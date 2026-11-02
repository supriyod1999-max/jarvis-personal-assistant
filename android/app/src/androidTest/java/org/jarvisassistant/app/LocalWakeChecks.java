package org.jarvisassistant.app;

import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import java.io.*;
import java.nio.*;
import java.util.Arrays;
import org.junit.*;
import static org.junit.Assert.*;

/** Synthetic file inference only, never the owner's microphone, network or recordings. */
public class LocalWakeChecks {
    private Context context;private LocalWake engine;
    @Before public void setup()throws Exception{context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());engine=new LocalWake(context);}
    static byte[] pcm(String name,float volume)throws Exception{
        try(InputStream input=InstrumentationRegistry.getInstrumentation().getContext().getAssets().open("wake/"+name+".wav");ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] block=new byte[4096];int count;while((count=input.read(block))!=-1)output.write(block,0,count);byte[] wav=output.toByteArray();int offset=12;ByteBuffer header=ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);while(offset+8<wav.length){int length=header.getInt(offset+4);if(wav[offset]=='d'&&wav[offset+1]=='a'&&wav[offset+2]=='t'&&wav[offset+3]=='a'){byte[] pcm=Arrays.copyOfRange(wav,offset+8,offset+8+length);for(int i=0;i<pcm.length;i+=2){short value=(short)((pcm[i]&255)|(pcm[i+1]<<8));value=(short)(value*volume);pcm[i]=(byte)value;pcm[i+1]=(byte)(value>>8);}return pcm;}offset+=8+length+(length%2);}throw new IOException("Synthetic WAV data missing");}
    }
    @Test public void configuredWakePhrasesAreDetectedWithoutWhisper()throws Exception{for(String name:new String[]{"hey","hello","wake"}){LocalWake.Match match=engine.detect(pcm(name,1));assertNotNull(name,match);assertFalse(name+" must be wake-only",match.hasCommand);}}
    @Test public void quieterWakeIsDetected()throws Exception{assertNotNull(engine.detect(pcm("hey",.2f)));}
    @Test public void ordinarySpeechAndSilenceDoNotWake()throws Exception{assertNull("ordinary speech",engine.detect(pcm("negative",1)));assertNull("silence",engine.detect(new byte[64000]));assertNull("quoted wake",engine.detect(pcm("quoted",1)));}
    @Test public void questionAfterWakeIsRetained()throws Exception{LocalWake.Match match=engine.detect(pcm("question",1));assertNotNull(match);assertTrue(match.hasCommand);}
    @After public void close(){if(engine!=null)engine.close();}
}
