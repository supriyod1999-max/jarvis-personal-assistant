package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.graphics.*;
import android.view.*;
import android.webkit.*;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.*;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.lang.reflect.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

/** Runs ONLY in the isolated .design package. Never clears or uses the owner's app. */
public class NativeDesignChecks {
    private static final String HOST="https://fixture.tail-test.ts.net", COMPUTER="00000000-0000-4000-8000-000000000001", SID="S-1-5-21-111-222-333-1001";
    private static volatile JSONObject snapshot;
    private static volatile boolean unavailable;
    private static final AtomicInteger posts=new AtomicInteger();
    private Context context;
    @BeforeClass public static void fixture() {
        assertTrue("Use only the isolated design preview",BuildConfig.APPLICATION_ID.endsWith(".design"));
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) {
                if(!url.getHost().equals("fixture.tail-test.ts.net"))throw new AssertionError("Unexpected native host");
                return new HttpURLConnection(url) {
                    @Override public void connect() {}
                    @Override public void disconnect() {}
                    @Override public boolean usingProxy() { return false; }
                    @Override public int getResponseCode() { return unavailable?503:200; }
                    @Override public InputStream getErrorStream() { return new ByteArrayInputStream("{\"error\":\"Synthetic connection unavailable\"}".getBytes(StandardCharsets.UTF_8)); }
                    @Override public OutputStream getOutputStream() { posts.incrementAndGet(); throw new AssertionError("Design checks cannot submit actions"); }
                    @Override public InputStream getInputStream() { return new ByteArrayInputStream(snapshot.toString().getBytes(StandardCharsets.UTF_8)); }
                };
            }
        }:null);
    }
    @Before public void before() throws Exception {
        context=InstrumentationRegistry.getInstrumentation().getTargetContext();
        assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).edit().clear().commit();
        context.getSharedPreferences(ComputerActivity.class.getName(),Context.MODE_PRIVATE).edit().clear().commit();
        unavailable=false; posts.set(0);
        snapshot=new JSONObject().put("computerId",COMPUTER).put("accountSid",SID).put("computerName","Studio laptop").put("available",true).put("locked",false).put("lockReady",true).put("unlockReady",false).put("devices",new JSONArray());
    }
    private Object field(Object object,String name) { try { Field f=object.getClass().getDeclaredField(name); f.setAccessible(true); return f.get(object); } catch(Exception error) { throw new AssertionError(error); } }
    private void invoke(Object object,String name,Class<?>[] types,Object...values) { try { Method m=object.getClass().getDeclaredMethod(name,types); m.setAccessible(true); m.invoke(object,values); } catch(Exception error) { throw new AssertionError(error); } }
    private View find(View root,String label) {
        if(label.contentEquals(root.getContentDescription()==null?"":root.getContentDescription()) || root instanceof TextView && label.contentEquals(((TextView)root).getText()))return root;
        if(root instanceof ViewGroup) for(int i=0;i<((ViewGroup)root).getChildCount();i++) { View found=find(((ViewGroup)root).getChildAt(i),label); if(found!=null)return found; }
        return null;
    }
    private void screenshot(View view,String name) {
        try {
            Bitmap bitmap=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888); view.draw(new Canvas(bitmap));
            File folder=new File(context.getExternalFilesDir(null),"design-review"); assertTrue(folder.isDirectory() || folder.mkdirs());
            try(OutputStream output=new FileOutputStream(new File(folder,name+".png"))) { bitmap.compress(Bitmap.CompressFormat.PNG,100,output); } bitmap.recycle();
        } catch(Exception error) { throw new AssertionError(error); }
    }
    private void waitFor(java.util.function.BooleanSupplier condition) throws Exception {
        long end=android.os.SystemClock.elapsedRealtime()+10000;
        while(!condition.getAsBoolean() && android.os.SystemClock.elapsedRealtime()<end)Thread.sleep(60);
        assertTrue("Native UI did not reach its expected state",condition.getAsBoolean());
    }
    @Test public void a_onboardingAndInvalidAddressKeepTheMicrophoneOff() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            Thread.sleep(350);
            scenario.onActivity(activity->{
                assertFalse(VoiceService.running); screenshot(activity.getWindow().getDecorView(),"01-connect");
                EditText address=(EditText)find(activity.getWindow().getDecorView(),"Your private JARVIS address"); assertNotNull(address);
                address.setText("http://example.org"); find(activity.getWindow().getDecorView(),"Connect to JARVIS").performClick();
                assertNotNull(address.getError()); assertEquals("",context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).getString("origin",""));
                screenshot(activity.getWindow().getDecorView(),"02-address-error");
            });
        }
        assertEquals(0,posts.get());
    }
    @Test public void b_nativeHeaderMenuAndConnectionErrorOfferRecoveryWithoutStartingVoice() throws Exception {
        context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).edit().putString("origin",HOST).commit();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity->{
                WebView web=(WebView)field(activity,"web"); web.stopLoading(); WebViewClient original=web.getWebViewClient();
                web.setWebViewClient(new WebViewClient() {
                    @Override public void onPageStarted(WebView view,String url,Bitmap icon) { original.onPageStarted(view,url,icon); }
                    @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request) {
                        String html="<html><meta name='viewport' content='width=device-width,initial-scale=1'><body style='margin:0;background:#0d1219;color:#edf1f5;font:16px sans-serif;padding:28px'><p style='color:#a9e4d5;font-size:12px'>ISOLATED DESIGN PREVIEW</p><h1 style='font-weight:500;margin-top:60px'>Your personal workspace</h1><p style='color:#9daab9;line-height:1.8'>This preview uses synthetic content. Your saved records and connections are untouched.</p></body></html>";
                        return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));
                    }
                }); web.loadUrl(HOST+"/#/command");
            }); Thread.sleep(900);
            scenario.onActivity(activity->{
                screenshot(activity.getWindow().getDecorView(),"03-native-header");
                find(activity.getWindow().getDecorView(),"Connection and app settings").performClick();
            }); Thread.sleep(350);
            scenario.onActivity(activity->{
                Dialog menu=(Dialog)field(activity,"menuDialog"); assertTrue(menu.isShowing());
                assertNotNull(find(menu.getWindow().getDecorView(),"Laptop controls")); screenshot(menu.getWindow().getDecorView(),"04-app-controls"); menu.dismiss();
                try { Field error=MainActivity.class.getDeclaredField("connectionError"); error.setAccessible(true); error.set(activity,"Cannot reach JARVIS. Check Tailscale and make sure your laptop is awake, then retry."); } catch(Exception e) { throw new AssertionError(e); }
                invoke(activity,"renderConnection",new Class<?>[]{});
            }); Thread.sleep(350);
            scenario.onActivity(activity->{
                View banner=(View)field(activity,"connectionBanner"); assertTrue(banner.isShown()); assertTrue(banner.getHeight()>100);
                assertNotNull(find(activity.getWindow().getDecorView(),"Retry connection")); screenshot(activity.getWindow().getDecorView(),"05-connection-error"); assertFalse(VoiceService.running);
            });
        }
        assertEquals(0,posts.get());
    }
    private ActivityScenario<ComputerActivity> laptop() {
        return ActivityScenario.launch(new Intent(context,ComputerActivity.class).putExtra("origin",HOST).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
    }
    private void settled(ActivityScenario<ComputerActivity> scenario) throws Exception {
        waitFor(()-> { final boolean[] ready={false}; scenario.onActivity(activity->ready[0]=((Button)field(activity,"refresh")).isEnabled()); return ready[0]; }); Thread.sleep(250);
    }
    @Test public void c_laptopReadinessAndFailureNeverSubmitAWindowsAction() throws Exception {
        unavailable=true; // Rendering checks never enroll or use a biometric key.
        try(ActivityScenario<ComputerActivity> scenario=laptop()) {
            settled(scenario);
            scenario.onActivity(activity->invoke(activity,"renderSnapshot",new Class<?>[]{JSONObject.class,String.class,String.class,boolean.class,boolean.class,boolean.class},snapshot,COMPUTER,SID,true,true,false)); Thread.sleep(250);
            scenario.onActivity(activity->{ assertTrue(((Button)field(activity,"lock")).isEnabled()); assertFalse(((Button)field(activity,"unlock")).isEnabled()); screenshot(activity.getWindow().getDecorView(),"06-laptop-unlocked"); });
            snapshot.put("locked",true);
            scenario.onActivity(activity->invoke(activity,"renderSnapshot",new Class<?>[]{JSONObject.class,String.class,String.class,boolean.class,boolean.class,boolean.class},snapshot,COMPUTER,SID,true,false,false)); Thread.sleep(250);
            scenario.onActivity(activity->{ assertFalse(((Button)field(activity,"lock")).isEnabled()); assertFalse(((Button)field(activity,"unlock")).isEnabled()); screenshot(activity.getWindow().getDecorView(),"07-waiting-for-windows"); });
            snapshot.put("unlockReady",true);
            scenario.onActivity(activity->invoke(activity,"renderSnapshot",new Class<?>[]{JSONObject.class,String.class,String.class,boolean.class,boolean.class,boolean.class},snapshot,COMPUTER,SID,true,false,true)); Thread.sleep(250);
            scenario.onActivity(activity->{ assertTrue(((Button)field(activity,"unlock")).isEnabled()); screenshot(activity.getWindow().getDecorView(),"08-unlock-ready"); });
            unavailable=true; scenario.onActivity(activity->((Button)field(activity,"refresh")).performClick()); settled(scenario);
            scenario.onActivity(activity->{ assertFalse(((Button)field(activity,"unlock")).isEnabled()); assertTrue(((TextView)field(activity,"detail")).getText().toString().contains("no action was resent")); screenshot(activity.getWindow().getDecorView(),"09-laptop-connection-error"); });
        }
        assertEquals(0,posts.get());
    }
    @Test public void d_pairingCodeIsSeparateFromActionsAndOverlayControlsStayUsable() throws Exception {
        unavailable=true;
        try(ActivityScenario<ComputerActivity> scenario=laptop()) {
            settled(scenario);
            scenario.onActivity(activity->{
                invoke(activity,"renderSnapshot",new Class<?>[]{JSONObject.class,String.class,String.class,boolean.class,boolean.class,boolean.class},snapshot,COMPUTER,SID,false,false,false);
                assertEquals(View.VISIBLE,((Button)field(activity,"pair")).getVisibility()); screenshot(activity.getWindow().getDecorView(),"10-pair-phone");
                JSONObject pending=new JSONObject(); try { pending.put("code","482615").put("expiresAtMs",System.currentTimeMillis()+300000); } catch(Exception e) { throw new AssertionError(e); }
                invoke(activity,"showPairing",new Class<?>[]{JSONObject.class},pending);
                ((TextView)field(activity,"pairProgress")).setText("Phone verified. Approve the matching code on your laptop, then refresh status here.");
            }); Thread.sleep(250);
            scenario.onActivity(activity->{
                screenshot(activity.getWindow().getDecorView(),"11-pairing-code");
                AtomicInteger stops=new AtomicInteger(); FloatingOrb orb=new FloatingOrb(activity,()->{},()->{},stops::incrementAndGet);
                View root=(View)field(orb,"root"); int width=NativeStyle.dp(activity,112);
                root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED)); root.layout(0,0,root.getMeasuredWidth(),root.getMeasuredHeight()); screenshot(root,"12-orb-compact");
                orb.update("Listening","How can I help you think this through?",true,.5f); width=NativeStyle.dp(activity,184);
                root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED)); root.layout(0,0,root.getMeasuredWidth(),root.getMeasuredHeight()); screenshot(root,"17-island-active");
                ((View)field(orb,"header")).performClick(); width=NativeStyle.dp(activity,350);
                root.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(0,View.MeasureSpec.UNSPECIFIED)); root.layout(0,0,root.getMeasuredWidth(),root.getMeasuredHeight()); screenshot(root,"13-orb-expanded");
                assertNotNull(find(root,"Open")); find(root,"Stop").performClick(); assertEquals(1,stops.get()); orb.close();
            });
        }
        assertEquals(0,posts.get()); assertFalse(VoiceService.running);
    }
    @Test public void e_largeTextKeepsSetupAndAppControlsScrollable() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            final android.content.res.Configuration[] original={null};
            scenario.onActivity(activity->{
                original[0]=new android.content.res.Configuration(activity.getResources().getConfiguration());
                android.content.res.Configuration enlarged=new android.content.res.Configuration(original[0]); enlarged.fontScale=1.4f;
                activity.getResources().updateConfiguration(enlarged,activity.getResources().getDisplayMetrics());
                invoke(activity,"setup",new Class<?>[]{});
            }); Thread.sleep(350);
            scenario.onActivity(activity->{
                View connect=find(activity.getWindow().getDecorView(),"Connect to JARVIS"); assertTrue(connect.getWidth()>0); assertTrue(connect.getHeight()>=NativeStyle.dp(activity,48));
                EditText address=(EditText)find(activity.getWindow().getDecorView(),"Your private JARVIS address"); assertTrue(address.getWidth()<activity.getWindow().getDecorView().getWidth());
                screenshot(activity.getWindow().getDecorView(),"14-connect-large-text"); invoke(activity,"options",new Class<?>[]{});
            }); Thread.sleep(350);
            scenario.onActivity(activity->{
                Dialog menu=(Dialog)field(activity,"menuDialog"); assertTrue(menu.isShowing());
                assertTrue(menu.getWindow().getDecorView().getHeight()<=activity.getResources().getDisplayMetrics().heightPixels);
                screenshot(menu.getWindow().getDecorView(),"15-app-controls-large-text"); menu.dismiss();
                activity.getResources().updateConfiguration(original[0],activity.getResources().getDisplayMetrics());
            });
        }
        assertFalse(VoiceService.running); assertEquals(0,posts.get());
    }
    @Test public void f_backgroundConsentIsExplicitAndCancelDoesNotEnableIt() throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity->invoke(activity,"explainWake",new Class<?>[]{})); Thread.sleep(300);
            scenario.onActivity(activity->{
                android.app.AlertDialog dialog=(android.app.AlertDialog)field(activity,"wakeDialog"); assertTrue(dialog.isShowing());
                android.widget.CheckBox keep=(android.widget.CheckBox)find(dialog.getWindow().getDecorView(),"Keep listening on the lock screen and after closing the app");
                assertNotNull(keep); assertFalse(keep.isChecked()); keep.setChecked(true);
                assertNotNull(find(dialog.getWindow().getDecorView(),"Android battery settings"));
                screenshot(dialog.getWindow().getDecorView(),"16-background-voice-consent");
                dialog.getButton(android.app.AlertDialog.BUTTON_NEGATIVE).performClick();
            });
            Thread.sleep(200);
            assertFalse(context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).getBoolean("keepListening",false));
            assertFalse(context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).getBoolean("voiceConsentV2",false));
            assertFalse(VoiceService.running); assertEquals(0,posts.get());
        }
    }
    @Test public void g_cameraIslandWindowRetargetsAndOnlyShowsControlsOnTap() throws Exception {
        try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("appops set org.jarvisassistant.app.design SYSTEM_ALERT_WINDOW allow"); InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)){while(in.read()!=-1){}}
        final FloatingOrb[] island={null};
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity->{island[0]=new FloatingOrb(activity,()->{},()->{},()->{});island[0].show();});Thread.sleep(400);
            scenario.onActivity(activity->{
                View root=(View)field(island[0],"root");android.view.WindowManager.LayoutParams params=(android.view.WindowManager.LayoutParams)field(island[0],"params");
                int[] position=new int[2];root.getLocationOnScreen(position);assertEquals(params.x,position[0]);assertEquals(params.y,position[1]);
                assertTrue(root.getWidth()<NativeStyle.dp(activity,120));assertFalse(find(root,"Open").isShown());screenshot(root,"18-island-window-idle");
                island[0].update("Listening","Synthetic camera-island preview",true,.7f);
            });Thread.sleep(350);
            scenario.onActivity(activity->{
                View root=(View)field(island[0],"root");assertEquals(NativeStyle.dp(activity,152),root.getWidth());assertFalse(find(root,"Open").isShown());screenshot(root,"19-island-window-listening");
                ((View)field(island[0],"header")).performClick();
            });Thread.sleep(350);
            scenario.onActivity(activity->{View root=(View)field(island[0],"root");assertTrue(find(root,"Open").isShown());screenshot(root,"20-island-window-expanded");((View)field(island[0],"header")).performClick();});Thread.sleep(65);
            scenario.onActivity(activity->((View)field(island[0],"header")).performClick());Thread.sleep(350);
            scenario.onActivity(activity->{View root=(View)field(island[0],"root");assertTrue(find(root,"Open").isShown());island[0].update("Wake listening",null,false,0);});Thread.sleep(350);
            scenario.onActivity(activity->{assertTrue(((View)field(island[0],"root")).getWidth()<NativeStyle.dp(activity,90));island[0].update("Speaking","A reply opens automatically so it can be read.",true,.5f);});Thread.sleep(350);
            scenario.onActivity(activity->{View root=(View)field(island[0],"root");assertTrue(find(root,"Open").isShown());assertNotNull(find(root,"View coding sessions"));screenshot(root,"21-island-auto-reply");island[0].close();});
        } finally {if(island[0]!=null)InstrumentationRegistry.getInstrumentation().runOnMainSync(island[0]::close);}
        assertFalse(VoiceService.running);assertEquals(0,posts.get());
    }

    @Test public void h_phoneCodingShowsLiteralUpdatesAndClearsOnConnectionFailure()throws Exception{
        snapshot=new JSONObject().put("enabled",true).put("sessions",new JSONArray().put(new JSONObject().put("title","Improve the synthetic island").put("status","working").put("project","Design preview").put("preview","Checking animation and accessibility.")).put(new JSONObject().put("title","Review synthetic UI").put("status","attention").put("question","Which layout do you prefer?")));
        try(ActivityScenario<CodingActivity> scenario=ActivityScenario.launch(new Intent(context,CodingActivity.class).putExtra("origin",HOST))){Thread.sleep(450);
            scenario.onActivity(activity->{assertNotNull(find(activity.getWindow().getDecorView(),"Improve the synthetic island"));assertNotNull(find(activity.getWindow().getDecorView(),"Which layout do you prefer?"));screenshot(activity.getWindow().getDecorView(),"22-phone-codex");unavailable=true;find(activity.getWindow().getDecorView(),"Refresh").performClick();});Thread.sleep(350);
            scenario.onActivity(activity->{assertNull(find(activity.getWindow().getDecorView(),"Improve the synthetic island"));assertNotNull(find(activity.getWindow().getDecorView(),"Could not reach your laptop. Check Tailscale, then refresh."));});
        }assertEquals(0,posts.get());
    }
    @Test public void i_lockedPresenceContainsNoPersonalContent()throws Exception{
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){scenario.onActivity(activity->{View presence=AssistantPresence.create(activity,()->{});int width=activity.getResources().getDisplayMetrics().widthPixels,height=activity.getResources().getDisplayMetrics().heightPixels;presence.measure(View.MeasureSpec.makeMeasureSpec(width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(height,View.MeasureSpec.EXACTLY));presence.layout(0,0,width,height);assertNotNull(find(presence,"I'm here."));assertNotNull(find(presence,"Dismiss"));screenshot(presence,"23-lock-screen-presence");});}assertEquals(0,posts.get());
    }
    @Test public void j_devicesShortcutOpensItsPageInsteadOfSilentlyStayingOnCommand()throws Exception{
        context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).edit().putString("origin",HOST).commit();
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{WebView web=(WebView)field(activity,"web");web.stopLoading();WebViewClient original=web.getWebViewClient();web.setWebViewClient(new WebViewClient(){
                @Override public void onPageStarted(WebView view,String url,Bitmap icon){original.onPageStarted(view,url,icon);}
                @Override public void onPageFinished(WebView view,String url){original.onPageFinished(view,url);}
                @Override public WebResourceResponse shouldInterceptRequest(WebView view,WebResourceRequest request){String html="<html><body><h1 id='heading'>Command</h1><script>window.__jarvisFeatures={devices:1};document.getElementById('heading').textContent=location.hash==='#/devices'?'Devices':'Command';</script></body></html>";return new WebResourceResponse("text/html","UTF-8",new ByteArrayInputStream(html.getBytes(StandardCharsets.UTF_8)));}
            });web.loadUrl(HOST+"/#/command");});Thread.sleep(500);
            scenario.onActivity(activity->find(activity.getWindow().getDecorView(),"Connection and app settings").performClick());Thread.sleep(200);
            scenario.onActivity(activity->{Dialog menu=(Dialog)field(activity,"menuDialog");View action=find(menu.getWindow().getDecorView(),"My devices & files");while(action!=null&&!action.hasOnClickListeners())action=action.getParent() instanceof View?(View)action.getParent():null;assertNotNull(action);assertTrue(action.performClick());});Thread.sleep(1200);
            final java.util.concurrent.CountDownLatch checked=new java.util.concurrent.CountDownLatch(1);
            scenario.onActivity(activity->{WebView web=(WebView)field(activity,"web");assertTrue(web.getUrl().endsWith("#/devices"));assertFalse(((Dialog)field(activity,"menuDialog")).isShowing());web.evaluateJavascript("document.getElementById('heading').textContent",value->{assertEquals("\"Devices\"",value);checked.countDown();});});assertTrue(checked.await(5,java.util.concurrent.TimeUnit.SECONDS));
        }assertEquals(0,posts.get());
    }

}
