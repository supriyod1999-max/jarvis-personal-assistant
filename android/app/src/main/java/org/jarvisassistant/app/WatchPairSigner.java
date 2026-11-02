package org.jarvisassistant.app;
import android.app.Activity;
import android.hardware.biometrics.*;
import android.os.*;
import android.util.Base64;
import java.security.*;
import java.nio.charset.StandardCharsets;
final class WatchPairSigner {
    private static boolean valid(String payload,String computer,String phone,String watch,String node){try{String[] fields=payload.split("\n",-1);long now=System.currentTimeMillis();return fields.length==8&&fields[0].equals("JARVIS_TRUST_WATCH_V1")&&fields[1].equals(computer)&&fields[2].equals(phone)&&fields[3].equals(watch)&&fields[4].equals(AppReleases.hex(MessageDigest.getInstance("SHA-256").digest(node.getBytes(StandardCharsets.UTF_8))))&&WatchWire.id(fields[5])&&fields[6].matches("[A-Za-z0-9_-]{32}")&&Long.parseLong(fields[7])>now&&Long.parseLong(fields[7])-now<=60000;}catch(Exception ignored){return false;}}
    static CancellationSignal approve(Activity activity,String payload,String computer,String watch,String node,RemoteSigner.Result result){CancellationSignal cancel=new CancellationSignal();
        try{String phone=RemoteSigner.deviceId();if(!valid(payload,computer,phone,watch,node))throw new GeneralSecurityException();KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign((PrivateKey)store.getKey("jarvis-windows-approval-v1",null));BiometricPrompt.Builder prompt=new BiometricPrompt.Builder(activity).setTitle("Trust your Galaxy Watch").setSubtitle("Files, coding sessions and laptop input until disconnected").setNegativeButton("Cancel",activity.getMainExecutor(),(d,w)->result.failed());if(Build.VERSION.SDK_INT>=30)prompt.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            prompt.build().authenticate(new BiometricPrompt.CryptoObject(signer),cancel,activity.getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){@Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult value){try{if(cancel.isCanceled()||!valid(payload,computer,phone,watch,node))throw new GeneralSecurityException();Signature proof=value.getCryptoObject().getSignature();proof.update(payload.getBytes(StandardCharsets.UTF_8));result.approved(Base64.encodeToString(proof.sign(),Base64.NO_WRAP));}catch(Exception error){result.failed();}}@Override public void onAuthenticationError(int code,CharSequence message){result.failed();}});
        }catch(Exception error){result.failed();}return cancel;
    }
}
