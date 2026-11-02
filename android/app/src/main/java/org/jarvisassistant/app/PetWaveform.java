package org.jarvisassistant.app;
/** Bounded PCM WAV envelope for the face. Unsupported formats simply have no waveform. */
final class PetWaveform {
    private final byte[] audio;private int start,length,rate,channels;
    PetWaveform(byte[] audio){this.audio=audio;if(audio.length<44||!tag(0,"RIFF")||!tag(8,"WAVE"))return;boolean pcm=false;for(int p=12;p+8<=audio.length;){long size=u32(p+4);if(size>audio.length-p-8)return;if(tag(p,"fmt ")&&size>=16){pcm=u16(p+8)==1&&u16(p+22)==16;channels=u16(p+10);rate=(int)u32(p+12);}if(tag(p,"data")){start=p+8;length=(int)size;}long next=p+8+size+(size&1);if(next>audio.length||next<=p)return;p=(int)next;}if(!pcm||channels<1||channels>2||rate<8000||rate>96000){length=0;}}
    private boolean tag(int offset,String value){for(int i=0;i<value.length();i++)if(audio[offset+i]!=(byte)value.charAt(i))return false;return true;}
    private int u16(int offset){return(audio[offset]&255)|((audio[offset+1]&255)<<8);}
    private long u32(int offset){return((long)u16(offset))|((long)u16(offset+2)<<16);}
    float level(int milliseconds){if(length==0||milliseconds<0)return 0;long position=start+(long)milliseconds*rate/1000*channels*2;if(position<start||position>=start+length)return 0;int available=(int)Math.min(1024,start+length-position);double sum=0;int n=0;for(int p=(int)position;p+1<position+available;p+=2){double value=(short)u16(p)/32768.0;sum+=value*value;n++;}return n==0?0:Math.min(1,(float)Math.sqrt(sum/n)*5);}
}
