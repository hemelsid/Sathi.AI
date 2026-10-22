/* সাথী AI — app: state, agent loop, UI */
(function (W) {
  "use strict";
  var S = W.Shathi, A = S.A, $ = S.$, $$ = S.$$, esc = S.esc;
  var ui = S.ui = {};

  /* =========================================================
   * settings, providers, memory, chats
   * ========================================================= */
  var DEF = {
    v: 2, providers: [], defaultModel: "auto", customModels: [], profile: "", memoryOn: true,
    voice: { input: "auto", output: "device", rate: 1.0, autoSpeak: false, lang: "bn", aiVoice: "Kore" },
    agent: { confirmFiles: true, maxSteps: 16 }, theme: "dark"
  };
  function merge(d, o) {
    var r = JSON.parse(JSON.stringify(d));
    for (var k in (o || {})) r[k] = (o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) && d[k] && typeof d[k] === "object") ? merge(d[k], o[k]) : o[k];
    return r;
  }
  S.settings = merge(DEF, S.store.load("settings", {}));
  var saveSettings = S.debounce(function () { S.store.save("settings", S.settings); }, 300);
  S.saveSettings = saveSettings;

  S.providers = {
    usable: function () { return S.settings.providers.filter(function (p) { return p.enabled !== false && (p.key || S.preset(p.preset).noKey); }); },
    find: function (preset) { var u = S.providers.usable(); for (var i = 0; i < u.length; i++) if (u[i].preset === preset) return u[i]; return null; },
    byId: function (id) { for (var i = 0; i < S.settings.providers.length; i++) if (S.settings.providers[i].id === id) return S.settings.providers[i]; return null; },
    add: function (preset, key, extra) {
      var pr = S.preset(preset);
      var p = { id: S.uid(), preset: preset, type: pr.type, name: pr.name, base: pr.base, key: key || "", enabled: true, models: [] };
      for (var k in (extra || {})) p[k] = extra[k];
      S.settings.providers.push(p); saveSettings(); return p;
    },
    refresh: function (p) {
      return S.listModels(p).then(function (ms) { p.models = ms; p.fetchedAt = Date.now(); saveSettings(); return ms; });
    }
  };
  var ORDER = ["gemini", "groq", "openrouter", "cerebras", "mistral", "github", "anthropic", "openai", "deepseek", "xai", "together", "pollinations", "ollama", "custom"];

  S.memory = {
    list: function () { return S.store.load("memory", []); },
    add: function (fact) {
      fact = String(fact || "").trim(); if (!fact) return { error: "empty" };
      var m = S.memory.list();
      if (m.some(function (x) { return x.text === fact; })) return { ok: true, note: "already saved" };
      m.push({ id: S.uid(), text: fact.slice(0, 300), t: Date.now() }); S.store.save("memory", m.slice(-200));
      S.toast("🧠 মনে রাখলাম: " + fact.slice(0, 40)); return { ok: true };
    },
    remove: function (text) {
      var m = S.memory.list(), n = m.length, q = String(text || "").toLowerCase();
      m = m.filter(function (x) { return x.id !== text && x.text.toLowerCase().indexOf(q) < 0; });
      S.store.save("memory", m); return { ok: true, removed: n - m.length };
    }
  };

  var convs = S.store.load("chats", []), cur = null;
  var saveChats = S.debounce(function () {
    var out = convs.filter(function (c) { return c.msgs.length; }).slice(0, 300).map(function (c) {
      return { id: c.id, title: c.title, t: c.t, pinned: c.pinned, model: c.model, agent: c.agent, msgs: c.msgs.map(slim) };
    });
    S.store.save("chats", out);
  }, 700);
  function slim(m) {
    if (m.role !== "user" || !m.files || !m.files.length) {
      if (m.role === "assistant" && m.images) {
        var c = JSON.parse(JSON.stringify(m)); c.images = c.images.map(function (s) { return s.length > 400000 ? "" : s; }); return c;
      }
      return m;
    }
    var c2 = JSON.parse(JSON.stringify(m));
    c2.files = c2.files.map(function (f) {
      if (f.b64 && f.b64.length > 120000) { var g = { name: f.name, mime: f.mime, thumb: f.thumb, note: "[আগে পাঠানো ফাইল: " + f.name + "]" }; return g; }
      return f;
    });
    return c2;
  }
  function newConv() {
    return { id: S.uid(), title: "", t: Date.now(), msgs: [], model: S.settings.defaultModel || "auto", agent: false };
  }

  /* ---- migrate v1 data ---- */
  (function migrate() {
    if (S.store.pref("migrated_v2")) return;
    var oldKey = S.store.pref("api_key");
    if (oldKey && !S.settings.providers.length) S.providers.add("gemini", oldKey);
    var about = S.store.pref("about"); if (about && !S.settings.profile) S.settings.profile = about;
    if (S.store.pref("auto_speak") === "1") S.settings.voice.autoSpeak = true;
    try {
      var old = JSON.parse(localStorage.getItem("convs") || "[]");
      old.forEach(function (c) {
        var msgs = [];
        (c.items || []).forEach(function (it) {
          if (it.role === "user") msgs.push({ id: S.uid(), role: "user", text: it.text, files: (it.att || []).map(function (a) { return { name: a.name, thumb: a.thumb, note: "[" + a.name + "]" }; }) });
          else if (it.role === "bot") msgs.push({ id: S.uid(), role: "assistant", text: it.text });
        });
        if (msgs.length) convs.push({ id: c.id || S.uid(), title: c.title || "পুরনো চ্যাট", t: c.t || Date.now(), msgs: msgs, model: "auto" });
      });
    } catch (e) {}
    S.store.pref("migrated_v2", "1"); saveSettings(); saveChats();
  })();

  /* =========================================================
   * model routing
   * ========================================================= */
  function customById(id) { for (var i = 0; i < S.settings.customModels.length; i++) if (S.settings.customModels[i].id === id) return S.settings.customModels[i]; return null; }
  function autoRoutes() {
    return S.providers.usable().filter(function (p) { return !S.preset(p.preset).mediaOnly; }).slice().sort(function (a, b) { return ORDER.indexOf(a.preset) - ORDER.indexOf(b.preset); })
      .map(function (p) { return { p: p, model: S.pickModel(p) }; }).filter(function (r) { return r.model; });
  }
  function routesFor(ref) {
    ref = ref || "auto";
    if (ref.indexOf("c:") === 0) { var c = customById(ref.slice(2)); return c ? routesFor(c.base || "auto") : autoRoutes(); }
    if (ref.indexOf("p:") === 0) {
      var i = ref.indexOf(":", 2), p = S.providers.byId(ref.slice(2, i)), model = ref.slice(i + 1);
      var first = p ? [{ p: p, model: model, pinned: true }] : [];
      return first.concat(autoRoutes().filter(function (r) { return !p || r.p.id !== p.id; }));
    }
    return autoRoutes();
  }
  S.modelLabel = function (ref) {
    ref = ref || "auto";
    if (ref === "auto") return "✨ সাথী অটো";
    if (ref.indexOf("c:") === 0) { var c = customById(ref.slice(2)); return c ? (c.emoji || "🧬") + " " + c.name : "✨ সাথী অটো"; }
    var i = ref.indexOf(":", 2), p = S.providers.byId(ref.slice(2, i));
    return (p ? p.name + " · " : "") + shortModel(ref.slice(i + 1));
  };
  function shortModel(m) { return String(m || "").replace(/^models\//, "").replace(/^[\w.-]+\//, "").replace(/:free$/, " (ফ্রি)"); }

  /* =========================================================
   * system prompt
   * ========================================================= */
  function systemPrompt(conv, route) {
    var c = conv.model && conv.model.indexOf("c:") === 0 ? customById(conv.model.slice(2)) : null;
    var now = new Date(), L = [];
    if (c) {
      L.push("You are \"" + c.name + "\", a custom AI assistant the user created in the Shathi (সাথী) app.");
      if (c.instructions) L.push("Your instructions from the user:\n" + c.instructions);
    } else {
      L.push("You are 'সাথী' (Shathi), a warm, brilliant and honest AI assistant in an Android app, made for people in Bangladesh. " +
        "You chat naturally like a knowledgeable friend and you can also act as an agent that gets things done with tools.");
    }
    L.push("Current date/time: " + now.toLocaleString("en-GB", { weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }) +
      " (" + Intl.DateTimeFormat().resolvedOptions().timeZone + "). Running on model " + route.model + " via " + route.p.name + ".");
    L.push("Guidelines:\n- Answer directly and helpfully; match length to the question.\n- Use tools whenever they make the answer more correct or current: web_search for news/prices/facts you are unsure of (then cite 1-3 sources as markdown links), calculate/run_code for math, weather, currency, wikipedia, generate_image when asked to draw/create a picture.\n- Never invent facts, numbers, links or quotes. If unsure, search or say so.\n- If the user shares a lasting personal fact or asks you to remember something, call remember.\n- Images: call generate_image with a rich English prompt (pick a fitting style/aspect; count up to 4 for options). Videos: generate_video for a short realistic AI clip; make_story_video for stories, explainers, reels, wishes or ads with narration (free). Ask nothing first unless the request is truly unclear.\n- NEVER say an image or video was made unless the tool result has ok:true. If it failed, say so plainly in one line and point to the setup button.\n- Attached images, PDFs and files are visible to you; analyse them carefully.");
    if (conv.agent) {
      L.push("AGENT MODE is ON. For tasks that need several steps: first write a very short plan (1-3 lines), then use tools one step at a time, check each result, fix problems yourself, and finish with a clear summary of what was done. " +
        "Phone tools (alarm, timer, calendar, call, SMS, email, maps, links) open the relevant app for the user to confirm. Files are saved to Download/Shathi. " +
        "Android does not let apps read other apps' private data, messages or contacts; say so kindly if asked.");
    } else {
      L.push("Agent mode is OFF: phone actions and file tools are unavailable. If the user asks for one, tell them to turn on 'এজেন্ট' (the 🛠 button) and try again.");
    }
    var mem = S.settings.memoryOn ? S.memory.list() : [];
    if (S.settings.profile) L.push("About the user (written by them):\n" + S.settings.profile);
    if (mem.length) L.push("Things you remember about the user:\n" + mem.slice(-60).map(function (m) { return "- " + m.text; }).join("\n"));
    if (c && c.knowledge) L.push("Reference knowledge provided by the user (use it when relevant, prefer it over general knowledge):\n<<<\n" + String(c.knowledge).slice(0, 60000) + "\n>>>");
    L.push("Language & format: reply in the user's language; default to Bangla (বাংলা script) for Bangla or Banglish input. Use clean markdown: short paragraphs, bullet lists, **bold** key points, tables only for comparisons, fenced code blocks for code. No filler or repeated disclaimers.");
    return L.join("\n\n");
  }

  /* =========================================================
   * agent loop
   * ========================================================= */
  var active = null; // {signal, conv}
  function busy() { return !!active; }

  function runTurn(conv) {
    var signal = { cancelled: false, handle: null };
    active = { signal: signal, conv: conv };
    setBusyUI(true);
    var turn = ui.ensureTurn(conv);
    var routes = routesFor(conv.model);
    if (!routes.length) {
      active = null; setBusyUI(false);
      ui.turnError(turn, "কোনো AI যুক্ত নেই। একটা ফ্রি AI (Gemini বা Groq) যোগ করুন।", true);
      return Promise.resolve();
    }
    var custom = conv.model && conv.model.indexOf("c:") === 0 ? customById(conv.model.slice(2)) : null;
    var temp = custom && custom.temperature != null ? custom.temperature : 0.7;
    var ri = 0, noTools = {}, steps = 0, maxSteps = S.settings.agent.maxSteps || 16;

    function step() {
      if (signal.cancelled) return Promise.resolve();
      if (steps++ >= maxSteps) { ui.turnNote(turn, "অনেকগুলো ধাপ হয়ে গেছে, এখানে থামলাম। \"চালিয়ে যাও\" লিখলে আবার শুরু করবে।"); return Promise.resolve(); }
      var route = routes[ri];
      var tools = noTools[route.p.id + route.model] ? [] : S.toolsFor(conv.agent ? "agent" : "chat");
      var live = ui.liveText(turn, route);
      return S.callModel({ p: route.p, model: route.model, system: systemPrompt(conv, route), msgs: conv.msgs, tools: tools,
        temperature: temp, signal: signal, onText: function (t) { live.update(t); } })
        .then(function (r) {
          live.done();
          if (r.cancelled && !r.text && !r.calls.length) return;
          if (route.p.working !== route.model) { route.p.working = route.model; saveSettings(); }
          var msg = { id: S.uid(), role: "assistant", text: r.text, calls: r.calls, prov: route.p.type, provId: route.p.id, model: route.model,
            raw: route.p.type === "gemini" ? r.raw : undefined, sources: r.sources, images: r.images || [] };
          if (!msg.text && !msg.calls.length && !msg.images.length) msg.text = "(কোনো উত্তর আসেনি — আবার চেষ্টা করুন।)";
          conv.msgs.push(msg); saveChats();
          ui.renderAssistant(turn, msg);
          if (r.cancelled || !r.calls.length) return;
          return runCalls(conv, turn, msg, signal).then(step);
        }, function (e) {
          live.done(true);
          if (signal.cancelled) return;
          if (e.kind === "notools" && !noTools[route.p.id + route.model]) { noTools[route.p.id + route.model] = 1; steps--; return step(); }
          if (e.kind === "model" && route.p.working === route.model) { route.p.working = ""; saveSettings(); }
          if (e.kind === "model" && route.p.type === "gemini" && !route.retried) {
            // try the next Gemini model before leaving Gemini
            var alt = S.chatModels(route.p).filter(function (m) { return m !== route.model; })[0];
            if (alt) { routes.splice(ri + 1, 0, { p: route.p, model: alt, retried: true }); }
          }
          if (ri + 1 < routes.length) {
            ri++; steps--;
            if (routes[ri].p.id !== route.p.id) ui.turnNote(turn, e.message + " → " + routes[ri].p.name + " দিয়ে চেষ্টা করছি…");
            return step();
          }
          ui.turnError(turn, e.message, e.kind === "auth");
        });
    }
    return step().then(function () {
      active = null; setBusyUI(false); ui.finishTurn(turn, conv); saveChats();
      var last = conv.msgs[conv.msgs.length - 1];
      if (last && last.role === "assistant" && last.text && (S.settings.voice.autoSpeak || ui.talkOn)) ui.speakMsg(last.text);
      if (ui.talkOn) ui.talkAfterReply(last && last.text);
    });
  }

  function runCalls(conv, turn, msg, signal) {
    var results = [];
    var row = null;
    var ctx = {
      addImage: function (src, meta) {
        var item = typeof meta === "object" && meta ? { src: src, uri: meta.uri, path: meta.path } : src;
        msg.images = (msg.images || []).concat([item]); ui.renderAssistant(turn, msg); saveChats();
      },
      addVideo: function (v) {
        if (v.blob) { VIDEO_BLOBS[v.uri || v.path || S.uid()] = URL.createObjectURL(v.blob); }
        msg.videos = (msg.videos || []).concat([{ uri: v.uri, path: v.path, title: v.title, mime: v.mime || "video/mp4" }]);
        ui.renderAssistant(turn, msg); saveChats();
      },
      progress: function (t) { if (row && row.prog) row.prog(t); },
      needSetup: function (kind, why) { msg.setup = kind; msg.setupWhy = why; ui.renderAssistant(turn, msg); }
    };
    var chain = Promise.resolve();
    msg.calls.forEach(function (c) {
      chain = chain.then(function () {
        if (signal.cancelled) { results.push({ id: c.id, name: c.name, result: { error: "stopped by user" } }); return; }
        var t = S.toolByName(c.name); row = ui.stepRow(turn, c, t);
        if (!t) { row.fail("অজানা টুল"); results.push({ id: c.id, name: c.name, result: { error: "Unknown tool" } }); return; }
        var ask = (t.confirm === "always" || (t.confirm === "file" && S.settings.agent.confirmFiles)) && t.ask ? ui.confirm(t.ask(c.args || {}), "হ্যাঁ") : Promise.resolve(true);
        return ask.then(function (ok) {
          if (!ok) { row.fail("আপনি বাতিল করেছেন"); results.push({ id: c.id, name: c.name, result: { error: "User declined" } }); return; }
          return Promise.race([
            Promise.resolve().then(function () { return t.run(c.args || {}, ctx); }),
            S.sleep(/video/.test(c.name) ? 15 * 60000 : 120000).then(function () { return { error: "সময় শেষ" }; })
          ]).then(function (res) {
            if (res && res.error && /NO_PERMISSION/.test(res.error)) { res.error = "Storage permission missing. Ask the user to allow 'All files access' (button shown)."; ui.storagePrompt(); }
            if (res && (res.error || res.ok === false)) row.fail(String(res.error || "ব্যর্থ").slice(0, 120)); else row.ok(summary(c.name, res));
            results.push({ id: c.id, name: c.name, result: res == null ? { ok: true } : res });
          }, function (e) {
            row.fail(String(e.message || e).slice(0, 90)); results.push({ id: c.id, name: c.name, result: { error: String(e.message || e) } });
          });
        });
      });
    });
    return chain.then(function () { conv.msgs.push({ id: S.uid(), role: "tool", results: results }); saveChats(); });
  }
  function summary(name, r) {
    if (!r) return "";
    if (name === "web_search") return r.sources ? r.sources.length + "টি সূত্র" : r.results ? r.results.length + "টি ফলাফল" : "";
    if (name === "calculate") return "= " + r.result;
    if (name === "weather" && r.now) return r.place + " · " + r.now.temp_c + "°C";
    if (name === "currency") return "1 " + r.from + " = " + r.rate + " " + r.to;
    if (name === "fetch_url") return r.title || "";
    if (name === "save_file") return r.path || "";
    if (name === "wikipedia") return r.title || "";
    if (name === "generate_image") return S.bnNum(r.created || 0) + "টি ছবি · " + (r.provider || "");
    if (/video/.test(name)) return (r.kind === "story_video" ? "স্টোরি ভিডিও · " + S.bnNum(r.seconds || 0) + " সেকেন্ড" : r.provider || "") + (r.saved_to ? " · " + r.saved_to : "");
    return "";
  }

  /* =========================================================
   * UI — chat rendering
   * ========================================================= */
  var chat = $("#chat"), input = $("#input");
  var LOGO = "img/logo.svg";

  function scrollEnd(force) {
    var near = chat.scrollHeight - chat.scrollTop - chat.clientHeight < 160;
    if (force || near) chat.scrollTop = chat.scrollHeight;
  }
  chat.addEventListener("scroll", function () { $(".top").classList.toggle("scrolled", chat.scrollTop > 4); });

  function wireMd(el) {
    $$(".code-h .cpy", el).forEach(function (b) {
      b.onclick = function () { S.copy(b.closest(".code").querySelector("code").textContent); b.textContent = "✓ কপি"; setTimeout(function () { b.textContent = "কপি"; }, 1500); };
    });
    $$("a", el).forEach(function (a) { a.onclick = function (e) { e.preventDefault(); if (A) A.openUrl(a.href); else W.open(a.href); }; });
  }

  function renderUser(m, idx) {
    var d = document.createElement("div"); d.className = "u"; d.dataset.idx = idx;
    if (m.files && m.files.length) {
      var f = document.createElement("div"); f.className = "files";
      m.files.forEach(function (x) {
        if (x.thumb) { var im = document.createElement("img"); im.src = x.thumb; f.appendChild(im); }
        else { var s = document.createElement("span"); s.className = "fchip"; s.textContent = "📎 " + x.name; f.appendChild(s); }
      });
      d.appendChild(f);
    }
    var b = document.createElement("div"); b.className = "bubble"; b.textContent = m.text; d.appendChild(b);
    var act = document.createElement("div"); act.className = "uact";
    act.appendChild(miniBtn("কপি", "copy", function () { S.copy(m.text); S.toast("কপি হয়েছে"); }));
    act.appendChild(miniBtn("এডিট", "edit", function () { editFrom(m); }));
    d.appendChild(act);
    return d;
  }
  var ICON = {
    copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 012-2h8"/></svg>',
    edit: '<svg viewBox="0 0 24 24"><path d="M16.5 3.5a2.1 2.1 0 013 3L7 19l-4 1 1-4z"/></svg>',
    speak: '<svg viewBox="0 0 24 24"><path d="M11 5L6 9H3v6h3l5 4z"/><path d="M15.5 8.5a5 5 0 010 7M18.5 5.5a9 9 0 010 13"/></svg>',
    stop: '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>',
    share: '<svg viewBox="0 0 24 24"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="M8.2 10.8l7.6-4.4M8.2 13.2l7.6 4.4"/></svg>',
    redo: '<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 10-2.3 5.7"/><path d="M20 4v7h-7"/></svg>'
  };
  function miniBtn(label, icon, fn) {
    var b = document.createElement("button"); b.className = "mini"; b.innerHTML = (ICON[icon] || "") + "<span>" + label + "</span>"; b.onclick = fn; return b;
  }

  /** a turn = assistant block after a user message */
  ui.ensureTurn = function (conv) {
    var last = chat.lastElementChild;
    if (last && last.classList.contains("turn") && !last.dataset.done) return last;
    var t = document.createElement("div"); t.className = "turn";
    var c = conv.model && conv.model.indexOf("c:") === 0 ? customById(conv.model.slice(2)) : null;
    t.innerHTML = '<div class="who">' + (c ? '<span class="cm">' + esc(c.emoji || "🧬") + "</span><span>" + esc(c.name) + "</span>" : '<img src="' + LOGO + '" alt=""><span>সাথী</span>') +
      '<span class="via"></span></div><div class="tbody"></div>';
    chat.appendChild(t); scrollEnd(true); return t;
  };
  ui.liveText = function (turn, route) {
    var body = $(".tbody", turn), el = document.createElement("div"), think = document.createElement("div");
    $(".via", turn).textContent = "· " + shortModel(route.model);
    think.className = "thinking"; think.innerHTML = '<span class="dots"><i></i><i></i><i></i></span><span>ভাবছে…</span>';
    body.appendChild(think); scrollEnd();
    el.className = "md live cursor"; var shown = false, pendingT = null, raf = 0;
    var flush = function () { raf = 0; if (pendingT == null) return; el.innerHTML = S.md(pendingT); scrollEnd(); };
    return {
      update: function (t) {
        if (!shown && t) { think.remove(); body.appendChild(el); shown = true; }
        pendingT = t; if (!raf) raf = setTimeout(flush, 70);
      },
      done: function () { clearTimeout(raf); think.remove(); el.remove(); }
    };
  };
  var ELS = new WeakMap();
  ui.renderAssistant = function (turn, msg) {
    var body = $(".tbody", turn), box = ELS.get(msg);
    if (!box) { box = document.createElement("div"); box.className = "amsg"; ELS.set(msg, box); body.appendChild(box); }
    box.innerHTML = "";
    if (msg.text) { var md = document.createElement("div"); md.className = "md"; md.innerHTML = S.md(msg.text); wireMd(md); box.appendChild(md); }
    if (msg.images && msg.images.filter(Boolean).length) {
      var g = document.createElement("div"); g.className = "imgs" + (msg.images.length > 1 ? " two" : "");
      msg.images.filter(Boolean).forEach(function (it) {
        var src = typeof it === "string" ? it : it.src;
        if (!src) return;
        var f = document.createElement("figure"), im = document.createElement("img"); im.src = src; im.loading = "lazy";
        im.onerror = function () { f.innerHTML = '<div class="errbox">ছবিটা আর পাওয়া যাচ্ছে না।</div>'; };
        im.onclick = function () { ui.viewImage(src, it); };
        var cap = document.createElement("figcaption");
        if (it.uri && A) {
          var sh = document.createElement("button"); sh.textContent = "↗ শেয়ার"; sh.onclick = function (e) { e.stopPropagation(); A.shareUri(it.uri, "image/*"); };
          cap.appendChild(sh);
        } else {
          var sv = document.createElement("button"); sv.textContent = "⬇ সেভ"; sv.onclick = function (e) { e.stopPropagation(); saveImage(src); }; cap.appendChild(sv);
        }
        f.appendChild(im); f.appendChild(cap); g.appendChild(f);
      });
      box.appendChild(g);
    }
    (msg.videos || []).forEach(function (v) { box.appendChild(videoCard(v)); });
    if (msg.setup) box.appendChild(setupCard(msg.setup, msg.setupWhy));
    if (msg.calls && msg.calls.length) {
      var st = turn._steps;
      if (!st) {
        st = document.createElement("details"); st.className = "steps"; st.open = true;
        st.innerHTML = '<summary><span>🛠</span><span class="lbl">কাজ চলছে…</span><span class="sp"></span><span class="cnt"></span></summary>';
        turn._steps = st;
      }
      box.appendChild(st);
    }
    scrollEnd();
  };
  var VIDEO_BLOBS = {};
  function videoCard(v) {
    var w = document.createElement("div"); w.className = "vcard";
    var src = VIDEO_BLOBS[v.uri || v.path] || v.uri;
    w.innerHTML = '<video controls playsinline preload="metadata"></video><div class="vbar"><span class="vt"></span><span class="sp"></span></div>';
    var vid = $("video", w); if (src) vid.src = src;
    vid.onerror = function () { vid.replaceWith(Object.assign(document.createElement("div"), { className: "vph", textContent: "🎬 ভিডিও তৈরি হয়েছে — নিচের বোতামে চাপুন" })); };
    $(".vt", w).textContent = (v.title || "ভিডিও") + (v.path ? " · " + v.path : "");
    var bar = $(".vbar", w);
    if (v.uri && A) {
      [["▶ গ্যালারিতে", function () { A.openUri(v.uri, v.mime || "video/*"); }], ["↗ শেয়ার", function () { A.shareUri(v.uri, v.mime || "video/*"); }]].forEach(function (x) {
        var b = document.createElement("button"); b.className = "mini"; b.textContent = x[0]; b.onclick = x[1]; bar.appendChild(b);
      });
    }
    return w;
  }
  function setupCard(kind, why) {
    var c = document.createElement("div"); c.className = "setupcard";
    c.innerHTML = "<b>" + (kind === "image" ? "🎨 ছবি বানাতে একটা ফ্রি সার্ভিস যোগ করুন" : "🎬 ভিডিওর জন্য সার্ভিস যোগ করুন") + "</b><p></p>";
    $("p", c).textContent = (why ? why + " " : "") + "সবচেয়ে বেশি ফ্রি: Cloudflare (দিনে ~২০০+ ছবি)।";
    var row = document.createElement("div"); row.className = "row2";
    [["cloudflare", "☁ Cloudflare"], ["pollinations", "🌸 Pollinations"], ["huggingface", "🤗 Hugging Face"]].forEach(function (x) {
      var b = document.createElement("button"); b.textContent = x[1]; b.onclick = function () { pages.providerEdit(S.providers.find(x[0]), x[0]); }; row.appendChild(b);
    });
    c.appendChild(row); return c;
  }
  ui.viewImage = function (src, it) {
    var bg = document.createElement("div"); bg.className = "viewer";
    bg.innerHTML = '<img alt=""><div class="vb"></div>'; $("img", bg).src = src;
    var close = function () { bg.remove(); popBack(close); };
    bg.onclick = function (e) { if (e.target === bg || e.target.tagName === "IMG") close(); };
    var vb = $(".vb", bg);
    if (it && it.uri && A) {
      [["খুলুন", function () { A.openUri(it.uri, "image/*"); }], ["শেয়ার", function () { A.shareUri(it.uri, "image/*"); }]].forEach(function (x) {
        var b = document.createElement("button"); b.textContent = x[0]; b.onclick = function (e) { e.stopPropagation(); x[1](); }; vb.appendChild(b);
      });
    }
    document.body.appendChild(bg); pushBack(close);
  };

  ui.stepRow = function (turn, call, tool) {
    var st = turn._steps; if (!st) { ui.renderAssistant(turn, { calls: [call] }); st = turn._steps; }
    var row = document.createElement("div"); row.className = "st";
    var a = call.args || {}, hint = a.query || a.location || a.url || a.expression || a.topic || a.prompt || a.path || a.filename || a.title || a.message || a.number || "";
    row.innerHTML = '<span class="s"><span class="spin"></span></span><span class="d"></span>';
    $(".d", row).innerHTML = "<span>" + esc(tool ? tool.label : call.name) + "</span>" + (hint ? "<small>" + esc(String(hint).slice(0, 80)) + "</small>" : "");
    st.appendChild(row);
    var n = $$(".st", st).length; $(".cnt", st).textContent = S.bnNum(n) + " ধাপ";
    scrollEnd();
    return {
      prog: function (s) {
        var sm = row.querySelector("small.pg"); if (!sm) { sm = document.createElement("small"); sm.className = "pg"; $(".d", row).appendChild(sm); }
        sm.textContent = s; scrollEnd();
      },
      ok: function (s) { var pg = row.querySelector("small.pg"); if (pg) pg.remove(); $(".s", row).textContent = "✓"; $(".s", row).style.color = "var(--ok)"; if (s) { var sm = $("small", row) || row.querySelector(".d").appendChild(document.createElement("small")); sm.textContent = s; } },
      fail: function (s) { var pg = row.querySelector("small.pg"); if (pg) pg.remove(); $(".s", row).textContent = "✕"; $(".s", row).style.color = "var(--danger)"; var sm = document.createElement("small"); sm.textContent = s; sm.style.color = "var(--danger)"; $(".d", row).appendChild(sm); }
    };
  };
  ui.turnNote = function (turn, text) { var n = document.createElement("div"); n.className = "note"; n.textContent = text; $(".tbody", turn).appendChild(n); scrollEnd(); };
  ui.turnError = function (turn, text, setup) {
    var n = document.createElement("div"); n.className = "errbox"; n.textContent = text;
    var b = document.createElement("button"); b.textContent = setup ? "AI প্রোভাইডার ঠিক করুন →" : "আবার চেষ্টা করুন ↻";
    b.style.display = "block";
    b.onclick = function () { if (setup) pages.providers(); else regenerate(); };
    n.appendChild(b); $(".tbody", turn).appendChild(n); scrollEnd(true);
  };
  ui.finishTurn = function (turn, conv) {
    turn.dataset.done = "1";
    if (turn._steps) { $(".lbl", turn._steps).textContent = "সম্পন্ন ধাপ"; turn._steps.open = false; }
    addTurnActions(turn, conv);
  };
  function turnText(turn, conv) {
    var msgs = turnMsgs(conv, turn); return msgs.map(function (m) { return m.text || ""; }).filter(Boolean).join("\n\n");
  }
  function turnMsgs(conv, turn) {
    var all = $$(".turn", chat), k = all.indexOf(turn), out = [], seen = -1;
    for (var i = 0; i < conv.msgs.length; i++) {
      var m = conv.msgs[i];
      if (m.role === "user") seen++;
      if (seen === k && m.role === "assistant") out.push(m);
    }
    return out;
  }
  function addTurnActions(turn, conv) {
    var old = $(".tact", turn); if (old) old.remove();
    var t = turnText(turn, conv); if (!t) return;
    var a = document.createElement("div"); a.className = "tact";
    a.appendChild(miniBtn("কপি", "copy", function () { S.copy(t); S.toast("কপি হয়েছে"); }));
    var sp = miniBtn("শুনুন", "speak", function () {
      if (S.voice.speaking) { S.voice.stopSpeaking(); return; }
      ui.speakMsg(t, sp);
    });
    a.appendChild(sp);
    a.appendChild(miniBtn("শেয়ার", "share", function () { if (A) A.share(t); else S.copy(t); }));
    var turns = $$(".turn", chat);
    if (turns[turns.length - 1] === turn) a.appendChild(miniBtn("আবার", "redo", regenerate));
    $(".tbody", turn).appendChild(a);
  }
  ui.speakMsg = function (text, btn) {
    var set = function (on) { if (btn) btn.innerHTML = (on ? ICON.stop : ICON.speak) + "<span>" + (on ? "থামান" : "শুনুন") + "</span>"; };
    S.voice.onState = set; set(true);
    return S.voice.speak(text).then(function (r) { set(false); return r; });
  };

  function renderConv() {
    chat.innerHTML = "";
    $("#convTitle").textContent = cur.msgs.length ? (cur.title || "চ্যাট") : "সাথী AI";
    $("#modelName").textContent = S.modelLabel(cur.model);
    $("#agentBtn").setAttribute("aria-pressed", cur.agent ? "true" : "false");
    if (!cur.msgs.length) { renderWelcome(); return; }
    var turn = null;
    cur.msgs.forEach(function (m, i) {
      if (m.role === "user") { if (turn) ui.finishTurn(turn, cur); turn = null; chat.appendChild(renderUser(m, i)); return; }
      if (!turn) turn = ui.ensureTurn(cur);
      if (m.role === "assistant") {
        if (m.model) $(".via", turn).textContent = "· " + shortModel(m.model);
        ELS.delete(m); ui.renderAssistant(turn, m);
      } else if (m.role === "tool") {
        var prev = cur.msgs[i - 1];
        m.results.forEach(function (r, k) {
          var call = prev && prev.calls ? prev.calls[k] || { name: r.name, args: {} } : { name: r.name, args: {} };
          var row = ui.stepRow(turn, call, S.toolByName(r.name));
          if (r.result && r.result.error) row.fail(String(r.result.error).slice(0, 90)); else row.ok(summary(r.name, r.result || {}));
        });
      }
    });
    if (turn) ui.finishTurn(turn, cur);
    setTimeout(function () { chat.scrollTop = chat.scrollHeight; }, 0);
  }
  ui.renderConv = function () { renderConv(); };

  function greeting() {
    var h = new Date().getHours();
    return h < 5 ? "শুভ রাত্রি" : h < 12 ? "শুভ সকাল" : h < 16 ? "শুভ দুপুর" : h < 19 ? "শুভ বিকেল" : "শুভ সন্ধ্যা";
  }
  var SUGS = [
    ["📰", "আজকের খবর", "বাংলাদেশের আজকের প্রধান খবরগুলো সংক্ষেপে বলো, সূত্রসহ।", false],

    ["✍️", "লিখে দাও", "অফিসে ২ দিনের ছুটির জন্য একটা ভদ্র দরখাস্ত লিখে দাও।", false],
    ["🎨", "ছবি আঁকো", "সূর্যাস্তের সময় পদ্মা নদীতে একটা নৌকার সুন্দর ছবি আঁকো।", false],
    ["🎬", "ভিডিও বানাও", "একটা ছোট্ট পাখির বন্ধুত্বের গল্প নিয়ে বাংলায় বর্ণনাসহ ৫ দৃশ্যের স্টোরি ভিডিও বানাও।", false],
    ["🛠", "এজেন্ট", "আমার ফোনের স্টোরেজ পরীক্ষা করো, কোন ফাইলগুলো সবচেয়ে বেশি জায়গা নিচ্ছে বলো আর কী মুছলে ভালো হয় পরামর্শ দাও।", true],
    ["⏰", "রিমাইন্ডার", "কাল সকাল ৬:৩০-এ একটা অ্যালার্ম দাও, নাম দাও 'ফজর'।", true]
  ];
  function renderWelcome() {
    var w = document.createElement("div"); w.className = "welcome";
    var hasAI = S.providers.usable().length > 0;
    w.innerHTML = '<img class="lg" src="' + LOGO + '" alt=""><h2>' + greeting() + '!</h2><div class="sub">আজ কীভাবে সাহায্য করতে পারি?</div>';
    if (!hasAI) {
      var s = document.createElement("div"); s.className = "setup";
      s.innerHTML = "<b>শুরু করতে একটা ফ্রি AI যোগ করুন</b><p>Google Gemini বা Groq — দুটোই ফ্রি, key নিতে ১ মিনিট লাগে।</p>";
      var row = document.createElement("div"); row.className = "row";
      [["gemini", "Google Gemini"], ["groq", "Groq"], ["", "সব দেখুন"]].forEach(function (x) {
        var b = document.createElement("button"); b.textContent = x[1];
        b.onclick = function () { if (x[0]) pages.providerEdit(null, x[0]); else pages.providers(); };
        row.appendChild(b);
      });
      s.appendChild(row); w.appendChild(s);
    }
    var g = document.createElement("div"); g.className = "sugs";
    SUGS.forEach(function (x) {
      var b = document.createElement("button"); b.className = "sug";
      b.innerHTML = "<b>" + x[0] + " " + esc(x[1]) + "</b><span>" + esc(x[2].slice(0, 46)) + "…</span>";
      b.onclick = function () { if (x[3] && !cur.agent) { cur.agent = true; $("#agentBtn").setAttribute("aria-pressed", "true"); } send(x[2]); };
      g.appendChild(b);
    });
    w.appendChild(g); chat.appendChild(w);
  }

  /* =========================================================
   * sending, editing, regenerating
   * ========================================================= */
  var pendingFiles = [];
  function send(text) {
    text = (text == null ? input.value : text).trim();
    if (busy()) return;
    if (!text && !pendingFiles.length) return;
    if (!S.providers.usable().length) { S.toast("আগে একটা AI প্রোভাইডার যোগ করুন"); pages.providers(); return; }
    S.voice.stopSpeaking();
    var files = pendingFiles.slice(); pendingFiles = []; renderPending();
    input.value = ""; autosize();
    if (!text) text = files.some(function (f) { return /^image/.test(f.mime); }) ? "ছবিটা দেখে বুঝিয়ে বলো।" : "ফাইলটা পড়ে সারসংক্ষেপ দাও।";
    if (!cur.msgs.length) { $(".welcome") && $(".welcome").remove(); cur.title = text.replace(/\s+/g, " ").slice(0, 48); $("#convTitle").textContent = cur.title; if (convs.indexOf(cur) < 0) convs.unshift(cur); }
    var m = { id: S.uid(), role: "user", text: text, files: files };
    cur.msgs.push(m); cur.t = Date.now();
    chat.appendChild(renderUser(m, cur.msgs.length - 1)); scrollEnd(true);
    saveChats();
    return runTurn(cur);
  }
  S.send = send;
  function stop() { if (!active) return; active.signal.cancelled = true; if (active.signal.handle) active.signal.handle.cancel(); }
  function regenerate() {
    if (busy()) return;
    var i = cur.msgs.length - 1; while (i >= 0 && cur.msgs[i].role !== "user") i--;
    if (i < 0) return;
    cur.msgs = cur.msgs.slice(0, i + 1); renderConv();
    runTurn(cur);
  }
  function editFrom(m) {
    if (busy()) return;
    var i = cur.msgs.indexOf(m); if (i < 0) return;
    ui.prompt("মেসেজ এডিট করুন", m.text, true).then(function (t) {
      if (t == null || !t.trim()) return;
      cur.msgs = cur.msgs.slice(0, i); var files = m.files || [];
      renderConv(); pendingFiles = files.filter(function (f) { return f.b64 || f.text; }); send(t);
    });
  }
  function setBusyUI(b) {
    var sb = $("#sendBtn");
    sb.classList.toggle("stop", b);
    sb.innerHTML = b ? '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor"/></svg>' : '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>';
    if (A) A.keepAwake(b);
  }

  /* =========================================================
   * composer: input, attachments, agent toggle, mic
   * ========================================================= */
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 160) + "px"; }
  input.addEventListener("input", autosize);
  $("#sendBtn").onclick = function () { if (busy()) stop(); else send(); };
  $("#agentBtn").onclick = function () {
    cur.agent = !cur.agent; this.setAttribute("aria-pressed", cur.agent ? "true" : "false");
    S.toast(cur.agent ? "🛠 এজেন্ট মোড চালু: ফোনের কাজ, ফাইল, কোড — সব টুল" : "এজেন্ট মোড বন্ধ"); saveChats();
  };
  $("#attachBtn").onclick = function () {
    ui.menu($("#attachBtn"), [
      ["📎 ছবি / ফাইল যোগ করুন", function () { $("#fileInput").click(); }],
      ["🎨 ছবি বানান", function () { pages.studio("image"); }],
      ["🎬 ভিডিও বানান", function () { pages.studio("video"); }]
    ], true);
  };
  function readFileObj(f) {
    return new Promise(function (res, rej) {
      var r = new FileReader(); r.onload = function () { res(r.result); }; r.onerror = function () { rej(r.error); };
      if (/^text\/|json|csv|markdown|xml/.test(f.type) || /\.(txt|md|csv|json|xml|html|js|py|java|kt|c|cpp|css)$/i.test(f.name)) r.readAsText(f); else r.readAsDataURL(f);
    });
  }
  function makeThumb(dataUrl) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () {
        var s = 168, c = document.createElement("canvas"), k = Math.max(s / im.width, s / im.height);
        c.width = s; c.height = s; c.getContext("2d").drawImage(im, (s - im.width * k) / 2, (s - im.height * k) / 2, im.width * k, im.height * k);
        res(c.toDataURL("image/jpeg", .72));
      }; im.onerror = function () { res(null); }; im.src = dataUrl;
    });
  }
  function shrinkImage(dataUrl, mime) {
    return new Promise(function (res) {
      var im = new Image(); im.onload = function () {
        var max = 1600, k = Math.min(1, max / Math.max(im.width, im.height));
        if (k >= 1 && dataUrl.length < 1500000) { res(dataUrl); return; }
        var c = document.createElement("canvas"); c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", .86));
      }; im.onerror = function () { res(dataUrl); }; im.src = dataUrl;
    });
  }
  $("#fileInput").onchange = function () {
    var files = Array.prototype.slice.call(this.files || []); this.value = "";
    var chain = Promise.resolve();
    files.slice(0, 8).forEach(function (f) {
      chain = chain.then(function () {
        if (f.size > 20 * 1024 * 1024) { S.toast(f.name + " অনেক বড় (২০ MB-এর বেশি)"); return; }
        return readFileObj(f).then(function (data) {
          var item = { name: f.name, mime: f.type || "application/octet-stream" };
          if (typeof data === "string" && data.indexOf("data:") === 0) {
            item.mime = data.slice(5, data.indexOf(";")) || item.mime;
            if (/^image\//.test(item.mime)) {
              return shrinkImage(data, item.mime).then(function (d2) {
                item.mime = d2.slice(5, d2.indexOf(";")); item.b64 = d2.split(",")[1];
                return makeThumb(d2).then(function (t) { item.thumb = t; pendingFiles.push(item); });
              });
            }
            item.b64 = data.split(",")[1]; pendingFiles.push(item); return;
          }
          item.text = String(data).slice(0, 80000); item.mime = "text/plain"; pendingFiles.push(item);
        });
      });
    });
    chain.then(renderPending, function () { S.toast("ফাইল পড়া যায়নি"); });
  };
  function renderPending() {
    var box = $("#pending"); box.innerHTML = "";
    pendingFiles.forEach(function (p, i) {
      var c = document.createElement("div"); c.className = "pchip";
      var icon = /pdf/.test(p.mime) ? "📄" : /^audio/.test(p.mime) ? "🎵" : "📝";
      c.innerHTML = (p.thumb ? '<img src="' + p.thumb + '">' : '<span class="ic">' + icon + "</span>") + "<span>" + esc(p.name) + "</span>";
      var x = document.createElement("button"); x.textContent = "✕"; x.onclick = function () { pendingFiles.splice(i, 1); renderPending(); };
      c.appendChild(x); box.appendChild(c);
    });
  }

  /* ---- mic in the composer ---- */
  var recTimer = null, recStarted = 0, deviceMode = false;
  function showRec(on) { $("#crow").hidden = on; $("#recbar").hidden = !on; }
  function bars(level) {
    var b = $("#recBars"), i = document.createElement("i"); i.style.height = Math.max(3, Math.round(level * 26)) + "px";
    b.appendChild(i); while (b.children.length > 60) b.removeChild(b.firstChild);
  }
  $("#micBtn").onclick = function () {
    if (busy()) return;
    $("#recBars").innerHTML = ""; recStarted = Date.now();
    var tick = function () { var s = Math.floor((Date.now() - recStarted) / 1000); $("#recTime").textContent = Math.floor(s / 60) + ":" + ("0" + s % 60).slice(-2); };
    clearInterval(recTimer); recTimer = setInterval(tick, 500); tick();
    if (S.voice.transcriber()) {
      deviceMode = false;
      S.voice.startRecording({ onLevel: bars }).then(function () { showRec(true); }, function (e) { clearInterval(recTimer); S.toast(e.message, 3500); });
    } else {
      deviceMode = true; var base = input.value ? input.value + " " : "";
      S.voice.deviceListen({
        partial: function (t) { input.value = base + t; autosize(); },
        final: function (t) { input.value = base + t; autosize(); endRec(); },
        error: function (c) { endRec(); S.toast(c === "perm" ? "মাইক্রোফোনের অনুমতি দিন" : "ভয়েস বোঝা যায়নি, আবার চেষ্টা করুন"); },
        ready: function () {}, end: function () {}
      }).then(function () { showRec(true); var t = setInterval(function () { bars(0.2 + Math.random() * 0.6); if ($("#recbar").hidden) clearInterval(t); }, 120); },
        function (e) { clearInterval(recTimer); S.toast(e.message, 4000); });
    }
  };
  function endRec() { clearInterval(recTimer); showRec(false); }
  $("#recCancel").onclick = function () { if (deviceMode) S.voice.deviceStop(); else S.voice.cancelRecording(); endRec(); };
  $("#recDone").onclick = function () {
    if (deviceMode) { S.voice.deviceStop(); endRec(); return; }
    endRec(); var ph = input.placeholder; input.placeholder = "লিখছি…"; input.disabled = true;
    S.voice.stopAndTranscribe().then(function (t) {
      input.disabled = false; input.placeholder = ph;
      if (!t) { S.toast("কোনো কথা শোনা যায়নি"); return; }
      input.value = (input.value ? input.value + " " : "") + t; autosize(); input.focus();
    }, function (e) { input.disabled = false; input.placeholder = ph; S.toast("ভয়েস থেকে লেখা যায়নি: " + e.message, 4000); });
  };

  /* =========================================================
   * voice conversation mode
   * ========================================================= */
  var talk = $("#talk");
  function talkState(st, text) { talk.dataset.state = st; $("#talkStatus").textContent = text; }
  ui.talkOn = false;
  function talkListen() {
    if (!ui.talkOn) return;
    talkState("listening", "শুনছি…");
    var core = $(".orb .core"), ring = $(".orb .ring");
    if (S.voice.transcriber()) {
      S.voice.startRecording({ autoStop: true, onLevel: function (l) { core.style.transform = "scale(" + (1 + l * 0.18) + ")"; ring.style.transform = "scale(" + (1 + l * 0.3) + ")"; },
        onSilence: function () { talkFinishListening(); } })
        .catch(function (e) { talkState("idle", e.message); });
    } else {
      S.voice.deviceListen({
        partial: function (t) { $("#talkText").textContent = t; },
        final: function (t) { talkSend(t); },
        error: function () { talkState("idle", "বোঝা যায়নি — ট্যাপ করে আবার বলুন"); },
        ready: function () {}, end: function () { talkState("thinking", "বুঝছি…"); }
      }).catch(function (e) { talkState("idle", e.message); });
    }
  }
  var finishing = false;
  function talkFinishListening() {
    if (finishing || !S.voice.recording) return; finishing = true;
    talkState("thinking", "বুঝছি…");
    $(".orb .core").style.transform = ""; $(".orb .ring").style.transform = "";
    S.voice.stopAndTranscribe().then(function (t) { finishing = false; if (!t) { talkListen(); return; } talkSend(t); },
      function (e) { finishing = false; talkState("idle", "সমস্যা: " + e.message); });
  }
  function talkSend(t) {
    $("#talkText").textContent = "“" + t + "”";
    talkState("thinking", "ভাবছি…");
    send(t);
  }
  ui.talkAfterReply = function (text) {
    if (!ui.talkOn) return;
    if (!text) { talkListen(); return; }
    talkState("speaking", "বলছি…"); $("#talkText").textContent = text.slice(0, 280) + (text.length > 280 ? "…" : "");
  };
  S.voice.onState = null;
  var origSpeak = ui.speakMsg;
  ui.speakMsg = function (text, btn) {
    return origSpeak(text, btn).then(function (r) {
      if (ui.talkOn && r !== "stopped") setTimeout(talkListen, 250);
      return r;
    });
  };
  $("#talkBtn").onclick = function () {
    if (!S.providers.usable().length) { pages.providers(); return; }
    ui.talkOn = true; talk.hidden = false; $("#talkText").textContent = "";
    $("#talkModel").textContent = S.modelLabel(cur.model); S.voice.prepare(); pushBack(closeTalk);
    talkListen();
  };
  function closeTalk() {
    ui.talkOn = false; talk.hidden = true; S.voice.stopSpeaking();
    if (S.voice.recording) S.voice.cancelRecording(); S.voice.deviceStop(); stop(); popBack(closeTalk);
  }
  $("#talkClose").onclick = closeTalk;
  $("#orb").onclick = function () {
    var st = talk.dataset.state;
    if (st === "listening") { if (S.voice.recording) talkFinishListening(); else S.voice.deviceStop(); }
    else if (st === "speaking") { S.voice.stopSpeaking(); talkListen(); }
    else if (st === "thinking") { stop(); talkListen(); }
    else talkListen();
  };

  /* =========================================================
   * drawer & conversation list
   * ========================================================= */
  var drawer = $("#drawer"), scrim = $("#scrim");
  function openDrawer() { renderList(); drawer.classList.add("open"); scrim.classList.add("open"); pushBack(closeDrawer); }
  function closeDrawer() { drawer.classList.remove("open"); scrim.classList.remove("open"); popBack(closeDrawer); }
  $("#menuBtn").onclick = openDrawer; scrim.onclick = closeDrawer;
  function startNew() { if (busy()) stop(); S.voice.stopSpeaking(); cur = newConv(); renderConv(); closeDrawer(); }
  $("#newBtn").onclick = startNew; $("#drNew").onclick = startNew;
  $("#searchInput").oninput = function () { renderList(); };
  $$(".dr-foot button").forEach(function (b) { b.onclick = function () { closeDrawer(); pages[b.dataset.go](); }; });

  function renderList() {
    var q = $("#searchInput").value.trim().toLowerCase(), box = $("#convList"); box.innerHTML = "";
    var list = convs.filter(function (c) { return c.msgs.length; });
    if (q) list = list.filter(function (c) {
      return (c.title || "").toLowerCase().indexOf(q) >= 0 || c.msgs.some(function (m) { return (m.text || "").toLowerCase().indexOf(q) >= 0; });
    });
    list.sort(function (a, b) { return (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) || b.t - a.t; });
    var lastSec = "";
    list.forEach(function (c) {
      var sec = c.pinned ? "📌 পিন করা" : S.timeAgo(c.t);
      if (sec !== lastSec) { var h = document.createElement("div"); h.className = "dr-sec"; h.textContent = sec; box.appendChild(h); lastSec = sec; }
      var row = document.createElement("div"); row.className = "conv" + (c === cur ? " active" : "");
      var t = document.createElement("button"); t.className = "t"; t.textContent = c.title || "চ্যাট";
      t.onclick = function () { if (busy()) stop(); cur = c; renderConv(); closeDrawer(); };
      var m = document.createElement("button"); m.className = "m"; m.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/></svg>';
      m.onclick = function (e) {
        e.stopPropagation();
        ui.menu(m, [
          [c.pinned ? "📌 আনপিন" : "📌 পিন করুন", function () { c.pinned = !c.pinned; saveChats(); renderList(); }],
          ["✏️ নাম বদলান", function () { ui.prompt("চ্যাটের নাম", c.title).then(function (t2) { if (t2) { c.title = t2.trim(); saveChats(); renderList(); if (c === cur) $("#convTitle").textContent = c.title; } }); }],
          ["📤 শেয়ার / এক্সপোর্ট", function () { exportConv(c); }],
          ["🗑️ মুছে ফেলুন", function () { ui.confirm("\"" + (c.title || "চ্যাট") + "\" মুছে ফেলবেন?", "মুছুন").then(function (ok) { if (!ok) return; convs.splice(convs.indexOf(c), 1); if (c === cur) { cur = newConv(); renderConv(); } saveChats(); renderList(); }); }, true]
        ]);
      };
      row.appendChild(t); row.appendChild(m); box.appendChild(row);
    });
    if (!box.children.length) box.innerHTML = '<div class="empty">' + (q ? "কিছু পাওয়া যায়নি" : "এখনো কোনো চ্যাট নেই") + "</div>";
  }
  function exportConv(c) {
    var txt = "# " + (c.title || "চ্যাট") + "\n\n" + c.msgs.filter(function (m) { return m.role !== "tool" && m.text; }).map(function (m) {
      return (m.role === "user" ? "**আপনি:** " : "**সাথী:** ") + m.text;
    }).join("\n\n");
    if (A) A.share(txt); else S.copy(txt);
  }
  function saveImage(src) {
    var name = "shathi-" + Date.now() + ".png";
    var arg = src.indexOf("data:") === 0 ? "b64:" + src.split(",")[1] : src;
    S.download(arg, name, "image/png").then(function (r) { S.toast("সেভ হয়েছে: " + r.body); }, function (e) { S.toast("সেভ হয়নি: " + e.message); });
  }

  /* =========================================================
   * generic layers: back stack, sheet, page, dialogs, menu
   * ========================================================= */
  var backStack = [];
  function pushBack(fn) { backStack.push(fn); }
  function popBack(fn) { var i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); }
  W.onBack = function () { var fn = backStack[backStack.length - 1]; if (fn) { fn(); return true; } if (busy()) { stop(); return true; } return false; };
  W.onAppResume = function () { if (ui._onResume) ui._onResume(); };

  ui.sheet = function (title, build) {
    var bg = document.createElement("div"); bg.className = "sheet-bg";
    var sh = document.createElement("div"); sh.className = "sheet";
    sh.innerHTML = '<div class="grab"></div>' + (title ? "<h3>" + esc(title) + "</h3>" : "") + '<div class="body"></div>';
    bg.appendChild(sh); $("#layers").appendChild(bg);
    var close = function () { bg.remove(); popBack(close); };
    bg.onclick = function (e) { if (e.target === bg) close(); };
    pushBack(close); build($(".body", sh), close); return close;
  };
  ui.page = function (title, build, right) {
    var pg = document.createElement("div"); pg.className = "page";
    pg.innerHTML = '<div class="ph"><button class="ib back" aria-label="ফিরে যান"><svg viewBox="0 0 24 24"><path d="M15 18l-6-6 6-6"/></svg></button><b>' + esc(title) + '</b><span class="pr"></span></div><div class="pb"></div>';
    $("#layers").appendChild(pg);
    var close = function () { pg.remove(); popBack(close); if (pg._onClose) pg._onClose(); };
    $(".back", pg).onclick = close; pushBack(close);
    if (right) $(".pr", pg).appendChild(right);
    build($(".pb", pg), close, pg); return close;
  };
  ui.confirm = function (text, okLabel) {
    return new Promise(function (res) {
      var bg = document.createElement("div"); bg.className = "sheet-bg center";
      bg.innerHTML = '<div class="dialog"><p></p><div class="acts"><button class="no">বাতিল</button><button class="ok"></button></div></div>';
      $("p", bg).textContent = text; $(".ok", bg).textContent = okLabel || "ঠিক আছে";
      $("#layers").appendChild(bg);
      var done = function (v) { bg.remove(); popBack(cancel); res(v); }, cancel = function () { done(false); };
      $(".ok", bg).onclick = function () { done(true); }; $(".no", bg).onclick = cancel; pushBack(cancel);
    });
  };
  ui.prompt = function (title, value, multi) {
    return new Promise(function (res) {
      var bg = document.createElement("div"); bg.className = "sheet-bg center";
      bg.innerHTML = '<div class="dialog"><p></p><div class="field"></div><div class="acts"><button class="no">বাতিল</button><button class="ok">ঠিক আছে</button></div></div>';
      $("p", bg).textContent = title;
      var inp = document.createElement(multi ? "textarea" : "input"); inp.value = value || ""; $(".field", bg).appendChild(inp);
      $("#layers").appendChild(bg); setTimeout(function () { inp.focus(); }, 50);
      var done = function (v) { bg.remove(); popBack(cancel); res(v); }, cancel = function () { done(null); };
      $(".ok", bg).onclick = function () { done(inp.value); }; $(".no", bg).onclick = cancel; pushBack(cancel);
    });
  };
  ui.menu = function (anchor, items, up) {
    var m = document.createElement("div"); m.className = "menu";
    items.forEach(function (it) { var b = document.createElement("button"); b.textContent = it[0]; if (it[2]) b.className = "danger"; b.onclick = function () { close(); it[1](); }; m.appendChild(b); });
    var bg = document.createElement("div"); bg.style.cssText = "position:fixed;inset:0;z-index:39"; bg.onclick = function () { close(); };
    document.body.appendChild(bg); document.body.appendChild(m);
    var r = anchor.getBoundingClientRect(), mh = m.offsetHeight;
    if (up) { m.style.top = Math.max(10, r.top - mh - 6) + "px"; m.style.left = Math.max(8, r.left) + "px"; }
    else { m.style.top = Math.min(r.bottom + 4, W.innerHeight - mh - 10) + "px"; m.style.right = Math.max(8, W.innerWidth - r.right) + "px"; }
    var close = function () { m.remove(); bg.remove(); popBack(close); }; pushBack(close);
  };
  ui.storagePrompt = function () {
    if (!A || A.hasStorage()) return;
    ui.confirm("ফোনের ফাইল দেখতে \"All files access\" অনুমতি দরকার। সেটিংস খুলবো?", "অনুমতি দিন").then(function (ok) { if (ok) A.requestStorage(); });
  };
  ui.noVoiceSheet = function () {
    ui.sheet("ফোনে বাংলা ভয়েস নেই", function (b, close) {
      b.innerHTML = '<p class="help" style="font-size:14px;margin:0 6px 10px">আপনার ফোনের লেখা-পড়ার (Text-to-speech) সিস্টেমে বাংলা ভয়েস ইনস্টল করা নেই। তাই আগে ইংরেজি ভয়েস বাংলা পড়তে গিয়ে রোবটের মতো ভাঙা আওয়াজ হচ্ছিল। এখন ভুল ভয়েসে পড়বে না।</p>';
      var add = function (label, cls, fn) { var x = document.createElement("button"); x.className = "btn " + cls; x.textContent = label; x.onclick = function () { close(); fn(); }; b.appendChild(x); };
      add("⬇ বাংলা ভয়েস ইনস্টল করুন (Google)", "primary", function () { A && A.installTtsData(); S.toast("Speech Services by Google → Bengali/বাংলা ভয়েস ডাউনলোড করুন", 5000); });
      if (S.providers.find("gemini")) add("✨ AI ভয়েস ব্যবহার করুন (আরও স্বাভাবিক)", "ghost", function () { S.settings.voice.output = "ai"; saveSettings(); S.toast("AI ভয়েস চালু হলো"); });
      add("⚙️ ফোনের ভয়েস সেটিংস", "ghost", function () { A && A.openTtsSettings(); });
    });
  };

  /* =========================================================
   * model picker
   * ========================================================= */
  $("#modelBtn").onclick = function () { pickModel(cur.model, function (ref) { cur.model = ref; S.settings.defaultModel = ref; saveSettings(); saveChats(); $("#modelName").textContent = S.modelLabel(ref); }); };
  function pickModel(selected, onPick, opts) {
    opts = opts || {};
    ui.sheet("মডেল বেছে নিন", function (b, close) {
      var grp = function (title) { var t = document.createElement("div"); t.className = "gtitle"; t.textContent = title; b.appendChild(t); var g = document.createElement("div"); g.className = "group"; b.appendChild(g); return g; };
      var row = function (g, icon, color, title, sub, ref, extra) {
        var r = document.createElement("button"); r.className = "row" + (ref === selected ? " sel" : "");
        r.innerHTML = '<span class="ri" style="background:' + color + '">' + icon + '</span><span class="rt"><b></b><small></small></span>' + (ref === selected ? '<span class="rr">✓</span>' : "");
        $("b", r).innerHTML = esc(title) + (extra || ""); $("small", r).textContent = sub || "";
        r.onclick = function () { close(); onPick(ref); }; g.appendChild(r); return r;
      };
      var g0 = grp("প্রস্তাবিত");
      row(g0, "✨", "var(--accent)", "সাথী অটো", "সবচেয়ে ভালো চালু মডেল নিজে বেছে নেয়; সমস্যা হলে অন্যটায় যায়", "auto");
      if (!opts.noCustom) {
        var gc = grp("আমার মডেল");
        S.settings.customModels.forEach(function (c) { row(gc, c.emoji || "🧬", c.color || "#7B61FF", c.name, (c.instructions || "").slice(0, 70), "c:" + c.id); });
        var add = document.createElement("button"); add.className = "row"; add.innerHTML = '<span class="ri" style="background:var(--surface2);color:var(--accent)">＋</span><span class="rt"><b>নিজের মডেল বানান</b><small>নাম, ব্যক্তিত্ব, জ্ঞান — আপনার মতো করে</small></span>';
        add.onclick = function () { close(); pages.customEdit(null); }; gc.appendChild(add);
      }
      S.providers.usable().filter(function (p) { return !S.preset(p.preset).mediaOnly; }).sort(function (a, b2) { return ORDER.indexOf(a.preset) - ORDER.indexOf(b2.preset); }).forEach(function (p) {
        var pr = S.preset(p.preset), g = grp(p.name);
        var models = S.chatModels(p);
        if (p.preset === "openrouter") models = models.filter(function (m) { return /:free$/.test(m); }).concat(models.filter(function (m) { return !/:free$/.test(m); }));
        if (!models.length && p.manualModel) models = [p.manualModel];
        var shown = 0, more = null;
        models.forEach(function (m) {
          var r = row(g, pr.icon, pr.color, shortModel(m), m === S.pickModel(p) ? "এই প্রোভাইডারের সেরা পছন্দ" : m, "p:" + p.id + ":" + m,
            /:free$/.test(m) || pr.tier === "free" ? '<span class="badge free">ফ্রি</span>' : pr.tier === "premium" ? '<span class="badge premium">পেইড</span>' : "");
          if (++shown > 8) r.hidden = true;
        });
        if (shown > 8) {
          more = document.createElement("button"); more.className = "row"; more.innerHTML = '<span class="rt"><b style="color:var(--accent)">আরও ' + S.bnNum(shown - 8) + "টি মডেল দেখুন</b></span>";
          more.onclick = function () { $$(".row[hidden]", g).forEach(function (x) { x.hidden = false; }); more.remove(); }; g.appendChild(more);
        }
        var rf = document.createElement("button"); rf.className = "row"; rf.innerHTML = '<span class="rt"><small>↻ মডেলের তালিকা আপডেট করুন</small></span>';
        rf.onclick = function () { rf.querySelector("small").textContent = "আপডেট হচ্ছে…"; S.providers.refresh(p).then(function () { close(); pickModel(selected, onPick, opts); }, function (e) { rf.querySelector("small").textContent = "সমস্যা: " + e.message; }); };
        g.appendChild(rf);
      });
      var ga = grp("আরও");
      var ap = document.createElement("button"); ap.className = "row"; ap.innerHTML = '<span class="ri" style="background:var(--surface2);color:var(--accent)">🔑</span><span class="rt"><b>AI প্রোভাইডার যোগ করুন</b><small>ফ্রি: Gemini, Groq, OpenRouter… · পেইড: OpenAI, Claude…</small></span>';
      ap.onclick = function () { close(); pages.providers(); }; ga.appendChild(ap);
    });
  }

  /* =========================================================
   * pages: providers, custom models, memory, settings
   * ========================================================= */
  var pages = S.pages = {};
  function field(parent, label, el, help) {
    var f = document.createElement("div"); f.className = "field";
    if (label) { var l = document.createElement("label"); l.textContent = label; f.appendChild(l); }
    f.appendChild(el); if (help) { var h = document.createElement("div"); h.className = "help"; h.innerHTML = help; f.appendChild(h); }
    parent.appendChild(f); return el;
  }
  function el(tag, props) { var e = document.createElement(tag); for (var k in (props || {})) { if (k === "text") e.textContent = props[k]; else if (k === "html") e.innerHTML = props[k]; else e[k] = props[k]; } return e; }
  function btn(parent, label, cls, fn) { var b = el("button", { className: "btn " + (cls || "ghost"), text: label }); b.onclick = fn; parent.appendChild(b); return b; }
  function switchRow(g, title, sub, val, onChange) {
    var r = el("label", { className: "row" });
    r.innerHTML = '<span class="rt"><b></b><small></small></span><span class="switch"><input type="checkbox"><span></span></span>';
    $("b", r).textContent = title; $("small", r).textContent = sub || ""; var cb = $("input", r); cb.checked = !!val;
    cb.onchange = function () { onChange(cb.checked); }; g.appendChild(r); return cb;
  }
  function segRow(parent, label, options, val, onChange) {
    var f = el("div", { className: "field" }); if (label) f.appendChild(el("label", { text: label }));
    var s = el("div", { className: "seg" });
    options.forEach(function (o) {
      var b = el("button", { text: o[1] }); if (o[0] === val) b.className = "on";
      b.onclick = function () { $$("button", s).forEach(function (x) { x.className = ""; }); b.className = "on"; onChange(o[0]); };
      s.appendChild(b);
    });
    f.appendChild(s); parent.appendChild(f);
  }
  function navRow(g, icon, color, title, sub, fn, right) {
    var r = el("button", { className: "row" });
    r.innerHTML = '<span class="ri" style="background:' + color + '">' + icon + '</span><span class="rt"><b></b><small></small></span><span class="rr"></span>';
    $("b", r).innerHTML = title; $("small", r).textContent = sub || ""; $(".rr", r).innerHTML = right || "›"; r.onclick = fn; g.appendChild(r); return r;
  }

  pages.providers = function () {
    ui.page("AI প্রোভাইডার ও API", function (b, close, pg) {
      var draw = function () {
        b.innerHTML = "";
        b.appendChild(el("div", { className: "help", html: "সাথী একসাথে অনেক AI ব্যবহার করতে পারে। <b>ফ্রি</b> প্রোভাইডারের key বিনামূল্যে পাওয়া যায়; <b>পেইড</b> গুলোতে ব্যবহার অনুযায়ী খরচ। key শুধু আপনার ফোনে থাকে।" }));
        var mine = S.settings.providers;
        if (mine.length) {
          b.appendChild(el("div", { className: "gtitle", text: "যুক্ত আছে" }));
          var g = el("div", { className: "group" }); b.appendChild(g);
          mine.forEach(function (p) {
            var pr = S.preset(p.preset), ok = p.enabled !== false && (p.key || pr.noKey);
            navRow(g, pr.icon, pr.color, esc(p.name) + ' <span class="badge ' + pr.tier + '">' + (pr.tier === "free" ? "ফ্রি" : pr.tier === "premium" ? "পেইড" : "নিজের") + "</span>",
              (ok ? "✓ চালু" : "বন্ধ") + (p.models && p.models.length ? " · " + S.bnNum(S.chatModels(p).length) + "টি মডেল" : "") + (p.working ? " · " + shortModel(p.working) : ""),
              function () { pages.providerEdit(p); });
          });
        }
        [["free", "🆓 ফ্রি চ্যাট AI"], ["media", "🎨 ছবি ও ভিডিও (ফ্রি)"], ["premium", "💎 প্রিমিয়াম (পেইড) API"], ["own", "🖥 নিজের মডেল / সার্ভার"]].forEach(function (sec) {
          b.appendChild(el("div", { className: "gtitle", text: sec[1] }));
          var grid = el("div", { className: "pgrid" }); grid.style.marginTop = "8px"; b.appendChild(grid);
          S.PRESETS.filter(function (x) { return sec[0] === "media" ? x.media : x.tier === sec[0] && !x.mediaOnly; }).forEach(function (pr) {
            var c = el("button", { className: "pcard" });
            c.innerHTML = '<span class="ri" style="background:' + pr.color + '">' + pr.icon + "</span><b>" + esc(pr.name) + "</b><small>" + esc(pr.note) + "</small>";
            c.onclick = function () { pages.providerEdit(null, pr.id); }; grid.appendChild(c);
          });
        });
      };
      draw(); pg._redraw = draw; ui._providersPage = pg;
    });
  };

  pages.providerEdit = function (p, presetId) {
    var isNew = !p, pr = S.preset(p ? p.preset : presetId);
    ui.page(isNew ? pr.name + " যোগ করুন" : p.name, function (b, close) {
      b.appendChild(el("div", { className: "help", html: '<span class="badge ' + pr.tier + '" style="margin:0 6px 0 0">' + (pr.tier === "free" ? "ফ্রি" : pr.tier === "premium" ? "পেইড" : "নিজের") + "</span>" + esc(pr.note) }));
      var name = field(b, "নাম", el("input", { value: p ? p.name : pr.name }));
      var baseIn = field(b, "Base URL", el("input", { value: p ? p.base : pr.base, placeholder: "https://…/v1" }),
        pr.id === "ollama" ? "কম্পিউটারের IP দিন, যেমন http://192.168.0.105:11434/v1 । Ollama চালানোর আগে OLLAMA_HOST=0.0.0.0 সেট করুন।" : "");
      if (pr.id !== "ollama" && pr.id !== "custom") baseIn.parentNode.hidden = true;
      var manualHide = !!pr.mediaOnly;
      var kr = el("div", { className: "keyrow" }), key = el("input", { type: "password", value: p ? p.key : "", placeholder: pr.noKey ? "দরকার নেই (ঐচ্ছিক)" : "এখানে key পেস্ট করুন", autocomplete: "off" });
      var eye = el("button", { className: "btn ghost sm", text: "👁" }); eye.onclick = function () { key.type = key.type === "password" ? "text" : "password"; };
      kr.appendChild(key); kr.appendChild(eye);
      field(b, "API key", kr, pr.keyUrl ? 'key নেই? <a href="#" id="getKey">এখানে চাপুন → ' + esc(pr.keyUrl.replace(/^https:\/\//, "")) + "</a> (লগইন করে \"Create key\")" : "");
      var gk = $("#getKey", b); if (gk) gk.onclick = function (e) { e.preventDefault(); A ? A.openUrl(pr.keyUrl) : W.open(pr.keyUrl); };
      var acct = null;
      if (pr.needsAccount) acct = field(b, "Account ID", el("input", { value: p ? (p.accountId || "") : "", placeholder: "৩২ অক্ষরের Account ID" }),
        "ধাপ: dash.cloudflare.com-এ ফ্রি অ্যাকাউন্ট খুলুন → বাঁদিকে <b>AI → Workers AI</b> → <b>Use REST API</b> → ওখানে Account ID কপি করুন আর <b>Create a Workers AI API Token</b> চেপে token নিন।");
      var manual = field(b, "মডেলের নাম (ঐচ্ছিক)", el("input", { value: p ? (p.manualModel || "") : "", placeholder: "খালি রাখলে নিজে খুঁজে নেবে" }),
        "তালিকা না এলে বা নির্দিষ্ট মডেল চাইলে নাম লিখুন।");
      if (manualHide) manual.parentNode.hidden = true;
      var status = el("div", { className: "help" }); b.appendChild(status);
      var save = function () {
        var data = { name: name.value.trim() || pr.name, base: baseIn.value.trim() || pr.base, key: key.value.trim(), manualModel: manual.value.trim() };
        if (acct) data.accountId = acct.value.trim();
        if (!p) p = S.providers.add(pr.id, data.key, data);
        else { for (var k in data) p[k] = data[k]; if (data.manualModel) p.working = ""; }
        p.enabled = true; saveSettings(); return p;
      };
      var test = btn(b, "✓ সংযোগ পরীক্ষা করে সেভ করুন", "primary", function () {
        if (!key.value.trim() && !pr.noKey) { status.textContent = "আগে API key দিন।"; status.style.color = "var(--danger)"; return; }
        status.style.color = ""; status.innerHTML = '<span class="spin"></span> পরীক্ষা করছি…'; test.disabled = true;
        var pp = save();
        S.providers.refresh(pp).then(function (ms) {
          test.disabled = false;
          var n = S.chatModels(pp).length;
          if (pr.mediaOnly) { status.style.color = "var(--ok)"; status.textContent = "✓ সংযোগ সফল! এখন ছবি বানানো যাবে।"; S.toast("✓ " + pp.name + " যুক্ত হয়েছে"); if (ui._providersPage && ui._providersPage._redraw) ui._providersPage._redraw(); return; }
          if (!n && !pp.manualModel) { status.style.color = "var(--warn)"; status.textContent = "সংযোগ হয়েছে কিন্তু কোনো চ্যাট মডেল পাওয়া যায়নি। মডেলের নাম লিখে দিন।"; return; }
          status.style.color = "var(--ok)"; status.textContent = "✓ সংযোগ সফল! " + S.bnNum(n) + "টি মডেল পাওয়া গেছে। সেরা পছন্দ: " + shortModel(S.pickModel(pp));
          S.toast("✓ " + pp.name + " যুক্ত হয়েছে"); if (ui._providersPage && ui._providersPage._redraw) ui._providersPage._redraw();
          if (!cur.msgs.length) renderConv();
        }, function (e) {
          test.disabled = false; status.style.color = "var(--danger)";
          status.textContent = /401|403|key|unauth/i.test(e.message) ? "key সঠিক না। আবার কপি করে পেস্ট করুন।" : "সমস্যা: " + e.message.slice(0, 160);
        });
      });
      if (!isNew) {
        var g = el("div", { className: "group" }); b.appendChild(g);
        switchRow(g, "চালু রাখুন", "বন্ধ করলে সাথী এটা ব্যবহার করবে না", p.enabled !== false, function (v) { p.enabled = v; saveSettings(); });
        btn(b, "🗑️ মুছে ফেলুন", "danger", function () {
          ui.confirm(p.name + " মুছে ফেলবেন?", "মুছুন").then(function (ok) {
            if (!ok) return; S.settings.providers.splice(S.settings.providers.indexOf(p), 1); saveSettings(); close();
            if (ui._providersPage && ui._providersPage._redraw) ui._providersPage._redraw();
          });
        });
      }
    });
  };

  pages.studio = function (tab) {
    ui.page("ছবি ও ভিডিও স্টুডিও", function (b, close) {
      var state = { tab: tab || "image", style: "auto", aspect: "square", count: 1, smart: true, vmode: "story", vaspect: "portrait", scenes: 5, narration: true, music: true, dur: 6 };
      var draw = function () {
        b.innerHTML = "";
        segRow(b, "", [["image", "🎨 ছবি"], ["video", "🎬 ভিডিও"]], state.tab, function (v) { state.tab = v; draw(); });
        var ib = S.media.imageBackends(), vb = S.media.videoBackends();
        var info = el("div", { className: "help" });
        if (state.tab === "image") info.innerHTML = ib.length ? "ছবি বানাবে: <b>" + ib.map(function (x) { return esc(x.name); }).join(" → ") + "</b> (একটায় না হলে পরেরটায়)" : "";
        else info.innerHTML = state.vmode === "ai" ? (vb.length ? "AI ভিডিও: <b>" + vb.map(function (x) { return esc(x.name); }).join(" → ") + "</b>" : "")
          : "ফ্রি স্টোরি ভিডিও: AI গল্প লিখবে, প্রতিটা দৃশ্যের ছবি আঁকবে, বাংলায় বর্ণনা দেবে, ক্যাপশন-মিউজিকসহ ফোনেই ভিডিও বানাবে।";
        b.appendChild(info);
        if (state.tab === "image" && !ib.length) b.appendChild(setupCard("image", "ছবি বানানোর কোনো সার্ভিস এখনো যুক্ত নেই।"));
        if (state.tab === "video" && state.vmode === "ai" && !vb.length) {
          var sc = setupCard("video", "AI ভিডিওর জন্য Pollinations-এর ফ্রি key (সীমিত), অথবা Gemini Veo / OpenAI Sora (পেইড) লাগে।"); b.appendChild(sc);
        }
        var idea = field(b, state.tab === "image" ? "কী আঁকবো?" : state.vmode === "ai" ? "কী ধরনের ভিডিও?" : "ভিডিও কী নিয়ে?",
          el("textarea", { value: state.idea || "", placeholder: state.tab === "image" ? "যেমন: বর্ষায় গ্রামের মেঠোপথে লাল ছাতা হাতে একটা মেয়ে" :
            state.vmode === "ai" ? "যেমন: সুন্দরবনের নদীতে ভোরের কুয়াশায় ভেসে চলা নৌকা, ধীরে ক্যামেরা এগোচ্ছে" : "যেমন: পিঁপড়া আর ঘাসফড়িংয়ের গল্প / আমার দোকানের ঈদ অফারের বিজ্ঞাপন / জন্মদিনের শুভেচ্ছা" }));
        idea.oninput = function () { state.idea = idea.value; };
        if (state.tab === "image") {
          var chips = el("div", { className: "emo styles" });
          S.media.STYLES.forEach(function (st) { var x = el("button", { text: st[1] }); if (st[0] === state.style) x.className = "on"; x.onclick = function () { state.style = st[0]; draw(); }; chips.appendChild(x); });
          field(b, "স্টাইল", chips);
          segRow(b, "আকার", [["square", "◻ বর্গ"], ["portrait", "▯ লম্বা"], ["landscape", "▭ চওড়া"]], state.aspect, function (v) { state.aspect = v; });
          segRow(b, "কয়টা", [[1, "১"], [2, "২"], [4, "৪"]], state.count, function (v) { state.count = v; });
          var g = el("div", { className: "group" }); b.appendChild(g);
          switchRow(g, "✨ স্মার্ট প্রম্পট", "AI আপনার আইডিয়াকে বিস্তারিত, সুন্দর প্রম্পটে বদলে দেবে", state.smart, function (v) { state.smart = v; });
        } else {
          segRow(b, "ধরন", [["story", "🎞 স্টোরি ভিডিও (ফ্রি)"], ["ai", "🤖 AI ভিডিও ক্লিপ"]], state.vmode, function (v) { state.vmode = v; draw(); });
          segRow(b, "আকার", [["portrait", "▯ রিলস"], ["landscape", "▭ ইউটিউব"], ["square", "◻ বর্গ"]], state.vaspect, function (v) { state.vaspect = v; });
          if (state.vmode === "story") {
            segRow(b, "দৃশ্য", [[3, "৩"], [5, "৫"], [7, "৭"], [10, "১০"]], state.scenes, function (v) { state.scenes = v; });
            var chips2 = el("div", { className: "emo styles" });
            S.media.STYLES.slice(0, 9).forEach(function (st) { var x = el("button", { text: st[1] }); if (st[0] === state.style) x.className = "on"; x.onclick = function () { state.style = st[0]; draw(); }; chips2.appendChild(x); });
            field(b, "ছবির স্টাইল", chips2);
            var g2 = el("div", { className: "group" }); b.appendChild(g2);
            switchRow(g2, "🎙 বাংলা বর্ণনা", "AI বা ফোনের ভয়েসে গল্প পড়ে শোনাবে", state.narration, function (v) { state.narration = v; });
            switchRow(g2, "🎵 হালকা মিউজিক", "", state.music, function (v) { state.music = v; });
          } else {
            segRow(b, "দৈর্ঘ্য", [[4, "৪ সে."], [6, "৬ সে."], [8, "৮ সে."]], state.dur, function (v) { state.dur = v; });
          }
        }
        var go = btn(b, state.tab === "image" ? "🎨 ছবি বানান" : "🎬 ভিডিও বানান", "primary", function () { run(); });
        var out = el("div", { className: "studio-out" }); b.appendChild(out);
        function prog(t, f) {
          out.innerHTML = '<div class="prog"><div class="pt"></div><div class="pbar"><i></i></div><div class="help">অ্যাপ খোলা রাখুন</div></div>';
          $(".pt", out).innerHTML = '<span class="spin"></span> ' + esc(t); if (f != null) $(".pbar i", out).style.width = Math.round(f * 100) + "%";
        }
        function run() {
          var text = (idea.value || "").trim(); if (!text) { S.toast("কী বানাবো লিখুন"); return; }
          if (!S.providers.usable().length) { pages.providers(); return; }
          go.disabled = true; if (A) A.keepAwake(true);
          var done = function () { go.disabled = false; if (A) A.keepAwake(false); };
          if (state.tab === "image") {
            prog(state.smart ? "✨ প্রম্পট সাজাচ্ছি…" : "আঁকছি…", 0.1);
            (state.smart ? S.media.enhance(text, state.style) : Promise.resolve(text)).then(function (pr) {
              prog("🎨 আঁকছি…", 0.35);
              return S.media.makeImages(pr, { aspect: state.aspect, style: state.style, count: state.count, onStatus: function (t) { prog(t, 0.5); } })
                .then(function (list) { return Promise.all(list.map(S.media.finalizeImage)); })
                .then(function (fin) {
                  out.innerHTML = ""; var g = el("div", { className: "imgs" + (fin.length > 1 ? " two" : "") }); out.appendChild(g);
                  fin.forEach(function (f) {
                    var fig = el("figure"), im = el("img", { src: f.preview }); im.onclick = function () { ui.viewImage(f.preview, f); }; fig.appendChild(im);
                    var cap = el("figcaption"); if (f.uri && A) { var sh = el("button", { text: "↗ শেয়ার" }); sh.onclick = function () { A.shareUri(f.uri, "image/*"); }; cap.appendChild(sh); }
                    fig.appendChild(cap); g.appendChild(fig);
                  });
                  out.appendChild(el("div", { className: "help", text: "✓ " + fin[0].provider + " · " + (fin[0].path ? "সেভ হয়েছে: Download/Shathi" : "") }));
                  var pp = el("details", { className: "steps" }); pp.innerHTML = "<summary>ব্যবহৃত প্রম্পট</summary>"; pp.appendChild(el("div", { className: "st", text: pr })); out.appendChild(pp);
                });
            }).catch(function (e) { out.innerHTML = ""; out.appendChild(el("div", { className: "errbox", text: e.message })); if (e.code === "no_image_provider") out.appendChild(setupCard("image")); })
              .then(done);
          } else {
            var job = state.vmode === "ai"
              ? S.media.enhance(text + " (as a short video shot: describe motion and camera)", state.style).then(function (pr) {
                  return S.media.makeAIVideo(pr, { duration: state.dur, aspect: state.vaspect, audio: true }, function (t) { prog(t); })
                    .then(function (v) { return { uri: v.uri, path: v.path, title: text.slice(0, 50), mime: "video/mp4", provider: v.provider }; });
                })
              : S.media.storyVideo(text, { scenes: state.scenes, aspect: state.vaspect, style: state.style, narration: state.narration, music: state.music }, prog)
                  .then(function (v) { if (v.blob) VIDEO_BLOBS[v.uri || v.path] = URL.createObjectURL(v.blob); return { uri: v.uri, path: v.path, title: v.title, mime: v.mime.split(";")[0], note: v.note }; });
            job.then(function (v) {
              out.innerHTML = ""; out.appendChild(videoCard(v));
              if (v.note) out.appendChild(el("div", { className: "help", text: "ℹ " + v.note }));
            }, function (e) { out.innerHTML = ""; out.appendChild(el("div", { className: "errbox", text: e.message })); }).then(done);
          }
        }
      };
      draw();
    });
  };

  var EMOJIS = ["🧬", "🤖", "🧠", "👩‍🏫", "👨‍💻", "📚", "🩺", "⚖️", "💼", "🎨", "✍️", "🕌", "🌾", "🍳", "💪", "🧘", "🎓", "📈", "🗣️", "🦉"];
  var COLORS = ["#7B61FF", "#E0457B", "#1F9D63", "#F08C00", "#2B7FFF", "#8E44AD", "#00A3A3", "#D35400"];
  var TEMPLATES = [
    ["👩‍🏫", "শিক্ষক", "তুমি একজন ধৈর্যশীল শিক্ষক। যেকোনো বিষয় সহজ বাংলায়, উদাহরণ দিয়ে ধাপে ধাপে বোঝাও। শেষে ২-৩টা ছোট প্রশ্ন করে যাচাই করো ছাত্র বুঝেছে কিনা।", 0.6],
    ["💼", "অফিস সহকারী", "তুমি একজন দক্ষ অফিস সহকারী। ইমেইল, দরখাস্ত, রিপোর্ট, মিটিং নোট পেশাদার ভাষায় লেখো। প্রয়োজনে বাংলা ও ইংরেজি দুটোতেই দাও।", 0.5],
    ["👨‍💻", "প্রোগ্রামার", "তুমি একজন সিনিয়র সফটওয়্যার ইঞ্জিনিয়ার। পরিষ্কার, চালানোর মতো কোড লেখো, ভুল খুঁজে ঠিক করো, ব্যাখ্যা বাংলায় দাও।", 0.3],
    ["🗣️", "ইংরেজি শিক্ষক", "তুমি একজন স্পোকেন ইংলিশ কোচ। আমার ইংরেজি ভুল নম্রভাবে ঠিক করে দাও, ভালো বিকল্প বাক্য দাও, আর বাংলায় কারণ বুঝিয়ে দাও।", 0.6],
    ["✍️", "লেখক", "তুমি একজন সৃজনশীল লেখক। গল্প, কবিতা, ক্যাপশন, স্ক্রিপ্ট সুন্দর সাবলীল বাংলায় লেখো।", 1.0]
  ];
  pages.custom = function () {
    ui.page("আমার মডেল", function (b, close, pg) {
      var draw = function () {
        b.innerHTML = "";
        b.appendChild(el("div", { className: "help", html: "নিজের AI মডেল বানান: নাম, ব্যক্তিত্ব, নির্দেশনা আর নিজের জ্ঞান (নোট, বইয়ের অংশ, তথ্য) দিয়ে। যেকোনো প্রোভাইডারের মডেলের উপর চলবে। নিজের কম্পিউটারের ওপেন-সোর্স মডেল চালাতে চাইলে <b>প্রোভাইডার → নিজের সার্ভার</b> যোগ করুন।" }));
        var g = el("div", { className: "group" }); b.appendChild(g);
        S.settings.customModels.forEach(function (c) {
          navRow(g, c.emoji || "🧬", c.color || "#7B61FF", esc(c.name), (c.instructions || "").slice(0, 80), function () { pages.customEdit(c); });
        });
        navRow(g, "＋", "var(--accent)", "নতুন মডেল বানান", "শূন্য থেকে", function () { pages.customEdit(null); });
        b.appendChild(el("div", { className: "gtitle", text: "তৈরি টেমপ্লেট" }));
        var g2 = el("div", { className: "group" }); b.appendChild(g2);
        TEMPLATES.forEach(function (t) {
          navRow(g2, t[0], "#7B61FF", esc(t[1]), t[2].slice(0, 70), function () { pages.customEdit(null, { emoji: t[0], name: t[1], instructions: t[2], temperature: t[3] }); });
        });
      };
      draw(); pg._redraw = draw; ui._customPage = pg;
    });
  };
  pages.customEdit = function (c, tpl) {
    var isNew = !c; var d = c ? JSON.parse(JSON.stringify(c)) : merge({ id: S.uid(), name: "", emoji: "🧬", color: COLORS[0], instructions: "", knowledge: "", base: "auto", temperature: 0.7, agent: false }, tpl || {});
    ui.page(isNew ? "নতুন মডেল" : d.name, function (b, close) {
      var name = field(b, "নাম", el("input", { value: d.name, placeholder: "যেমন: আমার শিক্ষক" }));
      var ef = el("div", { className: "emo" });
      EMOJIS.forEach(function (e) { var x = el("button", { text: e }); if (e === d.emoji) x.className = "on"; x.onclick = function () { d.emoji = e; $$("button", ef).forEach(function (y) { y.className = ""; }); x.className = "on"; }; ef.appendChild(x); });
      field(b, "আইকন", ef);
      var ins = field(b, "নির্দেশনা ও ব্যক্তিত্ব", el("textarea", { value: d.instructions, placeholder: "এই মডেল কে, কীভাবে কথা বলবে, কী করবে আর কী করবে না…" }));
      ins.style.minHeight = "130px";
      var kn = field(b, "নিজের জ্ঞান (ঐচ্ছিক)", el("textarea", { value: d.knowledge, placeholder: "তথ্য, নোট, নিয়ম, প্রোডাক্টের তালিকা, প্রশ্নোত্তর… মডেল এগুলো থেকে উত্তর দেবে" }),
        "লেখা পেস্ট করুন বা নিচের বোতাম দিয়ে .txt/.md/.csv ফাইল থেকে যোগ করুন (সর্বোচ্চ ~৬০,০০০ অক্ষর)।");
      var fb = el("input", { type: "file", accept: ".txt,.md,.csv,.json,text/*" }); fb.hidden = true; b.appendChild(fb);
      btn(b, "📄 ফাইল থেকে জ্ঞান যোগ করুন", "ghost", function () { fb.click(); });
      fb.onchange = function () { var f = fb.files[0]; if (!f) return; var r = new FileReader(); r.onload = function () { kn.value = (kn.value ? kn.value + "\n\n" : "") + "## " + f.name + "\n" + String(r.result).slice(0, 60000); S.toast("যোগ হয়েছে: " + f.name); }; r.readAsText(f); };
      var baseLbl = el("button", { className: "btn ghost", text: "মূল মডেল: " + S.modelLabel(d.base) });
      baseLbl.onclick = function () { pickModel(d.base, function (ref) { d.base = ref; baseLbl.textContent = "মূল মডেল: " + S.modelLabel(ref); }, { noCustom: true }); };
      field(b, "কোন AI-এর উপর চলবে", baseLbl);
      var tr = el("input", { type: "range", min: "0", max: "1.2", step: "0.1", value: d.temperature });
      var tl = el("div", { className: "help" }); var upd = function () { var v = +tr.value; tl.textContent = (v <= 0.3 ? "নির্ভুল ও স্থির" : v <= 0.8 ? "ভারসাম্যপূর্ণ" : "সৃজনশীল") + " (" + v + ")"; }; tr.oninput = upd; upd();
      field(b, "সৃজনশীলতা", tr).parentNode.appendChild(tl);
      btn(b, isNew ? "✓ মডেল তৈরি করুন" : "✓ সেভ করুন", "primary", function () {
        d.name = name.value.trim(); if (!d.name) { S.toast("একটা নাম দিন"); return; }
        d.instructions = ins.value.trim(); d.knowledge = kn.value; d.temperature = +tr.value;
        if (isNew) S.settings.customModels.push(d); else { var i = S.settings.customModels.indexOf(c); S.settings.customModels[i] = d; }
        saveSettings(); close(); if (ui._customPage && ui._customPage._redraw) ui._customPage._redraw();
        ui.confirm("\"" + d.name + "\" তৈরি! এখনই এর সাথে চ্যাট শুরু করবেন?", "শুরু করুন").then(function (ok) {
          if (!ok) return; $$(".page").forEach(function (p) { $(".back", p).click(); });
          cur = newConv(); cur.model = "c:" + d.id; renderConv();
        });
      });
      if (!isNew) btn(b, "🗑️ মুছে ফেলুন", "danger", function () {
        ui.confirm(d.name + " মুছে ফেলবেন?", "মুছুন").then(function (ok) {
          if (!ok) return; S.settings.customModels.splice(S.settings.customModels.indexOf(c), 1); saveSettings(); close();
          if (ui._customPage && ui._customPage._redraw) ui._customPage._redraw();
        });
      });
    });
  };

  pages.memory = function () {
    ui.page("স্মৃতি", function (b) {
      var draw = function () {
        b.innerHTML = "";
        b.appendChild(el("div", { className: "help", text: "সাথী আপনার সম্পর্কে যা মনে রাখে। চ্যাটে \"মনে রেখো…\" বললেই যোগ হয়। সব চ্যাটে কাজে লাগে।" }));
        var g0 = el("div", { className: "group" }); b.appendChild(g0);
        switchRow(g0, "স্মৃতি চালু", "বন্ধ করলে কিছু মনে রাখবে না বা ব্যবহার করবে না", S.settings.memoryOn, function (v) { S.settings.memoryOn = v; saveSettings(); });
        var list = S.memory.list(), g = el("div", { className: "group" }); b.appendChild(g);
        if (!list.length) g.appendChild(el("div", { className: "empty", text: "এখনো কিছু মনে রাখা নেই" }));
        list.slice().reverse().forEach(function (m) {
          var r = el("div", { className: "mem" }); r.appendChild(el("span", { text: m.text }));
          var x = el("button", { className: "mini", text: "✕" }); x.onclick = function () { S.memory.remove(m.id); draw(); }; r.appendChild(x); g.appendChild(r);
        });
        btn(b, "＋ নিজে যোগ করুন", "ghost", function () { ui.prompt("সাথী কী মনে রাখবে?", "").then(function (t) { if (t && t.trim()) { S.memory.add(t.trim()); draw(); } }); });
      };
      draw();
    });
  };

  pages.settings = function () {
    ui.page("সেটিংস", function (b) {
      var st = S.settings;
      b.appendChild(el("div", { className: "gtitle", text: "AI" }));
      var g = el("div", { className: "group" }); b.appendChild(g);
      navRow(g, "🔑", "#6A3DE8", "AI প্রোভাইডার ও API", S.bnNum(S.providers.usable().length) + "টি চালু", pages.providers);
      navRow(g, "🧬", "#E0457B", "আমার মডেল", S.bnNum(st.customModels.length) + "টি", pages.custom);
      navRow(g, "🧠", "#1F9D63", "স্মৃতি", S.bnNum(S.memory.list().length) + "টি তথ্য", pages.memory);
      var about = field(b, "আমার সম্পর্কে (সব চ্যাটে কাজে লাগবে)", el("textarea", { value: st.profile, placeholder: "যেমন: আমার নাম রাফি, ঢাকায় থাকি, ব্যাংকে চাকরি করি, সহজ ভাষায় উত্তর পছন্দ করি।" }));
      about.onchange = function () { st.profile = about.value.trim(); saveSettings(); };

      b.appendChild(el("div", { className: "gtitle", text: "ভয়েস" }));
      var vb = el("div"); b.appendChild(vb);
      segRow(vb, "ভয়েস থেকে লেখা", [["auto", "AI (সবচেয়ে নির্ভুল)"], ["device", "ফোনের নিজস্ব"]], st.voice.input, function (v) { st.voice.input = v; saveSettings(); });
      var t = S.voice.transcriber();
      vb.appendChild(el("div", { className: "help", text: t ? "এখন ব্যবহার হচ্ছে: " + (t.kind === "whisper" ? t.p.name + " Whisper" : "Gemini") : "AI দিয়ে ভয়েস চিনতে Groq (ফ্রি) বা Gemini যোগ করুন।" }));
      segRow(vb, "উত্তর পড়ে শোনানো", [["device", "ফোনের ভয়েস"], ["ai", "AI ভয়েস (Gemini)"]], st.voice.output, function (v) { st.voice.output = v; saveSettings(); });
      segRow(vb, "ভাষা", [["bn", "বাংলা"], ["en", "English"], ["auto", "অটো"]], st.voice.lang, function (v) { st.voice.lang = v; saveSettings(); });
      var rate = el("input", { type: "range", min: "0.6", max: "1.6", step: "0.1", value: st.voice.rate });
      rate.onchange = function () { st.voice.rate = +rate.value; saveSettings(); };
      field(vb, "কথার গতি", rate);
      var vs = el("select"); ["Kore", "Puck", "Zephyr", "Charon", "Aoede", "Leda", "Orus", "Fenrir", "Sulafat", "Achird"].forEach(function (n) { var o = el("option", { value: n, text: n }); if (n === st.voice.aiVoice) o.selected = true; vs.appendChild(o); });
      vs.onchange = function () { st.voice.aiVoice = vs.value; saveSettings(); };
      field(vb, "AI ভয়েসের কণ্ঠ", vs);
      var g2 = el("div", { className: "group" }); vb.appendChild(g2);
      switchRow(g2, "উত্তর নিজে থেকে পড়ে শোনাবে", "প্রতিটা উত্তর শেষে", st.voice.autoSpeak, function (v) { st.voice.autoSpeak = v; saveSettings(); });
      btn(vb, "🔊 ভয়েস পরীক্ষা করুন", "ghost", function () { ui.speakMsg("আসসালামু আলাইকুম! আমি সাথী। আমার কথা কি পরিষ্কার শোনা যাচ্ছে?"); });
      btn(vb, "⚙️ ফোনের ভয়েস সেটিংস / বাংলা ভয়েস ইনস্টল", "ghost", function () { if (A) A.installTtsData(); });

      b.appendChild(el("div", { className: "gtitle", text: "এজেন্ট" }));
      var g3 = el("div", { className: "group" }); b.appendChild(g3);
      switchRow(g3, "ফাইল সেভের আগে জিজ্ঞেস করবে", "ফাইল মোছার আগে সবসময় জিজ্ঞেস করে", st.agent.confirmFiles, function (v) { st.agent.confirmFiles = v; saveSettings(); });
      var ms = el("input", { type: "number", min: "4", max: "40", value: st.agent.maxSteps });
      ms.onchange = function () { st.agent.maxSteps = Math.max(4, Math.min(40, +ms.value || 16)); saveSettings(); };
      field(b, "এক কাজে সর্বোচ্চ ধাপ", ms);
      btn(b, "📁 ফাইলের অনুমতি (স্টোরেজ)", "ghost", function () { if (A) A.requestStorage(); });

      b.appendChild(el("div", { className: "gtitle", text: "চেহারা" }));
      segRow(b, "", [["dark", "🌙 ডার্ক"], ["light", "☀️ লাইট"], ["auto", "অটো"]], st.theme, function (v) { st.theme = v; saveSettings(); applyTheme(); });

      b.appendChild(el("div", { className: "gtitle", text: "ডেটা" }));
      btn(b, "💾 সব চ্যাটের ব্যাকআপ (Download-এ)", "ghost", function () {
        var data = JSON.stringify({ app: "shathi", v: 2, chats: convs, memory: S.memory.list(), customModels: st.customModels }, null, 1);
        if (!A) { S.copy(data); return; }
        S.J(A.writeFile("Download/shathi-backup-" + new Date().toISOString().slice(0, 10) + ".json", data), {});
        S.toast("Download/Shathi ফোল্ডারে সেভ হয়েছে");
      });
      btn(b, "🗑️ সব চ্যাট মুছে ফেলুন", "danger", function () {
        ui.confirm("সব চ্যাট চিরতরে মুছে যাবে। নিশ্চিত?", "মুছুন").then(function (ok) { if (!ok) return; convs = []; cur = newConv(); saveChats(); renderConv(); S.toast("মুছে ফেলা হয়েছে"); });
      });
      b.appendChild(el("div", { className: "help", html: "<br>সাথী AI " + esc(A ? A.appVersion() : "dev") + " · আপনার key ও চ্যাট শুধু এই ফোনে থাকে; শুধু আপনার বেছে নেওয়া AI প্রোভাইডারের কাছে পাঠানো হয়।" }));
    });
  };

  /* =========================================================
   * theme & boot
   * ========================================================= */
  function applyTheme() {
    var t = S.settings.theme;
    if (t === "auto") t = W.matchMedia && W.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    document.documentElement.dataset.theme = t;
  }
  applyTheme();
  cur = newConv();
  renderConv();
  S.voice.prepare();
  // refresh model lists in the background once a day
  S.providers.usable().forEach(function (p) {
    if (!p.fetchedAt || Date.now() - p.fetchedAt > 864e5) S.providers.refresh(p).catch(function () {});
  });
  S._debug = { convs: function () { return convs; }, cur: function () { return cur; }, routesFor: routesFor, systemPrompt: systemPrompt };
})(window);
