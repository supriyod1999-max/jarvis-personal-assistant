package org.jarvisassistant.app;

/** Short-lived visual cues, never an estimate of a person's emotional state. */
final class PetReactions {
    enum Cue { NONE, SMILE, WINK, WAVE }
    private long smileSince=-1,winkSince=-1,lastSmile=-20000,lastWink=-20000,lastWave=-20000;
    private final Wave left=new Wave(),right=new Wave();
    Cue face(float smile,float leftOpen,float rightOpen,long now){
        boolean smiling=Float.isFinite(smile)&&smile>=.8f;
        if(!smiling)smileSince=-1;else if(smileSince<0)smileSince=now;
        boolean wink=leftOpen>=0&&rightOpen>=0&&((leftOpen<.2f&&rightOpen>.8f)||(rightOpen<.2f&&leftOpen>.8f));
        if(!wink)winkSince=-1;else if(winkSince<0)winkSince=now;
        if(wink&&now-winkSince>=240&&now-lastWink>=6000){lastWink=now;winkSince=-1;return Cue.WINK;}
        if(smiling&&now-smileSince>=450&&now-lastSmile>=10000){lastSmile=now;smileSince=-1;return Cue.SMILE;}
        return Cue.NONE;
    }
    Cue hands(float lx,float ly,float lc,float rx,float ry,float rc,float shoulderX,float shoulderY,float shoulderWidth,float confidence,long now){
        if(confidence<.7f||!Float.isFinite(shoulderWidth)||shoulderWidth<.08f){left.reset();right.reset();return Cue.NONE;}
        boolean a=left.update((lx-shoulderX)/shoulderWidth,ly<shoulderY&&lc>=.75f,now);
        boolean b=right.update((rx-shoulderX)/shoulderWidth,ry<shoulderY&&rc>=.75f,now);
        if((a||b)&&now-lastWave>=7000){lastWave=now;return Cue.WAVE;}return Cue.NONE;
    }
    void lostFace(){smileSince=winkSince=-1;}
    private static final class Wave {
        long start=-1,last;float extreme;int direction,reversals;
        void reset(){start=-1;direction=reversals=0;}
        boolean update(float x,boolean raised,long now){
            if(!raised||!Float.isFinite(x)){reset();return false;}
            if(start<0||now-last>800||now-start>2600){reset();start=now;extreme=x;}
            last=now;float delta=x-extreme;
            if(direction==0){if(Math.abs(delta)>.22f){direction=delta>0?1:-1;extreme=x;}}
            else if(delta*direction>=0)extreme=x;
            else if(Math.abs(delta)>.28f){direction=-direction;extreme=x;reversals++;}
            if(reversals>=2&&now-start>=350){reset();return true;}return false;
        }
    }
}
