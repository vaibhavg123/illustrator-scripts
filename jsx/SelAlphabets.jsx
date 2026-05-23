function isEditable(item) {
    // Item must be unlocked and visible
    var p = item;
    while (p != null) {
        if (p.locked || p.hidden) return false;
        p = p.parent;
    }

    // Layer must be visible
    if (!item.layer.visible) return false;

    return true;
}

// Detect "real" text (ignore measurement-style letters)
function containsRealLetter(str) {
    // Match words with 2 or more letters
    return /\b[A-Za-z]{2,}\b/.test(str);
}

function selectTextWithLetters() {
    if (app.documents.length === 0) {
        alert("No open document.");
        return;
    }

    var doc = app.activeDocument;
    var selectedItems = [];

    // Prevent Illustrator from freezing
    var oldInteraction = app.userInteractionLevel;
    app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;

    try {
        var frames = doc.textFrames;
        for (var i = 0; i < frames.length; i++) {
            var tf = frames[i];
            if (!isEditable(tf)) continue;

            var txt = "";
            try {
                txt = tf.contents;
            } catch (e) { continue; }

            if (containsRealLetter(txt)) {
                selectedItems.push(tf);
            }
        }

        doc.selection = selectedItems.length > 0 ? selectedItems : null;

    } catch (e) {
        alert("Error: " + e);
    }

    app.userInteractionLevel = oldInteraction;
    alert(selectedItems.length + " text objects selected on visible layers.");
}

selectTextWithLetters();
