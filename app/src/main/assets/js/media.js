/* সাথী AI — media: smart image generation, AI video, free story-video maker */
(function (W) {
  "use strict";
  var S = W.Shathi, A = S.A;
  var M = S.media = {};

  M.STYLES = [
    ["auto", "✨ অটো", ""],
    ["photo", "📷 বাস্তব ছবি", "photorealistic, natural light, sharp focus, highly detailed, 35mm photography"],
    ["cinematic", "🎬 সিনেমাটিক", "cinematic still, dramatic lighting, shallow depth of field, film color grading"],
    ["cartoon", "🧸 কার্টুন", "colorful cartoon illustration, clean outlines, friendly, flat shading"],
    ["anime", "🌸 অ্যানিমে", "anime style, studio-quality, vibrant colors, detailed background"],
    ["3d", "🧊 ৩ডি", "3D render, Pixar-like, soft global illumination, cute, high detail"],
    ["painting", "🖼 তেলরঙ", "oil painting, rich textured brush strokes, fine art"],
    ["watercolor", "💧 জলরঙ", "soft watercolor painting, paper texture, gentle colors"],
    ["sketch", "✏️ স্কেচ", "detailed pencil sketch, graphite shading on paper"],
    ["logo", "🔷 লোগো", "minimal flat vector logo, simple geometric shapes, centered, plain white background"],
    ["poster", "📰 পোস্টার", "bold graphic poster design, strong composition, vivid colors"]
  ];
  M.ASPECTS = { square: [1024, 1024], portrait: [768, 1344], landscape: [1344, 768] };
  function styleText(id) { for (var i = 0; i < M.STYLES.length; i++) if (M.STYLES[i][0] === id) return M.STYLES[i][2]; return ""; }

  /* ---------------- helpers ---------------- */
  function loadImg(src, timeout) {
    return new Promise(function (res, rej) {
      var im = new Image(), t = setTimeout(function () { rej(new Error("ছবি লোড হতে দেরি হচ্ছে")); }, timeout || 60000);
      im.onload = function () { clearTimeout(t); if (im.naturalWidth > 8) res(im); else rej(new Error("ভাঙা ছবি")); };
      im.onerror = function () { clearTimeout(t); rej(new Error("ছবি লোড হয়নি")); };
      im.src = src;
    });
  }
  M.loadImg = loadImg;
  M.resize = function (src, max, q) {
    return loadImg(src).then(function (im) {
      var k = Math.min(1, max / Math.max(im.naturalWidth, im.naturalHeight)), c = document.createElement("canvas");
      c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k);
      c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
      return c.toDataURL("image/jpeg", q || 0.86);
    });
  };
  function dataUrlToBlob(d) {
    var parts = d.split(","), mime = parts[0].slice(5).split(";")[0], bin = atob(parts[1]), u8 = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return new Blob([u8], { type: mime });
  }
  M.dataUrlToBlob = dataUrlToBlob;
  M.saveDataUrl = function (d, name) {
    var b = dataUrlToBlob(d); return S.saveBlob(b, name, b.type);
  };
  function mimeFromB64(b64, ctype) {
    if (ctype && /^image\//.test(ctype)) return ctype.split(";")[0];
    if (/^\/9j/.test(b64)) return "image/jpeg"; if (/^iVBOR/.test(b64)) return "image/png"; if (/^UklGR/.test(b64)) return "image/webp";
    return "image/png";
  }
  function friendly(prov, status, body) {
    var t = String(body || "");
    if (status === 401 || status === 403 || /unauthori|invalid.*(token|key)|authentication/i.test(t)) return prov + ": key/টোকেন সঠিক না";
    if (status === 402 || /insufficient|balance|pollen|credit|payment|billing|quota|exceeded|limit/i.test(t)) return prov + ": ফ্রি লিমিট/ক্রেডিট শেষ বা এই মডেল পেইড";
    if (status === 429) return prov + ": এই মুহূর্তে লিমিট শেষ";
    if (status === 404) return prov + ": মডেল পাওয়া যায়নি";
    var m = /"message"\s*:\s*"([^"]{0,140})/.exec(t);
    return prov + ": " + (m ? m[1] : "HTTP " + status);
  }

  /* ---------------- which backends are available ---------------- */
  M.imageBackends = function () {
    var out = [], P = S.providers;
    var cf = P.find("cloudflare"); if (cf && cf.accountId) out.push({ id: "cloudflare", p: cf, name: "Cloudflare FLUX", free: true });
    var po = P.find("pollinations"); if (po) out.push({ id: "pollinations", p: po, name: "Pollinations", free: true });
    var hf = P.find("huggingface"); if (hf) out.push({ id: "huggingface", p: hf, name: "Hugging Face FLUX", free: true });
    var g = P.find("gemini");
    if (g && (g.allModels || []).some(function (m) { return /image/.test(m) && !/imagen/.test(m); })) out.push({ id: "gemini", p: g, name: "Gemini Nano Banana", free: false });
    var oa = P.find("openai"); if (oa) out.push({ id: "openai", p: oa, name: "OpenAI GPT Image", free: false });
    var pref = S.settings.imageProvider;
    if (pref && pref !== "auto") out.sort(function (a, b) { return (b.id === pref) - (a.id === pref); });
    return out;
  };
  M.videoBackends = function () {
    var out = [], P = S.providers;
    var po = P.find("pollinations"); if (po) out.push({ id: "pollinations", p: po, name: "Pollinations (Veo/Seedance/Wan)" });
    var g = P.find("gemini");
    if (g && (g.allModels || []).some(function (m) { return /veo|omni/.test(m); })) out.push({ id: "veo", p: g, name: "Google Veo (পেইড)" });
    var oa = P.find("openai"); if (oa) out.push({ id: "sora", p: oa, name: "OpenAI Sora (পেইড)" });
    return out;
  };

  /* ---------------- chat model helper (for prompts & scripts) ---------------- */
  M.ask = function (prompt, system) {
    var routes = S.providers.usable().filter(function (p) { return !S.preset(p.preset).mediaOnly; })
      .map(function (p) { return { p: p, model: S.pickModel(p) }; }).filter(function (r) { return r.model; });
    var go = function (i) {
      if (i >= routes.length) return Promise.reject(new Error("কোনো চ্যাট AI চালু নেই"));
      return S.callModel({ p: routes[i].p, model: routes[i].model, system: system, temperature: 0.8, msgs: [{ role: "user", text: prompt }] })
        .then(function (r) { if (!r.text) throw new Error("empty"); return r.text; })
        .catch(function () { return go(i + 1); });
    };
    return go(0);
  };
  M.enhance = function (idea, style) {
    return M.ask("Turn this idea into ONE vivid, detailed English prompt for an AI image generator (60-90 words): subject, setting, composition, lighting, colors, mood, camera/medium. " +
      (styleText(style) ? "Visual style: " + styleText(style) + ". " : "") +
      "No text, letters or watermarks in the image unless explicitly requested. Keep cultural details accurate (Bangladesh/Bengal if relevant). Output only the prompt.\n\nIdea: " + idea)
      .then(function (t) { return t.replace(/^["'\s]+|["'\s]+$/g, "").replace(/^prompt:\s*/i, "").slice(0, 1800); })
      .catch(function () { return idea; });
  };

  /* ---------------- image backends ---------------- */
  var IMG = {
    cloudflare: function (b, prompt, w, h, q) {
      var list = b.p.imageModels || [], model = "@cf/black-forest-labs/flux-1-schnell";
      var better = list.filter(function (m) { return /flux-2/.test(m); })[0]; if (better) model = better;
      var body = { prompt: prompt.slice(0, 2000) };
      if (/flux-1-schnell/.test(model)) body.steps = q === "high" ? 8 : 6; else { body.width = w; body.height = h; }
      return S.httpBin({ url: b.p.base.replace(/\/+$/, "") + "/accounts/" + encodeURIComponent(b.p.accountId) + "/ai/run/" + model,
        headers: { Authorization: "Bearer " + b.p.key }, body: body }).promise.then(function (r) {
        if (r.b64) return "data:" + mimeFromB64(r.b64, r.ctype) + ";base64," + r.b64;
        var d = S.J(r.body, {}); var img = d.result && (d.result.image || d.result);
        if (r.status < 400 && typeof img === "string" && img.length > 100) return "data:" + mimeFromB64(img) + ";base64," + img;
        throw new Error(friendly("Cloudflare", r.status, r.body));
      });
    },
    pollinations: function (b, prompt, w, h) {
      var url = "https://gen.pollinations.ai/image/" + encodeURIComponent(prompt.slice(0, 1500)) + "?width=" + w + "&height=" + h + "&seed=" + (Math.random() * 1e9 | 0) +
        (b.p.imageModel ? "&model=" + encodeURIComponent(b.p.imageModel) : "");
      return S.httpBin({ url: url, headers: { Authorization: "Bearer " + b.p.key } }).promise.then(function (r) {
        if (r.b64) return "data:" + mimeFromB64(r.b64, r.ctype) + ";base64," + r.b64;
        throw new Error(friendly("Pollinations", r.status, r.body));
      });
    },
    huggingface: function (b, prompt, w, h) {
      return S.httpBin({ url: "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell",
        headers: { Authorization: "Bearer " + b.p.key, Accept: "image/png" }, body: { inputs: prompt, parameters: { width: w, height: h } } }).promise.then(function (r) {
        if (r.b64) return "data:" + mimeFromB64(r.b64, r.ctype) + ";base64," + r.b64;
        throw new Error(friendly("Hugging Face", r.status, r.body));
      });
    },
    gemini: function (b, prompt, w, h) {
      var models = (b.p.allModels || []).filter(function (m) { return /image/.test(m) && !/imagen/.test(m); })
        .sort(function (x, y) { return (/lite/.test(x) ? 1 : 0) - (/lite/.test(y) ? 1 : 0); });
      var ar = w > h ? "16:9" : h > w ? "9:16" : "1:1";
      var tryOne = function (i, last) {
        if (i >= models.length) return Promise.reject(new Error(last || "Gemini: ছবির মডেল পাওয়া যায়নি"));
        return S.callModel({ p: b.p, model: models[i], temperature: 0.9, msgs: [{ role: "user", text: "Generate an image (aspect " + ar + "): " + prompt }] })
          .then(function (r) { if (r.images && r.images.length) return r.images[0]; throw new Error("Gemini: ছবি আসেনি"); })
          .catch(function (e) { return tryOne(i + 1, /লিমিট|limit|key/.test(e.message) ? "Gemini: ছবির মডেল পেইড বা লিমিট শেষ" : e.message); });
      };
      return tryOne(0);
    },
    openai: function (b, prompt, w, h) {
      var size = w > h ? "1536x1024" : h > w ? "1024x1536" : "1024x1024";
      return S.http({ url: b.p.base.replace(/\/+$/, "") + "/images/generations", headers: S.authHeaders(b.p),
        body: { model: "gpt-image-1", prompt: prompt, size: size, n: 1 } }).promise.then(function (r) {
        var d = S.J(r.body, {}), x = d.data && d.data[0];
        if (r.status >= 400 || !x) throw new Error(friendly("OpenAI", r.status, r.body));
        return x.b64_json ? "data:image/png;base64," + x.b64_json : x.url;
      });
    }
  };

  /**
   * Make one image. opts: {aspect, style, quality, onStatus}
   * resolves {src(dataURL), provider} — verified to decode — or rejects with a helpful message.
   */
  M.makeImage = function (prompt, opts) {
    opts = opts || {};
    var backs = M.imageBackends();
    if (!backs.length) { var e = new Error("ছবি বানানোর জন্য কোনো ফ্রি সার্ভিস যুক্ত নেই। Cloudflare, Pollinations বা Hugging Face-এর ফ্রি key যোগ করুন।"); e.code = "no_image_provider"; return Promise.reject(e); }
    var wh = M.ASPECTS[opts.aspect] || M.ASPECTS.square, full = prompt + (styleText(opts.style) ? ", " + styleText(opts.style) : "");
    var errs = [];
    var go = function (i) {
      if (i >= backs.length) { var e2 = new Error(errs.join("; ")); e2.code = "all_failed"; return Promise.reject(e2); }
      if (opts.onStatus) opts.onStatus(backs[i].name + " দিয়ে আঁকছি…");
      var rec = function (ok, msg) { if (S.usage) S.usage.record(backs[i].p, backs[i].name, "image", { ok: ok, units: backs[i].id === "cloudflare" && ok ? 43 : 0, status: ok ? 200 : (/লিমিট|limit/.test(msg || "") ? 429 : 400), body: msg || "" }); };
      return IMG[backs[i].id](backs[i], full, wh[0], wh[1], opts.quality)
        .then(function (src) { return loadImg(src, 90000).then(function () { rec(true); return { src: src, provider: backs[i].name }; }); })
        .catch(function (err) { rec(false, err.message); errs.push(err.message); return go(i + 1); });
    };
    return go(0);
  };
  /** Several images; returns array of results (at least one) */
  M.makeImages = function (prompt, opts) {
    var n = Math.max(1, Math.min(4, (opts && opts.count) || 1)), out = [], firstErr = null;
    var chain = Promise.resolve();
    for (var i = 0; i < n; i++) chain = chain.then(function () {
      return M.makeImage(prompt, opts).then(function (r) { out.push(r); }, function (e) { if (!firstErr) firstErr = e; if (e.code === "no_image_provider") throw e; });
    });
    return chain.then(function () { if (!out.length) throw firstErr || new Error("ছবি বানানো যায়নি"); return out; });
  };
  /** Save a generated image: original to Download/Shathi, small preview for chat. */
  M.finalizeImage = function (r) {
    var name = "shathi-" + Date.now() + "-" + (Math.random() * 1000 | 0) + (/png/.test(r.src.slice(0, 30)) ? ".png" : ".jpg");
    var save = r.src.indexOf("data:") === 0 ? M.saveDataUrl(r.src, name).catch(function () { return null; }) : Promise.resolve(null);
    return Promise.all([save, M.resize(r.src, 1024, 0.88).catch(function () { return r.src; })]).then(function (x) {
      return { preview: x[1], uri: x[0] && x[0].uri, path: x[0] && x[0].path, provider: r.provider };
    });
  };

  /* ---------------- AI video ---------------- */
  var VID = {
    pollinations: function (b, prompt, o, status) {
      var models = b.p.videoModel ? [b.p.videoModel] : ["", "alibaba/wan-2.2-fast", "bytedance/seedance-2.0-mini"];
      var errs = [];
      var tryOne = function (i) {
        if (i >= models.length) return Promise.reject(new Error(errs.join("; ")));
        status("Pollinations-এ ভিডিও তৈরি হচ্ছে" + (models[i] ? " (" + models[i].split("/").pop() + ")" : "") + "… কয়েক মিনিট লাগতে পারে");
        var url = "https://gen.pollinations.ai/video/" + encodeURIComponent(prompt.slice(0, 1500)) + "?duration=" + o.duration +
          "&aspectRatio=" + (o.aspect === "portrait" ? "9:16" : "16:9") + (o.audio ? "&audio=true" : "") + (models[i] ? "&model=" + encodeURIComponent(models[i]) : "");
        return S.downloadTo(url, { Authorization: "Bearer " + b.p.key }, "shathi-video-" + Date.now() + ".mp4", "video/mp4")
          .catch(function (e) { errs.push(friendly("Pollinations", +(/HTTP (\d+)/.exec(e.message) || [0, 0])[1], e.message)); return tryOne(i + 1); });
      };
      return tryOne(0);
    },
    veo: function (b, prompt, o, status) {
      var g = b.p, base = g.base.replace(/\/+$/, "");
      var model = (g.allModels || []).filter(function (m) { return /veo/.test(m); }).sort(function (x, y) { return (/fast|lite/.test(y) ? 1 : 0) - (/fast|lite/.test(x) ? 1 : 0); })[0];
      if (!model) return Promise.reject(new Error("Veo মডেল পাওয়া যায়নি"));
      status("Google Veo-তে ভিডিও তৈরি হচ্ছে…");
      return S.http({ url: base + "/models/" + model + ":predictLongRunning", headers: S.authHeaders(g),
        body: { instances: [{ prompt: prompt }], parameters: { aspectRatio: o.aspect === "portrait" ? "9:16" : "16:9", durationSeconds: Math.min(8, Math.max(4, o.duration)) } } }).promise
        .then(function (r) {
          var d = S.J(r.body, {}); if (r.status >= 400 || !d.name) throw new Error(friendly("Veo", r.status, r.body));
          var started = Date.now();
          var poll = function () {
            return S.sleep(8000).then(function () { return S.getJSON(base + "/" + d.name, S.authHeaders(g)); }).then(function (op) {
              if (op.error) throw new Error("Veo: " + (op.error.message || "ব্যর্থ"));
              if (!op.done) { if (Date.now() - started > 8 * 60000) throw new Error("Veo: সময় শেষ"); status("Veo ভিডিও তৈরি হচ্ছে… " + Math.round((Date.now() - started) / 1000) + " সেকেন্ড"); return poll(); }
              var resp = op.response || {}, gv = resp.generateVideoResponse || resp;
              var smp = (gv.generatedSamples || gv.generatedVideos || [])[0], uri = smp && smp.video && (smp.video.uri || smp.video.url);
              if (!uri) throw new Error("Veo: ভিডিও পাওয়া যায়নি (নিরাপত্তা নীতির কারণে হতে পারে)");
              status("ভিডিও ডাউনলোড হচ্ছে…");
              return S.downloadTo(uri, S.authHeaders(g), "shathi-veo-" + Date.now() + ".mp4", "video/mp4");
            });
          };
          return poll();
        });
    },
    sora: function (b, prompt, o, status) {
      var p = b.p, base = p.base.replace(/\/+$/, "");
      status("OpenAI Sora-তে ভিডিও তৈরি হচ্ছে…");
      return S.http({ url: base + "/videos", headers: S.authHeaders(p),
        body: { model: "sora-2", prompt: prompt, size: o.aspect === "portrait" ? "720x1280" : "1280x720", seconds: String(o.duration >= 8 ? 8 : 4) } }).promise
        .then(function (r) {
          var d = S.J(r.body, {}); if (r.status >= 400 || !d.id) throw new Error(friendly("Sora", r.status, r.body));
          var started = Date.now();
          var poll = function () {
            return S.sleep(8000).then(function () { return S.getJSON(base + "/videos/" + d.id, S.authHeaders(p)); }).then(function (v) {
              if (v.status === "failed") throw new Error("Sora: " + ((v.error && v.error.message) || "ব্যর্থ"));
              if (v.status !== "completed") { if (Date.now() - started > 10 * 60000) throw new Error("Sora: সময় শেষ"); status("Sora ভিডিও তৈরি হচ্ছে… " + (v.progress || 0) + "%"); return poll(); }
              status("ভিডিও ডাউনলোড হচ্ছে…");
              return S.downloadTo(base + "/videos/" + d.id + "/content", S.authHeaders(p), "shathi-sora-" + Date.now() + ".mp4", "video/mp4");
            });
          };
          return poll();
        });
    }
  };
  /** AI text-to-video. resolves {uri, path, provider} */
  M.makeAIVideo = function (prompt, o, status) {
    o = o || {}; o.duration = o.duration || 6; status = status || function () {};
    var backs = M.videoBackends(), errs = [];
    if (!backs.length) { var e = new Error("AI ভিডিওর জন্য Pollinations (ফ্রি key), Gemini Veo বা OpenAI Sora (পেইড) দরকার।"); e.code = "no_video_provider"; return Promise.reject(e); }
    var go = function (i) {
      if (i >= backs.length) { var e2 = new Error(errs.join("; ")); e2.code = "all_failed"; return Promise.reject(e2); }
      return VID[backs[i].id](backs[i], prompt, o, status).then(function (r) { r.provider = backs[i].name; if (S.usage) S.usage.record(backs[i].p, backs[i].name, "video", { ok: true }); return r; })
        .catch(function (err) { if (S.usage) S.usage.record(backs[i].p, backs[i].name, "video", { ok: false, body: err.message }); errs.push(err.message); return go(i + 1); });
    };
    return go(0);
  };

  /* ---------------- narration audio ---------------- */
  var fileWaiters = {};
  W.__ttsFile = function (id, b64, err) { var f = fileWaiters[id]; delete fileWaiters[id]; if (f) f(b64 ? "data:audio/wav;base64," + b64 : null, err); };
  function deviceTtsFile(text, lang) {
    if (!A || !A.ttsToFile) return Promise.resolve(null);
    var id = S.uid();
    return new Promise(function (res) {
      var t = setTimeout(function () { delete fileWaiters[id]; res(null); }, 30000);
      fileWaiters[id] = function (d, err) { clearTimeout(t); res(d); };
      A.ttsToFile(id, text, lang, S.settings.voice.rate || 1.0);
    });
  }
  M.narrate = function (text, lang) {
    var order = S.settings.voice.output === "ai" ? ["ai", "device"] : ["device", "ai"];
    var go = function (i) {
      if (i >= order.length) return Promise.resolve(null);
      var p = order[i] === "ai" ? (S.voice.aiAudio ? S.voice.aiAudio(text).catch(function () { return null; }) : Promise.resolve(null)) : deviceTtsFile(text, lang);
      return p.then(function (d) { return d || go(i + 1); });
    };
    return go(0);
  };

  /* ---------------- story video: script -> images -> narration -> render ---------------- */
  function extractJSON(t) {
    var s = String(t).replace(/```json|```/g, ""), a = s.indexOf("{"), b = s.lastIndexOf("}");
    return a >= 0 && b > a ? S.J(s.slice(a, b + 1), null) : null;
  }
  M.storyVideo = function (topic, o, status) {
    o = o || {}; status = status || function () {};
    var n = Math.max(3, Math.min(10, o.scenes || 5)), lang = S.isBangla(topic) || S.settings.voice.lang !== "en" ? "bn" : "en";
    status("✍️ গল্প আর দৃশ্য লিখছি…", 0.03);
    return M.ask("Create a short video storyboard about: \"" + topic + "\".\nReturn ONLY JSON: {\"title\":\"short catchy title\",\"style\":\"one consistent English visual style for all images\",\"scenes\":[{\"narration\":\"1-2 natural spoken sentences\",\"caption\":\"short on-screen text, max 8 words\",\"image_prompt\":\"detailed English image prompt for this scene, no text in image\"}]}\n" +
      "Exactly " + n + " scenes with a clear beginning, middle and end. title, narration and caption in " + (lang === "bn" ? "Bangla (বাংলা script)" : "English") + ". " +
      (o.style && styleText(o.style) ? "Visual style must be: " + styleText(o.style) + "." : ""))
      .then(function (txt) {
        var sb = extractJSON(txt);
        if (!sb || !sb.scenes || !sb.scenes.length) throw new Error("গল্প লেখা যায়নি, আবার চেষ্টা করুন");
        sb.scenes = sb.scenes.slice(0, n);
        var haveImg = M.imageBackends().length > 0, noImgReason = haveImg ? "" : "ছবির সার্ভিস যুক্ত নেই, তাই রঙিন পটভূমি ব্যবহার হয়েছে";
        var chain = Promise.resolve();
        sb.scenes.forEach(function (sc, i) {
          chain = chain.then(function () {
            if (!haveImg) return;
            status("🎨 দৃশ্য " + S.bnNum(i + 1) + "/" + S.bnNum(sb.scenes.length) + " আঁকছি…", 0.08 + 0.5 * i / sb.scenes.length);
            return M.makeImage(sc.image_prompt + (sb.style ? ", " + sb.style : ""), { aspect: o.aspect || "portrait" })
              .then(function (r) { return M.resize(r.src, 1400, 0.9); })
              .then(function (src) { sc.img = src; }, function (e) { if (e.code === "no_image_provider" || i === 0 && e.code === "all_failed") { haveImg = false; noImgReason = e.message; } });
          });
        });
        if (o.narration !== false) sb.scenes.forEach(function (sc, i) {
          chain = chain.then(function () {
            status("🎙 বর্ণনা রেকর্ড করছি " + S.bnNum(i + 1) + "/" + S.bnNum(sb.scenes.length) + "…", 0.6 + 0.15 * i / sb.scenes.length);
            return M.narrate(sc.narration || sc.caption, lang).then(function (a) { sc.audio = a; });
          });
        });
        return chain.then(function () {
          status("🎬 ভিডিও বানাচ্ছি… অ্যাপ খোলা রাখুন", 0.78);
          return M.render(sb, o, function (f) { status("🎬 ভিডিও বানাচ্ছি… " + S.bnNum(Math.round(f * 100)) + "%", 0.78 + 0.2 * f); });
        }).then(function (out) {
          out.title = sb.title; out.scenes = sb.scenes.length;
          out.narrated = sb.scenes.some(function (s) { return s.audio; });
          out.images = sb.scenes.filter(function (s) { return s.img; }).length;
          out.note = noImgReason;
          status("💾 সেভ করছি…", 0.99);
          return S.saveBlob(out.blob, "shathi-story-" + Date.now() + (/mp4/.test(out.mime) ? ".mp4" : ".webm"), out.mime.split(";")[0])
            .then(function (sv) { out.uri = sv.uri; out.path = sv.path; return out; }, function () { return out; });
        });
      });
  };

  /* ---------------- on-device animations (free, unlimited) ---------------- */
  M.EFFECTS = [
    ["zoom", "🔍 ধীরে জুম"], ["pan", "↔ প্যান"], ["sparkle", "✨ ঝিকিমিকি"], ["fireflies", "🌟 জোনাকি"], ["snow", "❄ তুষার"],
    ["rain", "🌧 বৃষ্টি"], ["hearts", "💖 হার্ট"], ["confetti", "🎉 কনফেটি"], ["light", "🌅 আলোর রেখা"], ["bubbles", "🫧 বুদবুদ"]
  ];
  function Particles(kind, Wd, Ht) {
    var n = { sparkle: 70, fireflies: 45, snow: 140, rain: 220, hearts: 28, confetti: 120, bubbles: 40, light: 0, zoom: 0, pan: 0 }[kind] || 0, ps = [];
    var rnd = function (a, b) { return a + Math.random() * (b - a); };
    var colors = ["#FFD166", "#EF476F", "#06D6A0", "#118AB2", "#C77DFF", "#FF9F1C"];
    for (var i = 0; i < n; i++) ps.push({ x: rnd(0, Wd), y: rnd(0, Ht), s: rnd(0.4, 1.4), v: rnd(0.4, 1.4), ph: rnd(0, 6.28), c: colors[i % colors.length], r: rnd(0, 6.28) });
    return function (ctx, t, dt) {
      ps.forEach(function (p) {
        ctx.save();
        if (kind === "snow") { p.y += 40 * p.v * dt; p.x += Math.sin(t + p.ph) * 12 * dt; ctx.fillStyle = "rgba(255,255,255,.85)"; ctx.beginPath(); ctx.arc(p.x, p.y, 2.5 * p.s + 1, 0, 7); ctx.fill(); }
        else if (kind === "rain") { p.y += 900 * p.v * dt; p.x -= 120 * dt; ctx.strokeStyle = "rgba(200,220,255,.45)"; ctx.lineWidth = 1.4; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 6, p.y + 22 * p.s); ctx.stroke(); }
        else if (kind === "sparkle") { var a = Math.max(0, Math.sin(t * 3 * p.v + p.ph)); ctx.globalAlpha = a; ctx.fillStyle = "#FFF6D5"; ctx.translate(p.x, p.y); ctx.rotate(t + p.ph);
          var z = 7 * p.s; ctx.beginPath(); ctx.moveTo(0, -z); ctx.quadraticCurveTo(0, 0, z, 0); ctx.quadraticCurveTo(0, 0, 0, z); ctx.quadraticCurveTo(0, 0, -z, 0); ctx.quadraticCurveTo(0, 0, 0, -z); ctx.fill(); }
        else if (kind === "fireflies") { p.x += Math.cos(t * 0.7 + p.ph) * 20 * dt; p.y += Math.sin(t * 0.9 + p.ph) * 16 * dt; var g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 14 * p.s);
          var al = 0.5 + 0.5 * Math.sin(t * 2 + p.ph); g.addColorStop(0, "rgba(255,240,150," + al + ")"); g.addColorStop(1, "rgba(255,200,50,0)"); ctx.fillStyle = g; ctx.fillRect(p.x - 20, p.y - 20, 40, 40); }
        else if (kind === "hearts") { p.y -= 50 * p.v * dt; p.x += Math.sin(t + p.ph) * 18 * dt; ctx.globalAlpha = 0.85; ctx.fillStyle = "#FF4D8D"; ctx.translate(p.x, p.y); ctx.scale(p.s * 1.4, p.s * 1.4);
          ctx.beginPath(); ctx.moveTo(0, 4); ctx.bezierCurveTo(-10, -4, -6, -12, 0, -6); ctx.bezierCurveTo(6, -12, 10, -4, 0, 4); ctx.fill(); }
        else if (kind === "confetti") { p.y += 160 * p.v * dt; p.r += 3 * dt; ctx.fillStyle = p.c; ctx.translate(p.x + Math.sin(t * 2 + p.ph) * 10, p.y); ctx.rotate(p.r); ctx.fillRect(-5 * p.s, -3, 10 * p.s, 6); }
        else if (kind === "bubbles") { p.y -= 60 * p.v * dt; p.x += Math.sin(t + p.ph) * 14 * dt; ctx.strokeStyle = "rgba(255,255,255,.55)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 10 * p.s + 4, 0, 7); ctx.stroke(); }
        ctx.restore();
        if (p.y > Ht + 30) { p.y = -30; p.x = Math.random() * Wd; }
        if (p.y < -40) { p.y = Ht + 30; p.x = Math.random() * Wd; }
        if (p.x < -40) p.x = Wd + 30; if (p.x > Wd + 40) p.x = -30;
      });
      if (kind === "light") {
        for (var k = 0; k < 4; k++) {
          var x = ((t * 60 + k * Wd / 3) % (Wd * 1.6)) - Wd * 0.3, g2 = ctx.createLinearGradient(x, 0, x + Wd * 0.25, Ht);
          g2.addColorStop(0, "rgba(255,230,180,0)"); g2.addColorStop(0.5, "rgba(255,230,180,.16)"); g2.addColorStop(1, "rgba(255,230,180,0)");
          ctx.fillStyle = g2; ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + Wd * 0.12, 0); ctx.lineTo(x + Wd * 0.4, Ht); ctx.lineTo(x + Wd * 0.25, Ht); ctx.fill();
        }
      }
    };
  }
  /** Record any canvas animation with optional music. draw(ctx, t, dt) */
  function recordCanvas(Wd, Ht, total, draw, music, onProg) {
    var mime = pickMime(); if (!mime) return Promise.reject(new Error("এই ফোনে ভিডিও রেকর্ড করা যাচ্ছে না"));
    var cv = document.createElement("canvas"); cv.width = Wd; cv.height = Ht; var ctx = cv.getContext("2d");
    var AC = W.AudioContext || W.webkitAudioContext, ac = new AC(), dest = ac.createMediaStreamDestination();
    if (music !== false) {
      var g = ac.createGain(); g.gain.value = 0.0001; g.connect(dest);
      var ch = [[261.63, 329.63, 392], [220, 277.18, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]], now = ac.currentTime;
      var os = [0, 1, 2].map(function (k) { var o = ac.createOscillator(); o.type = k ? "sine" : "triangle"; o.frequency.value = ch[0][k]; o.connect(g); return o; });
      for (var ci = 0, ct = 0; ct < total; ci++, ct += 3) os.forEach(function (o, k) { o.frequency.setTargetAtTime(ch[ci % 4][k], now + ct, 0.5); });
      g.gain.setTargetAtTime(0.05, now + 0.1, 0.6); g.gain.setTargetAtTime(0.0001, now + total - 1, 0.35);
      os.forEach(function (o) { o.start(now); o.stop(now + total + 0.4); });
    }
    var stream = cv.captureStream(30); dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
    var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 5000000 }), chunks = [];
    rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
    return new Promise(function (res, rej) {
      var t0 = ac.currentTime + 0.1, last = 0, timer;
      rec.onstop = function () { clearInterval(timer); ac.close(); res({ blob: new Blob(chunks, { type: mime }), mime: mime, duration: total }); };
      rec.onerror = function () { clearInterval(timer); rej(new Error("রেকর্ডিং ব্যর্থ")); };
      draw(ctx, 0, 0); rec.start(1000);
      timer = setInterval(function () {
        var t = Math.max(0, ac.currentTime - t0), dt = Math.min(0.1, t - last); last = t;
        draw(ctx, t, dt); if (onProg) onProg(Math.min(1, t / total));
        if (t >= total) { clearInterval(timer); setTimeout(function () { try { rec.stop(); } catch (x) { rej(x); } }, 200); }
      }, 1000 / 30);
    });
  }
  /**
   * Animation: photo (image dataURL) or text-only.
   * o: {image, lines[], effect, duration, aspect, title, music, onProg}
   */
  M.animate = function (o) {
    var dims = o.aspect === "landscape" ? [1280, 720] : o.aspect === "square" ? [1080, 1080] : [720, 1280];
    var Wd = dims[0], Ht = dims[1], total = Math.max(4, Math.min(30, o.duration || 8)), font = "'Noto Sans Bengali','Hind Siliguri',sans-serif";
    var lines = (o.lines || []).map(function (l) { return String(l).trim(); }).filter(Boolean).slice(0, 8);
    var parts = Particles(o.effect || "sparkle", Wd, Ht), hue0 = Math.random() * 360;
    return (o.image ? loadImg(o.image) : Promise.resolve(null)).then(function (im) {
      var per = lines.length ? (total - 1.2) / lines.length : total;
      return recordCanvas(Wd, Ht, total, function (ctx, t, dt) {
        var p = t / total;
        if (im) {
          var eff = o.effect, s = eff === "zoom" ? 1.0 + 0.22 * p : 1.1 + 0.04 * Math.sin(t * 0.6);
          var base = Math.max(Wd / im.naturalWidth, Ht / im.naturalHeight) * s, dw = im.naturalWidth * base, dh = im.naturalHeight * base;
          var dx = (Wd - dw) / 2 + (eff === "pan" ? (p - 0.5) * (dw - Wd) * 0.9 : Math.sin(t * 0.4) * 12), dy = (Ht - dh) / 2 + Math.cos(t * 0.35) * 10;
          ctx.drawImage(im, dx, dy, dw, dh);
          if (lines.length) { var gg = ctx.createLinearGradient(0, Ht * 0.45, 0, Ht); gg.addColorStop(0, "rgba(0,0,0,0)"); gg.addColorStop(1, "rgba(0,0,0,.65)"); ctx.fillStyle = gg; ctx.fillRect(0, Ht * 0.45, Wd, Ht * 0.55); }
        } else {
          var h = (hue0 + t * 12) % 360, g = ctx.createLinearGradient(Wd * Math.sin(t * 0.2), 0, Wd, Ht);
          g.addColorStop(0, "hsl(" + h + ",70%,30%)"); g.addColorStop(1, "hsl(" + ((h + 70) % 360) + ",75%,14%)");
          ctx.fillStyle = g; ctx.fillRect(0, 0, Wd, Ht);
        }
        parts(ctx, t, dt);
        // text: each line rises and fades in, stays, previous lines remain dimmer
        if (lines.length) {
          var fs = Math.round((im ? 0.058 : 0.075) * Math.min(Wd, Ht * 0.75)), lh = fs * 1.45;
          ctx.font = "700 " + fs + "px " + font; ctx.textAlign = "center"; ctx.textBaseline = "middle";
          var shown = [];
          lines.forEach(function (l, i) { var st = 0.4 + i * per; if (t >= st) shown.push({ l: l, a: Math.min(1, (t - st) / 0.6), i: i }); });
          var wrapped = [];
          shown.forEach(function (x) { wrap(ctx, x.l, Wd * 0.84).forEach(function (w) { wrapped.push({ w: w, a: x.a, i: x.i }); }); });
          var startY = im ? Ht - Ht * 0.08 - (wrapped.length - 1) * lh : Ht / 2 - (wrapped.length - 1) * lh / 2;
          wrapped.forEach(function (x, k) {
            var newest = x.i === shown.length - 1, rise = (1 - x.a) * 30;
            ctx.globalAlpha = x.a * (newest || !im ? 1 : 0.8); ctx.fillStyle = "#fff"; ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 14;
            ctx.fillText(x.w, Wd / 2, startY + k * lh + rise);
          });
          ctx.shadowBlur = 0; ctx.globalAlpha = 1;
        }
        if (t > total - 0.8) { ctx.fillStyle = "rgba(0,0,0," + Math.min(1, (t - (total - 0.8)) / 0.8) + ")"; ctx.fillRect(0, 0, Wd, Ht); }
      }, o.music, o.onProg);
    }).then(function (out) {
      return S.saveBlob(out.blob, "shathi-anim-" + Date.now() + (/mp4/.test(out.mime) ? ".mp4" : ".webm"), out.mime.split(";")[0])
        .then(function (sv) { out.uri = sv.uri; out.path = sv.path; return out; }, function () { return out; });
    });
  };

  /* ---------------- renderer (canvas + WebAudio -> MediaRecorder) ---------------- */
  function pickMime() {
    if (!W.MediaRecorder) return "";
    var c = ["video/mp4;codecs=avc1.42E01E,mp4a.40.2", "video/mp4", "video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"];
    for (var i = 0; i < c.length; i++) if (MediaRecorder.isTypeSupported(c[i])) return c[i];
    return "";
  }
  function wrap(ctx, text, maxW) {
    var words = String(text).split(/\s+/), lines = [], cur = "";
    words.forEach(function (w) { var t = cur ? cur + " " + w : w; if (ctx.measureText(t).width > maxW && cur) { lines.push(cur); cur = w; } else cur = t; });
    if (cur) lines.push(cur); return lines.slice(0, 4);
  }
  M.render = function (sb, o, onProg) {
    var mime = pickMime();
    if (!mime) return Promise.reject(new Error("এই ফোনে ভিডিও রেকর্ড করা যাচ্ছে না"));
    var dims = o.aspect === "landscape" ? [1280, 720] : o.aspect === "square" ? [1080, 1080] : [720, 1280];
    var Wd = dims[0], Ht = dims[1], cv = document.createElement("canvas"); cv.width = Wd; cv.height = Ht;
    var ctx = cv.getContext("2d"), AC = W.AudioContext || W.webkitAudioContext, ac = new AC(), dest = ac.createMediaStreamDestination();
    var font = "'Noto Sans Bengali','Hind Siliguri',sans-serif", scenes = sb.scenes;
    var imgs = [], bufs = [];
    var prep = Promise.all(scenes.map(function (sc, i) {
      var a = sc.img ? loadImg(sc.img).then(function (im) { imgs[i] = im; }, function () {}) : Promise.resolve();
      var b = sc.audio ? fetch(sc.audio).then(function (r) { return r.arrayBuffer(); }).then(function (ab) { return ac.decodeAudioData(ab); })
        .then(function (buf) { bufs[i] = buf; }, function () {}) : Promise.resolve();
      return Promise.all([a, b]);
    }));
    return prep.then(function () {
      var TITLE = 2.4, END = 1.8, FADE = 0.6, t = TITLE, timeline = [];
      scenes.forEach(function (sc, i) {
        var d = bufs[i] ? bufs[i].duration + 0.7 : Math.max(3.4, Math.min(7, 2.2 + String(sc.caption || "").length * 0.08));
        timeline.push({ start: t, dur: d }); t += d;
      });
      var total = t + END;
      // gentle background music: slow evolving chord
      var music = null;
      if (o.music !== false) {
        music = ac.createGain(); music.gain.value = 0.0001; music.connect(dest);
        var chords = [[220, 277.18, 329.63], [196, 246.94, 293.66], [174.61, 220, 261.63], [196, 246.94, 329.63]];
        var oscs = [0, 1, 2].map(function (k) { var os = ac.createOscillator(); os.type = k ? "sine" : "triangle"; os.frequency.value = chords[0][k]; os.connect(music); return os; });
        var now = ac.currentTime;
        for (var ci = 0, ct = 0; ct < total; ci++, ct += 4) oscs.forEach(function (os, k) { os.frequency.setTargetAtTime(chords[ci % 4][k], now + ct, 0.6); });
        music.gain.setTargetAtTime(scenes.some(function (s, i) { return bufs[i]; }) ? 0.025 : 0.05, now + 0.2, 0.8);
        music.gain.setTargetAtTime(0.0001, now + total - 1.2, 0.4);
        oscs.forEach(function (os) { os.start(now); os.stop(now + total + 0.5); });
      }
      var stream = cv.captureStream(30);
      dest.stream.getAudioTracks().forEach(function (tr) { stream.addTrack(tr); });
      var rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 4500000, audioBitsPerSecond: 128000 });
      var chunks = [];
      rec.ondataavailable = function (e) { if (e.data && e.data.size) chunks.push(e.data); };
      var t0 = ac.currentTime + 0.15;
      bufs.forEach(function (buf, i) { if (!buf) return; var src = ac.createBufferSource(); src.buffer = buf; var g = ac.createGain(); g.gain.value = 1; src.connect(g); g.connect(dest); src.start(t0 + timeline[i].start + 0.35); });

      function grad(i, a) {
        var hue = (i * 47 + 250) % 360, g = ctx.createLinearGradient(0, 0, Wd, Ht);
        g.addColorStop(0, "hsla(" + hue + ",65%,32%," + a + ")"); g.addColorStop(1, "hsla(" + ((hue + 60) % 360) + ",70%,18%," + a + ")"); return g;
      }
      function drawScene(i, p, alpha) {
        ctx.globalAlpha = alpha;
        var im = imgs[i];
        if (im) {
          var zoomIn = i % 2 === 0, s = zoomIn ? 1.04 + 0.12 * p : 1.16 - 0.12 * p;
          var base = Math.max(Wd / im.naturalWidth, Ht / im.naturalHeight) * s, dw = im.naturalWidth * base, dh = im.naturalHeight * base;
          var dx = (Wd - dw) / 2 + (i % 3 - 1) * 30 * (p - 0.5), dy = (Ht - dh) / 2 + ((i + 1) % 3 - 1) * 24 * (p - 0.5);
          ctx.drawImage(im, dx, dy, dw, dh);
        } else {
          ctx.fillStyle = grad(i, 1); ctx.fillRect(0, 0, Wd, Ht);
          ctx.fillStyle = "rgba(255,255,255,.06)";
          for (var k = 0; k < 6; k++) { ctx.beginPath(); ctx.arc((k * 173 + p * 60) % Wd, (k * 241 + i * 90) % Ht, 60 + k * 18, 0, 7); ctx.fill(); }
        }
        // caption
        var cap = scenes[i].caption || "", big = !im, fs = Math.round((big ? 0.075 : 0.052) * Math.min(Wd, Ht * 0.75));
        ctx.font = "700 " + fs + "px " + font;
        var lines = wrap(ctx, cap, Wd * 0.84), lh = fs * 1.35, boxH = lines.length * lh + fs * 0.9;
        var ca = Math.min(1, Math.max(0, (p * timeline[i].dur - 0.25) / 0.5)) * alpha;
        if (!big) {
          var g2 = ctx.createLinearGradient(0, Ht - boxH - Ht * 0.12, 0, Ht);
          g2.addColorStop(0, "rgba(0,0,0,0)"); g2.addColorStop(1, "rgba(0,0,0," + (0.72 * alpha) + ")");
          ctx.globalAlpha = 1; ctx.fillStyle = g2; ctx.fillRect(0, Ht - boxH - Ht * 0.12, Wd, boxH + Ht * 0.12);
        }
        ctx.globalAlpha = ca; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.shadowColor = "rgba(0,0,0,.6)"; ctx.shadowBlur = 12;
        var y0 = big ? Ht / 2 - (lines.length - 1) * lh / 2 : Ht - Ht * 0.07 - (lines.length - 1) * lh - fs * 0.3;
        lines.forEach(function (l, k) { ctx.fillText(l, Wd / 2, y0 + k * lh); });
        ctx.shadowBlur = 0; ctx.globalAlpha = 1;
      }
      function drawTitle(a) {
        ctx.globalAlpha = 1; ctx.fillStyle = grad(7, 1); ctx.fillRect(0, 0, Wd, Ht);
        ctx.globalAlpha = a; ctx.fillStyle = "#fff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
        var fs = Math.round(0.085 * Math.min(Wd, Ht * 0.75)); ctx.font = "800 " + fs + "px " + font;
        var lines = wrap(ctx, sb.title || "", Wd * 0.82); lines.forEach(function (l, k) { ctx.fillText(l, Wd / 2, Ht / 2 - (lines.length - 1) * fs * 0.7 + k * fs * 1.4); });
        ctx.globalAlpha = a * 0.7; ctx.font = "500 " + Math.round(fs * 0.36) + "px " + font; ctx.fillText("✦ সাথী AI", Wd / 2, Ht - fs * 1.2); ctx.globalAlpha = 1;
      }
      function frame() {
        var t = ac.currentTime - t0;
        if (t < 0) t = 0;
        if (t < TITLE) { drawTitle(Math.min(1, t / 0.5)); if (t > TITLE - FADE && scenes.length) drawScene(0, 0, (t - (TITLE - FADE)) / FADE); }
        else if (t < total - END) {
          for (var i = 0; i < timeline.length; i++) {
            var s = timeline[i];
            if (t >= s.start && t < s.start + s.dur) {
              drawScene(i, (t - s.start) / s.dur, 1);
              var nx = timeline[i + 1];
              if (nx && t > s.start + s.dur - FADE) drawScene(i + 1, 0, (t - (s.start + s.dur - FADE)) / FADE);
              break;
            }
          }
        } else {
          var last = scenes.length - 1; drawScene(last, 1, 1);
          ctx.fillStyle = "rgba(10,8,25," + Math.min(0.85, (t - (total - END)) / END) + ")"; ctx.fillRect(0, 0, Wd, Ht);
        }
        if (onProg) onProg(Math.min(1, t / total));
      }
      return new Promise(function (resolve, reject) {
        var timer = null;
        rec.onstop = function () { clearInterval(timer); ac.close(); resolve({ blob: new Blob(chunks, { type: mime }), mime: mime, duration: total }); };
        rec.onerror = function (e) { clearInterval(timer); reject(new Error("রেকর্ডিং ব্যর্থ: " + (e.error && e.error.message || ""))); };
        drawTitle(0);
        rec.start(1000);
        timer = setInterval(function () {
          frame();
          if (ac.currentTime - t0 >= total) { clearInterval(timer); setTimeout(function () { try { rec.stop(); } catch (x) { reject(x); } }, 250); }
        }, 1000 / 30);
      });
    });
  };
})(window);
