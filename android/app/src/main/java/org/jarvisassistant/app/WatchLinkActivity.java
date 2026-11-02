package org.jarvisassistant.app;
import android.Manifest;
import android.app.*;
import android.content.*;
import android.content.pm.PackageManager;
import android.os.*;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.widget.*;
import com.google.android.gms.wearable.*;
import org.json.*;
import java.util.concurrent.*;

/** Owner chooses the exact paired watch. Separate biometric grant for media only. */
public final class WatchLinkActivity extends Activity {
    private String origin;private TextView status;private LinearLayout body;private CancellationSignal biometric;
    private final ExecutorService worker=Executors.newSingleThreadExecutor();private volatile ApiClient active;private boolean visible;private int epoch;
    @Override public void onCreate(Bundle saved){super.onCreate(saved);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        try{origin=EndpointPolicy.connection(getIntent().getStringExtra("origin"));}catch(Exception e){finish();return;}
        LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"Galaxy Watch","JARVIS, within reach",this::finish));ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));body=NativeStyle.column(this);int p=NativeStyle.dp(this,22);body.setPadding(p,p,p,p);scroll.addView(body);setContentView(root);
        status=NativeStyle.text(this,"Install JARVIS on your paired watch, then choose it below. Watch voice is general conversation; private actions stay on your phone.",15,NativeStyle.MUTED);body.addView(status);
        body.addView(NativeStyle.action(this,"Find paired watches","refresh",true,this::find));
        body.addView(NativeStyle.action(this,"Enable watch connection","connection",false,this::start));
        body.addView(NativeStyle.action(this,"Allow media for 15 minutes","laptop",false,this::media));
        body.addView(NativeStyle.action(this,"Stop media control",null,false,()->{WatchBridgeService bridge=WatchBridgeService.current;if(bridge!=null)bridge.stopMedia();status.setText("Media control stopped.");}));
        body.addView(NativeStyle.action(this,"Disconnect watch",null,false,()->{stopService(new Intent(this,WatchBridgeService.class));getSharedPreferences("WatchLink",MODE_PRIVATE).edit().clear().apply();status.setText("Watch disconnected. Listening is controlled separately on the watch.");}));
        NativeStyle.gap(body,18);body.addView(NativeStyle.text(this,"Keep Tailscale connected and your JARVIS workspace unlocked. The phone connection has an ongoing notification with a disconnect button. On the watch, wake listening starts off every time; choose 15 minutes, 1 hour or Until stopped. No microphone starts from the tile alone.",13,NativeStyle.MUTED));
    }
    private void find(){Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(this,nodes->{if(nodes.isEmpty()){status.setText("No watch connected. Pair it with Galaxy Wearable and open JARVIS on the watch.");return;}String[] names=new String[nodes.size()];for(int i=0;i<names.length;i++)names[i]=nodes.get(i).getDisplayName();new AlertDialog.Builder(this).setTitle("Choose your watch").setItems(names,(d,index)->{Node node=nodes.get(index);new AlertDialog.Builder(this).setTitle("Link "+node.getDisplayName()+"?").setMessage("Allow voice conversations and requests for phone controls through this workspace? Fingerprint approval stays on your phone.").setNegativeButton("Cancel",null).setPositiveButton("Link watch",(dialog,which)->verifyAndLink(node)).show();}).show();}).addOnFailureListener(this,e->status.setText("Watch connection unavailable. Check Galaxy Wearable and Google Play services."));}
    private void verifyAndLink(Node node){int generation=epoch;worker.execute(()->{try(ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin))){active=api;if(!api.json("/api/lock/status",null).optBoolean("unlocked"))throw new Exception();runOnUiThread(()->{if(!visible||generation!=epoch)return;stopService(new Intent(this,WatchBridgeService.class));getSharedPreferences("WatchLink",MODE_PRIVATE).edit().putString("node",node.getId()).putString("origin",origin).putString("name",node.getDisplayName()).apply();status.setText("Watch linked. Tap Enable watch connection.");});}catch(Exception e){runOnUiThread(()->status.setText("Unlock this JARVIS workspace on your phone before linking."));}finally{active=null;}});}
    private void start(){if(getSharedPreferences("WatchLink",MODE_PRIVATE).getString("node","").isEmpty()){status.setText("Choose your watch first.");return;}
        if(Build.VERSION.SDK_INT>=31 && checkSelfPermission(Manifest.permission.BLUETOOTH_CONNECT)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.BLUETOOTH_CONNECT},84);return;}
        if(Build.VERSION.SDK_INT>=33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)!=PackageManager.PERMISSION_GRANTED){requestPermissions(new String[]{Manifest.permission.POST_NOTIFICATIONS},84);return;}
        try{startForegroundService(new Intent(this,WatchBridgeService.class));status.setText("Watch connection starting. Tap Check connection on your watch.");}catch(RuntimeException e){status.setText("Could not start. Reopen this screen and try Enable watch connection.");}}
    @Override public void onRequestPermissionsResult(int code,String[] permissions,int[] grants){super.onRequestPermissionsResult(code,permissions,grants);if(code==84 && grants.length>0 && grants[0]==PackageManager.PERMISSION_GRANTED)start();else status.setText("Allow nearby devices and notifications to enable the watch connection.");}
    private void media(){WatchBridgeService bridge=WatchBridgeService.current;if(bridge==null){status.setText("Enable the watch connection first.");return;}int generation=epoch;
        worker.execute(()->{try(ApiClient api=new ApiClient(origin,CookieManager.getInstance().getCookie(origin))){active=api;String computer=getSharedPreferences("ComputerActivity",MODE_PRIVATE).getString(origin+":computer","");JSONObject challenge=api.json("/api/remote/challenge",new JSONObject().put("deviceId",RemoteSigner.deviceId()));
            CountDownLatch done=new CountDownLatch(1);String[] proof={null};runOnUiThread(()->{if(!visible||epoch!=generation){done.countDown();return;}biometric=RemoteSigner.approve(this,challenge.optString("payload"),computer,"Watch media only · 15 minutes",new RemoteSigner.Result(){public void approved(String signature){proof[0]=signature;done.countDown();}public void failed(){done.countDown();}});});
            if(!done.await(90,TimeUnit.SECONDS)||proof[0]==null||!visible||epoch!=generation)throw new Exception();
            JSONObject receipt=api.json("/api/remote/start",new JSONObject().put("requestId",challenge.getString("requestId")).put("signature",proof[0]));String token=receipt.getString("session");
            if(!visible||epoch!=generation||WatchBridgeService.current!=bridge){api.json("/api/remote/stop",new JSONObject().put("session",token));return;}bridge.media(token);runOnUiThread(()->status.setText("Watch media enabled for 15 minutes. Volume and playback only. Use Stop media control to end it."));
        }catch(Exception e){runOnUiThread(()->status.setText("Media was not enabled. Unlock Windows and JARVIS, check phone pairing, then try again. No action was resent."));}finally{active=null;}});
    }
    @Override protected void onResume(){super.onResume();visible=true;}
    @Override protected void onPause(){visible=false;epoch++;if(biometric!=null)biometric.cancel();ApiClient api=active;if(api!=null)api.close();super.onPause();}
    @Override protected void onDestroy(){worker.shutdownNow();super.onDestroy();}
}
