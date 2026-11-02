package org.jarvisassistant.app;

import android.app.*;
import android.app.job.*;
import android.content.*;
import android.net.Uri;
import android.os.*;
import android.provider.DocumentsContract;
import org.json.JSONObject;
import java.util.UUID;

final class TransferJobs {
    static final String CHANNEL="jarvis-file-transfers";
    static JSONObject create(Context context,String origin,String direction,String name,Uri uri,long size)throws Exception{
        android.content.SharedPreferences preferences=context.getSharedPreferences("transfer-jobs",Context.MODE_PRIVATE);
        int job=preferences.getInt("next",20000)+1;preferences.edit().putInt("next",job).commit();
        return new JSONObject().put("id",UUID.randomUUID().toString()).put("job",job).put("origin",EndpointPolicy.connection(origin)).put("direction",direction).put("name",name).put("uri",uri.toString()).put("size",size).put("offset",0).put("state","queued").put("message","Queued");
    }
    static void start(Context context,JSONObject item)throws Exception{
        TransferStore store=new TransferStore(context);store.patch(item.getString("id"),"state","queued","message","Queued");
        if(Build.VERSION.SDK_INT>=34){
            PersistableBundle extras=new PersistableBundle();extras.putString("transfer",item.getString("id"));
            JobInfo.Builder job=new JobInfo.Builder(item.getInt("job"),new ComponentName(context,TransferJobService.class)).setExtras(extras).setUserInitiated(true).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setPersisted(true).setBackoffCriteria(10000,JobInfo.BACKOFF_POLICY_EXPONENTIAL);
            long size=item.optLong("size",-1);if(size>=0)job.setEstimatedNetworkBytes(item.getString("direction").equals("download")?size:0,item.getString("direction").equals("upload")?size:0);
            if(context.getSystemService(JobScheduler.class).schedule(job.build())!=JobScheduler.RESULT_SUCCESS){store.patch(item.getString("id"),"state","paused","message","Tap Resume while JARVIS is open");throw new IllegalStateException("Android could not schedule this transfer. Tap Resume.");}
        }else context.startForegroundService(new Intent(context,TransferService.class).putExtra("transfer",item.getString("id")));
    }
    static Notification notification(Context context,JSONObject item)throws Exception{
        NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel(CHANNEL,"File transfers",NotificationManager.IMPORTANCE_LOW));
        String id=item.getString("id"),state=item.getString("state");int job=item.getInt("job");
        PendingIntent open=PendingIntent.getActivity(context,job,new Intent(context,TransfersActivity.class),PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE);
        Notification.Builder note=new Notification.Builder(context,CHANNEL).setSmallIcon(android.R.drawable.stat_sys_download).setContentTitle("JARVIS file transfer").setContentText(item.optString("message","Transferring")).setContentIntent(open).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE).setOngoing(!TransferStore.terminal(state));
        long size=item.optLong("size",-1);if(size>0)note.setProgress(100,FileTransferPolicy.progress(item.optLong("offset"),size),false);else if(!TransferStore.terminal(state))note.setProgress(0,0,true);
        if(!TransferStore.terminal(state)){
            Intent pause=new Intent(context,TransferActions.class).setAction("pause").setData(Uri.parse("jarvis-transfer:"+id)).putExtra("transfer",id);
            note.addAction(new Notification.Action.Builder(null,"Pause",PendingIntent.getBroadcast(context,job,pause,PendingIntent.FLAG_UPDATE_CURRENT|PendingIntent.FLAG_IMMUTABLE)).build());
        }
        return note.build();
    }
    static void pause(Context context,String id)throws Exception{
        TransferStore store=new TransferStore(context);JSONObject item=store.get(id);if(TransferStore.terminal(item.getString("state")))return;
        store.patch(id,"state","paused","message","Paused — open Transfers to resume");stop(context,item);
        context.getSystemService(NotificationManager.class).notify(item.getInt("job"),notification(context,store.get(id)));
    }
    static void stop(Context context,JSONObject item)throws Exception{
        TransferEngine engine=TransferEngine.RUNNING.get(item.getString("id"));if(engine!=null)engine.stop();
        if(Build.VERSION.SDK_INT>=34)context.getSystemService(JobScheduler.class).cancel(item.getInt("job"));
    }
    static void cancel(Context context,String id)throws Exception{
        TransferStore store=new TransferStore(context);JSONObject item=store.get(id);if(item.getString("state").equals("complete"))return;
        store.patch(id,"state","paused","message","Stopping transfer","cancelRequested",true);stop(context,item);
        // The explicit Cancel tap schedules durable, idempotent cleanup. Offline
        // cleanup waits for reconnection and can never resume sending file bytes.
        start(context,store.get(id));
    }
}
