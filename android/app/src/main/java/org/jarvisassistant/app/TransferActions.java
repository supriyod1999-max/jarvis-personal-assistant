package org.jarvisassistant.app;
import android.content.*;

/** Immutable, app-private notification action. No network/cookie or document input. */
public final class TransferActions extends BroadcastReceiver {
    @Override public void onReceive(Context context,Intent intent){if("pause".equals(intent.getAction()))try{TransferJobs.pause(context,intent.getStringExtra("transfer"));}catch(Exception ignored){}}
}
