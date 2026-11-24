// jsx/hide_graphics.jsx
try {
    var reportProgress = function (pct, msg) {
        if (typeof vgProgress === "function") vgProgress(pct, msg);
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

    function compoundMatches(compoundItem, checkFn) {
        try {
            var paths = compoundItem.pathItems;
            for (var i = 0; i < paths.length; i++) {
                if (checkFn(paths[i])) return true;
            }
        } catch (e) {}
        return false;
    }

    function processContainer(container) {
        if (container.layers && container.layers.length > 0) {
            for (var sl = 0; sl < container.layers.length; sl++) {
                var subLayer = container.layers[sl];
                if (!subLayer.visible || subLayer.locked) continue;
                processContainer(subLayer);
            }
        }

        var items = container.pageItems;
        for (var i = items.length - 1; i >= 0; i--) {
            var item = items[i];
            if (item.hidden || item.locked) continue;

            var type = item.typename;

            if (type === "GroupItem") {
                processContainer(item);
                continue;
            }

            if (type === "CompoundPathItem") {
                if (hideFillEnabled && compoundMatches(item, isFilledPath)) {
                    item.hidden = true;
                    hiddenFillCount++;
                } else if (hideDashedEnabled && compoundMatches(item, isDashedPath)) {
                    item.hidden = true;
                    hiddenDashedCount++;
                } else if (hideOnlyLinesEnabled && compoundMatches(item, isOnlyLine)) {
                    item.hidden = true;
                    hiddenOnlyLinesCount++;
                }
                continue;
            }

            if (type === "PathItem") {
                if (item.clipping) continue;

                if (hideFillEnabled && isFilledPath(item)) {
                    item.hidden = true;
                    hiddenFillCount++;
                } else if (hideDashedEnabled && isDashedPath(item)) {
                    item.hidden = true;
                    hiddenDashedCount++;
                } else if (hideOnlyLinesEnabled && isOnlyLine(item)) {
                    item.hidden = true;
                    hiddenOnlyLinesCount++;
                }
                continue;
            }

            if (type === "TextFrame" && hideTextEnabled) {
                item.hidden = true;
                hiddenTextCount++;
            }
        }
    }

    var totalLayers = doc.layers.length;
    for (var l = 0; l < totalLayers; l++) {
        var layer = doc.layers[l];
        var pct = 25 + Math.round(((l + 1) / totalLayers) * 70);
        reportProgress(pct, "Layer " + (l + 1) + "/" + totalLayers + ": " + layer.name);

        if (!layer.visible || layer.locked) continue;
        processContainer(layer);
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
