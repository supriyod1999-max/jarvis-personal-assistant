package org.jarvisassistant.app;

import android.content.*;
import android.net.Uri;
import android.os.*;
import org.json.*;
import java.io.*;
import java.net.*;
import java.nio.channels.FileChannel;
import java.util.*;
import java.util.concurrent.ConcurrentHashMap;

/** One durable operation per job. Reconnect always reconciles before writing again. */
final class TransferEngine {
    interface Update{void accept(JSONObject item);}
    static final ConcurrentHashMap<String,TransferEngine> RUNNING=new ConcurrentHashMap<>();
    private final Context context;private final String id;private final TransferStore store;private final Update update;
    private volatile boolean stopped;private volatile TransferHttp http;private volatile Thread worker;
    TransferEngine(Context context,String id,Update update){this.context=context;this.id=id;this.update=update;store=new TransferStore(context);}
    void stop(){stopped=true;TransferHttp client=http;if(client!=null)client.close();Thread thread=worker;if(thread!=null)thread.interrupt();}
    private boolean active()throws Exception{String state=store.get(id).getString("state");return !stopped&&!TransferStore.terminal(state)&&!state.equals("paused")&&!state.equals("auth");}
    private void report()throws Exception{update.accept(store.get(id));}
    void run(){
        worker=Thread.currentThread();
        try{while(!stopped&&RUNNING.putIfAbsent(id,this)!=null)Thread.sleep(100);}catch(InterruptedException ignored){return;}
        if(stopped){RUNNING.remove(id,this);return;}int failures=0;
        PowerManager.WakeLock awake=context.getSystemService(PowerManager.class).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,"JARVIS:file-transfer");awake.setReferenceCounted(false);
        try{
            while(active()){
                if(!awake.isHeld())awake.acquire(600_000);
                JSONObject item=store.get(id);store.patch(id,"state","running","message","Transferring");report();
                try(TransferHttp client=new TransferHttp(item.getString("origin"))){
                    http=client;if(stopped)break;
                    if(item.optBoolean("cancelRequested")){
                        boolean complete=false;
                        if(item.getString("direction").equals("upload")){
                            try{complete=client.json("/api/files/transfers/cancel",new JSONObject().put("id",id)).optString("state").equals("complete");}catch(TransferHttp.Failure error){if(error.status!=404)throw error;}
                        }else{
                            try{if(!android.provider.DocumentsContract.deleteDocument(context.getContentResolver(),Uri.parse(item.getString("uri"))))throw new IOException("Document provider did not remove the file");}catch(Exception error){store.patch(id,"state","cancelled","message","Cancelled — remove the partial download manually");report();break;}
                        }
                        store.patch(id,"state",complete?"complete":"cancelled","message",complete?"Already saved to laptop":"Cancelled and partial file removed");report();break;
                    }
                    if(item.getString("direction").equals("upload"))upload(item,client);else download(item,client);
                    if(active()){store.patch(id,"state","complete","message","Transfer complete");report();}break;
                }catch(TransferHttp.Failure error){
                    if(!active())break;
                    if(error.status==401||error.status==403){store.patch(id,"state","auth","message","Unlock JARVIS, then resume this transfer");report();break;}
                    if(error.status==409&&!error.path.startsWith("/api/files/transfers/chunk")){store.patch(id,"state","failed","message","Destination changed or file name already exists. Start a new upload with another name");report();break;}
                    if(error.status>=400&&error.status<500&&error.status!=408&&error.status!=409&&error.status!=429){store.patch(id,"state","failed","message",error.status==412?"Source file changed. Start a fresh download":"File unavailable or transfer refused");report();break;}
                    failures++;
                }catch(SourceChanged error){if(active()){store.patch(id,"state","failed","message",error.getMessage());report();}break;}
                catch(Exception error){if(!active())break;failures++;}
                finally{http=null;}
                if(!active())break;
                store.patch(id,"state","waiting","message","Waiting for connection — progress saved");report();
                if(awake.isHeld())awake.release();
                Thread.sleep(Math.min(60000,3000L*(1L<<Math.min(4,failures))));
            }
        }catch(Exception ignored){/* Stop/interruption retains the last durable checkpoint. */}
        finally{http=null;if(awake.isHeld())awake.release();RUNNING.remove(id,this);worker=null;}
    }
    static final class SourceChanged extends IOException{SourceChanged(String message){super(message);}}
    private void upload(JSONObject item,TransferHttp client)throws Exception{
        Uri uri=Uri.parse(item.getString("uri"));long size=item.getLong("size");
        try{
            ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(uri,"r");
            if(descriptor==null)throw new SourceChanged("Choose the source file again");
            try(FileInputStream input=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){
                FileChannel channel=input.getChannel();if(channel.size()!=size)throw new SourceChanged("Source file changed. Start a fresh upload");
                String fingerprint=fingerprint(channel,size),previous=item.optString("sourceFingerprint");
                if(!previous.isEmpty()&&!previous.equals(fingerprint))throw new SourceChanged("Source file changed. Start a fresh upload");
                if(previous.isEmpty())store.patch(id,"sourceFingerprint",fingerprint);
                JSONObject request=new JSONObject().put("id",id).put("share",item.getString("share")).put("path",item.getString("path")).put("name",item.getString("name")).put("size",size);
                JSONObject saved=client.json("/api/files/transfers/begin",request);
                if(saved.getString("state").equals("complete")){store.patch(id,"offset",size);return;}
                if(saved.getString("state").equals("cancelled"))throw new SourceChanged("Upload was discarded");
                long offset=saved.getLong("offset");int chunk=saved.getInt("chunkBytes");
                if(offset<0||offset>size||chunk<1||chunk>8*1024*1024)throw new SourceChanged("Invalid upload progress");
                store.patch(id,"offset",offset);report();
                while(active()&&offset<size){
                    channel.position(offset);byte[] bytes=new byte[(int)Math.min(chunk,size-offset)];int read=0,count;
                    while(read<bytes.length&&(count=input.read(bytes,read,bytes.length-read))!=-1)read+=count;
                    if(read!=bytes.length||channel.size()!=size)throw new SourceChanged("Source file changed. Start a fresh upload");
                    JSONObject result;try{result=client.upload(id,offset,bytes);}finally{Arrays.fill(bytes,(byte)0);}
                    long next=result.getLong("offset");if(next!=offset+read)throw new SourceChanged("Upload progress changed unexpectedly");
                    offset=next;store.patch(id,"offset",offset);report();
                }
                if(active())client.json("/api/files/transfers/finish",new JSONObject().put("id",id));
            }
        }catch(FileNotFoundException error){throw new SourceChanged("Source file permission was removed. Choose it again");}
    }
    private void download(JSONObject item,TransferHttp client)throws Exception{
        String path=item.getString("download");HttpURLConnection info=client.open(path,"HEAD",Collections.emptyMap(),null);
        long total;String etag;
        try{total=info.getContentLengthLong();etag=info.getHeaderField("ETag");if(total<0||total>FileTransferPolicy.MAXIMUM_BYTES||etag==null||!etag.matches("\"[a-f0-9]{64}\""))throw new SourceChanged("Update laptop JARVIS before downloading");}
        finally{client.release(info);}
        String previous=item.optString("etag");if(!previous.isEmpty()&&!previous.equals(etag))throw new SourceChanged("Source file changed. Start a fresh download");
        long offset=item.optLong("offset",0);if(offset>total)throw new SourceChanged("Invalid saved download position");
        store.patch(id,"etag",etag,"size",total);report();
        Uri uri=Uri.parse(item.getString("uri"));
        try{
            ParcelFileDescriptor descriptor=context.getContentResolver().openFileDescriptor(uri,"rw");
            if(descriptor==null)throw new SourceChanged("Choose a writable download location");
            try(FileOutputStream output=new ParcelFileDescriptor.AutoCloseOutputStream(descriptor)){
                FileChannel channel=output.getChannel();if(channel.size()<offset)throw new SourceChanged("Partial file changed. Start a fresh download");
                channel.truncate(offset);channel.position(offset);
                while(active()&&offset<total){
                    long end=Math.min(total-1,offset+8*1024*1024-1),expected=end-offset+1,read=0;
                    Map<String,String> headers=new HashMap<>();headers.put("Range","bytes="+offset+"-"+end);headers.put("If-Match",etag);
                    HttpURLConnection connection=client.open(path,"GET",headers,null);
                    try(InputStream input=connection.getInputStream()){
                        if(connection.getResponseCode()!=206||connection.getContentLengthLong()!=expected||!etag.equals(connection.getHeaderField("ETag"))||!("bytes "+offset+"-"+end+"/"+total).equals(connection.getHeaderField("Content-Range")))throw new SourceChanged("Laptop does not support safe download resume");
                        byte[] block=new byte[32768];int count;
                        while((count=input.read(block))!=-1){if(!active())throw new InterruptedIOException();if(read+count>expected)throw new SourceChanged("Invalid download response");output.write(block,0,count);read+=count;}
                        if(read!=expected)throw new EOFException();
                        output.flush();channel.force(true);offset+=read;store.patch(id,"offset",offset);report();
                    }finally{client.release(connection);}
                }
                output.flush();channel.force(true);
            }
        }catch(FileNotFoundException error){throw new SourceChanged("Download permission was removed. Choose a new location");}
    }
    private static String fingerprint(FileChannel channel,long size)throws Exception{
        java.security.MessageDigest digest=java.security.MessageDigest.getInstance("SHA-256");
        for(long position:new long[]{0,Math.max(0,size-65536)}){
            channel.position(position);java.nio.ByteBuffer block=java.nio.ByteBuffer.allocate((int)Math.min(65536,size-position));while(block.hasRemaining()&&channel.read(block)>0){}digest.update(block.array());java.util.Arrays.fill(block.array(),(byte)0);
        }
        channel.position(0);StringBuilder hex=new StringBuilder();for(byte part:digest.digest())hex.append(String.format(java.util.Locale.ROOT,"%02x",part&255));return hex.toString();
    }
}
