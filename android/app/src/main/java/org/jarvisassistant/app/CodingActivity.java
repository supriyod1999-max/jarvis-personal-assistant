package org.jarvisassistant.app;

import android.app.*;
import android.os.*;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.util.concurrent.*;

/** Read-only Codex activity through the existing authenticated primary workspace. */
public final class CodingActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ExecutorService worker=Executors.newSingleThreadExecutor();
    private ApiClient api;private String origin;private LinearLayout rows;private TextView status;
    private boolean visible,busy;private int epoch;
    private final Runnable refresh=new Runnable(){public void run(){load();if(visible)main.postDelayed(this,8000);}};
    @Override protected void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try{origin=EndpointPolicy.connection(getIntent().getStringExtra("origin"));}catch(Exception e){finish();return;}
        LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"Coding sessions","Connected to your laptop",this::finish));
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout content=NativeStyle.column(this);content.setPadding(NativeStyle.dp(this,20),NativeStyle.dp(this,16),NativeStyle.dp(this,20),NativeStyle.dp(this,24));scroll.addView(content);
        status=NativeStyle.text(this,"Checking saved activity…",14,NativeStyle.MUTED);content.addView(status);NativeStyle.gap(content,16);rows=NativeStyle.column(this);content.addView(rows);
        NativeStyle.gap(content,16);content.addView(NativeStyle.action(this,"Refresh", "refresh",false,this::load));NativeStyle.gap(content,16);content.addView(NativeStyle.text(this,"Saved local activity, not a live execution log. Quiet sessions may still be running. Answer questions and approve actions in Codex on your laptop.",13,NativeStyle.MUTED));
    }
    private boolean unlocked(){return !getSystemService(KeyguardManager.class).isDeviceLocked();}
    private void load(){if(!visible||busy)return;if(!unlocked()){rows.removeAllViews();status.setText("Unlock your phone to view coding sessions.");return;}busy=true;final int attempt=epoch;final ApiClient client=api;
        worker.execute(()->{try{JSONObject result=client.json("/api/coding/sessions",null);main.post(()->{if(!visible||attempt!=epoch)return;busy=false;if(!unlocked()){rows.removeAllViews();return;}render(result);});}
        catch(Exception e){main.post(()->{if(!visible||attempt!=epoch)return;busy=false;rows.removeAllViews();status.setText(e instanceof ApiClient.Failure && (((ApiClient.Failure)e).status==401||((ApiClient.Failure)e).status==403)?"Unlock your primary JARVIS workspace, then return here.":"Could not reach your laptop. Check Tailscale, then refresh.");});}});
    }
    private void render(JSONObject result){rows.removeAllViews();JSONArray sessions=result.optJSONArray("sessions");int count=sessions==null?0:Math.min(16,sessions.length());status.setText(count>0?count+" recent sessions · updated now":result.optString("message","No recent sessions."));
        for(int i=0;i<count;i++){JSONObject item=sessions.optJSONObject(i);if(item==null)continue;LinearLayout card=NativeStyle.card(this);card.addView(NativeStyle.text(this,item.optString("status","recent").toUpperCase(java.util.Locale.ROOT)+" · "+item.optString("project"),11,NativeStyle.ACCENT));NativeStyle.gap(card,10);card.addView(NativeStyle.title(this,item.optString("title","Codex session"),18));
            String question=item.optString("question"),preview=item.optString("preview");if(!question.isEmpty()){NativeStyle.gap(card,12);card.addView(NativeStyle.text(this,question,15,NativeStyle.WARNING));}
            if(!preview.isEmpty()){NativeStyle.gap(card,12);TextView text=NativeStyle.text(this,preview,14,NativeStyle.MUTED);text.setTextIsSelectable(true);card.addView(text);}rows.addView(card);NativeStyle.gap(rows,12);
        }
    }
    @Override protected void onResume(){super.onResume();if(origin==null)return;visible=true;epoch++;busy=false;api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin));main.post(refresh);}
    @Override protected void onStop(){visible=false;epoch++;main.removeCallbacksAndMessages(null);if(api!=null)api.close();rows.removeAllViews();super.onStop();}
    @Override protected void onDestroy(){worker.shutdownNow();super.onDestroy();}
}
