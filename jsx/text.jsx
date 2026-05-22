var doc = app.activeDocument;

var text = doc.textFrames.add();

text.contents = "Remote JSX Text";

text.position = [100, 500];

alert("Text added");
