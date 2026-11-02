package org.jarvisassistant.app;
import org.junit.Test;import static org.junit.Assert.*;
public class PetDeskTest {
 @Test public void boundedModesNeverInterpretGeneralCommands(){assertEquals(PetDesk.Mode.WORK,PetDesk.command("Start focus!"));assertEquals(PetDesk.Mode.BEDTIME,PetDesk.command("good night"));assertNull(PetDesk.command("Start work and delete my files"));assertEquals(PetDesk.Mode.RELAX,PetDesk.parse("bad"));assertEquals(PetSocial.Mode.QUIET,PetDesk.social(PetDesk.Mode.WORK));}
}
