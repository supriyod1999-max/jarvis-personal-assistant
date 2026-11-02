package org.jarvisassistant.app;

import android.content.*;
import android.content.pm.*;
import android.os.*;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.security.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.function.IntConsumer;

/** Only this publisher's same-package, same-signer upgrades. No model-controlled URLs. */
final class AppReleases {
    static final String UPDATE="/jarvis/watch/v1/update/";
    static final String FEED="/downloads/android-release.json";
    static boolean watch(Context context){return context.getPackageManager().hasSystemFeature("android.hardware.type.watch");}
    static String variant(Context context){return watch(context)?"watch":"phone";}
    static android.content.SharedPreferences preferences(Context context){return context.getSharedPreferences("JarvisUpdates",Context.MODE_PRIVATE);}
    static long installed(Context context)throws Exception{return context.getPackageManager().getPackageInfo(context.getPackageName(),0).getLongVersionCode();}
    static File apk(Context context){return new File(context.getCacheDir(),"jarvis-verified-update.apk");}
    static String hex(byte[] hash){StringBuilder value=new StringBuilder();for(byte b:hash)value.append(String.format(java.util.Locale.ROOT,"%02x",b&255));return value.toString();}
    static final class Release {
        final long code,bytes;final int minimumSdk;final String name,hash,url,packageName,variant;
        Release(JSONObject value,String channel)throws Exception{
            variant=channel;code=value.getLong("versionCode");bytes=value.getLong("bytes");minimumSdk=value.getInt("minimumSdk");name=value.getString("versionName");hash=value.getString("sha256");url=value.getString("url");packageName=value.getString("packageName");
            if(!UpdatePolicy.valid(code,bytes,hash,url,variant)||!name.matches("[0-9]+\\.[0-9]+\\.[0-9]+")||minimumSdk<21||minimumSdk>100||!packageName.matches("com\\.owner\\.jarvis(?:\\.design)?"))throw new IOException("Release information is invalid. No update was installed.");
        }
        static Release from(JSONObject root,String variant)throws Exception{if(!"jarvis-android-release".equals(root.optString("format"))||root.optInt("version")!=1)throw new IOException("Update feed is unavailable. No update was installed.");return new Release(root.getJSONObject("channels").getJSONObject(variant),variant);}
        JSONObject json()throws JSONException{return new JSONObject().put("versionCode",code).put("versionName",name).put("bytes",bytes).put("minimumSdk",minimumSdk).put("sha256",hash).put("url",url).put("packageName",packageName);}
    }
    static Release cached(Context context){try{return new Release(new JSONObject(preferences(context).getString("available","")),variant(context));}catch(Exception ignored){return null;}}
    static void validate(Context context,Release release,File file)throws Exception{
        if(!release.packageName.equals(context.getPackageName())||release.minimumSdk>Build.VERSION.SDK_INT||!UpdatePolicy.newer(installed(context),release.code))throw new IOException("This update does not match this app or Android version.");
        if(file.length()!=release.bytes)throw new IOException("The update download is incomplete.");MessageDigest digest=MessageDigest.getInstance("SHA-256");try(InputStream in=new FileInputStream(file)){byte[] buffer=new byte[32768];int n;while((n=in.read(buffer))!=-1)digest.update(buffer,0,n);}if(!hex(digest.digest()).equals(release.hash))throw new IOException("The update checksum did not match. Nothing was installed.");
        PackageManager pm=context.getPackageManager();int flags=PackageManager.GET_SIGNING_CERTIFICATES|PackageManager.GET_CONFIGURATIONS;
        PackageInfo own=pm.getPackageInfo(context.getPackageName(),flags),candidate=pm.getPackageArchiveInfo(file.getAbsolutePath(),flags);
        if(candidate==null||!context.getPackageName().equals(candidate.packageName)||candidate.getLongVersionCode()!=release.code||!release.name.equals(candidate.versionName)||candidate.applicationInfo==null||candidate.applicationInfo.minSdkVersion>Build.VERSION.SDK_INT)throw new IOException("The APK does not match its release information.");
        boolean watch=false;if(candidate.reqFeatures!=null)for(FeatureInfo feature:candidate.reqFeatures)if("android.hardware.type.watch".equals(feature.name))watch=true;
        if(watch!=watch(context)||own.signingInfo==null||candidate.signingInfo==null)throw new IOException("The update is for a different device type.");
        android.content.pm.Signature[] current=own.signingInfo.getApkContentsSigners(),downloaded=candidate.signingInfo.getApkContentsSigners();
        if(current.length!=1||downloaded.length!=1||!UpdatePolicy.sameSigner(current[0].toByteArray(),downloaded[0].toByteArray()))throw new IOException("The update is not signed by your installed JARVIS publisher. Nothing was installed.");
    }
    static final class Source implements AutoCloseable {
        private final Context context;private final boolean viaPhone;private volatile boolean closed;private volatile HttpURLConnection http;private volatile ChannelClient.Channel channel;
        Source(Context context,boolean forceHttp){this.context=context.getApplicationContext();viaPhone=watch(context)&&!forceHttp;}
        private HttpURLConnection open(String relative)throws Exception{
            if(closed||(!FEED.equals(relative)&&!UpdatePolicy.artifact(relative,"watch")&&!UpdatePolicy.artifact(relative,"phone")))throw new IOException("Invalid update source.");
            String origin=EndpointPolicy.connection(context.getSharedPreferences("MainActivity",Context.MODE_PRIVATE).getString("origin",""));HttpURLConnection connection=(HttpURLConnection)new URL(origin+relative).openConnection();http=connection;connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);connection.setRequestProperty("Origin",origin);connection.setConnectTimeout(12000);connection.setReadTimeout(45000);
            if(closed){connection.disconnect();throw new IOException("Update stopped.");}int status=connection.getResponseCode();if(status!=200){connection.disconnect();throw new IOException("Check the phone connection, Tailscale and the published JARVIS release.");}return connection;
        }
        private ChannelClient.Channel pipe(int mode,String hash)throws Exception{
            java.util.List<Node> nodes=Tasks.await(Wearable.getNodeClient(context).getConnectedNodes(),12,TimeUnit.SECONDS);if(nodes.size()!=1)throw new IOException("Connect your paired phone and enable its JARVIS watch connection.");
            ChannelClient.Channel opened=Tasks.await(Wearable.getChannelClient(context).openChannel(nodes.get(0).getId(),UPDATE+UUID.randomUUID()),12,TimeUnit.SECONDS);channel=opened;
            if(closed)throw new IOException("Update stopped.");DataOutputStream out=new DataOutputStream(Tasks.await(Wearable.getChannelClient(context).getOutputStream(opened),12,TimeUnit.SECONDS));out.writeByte(mode);if(mode==1)out.writeUTF(hash);out.flush();return opened;
        }
        JSONObject manifest()throws Exception{
            if(viaPhone){ChannelClient.Channel opened=pipe(0,"");try(DataInputStream in=new DataInputStream(Tasks.await(Wearable.getChannelClient(context).getInputStream(opened),12,TimeUnit.SECONDS));WatchWire.Frame frame=WatchWire.read(in,0)){JSONObject value=new JSONObject(frame.text);if(value.has("error"))throw new IOException(value.optString("error"));return value.getJSONObject("manifest");}finally{Wearable.getChannelClient(context).close(opened);channel=null;}}
            HttpURLConnection connection=open(FEED);try(InputStream in=connection.getInputStream();ByteArrayOutputStream out=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1){if(closed||out.size()+n>16384)throw new IOException("Update information was too large.");out.write(buffer,0,n);}return new JSONObject(out.toString("UTF-8"));}finally{connection.disconnect();http=null;}
        }
        InputStream artifact(Release release)throws Exception{if(viaPhone)throw new IOException("Use watch download stream.");HttpURLConnection connection=open(release.url);long length=connection.getContentLengthLong();if(length>0&&length!=release.bytes){connection.disconnect();throw new IOException("The published APK size changed.");}return connection.getInputStream();}
        void download(Release release,File target,IntConsumer progress)throws Exception{
            if(viaPhone){ChannelClient.Channel opened=pipe(1,release.hash);try(DataInputStream in=new DataInputStream(Tasks.await(Wearable.getChannelClient(context).getInputStream(opened),12,TimeUnit.SECONDS));WatchWire.Frame frame=WatchWire.read(in,0)){JSONObject header=new JSONObject(frame.text);if(header.has("error"))throw new IOException(header.optString("error"));if(header.optLong("bytes")!=release.bytes||!release.hash.equals(header.optString("sha256")))throw new IOException("The release changed. Check for updates again.");copy(in,new FileOutputStream(target),release.bytes,progress);}finally{Wearable.getChannelClient(context).close(opened);channel=null;}}
            else try(InputStream in=artifact(release)){copy(in,new FileOutputStream(target),release.bytes,progress);}finally{HttpURLConnection connection=http;if(connection!=null)connection.disconnect();http=null;}
        }
        void copy(InputStream in,OutputStream output,long length,IntConsumer progress)throws Exception{try(OutputStream out=output){byte[] buffer=new byte[32768];long total=0;while(total<length){if(closed||Thread.currentThread().isInterrupted())throw new IOException("Update transfer stopped. It will be checked again later.");int n=in.read(buffer,0,(int)Math.min(buffer.length,length-total));if(n<0)throw new IOException("Update connection dropped. It will be downloaded again on the next check.");if(n==0)continue;out.write(buffer,0,n);total+=n;progress.accept((int)(total*100/length));}}}
        @Override public void close(){closed=true;HttpURLConnection connection=http;if(connection!=null)connection.disconnect();ChannelClient.Channel opened=channel;if(opened!=null)Wearable.getChannelClient(context).close(opened);}
    }
}
