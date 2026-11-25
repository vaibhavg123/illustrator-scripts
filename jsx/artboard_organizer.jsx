#target illustrator

(function () {
    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    }

    function escapeJson(str) {
        return String(str === null || str === undefined ? "" : str)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r/g, " ")
            .replace(/\n/g, " ")
            .replace(/\t/g, " ");
    }

    function round2(v) {
        return Math.round(Number(v || 0) * 100) / 100;
    }

    function getBounds(item) {
        try {
            var b = item.visibleBounds; // [left, top, right, bottom]
            if (!b || b.length < 4) return null;
            var w = Math.abs(b[2] - b[0]);
            var h = Math.abs(b[1] - b[3]);
            return {
                left: b[0],
                top: b[1],
                right: b[2],
                bottom: b[3],
                w: w,
                h: h,
                cx: (b[0] + b[2]) * 0.5,
                cy: (b[1] + b[3]) * 0.5
            };
        } catch (e) {
            return null;
        }
    }

    function moveItemToCenter(item, targetCx, targetCy) {
        var b = getBounds(item);
        if (!b) return;
        item.translate(targetCx - b.cx, targetCy - b.cy);
    }

    function executeOrganizer() {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            return '{"ok":false,"error":"No document is open in Illustrator."}';
        }

        var doc = app.activeDocument;
        var pd = (typeof panelData !== "undefined" && panelData) ? panelData : {};
        var action = pd.action || "getArtboards";

        // 1. LOAD ALL ARTBOARDS
        if (action === "getArtboards") {
            report(50, "Reading artboards...");
            var abArr = [];
            for (var i = 0; i < doc.artboards.length; i++) {
                var ab = doc.artboards[i];
                var r = ab.artboardRect; // [left, top, right, bottom]
                var w = Math.abs(r[2] - r[0]);
                var h = Math.abs(r[1] - r[3]);
                var abName = "";
                try { abName = String(ab.name || ""); } catch (eN) { abName = ""; }
                if (!abName) abName = "Artboard " + (i + 1);

                abArr.push(
                    '{"index":' + i +
                    ',"name":"' + escapeJson(abName) + '"' +
                    ',"w":' + round2(w) +
                    ',"h":' + round2(h) + '}'
                );
            }
            report(100, "Artboards loaded.");
            return '{"ok":true,"message":"Loaded ' + abArr.length + ' artboard(s)","artboards":[' + abArr.join(",") + ']}';
        }

        // 2. LOAD SELECTED GROUPS
        if (action === "getSelectedGroups") {
            var sel = null;
            try { sel = doc.selection; } catch (eSel) { sel = null; }

            if (!sel || !sel.length || sel.length === 0) {
                report(100, "No selection.");
                return '{"ok":false,"error":"Please select one or more groups in Illustrator first."}';
            }

            report(50, "Reading selected groups...");
            var grpArr = [];
            for (var s = 0; s < sel.length; s++) {
                var it = sel[s];
                var b = getBounds(it);
                if (!b) continue;

                var rawName = "";
                try { rawName = String(it.name || ""); } catch (eNm) { rawName = ""; }
                var nm = rawName !== ""
                    ? rawName
                    : (it.typename === "GroupItem" ? ("Group " + (s + 1)) : (it.typename + " " + (s + 1)));

                grpArr.push(
                    '{"index":' + s +
                    ',"name":"' + escapeJson(nm) + '"' +
                    ',"type":"' + escapeJson(it.typename) + '"' +
                    ',"w":' + round2(b.w) +
                    ',"h":' + round2(b.h) + '}'
                );
            }

            if (grpArr.length === 0) {
                report(100, "No valid bounds.");
                return '{"ok":false,"error":"Selected items have no readable bounds."}';
            }

            report(100, "Selected groups loaded.");
            return '{"ok":true,"message":"Loaded ' + grpArr.length + ' selected group(s)","groups":[' + grpArr.join(",") + ']}';
        }

        // 3. APPLY LAYOUT ON SELECTED ARTBOARD (100% ORIGINAL SIZE - NO SCALING)
        if (action === "applyLayout") {
            var selItems = null;
            try { selItems = doc.selection; } catch (eS2) { selItems = null; }

            if (!selItems || !selItems.length || selItems.length === 0) {
                report(100, "No selection.");
                return '{"ok":false,"error":"Keep your target groups selected in Illustrator before clicking Apply."}';
            }

            var abIndex = parseInt(pd.artboardIndex, 10);
            if (isNaN(abIndex) || abIndex < 0 || abIndex >= doc.artboards.length) {
                return '{"ok":false,"error":"Invalid artboard selected."}';
            }

            var layoutType = String(pd.layoutType || "center");
            var gap = Math.max(0, Number(pd.gapPt) || 0);

            var targetAb = doc.artboards[abIndex];
            var abRect = targetAb.artboardRect;
            var abCx = (abRect[0] + abRect[2]) * 0.5;
            var abCy = (abRect[1] + abRect[3]) * 0.5;

            doc.artboards.setActiveArtboardIndex(abIndex);
            report(40, "Organizing " + selItems.length + " item(s) at 100% size...");

            var items = [];
            for (var k = 0; k < selItems.length; k++) {
                if (getBounds(selItems[k])) {
                    items.push(selItems[k]);
                }
            }

            if (items.length === 0) {
                return '{"ok":false,"error":"No valid items to position."}';
            }

            // SINGLE GROUP: CENTER AT ORIGINAL SIZE
            if (items.length === 1 || layoutType === "center") {
                moveItemToCenter(items[0], abCx, abCy);
                app.redraw();
                report(100, "Centered on artboard.");
                return '{"ok":true,"message":"Centered group (100% size) on ' + escapeJson(targetAb.name) + '"}';
            }

            // MULTIPLE GROUPS: ROW, COLUMN, GRID, GRID2 (100% ORIGINAL SIZE)
            var n = items.length;
            var cols = n;
            if (layoutType === "column") cols = 1;
            else if (layoutType === "grid") cols = Math.ceil(Math.sqrt(n));
            else if (layoutType === "grid2") cols = 2;

            var rows = Math.ceil(n / cols);
            var colWidths = [];
            var rowHeights = [];
            var c, rIdx, idx;

            for (c = 0; c < cols; c++) colWidths[c] = 0;
            for (rIdx = 0; rIdx < rows; rIdx++) rowHeights[rIdx] = 0;

            for (idx = 0; idx < n; idx++) {
                var b = getBounds(items[idx]);
                c = idx % cols;
                rIdx = Math.floor(idx / cols);
                if (b.w > colWidths[c]) colWidths[c] = b.w;
                if (b.h > rowHeights[rIdx]) rowHeights[rIdx] = b.h;
            }

            var totalW = gap * (cols - 1);
            for (c = 0; c < cols; c++) totalW += colWidths[c];

            var totalH = gap * (rows - 1);
            for (rIdx = 0; rIdx < rows; rIdx++) totalH += rowHeights[rIdx];

            var startX = abCx - (totalW * 0.5);
            var startY = abCy + (totalH * 0.5);

            var colX = [];
            var curX = startX;
            for (c = 0; c < cols; c++) {
                colX[c] = curX + (colWidths[c] * 0.5);
                curX += colWidths[c] + gap;
            }

            var rowY = [];
            var curY = startY;
            for (rIdx = 0; rIdx < rows; rIdx++) {
                rowY[rIdx] = curY - (rowHeights[rIdx] * 0.5);
                curY -= (rowHeights[rIdx] + gap);
            }

            for (idx = 0; idx < n; idx++) {
                c = idx % cols;
                rIdx = Math.floor(idx / cols);
                moveItemToCenter(items[idx], colX[c], rowY[rIdx]);
            }

            app.redraw();
            report(100, "Layout applied!");
            return '{"ok":true,"message":"Organized ' + n + ' groups (' + layoutType + ', 100% size) on ' + escapeJson(targetAb.name) + '"}';
        }

        return '{"ok":false,"error":"Unknown action."}';
    }

    var _finalOut;
    try {
        _finalOut = executeOrganizer();
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        _finalOut = '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}';
    }
    _finalOut;
})();
