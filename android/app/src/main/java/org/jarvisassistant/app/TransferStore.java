package org.jarvisassistant.app;

import android.content.Context;
import android.util.AtomicFile;
import org.json.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.*;

/** App-private checkpoints and selected document URIs only. Never stores cookies or file bytes. */
final class TransferStore {
    private static final Object LOCK=new Object();
    private final AtomicFile file;
    TransferStore(Context context){file=new AtomicFile(new File(context.getFilesDir(),"file-transfers.json"));}
    private JSONArray read()throws Exception{
        if(!file.getBaseFile().exists())return new JSONArray();
        try(InputStream input=file.openRead();ByteArrayOutputStream output=new ByteArrayOutputStream()){
            byte[] block=new byte[4096];int count;while((count=input.read(block))!=-1){if(output.size()+count>2_000_000)throw new IOException("Transfer history is too large");output.write(block,0,count);}
            return new JSONArray(output.toString("UTF-8"));
        }
    }
    private void write(JSONArray list)throws Exception{
        FileOutputStream output=null;try{output=file.startWrite();output.write(list.toString().getBytes(StandardCharsets.UTF_8));file.finishWrite(output);}catch(Exception error){if(output!=null)file.failWrite(output);throw error;}
    }
    List<JSONObject> all()throws Exception{synchronized(LOCK){JSONArray list=read();List<JSONObject> result=new ArrayList<>();for(int i=0;i<list.length();i++)result.add(list.getJSONObject(i));return result;}}
    JSONObject get(String id)throws Exception{for(JSONObject item:all())if(item.getString("id").equals(id))return item;throw new IOException("Transfer unavailable");}
    void put(JSONObject value)throws Exception{synchronized(LOCK){JSONArray list=read(),next=new JSONArray();boolean found=false;
        for(int i=0;i<list.length();i++){JSONObject item=list.getJSONObject(i);if(item.getString("id").equals(value.getString("id"))){next.put(value);found=true;}else next.put(item);}
        if(!found){if(next.length()>=100)throw new IOException("Transfer history is full. Remove finished items first.");next.put(value);}write(next);
    }}
    void patch(String id,Object... pairs)throws Exception{synchronized(LOCK){JSONObject item=get(id);for(int i=0;i<pairs.length;i+=2)item.put((String)pairs[i],pairs[i+1]);put(item);}}
    void remove(String id)throws Exception{synchronized(LOCK){JSONArray next=new JSONArray();for(JSONObject item:all())if(!item.getString("id").equals(id))next.put(item);write(next);}}
    static boolean terminal(String state){return state.equals("complete")||state.equals("cancelled")||state.equals("failed");}
}
