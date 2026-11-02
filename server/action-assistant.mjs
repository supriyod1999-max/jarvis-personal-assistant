import {resolveDeviceTarget} from './device-target.mjs';
import { ACTION_CATALOG, actionCard, actionDescriptor } from '../shared/action-catalog.mjs';

/** Capability handlers only: generated prose and IDs have no execution authority. */
export function createActionAssistant({ models, voice, devices, coding, primary = false }) {
  function run(request, onText, selected) {
    if (!actionDescriptor(selected)) throw new Error('That action is not available in JARVIS. Nothing was changed.');
    let stopped = false;
    const done = (async () => {
      let card = actionCard(selected, request.id);
      let text = card.detail;
      const privateAction = /^(?:devices|files|transfers|computer|remote|media|coding|watch|camera)\./.test(selected);
      if (privateAction && !primary) {text = 'Device files and laptop controls belong to the primary workspace. Open that workspace and unlock it before continuing.';card=actionCard('personal.review',request.id);}
      else if (!request.lockedVoice && selected === 'devices.list' && devices) {
        const snapshot = await devices.snapshot(() => !stopped);
        text = snapshot.devices.map(device => `${device.name}: ${device.role === 'host' ? 'host laptop' : 'paired phone'}, ${device.presence === 'online' ? 'online' : 'presence unknown'}. ${device.detail}`).join('\n');
      } else if (selected === 'chat.current-model') text = `The selected AI model is ${models.get()}.`;
      else if (selected === 'chat.models') {
        const choices = await models.models();
        text = choices.length ? `Available models: ${choices.slice(0, 40).map(choice => choice.name || choice.id).join(', ')}. Which one would you like to use?` : 'No models are available from the current ChatGPT connection. Open Connections to check sign-in.';
      } else if (!request.lockedVoice && selected === 'voice.status') {
        const state = voice.status();text = `Voice output: ${state.engine || 'local voice'}${state.voice ? `, ${state.voice}` : ''}. State: ${state.state}. No other voice model was started.`;
      } else if (!request.lockedVoice && primary && selected === 'coding.list' && coding) {
        const state = await coding.snapshot(() => !stopped);
        text = !state.enabled ? state.message || 'Coding monitoring is paused.' : state.sessions.length ? state.sessions.slice(0, 8).map(session => `${session.title || 'Coding session'}: ${session.status || session.state || 'open'}.`).join('\n') : 'No recent coding sessions were found. Open coding sessions to check monitoring.';
      } else if (!request.lockedVoice && primary && /^files\./.test(selected) && devices) {
        const snapshot=await devices.snapshot(()=>!stopped),target=resolveDeviceTarget(request.originalMessage||request.message,snapshot.devices);
        if(target.clarification){text=target.clarification;card=actionCard('devices.list',request.id);}
        else if(target.device&&!target.device.capabilities.files){text=target.device.name+' does not have a file agent connected. No other device was substituted.';card=actionCard('devices.list',request.id);}
        else if(target.device)text='Open files on '+target.device.name+' to choose the exact file and destination. Nothing has been transferred.';
      } else if (selected === 'help.actions') text = 'Ask in your own words to manage inbox items, tasks, knowledge, projects and people; read selected WhatsApp chats or prepare replies; check saved Instagram reels; choose an AI model; or find the file, transfer, voice, watch and laptop controls. Saves and sends keep their own reviews. Laptop input and Windows unlock keep phone fingerprint approval.';
      if (stopped) return { cancelled: true, text: '' };
      onText(text);
      return { text, provider: 'jarvis-actions', action: card };
    })();
    return { done, cancel: async () => { stopped = true; } };
  }
  return { run, catalog: () => ACTION_CATALOG.map(({ id, title, detail }) => ({ id, title, detail })) };
}
