package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import android.provider.Settings;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.time.ZoneId;
import java.util.UUID;
import java.util.concurrent.*;

/** User-started microphone owner. Auth and audio stay in memory for this session only. */
public final class VoiceService extends Service {
    static final String STOP = "org.jarvisassistant.app.STOP";
    static volatile boolean running;
    static volatile String currentStatus = "Wake listening is off";
    static volatile String lastConversation, lastOrigin;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private final ExecutorService microphone = Executors.newSingleThreadExecutor();
    private final BlockingQueue<Captured> captured = new ArrayBlockingQueue<>(1);
    private final ExecutorService speech = Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService watchdog = Executors.newSingleThreadScheduledExecutor();
    private volatile boolean alive, awake, busy;
    private volatile boolean generalConversation;
    private volatile String reviewedAction="";private volatile long reviewedActionUntil;
    private boolean keepListening;
    private boolean lockedChatSupported;private volatile boolean workspaceLimited;private CompanionVoice delegated;
    private volatile boolean screenProtected;
    private volatile int voiceEpoch;
    private long lastLockedWake;
    private PowerManager.WakeLock cpu;
    private volatile long lastInteraction;
    private volatile AudioRecord recorder;
    private volatile MediaPlayer player;
    private ApiClient api;
    private volatile ApiClient chatApi;
    private volatile ApiClient codingApi;
    private FloatingOrb overlay;
    private volatile VoiceFocus responseFocus;private String origin, cookie, serverId;
    private volatile String conversation = UUID.randomUUID().toString(), afterTurn;
    private volatile String activeTurn;
    private volatile String phase = "Preparing";
    private AudioFocusRequest focus;
    private final BroadcastReceiver lockReceiver = new BroadcastReceiver() {
        @Override public void onReceive(Context context, Intent intent) {
            if(Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                if(!keepListening) { finish("Phone locked. Start listening again when ready."); return; }
                protectScreen(true);
            } else if(Intent.ACTION_USER_PRESENT.equals(intent.getAction()) || Intent.ACTION_SCREEN_ON.equals(intent.getAction()) && !getSystemService(KeyguardManager.class).isDeviceLocked()) protectScreen(false);
        }
    };
    @Override public void onCreate() {
        super.onCreate();
        NotificationManager manager = getSystemService(NotificationManager.class);
        manager.createNotificationChannel(new NotificationChannel("voice", "JARVIS microphone", NotificationManager.IMPORTANCE_LOW));
        IntentFilter filter=new IntentFilter(Intent.ACTION_SCREEN_OFF); filter.addAction(Intent.ACTION_USER_PRESENT); filter.addAction(Intent.ACTION_SCREEN_ON);
        registerReceiver(lockReceiver,filter);
    }
    @Override public int onStartCommand(Intent intent, int flags, int id) {
        if (intent == null || STOP.equals(intent.getAction())) { finish("Wake listening is off"); return START_NOT_STICKY; }
        if (alive) return START_NOT_STICKY;
        try {
            origin = EndpointPolicy.connection(intent.getStringExtra("origin")); cookie = intent.getStringExtra("cookie");
            keepListening=intent.getBooleanExtra("keepListening",false);
            if (!Settings.canDrawOverlays(this)) throw new IOException("Allow JARVIS to display over other apps first.");
            if (getSystemService(KeyguardManager.class).isDeviceLocked()) throw new IOException("Unlock the phone before starting listening.");
            if (Build.VERSION.SDK_INT >= 30) startForeground(71, notification("Preparing voice · microphone is on"), ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE | ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            else startForeground(71, notification("Preparing voice · microphone is on"));
            alive = true; running = true; api = new ApiClient(origin, cookie);delegated=new CompanionVoice(this,origin);
            lastOrigin=origin;lastConversation=null;
            VoiceDiagnostics.start(this,keepListening);
            if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)throw new IOException("Microphone permission is needed. Open JARVIS to allow it.");
            // Establish microphone eligibility while the explicit Start action is
            // still foreground, before laptop warm-up or a keyguard transition.
            int buffer=Math.max(AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT),6400);
            recorder=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,buffer);
            if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Microphone could not start.");
            recorder.startRecording();busy=true;
            microphone.execute(() -> {
                try { while(alive) { Captured clip=capture();if(clip!=null){if(alive && !busy && captured.offer(clip))continue;java.util.Arrays.fill(clip.pcm,(byte)0);} } }
                catch(Exception error){if(alive)finish(friendly(error));}
            });
            if(keepListening) { cpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:WakeListening"); cpu.setReferenceCounted(false); renewCpu(); }
            overlay = new FloatingOrb(this, this::openApp, this::sleep, () -> finish("Wake listening is off")); overlay.show();
            update("Preparing", "Connecting to your laptop…", true);
            watchdog.scheduleWithFixedDelay(() -> {
                if (!alive) return;
                try {
                    if ((!keepListening && phoneProtected()) || !Settings.canDrawOverlays(this)) throw new IOException("Unlock your phone and start listening again.");
                    renewCpu();
                    JSONObject lock = api.json("/api/lock/status", null);
                    if(!lock.optBoolean("unlocked",false)){if(!CompanionClient.enrolled(this,origin))throw new IOException("Workspace locked. Open JARVIS to unlock it.");if(!workspaceLimited){endConversation();workspaceLimited=true;generalConversation=true;update("General voice only","Personal records stay locked. Say Hey JARVIS for general conversation.",false);}}else if(workspaceLimited){endConversation();workspaceLimited=false;update("Wake listening",null,false);}
                } catch (Exception e) { if (alive) finish(friendly(e)); }
            }, 15, 15, TimeUnit.SECONDS);
            watchdog.scheduleWithFixedDelay(() -> {
                if(!alive || phoneProtected()||workspaceLimited)return;
                final int epoch=voiceEpoch;
                try(ApiClient client=new ApiClient(origin,cookie,6000)) {
                    codingApi=client;JSONObject snapshot=client.json("/api/coding/sessions",null);
                    main.post(()->{if(alive && epoch==voiceEpoch && !phoneProtected() && overlay!=null)overlay.coding(snapshot);});
                } catch(Exception e) { main.post(()->{if(alive && epoch==voiceEpoch && overlay!=null)overlay.clearCoding();}); }
                finally { codingApi=null; }
            },3,15,TimeUnit.SECONDS);
            worker.execute(this::loop);
        } catch (Exception e) { finish(friendly(e)); }
        return START_NOT_STICKY;
    }
    private boolean phoneProtected() { return screenProtected || getSystemService(KeyguardManager.class).isDeviceLocked(); }
    private synchronized void renewCpu() { if(alive && cpu!=null)cpu.acquire(120000); }
    private void protectScreen(boolean locked) {
        if(!alive || screenProtected==locked)return;
        boolean continuingGeneral=awake && generalConversation;
        screenProtected=locked;
        if(!continuingGeneral)endConversation();
        JarvisSession.dismissPresence();
        if(codingApi!=null)codingApi.close();
        // Keep the user-started recorder alive across keyguard transitions. Some
        // devices silence recorders recreated after the app leaves the foreground.
        VoiceDiagnostics.increment(this,"screenChanges");
        if(continuingGeneral)VoiceDiagnostics.increment(this,"generalContinuations");
        VoiceDiagnostics.event(this,continuingGeneral?"Screen changed; general conversation retained":locked?"Screen locked; microphone retained":"Phone unlocked; fresh wake required");
        if(overlay!=null) { if(locked)overlay.close(); else { overlay.update(continuingGeneral?"Listening":"Wake listening",continuingGeneral?"Your general voice conversation is still active.":"Say “Hey JARVIS” to begin a new conversation.",continuingGeneral,0); overlay.show(); } }
        if(continuingGeneral&&locked)JarvisAssistant.showWake();
        update(continuingGeneral?busy?phase:"Listening":locked?"Lock screen wake":"Wake listening",null,continuingGeneral);
    }
    private void endConversation() {
        releaseVoiceFocus();reviewedAction="";voiceEpoch++; awake=false;generalConversation=false;if(delegated!=null)delegated.cancel();delegated=new CompanionVoice(this,origin);
        conversation=UUID.randomUUID().toString(); afterTurn=null;
        String turn=activeTurn; activeTurn=null;
        ApiClient old=chatApi; if(old!=null)old.close();
        if(player!=null)try { player.stop(); } catch(Exception ignored) {}
        cancelTurn(turn);
    }
    private void cancelTurn(String turn) {
        if(turn==null || serverId==null)return;
        String host=origin, session=cookie, server=serverId;
        new Thread(()-> { try(ApiClient cancel=new ApiClient(host,session)) { cancel.json("/api/chat/cancel",new JSONObject().put("id",turn).put("serverId",server)); } catch(Exception ignored) {} },"jarvis-cancel").start();
    }
    private Notification notification(String text) {
        PendingIntent open = PendingIntent.getActivity(this, 0, new Intent(this, MainActivity.class), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        PendingIntent stop = PendingIntent.getService(this, 1, new Intent(this, VoiceService.class).setAction(STOP), PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder builder=new Notification.Builder(this, "voice").setSmallIcon(org.jarvisassistant.app.R.drawable.ic_voice).setContentTitle("JARVIS voice")
            .setContentText(text).setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE)
            .addAction(new Notification.Action.Builder(null, "Stop listening", stop).build());
        String selected=reviewedAction;if(!selected.isEmpty()&&SystemClock.elapsedRealtime()<reviewedActionUntil){PendingIntent review=PendingIntent.getActivity(this,72,NativeActions.intent(this,origin,selected),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);builder.addAction(new Notification.Action.Builder(null,NativeActions.label(selected),review).build());}
        return builder.build();
    }
    private void loop() {
        update("Loading wake detector",null,false);
        try(LocalWake detector=new LocalWake(this)) {
            VoiceDiagnostics.event(this,"On-device wake detector ready");
            JSONObject lock = api.json("/api/lock/status", null);
            workspaceLimited=!lock.optBoolean("unlocked",false);if(workspaceLimited&&!CompanionClient.enrolled(this,origin))throw new IOException("Open JARVIS and unlock this workspace first.");
            JSONObject health=api.json("/api/health", null);serverId=health.getString("serverId");lockedChatSupported=health.optJSONObject("capabilities")!=null && health.optJSONObject("capabilities").optInt("lockedVoice")==1;
            lockedChatSupported=lockedChatSupported||CompanionClient.enrolled(this,origin);
            if(!workspaceLimited){JSONObject model = api.json("/api/chat/status", null);
            if (!"ready".equals(model.optString("state")) || !"chatgpt-direct".equals(model.optString("provider"))) throw new IOException("Connect direct ChatGPT in JARVIS Settings on your laptop before starting background voice.");
            api.json("/api/voice/warm", new JSONObject());}
            busy=false;
            update("Wake listening", "Say “Hey JARVIS”, “Hello JARVIS” or “Wake up JARVIS”.", false);
            while (alive) {
                int epoch=voiceEpoch;
                try {
                Captured clip = captured.poll(1,TimeUnit.SECONDS); if (!alive || clip == null) continue;
                if(clip.epoch!=voiceEpoch){java.util.Arrays.fill(clip.pcm,(byte)0);continue;}
                epoch=clip.epoch; byte[] pcm=clip.pcm;
                busy = true;
                update(awake ? "Understanding" : "Wake listening", null, awake);
                try{processClip(detector,pcm,epoch);}finally{java.util.Arrays.fill(pcm,(byte)0);}
                } catch(Exception error) { if(epoch==voiceEpoch)throw error; }
                finally { for(Captured old:captured)java.util.Arrays.fill(old.pcm,(byte)0);captured.clear();busy=false; }
                if(alive && epoch==voiceEpoch) { lastInteraction=SystemClock.elapsedRealtime(); update(awake?"Listening":phoneProtected()?"Lock screen wake":"Wake listening",null,awake); }
            }
        } catch (Exception e) { if (alive){if(phase.equals("Loading wake detector"))VoiceDiagnostics.failure(this,"wake engine",e);finish(friendly(e));} }
    }
    private void releaseVoiceFocus(){VoiceFocus focus=responseFocus;responseFocus=null;if(focus!=null)focus.close();}
    private void processClip(LocalWake detector,byte[] pcm,int epoch)throws Exception{
        final CompanionVoice scoped=delegated;if(!alive||epoch!=voiceEpoch)return;
        LocalWake.Match wake=null;
        if(!awake){
            VoiceDiagnostics.increment(this,"localChecks");wake=detector.detect(pcm);
            if(wake==null){VoiceDiagnostics.increment(this,"localRejected");return;}
            if(!alive||epoch!=voiceEpoch)return;
            VoiceDiagnostics.increment(this,"localHits");
            if(responseFocus==null){VoiceFocus focus=new VoiceFocus(this,origin,()->main.post(()->{if(alive){sleep();update("Voice coordination lost","Call me again to reconnect.",false);}}));responseFocus=focus;if(!focus.claim()){releaseVoiceFocus();return;}}
            if(!alive||epoch!=voiceEpoch){releaseVoiceFocus();return;}
            // Wake-only clips never need Whisper. Speech after the keyword is kept.
            if(!wake.hasCommand||phoneProtected()&&!lockedChatSupported){handleTranscript(wake.phrase,epoch);return;}
            if(!activateWake(epoch))return;
        }
        String heard;
        try{heard=useCompanion()?scoped.transcribe(pcm):api.json("/api/voice/transcribe",new JSONObject().put("wav",Base64.encodeToString(VoiceRules.wav(pcm),Base64.NO_WRAP))).optString("text","").trim();}
        catch(Exception error){VoiceDiagnostics.failure(this,"transcription",error);throw error;}
        VoiceDiagnostics.increment(this,"segments");VoiceDiagnostics.increment(this,heard.isEmpty()?"emptySegments":"recognisedSegments");if(phoneProtected())VoiceDiagnostics.increment(this,"lockedSegments");
        if(wake!=null)heard=VoiceRules.afterDetectedWake(heard);
        if(wake!=null&&heard.isEmpty()){update("Listening","How can I help?",true);speak("I'm listening.");return;}
        handleTranscript(heard,epoch);
    }
    private boolean activateWake(int epoch){
        if(!alive||epoch!=voiceEpoch||phoneProtected()&&!keepListening)return false;
        VoiceDiagnostics.increment(this,"wakes");
        generalConversation=phoneProtected()||workspaceLimited;awake=true;lastInteraction=SystemClock.elapsedRealtime();
        if(generalConversation){VoiceDiagnostics.increment(this,"lockedWakes");main.post(()->{if(alive&&epoch==voiceEpoch)JarvisAssistant.showWake();});}
        return true;
    }
    private void handleTranscript(String heard,int epoch) throws Exception {
                if(!alive || epoch!=voiceEpoch)return;
                if(phoneProtected() && !keepListening)return;
                if(phoneProtected() && !lockedChatSupported){if(VoiceRules.wakeCommand(heard)!=null){awake=true;try{speak("Update JARVIS on your laptop to enable locked-screen conversation.");}finally{awake=false;}}return;}
                if (!awake) {
                    // Ambient transcripts have no path to chat, records, logs or preferences.
                    String command = VoiceRules.wakeCommand(heard);
                    heard = "";
                    if (command == null) return;
                    if(!activateWake(epoch))return;heard = command;
                    if (heard.isEmpty()) { update("Listening", "How can I help?", true); speak("I'm listening."); }
                }
                if (!heard.isEmpty()) {
                    if (VoiceRules.off(heard)) { finish("Wake listening is off"); return; }
                    if (VoiceRules.sleep(heard)) { sleep(); return; }
                    lastInteraction = SystemClock.elapsedRealtime();
                    converse(heard);
                }
    }
    private static final class Captured { final byte[] pcm; final int epoch; Captured(byte[] pcm,int epoch){this.pcm=pcm;this.epoch=epoch;} }
    private Captured capture() throws Exception {
        if(!alive)return null;
        if (checkSelfPermission(android.Manifest.permission.RECORD_AUDIO) != android.content.pm.PackageManager.PERMISSION_GRANTED) throw new IOException("Microphone permission was removed. Open JARVIS to allow it again.");
        AudioRecord input=recorder;
        if(input==null) {
            int size=Math.max(AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT),6400);
            input=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size); recorder=input;
        }
        SpeechSegmenter segmenter=new SpeechSegmenter();
        int epoch=voiceEpoch; boolean silenced=false; short[] block = new short[640];
        try {
            if (!alive || input.getState() != AudioRecord.STATE_INITIALIZED) throw new IOException("The microphone could not start. Check microphone permission.");
            if(input.getRecordingState()!=AudioRecord.RECORDSTATE_RECORDING)input.startRecording();
            VoiceDiagnostics.recorder(this,input.getAudioSessionId());
            while (alive) {
                if(epoch!=voiceEpoch) { segmenter.reset();epoch=voiceEpoch; }
                if (awake && !busy && SystemClock.elapsedRealtime() - lastInteraction > 45000) sleep();
                int count = input.read(block, 0, block.length, AudioRecord.READ_BLOCKING);
                if (count <= 0) throw new IOException("Microphone disconnected. Open JARVIS to start again.");
                boolean paused=false;
                if(Build.VERSION.SDK_INT>=29) { AudioRecordingConfiguration config=input.getActiveRecordingConfiguration(); paused=config!=null && config.isClientSilenced(); }
                AudioManager audio=getSystemService(AudioManager.class);
                paused=paused || audio.getMode()==AudioManager.MODE_IN_CALL || audio.getMode()==AudioManager.MODE_IN_COMMUNICATION;
                if(paused!=silenced) {
                    silenced=paused; if(paused)VoiceDiagnostics.increment(this,"silenced");
                    VoiceDiagnostics.event(this,paused?"Android paused the microphone":"Microphone available again");
                    update(paused?"Microphone paused":phoneProtected()?"Lock screen wake":"Wake listening",null,false);
                }
                // Drain continuously through recognition and playback. Restarting
                // AudioRecord in the background can lose microphone eligibility;
                // buffered speaker audio must never become the next command.
                if(paused || busy) { segmenter.reset();continue; }
                double energy = 0;
                for (int i = 0; i < count; i++) energy += (block[i] / 32768.0) * (block[i] / 32768.0);
                float rms = (float)Math.sqrt(energy / count); float level = Math.min(1, rms * 8);
                main.post(() -> { if(alive){if(overlay!=null)overlay.level(phase,level);if(phoneProtected())JarvisSession.updatePresence(phase,level);} });
                byte[] result=segmenter.accept(block,count);
                if(result!=null){if(epoch==voiceEpoch)return new Captured(result,epoch);java.util.Arrays.fill(result,(byte)0);segmenter.reset();}
            }
            return null;
        } finally {
            segmenter.reset();java.util.Arrays.fill(block,(short)0);
            if(!alive) { try { input.stop();input.release(); } catch(Exception ignored){} if(recorder==input)recorder=null; }
        }
    }
    private boolean useCompanion(){return CompanionClient.enrolled(this,origin)&&(generalConversation||phoneProtected()||workspaceLimited);}
    private void converse(String text) throws Exception {
        if(useCompanion()){converseDelegated(text);return;}
        reviewedAction="";
        if (!alive || !awake || phoneProtected() && !keepListening) return;
        final int epoch=voiceEpoch; final boolean lockedTurn=generalConversation||phoneProtected(); final String sessionConversation=conversation;
        final ApiClient client=new ApiClient(origin,cookie); chatApi=client;
        try {
        final String id = UUID.randomUUID().toString(); activeTurn = id;
        update("Thinking", text, true);
        JSONObject request = new JSONObject().put("id", id).put("serverId", serverId).put("conversationId", sessionConversation)
            .put("afterTurnId", afterTurn == null ? JSONObject.NULL : afterTurn).put("message", text).put("sources", new JSONArray())
            .put("voice", true).put("lockedVoice",lockedTurn).put("reasoning", "low").put("timeZone", ZoneId.systemDefault().getId());
        // No retry: a disconnected send can already have reached the server.
        if(epoch!=voiceEpoch || phoneProtected() && !lockedTurn)return;
        VoiceDiagnostics.increment(this,"questions");
        try{client.json("/api/chat/send", request);VoiceDiagnostics.increment(this,"acceptedQuestions");}catch(Exception error){VoiceDiagnostics.failure(this,"chat submission",error);throw error;}
        if(epoch!=voiceEpoch || phoneProtected() && !lockedTurn)return;
        afterTurn = id; lastConversation = sessionConversation; lastOrigin = origin;
        BlockingQueue<String> chunks = new LinkedBlockingQueue<>(); final String end = new String("END");
        Future<?> spoken = speech.submit(() -> {
            try { while (alive && epoch==voiceEpoch && (!phoneProtected() || lockedTurn && keepListening)) { String part = chunks.take(); if (part == end) break; speak(part,client,epoch,false); } }
            catch (Exception e) { if (alive && epoch==voiceEpoch) finish("Voice stopped. Your reply is in the conversation. " + friendly(e)); }
        });
        int[] sent = {0}; String[] previous = {""};
        try {
            client.events(sessionConversation, snapshot -> {
                if(epoch!=voiceEpoch || phoneProtected() && !lockedTurn)return true;
                JSONArray turns = snapshot.optJSONArray("turns"); if (turns == null) return false;
                for (int i = 0; i < turns.length(); i++) {
                    JSONObject turn = turns.getJSONObject(i); if (!id.equals(turn.optString("id"))) continue;
                    String reply = turn.optString("reply", ""), status = turn.optString("status"); boolean done = !"running".equals(status);
                    if (!reply.startsWith(previous[0])) throw new IOException("The reply changed. Please read the final reply in the conversation.");
                    previous[0] = reply; update(player == null ? "Thinking" : "Speaking", reply.isEmpty() ? text : reply, true);
                    String tail = reply.substring(sent[0]);
                    while (!tail.isBlank()) {
                        int count = VoiceRules.chunk(tail);
                        if (!done && (count >= tail.length() || count < 30)) break;
                        String part = VoiceRules.spoken(tail.substring(0, count)); if (!part.isBlank()) chunks.put(part);
                        sent[0] += count; tail = reply.substring(sent[0]);
                    }
                    if (done) { if (!"complete".equals(status)) throw new IOException("Reply interrupted. Review the conversation before repeating an action."); receivedAction(turn.optJSONObject("action"),id,epoch);return true; }
                }
                return false;
            });
        } catch(Exception error){VoiceDiagnostics.failure(this,"reply stream",error);throw error;}
        finally { chunks.offer(end); if(epoch==voiceEpoch)activeTurn = null; }
        spoken.get();
        if(alive&&epoch==voiceEpoch)VoiceDiagnostics.increment(this,"answeredQuestions");
        } finally { if(chatApi==client)chatApi=null; client.close(); }
    }
    private void converseDelegated(String text)throws Exception{
        final CompanionVoice scoped=delegated;reviewedAction="";if(!alive||!awake||phoneProtected()&&!keepListening)return;int epoch=voiceEpoch;String id=UUID.randomUUID().toString();update("Thinking",null,true);VoiceDiagnostics.increment(this,"questions");JSONObject result=scoped.reply(text,id,conversation);if(!alive||epoch!=voiceEpoch)return;VoiceDiagnostics.increment(this,"acceptedQuestions");String reply=result.optString("reply","");update("Thinking",reply,true);receivedAction(result.optJSONObject("action"),id,epoch);String remaining=VoiceRules.spoken(reply);while(alive&&awake&&epoch==voiceEpoch&&!remaining.isBlank()){int length=VoiceRules.chunk(remaining);String part=remaining.substring(0,length);remaining=remaining.substring(length);speak(part,api,epoch,false);}if(alive&&epoch==voiceEpoch)VoiceDiagnostics.increment(this,"answeredQuestions");
    }
    private void speak(String text) throws Exception {
        speak(text,api,voiceEpoch,false);
    }
    private void receivedAction(JSONObject value,String id,int epoch){String action=NativeActions.fromJson(value,id);if(action!=null&&alive&&epoch==voiceEpoch){reviewedAction=action;reviewedActionUntil=SystemClock.elapsedRealtime()+120000;}}
    private void speak(String text,ApiClient client,int epoch,boolean lockedAcknowledgement) throws Exception {
        final CompanionVoice scoped=delegated;
        if (!alive || !awake || epoch!=voiceEpoch || phoneProtected() && !keepListening) return;
        update("Preparing voice", null, true);
        byte[] audio;try{audio=useCompanion()?scoped.audio(text):client.bytes("/api/voice/speak", new JSONObject().put("text", text), 10_000_000);}catch(Exception error){VoiceDiagnostics.failure(this,"voice generation",error);throw error;}
        if (!alive || !awake || epoch!=voiceEpoch || phoneProtected() && !keepListening) { java.util.Arrays.fill(audio,(byte)0); return; }
        AudioManager manager = getSystemService(AudioManager.class);
        AudioAttributes attributes = new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();
        focus = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes)
            .setOnAudioFocusChangeListener(change -> {
                if(change>=0 || !alive || epoch!=voiceEpoch)return;
                if(!keepListening) { finish("Another app took audio focus. Listening stopped."); return; }
                endConversation(); VoiceDiagnostics.event(this,"Audio interrupted; wake session retained"); update("Audio paused",null,false);
            }, main).build();
        if (manager.requestAudioFocus(focus) != AudioManager.AUDIOFOCUS_REQUEST_GRANTED) throw new IOException("Audio is in use by another app.");
        MediaPlayer output = new MediaPlayer(); player = output; CountDownLatch complete = new CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean failed=new java.util.concurrent.atomic.AtomicBoolean();java.util.concurrent.atomic.AtomicBoolean played=new java.util.concurrent.atomic.AtomicBoolean();
        try {
            output.setAudioAttributes(attributes);
            output.setDataSource(new MediaDataSource() {
                @Override public int readAt(long position, byte[] buffer, int offset, int size) { if (position >= audio.length) return -1; int n = Math.min(size, audio.length - (int)position); System.arraycopy(audio, (int)position, buffer, offset, n); return n; }
                @Override public long getSize() { return audio.length; }
                @Override public void close() {}
            });
            output.setOnCompletionListener(p -> {played.set(true);complete.countDown();}); output.setOnErrorListener((p, what, extra) -> {failed.set(true);complete.countDown();return true;});
            output.prepare(); if (!alive || !awake || epoch!=voiceEpoch || phoneProtected() && !keepListening) return; update("Speaking", null, true); output.start();
            while (alive && awake && epoch==voiceEpoch && !complete.await(100, TimeUnit.MILLISECONDS)) {
                main.post(() -> { if(alive){float level=.15f+.35f*(float)Math.abs(Math.sin(SystemClock.elapsedRealtime()/180.0));if(overlay!=null)overlay.level("Speaking",level);if(phoneProtected())JarvisSession.updatePresence("Speaking",level);} });
            }
            if(failed.get()){IOException error=new IOException("Audio playback failed. Check the phone media volume and output device.");VoiceDiagnostics.failure(this,"audio playback",error);throw error;}
            if(played.get() && phoneProtected())VoiceDiagnostics.increment(this,"lockedReplies");
        } finally { if (player == output) player = null; try { output.release(); } catch (Exception ignored) {} manager.abandonAudioFocusRequest(focus); java.util.Arrays.fill(audio, (byte)0); }
    }
    private void update(String next, String text, boolean expanded) {
        phase = next; currentStatus = next;
        VoiceDiagnostics.phase(this,next);
        final int epoch=voiceEpoch;
        main.post(() -> { if (!alive || epoch!=voiceEpoch) return; if (overlay != null && !phoneProtected()) overlay.update(next, text, expanded, 0); if(phoneProtected() && keepListening)JarvisSession.updatePresence(next,0); getSystemService(NotificationManager.class).notify(71, notification(next + " · tap Stop to turn off the microphone")); });
    }
    private void sleep() { endConversation(); main.post(JarvisSession::dismissPresence); update("Wake listening", "Say “Hey JARVIS” when you need me.", false); }
    private void openApp() { startActivity(new Intent(this, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP)); }
    private String friendly(Exception error) { return error instanceof IOException ? error.getMessage() : "Connection or audio unavailable. Check Tailscale and JARVIS on your laptop."; }
    private void finish(String reason) {
        currentStatus = reason;
        VoiceDiagnostics.event(this,reason.contains("Workspace") || reason.contains("workspace")?"Stopped: unlock JARVIS workspace":reason.contains("Phone locked")?"Stopped: screen-off mode":reason.contains("focus") || reason.contains("Audio") || reason.contains("audio")?"Stopped: audio interrupted":reason.contains("Microphone") || reason.contains("microphone")?"Stopped: microphone unavailable":reason.equals("Wake listening is off")?"Stopped by you":"Stopped: connection or service unavailable");
        main.post(this::stopSelf); alive = false;
    }
    @Override public void onTaskRemoved(Intent rootIntent) { if(!keepListening)finish("App closed. Wake listening is off."); }
    @Override public IBinder onBind(Intent intent) { return null; }
    @Override public void onDestroy() { releaseVoiceFocus();
        alive = false; awake = false; running = false; voiceEpoch++;if(delegated!=null)delegated.cancel();JarvisSession.dismissPresence();
        synchronized(this) { if(cpu!=null && cpu.isHeld())cpu.release(); }
        try { unregisterReceiver(lockReceiver); } catch (Exception ignored) {}
        AudioRecord input=recorder;recorder=null;
        if(input!=null) { try {input.stop();}catch(Exception ignored){} try {input.release();}catch(Exception ignored){} }
        if (player != null) try { player.stop(); } catch (Exception ignored) {}
        if (overlay != null) { overlay.close(); overlay = null; }
        cancelTurn(activeTurn); cookie = "";
        if(chatApi!=null)chatApi.close();
        if(codingApi!=null)codingApi.close();
        if (api != null) api.close();
        for(Captured clip:captured)java.util.Arrays.fill(clip.pcm,(byte)0);captured.clear();
        worker.shutdownNow(); microphone.shutdownNow();speech.shutdownNow(); watchdog.shutdownNow(); main.removeCallbacksAndMessages(null);
        stopForeground(STOP_FOREGROUND_REMOVE); super.onDestroy();
    }
}
