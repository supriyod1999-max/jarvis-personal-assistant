package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class RemoteProofTest {
    @Test public void proofIsBoundToRemoteDomainPhoneComputerAndShortExpiry(){
        String computer="00000000-0000-4000-8000-000000000001",device="a".repeat(64),payload="JARVIS_REMOTE_CONTROL_V1\n"+computer+"\n"+device+"\n00000000-0000-4000-8000-000000000002\n"+"a".repeat(32)+"\n1045000";
        assertTrue(RemoteProof.valid(payload,computer,device,1000000));assertFalse(RemoteProof.valid(payload,"other",device,1000000));assertFalse(RemoteProof.valid(payload,computer,"other",1000000));assertFalse(RemoteProof.valid(payload,computer,device,1045001));assertFalse(RemoteProof.valid(payload.replace("JARVIS_REMOTE_CONTROL_V1","JARVIS_WINDOWS_SIGNIN_V1"),computer,device,1000000));
    }
}
