import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

const DEFAULT_SNAPSHOT = resolve(process.env.JARVIS_AGENT_TOWN_SNAPSHOT || 'data/agent-town/snapshot.json');
const HARD_LIMIT = 2 * 1024 * 1024;
const statuses = ['working', 'waiting', 'idle', 'completed', 'unknown'];
const activities = ['coding', 'research', 'testing', 'review', 'planning', 'rest'];
const eventKinds = ['message', 'delegation', 'handoff', 'review', 'waiting', 'completed', 'activity', 'claim'];
const invalid = () => { throw new Error('invalid_snapshot'); };

// Defensive display filtering in addition to the companion's own export filter.
// No source transcript, execution argument or credential field is whitelisted.
function display(value) {
  return value
    .replace(/```[\s\S]*?```/g, '[code omitted]')
    .replace(/\b(?:sk-|ghp_|github_pat_|AIza)[A-Za-z0-9_-]{12,}/g, '[credential removed]')
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+/gi, 'Bearer [removed]')
    .replace(/((?:password|secret|api[_ -]?key|(?:access|refresh)[_ -]?token|authorization|x-vercel-protection-bypass|AGENT_TOWN_BRIDGE_KEY|BLOB_READ_WRITE_TOKEN)\s*[:=]\s*)["']?[^\s"',;]+/gi, '$1[removed]')
    .replace(/([?&](?:token|key|secret|auth|signature)=)[^&#\s]+/gi, '$1[removed]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email removed]')
    .replace(/\[[^\]]*\]\((?:[A-Za-z]:[\\/]|file:\/\/|\/)[^)]*\)/g, '[local file]')
    .replace(/`(?:[A-Za-z]:[\\/]|\\\\|\/)[^`]*`/g, '[local file]')
    .replace(/\b[A-Za-z]:[\\/][^\r\n`<>"|;]+/g, '[local path]')
    .replace(/\\\\[^\s`<>"|;]+/g, '[local path]')
    .replace(/(?<![:/\w])\/[A-Za-z0-9_.-]+(?:\/[^\s`<>"|;]*)?/g, '[local path]')
    .replace(/[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim();
}
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value;
}
function text(value, maximum = 600) {
  if (typeof value !== 'string' || value.length > maximum) invalid();
  return display(value).slice(0, maximum);
}
function identity(value) {
  if (typeof value !== 'string' || !value || value.length > 100 || display(value) !== value) invalid();
  return value;
}
function choice(value, allowed) {
  if (!allowed.includes(value)) invalid();
  return value;
}
function timestamp(value) {
  if (typeof value !== 'string' || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) invalid();
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 19) !== value.slice(0, 19)) invalid();
  return value;
}
function list(value, maximum, read) {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value.map(read);
}
function optional(target, source, key, read) {
  if (source[key] !== undefined) target[key] = read(source[key]);
}
function project(value) {
  const p = object(value);
  return { id: identity(p.id), name: text(p.name, 100) };
}
function observation(value) {
  const o = object(value);
  const result = {
    source: text(o.source, 100), observedAt: timestamp(o.observedAt),
    confidence: choice(o.confidence, ['observed', 'inferred', 'stale', 'unavailable']), detail: text(o.detail),
  };
  optional(result, o, 'summaryAt', timestamp);
  optional(result, o, 'tool', value => text(value, 100));
  optional(result, o, 'toolAt', timestamp);
  return result;
}
function work(value) {
  const w = object(value);
  return { id: identity(w.id), at: timestamp(w.at), kind: choice(w.kind, ['update', 'tool', 'result']), label: text(w.label, 100), detail: text(w.detail) };
}
function agent(value) {
  const a = object(value);
  if (!Number.isInteger(a.color) || a.color < 0 || a.color > 7) invalid();
  const result = {
    id: identity(a.id), name: text(a.name, 100), platform: choice(a.platform, ['codex', 'antigravity']),
    project: text(a.project, 100), status: choice(a.status, statuses), activity: choice(a.activity, activities),
    task: text(a.task), summary: text(a.summary), updatedAt: timestamp(a.updatedAt), evidence: text(a.evidence), color: a.color,
  };
  optional(result, a, 'projectId', identity);
  optional(result, a, 'projects', value => list(value, 20, project));
  optional(result, a, 'taskTitle', value => text(value));
  optional(result, a, 'parentId', identity);
  optional(result, a, 'observation', observation);
  optional(result, a, 'recentWork', value => list(value, 8, work));
  return result;
}
function event(value) {
  const e = object(value);
  const result = { id: identity(e.id), at: timestamp(e.at), kind: choice(e.kind, eventKinds), from: identity(e.from), title: text(e.title), detail: text(e.detail), evidence: text(e.evidence) };
  optional(result, e, 'to', identity);
  optional(result, e, 'taskId', value => value === '' ? '' : identity(value));
  return result;
}
function task(value) {
  const t = object(value);
  return { id: identity(t.id), title: text(t.title), status: text(t.status, 100), owner: text(t.owner, 100), dependsOn: list(t.dependsOn, 50, identity), handoff: text(t.handoff), updatedAt: text(t.updatedAt, 50) };
}
function source(value) {
  const s = object(value);
  return { name: text(s.name, 100), status: choice(s.status, ['connected', 'unavailable']), detail: text(s.detail) };
}
function snapshot(value) {
  const s = object(value);
  if (s.version !== 1 || s.mode !== 'live') invalid();
  const result = { version: 1, mode: 'live', collectedAt: timestamp(s.collectedAt), agents: list(s.agents, 3000, agent), events: list(s.events, 200, event), tasks: list(s.tasks, 500, task), sources: list(s.sources, 10, source) };
  optional(result, s, 'projects', value => list(value, 3000, project));
  return result;
}

async function gate(isAuthorized, isMonitoringEnabled) {
  try { if (typeof isAuthorized !== 'function' || await isAuthorized() !== true) return 'locked'; }
  catch { return 'locked'; }
  try { if (typeof isMonitoringEnabled !== 'function' || await isMonitoringEnabled() !== true) return 'paused'; }
  catch { return 'paused'; }
  return null;
}
function unavailable(reason) {
  const messages = {
    locked: 'Unlock the primary JARVIS workspace to view Agent Town.',
    paused: 'Coding monitoring is paused. Resume it in the Windows island.',
    missing: 'Agent Town has not supplied a local snapshot yet.',
    invalid: 'The Agent Town snapshot is unavailable or invalid. No activity was shown.',
    oversized: 'The Agent Town snapshot exceeded the display limit. No activity was shown.',
  };
  return { enabled: reason !== 'locked' && reason !== 'paused', available: false, message: messages[reason] || messages.invalid, snapshot: null };
}

/**
 * Read-only display adapter. Construct once with a server-owned, fixed path;
 * never pass a path from an HTTP query or model output. No credentials, agent
 * commands, approval actions or process execution are available here.
 */
export function createAgentTownReader({ snapshotPath = DEFAULT_SNAPSHOT, maxBytes = HARD_LIMIT } = {}) {
  if (typeof snapshotPath !== 'string' || !isAbsolute(snapshotPath) || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > HARD_LIMIT) throw new Error('Invalid Agent Town reader configuration.');
  return {
    async snapshot({ isAuthorized, isMonitoringEnabled } = {}) {
      const before = await gate(isAuthorized, isMonitoringEnabled);
      if (before) return unavailable(before);
      let handle, result, problem;
      try {
        const entry = await lstat(snapshotPath);
        if (!entry.isFile() || entry.isSymbolicLink()) invalid();
        handle = await open(snapshotPath, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
        const start = await handle.stat();
        if (!start.isFile() || start.dev !== entry.dev || start.ino !== entry.ino) invalid();
        if (start.size > maxBytes) throw new Error('oversized_snapshot');
        // Bound the read itself, including a writer that grows the file after stat.
        const buffer = Buffer.alloc(maxBytes + 1);
        let length = 0;
        while (length < buffer.length) {
          const read = await handle.read(buffer, length, buffer.length - length, length);
          if (!read.bytesRead) break;
          length += read.bytesRead;
        }
        if (length > maxBytes) throw new Error('oversized_snapshot');
        const end = await handle.stat();
        if (start.size !== end.size || start.mtimeMs !== end.mtimeMs || end.size !== length) invalid();
        const decoded = new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, length));
        result = snapshot(JSON.parse(decoded.replace(/^\uFEFF/, '')));
      } catch (error) {
        problem = error.code === 'ENOENT' ? 'missing' : error.message === 'oversized_snapshot' ? 'oversized' : 'invalid';
      } finally {
        await handle?.close().catch(() => {});
      }
      // Locking or pausing during an in-flight read revokes the response as well.
      const after = await gate(isAuthorized, isMonitoringEnabled);
      if (after) return unavailable(after);
      if (problem) return unavailable(problem);
      return { enabled: true, available: true, message: '', snapshot: result };
    },
  };
}
