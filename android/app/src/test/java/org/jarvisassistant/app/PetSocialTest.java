package org.jarvisassistant.app;
import org.junit.Test;import static org.junit.Assert.*;
public class PetSocialTest {
 @Test public void quietIsDefaultAndPresenceIsRequired(){PetSocial s=new PetSocial();assertFalse(s.due(1,0,12,false,0));assertFalse(s.due(1,90000,12,false,0));s.mode(PetSocial.Mode.SOCIABLE);assertFalse(s.due(0,90001,12,false,0));assertFalse(s.due(2,90002,12,false,0));assertFalse(s.due(1,91000,12,false,0));assertFalse(s.due(1,94000,12,false,0));assertTrue(s.due(1,109000,12,false,0));}
 @Test public void busyQuietHoursAndRateLimitAreRespected(){PetSocial s=new PetSocial();s.mode(PetSocial.Mode.SOCIABLE);s.due(1,0,12,false,0);assertFalse(s.due(1,3000,12,true,0));assertFalse(s.due(1,4000,23,false,0));assertFalse(s.due(1,5000,7,false,0));assertFalse(s.due(1,6000,12,false,0));assertTrue(s.due(1,21000,12,false,0));assertFalse(s.due(1,1220999,12,false,0));assertTrue(s.due(1,1221000,12,false,0));assertFalse(s.due(1,2421000,12,false,0));s.pause();assertFalse(s.due(1,9999999,12,false,0));}
 @Test public void friendlyOnlyGreetsOnceAndExplicitQuietDoesNotNeedAI(){PetSocial s=new PetSocial();s.mode(PetSocial.Mode.FRIENDLY);s.due(1,0,12,false,0);s.due(1,3000,12,false,0);assertTrue(s.due(1,18000,12,false,0));assertFalse(s.due(1,9999999,12,false,0));assertTrue(PetSocial.asksForQuiet("Not now, please."));assertFalse(PetSocial.asksForQuiet("What does not now mean?"));}
}
