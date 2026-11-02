// Fixed local mailbox: no credentials, arbitrary API access, send or scope inputs.
import { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { UUID } from '../shared/model.mjs';
export function monitorSummary(result) {
  return { enabled: result.settings.enabled, scope: result.settings.scope, skipped: result.skipped, report: result.report, newAlerts: result.report?.newAlerts ? result.alerts.filter(a => a.createdAt >= result.report.startedAt).map(({ id, accountName, chatName, sender, summary, reminder, dueText }) => ({ id, accountName, chatName, sender, summary, reminder, dueText })) : [] };
}
export function createMonitorMailbox({ directory, monitor, now = Date.now, interval = 500 }) {
  const input = join(directory, 'monitor-request.json'), output = join(directory, 'monitor-response.json');
  let busy = false, closed = false, current;
  async function poll() {
    if (closed || busy || !existsSync(input)) return;
    let request;
    try {
      if (statSync(input).size > 1024) { unlinkSync(input); return; }
      request = JSON.parse(readFileSync(input, 'utf8')); unlinkSync(input);
      if (!UUID.test(request.id) || !Number.isSafeInteger(request.at) || request.at > now() + 5000 || now() - request.at > 180000) return;
    } catch { return; }
    busy = true;
    try {
      let result;
      try { result = monitorSummary(await monitor.run()); }
      catch { result = { unavailable: true, message: 'The saved WhatsApp check could not finish. Review its connection in JARVIS.' }; }
      const temp = output + '.tmp'; writeFileSync(temp, JSON.stringify({ id: request.id, result })); renameSync(temp, output);
    } finally { busy = false; }
  }
  const timer = setInterval(() => { if (!busy) current = poll().catch(() => {}); }, interval); timer.unref();
  return { poll, close: async () => { closed = true; clearInterval(timer); await current; } };
}
