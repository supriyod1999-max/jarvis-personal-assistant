package org.jarvisassistant.app;

import android.app.Activity;
import android.os.*;
import android.view.WindowManager;
import android.view.View;
import android.view.Gravity;
import android.graphics.Typeface;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.util.concurrent.*;

/** Native-only phone controls. No WebView bridge or Windows password handling. */
public final class ComputerActivity extends Activity {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final Handler main = new Handler(Looper.getMainLooper());
    private ApiClient api; private String origin, computerId = "", accountSid = "";
    private final ThreadLocal<ApiClient> operationClient = new ThreadLocal<>();
    private TextView state,detail,laptopName,pairStatus,pairCode,pairHelp,pairProgress;
    private LinearLayout pairingCard;
    private ProgressBar progress;private ConnectionScene scene;private boolean connected;
    private Button pair,lock,unlock,refresh;
    private CancellationSignal biometric; private volatile int generation; private boolean busy, visible, biometricActive;
    private interface Work { void run() throws Exception; }
    @Override public void onCreate(Bundle saved) {
        super.onCreate(saved); getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try { origin = EndpointPolicy.connection(getIntent().getStringExtra("origin")); } catch (Exception error) { finish(); return; }
        LinearLayout root=NativeStyle.surface(this);
        root.addView(NativeStyle.toolbar(this,"Laptop controls","Private phone approval",this::finish));
        String requested=getIntent().getStringExtra("requestedOperation");if("windows.lock".equals(requested)||"windows.unlock".equals(requested)){TextView requestedLabel=NativeStyle.text(this,"Requested: "+("windows.lock".equals(requested)?"Lock laptop":"Unlock laptop")+". Review the matching button below and approve on this phone.",14,NativeStyle.ACCENT);requestedLabel.setPadding(dp(24),dp(8),dp(24),dp(8));root.addView(requestedLabel);}
        ScrollView scroll=new ScrollView(this); scroll.setFillViewport(true); root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));
        LinearLayout body=NativeStyle.column(this); body.setPadding(dp(24),dp(16),dp(24),dp(28)); scroll.addView(body);scroll.setVerticalScrollBarEnabled(false);scene=new ConnectionScene(this,"Laptop");body.addView(scene,new LinearLayout.LayoutParams(-1,dp(116)));
        LinearLayout computer=NativeStyle.card(this); body.addView(computer);
        LinearLayout identity=new LinearLayout(this); identity.setGravity(Gravity.CENTER_VERTICAL);
        ImageView glyph=new ImageView(this); glyph.setImageDrawable(new NativeIcon("laptop",NativeStyle.ACCENT)); glyph.setPadding(dp(11),dp(11),dp(11),dp(11)); glyph.setBackground(NativeStyle.background(this,0xff1c302f,0,14));
        identity.addView(glyph,new LinearLayout.LayoutParams(dp(48),dp(48)));
        LinearLayout names=NativeStyle.column(this); names.setPadding(dp(14),0,dp(8),0); laptopName=NativeStyle.title(this,"Your laptop",20); names.addView(laptopName);
        state=NativeStyle.text(this,"Checking connection…",13,NativeStyle.MUTED); state.setPadding(0,dp(7),0,0); state.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); names.addView(state);
        identity.addView(names,new LinearLayout.LayoutParams(0,-2,1)); progress=new ProgressBar(this); progress.setIndeterminateTintList(android.content.res.ColorStateList.valueOf(NativeStyle.ACCENT)); identity.addView(progress,new LinearLayout.LayoutParams(dp(22),dp(22))); computer.addView(identity);
        NativeStyle.gap(computer,22); pairStatus=NativeStyle.text(this,"Private connection",12,NativeStyle.ACCENT); computer.addView(pairStatus);
        NativeStyle.gap(computer,10); detail=NativeStyle.text(this,"Connect Tailscale and unlock your primary JARVIS workspace first.",14,NativeStyle.MUTED); detail.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); computer.addView(detail);
        NativeStyle.gap(body,24); body.addView(NativeStyle.title(this,"Windows controls",16)); NativeStyle.gap(body,12);
        pair=NativeStyle.action(this,"Pair this phone","connection",true,this::pair); body.addView(pair,new LinearLayout.LayoutParams(-1,-2));
        pairingCard=NativeStyle.card(this); LinearLayout.LayoutParams reviewLayout=new LinearLayout.LayoutParams(-1,-2); reviewLayout.topMargin=dp(16); body.addView(pairingCard,reviewLayout); pairingCard.setVisibility(View.GONE);
        pairingCard.addView(NativeStyle.title(this,"Compare this code",16)); NativeStyle.gap(pairingCard,18);
        pairCode=NativeStyle.text(this,"",34,NativeStyle.ACCENT); pairCode.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); pairCode.setLetterSpacing(.16f); pairingCard.addView(pairCode);
        NativeStyle.gap(pairingCard,16); pairHelp=NativeStyle.text(this,"",13,NativeStyle.MUTED); pairingCard.addView(pairHelp); NativeStyle.gap(pairingCard,12);
        pairProgress=NativeStyle.text(this,"",13,NativeStyle.ACCENT); pairProgress.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE); pairingCard.addView(pairProgress);
        NativeStyle.gap(body,12); lock=NativeStyle.action(this,"Lock laptop","lock",true,()->control("windows.lock")); lock.setEnabled(false); body.addView(lock,new LinearLayout.LayoutParams(-1,-2));
        NativeStyle.gap(body,12); unlock=NativeStyle.action(this,"Unlock laptop","unlock",true,()->control("windows.unlock")); unlock.setEnabled(false); body.addView(unlock,new LinearLayout.LayoutParams(-1,-2));
        NativeStyle.gap(body,14); body.addView(NativeStyle.text(this,"Each action needs your fingerprint or another supported strong biometric. Unlock becomes available when Windows is waiting for phone approval.",13,NativeStyle.MUTED));
        NativeStyle.gap(body,20); Button help=NativeStyle.action(this,"How phone approval works","shield",false,()->new android.app.AlertDialog.Builder(this).setTitle("Your phone approves. Windows signs in.").setMessage("Pairing requires a matching code on your laptop. Every lock or unlock uses a fresh request and a strong biometric on this phone.\n\nYour Windows password stays in the native Windows-protected vault. It is never entered in this app or sent to AI. Your usual Windows PIN or password remains available.").setPositiveButton("Got it",null).show()); body.addView(help,new LinearLayout.LayoutParams(-1,-2));
        LinearLayout dock=NativeStyle.column(this); dock.setPadding(dp(24),dp(12),dp(24),dp(12)); dock.setBackgroundColor(NativeStyle.BACKGROUND);
        refresh=NativeStyle.action(this,"Check connection","refresh",false,()->request(this::load)); dock.addView(refresh,new LinearLayout.LayoutParams(-1,-2)); root.addView(dock); NativeStyle.reveal(body);
    }
    private int dp(float value) { return NativeStyle.dp(this,value); }
    private void showDetail(String value) { NativeStyle.status(detail,value,false); }
    private void showError(String value) { connected=false;scene.state(false,false);refresh.setVisibility(View.VISIBLE);NativeStyle.status(detail,value,true); }
    private void showPairing(JSONObject pending) {
        pairingCard.setVisibility(View.VISIBLE); pairCode.setText(pending.optString("code")); pair.setText("Start pairing again");
        String expiry=android.text.format.DateFormat.getTimeFormat(this).format(new java.util.Date(pending.optLong("expiresAtMs")));
        pairHelp.setText("On your laptop, open Settings → Devices → Laptop controls. Compare the code and select Pair this phone. This screen updates automatically.\n\nCode valid until "+expiry+".");
        pairProgress.setText("Waiting for your biometric approval…"); NativeStyle.reveal(pairingCard);
    }
    private void renderSnapshot(JSONObject snapshot,String target,String sid,boolean bound,boolean ready,boolean unlockReady) {
        connected=true;scene.state(true,false);refresh.setVisibility(View.GONE);computerId=target; accountSid=sid; laptopName.setText(snapshot.optString("computerName","Your laptop"));
        boolean unknown=snapshot.isNull("locked"); boolean locked=snapshot.optBoolean("locked",true);
        state.setText(unknown?"Windows status unavailable":locked?"Windows locked":"Windows unlocked"); state.setTextColor(unlockReady?NativeStyle.ACCENT:NativeStyle.MUTED);
        pairStatus.setText(bound?"Paired to this phone":"Phone pairing needed"); pairStatus.setTextColor(bound?NativeStyle.ACCENT:NativeStyle.WARNING);
        showDetail(ready?"Phone paired. Biometric lock is ready.":unlockReady?"Windows is ready. Approve Unlock laptop with your phone biometric.":bound?(unknown?"Could not check Windows. Check the connection before trying again.":locked?"No active Windows unlock request yet. This screen checks automatically.":"Windows is already unlocked. Unlock readiness is checked on the lock screen."):"Pair this phone, then approve the matching code in laptop Settings → Devices. This screen updates automatically.");
        pair.setVisibility(bound?View.GONE:View.VISIBLE); lock.setEnabled(ready); unlock.setEnabled(unlockReady);
        if(bound)pairingCard.setVisibility(View.GONE);
    }
    private void ui(int attempt, Runnable action) { main.post(() -> { if (visible && attempt == generation && !isFinishing()) action.run(); }); }
    private void request(Work work) {
        if (busy || !visible || biometricActive) return; busy = true; progress.setVisibility(View.VISIBLE); pair.setEnabled(false); lock.setEnabled(false); unlock.setEnabled(false); refresh.setEnabled(false); final int attempt = generation; final ApiClient selected = api;
        worker.execute(() -> { try { if (attempt != generation) return; operationClient.set(selected); work.run(); } catch (Exception error) { ui(attempt, () -> showError(error instanceof ApiClient.Failure ? error.getMessage() + " Check the connection before trying again; no action was resent." : "Connection could not be confirmed. Check Tailscale and try again; no action was resent.")); }
            finally { operationClient.remove(); ui(attempt, () -> { busy = false; progress.setVisibility(View.INVISIBLE); if (!biometricActive) { refresh.setEnabled(true); pair.setEnabled(true); } }); } });
    }
    private ApiClient client() { ApiClient selected = operationClient.get(); if (selected == null) throw new IllegalStateException(); return selected; }
    private void load() throws Exception {
        final int attempt = generation; JSONObject snapshot = client().json("/api/computer/status", null);
        String target = snapshot.getString("computerId"), sid = snapshot.optString("accountSid"), deviceId = WindowsApprovalSigner.existingDeviceId();
        String savedId = getPreferences(MODE_PRIVATE).getString(origin + ":computer", ""), savedSid = getPreferences(MODE_PRIVATE).getString(origin + ":sid", "");
        boolean paired = false; JSONArray devices = snapshot.getJSONArray("devices");
        for (int i = 0; i < devices.length(); i++) if (devices.getJSONObject(i).getString("id").equals(deviceId)) paired = true;
        final boolean bound = paired && target.equals(savedId) && sid.equals(savedSid);
        final boolean ready = bound && snapshot.optBoolean("lockReady") && !snapshot.optBoolean("locked", true), unlockReady = bound && snapshot.optBoolean("unlockReady");
        ui(attempt,()->renderSnapshot(snapshot,target,sid,bound,ready,unlockReady));
    }
    private WindowsApprovalSigner.Result result(int attempt, WorkSignature next) {
        return new WindowsApprovalSigner.Result() {
            public void approved(String signature) { if (visible && attempt == generation) { biometricActive = false; request(() -> next.run(signature)); } }
            public void failed(String message) { ui(attempt, () -> { biometricActive = false; showError(message); if(pairingCard.getVisibility()==View.VISIBLE)pairProgress.setText("Biometric approval was not completed. Start pairing again when ready."); refresh.setEnabled(true); pair.setEnabled(true); }); }
        };
    }
    private interface WorkSignature { void run(String signature) throws Exception; }
    private void pair() { request(() -> {
        final int attempt = generation; JSONObject snapshot = client().json("/api/computer/status", null);
        String target = snapshot.getString("computerId"), sid = snapshot.getString("accountSid");
        JSONObject pending = client().json("/api/computer/pair", new JSONObject().put("publicKey", WindowsApprovalSigner.publicKey()).put("name", (Build.MANUFACTURER + " " + Build.MODEL).substring(0, Math.min(60, (Build.MANUFACTURER + " " + Build.MODEL).length()))));
        if (!target.equals(pending.getString("computerId")) || !sid.equals(pending.getString("accountSid"))) throw new Exception();
        ui(attempt, () -> {
            biometricActive = true;
            showPairing(pending);
            biometric = WindowsApprovalSigner.approvePair(this, pending.optString("payload"), target, sid, result(attempt, signature -> {
                client().json("/api/computer/pair-proof", new JSONObject().put("pairId", pending.getString("pairId")).put("signature", signature));
                ui(attempt, () -> { getPreferences(MODE_PRIVATE).edit().putString(origin + ":computer", target).putString(origin + ":sid", sid).apply(); pairProgress.setText("Phone verified. Approve the matching code on your laptop, The status updates automatically."); });
            }));
        });
    }); }
    private void control(String operation) { request(() -> {
        final int attempt = generation; final String target = computerId, sid = accountSid;
        if (target.isEmpty() || sid.isEmpty()) throw new Exception();
        JSONObject challenge = client().json("/api/computer/challenge", new JSONObject().put("deviceId", WindowsApprovalSigner.deviceId()).put("operation", operation));
        ui(attempt, () -> { biometricActive = true; biometric = WindowsApprovalSigner.approve(this, challenge.optString("payload"), target, sid, result(attempt, signature -> {
            JSONObject receipt = client().json("/api/computer/approve", new JSONObject().put("requestId", challenge.getString("requestId")).put("signature", signature));
            ui(attempt, () -> { state.setText(operation.equals("windows.unlock") ? "Unlock approval delivered" : receipt.optBoolean("locked") ? "Laptop locked" : "Lock requested"); showDetail(receipt.optString("message")); });
        })); });
    }); }
    private final Runnable autoCheck=new Runnable(){public void run(){if(visible){if(!busy&&!biometricActive)request(()->load());main.postDelayed(this,4000);}}};
    @Override protected void onResume() { super.onResume(); if (origin == null) return; visible = true; busy = false; api = new ApiClient(origin, CookieManager.getInstance().getCookie(origin)); request(this::load);main.removeCallbacks(autoCheck);main.postDelayed(autoCheck,4000); }
    @Override protected void onPause() { visible = false;main.removeCallbacks(autoCheck); generation++; if (biometric != null) biometric.cancel(); biometricActive = false; if (api != null) api.close(); busy = false; super.onPause(); }
    @Override protected void onDestroy() { if (api != null) api.close(); worker.shutdownNow(); main.removeCallbacksAndMessages(null); super.onDestroy(); }
}
