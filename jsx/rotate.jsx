if (app.documents.length > 0) {
    var sel = app.activeDocument.selection;

    if (sel.length > 0) {
        for (var i = 0; i < sel.length; i++) {
            var item = sel[i];

            if (item.typename === "TextFrame") {

                // Save center
                var b = item.geometricBounds;
                var cx = (b[0] + b[2]) / 2;
                var cy = (b[1] + b[3]) / 2;

                // Reset rotation by clearing matrix
                var m = app.getIdentityMatrix();
                item.transform(m, true, true, true, true, 1);

                // Rotate to horizontal (0°)
                // NOTE: If your text was vertical, rotate 90 to correct
                item.rotate(90);

                // Restore center
                var b2 = item.geometricBounds;
                var cx2 = (b2[0] + b2[2]) / 2;
                var cy2 = (b2[1] + b2[3]) / 2;

                item.translate(cx - cx2, cy - cy2);
            }
        }
    } else {
        alert("Select text.");
    }
}
