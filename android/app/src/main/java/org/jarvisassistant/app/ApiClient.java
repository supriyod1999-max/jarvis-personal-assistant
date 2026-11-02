package org.jarvisassistant.app;

import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/** Only the selected workspace origin; never redirects, retries mutations, or logs content. */
final class ApiClient implements AutoCloseable {
    static final class Failure extends IOException {
        final int status;
        Failure(int status, String message) { super(message); this.status = status; }
    }
    final String origin;
    private int readTimeout=90000;
    private String cookie;
    private volatile boolean closed;
    private final Set<HttpURLConnection> active = ConcurrentHashMap.newKeySet();
    interface Snapshot { boolean accept(JSONObject snapshot) throws Exception; }
    ApiClient(String origin, String cookie) { this.origin = EndpointPolicy.connection(origin); this.cookie = cookie == null ? "" : cookie; }
    ApiClient(String origin,String cookie,int timeout){this(origin,cookie);readTimeout=timeout;}
    private HttpURLConnection open(String path, JSONObject body) throws Exception {
        return open(path,body,false);
    }
    private HttpURLConnection open(String path, JSONObject body, boolean fileTransfer) throws Exception {
        if (closed) throw new IOException("Listening stopped.");
        if (!path.startsWith("/api/") || path.contains("\r") || path.contains("\n")) throw new IOException("Invalid request.");
        HttpURLConnection c = (HttpURLConnection) new URL(origin + path).openConnection();
        c.setInstanceFollowRedirects(false); c.setConnectTimeout(fileTransfer?0:Math.min(12000,readTimeout)); c.setReadTimeout(fileTransfer?0:readTimeout);
        c.setRequestProperty("Origin", origin); c.setRequestProperty("Cookie", cookie);
        c.setRequestProperty("Cache-Control", "no-store"); c.setUseCaches(false);
        active.add(c);
        try {
            if (closed) throw new IOException("Listening stopped.");
            if (body != null) {
                byte[] bytes = body.toString().getBytes(StandardCharsets.UTF_8);
                c.setRequestMethod("POST"); c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json"); c.setRequestProperty("X-Second-Brain", "1");
                // Streaming mode also disables the HTTP client's automatic retry of a POST.
                c.setFixedLengthStreamingMode(bytes.length);
                try (OutputStream out = c.getOutputStream()) { out.write(bytes); }
            }
            int status = c.getResponseCode();
            if (status < 200 || status >= 300) {
                if (status == 401 || status == 403) throw new Failure(status, "Open JARVIS and unlock this workspace. Check Tailscale is connected.");
                String message = "JARVIS could not finish (" + status + ").";
                try (InputStream error = c.getErrorStream()) {
                    if (error != null) {
                        byte[] bounded = new byte[2049]; int length = 0, count;
                        while (length < bounded.length && (count = error.read(bounded, length, bounded.length - length)) != -1) { if (count == 0) break; length += count; }
                        if (length <= 2048) {
                            String detail = new JSONObject(new String(bounded, 0, length, StandardCharsets.UTF_8)).optString("error", "");
                            if (!detail.isEmpty() && detail.length() <= 240) message = detail.replaceAll("[\\p{Cntrl}]", " ");
                        }
                    }
                } catch (Exception ignored) { /* The status is sufficient; never retry a mutation. */ }
                throw new Failure(status, message);
            }
            return c;
        } catch (Exception error) { release(c); throw error; }
    }
    JSONObject json(String path, JSONObject body) throws Exception {
        return new JSONObject(new String(bytes(path, body, 3_000_000), StandardCharsets.UTF_8));
    }
    void download(String path,OutputStream output,java.util.function.IntConsumer progress)throws Exception{
        HttpURLConnection connection=open(path,null,true);long length=connection.getContentLengthLong(),read=0;
        try(InputStream input=connection.getInputStream()){if(length>FileTransferPolicy.MAXIMUM_BYTES)throw new IOException("Files can be up to 20 GB.");byte[] buffer=new byte[32768];int count;while((count=input.read(buffer))!=-1){if(closed||read+count>FileTransferPolicy.MAXIMUM_BYTES)throw new IOException("Transfer stopped or file exceeds 20 GB.");output.write(buffer,0,count);read+=count;if(length>0)progress.accept(FileTransferPolicy.progress(read,length));}if(length>=0 && read!=length)throw new IOException("Transfer interrupted. The partial file was removed.");}
        finally{release(connection);}
    }
    byte[] bytes(String path, JSONObject body, int limit) throws Exception {
        HttpURLConnection c = open(path, body);
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] block = new byte[8192]; int n;
            while ((n = in.read(block)) != -1) { if (closed || out.size() + n > limit) throw new IOException("Response stopped or too large."); out.write(block, 0, n); }
            return out.toByteArray();
        } finally { release(c); }
    }
    void events(String id, Snapshot callback) throws Exception {
        HttpURLConnection c = open("/api/chat/events?id=" + URLEncoder.encode(id, "UTF-8"), null);
        c.setReadTimeout(25000);
        long deadline = System.nanoTime() + 180_000_000_000L;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream line = new ByteArrayOutputStream(); int b;
            while (!closed && System.nanoTime() < deadline && (b = in.read()) != -1) {
                if (b == '\n') {
                    String value = line.toString("UTF-8"); line.reset();
                    if (value.startsWith("data: ") && callback.accept(new JSONObject(value.substring(6)))) return;
                } else { if (line.size() > 3_000_000) throw new IOException("Conversation response too large."); line.write(b); }
            }
            throw new IOException("Connection ended. Open the conversation before repeating an action.");
        } finally { release(c); }
    }
    private void release(HttpURLConnection c) { active.remove(c); c.disconnect(); }
    @Override public void close() { closed = true; cookie = ""; for (HttpURLConnection c : active) c.disconnect(); active.clear(); }
}
