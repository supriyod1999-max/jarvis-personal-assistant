const { spawn } = require('node:child_process');
const path = require('node:path');

// One bounded native observer; emits only a boolean, never app titles or paths.
module.exports.watchFullscreen = ({ root, changed, launch = spawn, platform = process.platform }) => {
  if (platform !== 'win32') return { close() {} };
  const proc = launch(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(root, 'scripts', 'watch-fullscreen.ps1'), '-IgnoreProcessId', String(process.pid)],
    { windowsHide: true, shell: false, stdio: ['ignore', 'pipe', 'ignore'] });
  let pending = '', stopped = false;
  proc.stdout.on('data', bytes => {
    pending += bytes.toString('utf8');
    if (pending.length > 4096) { proc.kill(); return; }
    let end;
    while ((end = pending.indexOf('\n')) >= 0) {
      const line = pending.slice(0, end).trim(); pending = pending.slice(end + 1);
      if (!stopped && /^(true|false)$/.test(line)) changed(line === 'true');
    }
  });
  // A failed detector hides the overlay until it can be checked again.
  proc.on('error', () => { if (!stopped) changed(true); });
  proc.on('exit', () => { if (!stopped) changed(true); });
  return { close() { stopped = true; proc.kill(); } };
};
