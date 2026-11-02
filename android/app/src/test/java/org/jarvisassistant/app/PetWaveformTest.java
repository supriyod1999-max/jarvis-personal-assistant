package org.jarvisassistant.app;
import org.junit.Test;
import java.nio.*;
import static org.junit.Assert.*;
public class PetWaveformTest {
    @Test public void envelopeUsesActualSamplesAndRejectsUnsupportedOrTruncatedAudio(){byte[] wav=ByteBuffer.allocate(3244).order(ByteOrder.LITTLE_ENDIAN).put("RIFF".getBytes()).putInt(3236).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(3200).array();assertEquals(0,new PetWaveform(wav).level(0),0);for(int p=44;p<1644;p+=2){wav[p]=0;wav[p+1]=16;}assertTrue(new PetWaveform(wav).level(0)>.5f);assertEquals(0,new PetWaveform(wav).level(80),0);assertEquals(0,new PetWaveform(wav).level(200),0);assertEquals(0,new PetWaveform(new byte[0]).level(0),0);wav[20]=3;assertEquals(0,new PetWaveform(wav).level(0),0);}
}
