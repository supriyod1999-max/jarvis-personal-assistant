package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class UpdatePolicyTest {
    private final String hash="a".repeat(64),url="/downloads/JARVIS-phone-0.10.0-aaaaaaaaaaaa.apk";
    @Test public void onlyBoundedFirstPartyImmutableArtifacts(){assertTrue(UpdatePolicy.valid(13,100000,hash,url,"phone"));assertFalse(UpdatePolicy.valid(13,100000,hash,url,"watch"));for(String bad:new String[]{"https://evil.test/app.apk","/downloads/../app.apk","/downloads/JARVIS.apk",url+"?redirect=x"})assertFalse(UpdatePolicy.valid(13,100000,hash,bad,"phone"));assertFalse(UpdatePolicy.valid(13,UpdatePolicy.MAX_BYTES+1,hash,url,"phone"));assertFalse(UpdatePolicy.valid(13,100000,"bad",url,"phone"));assertFalse(UpdatePolicy.valid(0,100000,hash,url,"phone"));}
    @Test public void noDowngradesOrDifferentPublishers(){assertTrue(UpdatePolicy.newer(12,13));assertFalse(UpdatePolicy.newer(13,13));assertFalse(UpdatePolicy.newer(14,13));assertTrue(UpdatePolicy.sameSigner(new byte[]{1,2,3},new byte[]{1,2,3}));assertFalse(UpdatePolicy.sameSigner(new byte[]{1,2,3},new byte[]{1,2,4}));assertFalse(UpdatePolicy.sameSigner(new byte[0],new byte[0]));assertFalse(UpdatePolicy.sameSigner(null,new byte[]{1}));}
}
