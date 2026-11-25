#target illustrator

function makeRGBColor(r, g, b) {
    var c = new RGBColor();
    c.red = r;
    c.green = g;
    c.blue = b;
    return c;
}

function dist(a, b) {
    var dx = b[0] - a[0];
    var dy = b[1] - a[1];
    return Math.sqrt(dx * dx + dy * dy);
}

function getSegKey(a1, a2) {
    function r(v) { return Math.round(v * 100000) / 100000; }
    var x1 = r(a1[0]), y1 = r(a1[1]);
    var x2 = r(a2[0]), y2 = r(a2[1]);
    if (x1 < x2 || (x1 === x2 && y1 <= y2)) {
        return x1 + "," + y1 + "-" + x2 + "," + y2;
    }
    return x2 + "," + y2 + "-" + x1 + "," + y1;
}

function pointToSegmentDist(p, a, b) {
    var vx = b[0] - a[0];
    var vy = b[1] - a[1];
    var wx = p[0] - a[0];
    var wy = p[1] - a[1];
    var lenSq = vx * vx + vy * vy;
    if (lenSq === 0) return dist(p, a);
    var t = (wx * vx + wy * vy) / lenSq;
    if (t < 0) t = 0;
    else if (t > 1) t = 1;
    var projX = a[0] + t * vx;
    var projY = a[1] + t * vy;
    var dx = p[0] - projX;
    var dy = p[1] - projY;
    return Math.sqrt(dx * dx + dy * dy);
}

function isTrueNearOverlap(a1, b1, len1, a2, b2, len2, tol) {
    if (len1 <= 0 || len2 <= 0) return false;

    // Quick bounding-box reject before segment distance math
    var minA1X = Math.min(a1[0], b1[0]) - tol;
    var maxA1X = Math.max(a1[0], b1[0]) + tol;
    var minA2X = Math.min(a2[0], b2[0]);
    var maxA2X = Math.max(a2[0], b2[0]);
    if (maxA1X < minA2X || minA1X > maxA2X) return false;

    var minA1Y = Math.min(a1[1], b1[1]) - tol;
    var maxA1Y = Math.max(a1[1], b1[1]) + tol;
    var minA2Y = Math.min(a2[1], b2[1]);
    var maxA2Y = Math.max(a2[1], b2[1]);
    if (maxA1Y < minA2Y || minA1Y > maxA2Y) return false;

    var dA = pointToSegmentDist(a1, a2, b2);
    var dB = pointToSegmentDist(b1, a2, b2);
    if (dA > tol || dB > tol) return false;

    var ux1 = (b1[0] - a1[0]) / len1;
    var uy1 = (b1[1] - a1[1]) / len1;
    var ux2 = (b2[0] - a2[0]) / len2;
    var uy2 = (b2[1] - a2[1]) / len2;
    var dot = Math.abs(ux1 * ux2 + uy1 * uy2);
    if (dot < 0.985) return false;

    var projA = ((a1[0] - a2[0]) * ux2 + (a1[1] - a2[1]) * uy2);
    var projB = ((b1[0] - a2[0]) * ux2 + (b1[1] - a2[1]) * uy2);
    var minP = Math.min(projA, projB);
    var maxP = Math.max(projA, projB);

    var overlapStart = Math.max(0, minP);
    var overlapEnd = Math.min(len2, maxP);
    return (overlapEnd - overlapStart) > 0;
}

function getBoxGridKeys(minX, minY, maxX, maxY, cellSize, pad) {
    var gxMin = Math.floor((minX - pad) / cellSize);
    var gxMax = Math.floor((maxX + pad) / cellSize);
    var gyMin = Math.floor((minY - pad) / cellSize);
    var gyMax = Math.floor((maxY + pad) / cellSize);

    var spanX = gxMax - gxMin;
    var spanY = gyMax - gyMin;
    if (spanX * spanY > 300) {
        return getBoxGridKeys(minX, minY, minX, minY, cellSize, pad)
            .concat(getBoxGridKeys(maxX, maxY, maxX, maxY, cellSize, pad));
    }

    var keys = [];
    for (var gx = gxMin; gx <= gxMax; gx++) {
        for (var gy = gyMin; gy <= gyMax; gy++) {
            keys.push(gx + ":" + gy);
        }
    }
    return keys;
}

