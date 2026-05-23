#target illustrator

var doc = app.activeDocument;
var sel = doc.selection;

if (sel.length < 2) {
    alert("Select at least TWO text objects.");
} else {

   var spacing = Number(panelInput);

  if (isNaN(spacing)) {
      spacing = -2;
  }

    // Collect each object's bounds
    var objects = [];
    for (var i = 0; i < sel.length; i++) {
        var b = sel[i].visibleBounds; // [x1, y1, x2, y2]
        objects.push({
            item: sel[i],
            bounds: b,
            width: b[2] - b[0],
            height: b[1] - b[3]
        });
    }

    // Sort from top to bottom (Illustrator Y decreases downward)
    objects.sort(function(a, b) {
        return b.bounds[1] - a.bounds[1]; 
    });

    // Process objects in pairs
    for (var i = 0; i < objects.length - 1; i += 2) {
        var topObj = objects[i];
        var bottomObj = objects[i + 1];

        // --- Center horizontally relative to top object ---
        var topCenterX = (topObj.bounds[0] + topObj.bounds[2]) / 2;
        var bottomCenterX = (bottomObj.bounds[0] + bottomObj.bounds[2]) / 2;
        var shiftX = topCenterX - bottomCenterX;

        // --- Vertical spacing ---
        var prevBottomY = topObj.bounds[3]; // bottom of top object
        var currentTopY = bottomObj.bounds[1];
        var shiftY = prevBottomY - currentTopY - spacing;

        // Apply translation to bottom object only
        bottomObj.item.translate(shiftX, shiftY);
    }

    alert("Selected text pairs centered horizontally with " + spacing + "pt vertical spacing!");
}
