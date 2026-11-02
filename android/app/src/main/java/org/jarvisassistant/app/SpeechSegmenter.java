package org.jarvisassistant.app;

import java.io.ByteArrayOutputStream;
import java.util.Arrays;

/** Bounded RAM-only VAD. Keeps the soft start of “Hey” instead of clipping it. */
final class SpeechSegmenter {
    private final byte[] lead=new byte[9600]; // 300 ms at 16 kHz, PCM16
    private final ByteArrayOutputStream clip=new ByteArrayOutputStream();
    private int leadAt,leadSize,voiced,quiet;
    private float noise=.001f;
    private boolean started;
    boolean hasSpeech(){return started;}
    void reset(){Arrays.fill(lead,(byte)0);leadAt=leadSize=voiced=quiet=0;clip.reset();started=false;}
    byte[] accept(short[] samples,int count){
        double energy=0;byte[] bytes=new byte[count*2];
        for(int i=0;i<count;i++){float v=samples[i]/32768f;energy+=v*v;bytes[i*2]=(byte)samples[i];bytes[i*2+1]=(byte)(samples[i]>>8);}
        float rms=(float)Math.sqrt(energy/count),threshold=Math.max(.0035f,Math.min(.018f,noise*3));
        int ms=count*1000/16000;
        if(rms>threshold){
            if(!started){for(int i=0;i<leadSize;i++)clip.write(lead[(leadAt-leadSize+i+lead.length)%lead.length]);started=true;}
            voiced+=ms;quiet=0;
        } else {quiet+=ms;if(!started)noise=noise*.97f+rms*.03f;}
        if(started)clip.write(bytes,0,bytes.length);
        else for(byte b:bytes){lead[leadAt]=b;leadAt=(leadAt+1)%lead.length;leadSize=Math.min(lead.length,leadSize+1);}
        if(started && (quiet>=600 || clip.size()>=800000)){
            byte[] result=voiced>=160 && clip.size()>=11200?clip.toByteArray():null;reset();return result;
        }
        return null;
    }
}
