// js/custom_features.js
// Dedicated feature controller for new/custom JSX workflows.
// Keeps app.js clean as a universal runner.

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

    // Add future feature binders here as new .jsx tools are added:
    // function bindMyNextToolFeature() { ... }

    window.VGFeatureHandlers = {
        initView: function (viewId, config) {
            if (viewId === "home") {
                bindHideGraphicsFeature();
            }
            // Example for future views:
            // if (viewId === "batch_export") { bindBatchExportFeature(); }
        }
    };
})();
