package org.jarvisassistant.app;

import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.media.*;
import android.os.*;
import android.view.*;
import android.webkit.CookieManager;
import android.widget.*;
import android.util.Base64;
import org.json.*;
import java.io.*;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.*;

/** Explicit assistant invocation. No wake phrase, overlay grant or always-on service needed. */
public final class AssistantConversationActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private volatile boolean visible,busy;private volatile int epoch;private boolean first=true;
    private volatile AudioRecord recorder;private volatile MediaPlayer player;private volatile ApiClient active;private CompanionVoice delegated;
    private String origin,conversation=UUID.randomUUID().toString(),after;private volatile String turn,server;
    private TextView status,heard,reply;private Button action;private AssistantPresence.Aura aura;
    private Button review;private volatile String reviewAction="";
    @Override public void onCreate(Bundle saved){super.onCreate(saved);setShowWhenLocked(true);setTurnScreenOn(true);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE|WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"JARVIS","A conversation, right here",this::finish));ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout body=NativeStyle.column(this);body.setGravity(Gravity.CENTER_HORIZONTAL);int pad=NativeStyle.dp(this,24);body.setPadding(pad,0,pad,pad);scroll.addView(body);aura=new AssistantPresence.Aura(this);body.addView(aura,new LinearLayout.LayoutParams(NativeStyle.dp(this,220),NativeStyle.dp(this,220)));
        status=NativeStyle.title(this,"I'm listening.",24);status.setAccessibilityLiveRegion(View.ACCESSIBILITY_LIVE_REGION_POLITE);body.addView(status);body.addView(NativeStyle.text(this,"Speak naturally. No wake phrase needed.",14,NativeStyle.MUTED));NativeStyle.gap(body,16);
        heard=NativeStyle.text(this,"",14,NativeStyle.MUTED);heard.setSaveEnabled(false);body.addView(heard);reply=NativeStyle.text(this,"",18,NativeStyle.TEXT);reply.setSaveEnabled(false);body.addView(reply);NativeStyle.gap(body,18);
        action=NativeStyle.action(this,"Stop",null,false,()->{if(busy){cancel();show("Stopped",null);action.setText("Talk again");}else begin();});body.addView(action,new LinearLayout.LayoutParams(-1,-2));body.addView(NativeStyle.action(this,"Open JARVIS",null,false,()->{cancel();startActivity(new Intent(this,MainActivity.class));finish();}),new LinearLayout.LayoutParams(-1,-2));setContentView(root);
        review=NativeStyle.action(this,"Continue in JARVIS",null,true,()->{String selected=reviewAction;if(!NativeActions.known(selected))return;cancel();startActivity(NativeActions.intent(this,origin,selected));finish();});review.setVisibility(View.GONE);body.addView(review,new LinearLayout.LayoutParams(-1,-2));
        try{origin=EndpointPolicy.connection(getSharedPreferences("MainActivity",MODE_PRIVATE).getString("origin",""));}catch(Exception e){first=false;show("Connect your phone in JARVIS first.",null);action.setEnabled(false);}
    }
    @Override protected void onResume(){super.onResume();visible=true;if(first){first=false;begin();}}
    private void begin(){if(!visible||busy||origin==null)return;if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.RECORD_AUDIO},96);return;}
        // One microphone owner; ending this conversation never opts into background listening.
        reviewAction="";review.setVisibility(View.GONE);stopService(new Intent(this,VoiceService.class));delegated=new CompanionVoice(this,origin);int generation=++epoch;busy=true;action.setText("Stop");heard.setText("");reply.setText("");show("Listening",null);
        worker.execute(()->{try{for(int i=0;i<40&&VoiceService.running&&valid(generation);i++)Thread.sleep(50);
            while(valid(generation)){byte[] pcm=capture(generation);if(pcm==null){show("Tap Talk again when you're ready.",null);break;}try{answer(pcm,generation);}finally{Arrays.fill(pcm,(byte)0);}if(!reviewAction.isEmpty())break;if(valid(generation))show("Listening",null);}
        }catch(Exception e){if(valid(generation))show(e instanceof IOException?e.getMessage():"Could not finish. Check Tailscale and JARVIS on your laptop. No request was resent.",null);}finally{if(generation==epoch){busy=false;main.post(()->{if(visible&&generation==epoch)action.setText("Talk again");});}}});
    }
    private boolean valid(int generation){return visible&&generation==epoch&&!Thread.currentThread().isInterrupted();}
    private void receivedAction(JSONObject value,String id,int generation){String selected=NativeActions.fromJson(value,id);if(selected==null||!valid(generation))return;reviewAction=selected;main.post(()->{if(valid(generation)&&id.equals(after)){review.setText(NativeActions.label(selected));review.setVisibility(View.VISIBLE);}});}
    private boolean microphoneSilenced(AudioRecord input){if(Build.VERSION.SDK_INT<29)return false;AudioRecordingConfiguration config=input.getActiveRecordingConfiguration();return config!=null&&config.isClientSilenced();}
    private byte[] capture(int generation)throws Exception{
        if(checkSelfPermission(Manifest.permission.RECORD_AUDIO)!=PackageManager.PERMISSION_GRANTED)throw new IOException("Allow microphone access to talk to JARVIS.");
        AudioRecord input=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,Math.max(6400,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT)));recorder=input;SpeechSegmenter segmenter=new SpeechSegmenter();short[] block=new short[640];long end=SystemClock.elapsedRealtime()+18000;
        try{if(input.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("Microphone unavailable. Close other voice apps and try again.");input.startRecording();while(valid(generation)&&SystemClock.elapsedRealtime()<end){int n=input.read(block,0,block.length,AudioRecord.READ_BLOCKING);if(n<=0)throw new IOException("Microphone disconnected. Tap Talk again.");if(microphoneSilenced(input))throw new IOException("Another app is using the microphone. Tap Talk again when it's free.");double energy=0;for(int i=0;i<n;i++)energy+=(block[i]/32768.0)*(block[i]/32768.0);float level=Math.min(1,(float)Math.sqrt(energy/n)*8);main.post(()->{if(valid(generation))aura.state("Listening",level);});byte[] clip=segmenter.accept(block,n);if(clip!=null)return clip;}return null;
        }finally{segmenter.reset();Arrays.fill(block,(short)0);if(recorder==input)recorder=null;try{input.stop();}catch(Exception ignored){}input.release();}
    }
    private void answer(byte[] pcm,int generation)throws Exception{
        if(!valid(generation))return;
        if(CompanionClient.enrolled(this,origin)){answerDelegated(pcm,generation);return;}
        try(ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin))){active=api;show("Understanding",null);if(!api.json("/api/lock/status",null).optBoolean("unlocked"))throw new IOException("Unlock your JARVIS workspace in the app first.");JSONObject health=api.json("/api/health",null);server=health.getString("serverId");if(health.optJSONObject("capabilities")==null||health.optJSONObject("capabilities").optInt("lockedVoice")!=1)throw new IOException("Update JARVIS on your laptop to use assistant conversations.");
            String text=api.json("/api/voice/transcribe",new JSONObject().put("wav",Base64.encodeToString(VoiceRules.wav(pcm),Base64.NO_WRAP))).optString("text","").trim();if(!valid(generation))return;if(text.isEmpty()){show("I didn't catch that. Please try again.",null);return;}main.post(()->{if(valid(generation))heard.setText(text);});if(VoiceRules.off(text)||VoiceRules.sleep(text)){main.post(this::finish);return;}
            String id=UUID.randomUUID().toString();turn=id;show("Thinking",null);api.json("/api/chat/send",new JSONObject().put("id",id).put("serverId",server).put("conversationId",conversation).put("afterTurnId",after==null?JSONObject.NULL:after).put("message",text).put("sources",new JSONArray()).put("voice",true).put("lockedVoice",true).put("reasoning","low").put("timeZone",ZoneId.systemDefault().getId()));after=id;String[] result={""};
            api.events(conversation,snapshot->{if(!valid(generation))return true;JSONArray turns=snapshot.optJSONArray("turns");if(turns==null)return false;for(int i=0;i<turns.length();i++){JSONObject t=turns.getJSONObject(i);if(!id.equals(t.optString("id")))continue;result[0]=t.optString("reply");show("Thinking",result[0]);if(!"running".equals(t.optString("status"))){if(!"complete".equals(t.optString("status")))throw new IOException("Reply interrupted. Check JARVIS before repeating a request.");receivedAction(t.optJSONObject("action"),id,generation);return true;}}return false;});turn=null;
            String remaining=VoiceRules.spoken(result[0]);while(valid(generation)&&!remaining.isBlank()){int n=VoiceRules.chunk(remaining);String part=remaining.substring(0,n);remaining=remaining.substring(n);show("Preparing voice",null);byte[] audio;try{audio=api.bytes("/api/voice/speak",new JSONObject().put("text",part),10000000);}catch(Exception e){throw new IOException("Your written answer is here. Voice generation is unavailable; check the laptop voice service.");}try{if(valid(generation)){show("Speaking",null);speak(audio,generation);}}finally{Arrays.fill(audio,(byte)0);}}
        }finally{active=null;}
    }
    private void answerDelegated(byte[] pcm,int generation)throws Exception{
        if(delegated==null)delegated=new CompanionVoice(this,origin);final CompanionVoice voice=delegated;show("Understanding",null);String text=voice.transcribe(pcm);if(!valid(generation))return;if(text.isBlank()){show("I didn't catch that. Please try again.",null);return;}main.post(()->{if(valid(generation)&&!getSystemService(KeyguardManager.class).isDeviceLocked())heard.setText(text);});if(VoiceRules.off(text)||VoiceRules.sleep(text)){main.post(this::finish);return;}
        String id=UUID.randomUUID().toString();show("Thinking",null);JSONObject result=voice.reply(text,id,conversation);if(!valid(generation))return;after=id;String answer=result.optString("reply","");show("Thinking",answer);receivedAction(result.optJSONObject("action"),id,generation);String remaining=VoiceRules.spoken(answer);while(valid(generation)&&!remaining.isBlank()){int length=VoiceRules.chunk(remaining);String part=remaining.substring(0,length);remaining=remaining.substring(length);show("Preparing voice",null);byte[] audio=voice.audio(part);try{if(valid(generation)){show("Speaking",null);speak(audio,generation);}}finally{Arrays.fill(audio,(byte)0);}}
    }
    private void speak(byte[] audio,int generation)throws Exception{
        AudioManager manager=getSystemService(AudioManager.class);AudioAttributes attrs=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANT).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();CountDownLatch done=new CountDownLatch(1);java.util.concurrent.atomic.AtomicBoolean failed=new java.util.concurrent.atomic.AtomicBoolean();AudioFocusRequest focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attrs).setOnAudioFocusChangeListener(change->{if(change<0){failed.set(true);done.countDown();}}).build();MediaPlayer output=new MediaPlayer();player=output;
        try{if(manager.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new IOException("Audio is in use. Your written answer is here.");output.setAudioAttributes(attrs);output.setDataSource(new MediaDataSource(){public int readAt(long p,byte[] b,int o,int n){if(p>=audio.length)return -1;int count=Math.min(n,audio.length-(int)p);System.arraycopy(audio,(int)p,b,o,count);return count;}public long getSize(){return audio.length;}public void close(){}});output.setOnCompletionListener(p->done.countDown());output.setOnErrorListener((p,w,e)->{failed.set(true);done.countDown();return true;});output.prepare();if(!valid(generation))return;output.start();PetWaveform envelope=new PetWaveform(audio);long end=SystemClock.elapsedRealtime()+90000;while(valid(generation)&&!done.await(100,TimeUnit.MILLISECONDS)){if(SystemClock.elapsedRealtime()>end)throw new IOException("Playback stopped. Your written answer is here.");float level=envelope.level(output.getCurrentPosition());main.post(()->{if(valid(generation))aura.state("Speaking",level);});}if(failed.get())throw new IOException("Audio was interrupted. Your written answer is here.");}
        finally{if(player==output)player=null;output.release();manager.abandonAudioFocusRequest(focus);}
    }
    private void show(String phase,String answer){int generation=epoch;main.post(()->{if(isFinishing()||generation!=epoch)return;status.setText(phase.equals("Listening")?"I'm listening.":phase.equals("Thinking")?"Let me think.":phase.equals("Understanding")?"I heard you.":phase.equals("Preparing voice")?"One moment.":phase.equals("Speaking")?"Here's my answer.":phase);aura.state(phase,0);if(answer!=null)reply.setText(getSystemService(KeyguardManager.class).isDeviceLocked()?"":answer);});}
    private void cancel(){epoch++;if(delegated!=null)delegated.cancel();busy=false;reviewAction="";if(review!=null)review.setVisibility(View.GONE);ApiClient api=active;if(api!=null)api.close();AudioRecord input=recorder;if(input!=null)try{input.stop();}catch(Exception ignored){}MediaPlayer output=player;if(output!=null)try{output.stop();}catch(Exception ignored){}String id=turn,boot=server;turn=null;if(id!=null&&origin!=null)new Thread(()->{try(ApiClient cancel=new ApiClient(origin,CookieManager.getInstance().getCookie(origin),5000)){cancel.json("/api/chat/cancel",new JSONObject().put("id",id).put("serverId",boot));}catch(Exception ignored){}},"Cancel assistant turn").start();}
    @Override public void onRequestPermissionsResult(int request,String[] permissions,int[] grants){super.onRequestPermissionsResult(request,permissions,grants);if(request==96&&grants.length>0&&grants[0]==PackageManager.PERMISSION_GRANTED)begin();else show("Allow the microphone to talk. You can enable it in Android settings.",null);}
    @Override protected void onPause(){visible=false;cancel();super.onPause();}
    @Override protected void onDestroy(){cancel();worker.shutdownNow();main.removeCallbacksAndMessages(null);super.onDestroy();}
}
