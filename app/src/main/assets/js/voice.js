/* সাথী AI — voice: recording + AI transcription, device recognition fallback, natural speech output */
(function (W) {
  "use strict";
  var S = W.Shathi, A = S.A;
  var V = S.voice = { speaking: false, recording: false };

  /* ---------------- permission ---------------- */
  var permWaiters = {};
  W.__perm = function (name, granted) { var f = permWaiters[name]; delete permWaiters[name]; if (f) f(granted); };
  V.ensureMic = function () {
    if (!A || A.hasMicPerm()) return Promise.resolve(true);
    return new Promise(function (res) { permWaiters.mic = res; A.requestMic(); });
  };

  /* ---------------- which transcriber is available ---------------- */
  V.transcriber = function () {
    var pref = S.settings.voice.input;
    if (pref === "device") return null;
    var groq = S.providers.find("groq"); if (groq) return { kind: "whisper", p: groq, model: "whisper-large-v3-turbo" };
    var oa = S.providers.find("openai"); if (oa) return { kind: "whisper", p: oa, model: "whisper-1" };
    var g = S.providers.find("gemini"); if (g) return { kind: "gemini", p: g };
    return null;
  };

  /* ---------------- recording ---------------- */
  var levelTimer = null, silenceStart = 0, heardSpeech = false;
  V.startRecording = function (opts) {
    opts = opts || {};
    return V.ensureMic().then(function (ok) {
      if (!ok) throw new Error("মাইক্রোফোনের অনুমতি দেওয়া হয়নি।");
      if (!A) throw new Error("ভয়েস শুধু অ্যাপে চলে।");
      V.stopSpeaking();
      var r = A.recStart();
      if (r === "perm") throw new Error("মাইক্রোফোনের অনুমতি দরকার।");
      if (r !== "ok") throw new Error("রেকর্ড শুরু করা যায়নি: " + r);
      V.recording = true; heardSpeech = false; silenceStart = 0;
      var started = Date.now();
      clearInterval(levelTimer);
      levelTimer = setInterval(function () {
        var lvl = A.recLevel(), norm = Math.min(1, lvl / 12000);
        if (opts.onLevel) opts.onLevel(norm);
        if (lvl > 2200) { heardSpeech = true; silenceStart = 0; }
        else if (heardSpeech && opts.autoStop) {
          if (!silenceStart) silenceStart = Date.now();
          else if (Date.now() - silenceStart > 1500 && opts.onSilence) { opts.onSilence(); }
        }
        if (Date.now() - started > 120000 && opts.onSilence) opts.onSilence(); // 2 min cap
      }, 110);
    });
  };
  V.cancelRecording = function () {
    clearInterval(levelTimer); V.recording = false;
    if (A) A.recCancel();
  };
  /** Stop and transcribe. Resolves text ("" if nothing). */
  V.stopAndTranscribe = function () {
    clearInterval(levelTimer); V.recording = false;
    var rec = S.J(A.recStop(), {});
    if (!rec || rec.error) return Promise.reject(new Error("রেকর্ডিং পাওয়া যায়নি।"));
    if (rec.ms < 500) return Promise.resolve("");
    return V.transcribe(rec.b64, rec.mime);
  };
  V.transcribe = function (b64, mime) {
    var t = V.transcriber();
    if (!t) return Promise.reject(new Error("no transcriber"));
    var lang = S.settings.voice.lang || "bn";
    if (t.kind === "whisper") {
      var fields = { model: t.model, response_format: "json", temperature: "0" };
      if (lang !== "auto") fields.language = lang;
      return S.multipart(t.p.base.replace(/\/+$/, "") + "/audio/transcriptions", S.authHeaders(t.p), fields, b64, "voice.m4a", mime)
        .then(function (r) {
          var d = S.J(r.body, {});
          if (r.status >= 400) {
            // fall back to Gemini if available
            var g = S.providers.find("gemini");
            if (g) return geminiSTT(g, b64, mime, lang);
            throw new Error((d.error && d.error.message) || "ভয়েস থেকে লেখা হয়নি (" + r.status + ")");
          }
          return String(d.text || "").trim();
        });
    }
    return geminiSTT(t.p, b64, mime, lang);
  };
  function geminiSTT(p, b64, mime, lang) {
    return S.callModel({ p: p, model: S.pickModel(p), temperature: 0,
      msgs: [{ role: "user", text: "Transcribe this audio exactly as spoken" + (lang === "bn" ? " (most likely Bangla; write Bangla in Bangla script)" : "") +
        ". Output ONLY the transcript text, nothing else. If there is no speech, output nothing.", files: [{ mime: mime, b64: b64, name: "voice" }] }] })
      .then(function (r) { return String(r.text || "").replace(/^["“]|["”]$/g, "").trim(); });
  }

  /* ---------------- device recognizer (no AI key) ---------------- */
  var sttHandlers = null;
  W.__stt = function (type, text) { if (sttHandlers && sttHandlers[type]) sttHandlers[type](text); };
  V.deviceListen = function (h) {
    return V.ensureMic().then(function (ok) {
      if (!ok) throw new Error("মাইক্রোফোনের অনুমতি দেওয়া হয়নি।");
      if (!A || !A.sttAvailable()) throw new Error("এই ফোনে ভয়েস চেনার ব্যবস্থা নেই। Groq বা Gemini key দিলে AI দিয়ে ভয়েস চিনবে।");
      V.stopSpeaking();
      sttHandlers = h;
      A.sttStart(S.settings.voice.lang === "en" ? "en-US" : "bn-BD");
    });
  };
  V.deviceStop = function () { if (A) A.sttStop(); };

  /* ---------------- speech output ---------------- */
  var audioEl = null, ttsWaiter = null;
  W.__tts = function (type) {
    if (type === "start") { V.speaking = true; if (V.onState) V.onState(true); }
    if (type === "done" || type === "error") { V.speaking = false; if (V.onState) V.onState(false); if (ttsWaiter) { var w = ttsWaiter; ttsWaiter = null; w(type); } }
    if (type === "no_voice") { V.speaking = false; if (V.onState) V.onState(false); if (ttsWaiter) { var x = ttsWaiter; ttsWaiter = null; x("no_voice"); } V.noVoice(); }
  };
  V.prepare = function () { if (A) A.ttsPrepare(); };
  V.stopSpeaking = function () {
    if (A) A.stopSpeak();
    if (audioEl) { audioEl.pause(); audioEl = null; }
    if (V.speaking) { V.speaking = false; if (V.onState) V.onState(false); }
    if (ttsWaiter) { var w = ttsWaiter; ttsWaiter = null; w("stopped"); }
  };
  V.noVoice = function () { if (S.ui && S.ui.noVoiceSheet) S.ui.noVoiceSheet(); };

  /** Speak text. Resolves when finished (or failed). */
  V.speak = function (text) {
    V.stopSpeaking();
    var lang = S.isBangla(text) ? "bn" : "en";
    var clean = S.speakable(text);
    if (lang === "en") clean = clean.replace(/।/g, ".");
    if (!clean) return Promise.resolve("empty");
    var useAI = S.settings.voice.output === "ai" && S.providers.find("gemini");
    var p = useAI ? aiSpeak(clean).catch(function () { return deviceSpeak(clean, lang); }) : deviceSpeak(clean, lang);
    return p;
  };
  function deviceSpeak(text, lang) {
    if (!A) {
      if (W.speechSynthesis) { var u = new SpeechSynthesisUtterance(text); u.lang = lang === "bn" ? "bn-BD" : "en-US"; speechSynthesis.speak(u); }
      return Promise.resolve("ok");
    }
    return new Promise(function (res) {
      ttsWaiter = res;
      var r = A.speak(text, lang, S.settings.voice.rate || 1.0);
      if (r === "no_voice") { ttsWaiter = null; res("no_voice"); V.noVoice(); return; }
      V.speaking = true; if (V.onState) V.onState(true);
    });
  }
  function pcmToWav(b64, rate) {
    var bin = atob(b64), len = bin.length, buf = new ArrayBuffer(44 + len), v = new DataView(buf), i;
    var w = function (o, s) { for (var k = 0; k < s.length; k++) v.setUint8(o + k, s.charCodeAt(k)); };
    w(0, "RIFF"); v.setUint32(4, 36 + len, true); w(8, "WAVE"); w(12, "fmt "); v.setUint32(16, 16, true);
    v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true);
    v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, "data"); v.setUint32(40, len, true);
    var u8 = new Uint8Array(buf, 44); for (i = 0; i < len; i++) u8[i] = bin.charCodeAt(i);
    var s = "", bytes = new Uint8Array(buf); for (i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return "data:audio/wav;base64," + btoa(s);
  }
  function playSrc(src) {
    return new Promise(function (res) {
      audioEl = new Audio(src);
      V.speaking = true; if (V.onState) V.onState(true);
      ttsWaiter = res;
      audioEl.onended = function () { audioEl = null; W.__tts("done"); };
      audioEl.onerror = function () { audioEl = null; W.__tts("error"); };
      audioEl.play().catch(function () { W.__tts("error"); });
    });
  }
  function aiSpeak(text) { return V.aiAudio(text).then(playSrc); }
  /** Natural Gemini voice -> wav data URL */
  V.aiAudio = function (text) {
    var g = S.providers.find("gemini");
    if (!g) return Promise.reject(new Error("no gemini"));
    var models = (g.allModels || []).filter(function (m) { return /tts/.test(m); });
    if (!models.length) models = ["gemini-3.8-flash-tts", "gemini-3.8-flash-lite-tts", "gemini-2.5-flash-preview-tts"];
    models.sort(function (a, b) { return (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0); });
    var voice = S.settings.voice.aiVoice || "Kore", input = text.slice(0, 4000);
    var tryOne = function (i) {
      if (i >= models.length) return Promise.reject(new Error("tts failed"));
      // current Interactions API
      return S.http({ url: "https://generativelanguage.googleapis.com/v1beta/interactions", headers: S.authHeaders(g),
        body: { model: models[i], input: [{ type: "user_input", content: [{ type: "text", text: input,
          annotations: [{ type: "speech_metadata", style: "warm, natural and clear" }] }] }],
          response_format: { type: "audio" }, generation_config: { speech_config: [{ voice: voice }] } } }).promise
        .then(function (r) {
          var d = S.J(r.body, {}), data = null;
          (d.steps || []).forEach(function (st) { (st.content || []).forEach(function (c) { if (c.type === "audio" && c.data) data = c.data; }); });
          if (!data && d.output_audio) data = d.output_audio.data;
          if (data) return "data:audio/wav;base64," + data;
          // older generateContent style
          return S.http({ url: "https://generativelanguage.googleapis.com/v1beta/models/" + models[i] + ":generateContent", headers: S.authHeaders(g),
            body: { contents: [{ parts: [{ text: input }] }], generationConfig: { responseModalities: ["AUDIO"],
              speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } } } } }).promise.then(function (r2) {
            var d2 = S.J(r2.body, {}), part = ((((d2.candidates || [])[0] || {}).content || {}).parts || [])[0];
            if (!part || !part.inlineData) throw new Error("no audio");
            var mt = part.inlineData.mimeType || "", rate = +(/rate=(\d+)/.exec(mt) || [0, 24000])[1];
            return /wav/.test(mt) ? "data:audio/wav;base64," + part.inlineData.data : pcmToWav(part.inlineData.data, rate);
          });
        })
        .catch(function () { return tryOne(i + 1); });
    };
    return tryOne(0);
  };
})(window);
