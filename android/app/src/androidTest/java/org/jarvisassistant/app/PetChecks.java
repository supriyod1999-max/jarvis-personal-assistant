package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.graphics.*;
import android.view.*;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.lang.reflect.*;

/** Native synthetic-device checks. No owner origin, enrollment, media or message data. */
public class PetChecks {
    private Context context;private static final String HOST="https://fixture.tailtest.ts.net";
    @Before public void before(){InstrumentationRegistry.getInstrumentation().setInTouchMode(true);context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.RECORD_AUDIO);InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.CAMERA);context.getSharedPreferences("PetModeActivity",Context.MODE_PRIVATE).edit().clear().commit();}
    private Object field(Object object,String name){try{Field field=object.getClass().getDeclaredField(name);field.setAccessible(true);return field.get(object);}catch(Exception error){throw new AssertionError(error);}}
    private void call(Object object,String name){try{Method method=object.getClass().getDeclaredMethod(name);method.setAccessible(true);method.invoke(object);}catch(Exception error){throw new AssertionError(error);}}
    private boolean text(View root,String value){if(root instanceof TextView&&((TextView)root).getText().toString().contains(value))return true;if(root instanceof ViewGroup)for(int n=0;n<((ViewGroup)root).getChildCount();n++)if(text(((ViewGroup)root).getChildAt(n),value))return true;return false;}
    private void screenshot(Activity activity,String name){try{View view=activity.getWindow().getDecorView();Bitmap bitmap=Bitmap.createBitmap(view.getWidth(),view.getHeight(),Bitmap.Config.ARGB_8888);view.draw(new Canvas(bitmap));try(FileOutputStream out=new FileOutputStream(new File(context.getExternalFilesDir(null),name+".png"))){bitmap.compress(Bitmap.CompressFormat.PNG,100,out);}bitmap.recycle();}catch(Exception error){throw new AssertionError(error);}}
    @Test public void petStartsGrantedSensorsAndReleasesOnPause()throws Exception{
        try(ActivityScenario<PetModeActivity> scenario=ActivityScenario.launch(new Intent(context,PetModeActivity.class).putExtra("origin",HOST))){Thread.sleep(500);scenario.onActivity(activity->{assertNotNull(field(activity,"camera"));assertTrue(((PetTalkSession)field(activity,"conversation")).running());assertFalse(((PetCameraShare)field(activity,"sharing")).running());assertFalse(((PetTalkSession)field(activity,"conversation")).ownerMode());assertTrue((activity.getWindow().getAttributes().flags&WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)!=0);screenshot(activity,"pet-open");call(activity,"controls");Dialog sheet=(Dialog)field(activity,"sheet");assertTrue(sheet.isShowing());assertTrue(text(sheet.getWindow().getDecorView(),"Enable camera check-ins"));assertTrue(text(sheet.getWindow().getDecorView(),"Private messages"));sheet.dismiss();});scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);scenario.onActivity(activity->{assertNull(field(activity,"camera"));assertFalse(((PetTalkSession)field(activity,"conversation")).running());});}
    }
    @Test public void grantedLocalCameraStartsAndReleasesWhenPetLeavesForeground()throws Exception{
        InstrumentationRegistry.getInstrumentation().getUiAutomation().grantRuntimePermission(context.getPackageName(),android.Manifest.permission.CAMERA);
        try(ActivityScenario<PetModeActivity> scenario=ActivityScenario.launch(new Intent(context,PetModeActivity.class).putExtra("origin",HOST))){Thread.sleep(500);scenario.onActivity(activity->{assertNotNull(field(activity,"camera"));});long end=android.os.SystemClock.elapsedRealtime()+12000;boolean[] open={false};while(!open[0]&&android.os.SystemClock.elapsedRealtime()<end){Thread.sleep(150);scenario.onActivity(activity->open[0]=(Boolean)field(activity,"cameraOpen"));}assertTrue("The synthetic camera must actually open",open[0]);scenario.onActivity(activity->{assertFalse(((PetCameraShare)field(activity,"sharing")).running());screenshot(activity,"pet-local-camera");});scenario.moveToState(androidx.lifecycle.Lifecycle.State.CREATED);scenario.onActivity(activity->{assertNull(field(activity,"camera"));assertFalse((Boolean)field(activity,"cameraOpen"));});}
    }
    @Test public void visitorComposerDoesNotRecordOnEntryAndOwnerInboxStaysLocked()throws Exception{
        try(ActivityScenario<PetMessageActivity> scenario=ActivityScenario.launch(new Intent(context,PetMessageActivity.class).putExtra("origin",HOST))){scenario.onActivity(activity->{assertFalse((Boolean)field(activity,"recording"));assertTrue(text(activity.getWindow().getDecorView(),"Nothing is sent to AI"));screenshot(activity,"pet-visitor-message");});}
        try(ActivityScenario<PetMessagesActivity> scenario=ActivityScenario.launch(new Intent(context,PetMessagesActivity.class).putExtra("origin",HOST))){scenario.onActivity(activity->{assertFalse((Boolean)field(activity,"authenticated"));assertTrue(text(activity.getWindow().getDecorView(),"Unlock messages"));});}
    }
}
