package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.content.pm.PackageInstaller;
import android.os.Build;

/** Receives only the installer-owned PendingIntent for our recorded session. */
public final class AppUpdateResult extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){int session=intent.getIntExtra(PackageInstaller.EXTRA_SESSION_ID,-1);android.content.SharedPreferences preferences=AppReleases.preferences(context);if(session<0||session!=preferences.getInt("session",-2))return;int status=intent.getIntExtra(PackageInstaller.EXTRA_STATUS,PackageInstaller.STATUS_FAILURE);
        if(status==PackageInstaller.STATUS_PENDING_USER_ACTION){
            Intent confirmation=Build.VERSION.SDK_INT>=33?intent.getParcelableExtra(Intent.EXTRA_INTENT,Intent.class):intent.getParcelableExtra(Intent.EXTRA_INTENT);
            AppUpdates.status(context,"Android needs your confirmation. Open Updates to finish installation.");
            if(confirmation!=null){confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);AppUpdatesActivity visible=AppUpdatesActivity.visible;
                if(visible!=null){visible.startActivity(confirmation);return;}
                PendingIntent open=PendingIntent.getActivity(context,18344,confirmation,PendingIntent.FLAG_IMMUTABLE|PendingIntent.FLAG_UPDATE_CURRENT);AppUpdates.notify(context,"Tap to confirm the verified JARVIS update.",open);
            }
        }else if(status==PackageInstaller.STATUS_SUCCESS){preferences.edit().remove("session").remove("available").putString("status","JARVIS updated successfully. Your saved connection and pairing were preserved.").apply();AppReleases.apk(context).delete();context.getSystemService(NotificationManager.class).cancel(AppUpdates.NOTIFICATION);}
        else{preferences.edit().remove("session").apply();AppUpdates.status(context,"Android did not install the update. Open Updates to review and try again; nothing was resent automatically.");}
    }
}
