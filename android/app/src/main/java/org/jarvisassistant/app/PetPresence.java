package org.jarvisassistant.app;
/** Anonymous presence debounce for optional welcomes. No identity or face history is stored. */
final class PetPresence {
    private long visibleSince=-1,lastSeen=-1,lastWelcome=-1;private boolean welcomed;
    boolean seen(int count,long now,boolean busy){
        if(count<=0){visibleSince=-1;if(lastSeen>=0&&now-lastSeen>=15000)welcomed=false;return false;}
        lastSeen=now;if(visibleSince<0)visibleSince=now;if(busy||welcomed||now-visibleSince<1500||lastWelcome>=0&&now-lastWelcome<120000)return false;
        welcomed=true;lastWelcome=now;return true;
    }
}
