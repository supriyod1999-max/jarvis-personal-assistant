package org.jarvisassistant.app;
import android.content.Context;
import android.os.PowerManager;
import android.util.Base64;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.JSONObject;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.*;

/** Phone transports watch-signed requests. It cannot sign or invent approvals for the watch. */
final class WatchRpcRelay implements AutoCloseable {
    static final String PATH="/jarvis/watch/v2/request/",KEY="/jarvis/watch/v2/key";
    private final Context context;private final Predicate<String> trusted;private final String origin;private final BiConsumer<String,JSONObject> review;
    private final ExecutorService worker=Executors.newFixedThreadPool(3);private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();private final Semaphore slots=new Semaphore(3);private final java.util.Set<ChannelClient.Channel> channels=ConcurrentHashMap.newKeySet();private final java.util.Map<ChannelClient.Channel,ApiClient> clients=new ConcurrentHashMap<>();
    
    WatchRpcRelay(Context context,String origin,Predicate<String> trusted,BiConsumer<String,JSONObject> review){this.context=context;this.origin=origin;this.trusted=trusted;this.review=review;}
    boolean accepts(ChannelClient.Channel channel){return channel.getPath().startsWith(PATH);}
    void channel(ChannelClient.Channel channel){ChannelClient pipe=Wearable.getChannelClient(context);String id=channel.getPath().substring(PATH.length());
        if(!WatchWire.id(id)||!trusted.test(channel.getNodeId())||!slots.tryAcquire()){pipe.close(channel);return;}channels.add(channel);ScheduledFuture<?> deadline=timer.schedule(()->disconnected(channel),180,TimeUnit.SECONDS);
        worker.execute(()->{PowerManager.WakeLock cpu=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:WatchRequest");cpu.acquire(185000);
            try(DataInputStream in=new DataInputStream(Tasks.await(pipe.getInputStream(channel),12,TimeUnit.SECONDS));DataOutputStream out=new DataOutputStream(Tasks.await(pipe.getOutputStream(channel),12,TimeUnit.SECONDS));ApiClient client=new ApiClient(origin,"",180000)){
                clients.put(channel,client);if(!channels.contains(channel))throw new IOException("Request stopped.");
                try(WatchWire.Frame frame=WatchWire.read(in,WatchWire.PCM_LIMIT)){
                    JSONObject request=new JSONObject(frame.text);String operation=request.getString("operation"),args=request.getString("args"),watchId=request.getString("watchId");
                    if(!trusted.test(channel.getNodeId())||!watchId.equals(context.getSharedPreferences("WatchLink",Context.MODE_PRIVATE).getString("watchId","")))throw new IOException("Complete one-time watch pairing on your phone.");
                    JSONObject challenge=client.json("/api/watch/challenge",new JSONObject().put("watchId",watchId).put("operation",operation).put("args",args));WatchWire.write(out,challenge.toString(),new byte[0],0);
                    try(WatchWire.Frame signed=WatchWire.read(in,0)){
                        JSONObject proof=new JSONObject(signed.text);if(!proof.optString("requestId").equals(challenge.getString("requestId"))||!trusted.test(channel.getNodeId()))throw new IOException("The watch request changed.");
                        if(operation.equals("voice.transcribe")){if(frame.audio.length<11200)throw new IOException("No speech was recorded.");proof.put("data",Base64.encodeToString(VoiceRules.wav(frame.audio),Base64.NO_WRAP));}else if(frame.audio.length!=0)throw new IOException("Unexpected watch audio.");
                        if(operation.equals("voice.speak")){byte[] audio=client.bytes("/api/watch/execute",proof,WatchWire.AUDIO_LIMIT);try{if(!trusted.test(channel.getNodeId()))throw new IOException("Watch disconnected.");WatchWire.write(out,"{}",audio,WatchWire.AUDIO_LIMIT);}finally{java.util.Arrays.fill(audio,(byte)0);}}
                        else{JSONObject result=client.json("/api/watch/execute",proof);if(!trusted.test(channel.getNodeId()))throw new IOException("Watch disconnected.");if(operation.equals("files.phone-download"))result=download(result,id);if(operation.equals("voice.reply"))review.accept(new JSONObject(args).optString("turnId"),result.optJSONObject("action"));WatchWire.write(out,result.toString(),new byte[0],0);}
                    }
                }catch(Exception error){String text=error instanceof ApiClient.Failure&&((ApiClient.Failure)error).status==403?"Finish trusted-watch pairing in JARVIS on your phone.":error instanceof IOException&&error.getMessage()!=null?error.getMessage():"The connection ended. Nothing was resent. Check your phone and laptop.";try{WatchWire.write(out,new JSONObject().put("error",text).toString(),new byte[0],0);}catch(Exception ignored){}}
            }catch(Exception ignored){}finally{deadline.cancel(false);if(cpu.isHeld())cpu.release();clients.remove(channel);channels.remove(channel);slots.release();pipe.close(channel);}
        });
    }
    private JSONObject download(JSONObject result,String request)throws Exception{
        JSONObject file=result.getJSONObject("phoneDownload");String share=file.getString("share"),path=file.getString("path");if(share.length()>80||path.length()>3000)throw new IOException("Invalid file handoff.");
        android.net.Uri url=android.net.Uri.parse(origin+"/api/files/download").buildUpon().appendQueryParameter("share",share).appendQueryParameter("path",path).build();
        android.content.Intent target=new android.content.Intent(context,DownloadActivity.class).putExtra("origin",origin).putExtra("url",url.toString());
        android.app.PendingIntent open=android.app.PendingIntent.getActivity(context,request.hashCode(),target,android.app.PendingIntent.FLAG_IMMUTABLE|android.app.PendingIntent.FLAG_UPDATE_CURRENT);
        context.getSystemService(android.app.NotificationManager.class).notify(request.hashCode(),new android.app.Notification.Builder(context,"watch").setSmallIcon(R.drawable.ic_voice).setContentTitle("Save your selected laptop file").setContentText("Tap to choose where to save "+file.getString("name")).setContentIntent(open).setAutoCancel(true).setVisibility(android.app.Notification.VISIBILITY_PRIVATE).build());
        return new JSONObject().put("message","Open the phone notification to choose where to save the file. Unlock JARVIS there if its session expired.");
    }
    void disconnected(ChannelClient.Channel channel){if(channels.remove(channel)){ApiClient client=clients.get(channel);if(client!=null)client.close();Wearable.getChannelClient(context).close(channel);}}
    @Override public void close(){for(ChannelClient.Channel channel:channels)disconnected(channel);worker.shutdownNow();timer.shutdownNow();}
}
