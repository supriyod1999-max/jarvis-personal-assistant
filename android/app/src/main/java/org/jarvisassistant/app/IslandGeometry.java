package org.jarvisassistant.app;

/** Pixel geometry, independent of Android views so real cutout cases can be tested. */
final class IslandGeometry {
    final int x,y,width,headerHeight,cameraGap;
    final boolean cameraAligned;
    private IslandGeometry(int x,int y,int width,int headerHeight,int cameraGap,boolean aligned) { this.x=x;this.y=y;this.width=width;this.headerHeight=headerHeight;this.cameraGap=cameraGap;this.cameraAligned=aligned; }
    static IslandGeometry calculate(int screenWidth,int screenHeight,float density,int statusBar,int left,int top,int right,int bottom,boolean active,boolean expanded) {
        float scale=Math.max(.5f,density);
        int margin=Math.round(12*scale), cameraWidth=Math.max(0,right-left);
        boolean aligned=screenHeight>screenWidth && cameraWidth>0 && cameraWidth<=Math.round(80*scale) && top<=statusBar && Math.abs((left+right)/2-screenWidth/2)<=screenWidth*.08f;
        int compact=aligned?Math.max(Math.round(72*scale),cameraWidth+Math.round(44*scale)):Math.round(72*scale);
        int width=Math.min(expanded?Math.round(350*scale):active?Math.round(152*scale):compact,Math.max(Math.round(72*scale),screenWidth-margin*2));
        int center=aligned?(left+right)/2:screenWidth/2;
        // Only the narrow camera capsule occupies the status-bar row. Wider
        // interaction cards move beneath it so clock/privacy/battery stay clear.
        int y=aligned&&!expanded?Math.max(Math.round(3*scale),bottom-Math.round(34*scale)):Math.max(statusBar,bottom)+Math.round(8*scale);
        int header=Math.round((active || expanded?44:40)*scale);
        int gap=aligned&&!expanded?Math.max(Math.round(28*scale),cameraWidth+Math.round(12*scale)):0;
        return new IslandGeometry(Math.max(margin,Math.min(screenWidth-margin-width,center-width/2)),y,width,header,gap,aligned);
    }
}
