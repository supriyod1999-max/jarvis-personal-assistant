package org.jarvisassistant.app;
import android.content.*;
import android.graphics.Bitmap;
import android.view.*;
import android.widget.TextView;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;

/** Static native UI only: no network, approval prompt or Windows input. */
public class RemoteUiChecks {
    private boolean text(View view,String expected){if(view instanceof TextView&&((TextView)view).getText().toString().equals(expected))return true;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)if(text(((ViewGroup)view).getChildAt(i),expected))return true;return false;}
    private void capture(Context context,String name)throws Exception{Bitmap image=InstrumentationRegistry.getInstrumentation().getUiAutomation().takeScreenshot();try(OutputStream output=new FileOutputStream(new File(context.getExternalFilesDir(null),name))){assertTrue(image.compress(Bitmap.CompressFormat.PNG,100,output));}image.recycle();}
    @Test public void rendersRemoteAndTransferControlsWithoutActivatingEither()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());
        try(ActivityScenario<RemoteActivity> scenario=ActivityScenario.launch(new Intent(context,RemoteActivity.class).putExtra("origin","https://fixture.tail-test.ts.net"))){scenario.onActivity(activity->{activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);assertTrue(text(activity.getWindow().getDecorView(),"Start control"));assertTrue(text(activity.getWindow().getDecorView(),"Media & volume"));assertTrue(text(activity.getWindow().getDecorView(),"Keyboard"));});Thread.sleep(250);capture(context,"remote-control.png");}
        try(ActivityScenario<TransfersActivity> scenario=ActivityScenario.launch(TransfersActivity.class)){scenario.onActivity(activity->{activity.getWindow().clearFlags(WindowManager.LayoutParams.FLAG_SECURE);assertTrue(text(activity.getWindow().getDecorView(),"Transfers"));});Thread.sleep(250);capture(context,"background-transfers.png");}
    }
}
