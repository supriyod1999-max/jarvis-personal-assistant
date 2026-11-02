package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.content.pm.ServiceInfo;
import android.os.*;
import android.webkit.CookieManager;
import android.util.Base64;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.io.*;
import java.time.ZoneId;
import java.util.*;
import java.util.concurrent.*;

/** Explicit, revocable phone relay. No credentials or approval signatures go to the watch. */
public final class WatchBridgeService extends Service {
    static volatile WatchBridgeService current;
    static final String STOP="watch.stop";
    private WatchUpdateRelay updates;
    private WatchRpcRelay rpc;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService deadlines=Executors.newSingleThreadScheduledExecutor();
    private final WatchWire.Seen seen=new WatchWire.Seen();
    private final Set<ChannelClient.Channel> channels=ConcurrentHashMap.newKeySet();
    private volatile ApiClient active;
    private volatile boolean busy,commandBusy;
    private String origin,node;private volatile String media="";private long sequence,mediaUntil;
    private String conversation=UUID.randomUUID().toString(),after;private long lastTurn;
    private volatile String turn,server;
    private volatile String reviewAction="",reviewRequest="";private volatile long reviewUntil;
    @Override public void onCreate(){super.onCreate();updates=new WatchUpdateRelay(this,this::trusted);getSystemService(NotificationManager.class).createNotificationChannel(new NotificationChannel("watch","Watch companion",NotificationManager.IMPORTANCE_LOW));}
    @Override public int onStartCommand(Intent intent,int flags,int id){
        if(intent!=null&&STOP.equals(intent.getAction())){getSharedPreferences("WatchLink",MODE_PRIVATE).edit().putBoolean("connectionEnabled",false).apply();stopSelf();return START_NOT_STICKY;}
        if(intent==null&&!getSharedPreferences("WatchLink",MODE_PRIVATE).getBoolean("connectionEnabled",false)){stopSelf();return START_NOT_STICKY;}
        if(current==this)return START_STICKY;
        try{
            android.content.SharedPreferences preferences=getSharedPreferences("WatchLink",MODE_PRIVATE);
            origin=EndpointPolicy.connection(preferences.getString("origin",""));node=preferences.getString("node","");
            if(node.isEmpty() || !origin.equals(getSharedPreferences("MainActivity",MODE_PRIVATE).getString("origin","")))throw new IOException();
            rpc=new WatchRpcRelay(this,origin,this::trusted,this::registerReview);
            PendingIntent open=PendingIntent.getActivity(this,81,new Intent(this,WatchConnectionsActivity.class).putExtra("origin",origin),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
            PendingIntent stop=PendingIntent.getService(this,82,new Intent(this,WatchBridgeService.class).setAction(STOP),PendingIntent.FLAG_IMMUTABLE);
            Notification n=new Notification.Builder(this,"watch").setSmallIcon(R.drawable.ic_voice).setContentTitle("JARVIS watch connected").setContentText("Voice through your phone · tap to manage").setContentIntent(open).setOngoing(true).setVisibility(Notification.VISIBILITY_PRIVATE).addAction(new Notification.Action.Builder(null,"Disconnect watch",stop).build()).build();
            if(Build.VERSION.SDK_INT>=29)startForeground(81,n,ServiceInfo.FOREGROUND_SERVICE_TYPE_CONNECTED_DEVICE);else startForeground(81,n);current=this;
        }catch(Exception e){stopSelf();return START_NOT_STICKY;}return getSharedPreferences("WatchLink",MODE_PRIVATE).getBoolean("connectionEnabled",false)?START_STICKY:START_NOT_STICKY;
    }
    private boolean trusted(String source){return current==this && node.equals(source) && node.equals(getSharedPreferences("WatchLink",MODE_PRIVATE).getString("node","")) && origin.equals(getSharedPreferences("MainActivity",MODE_PRIVATE).getString("origin",""));}
    private ApiClient client()throws Exception{
        if(!trusted(node))throw new IOException("Watch disconnected. Relink it on your phone.");
        ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin));
        try{if(!api.json("/api/lock/status",null).optBoolean("unlocked"))throw new IOException("Unlock the JARVIS workspace on your phone.");return api;}catch(Exception e){api.close();throw e;}
    }
    synchronized void channel(ChannelClient.Channel channel){
        if(rpc!=null&&rpc.accepts(channel)){rpc.channel(channel);return;}
        if(updates.accepts(channel)){updates.channel(channel);return;}
        String id=WatchWire.channelId(channel.getPath());
        if(!trusted(channel.getNodeId())||busy||commandBusy||id==null||!seen.accept(id,SystemClock.elapsedRealtime())){Wearable.getChannelClient(this).close(channel);return;}
        busy=true;reviewAction="";reviewRequest="";channels.add(channel);ScheduledFuture<?> timeout=deadlines.schedule(()->{Wearable.getChannelClient(this).close(channel);ApiClient api=active;if(api!=null)api.close();cancel();},180,TimeUnit.SECONDS);
        worker.execute(()->{
            ChannelClient pipe=Wearable.getChannelClient(this);
            PowerManager.WakeLock cpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:WatchReply");cpu.acquire(185000);
            try(DataInputStream in=new DataInputStream(Tasks.await(pipe.getInputStream(channel),12,TimeUnit.SECONDS));DataOutputStream out=new DataOutputStream(Tasks.await(pipe.getOutputStream(channel),12,TimeUnit.SECONDS))){
                try(WatchWire.Frame frame=WatchWire.read(in,WatchWire.PCM_LIMIT)){
                    JSONObject options=new JSONObject(frame.text);boolean quiet=options.optBoolean("quiet");
                    if(frame.audio.length<11200 || frame.audio.length%2!=0 || !trusted(channel.getNodeId()))throw new IOException("Recording unavailable. Try Talk again.");
                    try(ApiClient api=client()){
                        active=api;JSONObject health=api.json("/api/health",null);String boot=health.optString("serverId");
                        if(!boot.equals(server)||SystemClock.elapsedRealtime()-lastTurn>300000){conversation=UUID.randomUUID().toString();after=null;}server=boot;
                        if(health.optJSONObject("capabilities")==null||health.optJSONObject("capabilities").optInt("lockedVoice")!=1)throw new IOException("Update JARVIS on your laptop before using watch voice.");
                        String heard=api.json("/api/voice/transcribe",new JSONObject().put("wav",Base64.encodeToString(VoiceRules.wav(frame.audio),Base64.NO_WRAP))).optString("text","").trim();
                        String wake=VoiceRules.wakeCommand(heard);if(wake!=null)heard=wake;
                        if(heard.isEmpty()){WatchWire.write(out,new JSONObject().put("reply","I'm listening. Tap Talk and ask your question.").toString(),new byte[0],WatchWire.AUDIO_LIMIT);return;}
                        turn=id;
                        // General conversation mode deliberately cannot approve private actions.
                        api.json("/api/chat/send",new JSONObject().put("id",id).put("serverId",server).put("conversationId",conversation).put("afterTurnId",after==null?JSONObject.NULL:after).put("message",heard).put("sources",new JSONArray()).put("voice",true).put("lockedVoice",true).put("reasoning","low").put("timeZone",ZoneId.systemDefault().getId()));
                        after=id;lastTurn=SystemClock.elapsedRealtime();
                        final String[] reply={""};final JSONObject[] nextAction={null};
                        api.events(conversation,snapshot->{JSONArray turns=snapshot.optJSONArray("turns");if(turns==null)return false;for(int i=0;i<turns.length();i++){JSONObject t=turns.getJSONObject(i);if(!id.equals(t.optString("id")))continue;if(!"running".equals(t.optString("status"))){if(!"complete".equals(t.optString("status")))throw new IOException("Reply interrupted. Check JARVIS before trying again.");reply[0]=t.optString("reply");nextAction[0]=t.optJSONObject("action");return true;}}return false;});turn=null;
                        String nextId=NativeActions.fromJson(nextAction[0],id);if(nextId!=null){reviewAction=nextId;reviewRequest=id;reviewUntil=SystemClock.elapsedRealtime()+120000;}String text=reply[0];if(text.length()>2600)text=text.substring(0,2600)+"… Open JARVIS for the rest.";
                        byte[] audio=new byte[0];String audioError="";
                        if(!quiet)try{String spoken=VoiceRules.spoken(text);if(spoken.length()>1100)spoken=spoken.substring(0,1100)+". The rest is on your watch.";audio=api.bytes("/api/voice/speak",new JSONObject().put("text",spoken),WatchWire.AUDIO_LIMIT);}catch(Exception e){audioError="Voice unavailable. The written answer is below.";}
                        try{if(!trusted(node))throw new IOException("Watch disconnected.");WatchWire.write(out,new JSONObject().put("reply",text).put("audioError",audioError).put("action",nextId==null?JSONObject.NULL:nextAction[0]).toString(),audio,WatchWire.AUDIO_LIMIT);}finally{Arrays.fill(audio,(byte)0);}
                    }
                }catch(Exception e){try{WatchWire.write(out,new JSONObject().put("error",friendly(e)).toString(),new byte[0],WatchWire.AUDIO_LIMIT);}catch(Exception ignored){}}
            }catch(Exception ignored){cancel();}finally{timeout.cancel(false);if(cpu.isHeld())cpu.release();active=null;turn=null;channels.remove(channel);pipe.close(channel);busy=false;}
        });
    }
    void disconnected(ChannelClient.Channel channel){if(rpc!=null)rpc.disconnected(channel);updates.disconnected(channel);if(channels.contains(channel)){ApiClient api=active;if(api!=null)api.close();cancel();}}
    private void registerReview(String request,JSONObject action){String id=NativeActions.fromJson(action,request);reviewAction=id==null?"":id;reviewRequest=id==null?"":request;reviewUntil=SystemClock.elapsedRealtime()+120000;}
    synchronized void command(String source,byte[] data){
        if(!trusted(source)||data.length>2048)return;
        try{JSONObject request=new JSONObject(new String(data,java.nio.charset.StandardCharsets.UTF_8));String id=request.optString("id"),action=request.optString("action");long age=System.currentTimeMillis()-request.optLong("time");if(age< -30000||age>30000||!seen.accept(id,SystemClock.elapsedRealtime()))return;
            if(busy||commandBusy){status(source,id,"JARVIS is busy. Wait for the current request to finish.");return;}commandBusy=true;
            worker.execute(()->{try{
                if(!trusted(source)||System.currentTimeMillis()-request.optLong("time")>15000)return;
                if(action.equals("ping")){try(ApiClient api=client()){api.json("/api/health",null);}status(source,id,"Connected. Voice ready.");}
                else if(action.equals("computer")){approval(ComputerActivity.class,"Review laptop lock or unlock on your phone");status(source,id,"Open the phone notification and approve there.");}
                else if(action.equals("coding")){approval(CodingActivity.class,"View your coding sessions on your phone");status(source,id,"Open the phone notification for coding sessions.");}
                else if(action.equals("continue")){
                    if(!request.optString("requestId").equals(reviewRequest)||reviewAction.isEmpty()||SystemClock.elapsedRealtime()>reviewUntil){status(source,id,"That review expired. Ask JARVIS again to prepare a fresh action.");return;}
                    Intent target=NativeActions.intent(this,origin,reviewAction);reviewAction="";reviewRequest="";
                    PendingIntent open=PendingIntent.getActivity(this,84,target,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
                    getSystemService(NotificationManager.class).notify(84,new Notification.Builder(this,"watch").setSmallIcon(R.drawable.ic_voice).setContentTitle("Review your JARVIS request").setContentText("Tap to continue on your phone. Nothing was approved from the watch.").setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());status(source,id,"Open the JARVIS notification on your phone to review this request.");
                }
                else if(action.equals("media-stop")){stopMedia();status(source,id,"Watch media control stopped.");}
                else if(WatchWire.media(action)){
                    if(media.isEmpty()||SystemClock.elapsedRealtime()>mediaUntil){stopMedia();approval(WatchConnectionsActivity.class,"Approve 15 minutes of watch media control");status(source,id,"Approve watch media on your phone first. No button was queued.");return;}
                    try(ApiClient api=client()){JSONObject receipt=api.json("/api/remote/input",new JSONObject().put("session",media).put("sequence",++sequence).put("events",new JSONArray().put(new JSONObject().put("type","media").put("key",action))));if(!receipt.optBoolean("applied"))throw new IOException();}
                    status(source,id,"Media control applied.");
                }
            }catch(Exception e){stopMedia();status(source,id,"Connection ended. No action was resent. Check your phone.");}finally{commandBusy=false;}});
        }catch(Exception ignored){}
    }
    synchronized void media(String token){stopMedia();media=token;sequence=0;mediaUntil=SystemClock.elapsedRealtime()+900000;deadlines.schedule(()->{synchronized(this){if(token.equals(media))stopMedia();}},15,TimeUnit.MINUTES);}
    synchronized void stopMedia(){String old=media;media="";if(!old.isEmpty())new Thread(()->{try(ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin),5000)){api.json("/api/remote/stop",new JSONObject().put("session",old));}catch(Exception ignored){}},"Stop watch media").start();}
    private void approval(Class<?> target,String text){PendingIntent open=PendingIntent.getActivity(this,83,new Intent(this,target).putExtra("origin",origin),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);getSystemService(NotificationManager.class).notify(83,new Notification.Builder(this,"watch").setSmallIcon(R.drawable.ic_voice).setContentTitle("JARVIS watch request").setContentText(text).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());}
    private void status(String source,String id,String text){try{Wearable.getMessageClient(this).sendMessage(source,WatchWire.STATUS,new JSONObject().put("id",id).put("text",text).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}catch(Exception ignored){}}
    private static String friendly(Exception error){return error instanceof IOException&&error.getMessage()!=null?error.getMessage():"Could not finish. Check your phone, Tailscale and laptop. No request was resent.";}
    private void cancel(){String id=turn,boot=server;if(id==null)return;turn=null;new Thread(()->{try(ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin),5000)){api.json("/api/chat/cancel",new JSONObject().put("id",id).put("serverId",boot));}catch(Exception ignored){}},"Cancel watch reply").start();}
    @Override public void onDestroy(){if(current==this)current=null;updates.close();if(rpc!=null)rpc.close();for(ChannelClient.Channel channel:channels)Wearable.getChannelClient(this).close(channel);ApiClient api=active;if(api!=null)api.close();cancel();stopMedia();worker.shutdownNow();deadlines.shutdownNow();super.onDestroy();}
    @Override public IBinder onBind(Intent intent){return null;}
}
