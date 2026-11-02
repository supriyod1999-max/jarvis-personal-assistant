package org.jarvisassistant.app;

import android.content.Context;
import com.k2fsa.sherpa.onnx.*;
import java.io.IOException;
import java.util.Arrays;

/** CPU-only acoustic keyword check on bounded RAM clips. No microphone/network owner. */
final class LocalWake implements AutoCloseable {
    static final class Match {
        final String phrase;final boolean hasCommand;final float firstToken,lastToken;
        Match(String phrase,boolean command,float first,float last){this.phrase=phrase;hasCommand=command;firstToken=first;lastToken=last;}
        @Override public String toString(){return phrase+" at "+firstToken+"–"+lastToken+", command="+hasCommand;}
    }
    private KeywordSpotter spotter;
    LocalWake(Context context)throws IOException{
        try{
            OnlineTransducerModelConfig transducer=new OnlineTransducerModelConfig();
            transducer.setEncoder("wake/encoder.onnx");transducer.setDecoder("wake/decoder.onnx");transducer.setJoiner("wake/joiner.onnx");
            OnlineModelConfig model=new OnlineModelConfig();model.setTransducer(transducer);model.setTokens("wake/tokens.txt");model.setModelType("zipformer2");model.setProvider("cpu");model.setNumThreads(1);model.setDebug(false);
            KeywordSpotterConfig config=new KeywordSpotterConfig();config.setModelConfig(model);config.setFeatConfig(new FeatureConfig(16000,80,0));config.setKeywordsFile("wake/keywords.txt");config.setKeywordsThreshold(.35f);config.setKeywordsScore(1.5f);config.setNumTrailingBlanks(1);
            spotter=new KeywordSpotter(context.getAssets(),config);
        }catch(RuntimeException|LinkageError error){throw new IOException("The on-device wake engine could not load. Reinstall JARVIS or start a conversation in the app.",error);}
    }
    Match detect(byte[] pcm)throws IOException{
        if(spotter==null)throw new IOException("Wake engine stopped.");
        if(pcm.length<11200||pcm.length>960000||pcm.length%2!=0)throw new IOException("Invalid wake audio.");
        OnlineStream stream=spotter.createStream("");float[] samples=new float[640];
        try{
            // Each utterance gets a fresh stream, bounding native feature history.
            int total=pcm.length/2;
            for(int offset=0;offset<total+8000;offset+=640){
                if(Thread.currentThread().isInterrupted())throw new IOException("Wake check stopped.");
                for(int i=0;i<samples.length;i++){int position=(offset+i)*2;samples[i]=position+1<pcm.length?(short)((pcm[position]&255)|(pcm[position+1]<<8))/32768f:0;}
                stream.acceptWaveform(samples,16000);
                while(spotter.isReady(stream)){
                    spotter.decode(stream);KeywordSpotterResult result=spotter.getResult(stream);String phrase=phrase(result.getKeyword());
                    float[] timestamps=result.getTimestamps();
                    if(phrase!=null&&timestamps.length>0){float first=timestamps[0],last=timestamps[timestamps.length-1];
                        // Wake must begin the speech clip, not occur in a later quote.
                        if(first<=Math.min(.85f,speechStart(pcm)+.35f))return new Match(phrase,hasCommand(pcm,last),first,last);
                    }
                }
            }
            return null;
        }finally{Arrays.fill(samples,0);stream.release();}
    }
    private static String phrase(String keyword){switch(keyword){case "HEY_JARVIS":return "Hey JARVIS";case "HELLO_JARVIS":return "Hello JARVIS";case "WAKE_UP_JARVIS":return "Wake up JARVIS";default:return null;}}
    private static float speechStart(byte[] pcm){int consecutive=0;for(int offset=0;offset+640<=pcm.length/2;offset+=640){double energy=0;for(int i=0;i<640;i++){int position=(offset+i)*2;double value=(short)((pcm[position]&255)|(pcm[position+1]<<8))/32768.0;energy+=value*value;}if(Math.sqrt(energy/640)>.0035){if(++consecutive>=3)return (offset-1280)/16000f;}else consecutive=0;}return 0;}
    private static boolean hasCommand(byte[] pcm,float lastToken){
        int voiced=0,start=Math.max(0,(int)((lastToken+.4f)*16000));
        for(int offset=start;offset+640<=pcm.length/2;offset+=640){double energy=0;for(int i=0;i<640;i++){int position=(offset+i)*2;double value=(short)((pcm[position]&255)|(pcm[position+1]<<8))/32768.0;energy+=value*value;}if(Math.sqrt(energy/640)>.0035)voiced+=40;}
        return voiced>=160;
    }
    @Override public void close(){if(spotter!=null){spotter.release();spotter=null;}}
}
