package org.jarvisassistant.app;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.io.IOException;
import java.util.concurrent.*;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.function.*;

/** Replies use media/speech audio, independent of muted watch notification sounds. */
final class WatchSpeaker implements AutoCloseable {
    private final Context context;private volatile MediaPlayer player;
    WatchSpeaker(Context context){this.context=context;}
    void play(byte[] audio,BooleanSupplier alive,IntConsumer route)throws Exception{
        AudioManager manager=context.getSystemService(AudioManager.class);if(manager.getStreamVolume(AudioManager.STREAM_MUSIC)==0)throw new IOException("Watch media volume is zero. Raise Media volume to hear replies.");
        MediaPlayer output=new MediaPlayer();player=output;CountDownLatch done=new CountDownLatch(1);AtomicBoolean failed=new AtomicBoolean();AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();AudioFocusRequest focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change->{if(change<0){failed.set(true);done.countDown();}},new Handler(Looper.getMainLooper())).build();
        try{if(manager.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new IOException("Audio is in use. Your written reply is ready.");output.setAudioAttributes(attributes);output.setDataSource(new MediaDataSource(){public int readAt(long p,byte[] b,int o,int n){if(p>=audio.length)return -1;int count=Math.min(n,audio.length-(int)p);System.arraycopy(audio,(int)p,b,o,count);return count;}public long getSize(){return audio.length;}public void close(){}});output.setOnCompletionListener(p->done.countDown());output.setOnErrorListener((p,w,e)->{failed.set(true);done.countDown();return true;});output.prepare();if(!alive.getAsBoolean())return;output.start();long end=SystemClock.elapsedRealtime()+120000;boolean routed=false;while(alive.getAsBoolean()&&!done.await(100,TimeUnit.MILLISECONDS)&&SystemClock.elapsedRealtime()<end){AudioDeviceInfo device=output.getRoutedDevice();if(!routed&&device!=null){route.accept(device.getType());routed=true;}}if(failed.get())throw new IOException("Audio was interrupted. Your written reply is ready.");if(SystemClock.elapsedRealtime()>=end)throw new IOException("Reply playback timed out.");}
        finally{player=null;output.release();manager.abandonAudioFocusRequest(focus);}
    }
    @Override public void close(){MediaPlayer current=player;if(current!=null)try{current.stop();}catch(RuntimeException ignored){}}
}
