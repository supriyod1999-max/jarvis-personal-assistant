package org.jarvisassistant.app;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.os.*;
import android.view.*;

/** Native vector eyes: no camera frames, fake sensor readings or network in this view. */
final class PetFaceView extends View {
    interface Touch{void controls();void boop();}
    enum Mood{IDLE,CURIOUS,LISTENING,THINKING,SPEAKING,HAPPY,SLEEP}
    private final Paint paint=new Paint(3);private final Path path=new Path();private final Handler main=new Handler(Looper.getMainLooper());private final GestureDetector gestures;
    private long beatAt;private float beatStrength;private long musicUntil;private float musicLevel;private long waveUntil,winkUntil,gazeAt;private float tilt,targetTilt;private Mood mood=Mood.IDLE;private boolean attached,paused=true,lowPower;private int color=0xffa9e4d5;private float targetX,targetY,x,y,vx,vy,level;private long last,nextBlink=SystemClock.elapsedRealtime()+3500,blinkAt,happyUntil,touchUntil;private float fingerX,fingerY;private final Touch touch;
    PetFaceView(Context context,Touch touch){super(context);this.touch=touch;setBackgroundColor(Color.BLACK);setContentDescription("JARVIS pet. Tap to boop; long press for controls.");setFocusable(true);setClickable(true);setDefaultFocusHighlightEnabled(false);setOnFocusChangeListener((view,focused)->invalidate());setOnLongClickListener(view->{touch.controls();return true;});gestures=new GestureDetector(context,new GestureDetector.SimpleOnGestureListener(){@Override public boolean onDown(MotionEvent event){return true;}@Override public boolean onSingleTapUp(MotionEvent event){performClick();return true;}@Override public void onLongPress(MotionEvent event){performLongClick();}@Override public boolean onScroll(MotionEvent first,MotionEvent event,float dx,float dy){if(event==null)return false;fingerX=PetLayout.clamp((event.getX()/Math.max(1,getWidth())-.5f)*2,-1,1);fingerY=PetLayout.clamp((event.getY()/Math.max(1,getHeight())-.5f)*2,-1,1);touchUntil=SystemClock.elapsedRealtime()+800;invalidate();return true;}});}
    void mood(Mood value){if(mood!=value){mood=value;setContentDescription("JARVIS pet · "+value.name().toLowerCase(java.util.Locale.ROOT)+". Tap to boop; long press for controls.");}invalidate();}
    void gaze(float x,float y){gazeAt=SystemClock.elapsedRealtime();targetX=PetLayout.clamp(x,-1,1);targetY=PetLayout.clamp(y,-1,1);invalidate();}
    void beat(float strength){beatAt=SystemClock.elapsedRealtime();beatStrength=PetLayout.clamp(strength,0,1);invalidate();}
    void music(boolean active,float level){musicUntil=active?SystemClock.elapsedRealtime()+2500:0;musicLevel=PetLayout.clamp(level,0,1);invalidate();}
    void react(PetReactions.Cue cue){long now=SystemClock.elapsedRealtime();if(cue==PetReactions.Cue.SMILE)happyUntil=now+2200;else if(cue==PetReactions.Cue.WINK)winkUntil=now+1100;else if(cue==PetReactions.Cue.WAVE){waveUntil=now+2500;happyUntil=now+2500;}invalidate();}
    void tilt(float degrees){targetTilt=PetLayout.clamp(degrees*.35f,-10,10);}
    void level(float value){level=PetLayout.clamp(value,0,1);invalidate();}
    void style(int tint,boolean saving){color=tint;lowPower=saving;invalidate();}
    void resume(){paused=false;last=SystemClock.elapsedRealtime();main.removeCallbacks(frame);frame.run();}
    void pause(){paused=true;main.removeCallbacks(frame);}
    private final Runnable frame=new Runnable(){public void run(){if(!attached||paused)return;invalidate();if(ValueAnimator.areAnimatorsEnabled())main.postDelayed(this,mood==Mood.SLEEP?500:lowPower?250:mood==Mood.IDLE&&SystemClock.elapsedRealtime()>happyUntil?66:33);}};
    @Override protected void onAttachedToWindow(){super.onAttachedToWindow();attached=true;if(!paused)frame.run();}
    @Override protected void onDetachedFromWindow(){attached=false;main.removeCallbacksAndMessages(null);super.onDetachedFromWindow();}
    @Override public boolean onTouchEvent(MotionEvent event){gestures.onTouchEvent(event);return true;}
    @Override public boolean performClick(){super.performClick();happyUntil=SystemClock.elapsedRealtime()+1800;performHapticFeedback(HapticFeedbackConstants.CLOCK_TICK);touch.boop();invalidate();return true;}
    @Override protected void onDraw(Canvas canvas){long now=SystemClock.elapsedRealtime();float dt=Math.min(.06f,Math.max(.001f,(now-last)/1000f));last=now;boolean motion=ValueAnimator.areAnimatorsEnabled();float gx=now<touchUntil?fingerX:targetX,gy=now<touchUntil?fingerY:targetY;
        if(motion&&now-gazeAt>3500&&mood==Mood.IDLE){gx=(float)Math.sin(now/4300.0)*.24f;gy=(float)Math.sin(now/7100.0)*.12f;}
        if(motion){vx+=(90*(gx-x)-18*vx)*dt;vy+=(90*(gy-y)-18*vy)*dt;x+=vx*dt;y+=vy*dt;}else{x=gx;y=gy;}
        boolean dancing=now<musicUntil&&(mood==Mood.IDLE||mood==Mood.CURIOUS);Mood state=now<happyUntil||dancing?Mood.HAPPY:mood;float w=getWidth(),h=getHeight(),unit=Math.min(w,h),eyeW=Math.min(w*.19f,unit*.255f),eyeH=eyeW*1.25f,cx=w*.5f,cy=h*.49f;
        tilt+= (targetTilt-tilt)*Math.min(1,dt*7);int save=canvas.save();if(motion){canvas.rotate(tilt+(dancing?(float)Math.sin(now/250.0)*8:0),cx,cy);if(dancing){float pulse=Math.max(0,1-(now-beatAt)/300f)*beatStrength;canvas.scale(1+pulse*.055f,1-pulse*.035f,cx,cy);canvas.translate((float)Math.sin(now/380.0)*unit*.035f,-Math.abs((float)Math.sin(now/190.0))*unit*.04f*(.5f+musicLevel));}}
        float drift=motion?(float)Math.sin(now/23000.0)*Math.min(3,getResources().getDisplayMetrics().density*1.5f):0;float shiftX=x*eyeW*.22f+drift,shiftY=y*eyeH*.14f;
        if(now>=nextBlink&&state!=Mood.SLEEP&&motion){blinkAt=now;nextBlink=now+3500+(long)(Math.random()*4000);}float blink=blinkAt>0&&now-blinkAt<160?(float)Math.sin((now-blinkAt)/160.0*Math.PI):0;
        if(state==Mood.SLEEP){eyeH*=.07f;shiftY=0;}else if(state==Mood.THINKING)eyeH*=.92f;else if(state==Mood.LISTENING)eyeH*=1.12f;
        eyeH=Math.max(3*getResources().getDisplayMetrics().density,eyeH*(1-blink*.95f));int tint=state==Mood.THINKING?0xffbaade8:color;
        eye(canvas,cx-eyeW*.94f+shiftX,cy+shiftY,eyeW,eyeH,tint,state,true);eye(canvas,cx+eyeW*.94f+shiftX,cy+shiftY,eyeW,now<winkUntil?Math.max(3,eyeH*.08f):eyeH,tint,state,false);
        float mouthY=cy+Math.max(eyeW*.91f,12*getResources().getDisplayMetrics().density);paint.setColor(tint);paint.setStrokeWidth(Math.max(2,unit*.008f));paint.setStrokeCap(Paint.Cap.ROUND);paint.setStyle(Paint.Style.STROKE);
        if(state==Mood.SPEAKING){paint.setStyle(Paint.Style.FILL);float opening=eyeW*(.045f+level*.16f);canvas.drawOval(cx-eyeW*.12f,mouthY-opening,cx+eyeW*.12f,mouthY+opening,paint);}
        else if(state!=Mood.SLEEP){path.reset();path.moveTo(cx-eyeW*.17f,mouthY);path.quadTo(cx-eyeW*.09f,mouthY+eyeW*.14f,cx,mouthY+eyeW*.035f);path.quadTo(cx+eyeW*.09f,mouthY+eyeW*.14f,cx+eyeW*.17f,mouthY);canvas.drawPath(path,paint);}
        paint.setStyle(Paint.Style.FILL);
        if(state==Mood.HAPPY){paint.setColor(0xffe6a6ae);paint.setAlpha(125);for(int side=-1;side<=1;side+=2){float cheek=cx+side*eyeW*1.24f;canvas.drawOval(cheek-eyeW*.17f,cy+eyeW*.5f,cheek+eyeW*.17f,cy+eyeW*.62f,paint);}paint.setAlpha(255);}
        if(now<waveUntil){float hx=cx-eyeW*1.35f,hy=cy+eyeW*.7f;int hand=canvas.save();if(motion)canvas.rotate((float)Math.sin((waveUntil-now)/110.0)*22,hx,hy);paint.setColor(tint);paint.setStrokeWidth(eyeW*.065f);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStyle(Paint.Style.STROKE);canvas.drawOval(hx-eyeW*.14f,hy-eyeW*.1f,hx+eyeW*.14f,hy+eyeW*.18f,paint);for(int i=0;i<3;i++)canvas.drawLine(hx+(i-1)*eyeW*.095f,hy-eyeW*.04f,hx+(i-1)*eyeW*.13f,hy-eyeW*(i==1?.38f:.28f),paint);canvas.restoreToCount(hand);paint.setStyle(Paint.Style.FILL);}canvas.restoreToCount(save);
        if(isFocused()&&!isInTouchMode()){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(getResources().getDisplayMetrics().density*1.5f);paint.setColor(color);paint.setAlpha(180);float left=cx-eyeW*1.55f,right=cx+eyeW*1.55f,top=cy-eyeW*.78f,bottom=mouthY+eyeW*.3f,len=eyeW*.16f;for(int side=0;side<2;side++){float edge=side==0?left:right,step=side==0?len:-len;canvas.drawLine(edge,top,edge+step,top,paint);canvas.drawLine(edge,top,edge,top+len,paint);canvas.drawLine(edge,bottom,edge+step,bottom,paint);canvas.drawLine(edge,bottom,edge,bottom-len,paint);}paint.setAlpha(255);paint.setStyle(Paint.Style.FILL);}
    }
    private void eye(Canvas canvas,float cx,float cy,float width,float height,int tint,Mood state,boolean left){
        paint.setShader(null);paint.setStyle(Paint.Style.FILL);paint.setColor(tint);paint.setAlpha(255);
        if(state==Mood.HAPPY&&height>width*.3f){
            paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(width*.19f);paint.setStrokeCap(Paint.Cap.ROUND);
            path.reset();path.moveTo(cx-width*.35f,cy+height*.1f);path.cubicTo(cx-width*.25f,cy-height*.32f,cx+width*.25f,cy-height*.32f,cx+width*.35f,cy+height*.1f);canvas.drawPath(path,paint);paint.setStyle(Paint.Style.FILL);return;
        }
        if(state==Mood.SLEEP||height<width*.2f){paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(width*.09f);paint.setStrokeCap(Paint.Cap.ROUND);path.reset();path.moveTo(cx-width*.32f,cy);path.quadTo(cx,cy+width*.12f,cx+width*.32f,cy);canvas.drawPath(path,paint);paint.setStyle(Paint.Style.FILL);return;}
        // Soft, pupil-free robot eyes. Gaze moves the whole eye rather than a staring iris.
        float curious=state==Mood.CURIOUS?(left?1.04f:.96f):1f;
        canvas.drawRoundRect(cx-width/2,cy-height*curious/2,cx+width/2,cy+height*curious/2,width*.48f,width*.48f,paint);
        paint.setColor(0xfff0fff8);paint.setAlpha(190);canvas.drawOval(cx-width*.29f,cy-height*.32f,cx-width*.05f,cy-height*.14f,paint);
        paint.setAlpha(65);canvas.drawCircle(cx+width*.23f,cy+height*.26f,width*.04f,paint);paint.setAlpha(255);
    }
}
