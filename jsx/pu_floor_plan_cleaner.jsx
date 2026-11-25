#target illustrator

(function () {
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

    function executeOrganizer() {
        var isHtmlMode = (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true);

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
        var CHUNK = 200; // safe chunk size for UI breathing

        var summary = {
            text: 0,
            fill: 0,
            stroke: 0,
            dashed: 0,
            line: 0,
            zeroSize: 0
        };

        // =========================
        // SCRIPT 1: TEXT
        // =========================
        if (opts.runText) {
            report(10, "Moving text frames...");
            (function () {
                var newLayer;
                try { newLayer = doc.layers.getByName("text"); } catch (e) { newLayer = doc.layers.add(); newLayer.name = "text"; }
                for (var l = 0; l < doc.layers.length; l++) {
                    var layer = doc.layers[l];
                    if (!layer.visible || layer.locked) continue;
                    var tfs = layer.textFrames;
                    for (var i = tfs.length - 1; i >= 0; i--) {
                        tfs[i].move(newLayer, ElementPlacement.PLACEATBEGINNING);
                        summary.text++;
                        if (i % CHUNK === 0) $.sleep(5);
                    }
                    $.sleep(5);
                }
            })();
        }

        // =========================
        // SCRIPT 2: FILL
        // =========================
        if (opts.runFill) {
            report(25, "Moving filled paths...");
            (function () {
                var fillLayer;
                try { fillLayer = doc.layers.getByName("fill"); } catch (e) { fillLayer = doc.layers.add(); fillLayer.name = "fill"; }

                function process(items) {
                    for (var i = 0; i < items.length; i++) {
                        var it = items[i];
                        if (it.locked || it.hidden || it.layer.locked || !it.layer.visible) continue;
                        var moved = false;

                        try {
                            if (it.typename === "PathItem") {
                                if (it.filled && it.fillColor != null) {
                                    it.move(fillLayer, ElementPlacement.PLACEATBEGINNING);
                                    moved = true;
                                }
                            } else if (it.typename === "GroupItem") {
                                moved = process(it.pageItems) || moved;
                            } else if (it.typename === "CompoundPathItem") {
                                moved = process(it.pathItems) || moved;
                            }
                        } catch (e) {}

                        if (moved) summary.fill++;
                        if (i % CHUNK === 0) $.sleep(5);
                    }
                    return false;
                }

                process(doc.pageItems);
            })();
        }

        // =========================
        // SCRIPT 3A: ZERO SIZE OBJECTS
        // =========================
        if (opts.runZeroSize) {
            report(42, "Moving zero-size objects...");
            (function () {
                var zeroLayer;
                try {
                    zeroLayer = doc.layers.getByName("zero_size");
                } catch (e) {
                    zeroLayer = doc.layers.add();
                    zeroLayer.name = "zero_size";
                }

                var targetW = 0;
                var targetH = 0;
                var tol = 0.01;

                function processItem(item) {
                    if (item.locked || item.hidden || item.layer.locked || !item.layer.visible) {
                        return 0;
                    }
                    var moved = 0;
                    try {
                        if (Math.abs(item.width - targetW) < tol && Math.abs(item.height - targetH) < tol) {
                            item.move(zeroLayer, ElementPlacement.PLACEATBEGINNING);
                            moved++;
                        }
                    } catch (e) {}
                    return moved;
                }

                for (var l = 0; l < doc.layers.length; l++) {
                    var layer = doc.layers[l];
                    if (
                        layer.name === "text" ||
                        layer.name === "fill" ||
                        layer.name === "stroke" ||
                        layer.name === "line" ||
                        layer.name === "dashed" ||
                        layer.name === "zero_size" ||
                        layer.locked ||
                        !layer.visible
                    ) {
                        continue;
                    }

                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.zeroSize += processItem(items[i]);
                    }
                    $.sleep(5);
                }
            })();
        }

        // =========================
        // SCRIPT 3B: STROKE
        // =========================
        if (opts.runStroke) {
            report(58, "Moving zero-stroke paths...");
            (function () {
                var targetLayer;
                try { targetLayer = doc.layers.getByName("stroke"); } catch (e) { targetLayer = doc.layers.add(); targetLayer.name = "stroke"; }

                function moveSafe(item, targetLayer) {
                    try {
                        item.duplicate(targetLayer, ElementPlacement.PLACEATEND);
                        item.remove();
                    } catch (e) {
                        try { item.move(targetLayer, ElementPlacement.PLACEATEND); } catch (err) {}
                    }
                }

                function isZeroStroke(path) {
                    return (!path.stroked || path.strokeWidth === 0);
                }

                function processItem(item) {
                    if (item.locked || item.hidden || item.layer.locked || !item.layer.visible) return 0;
                    if (item.layer.name === "fill") return 0;

                    var movedCount = 0;
                    switch (item.typename) {
                        case "PathItem":
                            if (isZeroStroke(item)) { moveSafe(item, targetLayer); movedCount++; }
                            break;
                        case "CompoundPathItem":
                            var paths = item.pathItems;
                            for (var i = 0; i < paths.length; i++) {
                                if (isZeroStroke(paths[i])) { moveSafe(item, targetLayer); movedCount++; break; }
                            }
                            break;
                        case "GroupItem":
                            for (var g = item.pageItems.length - 1; g >= 0; g--) {
                                movedCount += processItem(item.pageItems[g]);
                            }
                            break;
                    }
                    return movedCount;
                }

                for (var l = 0; l < doc.layers.length; l++) {
                    var layer = doc.layers[l];
                    if (
                        layer.name === "fill" ||
                        layer.name === "stroke" ||
                        layer.name === "zero_size" ||
                        layer.locked ||
                        !layer.visible
                    ) continue;

                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.stroke += processItem(items[i]);
                    }
                    $.sleep(5);
                }
            })();
        }

        // =========================
        // SCRIPT 4A: DASHED LINES
        // =========================
        if (opts.runDashed) {
            report(74, "Moving dashed lines...");
            (function () {
                var dashedLayer;
                try {
                    dashedLayer = doc.layers.getByName("dashed");
                } catch (e) {
                    dashedLayer = doc.layers.add();
                    dashedLayer.name = "dashed";
                }

                function isDashed(path) {
                    try {
                        return (
                            path.stroked &&
                            path.strokeDashes &&
                            path.strokeDashes.length > 0 &&
                            path.strokeDashes[0] > 0
                        );
                    } catch (e) {
                        return false;
                    }
                }

                function processItem(item) {
                    if (item.locked || item.hidden || item.layer.locked || !item.layer.visible) {
                        return 0;
                    }
                    var moved = 0;
                    switch (item.typename) {
                        case "PathItem":
                            if (isDashed(item)) {
                                try {
                                    item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                                    moved++;
                                } catch (e) {}
                            }
                            break;
                        case "CompoundPathItem":
                            try {
                                var paths = item.pathItems;
                                for (var i = 0; i < paths.length; i++) {
                                    if (isDashed(paths[i])) {
                                        item.move(dashedLayer, ElementPlacement.PLACEATBEGINNING);
                                        moved++;
                                        break;
                                    }
                                }
                            } catch (e) {}
                            break;
                        case "GroupItem":
                            for (var g = item.pageItems.length - 1; g >= 0; g--) {
                                moved += processItem(item.pageItems[g]);
                            }
                            break;
                    }
                    return moved;
                }

                for (var l = 0; l < doc.layers.length; l++) {
                    var layer = doc.layers[l];
                    if (
                        layer.name === "text" ||
                        layer.name === "fill" ||
                        layer.name === "stroke" ||
                        layer.name === "dashed" ||
                        layer.name === "zero_size" ||
                        layer.locked ||
                        !layer.visible
                    ) {
                        continue;
                    }

                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        summary.dashed += processItem(items[i]);
                    }
                    $.sleep(5);
                }
            })();
        }

        // =========================
        // SCRIPT 4B: REMAINING GRAPHICS -> "line"
        // =========================
        if (opts.runLine) {
            report(88, "Moving remaining graphics to 'line'...");
            (function () {
                var lineLayer;
                try { lineLayer = doc.layers.getByName("line"); } catch (e) { lineLayer = doc.layers.add(); lineLayer.name = "line"; }

                for (var l = 0; l < doc.layers.length; l++) {
                    var layer = doc.layers[l];
                    if (
                        layer.name === "text" ||
                        layer.name === "fill" ||
                        layer.name === "stroke" ||
                        layer.name === "line" ||
                        layer.name === "dashed" ||
                        layer.name === "zero_size" ||
                        layer.locked ||
                        !layer.visible
                    ) continue;

                    var items = layer.pageItems;
                    for (var i = items.length - 1; i >= 0; i--) {
                        var it = items[i];
                        if (it.locked || it.hidden) continue;
                        try {
                            it.move(lineLayer, ElementPlacement.PLACEATBEGINNING);
                            summary.line++;
                        } catch (e) {}
                        if (i % CHUNK === 0) $.sleep(5);
                    }
                    $.sleep(5);
                }
            })();
        }

        // =========================
        // FINAL LAYER ORDER
        // =========================
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
                "Remaining graphics moved to 'line': " + summary.line + "\n" +
                "Zero-size graphics moved: " + summary.zeroSize + "\n\n" +
                "Layer order: text -> fill -> dashed -> line -> stroke -> zero_size";
            alert(alertMsg);
        }

        return '{"ok":true' +
            ',"message":"Layer Organizer completed"' +
            ',"text":' + summary.text +
            ',"fill":' + summary.fill +
            ',"dashed":' + summary.dashed +
            ',"line":' + summary.line +
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
