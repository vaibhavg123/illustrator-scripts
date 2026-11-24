#target illustrator

(function () {
    function report(pct, msg) {
        if (typeof vgProgress === "function") {
            vgProgress(pct, msg);
        }
    }

    function escapeJson(str) {
        return String(str || "")
            .replace(/\\/g, "\\\\")
            .replace(/"/g, '\\"')
            .replace(/\r?\n/g, " ");
    }

    var APP_TITLE = "Floor Plan Label Cleaner v3.0";
    var SETTINGS_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_settings.txt");
    var REPORT_FILE = new File(Folder.userData + "/FloorPlanLabelCleaner_last_report.txt");
    var EOL = ($.os.indexOf("Windows") !== -1) ? "\r\n" : "\n";
    var CATS = ["main", "secondary", "small", "oname", "fname"];
    var CAT_LABEL = { main: "Main room", secondary: "Secondary", small: "Small", oname: "O_name", fname: "F_name" };
    var EXTRAS = ["dashed", "arrow"];
    var EXTRA_LABEL = { dashed: "Dashed line", arrow: "Arrows" };
    var UNITS = ["in", "mm", "cm", "pt", "px"];
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
            return { key: norm(left), value: toIllustratorLines(right).toUpperCase(), isMap: true };
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

    function incr(o, k) { o[k] = (hasOwn(o, k) ? o[k] : 0) + 1; }

    function applyColorToGraphic(item, rgbColor) {
        if (!item) return;
        try {
            var t = item.typename;
            if (t === "PathItem") {
                if (item.stroked) item.strokeColor = rgbColor;
                if (item.filled) item.fillColor = rgbColor;
            } else if (t === "CompoundPathItem") {
                for (var i = 0; i < item.pathItems.length; i++) applyColorToGraphic(item.pathItems[i], rgbColor);
            } else if (t === "GroupItem") {
                for (var j = 0; j < item.pageItems.length; j++) applyColorToGraphic(item.pageItems[j], rgbColor);
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
        for (n = 1; n <= 5; n++) R("main", "BEDROOM " + n, ["bed " + n, "bed" + n, "bdrm " + n, "bdrm" + n, "bedroom " + n]);
        for (n = 1; n <= 4; n++) R("main", "BATH " + n, ["ba " + n, "ba" + n, "bath " + n, "bath" + n]);
        R("main", "OWNER'S SUITE", ["owner's suite", "owners suite"]);
        R("main", "OWNER'S BEDROOM", ["owner's bedroom", "owners bedroom"]);
        R("main", "OWNER'S BATH", ["owner's bath", "o. ba", "o. bath", "o.ba", "o.bath"]);
        R("main", "UPSTAIRS LIVING", ["upstairs living"]);
        R("main", "FAMILY", ["family"]);
        R("main", "GAME ROOM", ["game room"]);
        R("main", "STUDY", ["study"]);
        R("main", "FLEX", ["flex"]);
        R("main", "LIVING", ["living"]);
        R("main", "CASUAL", ["casual"]);
        R("main", "CASUAL DINING", ["casual dining"]);
        R("main", "OFFICE", ["office"]);
        R("main", "COVERED PORCH", ["covered porch"]);
        R("main", "COVERED PATIO", ["covered patio"]);
        R("main", "PATIO", ["patio"]);
        R("main", "DECK", ["deck"]);
        R("main", "DINING", ["dining"]);
        R("main", "BREAKFAST", ["breakfast"]);
        R("main", "LOFT", ["loft"]);
        R("main", "KITCHEN", ["kitchen"]);
        R("main", "GREAT ROOM", ["great rm", "great room"]);
        R("main", "GARAGE", ["garage"]);

        R("secondary", "LAUNDRY", ["la"], true);
        R("secondary", "LAUNDRY", ["laundry"]);
        R("secondary", "MECH", ["mech"]);
        R("secondary", "WALK-IN CLOSET", ["wic", "w.i.c.", "walk-in closet", "walk in closet"]);
        R("secondary", "FOYER", ["foyer"]);
        R("secondary", "PORCH", ["porch"]);

        R("small", "PWDR", ["pdr", "pwdr"]);
        R("small", "ATTIC ACCESS", ["attic access"]);
        R("small", "REF", ["ref", "ref."], true);
        R("small", "DW", ["dw"], true);
        R("small", "BOWL", ["bowl"], true);
        R("small", "OPT.", ["opt."], true);
        R("small", "OPT", ["opt"], true);
        R("small", "COATS", ["coats"]);
        R("small", "LINEN", ["linen"]);
        R("small", "PANTRY", ["pantry"]);
        R("small", "STORAGE", ["storage"]);
        R("small", "DROP", ["drop"], true);
        R("small", "ZONE", ["zone"], true);
        R("small", "CLOSET", ["closet"]);
        R("small", "D", ["d"], true);
        R("small", "W", ["w"], true);
        R("small", "FRENCH DOOR", ["fr dr", "french door"]);
        R("small", "LINE OF OPTIONAL", ["line of optional"]);
        R("small", "F.A.U.", ["f.a.u."]);
        R("small", "OPT. VAULTED CEILING", ["opt. vaulted clg.", "opt. vaulted ceiling"]);
        R("small", "LINE OF VAULTED CEILING", ["line of vaulted ceiling"]);
        R("small", "VAULTED CEILING", ["vaulted ceiling"]);
        R("small", "OPT. FIREPLACE", ["opt. elec. f.p."]);
        R("small", "OPT. WINDOW", ["opt. 2/4x5/0"]);
        R("small", "END UNIT ONLY", ["end unit only"]);
        R("small", "AT END CONDITION", ["at end condition"]);
        R("small", "SINK", ["sink"]);
        R("small", "WH", ["wh"], true);

        return {
            version: 3,
            cfg: {
                scope: "document", dryRun: false, moveOptNames: false, restyle: true,
                updnEnabled: true, wrapLabels: true, removeJunk: true, looseMatch: true,
                dashedEnabled: false, allLinesEnabled: false, arrowsEnabled: false,
                groupGraphicsEnabled: false, capLayersEnabled: false, capTextEnabled: false,
                reportEnabled: true, reportItems: false,
                looseMinLength: 4, looseMaxLength: 40, updnMaxLength: 14,
                optLayer: "Opt_Names", runSet: "standard"
            },
            dashed: {
                enabled: true, applyDashSpace: true, applyColor: true, applyWeight: true,
                selectAfter: false, strokeWeight: 0.5, dash: 3, space: 2
            },
            allLines: {
                applyWeight: true, applyColor: true, weight: 0.5, color: [0, 0, 0],
                skipDashed: false, selectAfter: false
            },
            arrows: { keywords: ["arrow"], detectTriangles: true, triMax: 24, detectGlyphs: true },
            universal: { layersIncludeSub: true, textMode: "upper", selectTexts: false },
            groupGraphics: {
                unit: "in", tolerance: 0.05, maxGap: 2.0, allowRotated: false,
                useVisibleBounds: false, requireAllParts: true, applyColor: true,
                sets: [
                    { name: "Group 1", color: [84,
