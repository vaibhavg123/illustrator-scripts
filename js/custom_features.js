// js/custom_features.js
// Dedicated feature controller for new/custom JSX workflows.
// Keeps app.js clean as a universal runner.
//
// HOW TO ADD A NEW FEATURE WITHOUT TOUCHING app.js:
// 1. Add your HTML controls inside a view HTML file (e.g. views/home.html or views/my_tool.html).
// 2. Create your ExtendScript file on GitHub (e.g. jsx/my_new_tool.jsx).
//    Inside your .jsx file, you can read:
//      - panelInput (string from top #messageInput box)
//      - panelData  (object passed as 2nd argument to window.VGTools.runScript)
//    And call:
//      - vgProgress(percent, "Status text") to update the live HTML progress bar
//    And return a JSON string or text string so app.js logs it automatically in #vgLogBox.
// 3. Add a bind...Feature() method below and call it inside window.VGFeatureHandlers.initView().

(function () {
    function bindHideGraphicsFeature() {
        var header = document.getElementById("hideGraphicsHeader");
        var content = document.getElementById("hideGraphicsContent");
        var hideBtn = document.getElementById("btnRunHideGraphics");
        var unhideBtn = document.getElementById("btnUnhideAll");

        if (header && content && !header.dataset.vgBound) {
            header.dataset.vgBound = "1";
            header.onclick = function () {
                var isOpen = header.classList.contains("active");
                if (isOpen) {
                    header.classList.remove("active");
                    content.style.maxHeight = "0px";
                } else {
                    header.classList.add("active");
                    content.style.maxHeight = content.scrollHeight + 20 + "px";
                }
            };
        }

        function setBusy(isBusy, activeLabel) {
            if (hideBtn) {
                hideBtn.disabled = isBusy;
                hideBtn.innerText = isBusy && activeLabel === "hide" ? "Hiding..." : "Hide Selected";
            }
            if (unhideBtn) {
                unhideBtn.disabled = isBusy;
                unhideBtn.innerText = isBusy && activeLabel === "unhide" ? "Restoring..." : "Unhide All";
            }
        }

        if (hideBtn && !hideBtn.dataset.vgBound) {
            hideBtn.dataset.vgBound = "1";
            hideBtn.onclick = function () {
                var chkFill = document.getElementById("chkHideFill");
                var chkText = document.getElementById("chkHideText");
                var chkDashed = document.getElementById("chkHideDashed");
                var chkOnlyLines = document.getElementById("chkHideOnlyLines");

                var payload = {
                    hideFill: chkFill ? chkFill.checked : false,
                    hideText: chkText ? chkText.checked : false,
                    hideDashed: chkDashed ? chkDashed.checked : false,
                    hideOnlyLines: chkOnlyLines ? chkOnlyLines.checked : false
                };

                if (!payload.hideFill && !payload.hideText && !payload.hideDashed && !payload.hideOnlyLines) {
                    window.VGTools.log("Hide Graphics -> Please check at least one option.", "warn");
                    return;
                }

                setBusy(true, "hide");
                window.VGTools.runScript("jsx/hide_graphics.jsx", payload, function () {
                    setBusy(false);
                }, "Hide Graphics");
            };
        }

        if (unhideBtn && !unhideBtn.dataset.vgBound) {
            unhideBtn.dataset.vgBound = "1";
            unhideBtn.onclick = function () {
                setBusy(true, "unhide");
                window.VGTools.runScript("jsx/unhide_graphics.jsx", {}, function () {
                    setBusy(false);
                }, "Unhide All");
            };
        }
    }

    // =========================================================
    // TEMPLATE METHOD FOR FUTURE NEW .JSX + HTML CONTROLS
    // Copy this pattern, rename IDs/script path/label, and call
    // it inside window.VGFeatureHandlers.initView() below.
    // =========================================================
    function bindTemplateFeature() {
        // Step 1: Grab your custom HTML controls (present only when that view is active)
        var runBtn = document.getElementById("btnTemplateRun");
        var countInput = document.getElementById("templateCountInput");
        var modeSelect = document.getElementById("templateModeSelect");

        // Guard: if this view isn't currently loaded in #view-container, exit safely
        if (!runBtn) return;

        // Guard: prevent attaching duplicate click listeners on re-render
        if (runBtn.dataset.vgBound) return;
        runBtn.dataset.vgBound = "1";

        // Step 2: Bind button click
        runBtn.onclick = function () {
            // Collect values from your custom HTML inputs
            var payload = {
                count: countInput ? (Number(countInput.value) || 1) : 1,
                mode: modeSelect ? modeSelect.value : "default"
            };

            // Optional validation log (appears in bottom selectable Activity Log)
            if (payload.count < 1) {
                window.VGTools.log("Template Tool -> Count must be at least 1.", "warn");
                return;
            }

            // Lock UI while Illustrator runs
            runBtn.disabled = true;
            var originalLabel = runBtn.innerText;
            runBtn.innerText = "Running...";

            // Step 3: Execute remote JSX via universal runner:
            //   arg 1: JSX path/URL relative to VG_BASE_URL (or full https:// URL)
            //   arg 2: payload object (available as `panelData` inside the .jsx script)
            //   arg 3: completion callback(rawResult)
            //   arg 4: friendly action name shown in Activity Log & progress bar
            window.VGTools.runScript(
                "jsx/template_tool.jsx",
                payload,
                function (rawResult) {
                    runBtn.disabled = false;
                    runBtn.innerText = originalLabel;

                    // Optional extra custom log entry if needed
                    // window.VGTools.log("Template Tool finished with mode: " + payload.mode, "info");
                },
                "Template Tool"
            );
        };
    }

    window.VGFeatureHandlers = {
        initView: function (viewId, config) {
            if (viewId === "home") {
                bindHideGraphicsFeature();
                bindTemplateFeature(); // Call here if HTML controls live in home.html
            }

            // Or bind to a dedicated view ID from version.json:
            // if (viewId === "template_view") {
            //     bindTemplateFeature();
            // }
        }
    };
})();
