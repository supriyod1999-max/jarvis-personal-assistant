package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.media.*;
import android.os.*;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** User-started, bounded capture. Ambient clips stay on-watch and are erased. */
public final class WatchVoiceService extends Service {
    static volatile boolean running;static volatile String status="Ready when you are",reply="";
    static volatile String actionRequest="";static volatile long actionUntil;
    private final ExecutorService microphone=Executors.newSingleThreadExecutor(),network=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
    private volatile boolean alive,busy,awake;private boolean background,quiet;private long expiry,lastSpeech;
    private AudioRecord recorder;private volatile ChannelClient.Channel channel;private MediaPlayer player;private PowerManager.WakeLock cpu;
    @Override public void onCreate(){super.onCreate();getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("watch-voice","JARVIS listening",NotificationManager.IMPORTANCE_LOW));}
    private Notification notification(){PendingIntent open=PendingIntent.getActivity(this,90,new Intent(this,WatchActivity.class),PendingIntent.FLAG_IMMUTABLE);PendingIntent stop=PendingIntent.getService(this,91,new Intent(this,WatchVoiceService.class).setAction("stop"),PendingIntent.FLAG_IMMUTABLE);return new Notification.Builder(this,"watch-voice").setSmallIcon(R.drawable.ic_watch).setContentTitle("JARVIS microphone on").setContentText(status).setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,"Stop listening",stop).build()).build();}
    @Override public int onStartCommand(Intent intent,int flags,int id){if(intent==null||"stop".equals(intent.getAction())){stopSelf();return START_NOT_STICKY;}if(alive)return START_NOT_STICKY;
        try{background=intent.getBooleanExtra("background",false);quiet=intent.getBooleanExtra("quiet",false);long duration=WatchWire.duration(intent.getIntExtra("minutes",0));expiry=duration==0?0:SystemClock.elapsedRealtime()+duration;awake=!background;lastSpeech=SystemClock.elapsedRealtime();reply="";actionRequest="";status=background?"Say Hey JARVIS":"Listening…";
            if(checkSelfPermission(android.Manifest.permission.RECORD_AUDIO)!=android.content.pm.PackageManager.PERMISSION_GRANTED)throw new IOException("Microphone permission is required.");
            startForeground(90,notification(),ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE|ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
            int size=Math.max(6400,AudioRecord.getMinBufferSize(16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT));recorder=new AudioRecord(MediaRecorder.AudioSource.VOICE_RECOGNITION,16000,AudioFormat.CHANNEL_IN_MONO,AudioFormat.ENCODING_PCM_16BIT,size);if(recorder.getState()!=AudioRecord.STATE_INITIALIZED)throw new IOException("The watch microphone could not start.");recorder.startRecording();alive=running=true;
            cpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:WatchListening");cpu.setReferenceCounted(false);cpu.acquire(600000);
            timer.scheduleWithFixedDelay(()->{if(!alive)return;if(expiry!=0&&SystemClock.elapsedRealtime()>=expiry){finish("Listening timer finished");return;}if(cpu!=null)cpu.acquire(600000);},30,30,TimeUnit.SECONDS);
            microphone.execute(this::capture);
        }catch(Exception e){finish("Microphone unavailable. Allow microphone access and reopen JARVIS.");}return START_NOT_STICKY;
    }
    private void capture(){SpeechSegmenter segmenter=new SpeechSegmenter();short[] samples=new short[640];LocalWake detector=null;
        try{if(background)detector=new LocalWake(this);while(alive){int n=recorder.read(samples,0,samples.length,AudioRecord.READ_BLOCKING);if(n<=0)throw new IOException("Watch microphone stopped.");AudioRecordingConfiguration config=recorder.getActiveRecordingConfiguration();if(config!=null&&config.isClientSilenced()){segmenter.reset();update("Microphone paused by Android");continue;}if(busy){segmenter.reset();continue;}
                if(SystemClock.elapsedRealtime()-lastSpeech>15000 && awake){if(background){awake=false;update("Say Hey JARVIS");}else{finish("No speech heard. Tap Talk to try again.");break;}}
                byte[] clip=segmenter.accept(samples,n);if(clip==null)continue;
                if(!awake){LocalWake.Match wake;try{wake=detector.detect(clip);}catch(Exception e){Arrays.fill(clip,(byte)0);throw e;}if(wake==null){Arrays.fill(clip,(byte)0);continue;}awake=true;lastSpeech=SystemClock.elapsedRealtime();haptic();update("Listening…");if(!wake.hasCommand){Arrays.fill(clip,(byte)0);continue;}}
                if(awake){lastSpeech=SystemClock.elapsedRealtime();busy=true;byte[] recording=clip;network.execute(()->{try{ask(recording);}catch(Exception e){if(alive)update(e instanceof IOException?e.getMessage():"Connection ended. Check phone, Tailscale and laptop. No request was resent.");}finally{Arrays.fill(recording,(byte)0);busy=false;awake=false;if(!background){alive=false;stopSelf();}else if(alive){lastSpeech=SystemClock.elapsedRealtime();}}});}else Arrays.fill(clip,(byte)0);
            }
        }catch(Exception e){if(alive)finish(e instanceof IOException?e.getMessage():"Wake engine unavailable. Reopen JARVIS or use Talk.");}finally{segmenter.reset();Arrays.fill(samples,(short)0);if(detector!=null)detector.close();}
    }
    private volatile WatchRpc rpc;
    private void ask(byte[] pcm)throws Exception{
        try(WatchRpc client=new WatchRpc(this)){
            rpc=client;update("Understanding…");byte[] wav=VoiceRules.wav(pcm);String hash=AppReleases.hex(java.security.MessageDigest.getInstance("SHA-256").digest(wav));Arrays.fill(wav,(byte)0);
            String heard;try(WatchWire.Frame frame=client.request("voice.transcribe",new JSONObject().put("sha256",hash),pcm)){heard=new JSONObject(frame.text).optString("text","").trim();}
            String wake=VoiceRules.wakeCommand(heard);if(wake!=null)heard=wake;if(heard.isEmpty())throw new IOException("No speech heard. Tap Talk and try again.");
            update("Thinking…");String requestId=UUID.randomUUID().toString();JSONObject response=client.json("voice.reply",new JSONObject().put("text",heard).put("turnId",requestId));reply=response.optString("reply");JSONObject action=response.optJSONObject("action");
            if(action!=null&&"jarvis-action".equals(action.optString("kind"))&&requestId.equals(action.optString("requestId"))){actionRequest=requestId;actionUntil=SystemClock.elapsedRealtime()+120000;}
            haptic();if(!quiet){update("Preparing voice…");String spoken=VoiceRules.spoken(reply);if(spoken.length()>1400)spoken=spoken.substring(0,1400)+". The rest is on your watch.";try(WatchWire.Frame audio=client.request("voice.speak",new JSONObject().put("text",spoken),new byte[0])){if(audio.audio.length==0)throw new IOException("No voice audio was returned. Your written reply is ready.");update("Speaking…");play(audio.audio);}}
            if(alive)update(background?"Say Hey JARVIS":quiet?"Reply ready · spoken replies off":"Reply ready");
        }finally{rpc=null;}
    }
    private volatile WatchSpeaker speaker;
    private void play(byte[] audio)throws Exception{try(WatchSpeaker output=new WatchSpeaker(this)){speaker=output;output.play(audio,()->alive,route->{});}finally{speaker=null;}}
    private void haptic(){getSystemService(Vibrator.class).vibrate(VibrationEffect.createOneShot(35,VibrationEffect.DEFAULT_AMPLITUDE));}
    private void update(String value){if(!alive)return;status=value;getSystemService(NotificationManager.class).notify(90,notification());}
    private void finish(String value){status=value;alive=false;stopSelf();}
    @Override public void onDestroy(){alive=running=false;if(recorder!=null){try{recorder.stop();}catch(Exception ignored){}recorder.release();recorder=null;}if(channel!=null)Wearable.getChannelClient(this).close(channel);if(rpc!=null)rpc.close();if(speaker!=null)speaker.close();if(cpu!=null&&cpu.isHeld())cpu.release();microphone.shutdownNow();network.shutdownNow();timer.shutdownNow();if(status.startsWith("Listening")||status.startsWith("Say "))status="Listening off";super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
