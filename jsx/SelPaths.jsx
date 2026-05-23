// Select all filled paths in the document, with progress bar + Cancel button
// Works safely and responsively (no freezing)

if (app.documents.length > 0) {
    var doc = app.activeDocument;
    app.executeMenuCommand("deselectall");
    var fillCount = 0;
    var canceled = false;

    // Collect all path items recursively (including inside groups & compound paths)
    var allPaths = [];
    function collectPaths(items) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.locked || it.hidden) continue;
            if (it.typename === "GroupItem") collectPaths(it.pageItems);
            else if (it.typename === "CompoundPathItem") collectPaths(it.pathItems);
            else if (it.typename === "PathItem") allPaths.push(it);
        }
    }
    collectPaths(doc.pageItems);

    // Progress palette setup
    var w = new Window("palette", "Selecting Filled Paths");
    w.alignChildren = "fill";
    var infoText = w.add("statictext", undefined, "Preparing...");
    var progress = w.add("progressbar", undefined, 0, allPaths.length);
    progress.preferredSize = [300, 20];
    var cancelBtn = w.add("button", undefined, "Cancel");
    cancelBtn.onClick = function() {
        canceled = true;
    };
    w.show();

    // Loop through all paths, chunked to stay responsive
    for (var i = 0; i < allPaths.length; i++) {
        if (canceled) break;

        var p = allPaths[i];
        try {
            // Check if path has a fill
            if (p.filled && p.fillColor != null) {
                p.selected = true;
                fillCount++;
            }
        } catch (e) {}

        // Update UI every 50 paths
        if (i % 50 === 0 || i === allPaths.length - 1) {
            progress.value = i;
            infoText.text = "Checked " + i + " of " + allPaths.length + " paths...";
            w.update();      // Refresh progress window
            $.sleep(10);     // Let Illustrator breathe
        }
    }

    w.close();

    // Show result
    if (canceled) {
        alert("⚠️ Process canceled.\n" + fillCount + " filled path(s) selected before stopping.");
    } else {
        alert("✅ Finished.\nSelected " + fillCount + " filled path(s).");
    }

} else {
    alert("No document open.");
}
