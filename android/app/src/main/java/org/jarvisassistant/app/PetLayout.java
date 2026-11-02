package org.jarvisassistant.app;
/** Actual window geometry, with an explicit optional layout override. */
final class PetLayout {
    enum Mode{COVER,FULL,DESK,WIDE}
    static Mode mode(float widthDp,float heightDp,boolean horizontalHalfOpen,String override){
        if("cover".equals(override))return Mode.COVER;if("desk".equals(override))return Mode.DESK;if("full".equals(override))return Mode.FULL;
        if(horizontalHalfOpen)return Mode.DESK;if(heightDp<=520&&widthDp<=520)return Mode.COVER;if(widthDp>heightDp*1.25f)return Mode.WIDE;return Mode.FULL;
    }
    static int faceHeight(int width,int height,Mode mode,int hingeTop,int minimum){
        if(mode==Mode.COVER||mode==Mode.WIDE)return height;
        if(mode==Mode.DESK&&hingeTop>minimum&&hingeTop<height-minimum)return hingeTop;
        return Math.max(Math.min(height-minimum,minimum),Math.round(height*(mode==Mode.DESK?.5f:.72f)));
    }
    static float clamp(float value,float min,float max){return Math.max(min,Math.min(max,value));}
}
