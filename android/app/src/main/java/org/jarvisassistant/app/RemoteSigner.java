package org.jarvisassistant.app;

import android.app.Activity;
import android.hardware.biometrics.*;
import android.os.*;
import android.util.Base64;
import java.security.*;
import java.nio.charset.StandardCharsets;

/** Distinct remote-control proof domain; cannot sign Windows logon payloads. */
final class RemoteSigner {
    private static final String ALIAS="jarvis-windows-approval-v1";
    interface Result{void approved(String signature);void failed();}
    static String deviceId()throws Exception{
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias(ALIAS))throw new GeneralSecurityException("Pair first");
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(store.getCertificate(ALIAS).getPublicKey().getEncoded());StringBuilder hex=new StringBuilder();for(byte part:hash)hex.append(String.format(java.util.Locale.ROOT,"%02x",part&255));return hex.toString();
    }
    static CancellationSignal approve(Activity activity,String payload,String computer,Result result){
        return approve(activity,payload,computer,"Mouse, keyboard and media · 15 minutes",result);
    }
    static CancellationSignal approve(Activity activity,String payload,String computer,String subtitle,Result result){
        CancellationSignal cancellation=new CancellationSignal();
        try{
            if(!RemoteProof.valid(payload,computer,deviceId(),System.currentTimeMillis()))throw new GeneralSecurityException();
            KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);Signature signer=Signature.getInstance("SHA256withRSA");signer.initSign((PrivateKey)store.getKey(ALIAS,null));
            BiometricPrompt.Builder builder=new BiometricPrompt.Builder(activity).setTitle("Control your laptop").setSubtitle(subtitle).setNegativeButton("Cancel",activity.getMainExecutor(),(dialog,which)->result.failed());
            if(Build.VERSION.SDK_INT>=30)builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            builder.build().authenticate(new BiometricPrompt.CryptoObject(signer),cancellation,activity.getMainExecutor(),new BiometricPrompt.AuthenticationCallback(){
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult authentication){try{
                    if(cancellation.isCanceled()||!RemoteProof.valid(payload,computer,deviceId(),System.currentTimeMillis()))throw new GeneralSecurityException();
                    Signature signature=authentication.getCryptoObject().getSignature();if(signature==null)throw new GeneralSecurityException();signature.update(payload.getBytes(StandardCharsets.UTF_8));result.approved(Base64.encodeToString(signature.sign(),Base64.NO_WRAP));
                }catch(Exception ignored){result.failed();}}
                @Override public void onAuthenticationError(int code,CharSequence message){result.failed();}
            });
        }catch(Exception ignored){result.failed();}return cancellation;
    }
}
