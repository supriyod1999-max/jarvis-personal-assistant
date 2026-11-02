package org.jarvisassistant.app;

import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.hardware.display.DisplayManager;
import android.os.*;
import android.text.TextUtils;
import android.view.*;
import android.view.animation.PathInterpolator;
import android.widget.*;

/** Camera-anchored native island; no access to other apps or protected lock-screen UI. */
final class FloatingOrb {
    private final Context context;
    private final WindowManager manager;
    private final FrameLayout root;
    private final LinearLayout surface,header,detail;
    private final ScrollView detailViewport;
    private final View cameraSpace;
    private final TextView status,compactStatus,words;
    private final Signal brand,signal;
    private final WindowManager.LayoutParams params;
    private final Handler main=new Handler(Looper.getMainLooper());
    private final DisplayManager displays;
    private ValueAnimator animation;
    private boolean added,active,userExpanded,autoExpanded,manuallyCollapsed;
    private final TextView codingSummary;
    private String phase="Wake listening";
    private IslandGeometry geometry;
    private int targetX,targetY,targetWidth=-1,targetHeight;
    private final DisplayManager.DisplayListener displayListener=new DisplayManager.DisplayListener() {
        @Override public void onDisplayAdded(int id){} @Override public void onDisplayRemoved(int id){}
        @Override public void onDisplayChanged(int id){if(added)render(false);}
    };
    FloatingOrb(Context context,Runnable open,Runnable sleep,Runnable stop) {
        this.context=context; manager=context.getSystemService(WindowManager.class); displays=context.getSystemService(DisplayManager.class);
        root=new FrameLayout(context);root.setClipChildren(true);root.setMinimumHeight(dp(48));root.setFocusable(true);root.setOnClickListener(v->toggle());
        surface=new LinearLayout(context);surface.setOrientation(LinearLayout.VERTICAL);surface.setBackground(NativeStyle.background(context,0xff030506,0,24));surface.setClipToOutline(true);root.addView(surface,new FrameLayout.LayoutParams(-1,-2));
        header=new LinearLayout(context);header.setGravity(Gravity.CENTER_VERTICAL);header.setPadding(dp(4),0,dp(4),0);surface.addView(header,new LinearLayout.LayoutParams(-1,dp(40)));
        FrameLayout left=new FrameLayout(context),right=new FrameLayout(context);cameraSpace=new View(context);
        header.addView(left,new LinearLayout.LayoutParams(0,-1,1));header.addView(cameraSpace,new LinearLayout.LayoutParams(dp(28),1));header.addView(right,new LinearLayout.LayoutParams(0,-1,1));
        brand=new Signal(context,true);left.addView(brand,center(dp(14),dp(18)));
        compactStatus=NativeStyle.text(context,"Ready",11,NativeStyle.TEXT);compactStatus.setMaxLines(1);compactStatus.setEllipsize(TextUtils.TruncateAt.END);compactStatus.setGravity(Gravity.CENTER);compactStatus.setVisibility(View.GONE);left.addView(compactStatus,center(-1,-1));
        signal=new Signal(context,false);right.addView(signal,center(dp(16),dp(18)));
        header.setOnClickListener(v->toggle());header.setContentDescription("Show or hide JARVIS voice controls");header.setFocusable(true);header.setBackground(NativeStyle.ripple(context,0x00000000,0,24));
        detailViewport=new ScrollView(context);detailViewport.setVerticalScrollBarEnabled(false);surface.addView(detailViewport,new LinearLayout.LayoutParams(-1,-2));detailViewport.setVisibility(View.GONE);
        detail=NativeStyle.column(context);detail.setPadding(dp(18),dp(12),dp(18),dp(16));detailViewport.addView(detail);
        LinearLayout identity=new LinearLayout(context);identity.setGravity(Gravity.CENTER_VERTICAL);
        TextView name=NativeStyle.title(context,"JARVIS",15);name.setLetterSpacing(.12f);identity.addView(name,new LinearLayout.LayoutParams(0,-2,1));
        status=NativeStyle.text(context,"Wake listening",12,NativeStyle.ACCENT);identity.addView(status);detail.addView(identity);
        words=NativeStyle.text(context,"Say “Hey JARVIS”",14,NativeStyle.TEXT);words.setMaxLines(4);words.setEllipsize(TextUtils.TruncateAt.END);words.setPadding(0,dp(14),0,dp(16));detail.addView(words);
        LinearLayout controls=new LinearLayout(context);
        addButton(controls,"Open",()->{userExpanded=false;render(true);open.run();});addButton(controls,"Sleep",()->{userExpanded=false;render(true);sleep.run();});addButton(controls,"Stop",stop);detail.addView(controls);
        codingSummary=NativeStyle.text(context,"Codex activity",12,NativeStyle.MUTED);codingSummary.setPadding(0,dp(14),0,dp(10));detail.addView(codingSummary);
        detail.addView(NativeStyle.action(context,"View coding sessions","laptop",false,()->context.startActivity(new android.content.Intent(context,CodingActivity.class).putExtra("origin",VoiceService.lastOrigin).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))));
        params=new WindowManager.LayoutParams(dp(112),dp(48),WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL|WindowManager.LayoutParams.FLAG_SECURE|WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN,PixelFormat.TRANSLUCENT);
        params.gravity=Gravity.TOP|Gravity.LEFT;params.layoutInDisplayCutoutMode=Build.VERSION.SDK_INT>=30?WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS:WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES;
        if(Build.VERSION.SDK_INT>=30)params.setFitInsetsTypes(0);params.setTitle("JARVIS camera island");
        params.flags|=WindowManager.LayoutParams.FLAG_WATCH_OUTSIDE_TOUCH;
        root.setOnTouchListener((view,event)->{if(event.getAction()==MotionEvent.ACTION_OUTSIDE){userExpanded=autoExpanded=false;manuallyCollapsed=true;render(true);}return false;});
        root.setOnApplyWindowInsetsListener((view,insets)->{if(added)main.post(()->{if(!added)return;IslandGeometry next=measureGeometry();if(geometry==null||next.x!=geometry.x||next.y!=geometry.y||next.width!=geometry.width||next.cameraGap!=geometry.cameraGap)render(false);});return insets;});render(false);
    }
    private FrameLayout.LayoutParams center(int width,int height){return new FrameLayout.LayoutParams(width,height,Gravity.CENTER);}
    private void addButton(LinearLayout row,String text,Runnable action){Button b=NativeStyle.action(context,text,null,false,action);b.setTextSize(12);LinearLayout.LayoutParams size=new LinearLayout.LayoutParams(0,-2,1);size.setMargins(dp(3),0,dp(3),0);row.addView(b,size);}
    private int dp(float value){return NativeStyle.dp(context,value);}
    private boolean expanded(){return userExpanded||autoExpanded;}
    private void toggle(){boolean was=expanded();userExpanded=!was;autoExpanded=false;manuallyCollapsed=was;render(true);if(userExpanded)NativeStyle.reveal(detail);}
    private IslandGeometry measureGeometry(){
        Point size=new Point();manager.getDefaultDisplay().getRealSize(size);int bar=dp(28),l=0,t=0,r=0,b=0;
        try{WindowInsets insets=Build.VERSION.SDK_INT>=30?manager.getMaximumWindowMetrics().getWindowInsets():root.getRootWindowInsets();
            if(insets!=null){bar=Build.VERSION.SDK_INT>=30?insets.getInsetsIgnoringVisibility(WindowInsets.Type.statusBars()).top:insets.getStableInsetTop();DisplayCutout cutout=insets.getDisplayCutout();if(cutout!=null){for(Rect rect:cutout.getBoundingRects()){if(rect.top<=bar && rect.centerY()<size.y/3 && (r==0||Math.abs(rect.centerX()-size.x/2)<Math.abs((l+r)/2-size.x/2))){l=rect.left;t=rect.top;r=rect.right;b=rect.bottom;}}}}}
        catch(RuntimeException ignored){/* Use the fallback below system bars when no metrics are exposed. */}
        return IslandGeometry.calculate(size.x,size.y,context.getResources().getDisplayMetrics().density,bar,l,t,r,b,active,expanded());
    }
    private void render(boolean animate){
        geometry=measureGeometry();compactStatus.setVisibility(active&&!expanded()?View.VISIBLE:View.GONE);brand.setVisibility(active&&!expanded()?View.GONE:View.VISIBLE);detailViewport.setVisibility(expanded()?View.VISIBLE:View.GONE);
        header.getLayoutParams().height=geometry.headerHeight;cameraSpace.getLayoutParams().width=geometry.cameraGap;header.requestLayout();
        Point screen=new Point();manager.getDefaultDisplay().getRealSize(screen);int available=Math.max(dp(96),Math.min(dp(440),screen.y-geometry.y-dp(32)));
        surface.measure(View.MeasureSpec.makeMeasureSpec(geometry.width,View.MeasureSpec.EXACTLY),View.MeasureSpec.makeMeasureSpec(available,View.MeasureSpec.AT_MOST));int height=Math.max(dp(48),surface.getMeasuredHeight());
        root.setContentDescription("JARVIS camera island. "+phase+". "+(expanded()?"Controls expanded.":"Tap for voice controls."));
        if(added&&targetX==geometry.x&&targetY==geometry.y&&targetWidth==geometry.width&&targetHeight==height)return;
        targetX=geometry.x;targetY=geometry.y;targetWidth=geometry.width;targetHeight=height;
        if(animation!=null)animation.cancel();
        if(!added||!animate||!ValueAnimator.areAnimatorsEnabled()){params.x=geometry.x;params.y=geometry.y;params.width=geometry.width;params.height=height;if(added)manager.updateViewLayout(root,params);return;}
        int fromX=params.x,fromY=params.y,fromWidth=params.width,fromHeight=params.height;IslandGeometry target=geometry;
        animation=ValueAnimator.ofFloat(0,1);animation.setDuration(280);animation.setInterpolator(new PathInterpolator(.2f,0,.1f,1));
        animation.addUpdateListener(frame->{if(!added)return;float f=(float)frame.getAnimatedValue();params.x=Math.round(fromX+(target.x-fromX)*f);params.y=Math.round(fromY+(target.y-fromY)*f);params.width=Math.round(fromWidth+(target.width-fromWidth)*f);params.height=Math.round(fromHeight+(height-fromHeight)*f);manager.updateViewLayout(root,params);});animation.start();
    }
    void show(){if(added)return;render(false);manager.addView(root,params);added=true;displays.registerDisplayListener(displayListener,main);root.requestApplyInsets();}
    void update(String next,String text,boolean expanded,float level){boolean changed=active!=expanded || !phase.equals(next);phase=next;active=expanded;status.setText(next);compactStatus.setText(next.equals("Preparing voice")?"Replying":next.equals("Understanding")?"Heard you":next);if(text!=null&&!text.isEmpty())words.setText(text);if(!active){userExpanded=autoExpanded=manuallyCollapsed=false;}else if(!manuallyCollapsed && (next.equals("Thinking")||next.equals("Speaking")))autoExpanded=true;signal.state(next,level,active);brand.state(next,0,false);render(changed);}
    void coding(org.json.JSONObject snapshot){org.json.JSONArray sessions=snapshot.optJSONArray("sessions");int count=sessions==null?0:sessions.length();String summary=count==0?snapshot.optString("message","No recent Codex sessions"):count+" recent Codex sessions";if(count>0){org.json.JSONObject item=sessions.optJSONObject(0);if(item!=null)summary+="\n"+item.optString("status")+" · "+item.optString("title");}codingSummary.setText(summary);if(expanded())render(true);}
    void clearCoding(){codingSummary.setText("Open coding sessions to reconnect");}
    void level(String phase,float level){signal.state(phase,level,active);}
    void close(){if(animation!=null)animation.cancel();main.removeCallbacksAndMessages(null);if(added){added=false;displays.unregisterDisplayListener(displayListener);manager.removeView(root);}userExpanded=autoExpanded=manuallyCollapsed=false;codingSummary.setText("Codex activity");}
    private static final class Signal extends View{
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final boolean brand;private float level;private String phase="";private boolean active;
        Signal(Context context,boolean brand){super(context);this.brand=brand;setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
        void state(String phase,float level,boolean active){float next=active?Math.max(0,Math.min(1,level)):0;if(this.phase.equals(phase)&&this.level==next&&this.active==active)return;this.phase=phase;this.level=next;this.active=active;invalidate();}
        @Override protected void onDraw(Canvas canvas){float unit=Math.min(getWidth(),getHeight())/20f;paint.setColor(phase.contains("Thinking")||phase.contains("Preparing")?NativeStyle.WARNING:NativeStyle.ACCENT);paint.setStrokeCap(Paint.Cap.ROUND);paint.setStrokeWidth(unit*2);float cx=getWidth()/2f,cy=getHeight()/2f;
            if(brand){paint.setStyle(Paint.Style.STROKE);canvas.drawCircle(cx,cy,unit*6,paint);canvas.drawCircle(cx,cy,unit*2,paint);paint.setStyle(Paint.Style.FILL);return;}
            for(int i=0;i<5;i++){float x=cx+(i-2)*unit*4,h=unit*(active?2+level*(i%2==0?10:15):i==2?4:2);canvas.drawLine(x,cy-h/2,x,cy+h/2,paint);}}
    }
}
