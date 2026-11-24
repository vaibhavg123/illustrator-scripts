// jsx/unhide_graphics.jsx
// Unhides all hidden graphic items across visible, unlocked layers

if (!app.documents.length) {
    vgProgress(100, "No document open.");
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
    vgProgress(pct, "Restoring layer " + (l + 1) + "/" + totalLayers + ": " + layer.name);

    if (!layer.visible || layer.locked) continue;

    // Unhide compound paths, paths, text frames, and any other page items
    unhideItems(layer.compoundPathItems);
    unhideItems(layer.pathItems);
    unhideItems(layer.textFrames);
    unhideItems(layer.pageItems);
}

app.redraw();
vgProgress(100, "Restored " + unhiddenCount + " items!");

return '{"ok":true,"unhidden":' + unhiddenCount + '}';
