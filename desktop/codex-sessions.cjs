const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const LIMIT = 262144, MAX_SESSIONS = 16;

// Display strings only. Never execute or forward transcript text to an agent.
function displayText(value, limit = 500) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .replace(/Bearer\s+[A-Za-z0-9._~+/-]{12,}/gi, 'Bearer [redacted]')
    .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, '[redacted]')
    .replace(/\b(api[_-]?key|password|access_token|refresh_token|secret)\s*[:=]\s*["']?[^\s"',;]{6,}/gi, '$1=[redacted]')
    .replace(/\s+/g, ' ').trim().slice(0, limit);
}
async function readTail(file, maximum = LIMIT) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Not a regular session file');
  const handle = await fs.open(file, 'r');
  try {
    const size = Math.min(stat.size, maximum), start = stat.size - size, data = Buffer.alloc(size);
    const { bytesRead } = await handle.read(data, 0, size, start);
    const lines = data.subarray(0, bytesRead).toString('utf8').split('\n');
    if (start) lines.shift(); // Ignore an incomplete first record.
    const records = [];
    for (const line of lines) { try { const value = JSON.parse(line); if (value && typeof value === 'object') records.push(value); } catch {} }
    return { stat, records };
  } finally { await handle.close(); }
}
function dateFolders(id, updatedAt) {
  const dates = new Set();
  const version7 = id[14] === '7' ? Number.parseInt(id.replaceAll('-', '').slice(0, 12), 16) : NaN;
  for (const timestamp of [version7, Date.parse(updatedAt)]) {
    if (!Number.isFinite(timestamp) || timestamp < Date.UTC(2000, 0, 1) || timestamp > Date.now() + 86400000) continue;
    // Rollout folder dates can use the host's local timezone, unlike UUID time.
    for (let offset = -2; offset <= 2; offset++) dates.add(new Date(timestamp + offset * 86400000).toISOString().slice(0, 10).replaceAll('-', path.sep));
  }
  return [...dates];
}
function textContent(content) {
  if (typeof content === 'string') return content;
  return Array.isArray(content) ? content.filter(part => ['output_text', 'text'].includes(part?.type)).map(part => part.text || '').join(' ') : '';
}
function parseActivity(records, now) {
  const value = { status: 'recent', preview: '', question: '', project: '', observedAt: 0, pendingQuestion: false };
  let questionCall = '', questionKind = '';
  for (const record of records) {
    const payload = record.payload;
    if (!payload || typeof payload !== 'object') continue;
    const time = Date.parse(record.timestamp);
    // Never surface reasoning, encrypted content, execution arguments or tool output.
    if (record.type === 'session_meta' || record.type === 'turn_context') {
      if (typeof payload.cwd === 'string') value.project = displayText(path.win32.basename(path.basename(payload.cwd)), 80);
    }
    if (record.type === 'event_msg') {
      if (payload.type === 'task_started') { value.status = 'working'; value.pendingQuestion = false; }
      if (payload.type === 'task_complete') { value.status = 'complete'; value.pendingQuestion = false; value.preview = displayText(payload.last_agent_message) || value.preview; }
      if (['turn_aborted', 'task_interrupted', 'task_aborted'].includes(payload.type)) { value.status = 'interrupted'; value.pendingQuestion = false; }
      if (payload.type === 'user_message' || (payload.type === 'item_completed' && payload.item?.type === 'UserMessage')) value.pendingQuestion = false;
      if (payload.type === 'agent_message') value.preview = displayText(payload.message) || value.preview;
      if (payload.type === 'item_completed' && payload.item?.type === 'AgentMessage' && payload.item.phase !== 'analysis') value.preview = displayText(textContent(payload.item.content)) || value.preview;
      if (['task_started', 'task_complete', 'turn_aborted', 'task_interrupted', 'task_aborted', 'agent_message', 'item_completed'].includes(payload.type) && Number.isFinite(time)) value.observedAt = Math.max(value.observedAt, time);
    }
    if (record.type === 'response_item') {
      if (payload.type === 'message' && payload.role === 'user') value.pendingQuestion = false;
      if (payload.type === 'message' && payload.role === 'assistant' && payload.phase !== 'analysis') {
        value.preview = displayText(textContent(payload.content)) || value.preview;
        if (Number.isFinite(time)) value.observedAt = Math.max(value.observedAt, time);
      }
      if (payload.type === 'function_call' && ['request_user_input', 'request_user_input_async'].includes(payload.name)) {
        value.pendingQuestion = true;
        questionCall = payload.call_id || ''; questionKind = payload.name;
        try {
          const args = typeof payload.arguments === 'string' && payload.arguments.length <= 16000 ? JSON.parse(payload.arguments) : null;
          value.question = displayText(args?.questions?.map(question => question?.question || question?.title || '').join(' '), 320);
        } catch { value.question = ''; }
        if (Number.isFinite(time)) value.observedAt = Math.max(value.observedAt, time);
      }
      if (payload.type === 'function_call_output' && questionKind === 'request_user_input' && questionCall && payload.call_id === questionCall) value.pendingQuestion = false;
    }
  }
  const stale = !value.observedAt || now - value.observedAt > 120000;
  if (!value.pendingQuestion) value.question = '';
  if (value.pendingQuestion && value.status !== 'complete') value.status = stale ? 'quiet' : 'attention';
  else if (value.status === 'working' && stale) value.status = 'quiet';
  return { ...value, stale };
}

