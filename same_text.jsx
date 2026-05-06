if ((app.activeDocument.selection.length == 1) && (app.activeDocument.selection[0].typename == "TextFrame")) {
var selectedText = app.activeDocument.selection[0];
var textObjects = app.activeDocument.textFrames
var numTextObj = textObjects.length;
for ( j = 0 ; j < numTextObj; j++ ) {
if(textObjects[j].textRange.length > 0 && textObjects[j].editable==true && !textObjects[j].locked && !textObjects[j].hidden ){
if ( selectedText.textRange.characterAttributes.size == textObjects[j].textRange.characterAttributes.size ){
selCValue = selectedText.textRange.characterAttributes.textFont.name ;
txtCValue = textObjects[j].textRange.characterAttributes.textFont.name ;
if (selCValue == txtCValue ) {
textObjects[j].selected = true;
}
}
}
}
} else {
alert ("You must only have a single text object selected");
}
