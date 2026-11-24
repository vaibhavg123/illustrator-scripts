// jsx/unhide_graphics.jsx
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

    var doc = app.activeDocument;
    var totalLayers = doc.layers.length;
    var unhiddenCount = 0;

    function unhideItems(collection) {
        for (var i = collection.length - 1; i >= 0; i--) {
            try {
                var item = collection[i];
                if (item.hidden && !item.locked) {
                    item.hidden = false;
                    unhiddenCount++;
                }
            } catch (e) {}
        }
    }

    for (var l = 0; l < totalLayers; l++) {
        var layer = doc.layers[l];
        var pct = 25 + Math.round(((l + 1) / totalLayers) * 70);
        reportProgress(pct, "Restoring layer " + (l + 1) + "/" + totalLayers + ": " + layer.name);

        if (!layer.visible || layer.locked) continue;

        unhideItems(layer.compoundPathItems);
        unhideItems(layer.pathItems);
        unhideItems(layer.textFrames);
        unhideItems(layer.pageItems);
    }

    app.redraw();
    reportProgress(100, "Restored " + unhiddenCount + " items!");

    return '{"ok":true,"unhidden":' + unhiddenCount + '}';

} catch (err) {
    var msg = String(err.message || err).replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");
    if (typeof vgProgress === "function") vgProgress(100, "Error: " + msg);
    return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + msg + '"}';
}
