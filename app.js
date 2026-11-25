(function () {
    "use strict";

    var rawBase = window.VG_BASE_URL || "";
    var BASE_URL = rawBase ? (rawBase.charAt(rawBase.length - 1) === "/" ? rawBase : rawBase + "/") : "";

    var VERSION_URL = BASE_URL + "version.json";
    var CSS_URL = BASE_URL + "style.css";
    var UI_URL = BASE_URL + "ui.html";
    var FEATURES_JS_URL = BASE_URL + "js/custom_features.js";

    var cs = new CSInterface();

    // Block right-click View Page Source outside editable controls and log panel
    document.addEventListener("contextmenu", function (e) {
        var target = e.target;
        var allow = false;

        while (target && target !== document) {
            if (
                target.tagName === "INPUT" ||
                target.tagName === "TEXTAREA" ||
                target.isContentEditable ||
                target.id === "vgLogBox" ||
                target.id === "vgLogPanel"
            ) {
                allow = true;
                break;
            }
            target = target.parentNode;
        }

        if (!allow) {
            e.preventDefault();
            return false;
        }
    }, true);

    var state = {
        version: null,
        interval: 5 * 60 * 60 * 1000, // 5 hours
        timer: null,
        config: null,
        currentViewId: null,
        lastUpdatedText: "",
        logs: [],
        cache: {
            views: {},
            scripts: {}
        }
    };

    // =====================================================
    // UTILITIES
    // =====================================================
    function noCache(url) {
        var sep = url.indexOf("?") === -1 ? "?" : "&";
        return url + sep + "v=" + Date.now() + "_" + Math.random().toString(36).slice(2, 7);
    }

    function resolveUrl(path) {
        if (!path) return "";
        if (path.indexOf("http://") === 0 || path.indexOf("https://") === 0) {
            return path;
        }
        return BASE_URL + String(path).replace(/^\/+/, "");
    }

    function getScriptName(url) {
        if (!url) return "script";
        var clean = String(url).split("?")[0];
        var parts = clean.split("/");
        return parts[parts.length - 1] || clean;
    }

    function formatTime() {
        var d = new Date();
        var hh = ("0" + d.getHours()).slice(-2);
        var mm = ("0" + d.getMinutes()).slice(-2);
        var ss = ("0" + d.getSeconds()).slice(-2);
        return hh + ":" + mm + ":" + ss;
    }

    function sanitizeLogMessage(msg) {
        return String(msg === null || msg === undefined ? "" : msg)
            .replace(/https?:\/\/[^\s"'<>)]+/gi, "[protected]")
            .replace(/\b(?:raw\.githubusercontent\.com|gist\.githubusercontent\.com|github\.com|[a-z0-9-]+\.github\.io)\/[^\s"'<>)]*/gi, "[protected]")
            .replace(/\b(?:views|jsx|js)\/[a-zA-Z0-9_./-]+/g, "[script]");
    }

    // =====================================================
    // GLOBAL SELECTABLE LOG SYSTEM
    // =====================================================
    function addLog(message, type) {
        var entry = {
            time: formatTime(),
            type: type || "info",
            message: sanitizeLogMessage(message)
        };
        state.logs.push(entry);

        if (state.logs.length > 200) {
            state.logs.shift();
        }

        renderAllLogs();
    }

    function renderLogEntry(entry) {
        var box = document.getElementById("vgLogBox");
        if (!box) return;

        var line = document.createElement("div");
        line.className = "log-entry log-" + entry.type;

        var timeSpan = document.createElement("span");
        timeSpan.className = "log-time";
        timeSpan.textContent = "[" + entry.time + "] ";

        var msgSpan = document.createElement("span");
        msgSpan.className = "log-msg";
        msgSpan.textContent = sanitizeLogMessage(entry.message);

        line.appendChild(timeSpan);
        line.appendChild(msgSpan);
        box.appendChild(line);

        box.scrollTop = box.scrollHeight;
    }

    function renderAllLogs() {
        var box = document.getElementById("vgLogBox");
        if (!box) return;
        box.innerHTML = "";
        for (var i = 0; i < state.logs.length; i++) {
            renderLogEntry(state.logs[i]);
        }
        box.scrollTop = box.scrollHeight;
    }

    function copyLogsToClipboard() {
        var lines = [];
        for (var i = 0; i < state.logs.length; i++) {
            var e = state.logs[i];
            lines.push("[" + e.time + "] [" + e.type.toUpperCase() + "] " + sanitizeLogMessage(e.message));
        }
        var text = lines.join("\n");
        if (!text) return;

        var ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        try {
            document.execCommand("copy");
            addLog("Log copied to clipboard.", "info");
        } catch (err) {
            addLog("Copy failed: " + err.message, "error");
        }
        document.body.removeChild(ta);
    }

    function formatJsxResult(scriptLabel, rawRes) {
        if (rawRes === "EvalScript error.") {
            addLog(scriptLabel + " -> EvalScript error (JSX syntax/runtime issue).", "error");
            return;
        }

        if (rawRes === undefined || rawRes === null || rawRes === "" || rawRes === "undefined") {
            addLog(scriptLabel + " -> Completed (no return value).", "success");
            return;
        }

        try {
            var data = JSON.parse(rawRes);
            if (data && typeof data === "object") {
                if (data.ok === false) {
                    addLog(scriptLabel + " -> " + (data.error || "Failed."), "error");
                    return;
                }

                var summaryParts = [];
                if (data.message) summaryParts.push(data.message);

                for (var key in data) {
                    if (data.hasOwnProperty(key) && key !== "ok" && key !== "message" && key !== "error") {
                        summaryParts.push(key + ": " + data[key]);
                    }
                }

                var summary = summaryParts.length > 0 ? summaryParts.join(" | ") : "Success";
                addLog(scriptLabel + " -> " + summary, "success");
                return;
            }
        } catch (e) {
            // Plain string return from JSX
        }

        addLog(scriptLabel + " -> " + String(rawRes), "success");
    }

    // =====================================================
    // LOG DRAG-TO-RESIZE & FOOTER SYNC
    // =====================================================
    var logDragState = {
        active: false,
        startY: 0,
        startHeight: 0,
        bound: false
    };

    var LOG_MIN_HEIGHT = 60;
    var LOG_STORAGE_KEY = "vg_tools_log_height";

    function syncFooterPadding() {
        var footer = document.querySelector(".footer-info");
        var logPanel = document.getElementById("vgLogPanel");
        if (!footer || !logPanel) return;
        footer.style.paddingBottom = (logPanel.offsetHeight + 16) + "px";
    }

    function clampLogHeight(desiredHeight) {
        var maxHeight = Math.max(LOG_MIN_HEIGHT, window.innerHeight - 170);
        return Math.max(LOG_MIN_HEIGHT, Math.min(maxHeight, desiredHeight));
    }

    function initLogResizer() {
        var resizer = document.getElementById("vgLogResizer");
        var logBox = document.getElementById("vgLogBox");
        var logPanel = document.getElementById("vgLogPanel");
        if (!resizer || !logBox || !logPanel) return;

        try {
            var saved = parseInt(localStorage.getItem(LOG_STORAGE_KEY), 10);
            if (!isNaN(saved) && saved >= LOG_MIN_HEIGHT) {
                logBox.style.height = clampLogHeight(saved) + "px";
            }
        } catch (e) {}

        syncFooterPadding();

        resizer.addEventListener("mousedown", function (e) {
            if (logPanel.classList.contains("collapsed")) return;
            e.preventDefault();

            logDragState.active = true;
            logDragState.startY = e.clientY;
            logDragState.startHeight = logBox.offsetHeight;

            resizer.classList.add("dragging");
            document.body.classList.add("vg-resizing-log");
        });

        if (!logDragState.bound) {
            logDragState.bound = true;

            document.addEventListener("mousemove", function (e) {
                if (!logDragState.active) return;
                var box = document.getElementById("vgLogBox");
                if (!box) return;

                var deltaY = logDragState.startY - e.clientY;
                box.style.height = clampLogHeight(logDragState.startHeight + deltaY) + "px";
                syncFooterPadding();
            });

            document.addEventListener("mouseup", function () {
                if (!logDragState.active) return;

                logDragState.active = false;
                var handle = document.getElementById("vgLogResizer");
                var box = document.getElementById("vgLogBox");
                if (handle) handle.classList.remove("dragging");
                document.body.classList.remove("vg-resizing-log");

                if (box) {
                    try {
                        localStorage.setItem(LOG_STORAGE_KEY, String(box.offsetHeight));
                    } catch (e) {}
                }
            });

            window.addEventListener("resize", function () {
                var box = document.getElementById("vgLogBox");
                var panel = document.getElementById("vgLogPanel");
                if (box && panel && !panel.classList.contains("collapsed")) {
                    box.style.height = clampLogHeight(box.offsetHeight) + "px";
                }
                syncFooterPadding();
            });
        }
    }

    // =====================================================
    // LIVE PROGRESS BAR (CONNECTED TO JSX VIA CSXSEvent)
    // =====================================================
    var progressHideTimer = null;

    function updateProgress(percent, message) {
        var wrap = document.getElementById("progressWrap");
        var fill = document.getElementById("progressFill");
        var text = document.getElementById("progressText");
        var pct = document.getElementById("progressPercent");

        if (!wrap || !fill || !text || !pct) return;

        if (progressHideTimer) {
            clearTimeout(progressHideTimer);
            progressHideTimer = null;
        }

        var safePct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        wrap.classList.add("visible");
        fill.style.width = safePct + "%";
        text.textContent = sanitizeLogMessage(message || "Processing...");
        pct.textContent = safePct + "%";

        if (safePct >= 100) {
            progressHideTimer = setTimeout(function () {
                wrap.classList.remove("visible");
            }, 1800);
        }
    }

    function hideProgress() {
        var wrap = document.getElementById("progressWrap");
        if (wrap) wrap.classList.remove("visible");
    }

    cs.addEventListener("com.vg.tools.progress", function (event) {
        try {
            var data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            updateProgress(data.percent, data.message);
        } catch (e) {
            console.error("Progress event parse error:", e);
        }
    });

    // =====================================================
    // CUSTOM FEATURES MODULE BRIDGE (INLINE INJECTION)
    // =====================================================
    function loadCustomFeaturesModule() {
        return new Promise(function (resolve) {
            var old = document.getElementById("vg-custom-features-js");
            if (old) old.remove();

            fetch(noCache(FEATURES_JS_URL), { cache: "no-store" })
                .then(function (res) {
                    if (!res.ok) throw new Error("HTTP " + res.status);
                    return res.text();
                })
                .then(function (code) {
                    var script = document.createElement("script");
                    script.id = "vg-custom-features-js";
                    script.textContent = code;
                    document.body.appendChild(script);
                    resolve(true);
                })
                .catch(function () {
                    addLog("Optional feature module not loaded.", "warn");
                    resolve(false);
                });
        });
    }

    function notifyFeatureHandlers(viewId) {
        if (window.VGFeatureHandlers && typeof window.VGFeatureHandlers.initView === "function") {
            try {
                window.VGFeatureHandlers.initView(viewId, state.config);
            } catch (err) {
                addLog("Feature handler error (" + viewId + "): " + err.message, "error");
            }
        }
    }

    // =====================================================
    // LOAD SHELL UI & CSS
    // =====================================================
    function loadRemoteCSS() {
        return fetch(noCache(CSS_URL), { cache: "no-store" })
            .then(function (res) {
                if (!res.ok) throw new Error("CSS HTTP " + res.status);
                return res.text();
            })
            .then(function (css) {
                var old = document.getElementById("remote-style");
                if (old) old.remove();
                var style = document.createElement("style");
                style.id = "remote-style";
                style.textContent = css;
                document.head.appendChild(style);
            });
    }

    function loadShellUI() {
        return fetch(noCache(UI_URL), { cache: "no-store" })
            .then(function (res) {
                if (!res.ok) throw new Error("UI HTTP " + res.status);
                return res.text();
            })
            .then(function (html) {
                var root = document.getElementById("root");
                if (!root) return;
                root.innerHTML = html;
                bindShellEvents();
                renderAllLogs();
            });
    }

    function bindShellEvents() {
        var refreshBtn = document.getElementById("refreshUiBtn");
        if (refreshBtn) {
            refreshBtn.onclick = function () {
                forceRefreshAll();
            };
        }

        var viewSelect = document.getElementById("viewSelector");
        if (viewSelect) {
            viewSelect.onchange = function () {
                loadView(this.value, false);
            };
        }

        var copyBtn = document.getElementById("vgLogCopyBtn");
        if (copyBtn) {
            copyBtn.onclick = copyLogsToClipboard;
        }

        var clearBtn = document.getElementById("vgLogClearBtn");
        if (clearBtn) {
            clearBtn.onclick = function () {
                state.logs = [];
                renderAllLogs();
            };
        }

        var toggleBtn = document.getElementById("vgLogToggleBtn");
        var logPanel = document.getElementById("vgLogPanel");
        if (toggleBtn && logPanel) {
            toggleBtn.onclick = function () {
                var collapsed = logPanel.classList.toggle("collapsed");
                toggleBtn.textContent = collapsed ? "▲" : "▼";
                syncFooterPadding();
            };
        }

        initLogResizer();
    }

    // =====================================================
    // LOAD CONFIG (version.json)
    // =====================================================
    function loadConfig(forceReload) {
        return fetch(noCache(VERSION_URL), { cache: "no-store" })
            .then(function (res) {
                if (!res.ok) throw new Error("Config HTTP " + res.status);
                var lastMod = res.headers.get("Last-Modified");
                return res.json().then(function (data) {
                    return { data: data, lastMod: lastMod };
                });
            })
            .then(function (result) {
                var data = result.data;
                state.config = data;
                state.version = data.version || "1.0.0";
                state.interval = data.interval || (5 * 60 * 60 * 1000);

                var dateText = data.lastUpdated
                    || (result.lastMod ? new Date(result.lastMod).toLocaleString() : new Date().toLocaleString());
                state.lastUpdatedText = "v" + state.version + " • Updated: " + dateText;
                renderLastUpdated();

                addLog("VG Tools v" + state.version + " ready.", "info");

                populateDropdown(data.views || [], data.defaultView);

                var targetView = state.currentViewId
                    || data.defaultView
                    || (data.views && data.views.length > 0 ? data.views[0].id : null);

                if (targetView) {
                    loadView(targetView, forceReload);
                }

                startAutoUpdater();
            })
            .catch(function (err) {
                addLog("Config load failed: " + err.message, "error");
            });
    }

    function renderLastUpdated() {
        var el = document.getElementById("lastUpdatedText");
        if (el) el.textContent = state.lastUpdatedText;
    }

    // =====================================================
    // DROPDOWN & DYNAMIC VIEW LOADER
    // =====================================================
    function populateDropdown(views, defaultView) {
        var select = document.getElementById("viewSelector");
        if (!select) return;

        select.innerHTML = "";
        var hasCurrent = false;

        for (var i = 0; i < views.length; i++) {
            var opt = document.createElement("option");
            opt.value = views[i].id;
            opt.textContent = views[i].label || views[i].id;
            select.appendChild(opt);
            if (views[i].id === state.currentViewId) hasCurrent = true;
        }

        if (hasCurrent) {
            select.value = state.currentViewId;
        } else if (defaultView) {
            select.value = defaultView;
        }
    }

    function loadView(viewId, forceReload) {
        if (!state.config || !state.config.views) return;

        var viewObj = null;
        for (var i = 0; i < state.config.views.length; i++) {
            if (state.config.views[i].id === viewId) {
                viewObj = state.config.views[i];
                break;
            }
        }
        if (!viewObj) return;

        state.currentViewId = viewId;
        var container = document.getElementById("view-container");
        if (!container) return;

        var renderHtml = function (html) {
            container.innerHTML = html;

            var scripts = container.getElementsByTagName("script");
            var scriptList = [];
            for (var s = 0; s < scripts.length; s++) {
                scriptList.push(scripts[s]);
            }
            for (var k = 0; k < scriptList.length; k++) {
                var oldScript = scriptList[k];
                var newScript = document.createElement("script");
                if (oldScript.src) {
                    (function (srcAttr, targetEl, replacementEl) {
                        fetch(noCache(resolveUrl(srcAttr)), { cache: "no-store" })
                            .then(function (r) { return r.ok ? r.text() : ""; })
                            .then(function (txt) {
                                if (txt) {
                                    replacementEl.textContent = txt;
                                    if (targetEl.parentNode) targetEl.parentNode.replaceChild(replacementEl, targetEl);
                                }
                            })
                            .catch(function () {});
                    })(oldScript.getAttribute("src"), oldScript, newScript);
                } else {
                    newScript.textContent = oldScript.textContent;
                    oldScript.parentNode.replaceChild(newScript, oldScript);
                }
            }

            bindDeclarativeJsxButtons(container);

            if (document.getElementById("sections")) {
                createSections(state.config.sections || []);
            }
            if (document.getElementById("buttons")) {
                createButtons(state.config.buttons || []);
            }

            notifyFeatureHandlers(viewId);
            syncFooterPadding();
            renderAllLogs();
        };

        if (!forceReload && state.cache.views[viewId]) {
            renderHtml(state.cache.views[viewId]);
            addLog("Switched view: " + (viewObj.label || viewId), "info");
            return;
        }

        container.innerHTML = "<div class='view-loading'>Loading " + (viewObj.label || viewId) + "...</div>";

        fetch(noCache(resolveUrl(viewObj.html)), { cache: "no-store" })
            .then(function (res) {
                if (!res.ok) throw new Error("HTTP " + res.status);
                return res.text();
            })
            .then(function (html) {
                state.cache.views[viewId] = html;
                renderHtml(html);
                addLog("Loaded view: " + (viewObj.label || viewId), "info");
            })
            .catch(function (err) {
                var viewName = viewObj.label || viewId;
                addLog("View load failed (" + viewName + "): " + err.message, "error");
                container.innerHTML = "<div style='color:#ff6b6b;padding:10px;'>Failed to load " + viewName + " (" + sanitizeLogMessage(err.message) + ").</div>";
            });
    }

    function bindDeclarativeJsxButtons(scope) {
        var btns = scope.querySelectorAll("[data-jsx]");
        for (var i = 0; i < btns.length; i++) {
            (function (btn) {
                btn.addEventListener("click", function () {
                    var scriptUrl = btn.getAttribute("data-jsx");
                    var label = btn.textContent ? btn.textContent.trim() : getScriptName(scriptUrl);
                    runRemoteScript(scriptUrl, null, null, label);
                });
            })(btns[i]);
        }
    }

    // =====================================================
    // RENDER SECTIONS & BUTTONS
    // =====================================================
    function createButtons(buttons) {
        var container = document.getElementById("buttons");
        if (!container) return;
        container.innerHTML = "";

        for (var i = 0; i < buttons.length; i++) {
            (function (btn) {
                var button = document.createElement("button");
                button.textContent = btn.label || "Unnamed";
                button.className = "tool-btn";
                button.onclick = function () {
                    runRemoteScript(btn.script, btn.params || null, null, btn.label);
                };
                container.appendChild(button);
            })(buttons[i]);
        }
    }

    function createSections(sections) {
        var container = document.getElementById("sections");
        if (!container) return;
        container.innerHTML = "";

        for (var s = 0; s < sections.length; s++) {
            (function (section) {
                var accordion = document.createElement("div");
                accordion.className = "accordion";

                var header = document.createElement("div");
                header.className = "accordion-header";
                header.innerHTML = "<span>" + (section.title || "Tools") + "</span><span class='accordion-icon'>▼</span>";

                var content = document.createElement("div");
                content.className = "accordion-content";
                content.style.maxHeight = "0px";

                var sub = document.createElement("div");
                sub.className = "button-sub layout-" + (section.layout || "column");

                var btns = section.buttons || [];
                for (var b = 0; b < btns.length; b++) {
                    (function (btn) {
                        var button = document.createElement("button");
                        button.className = "tool-btn";
                        button.textContent = btn.label || "Unnamed";
                        button.onclick = function (e) {
                            if (e && e.stopPropagation) e.stopPropagation();
                            if (btn.script) runRemoteScript(btn.script, btn.params || null, null, btn.label);
                        };
                        sub.appendChild(button);
                    })(btns[b]);
                }

                content.appendChild(sub);
                accordion.appendChild(header);
                accordion.appendChild(content);
                container.appendChild(accordion);

                header.onclick = function () {
                    var isActive = header.classList.contains("active");
                    var headers = container.getElementsByClassName("accordion-header");
                    for (var i = 0; i < headers.length; i++) {
                        headers[i].classList.remove("active");
                        if (headers[i].nextElementSibling) {
                            headers[i].nextElementSibling.style.maxHeight = "0px";
                        }
                    }
                    if (!isActive) {
                        header.classList.add("active");
                        content.style.maxHeight = content.scrollHeight + 20 + "px";
                    }
                };
            })(sections[s]);
        }
    }

    // =====================================================
    // RUN REMOTE JSX (UNIVERSAL RUNNER)
    // =====================================================
    function runRemoteScript(url, customData, callback, actionLabel) {
        var fullUrl = resolveUrl(url);
        var label = actionLabel || getScriptName(url);
        var inputEl = document.getElementById("messageInput");
        var inputValue = inputEl ? inputEl.value : "";

        addLog("Running: " + label + "...", "info");
        updateProgress(10, "Loading " + label + "...");

        var fetchPromise = state.cache.scripts[fullUrl]
            ? Promise.resolve(state.cache.scripts[fullUrl])
            : fetch(noCache(fullUrl), { cache: "no-store" }).then(function (res) {
                if (!res.ok) {
                    throw new Error("HTTP " + res.status);
                }
                return res.text();
            }).then(function (code) {
                state.cache.scripts[fullUrl] = code;
                return code;
            });

        fetchPromise
            .then(function (code) {
                if (code.indexOf("<html") !== -1 || code.indexOf("<!DOCTYPE") !== -1) {
                    hideProgress();
                    addLog(label + " -> Invalid script response (received HTML).", "error");
                    if (typeof callback === "function") {
                        callback(JSON.stringify({ ok: false, error: "Invalid script response." }));
                    }
                    return;
                }

                var cleanCode = code
                    .replace(/^\s*#target[^\r\n]*/gm, "")
                    .replace(/^\s*#targetengine[^\r\n]*/gm, "");

                updateProgress(25, "Running in Illustrator...");

                var safeInput = String(inputValue)
                    .replace(/\\/g, "\\\\")
                    .replace(/'/g, "\\'")
                    .replace(/\r?\n/g, "\\n");

                var safeJsonData = JSON.stringify(customData || {});

                var wrapped =
                    "var panelInput = '" + safeInput + "';\n" +
                    "var panelData = " + safeJsonData + ";\n" +
                    "var _vgPlugPlug = null;\n" +
                    "try { _vgPlugPlug = new ExternalObject('lib:PlugPlugExternalObject'); } catch(e) {}\n" +
                    "function vgProgress(percent, message) {\n" +
                    "    if (!_vgPlugPlug) return;\n" +
                    "    try {\n" +
                    "        var ev = new CSXSEvent();\n" +
                    "        ev.type = 'com.vg.tools.progress';\n" +
                    "        var msg = String(message || '').replace(/\\\\/g, '\\\\\\\\').replace(/\"/g, '\\\\\"').replace(/\\r?\\n/g, ' ');\n" +
                    "        ev.data = '{\"percent\":' + (Number(percent) || 0) + ',\"message\":\"' + msg + '\"}';\n" +
                    "        ev.dispatch();\n" +
                    "    } catch(e) {}\n" +
                    "}\n" +
                    "(function(){\n" +
                    cleanCode +
                    "\n})();";

                cs.evalScript(wrapped, function (res) {
                    if (res === "EvalScript error.") {
                        updateProgress(100, "JSX Error!");
                    } else {
                        updateProgress(100, "Done!");
                    }
                    formatJsxResult(label, res);
                    if (typeof callback === "function") callback(res);
                });
            })
            .catch(function (err) {
                updateProgress(100, "Script failed!");
                addLog(label + " -> " + err.message, "error");
                if (typeof callback === "function") {
                    callback(JSON.stringify({ ok: false, error: err.message }));
                }
            });
    }

    // =====================================================
    // 5-HOUR AUTO-UPDATER & FULL REFRESH
    // =====================================================
    function startAutoUpdater() {
        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(checkForUpdateSilent, state.interval);
    }

    function checkForUpdateSilent() {
        fetch(noCache(VERSION_URL), { cache: "no-store" })
            .then(function (res) { return res.json(); })
            .then(function (data) {
                if (data.version && data.version !== state.version) {
                    forceRefreshAll();
                }
            })
            .catch(function (err) {
                addLog("Update check failed: " + err.message, "warn");
            });
    }

    function forceRefreshAll() {
        window.location.reload();
    }

    window.VGTools = {
        runScript: runRemoteScript,
        log: addLog,
        setProgress: updateProgress,
        refresh: forceRefreshAll,
        getConfig: function () { return state.config; }
    };

    // =====================================================
    // BOOTSTRAP
    // =====================================================
    Promise.all([loadRemoteCSS(), loadShellUI(), loadCustomFeaturesModule()])
        .then(function () {
            renderAllLogs();
            syncFooterPadding();
            return loadConfig(true);
        })
        .then(function () {
            renderAllLogs();
        })
        .catch(function (err) {
            addLog("Init error: " + err.message, "error");
            var root = document.getElementById("root");
            if (root && !document.getElementById("vgLogBox")) {
                root.innerHTML = "<div style='color:#ff6b6b;padding:12px;font-size:12px;'>Init error: " + sanitizeLogMessage(err.message) + "</div>";
            }
        });
})();
