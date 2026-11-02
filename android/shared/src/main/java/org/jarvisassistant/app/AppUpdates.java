package org.jarvisassistant.app;
import android.app.*;
import android.app.job.*;
import android.content.*;
import android.content.pm.*;
import android.os.*;
import java.io.*;
import java.util.concurrent.atomic.AtomicBoolean;

/** Update jobs are opted into by the owner. They never start a microphone. */
final class AppUpdates {
    static final int PERIODIC=18341,NOW=18342,NOTIFICATION=18343;
    static final AtomicBoolean working=new AtomicBoolean();
    static void status(Context context,String text){AppReleases.preferences(context).edit().putString("status",text).apply();}
    static void schedule(Context context,boolean automatic){
        AppReleases.preferences(context).edit().putBoolean("automatic",automatic).apply();JobScheduler jobs=context.getSystemService(JobScheduler.class);
        if(!automatic){jobs.cancel(PERIODIC);return;}
        JobInfo job=new JobInfo.Builder(PERIODIC,new ComponentName(context,AppUpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED).setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).setPeriodic(6*60*60*1000L).setPersisted(true).build();
        if(jobs.schedule(job)!=JobScheduler.RESULT_SUCCESS)status(context,"Android could not schedule update checks. Use Check now.");
    }
    static void downloadNow(Context context){JobInfo job=new JobInfo.Builder(NOW,new ComponentName(context,AppUpdateJob.class)).setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY).setMinimumLatency(1).setBackoffCriteria(15*60*1000L,JobInfo.BACKOFF_POLICY_EXPONENTIAL).build();if(context.getSystemService(JobScheduler.class).schedule(job)==JobScheduler.RESULT_SUCCESS)status(context,"Update download scheduled. You can close JARVIS; a notification will show the result.");else status(context,"Android could not start the download. Try again from this screen.");}
    static AppReleases.Release check(Context context,AppReleases.Source source)throws Exception{
        AppReleases.Release release=AppReleases.Release.from(source.manifest(),AppReleases.variant(context));
        if(!release.packageName.equals(context.getPackageName()))throw new IOException("This release is for a different app. Nothing was installed.");
        if(!UpdatePolicy.newer(AppReleases.installed(context),release.code)){AppReleases.preferences(context).edit().remove("available").apply();status(context,"You're up to date.");return null;}
        if(release.minimumSdk>Build.VERSION.SDK_INT)throw new IOException("The new release needs a newer Android version.");
        AppReleases.preferences(context).edit().putString("available",release.json().toString()).apply();status(context,"JARVIS "+release.name+" is available · "+Math.round(release.bytes/1024.0/1024)+" MB.");return release;
    }
    static void fetch(Context context,AppReleases.Source source,AppReleases.Release release)throws Exception{
        File temporary=new File(context.getCacheDir(),"jarvis-update-download.part");
        try{source.download(release,temporary,percent->status(context,"Downloading JARVIS "+release.name+" · "+percent+"%"));AppReleases.validate(context,release,temporary);File destination=AppReleases.apk(context);if(destination.exists()&&!destination.delete())throw new IOException("Close the previous update and try again.");if(!temporary.renameTo(destination))throw new IOException("Could not finish saving the verified update.");status(context,"JARVIS "+release.name+" downloaded and verified.");}
        finally{if(temporary.exists())temporary.delete();}
    }
    static void install(Context context,AppReleases.Release release,boolean automatic)throws Exception{
        File file=AppReleases.apk(context);AppReleases.validate(context,release,file);
        if(!context.getPackageManager().canRequestPackageInstalls())throw new IOException("Allow JARVIS to install its own updates from the Updates screen first.");
        PackageInstaller installer=context.getPackageManager().getPackageInstaller();android.content.SharedPreferences preferences=AppReleases.preferences(context);int prior=preferences.getInt("session",-1);
        if(prior>=0&&installer.getSessionInfo(prior)!=null){if(automatic){status(context,"An update is already waiting for Android. Open Updates to continue.");return;}try{installer.abandonSession(prior);}catch(Exception ignored){}}
        PackageInstaller.SessionParams params=new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);params.setAppPackageName(context.getPackageName());params.setSize(release.bytes);params.setInstallReason(PackageManager.INSTALL_REASON_USER);
        if(Build.VERSION.SDK_INT>=31)params.setRequireUserAction(automatic?PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED:PackageInstaller.SessionParams.USER_ACTION_REQUIRED);
        int session=installer.createSession(params);
        try(PackageInstaller.Session target=installer.openSession(session)){
            try(InputStream input=new FileInputStream(file);OutputStream output=target.openWrite("base.apk",0,release.bytes)){byte[] bytes=new byte[32768];int n;while((n=input.read(bytes))!=-1)output.write(bytes,0,n);target.fsync(output);}
            Intent result=new Intent(context,AppUpdateResult.class).setAction(context.getPackageName()+".UPDATE_RESULT");
            int flags=PendingIntent.FLAG_UPDATE_CURRENT;if(Build.VERSION.SDK_INT>=31)flags|=PendingIntent.FLAG_MUTABLE;
            PendingIntent callback=PendingIntent.getBroadcast(context,session,result,flags);
            preferences.edit().putInt("session",session).putLong("pendingVersion",release.code).putString("status","Android is installing the verified update. It may ask for confirmation.").apply();
            target.commit(callback.getIntentSender());
        }catch(Exception e){try{installer.abandonSession(session);}catch(Exception ignored){}preferences.edit().remove("session").apply();throw e;}
    }
    static void notifyReady(Context context,String text){
        android.content.SharedPreferences preferences=AppReleases.preferences(context);AppReleases.Release release=AppReleases.cached(context);String key=release==null?text:release.hash+":"+text;
        if(key.equals(preferences.getString("notified","")))return;
        PendingIntent open=PendingIntent.getActivity(context,NOTIFICATION,new Intent(context,AppUpdatesActivity.class),PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);
        notify(context,text,open);preferences.edit().putString("notified",key).apply();
    }
    static void notify(Context context,String text,PendingIntent open){NotificationManager manager=context.getSystemService(NotificationManager.class);manager.createNotificationChannel(new NotificationChannel("app-updates","JARVIS app updates",NotificationManager.IMPORTANCE_DEFAULT));int icon=context.getApplicationInfo().icon;try{manager.notify(NOTIFICATION,new Notification.Builder(context,"app-updates").setSmallIcon(icon).setContentTitle("JARVIS update").setContentText(text).setContentIntent(open).setAutoCancel(true).setVisibility(Notification.VISIBILITY_PRIVATE).build());}catch(SecurityException ignored){status(context,"Open Updates to finish installing. Notifications are off.");}}
}
