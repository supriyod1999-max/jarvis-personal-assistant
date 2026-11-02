package org.jarvisassistant.app;
/** Lightweight onset detector. No song identity, saved audio or tempo claims. */
final class PetBeat {
    private double baseline=.02;private long last=-1000;
    float accept(short[] pcm,int length,long time){
        if(length<=0)return 0;double sum=0;for(int i=0;i<length;i++){double v=pcm[i]/32768.0;sum+=v*v;}double rms=Math.sqrt(sum/length);
        boolean peak=rms>.035&&rms>baseline*1.55&&time-last>=240;
        baseline=baseline*.94+rms*.06;if(!peak)return 0;last=time;return (float)Math.min(1,rms*5);
    }
}
