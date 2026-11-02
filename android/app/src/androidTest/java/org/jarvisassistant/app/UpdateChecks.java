package org.jarvisassistant.app;
import android.content.*;
import android.media.AudioManager;
import android.view.*;
import android.widget.*;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
public class UpdateChecks {
    private boolean text(View view,String value){if(view instanceof TextView&&((TextView)view).getText().toString().contains(value))return true;if(view instanceof ViewGroup)for(int i=0;i<((ViewGroup)view).getChildCount();i++)if(text(((ViewGroup)view).getChildAt(i),value))return true;return false;}
    @Test public void updatesAreOffByDefaultAndOpeningDoesNotStartVoice()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());context.getSharedPreferences("JarvisUpdates",Context.MODE_PRIVATE).edit().clear().commit();
        try(ActivityScenario<AppUpdatesActivity> scenario=ActivityScenario.launch(AppUpdatesActivity.class)){scenario.onActivity(activity->{assertTrue(text(activity.getWindow().getDecorView(),"Automatic updates"));assertTrue(text(activity.getWindow().getDecorView(),"Check now"));assertFalse(AppReleases.preferences(activity).getBoolean("automatic",false));assertFalse(AppUpdates.working.get());assertTrue(activity.getSystemService(AudioManager.class).getActiveRecordingConfigurations().isEmpty());});}
        assertFalse(AppUpdates.working.get());
    }
    @Test public void foreignPackagesAreRejectedBeforeInstalling()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();org.json.JSONObject value=new org.json.JSONObject().put("versionCode",AppReleases.installed(context)+1).put("versionName","0.10.1").put("bytes",1024).put("minimumSdk",28).put("sha256","a".repeat(64)).put("url","/downloads/JARVIS-phone-0.10.1-aaaaaaaaaaaa.apk").put("packageName","org.jarvisassistant.app");
        try{AppReleases.validate(context,new AppReleases.Release(value,"phone"),new java.io.File(context.getCacheDir(),"missing.apk"));fail("A production APK must never be installed over preview");}catch(java.io.IOException expected){assertTrue(expected.getMessage().contains("does not match"));}
    }
}
