/*
 =====================================================================
  FLOOR PLAN LABEL CLEANER v3.2  (CEP + Standalone ExtendScript)
 =====================================================================
*/

(function () {
    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            try { vgProgress(pct, msg); } catch (e) {}
        }
    }

    // FIX: also strips remaining control chars / line separators so the JSON the panel parses never breaks
    function escapeJson(str) {
        return String(str === null || str === undefined ? "" : str)
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r/g, "\\r")
            .replace(/\n/g, "\\n")
            .replace(/\t/g, "\\t")
            .replace(/[\u0000-\u001F\u2028\u2029]/g, " ");
    }


    function toJson(v) {
        var i, out, k;
        if (v === null || v === undefined) return "null";
        if (typeof v === "number") return isFinite(v) ? String(v) : "null";
        if (typeof v === "boolean") return v ? "true" : "false";
        if (typeof v === "string") return '"' + escapeJson(v) + '"';
        if (v instanceof Array) {
            out = [];
            for (i = 0; i < v.length; i++) out.push(toJson(v[i]));
            return "[" + out.join(",") + "]";
        }
        out = [];
        for (k in v) if (hasOwn(v, k)) out.push('"' + escapeJson(k) + '":' + toJson(v[k]));
        return "{" + out.join(",") + "}";
    }

    // "0.2.1" -> doc.layers[0].layers[2].layers[1]
    function layerByIdx(doc, idxStr) {
        if (idxStr === undefined || idxStr === null || String(idxStr) === "") return null;
        var parts = String(idxStr).split("."), cur = doc.layers, layer = null;
        for (var i = 0; i < parts.length; i++) {
            var n = parseInt(parts[i], 10);
            if (isNaN(n) || n < 0 || n >= cur.length) return null;
            layer = cur[n];
            cur = layer.layers;
        }
        return layer;
    }

    // The panel host does not always hand back the script's return value ("no return value"),
    // so every reply is ALSO written to a small file the panel can read (stamped with the request id).
    function stampAndStore(out) {
        var id = "";
        try { if (typeof panelData !== "undefined" && panelData && panelData.reqId) id = String(panelData.reqId); } catch (e0) {}
        var s = String(out);
        if (id !== "" && s.charAt(0) === "{") s = '{"reqId":"' + escapeJson(id) + '",' + s.substring(1);
        try {
            RESULT_FILE.encoding = "UTF-8";
            RESULT_FILE.open("w");
            RESULT_FILE.write(s);
            RESULT_FILE.close();
        } catch (e1) { try { RESULT_FILE.close(); } catch (e2) {} }
        try { $.global.vgLastResult = s; } catch (e3) {}
        return s;
    }

    var SETTINGS_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_settings.txt");
    var REPORT_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_last_report.txt");
    var RESULT_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_result.json");
    var EOL = ($.os.indexOf("Windows") !== -1) ? "\r\n" : "\n";
    var CATS = ["main", "secondary", "small", "oname", "fname"];
    var CAT_LABEL = { main: "Main room", secondary: "Secondary", small: "Small", oname: "O_name", fname: "F_name" };
    var EXTRAS = ["dashed", "arrow"];
    var ARROW_GLYPH_RE = /^[\s\u2190-\u21FF\u2B05-\u2B07\u27A1\u2794\u279C-\u27BE\u25B2\u25B3\u25B4\u25B6\u25B7\u25B8\u25BA\u25BC\u25BD\u25BE\u25C0\u25C1\u25C2\u25C4]+$/;

    var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

    function trim(s) { return String(s === null || s === undefined ? "" : s).replace(/^\s+|\s+$/g, ""); }

    function norm(s) {
        return trim(s)
            .replace(/[\u2018\u2019\u2032`]/g, "'")
            .replace(/[\u201C\u201D\u2033]/g, '"')
            .replace(/\s*(?:\/n|\\n)\s*/gi, " ")
            .replace(/[\r\n\u0003\u2028\u2029]+/g, " ")
            .replace(/\s+/g, " ")
            .toUpperCase();
    }

    function toPoints(val, unit) {
        var v = parseFloat(val);
        if (isNaN(v)) return 0;
        switch (String(unit).toLowerCase()) {
            case "in": return v * 72;
            case "mm": return v * (72 / 25.4);
            case "cm": return v * (72 / 2.54);
            case "px":
            case "pt":
            default:   return v;
        }
    }

    function toIllustratorLines(s) {
        var out = String(s === null || s === undefined ? "" : s);
        out = out.replace(/\s*\/n\s*/gi, "\r");
        out = out.replace(/\s*\\n\s*/g, "\r");
        out = out.replace(/\r\n|\r|\n/g, "\r");
        return out;
    }

    function parseMultiLineSpec(rawLine) {
        var cleaned = trim(rawLine);
        if (cleaned === "") return null;

        var arrow = cleaned.indexOf("=>");
        if (arrow > 0) {
            var left = trim(cleaned.substring(0, arrow));
            var right = trim(cleaned.substring(arrow + 2));
            if (left === "" || right === "") return null;
            var mapped = toIllustratorLines(right).toUpperCase();
            return { key: norm(left), value: mapped, isMap: true };
        }

        if (/\/n|\\n|\r|\n/i.test(cleaned)) {
            var illText = toIllustratorLines(cleaned).toUpperCase();
            var matchKey = norm(illText);
            if (matchKey !== "") return { key: matchKey, value: illText };
            return null;
        }

        var nt = norm(cleaned);
        var sp = nt.indexOf(" ");
        if (sp > 0) {
            return { key: nt, value: nt.substring(0, sp) + "\r" + nt.substring(sp + 1) };
        }
        return null;
    }

    function isAlnum(c) { return /[A-Z0-9]/.test(c); }

    function clamp255(v) {
        v = parseInt(v, 10);
        if (isNaN(v)) v = 0;
        return Math.max(0, Math.min(255, v));
    }

    function hex2(n) {
        var s = clamp255(n).toString(16).toUpperCase();
        return s.length < 2 ? "0" + s : s;
    }

    function rgbToHex(rgbArr) {
        return "#" + hex2(rgbArr[0]) + hex2(rgbArr[1]) + hex2(rgbArr[2]);
    }

    function makeRGB(rgbArr) {
        var cc = new RGBColor();
        cc.red = clamp255(rgbArr[0]);
        cc.green = clamp255(rgbArr[1]);
        cc.blue = clamp255(rgbArr[2]);
        return cc;
    }

    function round2(v) { return Math.round(v * 100) / 100; }
    function pad(s, n) { s = String(s); while (s.length < n) s += " "; return s; }
    function incr(o, k) { o[k] = (hasOwn(o, k) ? o[k] : 0) + 1; }

    function colorKey(c) {
        try {
            if (!c) return "none";
            switch (c.typename) {
                case "RGBColor":  return rgbToHex([c.red, c.green, c.blue]);
                case "CMYKColor": return "CMYK(" + Math.round(c.cyan) + "," + Math.round(c.magenta) + "," +
                                         Math.round(c.yellow) + "," + Math.round(c.black) + ")";
                case "GrayColor": return "Gray(" + Math.round(c.gray) + "%)";
                case "SpotColor": return "Spot:" + c.spot.name + " " + Math.round(c.tint) + "%";
                case "NoColor":   return "none";
                case "GradientColor": return "Gradient";
                case "PatternColor":  return "Pattern";
                default: return String(c.typename);
            }
        } catch (e) { return "?"; }
    }

    function applyColorToGraphic(item, rgbColor) {
        if (!item) return;
        try {
            var t = item.typename;
            if (t === "PathItem") {
                if (item.stroked) item.strokeColor = rgbColor;
                if (item.filled) item.fillColor = rgbColor;
            } else if (t === "CompoundPathItem") {
                for (var i = 0; i < item.pathItems.length; i++) {
                    applyColorToGraphic(item.pathItems[i], rgbColor);
                }
            } else if (t === "GroupItem") {
                for (var j = 0; j < item.pageItems.length; j++) {
                    applyColorToGraphic(item.pageItems[j], rgbColor);
                }
            }
        } catch (e) {}
    }

    function openItem(o) {
        var s = { l: false, h: false };
        try {
            s.l = o.locked; s.h = o.hidden;
            if (s.l) o.locked = false;
            if (s.h) o.hidden = false;
        } catch (e) {}
        return s;
    }

    function closeItem(o, s) {
        try {
            if (s.l) o.locked = true;
            if (s.h) o.hidden = true;
        } catch (e) {}
    }

    function defaultState() {
        var rules = [];
        function R(cat, text, keys, exact) {
            rules.push({ cat: cat, text: text, keys: keys, exact: !!exact });
        }
        var n;

        for (n = 1; n <= 5; n++) {
            R("main", "BEDROOM " + n, ["bed " + n, "bed" + n, "bdrm " + n, "bdrm" + n, "bedroom " + n]);
        }
        for (n = 1; n <= 4; n++) {
            R("main", "BATH " + n, ["ba " + n, "ba" + n, "bath " + n, "bath" + n]);
        }
        R("main", "OWNER'S/nSUITE",   ["owner's suite", "owners suite"]);
        R("main", "PRIMARY/nSUITE",   ["primary suite", "primary suite"]);
        R("main", "OWNER'S/nBEDROOM", ["owner's bedroom", "owners bedroom"]);
        R("main", "OWNER'S/nBATH",    ["owner's bath", "o. ba", "o. bath", "o.ba", "o.bath"]);
       R("main", "PRIMARY/nBATH",    ["primary bath", "p. ba", "p. bath", "p.ba", "p.bath"]);
       R("main", "RECREATION/nROOM",    ["recreation room"]);
        R("main", "UPSTAIRS/nLIVING", ["upstairs living"]);
        R("main", "FAMILY",          ["family"]);
        R("main", "GAME/nROOM",       ["game room"]);
        R("main", "STUDY",           ["study"]);
        R("main", "FLEX",            ["flex"]);
        R("main", "LIVING",          ["living"]);
        R("main", "CASUAL",          ["casual"]);
        R("main", "CASUAL/nDINING",   ["casual dining"]);
        R("main", "OFFICE",          ["office"]);
        R("main", "COVERED/nPORCH",   ["covered porch"]);
        R("main", "COVERED/nPATIO",   ["covered patio"]);
        R("main", "PATIO",           ["patio"]);
        R("main", "DECK",            ["deck"]);
        R("main", "DINING",          ["dining"]);
        R("main", "BREAKFAST",       ["breakfast"]);
        R("main", "LOFT",            ["loft"]);
        R("main", "KITCHEN",         ["kitchen"]);
        R("main", "GREAT/nROOM",      ["great rm", "great room"]);
        R("main", "GARAGE",          ["garage"]);
        R("main", "LAUNDRY",        ["la"], true);
        R("main", "LAUNDRY",        ["laundry"]);
        R("main", "MECH",           ["mech"]);
        R("main", "W.I.C.", ["wic", "w.i.c.", "walk-in closet", "walk in closet"]);
        R("main", "FOYER",          ["foyer"]);
        R("main", "PORCH",          ["porch"]);
        R("main", "TERRACE",         ["TERRACE"]);

        R("small", "PWDR",            ["pdr", "pwdr"]);
        R("small", "ATTIC ACCESS",    ["attic access"]);
        R("small", "REF",             ["ref", "ref."], true);
        R("small", "DW",              ["dw"], true);
        R("small", "BOWL",            ["bowl"], true);
        R("small", "OPT.",            ["opt."], true);
        R("small", "OPT",             ["opt"], true);
        R("small", "COATS",           ["coats"]);
        R("small", "LINEN",           ["linen"]);
        R("small", "PANTRY",          ["pantry"]);
        R("small", "STORAGE",         ["storage"]);
        R("small", "DROP",            ["drop"], true);
        R("small", "ZONE",            ["zone"], true);
        R("small", "CLOSET",          ["closet"]);
        R("small", "D",               ["d"], true);
        R("small", "W",               ["w"], true);
        R("small", "FRENCH DOOR",     ["fr dr", "french door"]);
        R("small", "LINE OF OPTIONAL", ["line of optional"]);
        R("small", "F.A.U.",          ["f.a.u."]);
        R("small", "OPT. VAULTED CEILING",    ["opt. vaulted clg.", "opt. vaulted ceiling"]);
        R("small", "LINE OF VAULTED CEILING", ["line of vaulted ceiling"]);
        R("small", "VAULTED CEILING",         ["vaulted ceiling"]);
        R("small", "OPT. FIREPLACE",          ["opt. elec. f.p."]);
        R("small", "OPT. WINDOW",             ["opt. 2/4x5/0"]);
        R("small", "END UNIT ONLY",           ["end unit only"]);
        R("small", "AT END CONDITION",        ["at end condition"]);
        R("small", "SINK",            ["sink"]);
        R("small", "WH",              ["wh"], true);
        R("small", "OVEN//nMICRO",              ["OVEN/ MICRO"], true);

        return {
            version: 3,
            cfg: {
                scope: "document",
                dryRun: false,
                moveOptNames: false,
                restyle: true,
                updnEnabled: true,
                wrapLabels: true,
                removeJunk: true,
                looseMatch: true,
                dashedEnabled: false,
                allLinesEnabled: false,
                arrowsEnabled: false,
                groupGraphicsEnabled: false,
                capLayersEnabled: false,
                capTextEnabled: false,
                reportEnabled: true,
                reportItems: false,
                looseMinLength: 4,
                looseMaxLength: 40,
                updnMaxLength: 14,
                optLayer: "Opt_Names",
                runSet: "standard"
            },
            dashed: {
                enabled: true,
                applyDashSpace: true,
                applyColor: true,
                applyWeight: true,
                selectAfter: true,
                strokeWeight: 0.5,
                dash: 4,
                space: 2
            },
            allLines: {
                applyWeight: true,
                applyColor: true,
                weight: 0.5,
                color: [0, 0, 0],
                skipDashed: false,
                selectAfter: false
            },
            arrows: {
                keywords: ["arrow"],
                detectTriangles: true,
                triMax: 24,
                detectGlyphs: true
            },
            universal: {
                layersIncludeSub: true,
                textMode: "upper",
                selectTexts: false
            },
            groupGraphics: {
                unit: "in",
                tolerance: 0.05,
                maxGap: 2.0,
                allowRotated: false,
                useVisibleBounds: false,
                requireAllParts: true,
                applyColor: true,
                sets: [
                    { name: "Group 1", color: [84, 84, 84], items: [{ w: 10, h: 5 }, { w: 1, h: 5 }] },
                    { name: "Group 2", color: [221, 221, 221], items: [{ w: 11, h: 4 }, { w: 6, h: 3 }] }
                ]
            },
            styleSets: {
                standard: {
                    main:      { size: 10, color: [0, 100, 255] },
                    secondary: { size: 8, color: [255, 0, 0] },
                    small:     { size: 6, color: [0, 170, 0] },
                    oname:     { size: 12, color: [170, 0, 255] },
                    fname:     { size: 12, color: [255, 128, 0] },
                    dashed:    { color: [0, 0, 0] },
                    arrow:     { color: [0, 0, 0] }
                },
                compact: {
                    main:      { size: 10, color: [0, 100, 255] },
                    secondary: { size: 8, color: [255, 0, 0] },
                    small:     { size: 6, color: [0, 170, 0] },
                    oname:     { size: 12, color: [170, 0, 255] },
                    fname:     { size: 12, color: [255, 128, 0] },
                    dashed:    { color: [0, 0, 0] },
                    arrow:     { color: [0, 0, 0] }
                }
            },
            rules: rules,
            optPatterns: ["Floor Plan", "End Unit", "At End Unit", "Basement", "Steps Option"],
            wrapTexts: ["WALK-IN CLOSET", "UPSTAIRS LIVING", "MASTER BEDROOM", "OWNER'S SUITE",
                        "OWNER'S BATH", "OWNER'S BEDROOM", "DINING ROOM", "COVERED PORCH",
                        "FRENCH DOOR", "FAMILY ROOM", "GREAT/nROOM",
                        "PRIMARY BATH => MASTER/nBATH"],
            junkExact: ["PER ELEVATION"],
            junkRegex: [
                "^SCALE:",
                "^\\d+'(-\\d+\"?)?\\s*CLG\\.?$",
                "^\\+?\\d+\"\\s*ISLAND$",
                "^\\d+\"\\s*X\\s*\\d+\"$",
                "^\\d+\\/\\d+\\s*X\\s*\\d+\\/\\d+$"
            ]
        };
    }

    function sanitizeItems(rawItems) {
        var valid = [];
        if (!(rawItems instanceof Array)) return valid;
        for (var i = 0; i < rawItems.length; i++) {
            var it = rawItems[i];
            if (it) {
                var iw = parseFloat(it.w), ih = parseFloat(it.h);
                if (!isNaN(iw) && iw >= 0 && !isNaN(ih) && ih >= 0) {
                    valid.push({ w: iw, h: ih });
                }
            }
        }
        return valid;
    }

    function mergeBool(dst, src, key) {
        if (src && typeof src[key] === "boolean") dst[key] = src[key];
    }
    function mergeNum(dst, src, key, minVal, strict) {
        if (!src) return;
        var v = parseFloat(src[key]);
        if (isNaN(v)) return;
        if (strict ? v > minVal : v >= minVal) dst[key] = v;
    }
    function mergeColor(dst, src, key) {
        if (src && src[key] && src[key].length === 3) {
            dst[key] = [clamp255(src[key][0]), clamp255(src[key][1]), clamp255(src[key][2])];
        }
    }

    // Used for BOTH the saved settings file and the live panel payload (validated, never replaces wholesale)
    function mergeState(st, saved) {
        var k, s, c;
        if (!saved) return;
        if (saved.cfg) {
            for (k in st.cfg) {
                if (hasOwn(st.cfg, k) && hasOwn(saved.cfg, k) && saved.cfg[k] !== null && saved.cfg[k] !== undefined) {
                    st.cfg[k] = saved.cfg[k];
                }
            }
            if (st.cfg.runSet !== "standard" && st.cfg.runSet !== "compact") st.cfg.runSet = "standard";
            if (st.cfg.scope !== "document" && st.cfg.scope !== "selection") st.cfg.scope = "document";
        }
        if (saved.dashed) {
            mergeBool(st.dashed, saved.dashed, "enabled");
            mergeBool(st.dashed, saved.dashed, "applyDashSpace");
            mergeBool(st.dashed, saved.dashed, "applyColor");
            mergeBool(st.dashed, saved.dashed, "applyWeight");
            mergeBool(st.dashed, saved.dashed, "selectAfter");
            mergeNum(st.dashed, saved.dashed, "strokeWeight", 0, true);
            mergeNum(st.dashed, saved.dashed, "dash", 0, true);
            mergeNum(st.dashed, saved.dashed, "space", 0, false);
        }
        if (saved.allLines) {
            mergeBool(st.allLines, saved.allLines, "applyWeight");
            mergeBool(st.allLines, saved.allLines, "applyColor");
            mergeBool(st.allLines, saved.allLines, "skipDashed");
            mergeBool(st.allLines, saved.allLines, "selectAfter");
            mergeNum(st.allLines, saved.allLines, "weight", 0, true);
            mergeColor(st.allLines, saved.allLines, "color");
        }
        if (saved.arrows) {
            mergeBool(st.arrows, saved.arrows, "detectTriangles");
            mergeBool(st.arrows, saved.arrows, "detectGlyphs");
            mergeNum(st.arrows, saved.arrows, "triMax", 0, true);
            if (saved.arrows.keywords instanceof Array) st.arrows.keywords = saved.arrows.keywords;
        }
        if (saved.universal) {
            mergeBool(st.universal, saved.universal, "layersIncludeSub");
            mergeBool(st.universal, saved.universal, "selectTexts");
            if (saved.universal.textMode === "upper" || saved.universal.textMode === "allcaps") {
                st.universal.textMode = saved.universal.textMode;
            }
        }
        if (saved.groupGraphics) {
            var gg = saved.groupGraphics;
            if (typeof gg.unit === "string") st.groupGraphics.unit = gg.unit;
            var tol = parseFloat(gg.tolerance);
            var gap = parseFloat(gg.maxGap);
            if (!isNaN(tol) && tol >= 0) st.groupGraphics.tolerance = tol;
            if (!isNaN(gap) && gap >= 0) st.groupGraphics.maxGap = gap;
            mergeBool(st.groupGraphics, gg, "allowRotated");
            mergeBool(st.groupGraphics, gg, "useVisibleBounds");
            mergeBool(st.groupGraphics, gg, "requireAllParts");
            mergeBool(st.groupGraphics, gg, "applyColor");

            if (gg.sets instanceof Array && gg.sets.length > 0) {
                var validSets = [];
                for (c = 0; c < gg.sets.length; c++) {
                    var gs = gg.sets[c];
                    if (!gs) continue;
                    var sName = trim(gs.name) !== "" ? trim(gs.name) : ("Group " + (validSets.length + 1));
                    var sCol = [84, 84, 84];
                    if (gs.color && gs.color.length === 3) {
                        sCol = [clamp255(gs.color[0]), clamp255(gs.color[1]), clamp255(gs.color[2])];
                    }
                    validSets.push({ name: sName, color: sCol, items: sanitizeItems(gs.items) });
                }
                if (validSets.length > 0) st.groupGraphics.sets = validSets;
            }
        }
        if (saved.styleSets) {
            for (s in st.styleSets) {
                if (!hasOwn(st.styleSets, s) || !saved.styleSets[s]) continue;
                for (c = 0; c < CATS.length; c++) {
                    var src = saved.styleSets[s][CATS[c]];
                    if (!src) continue;
                    var size = parseFloat(src.size);
                    if (!isNaN(size) && size > 0) st.styleSets[s][CATS[c]].size = size;
                    mergeColor(st.styleSets[s][CATS[c]], src, "color");
                }
                for (c = 0; c < EXTRAS.length; c++) {
                    var ex = saved.styleSets[s][EXTRAS[c]];
                    if (ex) mergeColor(st.styleSets[s][EXTRAS[c]], ex, "color");
                }
            }
        }
        var arrays = ["optPatterns", "wrapTexts", "junkExact", "junkRegex"];
        for (c = 0; c < arrays.length; c++) {
            if (saved[arrays[c]] instanceof Array) st[arrays[c]] = saved[arrays[c]];
        }
        if (saved.rules instanceof Array) {
            var good = [];
            for (c = 0; c < saved.rules.length; c++) {
                var r = saved.rules[c];
                if (r && hasOwn(CAT_LABEL, r.cat) && typeof r.text === "string" && r.keys instanceof Array) {
                    good.push({ cat: r.cat, text: r.text, keys: r.keys, exact: !!r.exact });
                }
            }
            if (good.length > 0) st.rules = good;   // FIX: never end up with zero rules from a bad payload
        }
    }

    function loadState(file) {
        var st = defaultState();
        try {
            if (file.exists) {
                file.encoding = "UTF-8";
                file.open("r");
                var s = file.read();
                file.close();
                mergeState(st, eval("(" + s + ")"));
            }
        } catch (e) {
            try { file.close(); } catch (e2) {}
        }
        st.cfg.dryRun = false;
        return st;
    }

    function saveState(st, file) {
        try {
            file.encoding = "UTF-8";
            file.open("w");
            file.write(st.toSource());
            file.close();
            return true;
        } catch (e) {
            try { file.close(); } catch (e2) {}
            return false;
        }
    }

    function saveReportFile(text) {
        try {
            REPORT_FILE.encoding = "UTF-8";
            REPORT_FILE.open("w");
            REPORT_FILE.write(text);
            REPORT_FILE.close();
            return true;
        } catch (e) {
            try { REPORT_FILE.close(); } catch (e2) {}
            return false;
        }
    }

    function readReportFile() {
        try {
            if (!REPORT_FILE.exists) return "";
            REPORT_FILE.encoding = "UTF-8";
            REPORT_FILE.open("r");
            var txt = REPORT_FILE.read();
            REPORT_FILE.close();
            return txt;
        } catch (e) {
            try { REPORT_FILE.close(); } catch (e2) {}
            return "";
        }
    }

    function compile(st) {
        var ctx = { rules: {}, loose: [], wrap: {}, junkExact: {}, junkRegex: [], badRegex: [],
                    opt: [], cfg: st.cfg };
        var i, j, r, k;

        for (i = 0; i < st.rules.length; i++) {
            r = st.rules[i];
            var formattedFinal = toIllustratorLines(r.text).toUpperCase();
            var keys = r.keys.length ? r.keys : [r.text];
            for (j = 0; j < keys.length; j++) {
                k = norm(keys[j]);
                if (k !== "") ctx.rules[k] = { text: formattedFinal, cat: r.cat, exact: !!r.exact };
            }
        }
        for (i = 0; i < st.rules.length; i++) {
            var outFinal = toIllustratorLines(st.rules[i].text).toUpperCase();
            k = norm(outFinal);
            if (k !== "" && !hasOwn(ctx.rules, k)) {
                ctx.rules[k] = { text: outFinal, cat: st.rules[i].cat, exact: false };
            }
        }
        for (k in ctx.rules) {
            if (hasOwn(ctx.rules, k) && !ctx.rules[k].exact && k.length >= st.cfg.looseMinLength) ctx.loose.push(k);
        }
        ctx.loose.sort(function (a, b) { return b.length - a.length; });

        for (i = 0; i < st.wrapTexts.length; i++) {
            var spec = parseMultiLineSpec(st.wrapTexts[i]);
            if (spec) ctx.wrap[spec.key] = spec.value;
        }
        for (i = 0; i < st.wrapTexts.length; i++) {
            var spec2 = parseMultiLineSpec(st.wrapTexts[i]);
            if (spec2 && spec2.isMap) {
                var outKey = norm(spec2.value);
                if (outKey !== "" && !hasOwn(ctx.wrap, outKey)) ctx.wrap[outKey] = spec2.value;
            }
        }
        for (i = 0; i < st.junkExact.length; i++) ctx.junkExact[norm(st.junkExact[i])] = true;
        for (i = 0; i < st.junkRegex.length; i++) {
            try { ctx.junkRegex.push(new RegExp(st.junkRegex[i], "i")); }
            catch (e) { ctx.badRegex.push(st.junkRegex[i]); }
        }
        for (i = 0; i < st.optPatterns.length; i++) {
            var p = norm(st.optPatterns[i]);
            if (p !== "") ctx.opt.push(p);
        }
        return ctx;
    }

    function compileArrows(st) {
        var a = st.arrows, kw = [];
        for (var i = 0; i < a.keywords.length; i++) {
            var k = trim(a.keywords[i]).toLowerCase();
            if (k !== "") kw.push(k);
        }
        return { kw: kw, tri: !!a.detectTriangles, triMax: a.triMax, glyph: !!a.detectGlyphs, glyphRe: ARROW_GLYPH_RE };
    }

    function kwMatch(actx, s) {
        for (var i = 0; i < actx.kw.length; i++) if (s.indexOf(actx.kw[i]) !== -1) return true;
        return false;
    }

    function arrowLayerMatch(actx, layerPath) {
        return actx.kw.length > 0 && kwMatch(actx, String(layerPath).toLowerCase());
    }

    function arrowKind(actx, p, layerPath, layerArrow) {
        if (layerArrow) return "Named (layer)";
        if (actx.kw.length) {
            var n = "";
            try { n = String(p.name).toLowerCase(); } catch (e0) {}
            if (n !== "" && kwMatch(actx, n)) return "Named (item)";
            var par = null;
            try { par = p.parent; } catch (e1) {}
            for (var d = 0; par && d < 3; d++) {
                var tn = "";
                try { tn = par.typename; } catch (e2) { break; }
                if (tn === "Layer" || tn === "Document") break;
                var pn = "";
                try { pn = String(par.name).toLowerCase(); } catch (e3) {}
                if (pn !== "" && kwMatch(actx, pn)) return "Named (group)";
                par = par.parent;
            }
        }
        if (actx.tri) {
            try {
                if (p.closed && p.filled && p.width <= actx.triMax && p.height <= actx.triMax &&
                    p.pathPoints.length === 3) return "Triangle arrowhead";
            } catch (e4) {}
        }
        return null;
    }

    function looseMatch(ctx, t) {
        if (t.length > ctx.cfg.looseMaxLength) return null;
        for (var i = 0; i < ctx.loose.length; i++) {
            var key = ctx.loose[i], from = 0, idx;
            while ((idx = t.indexOf(key, from)) !== -1) {
                var e = idx + key.length;
                var okB = idx === 0 || !isAlnum(t.charAt(idx - 1));
                var okA = e >= t.length || !isAlnum(t.charAt(e));
                if (okB && okA) return ctx.rules[key];
                from = idx + 1;
            }
        }
        return null;
    }

    function matchRule(ctx, t) {
        if (hasOwn(ctx.rules, t)) return ctx.rules[t];
        return ctx.cfg.looseMatch ? looseMatch(ctx, t) : null;
    }

    function getUpDn(ctx, t) {
        if (t.length > ctx.cfg.updnMaxLength) return null;
        if (/\bUP\b/.test(t)) return "UP";
        if (/\b(DN|DWN)\b/.test(t)) return "DN";
        return null;
    }

    function isJunk(ctx, t) {
        if (hasOwn(ctx.junkExact, t)) return true;
        for (var i = 0; i < ctx.junkRegex.length; i++) if (ctx.junkRegex[i].test(t)) return true;
        return false;
    }

    function isOptText(ctx, t) {
        for (var i = 0; i < ctx.opt.length; i++) if (t.indexOf(ctx.opt[i]) !== -1) return true;
        return false;
    }

    function decideText(ctx, cfg, t) {
        if (cfg.moveOptNames && isOptText(ctx, t)) return { k: "opt" };
        if (cfg.removeJunk && isJunk(ctx, t)) return { k: "junk" };

        var out = null, cat = null, isUpDn = false;
        if (cfg.restyle) {
            var ud = cfg.updnEnabled ? getUpDn(ctx, t) : null;
            if (ud) { out = ud; cat = "small"; isUpDn = true; }
            else {
                var rule = matchRule(ctx, t);
                if (rule) { out = rule.text; cat = rule.cat; }
            }
        }

        var outText = null;
        if (!isUpDn && cfg.wrapLabels && hasOwn(ctx.wrap, t)) {
            outText = ctx.wrap[t];
        } else if (out !== null) {
            outText = out;
            if (!isUpDn && cfg.wrapLabels) {
                var nf = norm(out);
                if (hasOwn(ctx.wrap, nf)) outText = ctx.wrap[nf];
            }
        }
        if (outText === null) return { k: "none" };
        return { k: "label", text: outText, cat: cat, upDn: isUpDn, wrapped: outText.indexOf("\r") !== -1 };
    }

    function walkLayersPlain(layers, fn, parentPath, includeSub) {
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i];
            var path = parentPath ? (parentPath + " > " + L.name) : L.name;
            try { fn(L, path); } catch (e) {}
            if (includeSub && L.layers.length) walkLayersPlain(L.layers, fn, path, true);
        }
    }

    function walkLayersLocked(layers, fn, parentPath) {
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i], wasL = false, wasV = true;
            try {
                wasL = L.locked; wasV = L.visible;
                if (wasL) L.locked = false;
                if (!wasV) L.visible = true;
            } catch (e) {}
            var path = parentPath ? (parentPath + " > " + L.name) : L.name;
            try { fn(L, path); } catch (eFn) {}
            if (L.layers.length) walkLayersLocked(L.layers, fn, path);
            try {
                if (wasL) L.locked = true;
                if (!wasV) L.visible = false;
            } catch (e2) {}
        }
    }

    function collectSel(items, kind, out) {
        for (var i = 0; i < items.length; i++) {
            var it = items[i], t = it.typename, dup = false, j;
            if (kind === "textFrames") {
                if (t === "TextFrame") {
                    for (j = 0; j < out.length; j++) if (out[j] === it) { dup = true; break; }
                    if (!dup) out.push(it);
                } else if (t === "GroupItem") collectSel(it.pageItems, kind, out);
            } else {
                if (t === "PathItem") {
                    for (j = 0; j < out.length; j++) if (out[j] === it) { dup = true; break; }
                    if (!dup) out.push(it);
                } else if (t === "GroupItem") collectSel(it.pageItems, kind, out);
                else if (t === "CompoundPathItem") collectSel(it.pathItems, kind, out);
            }
        }
    }

    function hasSelection(doc) {
        try { return !!(doc.selection && doc.selection.length); } catch (e) { return false; }
    }

    function forEachScope(doc, scope, kind, fn, noUnlock) {
        if (scope === "selection") {
            // FIX: "selection" with nothing selected used to silently fall through to the WHOLE document
            if (!hasSelection(doc)) return;
            var out = [];
            collectSel(doc.selection, kind, out);
            fn(out, "(selection)");
            return;
        }
        var visit = function (L, path) {
            var coll;
            try { coll = L[kind]; } catch (e) { return; }
            var n = coll.length, arr = [], i;
            for (i = 0; i < n; i++) arr.push(coll[i]);
            fn(arr, path);
        };
        if (noUnlock) walkLayersPlain(doc.layers, visit, "", true);
        else walkLayersLocked(doc.layers, visit, "");
    }

    function forEachLayer(layers, fn) {
        for (var i = 0; i < layers.length; i++) {
            fn(layers[i]);
            if (layers[i].layers.length) forEachLayer(layers[i].layers, fn);
        }
    }

    function unlockAllLayers(doc) {
        var saved = [];
        forEachLayer(doc.layers, function (l) {
            saved.push({ layer: l, locked: l.locked, visible: l.visible });
            try { l.locked = false; l.visible = true; } catch (e) {}
        });
        return saved;
    }

    function restoreLayers(saved) {
        for (var i = saved.length - 1; i >= 0; i--) {
            try {
                saved[i].layer.locked = saved[i].locked;
                saved[i].layer.visible = saved[i].visible;
            } catch (e) {}
        }
    }

    function getItemBounds(item, useVisible) {
        try {
            var b = useVisible ? item.visibleBounds : item.geometricBounds;
            return {
                left: b[0], top: b[1], right: b[2], bottom: b[3],
                w: Math.abs(b[2] - b[0]), h: Math.abs(b[1] - b[3]),
                cx: (b[0] + b[2]) * 0.5, cy: (b[1] + b[3]) * 0.5
            };
        } catch (e) { return null; }
    }

    function matchesTargetSize(wPt, hPt, targetWPt, targetHPt, tolPt, allowRotated) {
        var direct = (Math.abs(wPt - targetWPt) <= tolPt) && (Math.abs(hPt - targetHPt) <= tolPt);
        if (direct) return true;
        if (allowRotated) {
            return (Math.abs(wPt - targetHPt) <= tolPt) && (Math.abs(hPt - targetWPt) <= tolPt);
        }
        return false;
    }

    function boundsGap(a, b) {
        var dx = 0;
        if (a.right < b.left) dx = b.left - a.right;
        else if (b.right < a.left) dx = a.left - b.right;

        var dy = 0;
        if (a.top < b.bottom) dy = b.bottom - a.top;
        else if (b.top < a.bottom) dy = a.bottom - b.top;

        return Math.sqrt(dx * dx + dy * dy);
    }

    function collectGraphicCandidates(doc, scope, out) {
        var i;
        if (scope === "selection") {
            if (!hasSelection(doc)) return;   // FIX: same selection fall-through bug
            for (i = 0; i < doc.selection.length; i++) collectGraphicNode(doc.selection[i], out);
        } else {
            for (i = 0; i < doc.layers.length; i++) collectGraphicFromLayer(doc.layers[i], out);
        }
    }

    function collectGraphicFromLayer(layer, out) {
        var i;
        for (i = 0; i < layer.pageItems.length; i++) collectGraphicNode(layer.pageItems[i], out);
        for (i = 0; i < layer.layers.length; i++) collectGraphicFromLayer(layer.layers[i], out);
    }

    function collectGraphicNode(item, out) {
        if (!item) return;
        var t = item.typename;
        if (t === "TextFrame" || t === "LegacyTextItem") return;

        if (t === "PathItem" || t === "CompoundPathItem" || t === "PlacedItem" ||
            t === "RasterItem" || t === "SymbolItem" || t === "MeshItem" ||
            t === "PluginItem" || t === "GroupItem") {
            out.push(item);
        }
        if (t === "GroupItem") {
            for (var i = 0; i < item.pageItems.length; i++) collectGraphicNode(item.pageItems[i], out);
        }
    }

    function isInArray(arr, item) {
        for (var i = 0; i < arr.length; i++) if (arr[i] === item) return true;
        return false;
    }

    function runGroupGraphics(doc, st, dryOverride) {
        var gg = st.groupGraphics;
        var DRY = (typeof dryOverride === "boolean") ? dryOverride : st.cfg.dryRun;
        var res = {
            setsCount: gg.sets ? gg.sets.length : 0,
            matchedTotal: 0, groupsCreated: 0, itemsGrouped: 0,
            incompleteSkipped: 0, errors: 0, perSet: [], details: []
        };

        if (!gg.sets || gg.sets.length === 0) return res;

        var unit = gg.unit || "in";
        var tolPt = toPoints(gg.tolerance, unit);
        var maxGapPt = toPoints(gg.maxGap, unit);

        var savedLayers = unlockAllLayers(doc);
        try {
            var candidates = [];
            collectGraphicCandidates(doc, st.cfg.scope, candidates);

            // FIX: always de-duplicate (nested items were being collected twice)
            var pool = [];
            var seenHandles = [];
            for (var i = 0; i < candidates.length; i++) {
                var item = candidates[i];
                try { if (item.guides || item.clipping) continue; } catch (eG) {}
                if (isInArray(seenHandles, item)) continue;
                seenHandles.push(item);
                var b = getItemBounds(item, gg.useVisibleBounds);
                if (!b || (b.w === 0 && b.h === 0)) continue;
                pool.push({ item: item, bounds: b, globallyUsed: false });
            }

            if (!DRY) {
                try { doc.selection = null; } catch (eSel) {}
            }

            for (var setIdx = 0; setIdx < gg.sets.length; setIdx++) {
                var gSet = gg.sets[setIdx];
                var setStats = {
                    name: gSet.name || ("Group " + (setIdx + 1)),
                    hex: rgbToHex(gSet.color || [84, 84, 84]),
                    partsCount: gSet.items ? gSet.items.length : 0,
                    matched: 0, groupsCreated: 0, itemsGrouped: 0, incompleteSkipped: 0
                };

                if (!gSet.items || gSet.items.length === 0) {
                    res.perSet.push(setStats);
                    continue;
                }

                var targets = [];
                for (var s = 0; s < gSet.items.length; s++) {
                    targets.push({
                        idx: s,
                        wPt: toPoints(gSet.items[s].w, unit),
                        hPt: toPoints(gSet.items[s].h, unit)
                    });
                }

                var matched = [];
                for (var pIdx = 0; pIdx < pool.length; pIdx++) {
                    var entry = pool[pIdx];
                    if (entry.globallyUsed) continue;

                    var matchedSlots = [];
                    for (var t = 0; t < targets.length; t++) {
                        if (matchesTargetSize(entry.bounds.w, entry.bounds.h, targets[t].wPt, targets[t].hPt, tolPt, gg.allowRotated)) {
                            matchedSlots.push(t);
                        }
                    }
                    if (matchedSlots.length > 0) {
                        matched.push({
                            poolEntry: entry, item: entry.item, bounds: entry.bounds,
                            slots: matchedSlots, used: false
                        });
                    }
                }

                // a matched group that contains another matched item is skipped in favour of its children
                for (var a = 0; a < matched.length; a++) {
                    if (matched[a].item.typename !== "GroupItem") continue;
                    for (var c = 0; c < matched.length; c++) {
                        if (a === c) continue;
                        var par = matched[c].item.parent;
                        while (par && par.typename !== "Layer" && par.typename !== "Document") {
                            if (par === matched[a].item) {
                                matched[a].used = true;
                                break;
                            }
                            par = par.parent;
                        }
                        if (matched[a].used) break;
                    }
                }

                var active = [];
                for (var m = 0; m < matched.length; m++) {
                    if (!matched[m].used) active.push(matched[m]);
                }
                setStats.matched = active.length;
                res.matchedTotal += active.length;

                var setsToGroup = [];
                for (var idx0 = 0; idx0 < active.length; idx0++) {
                    var anchor = active[idx0];
                    if (anchor.used) continue;

                    var canStartSlot0 = false;
                    for (var sl = 0; sl < anchor.slots.length; sl++) {
                        if (anchor.slots[sl] === 0) { canStartSlot0 = true; break; }
                    }
                    if (!canStartSlot0) continue;

                    var chosen = [anchor];
                    var missing = false;

                    for (var slotIdx = 1; slotIdx < targets.length; slotIdx++) {
                        var bestCand = null;
                        var bestDist = Infinity;

                        for (var candIdx = 0; candIdx < active.length; candIdx++) {
                            var cand = active[candIdx];
                            if (cand.used || cand === anchor) continue;
                            if (isInArray(chosen, cand)) continue;

                            var fitsSlot = false;
                            for (var cs = 0; cs < cand.slots.length; cs++) {
                                if (cand.slots[cs] === slotIdx) { fitsSlot = true; break; }
                            }
                            if (!fitsSlot) continue;

                            var minGap = Infinity;
                            for (var cm = 0; cm < chosen.length; cm++) {
                                var gDist = boundsGap(chosen[cm].bounds, cand.bounds);
                                if (gDist < minGap) minGap = gDist;
                            }

                            if (minGap <= maxGapPt && minGap < bestDist) {
                                bestDist = minGap;
                                bestCand = cand;
                            }
                        }

                        if (bestCand) {
                            chosen.push(bestCand);
                        } else {
                            missing = true;
                            break;
                        }
                    }

                    if (missing && gg.requireAllParts) {
                        setStats.incompleteSkipped++;
                        res.incompleteSkipped++;
                        continue;
                    }

                    if (chosen.length >= 2 || targets.length === 1) {
                        for (var u = 0; u < chosen.length; u++) {
                            chosen[u].used = true;
                            chosen[u].poolEntry.globallyUsed = true;
                        }
                        setsToGroup.push(chosen);
                    } else {
                        setStats.incompleteSkipped++;
                        res.incompleteSkipped++;
                    }
                }

                var setRGB = makeRGB(gSet.color || [84, 84, 84]);
                if (!DRY) {
                    for (var gIdx = 0; gIdx < setsToGroup.length; gIdx++) {
                        var setItems = setsToGroup[gIdx];
                        try {
                            var container = setItems[0].item.parent;
                            var grp = container.groupItems.add();
                            grp.name = setStats.name + "_" + (gIdx + 1);
                            for (var k = 0; k < setItems.length; k++) {
                                var itObj = setItems[k].item;
                                itObj.move(grp, ElementPlacement.PLACEATEND);
                                if (gg.applyColor) applyColorToGraphic(itObj, setRGB);
                                setStats.itemsGrouped++;
                                res.itemsGrouped++;
                            }
                            grp.selected = true;
                            setStats.groupsCreated++;
                            res.groupsCreated++;
                        } catch (eGrp) {
                            res.errors++;
                            if (res.details.length < 10) res.details.push(setStats.name + " #" + (gIdx + 1) + ": " + eGrp);
                        }
                    }
                } else {
                    setStats.groupsCreated = setsToGroup.length;
                    res.groupsCreated += setsToGroup.length;
                    for (var dIdx = 0; dIdx < setsToGroup.length; dIdx++) {
                        setStats.itemsGrouped += setsToGroup[dIdx].length;
                        res.itemsGrouped += setsToGroup[dIdx].length;
                    }
                }

                res.perSet.push(setStats);
            }
        } finally {
            // FIX: layers are restored even if grouping throws
            restoreLayers(savedLayers);
        }
        return res;
    }

    function scanUnmatched(doc, st) {
        var ctx = compile(st);
        var counts = {}, t;
        forEachScope(doc, st.cfg.scope, "textFrames", function (frames) {
            for (var i = 0; i < frames.length; i++) {
                try {
                    t = norm(frames[i].contents);
                    if (t === "" || isOptText(ctx, t) || isJunk(ctx, t) || getUpDn(ctx, t) ||
                        matchRule(ctx, t) || hasOwn(ctx.wrap, t)) continue;
                    counts[t] = (counts[t] || 0) + 1;
                } catch (e) {}
            }
        }, true);
        var list = [];
        for (t in counts) if (hasOwn(counts, t)) list.push({ t: t, n: counts[t] });
        list.sort(function (a, b) { return b.n - a.n; });
        return list;
    }

    function histLines(title, obj, limit) {
        var arr = [], k, i;
        for (k in obj) if (hasOwn(obj, k)) arr.push({ k: k, n: obj[k] });
        arr.sort(function (a, b) { return b.n - a.n; });
        var out = ["", title];
        if (!arr.length) out.push("  (none)");
        for (i = 0; i < arr.length && i < limit; i++) out.push("  " + pad(arr[i].n, 8) + arr[i].k);
        if (arr.length > limit) out.push("  ... +" + (arr.length - limit) + " more");
        return out;
    }

    function buildAudit(doc, st, ctx, actx, listItems) {
        var cfg = st.cfg, CAP = 2500;
        var layerMap = {}, layerOrder = [];
        function row(path) {
            if (!hasOwn(layerMap, path)) {
                layerMap[path] = { path: path, texts: 0, paths: 0, stroked: 0, dashed: 0, arrows: 0 };
                layerOrder.push(path);
            }
            return layerMap[path];
        }
        var H = { font: {}, size: {}, tcolor: {}, tcat: {}, sw: {}, sc: {}, dash: {}, cap: {}, join: {},
                  fill: {}, atype: {}, acolor: {} };
        var textRows = [], strokeRows = [], arrowRows = [];
        var tot = { texts: 0, multi: 0, paths: 0, stroked: 0, dashed: 0, filled: 0, open: 0, arrows: 0 };

        forEachScope(doc, cfg.scope, "textFrames", function (frames, lname) {
            var r = row(lname);
            for (var i = 0; i < frames.length; i++) {
                try {
                    var tf = frames[i];
                    var raw = tf.contents;
                    var t = norm(raw);
                    if (t === "") continue;
                    r.texts++; tot.texts++;
                    var ca = tf.textRange.characterAttributes;
                    var font = "?", size = "?", col = "?";
                    try { font = ca.textFont.name; } catch (e1) { font = "(mixed)"; }
                    try { size = round2(ca.size); } catch (e2) { size = "(mixed)"; }
                    try { col = colorKey(ca.fillColor); } catch (e3) { col = "(mixed)"; }
                    var lines = raw.split(/\r|\n|\u0003/).length;
                    if (lines > 1) tot.multi++;
                    var cat;
                    if (actx.glyphRe.test(raw)) {
                        cat = "Arrow glyph";
                        incr(H.atype, "Text arrow glyph"); incr(H.acolor, "text " + col);
                        r.arrows++; tot.arrows++;
                        if (listItems && arrowRows.length < CAP) arrowRows.push(lname + " | Text arrow glyph | " + t + " | " + col);
                    } else if (getUpDn(ctx, t)) {
                        cat = "UP / DN";
                    } else {
                        var rule = matchRule(ctx, t);
                        cat = rule ? CAT_LABEL[rule.cat] : "(unrecognised)";
                    }
                    incr(H.tcat, cat); incr(H.font, font); incr(H.size, size + " pt"); incr(H.tcolor, col);
                    if (listItems && textRows.length < CAP) {
                        textRows.push(lname + " | " + raw.replace(/\r|\n|\u0003/g, " / ") + " | " + cat + " | " +
                                      font + " | " + size + " pt | " + col + (lines > 1 ? " | multi-line" : ""));
                    }
                } catch (eT) {}
            }
        }, true);

        forEachScope(doc, cfg.scope, "pathItems", function (paths, lname) {
            var r = row(lname), layerArrow = arrowLayerMatch(actx, lname);
            for (var i = 0; i < paths.length; i++) {
                try {
                    var p = paths[i];
                    try { if (p.guides || p.clipping) continue; } catch (eg) {}
                    r.paths++; tot.paths++;
                    var stroked = p.stroked, filled = p.filled;
                    var fc = filled ? colorKey(p.fillColor) : "none";
                    var sc = "none", wt = 0, dashStr = "solid";
                    if (!p.closed) tot.open++;
                    if (filled) { tot.filled++; incr(H.fill, fc); }
                    if (stroked) {
                        r.stroked++; tot.stroked++;
                        wt = round2(p.strokeWidth);
                        sc = colorKey(p.strokeColor);
                        var dd = p.strokeDashes;
                        if (dd && dd.length) {
                            r.dashed++; tot.dashed++;
                            var dp = [];
                            for (var k = 0; k < dd.length; k++) dp.push(round2(dd[k]));
                            dashStr = dp.join(" / ");
                        }
                        incr(H.sw, wt + " pt");
                        incr(H.sc, sc);
                        incr(H.dash, dashStr);
                        incr(H.cap, String(p.strokeCap).replace("StrokeCap.", ""));
                        incr(H.join, String(p.strokeJoin).replace("StrokeJoin.", ""));
                        if (listItems && strokeRows.length < CAP) {
                            strokeRows.push(lname + " | " + (p.closed ? "closed" : "open") + " | " + wt + " pt | " +
                                            sc + " | dash " + dashStr);
                        }
                    }
                    var ak = arrowKind(actx, p, lname, layerArrow);
                    if (ak) {
                        r.arrows++; tot.arrows++;
                        incr(H.atype, ak);
                        var ac = (filled ? "fill " + fc : "") + (filled && stroked ? " + " : "") + (stroked ? "stroke " + sc : "");
                        incr(H.acolor, ac === "" ? "none" : ac);
                        if (listItems && arrowRows.length < CAP) {
                            arrowRows.push(lname + " | " + ak + " | " + p.pathPoints.length + " pts | " +
                                           round2(p.width) + " x " + round2(p.height) + " pt | " + ac);
                        }
                    }
                } catch (eP) {}
            }
        }, true);

        var L = [];
        L.push("");
        L.push("==================================================");
        L.push("DETAILED DOCUMENT REPORT" + (cfg.scope === "selection" ? "  (selection only)" : ""));
        L.push("==================================================");
        try { L.push("Document:               " + doc.name); } catch (e0) {}
        try { L.push("Artboards:              " + doc.artboards.length); } catch (e0b) {}
        try { L.push("Colour space:           " + String(doc.documentColorSpace).replace("DocumentColorSpace.", "")); } catch (e0c) {}
        L.push("Layers (incl. sub):     " + layerOrder.length);
        L.push("Text frames:            " + tot.texts + "   (multi-line: " + tot.multi + ")");
        L.push("Path items:             " + tot.paths + "   (open: " + tot.open + ", filled: " + tot.filled + ")");
        L.push("Stroked paths:          " + tot.stroked + "   (dashed: " + tot.dashed + ")");
        L.push("Arrow objects:          " + tot.arrows);

        L.push("");
        L.push("LAYERS  (text | paths | stroked | dashed | arrows)");
        for (var li = 0; li < layerOrder.length; li++) {
            var lr = layerMap[layerOrder[li]];
            L.push("  " + pad(lr.path, 46) + pad(lr.texts, 8) + pad(lr.paths, 8) + pad(lr.stroked, 8) +
                   pad(lr.dashed, 8) + lr.arrows);
        }

        L = L.concat(histLines("TEXT BY LABEL CATEGORY", H.tcat, 40));
        L = L.concat(histLines("TEXT FONTS", H.font, 25));
        L = L.concat(histLines("TEXT SIZES", H.size, 25));
        L = L.concat(histLines("TEXT FILL COLOURS", H.tcolor, 25));
        L = L.concat(histLines("STROKE WEIGHTS", H.sw, 30));
        L = L.concat(histLines("STROKE COLOURS", H.sc, 30));
        L = L.concat(histLines("DASH PATTERNS (dash / space ...)", H.dash, 25));
        L = L.concat(histLines("STROKE CAPS", H.cap, 10));
        L = L.concat(histLines("STROKE JOINS", H.join, 10));
        L = L.concat(histLines("FILL COLOURS (paths)", H.fill, 30));
        L = L.concat(histLines("ARROW TYPES", H.atype, 20));
        L = L.concat(histLines("ARROW COLOURS", H.acolor, 25));

        if (listItems) {
            L.push("");
            L.push("TEXT LISTING (layer | text | category | font | size | colour)  max " + CAP);
            for (var a = 0; a < textRows.length; a++) L.push("  " + textRows[a]);
            L.push("");
            L.push("STROKE LISTING (layer | type | weight | colour | dash)  max " + CAP);
            for (var b = 0; b < strokeRows.length; b++) L.push("  " + strokeRows[b]);
            L.push("");
            L.push("ARROW LISTING (layer | type | detail)  max " + CAP);
            for (var c = 0; c < arrowRows.length; c++) L.push("  " + arrowRows[c]);
        }
        return L;
    }

    function runCleaner(doc, st, setName) {
        var t0 = new Date().getTime();
        var cfg = st.cfg;
        var DRY = cfg.dryRun;
        var ctx = compile(st);
        var actx = compileArrows(st);
        var set = st.styleSets[setName] || st.styleSets.standard;
        var dashedCfg = st.dashed, allCfg = st.allLines, up = st.universal;

        var styles = {};
        for (var ci = 0; ci < CATS.length; ci++) {
            styles[CATS[ci]] = {
                size: set[CATS[ci]].size,
                color: makeRGB(set[CATS[ci]].color)
            };
        }
        var dashedColor = makeRGB(set.dashed ? set.dashed.color : [0, 0, 0]);
        var arrowColor = makeRGB(set.arrow ? set.arrow.color : [0, 0, 0]);
        var allColor = makeRGB(allCfg.color);

        var stats = {
            scanned: 0, optMatched: 0, main: 0, secondary: 0, small: 0, oname: 0, fname: 0,
            updn: 0, wrapped: 0, textOnly: 0, removed: 0, empty: 0, errors: 0,
            capped: 0, selectedTexts: 0, layersSeen: 0, layersCapped: 0,
            allFound: 0, allUpdated: 0, dashedFound: 0, dashedUpdated: 0,
            arrowsFound: 0, arrowsUpdated: 0
        };
        var unmatched = {}, errorLog = [], cache = {};
        var ggRes = null, auditLines = null;

        var doDashed = !!(cfg.dashedEnabled && dashedCfg.enabled);
        var doAll = !!cfg.allLinesEnabled;
        var doArrows = !!cfg.arrowsEnabled;
        var capText = !!cfg.capTextEnabled;

        var oldLevel = null;
        try {
            oldLevel = app.userInteractionLevel;
            app.userInteractionLevel = UserInteractionLevel.DONTDISPLAYALERTS;
        } catch (eUi) {}

        try {
            report(20, "Processing text frames...");
            var textNeeded = cfg.restyle || cfg.wrapLabels || cfg.removeJunk || cfg.moveOptNames ||
                             capText || (doArrows && actx.glyph);

            var processFrame = function (tf) {
                try {
                    stats.scanned++;
                    var raw = tf.contents;
                    var t = norm(raw);
                    if (t === "") { stats.empty++; return; }

                    if (doArrows && actx.glyph && actx.glyphRe.test(raw)) {
                        stats.arrowsFound++;
                        if (!DRY) {
                            var sa = openItem(tf);
                            try { tf.textRange.characterAttributes.fillColor = arrowColor; stats.arrowsUpdated++; }
                            finally { closeItem(tf, sa); }
                        }
                        return;
                    }

                    var d = hasOwn(cache, t) ? cache[t] : null;
                    if (!d) { d = decideText(ctx, cfg, t); cache[t] = d; }

                    if (d.k === "junk") {
                        if (!DRY) { openItem(tf); tf.remove(); }
                        stats.removed++;
                        return;
                    }
                    if (d.k === "opt") stats.optMatched++;

                    var doLabel = (d.k === "label");
                    if (doLabel) {
                        if (d.upDn) stats.updn++;
                        else if (d.cat) stats[d.cat]++;
                        else stats.textOnly++;
                        if (d.wrapped) stats.wrapped++;
                    } else if (d.k === "none") {
                        unmatched[t] = (unmatched[t] || 0) + 1;
                    }

                    var upper = raw;
                    var capNow = false;
                    if (capText) {
                        if (up.textMode === "allcaps") capNow = true;
                        else if (!doLabel) { upper = raw.toUpperCase(); capNow = (upper !== raw); }
                    }
                    var selNow = capText && up.selectTexts;

                    if (DRY) {
                        if (capNow) stats.capped++;
                        return;
                    }
                    if (!doLabel && !capNow && !selNow) return;

                    var sf = openItem(tf);
                    try {
                        if (doLabel) {
                            if (raw !== d.text) tf.contents = d.text;
                            if (d.cat) {
                                var s = styles[d.cat];
                                var ca = tf.textRange.characterAttributes;
                                ca.size = s.size;
                                ca.horizontalScale = 100;
                                ca.fillColor = s.color;
                            }
                            if (d.wrapped) tf.textRange.paragraphAttributes.justification = Justification.CENTER;
                        }
                        if (capNow) {
                            if (up.textMode === "allcaps") tf.textRange.characterAttributes.capitalization = FontCapsOption.ALLCAPS;
                            else tf.contents = upper;
                            stats.capped++;
                        }
                    } finally {
                        closeItem(tf, sf);
                    }
                    if (selNow && !sf.l && !sf.h) { tf.selected = true; stats.selectedTexts++; }
                } catch (e) {
                    stats.errors++;
                    if (errorLog.length < 10) errorLog.push("Text frame: " + e);
                }
            };

            if (textNeeded) {
                if (!DRY && capText && up.selectTexts) { try { doc.selection = null; } catch (eS0) {} }
                forEachScope(doc, cfg.scope, "textFrames", function (frames) {
                    for (var i = 0; i < frames.length; i++) processFrame(frames[i]);
                });
            }

            if (doAll || doDashed || doArrows) {
                report(50, "Processing lines & arrows...");
                var wantSelect = (doAll && allCfg.selectAfter) || (doDashed && dashedCfg.selectAfter);
                if (!DRY && wantSelect && !(capText && up.selectTexts)) { try { doc.selection = null; } catch (eS1) {} }

                var processPath = function (p, lname, layerArrow) {
                    try {
                        if (p.guides || p.clipping) return;
                        var stroked = p.stroked;
                        var dashed = false;
                        if (stroked && (doDashed || (doAll && allCfg.skipDashed))) {
                            var dd = p.strokeDashes;
                            dashed = !!(dd && dd.length > 0);
                        }
                        var doA = doAll && stroked && !(allCfg.skipDashed && dashed);
                        var doD = doDashed && stroked && dashed;
                        var ak = doArrows ? arrowKind(actx, p, lname, layerArrow) : null;
                        if (!doA && !doD && !ak) return;

                        if (doA) stats.allFound++;
                        if (doD) stats.dashedFound++;
                        if (ak) stats.arrowsFound++;
                        if (DRY) return;

                        var sp = openItem(p);
                        try {
                            if (doA) {
                                if (allCfg.applyWeight) p.strokeWidth = allCfg.weight;
                                if (allCfg.applyColor) p.strokeColor = allColor;
                                stats.allUpdated++;
                            }
                            if (doD) {
                                if (dashedCfg.applyWeight) p.strokeWidth = dashedCfg.strokeWeight;
                                if (dashedCfg.applyDashSpace) p.strokeDashes = [dashedCfg.dash, dashedCfg.space];
                                if (dashedCfg.applyColor) p.strokeColor = dashedColor;
                                stats.dashedUpdated++;
                            }
                            if (ak) {
                                applyColorToGraphic(p, arrowColor);
                                stats.arrowsUpdated++;
                            }
                        } finally {
                            closeItem(p, sp);
                        }
                        if (!sp.l && !sp.h && ((doA && allCfg.selectAfter) || (doD && dashedCfg.selectAfter))) p.selected = true;
                    } catch (e) {
                        stats.errors++;
                        if (errorLog.length < 10) errorLog.push("Path: " + e);
                    }
                };

                forEachScope(doc, cfg.scope, "pathItems", function (paths, lname) {
                    var layerArrow = doArrows && arrowLayerMatch(actx, lname);
                    for (var i = 0; i < paths.length; i++) processPath(paths[i], lname, layerArrow);
                });
            }

            if (cfg.groupGraphicsEnabled) {
                report(75, "Grouping matching graphics...");
                ggRes = runGroupGraphics(doc, st, DRY);
                stats.errors += ggRes.errors;
            }

            if (cfg.capLayersEnabled) {
                report(88, "Capitalising layer names...");
                walkLayersPlain(doc.layers, function (Ly) {
                    stats.layersSeen++;
                    var n = String(Ly.name), u = n.toUpperCase();
                    if (n !== u) {
                        stats.layersCapped++;
                        if (!DRY) { try { Ly.name = u; } catch (eL) { stats.errors++; } }
                    }
                }, "", up.layersIncludeSub);
            }

            if (cfg.reportEnabled) {
                report(95, "Building report...");
                try { auditLines = buildAudit(doc, st, ctx, actx, cfg.reportItems); }
                catch (eA) { auditLines = ["", "Detailed report failed: " + eA]; }
            }
        } finally {
            try { if (oldLevel !== null) app.userInteractionLevel = oldLevel; } catch (eUi2) {}
        }

        var secs = Math.round((new Date().getTime() - t0) / 100) / 10;
        var L = [];
        L.push(DRY ? "*** DRY RUN - NOTHING WAS CHANGED ***" : "Finished in " + secs + " s.");
        L.push("Style set: " + setName.toUpperCase() + "  (main " + set.main.size + " pt, secondary " +
               set.secondary.size + " pt, small " + set.small.size + " pt, O_name " + set.oname.size +
               " pt, F_name " + set.fname.size + " pt)");
        L.push("");
        L.push("RUN SUMMARY");
        L.push("Frames scanned:        " + stats.scanned);
        L.push("Option notes skipped:  " + stats.optMatched);
        L.push("Main labels:           " + stats.main);
        L.push("Secondary labels:      " + stats.secondary);
        L.push("Small labels:          " + stats.small);
        L.push("O_name labels:         " + stats.oname);
        L.push("F_name labels:         " + stats.fname);
        L.push("UP / DN:               " + stats.updn);
        L.push("Multi-line labels:     " + stats.wrapped);
        L.push("Text-only replacements: " + stats.textOnly);
        L.push("Junk removed:          " + stats.removed);
        L.push("Empty frames skipped:  " + stats.empty);
        if (capText) L.push("Texts set to CAPITAL:  " + stats.capped + (up.selectTexts ? "   (selected: " + stats.selectedTexts + ")" : ""));
        if (cfg.capLayersEnabled) L.push("Layer names capitalised: " + stats.layersCapped + " of " + stats.layersSeen);
        if (doAll) {
            L.push("All lines found:      " + stats.allFound);
            L.push("All lines updated:    " + stats.allUpdated + "   (weight " + (allCfg.applyWeight ? allCfg.weight + " pt" : "unchanged") +
                   ", colour " + (allCfg.applyColor ? rgbToHex(allCfg.color) : "unchanged") + ")");
        }
        if (doDashed) {
            L.push("Dashed lines found:    " + stats.dashedFound);
            L.push("Dashed lines updated:  " + stats.dashedUpdated);
        }
        if (doArrows) {
            L.push("Arrows found:          " + stats.arrowsFound);
            L.push("Arrows recoloured:     " + stats.arrowsUpdated + "   (" + rgbToHex(set.arrow ? set.arrow.color : [0, 0, 0]) + ")");
        }
        if (ggRes) {
            L.push("Graphic sets total:    " + ggRes.groupsCreated + " groups (" + ggRes.itemsGrouped + " items)");
            for (var ps = 0; ps < ggRes.perSet.length; ps++) {
                var pInfo = ggRes.perSet[ps];
                L.push("  - " + pInfo.name + " (" + pInfo.hex + "): " + pInfo.groupsCreated + " groups, " + pInfo.itemsGrouped + " items");
            }
        }
        L.push("Errors:                " + stats.errors);
        if (ctx.badRegex.length) {
            L.push("");
            L.push("Ignored invalid junk patterns: " + ctx.badRegex.join("  |  "));
        }
        if (cfg.restyle || cfg.wrapLabels) {
            var ulist = [];
            for (var uk in unmatched) if (hasOwn(unmatched, uk)) ulist.push({ t: uk, n: unmatched[uk] });
            ulist.sort(function (x, y) { return y.n - x.n; });
            L.push("");
            L.push("UNRECOGNISED TEXT (" + ulist.length + " unique) - use Rules > Scan Doc to add them:");
            for (var uj = 0; uj < ulist.length; uj++) L.push("  " + ulist[uj].n + " x  " + ulist[uj].t);
        }
        if (errorLog.length) {
            L.push("");
            L.push("ERRORS (first 10):");
            for (var e2 = 0; e2 < errorLog.length; e2++) L.push("  " + errorLog[e2]);
        }
        if (auditLines) L = L.concat(auditLines);

        var fullReportText = L.join(EOL);
        saveReportFile(fullReportText);

        var totalLabeled = stats.main + stats.secondary + stats.small + stats.oname + stats.fname + stats.updn;
        var summaryMsg = (DRY ? "[Dry Run] " : "") +
            "Scanned " + stats.scanned + " texts, labeled " + totalLabeled + ", junk " + stats.removed +
            ", dashed " + stats.dashedUpdated + ", lines " + stats.allUpdated + ", errors " + stats.errors;

        return {
            json: '{"ok":true' +
                ',"message":"' + escapeJson(summaryMsg) + '"' +
                ',"labeled":' + totalLabeled +
                ',"junk":' + stats.removed +
                ',"dashed":' + stats.dashedUpdated +
                ',"lines":' + stats.allUpdated +
                ',"errors":' + stats.errors + '}',
            report: fullReportText,
            summary: summaryMsg
        };
    }

    function applyOnly(cfg, only) {
        var flags = ["restyle", "wrapLabels", "removeJunk", "moveOptNames", "dashedEnabled",
                     "groupGraphicsEnabled", "allLinesEnabled", "arrowsEnabled",
                     "capLayersEnabled", "capTextEnabled"];
        for (var i = 0; i < flags.length; i++) {
            var keep = false;
            for (var j = 0; j < only.length; j++) {
                if (only[j] === flags[i]) { keep = true; break; }
            }
            cfg[flags[i]] = keep;
        }
    }

    function collectLayerMeta(layers, depth, incSub, itemsJson, prefix) {
        for (var li = 0; li < layers.length; li++) {
            var L = layers[li];
            var idx = prefix === "" ? String(li) : prefix + "." + li;
            var itemCnt = 0;
            try { itemCnt = L.pageItems.length; } catch (eCnt) {}
            itemsJson.push(
                '{"name":"' + escapeJson(L.name) +
                '","idx":"' + idx +
                '","depth":' + depth +
                ',"items":' + itemCnt +
                ',"visible":' + (L.visible ? 'true' : 'false') +
                ',"locked":' + (L.locked ? 'true' : 'false') + '}'
            );
            if (incSub && L.layers.length) collectLayerMeta(L.layers, depth + 1, incSub, itemsJson, idx);
        }
    }

    function executeFloorPlanCleaner() {
        var hasUiData = (typeof panelData !== "undefined" && panelData && panelData._fromHtmlUi === true);

        if (hasUiData && panelData.action === "getLastReport") {
            var txt = readReportFile();
            if (!txt) {
                return '{"ok":false,"error":"No saved report found yet. Run the cleaner first."}';
            }
            return '{"ok":true,"message":"Loaded last report","report":"' + escapeJson(txt) + '"}';
        }

        if (app.documents.length === 0) {
            report(100, "No document open.");
            return '{"ok":false,"error":"No document is open."}';
        }

        var doc = app.activeDocument;
        var st = loadState(SETTINGS_FILE);

        if (hasUiData) {
            if (panelData.action === "listLayers") {
                var itemsJson = [];
                collectLayerMeta(doc.layers, 0, Boolean(panelData.includeSub), itemsJson, "");
                report(100, "Layers loaded.");
                return '{"ok":true,"message":"Loaded ' + itemsJson.length + ' layers","layers":[' + itemsJson.join(",") + ']}';
            }

            if (panelData.action === "selectionInfo") {
                var selN = 0;
                try { selN = doc.selection ? doc.selection.length : 0; } catch (eSn) {}
                return '{"ok":true,"selected":' + selN + '}';
            }

            if (panelData.action === "getSettings") {
                return '{"ok":true,"message":"Loaded saved settings","settings":' + toJson(st) + '}';
            }

            if (panelData.layerOp) {
                var opLayer = layerByIdx(doc, panelData.layerOp.idx);
                if (!opLayer) return '{"ok":false,"error":"Layer not found."}';
                if (panelData.layerOp.op === "toggleVisible") opLayer.visible = !opLayer.visible;
                else if (panelData.layerOp.op === "toggleLocked") opLayer.locked = !opLayer.locked;
                return '{"ok":true,"message":"Layer updated"}';
            }

            if (panelData.renameLayer && panelData.renameLayer.newName) {
                var foundLayer = layerByIdx(doc, panelData.renameLayer.idx);
                if (!foundLayer && panelData.renameLayer.oldName) {
                    walkLayersPlain(doc.layers, function (L) {
                        if (!foundLayer && L.name === panelData.renameLayer.oldName) foundLayer = L;
                    }, "", true);
                }
                if (!foundLayer) {
                    return '{"ok":false,"error":"Layer not found."}';
                }
                foundLayer.name = String(panelData.renameLayer.newName);
                report(100, "Layer renamed.");
                return '{"ok":true,"message":"Renamed layer to ' + escapeJson(foundLayer.name) + '"}';
            }

            mergeState(st, panelData);   // FIX: validated merge instead of blind overwrite

            if (panelData.action === "saveSettings") {
                var savedOk = saveState(st, SETTINGS_FILE);
                report(100, savedOk ? "Settings saved." : "Save failed.");
                return savedOk
                    ? '{"ok":true,"message":"Settings saved to UserData"}'
                    : '{"ok":false,"error":"Could not write settings file."}';
            }
        }

        // FIX: refuse to run on "Selection Only" when nothing is selected
        if (st.cfg.scope === "selection" && !hasSelection(doc)) {
            report(100, "Nothing selected.");
            return '{"ok":false,"error":"Scope is \\"Selection Only\\" but nothing is selected."}';
        }

        if (hasUiData) {
            if (panelData.action === "scanUnmatched") {
                report(40, "Scanning document for unrecognised text...");
                var found = scanUnmatched(doc, st);
                var fArr = [];
                for (var fi = 0; fi < found.length; fi++) {
                    fArr.push('{"t":"' + escapeJson(found[fi].t) + '","n":' + found[fi].n + '}');
                }
                report(100, "Scan complete.");
                return '{"ok":true,"message":"Found ' + found.length + ' unrecognised texts","found":[' + fArr.join(",") + ']}';
            }

            if (panelData.action === "groupOnly") {
                saveState(st, SETTINGS_FILE);
                report(40, "Grouping matching graphics...");
                var ggOut = runGroupGraphics(doc, st, false);
                var gRep = [
                    "Group Graphics Finished.",
                    "Group sets configured:  " + ggOut.setsCount,
                    "Matching parts found:   " + ggOut.matchedTotal,
                    "Total groups created:   " + ggOut.groupsCreated,
                    "Total items grouped:    " + ggOut.itemsGrouped,
                    "Unpaired parts skipped: " + ggOut.incompleteSkipped,
                    "Errors:                 " + ggOut.errors
                ];
                for (var ps = 0; ps < ggOut.perSet.length; ps++) {
                    var sInfo = ggOut.perSet[ps];
                    gRep.push("  " + sInfo.name + " (" + sInfo.hex + "): " + sInfo.groupsCreated + " groups (" + sInfo.itemsGrouped + " items)");
                }
                saveReportFile(gRep.join(EOL));
                report(100, "Group Graphics finished.");
                return '{"ok":true,"message":"Created ' + ggOut.groupsCreated + ' groups (' + ggOut.itemsGrouped + ' items)","groups":' + ggOut.groupsCreated + ',"errors":' + ggOut.errors + '}';
            }

            if (panelData.onlyFlags instanceof Array) {
                applyOnly(st.cfg, panelData.onlyFlags);
            }
        }

        saveState(st, SETTINGS_FILE);
        var outcome = runCleaner(doc, st, st.cfg.runSet);
        report(100, "Floor Plan Cleaner finished.");
        // standalone (no panel): show a result dialog so the run is not silent
        if (!hasUiData) {
            try { alert(outcome.summary); } catch (eAl) {}
        }
        return outcome.json;
    }

    try {
        return stampAndStore(executeFloorPlanCleaner());
    } catch (err) {
        report(100, "Error: " + escapeJson(err.message || err));
        return stampAndStore('{"ok":false,"error":"JSX Error (Line ' + (err.line || "?") + '): ' + escapeJson(err.message || err) + '"}');
    }
})();
