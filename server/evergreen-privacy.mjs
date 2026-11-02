import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
const initial = () => ({ version: 1, processWithAI: false, retainChat: false, agreedAt: null });
export function evergreenPrivacy(directory) {
  const file = join(directory, 'evergreen-privacy.json'); let policy = initial();
  if (existsSync(file)) {
    try { const p = JSON.parse(readFileSync(file, 'utf8')); if (p.version === 1 && typeof p.processWithAI === 'boolean' && typeof p.retainChat === 'boolean' && (!(p.processWithAI || p.retainChat) || Number.isFinite(Date.parse(p.agreedAt)))) policy = p; } catch { /* Damaged consent is never permission. */ }
  }
  return { get: () => ({ ...policy }), set: input => {
    if (!input || Object.keys(input).some(k => !['processWithAI', 'retainChat', 'confirm'].includes(k)) || input.confirm !== true || typeof input.processWithAI !== 'boolean' || typeof input.retainChat !== 'boolean') throw new Error('Review and confirm both Evergreen privacy choices.');
    const next = { version: 1, processWithAI: input.processWithAI, retainChat: input.retainChat, agreedAt: new Date().toISOString() };
    mkdirSync(directory, { recursive: true }); const temp = `${file}.${randomUUID()}.tmp`;
    try { writeFileSync(temp, JSON.stringify(next), { flag: 'wx', mode: 0o600 }); renameSync(temp, file); policy = next; } finally { if (existsSync(temp)) unlinkSync(temp); }
    return { ...policy };
  } };
}
