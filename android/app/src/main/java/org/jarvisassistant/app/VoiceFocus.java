package org.jarvisassistant.app;
import android.content.Context;
import org.json.JSONObject;
import java.util.UUID;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Coordinates responses only. Never starts a microphone or shares a transcript. */
final class VoiceFocus implements AutoCloseable {
    private final Context context;private final String origin;private final Runnable lost;
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean closed=new AtomicBoolean();private volatile String token;
    VoiceFocus(Context context,String origin,Runnable lost){this.context=context;this.origin=origin;this.lost=lost;}
    boolean claim()throws Exception{
        // Existing non-enrolled installations retain explicit local voice functionality.
        if(!CompanionClient.enrolled(context,origin))return true;
        try(CompanionClient api=new CompanionClient(context,origin)){
            JSONObject result=api.json("voice.claim",new JSONObject().put("attempt",UUID.randomUUID().toString()),null);
            if(!result.optBoolean("granted"))return false;token=result.getString("token");
        }
        if(closed.get()){release();return false;}
        worker.scheduleWithFixedDelay(()->{if(closed.get())return;try(CompanionClient api=new CompanionClient(context,origin)){if(!api.json("voice.renew",new JSONObject().put("token",token),null).optBoolean("granted"))throw new IllegalStateException();}catch(Exception unavailable){if(!closed.get()){lost.run();close();}}},4,4,TimeUnit.SECONDS);return true;
    }
    private void release(){String saved=token;token=null;if(saved==null)return;try(CompanionClient api=new CompanionClient(context,origin)){api.json("voice.release",new JSONObject().put("token",saved),null);}catch(Exception ignored){/* Bounded lease expires if disconnected. */}}
    @Override public void close(){if(!closed.compareAndSet(false,true))return;worker.shutdownNow();new Thread(this::release,"Release voice focus").start();}
}
