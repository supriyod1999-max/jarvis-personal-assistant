package org.jarvisassistant.app;
import android.content.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
public class WatchUiChecks {
    @Test public void updatesStartOffAndUseTheWatchScreen()throws Exception{
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());context.getSharedPreferences("JarvisUpdates",Context.MODE_PRIVATE).edit().clear().commit();
        android.app.Activity activity=instrumentation.startActivitySync(new Intent(context,AppUpdatesActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{instrumentation.runOnMainSync(()->activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));Thread.sleep(500);android.view.accessibility.AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();assertNotNull(root);assertFalse(root.findAccessibilityNodeInfosByText("JARVIS updates").isEmpty());assertFalse(AppReleases.preferences(context).getBoolean("automatic",false));assertFalse(WatchVoiceService.running);android.graphics.Bitmap screenshot=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(screenshot);try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"watch-updates.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screenshot.recycle();}finally{instrumentation.runOnMainSync(activity::finish);}
    }
    @Test public void openingTheWatchAppLeavesMicrophoneOff()throws Exception{
        android.app.Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        android.app.Activity activity=instrumentation.startActivitySync(new Intent(context,WatchActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        instrumentation.runOnMainSync(()->activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));
        android.view.accessibility.AccessibilityNodeInfo root=null;long until=android.os.SystemClock.elapsedRealtime()+6000;while(root==null&&android.os.SystemClock.elapsedRealtime()<until){Thread.sleep(200);root=instrumentation.getUiAutomation().getRootInActiveWindow();}assertNotNull(root);assertFalse(root.findAccessibilityNodeInfosByText("Talk to JARVIS").isEmpty());assertFalse(WatchVoiceService.running);
        assertFalse(root.findAccessibilityNodeInfosByText("Voice").isEmpty());
        // Only this isolated, empty preview relaxes screenshot protection for QA.
        instrumentation.runOnMainSync(()->activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));Thread.sleep(600);
        android.graphics.Bitmap screenshot=instrumentation.getUiAutomation().takeScreenshot();assertNotNull(screenshot);
        try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"watch-home.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screenshot.recycle();
    }
}
