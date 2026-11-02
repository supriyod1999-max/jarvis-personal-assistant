package org.jarvisassistant.app;
import android.content.Context;
import android.media.*;
import android.os.*;
import java.io.IOException;
import java.nio.*;
import java.util.Arrays;
import java.util.function.Consumer;

/** In-memory visitor-note preview; separate from the shorter AI speech request limit. */
final class PetNoteAudio implements AutoCloseable {
    private final Context context;private final Consumer<String> status;private final Handler main=new Handler(Looper.getMainLooper());private MediaPlayer player;private byte[] wav;private AudioFocusRequest focus;
    PetNoteAudio(Context context,Consumer<String> status){this.context=context;this.status=status;}
    boolean playing(){return player!=null;}
    void play(byte[] pcm){close();if(pcm.length==0||pcm.length>PetMessageStore.MAX_AUDIO||pcm.length%2!=0){status.accept("This recording is unavailable.");return;}AudioManager manager=context.getSystemService(AudioManager.class);if(manager.getStreamVolume(AudioManager.STREAM_MUSIC)==0){status.accept("Raise media volume to hear this recording.");return;}
        wav=ByteBuffer.allocate(44+pcm.length).order(ByteOrder.LITTLE_ENDIAN).put("RIFF".getBytes()).putInt(36+pcm.length).put("WAVEfmt ".getBytes()).putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16).put("data".getBytes()).putInt(pcm.length).put(pcm).array();byte[] audio=wav;AudioAttributes attributes=new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build();focus=new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT).setAudioAttributes(attributes).setOnAudioFocusChangeListener(change->{if(change<0){close();status.accept("Playback interrupted. Your message is still here.");}},main).build();MediaPlayer output=new MediaPlayer();player=output;
        try{if(manager.requestAudioFocus(focus)!=AudioManager.AUDIOFOCUS_REQUEST_GRANTED)throw new IOException();output.setAudioAttributes(attributes);output.setDataSource(new MediaDataSource(){public int readAt(long position,byte[] target,int offset,int length){if(position>=audio.length)return -1;int n=Math.min(length,audio.length-(int)position);System.arraycopy(audio,(int)position,target,offset,n);return n;}public long getSize(){return audio.length;}public void close(){}});output.setOnCompletionListener(value->{close();status.accept("Recording ready.");});output.setOnErrorListener((value,what,extra)->{close();status.accept("Playback could not finish. Try again.");return true;});output.prepare();output.start();status.accept("Playing your recording…");main.postDelayed(()->{if(player==output){close();status.accept("Playback ended.");}},65000);}catch(Exception error){close();status.accept("Audio is unavailable. Check media volume or other audio apps.");}}
    @Override public void close(){main.removeCallbacksAndMessages(null);MediaPlayer value=player;player=null;if(value!=null)value.release();if(wav!=null){Arrays.fill(wav,(byte)0);wav=null;}if(focus!=null){context.getSystemService(AudioManager.class).abandonAudioFocusRequest(focus);focus=null;}}
}
