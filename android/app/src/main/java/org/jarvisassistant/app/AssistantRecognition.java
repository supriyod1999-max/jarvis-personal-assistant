package org.jarvisassistant.app;

import android.content.Intent;
import android.speech.*;

/** Required assistant metadata endpoint; not advertised as a dictation provider.
 * JARVIS recognition is owned exclusively by the user-started VoiceService.
 * A binder request must never start another microphone or borrow its PIN cookie.
 */
public final class AssistantRecognition extends RecognitionService {
    @Override protected void onStartListening(Intent intent,Callback callback){try{callback.error(SpeechRecognizer.ERROR_CLIENT);}catch(android.os.RemoteException ignored){}}
    @Override protected void onStopListening(Callback callback){}
    @Override protected void onCancel(Callback callback){}
}
