package org.jarvisassistant.app;
import org.junit.Test;
import static org.junit.Assert.*;

public class IslandGeometryTest {
    @Test public void samsungCenterCameraStaysAtTheSameAnchorThroughAllStates(){
        for(boolean[] mode:new boolean[][]{{false,false},{true,false},{true,true}}){
            IslandGeometry frame=IslandGeometry.calculate(1080,2340,2.8125f,112,510,0,570,104,mode[0],mode[1]);
            assertTrue(frame.cameraAligned);assertEquals(540,frame.x+frame.width/2,1);if(mode[1]){assertTrue(frame.y>=112);assertEquals(0,frame.cameraGap);}else{assertTrue(frame.y<104);assertTrue(frame.y+frame.headerHeight>=104);assertTrue(frame.cameraGap>=60);}
            assertTrue(frame.x>=0);assertTrue(frame.x+frame.width<=1080);
        }
    }
    @Test public void smallIdleAndCompactActivityLeaveMoreRoomThanExpandedControls(){
        IslandGeometry idle=IslandGeometry.calculate(1080,2340,2.8125f,112,510,0,570,104,false,false);
        IslandGeometry active=IslandGeometry.calculate(1080,2340,2.8125f,112,510,0,570,104,true,false);
        IslandGeometry expanded=IslandGeometry.calculate(1080,2340,2.8125f,112,510,0,570,104,true,true);
        assertTrue(idle.width<active.width);assertTrue(active.width<expanded.width);assertTrue(idle.width<1080/3);
    }
    @Test public void sideCamerasWideNotchesAndLandscapeUseTheUnobstructedFallback(){
        for(int[] bounds:new int[][]{{20,0,90,90},{300,0,780,100},{0,0,0,0}}){IslandGeometry frame=IslandGeometry.calculate(1080,2340,3,110,bounds[0],bounds[1],bounds[2],bounds[3],true,false);assertFalse(frame.cameraAligned);assertTrue(frame.y>=110);}
        IslandGeometry landscape=IslandGeometry.calculate(2340,1080,3,72,0,400,80,600,true,false);assertFalse(landscape.cameraAligned);assertTrue(landscape.x>80);assertTrue(landscape.y>=72);
    }
    @Test public void expandedControlsStayWithinNarrowPhoneEdges(){
        for(int width:new int[]{280,320,360,390}){IslandGeometry frame=IslandGeometry.calculate(width,844,1,28,width/2-8,0,width/2+8,28,true,true);assertTrue(frame.x>=12);assertTrue(frame.x+frame.width<=width-12);}
    }
}
