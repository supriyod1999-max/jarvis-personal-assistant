package org.jarvisassistant.app;

import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.*;
import android.view.*;
import android.widget.*;

/** Native watch presentation only. Connection and microphone state stay with their services. */
final class WatchStyle {
    static final int BACKGROUND=0xff0c1b20, SURFACE=0xff132a30, RAISED=0xff1c353b, LINE=0xff36515a;
    static final int TEXT=0xffeff5f2, MUTED=0xff9eb7b6, MINT=0xffaedecf, PEACH=0xfff0b998;
    static int dp(Context context,float value){return Math.round(value*context.getResources().getDisplayMetrics().density);}
    static GradientDrawable background(Context context,int color,int radius){GradientDrawable shape=new GradientDrawable();shape.setColor(color);shape.setCornerRadius(dp(context,radius));return shape;}
    static LinearLayout page(Activity activity,String title){
        ScrollView scroll=new ScrollView(activity);scroll.setFillViewport(true);scroll.setBackgroundColor(BACKGROUND);scroll.setVerticalScrollBarEnabled(false);scroll.setClipToPadding(false);
        LinearLayout body=new LinearLayout(activity);body.setOrientation(LinearLayout.VERTICAL);body.setGravity(Gravity.CENTER_HORIZONTAL);
        boolean round=activity.getResources().getConfiguration().isScreenRound();body.setPadding(dp(activity,round?26:18),dp(activity,round?20:12),dp(activity,round?26:18),dp(activity,round?42:24));scroll.addView(body);
        TextView heading=text(activity,title,16,TEXT);heading.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));heading.setAccessibilityHeading(true);body.addView(heading,new LinearLayout.LayoutParams(-1,-2));activity.setContentView(scroll);return body;
    }
    static TextView text(Context context,String value,int size,int color){TextView view=new TextView(context);view.setText(value);view.setTextSize(size);view.setTextColor(color);view.setGravity(Gravity.CENTER);view.setIncludeFontPadding(false);view.setLineSpacing(dp(context,2),1);view.setPadding(0,dp(context,5),0,dp(context,5));view.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL));return view;}
    static Button button(Context context,String label,boolean primary,Runnable action){
        Button button=new Button(context);button.setText(label);button.setContentDescription(label);button.setAllCaps(false);button.setTextSize(14);button.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));button.setIncludeFontPadding(false);button.setTextColor(primary?BACKGROUND:TEXT);
        button.setMinHeight(dp(context,48));button.setMinimumHeight(dp(context,48));button.setMinWidth(0);button.setMinimumWidth(0);button.setPadding(dp(context,12),dp(context,10),dp(context,12),dp(context,10));button.setMaxLines(3);button.setElevation(0);button.setStateListAnimator(null);
        StateListDrawable states=new StateListDrawable();GradientDrawable focused=background(context,primary?PEACH:RAISED,24);focused.setStroke(dp(context,1),MINT);states.addState(new int[]{android.R.attr.state_focused},focused);states.addState(new int[]{},background(context,primary?PEACH:RAISED,24));button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33aedecf),states,null));
        button.setOnClickListener(view->{view.performHapticFeedback(HapticFeedbackConstants.VIRTUAL_KEY);action.run();});return button;
    }
    static Button addButton(LinearLayout parent,String label,boolean primary,Runnable action){Button button=button(parent.getContext(),label,primary,action);LinearLayout.LayoutParams size=new LinearLayout.LayoutParams(-1,-2);size.topMargin=dp(parent.getContext(),8);parent.addView(button,size);return button;}
}
