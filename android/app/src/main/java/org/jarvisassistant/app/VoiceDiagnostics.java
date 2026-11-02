package org.jarvisassistant.app;

import android.content.Context;
import android.content.SharedPreferences;

/** Bounded local health counters only. Never audio, transcripts, cookies or account details. */
final class VoiceDiagnostics {
    private static SharedPreferences store(Context context) { return context.getSharedPreferences("voice_health",Context.MODE_PRIVATE); }
    static void start(Context context,boolean keep) { SharedPreferences data=store(context);String previous=data.getString("event","No earlier session"); data.edit().clear().putString("previous",previous).putString("mode",keep?"Keep listening":"Screen unlocked only").putString("event","Starting microphone").apply(); }
    static void event(Context context,String fixedLabel) { store(context).edit().putString("event",fixedLabel).apply(); }
    static synchronized void increment(Context context,String counter) { SharedPreferences data=store(context); data.edit().putInt(counter,Math.min(9999,data.getInt(counter,0)+1)).apply(); }
    static void recorder(Context context,int session) { SharedPreferences data=store(context);if(data.getInt("recorderSession",0)!=session)data.edit().putInt("recorderSession",session).putString("event","Microphone connected").apply(); }
    static void phase(Context context,String phase){SharedPreferences data=store(context);if(!phase.equals(data.getString("phase","")))data.edit().putString("phase",phase).apply();}
    static void failure(Context context,String stage,Exception error){store(context).edit().putString("failureStage",stage).putInt("failureStatus",error instanceof ApiClient.Failure?((ApiClient.Failure)error).status:0).apply();}
    static String report(Context context) {
        SharedPreferences data=store(context);
        return "Listening now: "+(VoiceService.running?"On":"Off")+"\nLast mode: "+data.getString("mode","Not started")+"\nLast event: "+data.getString("event","No listening session yet")
            +"\nWake engine: On-device Sherpa\nLocal wake checks / matches / rejected: "+data.getInt("localChecks",0)+" / "+data.getInt("localHits",0)+" / "+data.getInt("localRejected",0)
            +"\nSpeech snippets transcribed after wake: "+data.getInt("segments",0)+"\nWake phrases detected: "+data.getInt("wakes",0)
            +"\nLock-screen wake phrases: "+data.getInt("lockedWakes",0)+"\nLock-screen replies completed: "+data.getInt("lockedReplies",0)
            +"\nLock-screen speech segments: "+data.getInt("lockedSegments",0)+"\nRecognised speech segments: "+data.getInt("recognisedSegments",0)+"\nEmpty recognitions: "+data.getInt("emptySegments",0)
            +"\nQuestions submitted / accepted / answered: "+data.getInt("questions",0)+" / "+data.getInt("acceptedQuestions",0)+" / "+data.getInt("answeredQuestions",0)
            +"\nScreen changes / general continuations: "+data.getInt("screenChanges",0)+" / "+data.getInt("generalContinuations",0)+"\nLast phase: "+data.getString("phase","Not started")
            +"\nLast failed stage: "+data.getString("failureStage","None")+" (HTTP "+data.getInt("failureStatus",0)+")\nAndroid assistant selected: "+(JarvisAssistant.selected(context)?"Yes":"No")
            +"\nAudio paused by Android: "+data.getInt("silenced",0)+"\nMedia volume: "+context.getSystemService(android.media.AudioManager.class).getStreamVolume(android.media.AudioManager.STREAM_MUSIC)+"\nPrevious session event: "+data.getString("previous","None");
    }
}
