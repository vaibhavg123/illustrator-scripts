/**
 * Combine horizontally nearby text frames into one text frame.
 * Works in Illustrator CS6–2025.
 * 
 * FIXED:
 * – Ensures exactly one space before & after "X"
 * – Cleans extra spaces
 */
(function () {

    if (app.documents.length === 0) {
        alert("No document open.");
        return;
    }

    var doc = app.activeDocument;
    var sel = doc.selection;

    if (!sel || sel.length < 2) {
        alert("Select at least two text objects.");
        return;
    }

    // ---- SETTINGS ----
    var Y_TOLERANCE = 4;
    var GAP_THRESHOLD = 50;

    // ---- HELPERS ----
    function isText(it) {
        return it && it.typename === "TextFrame" && !it.locked && !it.hidden;
    }

    function yCenter(tf) {
        return tf.position[1] - tf.height / 2;
    }

    // ---- Collect text frames ----
    var frames = [];
    for (var i = 0; i < sel.length; i++) {
        if (isText(sel[i])) frames.push(sel[i]);
    }

    if (frames.length < 2) {
        alert("No multiple text frames found in the selection.");
        return;
    }

    // ---- Sort by Y then X ----
    frames.sort(function (a, b) {
        var dy = yCenter(b) - yCenter(a);
        if (Math.abs(dy) < Y_TOLERANCE) {
            return a.position[0] - b.position[0];
        }
        return dy;
    });

    // ---- Group into horizontal lines ----
    var lines = [];
    var currentLine = [frames[0]];

    for (var i = 1; i < frames.length; i++) {
        var prev = currentLine[currentLine.length - 1];
        var curr = frames[i];

        var yDiff = Math.abs(yCenter(prev) - yCenter(curr));
        var xDiff = curr.position[0] - (prev.position[0] - prev.width);

        if (yDiff <= Y_TOLERANCE && xDiff <= GAP_THRESHOLD) {
            currentLine.push(curr);
        } else {
            lines.push(currentLine);
            currentLine = [curr];
        }
    }
    lines.push(currentLine);

    // ---- Process lines ----
    var totalCombined = 0;

    for (var li = 0; li < lines.length; li++) {
        var group = lines[li];
        if (group.length < 2) continue;

        // Sort left → right
        group.sort(function (a, b) {
            return a.position[0] - b.position[0];
        });

        // ---- Combine text (no spacing here) ----
        var combinedText = "";
        for (var j = 0; j < group.length; j++) {
            combinedText += group[j].contents;
        }

        // ---- FIX SPACING AROUND X ----
        combinedText = combinedText
            .replace(/\s*[Xx×]\s*/g, " X ") // force single space around X
            .replace(/\s+/g, " ")           // collapse multiple spaces
            .replace(/^\s+|\s+$/g, "");     // trim

        var first = group[0];
        var newFrame = first.layer.textFrames.add();
        newFrame.position = first.position;
        newFrame.contents = combinedText;

        // Copy formatting
        try {
            var ca = first.textRange.characterAttributes;
            var ta = newFrame.textRange.characterAttributes;
            ta.textFont = ca.textFont;
            ta.size = ca.size;
            ta.fillColor = ca.fillColor;
        } catch (e) {}

        totalCombined += group.length;

        // Remove originals
        for (var d = 0; d < group.length; d++) {
            try { group[d].remove(); } catch (e) {}
        }
    }

    if (totalCombined > 0) {
        alert("✅ Combined " + totalCombined + " text objects.");
    } else {
        alert("No horizontally-near text groups found.");
    }

})();
