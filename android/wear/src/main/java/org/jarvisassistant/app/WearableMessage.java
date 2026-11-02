package org.jarvisassistant.app;
import android.content.Context;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
final class WearableMessage {static void send(Context context,String node,String action)throws Exception{Wearable.getMessageClient(context).sendMessage(node,WatchWire.COMMAND,new JSONObject().put("id",java.util.UUID.randomUUID().toString()).put("time",System.currentTimeMillis()).put("action",action).toString().getBytes(java.nio.charset.StandardCharsets.UTF_8));}}
