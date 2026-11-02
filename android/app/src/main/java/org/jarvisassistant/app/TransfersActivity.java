package org.jarvisassistant.app;

import android.app.*;
import android.content.*;
import android.database.Cursor;
import android.net.Uri;
import android.os.*;
import android.provider.OpenableColumns;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONObject;

/** Native file picker and durable progress; no privileged WebView bridge. */
public final class TransfersActivity extends Activity {
    private final Handler main=new Handler(android.os.Looper.getMainLooper());
    private LinearLayout rows;private TextView status,selected;private EditText filename;private String origin,share,path;private Uri source;private long size;
    private final Runnable refresh=new Runnable(){public void run(){render();main.postDelayed(this,1000);}};
    @Override public void onCreate(Bundle state){
        super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"Transfers","Continue across apps and the lock screen",this::finish));
        ScrollView scroll=new ScrollView(this);root.addView(scroll,new LinearLayout.LayoutParams(-1,0,1));LinearLayout content=NativeStyle.column(this);int pad=NativeStyle.dp(this,24);content.setPadding(pad,pad,pad,pad);scroll.addView(content);
        status=NativeStyle.text(this,"Transfers resume after a connection drop. Keep the laptop awake and Tailscale connected. Unlock JARVIS again if its session expires.",13,NativeStyle.MUTED);content.addView(status);NativeStyle.gap(content,20);
        if(getIntent().hasExtra("upload"))try{
            origin=EndpointPolicy.connection(getIntent().getStringExtra("origin"));Uri url=Uri.parse(getIntent().getStringExtra("upload"));
            if(!EndpointPolicy.sameOrigin(url.toString(),origin)||!"/native/files/upload".equals(url.getPath()))throw new IllegalArgumentException();
            share=url.getQueryParameter("share");path=url.getQueryParameter("path");if(share==null||share.length()>80||path==null||path.length()>3000)throw new IllegalArgumentException();
            LinearLayout card=NativeStyle.card(this);content.addView(card);card.addView(NativeStyle.title(this,"Send to laptop",20));NativeStyle.gap(card,12);
            card.addView(NativeStyle.text(this,"Destination: "+share.replace("drive-","").toUpperCase(java.util.Locale.ROOT)+":/"+path,13,NativeStyle.MUTED));
            selected=NativeStyle.text(this,"Choose the file you want to send.",14,NativeStyle.TEXT);NativeStyle.gap(card,16);card.addView(selected);
            card.addView(NativeStyle.action(this,"Choose a file","file",false,()->startActivityForResult(new Intent(Intent.ACTION_OPEN_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("*/*").addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),81)));
            filename=new EditText(this);NativeStyle.input(this,filename);filename.setHint("File name on laptop");filename.setSingleLine(true);card.addView(filename);
            card.addView(NativeStyle.action(this,"Start background upload","upload",true,this::startUpload));NativeStyle.gap(content,24);
        }catch(Exception ignored){status.setText("Open Files in JARVIS and choose a destination before uploading.");}
        rows=NativeStyle.column(this);content.addView(rows);setContentView(root);
    }
    @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=81||result!=RESULT_OK||data==null)return;
        try{
            Uri uri=data.getData();if(uri==null||!"content".equals(uri.getScheme()))throw new Exception();
            getContentResolver().takePersistableUriPermission(uri,Intent.FLAG_GRANT_READ_URI_PERMISSION);
            String name="";long bytes=-1;try(Cursor cursor=getContentResolver().query(uri,new String[]{OpenableColumns.DISPLAY_NAME,OpenableColumns.SIZE},null,null,null)){if(cursor!=null&&cursor.moveToFirst()){name=cursor.getString(0);if(!cursor.isNull(1))bytes=cursor.getLong(1);}}
            if(bytes<0||bytes>FileTransferPolicy.MAXIMUM_BYTES)throw new Exception();
            ParcelFileDescriptor descriptor=getContentResolver().openFileDescriptor(uri,"r");if(descriptor==null)throw new Exception();try(java.io.FileInputStream input=new ParcelFileDescriptor.AutoCloseInputStream(descriptor)){if(input.getChannel().size()!=bytes)throw new Exception();input.getChannel().position(0);}
            source=uri;size=bytes;filename.setText(name);selected.setText(name+" · "+android.text.format.Formatter.formatFileSize(this,bytes));
        }catch(Exception ignored){source=null;status.setText("Choose a local file up to 20 GB from a document provider that allows continued access.");}
    }
    private void startUpload(){
        if(source==null){status.setText("Choose a file first.");return;}
        try{
            String name=filename.getText().toString().trim();if(name.isEmpty()||name.length()>240)throw new Exception();
            JSONObject item=TransferJobs.create(this,origin,"upload",name,source,size).put("share",share).put("path",path);
            new TransferStore(this).put(item);TransferJobs.start(this,item);source=null;selected.setText("Upload queued. You can close this screen.");render();
        }catch(Exception ignored){status.setText("Could not start the upload. Check its name and resume it below if it was queued.");}
    }
    private void render(){if(rows==null)return;try{
        java.util.List<JSONObject> list=new TransferStore(this).all();rows.removeAllViews();
        if(list.isEmpty()){rows.addView(NativeStyle.text(this,"No transfers yet. Start one from your laptop’s Files screen.",14,NativeStyle.MUTED));return;}
        java.util.Collections.reverse(list);
        for(JSONObject item:list){String id=item.getString("id"),state=item.getString("state");LinearLayout card=NativeStyle.card(this);rows.addView(card);NativeStyle.gap(rows,14);
            card.addView(NativeStyle.title(this,item.optString("name","File"),16));NativeStyle.gap(card,8);card.addView(NativeStyle.text(this,item.optString("message","Queued"),13,NativeStyle.MUTED));
            ProgressBar progress=new ProgressBar(this,null,android.R.attr.progressBarStyleHorizontal);progress.setMax(100);long total=item.optLong("size",-1);progress.setIndeterminate(total<0);if(total>=0)progress.setProgress(FileTransferPolicy.progress(item.optLong("offset"),total));card.addView(progress);
            if(total>=0)card.addView(NativeStyle.text(this,android.text.format.Formatter.formatFileSize(this,item.optLong("offset"))+" / "+android.text.format.Formatter.formatFileSize(this,total),12,NativeStyle.MUTED));
            LinearLayout controls=new LinearLayout(this);card.addView(controls);
            if(TransferStore.terminal(state))controls.addView(NativeStyle.action(this,"Remove from list",null,false,()->action(()->new TransferStore(this).remove(id))));
            else{
                boolean paused=state.equals("paused")||state.equals("auth");
                controls.addView(NativeStyle.action(this,paused?"Resume":"Pause",null,false,()->action(()->{if(paused)TransferJobs.start(this,new TransferStore(this).get(id));else TransferJobs.pause(this,id);} )));
                controls.addView(NativeStyle.action(this,"Cancel",null,false,()->action(()->TransferJobs.cancel(this,id))));
            }
        }
    }catch(Exception ignored){status.setText("Transfer history could not load. Your files were not removed.");}}
    private interface Action{void run()throws Exception;}
    private void action(Action action){try{action.run();render();}catch(Exception ignored){status.setText("Could not update the transfer. Open JARVIS, unlock it and try again.");}}
    @Override protected void onResume(){super.onResume();main.removeCallbacks(refresh);refresh.run();}
    @Override protected void onPause(){main.removeCallbacks(refresh);super.onPause();}
}
