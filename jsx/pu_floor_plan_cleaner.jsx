#target illustrator

(function () {
    var PT_TO_IN = 1 / 72;
    var CHUNK = 120;

    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            try { vgProgress(pct, msg); } catch (e) {}
        }
    }

    function escapeJson(str) {
        return String(str === null || str === undefined ? "" : str)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, " ");
    }

    function clearSelectionSafely(doc) {
        try {
            if (doc && doc.selection && doc.selection.length > 0) {
                doc.selection = null;
            }
        } catch (e) {}
    }

    function yieldBreath(stepCounter) {
        if (stepCounter % CHUNK === 0) {
            try { $.sleep(1); } catch (e) {}
        }
    }

    function isWhiteFillColor(color) {
        if (!color) return false;
        try {
            var t = color.typename;
            if (t === "RGBColor") {
                return (
                    color.red >= 254.0 &&
                    color.green >= 254.0 &&
                    color.blue >= 254.0
                );
            }
            if (t === "CMYKColor") {
                return (
                    color.cyan <= 0.5 &&
                    color.magenta <= 0.5 &&
                    color.yellow <= 0.5 &&
                    color.black <= 0.5
                );
            }
            if (t === "GrayColor") {
                // In Illustrator GrayColor, 0 = white and 100 = black
                return color.gray <= 0.5;
            }
            if (t === "SpotColor" && color.spot && color.spot.color) {
                var tint = (typeof color.tint === "number") ? color.tint : 100;
                return tint <= 0.5 || isWhiteFillColor(color.spot.color);
            }
        } catch (e) {}
        return false;
    }

    function isWhiteFilledPath(pathItem) {
        try {
            if (!pathItem || pathItem.typename !== "PathItem") return false;
            if (!pathItem.filled || pathItem.fillColor == null) return false;
            if (pathItem.fillColor.typename === "NoColor") return false;
            return isWhiteFillColor(pathItem.fillColor);
        } catch (e) {
            return false;
        }
    }

    function isWhiteFilledCompound(compoundItem) {
        try {
            if (!compoundItem || compoundItem.typename !== "CompoundPathItem") return false;
            var pItems = compoundItem.pathItems;
            if (!pItems || pItems.length === 0) return false;
            for (var p = 0; p < pItems.length; p++) {
                if (isWhiteFilledPath(pItems[p])) {
                    return true;
                }
            }
        } catch (e) {}
        return false;
    }

    function getItemDimensionsInInches(item) {
        var wPt = 0;
        var hPt = 0;

        try {
            if (item.geometricBounds && item.geometricBounds.length === 4) {
                var b = item.geometricBounds;
                wPt = Math.abs(b[2] - b[0]);
                hPt = Math.abs(b[1] - b[3]);
            }
        } catch (e) {}

        if (wPt === 0 && hPt === 0) {
            try { wPt = Math.abs(item.width || 0); } catch (e1) {}
            try { hPt = Math.abs(item.height || 0); } catch (e2) {}
        }

        return {
            widthIn: wPt * PT_TO_IN,
            heightIn: hPt * PT_TO_IN
        };
    }

    function getSelectedLineInches() {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            return '{"ok":false,"error":"No document open."}';
        }

        var doc = app.activeDocument;
        var sel = doc.selection;

        if (!sel || sel.length === 0) {
            report(100, "No selection.");
            return '{"ok":false,"error":"Select a line or object first."}';
        }

        var item = sel[0];
        var dims = getItemDimensionsInInches(item);
        var wIn = dims.widthIn;
        var hIn = dims.heightIn;

        var measuredIn = wIn;
        var orientation = "horizontal";

        if (item.typename === "PathItem" && item.pathPoints && item.pathPoints.length >= 2) {
            var pFirst = item.pathPoints[0].anchor;
            var pLast = item.pathPoints[item.pathPoints.length - 1].anchor;
            var dxIn = Math.abs(pLast[0] - pFirst[0]) * PT_TO_IN;
            var dyIn = Math.abs(pLast[1] - pFirst[1]) * PT_TO_IN;

            if (dyIn > dxIn) {
                measuredIn = dyIn;
                orientation = "vertical";
            } else {
                measuredIn = dxIn;
                orientation = "horizontal";
            }
        } else if (hIn > wIn) {
            measuredIn = hIn;
            orientation = "vertical";
        } else {
            measuredIn = wIn;
            orientation = "horizontal";
        }

        var rounded = parseFloat(measuredIn.toFixed(4));
        if (isNaN(rounded)) {
            rounded = 0;
        }

        report(100, "Fetched " + orientation + " size: " + rounded + " in");
        return '{"ok":true' +
            ',"inches":' + rounded +
            ',"orientation":"' + orientation + '"' +
            ',"widthIn":' + parseFloat(wIn.toFixed(4)) +
            ',"heightIn":' + parseFloat(hIn.toFixed(4)) + '}';
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

    function runMainClean(isHtmlMode, opts) {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            if (!isHtmlMode) alert("No document open");
            return '{"ok":false,"error":"No document open."}';
        }

        var doc = app.activeDocument;
        var oldInteraction = app.userInteractionLevel;
        app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        clearSelectionSafely(doc);

        var summary = {
            text: 0,
            whiteFill: 0,
            fill: 0,
            stroke: 0,
            dashed: 0,
            lines: 0,
            zeroSize: 0
        };

        var pulse = 0;

        try {
            var textLayer = opts.runText ? getOrCreateLayer(doc, "text") : null;
            var whiteFillLayer = opts.runWhiteFill ? getOrCreateLayer(doc, "white_fill") : null;
            var fillLayer = opts.runFill ? getOrCreateLayer(doc, "fill") : null;
            var zeroLayer = opts.runZeroSize ? getOrCreateLayer(doc, "zero_size") : null;
            var strokeLayer = opts.runStroke ? getOrCreateLayer(doc, "stroke") : null;
            var dashedLayer = opts.runDashed ? getOrCreateLayer(doc, "dashed") : null;
            var linesLayer = opts.runLine ? getOrCreateLayer(doc, "lines") : null;

            var sourceLayers = [];
            for (var s = 0; s < doc.layers.length; s++) {
                var sl = doc.layers[s];
                if (
                    sl === textLayer || sl === whiteFillLayer || sl === fillLayer ||
                    sl === zeroLayer || sl === strokeLayer || sl === dashedLayer || sl === linesLayer
                ) {
                    continue;
                }
                if (!sl.visible || sl.locked) continue;
                sourceLayers.push(sl);
            }

            var totalSrc = Math.max(sourceLayers.length, 1);

            // 1. TEXT (layer-by-layer)
            if (opts.runText && textLayer) {
                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 5 + Math.round(((l + 1) / totalSrc) * 12);
                    report(pct, "Text [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);

                    var tfs = layer.textFrames;
                    for (var i = tfs.length - 1; i >= 0; i--) {
                        pulse++;
                        try {
                            tfs[i].move(textLayer, ElementPlacement.PLACEATBEGINNING);
                            summary.text++;
                        } catch (e) {}
                        yieldBreath(pulse);
                    }
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 2A. #FFFFFF FILL -> "white_fill" (layer-by-layer)
            if (opts.runWhiteFill && whiteFillLayer) {
                function processWhiteFill(items) {
                    var movedAny = false;
                    for (var i = items.length - 1; i >= 0; i--) {
                        pulse++;
                        var it = items[i];
                        if (it.locked || it.hidden) { yieldBreath(pulse); continue; }
                        try {
                            if (it.typename === "PathItem") {
                                if (isWhiteFilledPath(it)) {
                                    it.move(whiteFillLayer, ElementPlacement.PLACEATBEGINNING);
                                    summary.whiteFill++;
                                    movedAny = true;
                                }
                            } else if (it.typename === "CompoundPathItem") {
                                if (isWhiteFilledCompound(it)) {
                                    it.move(whiteFillLayer, ElementPlacement.PLACEATBEGINNING);
                                    summary.whiteFill++;
                                    movedAny = true;
                                }
                            } else if (it.typename === "GroupItem") {
                                if (processWhiteFill(it.pageItems)) {
                                    movedAny = true;
                                }
                            }
                        } catch (e) {}
                        yieldBreath(pulse);
                    }
                    return movedAny;
                }

                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 18 + Math.round(((l + 1) / totalSrc) * 14);
                    report(pct, "#FFFFFF Fill [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);
                    processWhiteFill(layer.pageItems);
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 2B. REMAINING FILL -> "fill" (layer-by-layer)
            if (opts.runFill && fillLayer) {
                function processFill(items) {
                    var movedAny = false;
                    for (var i = items.length - 1; i >= 0; i--) {
                        pulse++;
                        var it = items[i];
                        if (it.locked || it.hidden) { yieldBreath(pulse); continue; }
                        try {
                            if (it.typename === "PathItem") {
                                if (it.filled && it.fillColor != null && it.fillColor.typename !== "NoColor") {
                                    it.move(fillLayer, ElementPlacement.PLACEATBEGINNING);
                                    summary.fill++;
                                    movedAny = true;
                                }
                            } else if (it.typename === "CompoundPathItem") {
                                if (processFill(it.pathItems)) {
                                    movedAny = true;
                                }
                            } else if (it.typename === "GroupItem") {
                                if (processFill(it.pageItems)) {
                                    movedAny = true;
                                }
                            }
                        } catch (e) {}
                        yieldBreath(pulse);
                    }
                    return movedAny;
                }

                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 33 + Math.round(((l + 1) / totalSrc) * 14);
                    report(pct, "Fill [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);
                    processFill(layer.pageItems);
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 3A. ZERO SIZE OBJECTS (layer-by-layer)
            if (opts.runZeroSize && zeroLayer) {
                var targetW = 0;
                var targetH = 0;
                var tol = 0.01;

                function processZeroItem(item) {
                    pulse++;
                    if (item.locked || item.hidden) { yieldBreath(pulse); return 0; }
                    var moved = 0;
                    try {
                        if (Math.abs(item.width - targetW) < tol && Math.abs(item.height - targetH) < tol) {
                            item.move(zeroLayer, ElementPlacement.PLACEATBEGINNING);
                            moved++;
                        }
                    } catch (e) {}
                    yieldBreath(pulse);
                    return moved;
                }

                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 48 + Math.round(((l + 1) / totalSrc) * 12);
                    report(pct, "Zero-Size [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);
                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.zeroSize += processZeroItem(items[i]);
                    }
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 3B. ZERO-STROKE PATHS (layer-by-layer)
            if (opts.runStroke && strokeLayer) {
                function isZeroStroke(path) {
                    try { return (!path.stroked || path.strokeWidth === 0); } catch (e) { return false; }
                }

                function processStrokeItem(item) {
                    pulse++;
                    if (item.locked || item.hidden) { yieldBreath(pulse); return 0; }
                    var movedCount = 0;
                    try {
                        switch (item.typename) {
                            case "PathItem":
                                if (isZeroStroke(item)) {
                                    item.move(strokeLayer, ElementPlacement.PLACEATEND);
                                    movedCount++;
                                }
                                break;
                            case "CompoundPathItem":
                                var paths = item.pathItems;
                                for (var i = 0; i < paths.length; i++) {
                                    if (isZeroStroke(paths[i])) {
                                        item.move(strokeLayer, ElementPlacement.PLACEATEND);
                                        movedCount++;
                                        break;
                                    }
                                }
                                break;
                            case "GroupItem":
                                for (var g = item.pageItems.length - 1; g >= 0; g--) {
                                    movedCount += processStrokeItem(item.pageItems[g]);
                                }
                                break;
                        }
                    } catch (e) {}
                    yieldBreath(pulse);
                    return movedCount;
                }

                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 61 + Math.round(((l + 1) / totalSrc) * 12);
                    report(pct, "Zero-Stroke [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);
                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.stroke += processStrokeItem(items[i]);
                    }
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 4A. DASHED LINES (layer-by-layer)
            if (opts.runDashed && dashedLayer) {
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
                    pulse++;
                    if (item.locked || item.hidden) { yieldBreath(pulse); return 0; }
                    var moved = 0;
                    try {
                        switch (item.typename) {
                            case "PathItem":
                                if (isDashed(item)) {
                                    item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                                    moved++;
                                }
                                break;
                            case "CompoundPathItem":
                                var paths = item.pathItems;
                                for (var i = 0; i < paths.length; i++) {
                                    if (isDashed(paths[i])) {
                                        item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                                        moved++;
                                        break;
                                    }
                                }
                                break;
                            case "GroupItem":
                                for (var g = item.pageItems.length - 1; g >= 0; g--) {
                                    moved += processDashedItem(item.pageItems[g]);
                                }
                                break;
                        }
                    } catch (e) {}
                    yieldBreath(pulse);
                    return moved;
                }

                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 74 + Math.round(((l + 1) / totalSrc) * 10);
                    report(pct, "Dashed [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);
                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.dashed += processDashedItem(items[i]);
                    }
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 4B. REMAINING GRAPHICS -> "lines" (layer-by-layer)
            if (opts.runLine && linesLayer) {
                for (var l = 0; l < sourceLayers.length; l++) {
                    var layer = sourceLayers[l];
                    if (!layer.visible || layer.locked) continue;
                    var pct = 85 + Math.round(((l + 1) / totalSrc) * 9);
                    report(pct, "Remaining -> lines [" + (l + 1) + "/" + sourceLayers.length + "]: " + layer.name);

                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        pulse++;
                        var it = items[i];
                        if (it.locked || it.hidden) { yieldBreath(pulse); continue; }
                        try {
                            it.move(linesLayer, ElementPlacement.PLACEATBEGINNING);
                            summary.lines++;
                        } catch (e) {}
                        yieldBreath(pulse);
                    }
                    try { $.sleep(1); } catch (e) {}
                }
            }

            // 5. FINAL LAYER ORDER
            if (opts.runReorder) {
                report(96, "Reordering layers...");
                try {
                    var orderNames = ["text", "white_fill", "fill", "dashed", "lines", "stroke", "zero_size"];
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

            clearSelectionSafely(doc);
            report(100, "Script Completed!");
        } finally {
            app.userInteractionLevel = oldInteraction;
        }

        if (!isHtmlMode) {
            var alertMsg = "Script Completed!\n\n";
            alertMsg += "Text frames moved: " + summary.text + "\n";
            alertMsg += "#FFFFFF fill graphics moved: " + summary.whiteFill + "\n";
            alertMsg += "Filled paths moved: " + summary.fill + "\n";
            alertMsg += "Dashed lines moved: " + summary.dashed + "\n";
            alertMsg += "Zero-stroke paths moved: " + summary.stroke + "\n";
            alertMsg += "Remaining graphics moved to 'lines': " + summary.lines + "\n";
            alertMsg += "Zero-size graphics moved: " + summary.zeroSize + "\n";
            alertMsg += "\nLayer order: text -> white_fill -> fill -> dashed -> lines -> stroke -> zero_size";
            alert(alertMsg);
        }

        return '{"ok":true' +
            ',"message":"Script Completed"' +
            ',"text":' + summary.text +
            ',"whiteFill":' + summary.whiteFill +
            ',"fill":' + summary.fill +
            ',"dashed":' + summary.dashed +
            ',"lines":' + summary.lines +
            ',"stroke":' + summary.stroke +
            ',"zeroSize":' + summary.zeroSize + '}';
    }

    try {
        var isHtmlMode = (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true);

        if (isHtmlMode && panelData.action === "getSelectedSize") {
            return getSelectedLineInches();
        }

        var opts = {
            runText: isHtmlMode ? Boolean(panelData.runText) : true,
            runWhiteFill: isHtmlMode ? (panelData.runWhiteFill !== undefined ? Boolean(panelData.runWhiteFill) : true) : true,
            runFill: isHtmlMode ? Boolean(panelData.runFill) : true,
            runZeroSize: isHtmlMode ? Boolean(panelData.runZeroSize) : true,
            runStroke: isHtmlMode ? Boolean(panelData.runStroke) : true,
            runDashed: isHtmlMode ? Boolean(panelData.runDashed) : true,
            runLine: isHtmlMode ? Boolean(panelData.runLine) : true,
            runReorder: isHtmlMode ? Boolean(panelData.runReorder) : true
        };

        return runMainClean(isHtmlMode, opts);
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}';
    }
})();
