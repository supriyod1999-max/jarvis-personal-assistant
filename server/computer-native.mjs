import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const execute = promisify(execFile);
const executable = fileURLToPath(new URL('../output/windows-signin/build/Release/jarvis-computer.exe', import.meta.url));
export function createComputerNative() {
  const call = async args => {
    if (process.platform !== 'win32' || !existsSync(executable)) throw new Error('The Windows computer helper is not installed.');
    try { const { stdout } = await execute(executable, args, { windowsHide: true, timeout: 5000, maxBuffer: 4096 }); return JSON.parse(stdout); }
    catch { throw new Error('The active Windows session could not be verified.'); }
  };
  return { available: () => process.platform === 'win32' && existsSync(executable), status: () => call(['status']),
    lock: ({ sessionId, accountSid }) => {
      if (!Number.isSafeInteger(sessionId) || sessionId < 1 || !/^S-1-5-(?:\d+-){1,14}\d+$/.test(accountSid)) throw new Error('Invalid Windows session.');
      return call(['lock', String(sessionId), accountSid]);
    } };
}
