package org.jarvisassistant.app;
import android.content.Context;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import org.json.JSONObject;
import java.io.*;
import java.util.*;
import java.util.concurrent.*;

/** Signed, one-use requests over the exact paired phone; never sends its private key. */
final class WatchRpc implements AutoCloseable {
    static final String PATH="/jarvis/watch/v2/request/";
    private final Context context;private volatile ChannelClient.Channel channel;private volatile boolean closed;
    WatchRpc(Context context){this.context=context;}
    WatchWire.Frame request(String operation,JSONObject options,byte[] audio)throws Exception{
        String args=options.toString();WatchIdentity.id(context);ChannelClient client=Wearable.getChannelClient(context);ChannelClient.Channel opened=Tasks.await(client.openChannel(WatchConnection.phone(context),PATH+UUID.randomUUID()),12,TimeUnit.SECONDS);channel=opened;
        ScheduledExecutorService timer=Executors.newSingleThreadScheduledExecutor();ScheduledFuture<?> deadline=timer.schedule(()->client.close(opened),180,TimeUnit.SECONDS);
        try(DataOutputStream out=new DataOutputStream(Tasks.await(client.getOutputStream(opened),12,TimeUnit.SECONDS));DataInputStream in=new DataInputStream(Tasks.await(client.getInputStream(opened),12,TimeUnit.SECONDS))){
            if(closed)throw new IOException("Request stopped.");WatchWire.write(out,new JSONObject().put("operation",operation).put("args",args).put("watchId",WatchIdentity.id(context)).toString(),audio,WatchWire.PCM_LIMIT);
            try(WatchWire.Frame frame=WatchWire.read(in,0)){JSONObject challenge=new JSONObject(frame.text);if(challenge.has("error"))throw new IOException(challenge.optString("error"));if(closed)throw new IOException("Request stopped.");String payload=challenge.getString("payload"),signature=WatchIdentity.sign(context,payload,operation,args);WatchWire.write(out,new JSONObject().put("requestId",challenge.getString("requestId")).put("signature",signature).toString(),new byte[0],0);}
            WatchWire.Frame result=WatchWire.read(in,WatchWire.AUDIO_LIMIT);JSONObject value=new JSONObject(result.text);if(value.has("error")){result.close();throw new IOException(value.optString("error"));}return result;
        }finally{deadline.cancel(false);timer.shutdownNow();client.close(opened);channel=null;}
    }
    JSONObject json(String operation,JSONObject args)throws Exception{try(WatchWire.Frame frame=request(operation,args,new byte[0])){return new JSONObject(frame.text);}}
    @Override public void close(){closed=true;ChannelClient.Channel current=channel;if(current!=null)Wearable.getChannelClient(context).close(current);}
}
