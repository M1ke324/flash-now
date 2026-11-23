package io.github.m1ke324.studioquiz;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.content.res.Configuration;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Base64;
import android.view.View;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.window.OnBackInvokedDispatcher;

import androidx.core.content.FileProvider;
import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.Collections;

/**
 * L'app contiene il sito (cartella assets/www, copiata durante la build) e lo serve
 * da https://appassets.androidplatform.net, quindi funziona anche senza connessione.
 * I mazzi online del sito GitHub Pages vengono scaricati dal codice JavaScript solo se attivi.
 */
public class MainActivity extends Activity {

    private static final String HOST = "appassets.androidplatform.net";
    private static final String START = "https://" + HOST + "/assets/www/index.html";
    private static final int PICK_FILES = 1;
    private static final int SAVE_FILE = 2;

    private WebView web;
    private WebViewAssetLoader assets;
    private ValueCallback<Uri[]> fileCallback;
    private byte[] pendingSave;
    private JavaScriptReplyProxy pendingReply;
    private int pendingId;
    private File pendingInstall;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        assets = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        web = new WebView(this);
        web.setBackgroundColor(getColor(R.color.surface));
        // Il WebView ignora il proprio padding: i margini di sistema vanno applicati a un contenitore.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(getColor(R.color.surface));
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);

        // Da Android 15 l'app è sempre edge-to-edge: il contenuto non deve finire
        // sotto barra di stato, barra di navigazione e tastiera.
        if (Build.VERSION.SDK_INT >= 35) {
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                v.setPadding(bars.left, bars.top, bars.right, Math.max(bars.bottom, ime.bottom));
                return WindowInsets.CONSUMED;
            });
        }
        applySystemBarColors();

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true); // localStorage: mazzi locali, punteggi, impostazioni
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(true); // lettura dei file scelti per l'importazione

        web.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                return assets.shouldInterceptRequest(request.getUrl());
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (HOST.equals(uri.getHost())) return false;
                // Link esterni (es. creazione del token GitHub): apri nel browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, uri));
                } catch (ActivityNotFoundException ignored) {
                }
                return true;
            }
        });

        // <input type="file">: importazione dei mazzi .md
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null);
                fileCallback = callback;
                Intent i = new Intent(Intent.ACTION_GET_CONTENT);
                i.addCategory(Intent.CATEGORY_OPENABLE);
                i.setType("*/*"); // i file .md spesso non hanno un tipo MIME riconosciuto
                i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                try {
                    startActivityForResult(Intent.createChooser(i, null), PICK_FILES);
                    return true;
                } catch (ActivityNotFoundException e) {
                    fileCallback = null;
                    return false;
                }
            }
        });

        // Canale "FlashNowAndroid" (file, appunti, versione, aggiornamenti): solo il sito incluso nell'app può usarlo.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "FlashNowAndroid",
                    Collections.singleton("https://" + HOST),
                    (view, message, sourceOrigin, isMainFrame, reply) -> onWebMessage(message.getData(), reply));
        }

        if (Build.VERSION.SDK_INT >= 33) {
            getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
                    OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::goBackOrExit);
        }

        if (savedInstanceState != null) web.restoreState(savedInstanceState);
        else web.loadUrl(START);
    }

    // Messaggi dal JavaScript (ogni richiesta ha un "id", ripetuto nella risposta):
    //   {"type":"save","name","mime","data":"<base64>"} -> {"ok":true|false}
    //   {"type":"paste"}                                -> {"ok":true,"text":"..."}
    //   {"type":"version"}                              -> {"ok":true,"version":"1.6.0"}
    //   {"type":"update","url":"https://...apk"}        -> {"progress":0..100}..., poi {"ok":true|false}
    private void onWebMessage(String json, JavaScriptReplyProxy reply) {
        int id = 0;
        try {
            JSONObject m = new JSONObject(json);
            id = m.optInt("id");
            switch (m.optString("type")) {
                case "paste":
                    send(reply, clipboardReply().put("id", id));
                    break;
                case "version":
                    String v = getPackageManager().getPackageInfo(getPackageName(), 0).versionName;
                    send(reply, new JSONObject().put("id", id).put("ok", true).put("version", v));
                    break;
                case "save":
                    pendingSave = Base64.decode(m.getString("data"), Base64.DEFAULT);
                    pendingReply = reply;
                    pendingId = id;
                    Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
                    i.addCategory(Intent.CATEGORY_OPENABLE);
                    i.setType(m.optString("mime", "application/octet-stream"));
                    i.putExtra(Intent.EXTRA_TITLE, m.optString("name", "export"));
                    startActivityForResult(i, SAVE_FILE);
                    break;
                case "update":
                    downloadUpdate(m.getString("url"), reply, id);
                    break;
                default:
                    send(reply, new JSONObject().put("id", id).put("ok", false));
            }
        } catch (Exception e) {
            sendResult(reply, id, false, e.getMessage());
        }
    }

    private void send(JavaScriptReplyProxy reply, JSONObject msg) {
        runOnUiThread(() -> reply.postMessage(msg.toString()));
    }

    private void sendResult(JavaScriptReplyProxy reply, int id, boolean ok, String error) {
        try {
            JSONObject r = new JSONObject().put("id", id).put("ok", ok);
            if (error != null) r.put("error", error);
            send(reply, r);
        } catch (Exception ignored) {
        }
    }

    // ---------- aggiornamento dell'app ----------
    // Scarica l'APK della nuova versione nella cache e avvia l'installazione di Android.
    private void downloadUpdate(String url, JavaScriptReplyProxy reply, int id) {
        if (!url.startsWith("https://github.com/M1ke324/flash-now/releases/download/")) {
            sendResult(reply, id, false, "indirizzo non valido");
            return;
        }
        new Thread(() -> {
            File dir = new File(getCacheDir(), "updates");
            File apk = new File(dir, "FlashNow-update.apk");
            try {
                dir.mkdirs();
                HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
                c.setInstanceFollowRedirects(true);
                c.setConnectTimeout(15000);
                c.setReadTimeout(30000);
                if (c.getResponseCode() != 200) throw new Exception("HTTP " + c.getResponseCode());
                long total = c.getContentLengthLong();
                long done = 0;
                int last = -1;
                try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(apk)) {
                    byte[] buf = new byte[64 * 1024];
                    for (int n; (n = in.read(buf)) > 0; ) {
                        out.write(buf, 0, n);
                        done += n;
                        int pct = total > 0 ? (int) (done * 100 / total) : 0;
                        if (pct != last) {
                            last = pct;
                            send(reply, new JSONObject().put("id", id).put("progress", pct));
                        }
                    }
                }
                runOnUiThread(() -> {
                    boolean needPermission = !getPackageManager().canRequestPackageInstalls();
                    pendingInstall = apk;
                    if (needPermission) {
                        // Android chiede una volta di consentire a Flash Now di installare app.
                        startActivity(new Intent(android.provider.Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                                Uri.parse("package:" + getPackageName())));
                    } else {
                        installPending();
                    }
                    try {
                        send(reply, new JSONObject().put("id", id).put("ok", true).put("permission", needPermission));
                    } catch (Exception ignored) {
                    }
                });
            } catch (Exception e) {
                sendResult(reply, id, false, e.getMessage());
            }
        }).start();
    }

    private void installPending() {
        if (pendingInstall == null || !pendingInstall.exists()) return;
        Uri uri = FileProvider.getUriForFile(this, getPackageName() + ".files", pendingInstall);
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setDataAndType(uri, "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
        pendingInstall = null;
        startActivity(i);
    }

    @Override
    protected void onResume() {
        super.onResume();
        // Di ritorno dalle impostazioni: se il permesso ora c'è, si prosegue con l'installazione.
        if (pendingInstall != null && getPackageManager().canRequestPackageInstalls()) installPending();
    }

    private JSONObject clipboardReply() throws org.json.JSONException {
        JSONObject r = new JSONObject();
        ClipboardManager cm = getSystemService(ClipboardManager.class);
        ClipData clip = cm != null ? cm.getPrimaryClip() : null;
        if (clip == null || clip.getItemCount() == 0) {
            r.put("ok", true).put("text", "");
        } else {
            CharSequence text = clip.getItemAt(0).coerceToText(this);
            r.put("ok", true).put("text", text != null ? text.toString() : "");
        }
        return r;
    }

    @SuppressWarnings("deprecation")
    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == SAVE_FILE) {
            boolean ok = false;
            if (resultCode == RESULT_OK && data != null && data.getData() != null && pendingSave != null) {
                try (OutputStream out = getContentResolver().openOutputStream(data.getData(), "wt")) {
                    out.write(pendingSave);
                    ok = true;
                } catch (Exception ignored) {
                }
            }
            if (pendingReply != null) sendResult(pendingReply, pendingId, ok, null);
            pendingSave = null;
            pendingReply = null;
            return;
        }
        if (requestCode != PICK_FILES || fileCallback == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                result = new Uri[clip.getItemCount()];
                for (int i = 0; i < clip.getItemCount(); i++) result[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                result = new Uri[] { data.getData() };
            }
        }
        fileCallback.onReceiveValue(result);
        fileCallback = null;
    }

    private void goBackOrExit() {
        if (web.canGoBack()) web.goBack();
        else finish();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() { // Android < 13
        goBackOrExit();
    }

    @SuppressWarnings("deprecation")
    private void applySystemBarColors() {
        boolean night = (getResources().getConfiguration().uiMode & Configuration.UI_MODE_NIGHT_MASK)
                == Configuration.UI_MODE_NIGHT_YES;
        getWindow().getDecorView().setBackgroundColor(getColor(R.color.surface));
        if (Build.VERSION.SDK_INT >= 30) {
            WindowInsetsController c = getWindow().getInsetsController();
            if (c != null) {
                int light = WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS;
                c.setSystemBarsAppearance(night ? 0 : light, light);
            }
        } else if (!night) {
            getWindow().getDecorView().setSystemUiVisibility(
                    View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
        }
        if (Build.VERSION.SDK_INT < 35) {
            getWindow().setStatusBarColor(getColor(R.color.surface));
            getWindow().setNavigationBarColor(getColor(R.color.surface));
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }
}
