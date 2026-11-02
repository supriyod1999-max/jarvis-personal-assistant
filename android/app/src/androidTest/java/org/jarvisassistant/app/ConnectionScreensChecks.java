package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.os.SystemClock;
import android.view.*;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.atomic.AtomicInteger;

/** No real network, pairing, biometric approval or account data. */
public class ConnectionScreensChecks {
    static final String HOST="https://fixture.tailtest.ts.net";static final AtomicInteger reads=new AtomicInteger(),writes=new AtomicInteger();
    @BeforeClass public static void fixture(){URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 200;}public OutputStream getOutputStream(){writes.incrementAndGet();throw new AssertionError("Preview must not write");}public InputStream getInputStream(){reads.incrementAndGet();String body=url.getPath().equals("/api/computer/status")?"{\"computerId\":\"00000000-0000-4000-8000-000000000001\",\"accountSid\":\"S-1-5-21-111-222-333-1001\",\"computerName\":\"Studio laptop\",\"available\":true,\"locked\":false,\"lockReady\":true,\"unlockReady\":false,\"devices\":[]}":"{\"ok\":true,\"watches\":[]}";return new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8));}};}}:null);}
    private boolean text(View view,String value){if(view instanceof TextView&&((TextView)view).getText().toString().contains(value))return true;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)if(text(((ViewGroup)view).getChildAt(i),value))return true;return false;}
    private void capture(Activity activity,String name){try{View view=activity.getWindow().getDecorView();Bitmap bitmap=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));try(FileOutputStream out=new FileOutputStream(new File(activity.getExternalFilesDir(null),name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}catch(Exception error){throw new AssertionError(error);}}
    @Test public void laptopAutomaticallyRechecksWithoutCreatingKeysOrPostingActions()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());reads.set(0);writes.set(0);String before=WindowsApprovalSigner.existingDeviceId();
        try(ActivityScenario<ComputerActivity> scenario=ActivityScenario.launch(new Intent(context,ComputerActivity.class).putExtra("origin",HOST))){long end=SystemClock.elapsedRealtime()+6000;while(reads.get()<1&&SystemClock.elapsedRealtime()<end)Thread.sleep(100);Thread.sleep(300);scenario.onActivity(activity->{assertTrue(text(activity.getWindow().getDecorView(),"Studio laptop"));assertTrue(text(activity.getWindow().getDecorView(),"Windows unlocked"));assertTrue(text(activity.getWindow().getDecorView(),"Pair this phone"));capture(activity,"laptop-connections");});int first=reads.get();Thread.sleep(4500);assertTrue("Status must refresh without a manual button",reads.get()>first);}
        assertEquals(before,WindowsApprovalSigner.existingDeviceId());assertEquals(0,writes.get());assertFalse(VoiceService.running);
    }
    @Test public void watchConnectionScreenExplainsOneTimeTrustAndKeepsVoiceOff()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());context.getSharedPreferences("WatchLink",Context.MODE_PRIVATE).edit().clear().commit();
        try(ActivityScenario<WatchConnectionsActivity> scenario=ActivityScenario.launch(new Intent(context,WatchConnectionsActivity.class).putExtra("origin",HOST))){Thread.sleep(1200);scenario.onActivity(activity->{assertTrue(text(activity.getWindow().getDecorView(),"Your watch"));assertTrue(text(activity.getWindow().getDecorView(),"Pair watch"));assertTrue(text(activity.getWindow().getDecorView(),"Ready from your wrist"));capture(activity,"watch-connections");});}assertFalse(VoiceService.running);
    }
}
