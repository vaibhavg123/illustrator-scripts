var doc = app.activeDocument;

for (var i = 0; i < doc.pageItems.length; i++) {

    var item = doc.pageItems[i];

    if (item.filled) {

        var color = new RGBColor();

        color.red = Math.random() * 255;

        color.green = Math.random() * 255;

        color.blue = Math.random() * 255;

        item.fillColor = color;
    }
}

alert("Colors randomized");
