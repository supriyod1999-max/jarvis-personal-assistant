package org.jarvisassistant.app;

import android.content.*;
import android.os.Bundle;
import android.service.voice.VoiceInteractionService;

/** Android binds this only after the owner selects JARVIS as their assistant. */
public final class JarvisAssistant extends VoiceInteractionService {
    private static JarvisAssistant ready;
    @Override public void onReady(){super.onReady();ready=this;}
    @Override public void onShutdown(){if(ready==this)ready=null;super.onShutdown();}
    static boolean selected(Context context){return isActiveService(context,new ComponentName(context,JarvisAssistant.class));}
    static boolean connected(){return ready!=null;}
    static boolean showWake(){
        if(ready==null)return false;
        try { Bundle args=new Bundle();args.putBoolean("wakePresence",true);ready.showSession(args,0);return true; } // No assist data or screenshots.
        catch(RuntimeException error){return false;}
    }
    @Override public void onLaunchVoiceAssistFromKeyguard(){startActivity(new Intent(this,AssistantConversationActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));}
}