function addEntryToGrid(gridBuckets, entryIdx, minX, minY, maxX, maxY, cellSize) {
    var keys = getBoxGridKeys(minX, minY, maxX, maxY, cellSize, 0);
    for (var i = 0; i < keys.length; i++) {
        var k = keys[i];
        if (!gridBuckets[k]) gridBuckets[k] = [];
        gridBuckets[k].push(entryIdx);
    }
}

function isLayerUsable(layer) {
    var cur = layer;
    while (cur && cur.typename === "Layer") {
        if (!cur.visible || cur.locked) return false;
        cur = cur.parent;
    }
    return true;
}

function collectLayerSegmentsFast(layer) {
    var segs = [];
    var paths = layer.pathItems;
    var pLen = paths.length;

    for (var i = 0; i < pLen; i++) {
        var p = paths[i];
        if (!p || p.guides || p.clipping || p.hidden || p.locked) continue;

        try {
            var pts = p.pathPoints;
            var count = pts ? pts.length : 0;
            if (count < 2) continue;

            var segCount = p.closed ? count : count - 1;
            for (var s = 0; s < segCount; s++) {
                var iNext = (s + 1) % count;
                var a1 = pts[s].anchor;
                var a2 = pts[iNext].anchor;
                var len = dist(a1, a2);
                if (len === 0) continue;

                segs.push({
                    path: p,
                    a1: a1,
                    a2: a2,
                    len: len,
                    minX: Math.min(a1[0], a2[0]),
                    maxX: Math.max(a1[0], a2[0]),
                    minY: Math.min(a1[1], a2[1]),
                    maxY: Math.max(a1[1], a2[1]),
                    key: getSegKey(a1, a2)
                });
            }
        } catch (e) {}
    }

    return segs;
}

