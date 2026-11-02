package org.jarvisassistant.app;
import android.content.Context;
import com.google.android.gms.tasks.Tasks;
import com.google.android.gms.wearable.*;
import java.util.*;
import java.util.concurrent.TimeUnit;
import java.util.function.Consumer;
final class WatchConnection {
    static void phone(Context context,Consumer<String> ready,Consumer<String> failed){Wearable.getNodeClient(context).getConnectedNodes().addOnSuccessListener(nodes->{if(nodes.size()!=1){failed.accept(nodes.isEmpty()?"Connect your phone in Galaxy Wearable first.":"More than one device connected. Keep only your paired phone connected for setup.");return;}ready.accept(nodes.get(0).getId());}).addOnFailureListener(e->failed.accept("Phone connection unavailable. Check Galaxy Wearable."));}
    static String phone(Context context)throws Exception{List<Node> nodes=Tasks.await(Wearable.getNodeClient(context).getConnectedNodes(),12,TimeUnit.SECONDS);if(nodes.size()!=1)throw new java.io.IOException("Connect one paired phone, then enable Galaxy Watch in JARVIS.");return nodes.get(0).getId();}
}
