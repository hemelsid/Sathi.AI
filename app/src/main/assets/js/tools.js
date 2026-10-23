/* সাথী AI — agent tools */
(function (W) {
  "use strict";
  var S = W.Shathi, A = S.A;

  function needApp() { if (!A) throw new Error("শুধু অ্যাপের ভেতরে চলে"); }
  var str = function (d) { return { type: "string", description: d }; };
  var num = function (d) { return { type: "number", description: d }; };
  var obj = function (props, req) { return { type: "object", properties: props || {}, required: req || [] }; };

  /* ---------- helpers ---------- */
  function stripHtml(h) {
    try {
      var doc = new DOMParser().parseFromString(h, "text/html");
      S.$$("script,style,noscript,svg,nav,footer,header,form,iframe", doc).forEach(function (e) { e.remove(); });
      var title = doc.title || "";
      var main = doc.querySelector("article") || doc.querySelector("main") || doc.body;
      var t = (main ? main.innerText || main.textContent : "") || "";
      return { title: title, text: t.replace(/[ \t\r\f\v]+/g, " ").replace(/\n\s*\n+/g, "\n").trim() };
    } catch (e) { return { title: "", text: String(h).replace(/<[^>]+>/g, " ") }; }
  }
  var WMO = { 0: "পরিষ্কার আকাশ", 1: "প্রায় পরিষ্কার", 2: "আংশিক মেঘলা", 3: "মেঘলা", 45: "কুয়াশা", 48: "ঘন কুয়াশা",
    51: "হালকা গুঁড়ি বৃষ্টি", 53: "গুঁড়ি বৃষ্টি", 55: "ঘন গুঁড়ি বৃষ্টি", 61: "হালকা বৃষ্টি", 63: "বৃষ্টি", 65: "ভারী বৃষ্টি",
    66: "ঠান্ডা বৃষ্টি", 67: "ভারী ঠান্ডা বৃষ্টি", 71: "হালকা তুষার", 73: "তুষার", 75: "ভারী তুষার", 80: "হালকা ঝরো বৃষ্টি",
    81: "ঝরো বৃষ্টি", 82: "প্রবল ঝরো বৃষ্টি", 95: "বজ্রঝড়", 96: "শিলাসহ বজ্রঝড়", 99: "প্রবল শিলাসহ বজ্রঝড়" };

  function ddg(q) {
    return S.http({ url: "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q) + "&kl=bd-en" }).promise.then(function (r) {
      var doc = new DOMParser().parseFromString(r.body || "", "text/html"), out = [];
      S.$$(".result", doc).forEach(function (el) {
        var a = el.querySelector("a.result__a"); if (!a || out.length >= 8) return;
        var href = a.getAttribute("href") || "", m = /[?&]uddg=([^&]+)/.exec(href), sn = el.querySelector(".result__snippet");
        out.push({ title: a.textContent.trim(), url: m ? decodeURIComponent(m[1]) : href, snippet: sn ? sn.textContent.trim() : "" });
      });
      return out;
    });
  }

  function runJS(code) {
    return new Promise(function (resolve) {
      var src = "var __out=[];var console={log:function(){__out.push(Array.prototype.map.call(arguments,function(a){try{return typeof a==='object'?JSON.stringify(a):String(a)}catch(e){return String(a)}}).join(' '))}};" +
        "self.onmessage=function(e){try{var r=(new Function(e.data))();Promise.resolve(r).then(function(v){postMessage({result:v===undefined?null:v,logs:__out})},function(err){postMessage({error:String(err),logs:__out})})}catch(err){postMessage({error:String(err),logs:__out})}}";
      var w;
      try { w = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" }))); }
      catch (e) {
        try { var logs = [], con = { log: function () { logs.push([].slice.call(arguments).join(" ")); } };
          var v = new Function("console", code)(con); resolve({ result: v === undefined ? null : v, logs: logs }); }
        catch (err) { resolve({ error: String(err) }); }
        return;
      }
      var t = setTimeout(function () { w.terminate(); resolve({ error: "সময় শেষ (৮ সেকেন্ড)" }); }, 8000);
      w.onmessage = function (e) { clearTimeout(t); w.terminate(); var d = e.data; try { JSON.stringify(d.result); } catch (x) { d.result = String(d.result); } resolve(d); };
      w.onerror = function (e) { clearTimeout(t); w.terminate(); resolve({ error: e.message || "error" }); };
      w.postMessage(code);
    });
  }

  /* ---------- tool table ---------- */
  // group: chat = always available; agent = only in agent mode. confirm: ask user first.
  var T = [
    { name: "web_search", group: "chat", label: "🔍 ওয়েবে খুঁজছে",
      description: "Search the internet for current or factual info (news, prices, sports, people, products, rules, events). Returns an answer and/or results with links. Prefer this over guessing.",
      parameters: obj({ query: str("Search query, in the best language for the topic") }, ["query"]),
      run: function (a, ctx) { return S.webSearch(a.query, ctx); } },
    { name: "fetch_url", group: "chat", label: "🌐 পেজ পড়ছে",
      description: "Read the main text of a web page.",
      parameters: obj({ url: str("http(s) URL") }, ["url"]),
      run: function (a) {
        if (!/^https?:\/\//.test(a.url || "")) return { error: "Only http(s)" };
        return S.http({ url: a.url }).promise.then(function (r) {
          if (r.status >= 400) return { error: "HTTP " + r.status };
          var x = stripHtml(r.body || ""); return { url: a.url, title: x.title, text: x.text.slice(0, 12000) };
        });
      } },
    { name: "calculate", group: "chat", label: "🧮 হিসাব করছে",
      description: "Evaluate a math expression exactly. JavaScript syntax; Math.* allowed (e.g. '1250*12*0.075', 'Math.sqrt(2)'). Use for any arithmetic.",
      parameters: obj({ expression: str("Math expression") }, ["expression"]),
      run: function (a) {
        var e = String(a.expression || ""), MATH = /Math\.(PI|E|sqrt|cbrt|pow|log|log10|log2|exp|abs|floor|ceil|round|trunc|min|max|sin|cos|tan|asin|acos|atan|atan2|hypot|sign)\b/g;
        if (!/^[\d\s+\-*\/%().,eE^]*$/.test(e.replace(MATH, ""))) return { error: "Only math expressions" };
        try { return { expression: e, result: Function('"use strict";return (' + e.replace(/\^/g, "**") + ")")() }; }
        catch (x) { return { error: String(x.message) }; }
      } },
    { name: "run_code", group: "agent", label: "💻 কোড চালাচ্ছে",
      description: "Run JavaScript in a sandbox (no network, 8s limit) for data processing, multi-step calculations, date math, text transforms or simulations. Use console.log for output and/or `return` a value.",
      parameters: obj({ code: str("JavaScript function body") }, ["code"]),
      run: function (a) { return runJS(String(a.code || "")); } },
    { name: "weather", group: "chat", label: "⛅ আবহাওয়া দেখছে",
      description: "Current weather and forecast for a place (city/area name, any language).",
      parameters: obj({ location: str("Place name, e.g. Dhaka"), days: num("Forecast days 1-7, default 3") }, ["location"]),
      run: function (a) {
        var q = encodeURIComponent(a.location || "Dhaka");
        return S.getJSON("https://geocoding-api.open-meteo.com/v1/search?count=1&language=en&name=" + q).then(function (g) {
          var r = (g.results || [])[0]; if (!r) return { error: "জায়গা পাওয়া যায়নি: " + a.location };
          var d = Math.max(1, Math.min(7, a.days || 3));
          return S.getJSON("https://api.open-meteo.com/v1/forecast?latitude=" + r.latitude + "&longitude=" + r.longitude +
            "&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,precipitation" +
            "&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset&timezone=auto&forecast_days=" + d)
            .then(function (w) {
              var c = w.current || {};
              return { place: r.name + (r.admin1 ? ", " + r.admin1 : "") + ", " + (r.country || ""),
                now: { temp_c: c.temperature_2m, feels_like_c: c.apparent_temperature, humidity: c.relative_humidity_2m,
                  wind_kmh: c.wind_speed_10m, rain_mm: c.precipitation, sky: WMO[c.weather_code] || c.weather_code },
                daily: (w.daily && w.daily.time || []).map(function (t, i) {
                  return { date: t, sky: WMO[w.daily.weather_code[i]], max_c: w.daily.temperature_2m_max[i], min_c: w.daily.temperature_2m_min[i],
                    rain_chance: w.daily.precipitation_probability_max[i], sunrise: w.daily.sunrise[i], sunset: w.daily.sunset[i] };
                }), source: "open-meteo.com" };
            });
        });
      } },
    { name: "currency", group: "chat", label: "💱 মুদ্রার রেট দেখছে",
      description: "Live currency exchange rate / conversion (e.g. USD to BDT). Note: official/market rate, not local kerb market.",
      parameters: obj({ from: str("ISO code, e.g. USD"), to: str("ISO code, e.g. BDT"), amount: num("Amount, default 1") }, ["from", "to"]),
      run: function (a) {
        var f = String(a.from || "USD").toUpperCase(), t = String(a.to || "BDT").toUpperCase(), amt = a.amount || 1;
        return S.getJSON("https://open.er-api.com/v6/latest/" + f).then(function (d) {
          var rate = d.rates && d.rates[t]; if (!rate) return { error: "রেট পাওয়া যায়নি" };
          return { from: f, to: t, rate: rate, amount: amt, result: +(amt * rate).toFixed(4), updated: d.time_last_update_utc, source: "open.er-api.com" };
        });
      } },
    { name: "wikipedia", group: "chat", label: "📚 উইকিপিডিয়া পড়ছে",
      description: "Get a Wikipedia summary about a topic. lang 'bn' for Bangla Wikipedia, 'en' for English.",
      parameters: obj({ query: str("Topic"), lang: str("bn or en, default en") }, ["query"]),
      run: function (a) {
        var lang = a.lang === "bn" ? "bn" : "en";
        return S.getJSON("https://" + lang + ".wikipedia.org/w/api.php?action=opensearch&limit=1&format=json&search=" + encodeURIComponent(a.query))
          .then(function (s) {
            var title = s && s[1] && s[1][0]; if (!title) return { error: "পাওয়া যায়নি" };
            return S.getJSON("https://" + lang + ".wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(title)).then(function (d) {
              return { title: d.title, summary: d.extract, url: d.content_urls && d.content_urls.mobile && d.content_urls.mobile.page };
            });
          });
      } },
    { name: "generate_image", group: "chat", label: "🎨 ছবি আঁকছে",
      description: "Create image(s) from a description: illustrations, photos, posters, logos, art, thumbnails. Write the prompt in detailed English (subject, setting, composition, lighting, colors, mood). Images are shown to the user and saved automatically. ONLY say an image was created if this returns ok:true.",
      parameters: obj({ prompt: str("Detailed English description"), aspect: str("square | portrait | landscape"),
        style: str("auto | photo | cinematic | cartoon | anime | 3d | painting | watercolor | sketch | logo | poster"), count: num("1-4, default 1") }, ["prompt"]),
      run: function (a, ctx) {
        return S.media.makeImages(a.prompt, { aspect: a.aspect || "square", style: a.style || "auto", count: a.count || 1,
          onStatus: function (t) { ctx && ctx.progress && ctx.progress(t); } })
          .then(function (list) {
            return Promise.all(list.map(S.media.finalizeImage)).then(function (fin) {
              fin.forEach(function (f) { if (ctx && ctx.addImage) ctx.addImage(f.preview, f); });
              return { ok: true, created: fin.length, provider: fin[0].provider, saved_to: fin.map(function (f) { return f.path; }).filter(Boolean),
                note: "Images are displayed to the user. Describe briefly; don't paste URLs." };
            });
          }, function (e) {
            if (ctx && ctx.needSetup) ctx.needSetup("image", e.message);
            return { ok: false, error: e.message, tell_user: "Image was NOT created. Explain briefly and say a free image service (Cloudflare, Pollinations or Hugging Face key) can be added from the button shown." };
          });
      } },
    { name: "generate_video", group: "chat", label: "🎬 AI ভিডিও বানাচ্ছে",
      description: "Generate a short AI video clip (4-8 s) from a detailed English prompt (scene, action, camera movement, style, sound). Needs a video service; if none works, it automatically makes a free narrated story video instead. ONLY claim success if ok:true.",
      parameters: obj({ prompt: str("Detailed English video prompt"), duration: num("seconds 4-8"), aspect: str("landscape | portrait"), audio: { type: "boolean", description: "with sound" } }, ["prompt"]),
      run: function (a, ctx) {
        var st = function (t) { ctx && ctx.progress && ctx.progress(t); };
        return S.media.makeAIVideo(a.prompt, { duration: a.duration || 6, aspect: a.aspect || "landscape", audio: a.audio !== false }, st).then(function (v) {
          if (ctx && ctx.addVideo) ctx.addVideo({ uri: v.uri, path: v.path, title: a.prompt.slice(0, 60), mime: "video/mp4" });
          return { ok: true, kind: "ai_video", provider: v.provider, saved_to: v.path };
        }, function (e) {
          st("AI ভিডিও হয়নি → ফ্রি স্টোরি ভিডিও বানাচ্ছি");
          return S.tools_storyVideo({ topic: a.prompt, scenes: 4, aspect: a.aspect === "portrait" ? "portrait" : "landscape", narration: true }, ctx)
            .then(function (r) { r.ai_video_error = e.message; r.note = "AI video service unavailable (" + e.message + "), so a free narrated story video was made instead. Tell the user this honestly."; return r; });
        });
      } },
    { name: "make_animation", group: "chat", label: "✨ অ্যানিমেশন বানাচ্ছে",
      description: "FREE & unlimited (made on the phone): short animated video with lines of text appearing one by one over an animated background or an AI picture, with effects (sparkle, fireflies, snow, rain, hearts, confetti, light, bubbles, zoom, pan) and soft music. Best for wishes, quotes, status videos, simple ads. ONLY claim success if ok:true.",
      parameters: obj({ lines: { type: "array", items: { type: "string" }, description: "2-6 short lines (max 8 words each) in the user's language" },
        effect: str("sparkle | fireflies | snow | rain | hearts | confetti | light | bubbles | zoom | pan"), image_prompt: str("optional English prompt for a background picture"),
        duration: num("seconds 6-30, default 10"), aspect: str("portrait | square | landscape") }, ["lines"]),
      run: function (a, ctx) {
        var st = function (t) { ctx && ctx.progress && ctx.progress(t); };
        var img = a.image_prompt && S.media.imageBackends().length ? (st("🎨 পটভূমির ছবি আঁকছি…"), S.media.makeImage(a.image_prompt, { aspect: a.aspect || "portrait" }).then(function (r) { return r.src; }, function () { return null; })) : Promise.resolve(null);
        return img.then(function (src) {
          return S.media.animate({ image: src, lines: a.lines || [], effect: a.effect || "sparkle", duration: a.duration || 10, aspect: a.aspect || "portrait",
            onProg: function (f) { st("✨ অ্যানিমেশন বানাচ্ছি… " + S.bnNum(Math.round(f * 100)) + "%"); } });
        }).then(function (v) {
          if (ctx && ctx.addVideo) ctx.addVideo({ uri: v.uri, path: v.path, blob: v.blob, title: (a.lines || [""])[0], mime: v.mime.split(";")[0] });
          return { ok: true, kind: "animation", seconds: Math.round(v.duration), saved_to: v.path };
        }, function (e) { return { ok: false, error: e.message }; });
      } },
    { name: "make_story_video", group: "chat", label: "🎞 স্টোরি ভিডিও বানাচ্ছে",
      description: "Make a FREE narrated video on the phone: writes a script, draws a picture for each scene, adds Bangla voice narration, captions, music and smooth motion. Great for stories, explainers, reels, birthday wishes, ads, lessons. Takes 1-3 minutes. ONLY claim success if ok:true.",
      parameters: obj({ topic: str("What the video is about (any language), with any details the user gave"), scenes: num("3-10, default 5"),
        aspect: str("portrait (reels) | landscape | square"), style: str("visual style id, e.g. cartoon, photo, anime, 3d, watercolor"), narration: { type: "boolean", description: "voice narration, default true" } }, ["topic"]),
      run: function (a, ctx) { return S.tools_storyVideo(a, ctx); } },
    { name: "remember", group: "chat", label: "🧠 মনে রাখছে",
      description: "Save a lasting fact about the user (name, preferences, job, family, goals) when they share it or ask you to remember. Keep it short.",
      parameters: obj({ fact: str("Short fact, in Bangla") }, ["fact"]),
      run: function (a) { return S.memory.add(a.fact); } },
    { name: "forget", group: "chat", label: "🧠 ভুলে যাচ্ছে",
      description: "Delete a saved memory that matches the given text.",
      parameters: obj({ text: str("Part of the memory to delete") }, ["text"]),
      run: function (a) { return S.memory.remove(a.text); } },

    /* ---- phone & agent tools ---- */
    { name: "device_info", group: "agent", label: "🔋 ফোনের তথ্য দেখছে",
      description: "Phone status: model, Android version, battery %, charging, temperature, RAM, storage free, current local date/time.",
      parameters: obj({}), run: function () { needApp(); return S.J(A.deviceInfo(), {}); } },
    { name: "storage_summary", group: "agent", label: "📊 স্টোরেজ স্ক্যান করছে",
      description: "Scan phone storage: biggest folders, file types, largest files. Slow on big phones.",
      parameters: obj({ path: str("Folder, default /sdcard") }),
      run: function (a) { needApp(); return S.sleep(30).then(function () { return S.J(A.storageSummary(a.path || "/sdcard", 15), {}); }); } },
    { name: "list_dir", group: "agent", label: "📁 ফোল্ডার দেখছে",
      description: "List files in a phone folder (/sdcard is root, e.g. /sdcard/Download).",
      parameters: obj({ path: str("Folder path") }, ["path"]),
      run: function (a) { needApp(); return S.J(A.listDir(a.path), {}); } },
    { name: "read_file", group: "agent", label: "📄 ফাইল পড়ছে",
      description: "Read a text file on the phone.",
      parameters: obj({ path: str("File path") }, ["path"]),
      run: function (a) { needApp(); return S.J(A.readFile(a.path, 12000), {}); } },
    { name: "save_file", group: "agent", label: "💾 ফাইল সেভ করছে", confirm: "file",
      description: "Save text as a file in the phone's Download/Shathi folder (notes, letters, reports, CSV, HTML, code). Give a file name with extension.",
      parameters: obj({ filename: str("e.g. report.md, list.csv, page.html"), content: str("Full file content") }, ["filename", "content"]),
      ask: function (a) { return "এই ফাইলটা Download/Shathi-এ সেভ করবো?\n\n" + a.filename; },
      run: function (a) { needApp(); return S.J(A.writeFile("Download/" + String(a.filename).replace(/[\/\\]/g, "_"), a.content || ""), {}); } },
    { name: "move_to_trash", group: "agent", label: "🗑️ ফাইল সরাচ্ছে", confirm: "always",
      description: "Move files to a recoverable trash to free space. Only when the user asked to delete/clean.",
      parameters: obj({ paths: { type: "array", items: { type: "string" }, description: "File paths" } }, ["paths"]),
      ask: function (a) { return (a.paths || []).length + "টি ফাইল ট্র্যাশে যাবে (ফেরত আনা যাবে):\n\n" + (a.paths || []).join("\n"); },
      run: function (a) { needApp(); return { results: (a.paths || []).map(function (p) { return S.J(A.moveToTrash(p), {}); }) }; } },
    { name: "set_alarm", group: "agent", label: "⏰ অ্যালার্ম দিচ্ছে",
      description: "Set an alarm in the phone's clock app (opens it for the user to confirm).",
      parameters: obj({ hour: num("0-23"), minute: num("0-59"), label: str("Label") }, ["hour", "minute"]),
      run: function (a) { needApp(); return S.J(A.setAlarm(a.hour | 0, a.minute | 0, a.label || "সাথী"), {}); } },
    { name: "set_timer", group: "agent", label: "⏱️ টাইমার দিচ্ছে",
      description: "Start a countdown timer in the clock app.",
      parameters: obj({ seconds: num("Duration in seconds"), label: str("Label") }, ["seconds"]),
      run: function (a) { needApp(); return S.J(A.setTimer(a.seconds | 0, a.label || "সাথী"), {}); } },
    { name: "add_calendar_event", group: "agent", label: "📅 ক্যালেন্ডারে যোগ করছে",
      description: "Open the calendar app with a new event filled in (user saves it). Times in ISO 8601 local time, e.g. 2026-10-25T15:00.",
      parameters: obj({ title: str("Title"), start: str("ISO start"), end: str("ISO end (optional)"), description: str("Notes"), location: str("Place") }, ["title", "start"]),
      run: function (a) {
        needApp(); var s = new Date(a.start).getTime(); if (isNaN(s)) return { error: "Bad start time" };
        var e = a.end ? new Date(a.end).getTime() : s + 3600e3;
        return S.J(A.calendarEvent(a.title, a.description || "", s, isNaN(e) ? s + 3600e3 : e, a.location || ""), {});
      } },
    { name: "make_call", group: "agent", label: "📞 কল খুলছে",
      description: "Open the phone dialer with a number (user taps call).",
      parameters: obj({ number: str("Phone number") }, ["number"]),
      run: function (a) { needApp(); return S.J(A.dial(a.number), {}); } },
    { name: "send_sms", group: "agent", label: "💬 SMS লিখছে",
      description: "Open the SMS app with the message filled in (user taps send).",
      parameters: obj({ number: str("Phone number (optional)"), message: str("Message") }, ["message"]),
      run: function (a) { needApp(); return S.J(A.sms(a.number || "", a.message), {}); } },
    { name: "send_email", group: "agent", label: "✉️ ইমেইল লিখছে",
      description: "Open the email app with a drafted email (user sends).",
      parameters: obj({ to: str("Address (optional)"), subject: str("Subject"), body: str("Body") }, ["subject", "body"]),
      run: function (a) { needApp(); return S.J(A.email(a.to || "", a.subject, a.body), {}); } },
    { name: "open_map", group: "agent", label: "🗺️ ম্যাপ খুলছে",
      description: "Open a place or search in the maps app.",
      parameters: obj({ query: str("Place / search") }, ["query"]),
      run: function (a) { needApp(); return S.J(A.openMap(a.query), {}); } },
    { name: "open_link", group: "agent", label: "🔗 লিংক খুলছে",
      description: "Open a URL in the browser or its app (YouTube, Facebook, etc.).",
      parameters: obj({ url: str("https URL") }, ["url"]),
      run: function (a) { if (!/^https?:\/\//.test(a.url || "")) return { error: "bad url" }; needApp(); A.openUrl(a.url); return { ok: true }; } },
    { name: "clipboard", group: "agent", label: "📋 ক্লিপবোর্ড",
      description: "Copy text to the clipboard (action 'copy') or read the current clipboard (action 'read').",
      parameters: obj({ action: str("copy | read"), text: str("Text to copy") }, ["action"]),
      run: function (a) {
        if (a.action === "read") { needApp(); return { text: A.readClipboard().slice(0, 8000) }; }
        S.copy(a.text || ""); return { ok: true };
      } }
  ];
  S.TOOLS = T;
  S.toolByName = function (n) { for (var i = 0; i < T.length; i++) if (T[i].name === n) return T[i]; return null; };
  S.toolsFor = function (mode) {
    return T.filter(function (t) { return mode === "agent" || t.group === "chat"; })
      .map(function (t) { return { name: t.name, description: t.description, parameters: t.parameters }; });
  };

  /* ---------- web search: Gemini grounding → DuckDuckGo ---------- */
  S.webSearch = function (q, ctx) {
    var g = S.providers.find("gemini");
    var viaGemini = g ? S.callModel({ p: g, model: S.pickModel(g), grounding: true, temperature: 0.2,
      msgs: [{ role: "user", text: "Search the web and answer factually with specific numbers, names and dates. Today is " + new Date().toDateString() + ". Question: " + q }] })
      .then(function (r) { if (!r.text) throw new Error("empty"); return { query: q, answer: r.text, sources: (r.sources || []).slice(0, 6) }; })
      : Promise.reject(new Error("no gemini"));
    return viaGemini.catch(function () {
      return ddg(q).then(function (res) {
        if (!res.length) return { error: "কোনো ফলাফল পাওয়া যায়নি" };
        return { query: q, results: res, hint: "Use fetch_url on the 1-2 most relevant links for details before answering." };
      });
    });
  };

  S.tools_storyVideo = function (a, ctx) {
    return S.media.storyVideo(a.topic, { scenes: a.scenes || 5, aspect: a.aspect || "portrait", style: a.style, narration: a.narration !== false },
      function (t) { ctx && ctx.progress && ctx.progress(t); })
      .then(function (v) {
        if (ctx && ctx.addVideo) ctx.addVideo({ uri: v.uri, path: v.path, blob: v.blob, title: v.title, mime: v.mime.split(";")[0] });
        return { ok: true, kind: "story_video", title: v.title, scenes: v.scenes, seconds: Math.round(v.duration), narrated: v.narrated,
          ai_images: v.images, saved_to: v.path, note: v.note || undefined };
      }, function (e) { return { ok: false, error: e.message }; });
  };

  /* ---------- (legacy) image generation ---------- */
  S.generateImage = function (prompt, aspect, ctx) {
    var tries = [];
    var g = S.providers.find("gemini");
    if (g) tries.push(function () {
      var models = (g.allModels || []).filter(function (m) { return /image/.test(m) && !/imagen|tts|lite-image/.test(m); });
      if (!models.length && !(g.allModels || []).length) models = ["gemini-3.1-flash-image"];
      if (!models.length) return Promise.reject(new Error("no image model for this key"));
      var tryOne = function (i) {
        if (i >= models.length) return Promise.reject(new Error("no image model"));
        return S.callModel({ p: g, model: models[i], msgs: [{ role: "user", text: "Generate an image (" + aspect + "): " + prompt }], temperature: 0.8 })
          .then(function (r) { if (r.images && r.images.length) return r.images[0]; throw new Error("no image"); })
          .catch(function () { return tryOne(i + 1); });
      };
      return tryOne(0);
    });
    var o = S.providers.find("openai");
    if (o) tries.push(function () {
      var size = aspect === "portrait" ? "1024x1536" : aspect === "landscape" ? "1536x1024" : "1024x1024";
      return S.http({ url: o.base.replace(/\/+$/, "") + "/images/generations", headers: S.authHeaders(o),
        body: { model: "gpt-image-1", prompt: prompt, size: size, n: 1 } }).promise.then(function (r) {
        var d = S.J(r.body, {}); var b = d.data && d.data[0];
        if (r.status >= 400 || !b) throw new Error("openai image failed");
        return b.b64_json ? "data:image/png;base64," + b.b64_json : b.url;
      });
    });
    tries.push(function () {
      var pl = S.providers.find("pollinations");
      var wh = aspect === "portrait" ? "&width=768&height=1152" : aspect === "landscape" ? "&width=1152&height=768" : "&width=1024&height=1024";
      var url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt) + "?model=flux&nologo=true&seed=" + (Math.random() * 1e6 | 0) + wh +
        (pl && pl.key ? "&key=" + encodeURIComponent(pl.key) : "");
      return Promise.resolve(url);
    });
    var go = function (i) {
      if (i >= tries.length) return Promise.reject(new Error("ছবি বানানো যায়নি"));
      return tries[i]().catch(function () { return go(i + 1); });
    };
    return go(0).then(function (src) {
      if (ctx && ctx.addImage) ctx.addImage(src, prompt);
      return { ok: true, shown_to_user: true, note: "Image is displayed to the user. Do not repeat the URL." };
    }, function (e) { return { error: e.message }; });
  };
})(window);
