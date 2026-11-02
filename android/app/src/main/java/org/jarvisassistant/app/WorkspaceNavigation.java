package org.jarvisassistant.app;
import android.content.Context;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Fixed one-way navigation; no cookie, personal data or privileged JS bridge. */
final class WorkspaceNavigation {
    static String devices(Context context)throws IOException{try(InputStream input=context.getAssets().open("devices-navigation.js");ByteArrayOutputStream output=new ByteArrayOutputStream()){byte[] buffer=new byte[1024];int count;while((count=input.read(buffer))!=-1){if(output.size()+count>8192)throw new IOException("Navigation asset too large");output.write(buffer,0,count);}return new String(output.toByteArray(),StandardCharsets.UTF_8);}}
}
