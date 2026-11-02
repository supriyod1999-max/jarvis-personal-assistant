package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;

public class VoiceRulesTest {
    @Test public void ambientSpeechCannotBecomeCommand() {
        for (String text : new String[]{"tell Jarvis to send it", "I said hey Jarvis earlier", "yes", "send it", "remember that", "hey jarvison"}) assertNull(text, VoiceRules.wakeCommand(text));
        assertEquals("", VoiceRules.wakeCommand("Hey Jarvis"));
        assertEquals("send it", VoiceRules.wakeCommand("Hello, Jarvis, send it"));
        assertEquals("read my updates", VoiceRules.wakeCommand("Wake up Jarvis. read my updates"));
    }
    @Test public void sleepAndOffAreExplicit() {
        assertTrue(VoiceRules.sleep("Go to sleep.")); assertTrue(VoiceRules.off("Jarvis, stop listening"));
        assertFalse(VoiceRules.sleep("Remind me to go to sleep")); assertFalse(VoiceRules.off("Do not stop listening"));
    }
    @Test public void acousticWakeMayStripAsrSpellingButAmbientSpeechStillCannotWake(){assertNull(VoiceRules.wakeCommand("Hey Jervis, what is two plus two?"));assertEquals("what is two plus two?",VoiceRules.afterDetectedWake("Hey Jervis, what is two plus two?"));assertEquals("what is two plus two?",VoiceRules.afterDetectedWake("Hey JARVIS, what is two plus two?"));assertEquals("What is two plus two?",VoiceRules.afterDetectedWake("What is two plus two?"));assertEquals("Tell Jarvis to send it",VoiceRules.afterDetectedWake("Tell Jarvis to send it"));}
    @Test public void boundedPcmHasExactWhisperHeader() {
        byte[] pcm = new byte[32000]; pcm[500] = 7; byte[] wav = VoiceRules.wav(pcm);
        ByteBuffer header = ByteBuffer.wrap(wav).order(ByteOrder.LITTLE_ENDIAN);
        assertEquals(32044, wav.length); assertEquals(16000, header.getInt(24)); assertEquals(1, header.getShort(22)); assertEquals(16, header.getShort(34)); assertEquals(7, wav[544]);
        for (int size : new int[]{100, 11201, 960002}) { try { VoiceRules.wav(new byte[size]); fail("accepted " + size); } catch (IllegalArgumentException expected) {} }
    }
    @Test public void spokenChunkIsBoundedAndPreservesWords() {
        String text = "First sentence. Then another sentence."; assertEquals(15, VoiceRules.chunk(text));
        assertTrue(VoiceRules.chunk("x".repeat(500)) <= 220);
        assertEquals("See this link", VoiceRules.spoken("See [this link](https://example.com)"));
    }
}
