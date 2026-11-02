package org.jarvisassistant.app;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.Build;
/** Owner-approved companion restoration. Never starts voice or a microphone. */
public final class WatchConnectionRestore extends BroadcastReceiver {
    static void restore(Context context){android.content.SharedPreferences prefs=context.getSharedPreferences("WatchLink",Context.MODE_PRIVATE);if(!prefs.getBoolean("connectionEnabled",false)||prefs.getString("approvedId","").isEmpty()||!prefs.getString("approvedId","").equals(prefs.getString("watchId",""))||WatchBridgeService.current!=null)return;if(Build.VERSION.SDK_INT>=31&&context.checkSelfPermission(android.Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED)return;if(Build.VERSION.SDK_INT>=33&&context.checkSelfPermission(android.Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED)return;try{context.startForegroundService(new Intent(context,WatchBridgeService.class));}catch(RuntimeException ignored){/* Connection screen offers Connect if Android defers startup. */}}
    @Override public void onReceive(Context context,Intent intent){if(Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())||Intent.ACTION_MY_PACKAGE_REPLACED.equals(intent.getAction()))restore(context);}
}
