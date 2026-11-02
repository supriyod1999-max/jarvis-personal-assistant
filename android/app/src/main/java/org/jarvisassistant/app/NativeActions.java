package org.jarvisassistant.app;
import android.content.*;
import org.json.JSONObject;

/** Fixed UI handoffs only. Never accepts a model URL, password, signature or command. */
final class NativeActions {
    static String label(String id){if(id==null)return "Continue in JARVIS";switch(id){case "computer.lock":return "Review laptop lock";case "computer.unlock":return "Review laptop unlock";case "remote.open":return "Review laptop control";case "coding.list":case "coding.approve":return "Open coding sessions";case "watch.open":return "Open watch companion";case "transfers.list":return "Open file transfers";default:return media(id)!=null?"Review laptop media":"Continue in JARVIS";}}
    static String media(String id){if(id!=null&&id.startsWith("media.")){String key=id.substring(6);if(WatchWire.media(key))return key;}return null;}
    static boolean known(String id){return page(id)!=null || media(id)!=null || java.util.Arrays.asList("pet.open","app.updates","transfers.list","computer.status","computer.lock","computer.unlock","remote.open","coding.list","coding.approve","watch.open","voice.wake","voice.quiet").contains(id);}
    static String fromJson(JSONObject action,String requestId){if(action==null || !"jarvis-action".equals(action.optString("kind")) || action.optInt("version")!=1 || !requestId.equals(action.optString("requestId")))return null;String id=action.optString("id");return known(id)?id:null;}
    static String page(String id){if(id==null)return null;switch(id){
        case "view.inbox":return "inbox";case "view.tasks":return "tasks";case "view.knowledge":return "knowledge";case "view.projects":return "projects";case "view.people":return "people";case "data.export":case "data.import":return "settings/data";case "personal.review":case "chat.models":case "chat.current-model":case "help.actions":return "command";
        case "camera.checkin":case "devices.list":case "screen.inspect":case "screen.remote":return "devices";
        case "files.browse":case "files.download":case "files.upload":case "files.folder":return "files";
        case "voice.status":case "voice.model":case "island.open":return "settings/assistant";
        case "connections.status":case "instagram.settings":case "evergreen.settings":case "google.open":return "settings/connections";
        case "workspace.lock":case "workspace.switch":return "settings/personal";
        case "profile.open":return "settings/personal";
        case "app.startup":return "settings/devices";
        case "whatsapp.settings":return "whatsapp";
        default:return null;
    }}
    static Intent intent(Context context,String origin,String id){
        origin=EndpointPolicy.connection(origin);String media=media(id);Intent intent;
        if(media!=null)intent=new Intent(context,RemoteActivity.class).putExtra("requestedMedia",media).putExtra("requestedAt",System.currentTimeMillis());
        else switch(id){
            case "computer.status":case "computer.lock":case "computer.unlock":intent=new Intent(context,ComputerActivity.class);if(!id.equals("computer.status"))intent.putExtra("requestedOperation",id.equals("computer.lock")?"windows.lock":"windows.unlock");break;
            case "remote.open":intent=new Intent(context,RemoteActivity.class);break;
            case "coding.list":case "coding.approve":intent=new Intent(context,CodingActivity.class);break;
            case "transfers.list":intent=new Intent(context,TransfersActivity.class);break;
            case "watch.open":intent=new Intent(context,WatchConnectionsActivity.class);break;
            case "pet.open":intent=new Intent(context,PetModeActivity.class);break;
            case "app.updates":intent=new Intent(context,AppUpdatesActivity.class);break;
            case "voice.wake":case "voice.quiet":intent=new Intent(context,MainActivity.class).putExtra("openVoice",true);break;
            default:String page=page(id);if(page==null)throw new IllegalArgumentException("Unknown action");intent=new Intent(context,MainActivity.class).putExtra("jarvisPage",page);
        }
        return intent.putExtra("origin",origin);
    }
}
