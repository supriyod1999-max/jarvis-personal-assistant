package org.jarvisassistant.app;

import android.webkit.CookieManager;
import org.json.JSONObject;
import java.io.*;
import java.net.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Fixed file endpoints; explicit engine reconciliation makes retries idempotent. */
final class TransferHttp implements AutoCloseable {
    static final class Failure extends IOException{final int status;final String path;Failure(int status,String path){super("File request failed");this.status=status;this.path=path;}}
    private final String origin;private volatile HttpURLConnection active;private volatile boolean closed;
    TransferHttp(String origin){this.origin=EndpointPolicy.connection(origin);}
    HttpURLConnection open(String path,String method,Map<String,String> headers,byte[] bytes)throws Exception{
        if(closed)throw new InterruptedIOException();
        if(!path.startsWith("/api/files/")||path.contains("\n")||path.contains("\r"))throw new IOException("Invalid file endpoint");
        HttpURLConnection connection=(HttpURLConnection)new URL(origin+path).openConnection();active=connection;
        connection.setInstanceFollowRedirects(false);connection.setUseCaches(false);
        // Attempt-level stall recovery only; there is no overall transfer deadline.
        connection.setConnectTimeout(20000);connection.setReadTimeout(45000);connection.setRequestMethod(method);
        connection.setRequestProperty("Origin",origin);connection.setRequestProperty("Cache-Control","no-store");
        String cookie=CookieManager.getInstance().getCookie(origin);connection.setRequestProperty("Cookie",cookie==null?"":cookie);
        for(Map.Entry<String,String> header:headers.entrySet())connection.setRequestProperty(header.getKey(),header.getValue());
        try{
            if(closed)throw new InterruptedIOException();
            if(bytes!=null){connection.setDoOutput(true);connection.setFixedLengthStreamingMode(bytes.length);try(OutputStream output=connection.getOutputStream()){output.write(bytes);}}
            int status=connection.getResponseCode();if(status<200||status>=300)throw new Failure(status,path);
            return connection;
        }catch(Exception error){release(connection);throw error;}
    }
    private static Map<String,String> headers(String... pairs){Map<String,String> value=new HashMap<>();for(int i=0;i<pairs.length;i+=2)value.put(pairs[i],pairs[i+1]);return value;}
    JSONObject json(String path,JSONObject body)throws Exception{
        byte[] bytes=body==null?null:body.toString().getBytes(StandardCharsets.UTF_8);
        HttpURLConnection connection=open(path,body==null?"GET":"POST",body==null?Collections.emptyMap():headers("Content-Type","application/json","X-Second-Brain","1"),bytes);
        try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] block=new byte[4096];int count;while((count=input.read(block))!=-1){if(output.size()+count>16000)throw new IOException("Invalid transfer response");output.write(block,0,count);}return new JSONObject(output.toString("UTF-8"));
        }finally{release(connection);}
    }
    JSONObject upload(String id,long offset,byte[] bytes)throws Exception{
        byte[] digest=java.security.MessageDigest.getInstance("SHA-256").digest(bytes);StringBuilder hash=new StringBuilder();for(byte part:digest)hash.append(String.format(Locale.ROOT,"%02x",part&255));
        HttpURLConnection connection=open("/api/files/transfers/chunk?id="+id+"&offset="+offset,"POST",headers("Content-Type","application/octet-stream","X-Second-Brain","1","X-Content-SHA256",hash.toString()),bytes);
        try(InputStream input=connection.getInputStream();ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] block=new byte[1024];int count;while((count=input.read(block))!=-1){if(output.size()+count>16000)throw new IOException("Invalid transfer response");output.write(block,0,count);}return new JSONObject(output.toString("UTF-8"));
        }finally{release(connection);}
    }
    void release(HttpURLConnection connection){if(active==connection)active=null;connection.disconnect();}
    void interruptConnection(){HttpURLConnection connection=active;if(connection!=null)connection.disconnect();}
    @Override public void close(){closed=true;interruptConnection();}
}
