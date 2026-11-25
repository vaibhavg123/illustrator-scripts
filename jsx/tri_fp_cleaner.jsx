#target illustrator
/*
 =====================================================================
  FLOOR PLAN LABEL CLEANER v3.0  (Adobe Illustrator ExtendScript)
 =====================================================================
  Everything is editable from the popup - no need to touch the code:

   RUN             scope, a checkbox for EVERY feature, style set,
                   [Run] and [Run Compact]
   RULES           label rules in 5 categories: Main room, Secondary,
                   Small, O_name, F_name (add / edit / delete / scan)
   STYLES          size + colour per category, Dashed line colour,
                   Arrow colour, arrow detection options
   LISTS           Opt_Names patterns, multi-line labels (GREAT/nROOM and
                   "PRIMARY BATH => MASTER/nBATH"), junk text
   DASHED          dashed-line update + "ALL lines" stroke weight/colour
   UNIVERSAL       capitalise all layer names, all texts to CAPITAL
   LAYERS          list every layer, rename directly from the popup
   GROUP GRAPHICS  group nearby matching W x H parts, one colour per set

  SPEED: all work is done layer by layer (only the layer being processed
  is unlocked), decisions are cached per unique text, and unchanged text
  frames are not rewritten.

  REPORT: a detailed report (layers, text, strokes, dashes, fills,
  arrows, colours ...) is generated at the end of every run.

  Settings are auto-saved to:
     <user data folder>/FloorPlanLabelCleaner_settings.txt
 =====================================================================
*/

