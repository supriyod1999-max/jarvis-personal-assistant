package org.jarvisassistant.app;
import com.google.android.gms.wearable.*;
public final class WatchKeyListener extends WearableListenerService {
    @Override public void onMessageReceived(MessageEvent message){if(!WatchIdentity.REQUEST.equals(message.getPath())||message.getData().length>20)return;Wearable.getNodeClient(this).getConnectedNodes().addOnSuccessListener(nodes->{if(nodes.size()==1&&nodes.get(0).getId().equals(message.getSourceNodeId()))WatchIdentity.announce(this,message.getSourceNodeId());});}
}
