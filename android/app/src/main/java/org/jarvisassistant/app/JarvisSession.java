package org.jarvisassistant.app;

import android.content.*;
import android.os.*;
import android.service.voice.VoiceInteractionSession;
import android.view.*;

/** Generic presence only: never displays previous chat, Codex or other private data. */
public final class JarvisSession extends VoiceInteractionSession {
    private final Context context;
    private final Handler timer=new Handler(Looper.getMainLooper());
    private static JarvisSession visible;
    private AssistantPresence presence;
    static void updatePresence(String phase,float level){if(visible!=null && visible.presence!=null)visible.presence.state(phase,level);}
    static void dismissPresence(){if(visible!=null)visible.hide();}
    public JarvisSession(Context context){super(context);this.context=context;}
    @Override public void onPrepareShow(Bundle args,int flags){super.onPrepareShow(args,flags);setUiEnabled(args!=null&&args.getBoolean("wakePresence",false));}
    @Override public View onCreateContentView(){
        Window window=getWindow().getWindow();
        window.addFlags(WindowManager.LayoutParams.FLAG_SECURE|WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED|WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        window.setBackgroundDrawableResource(android.R.color.transparent);
        window.setLayout(-1,-1);
        presence=AssistantPresence.create(context,this::hide);return presence;
    }
    @Override public void onShow(Bundle args,int flags){super.onShow(args,flags);timer.removeCallbacksAndMessages(null);
        if(args==null||!args.getBoolean("wakePresence",false)){visible=null;startAssistantActivity(new Intent(context,AssistantConversationActivity.class));return;}
        visible=this;timer.postDelayed(()->{if(!VoiceService.running)hide();},12000);
    }
    @Override public void onHide(){if(visible==this)visible=null;timer.removeCallbacksAndMessages(null);super.onHide();}
    @Override public void onDestroy(){timer.removeCallbacksAndMessages(null);super.onDestroy();}
}
