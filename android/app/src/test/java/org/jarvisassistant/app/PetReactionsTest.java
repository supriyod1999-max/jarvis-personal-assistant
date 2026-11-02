package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;
public class PetReactionsTest {
    @Test public void smilesNeedSustainedConfidenceAndHaveCooldown(){PetReactions r=new PetReactions();assertEquals(PetReactions.Cue.NONE,r.face(.95f,1,1,0));assertEquals(PetReactions.Cue.SMILE,r.face(.95f,1,1,500));assertEquals(PetReactions.Cue.NONE,r.face(.95f,1,1,1000));assertEquals(PetReactions.Cue.NONE,r.face(.95f,1,1,1500));r.lostFace();assertEquals(PetReactions.Cue.NONE,r.face(.95f,1,1,15000));}
    @Test public void blinkOrMissingClassificationIsNotWink(){PetReactions r=new PetReactions();r.face(-1,.1f,.1f,0);assertEquals(PetReactions.Cue.NONE,r.face(-1,.1f,.1f,400));r.face(-1,-1,.95f,500);assertEquals(PetReactions.Cue.NONE,r.face(-1,-1,.95f,900));r.face(-1,.1f,.95f,1000);assertEquals(PetReactions.Cue.WINK,r.face(-1,.1f,.95f,1300));}
    private PetReactions.Cue hand(PetReactions r,float x,float y,float confidence,long time){return r.hands(x,y,confidence,0,1,0,.5f,.6f,.2f,1,time);}
    @Test public void waveNeedsRaisedHandAndTwoReversals(){PetReactions r=new PetReactions();assertEquals(PetReactions.Cue.NONE,hand(r,.2f,.3f,1,0));assertEquals(PetReactions.Cue.NONE,hand(r,.35f,.3f,1,200));assertEquals(PetReactions.Cue.NONE,hand(r,.2f,.3f,1,400));assertEquals(PetReactions.Cue.WAVE,hand(r,.35f,.3f,1,600));assertEquals(PetReactions.Cue.NONE,hand(r,.2f,.3f,1,800));assertEquals(PetReactions.Cue.NONE,hand(r,.35f,.3f,1,1000));assertEquals(PetReactions.Cue.NONE,hand(r,.2f,.3f,1,1200));assertEquals(PetReactions.Cue.NONE,hand(r,.35f,.3f,1,1400));}
    @Test public void walkingNoiseLowConfidenceAndLongGapsDoNotWave(){for(float confidence:new float[]{.2f,1}){PetReactions r=new PetReactions();for(int i=0;i<20;i++)assertEquals(PetReactions.Cue.NONE,hand(r,i%2==0?.2f:.35f,confidence<1?.3f:.8f,confidence,i*200));}PetReactions r=new PetReactions();for(int i=0;i<10;i++)assertEquals(PetReactions.Cue.NONE,hand(r,i%2==0?.2f:.35f,.3f,.99f,i*1500));}
}
