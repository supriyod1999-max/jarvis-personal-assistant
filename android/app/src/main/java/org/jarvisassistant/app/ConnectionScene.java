package org.jarvisassistant.app;
import android.animation.ValueAnimator;
import android.content.Context;
import android.graphics.*;
import android.view.View;
/** Live connection feedback; only pending checks animate. */
final class ConnectionScene extends View {
    private final String target;private final Paint paint=new Paint(3);private boolean connected;private float phase;private ValueAnimator animator;
    ConnectionScene(Context context,String target){super(context);this.target=target;setImportantForAccessibility(IMPORTANT_FOR_ACCESSIBILITY_NO);}
    void state(boolean connected,boolean checking){this.connected=connected;if(checking&&isAttachedToWindow()&&ValueAnimator.areAnimatorsEnabled()){if(animator==null){animator=ValueAnimator.ofFloat(0,1);animator.setDuration(1000);animator.setRepeatCount(-1);animator.addUpdateListener(value->{phase=(float)value.getAnimatedValue();invalidate();});animator.start();}}else if(animator!=null){animator.cancel();animator=null;}invalidate();}
    @Override protected void onDetachedFromWindow(){if(animator!=null){animator.cancel();animator=null;}super.onDetachedFromWindow();}
    @Override protected void onDraw(Canvas canvas){float d=getResources().getDisplayMetrics().density,x=getWidth()*.25f,z=getWidth()*.75f,y=45*d,r=25*d;paint.setStrokeWidth(d);paint.setColor(NativeStyle.LINE);canvas.drawLine(x+r,y,z-r,y,paint);for(int i=0;i<3;i++){paint.setColor(connected?NativeStyle.ACCENT:NativeStyle.MUTED);paint.setAlpha(animator!=null?100+(int)(155*Math.abs(Math.sin((phase+i*.2)*Math.PI))):connected?255:80);canvas.drawCircle(x+(z-x)*(i+1)/4,y,2.5f*d,paint);}paint.setAlpha(255);device(canvas,x,y,r,"phone","This phone");device(canvas,z,y,r,target.equals("Watch")?"watch":"laptop",target);}
    private void device(Canvas c,float x,float y,float r,String icon,String name){paint.setColor(NativeStyle.SURFACE);c.drawCircle(x,y,r+6*getResources().getDisplayMetrics().density,paint);paint.setColor(NativeStyle.RAISED);c.drawCircle(x,y,r,paint);NativeIcon glyph=new NativeIcon(icon,icon.equals("phone")?NativeStyle.ACCENT:NativeStyle.PEACH);int p=(int)(r*.5);glyph.setBounds((int)x-p,(int)y-p,(int)x+p,(int)y+p);glyph.draw(c);paint.setColor(NativeStyle.MUTED);paint.setTextAlign(Paint.Align.CENTER);paint.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));paint.setTextSize(12*getResources().getDisplayMetrics().scaledDensity);c.drawText(name,x,y+r+23*getResources().getDisplayMetrics().density,paint);}
}
