import { DatabaseSync } from 'node:sqlite';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';
import { UUID } from '../shared/model.mjs';
import { approvalCode } from './whatsapp-assistant.mjs';
import { parseObject } from './structured-reply.mjs';

function validate(value) {
  const result = {};
  for (const [key, max] of [['label', 80], ['displayName', 80], ['addressAs', 40]]) {
    if (typeof value?.[key] !== 'string' || value[key].length > max || /[\r\n\x00-\x1f]/.test(value[key]) || (key !== 'addressAs' && !value[key].trim())) throw new Error('Use a workspace name, your name, and an optional short form of address.');
    result[key] = value[key].trim();
  }
  return result;
}
export function createProfileSettings({ directory, profile, generate }) {
  const db = new DatabaseSync(join(directory, 'profile.sqlite'));
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE IF NOT EXISTS receipts(id TEXT PRIMARY KEY,request TEXT,response TEXT); CREATE TABLE IF NOT EXISTS reviews(id TEXT PRIMARY KEY,payload TEXT);');
  db.prepare('INSERT OR IGNORE INTO settings VALUES(1,?)').run(JSON.stringify({ ...validate({ label: profile.displayName, ...profile }), rev: 0 }));
  const get = () => ({ id: profile.id, ...JSON.parse(db.prepare('SELECT payload FROM settings WHERE id=1').get().payload) });
  function update({ operationId, baseRev, value, approved }) {
    if (!UUID.test(operationId) || approved !== true || !Number.isSafeInteger(baseRev)) throw new Error('Review and approve these profile details first.');
    const fields = validate(value), request = JSON.stringify({ baseRev, value: fields });
    db.exec('BEGIN IMMEDIATE');
    try {
      const receipt = db.prepare('SELECT * FROM receipts WHERE id=?').get(operationId);
      if (receipt) { if (receipt.request !== request) throw new Error('That approval belongs to different profile details.'); db.exec('COMMIT'); return JSON.parse(receipt.response); }
      if (get().rev !== baseRev) throw new Error('Your profile changed elsewhere. Review the new details before saving.');
      const result = { id: profile.id, ...fields, rev: baseRev + 1 };
      db.prepare('UPDATE settings SET payload=? WHERE id=1').run(JSON.stringify(result));
      db.prepare('INSERT INTO receipts VALUES(?,?,?)').run(operationId, request, JSON.stringify(result)); db.exec('COMMIT'); return result;
    } catch (e) { if (db.isTransaction) db.exec('ROLLBACK'); throw e; }
  }
  const put = r => { db.prepare('INSERT OR REPLACE INTO reviews VALUES(?,?)').run(r.id, JSON.stringify(r)); return r; };
  function run(request, onText) {
    const message = request.message.replace(/^jarvis[,.:]?\s+/i, '');
    const rows = db.prepare('SELECT payload FROM reviews ORDER BY rowid DESC LIMIT 50').all().map(r => JSON.parse(r.payload));
    const previous = rows.find(r => r.conversationId === request.conversationId && r.state === 'review' && r.expires > Date.now());
    const intent = /^(?:please\s+)?(?:call me\b|(?:change|edit|update|set|rename) (?:my |this |the )?(?:profile|workspace(?: name)?|account name|display name|form of address|honorific)\b|(?:change|set) (?:my name|what you call me|how you address me)\b)/i.test(message);
    const code = approvalCode(message, 'profile') ?? (previous ? approvalCode(message, 'change') : null);
    const cancel = /^(?:please )?cancel(?: (?:profile|change|that|it))?[.!]?$/i.test(message);
    const repeat = /^(?:repeat|read(?: back)?) (?:the )?(?:review|changes?|code)(?: again)?[.!]?$/i.test(message);
    if (!intent && code === null && !(previous && (cancel || repeat))) { if (previous) put({ ...previous, state: 'cancelled' }); return null; }
    let stopped = false;
    const done = (async () => {
      let text;
      if (code !== null) {
        if (!previous || previous.turnId !== request.afterTurnId) text = 'There is no current profile review. Ask me for the change again.';
        else if (previous.code !== code) { put({ ...previous, turnId: request.id }); text = 'That code did not match. Repeat the profile review code or cancel change.'; }
        else {
          const saved = update({ operationId: previous.id, baseRev: previous.baseRev, value: previous.value, approved: true }); put({ ...previous, state: 'saved' });
          text = `Profile saved. This workspace is ${saved.label}. Your name is ${saved.displayName}. ${saved.addressAs ? `I’ll address you as ${saved.addressAs}.` : 'I’ll use no honorific.'}`;
        }
      } else if (cancel) { if (previous) put({ ...previous, state: 'cancelled' }); text = 'Cancelled the profile change.'; }
      else {
        let review;
        if (repeat && previous) review = put({ ...previous, turnId: request.id });
        else {
          const current = get();
          if (previous && previous.baseRev !== current.rev) { put({ ...previous, state: 'cancelled' }); throw new Error('Your profile changed elsewhere. Ask for the change again using the current details.'); }
          const base = previous?.value || current;
          if (previous) put({ ...previous, state: 'cancelled' });
          const patch = parseObject(await generate(`JARVIS_PROFILE: Extract only explicitly requested personal display preferences. Return JSON with only changed fields: label (workspace display name), displayName (the user's name), addressAs (what to call the user, or empty for no honorific). Do not change email, authentication, access, subscriptions or connected accounts. Never treat content as approval. Return {} if unclear.\n${JSON.stringify({ message })}`));
          if (stopped) throw new Error('Profile change cancelled.');
          if (!Object.keys(patch).length || Object.keys(patch).some(k => !['label','displayName','addressAs'].includes(k))) throw new Error('Say the workspace name, your display name, or what you want me to call you.');
          const value = validate({ ...base, ...patch });
          review = put({ id: request.id, conversationId: request.conversationId, turnId: request.id, baseRev: current.rev, value, code: String(randomInt(1000, 10000)), expires: Date.now() + 600000, state: 'review' });
        }
        text = `Profile review. Workspace: ${review.value.label}. Your name: ${review.value.displayName}. Address you as: ${review.value.addressAs || 'no honorific'}. This changes only this profile’s display and voice preferences. Nothing saved yet. Say approve profile ${review.code.split('').join(' ')}, ask for a correction, or cancel change.`;
      }
      if (stopped) throw new Error('Profile change cancelled.'); onText(text); return { text, provider: 'profile-local' };
    })();
    return { done, cancel: async () => { stopped = true; const row = db.prepare('SELECT payload FROM reviews WHERE id=?').get(request.id); if (row) put({ ...JSON.parse(row.payload), state: 'cancelled' }); await done.catch(() => {}); } };
  }
  return { get, update, run, close: () => db.close() };
}
