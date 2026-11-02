package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.media.*;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import static org.junit.Assert.*;
public class WatchAudioChecks {
    @Test public void replyAudioUsesMediaOutputWithoutMicrophone()throws Exception{
        Instrumentation instrumentation=InstrumentationRegistry.getInstrumentation();Context context=instrumentation.getTargetContext();assertTrue(context.getPackageName().equals("org.jarvisassistant.app.design")||context.getPackageName().equals("org.jarvisassistant.app"));Activity activity=instrumentation.startActivitySync(new Intent(context,WatchActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        try{Thread.sleep(500);AudioManager manager=context.getSystemService(AudioManager.class);assertTrue("Set a nonzero media volume before this audible routing test",manager.getStreamVolume(AudioManager.STREAM_MUSIC)>0);byte[] pcm=new byte[64000];for(int i=0;i<pcm.length/2;i++){short sample=(short)(Math.sin(i*2*Math.PI*440/16000)*1200);pcm[i*2]=(byte)sample;pcm[i*2+1]=(byte)(sample>>8);}int[] routed={0};try(WatchSpeaker speaker=new WatchSpeaker(context)){speaker.play(VoiceRules.wav(pcm),()->true,type->routed[0]=type);}assertTrue("Android must select a real audio output",routed[0]>0);assertTrue(manager.getActiveRecordingConfigurations().isEmpty());assertFalse(WatchVoiceService.running);android.os.Bundle result=new android.os.Bundle();result.putString("audio_route","device type "+routed[0]+"; media speech playback completed");instrumentation.sendStatus(0,result);}finally{instrumentation.runOnMainSync(activity::finish);}
    }
}
