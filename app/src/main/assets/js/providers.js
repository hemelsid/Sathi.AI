/* সাথী AI — AI providers: Gemini, OpenAI-compatible (Groq, OpenRouter, …), Anthropic. Streaming + tool calling. */
(function (W) {
  "use strict";
  var S = W.Shathi;

  /* ---------------- presets ---------------- */
  S.PRESETS = [
    { id: "gemini", name: "Google Gemini", type: "gemini", base: "https://generativelanguage.googleapis.com/v1beta", tier: "free",
      keyUrl: "https://aistudio.google.com/apikey", icon: "G", color: "#4285F4",
      note: "ফ্রি। ছবি/PDF/অডিও বোঝে, Google সার্চ, ভয়েস।" },
    { id: "groq", name: "Groq", type: "openai", base: "https://api.groq.com/openai/v1", tier: "free",
      keyUrl: "https://console.groq.com/keys", icon: "⚡", color: "#F55036",
      note: "ফ্রি, খুব দ্রুত। Llama, GPT-OSS, Qwen, Kimi। ভয়েস থেকে লেখা (Whisper)।" },
    { id: "openrouter", name: "OpenRouter", type: "openai", base: "https://openrouter.ai/api/v1", tier: "free",
      keyUrl: "https://openrouter.ai/keys", icon: "◎", color: "#6566F1",
      note: "অনেক ফ্রি মডেল (:free)। একই key-তে পেইড মডেলও।" },
    { id: "mistral", name: "Mistral", type: "openai", base: "https://api.mistral.ai/v1", tier: "free",
      keyUrl: "https://console.mistral.ai/api-keys", icon: "M", color: "#FA520F", note: "ফ্রি Experiment প্ল্যান।" },
    { id: "cerebras", name: "Cerebras", type: "openai", base: "https://api.cerebras.ai/v1", tier: "free",
      keyUrl: "https://cloud.cerebras.ai", icon: "C", color: "#F05A28", note: "ফ্রি, অনেক দ্রুত।" },
    { id: "github", name: "GitHub Models", type: "openai", base: "https://models.github.ai/inference", tier: "free",
      keyUrl: "https://github.com/settings/tokens", icon: "GH", color: "#24292F",
      note: "GitHub টোকেন (models অনুমতি) দিয়ে ফ্রি।", listUrl: "https://models.github.ai/catalog/models" },
    { id: "pollinations", name: "Pollinations", type: "openai", base: "https://gen.pollinations.ai/v1", tier: "free", media: true,
      keyUrl: "https://enter.pollinations.ai", icon: "🌸", color: "#3FB950", note: "ফ্রি key-তে ছবি, AI ভিডিও আর চ্যাট (দৈনিক সীমিত)।" },
    { id: "cloudflare", name: "Cloudflare (ছবি)", type: "cloudflare", base: "https://api.cloudflare.com/client/v4", tier: "free", media: true, mediaOnly: true,
      keyUrl: "https://dash.cloudflare.com/?to=/:account/ai/workers-ai", icon: "☁", color: "#F38020", needsAccount: true,
      note: "ফ্রি: দিনে ~২০০+ ছবি (FLUX)। Account ID আর API token লাগে।" },
    { id: "huggingface", name: "Hugging Face (ছবি)", type: "hf", base: "https://router.huggingface.co", tier: "free", media: true, mediaOnly: true,
      keyUrl: "https://huggingface.co/settings/tokens", icon: "🤗", color: "#FFB000",
      note: "ফ্রি মাসিক ক্রেডিটে FLUX ছবি।" },
    { id: "openai", name: "OpenAI (ChatGPT)", type: "openai", base: "https://api.openai.com/v1", tier: "premium",
      keyUrl: "https://platform.openai.com/api-keys", icon: "◐", color: "#10A37F", note: "পেইড। GPT মডেল, ছবি বানানো, Whisper।" },
    { id: "anthropic", name: "Anthropic Claude", type: "anthropic", base: "https://api.anthropic.com/v1", tier: "premium",
      keyUrl: "https://console.anthropic.com/settings/keys", icon: "✳", color: "#D97757", note: "পেইড। Claude মডেল।" },
    { id: "deepseek", name: "DeepSeek", type: "openai", base: "https://api.deepseek.com/v1", tier: "premium",
      keyUrl: "https://platform.deepseek.com/api_keys", icon: "D", color: "#4D6BFE", note: "কম খরচের পেইড।" },
    { id: "xai", name: "xAI Grok", type: "openai", base: "https://api.x.ai/v1", tier: "premium",
      keyUrl: "https://console.x.ai", icon: "X", color: "#111111", note: "পেইড। Grok মডেল।" },
    { id: "together", name: "Together AI", type: "openai", base: "https://api.together.xyz/v1", tier: "premium",
      keyUrl: "https://api.together.ai/settings/api-keys", icon: "T", color: "#0F6FFF", note: "ওপেন মডেল, পেইড।" },
    { id: "ollama", name: "নিজের সার্ভার (Ollama / LM Studio)", type: "openai", base: "http://192.168.0.100:11434/v1", tier: "own",
      keyUrl: "https://ollama.com", icon: "🖥", color: "#555555", noKey: true,
      note: "নিজের কম্পিউটারে চলা মডেল। একই Wi-Fi-তে থাকতে হবে।" },
    { id: "custom", name: "অন্য যেকোনো (OpenAI-compatible)", type: "openai", base: "https://", tier: "own",
      icon: "⚙", color: "#777777", note: "Base URL আর key দিন।" }
  ];
  S.preset = function (id) { for (var i = 0; i < S.PRESETS.length; i++) if (S.PRESETS[i].id === id) return S.PRESETS[i]; return S.PRESETS[S.PRESETS.length - 1]; };

  /* model preference per preset: first match in the provider's live model list wins */
  var PREFER = {
    gemini: ["gemini-flash-latest", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash", "gemini-3-flash-preview",
             "gemini-flash-lite-latest", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-2.5-flash"],
    groq: ["openai/gpt-oss-120b", "moonshotai/kimi-k2-instruct-0905", "llama-3.3-70b-versatile", "qwen/qwen3-32b", "meta-llama/llama-4-maverick-17b-128e-instruct"],
    openrouter: [":free"],
    cerebras: ["gpt-oss-120b", "llama-3.3-70b", "qwen-3-235b"],
    mistral: ["mistral-medium-latest", "mistral-small-latest", "mistral-large-latest"],
    github: ["openai/gpt-4.1", "openai/gpt-4o", "openai/gpt-4.1-mini"],
    pollinations: ["openai", "openai-large"],
    deepseek: ["deepseek-chat"],
    anthropic: ["sonnet", "haiku", "opus"]
  };
  var SKIP = /embed|tts|whisper|transcrib|audio|image|vision-only|moderation|guard|dall-e|imagen|veo|live|realtime|robotics|computer|search-preview|banana|lyria|omni-moderation|rerank|ocr/i;

  S.chatModels = function (p) {
    return (p.models || []).filter(function (m) { return !SKIP.test(m); });
  };
  S.pickModel = function (p) {
    if (p.working && (p.models || []).indexOf(p.working) >= 0) return p.working;
    if (p.working && !(p.models || []).length) return p.working;
    var list = S.chatModels(p), pref = PREFER[p.preset] || [];
    for (var i = 0; i < pref.length; i++) {
      for (var j = 0; j < list.length; j++) if (list[j] === pref[i] || (pref[i].charAt(0) === ":" || pref[i].length < 8) && list[j].indexOf(pref[i]) >= 0) {
        if (p.preset === "openrouter" && p.toolModels && p.toolModels.length) {
          for (var k = 0; k < list.length; k++) if (list[k].indexOf(":free") > 0 && p.toolModels.indexOf(list[k]) >= 0) return list[k];
        }
        return list[j];
      }
    }
    if (list.length) return list[0];
    if (p.preset === "gemini") return "gemini-flash-latest";
    return p.manualModel || "";
  };

  function authHeaders(p) {
    var h = {};
    if (p.type === "anthropic") { h["x-api-key"] = p.key; h["anthropic-version"] = "2023-06-01"; }
    else if (p.type === "gemini") { h["x-goog-api-key"] = p.key; }
    else if (p.key) { h["Authorization"] = "Bearer " + p.key; }
    if (p.preset === "openrouter") { h["HTTP-Referer"] = "https://github.com/hemelsid/Sathi.AI"; h["X-Title"] = "Shathi AI"; }
    return h;
  }
  S.authHeaders = authHeaders;
  function base(p) { return String(p.base || "").replace(/\/+$/, ""); }

  /* ---------------- list models ---------------- */
  S.listModels = function (p) {
    if (p.type === "cloudflare") {
      if (!p.accountId) return Promise.reject(new Error("Account ID দিন"));
      return S.getJSON(base(p) + "/accounts/" + encodeURIComponent(p.accountId) + "/ai/models/search?task=Text-to-Image&per_page=50", { Authorization: "Bearer " + p.key })
        .then(function (d) { p.imageModels = (d.result || []).map(function (m) { return m.name; }); return []; });
    }
    if (p.type === "hf") {
      return S.getJSON("https://huggingface.co/api/whoami-v2", { Authorization: "Bearer " + p.key }).then(function () { return []; });
    }
    if (p.type === "gemini") {
      return S.getJSON(base(p) + "/models?pageSize=300", authHeaders(p)).then(function (d) {
        var all = (d.models || []).map(function (m) {
          return { id: m.name.replace("models/", ""), gen: (m.supportedGenerationMethods || []).indexOf("generateContent") >= 0 };
        });
        p.allModels = all.map(function (m) { return m.id; });
        var ver = function (n) { var m = /gemini-(\d+(?:\.\d+)?)/.exec(n); return m ? parseFloat(m[1]) : (/latest/.test(n) ? 99 : 0); };
        return all.filter(function (m) { return m.gen && /gemini|gemma/.test(m.id); }).map(function (m) { return m.id; })
          .sort(function (x, y) { return (ver(y) - ver(x)) || ((/lite/.test(x) ? 1 : 0) - (/lite/.test(y) ? 1 : 0)) || ((/preview|exp/.test(x) ? 1 : 0) - (/preview|exp/.test(y) ? 1 : 0)); });
      });
    }
    if (p.type === "anthropic") {
      return S.getJSON(base(p) + "/models?limit=100", authHeaders(p)).then(function (d) {
        return (d.data || []).map(function (m) { return m.id; });
      });
    }
    var url = p.preset === "github" ? S.preset("github").listUrl : base(p) + "/models";
    return S.getJSON(url, authHeaders(p)).then(function (d) {
      var arr = Array.isArray(d) ? d : (d.data || d.models || []);
      if (p.preset === "openrouter") {
        p.toolModels = arr.filter(function (m) { return (m.supported_parameters || []).indexOf("tools") >= 0; }).map(function (m) { return m.id; });
        arr.sort(function (a, b) { return ((b.id.indexOf(":free") > 0) - (a.id.indexOf(":free") > 0)); });
      }
      return arr.map(function (m) { return typeof m === "string" ? m : (m.id || m.name); }).filter(Boolean);
    });
  };

  /* ---------------- message conversion ---------------- */
  // neutral: {role:'user',text,files:[{mime,b64,text,name}]} | {role:'assistant',text,calls:[{id,name,args}],raw,prov}
  //          | {role:'tool',results:[{id,name,result}]}
  function toGemini(msgs) {
    var out = [];
    msgs.forEach(function (m) {
      if (m.role === "user") {
        var parts = [];
        (m.files || []).forEach(function (f) {
          if (f.b64 && /^(image|application\/pdf|audio|video)/.test(f.mime)) parts.push({ inlineData: { mimeType: f.mime, data: f.b64 } });
          else if (f.text) parts.push({ text: "সংযুক্ত ফাইল \"" + f.name + "\":\n" + f.text });
          else if (f.note) parts.push({ text: f.note });
        });
        parts.push({ text: m.text || " " });
        out.push({ role: "user", parts: parts });
      } else if (m.role === "assistant") {
        if (m.prov === "gemini" && m.raw && m.raw.length) { out.push({ role: "model", parts: m.raw }); return; }
        var ps = [];
        if (m.text) ps.push({ text: m.text });
        (m.calls || []).forEach(function (c) { ps.push({ functionCall: { name: c.name, args: c.args || {} }, thoughtSignature: "skip_thought_signature_validator" }); });
        if (!ps.length) ps.push({ text: " " });
        out.push({ role: "model", parts: ps });
      } else if (m.role === "tool") {
        out.push({ role: "user", parts: m.results.map(function (r) {
          var fr = { name: r.name, response: { result: r.result } }; if (r.id && /^g/.test(r.id) === false) fr.id = r.id;
          return { functionResponse: fr };
        }) });
      }
    });
    return out;
  }
  function toOpenAI(msgs, system, vision) {
    var out = [];
    if (system) out.push({ role: "system", content: system });
    msgs.forEach(function (m) {
      if (m.role === "user") {
        var files = m.files || [];
        if (!files.length) { out.push({ role: "user", content: m.text || " " }); return; }
        var content = [];
        files.forEach(function (f) {
          if (f.b64 && /^image\//.test(f.mime) && vision !== false) content.push({ type: "image_url", image_url: { url: "data:" + f.mime + ";base64," + f.b64 } });
          else if (f.b64 && f.mime === "application/pdf") content.push({ type: "file", file: { filename: f.name, file_data: "data:application/pdf;base64," + f.b64 } });
          else if (f.text) content.push({ type: "text", text: "সংযুক্ত ফাইল \"" + f.name + "\":\n" + f.text });
          else content.push({ type: "text", text: "[" + f.name + " — এই মডেল এই ধরনের ফাইল পড়তে পারে না]" });
        });
        content.push({ type: "text", text: m.text || " " });
        out.push({ role: "user", content: content });
      } else if (m.role === "assistant") {
        var o = { role: "assistant", content: m.text || "" };
        if (m.calls && m.calls.length) o.tool_calls = m.calls.map(function (c) {
          return { id: c.id, type: "function", function: { name: c.name, arguments: JSON.stringify(c.args || {}) } };
        });
        if (!o.content && !o.tool_calls) o.content = " ";
        out.push(o);
      } else if (m.role === "tool") {
        m.results.forEach(function (r) { out.push({ role: "tool", tool_call_id: r.id, content: JSON.stringify(r.result).slice(0, 24000) }); });
      }
    });
    return out;
  }
  function toAnthropic(msgs) {
    var out = [];
    var push = function (role, blocks) {
      var last = out[out.length - 1];
      if (last && last.role === role) last.content = last.content.concat(blocks); else out.push({ role: role, content: blocks });
    };
    msgs.forEach(function (m) {
      if (m.role === "user") {
        var b = [];
        (m.files || []).forEach(function (f) {
          if (f.b64 && /^image\//.test(f.mime)) b.push({ type: "image", source: { type: "base64", media_type: f.mime, data: f.b64 } });
          else if (f.b64 && f.mime === "application/pdf") b.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 } });
          else if (f.text) b.push({ type: "text", text: "সংযুক্ত ফাইল \"" + f.name + "\":\n" + f.text });
        });
        b.push({ type: "text", text: m.text || " " });
        push("user", b);
      } else if (m.role === "assistant") {
        var c = [];
        if (m.text) c.push({ type: "text", text: m.text });
        (m.calls || []).forEach(function (x) { c.push({ type: "tool_use", id: x.id, name: x.name, input: x.args || {} }); });
        if (!c.length) c.push({ type: "text", text: " " });
        push("assistant", c);
      } else if (m.role === "tool") {
        push("user", m.results.map(function (r) {
          return { type: "tool_result", tool_use_id: r.id, content: JSON.stringify(r.result).slice(0, 24000), is_error: !!(r.result && r.result.error) };
        }));
      }
    });
    if (out.length && out[0].role !== "user") out.unshift({ role: "user", content: [{ type: "text", text: "…" }] });
    return out;
  }
  function geminiSchema(s) {
    if (!s || typeof s !== "object") return s;
    var o = {};
    for (var k in s) {
      if (k === "type") o.type = String(s.type).toUpperCase();
      else if (k === "properties") { o.properties = {}; for (var p in s.properties) o.properties[p] = geminiSchema(s.properties[p]); }
      else if (k === "items") o.items = geminiSchema(s.items);
      else if (k === "additionalProperties") continue;
      else o[k] = s[k];
    }
    return o;
  }

  /* ---------------- errors ---------------- */
  function ProviderError(msg, kind, status) { var e = new Error(msg); e.kind = kind; e.status = status; return e; }
  S.ProviderError = ProviderError;
  function classify(status, body, p) {
    var t = String(body || "");
    if (status === 401 || ((status === 400 || status === 403) && /api.?key|unauthori[sz]ed|invalid.*(key|token)|permission/i.test(t)))
      return ProviderError(p.name + ": API key সঠিক না বা অনুমতি নেই।", "auth", status);
    if (status === 429 || /quota|rate.?limit|resource_exhausted/i.test(t))
      return ProviderError(p.name + ": ফ্রি লিমিট এই মুহূর্তে শেষ।", "limit", status);
    if ((status === 400 || status === 404) && /tool use|tool.?call|tools? (is|are) not supported|function.?call|support tool/i.test(t))
      return ProviderError(p.name + ": এই মডেল টুল সাপোর্ট করে না।", "notools", status);
    if (status === 404 || /not.?found|no longer available|does not exist|not supported for|unknown model|decommission/i.test(t))
      return ProviderError(p.name + ": মডেলটা পাওয়া যায়নি।", "model", status);
    if (/tool|function.?call/i.test(t) && status === 400) return ProviderError(p.name + ": এই মডেল টুল সাপোর্ট করে না।", "notools", status);
    if (/location is not supported|user location/i.test(t)) return ProviderError(p.name + ": আপনার এলাকায় এই সেবা নেই।", "region", status);
    if (status >= 500) return ProviderError(p.name + ": সার্ভারে সমস্যা (" + status + ")।", "server", status);
    var m = /"message"\s*:\s*"([^"]{0,200})/.exec(t);
    return ProviderError(p.name + ": " + (m ? m[1] : "HTTP " + status), "other", status);
  }

  /**
   * One model call with streaming.
   * opts: {p, model, system, msgs, tools(neutral), temperature, onText(full), signal:{cancelled, handle}}
   * returns {text, calls, raw, model}
   */
  S.callModel = function (o) {
    var p = o.p;
    if (p.type === "gemini") return callGemini(o);
    if (p.type === "anthropic") return callAnthropic(o);
    return callOpenAI(o);
  };

  function run(o, req, parse) {
    var acc = { text: "", calls: [], raw: [], done: false };
    var h = S.http({ method: "POST", url: req.url, headers: req.headers, body: req.body, stream: true,
      onChunk: S.sse(function (ev) { parse(ev, acc); if (o.onText) o.onText(acc.text); }) });
    if (o.signal) o.signal.handle = h;
    return h.promise.then(function (r) {
      if (o.signal && o.signal.cancelled) { acc.cancelled = true; return acc; }
      if (r.status >= 400) throw classify(r.status, r.body, o.p);
      if (r.status === 0 && !acc.text && !acc.calls.length) throw ProviderError(o.p.name + ": সংযোগ বিচ্ছিন্ন।", "network", 0);
      if (acc.error) throw classify(acc.error.status || 400, JSON.stringify(acc.error), o.p);
      return acc;
    }, function (e) {
      if (o.signal && o.signal.cancelled) { acc.cancelled = true; return acc; }
      var m = String(e.message || e);
      S.unreachable = S.unreachable || {}; S.unreachable[o.p.id] = Date.now();
      throw ProviderError(/timed? ?out|ETIMEDOUT|connect|UnknownHost|unreachable|reset/i.test(m)
        ? o.p.name + ": এই নেটওয়ার্ক থেকে সার্ভারে পৌঁছানো যাচ্ছে না"
        : o.p.name + ": সংযোগে সমস্যা", "network", 0);
    });
  }

  function callGemini(o) {
    var p = o.p, body = {
      contents: toGemini(o.msgs),
      generationConfig: { temperature: o.temperature == null ? 0.7 : o.temperature }
    };
    if (o.system) body.systemInstruction = { parts: [{ text: o.system }] };
    var tools = [];
    if (o.tools && o.tools.length) tools.push({ functionDeclarations: o.tools.map(function (t) {
      return { name: t.name, description: t.description, parameters: geminiSchema(t.parameters) };
    }) });
    if (o.grounding) tools.push({ google_search: {} });
    if (tools.length) body.tools = tools;
    var url = base(p) + "/models/" + o.model + ":streamGenerateContent?alt=sse";
    return run(o, { url: url, headers: authHeaders(p), body: body }, function (ev, acc) {
      if (ev.error) { acc.error = ev.error; return; }
      var c = (ev.candidates || [])[0]; if (!c) return;
      if (c.groundingMetadata && c.groundingMetadata.groundingChunks) {
        acc.sources = (acc.sources || []).concat(c.groundingMetadata.groundingChunks.map(function (g) { return g.web ? { title: g.web.title, url: g.web.uri } : null; }).filter(Boolean));
      }
      ((c.content || {}).parts || []).forEach(function (part) {
        if (part.functionCall) {
          acc.calls.push({ id: "g" + S.uid(), name: part.functionCall.name, args: part.functionCall.args || {} });
          acc.raw.push(part);
        } else if (part.inlineData && /^image\//.test(part.inlineData.mimeType)) {
          acc.images = (acc.images || []).concat(["data:" + part.inlineData.mimeType + ";base64," + part.inlineData.data]);
        } else if (typeof part.text === "string") {
          if (part.thought) { acc.thinking = true; if (part.thoughtSignature) acc.raw.push(part); return; }
          acc.text += part.text;
          var last = acc.raw[acc.raw.length - 1];
          if (last && typeof last.text === "string" && !last.thought && !last.thoughtSignature && !part.thoughtSignature) last.text += part.text;
          else acc.raw.push(JSON.parse(JSON.stringify(part)));
        } else if (part.thoughtSignature) acc.raw.push(part);
      });
      if (c.finishReason && /SAFETY|PROHIBITED|BLOCK/.test(c.finishReason) && !acc.text) acc.text = "(নিরাপত্তার কারণে এই উত্তর দেওয়া যায়নি।)";
    });
  }

  function callOpenAI(o) {
    var p = o.p, body = {
      model: o.model, stream: true,
      messages: toOpenAI(o.msgs, o.system, o.vision),
      temperature: o.temperature == null ? 0.7 : o.temperature
    };
    if (o.tools && o.tools.length) body.tools = o.tools.map(function (t) {
      return { type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } };
    });
    var url = base(p) + "/chat/completions";
    var tc = {};
    return run(o, { url: url, headers: authHeaders(p), body: body }, function (ev, acc) {
      if (ev.error) { acc.error = ev.error; return; }
      var ch = (ev.choices || [])[0]; if (!ch) return;
      var d = ch.delta || ch.message || {};
      if (typeof d.content === "string") acc.text += d.content;
      if (d.reasoning || d.reasoning_content) acc.thinking = true;
      (d.tool_calls || []).forEach(function (t) {
        var k = t.index != null ? t.index : (t.id || 0);
        var cur = tc[k] || (tc[k] = { id: t.id || ("call_" + S.uid()), name: "", args: "" });
        if (t.id) cur.id = t.id;
        if (t.function) { if (t.function.name) cur.name += t.function.name; if (t.function.arguments) cur.args += t.function.arguments; }
      });
    }).then(function (acc) {
      Object.keys(tc).forEach(function (k) {
        var c = tc[k]; if (!c.name) return;
        acc.calls.push({ id: c.id, name: c.name, args: S.J(c.args || "{}", {}) || {} });
      });
      // some models print reasoning inside <think> tags
      acc.text = acc.text.replace(/<think>[\s\S]*?<\/think>\s*/g, "");
      return acc;
    });
  }

  function callAnthropic(o) {
    var p = o.p, body = {
      model: o.model, max_tokens: 8192, stream: true,
      messages: toAnthropic(o.msgs),
      temperature: o.temperature == null ? 0.7 : Math.min(1, o.temperature)
    };
    if (o.system) body.system = o.system;
    if (o.tools && o.tools.length) body.tools = o.tools.map(function (t) { return { name: t.name, description: t.description, input_schema: t.parameters }; });
    var blocks = {};
    return run(o, { url: base(p) + "/messages", headers: authHeaders(p), body: body }, function (ev, acc) {
      if (ev.type === "error") { acc.error = ev.error; return; }
      if (ev.type === "content_block_start") {
        var b = ev.content_block || {};
        blocks[ev.index] = { type: b.type, id: b.id, name: b.name, json: "" };
      } else if (ev.type === "content_block_delta") {
        var d = ev.delta || {}, blk = blocks[ev.index];
        if (d.type === "text_delta") acc.text += d.text;
        else if (d.type === "input_json_delta" && blk) blk.json += d.partial_json;
        else if (d.type === "thinking_delta") acc.thinking = true;
      } else if (ev.type === "content_block_stop") {
        var bb = blocks[ev.index];
        if (bb && bb.type === "tool_use") acc.calls.push({ id: bb.id, name: bb.name, args: S.J(bb.json || "{}", {}) || {} });
      }
    });
  }

  /* ---------------- simple one-shot helpers (no streaming UI) ---------------- */
  S.quickText = function (p, model, prompt, extra) {
    var acc = "";
    return S.callModel({ p: p, model: model, msgs: [{ role: "user", text: prompt, files: (extra && extra.files) || [] }],
      system: extra && extra.system, temperature: 0.2, grounding: extra && extra.grounding, onText: function (t) { acc = t; } })
      .then(function (r) { return r; });
  };
})(window);
