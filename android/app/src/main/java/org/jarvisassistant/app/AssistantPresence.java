package org.jarvisassistant.app;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.view.*;
import android.widget.*;

/** Centred, reactive voice presence without previous chat or private records. */
final class AssistantPresence extends FrameLayout {
    private final Aura aura;private final TextView title,caption;
    static AssistantPresence create(Context context,Runnable dismiss){return new AssistantPresence(context,dismiss);}
    private AssistantPresence(Context context,Runnable dismiss){super(context);setBackgroundColor(0xe6080e17);
        LinearLayout content=NativeStyle.column(context);content.setGravity(Gravity.CENTER);int pad=NativeStyle.dp(context,28);content.setPadding(pad,pad,pad,pad);addView(content,new FrameLayout.LayoutParams(-1,-2,Gravity.CENTER));
        TextView label=NativeStyle.text(context,"J A R V I S",12,NativeStyle.ACCENT);label.setGravity(Gravity.CENTER);content.addView(label);NativeStyle.gap(content,28);
        aura=new Aura(context);content.addView(aura,new LinearLayout.LayoutParams(NativeStyle.dp(context,240),NativeStyle.dp(context,240)));
        NativeStyle.gap(content,28);title=NativeStyle.title(context,"I'm here.",27);title.setGravity(Gravity.CENTER);content.addView(title,new LinearLayout.LayoutParams(-1,-2));NativeStyle.gap(content,12);
        caption=NativeStyle.text(context,VoiceService.running?"Say Hey JARVIS, then tell me what's on your mind.":"Start listening in JARVIS to talk from here.",14,NativeStyle.MUTED);caption.setGravity(Gravity.CENTER);content.addView(caption);
        NativeStyle.gap(content,32);content.addView(NativeStyle.action(context,"Dismiss",null,false,dismiss),new LinearLayout.LayoutParams(NativeStyle.dp(context,160),-2));
    }
    void state(String phase,float level){aura.state(phase,level);String heading=phase.equals("Listening")?"I'm listening.":phase.equals("Understanding")?"I heard you.":phase.equals("Thinking")?"Let me think.":phase.equals("Preparing voice")?"One moment.":phase.equals("Speaking")?"Here's what I think.":"I'm here.";
        if(!heading.contentEquals(title.getText()))title.setText(heading);caption.setText(phase.equals("Microphone paused")?"Another app is using the microphone.":phase.equals("Speaking")?"Listening resumes after my reply.":phase.equals("Thinking")||phase.equals("Preparing voice")?"Working on your reply…":"A question. A thought. Say it naturally.");}
    static final class Aura extends View {
        private final Paint paint=new Paint(Paint.ANTI_ALIAS_FLAG);private final Path shape=new Path();private ValueAnimator motion;private float time,level;private String phase="Listening";
        Aura(Context context){super(context);setContentDescription("JARVIS voice presence");}
        void state(String next,float input){phase=next;level=level*.65f+Math.max(0,Math.min(1,input))*.35f;invalidate();}
        @Override protected void onAttachedToWindow(){super.onAttachedToWindow();if(!ValueAnimator.areAnimatorsEnabled())return;motion=ValueAnimator.ofFloat(0,6.283185f);motion.setDuration(4800);motion.setRepeatCount(ValueAnimator.INFINITE);motion.setInterpolator(new android.view.animation.LinearInterpolator());motion.addUpdateListener(a->{time=(float)a.getAnimatedValue();invalidate();});motion.start();}
        @Override protected void onDetachedFromWindow(){if(motion!=null)motion.cancel();super.onDetachedFromWindow();}
        @Override public void onVisibilityAggregated(boolean visible){super.onVisibilityAggregated(visible);if(motion!=null){if(visible)motion.resume();else motion.pause();}}
        @Override protected void onDraw(Canvas canvas){float cx=getWidth()/2f,cy=getHeight()/2f,unit=getWidth()/2f;boolean thinking=phase.equals("Thinking")||phase.equals("Preparing voice");int mint=thinking?0xffdeb5ee:0xff8aebd4;
            paint.setShader(new RadialGradient(cx,cy,unit,new int[]{0x4466d9cf,0x224475ba,0x004475ba},new float[]{0,.62f,1},Shader.TileMode.CLAMP));canvas.drawCircle(cx,cy,unit,paint);
            for(int layer=0;layer<4;layer++){shape.reset();float base=unit*(.57f+layer*.035f+level*.06f);for(int i=0;i<=100;i++){double angle=i*Math.PI*2/100;float wave=(float)(Math.sin(angle*3+time+layer*.8)*.065+Math.cos(angle*2-time*2+layer)*.045);float r=base+unit*wave;float x=cx+(float)Math.cos(angle)*r,y=cy+(float)Math.sin(angle)*r;if(i==0)shape.moveTo(x,y);else shape.lineTo(x,y);}shape.close();paint.setStyle(Paint.Style.FILL);paint.setShader(new LinearGradient(cx-unit*.7f,cy-unit*.7f,cx+unit*.7f,cy+unit*.7f,new int[]{mint,0xff4d86ed,0xff85c8ec},new float[]{0,.55f,1},Shader.TileMode.CLAMP));paint.setAlpha(layer==0?210:65);canvas.drawPath(shape,paint);paint.setShader(null);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(unit*.007f);paint.setColor(0x90d4fff0);canvas.drawPath(shape,paint);}paint.setAlpha(255);paint.setStyle(Paint.Style.FILL);
        }
    }
}
