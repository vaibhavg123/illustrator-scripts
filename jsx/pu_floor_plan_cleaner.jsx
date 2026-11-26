#target illustrator

(function () {
    var PT_TO_IN = 1 / 72;
    var SCALE_FACTOR = 9.733;
    var TARGET_LAYERS = {
        "text": true,
        "fill": true,
        "dashed": true,
        "line": true,
        "lines": true,
        "stroke": true,
        "zero_size": true
    };

    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    }

    function escapeJson(str) {
        return String(str === null || str === undefined ? "" : str)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, " ");
    }

    function getOrCreateLayer(doc, name) {
        try {
            return doc.layers.getByName(name);
        } catch (e) {
            var lyr = doc.layers.add();
            lyr.name = name;
            return lyr;
        }
    }

    function isLayerSkippable(layer, extraSkipMap) {
        if (!layer || !layer.visible || layer.locked) return true;
        if (TARGET_LAYERS[layer.name]) return true;
        if (extraSkipMap && extraSkipMap[layer.name]) return true;
        return false;
    }

    function isItemLockedOrHidden(item) {
        try {
            return Boolean(item.locked || item.hidden);
        } catch (e) {
            return true;
        }
    }

    function getSelectedLineInches() {
        if (app.documents.length === 0) {
            return '{"ok":false,"error":"No document open."}';
        }
        var doc = app.activeDocument;
        var sel = doc.selection;
        if (!sel || sel.length === 0) {
            return '{"ok":false,"error":"Select a line or object first."}';
        }

        var item = sel[0];
        var wIn = Math.abs(item.width) * PT_TO_IN;
        var hIn = Math.abs(item.height) * PT_TO_IN;

        // For a line, width or height holds the span; pick the larger non-zero axis
        var measuredIn = (hIn > wIn && hIn > 0.00001) ? hIn : wIn;
        if (measuredIn <= 0.00001) {
            measuredIn = Math.max(wIn, hIn);
        }

        return '{"ok":true' +
            ',"inches":' + Number(measuredIn.toFixed(4)) +
            ',"widthIn":' + Number(wIn.toFixed(4)) +
            ',"heightIn":' + Number(hIn.toFixed(4)) + '}';
    }

    function executeOrganizer() {
        var isHtmlMode = (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true);

        if (isHtmlMode && panelData.action === "getSelectedSize") {
            return getSelectedLineInches();
        }

        if (app.documents.length === 0) {
            report(100, "No document open.");
            if (!isHtmlMode) alert("No document open");
            return '{"ok":false,"error":"No document open."}';
        }

        var opts = {
            runText: isHtmlMode ? Boolean(panelData.runText) : true,
            runFill: isHtmlMode ? Boolean(panelData.runFill) : true,
            runZeroSize: isHtmlMode ? Boolean(panelData.runZeroSize) : true,
            runStroke: isHtmlMode ? Boolean(panelData.runStroke) : true,
            runDashed: isHtmlMode ? Boolean(panelData.runDashed) : true,
            runLine: isHtmlMode ? Boolean(panelData.runLine) : true,
            runReorder: isHtmlMode ? Boolean(panelData.runReorder) : true
        };

        var doc = app.activeDocument;
        var layers = doc.layers;
        var layerCount = layers.length;

        var summary = {
            text: 0,
            fill: 0,
            stroke: 0,
            dashed: 0,
            lines: 0,
            zeroSize: 0
        };

        // 1. TEXT (layer-by-layer)
        if (opts.runText) {
            report(12, "Moving text frames...");
            var textLayer = getOrCreateLayer(doc, "text");
            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                var tfs = layer.textFrames;
                for (var i = tfs.length - 1; i >= 0; i--) {
                    var tf = tfs[i];
                    if (isItemLockedOrHidden(tf)) continue;
                    try {
                        tf.move(textLayer, ElementPlacement.PLACEATBEGINNING);
                        summary.text++;
                    } catch (e) {}
                }
            }
        }

        // 2. FILL (layer-by-layer)
        if (opts.runFill) {
            report(28, "Moving filled paths...");
            var fillLayer = getOrCreateLayer(doc, "fill");

            function moveFilledItems(collection) {
                var movedAny = false;
                for (var i = collection.length - 1; i >= 0; i--) {
                    var it = collection[i];
                    if (isItemLockedOrHidden(it)) continue;
                    try {
                        if (it.typename === "PathItem") {
                            if (it.filled && it.fillColor != null) {
                                it.move(fillLayer, ElementPlacement.PLACEATBEGINNING);
                                summary.fill++;
                                movedAny = true;
                            }
                        } else if (it.typename === "GroupItem") {
                            if (moveFilledItems(it.pageItems)) movedAny = true;
                        } else if (it.typename === "CompoundPathItem") {
                            if (moveFilledItems(it.pathItems)) movedAny = true;
                        }
                    } catch (e) {}
                }
                return movedAny;
            }

            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                moveFilledItems(layer.pageItems);
            }
        }

        // 3A. ZERO-SIZE OBJECTS (layer-by-layer)
        if (opts.runZeroSize) {
            report(45, "Moving zero-size objects...");
            var zeroLayer = getOrCreateLayer(doc, "zero_size");
            var tol = 0.01;

            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    var item = items[i];
                    if (isItemLockedOrHidden(item)) continue;
                    try {
                        if (Math.abs(item.width) < tol && Math.abs(item.height) < tol) {
                            item.move(zeroLayer, ElementPlacement.PLACEATBEGINNING);
                            summary.zeroSize++;
                        }
                    } catch (e) {}
                }
            }
        }

        // 3B. ZERO-STROKE PATHS (layer-by-layer)
        if (opts.runStroke) {
            report(62, "Moving zero-stroke paths...");
            var strokeLayer = getOrCreateLayer(doc, "stroke");

            function isZeroStroke(path) {
                try {
                    return (!path.stroked || path.strokeWidth === 0);
                } catch (e) {
                    return false;
                }
            }

            function processStrokeItem(item) {
                if (isItemLockedOrHidden(item)) return;
                try {
                    if (item.typename === "PathItem") {
                        if (isZeroStroke(item)) {
                            item.move(strokeLayer, ElementPlacement.PLACEATEND);
                            summary.stroke++;
                        }
                    } else if (item.typename === "CompoundPathItem") {
                        var paths = item.pathItems;
                        for (var p = 0; p < paths.length; p++) {
                            if (isZeroStroke(paths[p])) {
                                item.move(strokeLayer, ElementPlacement.PLACEATEND);
                                summary.stroke++;
                                break;
                            }
                        }
                    } else if (item.typename === "GroupItem") {
                        for (var g = item.pageItems.length - 1; g >= 0; g--) {
                            processStrokeItem(item.pageItems[g]);
                        }
                    }
                } catch (e) {}
            }

            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    processStrokeItem(items[i]);
                }
            }
        }

        // 4A. DASHED LINES (layer-by-layer)
        if (opts.runDashed) {
            report(78, "Moving dashed lines...");
            var dashedLayer = getOrCreateLayer(doc, "dashed");

            function isDashed(path) {
                try {
                    return Boolean(
                        path.stroked &&
                        path.strokeDashes &&
                        path.strokeDashes.length > 0 &&
                        path.strokeDashes[0] > 0
                    );
                } catch (e) {
                    return false;
                }
            }

            function processDashedItem(item) {
                if (isItemLockedOrHidden(item)) return;
                try {
                    if (item.typename === "PathItem") {
                        if (isDashed(item)) {
                            item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                            summary.dashed++;
                        }
                    } else if (item.typename === "CompoundPathItem") {
                        var paths = item.pathItems;
                        for (var p = 0; p < paths.length; p++) {
                            if (isDashed(paths[p])) {
                                item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                                summary.dashed++;
                                break;
                            }
                        }
                    } else if (item.typename === "GroupItem") {
                        for (var g = item.pageItems.length - 1; g >= 0; g--) {
                            processDashedItem(item.pageItems[g]);
                        }
                    }
                } catch (e) {}
            }

            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    processDashedItem(items[i]);
                }
            }
        }

        // 4B. REMAINING GRAPHICS -> "line" (layer-by-layer)
        if (opts.runLine) {
            report(90, "Moving remaining graphics to 'line'...");
            var lineLayer = getOrCreateLayer(doc, "line");

            for (var l = 0; l < layerCount; l++) {
                var layer = layers[l];
                if (isLayerSkippable(layer)) continue;
                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    var it = items[i];
                    if (isItemLockedOrHidden(it)) continue;
                    try {
                        it.move(lineLayer, ElementPlacement.PLACEATBEGINNING);
                        summary.lines++;
                    } catch (e) {}
                }
            }
        }

        // 5. FINAL LAYER ORDER
        if (opts.runReorder) {
            report(96, "Reordering layers...");
            try {
                var orderNames = ["text", "fill", "dashed", "line", "stroke", "zero_size"];
                var prevLayer = null;
                for (var oi = 0; oi < orderNames.length; oi++) {
                    var lyr = null;
                    try { lyr = doc.layers.getByName(orderNames[oi]); } catch (eL) {}
                    if (!lyr) continue;
                    if (!prevLayer) {
                        lyr.move(doc, ElementPlacement.PLACEATBEGINNING);
                    } else {
                        lyr.move(prevLayer, ElementPlacement.PLACEAFTER);
                    }
                    prevLayer = lyr;
                }
            } catch (e) {}
        }

        app.redraw();
        report(100, "Layer Organizer complete!");

        if (!isHtmlMode) {
            var alertMsg = "Script Completed!\n\n" +
                "Text frames moved: " + summary.text + "\n" +
                "Filled paths moved: " + summary.fill + "\n" +
                "Dashed lines moved: " + summary.dashed + "\n" +
                "Zero-stroke paths moved: " + summary.stroke + "\n" +
                "Remaining graphics moved to 'line': " + summary.lines + "\n" +
                "Zero-size graphics moved: " + summary.zeroSize + "\n\n" +
                "Layer order: text -> fill -> dashed -> line -> stroke -> zero_size";
            alert(alertMsg);
        }

        return '{"ok":true' +
            ',"message":"Layer Organizer completed"' +
            ',"text":' + summary.text +
            ',"fill":' + summary.fill +
            ',"dashed":' + summary.dashed +
            ',"lines":' + summary.lines +
            ',"stroke":' + summary.stroke +
            ',"zeroSize":' + summary.zeroSize + '}';
    }

    try {
        return executeOrganizer();
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}';
    }
})();
