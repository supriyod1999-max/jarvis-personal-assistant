package org.jarvisassistant.app;

import android.graphics.*;
import android.graphics.drawable.Drawable;
import android.content.res.ColorStateList;

/** Small native line icons stay crisp at any display or font scale. */
final class NativeIcon extends Drawable {
    private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
    private final String name;
    private ColorStateList tint;
    NativeIcon(String name,int color) { this.name=name; paint.setColor(color); paint.setStyle(Paint.Style.STROKE); paint.setStrokeWidth(1.7f); paint.setStrokeCap(Paint.Cap.ROUND); paint.setStrokeJoin(Paint.Join.ROUND); }
    @Override public void draw(Canvas canvas) {
        canvas.save(); canvas.translate(getBounds().left,getBounds().top); canvas.scale(getBounds().width()/24f,getBounds().height()/24f);
        switch(name) {
            case "back": line(canvas,19,12,5,12); line(canvas,5,12,11,6); line(canvas,5,12,11,18); break;
            case "close": line(canvas,6,6,18,18); line(canvas,6,18,18,6); break;
            case "chevron": line(canvas,9,6,15,12); line(canvas,15,12,9,18); break;
            case "more": canvas.drawCircle(5,12,.8f,paint); canvas.drawCircle(12,12,.8f,paint); canvas.drawCircle(19,12,.8f,paint); break;
            case "laptop": canvas.drawRoundRect(4,4,20,16,2,2,paint); line(canvas,2,20,22,20); line(canvas,4,16,2,20); line(canvas,20,16,22,20); break;
            case "phone": canvas.drawRoundRect(6,2,18,22,3,3,paint);line(canvas,10,5,14,5);line(canvas,10,19,14,19);break;
            case "watch": canvas.drawRoundRect(5,6,19,18,4,4,paint);line(canvas,8,2,8,6);line(canvas,16,2,16,6);line(canvas,8,18,8,22);line(canvas,16,18,16,22);line(canvas,12,9,12,12);line(canvas,12,12,15,13);break;
            case "lock": canvas.drawRoundRect(5,10,19,21,2,2,paint); canvas.drawArc(8,2,16,14,180,180,false,paint); line(canvas,8,6,8,10); line(canvas,16,6,16,10); line(canvas,12,15,12,17); break;
            case "unlock": canvas.drawRoundRect(5,10,19,21,2,2,paint); canvas.drawArc(8,2,16,14,180,165,false,paint); line(canvas,8,6,8,10); line(canvas,12,15,12,17); break;
            case "mic": canvas.drawRoundRect(9,2,15,15,3,3,paint); canvas.drawArc(5,7,19,19,0,180,false,paint); line(canvas,12,19,12,22); line(canvas,8,22,16,22); break;
            case "refresh": canvas.drawArc(4,4,20,20,35,285,false,paint); line(canvas,20,4,20,10); line(canvas,14,10,20,10); break;
            case "shield": { Path p=new Path(); p.moveTo(12,2); p.lineTo(21,6); p.lineTo(20,14); p.quadTo(18,19,12,22); p.quadTo(6,19,4,14); p.lineTo(3,6); p.close(); canvas.drawPath(p,paint); line(canvas,8,12,11,15); line(canvas,11,15,16,9); break; }
            case "connection": canvas.drawArc(5,8,13,16,80,270,false,paint); canvas.drawArc(11,8,19,16,260,270,false,paint); line(canvas,9,12,15,12); break;
            case "check": line(canvas,5,12,10,17); line(canvas,10,17,20,6); break;
            case "message": {Path p=new Path();p.moveTo(4,3);p.lineTo(20,3);p.quadTo(22,3,22,5);p.lineTo(22,15);p.quadTo(22,17,20,17);p.lineTo(9,17);p.lineTo(3,22);p.lineTo(3,5);p.quadTo(3,3,4,3);canvas.drawPath(p,paint);line(canvas,7,8,18,8);line(canvas,7,12,15,12);break;}
            case "pet": canvas.drawRoundRect(3,6,10,16,2.5f,2.5f,paint);canvas.drawRoundRect(14,6,21,16,2.5f,2.5f,paint);line(canvas,10,20,14,20);break;
            case "camera": canvas.drawRoundRect(2,7,22,21,3,3,paint);canvas.drawCircle(12,14,4,paint);line(canvas,7,7,9,3);line(canvas,9,3,15,3);line(canvas,15,3,17,7);break;
            case "moon": {Path p=new Path();p.moveTo(19,16);p.cubicTo(7,20,3,8,10,3);p.cubicTo(-2,5,0,22,12,22);p.quadTo(18,22,21,16);p.close();canvas.drawPath(p,paint);break;}
            case "play": {Path p=new Path();p.moveTo(8,3);p.lineTo(21,12);p.lineTo(8,21);p.close();canvas.drawPath(p,paint);break;}
            case "stop": canvas.drawRoundRect(5,5,19,19,2,2,paint);break;
            case "files":case "folder": {Path p=new Path();p.moveTo(3,5);p.lineTo(10,5);p.lineTo(12,8);p.lineTo(21,8);p.lineTo(21,20);p.lineTo(3,20);p.close();canvas.drawPath(p,paint);break;}
            case "download": line(canvas,12,2,12,16);line(canvas,7,11,12,16);line(canvas,12,16,17,11);line(canvas,3,17,3,22);line(canvas,3,22,21,22);line(canvas,21,22,21,17);break;
            case "upload": line(canvas,12,2,12,16);line(canvas,7,7,12,2);line(canvas,12,2,17,7);line(canvas,3,17,3,22);line(canvas,3,22,21,22);line(canvas,21,22,21,17);break;
            case "code": line(canvas,8,5,2,12);line(canvas,2,12,8,19);line(canvas,16,5,22,12);line(canvas,22,12,16,19);line(canvas,14,3,10,21);break;
            case "keyboard": canvas.drawRoundRect(2,5,22,20,2,2,paint);for(int row=0;row<2;row++)for(int col=0;col<4;col++)canvas.drawPoint(6+col*4,9+row*4,paint);line(canvas,7,17,17,17);break;
            case "music": line(canvas,9,17,9,5);line(canvas,9,5,21,2);line(canvas,21,2,21,14);canvas.drawOval(3,15,9,20,paint);canvas.drawOval(15,12,21,17,paint);break;
            default: canvas.drawCircle(12,12,8,paint); canvas.drawCircle(12,12,2,paint);
        }
        canvas.restore();
    }
    private void line(Canvas canvas,float x1,float y1,float x2,float y2) { canvas.drawLine(x1,y1,x2,y2,paint); }
    @Override public void setTintList(ColorStateList colors) { tint=colors; onStateChange(getState()); }
    @Override public boolean isStateful() { return tint!=null && tint.isStateful(); }
    @Override protected boolean onStateChange(int[] state) {
        if(tint==null)return false;
        int color=tint.getColorForState(state,tint.getDefaultColor());
        if(paint.getColor()==color)return false;
        paint.setColor(color); invalidateSelf(); return true;
    }
    @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
    @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
    @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
    @Override public int getIntrinsicWidth() { return 24; }
    @Override public int getIntrinsicHeight() { return 24; }
}
