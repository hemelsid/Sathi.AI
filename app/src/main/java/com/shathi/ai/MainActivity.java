package com.shathi.ai;

import android.Manifest;
import android.app.Activity;
import android.app.ActivityManager;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.StatFs;
import android.view.Window;
import android.speech.RecognizerIntent;
import android.speech.tts.TextToSpeech;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
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
import java.util.List;
import java.util.Locale;
import java.util.Map;

public class MainActivity extends Activity {

    private WebView web;
    private SharedPreferences prefs;
    private ValueCallback<Uri[]> fileCb;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private static final int REQ_FILE = 11, REQ_VOICE = 12;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        requestWindowFeature(Window.FEATURE_NO_TITLE);
        if (Build.VERSION.SDK_INT >= 21) {
            getWindow().setStatusBarColor(Color.parseColor("#1E1B4B"));
        }
        prefs = getSharedPreferences("shathi", Context.MODE_PRIVATE);

        web = new WebView(this);
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView v, ValueCallback<Uri[]> cb, FileChooserParams params) {
                if (fileCb != null) fileCb.onReceiveValue(null);
                fileCb = cb;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*");
                i.putExtra(Intent.EXTRA_MIME_TYPES, new String[]{"image/*", "application/pdf", "text/*",
                        "application/json", "text/csv"});
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                try {
                    startActivityForResult(Intent.createChooser(i, "ফাইল বেছে নিন"), REQ_FILE);
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
        } else if (req == REQ_VOICE) {
            String text = "";
            if (res == RESULT_OK && data != null) {
                ArrayList<String> r = data.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS);
                if (r != null && !r.isEmpty()) text = r.get(0);
            }
            web.evaluateJavascript("window.onVoice && window.onVoice(" + JSONObject.quote(text) + ")", null);
        }
    }

    @Override
    protected void onDestroy() {
        if (tts != null) tts.shutdown();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        if (web != null && web.canGoBack()) {
            web.goBack();
        } else {
            super.onBackPressed();
        }
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (web != null) {
            web.evaluateJavascript("window.onAppResume && window.onAppResume()", null);
        }
    }

    private void openExternal(String url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url)));
        } catch (Exception ignored) {
        }
    }

    // ---------- storage permission ----------
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

    private void askStorage() {
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (Build.VERSION.SDK_INT >= 30) {
                    try {
                        Intent i = new Intent("android.settings.MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
                                Uri.parse("package:" + getPackageName()));
                        startActivity(i);
                    } catch (Exception e) {
                        startActivity(new Intent("android.settings.MANAGE_ALL_FILES_ACCESS_PERMISSION"));
                    }
                } else if (Build.VERSION.SDK_INT >= 23) {
                    requestPermissions(new String[]{
                            Manifest.permission.READ_EXTERNAL_STORAGE,
                            Manifest.permission.WRITE_EXTERNAL_STORAGE}, 7);
                }
            }
        });
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

    private static String err(String msg) {
        try {
            return new JSONObject().put("error", msg).toString();
        } catch (Exception e) {
            return "{\"error\":\"" + msg + "\"}";
        }
    }

    // ---------- scanning ----------
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

    // ---------- JS bridge ----------
    public class Bridge {

        @JavascriptInterface
        public String getPref(String k) {
            return prefs.getString(k, "");
        }

        @JavascriptInterface
        public void setPref(String k, String v) {
            prefs.edit().putString(k, v).apply();
        }

        @JavascriptInterface
        public boolean hasStorage() {
            return storageAllowed();
        }

        @JavascriptInterface
        public void requestStorage() {
            askStorage();
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
            startActivity(Intent.createChooser(i, "শেয়ার করুন"));
        }

        @JavascriptInterface
        public void voice() {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Intent i = new Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM);
                    i.putExtra(RecognizerIntent.EXTRA_LANGUAGE, prefs.getString("voice_lang", "bn-BD"));
                    i.putExtra(RecognizerIntent.EXTRA_PROMPT, "বলুন…");
                    try {
                        startActivityForResult(i, REQ_VOICE);
                    } catch (Exception e) {
                        web.evaluateJavascript("window.onVoice && window.onVoice(null)", null);
                    }
                }
            });
        }

        @JavascriptInterface
        public void speak(final String text) {
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    if (tts == null) {
                        tts = new TextToSpeech(MainActivity.this, new TextToSpeech.OnInitListener() {
                            @Override
                            public void onInit(int status) {
                                ttsReady = status == TextToSpeech.SUCCESS;
                                if (ttsReady) {
                                    int r = tts.setLanguage(new Locale("bn", "BD"));
                                    if (r < 0) tts.setLanguage(new Locale("bn", "IN"));
                                    tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "s");
                                }
                            }
                        });
                    } else if (ttsReady) {
                        tts.speak(text, TextToSpeech.QUEUE_FLUSH, null, "s");
                    }
                }
            });
        }

        @JavascriptInterface
        public void stopSpeak() {
            if (tts != null) tts.stop();
        }

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
                    int health = bat.getIntExtra(BatteryManager.EXTRA_HEALTH, 0);
                    o.put("battery_percent", lvl * 100 / Math.max(sc, 1));
                    o.put("charging", st == BatteryManager.BATTERY_STATUS_CHARGING || st == BatteryManager.BATTERY_STATUS_FULL);
                    o.put("battery_temp_c", temp / 10.0);
                    o.put("battery_health", health == BatteryManager.BATTERY_HEALTH_GOOD ? "good" : String.valueOf(health));
                }
                ActivityManager am = (ActivityManager) getSystemService(Context.ACTIVITY_SERVICE);
                ActivityManager.MemoryInfo mi = new ActivityManager.MemoryInfo();
                am.getMemoryInfo(mi);
                o.put("ram_total", human(mi.totalMem));
                o.put("ram_free", human(mi.availMem));
                o.put("ram_low", mi.lowMemory);
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
            if (!storageAllowed()) return err("NO_PERMISSION: storage-er onumoti nei. User-ke settings theke 'All files access' dite bolo.");
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
                o.put("disk_used", human(fs.getTotalBytes() - fs.getAvailableBytes()));
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
                    ba.put(new JSONObject().put("path", sc.bigPath.get(i))
                            .put("size", human(sc.bigIdx.get(i)[0]))
                            .put("modified", df.format(new Date(sc.bigIdx.get(i)[1]))));
                }
                o.put("largest_files", ba);
                o.put("note", "Android/data (app-er nijer data) Android dekhte dey na.");
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
                if (list == null) return err("Folder pawa jayni ba khola jacche na: " + d.getAbsolutePath());
                Arrays.sort(list);
                JSONArray a = new JSONArray();
                for (int i = 0; i < Math.min(list.length, 300); i++) {
                    File f = list[i];
                    a.put(new JSONObject().put("name", f.getName())
                            .put("type", f.isDirectory() ? "folder" : "file")
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
                InputStream in = new FileInputStream(f);
                BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[4096];
                int n;
                while ((n = r.read(buf)) > 0 && sb.length() < max) sb.append(buf, 0, n);
                r.close();
                String t = sb.length() > max ? sb.substring(0, max) + "\n...[baki ongsho baad]" : sb.toString();
                return new JSONObject().put("path", f.getAbsolutePath()).put("content", t).toString();
            } catch (Exception e) {
                return err(e.toString());
            }
        }

        @JavascriptInterface
        public String writeFile(String path, String content) {
            if (!storageAllowed()) return err("NO_PERMISSION");
            try {
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
                if (!f.exists()) return err("File nei: " + f.getAbsolutePath());
                File trash = new File(root(), ".shathi_trash");
                trash.mkdirs();
                String rel = f.getAbsolutePath().substring(root().length()).replace("/", "__");
                File dest = new File(trash, System.currentTimeMillis() + rel);
                boolean ok = f.renameTo(dest);
                return ok ? new JSONObject().put("ok", true).put("trash_path", dest.getAbsolutePath()).toString()
                        : err("Sorano gelo na");
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

        private void deleteRec(File f, long[] acc) {
            File[] kids = f.listFiles();
            if (kids != null) for (File k : kids) deleteRec(k, acc);
            if (f.isFile()) {
                acc[0] += f.length();
                acc[1]++;
            }
            f.delete();
        }

        @JavascriptInterface
        public String fetchUrl(String url, int max) {
            HttpURLConnection c = null;
            try {
                if (max <= 0) max = 200000;
                c = (HttpURLConnection) new URL(url).openConnection();
                c.setConnectTimeout(15000);
                c.setReadTimeout(25000);
                c.setInstanceFollowRedirects(true);
                c.setRequestProperty("User-Agent", "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/124 Mobile Safari/537.36");
                c.setRequestProperty("Accept-Language", "bn,en;q=0.8");
                int code = c.getResponseCode();
                InputStream in = code >= 400 ? c.getErrorStream() : c.getInputStream();
                if (in == null) return err("HTTP " + code);
                BufferedReader r = new BufferedReader(new InputStreamReader(in, "UTF-8"));
                StringBuilder sb = new StringBuilder();
                char[] buf = new char[8192];
                int n;
                while ((n = r.read(buf)) > 0 && sb.length() < max) sb.append(buf, 0, n);
                r.close();
                return new JSONObject().put("status", code).put("html", sb.toString()).toString();
            } catch (Exception e) {
                return err(e.toString());
            } finally {
                if (c != null) c.disconnect();
            }
        }
    }
}
