package org.jarvisassistant.app;

import android.app.job.*;
import android.os.*;
import java.util.concurrent.ConcurrentHashMap;

/** Android 14+ user-initiated data transfer; independent of the activity/task. */
@android.annotation.TargetApi(34)
public final class TransferJobService extends JobService {
    private final ConcurrentHashMap<Integer,TransferEngine> engines=new ConcurrentHashMap<>();
    @Override public boolean onStartJob(JobParameters parameters){
        String id=parameters.getExtras().getString("transfer");
        try{
            setNotification(parameters,parameters.getJobId(),TransferJobs.notification(this,new TransferStore(this).get(id)),JOB_END_NOTIFICATION_POLICY_DETACH);
            TransferEngine engine=new TransferEngine(this,id,item->{try{if(engines.containsKey(parameters.getJobId()))setNotification(parameters,parameters.getJobId(),TransferJobs.notification(this,item),JOB_END_NOTIFICATION_POLICY_DETACH);}catch(Exception ignored){}});
            engines.put(parameters.getJobId(),engine);
            new Thread(()->{engine.run();new Handler(getMainLooper()).post(()->{if(engines.remove(parameters.getJobId(),engine))jobFinished(parameters,false);});},"JARVIS file transfer").start();return true;
        }catch(Exception ignored){jobFinished(parameters,false);return false;}
    }
    @Override public boolean onStopJob(JobParameters parameters){
        TransferEngine engine=engines.remove(parameters.getJobId());if(engine!=null)engine.stop();
        try{String state=new TransferStore(this).get(parameters.getExtras().getString("transfer")).getString("state");return !TransferStore.terminal(state)&&!state.equals("paused")&&!state.equals("auth");}catch(Exception ignored){return false;}
    }
    @Override public void onDestroy(){for(TransferEngine engine:engines.values())engine.stop();engines.clear();super.onDestroy();}
}
