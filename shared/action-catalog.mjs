// These descriptors are app-owned. A model selects an ID; it never supplies a URL,
// an approval, a credential, a shell command, or an executable device payload.
const definitions = [
  ['personal.review', 'Open JARVIS to review', '#/command', '/native/workspace', 'Open your JARVIS workspace to review personal records or actions. Nothing was changed from general voice mode.'],
  ['pet.open', 'JARVIS pet companion', '#/devices', '/native/pet', 'Open the native Android pet for animated eyes, optional local tracking and private visitor messages. Camera and microphone stay off until you choose them.'],
  ['camera.checkin', 'Camera check-ins', '#/devices', '', 'Choose an enrolled device with explicitly enabled camera sharing. One fresh image is requested; no camera is activated remotely.'],
  ['devices.list', 'My devices', '#/devices', '', 'See the devices enrolled in this workspace.'],
  ['files.browse', 'Browse laptop files', '#/files', '', 'Choose the drive and folder on your host laptop.'],
  ['files.download', 'Choose a file to download', '#/files', '', 'Select the exact file and destination. Downloads do not start from a guessed filename.'],
  ['files.upload', 'Choose an upload destination', '#/files', '', 'Open the destination folder, choose Upload, then select the phone file. Existing files are never silently overwritten.'],
  ['files.folder', 'Create a folder', '#/files', '', 'Choose its location and review the folder name in Files.'],
  ['transfers.list', 'File transfers', '#/files', '/native/transfers', 'Review progress or resume a saved transfer. Re-select the same source file if requested.'],
  ['computer.status', 'Laptop controls', '#/settings/devices', '/native/computer', 'Check pairing and Windows sign-in readiness.'],
  ['computer.lock', 'Review laptop lock', '#/settings/devices', '/native/computer?operation=windows.lock', 'Review Lock laptop on the paired phone and approve its fingerprint prompt. Windows has not been locked by this reply.'],
  ['computer.unlock', 'Review laptop unlock', '#/settings/devices', '/native/computer?operation=windows.unlock', 'Review Unlock laptop on the paired phone and approve its fingerprint prompt. Windows has not been unlocked by this reply.'],
  ['remote.open', 'Laptop mouse and keyboard', '#/files', '/native/control', 'Start remote control on the paired phone and approve the 15-minute biometric session.'],
  ['media.play-pause', 'Review laptop play / pause', '#/files', '/native/control?media=play-pause', 'Open laptop media controls on your phone. Review Play / pause before fingerprint approval.'],
  ['media.next', 'Review next laptop track', '#/files', '/native/control?media=next', 'Open laptop media controls on your phone. Review Next track before fingerprint approval.'],
  ['media.previous', 'Review previous laptop track', '#/files', '/native/control?media=previous', 'Open laptop media controls on your phone. Review Previous track before fingerprint approval.'],
  ['media.volume-up', 'Review laptop volume up', '#/files', '/native/control?media=volume-up', 'Open laptop media controls on your phone. Review Volume up before fingerprint approval.'],
  ['media.volume-down', 'Review laptop volume down', '#/files', '/native/control?media=volume-down', 'Open laptop media controls on your phone. Review Volume down before fingerprint approval.'],
  ['media.mute', 'Review laptop mute', '#/files', '/native/control?media=mute', 'Open laptop media controls on your phone. Review Mute before fingerprint approval.'],
  ['coding.list', 'Coding sessions', '#/devices', '/native/coding', 'View Codex progress on the phone or Windows island. Agent permissions remain in the coding tool.'],
  ['coding.approve', 'Review coding approval availability', '#/devices', '/native/coding', 'Live Codex approvals are not connected to JARVIS. Open Codex to review its exact request; JARVIS cannot approve it.'],
  ['voice.status', 'Voice service', '#/settings/assistant', '', 'Check the selected local voice engine without loading another model.'],
  ['voice.model', 'Review voice model change', '#/settings/assistant', '', 'Choose the engine in Voice & AI and use Apply & restart voice. No model was changed or preloaded by this request.'],
  ['voice.wake', 'Background voice', '#/settings/assistant', '/native/voice', 'Choose listening options on this device. Starting the microphone requires your explicit action and Android permission.'],
  ['voice.quiet', 'Quiet voice replies', '#/settings/assistant', '/native/voice', 'Review voice output and listening on this device. This reply does not change microphone permission.'],
  ['watch.open', 'Galaxy Watch companion', '#/devices', '/native/watch', 'Link the exact paired watch on your phone. Watch wake listening stays off until you explicitly start it.'],
  ['chat.models', 'Available AI models', '#/command', '', 'Choose a model available through your existing ChatGPT connection.'],
  ['chat.current-model', 'Current AI model', '#/command', '', 'Read the saved model selection.'],
  ['connections.status', 'Connection health', '#/settings/connections', '', 'Check the connection cards for current readiness.'],
  ['workspace.lock', 'Lock this JARVIS workspace', '#/settings/personal', '', 'Use Lock now in Personal settings. This is separate from locking Windows.'],
  ['workspace.switch', 'Switch JARVIS workspace', '#/settings/personal', '', 'Choose the workspace yourself and enter its PIN. Names do not establish identity.'],
  ['profile.open', 'Profile preferences', '#/settings/personal', '', 'Review your display name and form of address. This does not change sign-in identity.'],
  ['data.export', 'Export JARVIS data', '#/settings/data', '', 'Review the export options in Data & recovery. No file has been exported by this reply.'],
  ['data.import', 'Import or recover JARVIS data', '#/settings/data', '', 'Choose and review the backup in Data & recovery. No records were replaced by this reply.'],
  ['view.inbox', 'Inbox', '#/inbox', '', 'Open captured thoughts and items waiting for review.'],
  ['view.tasks', 'Tasks', '#/tasks', '', 'Open your task list.'],
  ['view.knowledge', 'Knowledge', '#/knowledge', '', 'Open your saved notes and knowledge.'],
  ['view.projects', 'Projects', '#/projects', '', 'Open your saved projects.'],
  ['view.people', 'People', '#/people', '', 'Open people, relationships and personal memory reviews.'],
  ['instagram.settings', 'Instagram connection', '#/settings/connections', '', 'Review sign-in, All Posts scanning and saved-reel understanding.'],
  ['whatsapp.settings', 'WhatsApp permissions and monitoring', '#/whatsapp', '', 'Choose the account and exact chat scope in WhatsApp. Natural language cannot silently expand permissions.'],
  ['evergreen.settings', 'Evergreen household connection', '#/settings/connections', '', 'Review the current household grant, release readiness and member consent.'],
  ['screen.inspect', 'Screen awareness', '#/devices', '', 'On-demand screen capture is not connected in this release. No screen was captured.'],
  ['screen.remote', 'Laptop screen control', '#/devices', '', 'Live laptop screen streaming is not connected. Mouse and keyboard control is available separately on the paired phone.'],
  ['google.open', 'Google account connection', '#/settings/connections', '', 'Google Drive, Gmail and Calendar are not connected inside JARVIS. A Google connection in the coding chat does not connect the JARVIS app.'],
  ['island.open', 'Windows island', '#/settings/assistant', '', 'Use the Windows JARVIS tray or native window controls to open island mode. A browser cannot change the native window.'],
  ['app.startup', 'Windows startup', '#/settings/devices', '', 'Review startup in the Windows JARVIS native controls. This request does not install a startup hook.'],
  ['app.updates', 'JARVIS app updates', '#/devices', '/native/updates', 'Check the private release channel in App updates. Automatic installation needs your one-time Android permission; the app verifies the APK and publisher signature.'],
  ['help.actions', 'What JARVIS can do', '#/command', '', 'Records, conversations, WhatsApp and Instagram workflows, local voice, device files, transfers and phone-reviewed laptop controls.'],
];
export const ACTION_CATALOG = Object.freeze(definitions.map(([id, title, href, nativeHref, detail]) => Object.freeze({ id, title, href, nativeHref, detail })));
const byId = new Map(ACTION_CATALOG.map(action => [action.id, action]));
export function actionDescriptor(id) { return byId.get(id) || null; }
export function actionCard(id, requestId) {
  const action = actionDescriptor(id);
  if (!action || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId || '')) throw new Error('Choose a supported action.');
  return { kind: 'jarvis-action', version: 1, id, requestId, title: action.title, href: action.href, ...(action.nativeHref ? { nativeHref: action.nativeHref } : {}), requiresPhone: !!action.nativeHref, detail: action.detail };
}
// Validate persisted/network data again at the client. Never render a model URL.
export function verifiedAction(value, requestId) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(requestId || '')) return null;
  if (!value || value.kind !== 'jarvis-action' || value.version !== 1 || value.requestId !== requestId) return null;
  const expected = actionDescriptor(value.id);
  if (!expected || value.href !== expected.href || (value.nativeHref || '') !== expected.nativeHref) return null;
  return actionCard(value.id, requestId);
}
