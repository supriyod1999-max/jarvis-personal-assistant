package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.io.*;
import java.util.*;

public class WatchWireTest {
    private byte[] header(int version,int textLength,int audioLength)throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();DataOutputStream out=new DataOutputStream(bytes);out.writeInt(version);out.writeInt(textLength);if(textLength==0)out.writeInt(audioLength);return bytes.toByteArray();}
    @Test public void roundTripAndErase()throws Exception{ByteArrayOutputStream bytes=new ByteArrayOutputStream();WatchWire.write(new DataOutputStream(bytes),"British Daniel · ready",new byte[]{1,2,3},10);WatchWire.Frame frame=WatchWire.read(new DataInputStream(new ByteArrayInputStream(bytes.toByteArray())),10);assertEquals("British Daniel · ready",frame.text);assertArrayEquals(new byte[]{1,2,3},frame.audio);frame.close();assertArrayEquals(new byte[3],frame.audio);}
    @Test public void rejectsUnboundedOrNegativeAllocationsBeforeReading()throws Exception{for(byte[] bytes:new byte[][]{header(2,0,0),header(1,-1,0),header(1,12001,0),header(1,0,-1),header(1,0,960001)}){try{WatchWire.read(new DataInputStream(new ByteArrayInputStream(bytes)),960000);fail("Invalid frame accepted");}catch(IOException expected){}}}
    @Test public void partialAudioFailsInsteadOfCreatingAQuestion()throws Exception{try{WatchWire.read(new DataInputStream(new ByteArrayInputStream(header(1,0,100))),100);fail();}catch(EOFException expected){}}
    @Test public void malformedPathsNeverReachTheMicrophoneBridge(){String id=UUID.randomUUID().toString();assertEquals(id,WatchWire.channelId(WatchWire.VOICE+id));assertNull(WatchWire.channelId(WatchWire.VOICE+id+"/extra"));assertNull(WatchWire.channelId("/api/remote/input"));assertNull(WatchWire.channelId(null));}
    @Test public void duplicateRequestsAreRejectedAndCacheIsBounded(){WatchWire.Seen seen=new WatchWire.Seen();String id=UUID.randomUUID().toString();assertTrue(seen.accept(id,0));assertFalse(seen.accept(id,1));for(int i=0;i<127;i++)assertTrue(seen.accept(UUID.randomUUID().toString(),2));assertFalse(seen.accept(UUID.randomUUID().toString(),3));assertTrue(seen.accept(UUID.randomUUID().toString(),600003));assertFalse(seen.accept("not-an-id",600004));}
    @Test public void fixedMediaListCannotTypeOrUnlock(){assertTrue(WatchWire.media("play-pause"));for(String key:Arrays.asList("windows.unlock","text","enter","run","/api/computer/approve"))assertFalse(WatchWire.media(key));}
    @Test public void listeningHasOnlyExplicitSupportedDurations(){assertEquals(900000,WatchWire.duration(15));assertEquals(3600000,WatchWire.duration(60));assertEquals(0,WatchWire.duration(0));try{WatchWire.duration(-1);fail();}catch(IllegalArgumentException expected){}}
}
