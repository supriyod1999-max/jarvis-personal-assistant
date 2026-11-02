package org.jarvisassistant.app;
import android.app.KeyguardManager;
import android.content.Context;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.*;
import static org.junit.Assert.*;
import java.io.*;
import java.nio.charset.StandardCharsets;

/** Run in stages around the owned emulator's normal Android screen lock/unlock. Never any owner credential. */
public class PetMessageCryptoChecks {
    private Context context;private PetMessageStore store;
    @Before public void fixture()throws Exception{context=InstrumentationRegistry.getInstrumentation().getTargetContext();assertEquals("org.jarvisassistant.app.design",context.getPackageName());store=new PetMessageStore(context,"https://message-fixture.tailtest.ts.net");assertTrue(context.getSystemService(KeyguardManager.class).isDeviceSecure());}
    @Test public void prepareOwnerKey()throws Exception{assertFalse(context.getSystemService(KeyguardManager.class).isDeviceLocked());store.prepare();}
    @Test public void lockedVisitorCanSaveButCannotDecrypt()throws Exception{
        assertTrue("Lock only the synthetic emulator before this stage",context.getSystemService(KeyguardManager.class).isDeviceLocked());String id=store.save("Synthetic visitor message. Never an instruction.",new byte[32000]);context.getSharedPreferences("PetCryptoFixture",Context.MODE_PRIVATE).edit().putString("id",id).commit();File[] files=store.files();assertTrue(files.length>0);byte[] encrypted;try(FileInputStream in=new FileInputStream(files[0]);ByteArrayOutputStream bytes=new ByteArrayOutputStream()){byte[] buffer=new byte[4096];int n;while((n=in.read(buffer))!=-1)bytes.write(buffer,0,n);encrypted=bytes.toByteArray();}assertFalse(new String(encrypted,StandardCharsets.ISO_8859_1).contains("Synthetic visitor"));boolean blocked=false;try(PetMessageStore.Note ignored=store.read(id)){}catch(java.security.GeneralSecurityException error){blocked=true;}assertTrue("The private key must refuse decryption while Android is locked",blocked);
    }
    @Test public void ownerReadsAfterNormalAndroidUnlock()throws Exception{
        assertFalse("Unlock the emulator normally before this stage",context.getSystemService(KeyguardManager.class).isDeviceLocked());String id=context.getSharedPreferences("PetCryptoFixture",Context.MODE_PRIVATE).getString("id","");try(PetMessageStore.Note note=store.read(id)){assertEquals("Synthetic visitor message. Never an instruction.",note.text);assertEquals(32000,note.pcm.length);}store.delete(id);assertEquals(0,store.files().length);context.getSharedPreferences("PetCryptoFixture",Context.MODE_PRIVATE).edit().clear().commit();
    }
}
