#target illustrator

var doc = app.activeDocument;
var sel = doc.selection;

if (sel.length < 2) {
    alert("Select at least TWO text objects.");
} else {

    // Determine the spacing and check its origin for the alert message
    var rawInput = Number(panelInput);
    var spacing;
    var spacingSource;

    if (isNaN(rawInput)) {
        spacing = -3; // Default fallback value
        spacingSource = "Default (-3pt)";
    } else {
        spacing = rawInput;
        spacingSource = "Panel Input (" + spacing + "pt)";
    }

    // Collect each object's bounds
    var objects = [];
    for (var i = 0; i < sel.length; i++) {
        var b = sel[i].visibleBounds; // [left, top, right, bottom]
        objects.push({
            item: sel[i],
            bounds: b,
            width: b[2] - b[0],
            height: b[1] - b[3]
        });
    }

    // Sort from top to bottom (Illustrator Y increases upward, so higher top bounds come first)
    objects.sort(function(a, b) {
        return b.bounds[1] - a.bounds[1]; 
    });

    // Use the topmost object's horizontal center as the alignment anchor
    var baseObj = objects[0];
    var targetCenterX = (baseObj.bounds[0] + baseObj.bounds[2]) / 2;

    // Keep track of the bottom Y of the previous object in the stack
    var currentBottomY = baseObj.bounds[3];

    // Process all subsequent objects sequentially (supports 3, 4, 5+ objects)
    for (var i = 1; i < objects.length; i++) {
        var currObj = objects[i];
        var b = currObj.bounds;

        // --- Center horizontally relative to the topmost object ---
        var currCenterX = (b[0] + b[2]) / 2;
        var shiftX = targetCenterX - currCenterX;

        // --- Vertical spacing ---
        var targetTopY = currentBottomY - spacing;
        var shiftY = targetTopY - b[1];

        // Apply translation to the current object
        currObj.item.translate(shiftX, shiftY);

        // Update currentBottomY based on the newly translated object's bottom bounds for the next item
        var updatedBounds = currObj.item.visibleBounds;
        currentBottomY = updatedBounds[3];
    }

    // Final alert showing the exact source and value applied
    alert("Successfully aligned " + objects.length + " text objects!\nApplied Spacing: " + spacing + " pt\nSource: " + spacingSource);
}
