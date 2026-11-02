package org.jarvisassistant.app;
import android.hardware.biometrics.*;
import android.content.Context;
import android.os.Build;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
import java.security.*;
/** Device-only diagnostic: no preference clears, permission changes, biometric
 * prompts, signatures, network calls, key deletion or private-key export. */
public class BiometricDiagnostic {
    @Test public void existingSigningKeyAndStrongPromptCanInitialize() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String stage = "public key";
        try {
            assertEquals(64, WindowsApprovalSigner.deviceId().length());
            stage = "key handle"; KeyStore store = KeyStore.getInstance("AndroidKeyStore"); store.load(null);
            PrivateKey key = (PrivateKey) store.getKey("jarvis-windows-approval-v1", null); assertNotNull(key);
            stage = "signature initialization"; Signature signature = Signature.getInstance("SHA256withRSA"); signature.initSign(key);
            stage = "strong biometric availability";
            if (Build.VERSION.SDK_INT >= 30) assertEquals(BiometricManager.BIOMETRIC_SUCCESS, context.getSystemService(BiometricManager.class).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG));
            stage = "prompt builder"; BiometricPrompt.Builder builder = new BiometricPrompt.Builder(context).setTitle("Diagnostic only, never displayed").setNegativeButton("Cancel", context.getMainExecutor(), (dialog, which) -> {});
            if (Build.VERSION.SDK_INT >= 30) builder.setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG);
            assertNotNull(builder.build()); // Do not authenticate or sign.
        } catch (Exception error) { fail("Biometric diagnostic failed at " + stage + " (" + error.getClass().getSimpleName() + ")"); }
    }
}
