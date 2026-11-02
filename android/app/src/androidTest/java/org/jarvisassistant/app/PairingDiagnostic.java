package org.jarvisassistant.app;
import android.content.Context;
import android.webkit.CookieManager;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;
/** Uses the app's ordinary same-origin signed-in client to create one unproved,
 * expiring pairing proposal. Never approves a pairing, prompts, signs, clears
 * preferences, exports cookies/keys or invokes a Windows action. */
public class PairingDiagnostic {
    @Test public void freshPairingRequestMatchesThisApp() throws Exception {
        Context context = InstrumentationRegistry.getInstrumentation().getTargetContext();
        String origin = EndpointPolicy.connection(context.getSharedPreferences("MainActivity", Context.MODE_PRIVATE).getString("origin", ""));
        String[] cookie = new String[1]; InstrumentationRegistry.getInstrumentation().runOnMainSync(() -> cookie[0] = CookieManager.getInstance().getCookie(origin));
        try (ApiClient api = new ApiClient(origin, cookie[0])) {
            JSONObject status = api.json("/api/computer/status", null);
            JSONObject pairing = api.json("/api/computer/pair", new JSONObject().put("publicKey", WindowsApprovalSigner.publicKey()).put("name", "Unproved diagnostic; expires automatically"));
            String[] fields = pairing.getString("payload").split("\n", -1); assertEquals("Pairing payload shape", 7, fields.length);
            boolean version = fields[0].equals("JARVIS_PHONE_PAIR_V1"), computer = fields[1].equals(status.getString("computerId")), account = fields[2].equals(status.getString("accountSid")), phone = fields[3].equals(WindowsApprovalSigner.deviceId()), id = fields[4].matches("[a-fA-F0-9-]{36}"), nonce = fields[5].matches("[A-Za-z0-9_-]{43}");
            long remaining = Long.parseLong(fields[6]) - System.currentTimeMillis();
            assertTrue("Public boundary checks: version=" + version + ",computer=" + computer + ",account=" + account + ",phone=" + phone + ",id=" + id + ",nonce=" + nonce + ",remainingMs=" + remaining, version && computer && account && phone && id && nonce && WindowsApprovalTiming.fresh(Long.parseLong(fields[6]), System.currentTimeMillis(), true));
        }
    }
}
