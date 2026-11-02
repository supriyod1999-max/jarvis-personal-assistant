import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, join, sep } from 'node:path';
import { spawn } from 'node:child_process';
const root = resolve('.test-data'); mkdirSync(root, { recursive: true });
const directory = mkdtempSync(join(root, 'browser-'));
const child = spawn(process.execPath, ['tests/fixtures/server.mjs'], { env: { ...process.env, PORT: process.env.BRAIN_TEST_PORT || '14320', BRAIN_DATA_DIR: directory }, stdio: 'inherit' });
process.on('SIGINT', () => child.kill()); process.on('SIGTERM', () => child.kill());
child.on('exit', code => {
  if (!resolve(directory).startsWith(root + sep)) throw new Error('Unsafe test cleanup');
  rmSync(directory, { recursive: true, force: true }); process.exit(code || 0);
});
