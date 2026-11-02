package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class EndpointPolicyTest {
    @Test public void workspaceSwitchesStayOnSamePrivateHost() {
        assertTrue(EndpointPolicy.allowed(EndpointPolicy.DEFAULT + ":8443/?switch=1#/command", EndpointPolicy.DEFAULT));
        assertFalse(EndpointPolicy.sameOrigin(EndpointPolicy.DEFAULT + ":8443/", EndpointPolicy.DEFAULT));
        assertTrue(EndpointPolicy.sameOrigin(EndpointPolicy.DEFAULT + ":443/api/health", EndpointPolicy.DEFAULT));
        assertFalse(EndpointPolicy.allowed("https://different.your-tailnet.ts.net", EndpointPolicy.DEFAULT));
    }
    @Test public void unsafeAndMisleadingAddressesAreRejected() {
        for (String value : new String[]{"http://localhost:4317", "https://your-device.your-tailnet.ts.net.evil.com", "https://evil@your-device.your-tailnet.ts.net", "https://your-device.your-tailnet.ts.net:4317", "javascript:alert(1)", "file:///secret", "https://your-device.your-tailnet.ts.net/api/health", "https://your-device.your-tailnet.ts.net/?token=secret"}) {
            try { EndpointPolicy.connection(value); fail(value); } catch (IllegalArgumentException expected) {}
        }
    }
}

