package org.jarvisassistant.app;

import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.net.*;
import java.util.concurrent.atomic.AtomicInteger;

/** Streaming transfer checks on synthetic connections, never the owner's files. */
public class DownloadChecks {
    private static byte[] content;private static long declared;private static int status;private static final AtomicInteger opened=new AtomicInteger();
    @BeforeClass public static void fixture(){assertEquals("org.jarvisassistant.app.design",InstrumentationRegistry.getInstrumentation().getTargetContext().getPackageName());URL.setURLStreamHandlerFactory(protocol->"https".equals(protocol)?new URLStreamHandler(){@Override protected URLConnection openConnection(URL url){assertEquals("fixture.tail-test.ts.net",url.getHost());opened.incrementAndGet();return new HttpURLConnection(url){@Override public void connect(){}@Override public void disconnect(){}@Override public boolean usingProxy(){return false;}@Override public int getResponseCode(){return status;}@Override public long getContentLengthLong(){return declared;}@Override public InputStream getInputStream(){return new ByteArrayInputStream(content);}};}}:null);}
    @Before public void reset(){content="Exact synthetic file".getBytes(java.nio.charset.StandardCharsets.UTF_8);declared=content.length;status=200;opened.set(0);}
    @Test public void savesExactStreamAndReportsProgress()throws Exception{try(ApiClient api=new ApiClient("https://fixture.tail-test.ts.net","synthetic")){ByteArrayOutputStream target=new ByteArrayOutputStream();AtomicInteger progress=new AtomicInteger();api.download("/api/files/download?share=test&path=test.txt",target,progress::set);assertArrayEquals(content,target.toByteArray());assertEquals(100,progress.get());assertEquals(1,opened.get());}}
    @Test public void interruptedStreamIsNotMarkedSuccessful()throws Exception{declared+=9;try(ApiClient api=new ApiClient("https://fixture.tail-test.ts.net","")){try{api.download("/api/files/download?share=test&path=test.txt",new ByteArrayOutputStream(),value->{});fail("Truncated transfer accepted");}catch(IOException expected){assertTrue(expected.getMessage().contains("interrupted"));}assertEquals(1,opened.get());}}
    @Test public void refusesRedirectAndDoesNotRetry()throws Exception{status=302;try(ApiClient api=new ApiClient("https://fixture.tail-test.ts.net","")){try{api.download("/api/files/download?share=test&path=test.txt",new ByteArrayOutputStream(),value->{});fail("Redirect accepted");}catch(ApiClient.Failure expected){assertEquals(302,expected.status);}assertEquals(1,opened.get());}}
    @Test public void rejectsOverTwentyGbBeforeWriting()throws Exception{declared=FileTransferPolicy.MAXIMUM_BYTES+1;ByteArrayOutputStream target=new ByteArrayOutputStream();try(ApiClient api=new ApiClient("https://fixture.tail-test.ts.net","")){try{api.download("/api/files/download?share=test&path=test.txt",target,value->{});fail("Oversize transfer accepted");}catch(IOException expected){assertTrue(expected.getMessage().contains("20 GB"));}assertEquals(0,target.size());}}
    @Test public void acceptsTwentyGbHeaderWithoutIntegerOverflow()throws Exception{declared=FileTransferPolicy.MAXIMUM_BYTES;try(ApiClient api=new ApiClient("https://fixture.tail-test.ts.net","")){try{api.download("/api/files/download?share=test&path=test.txt",new ByteArrayOutputStream(),value->{});fail("Truncation missed");}catch(IOException expected){assertTrue(expected.getMessage().contains("interrupted"));}}}
}
