package org.jarvisassistant.app;

import android.animation.ValueAnimator;
import android.app.Activity;
import android.content.Context;
import android.content.res.ColorStateList;
import android.graphics.Typeface;
import android.graphics.drawable.*;
import android.os.Build;
import android.view.*;
import android.widget.*;

/** Shared native palette and controls; never exposes a WebView administration bridge. */
final class NativeStyle {
    static final int BACKGROUND=0xff0c1b20, SURFACE=0xff132a30, RAISED=0xff1c353b, LINE=0xff36515a;
    static final int TEXT=0xffeff5f2, MUTED=0xff9eb7b6, ACCENT=0xffaedecf, PEACH=0xfff0b998, WARNING=0xffe7c58f, ERROR=0xffedb8af;
    static int dp(Context context,float value) { return Math.round(value*context.getResources().getDisplayMetrics().density); }
    static GradientDrawable background(Context context,int color,int border,int radius) {
        GradientDrawable shape=new GradientDrawable(); shape.setColor(color); shape.setCornerRadius(dp(context,radius));
        if(border!=0) shape.setStroke(dp(context,1),border); return shape;
    }
    static RippleDrawable ripple(Context context,int color,int border,int radius) {
        return new RippleDrawable(ColorStateList.valueOf(0x26aedecf),background(context,color,border,radius),null);
    }
    static LinearLayout surface(Activity activity) {
        LinearLayout root=column(activity); root.setBackgroundColor(BACKGROUND);
        root.setOnApplyWindowInsetsListener((view,insets)-> {
            if(Build.VERSION.SDK_INT>=30) {
                android.graphics.Insets bars=insets.getInsets(WindowInsets.Type.systemBars()|WindowInsets.Type.displayCutout()|WindowInsets.Type.ime());
                view.setPadding(bars.left,bars.top,bars.right,bars.bottom);
            } else view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());
            return insets;
        });
        activity.setContentView(root); root.requestApplyInsets(); return root;
    }
    static LinearLayout column(Context context) { LinearLayout view=new LinearLayout(context); view.setOrientation(LinearLayout.VERTICAL); return view; }
    static LinearLayout card(Context context) {
        LinearLayout view=column(context); int p=dp(context,22); view.setPadding(p,p,p,p); view.setBackground(background(context,SURFACE,0,22)); return view;
    }
    static TextView text(Context context,String value,int size,int color) {
        TextView view=new TextView(context); view.setText(value); view.setTextSize(size); view.setTextColor(color); view.setIncludeFontPadding(false);
        view.setLineSpacing(dp(context,3),1.05f); view.setTypeface(Typeface.create("sans-serif",Typeface.NORMAL)); return view;
    }
    static TextView title(Context context,String value,int size) {
        TextView view=text(context,value,size,TEXT); view.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL)); view.setAccessibilityHeading(true); return view;
    }
    static void gap(LinearLayout parent,int size) { parent.addView(new View(parent.getContext()),new LinearLayout.LayoutParams(1,dp(parent.getContext(),size))); }
    static void button(Context context,Button button,boolean primary) {
        StateListDrawable states=new StateListDrawable();
        states.addState(new int[]{-android.R.attr.state_enabled},background(context,SURFACE,LINE,16));
        states.addState(new int[]{android.R.attr.state_focused},background(context,primary?ACCENT:RAISED,PEACH,16));
        states.addState(new int[]{},background(context,primary?ACCENT:RAISED,0,16));
        button.setBackground(new RippleDrawable(ColorStateList.valueOf(0x33aedecf),states,null));
        button.setTextColor(new ColorStateList(new int[][]{new int[]{-android.R.attr.state_enabled},new int[]{}},new int[]{0xff809a9d,primary?BACKGROUND:TEXT}));
        button.setAllCaps(false); button.setTextSize(14); button.setTypeface(Typeface.create("sans-serif-medium",Typeface.NORMAL));
        button.setPadding(dp(context,18),dp(context,13),dp(context,18),dp(context,13)); button.setMinHeight(dp(context,52)); button.setMinimumHeight(dp(context,52));
        button.setMinWidth(0); button.setMinimumWidth(0); button.setElevation(0); button.setStateListAnimator(null); button.setGravity(Gravity.CENTER); button.setMaxLines(3);
    }
    static Button action(Context context,String label,String icon,boolean primary,Runnable action) {
        Button button=new Button(context); button.setText(label); button(context,button,primary);
        if(icon!=null) { NativeIcon drawable=new NativeIcon(icon,primary?BACKGROUND:ACCENT); int size=dp(context,20); drawable.setBounds(0,0,size,size); button.setCompoundDrawables(drawable,null,null,null); button.setCompoundDrawablePadding(dp(context,10)); button.setCompoundDrawableTintList(button.getTextColors()); }
        button.setOnClickListener(view->action.run()); return button;
    }
    static ImageButton iconButton(Context context,String icon,String label,Runnable action) {
        ImageButton button=new ImageButton(context); button.setImageDrawable(new NativeIcon(icon,TEXT)); button.setScaleType(ImageView.ScaleType.FIT_CENTER); button.setContentDescription(label);
        button.setPadding(dp(context,12),dp(context,12),dp(context,12),dp(context,12)); button.setBackground(ripple(context,0x00ffffff,0,12)); button.setOnClickListener(view->action.run()); return button;
    }
    static void input(Context context,EditText input) {
        input.setTextColor(TEXT); input.setHintTextColor(MUTED); input.setTextSize(15); input.setPadding(dp(context,16),dp(context,16),dp(context,16),dp(context,16));
        StateListDrawable states=new StateListDrawable(); states.addState(new int[]{android.R.attr.state_focused},background(context,BACKGROUND,ACCENT,14)); states.addState(new int[]{},background(context,BACKGROUND,LINE,14)); input.setBackground(states); input.setMinimumHeight(dp(context,56));
    }
    static LinearLayout toolbar(Activity activity,String title,String subtitle,Runnable back) {
        LinearLayout toolbar=new LinearLayout(activity); toolbar.setGravity(Gravity.CENTER_VERTICAL); toolbar.setPadding(dp(activity,12),dp(activity,12),dp(activity,20),dp(activity,14));
        toolbar.addView(iconButton(activity,"back","Back to JARVIS",back),new LinearLayout.LayoutParams(dp(activity,48),dp(activity,48)));
        LinearLayout names=column(activity); names.setPadding(dp(activity,10),0,0,0); names.addView(title(activity,title,20));
        TextView caption=text(activity,subtitle,12,MUTED); caption.setPadding(0,dp(activity,4),0,0); names.addView(caption); toolbar.addView(names,new LinearLayout.LayoutParams(0,-2,1)); return toolbar;
    }
    static LinearLayout menuRow(Context context,String icon,String title,String subtitle,Runnable action) {
        LinearLayout row=new LinearLayout(context); row.setGravity(Gravity.CENTER_VERTICAL); row.setPadding(dp(context,12),dp(context,14),dp(context,12),dp(context,14));
        row.setBackground(ripple(context,0x00ffffff,0,12)); row.setFocusable(true); row.setClickable(true); row.setContentDescription(title+". "+subtitle); row.setOnClickListener(view->action.run());
        ImageView glyph=new ImageView(context); glyph.setImageDrawable(new NativeIcon(icon,ACCENT)); glyph.setPadding(dp(context,10),dp(context,10),dp(context,10),dp(context,10)); glyph.setBackground(background(context,RAISED,0,14)); row.addView(glyph,new LinearLayout.LayoutParams(dp(context,44),dp(context,44)));
        LinearLayout labels=column(context); labels.setPadding(dp(context,16),0,dp(context,10),0); labels.addView(title(context,title,15));
        TextView caption=text(context,subtitle,12,MUTED); caption.setPadding(0,dp(context,5),0,0); labels.addView(caption); row.addView(labels,new LinearLayout.LayoutParams(0,-2,1));
        ImageView arrow=new ImageView(context); arrow.setImageDrawable(new NativeIcon("chevron",MUTED)); row.addView(arrow,new LinearLayout.LayoutParams(dp(context,18),dp(context,18))); return row;
    }
    static void menuSection(LinearLayout parent,String title) {
        TextView label=title(parent.getContext(),title,13); label.setTextColor(PEACH); label.setPadding(dp(parent.getContext(),12),dp(parent.getContext(),22),dp(parent.getContext(),12),dp(parent.getContext(),4)); parent.addView(label);
    }
    static void reveal(View view) { if(!ValueAnimator.areAnimatorsEnabled())return; view.setAlpha(.4f); view.animate().alpha(1).setDuration(180).start(); }
    static void status(TextView view,String value,boolean error) { if(!value.contentEquals(view.getText())) { view.setText(value); reveal(view); } view.setTextColor(error?ERROR:MUTED); }
}
