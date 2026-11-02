package org.jarvisassistant.app;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import org.json.JSONObject;

/** Android 9–13 fallback only. Never starts voice or bypasses user Stop. */
public final class TransferService extends Service {
    private final java.util.concurrent.ConcurrentHashMap<String,TransferEngine> engines=new java.util.concurrent.ConcurrentHashMap<>();
    @Override public int onStartCommand(Intent intent,int flags,int startId){
        if(intent==null)return START_NOT_STICKY;
        String id=intent.getStringExtra("transfer");
        try{
            JSONObject item=new TransferStore(this).get(id);startForeground(item.getInt("job"),TransferJobs.notification(this,item));
            TransferEngine engine=new TransferEngine(this,id,value->{try{getSystemService(android.app.NotificationManager.class).notify(value.getInt("job"),TransferJobs.notification(this,value));}catch(Exception ignored){}});
            if(engines.putIfAbsent(id,engine)!=null)return START_REDELIVER_INTENT;
            new Thread(()->{engine.run();engines.remove(id,engine);if(engines.isEmpty()){stopForeground(STOP_FOREGROUND_DETACH);stopSelf();}},"JARVIS file transfer").start();
        }catch(Exception ignored){if(engines.isEmpty())stopSelf();}return START_REDELIVER_INTENT;
    }
    @Override public IBinder onBind(Intent intent){return null;}
    @Override public void onDestroy(){for(TransferEngine engine:engines.values())engine.stop();engines.clear();super.onDestroy();}
}
