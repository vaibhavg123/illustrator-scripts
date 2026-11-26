#target illustrator

(function () {
    var PT_TO_IN = 1 / 72;

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

    function isWhiteFillColor(color) {
        if (!color || !color.typename) return false;
        try {
            if (color.typename === "RGBColor") {
                return (
                    color.red >= 254.5 &&
                    color.green >= 254.5 &&
                    color.blue >= 254.5
                );
            }
            if (color.typename === "CMYKColor") {
                return (
                    color.cyan <= 0.5 &&
                    color.magenta <= 0.5 &&
                    color.yellow <= 0.5 &&
                    color.black <= 0.5
                );
            }
            if (color.typename === "GrayColor") {
                return color.gray <= 0.5;
            }
            if (color.typename === "SpotColor" && color.spot && color.spot.color) {
                return isWhiteFillColor(color.spot.color);
            }
        } catch (e) {}
        return false;
    }

    function isWhiteFilledPath(pathItem) {
        try {
            if (!pathItem || pathItem.typename !== "PathItem") return false;
            if (!pathItem.filled || pathItem.fillColor == null) return false;
            return isWhiteFillColor(pathItem.fillColor);
        } catch (e) {
            return false;
        }
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

    function runMainClean(isHtmlMode, opts) {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            if (!isHtmlMode) alert("No document open");
            return '{"ok":false,"error":"No document open."}';
        }

        var doc = app.activeDocument;
        var CHUNK = 200; // safe chunk size for UI breathing

        // =========================
        // TRACK COUNTS
        // =========================
        var summary = {
            text: 0,
            whiteFill: 0,
            fill: 0,
            stroke: 0,
            dashed: 0,
            lines: 0,
            zeroSize: 0
        };

        var textLayer = opts.runText ? (function () {
            try { return doc.layers.getByName("text"); } catch (e) { var l = doc.layers.add(); l.name = "text"; return l; }
        })() : null;

        var whiteFillLayer = opts.runWhiteFill ? (function () {
            try { return doc.layers.getByName("white_fill"); } catch (e) { var l = doc.layers.add(); l.name = "white_fill"; return l; }
        })() : null;

        var fillLayer = opts.runFill ? (function () {
            try { return doc.layers.getByName("fill"); } catch (e) { var l = doc.layers.add(); l.name = "fill"; return l; }
        })() : null;

        var zeroLayer = opts.runZeroSize ? (function () {
            try { return doc.layers.getByName("zero_size"); } catch (e) { var l = doc.layers.add(); l.name = "zero_size"; return l; }
        })() : null;

        var strokeLayer = opts.runStroke ? (function () {
            try { return doc.layers.getByName("stroke"); } catch (e) { var l = doc.layers.add(); l.name = "stroke"; return l; }
        })() : null;

        var dashedLayer = opts.runDashed ? (function () {
            try { return doc.layers.getByName("dashed"); } catch (e) { var l = doc.layers.add(); l.name = "dashed"; return l; }
        })() : null;

        var linesLayer = opts.runLine ? (function () {
            try { return doc.layers.getByName("lines"); } catch (e) { var l = doc.layers.add(); l.name = "lines"; return l; }
        })() : null;

        // =========================
        // SCRIPT 1: TEXT (layer-by-layer)
        // =========================
        if (opts.runText && textLayer) {
            report(12, "Moving text frames...");
            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];
                if (layer === textLayer || !layer.visible || layer.locked) continue;
                var tfs = layer.textFrames;
                for (var i = tfs.length - 1; i >= 0; i--) {
                    try {
                        tfs[i].move(textLayer, ElementPlacement.PLACEATBEGINNING);
                        summary.text++;
                    } catch (e) {}
                    if (i % CHUNK === 0) $.sleep(5);
                }
                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 2A: #FFFFFF FILL -> "white_fill"
        // =========================
        if (opts.runWhiteFill && whiteFillLayer) {
            report(24, "Moving #FFFFFF filled graphics...");

            function processWhiteFill(items) {
                for (var i = items.length - 1; i >= 0; i--) {
                    var it = items[i];
                    if (it.locked || it.hidden || it.layer.locked || !it.layer.visible) continue;
                    var moved = false;

                    try {
                        if (it.typename === "PathItem") {
                            if (isWhiteFilledPath(it)) {
                                it.move(whiteFillLayer, ElementPlacement.PLACEATBEGINNING);
                                moved = true;
                            }
                        } else if (it.typename === "GroupItem") {
                            moved = processWhiteFill(it.pageItems) || moved;
                        } else if (it.typename === "CompoundPathItem") {
                            moved = processWhiteFill(it.pathItems) || moved;
                        }
                    } catch (e) {}

                    if (moved) summary.whiteFill++;
                    if (i % CHUNK === 0) $.sleep(5);
                }
                return false;
            }

            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];
                if (
                    layer === whiteFillLayer ||
                    layer.name === "text" ||
                    layer.name === "fill" ||
                    layer.name === "white_fill" ||
                    !layer.visible ||
                    layer.locked
                ) continue;
                processWhiteFill(layer.pageItems);
                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 2B: REMAINING FILL -> "fill"
        // =========================
        if (opts.runFill && fillLayer) {
            report(38, "Moving filled paths...");

            function processFill(items) {
                for (var i = items.length - 1; i >= 0; i--) {
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
                            moved = processFill(it.pageItems) || moved;
                        } else if (it.typename === "CompoundPathItem") {
                            moved = processFill(it.pathItems) || moved;
                        }
                    } catch (e) {}

                    if (moved) summary.fill++;
                    if (i % CHUNK === 0) $.sleep(5);
                }
                return false;
            }

            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];
                if (
                    layer === fillLayer ||
                    layer.name === "white_fill" ||
                    !layer.visible ||
                    layer.locked
                ) continue;
                processFill(layer.pageItems);
                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 3A: ZERO SIZE OBJECTS
        // =========================
        if (opts.runZeroSize && zeroLayer) {
            report(52, "Moving zero-size objects...");
            var targetW = 0;
            var targetH = 0;
            var tol = 0.01;

            function processZeroItem(item) {
                if (
                    item.locked ||
                    item.hidden ||
                    item.layer.locked ||
                    !item.layer.visible
                ) {
                    return 0;
                }

                var moved = 0;

                try {
                    if (
                        Math.abs(item.width - targetW) < tol &&
                        Math.abs(item.height - targetH) < tol
                    ) {
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
                    layer.name === "white_fill" ||
                    layer.name === "fill" ||
                    layer.name === "stroke" ||
                    layer.name === "lines" ||
                    layer.name === "dashed" ||
                    layer.name === "zero_size" ||
                    layer.locked ||
                    !layer.visible
                ) {
                    continue;
                }

                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    summary.zeroSize += processZeroItem(items[i]);
                }
                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 3B: STROKE
        // =========================
        if (opts.runStroke && strokeLayer) {
            report(66, "Moving zero-stroke paths...");

            function moveSafe(item, destLayer) {
                try {
                    item.duplicate(destLayer, ElementPlacement.PLACEATEND);
                    item.remove();
                } catch (e) {
                    try { item.move(destLayer, ElementPlacement.PLACEATEND); } catch (err) {}
                }
            }

            function isZeroStroke(path) {
                return (!path.stroked || path.strokeWidth === 0);
            }

            function processStrokeItem(item) {
                if (item.locked || item.hidden || item.layer.locked || !item.layer.visible) return 0;
                if (item.layer.name === "fill" || item.layer.name === "white_fill") return 0;

                var movedCount = 0;

                switch (item.typename) {
                    case "PathItem":
                        if (isZeroStroke(item)) { moveSafe(item, strokeLayer); movedCount++; }
                        break;
                    case "CompoundPathItem":
                        var paths = item.pathItems;
                        for (var i = 0; i < paths.length; i++) {
                            if (isZeroStroke(paths[i])) { moveSafe(item, strokeLayer); movedCount++; break; }
                        }
                        break;
                    case "GroupItem":
                        for (var i = item.pageItems.length - 1; i >= 0; i--) {
                            movedCount += processStrokeItem(item.pageItems[i]);
                        }
                        break;
                }
                return movedCount;
            }

            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];
                if (
                    layer.name === "fill" ||
                    layer.name === "white_fill" ||
                    layer.name === "stroke" ||
                    layer.name === "zero_size" ||
                    layer.locked ||
                    !layer.visible
                ) continue;
                var items = layer.pageItems;
                for (var i = items.length - 1; i >= 0; i--) {
                    summary.stroke += processStrokeItem(items[i]);
                }
                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 4A: DASHED LINES
        // =========================
        if (opts.runDashed && dashedLayer) {
            report(80, "Moving dashed lines...");

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

            function processDashedItem(item) {
                if (
                    item.locked ||
                    item.hidden ||
                    item.layer.locked ||
                    !item.layer.visible
                ) {
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
                        for (var i = item.pageItems.length - 1; i >= 0; i--) {
                            moved += processDashedItem(item.pageItems[i]);
                        }
                        break;
                }

                return moved;
            }

            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];

                if (
                    layer.name === "text" ||
                    layer.name === "white_fill" ||
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
                    summary.dashed += processDashedItem(items[i]);
                }

                $.sleep(5);
            }
        }

        // =========================
        // SCRIPT 4B: REMAINING GRAPHICS -> "lines"
        // =========================
        if (opts.runLine && linesLayer) {
            report(90, "Moving remaining graphics to 'lines'...");

            for (var l = 0; l < doc.layers.length; l++) {
                var layer = doc.layers[l];
                if (
                    layer.name === "text" ||
                    layer.name === "white_fill" ||
                    layer.name === "fill" ||
                    layer.name === "stroke" ||
                    layer.name === "lines" ||
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
                        it.move(linesLayer, ElementPlacement.PLACEATBEGINNING);
                        summary.lines++;
                    } catch (e) {}
                    if (i % CHUNK === 0) $.sleep(5);
                }
                $.sleep(5);
            }
        }

        // =========================
        // FINAL LAYER ORDER
        // =========================
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

        app.redraw();
        report(100, "Script Completed!");

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
