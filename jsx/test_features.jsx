// jsx/test_features.jsx
// Tests: vgProgress(), panelInput (top input box), and panelData (custom UI / version.json params)

try {
    vgProgress(5, "Starting VG Tools feature test...");
    $.sleep(300);

    // 1. Check or create an active document
    var doc;
    if (app.documents.length === 0) {
        vgProgress(15, "No document open. Creating test document...");
        doc = app.documents.add(DocumentColorSpace.RGB, 800, 600);
        $.sleep(400);
    } else {
        doc = app.activeDocument;
    }

    // 2. Read values injected by app.js
    var userMessage = (typeof panelInput !== "undefined" && panelInput !== "")
        ? panelInput
        : "Hello from VG Tools!";

    var itemCount = (typeof panelData !== "undefined" && panelData && panelData.count)
        ? Number(panelData.count)
        : 5;

    var scaleFactor = (typeof panelData !== "undefined" && panelData && panelData.scale)
        ? Number(panelData.scale)
        : 1;

    // 3. Create a dedicated test layer
    vgProgress(25, "Creating test layer...");
    var testLayer = doc.layers.add();
    testLayer.name = "VG_Test_" + new Date().getTime();
    $.sleep(300);

    // 4. Create header text showing received panelInput & panelData
    var headerText = testLayer.textFrames.add();
    headerText.contents = "Input: " + userMessage + " | Scale: " + scaleFactor + "x | Items: " + itemCount;
    headerText.left = 50;
    headerText.top = -40;
    headerText.textRange.characterAttributes.size = 16;

    // 5. Loop with live progress updates (25% -> 95%)
    var boxSize = 40 * scaleFactor;
    var gap = 15;

    for (var i = 0; i < itemCount; i++) {
        var pct = 25 + Math.round(((i + 1) / itemCount) * 70);
        vgProgress(pct, "Creating test item " + (i + 1) + " of " + itemCount + "...");

        // Draw a colored rectangle
        var rect = testLayer.pathItems.rectangle(
            -90,
            50 + i * (boxSize + gap),
            boxSize,
            boxSize
        );

        var fillColor = new RGBColor();
        fillColor.red = 0;
        fillColor.green = Math.min(255, 110 + (i * 25));
        fillColor.blue = 212;

        rect.filled = true;
        rect.fillColor = fillColor;
        rect.stroked = false;

        // Add number label below box
        var numLabel = testLayer.textFrames.add();
        numLabel.contents = "#" + (i + 1);
        numLabel.left = 50 + i * (boxSize + gap) + 5;
        numLabel.top = -90 - boxSize - 10;
        numLabel.textRange.characterAttributes.size = 12;

        app.redraw();
        $.sleep(450); // Pause briefly so you can watch the live progress bar move
    }

    vgProgress(100, "Test complete! Created " + itemCount + " items.");
    "SUCCESS: Created " + itemCount + " items on layer " + testLayer.name;

} catch (err) {
    vgProgress(100, "Error: " + err.message);
    alert("VG Tools Test Error (Line " + err.line + "): " + err.message);
    "ERROR: " + err.message;
}
