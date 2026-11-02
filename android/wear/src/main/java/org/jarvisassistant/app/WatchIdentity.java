package org.jarvisassistant.app;
import android.app.KeyguardManager;
import android.content.Context;
import android.security.keystore.*;
import android.util.Base64;
import com.google.android.gms.wearable.Wearable;
import org.json.JSONObject;
import java.security.*;
import java.nio.charset.StandardCharsets;

/** A watch-owned key usable only while Android considers the watch unlocked. */
final class WatchIdentity {
    static final String KEY="/jarvis/watch/v2/key",REQUEST="/jarvis/watch/v2/key-request";
    private static final String ALIAS="jarvis-trusted-watch-v1";
    static KeyStore store()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);return store;}
    static String publicKey(Context context)throws Exception{
        KeyguardManager guard=context.getSystemService(KeyguardManager.class);if(!guard.isDeviceSecure()||guard.isDeviceLocked())throw new java.io.IOException("Unlock your watch and set its screen lock before pairing controls.");
        KeyStore store=store();if(!store.containsAlias(ALIAS)){KeyPairGenerator generator=KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA,"AndroidKeyStore");generator.initialize(new KeyGenParameterSpec.Builder(ALIAS,KeyProperties.PURPOSE_SIGN|KeyProperties.PURPOSE_VERIFY).setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1).setUnlockedDeviceRequired(true).build());generator.generateKeyPair();store=store();}return Base64.encodeToString(store.getCertificate(ALIAS).getPublicKey().getEncoded(),Base64.NO_WRAP);
    }
    static String id(Context context)throws Exception{return AppReleases.hex(MessageDigest.getInstance("SHA-256").digest(Base64.decode(publicKey(context),Base64.NO_WRAP)));}
    static String sign(Context context,String payload,String operation,String args)throws Exception{
        String[] fields=payload.split("\n",-1);String hash=AppReleases.hex(MessageDigest.getInstance("SHA-256").digest(args.getBytes(StandardCharsets.UTF_8)));long now=System.currentTimeMillis();
        if(fields.length!=7||!fields[0].equals("JARVIS_WATCH_REQUEST_V1")||!fields[1].equals(id(context))||!WatchWire.id(fields[2])||!fields[3].equals(operation)||!fields[4].equals(hash)||!fields[5].matches("[A-Za-z0-9_-]{32}")||Long.parseLong(fields[6])<=now||Long.parseLong(fields[6])-now>60000)throw new java.io.IOException("The watch request changed. Nothing was signed.");
        Signature signature=Signature.getInstance("SHA256withRSA");signature.initSign((PrivateKey)store().getKey(ALIAS,null));signature.update(payload.getBytes(StandardCharsets.UTF_8));return Base64.encodeToString(signature.sign(),Base64.NO_WRAP);
    }
    static void announce(Context context,String phone){try{JSONObject value=new JSONObject().put("publicKey",publicKey(context)).put("watchId",id(context));Wearable.getMessageClient(context).sendMessage(phone,KEY,value.toString().getBytes(StandardCharsets.UTF_8));}catch(Exception ignored){}}
}
