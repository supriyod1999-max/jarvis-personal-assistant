package org.jarvisassistant.app;
import org.junit.Test;import static org.junit.Assert.*;
public class PetMusicStateTest {
 @Test public void requiresRepeatedMusicAndSettlesAfterSilence(){PetMusicState s=new PetMusicState();assertFalse(s.update(.9f));assertTrue(s.update(.9f));assertTrue(s.update(.1f));assertTrue(s.update(.1f));assertFalse(s.update(.1f));assertFalse(s.update(Float.NaN));assertFalse(s.update(.9f));s.reset();assertFalse(s.update(.9f));}
}
