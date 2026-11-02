package org.jarvisassistant.app;
import java.security.MessageDigest;
final class UpdatePolicy {
    static final long MAX_BYTES=150L*1024*1024;
    static boolean variant(String value){return "phone".equals(value)||"watch".equals(value);}
    static boolean artifact(String value,String variant){return variant(variant)&&value!=null&&value.matches("/downloads/JARVIS-"+variant+"-[0-9]+\\.[0-9]+\\.[0-9]+-[a-f0-9]{12}\\.apk");}
    static boolean valid(long version,long size,String hash,String url,String variant){return version>0&&version<=Integer.MAX_VALUE&&size>=1024&&size<=MAX_BYTES&&hash!=null&&hash.matches("[a-f0-9]{64}")&&artifact(url,variant);}
    static boolean sameSigner(byte[] installed,byte[] downloaded){return installed!=null&&downloaded!=null&&installed.length>0&&MessageDigest.isEqual(installed,downloaded);}
    static boolean newer(long current,long next){return current>0&&next>current;}
}
