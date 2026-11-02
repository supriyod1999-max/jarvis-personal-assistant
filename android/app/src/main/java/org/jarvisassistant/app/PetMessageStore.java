package org.jarvisassistant.app;
import android.content.Context;
import android.security.keystore.*;
import android.util.AtomicFile;
import org.json.JSONObject;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.MGF1ParameterSpec;
import java.util.*;
import javax.crypto.*;
import javax.crypto.spec.*;

/** Visitor writes use a public key; reading requires a recent Android device authentication. */
final class PetMessageStore {
    static final int MAX_AUDIO=16000*2*60, MAX_NOTES=30;
    private final File directory; private final String alias;
    PetMessageStore(Context context,String origin)throws Exception {
        String scope=hex(MessageDigest.getInstance("SHA-256").digest(EndpointPolicy.connection(origin).getBytes(StandardCharsets.UTF_8)));
        alias="jarvis-pet-messages-"+scope;directory=new File(context.getFilesDir(),"pet-messages/"+scope);
        if(!directory.isDirectory()&&!directory.mkdirs())throw new IOException("Private messages could not be opened.");
    }
    static String hex(byte[] bytes){StringBuilder out=new StringBuilder();for(byte b:bytes)out.append(String.format(Locale.ROOT,"%02x",b&255));return out.toString();}
    private KeyStore keys()throws Exception{KeyStore store=KeyStore.getInstance("AndroidKeyStore");store.load(null);return store;}
    synchronized void prepare()throws Exception{
        if(keys().containsAlias(alias))return;
        KeyPairGenerator generator=KeyPairGenerator.getInstance("RSA","AndroidKeyStore");
        KeyGenParameterSpec.Builder builder=new KeyGenParameterSpec.Builder(alias,KeyProperties.PURPOSE_DECRYPT).setKeySize(2048).setDigests(KeyProperties.DIGEST_SHA256,KeyProperties.DIGEST_SHA1).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_RSA_OAEP).setUserAuthenticationRequired(true).setUnlockedDeviceRequired(true).setInvalidatedByBiometricEnrollment(false);
        if(android.os.Build.VERSION.SDK_INT>=30)builder.setUserAuthenticationParameters(30,KeyProperties.AUTH_BIOMETRIC_STRONG|KeyProperties.AUTH_DEVICE_CREDENTIAL);else builder.setUserAuthenticationValidityDurationSeconds(30);
        generator.initialize(builder.build());generator.generateKeyPair();
    }
    synchronized String save(String text,byte[] pcm)throws Exception{
        text=text==null?"":text.trim();if(text.length()>2000||pcm==null||pcm.length>MAX_AUDIO||pcm.length%2!=0||text.isEmpty()&&pcm.length==0)throw new IOException("Add a short message or a recording of up to one minute.");
        if(files().length>=MAX_NOTES)throw new IOException("The private inbox is full. Ask the owner to review it first.");prepare();
        byte[] header=new JSONObject().put("text",text).put("created",System.currentTimeMillis()).toString().getBytes(StandardCharsets.UTF_8),plain;
        ByteArrayOutputStream memory=new ByteArrayOutputStream();try(DataOutputStream output=new DataOutputStream(memory)){output.writeInt(header.length);output.write(header);output.write(pcm);}plain=memory.toByteArray();
        SecretKey secret=KeyGenerator.getInstance("AES").generateKey();Cipher aes=Cipher.getInstance("AES/GCM/NoPadding");aes.init(Cipher.ENCRYPT_MODE,secret);byte[] encrypted=aes.doFinal(plain);Arrays.fill(plain,(byte)0);
        Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");rsa.init(Cipher.ENCRYPT_MODE,KeyFactory.getInstance("RSA").generatePublic(new java.security.spec.X509EncodedKeySpec(keys().getCertificate(alias).getPublicKey().getEncoded())),new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,PSource.PSpecified.DEFAULT));byte[] wrapped=rsa.doFinal(secret.getEncoded());
        String id=UUID.randomUUID().toString();AtomicFile file=new AtomicFile(new File(directory,id+".note"));FileOutputStream stream=null;try{stream=file.startWrite();DataOutputStream output=new DataOutputStream(stream);output.writeInt(1);output.writeInt(wrapped.length);output.write(wrapped);output.write(aes.getIV());output.write(encrypted);output.flush();file.finishWrite(stream);}catch(Exception error){if(stream!=null)file.failWrite(stream);throw error;}return id;
    }
    synchronized File[] files(){File[] files=directory.listFiles(file->file.getName().matches("[a-f0-9-]{36}\\.note"));if(files==null)return new File[0];Arrays.sort(files,Comparator.comparingLong(File::lastModified).reversed());return files;}
    static final class Note implements AutoCloseable {final String id,text;final long created;final byte[] pcm;Note(String id,String text,long created,byte[] pcm){this.id=id;this.text=text;this.created=created;this.pcm=pcm;}public void close(){Arrays.fill(pcm,(byte)0);}}
    private static byte[] readBounded(InputStream input,int maximum)throws IOException{ByteArrayOutputStream output=new ByteArrayOutputStream();byte[] buffer=new byte[Math.min(4096,maximum)];int remaining=maximum;while(remaining>0){int count=input.read(buffer,0,Math.min(remaining,buffer.length));if(count<0)break;output.write(buffer,0,count);remaining-=count;}return output.toByteArray();}
    synchronized Note read(String id)throws Exception{
        if(!id.matches("[a-f0-9-]{36}"))throw new IOException("Invalid message.");File file=new File(directory,id+".note");if(file.length()>MAX_AUDIO+20000)throw new IOException("Message exceeds the private limit.");byte[] plain;
        try(DataInputStream input=new DataInputStream(new AtomicFile(file).openRead())){if(input.readInt()!=1||input.readInt()!=256)throw new IOException("Message format unavailable.");byte[] wrapped=readBounded(input,256),iv=readBounded(input,12),encrypted=readBounded(input,MAX_AUDIO+19000);Cipher rsa=Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");rsa.init(Cipher.DECRYPT_MODE,keys().getKey(alias,null),new OAEPParameterSpec("SHA-256","MGF1",MGF1ParameterSpec.SHA1,PSource.PSpecified.DEFAULT));byte[] key=rsa.doFinal(wrapped);try{Cipher aes=Cipher.getInstance("AES/GCM/NoPadding");aes.init(Cipher.DECRYPT_MODE,new SecretKeySpec(key,"AES"),new GCMParameterSpec(128,iv));plain=aes.doFinal(encrypted);}finally{Arrays.fill(key,(byte)0);}}
        try(DataInputStream input=new DataInputStream(new ByteArrayInputStream(plain))){int length=input.readInt();if(length<0||length>16000)throw new IOException("Message unavailable.");JSONObject header=new JSONObject(new String(readBounded(input,length),StandardCharsets.UTF_8));return new Note(id,header.getString("text"),header.getLong("created"),readBounded(input,MAX_AUDIO));}finally{Arrays.fill(plain,(byte)0);}
    }
    synchronized void delete(String id)throws Exception{try(Note ignored=read(id)){new AtomicFile(new File(directory,id+".note")).delete();}}
}
