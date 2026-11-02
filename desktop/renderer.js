const bridge = window.jarvisDesktop;
let acting = false, controlError = '';
function render(state) {
  document.querySelector('#server').textContent = state.busy ? `${state.busy === 'stop' ? 'Stopping' : state.busy === 'restart' ? 'Restarting' : 'Starting'} server…` : state.running ? 'Server online' : 'Server stopped';
  document.querySelector('#voice').textContent = state.running ? state.input === 'ready' && state.output === 'ready' ? 'Voice ready' : ['error','unavailable'].includes(state.input) || ['error','unavailable'].includes(state.output) ? 'Voice needs attention' : 'Preparing voice…' : 'Voice off';
  document.querySelector('#headline').textContent = state.running ? 'Opening your assistant' : state.busy ? 'Preparing JARVIS' : 'JARVIS is resting';
  document.querySelector('#description').textContent = state.running ? 'Closing this window moves JARVIS into the island.' : 'Choose Start to bring your assistant online.';
  document.querySelector('#issue').textContent = state.issue || '';
  document.querySelector('#wake').textContent = state.wakeEnabled ? 'Wake on' : 'Wake off';
  document.querySelector('#wake').setAttribute('aria-pressed', String(!!state.wakeEnabled));
  document.querySelector('#wake').disabled = !state.running || !!state.busy;
  const presenceStatus = document.querySelector('#presence-status');
  presenceStatus.textContent = controlError || state.wakeIssue || (!state.running
    ? 'Start the server, unlock your workspace, then turn Wake on to use the floating assistant.'
    : state.fullscreenHidden && state.islandVisible === false
      ? 'Island hidden during fullscreen use. It returns when fullscreen ends; this does not change your microphone toggle.'
    : !state.wakeEnabled
      ? `${state.islandVisible ? 'Island ready · Microphone off' : 'Microphone off'} · Close this window for the island, or click Wake off to enable listening. Remembered permission does not start the microphone automatically.`
      : state.wakePhase === 'preparing'
        ? 'Preparing wake listening… The microphone stays active when you hide JARVIS to the tray.'
        : state.mode === 'island'
          ? 'Bezel notch is on · Hover to peek, say “Hey JARVIS” to talk. It shrinks after replies; “Go to sleep” ends the conversation.'
          : 'Say “Hey JARVIS” to show the floating orb · “Go to sleep” hides it again. Wake stays on when you hide JARVIS to the tray.');
  presenceStatus.title = presenceStatus.textContent;
  presenceStatus.dataset.issue = String(!!(controlError || state.wakeIssue));
  document.querySelector('#wake').disabled ||= acting;
  document.querySelector('#controls').disabled = acting;
  if (state.wakeIssue) document.querySelector('#voice').textContent = 'Wake needs attention — retry Wake';
  if (controlError) { document.querySelector('#voice').textContent = controlError; document.querySelector('#voice').title = controlError; }
  const picker = document.querySelector('#workspace');
  const options = state.workspaces || [];
  if (JSON.stringify(options) !== picker.dataset.options) { picker.replaceChildren(...options.map(item => { const option = document.createElement('option'); option.value = item.id; option.textContent = item.label; return option; })); picker.dataset.options = JSON.stringify(options); }
  picker.value = state.workspaceId || 'owner'; picker.disabled = acting || !!state.busy;
  document.querySelector('#server').dataset.online = String(!!state.running);
  document.querySelector('#wake').title = presenceStatus.textContent;
}
async function refresh() { try { render(await bridge.status()); } catch { document.querySelector('#issue').textContent = 'Desktop controls are unavailable. Reopen JARVIS.'; } }
document.getElementById('controls').addEventListener('click', async () => { try { await bridge.controls(); } catch (e) { controlError = e.message; } void refresh(); });
document.getElementById('hide').addEventListener('click', () => bridge.hide());
document.getElementById('wake').addEventListener('click', async () => { acting = true; controlError = ''; void refresh(); try { await bridge.wake(); } catch (e) { controlError = e.message.replace(/^Error invoking remote method '[^']+': Error: /, ''); } finally { acting = false; void refresh(); } });
document.getElementById('workspace').addEventListener('change', async event => { acting = true; try { await bridge.workspace(event.target.value); } catch (e) { document.querySelector('#issue').textContent = e.message; } finally { acting = false; void refresh(); } });
void refresh(); setInterval(refresh, 2000);
