package org.jarvisassistant.app;

import android.app.Instrumentation;
import android.content.Context;
import android.os.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;

/** An isolated, same-signer preview upgrade. Never run against the production package. */
public class UpdateInstallChecks {
    @Test public void installSyntheticNextPreview()throws Exception{
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());assertEquals(15,AppReleases.installed(context));
        File candidate=new File(context.getExternalFilesDir(null),"update-candidate.apk");assertTrue(candidate.isFile());
        java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(candidate)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}String hash=AppReleases.hex(digest.digest());
        JSONObject release=new JSONObject().put("packageName",context.getPackageName()).put("versionCode",16).put("versionName","0.12.0").put("bytes",candidate.length()).put("sha256",hash).put("minimumSdk",28).put("url","/downloads/JARVIS-phone-0.12.0-"+hash.substring(0,12)+".apk");
        byte[] manifest=new JSONObject().put("format","jarvis-android-release").put("version",1).put("channels",new JSONObject().put("phone",release)).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8);
        URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){protected URLConnection openConnection(URL url){return new HttpURLConnection(url){public void connect(){}public void disconnect(){}public boolean usingProxy(){return false;}public int getResponseCode(){return 200;}public long getContentLengthLong(){return url.getPath().equals(AppReleases.FEED)?manifest.length:candidate.length();}public InputStream getInputStream()throws IOException{if(url.getPath().equals(AppReleases.FEED))return new ByteArrayInputStream(manifest);if(url.getPath().equals(release.optString("url")))return new FileInputStream(candidate);throw new IOException("Unexpected fixture path");}};}}:null);
        context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).edit().putString("origin","https://synthetic.tailtest.ts.net").commit();
        try(AppReleases.Source source=new AppReleases.Source(context,false)){AppReleases.Release next=AppUpdates.check(context,source);assertNotNull(next);AppUpdates.fetch(context,source,next);assertTrue(AppReleases.apk(context).isFile());}
        // Only the empty preview emulator grants this fixture permission. Real-device permission remains owner-controlled.
        try(ParcelFileDescriptor command=instrumentation.getUiAutomation().executeShellCommand("appops set org.jarvisassistant.app.design REQUEST_INSTALL_PACKAGES allow");InputStream in=new ParcelFileDescriptor.AutoCloseInputStream(command)){while(in.read()!=-1){}}
        assertTrue(context.getPackageManager().canRequestPackageInstalls());context.getSharedPreferences("UpdateTestProof",Context.MODE_PRIVATE).edit().putString("marker","synthetic-pairing-preservation").commit();AppUpdates.install(context,AppReleases.cached(context),true);
        // The Android installer terminates this old process when its upgrade succeeds.
        SystemClock.sleep(8000);
    }
    @Test public void verifySyntheticUpgradePreservedData()throws Exception{
        Context context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());assertEquals(16,AppReleases.installed(context));assertEquals("synthetic-pairing-preservation",context.getSharedPreferences("UpdateTestProof",Context.MODE_PRIVATE).getString("marker",""));assertNull(AppReleases.cached(context));assertTrue(AppReleases.preferences(context).getString("status","").contains("updated successfully"));assertTrue(context.getSystemService(android.media.AudioManager.class).getActiveRecordingConfigurations().isEmpty());
    }
}
