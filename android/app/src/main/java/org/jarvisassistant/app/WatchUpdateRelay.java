package org.jarvisassistant.app;

import android.content.Context;
import android.os.PowerManager;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.JSONObject;
import java.io.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.Predicate;

/** Streams only the current published watch APK to the explicitly linked watch. */
final class WatchUpdateRelay implements AutoCloseable {
    private final Context context;private final Predicate<String> trusted;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private final ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();
    private final AtomicBoolean busy=new AtomicBoolean();
    private volatile ChannelClient.Channel active;private volatile AppReleases.Source source;
    WatchUpdateRelay(Context context,Predicate<String> trusted){this.context=context;this.trusted=trusted;}
    boolean accepts(ChannelClient.Channel channel){return channel.getPath().startsWith(AppReleases.UPDATE);}
    void channel(ChannelClient.Channel channel){
        ChannelClient pipes=Wearable.getChannelClient(context);String suffix=channel.getPath().substring(AppReleases.UPDATE.length());
        try{if(!java.util.UUID.fromString(suffix).toString().equals(suffix)||!trusted.test(channel.getNodeId())||!busy.compareAndSet(false,true)){pipes.close(channel);return;}}catch(IllegalArgumentException error){pipes.close(channel);return;}
        active=channel;ScheduledFuture<?> deadline=timer.schedule(()->disconnected(channel),10,TimeUnit.MINUTES);
        worker.execute(()->{
            PowerManager.WakeLock cpu=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:WatchUpdate");cpu.acquire(610000);
            try(DataInputStream in=new DataInputStream(Tasks.await(pipes.getInputStream(channel),12,TimeUnit.SECONDS));DataOutputStream out=new DataOutputStream(Tasks.await(pipes.getOutputStream(channel),12,TimeUnit.SECONDS));AppReleases.Source client=new AppReleases.Source(context,true)){
                source=client;
                try{
                    int mode=in.readUnsignedByte();if(mode!=0&&mode!=1)throw new IOException("Invalid update request.");String hash=mode==1?in.readUTF():"";
                    if(mode==1&&!hash.matches("[a-f0-9]{64}"))throw new IOException("Invalid update request.");
                    JSONObject manifest=client.manifest();AppReleases.Release release=AppReleases.Release.from(manifest,"watch");
                    if(!"org.jarvisassistant.app".equals(release.packageName)||!trusted.test(channel.getNodeId()))throw new IOException("The watch connection changed. Relink it on your phone.");
                    if(mode==0){WatchWire.write(out,new JSONObject().put("manifest",manifest).toString(),new byte[0],0);return;}
                    if(!hash.equals(release.hash))throw new IOException("The release changed. Check for updates again.");
                    try(InputStream apk=client.artifact(release)){
                        WatchWire.write(out,new JSONObject().put("bytes",release.bytes).put("sha256",release.hash).toString(),new byte[0],0);
                        byte[] buffer=new byte[32768];long remaining=release.bytes;
                        while(remaining>0){if(!trusted.test(channel.getNodeId())||Thread.currentThread().isInterrupted())throw new IOException("Watch disconnected.");int n=apk.read(buffer,0,(int)Math.min(buffer.length,remaining));if(n<0)throw new EOFException();out.write(buffer,0,n);remaining-=n;}out.flush();
                    }
                }catch(Exception error){try{WatchWire.write(out,new JSONObject().put("error","Update unavailable. Check the published release, paired phone and Tailscale.").toString(),new byte[0],0);}catch(Exception ignored){}}
            }catch(Exception ignored){}finally{deadline.cancel(false);if(cpu.isHeld())cpu.release();source=null;active=null;busy.set(false);pipes.close(channel);}
        });
    }
    void disconnected(ChannelClient.Channel channel){if(channel.equals(active)){AppReleases.Source client=source;if(client!=null)client.close();Wearable.getChannelClient(context).close(channel);}}
    @Override public void close(){ChannelClient.Channel channel=active;if(channel!=null)disconnected(channel);worker.shutdownNow();timer.shutdownNow();}
}
