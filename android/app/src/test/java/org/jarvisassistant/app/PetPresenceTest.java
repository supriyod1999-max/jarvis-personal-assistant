package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PetPresenceTest {
    @Test public void welcomesAreDebouncedAndDoNotRepeatForNoiseOrInterruptConversation(){PetPresence presence=new PetPresence();assertFalse(presence.seen(1,0,false));assertFalse(presence.seen(1,1600,true));assertTrue(presence.seen(1,2000,false));assertFalse(presence.seen(1,300000,false));assertFalse(presence.seen(0,300001,false));assertFalse(presence.seen(1,300020,false));assertFalse(presence.seen(0,316000,false));assertFalse(presence.seen(1,316100,false));assertTrue(presence.seen(1,317700,false));}
}
