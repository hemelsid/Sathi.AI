package com.shathi.ai;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.media.MediaRecorder;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.StatFs;
import android.provider.AlarmClock;
import android.provider.CalendarContract;
import android.provider.MediaStore;
import android.speech.RecognitionListener;
import android.speech.RecognizerIntent;
import android.speech.SpeechRecognizer;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.speech.tts.Voice;
import android.util.Base64;
import android.view.View;
import android.view.Window;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.lang.reflect.Method;
import java.net.HttpURLConnection;
import java.net.URL;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public class MainActivity extends Activity {

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCb;
    private final Handler ui = new Handler(Looper.getMainLooper());
    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, HttpURLConnection> live = new ConcurrentHashMap<String, HttpURLConnection>();
    private final Map<String, Boolean> cancelled = new ConcurrentHashMap<String, Boolean>();

    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String ttsEngine = "";
    private MediaRecorder recorder;
    private File recFile;
    private long recStartMs;
    private SpeechRecognizer stt;

    private static final int REQ_FILE = 11, REQ_PERM = 13;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (Build.VERSION.SDK_INT >= 21) getWindow().setStatusBarColor(Color.parseColor("#14112E"));
        prefs = getSharedPreferences("shathi", Context.MODE_PRIVATE);

        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#14112E"));
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/pdf", "text/*",
                        "application/json", "audio/*"});
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                Intent chooser = Intent.createChooser(i, "ফাইল বেছে নিন");
                try {
                    startActivityForResult(chooser, REQ_FILE);
                } catch (Exception e) {
                    fileCb = null;
                    return false;
                }
                return true;
            }
        });
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (url.startsWith("http://") || url.startsWith("https://")) {
                    openExternal(url);
                    return true;
                }
                return false;
            }
        });
        web.addJavascriptInterface(new Bridge(), "Android");
        web.loadUrl("file:///android_asset/index.html");
        setContentView(web);
    }

    // ---------------- helpers ----------------
    private void js(final String fn, final Object... args) {
        final StringBuilder sb = new StringBuilder("window.").append(fn).append("&&window.").append(fn).append("(");
        for (int i = 0; i < args.length; i++) {
            if (i > 0) sb.append(',');
            Object a = args[i];
            if (a == null) sb.append("null");
            else if (a instanceof Number || a instanceof Boolean) sb.append(a.toString());
            else sb.append(JSONObject.quote(a.toString()));
        }
        sb.append(")");
        ui.post(new Runnable() {
            @Override
            public void run() {
                if (web != null) web.evaluateJavascript(sb.toString(), null);
            }
        });
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    private boolean startSafe(Intent i) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            startActivity(i);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private static String ok() {
        return "{\"ok\":true}";
    }

    private static String err(String msg) {
        try {
            return new JSONObject().put("error", msg).toString();
        } catch (Exception e) {
            return "{\"error\":\"failed\"}";
        }
    }

    private static String human(long n) {
        String[] u = {"B", "KB", "MB", "GB", "TB"};
        double d = n;
        int i = 0;
        while (d >= 1024 && i < u.length - 1) {
            d /= 1024;
            i++;
        }
        return i == 0 ? (n + " B") : String.format(Locale.US, "%.1f %s", d, u[i]);
    }

    private static String root() {
        return Environment.getExternalStorageDirectory().getAbsolutePath();
    }

    private static File resolve(String path) {
        if (path == null || path.trim().isEmpty()) return new File(root());
        path = path.trim();
        if (path.startsWith("~")) path = root() + path.substring(1);
        if (path.startsWith("/sdcard")) path = root() + path.substring(7);
        File f = new File(path);
        if (!f.isAbsolute()) f = new File(root(), path);
        return f;
    }

    private static String readAll(InputStream in) throws Exception {
        BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
        StringBuilder sb = new StringBuilder();
        char[] buf = new char[8192];
        int n;
        while ((n = r.read(buf)) > 0) sb.append(buf, 0, n);
        r.close();
        return sb.toString();
    }

    private boolean storageAllowed() {
        if (Build.VERSION.SDK_INT >= 30) {
            try {
                Method m = Environment.class.getMethod("isExternalStorageManager");
                return (Boolean) m.invoke(null);
            } catch (Exception e) {
                return false;
            }
        }
        if (Build.VERSION.SDK_INT >= 23) {
            return checkSelfPermission(Manifest.permission.READ_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED;
        }
        return true;
    }

    private boolean hasMic() {
        return Build.VERSION.SDK_INT < 23 || checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED;
    }

    // ---------------- activity results ----------------
    @Override
    protected void onActivityResult(int req, int res, Intent data) {
        super.onActivityResult(req, res, data);
        if (req == REQ_FILE) {
            Uri[] out = null;
            if (res == RESULT_OK && data != null) {
                if (data.getClipData() != null) {
                    int n = data.getClipData().getItemCount();
                    out = new Uri[n];
                    for (int i = 0; i < n; i++) out[i] = data.getClipData().getItemAt(i).getUri();
                } else if (data.getData() != null) {
                    out = new Uri[]{data.getData()};
                }
            }
            if (fileCb != null) fileCb.onReceiveValue(out);
            fileCb = null;
        }
    }

    @Override
    public void onRequestPermissionsResult(int req, String[] perms, int[] results) {
        super.onRequestPermissionsResult(req, perms, results);
        for (int i = 0; i < perms.length; i++) {
            boolean g = i < results.length && results[i] == PackageManager.PERMISSION_GRANTED;
            String name = Manifest.permission.RECORD_AUDIO.equals(perms[i]) ? "mic" : "storage";
            js("__perm", name, g);
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        js("onAppResume");
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        if (stt != null) stt.destroy();
        if (recorder != null) {
            try {
                recorder.release();
            } catch (Exception ignored) {
            }
        }
        pool.shutdownNow();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null) {
            web.evaluateJavascript("window.onBack ? window.onBack() : false", new ValueCallback<String>() {
                @Override
                public void onReceiveValue(String v) {
                    if (!"true".equals(v)) MainActivity.super.onBackPressed();
                }
            });
        } else {
            super.onBackPressed();
        }
    }

    // ---------------- TTS ----------------
    private boolean installed(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception e) {
            return false;
        }
    }

    private void ensureTts(final Runnable then) {
        if (tts != null && ttsReady) {
            if (then != null) then.run();
            return;
        }
        if (tts != null) return; // still initialising
        ttsEngine = installed("com.google.android.tts") ? "com.google.android.tts" : "";
        TextToSpeech.OnInitListener l = new TextToSpeech.OnInitListener() {
            @Override
            public void onInit(int status) {
                ttsReady = status == TextToSpeech.SUCCESS;
                if (!ttsReady) {
                    js("__tts", "error", "init");
                    return;
                }
                tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                    @Override
                    public void onStart(String id) {
                        if (id.contains("#0")) js("__tts", "start", id);
                    }

                    @Override
                    public void onDone(String id) {
                        if (id.startsWith("f_")) {
                            finishTtsFile(id);
                            return;
                        }
                        if (id.endsWith("#last")) js("__tts", "done", id);
                    }

                    @Override
                    public void onError(String id) {
                        if (id.startsWith("f_")) {
                            js("__ttsFile", id.substring(2), "", "error");
                            return;
                        }
                        js("__tts", "error", id);
                    }
                });
                if (then != null) then.run();
            }
        };
        tts = ttsEngine.isEmpty() ? new TextToSpeech(this, l) : new TextToSpeech(this, l, ttsEngine);
    }

    private void finishTtsFile(final String uttId) {
        pool.execute(new Runnable() {
            @Override
            public void run() {
                String id = uttId.substring(2);
                try {
                    File f = new File(getCacheDir(), "tts_" + id + ".wav");
                    FileInputStream in = new FileInputStream(f);
                    ByteArrayOutputStream bo = new ByteArrayOutputStream();
                    byte[] buf = new byte[65536];
                    int n;
                    while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                    in.close();
                    f.delete();
                    js("__ttsFile", id, Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP), "");
                } catch (Exception e) {
                    js("__ttsFile", id, "", e.toString());
                }
            }
        });
    }

    private Voice bestVoice(String lang) {
        try {
            Voice best = null;
            int bestScore = -1;
            for (Voice v : tts.getVoices()) {
                Locale loc = v.getLocale();
                String l = loc.getLanguage();
                boolean match = lang.equals("bn") ? (l.equals("bn") || l.equals("ben")) : l.equals("en");
                if (!match) continue;
                if (v.getFeatures() != null && v.getFeatures().contains(TextToSpeech.Engine.KEY_FEATURE_NOT_INSTALLED)) continue;
                int score = v.getQuality();
                if ("BD".equals(loc.getCountry())) score += 50;
                if (lang.equals("en") && "US".equals(loc.getCountry())) score += 30;
                if (!v.isNetworkConnectionRequired()) score += 20;
                if (score > bestScore) {
                    bestScore = score;
                    best = v;
                }
            }
            return best;
        } catch (Exception e) {
            return null;
        }
    }

    private boolean setLang(String lang) {
        Voice v = bestVoice(lang);
        if (v != null) {
            tts.setVoice(v);
            return true;
        }
        Locale[] tryLocs = lang.equals("bn") ? new Locale[]{new Locale("bn", "BD"), new Locale("bn", "IN"), new Locale("bn")}
                : new Locale[]{Locale.US, Locale.UK, Locale.ENGLISH};
        for (Locale loc : tryLocs) {
            int r = tts.isLanguageAvailable(loc);
            if (r >= TextToSpeech.LANG_AVAILABLE) {
                tts.setLanguage(loc);
                return true;
            }
        }
        return false;
    }

    private static List<String> chunks(String text, int max) {
        List<String> out = new ArrayList<String>();
        String[] parts = text.split("(?<=[।!?\\.\\n])");
        StringBuilder cur = new StringBuilder();
        for (String p : parts) {
            if (cur.length() + p.length() > max && cur.length() > 0) {
                out.add(cur.toString());
                cur.setLength(0);
            }
            while (p.length() > max) {
                out.add(p.substring(0, max));
                p = p.substring(max);
            }
            cur.append(p);
        }
        if (cur.toString().trim().length() > 0) out.add(cur.toString());
        return out;
    }

    // ---------------- recording ----------------
    private String startRecording() {
        if (!hasMic()) return "perm";
        try {
            stopRecorderQuietly();
            recFile = new File(getCacheDir(), "voice_" + System.currentTimeMillis() + ".m4a");
            recorder = new MediaRecorder();
            recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION);
            recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
            recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
            recorder.setAudioChannels(1);
            recorder.setAudioSamplingRate(16000);
            recorder.setAudioEncodingBitRate(48000);
            recorder.setOutputFile(recFile.getAbsolutePath());
            recorder.prepare();
            recorder.start();
            recStartMs = System.currentTimeMillis();
            return "ok";
        } catch (Exception e) {
            stopRecorderQuietly();
            return "error:" + e.getMessage();
        }
    }

    private void stopRecorderQuietly() {
        if (recorder != null) {
            try {
                recorder.stop();
            } catch (Exception ignored) {
            }
            try {
                recorder.release();
            } catch (Exception ignored) {
            }
            recorder = null;
        }
    }

    // ---------------- scanning ----------------
    private static class Scan {
        Map<String, Long> folders = new HashMap<String, Long>();
        Map<String, long[]> types = new HashMap<String, long[]>();
        List<long[]> bigIdx = new ArrayList<long[]>();
        List<String> bigPath = new ArrayList<String>();
        long files = 0;
        long minBig = 0;
    }

    private static String typeOf(String name) {
        String n = name.toLowerCase(Locale.US);
        int dot = n.lastIndexOf('.');
        String e = dot >= 0 ? n.substring(dot) : "";
        if (Arrays.asList(".jpg", ".jpeg", ".png", ".webp", ".heic", ".gif", ".bmp").contains(e)) return "ছবি";
        if (Arrays.asList(".mp4", ".mkv", ".3gp", ".mov", ".avi", ".webm").contains(e)) return "ভিডিও";
        if (Arrays.asList(".mp3", ".m4a", ".aac", ".opus", ".ogg", ".wav", ".amr", ".flac").contains(e)) return "অডিও";
        if (Arrays.asList(".pdf", ".doc", ".docx", ".xls", ".xlsx", ".ppt", ".pptx", ".txt").contains(e)) return "ডকুমেন্ট";
        if (Arrays.asList(".apk", ".apks", ".xapk").contains(e)) return "APK";
        if (Arrays.asList(".zip", ".rar", ".7z", ".tar", ".gz").contains(e)) return "আর্কাইভ";
        return "অন্যান্য";
    }

    private void walk(File dir, String top, Scan sc, int depth, String skip) {
        if (depth > 40) return;
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String p = f.getAbsolutePath();
            if (p.startsWith(skip)) continue;
            String t = top == null ? (f.isDirectory() ? f.getName() : "(মূল ফোল্ডারের ফাইল)") : top;
            if (f.isDirectory()) {
                walk(f, t, sc, depth + 1, skip);
            } else {
                long len = f.length();
                sc.files++;
                Long cur = sc.folders.get(t);
                sc.folders.put(t, (cur == null ? 0 : cur) + len);
                String ty = typeOf(f.getName());
                long[] tv = sc.types.get(ty);
                if (tv == null) {
                    tv = new long[2];
                    sc.types.put(ty, tv);
                }
                tv[0] += len;
                tv[1]++;
                if (len > sc.minBig || sc.bigIdx.size() < 30) {
                    sc.bigIdx.add(new long[]{len, f.lastModified()});
                    sc.bigPath.add(p);
                    if (sc.bigIdx.size() > 120) trimBig(sc);
                }
            }
        }
    }

    private static void trimBig(Scan sc) {
        Integer[] order = new Integer[sc.bigIdx.size()];
        for (int i = 0; i < order.length; i++) order[i] = i;
        final List<long[]> b = sc.bigIdx;
        Arrays.sort(order, new Comparator<Integer>() {
            @Override
            public int compare(Integer a, Integer c) {
                return Long.compare(b.get(c)[0], b.get(a)[0]);
            }
        });
        List<long[]> ni = new ArrayList<long[]>();
        List<String> np = new ArrayList<String>();
        for (int i = 0; i < Math.min(30, order.length); i++) {
            ni.add(sc.bigIdx.get(order[i]));
            np.add(sc.bigPath.get(order[i]));
        }
        sc.bigIdx = ni;
        sc.bigPath = np;
        sc.minBig = ni.isEmpty() ? 0 : ni.get(ni.size() - 1)[0];
    }

    private void deleteRec(File f, long[] acc) {
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteRec(k, acc);
        if (f.isFile()) {
            acc[0] += f.length();
            acc[1]++;
        }
        f.delete();
    }

    /** Save bytes into the public Download folder (MediaStore on Android 10+). Returns a display path. */
    private String lastSavedUri = "";

    private String saveFileToDownloads(File src, String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Shathi");
            ContentResolver cr = getContentResolver();
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("MediaStore insert failed");
            OutputStream os = cr.openOutputStream(uri);
            FileInputStream in = new FileInputStream(src);
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) os.write(buf, 0, n);
            in.close();
            os.close();
            lastSavedUri = uri.toString();
            return "Download/Shathi/" + name;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Shathi");
        dir.mkdirs();
        File f = new File(dir, name);
        FileInputStream in = new FileInputStream(src);
        FileOutputStream fo = new FileOutputStream(f);
        byte[] buf = new byte[65536];
        int n;
        while ((n = in.read(buf)) > 0) fo.write(buf, 0, n);
        in.close();
        fo.close();
        lastSavedUri = Uri.fromFile(f).toString();
        return f.getAbsolutePath();
    }

    private String savedJson(String path) {
        try {
            return new JSONObject().put("path", path).put("uri", lastSavedUri).toString();
        } catch (Exception e) {
            return path;
        }
    }

    private String saveToDownloads(byte[] data, String name, String mime) throws Exception {
        if (Build.VERSION.SDK_INT >= 29) {
            ContentValues cv = new ContentValues();
            cv.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            cv.put(MediaStore.MediaColumns.MIME_TYPE, mime);
            cv.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Shathi");
            ContentResolver cr = getContentResolver();
            Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, cv);
            if (uri == null) throw new Exception("MediaStore insert failed");
            OutputStream os = cr.openOutputStream(uri);
            os.write(data);
            os.close();
            lastSavedUri = uri.toString();
            return "Download/Shathi/" + name;
        }
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS), "Shathi");
        dir.mkdirs();
        File f = new File(dir, name);
        FileOutputStream fo = new FileOutputStream(f);
        fo.write(data);
        fo.close();
        lastSavedUri = Uri.fromFile(f).toString();
        return f.getAbsolutePath();
    }

    // =====================================================================
    public class Bridge {

        // ---------- prefs & app data ----------
        @JavascriptInterface
        public String getPref(String k) {
            return prefs.getString(k, "");
        }

        @JavascriptInterface
        public void setPref(String k, String v) {
            prefs.edit().putString(k, v).apply();
        }

        @JavascriptInterface
        public String saveData(String name, String text) {
            if (!name.matches("[A-Za-z0-9_.-]{1,64}")) return err("bad name");
            try {
                File tmp = new File(getFilesDir(), name + ".tmp");
                OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(tmp), "UTF-8");
                w.write(text);
                w.close();
                File dest = new File(getFilesDir(), name);
                if (!tmp.renameTo(dest)) {
                    dest.delete();
                    tmp.renameTo(dest);
                }
                return ok();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String loadData(String name) {
            if (!name.matches("[A-Za-z0-9_.-]{1,64}")) return "";
            try {
                File f = new File(getFilesDir(), name);
                if (!f.exists()) return "";
                return readAll(new FileInputStream(f));
            } catch (Exception e) {
                return "";
            }
        }

        @JavascriptInterface
        public String appVersion() {
            try {
                return getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
            } catch (Exception e) {
                return "";
            }
        }

        // ---------- network (no CORS; streaming) ----------
        @JavascriptInterface
        public void http(final String id, final String method, final String url, final String headersJson,
                         final String body, final boolean stream) {
            cancelled.remove(id);
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        live.put(id, c);
                        c.setRequestMethod(method);
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(stream ? 180000 : 120000);
                        c.setInstanceFollowRedirects(true);
                        c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android " + Build.VERSION.RELEASE
                                + ") AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36 ShathiAI");
                        if (headersJson != null && headersJson.length() > 2) {
                            JSONObject h = new JSONObject(headersJson);
                            Iterator<String> it = h.keys();
                            while (it.hasNext()) {
                                String k = it.next();
                                c.setRequestProperty(k, h.getString(k));
                            }
                        }
                        if (body != null && body.length() > 0) {
                            c.setDoOutput(true);
                            OutputStream os = c.getOutputStream();
                            os.write(body.getBytes("UTF-8"));
                            os.close();
                        }
                        int code = c.getResponseCode();
                        js("__net", id, "status", String.valueOf(code));
                        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in == null) {
                            js("__net", id, "end", String.valueOf(code));
                            return;
                        }
                        if (stream && code < 400) {
                            BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                            StringBuilder batch = new StringBuilder();
                            long last = System.currentTimeMillis();
                            String line;
                            while ((line = r.readLine()) != null) {
                                if (cancelled.containsKey(id)) break;
                                batch.append(line).append('\n');
                                long now = System.currentTimeMillis();
                                if (now - last > 60 || batch.length() > 12000) {
                                    js("__net", id, "chunk", batch.toString());
                                    batch.setLength(0);
                                    last = now;
                                }
                            }
                            if (batch.length() > 0) js("__net", id, "chunk", batch.toString());
                            r.close();
                        } else {
                            js("__net", id, "body", readAll(in));
                        }
                        js("__net", id, "end", String.valueOf(code));
                    } catch (Exception e) {
                        if (cancelled.containsKey(id)) js("__net", id, "end", "0");
                        else js("__net", id, "error", e.getClass().getSimpleName() + ": " + e.getMessage());
                    } finally {
                        live.remove(id);
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        @JavascriptInterface
        public void cancel(final String id) {
            cancelled.put(id, true);
            final HttpURLConnection c = live.get(id);
            if (c != null) {
                pool.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            c.disconnect();
                        } catch (Exception ignored) {
                        }
                    }
                });
            }
        }

        /** multipart/form-data POST with one binary file (for speech-to-text APIs). */
        @JavascriptInterface
        public void multipart(final String id, final String url, final String headersJson, final String fieldsJson,
                              final String fileB64, final String fileName, final String mime) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        String boundary = "----shathi" + System.currentTimeMillis();
                        c = (HttpURLConnection) new URL(url).openConnection();
                        live.put(id, c);
                        c.setRequestMethod("POST");
                        c.setConnectTimeout(20000);
                        c.setReadTimeout(120000);
                        c.setDoOutput(true);
                        c.setRequestProperty("Content-Type", "multipart/form-data; boundary=" + boundary);
                        JSONObject h = new JSONObject(headersJson == null || headersJson.isEmpty() ? "{}" : headersJson);
                        Iterator<String> it = h.keys();
                        while (it.hasNext()) {
                            String k = it.next();
                            c.setRequestProperty(k, h.getString(k));
                        }
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        JSONObject f = new JSONObject(fieldsJson == null || fieldsJson.isEmpty() ? "{}" : fieldsJson);
                        Iterator<String> fk = f.keys();
                        while (fk.hasNext()) {
                            String k = fk.next();
                            bo.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"" + k + "\"\r\n\r\n"
                                    + f.getString(k) + "\r\n").getBytes("UTF-8"));
                        }
                        bo.write(("--" + boundary + "\r\nContent-Disposition: form-data; name=\"file\"; filename=\""
                                + fileName + "\"\r\nContent-Type: " + mime + "\r\n\r\n").getBytes("UTF-8"));
                        bo.write(Base64.decode(fileB64, Base64.DEFAULT));
                        bo.write(("\r\n--" + boundary + "--\r\n").getBytes("UTF-8"));
                        OutputStream os = c.getOutputStream();
                        os.write(bo.toByteArray());
                        os.close();
                        int code = c.getResponseCode();
                        js("__net", id, "status", String.valueOf(code));
                        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        js("__net", id, "body", in == null ? "" : readAll(in));
                        js("__net", id, "end", String.valueOf(code));
                    } catch (Exception e) {
                        js("__net", id, "error", e.getClass().getSimpleName() + ": " + e.getMessage());
                    } finally {
                        live.remove(id);
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        /** Download a URL (or save base64 when url starts with "b64:") into Download/Shathi. Result via __net(id,"saved",path). */
        @JavascriptInterface
        public void download(final String id, final String url, final String name, final String mime) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    try {
                        byte[] data;
                        if (url.startsWith("b64:")) {
                            data = Base64.decode(url.substring(4), Base64.DEFAULT);
                        } else {
                            HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                            c.setConnectTimeout(20000);
                            c.setReadTimeout(120000);
                            c.setInstanceFollowRedirects(true);
                            InputStream in = c.getInputStream();
                            ByteArrayOutputStream bo = new ByteArrayOutputStream();
                            byte[] buf = new byte[16384];
                            int n;
                            while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                            in.close();
                            c.disconnect();
                            data = bo.toByteArray();
                        }
                        js("__net", id, "saved", saveToDownloads(data, name.replaceAll("[\\\\/:*?\"<>|]", "_"), mime));
                    } catch (Exception e) {
                        js("__net", id, "error", e.toString());
                    }
                }
            });
        }

        /** Like http() but the response body is delivered as base64 (for images/audio/video). Sends "ctype" first. */
        @JavascriptInterface
        public void httpBin(final String id, final String method, final String url, final String headersJson, final String body) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection c = null;
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        live.put(id, c);
                        c.setRequestMethod(method);
                        c.setConnectTimeout(30000);
                        c.setReadTimeout(300000);
                        c.setInstanceFollowRedirects(true);
                        c.setRequestProperty("User-Agent", "ShathiAI/2 (Android)");
                        if (headersJson != null && headersJson.length() > 2) {
                            JSONObject h = new JSONObject(headersJson);
                            Iterator<String> it = h.keys();
                            while (it.hasNext()) {
                                String k = it.next();
                                c.setRequestProperty(k, h.getString(k));
                            }
                        }
                        if (body != null && body.length() > 0) {
                            c.setDoOutput(true);
                            OutputStream os = c.getOutputStream();
                            os.write(body.getBytes("UTF-8"));
                            os.close();
                        }
                        int code = c.getResponseCode();
                        js("__net", id, "status", String.valueOf(code));
                        String ct = c.getContentType();
                        js("__net", id, "ctype", ct == null ? "" : ct);
                        InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                        if (in == null) {
                            js("__net", id, "end", String.valueOf(code));
                            return;
                        }
                        ByteArrayOutputStream bo = new ByteArrayOutputStream();
                        byte[] buf = new byte[65536];
                        int n;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelled.containsKey(id)) break;
                            bo.write(buf, 0, n);
                        }
                        in.close();
                        if (code >= 400 || (ct != null && (ct.contains("json") || ct.startsWith("text")))) {
                            js("__net", id, "body", new String(bo.toByteArray(), "UTF-8"));
                        } else {
                            js("__net", id, "body", Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP));
                        }
                        js("__net", id, "end", String.valueOf(code));
                    } catch (Exception e) {
                        js("__net", id, "error", e.getClass().getSimpleName() + ": " + e.getMessage());
                    } finally {
                        live.remove(id);
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        /** Download a URL (optionally with headers) straight into Download/Shathi. Result: __net(id,"saved",{path,uri}). */
        @JavascriptInterface
        public void downloadTo(final String id, final String url, final String headersJson, final String name, final String mime) {
            pool.execute(new Runnable() {
                @Override
                public void run() {
                    HttpURLConnection c = null;
                    File tmp = new File(getCacheDir(), "dl_" + id);
                    try {
                        c = (HttpURLConnection) new URL(url).openConnection();
                        live.put(id, c);
                        c.setConnectTimeout(30000);
                        c.setReadTimeout(600000);
                        c.setInstanceFollowRedirects(true);
                        if (headersJson != null && headersJson.length() > 2) {
                            JSONObject h = new JSONObject(headersJson);
                            Iterator<String> it = h.keys();
                            while (it.hasNext()) {
                                String k = it.next();
                                c.setRequestProperty(k, h.getString(k));
                            }
                        }
                        int code = c.getResponseCode();
                        if (code >= 400) {
                            InputStream es = c.getErrorStream();
                            js("__net", id, "error", "HTTP " + code + " " + (es == null ? "" : readAll(es)));
                            return;
                        }
                        String ct = c.getContentType();
                        if (ct != null && (ct.contains("json") || ct.startsWith("text"))) {
                            js("__net", id, "error", "Not a media file: " + readAll(c.getInputStream()));
                            return;
                        }
                        InputStream in = c.getInputStream();
                        FileOutputStream fo = new FileOutputStream(tmp);
                        byte[] buf = new byte[65536];
                        int n;
                        long total = 0;
                        while ((n = in.read(buf)) > 0) {
                            if (cancelled.containsKey(id)) break;
                            fo.write(buf, 0, n);
                            total += n;
                        }
                        fo.close();
                        in.close();
                        if (total < 1000) {
                            js("__net", id, "error", "File too small (" + total + " bytes)");
                            return;
                        }
                        String path = saveFileToDownloads(tmp, name.replaceAll("[\\\\/:*?\"<>|]", "_"), mime);
                        js("__net", id, "saved", savedJson(path));
                    } catch (Exception e) {
                        js("__net", id, "error", e.toString());
                    } finally {
                        tmp.delete();
                        live.remove(id);
                        if (c != null) c.disconnect();
                    }
                }
            });
        }

        // ---------- chunked binary save (videos rendered in the page) ----------
        @JavascriptInterface
        public String fileBegin() {
            String h = "chunk_" + System.currentTimeMillis();
            new File(getCacheDir(), h).delete();
            return h;
        }

        @JavascriptInterface
        public String fileAppend(String handle, String b64) {
            if (!handle.matches("chunk_\\d+")) return err("bad handle");
            try {
                FileOutputStream fo = new FileOutputStream(new File(getCacheDir(), handle), true);
                fo.write(Base64.decode(b64, Base64.DEFAULT));
                fo.close();
                return ok();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String fileEnd(String handle, String name, String mime) {
            if (!handle.matches("chunk_\\d+")) return err("bad handle");
            File f = new File(getCacheDir(), handle);
            try {
                String path = saveFileToDownloads(f, name.replaceAll("[\\\\/:*?\"<>|]", "_"), mime);
                return savedJson(path);
            } catch (Exception e) {
                return err(e.toString());
            } finally {
                f.delete();
            }
        }

        @JavascriptInterface
        public String openUri(String uri, String mime) {
            try {
                Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(Uri.parse(uri), mime);
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                return startSafe(i) ? ok() : err("No app to open this file");
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String shareUri(String uri, String mime) {
            try {
                Intent i = new Intent(Intent.ACTION_SEND);
                i.setType(mime);
                i.putExtra(Intent.EXTRA_STREAM, Uri.parse(uri));
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                return startSafe(Intent.createChooser(i, "শেয়ার করুন")) ? ok() : err("share failed");
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        /** Synthesize speech to a WAV file; result via __ttsFile(id, base64, error). */
        @JavascriptInterface
        public void ttsToFile(final String id, final String text, final String lang, final float rate) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    ensureTts(new Runnable() {
                        @Override
                        public void run() {
                            if (!setLang(lang)) {
                                js("__ttsFile", id, "", "no_voice");
                                return;
                            }
                            tts.setSpeechRate(rate <= 0 ? 1.0f : rate);
                            File f = new File(getCacheDir(), "tts_" + id + ".wav");
                            int r = tts.synthesizeToFile(text, null, f, "f_" + id);
                            if (r != TextToSpeech.SUCCESS) js("__ttsFile", id, "", "synth failed");
                        }
                    });
                }
            });
        }

        // ---------- permissions ----------
        @JavascriptInterface
        public boolean hasMicPerm() {
            return hasMic();
        }

        @JavascriptInterface
        public void requestMic() {
            if (Build.VERSION.SDK_INT >= 23) requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, REQ_PERM);
            else js("__perm", "mic", true);
        }

        @JavascriptInterface
        public boolean hasStorage() {
            return storageAllowed();
        }

        @JavascriptInterface
        public void requestStorage() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (Build.VERSION.SDK_INT >= 30) {
                        if (!startSafe(new Intent("android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
                                Uri.parse("package:" + getPackageName())))) {
                            startSafe(new Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION"));
                        }
                    } else if (Build.VERSION.SDK_INT >= 23) {
                        requestPermissions(new String[]{Manifest.permission.READ_EXTERNAL_STORAGE,
                                Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_PERM);
                    }
                }
            });
        }

        // ---------- voice recording (for AI transcription) ----------
        @JavascriptInterface
        public String recStart() {
            return startRecording();
        }

        @JavascriptInterface
        public String recStop() {
            try {
                long ms = System.currentTimeMillis() - recStartMs;
                stopRecorderQuietly();
                if (recFile == null || !recFile.exists()) return err("no recording");
                FileInputStream in = new FileInputStream(recFile);
                ByteArrayOutputStream bo = new ByteArrayOutputStream();
                byte[] buf = new byte[16384];
                int n;
                while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
                in.close();
                recFile.delete();
                return new JSONObject().put("b64", Base64.encodeToString(bo.toByteArray(), Base64.NO_WRAP))
                        .put("mime", "audio/mp4").put("ms", ms).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public void recCancel() {
            stopRecorderQuietly();
            if (recFile != null) recFile.delete();
        }

        @JavascriptInterface
        public int recLevel() {
            try {
                return recorder == null ? 0 : recorder.getMaxAmplitude();
            } catch (Exception e) {
                return 0;
            }
        }

        // ---------- on-device speech recognition (fallback) ----------
        @JavascriptInterface
        public boolean sttAvailable() {
            return SpeechRecognizer.isRecognitionAvailable(MainActivity.this);
        }

        @JavascriptInterface
        public void sttStart(final String lang) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (!hasMic()) {
                        js("__stt", "error", "perm");
                        return;
                    }
                    if (stt != null) stt.destroy();
                    stt = SpeechRecognizer.createSpeechRecognizer(MainActivity.this);
                    stt.setRecognitionListener(new RecognitionListener() {
                        public void onReadyForSpeech(Bundle b) { js("__stt", "ready", ""); }
                        public void onBeginningOfSpeech() { }
                        public void onRmsChanged(float v) { }
                        public void onBufferReceived(byte[] b) { }
                        public void onEndOfSpeech() { js("__stt", "end", ""); }
                        public void onError(int e) { js("__stt", "error", String.valueOf(e)); }
                        public void onResults(Bundle b) {
                            ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            js("__stt", "final", r != null && !r.isEmpty() ? r.get(0) : "");
                        }
                        public void onPartialResults(Bundle b) {
                            ArrayList<String> r = b.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION);
                            if (r != null && !r.isEmpty()) js("__stt", "partial", r.get(0));
                        }
                        public void onEvent(int t, Bundle b) { }
                    });
                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, lang == null || lang.isEmpty() ? "bn-BD" : lang);
                    i.putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true);
                    i.putExtra(RecognizerIntent.EXTRA_CALLING_PACKAGE, getPackageName());
                    stt.startListening(i);
                }
            });
        }

        @JavascriptInterface
        public void sttStop() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (stt != null) stt.stopListening();
                }
            });
        }

        // ---------- text to speech ----------
        @JavascriptInterface
        public void ttsPrepare() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    ensureTts(null);
                }
            });
        }

        @JavascriptInterface
        public String ttsInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("ready", ttsReady);
                o.put("engine", tts != null ? tts.getDefaultEngine() : ttsEngine);
                o.put("googleInstalled", installed("com.google.android.tts"));
                boolean bn = false;
                if (ttsReady) {
                    bn = bestVoice("bn") != null || tts.isLanguageAvailable(new Locale("bn", "BD")) >= TextToSpeech.LANG_AVAILABLE
                            || tts.isLanguageAvailable(new Locale("bn", "IN")) >= TextToSpeech.LANG_AVAILABLE;
                }
                o.put("bangla", bn);
                return o.toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        /** Speak text in chunks with the best installed voice. lang: "bn" or "en". Returns "ok" | "no_voice" | "loading". */
        @JavascriptInterface
        public String speak(final String text, final String lang, final float rate) {
            if (tts == null || !ttsReady) {
                ui.post(new Runnable() {
                    @Override
                    public void run() {
                        ensureTts(new Runnable() {
                            @Override
                            public void run() {
                                String r = doSpeak(text, lang, rate);
                                if (!"ok".equals(r)) js("__tts", r, "");
                            }
                        });
                    }
                });
                return "loading";
            }
            return doSpeak(text, lang, rate);
        }

        private String doSpeak(String text, String lang, float rate) {
            if (!setLang(lang)) return "no_voice";
            tts.setSpeechRate(rate <= 0 ? 1.0f : rate);
            tts.setPitch(1.0f);
            int max = Math.min(3000, TextToSpeech.getMaxSpeechInputLength() - 100);
            List<String> parts = chunks(text, max);
            tts.stop();
            String base = "u" + System.currentTimeMillis();
            for (int i = 0; i < parts.size(); i++) {
                String id = base + "#" + i + (i == parts.size() - 1 ? "#last" : "");
                tts.speak(parts.get(i), i == 0 ? TextToSpeech.QUEUE_FLUSH : TextToSpeech.QUEUE_ADD, null, id);
            }
            return "ok";
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (tts != null) tts.stop();
        }

        @JavascriptInterface
        public void openTtsSettings() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (!startSafe(new Intent("com.android.settings.TTS_SETTINGS"))) {
                        Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
                        if (installed("com.google.android.tts")) i.setPackage("com.google.android.tts");
                        startSafe(i);
                    }
                }
            });
        }

        @JavascriptInterface
        public void installTtsData() {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(TextToSpeech.Engine.ACTION_INSTALL_TTS_DATA);
                    if (installed("com.google.android.tts")) i.setPackage("com.google.android.tts");
                    if (!startSafe(i)) {
                        openExternal("https://play.google.com/store/apps/details?id=com.google.android.tts");
                    }
                }
            });
        }

        // ---------- phone actions (all open the system app; the user confirms there) ----------
        @JavascriptInterface
        public String setAlarm(int hour, int minute, String label) {
            Intent i = new Intent(AlarmClock.ACTION_SET_ALARM);
            i.putExtra(AlarmClock.EXTRA_HOUR, hour);
            i.putExtra(AlarmClock.EXTRA_MINUTES, minute);
            if (label != null) i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
            return startSafe(i) ? ok() : err("No clock app");
        }

        @JavascriptInterface
        public String setTimer(int seconds, String label) {
            Intent i = new Intent(AlarmClock.ACTION_SET_TIMER);
            i.putExtra(AlarmClock.EXTRA_LENGTH, seconds);
            if (label != null) i.putExtra(AlarmClock.EXTRA_MESSAGE, label);
            i.putExtra(AlarmClock.EXTRA_SKIP_UI, false);
            return startSafe(i) ? ok() : err("No clock app");
        }

        @JavascriptInterface
        public String calendarEvent(String title, String desc, double startMs, double endMs, String location) {
            Intent i = new Intent(Intent.ACTION_INSERT).setData(CalendarContract.Events.CONTENT_URI);
            i.putExtra(CalendarContract.Events.TITLE, title);
            if (desc != null) i.putExtra(CalendarContract.Events.DESCRIPTION, desc);
            if (location != null) i.putExtra(CalendarContract.Events.EVENT_LOCATION, location);
            i.putExtra(CalendarContract.EXTRA_EVENT_BEGIN_TIME, (long) startMs);
            i.putExtra(CalendarContract.EXTRA_EVENT_END_TIME, (long) endMs);
            return startSafe(i) ? ok() : err("No calendar app");
        }

        @JavascriptInterface
        public String dial(String number) {
            return startSafe(new Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + Uri.encode(number)))) ? ok() : err("No phone app");
        }

        @JavascriptInterface
        public String sms(String number, String body) {
            Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("smsto:" + Uri.encode(number == null ? "" : number)));
            i.putExtra("sms_body", body);
            return startSafe(i) ? ok() : err("No SMS app");
        }

        @JavascriptInterface
        public String email(String to, String subject, String body) {
            Intent i = new Intent(Intent.ACTION_SENDTO, Uri.parse("mailto:" + Uri.encode(to == null ? "" : to)));
            i.putExtra(Intent.EXTRA_SUBJECT, subject);
            i.putExtra(Intent.EXTRA_TEXT, body);
            return startSafe(i) ? ok() : err("No email app");
        }

        @JavascriptInterface
        public String openMap(String query) {
            return startSafe(new Intent(Intent.ACTION_VIEW, Uri.parse("geo:0,0?q=" + Uri.encode(query)))) ? ok() : err("No map app");
        }

        @JavascriptInterface
        public void openUrl(String url) {
            openExternal(url);
        }

        @JavascriptInterface
        public void share(String text) {
            Intent i = new Intent(Intent.ACTION_SEND);
            i.setType("text/plain");
            i.putExtra(Intent.EXTRA_TEXT, text);
            startSafe(Intent.createChooser(i, "শেয়ার করুন"));
        }

        @JavascriptInterface
        public void copyText(final String text) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                    if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Shathi", text));
                }
            });
        }

        @JavascriptInterface
        public String readClipboard() {
            try {
                ClipboardManager cm = (ClipboardManager) getSystemService(Context.CLIPBOARD_SERVICE);
                if (cm == null || !cm.hasPrimaryClip()) return "";
                CharSequence t = cm.getPrimaryClip().getItemAt(0).coerceToText(MainActivity.this);
                return t == null ? "" : t.toString();
            } catch (Exception e) {
                return "";
            }
        }

        // ---------- device & files ----------
        @JavascriptInterface
        public String deviceInfo() {
            try {
                JSONObject o = new JSONObject();
                o.put("model", Build.MANUFACTURER + " " + Build.MODEL);
                o.put("android", Build.VERSION.RELEASE + " (API " + Build.VERSION.SDK_INT + ")");
                Intent bat = registerReceiver(null, new IntentFilter(Intent.ACTION_BATTERY_CHANGED));
                if (bat != null) {
                    int lvl = bat.getIntExtra(BatteryManager.EXTRA_LEVEL, -1);
                    int sc = bat.getIntExtra(BatteryManager.EXTRA_SCALE, 100);
                    int st = bat.getIntExtra(BatteryManager.EXTRA_STATUS, -1);
                    int temp = bat.getIntExtra(BatteryManager.EXTRA_TEMPERATURE, 0);
                    o.put("battery_percent", lvl * 100 / Math.max(sc, 1));
                    o.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL);
                    o.put("battery_temp_c", temp / 10.0);
                }
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ram_total", human(mi.totalMem));
                o.put("ram_free", human(mi.availMem));
                StatFs fs = new StatFs(Environment.getDataDirectory().getPath());
                o.put("storage_total", human(fs.getTotalBytes()));
                o.put("storage_free", human(fs.getAvailableBytes()));
                o.put("time", new SimpleDateFormat("yyyy-MM-dd HH:mm EEEE", Locale.US).format(new Date()));
                return o.toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String storageSummary(String path, int top) {
            if (!storageAllowed()) return err("NO_PERMISSION");
            try {
                File base = resolve(path);
                Scan sc = new Scan();
                walk(base, null, sc, 0, root() + "/Android/data");
                trimBig(sc);
                if (top <= 0) top = 15;
                List<Map.Entry<String, Long>> fl = new ArrayList<Map.Entry<String, Long>>(sc.folders.entrySet());
                Collections.sort(fl, new Comparator<Map.Entry<String, Long>>() {
                    @Override
                    public int compare(Map.Entry<String, Long> a, Map.Entry<String, Long> b) {
                        return Long.compare(b.getValue(), a.getValue());
                    }
                });
                JSONObject o = new JSONObject();
                o.put("path", base.getAbsolutePath());
                o.put("files", sc.files);
                StatFs fs = new StatFs(base.getPath());
                o.put("disk_total", human(fs.getTotalBytes()));
                o.put("disk_free", human(fs.getAvailableBytes()));
                JSONArray fa = new JSONArray();
                for (int i = 0; i < Math.min(top, fl.size()); i++) {
                    fa.put(new JSONObject().put("name", fl.get(i).getKey()).put("size", human(fl.get(i).getValue())));
                }
                o.put("folders", fa);
                JSONArray ta = new JSONArray();
                for (Map.Entry<String, long[]> e : sc.types.entrySet()) {
                    ta.put(new JSONObject().put("type", e.getKey()).put("size", human(e.getValue()[0])).put("count", e.getValue()[1]));
                }
                o.put("types", ta);
                JSONArray ba = new JSONArray();
                SimpleDateFormat df = new SimpleDateFormat("yyyy-MM-dd", Locale.US);
                for (int i = 0; i < Math.min(top, sc.bigPath.size()); i++) {
                    ba.put(new JSONObject().put("path", sc.bigPath.get(i)).put("size", human(sc.bigIdx.get(i)[0]))
                            .put("modified", df.format(new Date(sc.bigIdx.get(i)[1]))));
                }
                o.put("largest_files", ba);
                return o.toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String listDir(String path) {
            if (!storageAllowed()) return err("NO_PERMISSION");
            try {
                File d = resolve(path);
                File[] list = d.listFiles();
                if (list == null) return err("Folder not found: " + d.getAbsolutePath());
                Arrays.sort(list);
                JSONArray a = new JSONArray();
                for (int i = 0; i < Math.min(list.length, 300); i++) {
                    File f = list[i];
                    a.put(new JSONObject().put("name", f.getName()).put("type", f.isDirectory() ? "folder" : "file")
                            .put("size", f.isDirectory() ? "" : human(f.length())));
                }
                return new JSONObject().put("path", d.getAbsolutePath()).put("count", list.length).put("items", a).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String readFile(String path, int max) {
            if (!storageAllowed()) return err("NO_PERMISSION");
            try {
                File f = resolve(path);
                if (max <= 0) max = 8000;
                String t = readAll(new FileInputStream(f));
                if (t.length() > max) t = t.substring(0, max) + "\n...[truncated]";
                return new JSONObject().put("path", f.getAbsolutePath()).put("content", t).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String writeFile(String path, String content) {
            try {
                if (path != null && (path.startsWith("Download/") || !path.contains("/"))) {
                    String name = path.contains("/") ? path.substring(path.lastIndexOf('/') + 1) : path;
                    String mime = name.endsWith(".html") ? "text/html" : name.endsWith(".md") ? "text/markdown"
                            : name.endsWith(".csv") ? "text/csv" : name.endsWith(".json") ? "application/json" : "text/plain";
                    return new JSONObject().put("ok", true).put("path", saveToDownloads(content.getBytes("UTF-8"), name, mime)).toString();
                }
                if (!storageAllowed()) return err("NO_PERMISSION");
                File f = resolve(path);
                File p = f.getParentFile();
                if (p != null) p.mkdirs();
                OutputStreamWriter w = new OutputStreamWriter(new FileOutputStream(f), "UTF-8");
                w.write(content);
                w.close();
                return new JSONObject().put("ok", true).put("path", f.getAbsolutePath()).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String moveToTrash(String path) {
            if (!storageAllowed()) return err("NO_PERMISSION");
            try {
                File f = resolve(path);
                if (!f.exists()) return err("Not found: " + f.getAbsolutePath());
                File trash = new File(root(), ".shathi_trash");
                trash.mkdirs();
                String rel = f.getAbsolutePath().substring(root().length()).replace("/", "__");
                File dest = new File(trash, System.currentTimeMillis() + rel);
                return f.renameTo(dest) ? ok() : err("Move failed");
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String emptyTrash() {
            File trash = new File(root(), ".shathi_trash");
            long[] freed = new long[]{0, 0};
            deleteRec(trash, freed);
            try {
                return new JSONObject().put("freed", human(freed[0])).put("files", freed[1]).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public void keepAwake(final boolean on) {
            ui.post(new Runnable() {
                @Override
                public void run() {
                    if (on) getWindow().addFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                    else getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
                }
            });
        }
    }
}
