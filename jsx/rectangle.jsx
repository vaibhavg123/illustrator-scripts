var doc = app.activeDocument;

var rect = doc.pathItems.rectangle(
    500,
    100,
    200,
    100
);

rect.stroked = true;

rect.filled = false;

alert("Rectangle created");
