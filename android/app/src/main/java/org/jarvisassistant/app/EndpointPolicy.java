package org.jarvisassistant.app;

import java.net.URI;
import java.util.Locale;

public final class EndpointPolicy {
    public static final String DEFAULT = "https://your-device.your-tailnet.ts.net";
    public static String origin(String input) {
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost(); int port = uri.getPort();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || !host.toLowerCase(Locale.ROOT).matches("[a-z0-9-]+\\.[a-z0-9-]+\\.ts\\.net")
                    || uri.getRawUserInfo() != null || (port != -1 && port != 443 && port != 8443)) throw new IllegalArgumentException();
            return "https://" + host.toLowerCase(Locale.ROOT) + (port == 8443 ? ":8443" : "");
        } catch (Exception error) { throw new IllegalArgumentException("Use your private HTTPS Tailscale address, on port 443 or 8443."); }
    }
    public static String connection(String input) {
        String result = origin(input); URI uri = URI.create(input.trim());
        if (!(uri.getPath().isEmpty() || uri.getPath().equals("/")) || uri.getQuery() != null || uri.getFragment() != null) throw new IllegalArgumentException("Enter the address only, without a page or extra parameters.");
        return result;
    }
    public static boolean allowed(String url, String selected) {
        try { return URI.create(origin(url)).getHost().equals(URI.create(origin(selected)).getHost()); }
        catch (Exception ignored) { return false; }
    }
    public static boolean sameOrigin(String url, String selected) {
        try { return origin(url).equals(origin(selected)); } catch (Exception ignored) { return false; }
    }
}
