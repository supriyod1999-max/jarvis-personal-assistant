package org.jarvisassistant.app;

import android.app.Activity;
import android.os.*;
import android.view.WindowManager;

public final class LockedAssistantActivity extends Activity {
    private final Handler timer=new Handler(Looper.getMainLooper());
    @Override public void onCreate(Bundle state){super.onCreate(state);setShowWhenLocked(true);setTurnScreenOn(true);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);setContentView(AssistantPresence.create(this,this::finish));timer.postDelayed(()->{if(!VoiceService.running)finish();},12000);}
    @Override protected void onDestroy(){timer.removeCallbacksAndMessages(null);super.onDestroy();}
}
