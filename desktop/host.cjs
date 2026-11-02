const { spawn } = require('node:child_process');
const path = require('node:path');

function createHost({ root, origin = 'http://127.0.0.1:4317', request = fetch, launch = spawn, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  let busy = '', issue = '';
  async function read(route) {
    const response = await request(origin + route, { signal: AbortSignal.timeout(2500) });
    if (!response.ok) throw new Error('Unavailable');
    return response.json();
  }
  async function status() {
    try {
      const health = await read('/api/health');
      if (health.version !== '0.1.0' || health.ok !== true) throw new Error('Unexpected server');
      const runtime = await read('/api/runtime').catch(() => ({ output: 'unavailable', input: 'unavailable' }));
      return { running: true, busy, issue, output: runtime.output, input: runtime.input };
    } catch { return { running: false, busy, issue, input: 'off', output: 'off' }; }
  }
  function script(name) {
    return new Promise((done, reject) => {
      const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', name + '.ps1')];
      if (name === 'start') args.push('-NoBrowser');
      const child = launch('powershell.exe', args, { cwd: root, windowsHide: true, shell: false, stdio: 'ignore' });
      child.once('error', () => reject(new Error('Windows could not run the JARVIS launcher.')));
      child.once('exit', code => code === 0 ? done() : reject(new Error('The JARVIS launcher needs attention. Check the server logs.')));
    });
  }
  async function waitFor(running) {
    for (let n = 0; n < 60; n++) {
      if ((await status()).running === running) return;
      await sleep(500);
    }
    throw new Error(running ? 'JARVIS did not start. Check the server logs.' : 'JARVIS has not stopped. A manually started server must be closed in its own terminal.');
  }
  async function action(value) {
    if (!['start', 'restart', 'stop'].includes(value)) throw new Error('Unknown server control.');
    if (busy) throw new Error('A server control is already running.');
    busy = value; issue = '';
    try {
      if (value !== 'start') { await script('stop'); await waitFor(false); await sleep(1500); }
      if (value !== 'stop') { await script('start'); await waitFor(true); }
    } catch (e) { issue = e.message; throw e; }
    finally { busy = ''; }
    return status();
  }
  return { status, action };
}
module.exports = { createHost };
