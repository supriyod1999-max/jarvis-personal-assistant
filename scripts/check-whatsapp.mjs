// Existing hourly heartbeat: no account credentials or PIN access.
// The local mailbox can only run the owner's saved monitoring scope.
import { randomUUID } from 'node:crypto';
import { writeFile, rename, readFile, unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base = fileURLToPath(new URL('../data/', import.meta.url));
try {
  const health = await fetch('http://127.0.0.1:4317/api/health', { signal: AbortSignal.timeout(3000) });
  if (!health.ok) throw new Error('unavailable');
  const id = randomUUID(), input = base + 'monitor-request.json', output = base + 'monitor-response.json';
  await writeFile(input + '.' + id + '.tmp', JSON.stringify({ id, at: Date.now() })); await rename(input + '.' + id + '.tmp', input);
  const start = Date.now(); let found;
  while (Date.now() - start < 180000) {
    try { const response = JSON.parse(await readFile(output, 'utf8')); if (response.id === id) { found = response.result; await unlink(output).catch(() => {}); break; } } catch {}
    await new Promise(done => setTimeout(done, 500));
  }
  if (!found) throw new Error('timeout');
  // Keep the heartbeat concise: repeated connection failures do not need every
  // contact name. The full per-chat report remains in the protected app store.
  if (Array.isArray(found.report?.problems)) {
    const problems = found.report.problems;
    const compact = [...new Set(problems.map(value => String(value).includes(' / ') ? String(value).split(' / ')[0] + ': some chats could not be checked; review the connection in JARVIS.' : String(value)))];
    found.report = { ...found.report, problems: compact.slice(0, 8), problemCount: problems.length };
  }
  console.log(JSON.stringify(found));
} catch (error) {
  console.log(JSON.stringify({ unavailable: true, message: error.message === 'timeout' ? 'The check is taking longer than expected. It will not send or retry messages.' : 'JARVIS is unavailable. Start the app and OpenWA on the laptop.' }));
  process.exitCode = 1;
}
