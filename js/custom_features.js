// js/custom_features.js
// Dedicated feature controller for new/custom JSX workflows.
// Keeps app.js clean as a universal runner.

(function () {
    function safeLog(message, type) {
        if (window.VGTools && typeof window.VGTools.log === "function") {
            window.VGTools.log(message, type || "info");
            return;
        }

        // Fallback if window.VGTools is not attached yet
        var box = document.getElementById("vgLogBox");
        if (box) {
            var line = document.createElement("div");
            line.className = "log-entry log-" + (type || "info");
            line.textContent = "[" + new Date().toLocaleTimeString() + "] " + String(message);
            box.appendChild(line);
            box.scrollTop = box.scrollHeight;
        } else {
            console.log("[VGTools]", message);
        }
    }

    function safeRunScript(scriptPath, payload, doneCallback, actionLabel) {
        if (window.VGTools && typeof window.VGTools.runScript === "function") {
            window.VGTools.runScript(scriptPath, payload, doneCallback, actionLabel);
            return;
        }

        safeLog((actionLabel || scriptPath) + " -> VGTools runner not initialized yet.", "error");
        if (typeof doneCallback === "function") {
            doneCallback(null);
        }
    }

    function bindAccordionPair(headerId, contentId) {
        var header = document.getElementById(headerId);
        var content = document.getElementById(contentId);
        if (!header || !content) return;

        header.onclick = function () {
            var isOpen = header.classList.contains("active");
            if (isOpen) {
                header.classList.remove("active");
                content.style.maxHeight = "0px";
            } else {
                header.classList.add("active");
                content.style.maxHeight = (content.scrollHeight + 25) + "px";
            }
        };
    }

    function bindHideGraphicsFeature() {
        bindAccordionPair("hideGraphicsHeader", "hideGraphicsContent");

        var hideBtn = document.getElementById("btnRunHideGraphics");
        var unhideBtn = document.getElementById("btnUnhideAll");

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

        if (hideBtn) {
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
                    safeLog("Hide Graphics -> Please check at least one option.", "warn");
                    return;
                }

                setBusy(true, "hide");
                safeRunScript("jsx/hide_graphics.jsx", payload, function () {
                    setBusy(false);
                }, "Hide Graphics");
            };
        }

        if (unhideBtn) {
            unhideBtn.onclick = function () {
                setBusy(true, "unhide");
                safeRunScript("jsx/unhide_graphics.jsx", {}, function () {
                    setBusy(false);
                }, "Unhide All");
            };
        }
    }

    // =========================================================
    // TEMPLATE METHOD FOR FUTURE NEW .JSX + HTML CONTROLS
    // =========================================================
    function bindTemplateFeature() {
        bindAccordionPair("templateToolHeader", "templateToolContent");

        var runBtn = document.getElementById("btnTemplateRun");
        var countInput = document.getElementById("templateCountInput");
        var modeSelect = document.getElementById("templateModeSelect");

        if (!runBtn) return;

        runBtn.onclick = function () {
            var payload = {
                count: countInput ? (Number(countInput.value) || 1) : 1,
                mode: modeSelect ? modeSelect.value : "default"
            };

            if (payload.count < 1) {
                safeLog("Template Tool -> Count must be at least 1.", "warn");
                return;
            }

            runBtn.disabled = true;
            var originalLabel = runBtn.innerText;
            runBtn.innerText = "Running...";

            safeRunScript(
                "jsx/template_tool.jsx",
                payload,
                function () {
                    runBtn.disabled = false;
                    runBtn.innerText = originalLabel;
                },
                "Template Tool"
            );
        };
    }

    window.VGFeatureHandlers = {
        initView: function (viewId, config) {
            if (viewId === "home") {
                bindHideGraphicsFeature();
                bindTemplateFeature();
            }
        }
    };
})();
