#target illustrator

(function () {
    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    }

    function escapeJson(str) {
        return String(str || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, " ");
    }

    function parseLayerList() {
        // 1. Check optional array from custom UI / version.json params: { "layers": ["lines", "fill", "text"] }
        if (typeof panelData !== "undefined" && panelData && panelData.layers instanceof Array && panelData.layers.length > 0) {
            var cleanArr = [];
            for (var a = 0; a < panelData.layers.length; a++) {
                var n = String(panelData.layers[a] || "").replace(/^\s+|\s+$/g, "");
                if (n) cleanArr.push(n);
            }
            if (cleanArr.length > 0) return cleanArr;
        }

        // 2. Optional comma-separated list from top #messageInput (e.g. "guides, lines, fill, text")
        if (typeof panelInput !== "undefined" && panelInput && String(panelInput).replace(/^\s+|\s+$/g, "") !== "") {
            var rawParts = String(panelInput).split(",");
            var fromInput = [];
            for (var p = 0; p < rawParts.length; p++) {
                var item = rawParts[p].replace(/^\s+|\s+$/g, "");
                if (item) fromInput.push(item);
            }
            if (fromInput.length > 0) return fromInput;
        }

        // 3. Default layer sequence
        return ["lines", "fill", "text"];
    }

    function runCreateLayers() {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            return '{"ok":false,"error":"No document is open."}';
        }

        var doc = app.activeDocument;
        var layerNames = parseLayerList();
        var createdLayers = [];
        var existingLayers = [];

        report(15, "Checking layers...");

        // Step 1: Check or create layers
        for (var i = 0; i < layerNames.length; i++) {
            var layerName = layerNames[i];
            var existingLayer = null;

            var pct = 15 + Math.round(((i + 1) / layerNames.length) * 55);
            report(pct, "Checking layer: " + layerName);

            for (var j = 0; j < doc.layers.length; j++) {
                if (doc.layers[j].name === layerName) {
                    existingLayer = doc.layers[j];
                    break;
                }
            }

            if (existingLayer !== null) {
                existingLayers.push(layerName);
            } else {
                var newLayer = doc.layers.add();
                newLayer.name = layerName;
                createdLayers.push(layerName);
            }
        }

        // Step 2: Reorder layers to match desired sequence
        report(80, "Reordering layers...");
        for (var k = layerNames.length - 1; k >= 0; k--) {
            var targetLayer = null;
            for (var m = 0; m < doc.layers.length; m++) {
                if (doc.layers[m].name === layerNames[k]) {
                    targetLayer = doc.layers[m];
                    break;
                }
            }
            if (targetLayer) {
                targetLayer.zOrder(ZOrderMethod.SENDTOBACK);
            }
        }

        app.redraw();
        report(100, "Layers ready.");

        // Step 3: Build summary message for the common Activity Log
        var summaryMsg = "";
        if (createdLayers.length > 0 && existingLayers.length > 0) {
            summaryMsg = "Created [" + createdLayers.join(", ") + "]; already existed [" + existingLayers.join(", ") + "]";
        } else if (existingLayers.length > 0) {
            summaryMsg = "All requested layers already exist [" + existingLayers.join(", ") + "]";
        } else {
            summaryMsg = "Created layers [" + createdLayers.join(", ") + "]";
        }

        return '{"ok":true' +
            ',"message":"' + escapeJson(summaryMsg) + '"' +
            ',"created":' + createdLayers.length +
            ',"existing":' + existingLayers.length +
            '}';
    }

    try {
        return runCreateLayers();
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}';
    }
})();
