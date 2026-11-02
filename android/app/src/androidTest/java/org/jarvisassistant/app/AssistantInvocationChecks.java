package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.media.*;
import android.os.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;

/** Actual Android assistant dispatch and microphone lifecycle, isolated preview only. */
public class AssistantInvocationChecks {
    private void shell(Instrumentation instrumentation,String command)throws Exception{try(ParcelFileDescriptor fd=instrumentation.getUiAutomation().executeShellCommand(command);java.io.InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(fd)){while(in.read()!=-1){}}}
    @Test public void systemInvocationStartsRecordingWithoutWakeAndDismissalStopsIt()throws Exception{
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        // Public synthetic origin only; no credentials, real pairing or owner data.
        context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).edit().putString("origin","https://synthetic.tailtest.ts.net").commit();
        instrumentation.getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);
        shell(instrumentation,"cmd role remove-role-holder android.app.role.ASSISTANT org.jarvisassistant.app.design 0");
        shell(instrumentation,"cmd role add-role-holder android.app.role.ASSISTANT org.jarvisassistant.app.design 0");
        long end=SystemClock.elapsedRealtime()+5000;while((!JarvisAssistant.selected(context)||!JarvisAssistant.connected())&&SystemClock.elapsedRealtime()<end)Thread.sleep(100);assertTrue("Assistant service must be bound before system invocation",JarvisAssistant.connected());
        Instrumentation.ActivityMonitor monitor=instrumentation.addMonitor(AssistantConversationActivity.class.getName(),null,false);shell(instrumentation,"input keyevent KEYCODE_ASSIST");Activity activity=monitor.waitForActivityWithTimeout(7000);
        try{assertNotNull("System assistant invocation must launch the conversation",activity);AudioManager audio=context.getSystemService(AudioManager.class);end=SystemClock.elapsedRealtime()+5000;while(audio.getActiveRecordingConfigurations().isEmpty()&&SystemClock.elapsedRealtime()<end)Thread.sleep(100);assertFalse("No wake phrase is needed to start capture",audio.getActiveRecordingConfigurations().isEmpty());assertFalse("Assistant must not enable persistent wake listening",VoiceService.running);
            android.view.accessibility.AccessibilityNodeInfo root=instrumentation.getUiAutomation().getRootInActiveWindow();assertNotNull(root);assertFalse(root.findAccessibilityNodeInfosByText("Speak naturally. No wake phrase needed.").isEmpty());
            instrumentation.runOnMainSync(()->activity.getWindow().clearFlags(android.view.WindowManager.LayoutParams.FLAG_SECURE));Thread.sleep(500);android.graphics.Bitmap screenshot=instrumentation.getUiAutomation().takeScreenshot();try(java.io.FileOutputStream out=new java.io.FileOutputStream(new java.io.File(context.getExternalFilesDir(null),"assistant-invocation.png"))){screenshot.compress(android.graphics.Bitmap.CompressFormat.PNG,100,out);}screenshot.recycle();
            instrumentation.runOnMainSync(activity::finish);end=SystemClock.elapsedRealtime()+5000;while(!audio.getActiveRecordingConfigurations().isEmpty()&&SystemClock.elapsedRealtime()<end)Thread.sleep(100);assertTrue("Dismissal releases the microphone",audio.getActiveRecordingConfigurations().isEmpty());
        }finally{if(activity!=null)instrumentation.runOnMainSync(activity::finish);instrumentation.removeMonitor(monitor);context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).edit().remove("origin").commit();}
    }
}
