/* সাথী AI — which models are really free, and how much of the free limit is used today */
(function (W) {
  "use strict";
  var S = W.Shathi;
  var U = S.usage = {};

  /* ---------------- free / paid per model ----------------
   * returns {tier: "free"|"limited"|"paid"|"local"|"unknown", label, note}
   */
  var LBL = { free: "ফ্রি", limited: "সীমিত ফ্রি", paid: "পেইড", local: "নিজের", unknown: "অজানা" };
  S.modelTier = function (p, m) {
    var pr = S.preset(p.preset), id = String(m || ""), info = (p.modelInfo || {})[id] || {};
    var t = "unknown", note = "";
    if (pr.tier === "own") { t = "local"; note = "নিজের সার্ভারে চলে, কোনো খরচ নেই"; }
    else if (pr.tier === "premium") { t = "paid"; note = "ব্যবহার অনুযায়ী টাকা কাটে"; }
    else if (p.preset === "openrouter") {
      if (/:free$/.test(id) || info.free === true) { t = "limited"; note = "দিনে ৫০টি অনুরোধ (১০$ ক্রেডিট থাকলে ১০০০টি)"; }
      else { t = "paid"; note = "OpenRouter-এ ক্রেডিট কিনতে হয়"; }
    } else if (p.preset === "gemini") {
      if (/pro|image|veo|omni|imagen/.test(id)) { t = "paid"; note = "Google-এর ফ্রি টিয়ারে নেই, billing লাগে"; }
      else { t = "limited"; note = "দৈনিক ফ্রি সীমা আছে; Google আপনার ডেটা মডেল উন্নয়নে ব্যবহার করতে পারে"; }
    } else if (p.preset === "pollinations") {
      if (info.free === false) { t = "paid"; note = "এই মডেলে pollen (ক্রেডিট) লাগে"; }
      else if (info.free === true) { t = "limited"; note = "ফ্রি key-তে দৈনিক সীমিত"; }
      else { t = "limited"; note = "ফ্রি key-তে সীমিত; বড় মডেলে ক্রেডিট লাগতে পারে"; }
    } else if (/^(groq|cerebras|mistral|github|cloudflare|huggingface)$/.test(p.preset)) {
      t = "limited"; note = { groq: "প্রতি মডেলে দৈনিক সীমা (সাধারণত ১০০০টি অনুরোধ)", cerebras: "দিনে প্রায় ১০ লাখ টোকেন", mistral: "মাসে বড় ফ্রি কোটা, ডেটা ট্রেনিংয়ে যেতে পারে",
        github: "দিনে ৫০-১৫০টি অনুরোধ (মডেলভেদে)", cloudflare: "দিনে ১০,০০০ neuron (~২০০+ ছবি)", huggingface: "মাসিক ছোট ফ্রি ক্রেডিট" }[p.preset];
    }
    if (info.free === false && t !== "paid") { t = "paid"; note = "এই মডেলটা পেইড"; }
    return { tier: t, label: LBL[t], note: note };
  };
  S.tierBadge = function (p, m) {
    var x = S.modelTier(p, m), cls = { free: "free", limited: "free", paid: "premium", local: "own", unknown: "" }[x.tier];
    return x.tier === "unknown" ? "" : '<span class="badge ' + cls + '">' + x.label + "</span>";
  };
  /** provider-level summary badge */
  S.providerBadge = function (p) {
    var pr = S.preset(p.preset);
    if (pr.tier === "premium") return '<span class="badge premium">পেইড</span>';
    if (pr.tier === "own") return '<span class="badge own">নিজের</span>';
    if (p.preset === "openrouter" || p.preset === "pollinations" || p.preset === "gemini") return '<span class="badge free">ফ্রি + পেইড মডেল</span>';
    return '<span class="badge free">সীমিত ফ্রি</span>';
  };

  /* ---------------- daily usage store ---------------- */
  function today() { var d = new Date(); return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function load() {
    var u = S.store.load("usage", { day: today(), m: {} });
    if (u.day !== today()) u = { day: today(), m: {}, prev: u.m };
    return u;
  }
  var data = load();
  var save = S.debounce(function () { S.store.save("usage", data); }, 800);
  function key(p, m) { return p.id + "|" + m; }

  /** record one call. kind: chat | image | video | stt */
  U.record = function (p, model, kind, r) {
    if (!p || !model) return;
    if (data.day !== today()) data = load();
    var k = key(p, model), e = data.m[k] || (data.m[k] = { pid: p.id, model: model, kind: kind, req: 0, ok: 0, tin: 0, tout: 0, units: 0 });
    e.req++; if (r && r.ok !== false) e.ok++;
    if (r && r.usage) { e.tin += r.usage.input || 0; e.tout += r.usage.output || 0; }
    if (r && r.units) e.units += r.units;
    if (r && r.headers) {
      var h = r.headers, n = function (x) { var v = parseFloat(h[x]); return isNaN(v) ? null : v; };
      var lr = n("x-ratelimit-limit-requests"), rr = n("x-ratelimit-remaining-requests");
      if (lr == null) { lr = n("x-ratelimit-limit-requests-day"); rr = n("x-ratelimit-remaining-requests-day"); }
      if (lr != null && rr != null) e.hdr = { limit: lr, remaining: rr, at: Date.now() };
      var lt = n("x-ratelimit-limit-tokens"), rt = n("x-ratelimit-remaining-tokens");
      if (lt != null && rt != null) e.hdrTok = { limit: lt, remaining: rt, at: Date.now() };
    }
    if (r && (r.status === 429 || /quota|exhausted|limit/i.test(r.body || "") && r.status >= 400)) e.limitHit = Date.now();
    save();
  };

  /* known daily free limits (requests/day) — used when the provider doesn't tell us */
  var KNOWN = [
    ["groq", /llama-3\.1-8b/, 14400], ["groq", /allam/, 7000], ["groq", /compound/, 250], ["groq", /whisper/, 2000], ["groq", /./, 1000],
    ["gemini", /lite/, 1000], ["gemini", /flash/, 250], ["gemini", /gemma/, 14400],
    ["github", /mini|nano|small|8b/, 150], ["github", /./, 50],
    ["cloudflare", /./, 230]
  ];
  function knownLimit(p, model) {
    if (p.preset === "openrouter") return /:free$/.test(model) ? { v: (p.orInfo && p.orInfo.bigFree ? 1000 : 50), shared: true, est: !p.orInfo } : null;
    for (var i = 0; i < KNOWN.length; i++) if (KNOWN[i][0] === p.preset && KNOWN[i][1].test(model)) return { v: KNOWN[i][2], est: true };
    return null;
  }

  /** usage summary for a model today -> {req, tokens, pct (0-100|null), est, limitText} */
  U.of = function (p, model) {
    if (data.day !== today()) data = load();
    var e = data.m[key(p, model)] || { req: 0, ok: 0, tin: 0, tout: 0, units: 0 };
    var out = { req: e.req, ok: e.ok, tokens: e.tin + e.tout, pct: null, est: false, limitText: "" };
    if (e.hdr && Date.now() - e.hdr.at < 864e5 && e.hdr.limit > 0) {
      out.pct = Math.round(100 * (1 - e.hdr.remaining / e.hdr.limit)); out.limitText = e.hdr.remaining + "/" + e.hdr.limit + " বাকি";
    } else {
      var kl = knownLimit(p, model);
      if (kl) {
        var used = e.req;
        if (kl.shared) used = Object.keys(data.m).filter(function (k) { return k.indexOf(p.id + "|") === 0 && /:free$/.test(k); }).reduce(function (s, k) { return s + data.m[k].req; }, 0);
        if (p.preset === "cloudflare") used = e.units ? Math.round(e.units / 43) : e.req;
        out.pct = Math.min(100, Math.round(100 * used / kl.v)); out.est = kl.est; out.limitText = "দিনে ~" + kl.v + (p.preset === "cloudflare" ? "টি ছবি" : "টি");
      }
    }
    if (e.limitHit && new Date(e.limitHit).toDateString() === new Date().toDateString()) { out.pct = 100; out.limitText = "আজকের সীমা শেষ"; out.est = false; }
    return out;
  };
  U.all = function () { if (data.day !== today()) data = load(); return data.m; };
  U.reset = function () { data = { day: today(), m: {} }; save(); };

  /** OpenRouter: real account limits from /key */
  U.refreshOpenRouter = function (p) {
    return S.getJSON("https://openrouter.ai/api/v1/key", S.authHeaders(p)).then(function (d) {
      var k = d.data || {};
      p.orInfo = { usage: k.usage, limit: k.limit, freeTier: k.is_free_tier, bigFree: k.is_free_tier === false, at: Date.now() };
      S.saveSettings(); return p.orInfo;
    }).catch(function () { return null; });
  };

  /** small bar html */
  U.bar = function (u) {
    if (u.pct == null) return u.req ? '<span class="ubar-txt">আজ ' + S.bnNum(u.req) + "টি" + (u.tokens ? " · " + S.bnNum(Math.round(u.tokens / 100) / 10) + "k টোকেন" : "") + "</span>" : "";
    var col = u.pct >= 90 ? "var(--danger)" : u.pct >= 60 ? "var(--warn)" : "var(--ok)";
    return '<span class="ubar"><i style="width:' + Math.max(3, u.pct) + "%;background:" + col + '"></i></span><span class="ubar-txt">' + S.bnNum(u.pct) + "%" + (u.est ? " (আনুমানিক)" : "") + "</span>";
  };
})(window);
