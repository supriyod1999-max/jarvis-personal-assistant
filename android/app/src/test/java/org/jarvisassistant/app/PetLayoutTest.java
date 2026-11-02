package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PetLayoutTest {
    @Test public void usesRealWindowAndHingeWithExplicitOverrides(){assertEquals(PetLayout.Mode.COVER,PetLayout.mode(360,360,false,"auto"));assertEquals(PetLayout.Mode.FULL,PetLayout.mode(400,900,false,"auto"));assertEquals(PetLayout.Mode.WIDE,PetLayout.mode(850,390,false,"auto"));assertEquals(PetLayout.Mode.DESK,PetLayout.mode(400,800,true,"auto"));assertEquals(PetLayout.Mode.COVER,PetLayout.mode(400,900,false,"cover"));assertEquals(390,PetLayout.faceHeight(400,800,PetLayout.Mode.DESK,390,100));assertEquals(360,PetLayout.faceHeight(360,360,PetLayout.Mode.COVER,0,100));}
}
