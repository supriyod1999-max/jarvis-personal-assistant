package org.jarvisassistant.app;
import org.junit.Test;import static org.junit.Assert.*;import java.util.Arrays;
public class PetBeatTest {
 @Test public void silenceIsNotABeatAndPeaksAreRateLimited(){PetBeat beat=new PetBeat();short[] silence=new short[640],pulse=new short[640];Arrays.fill(pulse,(short)10000);assertEquals(0,beat.accept(silence,640,0),0);assertTrue(beat.accept(pulse,640,100)>0);assertEquals(0,beat.accept(pulse,640,150),0);for(int i=0;i<20;i++)beat.accept(silence,640,200+i*40);assertTrue(beat.accept(pulse,640,1100)>0);}
}
