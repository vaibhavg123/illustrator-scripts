// jsx/template_tool.jsx
// Starter ExtendScript (ES3) template for VG Tools.
//
// Globals injected automatically by app.js:
//   - panelInput : string from top #messageInput box
//   - panelData  : object passed as 2nd argument to window.VGTools.runScript(url, payload, ...)
//   - vgProgress(percent, message) : updates the live horizontal progress bar in HTML

try {
    var report = function (pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    };

    // 1. Validate active document
    if (!app.documents.length) {
        report(100, "No document open.");
        return '{"ok":false,"error":"Please open an Illustrator document first."}';
    }

    var doc = app.activeDocument;

    // 2. Read values from panelData (with safe fallbacks) and panelInput
    var opts = (typeof panelData !== "undefined" && panelData) ? panelData : {};
    var count = Number(opts.count) || 1;
    var mode = opts.mode ? String(opts.mode) : "default";
    var note = (typeof panelInput !== "undefined" && panelInput) ? String(panelInput) : "";

    report(10, "Starting template tool (mode: " + mode + ")...");

    // 3. Example work loop with live percentage updates (10% -> 95%)
    var processed = 0;
    for (var i = 0; i < count; i++) {
        var pct = 10 + Math.round(((i + 1) / count) * 85);
        report(pct, "Processing step " + (i + 1) + " of " + count + "...");

        // Replace this block with your actual Illustrator operations
        processed++;
        $.sleep(150);
    }

    app.redraw();
    report(100, "Template tool complete!");

    // 4. Escape strings safely so JSON never breaks if note/mode has quotes
    var safeMode = mode.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    var safeNote = note.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, " ");

    // 5. Return JSON string — app.js automatically formats and logs all keys in #vgLogBox
    return '{"ok":true' +
        ',"message":"Template tool finished"' +
        ',"mode":"' + safeMode + '"' +
        ',"processed":' + processed +
        ',"doc":"' + doc.name.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"' +
        (safeNote ? ',"note":"' + safeNote + '"' : '') +
        '}';

} catch (err) {
    var errMsg = String(err.message || err)
        .replace(/\\/g, "\\\\")
        .replace(/"/g, '\\"')
        .replace(/\r?\n/g, " ");

    if (typeof vgProgress === "function") {
        vgProgress(100, "Error: " + errMsg);
    }

    return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + errMsg + '"}';
}
