package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class SpeechSegmenterTest {
    private short[] tone(int amplitude){short[] block=new short[640];for(int i=0;i<block.length;i++)block[i]=(short)(Math.sin(i*.12)*amplitude);return block;}
    @Test public void softWakeRetainsItsBeginningAndFinishesSoonAfterSpeech(){
        SpeechSegmenter vad=new SpeechSegmenter();short[] quiet=tone(20),soft=tone(90),voice=tone(350);
        for(int i=0;i<12;i++)assertNull(vad.accept(quiet,640));
        for(int i=0;i<4;i++)assertNull(vad.accept(soft,640)); // soft leading “Hey”
        for(int i=0;i<12;i++)assertNull(vad.accept(voice,640)); // below old .012 threshold
        byte[] result=null;for(int i=0;i<15;i++){byte[] next=vad.accept(quiet,640);if(next!=null)result=next;}
        assertNotNull(result);assertTrue(result.length>=9600+12*1280);assertTrue(result.length<64000);
        // The retained pre-roll contains the quiet leading syllable.
        boolean retained=false;for(int i=0;i<9600;i+=2){short sample=(short)((result[i]&255)|(result[i+1]<<8));if(Math.abs(sample)>40)retained=true;}assertTrue(retained);
    }
    @Test public void noiseClicksAndResetCannotLeakOldSegments(){
        SpeechSegmenter vad=new SpeechSegmenter();for(int i=0;i<1000;i++)assertNull(vad.accept(tone(20),640));
        assertNull(vad.accept(tone(1000),640));for(int i=0;i<16;i++)assertNull(vad.accept(tone(20),640));
        for(int i=0;i<10;i++)assertNull(vad.accept(tone(500),640));vad.reset();for(int i=0;i<20;i++)assertNull(vad.accept(tone(20),640));
    }
    @Test public void continuousSpeechIsBounded(){SpeechSegmenter vad=new SpeechSegmenter();byte[] result=null;for(int i=0;i<700 && result==null;i++)result=vad.accept(tone(500),640);assertNotNull(result);assertTrue(result.length<=801280);}
}
