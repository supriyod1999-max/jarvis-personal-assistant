package org.jarvisassistant.app;
import android.content.Context;
import android.graphics.*;
import android.view.*;
/** Touch drag mirrors pointer motion; a deliberate tap clicks. */
final class WatchTouchpad extends View {
    interface Input{void move(int x,int y);void click();void scroll(int steps);}
    private final Input input;private final Paint paint=new Paint(3);private float x,y,startX,startY;private boolean down,moved;
    WatchTouchpad(Context context,Input input){super(context);this.input=input;setFocusable(true);setContentDescription("Laptop touchpad. Drag to move, tap to click, or rotate the watch bezel to scroll.");setBackgroundColor(0xff17212d);setOnClickListener(view->input.click());}
    @Override protected void onDraw(Canvas canvas){float d=getResources().getDisplayMetrics().density;paint.setColor(down?0xffa9e4d5:0xff67837f);paint.setStyle(Paint.Style.STROKE);paint.setStrokeWidth(d);canvas.drawRoundRect(d,d,getWidth()-d,getHeight()-d,18*d,18*d,paint);paint.setStyle(Paint.Style.FILL);for(int row=1;row<4;row++)for(int column=1;column<5;column++)canvas.drawCircle(getWidth()*column/5f,getHeight()*row/4f,d,paint);if(down){paint.setColor(0xffa9e4d5);canvas.drawCircle(x,y,5*d,paint);}else{paint.setTextAlign(Paint.Align.CENTER);paint.setTextSize(12*getResources().getDisplayMetrics().scaledDensity);canvas.drawText("Drag to move",getWidth()/2f,getHeight()/2f,paint);}}
    @Override public boolean onTouchEvent(MotionEvent event){switch(event.getActionMasked()){case MotionEvent.ACTION_DOWN:x=startX=event.getX();y=startY=event.getY();down=true;moved=false;requestFocus();getParent().requestDisallowInterceptTouchEvent(true);invalidate();return true;case MotionEvent.ACTION_MOVE:if(!down)return false;float nextX=event.getX(),nextY=event.getY();if(Math.hypot(nextX-startX,nextY-startY)>8)moved=true;if(moved)input.move(Math.round((nextX-x)*1.6f),Math.round((nextY-y)*1.6f));x=nextX;y=nextY;invalidate();return true;case MotionEvent.ACTION_UP:if(down&&!moved)performClick();case MotionEvent.ACTION_CANCEL:down=false;getParent().requestDisallowInterceptTouchEvent(false);invalidate();return true;default:return false;}}
    @Override public boolean onGenericMotionEvent(MotionEvent event){if(event.getAction()==MotionEvent.ACTION_SCROLL){int steps=Math.max(-6,Math.min(6,Math.round(-event.getAxisValue(MotionEvent.AXIS_SCROLL))));if(steps!=0)input.scroll(steps);return true;}return super.onGenericMotionEvent(event);}
    @Override public boolean performClick(){super.performClick();return true;}
}
