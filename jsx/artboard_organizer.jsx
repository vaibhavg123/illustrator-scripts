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
            .replace(/\r?\n/g, " ");
    }

    function round2(v) {
        return Math.round(v * 100) / 100;
    }

    function getBounds(item) {
        var b = item.visibleBounds; // [left, top, right, bottom]
        return {
            left: b[0],
            top: b[1],
            right: b[2],
            bottom: b[3],
            w: Math.abs(b[2] - b[0]),
            h: Math.abs(b[1] - b[3]),
            cx: (b[0] + b[2]) * 0.5,
            cy: (b[1] + b[3]) * 0.5
        };
    }

    function moveItemToCenter(item, targetCx, targetCy) {
        var b = getBounds(item);
        item.translate(targetCx - b.cx, targetCy - b.cy);
    }

    function scaleUniform(item, pct) {
        item.resize(pct, pct, true, true, true, true, pct, Transformation.CENTER);
    }

    function executeOrganizer() {
        if (app.documents.length === 0) {
            report(100, "No document open.");
            return '{"ok":false,"error":"No document is open."}';
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
                abArr.push(
                    '{"index":' + i +
                    ',"name":"' + escapeJson(ab.name) + '"' +
                    ',"w":' + round2(w) +
                    ',"h":' + round2(h) + '}'
                );
            }
            report(100, "Artboards loaded.");
            return '{"ok":true,"message":"Loaded ' + abArr.length + ' artboard(s)","artboards":[' + abArr.join(",") + ']}';
        }

        // 2. LOAD SELECTED GROUPS
        if (action === "getSelectedGroups") {
            var sel = doc.selection;
            if (!sel || sel.length === 0) {
                report(100, "No selection.");
                return '{"ok":false,"error":"Please select one or more groups in Illustrator first."}';
            }

            report(50, "Reading selected groups...");
            var grpArr = [];
            for (var s = 0; s < sel.length; s++) {
                var it = sel[s];
                var b = getBounds(it);
                var nm = it.name ? it.name : (it.typename === "GroupItem" ? ("Group " + (s + 1)) : (it.typename + " " + (s + 1)));
                grpArr.push(
                    '{"index":' + s +
                    ',"name":"' + escapeJson(nm) + '"' +
                    ',"type":"' + escapeJson(it.typename) + '"' +
                    ',"w":' + round2(b.w) +
                    ',"h":' + round2(b.h) + '}'
                );
            }
            report(100, "Selected groups loaded.");
            return '{"ok":true,"message":"Loaded ' + grpArr.length + ' selected item(s)","groups":[' + grpArr.join(",") + ']}';
        }

        // 3. APPLY LAYOUT ON SELECTED ARTBOARD
        if (action === "applyLayout") {
            var selItems = doc.selection;
            if (!selItems || selItems.length === 0) {
                report(100, "No selection.");
                return '{"ok":false,"error":"Keep your target groups selected in Illustrator before clicking Apply."}';
            }

            var abIndex = parseInt(pd.artboardIndex, 10);
            if (isNaN(abIndex) || abIndex < 0 || abIndex >= doc.artboards.length) {
                return '{"ok":false,"error":"Invalid artboard selected."}';
            }

            var layoutType = String(pd.layoutType || "center");
            var margin = Number(pd.marginPt) || 0;
            var gap = Number(pd.gapPt) || 0;
            var autoScale = (pd.autoScale !== false);

            var abRect = doc.artboards[abIndex].artboardRect;
            var abL = abRect[0], abT = abRect[1], abR = abRect[2], abB = abRect[3];
            var abW = Math.abs(abR - abL);
            var abH = Math.abs(abT - abB);
            var abCx = (abL + abR) * 0.5;
            var abCy = (abT + abB) * 0.5;
            var usableW = Math.max(10, abW - margin * 2);
            var usableH = Math.max(10, abH - margin * 2);

            doc.artboards.setActiveArtboardIndex(abIndex);
            report(35, "Organizing " + selItems.length + " item(s)...");

            var items = [];
            for (var k = 0; k < selItems.length; k++) items.push(selItems[k]);

            // SINGLE GROUP: CENTER / CENTER & FIT
            if (items.length === 1 || layoutType === "center" || layoutType === "center_fit") {
                var single = items[0];
                var sb = getBounds(single);
                if (layoutType === "center_fit" || (autoScale && (sb.w > usableW || sb.h > usableH))) {
                    var ratio = Math.min(usableW / Math.max(1, sb.w), usableH / Math.max(1, sb.h));
                    if (layoutType === "center_fit" || ratio < 1) {
                        scaleUniform(single, ratio * 100);
                    }
                }
                moveItemToCenter(single, abCx, abCy);
                app.redraw();
                report(100, "Centered on artboard.");
                return '{"ok":true,"message":"Centered group on ' + escapeJson(doc.artboards[abIndex].name) + '"}';
            }

            // MULTIPLE GROUPS: ROW, COLUMN, GRID, GRID2
            var n = items.length;
            var cols = n;
            if (layoutType === "column") cols = 1;
            else if (layoutType === "grid") cols = Math.ceil(Math.sqrt(n));
            else if (layoutType === "grid2") cols = 2;

            var rows = Math.ceil(n / cols);
            var boundsList = [];
            var colWidths = [];
            var rowHeights = [];
            var c, rIdx, idx;

            for (c = 0; c < cols; c++) colWidths[c] = 0;
            for (rIdx = 0; rIdx < rows; rIdx++) rowHeights[rIdx] = 0;

            for (idx = 0; idx < n; idx++) {
                var b = getBounds(items[idx]);
                boundsList.push(b);
                c = idx % cols;
                rIdx = Math.floor(idx / cols);
                if (b.w > colWidths[c]) colWidths[c] = b.w;
                if (b.h > rowHeights[rIdx]) rowHeights[rIdx] = b.h;
            }

            var totalW = gap * (cols - 1);
            for (c = 0; c < cols; c++) totalW += colWidths[c];

            var totalH = gap * (rows - 1);
            for (rIdx = 0; rIdx < rows; rIdx++) totalH += rowHeights[rIdx];

            // Optional proportional scale-to-fit if block exceeds usable artboard area
            var scaleFactor = 1;
            if (autoScale && (totalW > usableW || totalH > usableH)) {
                scaleFactor = Math.min(usableW / Math.max(1, totalW), usableH / Math.max(1, totalH));
                for (idx = 0; idx < n; idx++) {
                    scaleUniform(items[idx], scaleFactor * 100);
                }
                for (c = 0; c < cols; c++) colWidths[c] *= scaleFactor;
                for (rIdx = 0; rIdx < rows; rIdx++) rowHeights[rIdx] *= scaleFactor;
                gap *= scaleFactor;
                totalW *= scaleFactor;
                totalH *= scaleFactor;
            }

            // Position centered on artboard (Illustrator Y decreases downward)
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
            return '{"ok":true,"message":"Organized ' + n + ' groups (' + layoutType + ') on ' + escapeJson(doc.artboards[abIndex].name) + '","scale":"' + Math.round(scaleFactor * 100) + '%"}';
        }

        return '{"ok":false,"error":"Unknown action."}';
    }

    try {
        return executeOrganizer();
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        return '{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}';
    }
})();
