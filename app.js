(function () {
    var BASE_URL = window.VG_BASE_URL || "";
    var VERSION_URL = BASE_URL + "version.json";
    var CSS_URL = BASE_URL + "style.css";
    var UI_URL = BASE_URL + "ui.html";

    // Single reused CSInterface instance (faster, avoids memory leaks)
    var cs = new CSInterface();

    // App State
    var state = {
        version: null,
        interval: 5 * 60 * 60 * 1000, // Default: 5 hours (18000000 ms)
        timer: null,
        config: null,
        currentViewId: null,
        lastUpdatedText: "",
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
        return BASE_URL + path.replace(/^\/+/, "");
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
        text.innerText = message || "Processing...";
        pct.innerText = safePct + "%";

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

    // Listen for live progress events dispatched from Illustrator JSX
    cs.addEventListener("com.vg.tools.progress", function (event) {
        try {
            var data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
            updateProgress(data.percent, data.message);
        } catch (e) {
            console.error("Progress event parse error:", e);
        }
    });

    // =====================================================
    // LOAD SHELL UI & CSS
    // =====================================================
    function loadRemoteCSS() {
        return fetch(noCache(CSS_URL))
            .then(function (res) { return res.text(); })
            .then(function (css) {
                var old = document.getElementById("remote-style");
                if (old) old.remove();
                var style = document.createElement("style");
                style.id = "remote-style";
                style.innerHTML = css;
                document.head.appendChild(style);
            });
    }

    function loadShellUI() {
        return fetch(noCache(UI_URL))
            .then(function (res) { return res.text(); })
            .then(function (html) {
                var root = document.getElementById("root");
                if (!root) return;
                root.innerHTML = html;
                bindShellEvents();
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
                loadView(this.value);
            };
        }
    }

    // =====================================================
    // LOAD CONFIG (version.json)
    // =====================================================
    function loadConfig(forceReload) {
        return fetch(noCache(VERSION_URL))
            .then(function (res) {
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

                // Format last updated timestamp (prefer version.json, fallback to HTTP header or sync time)
                var dateText = data.lastUpdated
                    || (result.lastMod ? new Date(result.lastMod).toLocaleString() : new Date().toLocaleString());
                state.lastUpdatedText = "v" + state.version + " • Updated: " + dateText;
                renderLastUpdated();

                // Populate dropdown from version.json
                populateDropdown(data.views || [], data.defaultView);

                // Load selected or default view
                var targetView = state.currentViewId || data.defaultView || (data.views && data.views[0] && data.views[0].id);
                if (targetView) {
                    loadView(targetView, forceReload);
                }

                startAutoUpdater();
            });
    }

    function renderLastUpdated() {
        var el = document.getElementById("lastUpdatedText");
        if (el) {
            el.innerText = state.lastUpdatedText;
        }
    }

    // =====================================================
    // DROPDOWN & DYNAMIC VIEW LOADER
    // =====================================================
    function populateDropdown(views, defaultView) {
        var select = document.getElementById("viewSelector");
        if (!select) return;

        select.innerHTML = "";
        views.forEach(function (view) {
            var opt = document.createElement("option");
            opt.value = view.id;
            opt.innerText = view.label || view.id;
            select.appendChild(opt);
        });

        if (state.currentViewId && views.some(function (v) { return v.id === state.currentViewId; })) {
            select.value = state.currentViewId;
        } else if (defaultView) {
            select.value = defaultView;
        }
    }

    function loadView(viewId, forceReload) {
        if (!state.config || !state.config.views) return;

        var viewObj = state.config.views.find(function (v) { return v.id === viewId; });
        if (!viewObj) return;

        state.currentViewId = viewId;
        var container = document.getElementById("view-container");
        if (!container) return;

        var renderHtml = function (html) {
            container.innerHTML = html;

            // Execute any inline <script> tags inside the loaded remote HTML view
            var scripts = container.querySelectorAll("script");
            scripts.forEach(function (oldScript) {
                var newScript = document.createElement("script");
                if (oldScript.src) {
                    newScript.src = noCache(resolveUrl(oldScript.src));
                } else {
                    newScript.textContent = oldScript.textContent;
                }
                oldScript.parentNode.replaceChild(newScript, oldScript);
            });

            // Auto-wire any buttons with data-jsx="url" inside custom HTML views
            bindDeclarativeJsxButtons(container);

            // If this view contains #sections or #buttons, populate them from version.json
            if (document.getElementById("sections")) {
                createSections(state.config.sections || []);
            }
            if (document.getElementById("buttons")) {
                createButtons(state.config.buttons || []);
            }
        };

        // Use cached HTML unless Refresh UI was clicked
        if (!forceReload && state.cache.views[viewId]) {
            renderHtml(state.cache.views[viewId]);
            return;
        }

        container.innerHTML = "<div class='view-loading'>Loading " + (viewObj.label || viewId) + "...</div>";

        fetch(noCache(resolveUrl(viewObj.html)))
            .then(function (res) { return res.text(); })
            .then(function (html) {
                state.cache.views[viewId] = html;
                renderHtml(html);
            })
            .catch(function (err) {
                console.error("View load failed:", err);
                container.innerHTML = "<div style='color:#ff6b6b;padding:10px;'>Failed to load view: " + viewObj.html + "</div>";
            });
    }

    function bindDeclarativeJsxButtons(scope) {
        var btns = scope.querySelectorAll("[data-jsx]");
        btns.forEach(function (btn) {
            btn.addEventListener("click", function () {
                var scriptUrl = btn.getAttribute("data-jsx");
                runRemoteScript(scriptUrl);
            });
        });
    }

    // =====================================================
    // RENDER SECTIONS & BUTTONS
    // =====================================================
    function createButtons(buttons) {
        var container = document.getElementById("buttons");
        if (!container) return;
        container.innerHTML = "";

        buttons.forEach(function (btn) {
            var button = document.createElement("button");
            button.innerText = btn.label || "Unnamed";
            button.className = "tool-btn";
            button.onclick = function () {
                runRemoteScript(btn.script, btn.params || null);
            };
            container.appendChild(button);
        });
    }

    function createSections(sections) {
        var container = document.getElementById("sections");
        if (!container) return;
        container.innerHTML = "";

        sections.forEach(function (section) {
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

            (section.buttons || []).forEach(function (btn) {
                var button = document.createElement("button");
                button.className = "tool-btn";
                button.innerText = btn.label || "Unnamed";
                button.onclick = function (e) {
                    if (e && e.stopPropagation) e.stopPropagation();
                    if (btn.script) runRemoteScript(btn.script, btn.params || null);
                };
                sub.appendChild(button);
            });

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
        });
    }

    // =====================================================
    // RUN REMOTE JSX (WITH CACHING + LIVE PROGRESS BRIDGE)
    // =====================================================
    function runRemoteScript(url, customData, callback) {
        var fullUrl = resolveUrl(url);
        var inputEl = document.getElementById("messageInput");
        var inputValue = inputEl ? inputEl.value : "";

        updateProgress(10, "Loading script...");

        var fetchPromise = state.cache.scripts[fullUrl]
            ? Promise.resolve(state.cache.scripts[fullUrl])
            : fetch(noCache(fullUrl)).then(function (res) { return res.text(); }).then(function (code) {
                state.cache.scripts[fullUrl] = code;
                return code;
            });

        fetchPromise
            .then(function (code) {
                if (code.indexOf("<html") !== -1 || code.indexOf("<!DOCTYPE") !== -1) {
                    hideProgress();
                    alert("Invalid JSX file received from server.");
                    return;
                }

                updateProgress(25, "Running in Illustrator...");

                var safeInput = String(inputValue)
                    .replace(/\\/g, "\\\\")
                    .replace(/'/g, "\\'")
                    .replace(/\r?\n/g, "\\n");

                var safeJsonData = JSON.stringify(customData || {});

                // Inject vgProgress(percent, message) helper into every JSX script automatically
                var wrapped =
                    "#target illustrator\n" +
                    "#targetengine 'temp_" + Date.now() + "'\n" +
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
                    code +
                    "\n})();";

                cs.evalScript(wrapped, function (res) {
                    updateProgress(100, "Done!");
                    if (typeof callback === "function") callback(res);
                });
            })
            .catch(function (err) {
                console.error("JSX error:", err);
                updateProgress(100, "Script failed!");
            });
    }

    // =====================================================
    // 5-HOUR AUTO-UPDATER & MANUAL REFRESH
    // =====================================================
    function startAutoUpdater() {
        if (state.timer) clearInterval(state.timer);
        state.timer = setInterval(checkForUpdateSilent, state.interval);
    }

    function checkForUpdateSilent() {
        fetch(noCache(VERSION_URL))
            .then(function (res) { return res.json(); })
            .then(function (data) {
                // Only refresh if version on GitHub actually changed
                if (data.version && data.version !== state.version) {
                    forceRefreshAll();
                }
            })
            .catch(function (err) {
                console.error("Silent update check failed:", err);
            });
    }

    function forceRefreshAll() {
        updateProgress(20, "Refreshing UI from GitHub...");
        // Clear all cached views and JSX scripts
        state.cache.views = {};
        state.cache.scripts = {};

        Promise.all([loadRemoteCSS(), loadShellUI()])
            .then(function () {
                updateProgress(65, "Updating config...");
                return loadConfig(true);
            })
            .then(function () {
                updateProgress(100, "UI Updated!");
            })
            .catch(function (err) {
                console.error("Refresh failed:", err);
                updateProgress(100, "Refresh failed");
            });
    }

    // Expose global API so any custom HTML view can interact with Illustrator & Progress Bar
    window.VGTools = {
        runScript: runRemoteScript,
        setProgress: updateProgress,
        refresh: forceRefreshAll,
        getConfig: function () { return state.config; }
    };

    // =====================================================
    // BOOTSTRAP
    // =====================================================
    Promise.all([loadRemoteCSS(), loadShellUI()])
        .then(function () { return loadConfig(true); })
        .catch(function (err) { console.error("Init error:", err); });
})();
