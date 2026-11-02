package org.jarvisassistant.app;
import android.app.Activity;
import android.os.*;
import android.util.Base64;
import org.json.JSONObject;
import java.util.Arrays;
import java.util.concurrent.*;
import java.util.function.Consumer;

/** A visible foreground-only sharing session. It never opens a camera itself. */
final class PetCameraShare implements AutoCloseable {
    private final Activity context;private final String origin;private final Consumer<String> status;private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile boolean active;private volatile int epoch;private volatile CompanionClient client;
    PetCameraShare(Activity context,String origin,Consumer<String> status){this.context=context;this.origin=origin;this.status=status;}
    boolean running(){return active;}
    void start(PetCamera camera){if(active)return;if(!CompanionClient.enrolled(context,origin)){status.accept("Connect companion access before enabling check-ins.");return;}active=true;int generation=++epoch;status.accept("Camera check-ins enabled for this pet session.");worker.execute(()->{try(CompanionClient connection=new CompanionClient(context,origin)){client=connection;while(active&&epoch==generation){JSONObject value=connection.json("session.poll",new JSONObject().put("sharing",true),null);JSONObject capture=value.optJSONObject("capture");if(capture!=null){String id=capture.getString("requestId");CountDownLatch done=new CountDownLatch(1);java.util.concurrent.atomic.AtomicReference<byte[]> frame=new java.util.concurrent.atomic.AtomicReference<>();java.util.concurrent.atomic.AtomicBoolean abandoned=new java.util.concurrent.atomic.AtomicBoolean();context.runOnUiThread(()->{if(!active||epoch!=generation){done.countDown();return;}status.accept("Camera check-in · capturing one fresh image");camera.snapshot(bytes->{synchronized(frame){if(abandoned.get())Arrays.fill(bytes,(byte)0);else frame.set(bytes);}done.countDown();},error->done.countDown());});try{if(!done.await(6,TimeUnit.SECONDS)||!active||epoch!=generation)continue;byte[] bytes=frame.get();if(bytes==null)connection.json("session.frame",new JSONObject().put("requestId",id).put("error",true),null);else connection.json("session.frame",new JSONObject().put("requestId",id).put("sha256",CompanionClient.digest(bytes)),Base64.encodeToString(bytes,Base64.NO_WRAP));}finally{synchronized(frame){abandoned.set(true);byte[] discard=frame.getAndSet(null);if(discard!=null)Arrays.fill(discard,(byte)0);}}}Thread.sleep(2500);}}catch(Exception error){if(active&&generation==epoch)status.accept("Camera check-ins disconnected. Retry from Pet controls.");}finally{if(generation==epoch){active=false;client=null;}}});}
    void stop(){boolean wasActive=active;active=false;epoch++;CompanionClient value=client;client=null;if(value!=null)value.close();if(wasActive)status.accept("Camera check-ins off.");if(wasActive)worker.execute(()->{try(CompanionClient connection=new CompanionClient(context,origin)){connection.json("session.stop",new JSONObject(),null);}catch(Exception ignored){}});}
    @Override public void close(){stop();worker.shutdown();}
}
