package org.jarvisassistant.app;

/** Pure foreground desk policy. No account access, scheduling or sensor startup. */
final class PetDesk {
    enum Mode{RELAX,WORK,MUSIC,BEDTIME}
    static Mode parse(String text){try{return Mode.valueOf(text);}catch(Exception ignored){return Mode.RELAX;}}
    static PetSocial.Mode social(Mode mode){return mode==Mode.RELAX?PetSocial.Mode.SOCIABLE:PetSocial.Mode.QUIET;}
    static Mode command(String text){if(text==null)return null;String s=text.toLowerCase(java.util.Locale.ROOT).replaceAll("[.!?,]","").trim();
        if(s.matches("(?:please )?(?:start work|start focus|focus mode|work mode)(?: please)?"))return Mode.WORK;
        if(s.matches("(?:please )?(?:relax mode|relaxing mode|let us relax|let's relax)(?: please)?"))return Mode.RELAX;
        if(s.matches("(?:please )?(?:music mode|dance mode)(?: please)?"))return Mode.MUSIC;
        if(s.matches("(?:please )?(?:bedtime mode|good night|goodnight)(?: please)?"))return Mode.BEDTIME;
        return null;
    }
    static String label(Mode mode){return switch(mode){case WORK->"Work · quiet focus";case MUSIC->"Music · ready to dance";case BEDTIME->"Bedtime · dim and calm";default->"Relax · friendly company";};}
}
