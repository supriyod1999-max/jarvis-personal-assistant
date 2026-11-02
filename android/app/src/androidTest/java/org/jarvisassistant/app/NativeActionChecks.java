package org.jarvisassistant.app;
import android.content.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
public class NativeActionChecks {
    @Test public void modelActionsOnlyOpenFixedProtectedScreens()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());String origin="https://fixture.tailtest.ts.net",request=java.util.UUID.randomUUID().toString();
        JSONObject action=new JSONObject().put("kind","jarvis-action").put("version",1).put("requestId",request).put("id","computer.unlock").put("url","https://untrusted.invalid");
        assertEquals("computer.unlock",NativeActions.fromJson(action,request));assertNull(NativeActions.fromJson(action,java.util.UUID.randomUUID().toString()));
        Intent unlock=NativeActions.intent(context,origin,"computer.unlock");assertEquals(ComputerActivity.class.getName(),unlock.getComponent().getClassName());assertEquals("windows.unlock",unlock.getStringExtra("requestedOperation"));assertNull(unlock.getData());assertFalse(unlock.hasExtra("signature"));
        Intent media=NativeActions.intent(context,origin,"media.next");assertEquals(RemoteActivity.class.getName(),media.getComponent().getClassName());assertEquals("next",media.getStringExtra("requestedMedia"));assertNull(media.getStringExtra("session"));
        action.put("id","shell.run");assertNull(NativeActions.fromJson(action,request));assertFalse(NativeActions.known("media.shutdown"));
        assertEquals(AppUpdatesActivity.class.getName(),NativeActions.intent(context,origin,"app.updates").getComponent().getClassName());
    }
}
