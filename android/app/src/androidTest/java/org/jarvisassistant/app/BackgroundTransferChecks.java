package org.jarvisassistant.app;

import android.content.*;
import android.net.Uri;
import android.os.*;
import android.app.job.JobScheduler;
import androidx.test.core.app.ActivityScenario;
import androidx.test.platform.app.InstrumentationRegistry;
import org.json.JSONObject;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;

/** Preview-only synthetic HTTPS/document bytes. No owner's files, network or microphone. */
public class BackgroundTransferChecks {
    private static final int CHUNK=8*1024*1024,TOTAL=CHUNK+23;
    private static final String ORIGIN="https://fixture.tail-test.ts.net",ETAG="\""+"a".repeat(64)+"\"";
    private static volatile String mode;private static volatile long uploaded;private static volatile boolean dropped;
    private static final AtomicInteger finishes=new AtomicInteger();
    private static final List<Long> offsets=Collections.synchronizedList(new ArrayList<>());
    private static volatile CountDownLatch entered,release;
    private Context context;private TransferStore store;private final List<String> ids=new ArrayList<>();private final List<File> documents=new ArrayList<>();
    @BeforeClass public static void fixture(){
        assertEquals("org.jarvisassistant.app.design",InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName());
        URL.setURLStreamHandlerFactory(protocol->!protocol.equals("https")?null:new URLStreamHandler(){@Override protected URLConnection openConnection(URL url){
            if(!url.getHost().equals("fixture.tail-test.ts.net"))throw new AssertionError("Unexpected host");
            return new HttpURLConnection(url){
                final ByteArrayOutputStream body=new ByteArrayOutputStream();long start,end;boolean lose,responded;
                @Override public void connect(){}@Override public void disconnect(){}@Override public boolean usingProxy(){return false;}
                @Override public OutputStream getOutputStream(){return body;}
                @Override public int getResponseCode(){
                    if(mode.equals("upload-conflict")&&url.getPath().endsWith("/begin"))return 409;
                    if(responded)return url.getPath().endsWith("/download")&&getRequestMethod().equals("GET")?206:200;responded=true;
                    try{
                        if(url.getPath().endsWith("/chunk")){
                            long position=Long.parseLong(Uri.parse(url.toString()).getQueryParameter("offset"));assertEquals(uploaded,position);offsets.add(position);uploaded+=body.size();
                            if(mode.equals("upload-loss")&&!dropped){dropped=true;lose=true;}
                        }
                        if(url.getPath().endsWith("/finish"))finishes.incrementAndGet();
                        if(url.getPath().endsWith("/download")&&getRequestMethod().equals("GET")){
                            String[] range=getRequestProperty("Range").substring(6).split("-");start=Long.parseLong(range[0]);end=Long.parseLong(range[1]);offsets.add(start);return 206;
                        }
                        return 200;
                    }catch(Exception error){throw new AssertionError(error);}
                }
                @Override public long getContentLengthLong(){return getRequestMethod().equals("HEAD")?TOTAL:end-start+1;}
                @Override public String getHeaderField(String key){if(key.equalsIgnoreCase("ETag"))return ETAG;if(key.equalsIgnoreCase("Content-Range"))return "bytes "+start+"-"+end+"/"+TOTAL;return null;}
                @Override public InputStream getInputStream()throws IOException{
                    if(lose)throw new IOException("Synthetic lost acknowledgement");
                    if(url.getPath().endsWith("/download")){
                        if(mode.equals("hold")&&start==0){entered.countDown();try{if(!release.await(10,TimeUnit.SECONDS))throw new IOException("Synthetic gate timeout");}catch(InterruptedException error){throw new InterruptedIOException();}}
                        final boolean interrupt=mode.equals("download-loss")&&start==CHUNK&&!dropped;if(interrupt)dropped=true;
                        return new InputStream(){long position=start;@Override public int read()throws IOException{if(interrupt&&position>start+5)throw new IOException("Synthetic connection drop");return position<=end?(int)((position++*17)%251):-1;}@Override public int read(byte[] bytes,int offset,int length)throws IOException{if(interrupt&&position>start+5)throw new IOException("Synthetic connection drop");if(position>end)return -1;int count=(int)Math.min(length,end-position+1);if(interrupt)count=Math.min(count,6);for(int i=0;i<count;i++)bytes[offset+i]=(byte)((position++*17)%251);return count;}};
                    }
                    String response="{}";
                    if(url.getPath().endsWith("/begin")||url.getPath().endsWith("/chunk"))response="{\"state\":\"uploading\",\"offset\":"+uploaded+",\"chunkBytes\":"+CHUNK+"}";
                    if(url.getPath().endsWith("/finish"))response="{\"state\":\"complete\"}";
                    return new ByteArrayInputStream(response.getBytes(java.nio.charset.StandardCharsets.UTF_8));
                }
            };
        }});
    }
    @Before public void prepare(){context=InstrumentationRegistry.getInstrumentation().getTargetContext();store=new TransferStore(context);mode="";uploaded=0;dropped=false;finishes.set(0);offsets.clear();entered=new CountDownLatch(1);release=new CountDownLatch(1);}
    private JSONObject item(String direction)throws Exception{
        File document=File.createTempFile("transfer-fixture-",".bin",context.getCacheDir());documents.add(document);
        if(direction.equals("upload"))try(FileOutputStream out=new FileOutputStream(document)){byte[] bytes=new byte[32768];Arrays.fill(bytes,(byte)23);int left=TOTAL;while(left>0){int count=Math.min(left,bytes.length);out.write(bytes,0,count);left-=count;}}
        JSONObject item=TransferJobs.create(context,ORIGIN,direction,"Synthetic transfer",Uri.fromFile(document),direction.equals("upload")?TOTAL:-1).put("share","drive-test").put("path","").put("download","/api/files/download?share=test&path=synthetic.bin");store.put(item);ids.add(item.getString("id"));return item;
    }
    private void waitFor(String id,String state,long timeout)throws Exception{long until=SystemClock.elapsedRealtime()+timeout;while(SystemClock.elapsedRealtime()<until){if(store.get(id).getString("state").equals(state))return;Thread.sleep(50);}assertEquals(state,store.get(id).getString("state"));}
    @After public void clean()throws Exception{release.countDown();for(String id:ids){JSONObject item=store.get(id);TransferJobs.stop(context,item);store.remove(id);}for(File document:documents)assertTrue(document.delete());}
    @Test public void downloadResumesAtLastDurableChunkAfterDrop()throws Exception{
        mode="download-loss";JSONObject item=item("download");String id=item.getString("id");Thread worker=new Thread(()->new TransferEngine(context,id,value->{}).run());worker.start();waitFor(id,"complete",20000);worker.join(3000);
        assertEquals(Arrays.asList(0L,(long)CHUNK,(long)CHUNK),offsets);assertEquals(TOTAL,documents.get(0).length());
        try(RandomAccessFile file=new RandomAccessFile(documents.get(0),"r")){for(long position:new long[]{0,CHUNK-1,CHUNK,TOTAL-1}){file.seek(position);assertEquals((position*17)%251,file.read());}}
    }
    @Test public void uploadReconcilesLostResponseWithoutDuplicatingBytes()throws Exception{
        mode="upload-loss";String id=item("upload").getString("id");Thread worker=new Thread(()->new TransferEngine(context,id,value->{}).run());worker.start();waitFor(id,"complete",20000);worker.join(3000);
        assertEquals(Arrays.asList(0L,(long)CHUNK),offsets);assertEquals(TOTAL,uploaded);assertEquals(1,finishes.get());
    }
    @Test public void changedDownloadSnapshotDoesNotOverwritePartialFile()throws Exception{
        JSONObject item=item("download");String id=item.getString("id");store.patch(id,"etag","\""+"b".repeat(64)+"\"","offset",10);
        try(FileOutputStream out=new FileOutputStream(documents.get(0))){out.write(new byte[10]);}
        new TransferEngine(context,id,value->{}).run();assertEquals("failed",store.get(id).getString("state"));assertEquals(10,documents.get(0).length());assertTrue(offsets.isEmpty());
    }
    @Test public void cancelledUploadCleansUpWithoutSendingMoreBytes()throws Exception{
        String id=item("upload").getString("id");store.patch(id,"cancelRequested",true);
        new TransferEngine(context,id,value->{}).run();assertEquals("cancelled",store.get(id).getString("state"));assertEquals(0,uploaded);assertEquals(0,finishes.get());assertTrue(offsets.isEmpty());
    }
    @Test public void duplicateFilenameStopsWithoutSendingOrRetrying()throws Exception{
        mode="upload-conflict";String id=item("upload").getString("id");new TransferEngine(context,id,value->{}).run();
        assertEquals("failed",store.get(id).getString("state"));assertTrue(store.get(id).getString("message").contains("another name"));assertEquals(0,uploaded);assertTrue(offsets.isEmpty());
    }
    private void shell(String command)throws Exception{try(ParcelFileDescriptor descriptor=InstrumentationRegistry.getInstrumentation().getUiAutomation().executeShellCommand(command);InputStream input=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){while(input.read()!=-1){}}}
    @Test public void uidtContinuesAfterHomeAndScreenOff()throws Exception{
        Assume.assumeTrue(Build.VERSION.SDK_INT>=34);mode="hold";JSONObject item=item("download");String id=item.getString("id");shell("input keyevent 224");shell("wm dismiss-keyguard");
        try(ActivityScenario<TransfersActivity> scenario=ActivityScenario.launch(TransfersActivity.class)){
            scenario.onActivity(activity->{try{TransferJobs.start(activity,item);}catch(Exception error){throw new AssertionError(error);}});
            assertTrue("Scheduled transfer did not start",entered.await(12,TimeUnit.SECONDS));shell("input keyevent 3");shell("input keyevent 223");release.countDown();waitFor(id,"complete",12000);
        }finally{shell("input keyevent 224");shell("wm dismiss-keyguard");context.getSystemService(JobScheduler.class).cancel(item.getInt("job"));}
    }
}
