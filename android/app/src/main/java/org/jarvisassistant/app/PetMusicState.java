package org.jarvisassistant.app;
/** Hysteresis prevents dancing to one noisy classification. */
final class PetMusicState {
    private int positive,negative;private boolean dancing;
    boolean update(float probability){if(Float.isFinite(probability)&&probability>=.6f){positive++;negative=0;}else{negative++;positive=0;}if(positive>=2)dancing=true;if(negative>=3)dancing=false;return dancing;}
    void reset(){positive=negative=0;dancing=false;}
}
