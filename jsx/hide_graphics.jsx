// jsx/hide_graphics.jsx
try {
    var reportProgress = function (pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    };

    if (!app.documents.length) {
        reportProgress(100, "No document open.");
        return '{"ok":false,"error":"Please open an Illustrator document first."}';
    }

    var opts = (typeof panelData !== "undefined" && panelData) ? panelData : {};
    var hideFillEnabled      = Boolean(opts.hideFill);
    var hideTextEnabled      = Boolean(opts.hideText);
    var hideDashedEnabled    = Boolean(opts.hideDashed);
    var hideOnlyLinesEnabled = Boolean(opts.hideOnlyLines);

    if (!hideFillEnabled && !hideTextEnabled && !hideDashedEnabled && !hideOnlyLinesEnabled) {
        reportProgress(100, "Nothing selected.");
        return '{"ok":false,"error":"Nothing selected. Check at least one option."}';
    }

    var doc = app.activeDocument;
    var hiddenFillCount = 0;
    var hiddenTextCount = 0;
    var hiddenDashedCount = 0;
    var hiddenOnlyLinesCount = 0;

    function isFilledPath(pathItem) {
        try {
            return Boolean(pathItem.filled && pathItem.fillColor && pathItem.fillColor.typename !== "NoColor");
        } catch (e) {
            return false;
        }
    }

    function hasStroke(pathItem) {
        try {
            return Boolean(pathItem.stroked && pathItem.strokeWidth > 0 && pathItem.strokeColor && pathItem.strokeColor.typename !== "NoColor");
        } catch (e) {
            return false;
        }
    }

    function isDashedPath(pathItem) {
        try {
            if (!hasStroke(pathItem)) return false;
            var dashArray = pathItem.strokeDashes;
            return Boolean(dashArray && dashArray.length > 0);
        } catch (e) {
            return false;
        }
    }

    function isOnlyLine(pathItem) {
        try {
            if (!hasStroke(pathItem)) return false;
            return Boolean(!pathItem.closed || !isFilledPath(pathItem));
        } catch (e) {
            return false;
        }
    }

    function hasFilledSubPath(compoundItem) {
        try {
            var paths = compoundItem.pathItems;
            for (var i = 0; i < paths.length; i++) {
                if (isFilledPath(paths[i])) return true;
            }
        } catch (e) {}
        return false;
    }

    var totalLayers = doc.layers.length;

    // Process one layer at a time for speed
    for (var l = 0; l < totalLayers; l++) {
        var layer = doc.layers[l];
        var pct = 25 + Math.round(((l + 1) / totalLayers) * 70);
        reportProgress(pct, "Layer " + (l + 1) + "/" + totalLayers + ": " + layer.name);

        if (!layer.visible || layer.locked) continue;

        if (hideFillEnabled) {
            var compounds = layer.compoundPathItems;
            for (var c = compounds.length - 1; c >= 0; c--) {
                var comp = compounds[c];
                if (!comp.hidden && !comp.locked && hasFilledSubPath(comp)) {
                    comp.hidden = true;
                    hiddenFillCount++;
                }
            }
        }

        var paths = layer.pathItems;
        for (var p = paths.length - 1; p >= 0; p--) {
            var path = paths[p];
            if (path.hidden || path.locked) continue;
            if (path.parent && path.parent.typename === "CompoundPathItem") continue;

            if (hideFillEnabled && isFilledPath(path)) {
                path.hidden = true;
                hiddenFillCount++;
                continue;
            }

            if (hideDashedEnabled && isDashedPath(path)) {
                path.hidden = true;
                hiddenDashedCount++;
                continue;
            }

            if (hideOnlyLinesEnabled && isOnlyLine(path)) {
                path.hidden = true;
                hiddenOnlyLinesCount++;
                continue;
            }
        }

        if (hideTextEnabled) {
            var texts = layer.textFrames;
            for (var t = texts.length - 1; t >= 0; t--) {
                var tf = texts[t];
                if (!tf.hidden && !tf.locked) {
                    tf.hidden = true;
                    hiddenTextCount++;
                }
            }
        }
    }

    app.redraw();
    reportProgress(100, "Done!");

    return '{"ok":true' +
        ',"fill":' + hiddenFillCount +
        ',"dashed":' + hiddenDashedCount +
        ',"lines":' + hiddenOnlyLinesCount +
        ',"text":' + hiddenTextCount + '}';

} catch (err) {
    var msg = String(err.message || err).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
    if (typeof vgProgress === "function") vgProgress(100, "Error: " + msg);
    return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + msg + '"}';
}
