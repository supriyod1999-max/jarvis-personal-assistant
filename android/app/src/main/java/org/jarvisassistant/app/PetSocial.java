package org.jarvisassistant.app;

/** Session-only, anonymous social pacing. No face identity, private facts or retained observations. */
final class PetSocial {
    enum Mode { QUIET, FRIENDLY, SOCIABLE }
    private Mode mode=Mode.QUIET;
    private long presentSince=-1,lastPrompt=-1,nextPrompt=-1,windowStart=-1;
    private int prompts;private boolean paused;
    void mode(Mode value){mode=value;paused=false;presentSince=-1;nextPrompt=-1;}
    Mode mode(){return mode;}
    void pause(){paused=true;}
    boolean paused(){return paused;}
    boolean due(int people,long now,int hour,boolean busy,double random){
        if(people!=1){presentSince=-1;return false;}
        if(presentSince<0)presentSince=now;
        if(mode==Mode.QUIET||paused||busy||hour<8||hour>=22||now-presentSince<3000)return false;
        if(windowStart<0||now-windowStart>=3600000){windowStart=now;prompts=0;}
        if(prompts>=2)return false;
        if(lastPrompt>=0&&(mode==Mode.FRIENDLY||now-lastPrompt<1200000))return false;
        if(nextPrompt<0){nextPrompt=now+15000+(long)(Math.max(0,Math.min(1,random))*45000);return false;}
        if(now<nextPrompt)return false;
        lastPrompt=now;prompts++;nextPrompt=now+1200000+(long)(Math.max(0,Math.min(1,random))*600000);return true;
    }
    static boolean asksForQuiet(String words){
        if(words==null)return false;
        return words.toLowerCase(java.util.Locale.ROOT).replaceAll("[.!?,]","").trim().matches("(?:please )?(?:not now|be quiet|quiet please|leave me alone|stop talking|let me work|give me some quiet)(?: please)?");
    }
}
