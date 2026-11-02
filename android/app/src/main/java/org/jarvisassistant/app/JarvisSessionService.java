package org.jarvisassistant.app;

import android.os.Bundle;
import android.service.voice.*;

public final class JarvisSessionService extends VoiceInteractionSessionService {
    @Override public VoiceInteractionSession onNewSession(Bundle args){return new JarvisSession(this);}
}
