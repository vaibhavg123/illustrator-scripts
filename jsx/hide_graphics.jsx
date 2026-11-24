<!-- Hide Graphic Options (Native HTML UI) -->
<div class="accordion" id="hideGraphicsAccordion">
    <div class="accordion-header active" id="hideGraphicsHeader">
        <span>Hide Graphic Options</span>
        <span class="accordion-icon">▼</span>
    </div>

    <div class="accordion-content" id="hideGraphicsContent" style="max-height: 400px;">
        <div class="hide-options-body">
            <label class="checkbox-row">
                <input type="checkbox" id="chkHideFill" checked />
                <span>Hide Fill (Paths &amp; Compound Paths)</span>
            </label>

            <label class="checkbox-row">
                <input type="checkbox" id="chkHideText" />
                <span>Hide Texts (Text Frames)</span>
            </label>

            <label class="checkbox-row">
                <input type="checkbox" id="chkHideDashed" />
                <span>Hide Dashed Lines</span>
            </label>

            <label class="checkbox-row">
                <input type="checkbox" id="chkHideOnlyLines" />
                <span>Hide Only Lines (Open or Unfilled Strokes)</span>
            </label>

            <button id="btnRunHideGraphics" class="tool-btn">Hide Selected Types</button>

            <div id="hideGraphicsResult" class="result-box"></div>
        </div>
    </div>
</div>

<!-- Dynamic sections & buttons from version.json -->
<div id="sections"></div>
<div id="buttons"></div>

<script>
(function () {
    var header = document.getElementById("hideGraphicsHeader");
    var content = document.getElementById("hideGraphicsContent");
    var runBtn = document.getElementById("btnRunHideGraphics");
    var resultBox = document.getElementById("hideGraphicsResult");

    // Accordion toggle
    if (header && content) {
        header.onclick = function () {
            var isOpen = header.classList.contains("active");
            if (isOpen) {
                header.classList.remove("active");
                content.style.maxHeight = "0px";
            } else {
                header.classList.add("active");
                content.style.maxHeight = content.scrollHeight + 30 + "px";
            }
        };
    }

    function showResult(html, isError) {
        resultBox.innerHTML = html;
        resultBox.className = "result-box visible" + (isError ? " error" : "");
        if (header.classList.contains("active")) {
            content.style.maxHeight = content.scrollHeight + 30 + "px";
        }
    }

    if (runBtn) {
        runBtn.onclick = function () {
            var payload = {
                hideFill: document.getElementById("chkHideFill").checked,
                hideText: document.getElementById("chkHideText").checked,
                hideDashed: document.getElementById("chkHideDashed").checked,
                hideOnlyLines: document.getElementById("chkHideOnlyLines").checked
            };

            if (!payload.hideFill && !payload.hideText && !payload.hideDashed && !payload.hideOnlyLines) {
                showResult("Please check at least one option.", true);
                return;
            }

            runBtn.disabled = true;
            runBtn.innerText = "Hiding...";

            window.VGTools.runScript("jsx/hide_graphics.jsx", payload, function (res) {
                runBtn.disabled = false;
                runBtn.innerText = "Hide Selected Types";

                try {
                    var data = JSON.parse(res);
                    if (!data.ok) {
                        showResult(data.error || "Operation failed.", true);
                        return;
                    }
                    showResult(
                        "<strong>Done!</strong><br>" +
                        "Filled items: <b>" + data.fill + "</b> &nbsp;|&nbsp; " +
                        "Dashed lines: <b>" + data.dashed + "</b><br>" +
                        "Only lines: <b>" + data.lines + "</b> &nbsp;|&nbsp; " +
                        "Text frames: <b>" + data.text + "</b>",
                        false
                    );
                } catch (e) {
                    showResult("Completed.", false);
                }
            });
        };
    }
})();
</script>