(function () {

    var APP_TITLE = "Floor Plan Label Cleaner v3.0";
    var SETTINGS_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_settings.txt");
    var EOL = ($.os.indexOf("Windows") !== -1) ? "\r\n" : "\n";
    var CATS = ["main", "secondary", "small", "oname", "fname"];
    var CAT_LABEL = { main: "Main room", secondary: "Secondary", small: "Small", oname: "O_name", fname: "F_name" };
    var EXTRAS = ["dashed", "arrow"];
    var EXTRA_LABEL = { dashed: "Dashed line", arrow: "Arrows" };
    var UNITS = ["in", "mm", "cm", "pt", "px"];
    var ARROW_GLYPH_RE = /^[\s\u2190-\u21FF\u2B05-\u2B07\u27A1\u2794\u279C-\u27BE\u25B2\u25B3\u25B4\u25B6\u25B7\u25B8\u25BA\u25BC\u25BD\u25BE\u25C0\u25C1\u25C2\u25C4]+$/;

    var hasOwn = function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); };

    // =================================================================
    // TEXT, UNIT & COLOUR HELPERS
    // =================================================================
    function trim(s) { return String(s === null || s === undefined ? "" : s).replace(/^\s+|\s+$/g, ""); }

    // Normalises text for matching. A literal "/n" or "\n" typed in the drawing
    // text (e.g. "GREAT/nROOM") and real line breaks are all treated as a space.
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

    // Converts /n or \n (with or without spaces around) into Illustrator's \r line break
    function toIllustratorLines(s) {
        var out = String(s === null || s === undefined ? "" : s);
        out = out.replace(/\s*\/n\s*/gi, "\r");
        out = out.replace(/\s*\\n\s*/g, "\r");
        out = out.replace(/\r\n|\r|\n/g, "\r");
        return out;
    }

    // Builds a { key, value } entry from a multi-line list item. Supported formats:
    //   GREAT/nROOM  or  GREAT /n ROOM      -> label is stored with a line break
    //   GREAT ROOM                           -> two-word label split at the first space
    //   PRIMARY BATH => MASTER/nBATH         -> text found (single OR multi-line) becomes new text
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

    function splitLines(s) {
        var parts = String(s).split(/\r\n|\r|\n/), out = [];
        for (var i = 0; i < parts.length; i++) {
            var t = trim(parts[i]);
            if (t !== "") out.push(t);
        }
        return out;
    }

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

    function parseHexRGB(hexStr) {
        var h = trim(hexStr).replace(/^#+/, "");
        if (/^[0-9a-fA-F]{3}$/.test(h)) {
            return [
                parseInt(h.charAt(0) + h.charAt(0), 16),
                parseInt(h.charAt(1) + h.charAt(1), 16),
                parseInt(h.charAt(2) + h.charAt(2), 16)
            ];
        }
        if (/^[0-9a-fA-F]{6}$/.test(h)) {
            return [
                parseInt(h.substring(0, 2), 16),
                parseInt(h.substring(2, 4), 16),
                parseInt(h.substring(4, 6), 16)
            ];
        }
        return null;
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

    // Readable colour description for the report
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

    // temporarily unlock / unhide a single item, returns state for closeItem
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

    // =================================================================
    // DEFAULT SETTINGS
    // =================================================================
    function defaultState() {
        var rules = [];
        function R(cat, text, keys, exact) {
            rules.push({ cat: cat, text: text, keys: keys, exact: !!exact });
        }
        var n;

        // ---- main ----
        for (n = 1; n <= 5; n++) {
            R("main", "BEDROOM " + n, ["bed " + n, "bed" + n, "bdrm " + n, "bdrm" + n, "bedroom " + n]);
        }
        for (n = 1; n <= 4; n++) {
            R("main", "BATH " + n, ["ba " + n, "ba" + n, "bath " + n, "bath" + n]);
        }
        R("main", "OWNER'S SUITE",   ["owner's suite", "owners suite"]);
        R("main", "OWNER'S BEDROOM", ["owner's bedroom", "owners bedroom"]);
        R("main", "OWNER'S BATH",    ["owner's bath", "o. ba", "o. bath", "o.ba", "o.bath"]);
        R("main", "UPSTAIRS LIVING", ["upstairs living"]);
        R("main", "FAMILY",          ["family"]);
        R("main", "GAME ROOM",       ["game room"]);
        R("main", "STUDY",           ["study"]);
        R("main", "FLEX",            ["flex"]);
        R("main", "LIVING",          ["living"]);
        R("main", "CASUAL",          ["casual"]);
        R("main", "CASUAL DINING",   ["casual dining"]);
        R("main", "OFFICE",          ["office"]);
        R("main", "COVERED PORCH",   ["covered porch"]);
        R("main", "COVERED PATIO",   ["covered patio"]);
        R("main", "PATIO",           ["patio"]);
        R("main", "DECK",            ["deck"]);
        R("main", "DINING",          ["dining"]);
        R("main", "BREAKFAST",       ["breakfast"]);
        R("main", "LOFT",            ["loft"]);
        R("main", "KITCHEN",         ["kitchen"]);
        R("main", "GREAT ROOM",      ["great rm", "great room"]);
        R("main", "GARAGE",          ["garage"]);

        // ---- secondary ----
        R("secondary", "LAUNDRY",        ["la"], true);
        R("secondary", "LAUNDRY",        ["laundry"]);
        R("secondary", "MECH",           ["mech"]);
        R("secondary", "WALK-IN CLOSET", ["wic", "w.i.c.", "walk-in closet", "walk in closet"]);
        R("secondary", "FOYER",          ["foyer"]);
        R("secondary", "PORCH",          ["porch"]);

        // ---- small ----
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

        // ---- oname / fname : empty by default, add your own in the Rules tab ----

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
                dash: 3,
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
                textMode: "upper",       // "upper" = change characters, "allcaps" = All Caps formatting
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
                    {
                        name: "Group 1",
                        color: [84, 84, 84],
                        items: [
                            { w: 10, h: 5 },
                            { w: 1, h: 5 }
                        ]
                    },
                    {
                        name: "Group 2",
                        color: [221, 221, 221],
                        items: [
                            { w: 11, h: 4 },
                            { w: 6, h: 3 }
                        ]
                    }
                ]
            },
            styleSets: {
                standard: {
                    main:      { size: 9, color: [0, 100, 255] },
                    secondary: { size: 8, color: [255, 0, 0] },
                    small:     { size: 6, color: [0, 170, 0] },
                    oname:     { size: 6, color: [170, 0, 255] },
                    fname:     { size: 6, color: [255, 128, 0] },
                    dashed:    { color: [0, 0, 0] },
                    arrow:     { color: [0, 0, 0] }
                },
                compact: {
                    main:      { size: 8, color: [0, 100, 255] },
                    secondary: { size: 6, color: [255, 0, 0] },
                    small:     { size: 6, color: [0, 170, 0] },
                    oname:     { size: 6, color: [170, 0, 255] },
                    fname:     { size: 6, color: [255, 128, 0] },
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

    // =================================================================
    // SETTINGS LOAD / SAVE
    // =================================================================
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

    function mergeState(st, saved) {
        var k, s, c;
        if (saved.cfg) {
            for (k in st.cfg) {
                if (hasOwn(st.cfg, k) && hasOwn(saved.cfg, k)) st.cfg[k] = saved.cfg[k];
            }
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
            } else if (gg.items instanceof Array) {
                st.groupGraphics.sets = [{ name: "Group 1", color: [84, 84, 84], items: sanitizeItems(gg.items) }];
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
            st.rules = good;
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

    // =================================================================
    // COMPILED MATCHING CONTEXT
    // =================================================================
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
            if (spec) {
                ctx.wrap[spec.key] = spec.value;
            }
        }
        // make mappings idempotent: the converted text maps to itself on a second run
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

    // Returns null or a text describing why the path is considered an arrow.
    // NOTE: native stroke arrowheads (Stroke panel) are not readable by scripts, but they
    // always take the stroke colour of their path, so arrow LINES found by name/layer are recoloured.
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

    // Decides (once per unique normalised text) what to do with a text frame.
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
            // explicit multi-line / mapping entry wins (works for single-line AND multi-line source text)
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

    // =================================================================
    // LAYER-BY-LAYER WALKING  (speed: only the current layer is unlocked)
    // =================================================================
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

    // fn(itemsArray, layerPath). kind = "textFrames" | "pathItems".
    function forEachScope(doc, scope, kind, fn, noUnlock) {
        if (scope === "selection" && doc.selection && doc.selection.length) {
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

    // =================================================================
    // (used by Group Graphics) whole-document layer helpers
    // =================================================================
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

    // =================================================================
    // GRAPHIC SEARCH & MULTI-SET NEARBY GROUPING BY WIDTH x HEIGHT
    // =================================================================
    function getItemBounds(item, useVisible) {
        try {
            var b = useVisible ? item.visibleBounds : item.geometricBounds;
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
        } catch (e) {
            return null;
        }
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
        if (scope === "selection" && doc.selection && doc.selection.length) {
            for (i = 0; i < doc.selection.length; i++) {
                collectGraphicNode(doc.selection[i], out);
            }
        } else {
            for (i = 0; i < doc.layers.length; i++) {
                collectGraphicFromLayer(doc.layers[i], out);
            }
        }
    }

    function collectGraphicFromLayer(layer, out) {
        var i;
        for (i = 0; i < layer.pageItems.length; i++) {
            collectGraphicNode(layer.pageItems[i], out);
        }
        for (i = 0; i < layer.layers.length; i++) {
            collectGraphicFromLayer(layer.layers[i], out);
        }
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
            for (var i = 0; i < item.pageItems.length; i++) {
                collectGraphicNode(item.pageItems[i], out);
            }
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
            matchedTotal: 0,
            groupsCreated: 0,
            itemsGrouped: 0,
            incompleteSkipped: 0,
            errors: 0,
            perSet: [],
            details: []
        };

        if (!gg.sets || gg.sets.length === 0) return res;

        var unit = gg.unit || "in";
        var tolPt = toPoints(gg.tolerance, unit);
        var maxGapPt = toPoints(gg.maxGap, unit);

        var savedLayers = unlockAllLayers(doc);
        var candidates = [];
        collectGraphicCandidates(doc, st.cfg.scope, candidates);

        // duplicates are only possible when the selection holds an item AND its parent group
        var needDedupe = (st.cfg.scope === "selection" && doc.selection && doc.selection.length > 0);
        var pool = [];
        var seenHandles = [];
        for (var i = 0; i < candidates.length; i++) {
            var item = candidates[i];
            try {
                if (item.guides || item.clipping) continue;
            } catch (eG) {}
            if (needDedupe) {
                if (isInArray(seenHandles, item)) continue;
                seenHandles.push(item);
            }
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
                matched: 0,
                groupsCreated: 0,
                itemsGrouped: 0,
                incompleteSkipped: 0
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
                        poolEntry: entry,
                        item: entry.item,
                        bounds: entry.bounds,
                        slots: matchedSlots,
                        used: false
                    });
                }
            }

            // Exclude parent GroupItems if any of their children already matched in this set
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
                            if (gg.applyColor) {
                                applyColorToGraphic(itObj, setRGB);
                            }
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

        restoreLayers(savedLayers);
        return res;
    }

    // Texts in the drawing that no rule / list recognises
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

    // =================================================================
    // DETAILED DOCUMENT AUDIT (end-of-run report)
    // =================================================================
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

        // ---- text ----
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

        // ---- paths ----
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
        L.push("");
        L.push("Note: arrowheads set in the Stroke panel are not exposed to scripts. They always use the");
        L.push("stroke colour of their line, so lines found by name/layer keyword are recoloured too.");

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

    // =================================================================
    // THE CLEANER (layer by layer)
    // =================================================================
    function runCleaner(doc, st, setName) {
        var t0 = new Date().getTime();
        var cfg = st.cfg;
        var DRY = cfg.dryRun;
        var ctx = compile(st);
        var actx = compileArrows(st);
        var set = st.styleSets[setName];
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

        var stats = { scanned: 0, optMatched: 0, main: 0, secondary: 0, small: 0, oname: 0, fname: 0,
                      updn: 0, wrapped: 0, textOnly: 0, removed: 0, empty: 0, errors: 0,
                      capped: 0, selectedTexts: 0, layersSeen: 0, layersCapped: 0,
                      allFound: 0, allUpdated: 0, dashedFound: 0, dashedUpdated: 0,
                      arrowsFound: 0, arrowsUpdated: 0 };
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
            // ------------------------------------------------------------
            // 1. TEXT  (layer by layer, decisions cached per unique text)
            // ------------------------------------------------------------
            var textNeeded = cfg.restyle || cfg.wrapLabels || cfg.removeJunk || cfg.moveOptNames ||
                             capText || (doArrows && actx.glyph);

            var processFrame = function (tf) {
                try {
                    stats.scanned++;
                    var raw = tf.contents;
                    var t = norm(raw);
                    if (t === "") { stats.empty++; return; }

                    // arrow glyph text (e.g. an arrow character)
                    if (doArrows && actx.glyph && actx.glyphRe.test(raw)) {
                        stats.arrowsFound++;
                        if (!DRY) {
                            var sa = openItem(tf);
                            try { tf.textRange.characterAttributes.fillColor = arrowColor; stats.arrowsUpdated++; }
                            finally { closeItem(tf, sa); }
                        }
                        return;
                    }

                    var d = cache[t];
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

            // ------------------------------------------------------------
            // 2. PATHS: all lines, dashed lines, arrows  (one pass per layer)
            // ------------------------------------------------------------
            if (doAll || doDashed || doArrows) {
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

            // ------------------------------------------------------------
            // 3. GROUP GRAPHICS
            // ------------------------------------------------------------
            if (cfg.groupGraphicsEnabled) {
                ggRes = runGroupGraphics(doc, st, DRY);
                stats.errors += ggRes.errors;
            }

            // ------------------------------------------------------------
            // 4. CAPITALISE LAYER NAMES
            // ------------------------------------------------------------
            if (cfg.capLayersEnabled) {
                walkLayersPlain(doc.layers, function (Ly) {
                    stats.layersSeen++;
                    var n = String(Ly.name), u = n.toUpperCase();
                    if (n !== u) {
                        stats.layersCapped++;
                        if (!DRY) { try { Ly.name = u; } catch (eL) { stats.errors++; } }
                    }
                }, "", up.layersIncludeSub);
            }

            // ------------------------------------------------------------
            // 5. DETAILED AUDIT
            // ------------------------------------------------------------
            if (cfg.reportEnabled) {
                try { auditLines = buildAudit(doc, st, ctx, actx, cfg.reportItems); }
                catch (eA) { auditLines = ["", "Detailed report failed: " + eA]; }
            }
        } finally {
            try { if (oldLevel !== null) app.userInteractionLevel = oldLevel; } catch (eUi2) {}
        }

        // ---------------- run summary ----------------
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
        L.push("Text-only replacements:" + " " + stats.textOnly);
        L.push("Junk removed:          " + stats.removed);
        L.push("Empty frames skipped:  " + stats.empty);
        if (capText) {
            L.push("Texts set to CAPITAL:  " + stats.capped + (up.selectTexts ? "   (selected: " + stats.selectedTexts + ")" : ""));
        }
        if (cfg.capLayersEnabled) {
            L.push("Layer names capitalised: " + stats.layersCapped + " of " + stats.layersSeen);
        }
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
            var list = [];
            for (var k in unmatched) if (hasOwn(unmatched, k)) list.push({ t: k, n: unmatched[k] });
            list.sort(function (a, b) { return b.n - a.n; });
            L.push("");
            L.push("UNRECOGNISED TEXT (" + list.length + " unique) - use Rules > Scan document to add them:");
            for (var j = 0; j < list.length; j++) L.push("  " + list[j].n + " x  " + list[j].t);
        }

        if (errorLog.length) {
            L.push("");
            L.push("ERRORS (first 10):");
            for (var e2 = 0; e2 < errorLog.length; e2++) L.push("  " + errorLog[e2]);
        }
        if (auditLines) L = L.concat(auditLines);
        return L.join("\n");
    }

    // keep only the listed feature flags switched on (used by the "apply now" buttons)
    function applyOnly(cfg, only) {
        var flags = ["restyle", "wrapLabels", "removeJunk", "moveOptNames", "dashedEnabled",
                     "groupGraphicsEnabled", "allLinesEnabled", "arrowsEnabled",
                     "capLayersEnabled", "capTextEnabled"];
        var i, j, keep;
        for (i = 0; i < flags.length; i++) {
            keep = false;
            for (j = 0; j < only.length; j++) if (only[j] === flags[i]) keep = true;
            cfg[flags[i]] = keep;
        }
    }

    // =================================================================
    // UI : REPORT
    // =================================================================
    function showReport(text) {
        var w = new Window("dialog", APP_TITLE + " - Report");
        w.orientation = "column";
        w.alignChildren = "fill";
        var box = w.add("edittext", undefined, text, { multiline: true, readonly: true, scrolling: true });
        box.preferredSize = [720, 460];
        var g = w.add("group");
        g.alignment = "right";
        var bSave = g.add("button", undefined, "Save report...");
        g.add("button", undefined, "Close", { name: "ok" });
        bSave.onClick = function () {
            var f = File.saveDialog("Save report", "Text:*.txt");
            if (f) { f.encoding = "UTF-8"; f.open("w"); f.write(text); f.close(); }
        };
        w.show();
    }

    // =================================================================
    // UI : ADD / EDIT RULE
    // =================================================================
    function catIndex(cat) {
        for (var i = 0; i < CATS.length; i++) if (CATS[i] === cat) return i;
        return 0;
    }

    function catLabels() {
        var out = [];
        for (var i = 0; i < CATS.length; i++) out.push(CAT_LABEL[CATS[i]]);
        return out;
    }

    function ruleDialog(rule) {
        var d = new Window("dialog", rule ? "Edit rule" : "Add rule");
        d.orientation = "column";
        d.alignChildren = "left";

        var g1 = d.add("group");
        g1.add("statictext", undefined, "Category:");
        var dd = g1.add("dropdownlist", undefined, catLabels());
        dd.selection = rule ? catIndex(rule.cat) : 0;

        var g2 = d.add("group");
        g2.add("statictext", undefined, "Final text:");
        var eText = g2.add("edittext", undefined, rule ? rule.text : "");
        eText.characters = 34;

        d.add("statictext", undefined, "Tip: use /n or \\n in Final text for line breaks (e.g. GREAT/nROOM or MASTER/nBATH).");
        d.add("statictext", undefined, "Text found in the drawing that becomes the final text (comma separated).");
        d.add("statictext", undefined, "Single-line or multi-line source text both match. Leave empty to use the final text itself:");
        var eKeys = d.add("edittext", undefined, rule ? rule.keys.join(", ") : "");
        eKeys.characters = 52;

        var cExact = d.add("checkbox", undefined, "Exact match only (the WHOLE text must equal an input text)");
        cExact.value = rule ? !!rule.exact : false;

        var g3 = d.add("group");
        g3.alignment = "right";
        var bCancel = g3.add("button", undefined, "Cancel");
        var bOk = g3.add("button", undefined, "OK");

        var out = null;
        bCancel.onClick = function () { d.close(0); };
        bOk.onClick = function () {
            var text = trim(eText.text).toUpperCase();
            if (text === "") { alert("Final text cannot be empty."); return; }
            var keys = [], parts = eKeys.text.split(","), i;
            for (i = 0; i < parts.length; i++) {
                var k = trim(parts[i]);
                if (k !== "") keys.push(k);
            }
            out = { cat: CATS[dd.selection.index], text: text, keys: keys, exact: cExact.value };
            d.close(1);
        };

        d.show();
        return out;
    }

    // =================================================================
    // UI : SCAN RESULTS (add unrecognised text as rules)
    // =================================================================
    function scanDialog(found) {
        var d = new Window("dialog", "Unrecognised text in drawing");
        d.orientation = "column";
        d.alignChildren = "fill";
        d.add("statictext", undefined, "Select the texts to add as rules (Ctrl/Shift-click for several):");

        var lb = d.add("listbox", undefined, [], { multiselect: true, numberOfColumns: 2, showHeaders: true,
                                                    columnTitles: ["Count", "Text"], columnWidths: [60, 380] });
        lb.preferredSize = [480, 260];
        for (var i = 0; i < found.length; i++) {
            var it = lb.add("item", String(found[i].n));
            it.subItems[0].text = found[i].t;
            it.value = found[i].t;
        }

        var g = d.add("group");
        g.add("statictext", undefined, "Add as:");
        var dd = g.add("dropdownlist", undefined, catLabels());
        dd.selection = 0;
        var cExact = g.add("checkbox", undefined, "Exact match only");

        var g3 = d.add("group");
        g3.alignment = "right";
        var bAll = g3.add("button", undefined, "Select all");
        var bCancel = g3.add("button", undefined, "Cancel");
        var bOk = g3.add("button", undefined, "Add selected");

        bAll.onClick = function () {
            var all = [];
            for (var j = 0; j < lb.items.length; j++) all.push(lb.items[j]);
            lb.selection = all;
        };
        var added = [];
        bCancel.onClick = function () { d.close(0); };
        bOk.onClick = function () {
            var sel = lb.selection;
            if (!sel) { alert("Nothing selected."); return; }
            if (!(sel instanceof Array)) sel = [sel];
            for (var j = 0; j < sel.length; j++) {
                added.push({ cat: CATS[dd.selection.index], text: sel[j].value,
                             keys: [sel[j].value], exact: cExact.value });
            }
            d.close(1);
        };

        if (found.length === 0) { alert("Every text frame is already covered by a rule, list or junk pattern."); return []; }
        d.show();
        return added;
    }

    // =================================================================
    // UI : MAIN DIALOG
    // =================================================================
    function setSwatch(sw, r, g, b) {
        try {
            sw.graphics.backgroundColor = sw.graphics.newBrush(sw.graphics.BrushType.SOLID_COLOR,
                [r / 255, g / 255, b / 255, 1]);
        } catch (e) {}
    }

    function unitIndex(u) {
        for (var i = 0; i < UNITS.length; i++) if (UNITS[i] === u) return i;
        return 0;
    }

    function mirror(a, b) {
        a.onClick = function () { b.value = a.value; };
        b.onClick = function () { a.value = b.value; };
    }

    function buildUI(st, doc) {
        var hasSel = false;
        try { hasSel = !!(doc.selection && doc.selection.length > 0); } catch (eSel) {}
        var result = { action: null, only: null };
        var editSet = "standard";
        var activeGGSetIdx = 0;

        if (!st.groupGraphics.sets || st.groupGraphics.sets.length === 0) {
            st.groupGraphics.sets = [{ name: "Group 1", color: [84, 84, 84], items: [] }];
        }

        var w = new Window("dialog", APP_TITLE);
        w.orientation = "column";
        w.alignChildren = "fill";

        var tp = w.add("tabbedpanel");
        tp.alignChildren = "fill";
        tp.preferredSize = [780, 520];

        var tabRun      = tp.add("tab", undefined, "Run");
        var tabRules    = tp.add("tab", undefined, "Rules");
        var tabStyles   = tp.add("tab", undefined, "Styles");
        var tabLists    = tp.add("tab", undefined, "Lists");
        var tabDashed   = tp.add("tab", undefined, "Dashed");
        var tabUniv     = tp.add("tab", undefined, "Universal");
        var tabLayers   = tp.add("tab", undefined, "Layers");
        var tabGroupGfx = tp.add("tab", undefined, "Group Graphics");
        var tabs = [tabRun, tabRules, tabStyles, tabLists, tabDashed, tabUniv, tabLayers, tabGroupGfx];
        for (var ti = 0; ti < tabs.length; ti++) { tabs[ti].orientation = "column"; tabs[ti].alignChildren = "fill"; }

        // ------------------------- RUN TAB -------------------------
        var pScope = tabRun.add("panel", undefined, "Scope");
        pScope.alignChildren = "left";
        var rDoc = pScope.add("radiobutton", undefined, "Entire document");
        var rSel = pScope.add("radiobutton", undefined, "Selection only");
        rSel.enabled = hasSel;

        var pFeat = tabRun.add("panel", undefined, "Features - tick what should run");
        pFeat.orientation = "row";
        pFeat.alignChildren = ["left", "top"];

        var colL = pFeat.add("group");
        colL.orientation = "column";
        colL.alignChildren = "left";
        var colR = pFeat.add("group");
        colR.orientation = "column";
        colR.alignChildren = "left";

        colL.add("statictext", undefined, "TEXT LABELS");
        var cStyle  = colL.add("checkbox", undefined, "Rename / restyle labels (all 5 categories)");
        var cUpDn   = colL.add("checkbox", undefined, "Convert UP / DN labels");
        var cWrap   = colL.add("checkbox", undefined, "Multi-line labels / mappings (Lists tab)");
        var cJunk   = colL.add("checkbox", undefined, "Delete junk text");
        var cLoose  = colL.add("checkbox", undefined, "Loose matching (\"KITCHEN ISLAND\" -> \"KITCHEN\")");
        var cOpt    = colL.add("checkbox", undefined, "Skip option note matches (kept in place)");
        colL.add("statictext", undefined, "ARROWS");
        var cArrowsOn = colL.add("checkbox", undefined, "Recolour all arrows (Styles tab)");

        colR.add("statictext", undefined, "LINES & GRAPHICS");
        var cAllLines = colR.add("checkbox", undefined, "Update ALL lines: weight + colour (Dashed tab)");
        var cDashed   = colR.add("checkbox", undefined, "Update dashed lines (Dashed tab)");
        var cGroupGfx = colR.add("checkbox", undefined, "Group matching graphics by W x H (all sets)");
        colR.add("statictext", undefined, "UNIVERSAL");
        var cCapLayers = colR.add("checkbox", undefined, "Capitalise all layer names");
        var cCapText   = colR.add("checkbox", undefined, "Set ALL texts to CAPITAL");
        colR.add("statictext", undefined, "REPORT");
        var cReport      = colR.add("checkbox", undefined, "Detailed report at the end");
        var cReportItems = colR.add("checkbox", undefined, "   include item-by-item listing (slower)");

        var pSet = tabRun.add("panel", undefined, "Style set used by [Run]");
        pSet.alignChildren = "left";
        var ddRunSet = pSet.add("dropdownlist", undefined, ["Standard", "Compact"]);
        var sSummary = pSet.add("statictext", undefined, "");
        sSummary.preferredSize = [680, 20];

        var cDry = tabRun.add("checkbox", undefined, "Dry run (report only, change nothing)");
        var sTip = tabRun.add("statictext", undefined,
            "[Run Compact] always applies the Compact set. Work is done layer by layer; locked / hidden layers are restored afterwards.",
            { multiline: true });
        sTip.preferredSize = [700, 34];

        // ------------------------- RULES TAB -------------------------
        var gFilter = tabRules.add("group");
        gFilter.add("statictext", undefined, "Filter:");
        var eFilter = gFilter.add("edittext", undefined, "");
        eFilter.characters = 30;
        var sCount = gFilter.add("statictext", undefined, "");
        sCount.preferredSize = [160, 20];

        var list = tabRules.add("listbox", undefined, [], {
            multiselect: true, numberOfColumns: 4, showHeaders: true,
            columnTitles: ["Category", "Final text", "Input text", "Exact"],
            columnWidths: [85, 170, 330, 50]
        });
        list.preferredSize = [690, 330];

        var gRB = tabRules.add("group");
        var bAdd    = gRB.add("button", undefined, "Add...");
        var bEdit   = gRB.add("button", undefined, "Edit...");
        var bDel    = gRB.add("button", undefined, "Delete");
        var bScan   = gRB.add("button", undefined, "Scan document...");
        var bReset  = gRB.add("button", undefined, "Reset to defaults");

        // ------------------------- STYLES TAB -------------------------
        var gEdit = tabStyles.add("group");
        gEdit.add("statictext", undefined, "Edit style set:");
        var ddEdit = gEdit.add("dropdownlist", undefined, ["Standard", "Compact"]);
        ddEdit.selection = 0;

        var rows = {};
        function syncHexFromRGB(cat) {
            var x = rows[cat];
            if (!x || !x.hex) return;
            var rgb = [clamp255(x.r.text), clamp255(x.g.text), clamp255(x.b.text)];
            x.hex.text = rgbToHex(rgb);
        }

        function refreshSwatch(cat) {
            var x = rows[cat];
            setSwatch(x.sw, clamp255(x.r.text), clamp255(x.g.text), clamp255(x.b.text));
        }

        function addStyleRow(cat, labelText, hasSize) {
            var g = tabStyles.add("group");
            g.orientation = "row";
            var lab = g.add("statictext", undefined, labelText);
            lab.preferredSize = [85, 20];

            var size = null;
            if (hasSize) {
                g.add("statictext", undefined, "Size (pt)");
                size = g.add("edittext", undefined, "");
                size.characters = 4;
            } else {
                var spacer = g.add("statictext", undefined, "");
                spacer.preferredSize = [88, 20];
            }

            g.add("statictext", undefined, "RGB");
            var r = g.add("edittext", undefined, ""); r.characters = 3;
            var gg = g.add("edittext", undefined, ""); gg.characters = 3;
            var b = g.add("edittext", undefined, ""); b.characters = 3;
            g.add("statictext", undefined, "Hex");
            var hex = g.add("edittext", undefined, ""); hex.characters = 7;
            var sw = g.add("group");
            sw.preferredSize = [28, 20];
            var pick = g.add("button", undefined, "Pick...");
            rows[cat] = { size: size, r: r, g: gg, b: b, hex: hex, sw: sw, hasSize: !!hasSize };

            pick.onClick = function () {
                try {
                    var cur = (clamp255(r.text) << 16) | (clamp255(gg.text) << 8) | clamp255(b.text);
                    var v = $.colorPicker(cur);
                    if (v !== -1) {
                        r.text = String((v >> 16) & 255);
                        gg.text = String((v >> 8) & 255);
                        b.text = String(v & 255);
                        syncHexFromRGB(cat);
                        refreshSwatch(cat);
                        readStyleControls(editSet, true);
                    }
                } catch (e) {}
            };
            var rgbChanged = function () {
                syncHexFromRGB(cat);
                refreshSwatch(cat);
                readStyleControls(editSet, true);
            };
            var hexChanged = function () {
                var parsed = parseHexRGB(hex.text);
                if (parsed) {
                    r.text = String(parsed[0]);
                    gg.text = String(parsed[1]);
                    b.text = String(parsed[2]);
                    refreshSwatch(cat);
                    readStyleControls(editSet, true);
                }
            };
            if (size) {
                var sizeChanged = function () { readStyleControls(editSet, true); };
                size.onChanging = sizeChanged; size.onChange = sizeChanged;
            }
            r.onChanging = rgbChanged;    r.onChange = rgbChanged;
            gg.onChanging = rgbChanged;   gg.onChange = rgbChanged;
            b.onChanging = rgbChanged;    b.onChange = rgbChanged;
            hex.onChanging = hexChanged;
            hex.onChange = function () {
                var parsed = parseHexRGB(hex.text);
                if (parsed) {
                    r.text = String(parsed[0]);
                    gg.text = String(parsed[1]);
                    b.text = String(parsed[2]);
                    hex.text = rgbToHex(parsed);
                    refreshSwatch(cat);
                    readStyleControls(editSet, true);
                } else {
                    syncHexFromRGB(cat);
                    refreshSwatch(cat);
                }
            };
        }
        var ci;
        for (ci = 0; ci < CATS.length; ci++) addStyleRow(CATS[ci], CAT_LABEL[CATS[ci]], true);
        for (ci = 0; ci < EXTRAS.length; ci++) addStyleRow(EXTRAS[ci], EXTRA_LABEL[EXTRAS[ci]], false);

        var pArrow = tabStyles.add("panel", undefined, "Arrow detection (colour = Arrows row above)");
        pArrow.alignChildren = "left";
        var cArrowsOnS = pArrow.add("checkbox", undefined, "Recolour arrows when running");
        var gTri = pArrow.add("group");
        var cArrowTri = gTri.add("checkbox", undefined, "Triangle arrowheads (closed, filled, 3 points), max size");
        var eArrowTri = gTri.add("edittext", undefined, "24");
        eArrowTri.characters = 5;
        gTri.add("statictext", undefined, "pt");
        var cArrowGlyph = pArrow.add("checkbox", undefined, "Text arrow glyphs (arrow characters, triangles, etc.)");
        var gKw = pArrow.add("group");
        gKw.add("statictext", undefined, "Item / group / layer name contains (comma separated):");
        var eArrowKw = gKw.add("edittext", undefined, "arrow");
        eArrowKw.characters = 22;
        var gArrBtn = pArrow.add("group");
        var bArrowNow = gArrBtn.add("button", undefined, "Apply arrow colour now");
        var sArrowTip = pArrow.add("statictext", undefined,
            "Stroke-panel arrowheads follow their line's stroke colour, so name arrow lines (or their layer) with the keyword.",
            { multiline: true });
        sArrowTip.preferredSize = [680, 32];

        function loadStyleControls(setName) {
            var i, x;
            for (i = 0; i < CATS.length; i++) {
                var s = st.styleSets[setName][CATS[i]];
                x = rows[CATS[i]];
                x.size.text = String(s.size);
                x.r.text = String(s.color[0]);
                x.g.text = String(s.color[1]);
                x.b.text = String(s.color[2]);
                x.hex.text = rgbToHex(s.color);
                refreshSwatch(CATS[i]);
            }
            for (i = 0; i < EXTRAS.length; i++) {
                var ds = st.styleSets[setName][EXTRAS[i]] || { color: [0, 0, 0] };
                x = rows[EXTRAS[i]];
                x.r.text = String(ds.color[0]);
                x.g.text = String(ds.color[1]);
                x.b.text = String(ds.color[2]);
                x.hex.text = rgbToHex(ds.color);
                refreshSwatch(EXTRAS[i]);
            }
        }

        function rowColor(x) {
            var parsed = parseHexRGB(x.hex.text);
            return parsed ? parsed : [clamp255(x.r.text), clamp255(x.g.text), clamp255(x.b.text)];
        }

        function readStyleControls(setName, silent) {
            var i;
            for (i = 0; i < CATS.length; i++) {
                var x = rows[CATS[i]], s = st.styleSets[setName][CATS[i]];
                var rawSize = trim(x.size.text);
                var size = parseFloat(rawSize);
                if (rawSize === "" || isNaN(size) || size <= 0) {
                    if (!silent) { alert("Invalid size for " + CAT_LABEL[CATS[i]] + " (" + setName + ")."); return false; }
                } else {
                    s.size = size;
                }
                s.color = rowColor(x);
            }
            for (i = 0; i < EXTRAS.length; i++) {
                if (!st.styleSets[setName][EXTRAS[i]]) st.styleSets[setName][EXTRAS[i]] = { color: [0, 0, 0] };
                st.styleSets[setName][EXTRAS[i]].color = rowColor(rows[EXTRAS[i]]);
            }
            updateSummary();
            return true;
        }

        // ------------------------- LISTS TAB -------------------------
        function addListBox(label, height) {
            tabLists.add("statictext", undefined, label);
            var e = tabLists.add("edittext", undefined, "", { multiline: true, scrolling: true });
            e.preferredSize = [690, height];
            return e;
        }
        var eOpt   = addListBox("Option notes: any text CONTAINING one of these is matched as an option note (one per line)", 60);
        var eWrap  = addListBox("Multi-line labels (one per line):  GREAT/nROOM   |   GREAT ROOM   |   PRIMARY BATH => MASTER/nBATH  (the part before => may be single OR multi-line text in the drawing)", 100);
        var eJunkX = addListBox("Junk text to delete: exact text (one per line)", 50);
        var eJunkR = addListBox("Junk text to delete: regular expressions, case-insensitive (one per line)", 60);

        // ------------------------- DASHED TAB -------------------------
        var pDashed = tabDashed.add("panel", undefined, "Dashed line settings");
        pDashed.alignChildren = "left";
        var cDashedTabEnable = pDashed.add("checkbox", undefined, "Enable dashed line processing (also tick it on the Run tab)");
        var cApplyWeight     = pDashed.add("checkbox", undefined, "Set stroke weight on all dashed lines");
        var cApplyDashSpace  = pDashed.add("checkbox", undefined, "Set dash and space on all dashed lines");
        var cApplyDashColor  = pDashed.add("checkbox", undefined, "Apply Dashed line stroke colour from Styles tab");
        var cDashSelect      = pDashed.add("checkbox", undefined, "Leave updated dashed lines selected");

        var gDashVal = pDashed.add("group");
        gDashVal.orientation = "row";
        gDashVal.add("statictext", undefined, "Stroke weight (pt):");
        var eStrokeWeight = gDashVal.add("edittext", undefined, "0.5");
        eStrokeWeight.characters = 6;
        gDashVal.add("statictext", undefined, "Dash (pt):");
        var eDashLen = gDashVal.add("edittext", undefined, "3");
        eDashLen.characters = 6;
        gDashVal.add("statictext", undefined, "Space (pt):");
        var eDashSpace = gDashVal.add("edittext", undefined, "2");
        eDashSpace.characters = 6;

        var pAllLines = tabDashed.add("panel", undefined, "ALL lines (every stroked path, dashed or solid)");
        pAllLines.alignChildren = "left";
        var cAllLinesD   = pAllLines.add("checkbox", undefined, "Update ALL lines when running (also on the Run tab)");
        var gAllW = pAllLines.add("group");
        var cAllApplyW = gAllW.add("checkbox", undefined, "Set stroke weight (pt):");
        var eAllW = gAllW.add("edittext", undefined, "0.5");
        eAllW.characters = 6;
        var gAllC = pAllLines.add("group");
        var cAllApplyC = gAllC.add("checkbox", undefined, "Set stroke colour (Hex):");
        var eAllHex = gAllC.add("edittext", undefined, "#000000");
        eAllHex.characters = 8;
        var swAll = gAllC.add("group");
        swAll.preferredSize = [24, 20];
        var bAllPick = gAllC.add("button", undefined, "Pick...");
        var cAllSkipDashed = pAllLines.add("checkbox", undefined, "Skip dashed lines (leave them to the dashed settings above)");
        var cAllSelect = pAllLines.add("checkbox", undefined, "Select the lines after updating (slower on big files)");
        var gAllBtn = pAllLines.add("group");
        var bAllNow = gAllBtn.add("button", undefined, "Apply to all lines now");

        // ------------------------- UNIVERSAL TAB -------------------------
        var pUL = tabUniv.add("panel", undefined, "Layers");
        pUL.alignChildren = "left";
        var cCapLayersU = pUL.add("checkbox", undefined, "Capitalise all layer names (UPPERCASE)");
        var cLayerSubU  = pUL.add("checkbox", undefined, "Include sublayers");

        var pUT = tabUniv.add("panel", undefined, "Texts");
        pUT.alignChildren = "left";
        var cCapTextU = pUT.add("checkbox", undefined, "Select all texts and set all CAPITAL");
        var gMode = pUT.add("group");
        gMode.add("statictext", undefined, "Method:");
        var ddCapMode = gMode.add("dropdownlist", undefined,
            ["Change the characters to UPPERCASE", "Apply the All Caps format (text unchanged)"]);
        ddCapMode.selection = 0;
        var cSelectTexts = pUT.add("checkbox", undefined, "Leave all texts selected afterwards");
        var sUnivTip = tabUniv.add("statictext", undefined,
            "Tip: \"Change the characters\" rewrites the text (mixed formatting inside one frame takes the first character's style). " +
            "\"All Caps format\" keeps the text as typed. Texts changed by label rules are already capital.",
            { multiline: true });
        sUnivTip.preferredSize = [680, 50];
        var gUBtn = tabUniv.add("group");
        var bUnivNow = gUBtn.add("button", undefined, "Apply ticked Universal options now");

        // ------------------------- LAYERS TAB -------------------------
        var gLTop = tabLayers.add("group");
        var cLayerSub = gLTop.add("checkbox", undefined, "Show sublayers");
        cLayerSub.value = true;
        var bLayerRefresh = gLTop.add("button", undefined, "Refresh");
        gLTop.add("statictext", undefined, "Double-click a layer to rename it. Changes are applied to the document immediately.");

        var listLayers = tabLayers.add("listbox", undefined, [], {
            multiselect: false, numberOfColumns: 4, showHeaders: true,
            columnTitles: ["Layer name", "Items", "Visible", "Locked"],
            columnWidths: [380, 80, 80, 80]
        });
        listLayers.preferredSize = [690, 330];

        var gLName = tabLayers.add("group");
        gLName.add("statictext", undefined, "New name:");
        var eLayerName = gLName.add("edittext", undefined, "");
        eLayerName.characters = 36;
        var bLayerRename = gLName.add("button", undefined, "Rename selected");
        var bLayerUpper  = gLName.add("button", undefined, "UPPERCASE selected");

        // ------------------------- GROUP GRAPHICS TAB -------------------------
        var pGGSet = tabGroupGfx.add("panel", undefined, "Group sets & colour");
        pGGSet.alignChildren = "left";

        var gGGSetRow = pGGSet.add("group");
        gGGSetRow.orientation = "row";
        gGGSetRow.add("statictext", undefined, "Group set:");
        var ddGGSet = gGGSetRow.add("dropdownlist", undefined, []);
        ddGGSet.preferredSize = [130, 22];
        var bGGNewSet = gGGSetRow.add("button", undefined, "+ New Set");
        var bGGRenSet = gGGSetRow.add("button", undefined, "Rename");
        var bGGDelSet = gGGSetRow.add("button", undefined, "Delete Set");

        gGGSetRow.add("statictext", undefined, "Colour:");
        var eGGHex = gGGSetRow.add("edittext", undefined, "#545454");
        eGGHex.characters = 8;
        var swGG = gGGSetRow.add("group");
        swGG.preferredSize = [24, 20];
        var bGGPick = gGGSetRow.add("button", undefined, "Pick...");

        var pGGAdd = tabGroupGfx.add("panel", undefined, "Add part to selected set (W x H)");
        pGGAdd.alignChildren = "left";

        var gGGInput = pGGAdd.add("group");
        gGGInput.orientation = "row";
        gGGInput.add("statictext", undefined, "Width (W):");
        var eGGW = gGGInput.add("edittext", undefined, "");
        eGGW.characters = 7;
        gGGInput.add("statictext", undefined, "Height (H):");
        var eGGH = gGGInput.add("edittext", undefined, "");
        eGGH.characters = 7;
        gGGInput.add("statictext", undefined, "Unit:");
        var ddGGUnit = gGGInput.add("dropdownlist", undefined, UNITS);
        ddGGUnit.selection = unitIndex(st.groupGraphics.unit);

        var bGGAdd = gGGInput.add("button", undefined, "+ Add part");
        var bGGDel = gGGInput.add("button", undefined, "Remove");
        var bGGClr = gGGInput.add("button", undefined, "Clear");

        var listGG = tabGroupGfx.add("listbox", undefined, [], {
            multiselect: true,
            numberOfColumns: 3,
            showHeaders: true,
            columnTitles: ["Part #", "Width (W)", "Height (H)"],
            columnWidths: [80, 260, 260]
        });
        listGG.preferredSize = [690, 140];

        var pGGOpts = tabGroupGfx.add("panel", undefined, "Proximity & matching options");
        pGGOpts.alignChildren = "left";

        var gGGTol = pGGOpts.add("group");
        gGGTol.orientation = "row";
        gGGTol.add("statictext", undefined, "Size tolerance (+/-):");
        var eGGTol = gGGTol.add("edittext", undefined, String(st.groupGraphics.tolerance));
        eGGTol.characters = 6;
        gGGTol.add("statictext", undefined, "Max distance between parts:");
        var eGGGap = gGGTol.add("edittext", undefined, String(st.groupGraphics.maxGap));
        eGGGap.characters = 6;
        var sGGUnitHint = gGGTol.add("statictext", undefined, "(" + st.groupGraphics.unit + ")");
        sGGUnitHint.preferredSize = [45, 20];

        var gGGChecks = pGGOpts.add("group");
        gGGChecks.orientation = "row";
        var cGGSwap    = gGGChecks.add("checkbox", undefined, "Allow rotated (W <-> H)");
        var cGGVis     = gGGChecks.add("checkbox", undefined, "Visible bounds");
        var cGGAllReq  = gGGChecks.add("checkbox", undefined, "Require complete set");
        var cGGApplyCol = gGGChecks.add("checkbox", undefined, "Apply set colour");

        var gGGNow = tabGroupGfx.add("group");
        gGGNow.orientation = "row";
        var bGGNow = gGGNow.add("button", undefined, "Group All Sets Now");
        var sGGTip = gGGNow.add("statictext", undefined,
            "Each Group Set is matched in order and coloured with its own Hex colour.",
            { multiline: true });
        sGGTip.preferredSize = [490, 22];

        // ------------------------- BOTTOM BUTTONS -------------------------
        var gBtn = w.add("group");
        gBtn.alignment = "fill";
        var gLeft = gBtn.add("group");
        var bSaveSet = gLeft.add("button", undefined, "Save settings");
        var bImport  = gLeft.add("button", undefined, "Import...");
        var bExport  = gLeft.add("button", undefined, "Export...");
        var gMid = gBtn.add("group");
        gMid.alignment = ["fill", "center"];
        var gRight = gBtn.add("group");
        gRight.alignment = ["right", "center"];
        var bCancel  = gRight.add("button", undefined, "Cancel");
        var bCompact = gRight.add("button", undefined, "Run Compact");
        var bRun     = gRight.add("button", undefined, "Run");

        // keep duplicated checkboxes in sync
        mirror(cArrowsOn, cArrowsOnS);
        mirror(cAllLines, cAllLinesD);
        mirror(cCapLayers, cCapLayersU);
        mirror(cCapText, cCapTextU);
        mirror(cDashed, cDashedTabEnable);

        // ------------------------- LOGIC -------------------------
        function updateSummary() {
            var name = ddRunSet.selection && ddRunSet.selection.index === 1 ? "compact" : "standard";
            var s = st.styleSets[name];
            sSummary.text = "Main " + s.main.size + " | Secondary " + s.secondary.size + " | Small " + s.small.size +
                            " | O_name " + s.oname.size + " | F_name " + s.fname.size + "  (pt)";
        }

        function currentGGSet() {
            if (!st.groupGraphics.sets.length) {
                st.groupGraphics.sets.push({ name: "Group 1", color: [84, 84, 84], items: [] });
            }
            if (activeGGSetIdx < 0 || activeGGSetIdx >= st.groupGraphics.sets.length) activeGGSetIdx = 0;
            return st.groupGraphics.sets[activeGGSetIdx];
        }

        function refreshGGSetDropdown() {
            ddGGSet.removeAll();
            for (var i = 0; i < st.groupGraphics.sets.length; i++) {
                ddGGSet.add("item", st.groupGraphics.sets[i].name);
            }
            if (activeGGSetIdx >= st.groupGraphics.sets.length) activeGGSetIdx = st.groupGraphics.sets.length - 1;
            if (activeGGSetIdx < 0) activeGGSetIdx = 0;
            ddGGSet.selection = activeGGSetIdx;
        }

        function refreshGGColorUI() {
            var cur = currentGGSet();
            var col = cur.color || [84, 84, 84];
            eGGHex.text = rgbToHex(col);
            setSwatch(swGG, col[0], col[1], col[2]);
        }

        function refreshGGList() {
            listGG.removeAll();
            var cur = currentGGSet();
            var u = UNITS[ddGGUnit.selection ? ddGGUnit.selection.index : 0];
            sGGUnitHint.text = "(" + u + ")";
            for (var i = 0; i < cur.items.length; i++) {
                var item = cur.items[i];
                var it = listGG.add("item", "Part " + (i + 1));
                it.subItems[0].text = item.w + " " + u;
                it.subItems[1].text = item.h + " " + u;
                it.itemIndex = i;
            }
        }

        function refreshList() {
            list.removeAll();
            var f = trim(eFilter.text).toLowerCase(), shown = 0;
            for (var i = 0; i < st.rules.length; i++) {
                var r = st.rules[i];
                var hay = (CAT_LABEL[r.cat] + " " + r.text + " " + r.keys.join(" ")).toLowerCase();
                if (f !== "" && hay.indexOf(f) === -1) continue;
                var it = list.add("item", CAT_LABEL[r.cat]);
                it.subItems[0].text = r.text;
                it.subItems[1].text = r.keys.length ? r.keys.join(", ") : "(same as final text)";
                it.subItems[2].text = r.exact ? "yes" : "";
                it.rule = r;
                shown++;
            }
            sCount.text = shown + " of " + st.rules.length + " rules";
        }

        function selectedRules() {
            var sel = list.selection, out = [];
            if (!sel) return out;
            if (!(sel instanceof Array)) sel = [sel];
            for (var i = 0; i < sel.length; i++) out.push(sel[i].rule);
            return out;
        }

        // ---- layers tab helpers ----
        function levelPad(n) {
            var s = "";
            for (var i = 0; i < n; i++) s += "     ";
            return s;
        }
        function addLayerRows(layers, level) {
            for (var i = 0; i < layers.length; i++) {
                var Ly = layers[i];
                var cnt = "?";
                try { cnt = String(Ly.pageItems.length); } catch (e0) {}
                var it = listLayers.add("item", levelPad(level) + Ly.name);
                it.subItems[0].text = cnt;
                it.subItems[1].text = Ly.visible ? "yes" : "no";
                it.subItems[2].text = Ly.locked ? "yes" : "no";
                it.layerRef = Ly;
                it.level = level;
                if (cLayerSub.value && Ly.layers.length) addLayerRows(Ly.layers, level + 1);
            }
        }
        function refreshLayerList() {
            listLayers.removeAll();
            try { addLayerRows(doc.layers, 0); } catch (e) { alert("Could not read layers: " + e); }
            eLayerName.text = "";
        }
        function renameLayerItem(item, newName) {
            try {
                item.layerRef.name = newName;
                item.text = levelPad(item.level) + newName;
                return true;
            } catch (e) {
                alert("Could not rename the layer: " + e);
                return false;
            }
        }

        function populate() {
            if (hasSel && st.cfg.scope === "selection") rSel.value = true; else rDoc.value = true;
            cOpt.value = st.cfg.moveOptNames;
            cStyle.value = st.cfg.restyle;
            cUpDn.value = st.cfg.updnEnabled;
            cWrap.value = st.cfg.wrapLabels;
            cJunk.value = st.cfg.removeJunk;
            cLoose.value = st.cfg.looseMatch;
            cArrowsOn.value = cArrowsOnS.value = !!st.cfg.arrowsEnabled;
            cAllLines.value = cAllLinesD.value = !!st.cfg.allLinesEnabled;
            cDashed.value = cDashedTabEnable.value = !!st.cfg.dashedEnabled;
            cGroupGfx.value = !!st.cfg.groupGraphicsEnabled;
            cCapLayers.value = cCapLayersU.value = !!st.cfg.capLayersEnabled;
            cCapText.value = cCapTextU.value = !!st.cfg.capTextEnabled;
            cReport.value = !!st.cfg.reportEnabled;
            cReportItems.value = !!st.cfg.reportItems;
            cDry.value = st.cfg.dryRun;
            ddRunSet.selection = st.cfg.runSet === "compact" ? 1 : 0;

            cApplyWeight.value = st.dashed.applyWeight;
            cApplyDashSpace.value = st.dashed.applyDashSpace;
            cApplyDashColor.value = st.dashed.applyColor;
            cDashSelect.value = st.dashed.selectAfter;
            eStrokeWeight.text = String(st.dashed.strokeWeight);
            eDashLen.text = String(st.dashed.dash);
            eDashSpace.text = String(st.dashed.space);

            cAllApplyW.value = st.allLines.applyWeight;
            cAllApplyC.value = st.allLines.applyColor;
            eAllW.text = String(st.allLines.weight);
            eAllHex.text = rgbToHex(st.allLines.color);
            setSwatch(swAll, st.allLines.color[0], st.allLines.color[1], st.allLines.color[2]);
            cAllSkipDashed.value = st.allLines.skipDashed;
            cAllSelect.value = st.allLines.selectAfter;

            cArrowTri.value = st.arrows.detectTriangles;
            eArrowTri.text = String(st.arrows.triMax);
            cArrowGlyph.value = st.arrows.detectGlyphs;
            eArrowKw.text = st.arrows.keywords.join(", ");

            cLayerSubU.value = st.universal.layersIncludeSub;
            ddCapMode.selection = st.universal.textMode === "allcaps" ? 1 : 0;
            cSelectTexts.value = st.universal.selectTexts;

            ddGGUnit.selection = unitIndex(st.groupGraphics.unit);
            eGGTol.text = String(st.groupGraphics.tolerance);
            eGGGap.text = String(st.groupGraphics.maxGap);
            cGGSwap.value = !!st.groupGraphics.allowRotated;
            cGGVis.value = !!st.groupGraphics.useVisibleBounds;
            cGGAllReq.value = !!st.groupGraphics.requireAllParts;
            cGGApplyCol.value = (typeof st.groupGraphics.applyColor === "boolean") ? st.groupGraphics.applyColor : true;

            activeGGSetIdx = 0;
            refreshGGSetDropdown();
            refreshGGColorUI();
            refreshGGList();

            loadStyleControls(editSet);
            eOpt.text = st.optPatterns.join(EOL);
            eWrap.text = st.wrapTexts.join(EOL);
            eJunkX.text = st.junkExact.join(EOL);
            eJunkR.text = st.junkRegex.join(EOL);
            refreshList();
            refreshLayerList();
            updateSummary();
        }

        function readLists() {
            st.optPatterns = splitLines(eOpt.text);
            st.wrapTexts = splitLines(eWrap.text);
            st.junkExact = splitLines(eJunkX.text);
            st.junkRegex = splitLines(eJunkR.text);
        }

        function readDashedControls(silent) {
            var wVal = parseFloat(trim(eStrokeWeight.text));
            var dVal = parseFloat(trim(eDashLen.text));
            var spVal = parseFloat(trim(eDashSpace.text));
            if (isNaN(wVal) || wVal <= 0) {
                if (!silent) { alert("Invalid Stroke weight (pt). Enter a number greater than 0."); return false; }
            } else {
                st.dashed.strokeWeight = wVal;
            }
            if (isNaN(dVal) || dVal <= 0) {
                if (!silent) { alert("Invalid Dash size (pt). Enter a number greater than 0."); return false; }
            } else {
                st.dashed.dash = dVal;
            }
            if (isNaN(spVal) || spVal < 0) {
                if (!silent) { alert("Invalid Space size (pt). Enter 0 or a positive number."); return false; }
            } else {
                st.dashed.space = spVal;
            }
            st.dashed.enabled = true;
            st.dashed.applyWeight = cApplyWeight.value;
            st.dashed.applyDashSpace = cApplyDashSpace.value;
            st.dashed.applyColor = cApplyDashColor.value;
            st.dashed.selectAfter = cDashSelect.value;
            return true;
        }

        function readAllLinesControls(silent) {
            var wVal = parseFloat(trim(eAllW.text));
            if (isNaN(wVal) || wVal <= 0) {
                if (!silent) { alert("Invalid stroke weight for ALL lines. Enter a number greater than 0."); return false; }
            } else {
                st.allLines.weight = wVal;
            }
            var parsed = parseHexRGB(eAllHex.text);
            if (parsed) st.allLines.color = parsed;
            st.allLines.applyWeight = cAllApplyW.value;
            st.allLines.applyColor = cAllApplyC.value;
            st.allLines.skipDashed = cAllSkipDashed.value;
            st.allLines.selectAfter = cAllSelect.value;
            return true;
        }

        function readArrowControls(silent) {
            var v = parseFloat(trim(eArrowTri.text));
            if (isNaN(v) || v <= 0) {
                if (!silent) { alert("Invalid arrowhead max size. Enter a number greater than 0."); return false; }
            } else {
                st.arrows.triMax = v;
            }
            st.arrows.detectTriangles = cArrowTri.value;
            st.arrows.detectGlyphs = cArrowGlyph.value;
            var parts = eArrowKw.text.split(","), kw = [];
            for (var i = 0; i < parts.length; i++) {
                var k = trim(parts[i]);
                if (k !== "") kw.push(k);
            }
            st.arrows.keywords = kw;
            return true;
        }

        function readUniversalControls() {
            st.universal.layersIncludeSub = cLayerSubU.value;
            st.universal.textMode = (ddCapMode.selection && ddCapMode.selection.index === 1) ? "allcaps" : "upper";
            st.universal.selectTexts = cSelectTexts.value;
        }

        function readGroupGraphicsControls(silent) {
            var tol = parseFloat(trim(eGGTol.text));
            var gap = parseFloat(trim(eGGGap.text));
            if (isNaN(tol) || tol < 0) {
                if (!silent) { alert("Invalid Size tolerance. Enter 0 or a positive number."); return false; }
            } else {
                st.groupGraphics.tolerance = tol;
            }
            if (isNaN(gap) || gap < 0) {
                if (!silent) { alert("Invalid Max distance between parts. Enter 0 or a positive number."); return false; }
            } else {
                st.groupGraphics.maxGap = gap;
            }
            st.groupGraphics.unit = UNITS[ddGGUnit.selection ? ddGGUnit.selection.index : 0];
            st.groupGraphics.allowRotated = cGGSwap.value;
            st.groupGraphics.useVisibleBounds = cGGVis.value;
            st.groupGraphics.requireAllParts = cGGAllReq.value;
            st.groupGraphics.applyColor = cGGApplyCol.value;

            var parsed = parseHexRGB(eGGHex.text);
            if (parsed) currentGGSet().color = parsed;
            return true;
        }

        function commit() {
            if (!readStyleControls(editSet, false)) { tp.selection = tabStyles; return false; }
            if (!readDashedControls(false)) { tp.selection = tabDashed; return false; }
            if (!readAllLinesControls(false)) { tp.selection = tabDashed; return false; }
            if (!readArrowControls(false)) { tp.selection = tabStyles; return false; }
            if (!readGroupGraphicsControls(false)) { tp.selection = tabGroupGfx; return false; }
            readUniversalControls();

            st.cfg.scope = rSel.value ? "selection" : "document";
            st.cfg.moveOptNames = cOpt.value;
            st.cfg.restyle = cStyle.value;
            st.cfg.updnEnabled = cUpDn.value;
            st.cfg.wrapLabels = cWrap.value;
            st.cfg.removeJunk = cJunk.value;
            st.cfg.looseMatch = cLoose.value;
            st.cfg.arrowsEnabled = cArrowsOn.value;
            st.cfg.allLinesEnabled = cAllLines.value;
            st.cfg.dashedEnabled = cDashed.value;
            st.cfg.groupGraphicsEnabled = cGroupGfx.value;
            st.cfg.capLayersEnabled = cCapLayers.value;
            st.cfg.capTextEnabled = cCapText.value;
            st.cfg.reportEnabled = cReport.value;
            st.cfg.reportItems = cReportItems.value;
            st.cfg.dryRun = cDry.value;
            st.cfg.runSet = (ddRunSet.selection && ddRunSet.selection.index === 1) ? "compact" : "standard";

            readLists();
            var bad = [];
            for (var i = 0; i < st.junkRegex.length; i++) {
                try { new RegExp(st.junkRegex[i], "i"); } catch (e) { bad.push(st.junkRegex[i]); }
            }
            if (bad.length) {
                alert("Invalid regular expression(s):\n\n" + bad.join("\n"));
                tp.selection = tabLists;
                return false;
            }
            return true;
        }

        function runOnly(flags) {
            if (!commit()) return;
            result.action = "only";
            result.only = flags;
            w.close(1);
        }

        // ---- Group Graphics tab handlers ----
        ddGGSet.onChange = function () {
            if (ddGGSet.selection) {
                activeGGSetIdx = ddGGSet.selection.index;
                refreshGGColorUI();
                refreshGGList();
            }
        };

        bGGNewSet.onClick = function () {
            var nextNum = st.groupGraphics.sets.length + 1;
            var name = prompt("Enter name for the new Group Set:", "Group " + nextNum);
            if (name === null) return;
            name = trim(name) || ("Group " + nextNum);
            st.groupGraphics.sets.push({ name: name, color: [84, 84, 84], items: [] });
            activeGGSetIdx = st.groupGraphics.sets.length - 1;
            refreshGGSetDropdown();
            refreshGGColorUI();
            refreshGGList();
        };

        bGGRenSet.onClick = function () {
            var cur = currentGGSet();
            var name = prompt("Rename Group Set:", cur.name);
            if (name === null) return;
            name = trim(name);
            if (name === "") return;
            cur.name = name;
            refreshGGSetDropdown();
        };

        bGGDelSet.onClick = function () {
            if (st.groupGraphics.sets.length <= 1) {
                alert("At least one Group Set is required.");
                return;
            }
            var cur = currentGGSet();
            if (!confirm("Delete \"" + cur.name + "\"?")) return;
            st.groupGraphics.sets.splice(activeGGSetIdx, 1);
            if (activeGGSetIdx >= st.groupGraphics.sets.length) activeGGSetIdx = st.groupGraphics.sets.length - 1;
            refreshGGSetDropdown();
            refreshGGColorUI();
            refreshGGList();
        };

        eGGHex.onChanging = function () {
            var parsed = parseHexRGB(eGGHex.text);
            if (parsed) {
                currentGGSet().color = parsed;
                setSwatch(swGG, parsed[0], parsed[1], parsed[2]);
            }
        };
        eGGHex.onChange = function () {
            var parsed = parseHexRGB(eGGHex.text);
            if (parsed) {
                currentGGSet().color = parsed;
                eGGHex.text = rgbToHex(parsed);
                setSwatch(swGG, parsed[0], parsed[1], parsed[2]);
            } else {
                refreshGGColorUI();
            }
        };

        bGGPick.onClick = function () {
            try {
                var c = currentGGSet().color || [84, 84, 84];
                var curInt = (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2]);
                var v = $.colorPicker(curInt);
                if (v !== -1) {
                    currentGGSet().color = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
                    refreshGGColorUI();
                }
            } catch (e) {}
        };

        ddGGUnit.onChange = function () {
            readGroupGraphicsControls(true);
            refreshGGList();
        };

        bGGAdd.onClick = function () {
            var wVal = parseFloat(trim(eGGW.text));
            var hVal = parseFloat(trim(eGGH.text));
            if (isNaN(wVal) || wVal < 0 || isNaN(hVal) || hVal < 0) {
                alert("Enter valid numbers (0 or greater) for Width (W) and Height (H).");
                return;
            }
            currentGGSet().items.push({ w: wVal, h: hVal });
            eGGW.text = "";
            eGGH.text = "";
            refreshGGList();
        };

        bGGDel.onClick = function () {
            var sel = listGG.selection;
            if (!sel) { alert("Select one or more parts to remove."); return; }
            if (!(sel instanceof Array)) sel = [sel];
            var delIdx = {};
            for (var i = 0; i < sel.length; i++) delIdx[sel[i].itemIndex] = true;
            var cur = currentGGSet();
            var keep = [];
            for (var j = 0; j < cur.items.length; j++) {
                if (!delIdx[j]) keep.push(cur.items[j]);
            }
            cur.items = keep;
            refreshGGList();
        };

        function editGGPart() {
            var sel = listGG.selection;
            if (!sel) return;
            if (sel instanceof Array) sel = sel[0];

            var cur = currentGGSet();
            var idx = sel.itemIndex;
            var part = cur.items[idx];
            if (!part) return;

            var u = UNITS[ddGGUnit.selection ? ddGGUnit.selection.index : 0];
            var d = new Window("dialog", "Edit Part " + (idx + 1) + " (" + u + ")");
            d.orientation = "column";
            d.alignChildren = "left";

            var gW = d.add("group");
            gW.add("statictext", undefined, "Width (W):");
            var eW = gW.add("edittext", undefined, String(part.w));
            eW.characters = 10;

            var gH = d.add("group");
            gH.add("statictext", undefined, "Height (H):");
            var eH = gH.add("edittext", undefined, String(part.h));
            eH.characters = 10;

            var gBtns = d.add("group");
            gBtns.alignment = "right";
            var bC = gBtns.add("button", undefined, "Cancel");
            var bO = gBtns.add("button", undefined, "OK");

            bC.onClick = function () { d.close(0); };
            bO.onClick = function () {
                var wVal = parseFloat(trim(eW.text));
                var hVal = parseFloat(trim(eH.text));
                if (isNaN(wVal) || wVal < 0 || isNaN(hVal) || hVal < 0) {
                    alert("Enter valid numbers (0 or greater) for Width (W) and Height (H).");
                    return;
                }
                part.w = wVal;
                part.h = hVal;
                refreshGGList();
                d.close(1);
            };

            d.show();
        }

        listGG.onDoubleClick = editGGPart;

        bGGClr.onClick = function () {
            currentGGSet().items = [];
            refreshGGList();
        };

        bGGNow.onClick = function () {
            if (!readGroupGraphicsControls(false)) return;
            var hasAny = false;
            for (var i = 0; i < st.groupGraphics.sets.length; i++) {
                if (st.groupGraphics.sets[i].items.length > 0) { hasAny = true; break; }
            }
            if (!hasAny) {
                alert("Add at least one Width x Height part to a Group Set first.");
                return;
            }
            st.cfg.scope = rSel.value ? "selection" : "document";
            saveState(st, SETTINGS_FILE);
            result.action = "groupOnly";
            w.close(1);
        };

        // ---- Dashed / all lines / arrows / universal ----
        eStrokeWeight.onChanging = function () { readDashedControls(true); };
        eStrokeWeight.onChange = function () { readDashedControls(true); };
        eDashLen.onChanging = function () { readDashedControls(true); };
        eDashLen.onChange = function () { readDashedControls(true); };
        eDashSpace.onChanging = function () { readDashedControls(true); };
        eDashSpace.onChange = function () { readDashedControls(true); };

        eAllHex.onChanging = function () {
            var parsed = parseHexRGB(eAllHex.text);
            if (parsed) { st.allLines.color = parsed; setSwatch(swAll, parsed[0], parsed[1], parsed[2]); }
        };
        eAllHex.onChange = function () {
            var parsed = parseHexRGB(eAllHex.text);
            if (parsed) {
                st.allLines.color = parsed;
                eAllHex.text = rgbToHex(parsed);
                setSwatch(swAll, parsed[0], parsed[1], parsed[2]);
            } else {
                eAllHex.text = rgbToHex(st.allLines.color);
            }
        };
        bAllPick.onClick = function () {
            try {
                var c = st.allLines.color;
                var curInt = (clamp255(c[0]) << 16) | (clamp255(c[1]) << 8) | clamp255(c[2]);
                var v = $.colorPicker(curInt);
                if (v !== -1) {
                    st.allLines.color = [(v >> 16) & 255, (v >> 8) & 255, v & 255];
                    eAllHex.text = rgbToHex(st.allLines.color);
                    setSwatch(swAll, st.allLines.color[0], st.allLines.color[1], st.allLines.color[2]);
                }
            } catch (e) {}
        };
        bAllNow.onClick = function () {
            if (!cAllApplyW.value && !cAllApplyC.value) { alert("Tick Set stroke weight and/or Set stroke colour first."); return; }
            runOnly(["allLinesEnabled"]);
        };
        bArrowNow.onClick = function () { runOnly(["arrowsEnabled"]); };
        bUnivNow.onClick = function () {
            var flags = [];
            if (cCapLayersU.value) flags.push("capLayersEnabled");
            if (cCapTextU.value) flags.push("capTextEnabled");
            if (!flags.length) { alert("Tick at least one Universal option first."); return; }
            runOnly(flags);
        };

        // ---- layers tab ----
        bLayerRefresh.onClick = refreshLayerList;
        cLayerSub.onClick = refreshLayerList;
        listLayers.onChange = function () {
            var sel = listLayers.selection;
            if (sel && sel.layerRef) { try { eLayerName.text = sel.layerRef.name; } catch (e) {} }
        };
        listLayers.onDoubleClick = function () {
            var sel = listLayers.selection;
            if (!sel) return;
            var nm = prompt("Rename layer:", sel.layerRef.name);
            if (nm === null) return;
            nm = trim(nm);
            if (nm === "") return;
            if (renameLayerItem(sel, nm)) eLayerName.text = nm;
        };
        bLayerRename.onClick = function () {
            var sel = listLayers.selection;
            if (!sel) { alert("Select a layer first."); return; }
            var nm = trim(eLayerName.text);
            if (nm === "") { alert("Enter the new layer name."); return; }
            renameLayerItem(sel, nm);
        };
        bLayerUpper.onClick = function () {
            var sel = listLayers.selection;
            if (!sel) { alert("Select a layer first."); return; }
            var nm = String(sel.layerRef.name).toUpperCase();
            if (renameLayerItem(sel, nm)) eLayerName.text = nm;
        };

        ddRunSet.onChange = updateSummary;
        ddEdit.onChange = function () {
            readStyleControls(editSet, true);
            editSet = ddEdit.selection.index === 1 ? "compact" : "standard";
            loadStyleControls(editSet);
        };

        eFilter.onChanging = refreshList;

        bAdd.onClick = function () {
            var r = ruleDialog(null);
            if (r) { st.rules.push(r); eFilter.text = ""; refreshList(); }
        };
        function editSelected() {
            var sel = selectedRules();
            if (sel.length === 0) { alert("Select a rule first."); return; }
            var r = ruleDialog(sel[0]);
            if (r) {
                sel[0].cat = r.cat; sel[0].text = r.text; sel[0].keys = r.keys; sel[0].exact = r.exact;
                refreshList();
            }
        }
        bEdit.onClick = editSelected;
        list.onDoubleClick = editSelected;

        bDel.onClick = function () {
            var sel = selectedRules();
            if (sel.length === 0) { alert("Select one or more rules first."); return; }
            if (!confirm("Delete " + sel.length + " rule(s)?")) return;
            var keep = [];
            for (var i = 0; i < st.rules.length; i++) {
                var del = false;
                for (var j = 0; j < sel.length; j++) if (sel[j] === st.rules[i]) { del = true; break; }
                if (!del) keep.push(st.rules[i]);
            }
            st.rules = keep;
            refreshList();
        };

        bReset.onClick = function () {
            if (!confirm("Replace ALL rules with the built-in defaults?")) return;
            st.rules = defaultState().rules;
            refreshList();
        };

        bScan.onClick = function () {
            if (app.documents.length === 0) { alert("No document open."); return; }
            st.cfg.scope = rSel.value ? "selection" : "document";
            readLists();
            var found = scanUnmatched(app.activeDocument, st);
            var added = scanDialog(found);
            for (var i = 0; i < added.length; i++) st.rules.push(added[i]);
            if (added.length) { eFilter.text = ""; refreshList(); }
        };

        bSaveSet.onClick = function () {
            if (!commit()) return;
            alert(saveState(st, SETTINGS_FILE) ? "Settings saved." : "Could not write the settings file.");
        };
        bExport.onClick = function () {
            if (!commit()) return;
            var f = File.saveDialog("Export settings", "Text:*.txt");
            if (f) alert(saveState(st, f) ? "Exported." : "Could not write the file.");
        };
        bImport.onClick = function () {
            var f = File.openDialog("Import settings (only import files you trust)", "Text:*.txt");
            if (!f) return;
            var imp = loadState(f);
            for (var k in imp) if (hasOwn(imp, k)) st[k] = imp[k];
            populate();
        };

        bCancel.onClick = function () { w.close(0); };
        bRun.onClick = function () {
            if (!commit()) return;
            result.action = "normal";
            w.close(1);
        };
        bCompact.onClick = function () {
            if (!commit()) return;
            st.cfg.restyle = true;
            result.action = "compact";
            w.close(1);
        };

        populate();
        return (w.show() === 1) ? result : null;
    }

    // =================================================================
    // MAIN
    // =================================================================
    function main() {
        if (app.documents.length === 0) { alert("No document open."); return; }
        var doc = app.activeDocument;
        var st = loadState(SETTINGS_FILE);

        var res = buildUI(st, doc);
        if (!res) return;

        saveState(st, SETTINGS_FILE);

        if (res.action === "groupOnly") {
            var ggOut = runGroupGraphics(doc, st, false);
            var report = [
                "Group Graphics Finished.",
                "Group sets configured:  " + ggOut.setsCount,
                "Matching parts found:   " + ggOut.matchedTotal,
                "Total groups created:   " + ggOut.groupsCreated,
                "Total items grouped:    " + ggOut.itemsGrouped,
                "Unpaired parts skipped: " + ggOut.incompleteSkipped,
                "Errors:                 " + ggOut.errors,
                ""
            ];
            for (var ps = 0; ps < ggOut.perSet.length; ps++) {
                var sInfo = ggOut.perSet[ps];
                report.push("  " + sInfo.name + " (" + sInfo.hex + "): " +
                            sInfo.groupsCreated + " groups (" + sInfo.itemsGrouped + " items, " +
                            sInfo.incompleteSkipped + " skipped)");
            }
            if (ggOut.details.length) {
                report.push("");
                report.push("ERRORS:");
                for (var i = 0; i < ggOut.details.length; i++) report.push("  " + ggOut.details[i]);
            }
            showReport(report.join("\n"));
            return;
        }

        if (res.action === "only" && res.only) applyOnly(st.cfg, res.only);

        var setName = res.action === "compact" ? "compact" : st.cfg.runSet;
        showReport(runCleaner(doc, st, setName));
    }

    main();

})();
