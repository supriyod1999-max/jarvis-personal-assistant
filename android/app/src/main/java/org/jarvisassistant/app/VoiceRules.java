package org.jarvisassistant.app;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public final class VoiceRules {
    private static final Pattern WAKE = Pattern.compile("^(?:hey|hello|wake\\s+up)[,\\s]+jarvis(?:[.!?,:;]+|\\s|$)\\s*(.*)$", Pattern.CASE_INSENSITIVE | Pattern.DOTALL);
    public static String wakeCommand(String text) { Matcher m = WAKE.matcher(text.trim()); return m.matches() ? m.group(1).trim() : null; }
    // Only after LocalWake has independently verified the acoustic wake phrase.
    static String afterDetectedWake(String text){String exact=wakeCommand(text);if(exact!=null)return exact;return text.trim().replaceFirst("(?i)^(?:hey|hello|wake\\s+up)[,\\s]+(?:jervis|javis|jarvice|jarves|travis)\\b[.!?,:;\\s]*","").trim();}
    public static boolean sleep(String text) { return text.trim().matches("(?i)^(?:(?:hey |hello )?jarvis[, ]+)?(?:go to sleep|sleep now|dismiss|that's all|that is all)[.!]?$ ".trim()); }
    public static boolean off(String text) { return text.trim().matches("(?i)^(?:(?:hey |hello )?jarvis[, ]+)?(?:stop listening|turn off (?:the )?(?:microphone|wake listening)|microphone off)[.!]?$"); }
    public static byte[] wav(byte[] pcm) {
        if (pcm.length < 11200 || pcm.length > 960000 || pcm.length % 2 != 0) throw new IllegalArgumentException("Recording must be 0.35 to 30 seconds.");
        ByteBuffer bytes = ByteBuffer.allocate(44 + pcm.length).order(ByteOrder.LITTLE_ENDIAN);
        bytes.put("RIFF".getBytes(StandardCharsets.US_ASCII)).putInt(36 + pcm.length).put("WAVEfmt ".getBytes(StandardCharsets.US_ASCII));
        bytes.putInt(16).putShort((short)1).putShort((short)1).putInt(16000).putInt(32000).putShort((short)2).putShort((short)16);
        bytes.put("data".getBytes(StandardCharsets.US_ASCII)).putInt(pcm.length).put(pcm); return bytes.array();
    }
    public static String spoken(String text) {
        return text.replaceAll("(?s)```.*?(?:```|$)", " Code is in the written reply. ").replaceAll("\\[([^]]+)\\]\\([^)]*\\)", "$1").replaceAll("[*#`_>]", "").trim();
    }
    public static int chunk(String text) {
        int limit = Math.min(220, text.length());
        Matcher sentence = Pattern.compile("[.!?](?=\\s|$)").matcher(text);
        if (sentence.find() && sentence.end() <= limit) return sentence.end();
        if (text.length() <= limit) return text.length();
        int space = text.lastIndexOf(' ', limit); return space > 0 ? space : limit;
    }
}
