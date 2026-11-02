package org.jarvisassistant.app;
import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import org.json.JSONObject;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.util.*;

/** Separate nonextractable key: general voice and opted-in foreground camera only. No Windows approval key. */
final class CompanionClient implements AutoCloseable {
    private final Context context;private final String origin,alias;private final ApiClient api;private static final Set<String> OPERATIONS=new HashSet<>(Arrays.asList("voice.transcribe","voice.reply","voice.speak","voice.claim","voice.renew","voice.release","session.poll","session.frame","session.stop"));
    CompanionClient(Context context,String origin)throws Exception{this.context=context;this.origin=EndpointPolicy.connection(origin);alias=alias(this.origin);api=new ApiClient(this.origin,null);}
    static String digest(byte[] bytes)throws Exception{return PetMessageStore.hex(MessageDigest.getInstance("SHA-256").digest(bytes));}
    private static String alias(String origin)throws Exception{return "jarvis-companion-"+digest(EndpointPolicy.connection(origin).getBytes(StandardCharsets.UTF_8));}
    private KeyStore keys()throws Exception{KeyStore keys=KeyStore.getInstance("AndroidKeyStore");keys.load(null);return keys;}
    static boolean enrolled(Context context,String origin){try{return context.getSharedPreferences("Companions",Context.MODE_PRIVATE).getBoolean(alias(origin),false);}catch(Exception ignored){return false;}}
    void enroll(String cookie,String name)throws Exception{
        if(context.getSystemService(android.app.KeyguardManager.class).isDeviceLocked())throw new GeneralSecurityException("Unlock Android before connecting this companion.");
        KeyStore store=keys();if(!store.containsAlias(alias)){KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");generator.initialize(new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_SIGN).setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1).build());generator.generateKeyPair();store=keys();}
        String publicKey=Base64.encodeToString(store.getCertificate(alias).getPublicKey().getEncoded(),Base64.NO_WRAP),id=digest(store.getCertificate(alias).getPublicKey().getEncoded());
        try(ApiClient owner=new ApiClient(origin,cookie)){
            JSONObject request=owner.json("/api/companions/prepare",new JSONObject().put("publicKey",publicKey).put("name",name).put("voice",true).put("camera",true));String[] fields=request.getString("payload").split("\n",-1);
            if(request.getString("payload").length()>1200||fields.length!=6||!fields[0].equals("JARVIS_COMPANION_ENROLL_V1")||!fields[1].equals(id)||!fields[2].equals(request.getString("requestId"))||!fields[3].equals("voice,camera")||!fields[4].matches("[A-Za-z0-9_-]{32}")||!fields[5].equals(Long.toString(request.getLong("expiresAtMs"))))throw new GeneralSecurityException("Companion setup did not match this device.");
            JSONObject result=owner.json("/api/companions/approve",new JSONObject().put("requestId",fields[2]).put("signature",sign(request.getString("payload"))));if(!result.optBoolean("paired")||!id.equals(result.optString("deviceId")))throw new GeneralSecurityException("Companion setup was not saved.");context.getSharedPreferences("Companions",Context.MODE_PRIVATE).edit().putBoolean(alias,true).apply();
        }
    }
    private String sign(String payload)throws Exception{Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign((PrivateKey)keys().getKey(alias,null));signature.update(payload.getBytes(StandardCharsets.UTF_8));return Base64.encodeToString(signature.sign(),Base64.NO_WRAP);}
    private JSONObject request(String operation,JSONObject args,String data)throws Exception{
        if(!enrolled(context,origin)||!OPERATIONS.contains(operation))throw new GeneralSecurityException("Connect companion access in Pet controls first.");String id=digest(keys().getCertificate(alias).getPublicKey().getEncoded()),encoded=args.toString();JSONObject challenge=api.json("/api/companions/challenge",new JSONObject().put("deviceId",id).put("operation",operation).put("args",encoded));String payload=challenge.getString("payload");String[] fields=payload.split("\n",-1);
        if(payload.length()>1200||fields.length!=7||!fields[0].equals("JARVIS_COMPANION_REQUEST_V1")||!fields[1].equals(id)||!fields[2].equals(challenge.getString("requestId"))||!fields[3].equals(operation)||!fields[4].equals(digest(encoded.getBytes(StandardCharsets.UTF_8)))||!fields[5].matches("[A-Za-z0-9_-]{32}")||!fields[6].equals(Long.toString(challenge.getLong("expiresAtMs"))))throw new GeneralSecurityException("The companion request did not match. Nothing was sent.");
        long remaining=challenge.getLong("expiresAtMs")-System.currentTimeMillis();if(remaining<=0||remaining>45000)throw new GeneralSecurityException("Companion clock needs attention. Nothing was sent.");JSONObject input=new JSONObject().put("requestId",fields[2]).put("signature",sign(payload));if(data!=null)input.put("data",data);return input;
    }
    JSONObject json(String operation,JSONObject args,String data)throws Exception{return api.json("/api/companions/execute",request(operation,args,data));}
    byte[] audio(String text,String voice)throws Exception{return api.bytes("/api/companions/execute",request("voice.speak",new JSONObject().put("text",text).put("voice",voice),null),10000000);}
    byte[] audio(String text,String voice,String style)throws Exception{return api.bytes("/api/companions/execute",request("voice.speak",new JSONObject().put("text",text).put("voice",voice).put("style",style),null),10000000);}
    byte[] audio(String text)throws Exception{return api.bytes("/api/companions/execute",request("voice.speak",new JSONObject().put("text",text),null),10000000);}
    @Override public void close(){api.close();}
}
