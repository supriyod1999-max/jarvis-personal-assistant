import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../integrations/OpenWA');
const children = [
  // Resume previously authenticated sessions; upstream respects explicit stops.
  spawn(process.execPath, ['dist/main.js'], { cwd: root, windowsHide: true, stdio: 'inherit', env: { ...process.env, AUTO_START_SESSIONS: 'true' } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', '2886', '--strictPort'], { cwd: resolve(root, 'dashboard'), windowsHide: true, stdio: 'inherit' }),
];
let stopped = false;
function stop() { if (stopped) return; stopped = true; for (const child of children) child.kill(); }
for (const child of children) { child.on('error', stop); child.on('exit', stop); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
