package org.jarvisassistant.app;

final class RemoteProof {
    static boolean valid(String payload,String computer,String device,long now){
        if(payload==null||payload.length()>700||computer==null||computer.isEmpty())return false;
        String[] fields=payload.split("\n",-1);
        if(fields.length!=6||!fields[0].equals("JARVIS_REMOTE_CONTROL_V1")||!fields[1].equals(computer)||!fields[2].equals(device)||!fields[3].matches("[a-f0-9-]{36}")||!fields[4].matches("[A-Za-z0-9_-]{32}"))return false;
        try{long expires=Long.parseLong(fields[5]);return expires>now&&expires-now<=60000;}catch(NumberFormatException ignored){return false;}
    }
}
