var doc = app.activeDocument;

var file = new File("~/Desktop/export.png");

var options = new ExportOptionsPNG24();

options.transparency = true;

options.artBoardClipping = true;

options.horizontalScale = 100;

options.verticalScale = 100;

doc.exportFile(
    file,
    ExportType.PNG24,
    options
);

alert("PNG exported to Desktop");
