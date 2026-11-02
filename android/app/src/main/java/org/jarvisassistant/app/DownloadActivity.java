package org.jarvisassistant.app;
import android.app.*;
import android.content.*;
import android.net.Uri;
import android.os.Bundle;
import android.view.WindowManager;
import android.widget.*;
import org.json.JSONObject;

/** Save As grants a durable document; the job, not this activity, owns the bytes. */
public final class DownloadActivity extends Activity {
 private String origin,path,name;private TextView status;
 @Override protected void onCreate(Bundle state){super.onCreate(state);getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
  try{
   origin=EndpointPolicy.connection(getIntent().getStringExtra("origin"));Uri url=Uri.parse(getIntent().getStringExtra("url"));
   if(!EndpointPolicy.sameOrigin(url.toString(),origin)||!"/api/files/download".equals(url.getPath()))throw new IllegalArgumentException();
   path=url.getEncodedPath()+"?"+url.getEncodedQuery();String relative=url.getQueryParameter("path");name=relative==null?"JARVIS file":relative.substring(relative.lastIndexOf('/')+1);
   LinearLayout root=NativeStyle.surface(this);root.addView(NativeStyle.toolbar(this,"Save to phone","Download continues in the background",this::finish));status=NativeStyle.text(this,"Choose a local download location. Progress is available in Transfers and your notification.",15,NativeStyle.TEXT);int pad=NativeStyle.dp(this,24);status.setPadding(pad,pad,pad,pad);root.addView(status);setContentView(root);
   if(state==null)startActivityForResult(new Intent(Intent.ACTION_CREATE_DOCUMENT).addCategory(Intent.CATEGORY_OPENABLE).setType("application/octet-stream").putExtra(Intent.EXTRA_TITLE,name).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION|Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION),81);
  }catch(Exception ignored){finish();}
 }
 @Override protected void onActivityResult(int request,int result,Intent data){super.onActivityResult(request,result,data);if(request!=81)return;if(result!=RESULT_OK||data==null||data.getData()==null){finish();return;}
  try{
   Uri destination=data.getData();if(!"content".equals(destination.getScheme()))throw new Exception();
   getContentResolver().takePersistableUriPermission(destination,Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
   android.os.ParcelFileDescriptor descriptor=getContentResolver().openFileDescriptor(destination,"rw");if(descriptor==null)throw new Exception();try(java.io.FileOutputStream output=new android.os.ParcelFileDescriptor.AutoCloseOutputStream(descriptor)){output.getChannel().position(0);}
   JSONObject item=TransferJobs.create(this,origin,"download",name,destination,-1).put("download",path);new TransferStore(this).put(item);TransferJobs.start(this,item);
   startActivity(new Intent(this,TransfersActivity.class));finish();
  }catch(Exception ignored){status.setText("Could not queue this download. Choose local phone storage with continued read/write access, or check Transfers to resume an already queued file.");}
 }
}