function createCodexSessions({ home = process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), now = Date.now } = {}) {
  const root = path.resolve(home), sessionsRoot = path.join(root, 'sessions');
  let cache = new Map(), paths = new Map(), latest = new Map(), lastScan = 0, scanning, generation = 0;
  async function scan() {
    const moment = now();
    if (scanning) return scanning;
    const epoch = generation;
    scanning = (async () => {
      try {
        const index = await readTail(path.join(root, 'session_index.jsonl'));
        const entries = new Map();
        for (const row of index.records) if (UUID.test(row.id) && typeof row.thread_name === 'string' && Number.isFinite(Date.parse(row.updated_at))) entries.set(row.id.toLowerCase(), row);
        // Names/index timestamps may be old for a long-lived active chat. Inspect
        // bounded file metadata first, then read only the newest session tails.
        const candidates = [...entries.values()].sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at)).slice(0, 256);
        const directories = new Map(), next = new Map(), nextCache = new Map(), discovered = [], nextPaths = new Map();
        for (const entry of candidates) {
          if (epoch !== generation) break;
          const id = entry.id.toLowerCase(); let found = paths.get(id);
          for (const folder of found ? [] : dateFolders(id, entry.updated_at)) {
            if (!directories.has(folder)) directories.set(folder, fs.readdir(path.join(sessionsRoot, folder), { withFileTypes: true }).catch(() => []));
            const files = await directories.get(folder);
            const match = files.find(file => file.isFile() && !file.isSymbolicLink() && file.name.startsWith('rollout-') && file.name.endsWith('-' + id + '.jsonl'));
            if (match) { found = path.join(sessionsRoot, folder, match.name); break; }
          }
          if (!found) continue;
          try {
            const real = await fs.realpath(found);
            if (!real.startsWith(sessionsRoot + path.sep)) continue;
            const stat = await fs.stat(real);
            if (!stat.isFile()) continue;
            nextPaths.set(id, real); discovered.push({ id, entry, real, stat });
          } catch { /* Archived/deleted sessions are not retained in the view. */ }
        }
        for (const { id, entry, real, stat } of discovered.sort((a, b) => b.stat.mtimeMs - a.stat.mtimeMs).slice(0, MAX_SESSIONS)) {
          if (epoch !== generation) break;
          try {
            const old = cache.get(id);
            const same = old?.mtime === stat.mtimeMs && old?.size === stat.size;
            const activity = same ? { ...old.activity } : parseActivity((await readTail(real)).records, moment);
            activity.stale = !activity.observedAt || moment - activity.observedAt > 120000;
            if (activity.stale && ['working', 'attention'].includes(activity.status)) activity.status = 'quiet';
            nextCache.set(id, { mtime: stat.mtimeMs, size: stat.size, activity });
            next.set(id, { id, title: displayText(entry.thread_name, 110) || 'Codex session', project: activity.project,
              status: activity.status, stale: activity.stale, preview: activity.preview, question: activity.question,
              updatedAt: new Date(activity.observedAt || Date.parse(entry.updated_at)).toISOString() });
          } catch { /* An active writer or archived file can disappear between reads. */ }
        }
        if (epoch !== generation) return { available: false, sessions: [], message: 'Monitoring paused.' };
        cache = nextCache; paths = nextPaths; latest = next; lastScan = moment;
        return { available: true, sessions: [...latest.values()], message: latest.size ? '' : 'No recent saved Codex sessions found.' };
      } catch {
        if (epoch === generation) { cache.clear(); paths.clear(); latest.clear(); }
        return { available: false, sessions: [], message: 'Codex session history is unavailable on this computer.' };
      }
    })().finally(() => { scanning = undefined; });
    return scanning;
  }
  return {
    scan,
    async openable(id) { if (!UUID.test(id)) return false; if (now() - lastScan > 5000) await scan(); return latest.has(id.toLowerCase()); },
    clear() { generation++; cache.clear(); paths.clear(); latest.clear(); lastScan = 0; },
  };
}
module.exports = { createCodexSessions, parseActivity, displayText };
