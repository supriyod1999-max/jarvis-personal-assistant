package org.jarvisassistant.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.graphics.drawable.GradientDrawable;
import android.net.Uri;
import android.net.http.SslError;
import android.os.*;
import android.provider.Settings;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

public final class MainActivity extends Activity {
    private WebView web;
    private LinearLayout root;
    private TextView status;
    private Button wake;
    private LinearLayout connectionBanner;
    private TextView connectionMessage;
    private ProgressBar pageProgress;
    private Dialog menuDialog;
    private AlertDialog wakeDialog;
    private TextView wakeHealth;
    private String origin, shareText = "", shareTitle = "";
    private final Handler main = new Handler(Looper.getMainLooper());
    private ValueCallback<Uri[]> fileCallback;
    private PermissionRequest microphoneRequest;
    private boolean visible;
    private String connectionError = "";
    private boolean openingDevices;
    private final Runnable refresh = new Runnable() { public void run() {
        if (wake != null) {
            String label = VoiceService.running ? "Listening" : "Voice off";
            if (!label.contentEquals(wake.getText())) wake.setText(label);
            wake.setContentDescription(VoiceService.running ? "Stop background listening" : "Start background listening");
        }
        if (status != null) { NativeStyle.status(status, VoiceService.currentStatus, false); status.setVisibility(showVoiceStatus()?View.VISIBLE:View.GONE); }
        if(wakeHealth!=null && wakeDialog!=null && wakeDialog.isShowing())wakeHealth.setText(VoiceDiagnostics.report(MainActivity.this));
        renderConnection();
        if (visible) main.postDelayed(this, 1000);
    }};
    @Override public void onCreate(Bundle state) {
        super.onCreate(state); getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::back);
        acceptShare(getIntent());
        origin = getPreferences(MODE_PRIVATE).getString("origin", "");
        if (origin.isEmpty()) setup(); else { try { origin = EndpointPolicy.connection(origin); showApp(); } catch (Exception e) { setup(); } }
        nativeDestination(getIntent());
    }
    private int dp(float n) { return Math.round(n * getResources().getDisplayMetrics().density); }
    private boolean showVoiceStatus() { return VoiceService.running || !"Wake listening is off".equals(VoiceService.currentStatus); }
    private boolean nativeDestination(Intent intent){
        if(web==null||origin==null||intent==null)return false;
        if(intent.hasExtra("origin")&&!origin.equals(intent.getStringExtra("origin")))return false;
        String page=intent.getStringExtra("jarvisPage");
        if(page!=null&&java.util.Arrays.asList("command","files","devices","whatsapp","inbox","tasks","knowledge","projects","people","agent-town","settings/personal","settings/data","settings/assistant","settings/connections","settings/security","settings/profile","settings/devices").contains(page)){intent.removeExtra("jarvisPage");web.loadUrl(origin+"/#/"+page);return true;}
        if(intent.getBooleanExtra("openVoice",false)){intent.removeExtra("openVoice");explainWake();return true;}return false;
    }
    private LinearLayout surface() { return NativeStyle.surface(this); }
    private TextView text(String value,int size,int color) { return NativeStyle.text(this,value,size,color); }
    private Button button(String title,Runnable action) { return NativeStyle.action(this,title,null,title.equals("Connect to JARVIS"),action); }
    private void setup() {
        stopVoice(); destroyWeb(); root=surface(); wake=null; status=null; connectionBanner=null; pageProgress=null;
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); scroll.setClipToPadding(false); root.addView(scroll,new LinearLayout.LayoutParams(-1,-1));
        LinearLayout alignment=NativeStyle.column(this); alignment.setGravity(Gravity.CENTER_HORIZONTAL); alignment.setPadding(dp(24),dp(28),dp(24),dp(32)); scroll.addView(alignment);
        LinearLayout body=NativeStyle.column(this); alignment.addView(body,new LinearLayout.LayoutParams(Math.min(getResources().getDisplayMetrics().widthPixels-dp(48),dp(520)),-2));
        TextView brand=NativeStyle.title(this,"JARVIS",16); brand.setLetterSpacing(.08f); brand.setTextColor(NativeStyle.ACCENT); body.addView(brand);
        OrbView orb=new OrbView(this); body.addView(orb,new LinearLayout.LayoutParams(-1,dp(144)));
        body.addView(NativeStyle.title(this,"Your JARVIS.\nOn every device.",32));
        NativeStyle.gap(body,12); body.addView(text("Connect to the private workspace on your laptop.",16,NativeStyle.MUTED)); NativeStyle.gap(body,28);
        LinearLayout connection=NativeStyle.card(this); body.addView(connection);
        TextView addressLabel=NativeStyle.title(this,"Private laptop address",14); addressLabel.setLabelFor(View.generateViewId()); connection.addView(addressLabel); NativeStyle.gap(connection,12);
        EditText address=new EditText(this); address.setId(addressLabel.getLabelFor()); address.setContentDescription("Your private JARVIS address");
        address.setText(origin==null || origin.isEmpty()?EndpointPolicy.DEFAULT:origin); NativeStyle.input(this,address); address.setSingleLine(false); address.setMaxLines(3);
        address.setInputType(android.text.InputType.TYPE_CLASS_TEXT|android.text.InputType.TYPE_TEXT_VARIATION_URI); address.setImeOptions(android.view.inputmethod.EditorInfo.IME_ACTION_GO); connection.addView(address,new LinearLayout.LayoutParams(-1,-2));
        NativeStyle.gap(connection,16);
        Runnable connect=()-> { try { origin=EndpointPolicy.connection(address.getText().toString()); getPreferences(MODE_PRIVATE).edit().putString("origin",origin).apply(); showApp(); } catch(Exception e) { address.setError(e.getMessage()); } };
        connection.addView(NativeStyle.action(this,"Connect to JARVIS","connection",true,connect),new LinearLayout.LayoutParams(-1,-2));
        address.setOnEditorActionListener((view,action,event)-> { if(action==android.view.inputmethod.EditorInfo.IME_ACTION_GO) { connect.run(); return true; } return false; });
        NativeStyle.gap(body,12); body.addView(NativeStyle.action(this,"Open Tailscale","connection",false,this::tailscale),new LinearLayout.LayoutParams(-1,-2));
        NativeStyle.gap(body,24); body.addView(NativeStyle.title(this,"Before you connect",14)); NativeStyle.gap(body,8);
        body.addView(text("Keep your laptop awake with JARVIS running. Connect this phone to Tailscale using the identity allowed for your workspace.",13,NativeStyle.MUTED));
        NativeStyle.gap(body,20); TextView privacy=text("Voice starts when you choose. You control background and lock-screen listening in App controls.",12,NativeStyle.MUTED); body.addView(privacy); NativeStyle.reveal(body);
    }
    private void renderConnection() {
        if(connectionBanner==null) return;
        connectionBanner.setVisibility(connectionError.isEmpty()?View.GONE:View.VISIBLE);
        if(connectionMessage!=null) NativeStyle.status(connectionMessage,connectionError,true);
    }
    @SuppressWarnings("SetJavaScriptEnabled")
    private void showApp() {
        destroyWeb(); root=surface();
        LinearLayout bar=new LinearLayout(this); bar.setPadding(dp(20),dp(4),dp(8),dp(4)); bar.setGravity(Gravity.CENTER_VERTICAL);
        LinearLayout identity=NativeStyle.column(this); TextView brand=NativeStyle.title(this,"JARVIS",17); brand.setLetterSpacing(.08f); identity.addView(brand);
        TextView companion=text("Your companion",11,NativeStyle.MUTED); companion.setPadding(0,dp(4),0,0); identity.addView(companion); bar.addView(identity,new LinearLayout.LayoutParams(0,-2,1));
        wake=NativeStyle.action(this,VoiceService.running?"Listening":"Voice off","mic",false,()-> { if(VoiceService.running)stopVoice(); else if(getPreferences(MODE_PRIVATE).getBoolean("voiceConsentV2",false))prepareWake(); else explainWake(); });
        wake.setTextSize(12); wake.setMinHeight(dp(48)); wake.setMinimumHeight(dp(48)); wake.setPadding(dp(12),dp(10),dp(12),dp(10)); bar.addView(wake,new LinearLayout.LayoutParams(-2,-2));
        bar.addView(NativeStyle.iconButton(this,"more","Connection and app settings",this::options),new LinearLayout.LayoutParams(dp(48),dp(48))); root.addView(bar);
        status=text(VoiceService.currentStatus,12,NativeStyle.MUTED); status.setMaxLines(2); status.setPadding(dp(20),0,dp(20),dp(12)); status.setVisibility(showVoiceStatus()?View.VISIBLE:View.GONE); root.addView(status);
        connectionBanner=NativeStyle.column(this); connectionBanner.setPadding(dp(20),dp(16),dp(20),dp(16)); connectionBanner.setBackgroundColor(0xff30232a);
        connectionMessage=text("",13,NativeStyle.ERROR); connectionMessage.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); connectionBanner.addView(connectionMessage);
        NativeStyle.gap(connectionBanner,12); connectionBanner.addView(NativeStyle.action(this,"Retry connection","refresh",false,()-> { if(openingDevices)openDevices();else if(web!=null)web.reload(); }),new LinearLayout.LayoutParams(-1,-2)); root.addView(connectionBanner); renderConnection();
        pageProgress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal); pageProgress.setProgressTintList(android.content.res.ColorStateList.valueOf(NativeStyle.ACCENT));
        pageProgress.setProgressBackgroundTintList(android.content.res.ColorStateList.valueOf(NativeStyle.BACKGROUND)); root.addView(pageProgress,new LinearLayout.LayoutParams(-1,dp(2)));
        web=new WebView(this); web.setBackgroundColor(NativeStyle.BACKGROUND); root.addView(web,new LinearLayout.LayoutParams(-1,0,1));
        WebSettings s = web.getSettings(); s.setJavaScriptEnabled(true); s.setDomStorageEnabled(true); s.setAllowFileAccess(false); s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString()+" JARVISNativeTransfers/1");
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW); s.setMediaPlaybackRequiresUserGesture(false); s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setSupportMultipleWindows(false); s.setSafeBrowsingEnabled(true); s.setGeolocationEnabled(false);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        web.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, android.graphics.Bitmap icon) {
                if (!EndpointPolicy.allowed(url, origin)) { view.stopLoading(); stopVoice(); return; }
                if (!EndpointPolicy.sameOrigin(url, origin)) { stopVoice(); origin = EndpointPolicy.origin(url); getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply(); }
                connectionError = ""; renderConnection();
            }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                if(request.isForMainFrame()&&request.hasGesture()&&EndpointPolicy.sameOrigin(url,origin)){
                    String path=request.getUrl().getPath(),action=null;
                    if("/native/transfers".equals(path))action="transfers.list";
                    else if("/native/updates".equals(path)){startActivity(new Intent(MainActivity.this,AppUpdatesActivity.class));return true;}
                    else if("/native/coding".equals(path))action="coding.list";
                    else if("/native/pet".equals(path))action="pet.open";
                    else if("/native/watch".equals(path))action="watch.open";
                    else if("/native/voice".equals(path)){explainWake();return true;}
                    else if("/native/workspace".equals(path)){web.loadUrl(origin+"/#/command");return true;}
                    else if("/native/computer".equals(path)){String op=request.getUrl().getQueryParameter("operation");action="windows.lock".equals(op)?"computer.lock":"windows.unlock".equals(op)?"computer.unlock":"computer.status";}
                    else if("/native/control".equals(path)){String media=request.getUrl().getQueryParameter("media");if(WatchWire.media(media))action="media."+media;}
                    if(action!=null){stopVoice();startActivity(NativeActions.intent(MainActivity.this,origin,action));return true;}
                }
                if(request.isForMainFrame()&&request.hasGesture()&&EndpointPolicy.sameOrigin(url,origin)&&"/native/control".equals(request.getUrl().getPath())){
                    startActivity(new Intent(MainActivity.this,RemoteActivity.class).putExtra("origin",origin));return true;
                }
                if(request.isForMainFrame()&&request.hasGesture()&&EndpointPolicy.sameOrigin(url,origin)&&"/native/files/upload".equals(request.getUrl().getPath())){
                    startActivity(new Intent(MainActivity.this,TransfersActivity.class).putExtra("origin",origin).putExtra("upload",url));return true;
                }
                if (EndpointPolicy.allowed(url, origin)) {
                    if (!EndpointPolicy.sameOrigin(url, origin)) { stopVoice(); origin = EndpointPolicy.origin(url); getPreferences(MODE_PRIVATE).edit().putString("origin", origin).apply(); }
                    return false;
                }
                if (request.isForMainFrame() && request.hasGesture() && "https".equalsIgnoreCase(request.getUrl().getScheme())) external(request.getUrl());
                return true;
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                if (EndpointPolicy.sameOrigin(request.getUrl().toString(), origin) && "/api/lock/lock".equals(request.getUrl().getPath())) main.post(MainActivity.this::stopVoice);
                return null;
            }
            @Override public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) { handler.cancel(); stopVoice(); connectionError = "The secure connection could not be verified. Check your Tailscale address."; renderConnection(); }
            @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame()) { stopVoice(); connectionError = "Cannot reach JARVIS. Check Tailscale and make sure your laptop is awake, then retry."; renderConnection(); }
            }
            @Override public void onPageFinished(WebView view, String url) { CookieManager.getInstance().flush();if(openingDevices&&EndpointPolicy.sameOrigin(url,origin)&&"/devices".equals(Uri.parse(url).getFragment()))checkDevices(view); }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override public void onProgressChanged(WebView view,int progress) { if(pageProgress!=null) { pageProgress.setProgress(progress); pageProgress.setVisibility(progress<100?View.VISIBLE:View.INVISIBLE); } }
            @Override public void onPermissionRequest(PermissionRequest request) {
                main.post(() -> {
                    if (!visible || !EndpointPolicy.sameOrigin(request.getOrigin().toString(), origin)) { request.deny(); return; }
                    boolean audio = false; for (String resource : request.getResources()) if (PermissionRequest.RESOURCE_AUDIO_CAPTURE.equals(resource)) audio = true;
                    if (!audio) { request.deny(); return; }
                    if (microphoneRequest != null) microphoneRequest.deny(); microphoneRequest = request;
                    if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) == PackageManager.PERMISSION_GRANTED) grantWebMicrophone();
                    else requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 32);
                });
            }
            @Override public void onPermissionRequestCanceled(PermissionRequest request) { if (microphoneRequest == request) microphoneRequest = null; }
            @Override public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (fileCallback != null) fileCallback.onReceiveValue(null); fileCallback = callback;
                Intent pick = new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*");
                try { startActivityForResult(pick, 41); } catch (ActivityNotFoundException e) { fileCallback.onReceiveValue(null); fileCallback = null; } return true;
            }
        });
        web.setDownloadListener((url,agent,disposition,mime,length)->{
            if(EndpointPolicy.sameOrigin(url,origin) && "/api/files/download".equals(Uri.parse(url).getPath()))startActivity(new Intent(this,DownloadActivity.class).putExtra("origin",origin).putExtra("url",url));
        });
        loadHome();
    }
    private void grantWebMicrophone() {
        stopService(new Intent(this, VoiceService.class));
        main.postDelayed(() -> { if (microphoneRequest != null) { if (visible) microphoneRequest.grant(new String[]{PermissionRequest.RESOURCE_AUDIO_CAPTURE}); else microphoneRequest.deny(); microphoneRequest = null; } }, 250);
    }
    private void explainWake() {
        if(wakeDialog!=null && wakeDialog.isShowing())return;
        ScrollView scroll=new ScrollView(this); LinearLayout body=NativeStyle.column(this); body.setPadding(dp(24),dp(16),dp(24),dp(12)); scroll.addView(body);
        body.addView(text("Say “Hey JARVIS”, “Hello JARVIS” or “Wake up JARVIS” over other apps. An on-device keyword detector checks wake phrases without sending idle speech to your laptop. After waking, questions go privately to Whisper and your signed-in model on the laptop. Keep the laptop and Tailscale available for replies.",14,NativeStyle.MUTED));
        NativeStyle.gap(body,16); CheckBox keep=new CheckBox(this); keep.setText("Keep listening on the lock screen and after closing the app"); keep.setTextColor(NativeStyle.TEXT); keep.setButtonTintList(android.content.res.ColorStateList.valueOf(NativeStyle.ACCENT)); keep.setChecked(getPreferences(MODE_PRIVATE).getBoolean("keepListening",false)); body.addView(keep);
        NativeStyle.gap(body,12); body.addView(text("While locked, JARVIS can acknowledge you with a centred orb. Select JARVIS as Android’s digital assistant below to enable that system window. General voice conversation can continue while locked. Personal records and action reviews stay in the app. Android’s notification shade stays above the camera island.",13,NativeStyle.MUTED));
        NativeStyle.gap(body,12); body.addView(NativeStyle.action(this,JarvisAssistant.selected(this)?"JARVIS is your Android assistant":"Choose JARVIS as Android assistant","mic",false,this::chooseAssistant));
        NativeStyle.gap(body,12); body.addView(text("This uses more battery and keeps a microphone notification visible. Stop from that notification or say “Hey JARVIS, stop listening”. Android Force stop, reboot, permission loss or a lost connection ends listening; open JARVIS to start again. It never restarts the microphone by itself.",13,NativeStyle.MUTED));
        NativeStyle.gap(body,12); body.addView(NativeStyle.action(this,"Android battery settings","laptop",false,this::batterySettings));
        NativeStyle.gap(body,20); body.addView(NativeStyle.title(this,"Wake status",16)); NativeStyle.gap(body,10);
        wakeHealth=text(VoiceDiagnostics.report(this),12,NativeStyle.MUTED); body.addView(wakeHealth);
        NativeStyle.gap(body,12); body.addView(NativeStyle.action(this,"Copy wake status","connection",false,()-> {
            getSystemService(android.content.ClipboardManager.class).setPrimaryClip(ClipData.newPlainText("JARVIS wake status",VoiceDiagnostics.report(this)));
            Toast.makeText(this,"Wake status copied. No audio or conversation content is included.",Toast.LENGTH_SHORT).show();
        }));
        wakeDialog=new AlertDialog.Builder(this).setTitle("Background voice").setView(scroll)
            .setPositiveButton(VoiceService.running?"Apply and restart":"Start listening", (d, w) -> { stopVoice(); getPreferences(MODE_PRIVATE).edit().putBoolean("keepListening",keep.isChecked()).putBoolean("voiceConsentV2",true).apply(); prepareWake(); }).setNegativeButton("Cancel", null).show();
        wakeDialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        wakeDialog.getWindow().setBackgroundDrawable(NativeStyle.background(this,NativeStyle.SURFACE,NativeStyle.LINE,22));
        NativeStyle.button(this,wakeDialog.getButton(AlertDialog.BUTTON_POSITIVE),true);
        NativeStyle.button(this,wakeDialog.getButton(AlertDialog.BUTTON_NEGATIVE),false);
    }
    private void batterySettings() {
        try { startActivity(new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,Uri.parse("package:"+getPackageName()))); }
        catch(ActivityNotFoundException error) { Toast.makeText(this,"Open Android Settings → Apps → JARVIS → Battery. Choose Unrestricted if Android keeps stopping listening.",Toast.LENGTH_LONG).show(); }
    }
    private void chooseAssistant(){
        if(Build.VERSION.SDK_INT<31){Toast.makeText(this,"The lock-screen assistant window needs Android 12 or newer. Background voice remains available.",Toast.LENGTH_LONG).show();return;}
        try{startActivity(new Intent(Settings.ACTION_VOICE_INPUT_SETTINGS));}
        catch(ActivityNotFoundException e){startActivity(new Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS));}
    }
    private void prepareWake() {
        if (!Settings.canDrawOverlays(this)) {
            new AlertDialog.Builder(this).setTitle("Allow the floating orb").setMessage("Enable “Display over other apps” for JARVIS, return here, then tap Start listening.")
                .setPositiveButton("Open settings", (d, w) -> startActivity(new Intent(Settings.ACTION_MANAGE_OVERLAY_PERMISSION, Uri.parse("package:" + getPackageName())))).setNegativeButton("Cancel", null).show(); return;
        }
        if (checkSelfPermission(Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO}, 31); return; }
        if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) { requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS}, 33); return; }
        startWake();
    }
    private void startWake() {
        if (!visible || web == null || !EndpointPolicy.sameOrigin(web.getUrl(), origin)) return;
        // A fixed, one-way lifecycle event. No native administration or credentials in JavaScript.
        web.evaluateJavascript("window.dispatchEvent(new Event('jarvis:native-voice-start'));", ignored -> main.postDelayed(() -> {
            if (!visible) return;
            Intent service = new Intent(this, VoiceService.class).putExtra("origin", origin).putExtra("cookie", CookieManager.getInstance().getCookie(origin)).putExtra("keepListening",getPreferences(MODE_PRIVATE).getBoolean("keepListening",false));
            try { startForegroundService(service); } catch (Exception e) { status.setText("Listening could not start. Open JARVIS and check microphone permission."); }
        }, 300));
    }
    private void stopVoice() { stopService(new Intent(this, VoiceService.class)); VoiceService.currentStatus = "Wake listening is off"; }
    private void options() {
        if(menuDialog!=null && menuDialog.isShowing())return;
        menuDialog=new Dialog(this); menuDialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(false); scroll.setVerticalScrollBarEnabled(false);
        LinearLayout sheet=NativeStyle.column(this); sheet.setPadding(dp(14),dp(12),dp(14),dp(24)); sheet.setBackground(NativeStyle.background(this,NativeStyle.SURFACE,0,28)); scroll.addView(sheet);
        View handle=new View(this); handle.setBackground(NativeStyle.background(this,NativeStyle.LINE,0,3)); LinearLayout.LayoutParams handleSize=new LinearLayout.LayoutParams(dp(36),dp(4)); handleSize.gravity=Gravity.CENTER_HORIZONTAL; handleSize.bottomMargin=dp(16); sheet.addView(handle,handleSize);
        LinearLayout heading=new LinearLayout(this); heading.setPadding(dp(12),0,0,0); heading.setGravity(Gravity.CENTER_VERTICAL);
        heading.addView(NativeStyle.title(this,"App controls",24),new LinearLayout.LayoutParams(0,-2,1));
        heading.addView(NativeStyle.iconButton(this,"close","Close app controls",()->menuDialog.dismiss()),new LinearLayout.LayoutParams(dp(48),dp(48))); sheet.addView(heading);
        NativeStyle.menuSection(sheet,"Your network");
        sheet.addView(NativeStyle.menuRow(this,"laptop","My devices & files","Connected devices and their files",()-> { menuDialog.dismiss(); openDevices(); }));
        sheet.addView(NativeStyle.menuRow(this,"laptop","Transfers","Background uploads, downloads and saved progress",()-> { menuDialog.dismiss();startActivity(new Intent(this,TransfersActivity.class)); }));
        sheet.addView(NativeStyle.menuRow(this,"laptop","Laptop controls","Pair your phone, lock or unlock Windows",()-> { menuDialog.dismiss(); stopVoice(); startActivity(new Intent(this,ComputerActivity.class).putExtra("origin",origin)); }));
        sheet.addView(NativeStyle.menuRow(this,"laptop","Laptop remote","Touchpad, keyboard, media and volume",()-> { menuDialog.dismiss();startActivity(new Intent(this,RemoteActivity.class).putExtra("origin",origin)); }));
        sheet.addView(NativeStyle.menuRow(this,"laptop","Coding sessions","Codex progress, questions and saved replies",()-> { menuDialog.dismiss(); startActivity(new Intent(this,CodingActivity.class).putExtra("origin",origin)); }));
        sheet.addView(NativeStyle.menuRow(this,"code","Agent Town","Explore your coding agents and their work",()-> { menuDialog.dismiss(); nativeDestination(new Intent().putExtra("jarvisPage","agent-town").putExtra("origin",origin)); }));
        NativeStyle.menuSection(sheet,"Your companions");
        sheet.addView(NativeStyle.menuRow(this,"mic","Background voice","Wake phrases and the camera island",()-> { menuDialog.dismiss(); explainWake(); }));
        sheet.addView(NativeStyle.menuRow(this,"pet","JARVIS pet","Animated companion for cover, full screen and tabletop",()-> { menuDialog.dismiss(); startActivity(new Intent(this,PetModeActivity.class).putExtra("origin",origin)); }));
        sheet.addView(NativeStyle.menuRow(this,"connection","Galaxy Watch","Link your watch, voice and media controls",()-> { menuDialog.dismiss(); startActivity(new Intent(this,WatchConnectionsActivity.class).putExtra("origin",origin)); }));
        NativeStyle.menuSection(sheet,"Connection & app");
        sheet.addView(NativeStyle.menuRow(this,"refresh","App updates","Phone and watch releases",()-> { menuDialog.dismiss();startActivity(new Intent(this,AppUpdatesActivity.class)); }));
        sheet.addView(NativeStyle.menuRow(this,"refresh","Retry connection","Reload your workspace without clearing its data",()-> { menuDialog.dismiss(); if(web!=null)web.reload(); }));
        sheet.addView(NativeStyle.menuRow(this,"connection","Open Tailscale","Check your private connection",()-> { menuDialog.dismiss(); tailscale(); }));
        sheet.addView(NativeStyle.menuRow(this,"laptop","Change laptop address","Connect to another approved workspace address",()-> { menuDialog.dismiss(); setup(); }));
        NativeStyle.gap(sheet,16); TextView note=text("JARVIS for Android · "+BuildConfig.VERSION_NAME+"\nPrivate connection to your laptop",12,NativeStyle.MUTED); note.setPadding(dp(12),0,dp(12),0); sheet.addView(note);
        menuDialog.setContentView(scroll); menuDialog.setCanceledOnTouchOutside(true); menuDialog.show();
        Window window=menuDialog.getWindow(); window.setBackgroundDrawable(new android.graphics.drawable.ColorDrawable(Color.TRANSPARENT)); window.setGravity(Gravity.BOTTOM|Gravity.CENTER_HORIZONTAL); int width=Math.min(getResources().getDisplayMetrics().widthPixels,dp(600)); window.setLayout(width,-2);
        sheet.setOnApplyWindowInsetsListener((view,insets)->{if(Build.VERSION.SDK_INT>=30){android.graphics.Insets safe=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout());view.setPadding(dp(14)+safe.left,dp(12),dp(14)+safe.right,dp(24)+safe.bottom);}return insets;});sheet.requestApplyInsets();
        scroll.post(()-> { if(menuDialog!=null && menuDialog.isShowing()) { int max=Math.round(getResources().getDisplayMetrics().heightPixels*.88f); if(scroll.getHeight()>max)window.setLayout(width,max); } }); NativeStyle.reveal(sheet);
    }
    private void tailscale() {
        Intent intent = getPackageManager().getLaunchIntentForPackage("com.tailscale.ipn");
        if (intent != null) startActivity(intent); else external(Uri.parse("https://tailscale.com/download/android"));
    }
    private void openDevices(){
        openingDevices=true;
        if(web==null||!EndpointPolicy.sameOrigin(web.getUrl(),origin)){connectionError="Open your JARVIS workspace before viewing devices.";renderConnection();return;}
        connectionError="";renderConnection();Toast.makeText(this,"Opening your devices…",Toast.LENGTH_SHORT).show();
        WebView selected=web;try{selected.evaluateJavascript(WorkspaceNavigation.devices(this),null);}catch(java.io.IOException error){connectionError="Device navigation could not load. Reopen JARVIS and try again.";renderConnection();return;}
        main.postDelayed(()->{if(openingDevices&&web==selected)checkDevices(selected);},18000);
    }
    private void checkDevices(WebView selected){selected.evaluateJavascript("Boolean(window.__jarvisFeatures&&window.__jarvisFeatures.devices===1&&window.__jarvisFeatures.cameraCheckins===1)",result->{if(web!=selected||!openingDevices)return;if("true".equals(result)){openingDevices=false;connectionError="";}else connectionError="The latest Devices screen has not loaded. Check Tailscale, then tap Retry connection. Your saved data and pairing are unchanged.";renderConnection();});}
    private void external(Uri uri) { try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (ActivityNotFoundException e) { Toast.makeText(this, "No browser is available.", Toast.LENGTH_SHORT).show(); } }
    private void acceptShare(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction()) && "text/plain".equals(intent.getType())) {
            CharSequence value = intent.getCharSequenceExtra(Intent.EXTRA_TEXT); String title = intent.getStringExtra(Intent.EXTRA_SUBJECT);
            shareText = value == null ? "" : value.toString().substring(0, Math.min(value.length(), 12000)); shareTitle = title == null ? "" : title.substring(0, Math.min(title.length(), 200));
        }
    }
    private void loadHome() {
        String url = origin + "/";
        if (!shareText.isEmpty()) { stopVoice(); url += "?shareText=" + Uri.encode(shareText) + "&shareTitle=" + Uri.encode(shareTitle); url += "#/inbox"; shareText = ""; shareTitle = ""; }
        else url += voiceRoute();
        web.loadUrl(url);
    }
    private String voiceRoute() { return VoiceService.lastConversation != null && origin.equals(VoiceService.lastOrigin) ? "?conversation=" + VoiceService.lastConversation + "#/command" : "#/command"; }
    @Override protected void onNewIntent(Intent intent) { super.onNewIntent(intent); setIntent(intent); acceptShare(intent); if(nativeDestination(intent))return; if (web != null && (!shareText.isEmpty() || VoiceService.lastConversation != null && origin.equals(VoiceService.lastOrigin))) loadHome(); }
    @Override public void onRequestPermissionsResult(int request, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(request, permissions, results);
        boolean granted = results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED;
        if (request == 32) { if (granted) grantWebMicrophone(); else if (microphoneRequest != null) { microphoneRequest.deny(); microphoneRequest = null; } }
        if (request == 31 && granted) prepareWake();
        if (request == 33 && granted) startWake();
        if (!granted && request != 32) Toast.makeText(this, "Permission is needed for background voice. You can still use JARVIS on screen.", Toast.LENGTH_LONG).show();
    }
    @Override protected void onActivityResult(int request, int result, Intent data) {
        super.onActivityResult(request, result, data);
        if (request == 41 && fileCallback != null) { fileCallback.onReceiveValue(result == RESULT_OK && data != null && data.getData() != null ? new Uri[]{data.getData()} : null); fileCallback = null; }
    }
    @Override protected void onResume() { super.onResume(); WatchConnectionRestore.restore(this);visible = true; if (web != null) web.onResume(); main.removeCallbacks(refresh); refresh.run(); }
    @Override protected void onPause() {
        visible = false; main.removeCallbacks(refresh);
        if (web != null) { web.evaluateJavascript("window.dispatchEvent(new Event('jarvis:native-voice-start'));", null); web.onPause(); }
        super.onPause();
    }
    private void back() { if (web != null && web.canGoBack()) web.goBack(); else moveTaskToBack(true); }
    // API 33+ uses the native predictive-back callback registered above; this is the older-device path.
    @android.annotation.SuppressLint("GestureBackNavigation")
    @Override public void onBackPressed() { back(); }
    private void destroyWeb() { if (web != null) { web.stopLoading(); web.destroy(); web = null; } }
    @Override protected void onDestroy() { if(wakeDialog!=null)wakeDialog.dismiss(); if(menuDialog!=null)menuDialog.dismiss(); main.removeCallbacksAndMessages(null); if (fileCallback != null) fileCallback.onReceiveValue(null); if (microphoneRequest != null) microphoneRequest.deny(); destroyWeb(); super.onDestroy(); }
}
