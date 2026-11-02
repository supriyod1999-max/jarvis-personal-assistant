package org.jarvisassistant.app;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;

/** Run only after selecting the isolated preview as assistant on the emulator. */
public class AssistantRoleChecks {
    @Test public void selectedAssistantShowsItsOwnGenericSessionWithoutStartingMicrophone()throws Exception{
        android.content.Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        // Instrumentation force-stops the target before launch; select only now
        // so Android binds the assistant into this running preview process.
        try(android.os.ParcelFileDescriptor fd=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand("cmd role add-role-holder android.app.role.ASSISTANT org.jarvisassistant.app.design 0");java.io.InputStream in=new android.os.ParcelFileDescriptor.AutoCloseInputStream(fd)){while(in.read()!=-1){}}
        long end=android.os.SystemClock.elapsedRealtime()+5000;boolean[] shown={false};
        while(!shown[0]&&android.os.SystemClock.elapsedRealtime()<end){InstrumentationRegistry.getInstrumentation().runOnMainSync(()->{if(JarvisAssistant.selected(context))shown[0]=JarvisAssistant.showWake();});if(!shown[0])Thread.sleep(100);}
        assertTrue("Selected assistant must bind and accept showSession",shown[0]);Thread.sleep(700);
        android.view.accessibility.AccessibilityNodeInfo root=InstrumentationRegistry.getInstrumentation().getUiAutomation().getRootInActiveWindow();assertNotNull(root);assertFalse(root.findAccessibilityNodeInfosByText("I'm here.").isEmpty());assertFalse(VoiceService.running);
    }
}