function checkOverlappingLinesMultiPass() {
    if (app.documents.length === 0) {
        alert("No document open.");
        return;
    }

    var doc = app.activeDocument;

    var win = new Window('dialog', 'Overlapping Line Checker (Multi-Pass Fast)');
    win.orientation = 'column';
    win.alignChildren = ['fill', 'top'];
    win.spacing = 10;
    win.margins = 15;

    var typeGroup = win.add('group');
    typeGroup.add('statictext', undefined, 'Drawing Type:');
    var typeDropdown = typeGroup.add('dropdownlist', undefined, ['CAD / DXF Imports', 'Technical drawings', 'Rough / hand-drawn']);
    typeDropdown.selection = 0;
    typeDropdown.preferredSize.width = 190;

    var tolGroup = win.add('group');
    tolGroup.add('statictext', undefined, 'Tolerance:');
    var tolInput = tolGroup.add('edittext', undefined, '0.001');
    tolInput.characters = 10;

    var passGroup = win.add('group');
    passGroup.add('statictext', undefined, 'Scan Passes:');
    var passDropdown = passGroup.add('dropdownlist', undefined, [
        '2 Passes (Exact Hash -> Near Overlap)',
        '3 Passes (Exact -> Tight Near -> Loose Near)'
    ]);
    passDropdown.selection = 0;
    passDropdown.preferredSize.width = 240;

    var noteText = win.add('statictext', undefined, 'Skips hidden & locked layers/items. Scans each layer in passes.');

    var layerStatusText = win.add('statictext', undefined, 'Layer: -');
    var passStatusText = win.add('statictext', undefined, 'Pass: -');
    var progressText = win.add('statictext', undefined, 'Progress: 0%');
    var progressBar = win.add('progressbar', undefined, 0, 100);
    progressBar.preferredSize.width = 380;

    var btnGroup = win.add('group');
    btnGroup.alignment = 'center';
    var okBtn = btnGroup.add('button', undefined, 'Start');
    var cancelBtn = btnGroup.add('button', undefined, 'Cancel');

    var cancelRequested = false;
    cancelBtn.onClick = function () { cancelRequested = true; };

    typeDropdown.onChange = function () {
        switch (typeDropdown.selection.text) {
            case 'CAD / DXF Imports': tolInput.text = '0.001'; break;
            case 'Technical drawings': tolInput.text = '0.0001'; break;
            case 'Rough / hand-drawn': tolInput.text = '0.01'; break;
        }
    };

    okBtn.onClick = function () {
        var tol = parseFloat(tolInput.text);
        if (isNaN(tol) || tol < 0) {
            alert("Please enter a valid non-negative tolerance.");
            return;
        }

        var useThreePasses = (passDropdown.selection.index === 1);
        var redColor = makeRGBColor(255, 0, 0);
        var blueColor = makeRGBColor(0, 0, 255);

        var exactHighlighted = 0;
        var nearHighlighted = 0;
        var skippedLayers = 0;
        var numLayers = doc.layers.length;

        for (var l = 0; l < numLayers; l++) {
            if (cancelRequested) break;

            var layer = doc.layers[l];
            layerStatusText.text = "Layer (" + (l + 1) + "/" + numLayers + "): " + layer.name;

            if (!isLayerUsable(layer)) {
                skippedLayers++;
                var pctSkip = Math.round(((l + 1) / numLayers) * 100);
                progressBar.value = pctSkip;
                progressText.text = "Overall Progress: " + pctSkip + "% (Skipped locked/hidden layer)";
                win.update();
                continue;
            }

            var layerSegs = collectLayerSegmentsFast(layer);
            var countInLayer = layerSegs.length;
            if (countInLayer < 2) continue;

            // Longest segments first so the longest segment in each overlapping group is kept first
            layerSegs.sort(function (a, b) { return b.len - a.len; });

            var exactKeptByKey = {};
            var keptRefs = [];
            var protectedPaths = {};
            var highlightedPaths = {};
            var unmatchedForNearPass = [];

            function uidOf(pathObj) {
                return pathObj.uuid || (pathObj.name + "_" + pathObj.zOrderPosition);
            }

            function markPath(pathObj, colorObj) {
                var id = uidOf(pathObj);
                if (protectedPaths[id] || highlightedPaths[id]) return false;
                try {
                    pathObj.stroked = true;
                    pathObj.strokeColor = colorObj;
                    highlightedPaths[id] = true;
                    return true;
                } catch (e) {
                    return false;
                }
            }

            function protectPath(pathObj) {
                var id = uidOf(pathObj);
                if (!highlightedPaths[id]) {
                    protectedPaths[id] = true;
                }
            }

            // ============================================================
            // PASS 1: Fast Exact Duplicate Hash Scan (O(N) per layer)
            // ============================================================
            passStatusText.text = "Pass 1/2: Exact match scan (" + countInLayer + " segments)";
            for (var i1 = 0; i1 < countInLayer; i1++) {
                if (cancelRequested) break;

                var seg1 = layerSegs[i1];
                if (exactKeptByKey[seg1.key]) {
                    if (exactKeptByKey[seg1.key].path !== seg1.path) {
                        if (markPath(seg1.path, redColor)) exactHighlighted++;
                    }
                } else {
                    exactKeptByKey[seg1.key] = seg1;
                    protectPath(seg1.path);
                    keptRefs.push(seg1);
                    unmatchedForNearPass.push(seg1);
                }

                if (i1 % 300 === 0 || i1 === countInLayer - 1) {
                    var p1Pct = Math.round(((l + (0.35 * ((i1 + 1) / countInLayer))) / numLayers) * 100);
                    progressBar.value = p1Pct;
                    progressText.text = "Overall Progress: " + p1Pct + "% (Pass 1 Exact)";
                    win.update();
                }
            }

            if (cancelRequested) break;

            // Helper to run a near-overlap pass using a spatial grid
            function runNearPass(passTol, passLabel, baseFraction, spanFraction) {
                var nearCountInPass = unmatchedForNearPass.length;
                if (nearCountInPass < 2) return;

                passStatusText.text = passLabel + " (" + nearCountInPass + " candidates)";
                var cellSize = Math.max(passTol * 5, 5);
                var pad = passTol * 2;
                var gridBuckets = {};
                var activeRefs = [];
                var stillUnmatched = [];

                for (var rIdx = 0; rIdx < keptRefs.length; rIdx++) {
                    var refObj = keptRefs[rIdx];
                    var refId = uidOf(refObj.path);
                    if (!highlightedPaths[refId]) {
                        var newIdx = activeRefs.length;
                        activeRefs.push(refObj);
                        addEntryToGrid(gridBuckets, newIdx, refObj.minX, refObj.minY, refObj.maxX, refObj.maxY, cellSize);
                    }
                }

                for (var idx = 0; idx < nearCountInPass; idx++) {
                    if (cancelRequested) break;

                    var cur = unmatchedForNearPass[idx];
                    var curId = uidOf(cur.path);
                    if (highlightedPaths[curId]) continue;

                    var matchedNear = false;
                    var candidateSeen = {};
                    var keysToCheck = getBoxGridKeys(cur.minX, cur.minY, cur.maxX, cur.maxY, cellSize, pad);

                    for (var k = 0; k < keysToCheck.length; k++) {
                        var bucket = gridBuckets[keysToCheck[k]];
                        if (!bucket) continue;

                        for (var b = 0; b < bucket.length; b++) {
                            var refIdx2 = bucket[b];
                            if (candidateSeen[refIdx2]) continue;
                            candidateSeen[refIdx2] = true;

                            var refItem = activeRefs[refIdx2];
                            if (refItem.path === cur.path) continue;
                            if (cur.len > refItem.len) continue; // Keep longer segment untouched

                            if (isTrueNearOverlap(cur.a1, cur.a2, cur.len, refItem.a1, refItem.a2, refItem.len, passTol)) {
                                if (markPath(cur.path, blueColor)) nearHighlighted++;
                                matchedNear = true;
                                break;
                            }
                        }
                        if (matchedNear) break;
                    }

                    if (!matchedNear) {
                        protectPath(cur.path);
                        stillUnmatched.push(cur);
                        var addedIdx = activeRefs.length;
                        activeRefs.push(cur);
                        addEntryToGrid(gridBuckets, addedIdx, cur.minX, cur.minY, cur.maxX, cur.maxY, cellSize);
                    }

                    if (idx % 200 === 0 || idx === nearCountInPass - 1) {
                        var pct = Math.round(((l + (baseFraction + spanFraction * ((idx + 1) / nearCountInPass))) / numLayers) * 100);
                        progressBar.value = pct;
                        progressText.text = "Overall Progress: " + pct + "% (" + passLabel + ")";
                        win.update();
                    }
                }

                unmatchedForNearPass = stillUnmatched;
            }

            if (useThreePasses) {
                runNearPass(tol * 0.25, "Pass 2/3: Tight near overlap", 0.35, 0.32);
                if (cancelRequested) break;
                runNearPass(tol, "Pass 3/3: Full tolerance overlap", 0.67, 0.33);
            } else {
                runNearPass(tol, "Pass 2/2: Near overlap scan", 0.35, 0.65);
            }
        }

        progressBar.value = 100;
        win.update();

        alert(
            (cancelRequested ? "Cancelled early.\n" : "Done!\n") +
            "Exact overlaps highlighted (Red): " + exactHighlighted + "\n" +
            "Near overlaps highlighted (Blue): " + nearHighlighted + "\n" +
            "Skipped hidden/locked layers: " + skippedLayers + "\n" +
            "Tolerance: " + tol
        );
    };

    win.show();
}

checkOverlappingLinesMultiPass();
