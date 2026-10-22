/* সাথী AI — core: native bridge, networking, storage, markdown, helpers */
(function (W) {
  "use strict";
  var A = W.Android || null;
  var S = W.Shathi = W.Shathi || {};
  S.A = A;

  /* ---------------- small helpers ---------------- */
  S.$ = function (sel, root) { return (root || document).querySelector(sel); };
  S.$$ = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };
  S.uid = function () { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); };
  S.esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  };
  S.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  S.J = function (s, d) { try { return JSON.parse(s); } catch (e) { return d === undefined ? null : d; } };
  S.bnNum = function (n) { return String(n).replace(/\d/g, function (d) { return "০১২৩৪৫৬৭৮৯"[d]; }); };
  S.isBangla = function (t) {
    var b = (String(t).match(/[ঀ-৿]/g) || []).length, l = (String(t).match(/[A-Za-z]/g) || []).length;
    return b >= l * 0.4;
  };
  S.debounce = function (fn, ms) {
    var t; return function () { var a = arguments, self = this; clearTimeout(t); t = setTimeout(function () { fn.apply(self, a); }, ms); };
  };
  S.toast = function (msg, ms) {
    var el = S.$("#toast"); if (!el) return;
    el.textContent = msg; el.classList.add("show");
    clearTimeout(el._t); el._t = setTimeout(function () { el.classList.remove("show"); }, ms || 2400);
  };
  S.copy = function (t) {
    if (A) { A.copyText(t); return; }
    try { navigator.clipboard.writeText(t); } catch (e) {
      var ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove();
    }
  };
  S.timeAgo = function (t) {
    var d = new Date(t), now = new Date(), day = 864e5;
    var start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (t >= start) return "আজ";
    if (t >= start - day) return "গতকাল";
    if (t >= start - 7 * day) return "গত ৭ দিন";
    if (t >= start - 30 * day) return "গত ৩০ দিন";
    return "আরও আগে";
  };

  /* ---------------- persistent storage ---------------- */
  S.store = {
    load: function (name, def) {
      var raw = "";
      try { raw = A ? A.loadData(name) : (localStorage.getItem("sd_" + name) || ""); } catch (e) {}
      var v = raw ? S.J(raw, null) : null;
      return v == null ? def : v;
    },
    save: function (name, obj) {
      var txt = JSON.stringify(obj);
      try {
        if (A) { var r = S.J(A.saveData(name, txt), {}); if (r && r.error) console.warn(r.error); }
        else localStorage.setItem("sd_" + name, txt);
      } catch (e) { console.warn("save failed", e); }
    },
    pref: function (k, v) {
      if (v === undefined) { try { return A ? A.getPref(k) : (localStorage.getItem("p_" + k) || ""); } catch (e) { return ""; } }
      try { A ? A.setPref(k, v) : localStorage.setItem("p_" + k, v); } catch (e) {}
    }
  };

  /* ---------------- networking (native = no CORS + streaming) ---------------- */
  var pending = {};
  W.__net = function (id, type, data) {
    var p = pending[id]; if (!p) return;
    if (type === "status") p.status = parseInt(data, 10);
    else if (type === "chunk") { p.buf += data; if (p.onChunk && p.status < 400) p.onChunk(data); else p.body += data; }
    else if (type === "body") p.body += data;
    else if (type === "saved") { delete pending[id]; p.resolve({ status: 200, body: data }); }
    else if (type === "end") { delete pending[id]; p.resolve({ status: p.status || parseInt(data, 10) || 0, body: p.body }); }
    else if (type === "error") { delete pending[id]; p.reject(new Error(data)); }
  };

  /**
   * S.http({method,url,headers,body,stream,onChunk,timeout}) -> handle {promise, cancel()}
   * promise resolves {status, body}. With stream, chunks (raw text, line-oriented) go to onChunk.
   */
  S.http = function (o) {
    var id = "r" + S.uid(), cancelled = false, ctl = null;
    var body = o.body == null ? "" : (typeof o.body === "string" ? o.body : JSON.stringify(o.body));
    var headers = o.headers || {};
    if (o.body != null && typeof o.body !== "string" && !headers["Content-Type"]) headers["Content-Type"] = "application/json";
    var promise = new Promise(function (resolve, reject) {
      if (A) {
        pending[id] = { resolve: resolve, reject: reject, status: 0, body: "", buf: "", onChunk: o.stream ? o.onChunk : null };
        A.http(id, o.method || (body ? "POST" : "GET"), o.url, JSON.stringify(headers), body, !!o.stream);
        return;
      }
      // browser fallback (used for testing outside the app)
      ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
      fetch(o.url, { method: o.method || (body ? "POST" : "GET"), headers: headers, body: body || undefined, signal: ctl ? ctl.signal : undefined })
        .then(function (res) {
          if (o.stream && res.ok && res.body && res.body.getReader) {
            var reader = res.body.getReader(), dec = new TextDecoder();
            var pump = function () {
              return reader.read().then(function (r) {
                if (r.done) { resolve({ status: res.status, body: "" }); return; }
                o.onChunk && o.onChunk(dec.decode(r.value, { stream: true })); return pump();
              });
            };
            return pump();
          }
          return res.text().then(function (t) {
            if (o.stream && res.ok && o.onChunk) { o.onChunk(t); resolve({ status: res.status, body: "" }); }
            else resolve({ status: res.status, body: t });
          });
        })
        .catch(function (e) { if (cancelled) resolve({ status: 0, body: "" }); else reject(e); });
    });
    return {
      promise: promise,
      cancel: function () { cancelled = true; if (A) A.cancel(id); else if (ctl) ctl.abort(); }
    };
  };
  S.getJSON = function (url, headers) {
    return S.http({ url: url, headers: headers }).promise.then(function (r) {
      if (r.status >= 400) throw new Error("HTTP " + r.status + " " + String(r.body).slice(0, 200));
      return S.J(r.body, {});
    });
  };
  S.multipart = function (url, headers, fields, b64, fileName, mime) {
    var id = "m" + S.uid();
    return new Promise(function (resolve, reject) {
      if (!A) { reject(new Error("multipart only in app")); return; }
      pending[id] = { resolve: resolve, reject: reject, status: 0, body: "", buf: "" };
      A.multipart(id, url, JSON.stringify(headers || {}), JSON.stringify(fields || {}), b64, fileName, mime);
    });
  };
  S.download = function (urlOrB64, name, mime) {
    var id = "d" + S.uid();
    return new Promise(function (resolve, reject) {
      if (!A) { reject(new Error("download only in app")); return; }
      pending[id] = { resolve: resolve, reject: reject, status: 0, body: "", buf: "" };
      A.download(id, urlOrB64, name, mime || "application/octet-stream");
    });
  };

  /** Line splitter for SSE streams: calls onEvent(jsonObject) for each `data:` line. */
  S.sse = function (onEvent) {
    var buf = "";
    return function (chunk) {
      buf += chunk;
      var lines = buf.split("\n"); buf = lines.pop();
      for (var i = 0; i < lines.length; i++) {
        var l = lines[i].trim();
        if (l.indexOf("data:") !== 0) continue;
        var d = l.slice(5).trim();
        if (!d || d === "[DONE]") continue;
        var obj = S.J(d, null); if (obj) onEvent(obj);
      }
    };
  };

  /* ---------------- markdown (safe, small) ---------------- */
  function inline(s) {
    return s
      .replace(/!\[([^\]]*)\]\(((?:https?:|data:image\/)[^)\s]+)\)/g, '<img class="md-img" alt="$1" src="$2">')
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*\*(.+?)\*\*\*/g, "<b><i>$1</i></b>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*(?!\w)/g, "$1<i>$2</i>")
      .replace(/~~(.+?)~~/g, "<s>$1</s>")
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
  }
  S.md = function (src) {
    var text = String(src || ""), out = "", parts = text.split(/```/);
    for (var b = 0; b < parts.length; b++) {
      if (b % 2) {
        var m = /^([\w+#.-]*)\n?/.exec(parts[b]), lang = m ? m[1] : "", code = parts[b].slice(m ? m[0].length : 0);
        out += '<div class="code"><div class="code-h"><span>' + S.esc(lang || "code") + '</span><button class="cpy">কপি</button></div><pre><code>' +
          S.esc(code.replace(/\n$/, "")) + "</code></pre></div>";
        continue;
      }
      var lines = parts[b].split("\n"), stack = [];
      var closeLists = function (lvl) { while (stack.length > lvl) out += "</" + stack.pop().t + ">"; };
      for (var i = 0; i < lines.length; i++) {
        var rawLine = lines[i], raw = rawLine.trim();
        if (/^\|.*\|$/.test(raw) && i + 1 < lines.length && /^\|?[\s:|-]+\|?$/.test(lines[i + 1].trim()) && lines[i + 1].indexOf("-") >= 0) {
          closeLists(0);
          var row = function (r, tag) {
            return "<tr>" + r.replace(/^\||\|$/g, "").split("|").map(function (c) {
              return "<" + tag + ">" + inline(S.esc(c.trim())) + "</" + tag + ">";
            }).join("") + "</tr>";
          };
          var t = '<div class="tbl"><table>' + row(raw, "th"); i += 2;
          while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) { t += row(lines[i].trim(), "td"); i++; }
          out += t + "</table></div>"; i--; continue;
        }
        var indent = (rawLine.match(/^\s*/)[0].replace(/\t/g, "  ").length >> 1);
        var ul = /^[-*•+] (.*)/.exec(raw), ol = /^(\d+)[.)] (.*)/.exec(raw);
        if (ul || ol) {
          var tag = ul ? "ul" : "ol", lvl = Math.min(indent, 3) + 1;
          if (stack.length > lvl) closeLists(lvl);
          while (stack.length < lvl) { out += "<" + tag + ">"; stack.push({ t: tag }); }
          if (stack[stack.length - 1].t !== tag) { closeLists(lvl - 1); out += "<" + tag + ">"; stack.push({ t: tag }); }
          var item = ul ? ul[1] : ol[2], chk = /^\[( |x)\] (.*)/i.exec(item);
          out += "<li>" + (chk ? (chk[1] === " " ? "☐ " : "☑ ") + inline(S.esc(chk[2])) : inline(S.esc(item))) + "</li>";
          continue;
        }
        closeLists(0);
        var l = inline(S.esc(raw));
        if (/^#{1,2} /.test(raw)) out += "<h3>" + inline(S.esc(raw.replace(/^#+ /, ""))) + "</h3>";
        else if (/^#{3,6} /.test(raw)) out += "<h4>" + inline(S.esc(raw.replace(/^#+ /, ""))) + "</h4>";
        else if (/^> ?/.test(raw)) out += "<blockquote>" + inline(S.esc(raw.replace(/^> ?/, ""))) + "</blockquote>";
        else if (/^(-{3,}|\*{3,}|_{3,})$/.test(raw)) out += "<hr>";
        else if (raw) out += "<p>" + l + "</p>";
      }
      closeLists(0);
    }
    return out;
  };
  /** Text suitable for speaking aloud. */
  S.speakable = function (t) {
    return String(t)
      .replace(/```[\s\S]*?```/g, " ")
      .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, " ")
      .replace(/^\|?[\s:|-]{3,}\|?$/gm, "")
      .replace(/[*#`>_~|]/g, " ")
      .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
      .replace(/\s*\n\s*/g, "।\n").replace(/।\s*।/g, "।")
      .replace(/[ \t]+/g, " ").trim();
  };
})(window);
