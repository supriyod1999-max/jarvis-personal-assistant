package org.jarvisassistant.app;
import android.app.job.*;
import android.os.*;
import java.util.concurrent.*;

public final class AppUpdateJob extends JobService {
    private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile AppReleases.Source source;private volatile boolean stopped;
    @Override public boolean onStartJob(JobParameters params){if(!AppUpdates.working.compareAndSet(false,true))return false;stopped=false;
        worker.execute(()->{boolean retry=false;PowerManager.WakeLock cpu=getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:AppUpdate");cpu.acquire(10*60*1000L);
            try(AppReleases.Source client=new AppReleases.Source(this,false)){source=client;AppReleases.Release release=AppUpdates.check(this,client);if(release!=null&&!stopped){AppUpdates.fetch(this,client,release);if(!stopped){boolean automatic=AppReleases.preferences(this).getBoolean("automatic",false);if(automatic&&getPackageManager().canRequestPackageInstalls())AppUpdates.install(this,release,true);else AppUpdates.notifyReady(this,"The verified update is ready. Tap to review installation.");}}}
            catch(Exception e){retry=!stopped;AppUpdates.status(this,"Update check or download could not finish. Check the private connection and try again. Nothing unverified was installed.");}
            finally{source=null;AppUpdates.working.set(false);if(cpu.isHeld())cpu.release();if(!stopped)jobFinished(params,retry);}
        });return true;
    }
    @Override public boolean onStopJob(JobParameters params){stopped=true;AppReleases.Source client=source;if(client!=null)client.close();return true;}
    @Override public void onDestroy(){stopped=true;AppReleases.Source client=source;if(client!=null)client.close();worker.shutdownNow();super.onDestroy();}
}
