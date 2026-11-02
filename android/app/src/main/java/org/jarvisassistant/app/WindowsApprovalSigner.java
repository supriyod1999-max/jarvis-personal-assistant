package org.jarvisassistant.app;

import android.app.Activity;
import android.hardware.biometrics.BiometricPrompt;
import android.hardware.biometrics.BiometricManager;
import android.os.Build;
import android.os.CancellationSignal;
import android.security.keystore.KeyGenParameterSpec;
import android.security.keystore.KeyInfo;
import android.security.keystore.KeyProperties;
import android.util.Base64;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.*;

/** Not exposed to WebView. Native enrollment/transport must pin the exact target
 * before invoking this; no remote Windows access is enabled by this helper. */
public final class WindowsApprovalSigner {
    private static final String ALIAS = "jarvis-windows-approval-v1";
    private WindowsApprovalSigner() {}
    public interface Result { void approved(String signature); void failed(String message); }
    public static String publicKey() throws Exception {
        KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
        if (!store.containsAlias(ALIAS)) {
            KeyPairGenerator generator = KeyPairGenerator.getInstance(KeyProperties.KEY_ALGORITHM_RSA, "AndroidKeyStore");
            KeyGenParameterSpec.Builder spec = new KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_SIGN)
                .setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256).setSignaturePaddings(KeyProperties.SIGNATURE_PADDING_RSA_PKCS1)
                .setUserAuthenticationRequired(true).setInvalidatedByBiometricEnrollment(true);
            if (Build.VERSION.SDK_INT >= 30) spec.setUserAuthenticationParameters(0, KeyProperties.AUTH_BIOMETRIC_STRONG);
            else spec.setUserAuthenticationValidityDurationSeconds(-1);
            generator.initialize(spec.build()); generator.generateKeyPair();
        }
        PrivateKey key = (PrivateKey) store.getKey(ALIAS, null);
        KeyInfo info = KeyFactory.getInstance(key.getAlgorithm(), "AndroidKeyStore").getKeySpec(key, KeyInfo.class);
        if (!info.isInsideSecureHardware() || !info.isUserAuthenticationRequired()) throw new GeneralSecurityException("Hardware-backed biometric signing is unavailable on this phone.");
        return Base64.encodeToString(store.getCertificate(ALIAS).getPublicKey().getEncoded(), Base64.NO_WRAP);
    }
    public static String deviceId() throws Exception {
        byte[] hash = MessageDigest.getInstance("SHA-256").digest(Base64.decode(publicKey(), Base64.NO_WRAP));
        StringBuilder out = new StringBuilder(); for (byte b : hash) out.append(String.format(java.util.Locale.ROOT, "%02x", b & 255)); return out.toString();
    }
    static String existingDeviceId() throws Exception {
        KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);if(!store.containsAlias(ALIAS))return "";
        byte[] hash=MessageDigest.getInstance("SHA-256").digest(store.getCertificate(ALIAS).getPublicKey().getEncoded());StringBuilder value=new StringBuilder();for(byte part:hash)value.append(String.format(java.util.Locale.ROOT,"%02x",part&255));return value.toString();
    }
    public static CancellationSignal approve(Activity activity, String payload, String pairedComputerId, String pairedAccountSid, Result result) {
        return sign(activity, payload, pairedComputerId, pairedAccountSid, false, result);
    }
    public static CancellationSignal approvePair(Activity activity, String payload, String computerId, String accountSid, Result result) {
        return sign(activity, payload, computerId, accountSid, true, result);
    }
    private static CancellationSignal sign(Activity activity, String payload, String pairedComputerId, String pairedAccountSid, boolean pairing, Result result) {
        CancellationSignal cancellation = new CancellationSignal();
        String stage = "request";
        try {
            stage = "key"; String selectedDevice = deviceId(); stage = "request";
            String[] fields = payload.split("\n", -1);
            if (pairing) {
                if (payload.length() > 1200 || fields.length != 7 || !fields[0].equals("JARVIS_PHONE_PAIR_V1")
                    || !fields[1].equals(pairedComputerId) || !fields[2].equals(pairedAccountSid) || !fields[3].equals(selectedDevice)
                    || !fields[4].matches("[a-fA-F0-9-]{36}") || !fields[5].matches("[A-Za-z0-9_-]{43}")) throw new GeneralSecurityException();
            } else if (payload.length() > 1200 || fields.length != 10 || !fields[0].equals("JARVIS_WINDOWS_SIGNIN_V1")
                || !(fields[1].equals("windows.unlock") || fields[1].equals("windows.lock"))
                || !fields[2].equals(selectedDevice) || !fields[3].equals(pairedComputerId) || !fields[4].equals(pairedAccountSid)
                || !fields[3].matches("[a-fA-F0-9-]{36}") || !fields[4].matches("S-1-5-(?:[0-9]+-){1,14}[0-9]+")
                || !fields[5].matches("[1-9][0-9]{0,9}") || !fields[6].matches("[a-fA-F0-9-]{36}")
                || !fields[7].matches("[a-fA-F0-9-]{36}") || !fields[8].matches("[A-Za-z0-9_-]{43}")) throw new GeneralSecurityException();
            long expires = Long.parseLong(fields[pairing ? 6 : 9]);
            if (!WindowsApprovalTiming.fresh(expires, System.currentTimeMillis(), pairing)) throw new GeneralSecurityException();
            stage = "key";
            KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
            Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign((PrivateKey) store.getKey(ALIAS, null));
            stage = "prompt";
            BiometricPrompt.Builder builder = new BiometricPrompt.Builder(activity).setTitle(pairing ? "Pair this laptop" : fields[1].equals("windows.unlock") ? "Unlock Windows" : "Lock Windows")
                .setSubtitle("Approve this request for your paired laptop")
                .setNegativeButton("Cancel", activity.getMainExecutor(), (dialog, which) -> { cancellation.cancel(); result.failed("Approval cancelled."); });
            // CryptoObject approvals must explicitly request a Class 3 biometric.
            // A weak/default authenticator cannot authorize this per-use key.
            if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            BiometricPrompt prompt = builder.build();
            prompt.authenticate(new BiometricPrompt.CryptoObject(signature), cancellation, activity.getMainExecutor(), new BiometricPrompt.AuthenticationCallback() {
                @Override public void onAuthenticationSucceeded(BiometricPrompt.AuthenticationResult auth) {
                    try {
                        if (System.currentTimeMillis() >= expires || cancellation.isCanceled() || auth.getCryptoObject() == null || auth.getCryptoObject().getSignature() == null) throw new GeneralSecurityException();
                        Signature authorised = auth.getCryptoObject().getSignature(); authorised.update(payload.getBytes(StandardCharsets.UTF_8));
                        result.approved(Base64.encodeToString(authorised.sign(), Base64.NO_WRAP));
                    } catch (Exception error) { result.failed("Windows approval could not be signed. Try a new request."); }
                }
                @Override public void onAuthenticationError(int code, CharSequence message) { result.failed("Biometric approval was cancelled or unavailable."); }
            });
        } catch (android.security.keystore.KeyPermanentlyInvalidatedException error) { result.failed("Your biometric enrollment changed and invalidated this signing key. Revoke this phone on the laptop, then review a new pairing key. No key was reset."); }
        catch (Exception error) { result.failed(stage.equals("request") ? "The laptop request expired or did not match this phone. Tap Pair this phone again for a fresh request." : stage.equals("key") ? "Android could not open the biometric signing key (" + error.getClass().getSimpleName() + "). No key was reset." : "Android could not open the strong-biometric prompt (" + error.getClass().getSimpleName() + ")."); }
        return cancellation;
    }
}
