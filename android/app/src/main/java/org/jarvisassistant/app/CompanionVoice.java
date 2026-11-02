package org.jarvisassistant.app;
import android.content.Context;
import android.util.Base64;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** Short-lived, cancellable source-free requests using only the companion key. */
final class CompanionVoice {
    private volatile boolean cancelled;private final Context context;private final String origin;private final Set<CompanionClient> active=ConcurrentHashMap.newKeySet();
    CompanionVoice(Context context,String origin){this.context=context;this.origin=origin;}
    String transcribe(byte[] pcm)throws Exception{byte[] wav=VoiceRules.wav(pcm);try(CompanionClient client=new CompanionClient(context,origin)){active.add(client);try{if(cancelled)throw new java.io.IOException("Voice request cancelled.");return client.json("voice.transcribe",new JSONObject().put("sha256",CompanionClient.digest(wav)),Base64.encodeToString(wav,Base64.NO_WRAP)).optString("text","").trim();}finally{active.remove(client);}}finally{Arrays.fill(wav,(byte)0);}}
    JSONObject reply(String text,String turn,String conversation)throws Exception{try(CompanionClient client=new CompanionClient(context,origin)){active.add(client);try{if(cancelled)throw new java.io.IOException("Voice request cancelled.");return client.json("voice.reply",new JSONObject().put("text",text).put("turnId",turn).put("conversationId",conversation),null);}finally{active.remove(client);}}}
    byte[] audio(String text)throws Exception{try(CompanionClient client=new CompanionClient(context,origin)){active.add(client);try{if(cancelled)throw new java.io.IOException("Voice request cancelled.");return client.audio(text);}finally{active.remove(client);}}}
    void cancel(){cancelled=true;for(CompanionClient client:active)client.close();}
}
