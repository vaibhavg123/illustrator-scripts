#target illustrator

(function () {
    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    }

    if (!app.documents.length) {
        report(100, "No document open.");
        if (typeof panelData !== "undefined" && panelData) {
            return '{"ok":false,"error":"Please open an Illustrator document first."}';
        }
        alert("Please open an Illustrator document first.");
        return;
    }

    var hideFillEnabled = true;
    var hideTextEnabled = false;
    var hideDashedEnabled = false;
    var hideOnlyLinesEnabled = false;

    // If launched from HTML UI via window.VGTools.runScript(..., payload), use payload without popup
    if (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true) {
        hideFillEnabled      = Boolean(panelData.hideFill);
        hideTextEnabled      = Boolean(panelData.hideText);
        hideDashedEnabled    = Boolean(panelData.hideDashed);
        hideOnlyLinesEnabled = Boolean(panelData.hideOnlyLines);
    } else {
        // Standalone ScriptUI popup mode
        var win = new Window("dialog", "Hide Graphic Options");
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];
        win.spacing = 10;
        win.margins = 16;

        var chkFill = win.add("checkbox", undefined, "Hide Fill (Paths & Compound Paths)");
        chkFill.value = true;

        var chkText = win.add("checkbox", undefined, "Hide Texts (Text Frames)");
        chkText.value = false;

        var chkDashed = win.add("checkbox", undefined, "Hide Dashed Lines");
        chkDashed.value = false;

        var chkOnlyLines = win.add("checkbox", undefined, "Hide Only Lines (Open or Unfilled Strokes)");
        chkOnlyLines.value = false;

        var btnGroup = win.add("group");
        btnGroup.orientation = "row";
        btnGroup.alignment = ["right", "center"];
        btnGroup.spacing = 8;

        btnGroup.add("button", undefined, "Cancel", { name: "cancel" });
        btnGroup.add("button", undefined, "OK", { name: "ok" });

        if (win.show() !== 1) {
            return;
        }

        hideFillEnabled      = chkFill.value;
        hideTextEnabled      = chkText.value;
        hideDashedEnabled    = chkDashed.value;
        hideOnlyLinesEnabled = chkOnlyLines.value;
    }

    if (!hideFillEnabled && !hideTextEnabled && !hideDashedEnabled && !hideOnlyLinesEnabled) {
        report(100, "Nothing selected.");
        if (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true) {
            return '{"ok":false,"error":"Nothing selected. Check at least one option."}';
        }
        alert("Nothing selected. Check at least one option.");
        return;
    }

    var doc = app.activeDocument;
    var hiddenFillCount = 0;
    var hiddenTextCount = 0;
    var hiddenDashedCount = 0;
    var hiddenOnlyLinesCount = 0;

    function isFilledPath(pathItem) {
        try {
            return Boolean(pathItem.filled && pathItem.fillColor && pathItem.fillColor.typename !== "NoColor");
        } catch (e) {
            return false;
        }
    }

    function hasStroke(pathItem) {
        try {
            return Boolean(pathItem.stroked && pathItem.strokeWidth > 0 && pathItem.strokeColor && pathItem.strokeColor.typename !== "NoColor");
        } catch (e) {
            return false;
        }
    }

    function isDashedPath(pathItem) {
        try {
            if (!hasStroke(pathItem)) return false;
            var dashArray = pathItem.strokeDashes;
            return Boolean(dashArray && dashArray.length > 0);
        } catch (e) {
            return false;
        }
    }

    function isOnlyLine(pathItem) {
        try {
            if (!hasStroke(pathItem)) return false;
            return Boolean(!pathItem.closed || !isFilledPath(pathItem));
        } catch (e) {
            return false;
        }
    }

    function hasFilledSubPath(compoundItem) {
        try {
            var paths = compoundItem.pathItems;
            for (var i = 0; i < paths.length; i++) {
                if (isFilledPath(paths[i])) return true;
            }
        } catch (e) {}
        return false;
    }

    var totalLayers = doc.layers.length;

    // Process one layer at a time for speed
    for (var l = 0; l < totalLayers; l++) {
        var layer = doc.layers[l];
        var pct = 25 + Math.round(((l + 1) / totalLayers) * 70);
        report(pct, "Layer " + (l + 1) + "/" + totalLayers + ": " + layer.name);

        if (!layer.visible || layer.locked) continue;

        if (hideFillEnabled) {
            var compounds = layer.compoundPathItems;
            for (var c = compounds.length - 1; c >= 0; c--) {
                var comp = compounds[c];
                if (!comp.hidden && !comp.locked && hasFilledSubPath(comp)) {
                    comp.hidden = true;
                    hiddenFillCount++;
                }
            }
        }

        var paths = layer.pathItems;
        for (var p = paths.length - 1; p >= 0; p--) {
            var path = paths[p];
            if (path.hidden || path.locked) continue;
            if (path.parent && path.parent.typename === "CompoundPathItem") continue;

            if (hideFillEnabled && isFilledPath(path)) {
                path.hidden = true;
                hiddenFillCount++;
                continue;
            }

            if (hideDashedEnabled && isDashedPath(path)) {
                path.hidden = true;
                hiddenDashedCount++;
                continue;
            }

            if (hideOnlyLinesEnabled && isOnlyLine(path)) {
                path.hidden = true;
                hiddenOnlyLinesCount++;
                continue;
            }
        }

        if (hideTextEnabled) {
            var texts = layer.textFrames;
            for (var t = texts.length - 1; t >= 0; t--) {
                var tf = texts[t];
                if (!tf.hidden && !tf.locked) {
                    tf.hidden = true;
                    hiddenTextCount++;
                }
            }
        }
    }

    app.redraw();
    report(100, "Done!");

    if (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true) {
        return '{"ok":true' +
            ',"fill":' + hiddenFillCount +
            ',"dashed":' + hiddenDashedCount +
            ',"lines":' + hiddenOnlyLinesCount +
            ',"text":' + hiddenTextCount + '}';
    }

    alert(
        "Done.\n" +
        "Hidden filled items: " + hiddenFillCount + "\n" +
        "Hidden dashed lines: " + hiddenDashedCount + "\n" +
        "Hidden only lines: " + hiddenOnlyLinesCount + "\n" +
        "Hidden text frames: " + hiddenTextCount
    );
})();
