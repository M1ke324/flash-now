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

import androidx.webkit.JavaScriptReplyProxy;
import androidx.webkit.WebViewAssetLoader;
import androidx.webkit.WebViewCompat;
import androidx.webkit.WebViewFeature;

import org.json.JSONObject;

import java.io.OutputStream;
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

        // Canale "StudioAndroid" per l'esportazione: solo il sito incluso nell'app può usarlo.
        if (WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) {
            WebViewCompat.addWebMessageListener(web, "StudioAndroid",
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

    // Messaggi dal JavaScript:
    //   {"type":"save","name":"...","mime":"...","data":"<base64>"} -> {"ok":true|false}
    //   {"type":"paste"} -> {"ok":true,"text":"..."}
    private void onWebMessage(String json, JavaScriptReplyProxy reply) {
        try {
            JSONObject m = new JSONObject(json);
            if ("paste".equals(m.optString("type"))) {
                reply.postMessage(clipboardReply().toString());
                return;
            }
            if (!"save".equals(m.optString("type"))) return;
            pendingSave = Base64.decode(m.getString("data"), Base64.DEFAULT);
            pendingReply = reply;
            Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType(m.optString("mime", "application/octet-stream"));
            i.putExtra(Intent.EXTRA_TITLE, m.optString("name", "export"));
            startActivityForResult(i, SAVE_FILE);
        } catch (Exception e) {
            reply.postMessage("{\"ok\":false}");
        }
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
            if (pendingReply != null) pendingReply.postMessage(ok ? "{\"ok\":true}" : "{\"ok\":false}");
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
