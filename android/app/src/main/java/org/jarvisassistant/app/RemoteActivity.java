package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.os.*;
import android.view.*;
import android.webkit.CookieManager;
import android.widget.*;
import org.json.*;
import java.util.*;
import java.util.concurrent.*;

/** Direct human input only. Session token and typed text never leave RAM or enter AI. */
public final class RemoteActivity extends Activity {
    private final Handler main=new Handler(Looper.getMainLooper());
    private final ScheduledExecutorService worker=Executors.newSingleThreadScheduledExecutor();
    private final ArrayDeque<JSONObject> queue=new ArrayDeque<>();
    private String origin;private volatile String session="";private volatile ApiClient api;private volatile boolean visible;private int generation;private long sequence;
    private CancellationSignal biometric;private TextView status;private Button start;private EditText text;private float lastX,lastY,totalMove,scroll;private long down;
    private String requestedMedia="";private long requestedAt;private boolean requestedConsumed;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try{origin=EndpointPolicy.connection(getIntent().getStringExtra("origin"));}catch(Exception ignored){finish();return;}
        requestedAt=getIntent().getLongExtra("requestedAt",0);requestedConsumed=saved!=null&&saved.getBoolean("requestedConsumed",false);
        String requested=getIntent().getStringExtra("requestedMedia");if(WatchWire.media(requested)&&!requestedConsumed&&System.currentTimeMillis()-requestedAt>=0&&System.currentTimeMillis()-requestedAt<120000)requestedMedia=requested;
        LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"Laptop remote","Your phone. Your controls.",this::finish));ScrollView scrollView=new ScrollView(this);root.addView(scrollView,new LinearLayout.LayoutParams(-1,0,1));LinearLayout body=NativeStyle.column(this);int pad=NativeStyle.dp(this,22);body.setPadding(pad,pad,pad,pad);scrollView.addView(body);
        status=NativeStyle.text(this,"Start control and approve your fingerprint. Keep this screen open; leaving it stops control.",14,NativeStyle.MUTED);body.addView(status);if(!requestedMedia.isEmpty())body.addView(NativeStyle.text(this,"Requested laptop action: "+requestedMedia.replace('-',' ')+". Tap Start control and approve your fingerprint to apply it once.",14,NativeStyle.ACCENT));NativeStyle.gap(body,15);
        start=NativeStyle.action(this,"Start control","laptop",true,()->{if(session.isEmpty())begin();else stop();});body.addView(start);NativeStyle.gap(body,22);
        LinearLayout media=NativeStyle.card(this);body.addView(media);media.addView(NativeStyle.title(this,"Media & volume",18));
        row(media,new String[]{"Previous","Play / pause","Next"},new String[]{"previous","play-pause","next"},"media");row(media,new String[]{"Volume −","Mute","Volume +"},new String[]{"volume-down","mute","volume-up"},"media");NativeStyle.gap(body,18);
        TextView touch=NativeStyle.text(this,"Touchpad\n\nMove one finger · tap to click\nTwo fingers to scroll",15,NativeStyle.MUTED);touch.setGravity(Gravity.CENTER);touch.setBackground(NativeStyle.background(this,NativeStyle.SURFACE,NativeStyle.LINE,24));touch.setFocusable(true);touch.setContentDescription("Laptop touchpad. Use the buttons below for accessible clicks and arrows.");body.addView(touch,new LinearLayout.LayoutParams(-1,NativeStyle.dp(this,210)));touch.setOnTouchListener((view,event)->touch(view,event));
        row(body,new String[]{"Left click","Right click"},new String[]{"left","right"},"click");NativeStyle.gap(body,18);
        LinearLayout keyboard=NativeStyle.card(this);body.addView(keyboard);keyboard.addView(NativeStyle.title(this,"Keyboard",18));text=new EditText(this);text.setHint("Text to type on your laptop");text.setMaxLines(3);NativeStyle.input(this,text);text.setFilters(new android.text.InputFilter[]{new android.text.InputFilter.LengthFilter(512)});keyboard.addView(text);
        text.setSaveEnabled(false);text.setFreezesText(false);text.setImeOptions(android.view.inputmethod.EditorInfo.IME_FLAG_NO_PERSONALIZED_LEARNING);
        keyboard.addView(NativeStyle.action(this,"Send text",null,false,()->{String value=text.getText().toString();if(!value.isEmpty()&&!java.util.regex.Pattern.compile("[\\x00-\\x1f\\x7f]").matcher(value).find()){enqueue("text","text",value);text.setText("");}}));
        row(keyboard,new String[]{"Tab","Space","Backspace","Enter"},new String[]{"tab","space","backspace","enter"},"key");row(keyboard,new String[]{"←","↑","↓","→"},new String[]{"left","up","down","right"},"key");
        NativeStyle.gap(body,15);body.addView(NativeStyle.text(this,"Controls the active Windows app. Windows must be unlocked; secure prompts remain protected. No screen sharing is enabled.",12,NativeStyle.MUTED));setContentView(root);
        worker.scheduleWithFixedDelay(this::flush,60,60,TimeUnit.MILLISECONDS);
    }
    private void row(LinearLayout parent,String[] labels,String[] keys,String type){LinearLayout row=new LinearLayout(this);row.setGravity(Gravity.CENTER);parent.addView(row);for(int i=0;i<labels.length;i++){String key=keys[i];Button button=NativeStyle.action(this,labels[i],null,false,()->enqueue(type,type.equals("click")?"button":"key",key));button.setTextSize(11);button.setPadding(4,8,4,8);button.setMinWidth(0);row.addView(button,new LinearLayout.LayoutParams(0,NativeStyle.dp(this,52),1));}}
    private boolean touch(View view,MotionEvent event){
        if(session.isEmpty())return false;
        float x=event.getX(),y=event.getY();
        if(event.getActionMasked()==MotionEvent.ACTION_DOWN){lastX=x;lastY=y;totalMove=0;scroll=0;down=SystemClock.elapsedRealtime();view.getParent().requestDisallowInterceptTouchEvent(true);return true;}
        if(event.getActionMasked()==MotionEvent.ACTION_POINTER_DOWN||event.getActionMasked()==MotionEvent.ACTION_POINTER_UP){lastX=x;lastY=y;totalMove=100;return true;}
        if(event.getActionMasked()==MotionEvent.ACTION_MOVE){float dx=x-lastX,dy=y-lastY;lastX=x;lastY=y;totalMove+=Math.abs(dx)+Math.abs(dy);
            if(event.getPointerCount()>1){scroll+=dy/18;int steps=(int)scroll;if(steps!=0){scroll-=steps;enqueueNumbers("scroll",Math.max(-10,Math.min(10,-steps)),0);}}
            else enqueueNumbers("move",Math.max(-600,Math.min(600,Math.round(dx*1.5f))),Math.max(-600,Math.min(600,Math.round(dy*1.5f))));return true;
        }
        if(event.getActionMasked()==MotionEvent.ACTION_UP){if(totalMove<12&&SystemClock.elapsedRealtime()-down<300){view.performClick();enqueue("click","button","left");}view.getParent().requestDisallowInterceptTouchEvent(false);return true;}return true;
    }
    private void enqueueNumbers(String type,int a,int b){try{JSONObject event=new JSONObject().put("type",type);if(type.equals("move"))event.put("x",a).put("y",b);else event.put("steps",a);offer(event);}catch(JSONException ignored){}}
    private void enqueue(String type,String key,String value){if(session.isEmpty()){status.setText("Tap Start control first.");return;}try{offer(new JSONObject().put("type",type).put(key,value));}catch(JSONException ignored){}}
    private void offer(JSONObject event){synchronized(queue){
        if(queue.size()>=16){if(event.optString("type").equals("move"))return;main.post(()->status.setText("Controls are catching up. Wait a moment."));return;}
        queue.add(event);
    }}
    private void flush(){String token=session;ApiClient client=api;if(token.isEmpty()||client==null||!visible)return;JSONArray events=new JSONArray();synchronized(queue){while(!queue.isEmpty())events.put(queue.remove());}if(events.length()==0)return;
        try{JSONObject receipt=client.json("/api/remote/input",new JSONObject().put("session",token).put("sequence",++sequence).put("events",events));if(!receipt.optBoolean("applied"))throw new Exception();}
        catch(Exception ignored){main.post(()->{if(token.equals(session)){stop();status.setText("Control stopped after a connection problem or Windows lock. No input was resent.");}});}
    }
    private void begin(){
        if(api==null)return;start.setEnabled(false);int epoch=generation;ApiClient client=api;
        worker.execute(()->{try{
            String device=RemoteSigner.deviceId();String computer=getSharedPreferences("ComputerActivity",MODE_PRIVATE).getString(origin+":computer","");if(computer.isEmpty())throw new Exception();
            JSONObject challenge=client.json("/api/remote/challenge",new JSONObject().put("deviceId",device));
            main.post(()->{if(!visible||epoch!=generation)return;biometric=RemoteSigner.approve(this,challenge.optString("payload"),computer,new RemoteSigner.Result(){
                public void approved(String signature){worker.execute(()->{try{JSONObject receipt=client.json("/api/remote/start",new JSONObject().put("requestId",challenge.getString("requestId")).put("signature",signature));main.post(()->{if(visible&&epoch==generation){session=receipt.optString("session");sequence=0;applyRequestedMedia();start.setText("Stop control");start.setEnabled(true);status.setText("Control active · stops when you leave · expires in 15 minutes");}else endSession(receipt.optString("session"));});}catch(Exception ignored){failed();}});}
                public void failed(){main.post(()->{if(visible&&epoch==generation){start.setEnabled(true);status.setText("Control could not start. Check pairing, unlock JARVIS and Windows, then try again.");}});}
            });});
        }catch(Exception ignored){main.post(()->{if(visible&&epoch==generation){start.setEnabled(true);status.setText("Pair this phone in Laptop controls first, then unlock JARVIS and Windows.");}});}});
    }
    private void stop(){String token=session;session="";synchronized(queue){queue.clear();}if(start!=null){start.setText("Start control");start.setEnabled(true);}if(status!=null)status.setText("Control stopped.");
        endSession(token);
    }
    private void applyRequestedMedia(){if(!requestedMedia.isEmpty()&&!requestedConsumed&&System.currentTimeMillis()-requestedAt<120000){requestedConsumed=true;getIntent().removeExtra("requestedMedia");enqueue("media","key",requestedMedia);requestedMedia="";}}
    @Override protected void onSaveInstanceState(Bundle out){out.putBoolean("requestedConsumed",requestedConsumed);super.onSaveInstanceState(out);}
    private void endSession(String token){if(!token.isEmpty())new Thread(()->{try(ApiClient client=new ApiClient(origin,CookieManager.getInstance().getCookie(origin),5000)){client.json("/api/remote/stop",new JSONObject().put("session",token));}catch(Exception ignored){}},"JARVIS stop remote").start();}
    @Override protected void onResume(){super.onResume();if(origin==null)return;visible=true;api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin));}
    @Override protected void onPause(){visible=false;generation++;if(biometric!=null)biometric.cancel();stop();if(api!=null)api.close();api=null;super.onPause();}
    @Override protected void onDestroy(){worker.shutdownNow();main.removeCallbacksAndMessages(null);super.onDestroy();}
}
