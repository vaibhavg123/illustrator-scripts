// ULTRA FAST dashed-line selector (no UI, max speed)
// - Visible layers only
// - Ignores clipping masks
// - Uses selection instead of large arrays
// - Bulk move via cut/paste

if (app.documents.length > 0) {

    var doc = app.activeDocument;
    app.executeMenuCommand("deselectall");

    var stack = [];
    var sel = []; // lightweight selection buffer

    // 👉 Only visible & unlocked layers
    var layers = doc.layers;
    for (var l = 0, ll = layers.length; l < ll; l++) {
        var layer = layers[l];
        if (!layer.visible || layer.locked) continue;

        var items = layer.pageItems;
        for (var i = 0, il = items.length; i < il; i++) {
            stack.push(items[i]);
        }
    }

    // 🚀 Main loop (tight + minimal checks)
    while (stack.length) {

        var it = stack.pop();
        if (it.locked || it.hidden) continue;

        var tn = it.typename;

        if (tn === "GroupItem") {

            if (it.clipped) continue;

            var kids = it.pageItems;
            for (var g = 0, gl = kids.length; g < gl; g++) {
                var k = kids[g];
                if (!k.hidden && !k.locked && !k.clipping) {
                    stack.push(k);
                }
            }
        }
        else if (tn === "CompoundPathItem") {

            var p = it.pathItems;
            if (p.length && p[0].clipping) continue;

            for (var c = 0, cl = p.length; c < cl; c++) {
                stack.push(p[c]);
            }
        }
        else if (tn === "PathItem") {

            if (it.clipping) continue;

            // ⚡ fastest safe dashed check
            if (it.stroked) {
                var d = it.strokeDashes;
                if (d && d.length) {
                    sel.push(it);
                }
            }
        }
    }

    // 👉 Apply selection once (critical for speed)
    if (sel.length) {
        doc.selection = sel;

        // 👉 Get/create Dash layer
        var dashLayer;
        try {
            dashLayer = doc.layers.getByName("Dash");
        } catch (e) {
            dashLayer = doc.layers.add();
            dashLayer.name = "Dash";
        }

        doc.activeLayer = dashLayer;

        // ⚡ FASTEST MOVE
        app.executeMenuCommand("cut");
        app.executeMenuCommand("pasteInPlace");

        alert("✅ Done: " + sel.length + " dashed lines moved");
    } else {
        alert("No dashed lines found");
    }

} else {
    alert("No document open.");
}
