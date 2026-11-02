import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const MODEL = 'gpt-5.6-luna';
export const PROVIDER = 'openai-codex';
export const CHAT_ARGS = ['chat', '--provider', PROVIDER, '--model', MODEL, '--safe-mode', '--toolsets', 'none', '--oneshot', '--max-turns', '1', '--run-budget', '120', '--source', 'tool', '--format', 'stream-json', '--query-file', '-'];
export const chatArgs = ({ voice = false, reasoning } = {}) => {
  if (reasoning !== undefined && !['none', 'low', 'high'].includes(reasoning)) throw new Error('Unsupported thinking effort.');
  const effort = reasoning || (voice ? 'low' : undefined);
  return effort ? [...CHAT_ARGS, '--reasoning', effort] : CHAT_ARGS;
};

export function parseHermesLine(line) {
  // Installed Hermes emits this known harmless diagnostic on stdout before JSONL init.
  // Its explicit unknown toolset resolves to an empty tool allowlist, not the default bundle.
  if (!line.trim() || line.trim() === 'Warning: Unknown toolsets: none') return null;
  return JSON.parse(line);
}

function environment() {
  // Never inherit an orchestrator's task, routing, approval, or model overrides.
  const names = new Set(['path', 'systemroot', 'windir', 'comspec', 'userprofile', 'localappdata', 'appdata', 'temp', 'tmp', 'home', 'homedrive', 'homepath', 'pathext', 'programdata']);
  return { ...Object.fromEntries(Object.entries(process.env).filter(([key]) => names.has(key.toLowerCase()))), PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8' };
}

function safeError(value) {
  if (/rate.limit|quota|usage.limit|429/i.test(value)) return 'Your ChatGPT usage limit was reached. Try again after it resets.';
  if (/auth|credential|401|403|logged out|sign.in/i.test(value)) return 'Hermes needs attention. Check your ChatGPT sign-in in Hermes, then try again.';
  if (/model.*(not found|unsupported|unavailable|access)|model_not_found/i.test(value)) return 'GPT-5.6 Luna is unavailable for this connection. No other model was used.';
  return 'Hermes could not finish this reply. Your message is saved; you can try again.';
}

export function createHermes({ executable = process.env.BRAIN_HERMES_EXECUTABLE || join(process.env.LOCALAPPDATA || '', 'hermes', 'bin', 'hermes.exe'), cwd = resolve('data'), onTiming = () => {} } = {}) {
  let cache; let checking;
  function launch(args) { return spawn(executable, args, { cwd, shell: false, windowsHide: true, env: environment(), stdio: ['pipe', 'pipe', 'pipe'] }); }
  async function status() {
    if (cache && Date.now() - cache.checked < 30000) return cache.value;
    if (checking) return checking;
    checking = new Promise(resolveStatus => {
      const finish = (state, message) => {
        const value = { state, message, model: MODEL, provider: PROVIDER };
        cache = { checked: Date.now(), value }; resolveStatus(value);
      };
      if (!existsSync(executable)) return finish('unavailable', 'Hermes is not available on this computer.');
      const child = launch(['auth', 'status', PROVIDER]); let output = ''; let timedOut = false;
      const timer = setTimeout(() => { timedOut = true; void stopProcess(child); }, 10000);
      child.stdin.end(); child.stdin.on('error', () => {});
      child.stdout.on('data', chunk => { output = (output + chunk).slice(-8000); });
      child.stderr.resume();
      child.on('error', () => { clearTimeout(timer); finish('unavailable', 'Hermes could not be started.'); });
      child.on('close', code => {
        clearTimeout(timer);
        if (!timedOut && code === 0 && /openai-codex:\s*logged in\b/.test(output)) finish('ready', 'ChatGPT sign-in is ready.');
        else finish('unavailable', 'Check your ChatGPT sign-in in Hermes, then try again.');
      });
    }).finally(() => { checking = null; });
    return checking;
  }
  function run(prompt, onText, options) {
    let child; let cancelled = false; let failure = ''; let result; let buffer = ''; let stderr = ''; let text = ''; let timer;
    const started = performance.now(), timings = {};
    const mark = name => {
      if (timings[name] === undefined) {
        timings[name] = Math.round(performance.now() - started);
        try { onTiming({ ...timings }); } catch { /* Diagnostics cannot break a reply. */ }
      }
    };
    const done = new Promise((resolveRun, rejectRun) => {
      if (!existsSync(executable)) return rejectRun(new Error('Hermes is not available on this computer.'));
      child = launch(chatArgs(options));
      const fail = message => { failure ||= message; void stopProcess(child); };
      timer = setTimeout(() => fail('Hermes took too long to reply. Your message is saved; try again.'), 150000);
      child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
      child.stdin.on('error', () => {});
      child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
      function event(line) {
        if (!line.trim()) return;
        let value;
        try { value = parseHermesLine(line); } catch { return fail('Hermes returned an unreadable response. Check the installed Hermes version.'); }
        if (!value) return;
        if (value.type === 'system') mark('initMs');
        if (value.type === 'system' && value.model !== MODEL) return fail('Hermes selected an unexpected model. This reply was stopped.');
        if (value.type === 'tool_use' || value.type === 'tool_result') return fail('Hermes attempted an unavailable action. This reply was stopped.');
        if (value.type === 'text' && typeof value.text === 'string') {
          if (value.text.trim()) mark('firstTextMs');
          text += value.text;
          if (text.length > 64000) return fail('This reply exceeded the length limit. Ask for a shorter answer.');
          if (!cancelled && !failure) onText(text);
        }
        if (value.type === 'result') { result = value; mark('resultMs'); }
      }
      child.stdout.on('data', chunk => {
        buffer += chunk;
        if (buffer.length > 1000000) return fail('Hermes returned an oversized response.');
        let end;
        while ((end = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, end); buffer = buffer.slice(end + 1); event(line); }
      });
      child.on('error', () => { clearTimeout(timer); rejectRun(new Error('Hermes could not be started on this computer.')); });
      child.on('close', code => {
        clearTimeout(timer); if (buffer.trim()) event(buffer);
        mark('closedMs');
        if (cancelled) return resolveRun({ cancelled: true, text });
        if (failure) return rejectRun(new Error(failure));
        if (code !== 0 || !result || result.exit_code !== 0 || result.error) return rejectRun(new Error(safeError(`${stderr} ${result?.error || ''}`)));
        if (typeof result.text !== 'string' || !result.text.trim() || result.text.length > 64000) return rejectRun(new Error('Hermes returned no usable reply. Your message is saved; try again.'));
        resolveRun({ text: result.text, sessionId: typeof result.session_id === 'string' ? result.session_id : '', timings });
      });
      child.stdin.end(prompt, 'utf8');
    });
    return { done, cancel: async () => { cancelled = true; if (child) await stopProcess(child); } };
  }
  return { status, run };
}

async function stopProcess(child) {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') {
    // Kill this one launcher and its Python child, never unrelated Hermes sessions.
    await new Promise(resolveStop => {
      const killer = spawn(join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe'), ['/PID', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, stdio: 'ignore' });
      killer.on('error', resolveStop); killer.on('close', resolveStop);
    });
  } else child.kill('SIGKILL');
}
