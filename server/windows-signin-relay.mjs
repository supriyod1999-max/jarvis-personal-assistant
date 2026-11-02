// Unprivileged transport of PUBLIC challenges and signatures. This process never
// opens the native credential vault or creates a Windows unlock approval itself.
import { open, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { windowsApprovalPayload } from './windows-signin-approval.mjs';
export function createWindowsSigninRelay({ directory = join(process.env.ProgramData || 'C:\\ProgramData', 'JARVIS-WindowsSignin'), now = Date.now } = {}) {
  async function challenge({ deviceId, computerId, accountSid, sessionId }) {
    const file = await open(join(directory, 'challenge.txt'), 'r'); let raw;
    try { const bytes = Buffer.alloc(1501); const { bytesRead } = await file.read(bytes, 0, bytes.length, 0); if (bytesRead > 1500) throw new Error('Native Windows challenge is invalid.'); raw = bytes.subarray(0, bytesRead).toString('utf8'); } finally { await file.close(); }
    const fields = raw.split('\n');
    const value = { operation: fields[1], deviceId: fields[2], computerId: fields[3], accountSid: fields[4], sessionId: Number(fields[5]), bootId: fields[6], requestId: fields[7], nonce: fields[8], expiresAtMs: Number(fields[9]) };
    if (fields.length !== 10 || fields[0] !== 'JARVIS_WINDOWS_SIGNIN_V1' || windowsApprovalPayload(value) !== raw || value.operation !== 'windows.unlock'
      || value.deviceId !== deviceId || value.computerId !== computerId || value.accountSid !== accountSid || value.sessionId !== sessionId
      || value.expiresAtMs <= now() || value.expiresAtMs - now() > 30000) throw new Error('Native Windows challenge is unavailable or expired.');
    return { requestId: value.requestId, payload: raw, expiresAtMs: value.expiresAtMs };
  }
  async function submit(value, expected) {
    const current = await challenge(expected);
    if (current.payload !== value.payload || current.requestId !== value.requestId || !/^[A-Za-z0-9+/]{342}==$/.test(value.signature)) throw new Error('Windows approval changed. Make a new request.');
    await writeFile(join(directory, 'responses', current.requestId + '.sig'), value.signature, { encoding: 'ascii', flag: 'wx', mode: 0o600 });
    return { initiated: true, locked: true, message: 'Approval delivered to Windows. Refresh status to confirm unlock; this approval will not be resent.' };
  }
  return { challenge, submit };
}
