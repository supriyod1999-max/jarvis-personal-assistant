package org.jarvisassistant.app;

import android.Manifest;
import android.content.*;
import android.os.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.lang.reflect.*;
import java.util.*;
import java.util.concurrent.*;

/** Separate preview only: no owner data, real server, biometric or message actions. */
public class BackgroundVoiceChecks {
    private static final String HOST="https://fixture.tail-test.ts.net";
    private static final List<String> paths=Collections.synchronizedList(new ArrayList<>());
    private static volatile boolean workspaceUnlocked=true;
    private static volatile String spoken="",submitted="",transcript="";
    private Context context;
    @BeforeClass public static void fixtures() {
        assertEquals("org.jarvisassistant.app.design",BuildConfig.APPLICATION_ID);
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler() {
            @Override protected URLConnection openConnection(URL url) {
                if(!url.getHost().equals("fixture.tail-test.ts.net"))throw new AssertionError("Unexpected native host");
                return new HttpURLConnection(url) {
                    final ByteArrayOutputStream body=new ByteArrayOutputStream();
                    @Override public void connect(){} @Override public void disconnect(){} @Override public boolean usingProxy(){return false;}
                    @Override public OutputStream getOutputStream(){return body;}
                    @Override public int getResponseCode() {
                        paths.add(url.getPath());
                        if(url.getPath().equals("/api/chat/send")){submitted=body.toString(StandardCharsets.UTF_8);try{org.json.JSONObject request=new org.json.JSONObject(submitted);if(!request.optBoolean("lockedVoice")||request.getJSONArray("sources").length()!=0)throw new AssertionError("Only synthetic locked general voice is allowed");}catch(org.json.JSONException e){throw new AssertionError(e);}return 503;}
                        if(url.getPath().equals("/api/voice/speak")) { spoken=body.toString(StandardCharsets.UTF_8); return 503; }
                        return 200;
                    }
                    @Override public InputStream getErrorStream(){return new ByteArrayInputStream("{\"error\":\"Synthetic audio unavailable\"}".getBytes(StandardCharsets.UTF_8));}
                    @Override public InputStream getInputStream() {
                        String value="{}";
                        if(url.getPath().equals("/api/lock/status"))value="{\"unlocked\":"+workspaceUnlocked+"}";
                        if(url.getPath().equals("/api/health"))value="{\"serverId\":\"00000000-0000-4000-8000-000000000001\",\"capabilities\":{\"lockedVoice\":1}}";
                        if(url.getPath().equals("/api/chat/status"))value="{\"state\":\"ready\",\"provider\":\"chatgpt-direct\"}";
                        if(url.getPath().equals("/api/voice/transcribe"))value="{\"text\":"+org.json.JSONObject.quote(transcript)+"}";
                        return new ByteArrayInputStream(value.getBytes(StandardCharsets.UTF_8));
                    }
                };
            }
        }:null);
    }
    private Object get(Object object,String name)throws Exception {Field f=VoiceService.class.getDeclaredField(name); f.setAccessible(true); return f.get(object);}
    private void set(Object object,String name,Object value)throws Exception {Field f=VoiceService.class.getDeclaredField(name); f.setAccessible(true); f.set(object,value);}
    private Object call(Object object,String name,Class<?>[] types,Object... args)throws Exception {Method m=VoiceService.class.getDeclaredMethod(name,types); m.setAccessible(true); try{return m.invoke(object,args);}catch(InvocationTargetException error){throw (Exception)error.getCause();}}
    private void shell(String command)throws Exception {try(ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command); InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){while(in.read()!=-1){}}}
    private void await(java.util.function.BooleanSupplier ready,long timeout)throws Exception {long end=SystemClock.elapsedRealtime()+timeout; while(!ready.getAsBoolean() && SystemClock.elapsedRealtime()<end)Thread.sleep(60); assertTrue("Voice lifecycle did not settle",ready.getAsBoolean());}
    @Before public void prepare()throws Exception {
        context=InstrumentationRegistry.getInstrumentation().getTargetContext(); assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        context.stopService(new Intent(context,VoiceService.class)); await(()->!VoiceService.running,3000);
        // No real WebView DNS request may race the native service fixture.
        context.getSharedPreferences(MainActivity.class.getName(),Context.MODE_PRIVATE).edit().remove("origin").commit();
        paths.clear(); spoken=""; transcript="";workspaceUnlocked=true;
        shell("pm grant org.jarvisassistant.app.design "+Manifest.permission.RECORD_AUDIO);
        shell("pm grant org.jarvisassistant.app.design "+Manifest.permission.POST_NOTIFICATIONS);
        shell("appops set org.jarvisassistant.app.design SYSTEM_ALERT_WINDOW allow");
        shell("input keyevent 224"); shell("wm dismiss-keyguard");
    }
    @Test public void a_defaultStillStopsAtScreenOff()throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(a->a.startForegroundService(new Intent(a,VoiceService.class).putExtra("origin",HOST)));
            await(()->VoiceService.running && VoiceService.currentStatus.equals("Wake listening"),10000);
            shell("input keyevent 223"); await(()->!VoiceService.running,5000);
            assertTrue(VoiceService.currentStatus.contains("locked"));
        }
    }
    @Test public void b_optInKeepsTheMicrophoneServiceAcrossHomeAndScreenOffButHonorsWorkspaceLock()throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(a->a.startForegroundService(new Intent(a,VoiceService.class).putExtra("origin",HOST).putExtra("keepListening",true)));
            await(()->VoiceService.running && VoiceService.currentStatus.equals("Wake listening"),10000);
            await(()->context.getSharedPreferences("voice_health",Context.MODE_PRIVATE).contains("recorderSession"),3000);
            int recorderBeforeLock=context.getSharedPreferences("voice_health",Context.MODE_PRIVATE).getInt("recorderSession",0);
            shell("input keyevent 3"); Thread.sleep(400); assertTrue(VoiceService.running);
            shell("input keyevent 223"); await(()->VoiceService.currentStatus.equals("Lock screen wake"),5000);
            Thread.sleep(16500); assertTrue("Watchdog must allow opted-in screen-off listening",VoiceService.running);
            assertEquals("Locking must retain the same microphone recorder",recorderBeforeLock,context.getSharedPreferences("voice_health",Context.MODE_PRIVATE).getInt("recorderSession",-1));
            assertFalse(paths.contains("/api/chat/send"));
            workspaceUnlocked=false; await(()->!VoiceService.running,18000);
            assertTrue(VoiceService.currentStatus.contains("Workspace locked"));
        }
    }
    @Test public void c_lockedWakeDiscardsCommandsAndStaleConfirmations()throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(activity->{
                VoiceService voice=new VoiceService();
                try {
                    Method attach=ContextWrapper.class.getDeclaredMethod("attachBaseContext",Context.class); attach.setAccessible(true); attach.invoke(voice,activity);
                    set(voice,"alive",true); set(voice,"keepListening",true);set(voice,"lockedChatSupported",true); set(voice,"screenProtected",true); set(voice,"voiceEpoch",7);set(voice,"origin",HOST);set(voice,"cookie","synthetic");set(voice,"serverId","00000000-0000-4000-8000-000000000001"); set(voice,"api",new ApiClient(HOST,"synthetic"));
                    call(voice,"handleTranscript",new Class<?>[]{String.class,int.class},"send it",7);
                    call(voice,"handleTranscript",new Class<?>[]{String.class,int.class},"yes",7);
                    call(voice,"handleTranscript",new Class<?>[]{String.class,int.class},"Hey JARVIS, send it",6);
                    assertTrue(paths.isEmpty());
                    set(voice,"lastLockedWake",-10000L);
                    try {call(voice,"handleTranscript",new Class<?>[]{String.class,int.class},"Hey JARVIS, explain rainbows",7); fail("Synthetic speech must fail without real audio");}
                    catch(IOException expected){assertTrue(expected.getMessage().contains("Synthetic audio"));}
                    assertEquals(Collections.singletonList("/api/chat/send"),new ArrayList<>(paths));
                    assertTrue(submitted.contains("explain rainbows"));assertTrue(new org.json.JSONObject(submitted).getBoolean("lockedVoice"));assertEquals(0,new org.json.JSONObject(submitted).getJSONArray("sources").length());
                    assertFalse(VoiceDiagnostics.report(activity).contains("WhatsApp"));
                    set(voice,"awake",false);
                    String before=(String)get(voice,"conversation"); set(voice,"screenProtected",false); set(voice,"afterTurn","old-confirmation");
                    call(voice,"protectScreen",new Class<?>[]{boolean.class},true);
                    assertNotEquals(before,get(voice,"conversation")); assertNull(get(voice,"afterTurn")); assertEquals(8,get(voice,"voiceEpoch")); assertFalse((Boolean)get(voice,"awake"));
                    voice.onTaskRemoved(null); assertTrue((Boolean)get(voice,"alive"));
                }catch(Exception error){throw new AssertionError(error);}
                finally {
                    try {set(voice,"alive",false); ((Handler)get(voice,"main")).removeCallbacksAndMessages(null); for(String name:new String[]{"worker","microphone","speech","watchdog"})((ExecutorService)get(voice,name)).shutdownNow();}catch(Exception error){throw new AssertionError(error);}
                }
            });
        }
    }
    @Test public void d_notificationStopStillReleasesAnAlwaysOnSession()throws Exception {
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)) {
            scenario.onActivity(a->a.startForegroundService(new Intent(a,VoiceService.class).putExtra("origin",HOST).putExtra("keepListening",true)));
            await(()->VoiceService.running && VoiceService.currentStatus.equals("Wake listening"),10000);
            android.app.NotificationManager manager=context.getSystemService(android.app.NotificationManager.class);
            manager.getActiveNotifications()[0].getNotification().actions[0].actionIntent.send();
            await(()->!VoiceService.running,5000); assertEquals(0,manager.getActiveNotifications().length);
        }
    }
    @Test public void e_generalFollowupSurvivesUnlockWithoutGainingPersonalAccess()throws Exception{
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            scenario.onActivity(activity->{VoiceService voice=new VoiceService();try{
                Method attach=ContextWrapper.class.getDeclaredMethod("attachBaseContext",Context.class);attach.setAccessible(true);attach.invoke(voice,activity);
                set(voice,"alive",true);set(voice,"keepListening",true);set(voice,"lockedChatSupported",true);set(voice,"screenProtected",true);set(voice,"awake",true);set(voice,"generalConversation",true);set(voice,"voiceEpoch",12);set(voice,"origin",HOST);set(voice,"cookie","synthetic");set(voice,"serverId","00000000-0000-4000-8000-000000000001");set(voice,"api",new ApiClient(HOST,"synthetic"));
                String conversation=(String)get(voice,"conversation");call(voice,"protectScreen",new Class<?>[]{boolean.class},false);
                assertTrue((Boolean)get(voice,"awake"));assertTrue((Boolean)get(voice,"generalConversation"));assertEquals(12,get(voice,"voiceEpoch"));assertEquals(conversation,get(voice,"conversation"));
                try{call(voice,"handleTranscript",new Class<?>[]{String.class,int.class},"what is two plus two",12);fail("Synthetic chat must not run inference");}catch(IOException expected){}
                org.json.JSONObject request=new org.json.JSONObject(submitted);assertTrue(request.getBoolean("lockedVoice"));assertEquals("what is two plus two",request.getString("message"));assertEquals(0,request.getJSONArray("sources").length());
                call(voice,"sleep",new Class<?>[]{});assertFalse((Boolean)get(voice,"awake"));assertFalse((Boolean)get(voice,"generalConversation"));assertNotEquals(conversation,get(voice,"conversation"));
            }catch(Exception error){throw new AssertionError(error);}finally{try{set(voice,"alive",false);((Handler)get(voice,"main")).removeCallbacksAndMessages(null);for(String name:new String[]{"worker","microphone","speech","watchdog"})((ExecutorService)get(voice,name)).shutdownNow();}catch(Exception error){throw new AssertionError(error);}}});
        }
    }
    @Test public void f_idleSpeechNeverReachesWhisperAndWakeOnlyNeedsNoTranscription()throws Exception{
        try(ActivityScenario<MainActivity> scenario=ActivityScenario.launch(MainActivity.class)){
            final VoiceService[] service={null};
            scenario.onActivity(activity->{try{VoiceService voice=new VoiceService();service[0]=voice;Method attach=ContextWrapper.class.getDeclaredMethod("attachBaseContext",Context.class);attach.setAccessible(true);attach.invoke(voice,activity);set(voice,"alive",true);set(voice,"keepListening",true);set(voice,"lockedChatSupported",true);set(voice,"screenProtected",true);set(voice,"voiceEpoch",4);set(voice,"origin",HOST);set(voice,"cookie","synthetic");set(voice,"api",new ApiClient(HOST,"synthetic"));}catch(Exception error){throw new AssertionError(error);}});
            VoiceService voice=service[0];
            try(LocalWake detector=new LocalWake(context)){
                call(voice,"processClip",new Class<?>[]{LocalWake.class,byte[].class,int.class},detector,LocalWakeChecks.pcm("negative",1),4);assertTrue(paths.isEmpty());
                try{call(voice,"processClip",new Class<?>[]{LocalWake.class,byte[].class,int.class},detector,LocalWakeChecks.pcm("hey",1),4);fail("Synthetic voice output must fail");}catch(IOException expected){}
                assertEquals(Collections.singletonList("/api/voice/speak"),new ArrayList<>(paths));assertFalse(paths.contains("/api/voice/transcribe"));assertFalse(paths.contains("/api/chat/send"));
                paths.clear();set(voice,"awake",false);set(voice,"generalConversation",false);transcript="Hey Jervis, what is two plus two?";
                try{call(voice,"processClip",new Class<?>[]{LocalWake.class,byte[].class,int.class},detector,LocalWakeChecks.pcm("question",1),4);fail("Synthetic chat cannot run inference");}catch(IOException expected){}
                assertEquals(Arrays.asList("/api/voice/transcribe","/api/chat/send"),new ArrayList<>(paths));org.json.JSONObject question=new org.json.JSONObject(submitted);assertEquals("what is two plus two?",question.getString("message"));assertTrue(question.getBoolean("lockedVoice"));assertEquals(0,question.getJSONArray("sources").length());
            }finally{set(voice,"alive",false);((Handler)get(voice,"main")).removeCallbacksAndMessages(null);for(String name:new String[]{"worker","microphone","speech","watchdog"})((ExecutorService)get(voice,name)).shutdownNow();}
        }
    }
    @After public void cleanup()throws Exception {context.stopService(new Intent(context,VoiceService.class)); await(()->!VoiceService.running,3000); shell("input keyevent 224"); shell("wm dismiss-keyguard");}
}
