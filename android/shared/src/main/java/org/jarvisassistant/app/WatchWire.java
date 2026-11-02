package org.jarvisassistant.app;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** Bounded, transient frames. No filesystem paths, credentials or executable actions. */
final class WatchWire {
    static final String VOICE="/jarvis/watch/v1/voice/", COMMAND="/jarvis/watch/v1/command", STATUS="/jarvis/watch/v1/status";
    static final int PCM_LIMIT=960000, AUDIO_LIMIT=10000000;
    static boolean id(String value){return value!=null && value.matches("[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}");}
    static String channelId(String path){String id=path!=null&&path.startsWith(VOICE)?path.substring(VOICE.length()):"";return id(id)?id:null;}
    static void write(DataOutputStream out,String text,byte[] audio,int maximum)throws IOException{
        byte[] encoded=text.getBytes(StandardCharsets.UTF_8);
        if(encoded.length>12000 || audio.length>maximum)throw new IOException("Watch response too large.");
        out.writeInt(1);out.writeInt(encoded.length);out.write(encoded);out.writeInt(audio.length);out.write(audio);out.flush();
    }
    static Frame read(DataInputStream in,int maximum)throws IOException{
        if(in.readInt()!=1)throw new IOException("Update both JARVIS apps.");
        int n=in.readInt();if(n<0||n>12000)throw new IOException("Invalid watch message.");
        byte[] text=new byte[n];in.readFully(text);int length=in.readInt();
        if(length<0||length>maximum)throw new IOException("Invalid watch audio.");
        byte[] audio=new byte[length];try{in.readFully(audio);return new Frame(new String(text,StandardCharsets.UTF_8),audio);}catch(IOException e){Arrays.fill(audio,(byte)0);throw e;}
    }
    static final class Frame implements AutoCloseable {final String text;final byte[] audio;Frame(String text,byte[] audio){this.text=text;this.audio=audio;}public void close(){Arrays.fill(audio,(byte)0);}}
    static final class Seen {
        private final LinkedHashMap<String,Long> entries=new LinkedHashMap<>();
        synchronized boolean accept(String id,long now){entries.entrySet().removeIf(e->now-e.getValue()>600000);if(!WatchWire.id(id)||entries.containsKey(id)||entries.size()>=128)return false;entries.put(id,now);return true;}
    }
    static boolean media(String key){return Arrays.asList("previous","play-pause","next","volume-down","mute","volume-up").contains(key);}
    static long duration(int minutes){if(minutes!=15&&minutes!=60&&minutes!=0)throw new IllegalArgumentException("Choose a listening duration.");return minutes==0?0:minutes*60000L;}
}
