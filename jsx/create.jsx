if (app.documents.length > 0) {
    var doc = app.activeDocument;

    // Desired layer names in order
    var layerNames = ["lines", "fill", "text"];
    var existingMessages = [];

    // Step 1: Check/create layers
    for (var i = 0; i < layerNames.length; i++) {
        var layerName = layerNames[i];
        var existingLayer = null;

        // Check if layer exists
        for (var j = 0; j < doc.layers.length; j++) {
            if (doc.layers[j].name === layerName) {
                existingLayer = doc.layers[j];
                break;
            }
        }

        // If exists, collect message
        if (existingLayer !== null) {
            existingMessages.push("Layer '" + layerName + "' already exists.");
        } else {
            // Create and name the layer
            var newLayer = doc.layers.add();
            newLayer.name = layerName;
        }
    }

    // Step 2: Reorder layers to match desired sequence
    for (var k = layerNames.length - 1; k >= 0; k--) {
        var layer = doc.layers.getByName(layerNames[k]);
        layer.zOrder(ZOrderMethod.SENDTOBACK);
    }

    // Step 3: Show messages
    if (existingMessages.length > 0) {
        alert(existingMessages.join("\n"));
    } else {
        alert("Layers 'text', 'fill', and 'lines' have been created.");
    }

} else {
    alert("No document is open.");
}
