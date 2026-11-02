import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

export const wire = JSON.parse(readFileSync(new URL('../shared/evergreen-wire.schema.json', import.meta.url)));
export const DOMAINS = wire.$defs.domain.enum;
export const ACTIONS = wire.$defs.actionType.enum;
export const actionDomain = type => ({ task: 'tasks', schedule: 'planner', purchase: 'expenses', repayment: 'repayments', loan: 'loans', investment: 'investments', recipe: 'recipes', meal: 'meals', habit: 'habits', run: 'running', memory: 'memories' })[type.split('.')[0]] || type.split('.')[0];
export const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v => JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k => [k, JSON.parse(canonical(value[k]))])) : value);
export const hash = value => createHash('sha256').update(typeof value === 'string' ? value : canonical(value)).digest('hex');
export const integrationError = (code, status = 400) => Object.assign(new Error(({
  context_changed: 'Your Evergreen conversation context changed. Review again in the selected workspace; no private response was carried across.',
  release_held: 'Evergreen live access is disabled pending its security migration and deployment.',
  privacy_required: 'Review your Evergreen data-processing and chat-history choices in Settings before using voice or chat commands.',
  connection_error: 'Evergreen could not complete the connection. Original requests are kept; nothing was automatically retried.',
  owner_only: 'Evergreen is available only in Owner’s primary workspace.',
  disconnected: 'Connect your verified Evergreen account first.',
  denied: 'Evergreen access was denied. Its local cache has been cleared. Reconnect in Evergreen Settings.',
  security_hold: 'Evergreen is temporarily unavailable or on a security hold. Writes are suspended; your draft is kept.',
  privacy_review_required: 'Evergreen needs a fresh ownership review. Keep this original request; do not create a replacement while access is held.',
  native_privacy_release_required: 'Evergreen’s private workspace release is not ready. Access remains on hold.',
  private_rollout_scopes: 'This Evergreen rollout permits only reviewed personal tasks and standalone planner entries. Broader modules remain on hold.',
  private_record_denied: 'That Evergreen record is not approved for this connection. The local connection cache was cleared; review access in Evergreen Settings.',
  permissions_changed: 'Evergreen’s ownership review or permissions changed. The local connection cache was cleared. New signed-in consent and pairing are required.',
  conflict: 'Evergreen changed after the review. Read the current record and prepare a new review.',
  expired: 'That review expired. Prepare and confirm a new review.',
  unsupported: 'This action is unavailable in personal mode or is an Evergreen-only workflow.',
  rate_limited: 'Evergreen asked us to wait. Try again later; nothing was retried.',
  capacity: 'Evergreen sync needs an operator-managed checkpoint. No changes have been discarded.',
  protocol: 'Evergreen returned an unexpected response. Access is suspended for review.',
  uncertain: 'The response was interrupted. Recover this original request; do not create a replacement.',
  confirmation: 'Review the current Evergreen proposal and explicitly confirm that exact review.',
  scope: 'This Evergreen module needs an explicit read/write scope approved in Evergreen Settings.',
  busy: 'Finish recovering the previous Evergreen change before preparing another one.',
})[code] || 'The Evergreen request is invalid.'), { code, status });

// Implements only the JSON-schema vocabulary used by the supplied v1 wire schema.
// Native domain/business validation stays in Evergreen; this never authorises a write.
export function matches(schema, value) {
  if (schema.$ref) return matches(wire.$defs[schema.$ref.split('/').at(-1)], value);
  if (schema.anyOf && !schema.anyOf.some(s => matches(s, value))) return false;
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (Object.hasOwn(schema, 'const') && schema.const !== value) return false;
  const types = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  const typed = t => t === 'null' ? value === null : t === 'array' ? Array.isArray(value) : t === 'object' ? value !== null && typeof value === 'object' && !Array.isArray(value) : t === 'integer' ? Number.isSafeInteger(value) : typeof value === t;
  if (types.length && !types.some(typed)) return false;
  if (typeof value === 'string') {
    if (value.length < (schema.minLength || 0) || value.length > (schema.maxLength ?? Infinity) || (schema.pattern && !new RegExp(schema.pattern).test(value))) return false;
    if (schema.format === 'date-time' && !Number.isFinite(Date.parse(value))) return false;
    if (schema.format === 'date' && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || new Date(value).toISOString().slice(0, 10) !== value)) return false;
  }
  if (typeof value === 'number' && (!Number.isFinite(value) || value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) return false;
  if (Array.isArray(value)) {
    if (value.length < (schema.minItems || 0) || value.length > (schema.maxItems ?? Infinity)) return false;
    if (schema.uniqueItems && new Set(value.map(canonical)).size !== value.length) return false;
    if (schema.items && !value.every(v => matches(schema.items, v))) return false;
  } else if (value && typeof value === 'object') {
    if ((schema.required || []).some(k => !Object.hasOwn(value, k))) return false;
    if (Object.keys(value).some(k => ['__proto__', 'prototype', 'constructor'].includes(k))) return false;
    if (schema.additionalProperties === false && Object.keys(value).some(k => !Object.hasOwn(schema.properties || {}, k))) return false;
    if (Object.entries(schema.properties || {}).some(([k, s]) => Object.hasOwn(value, k) && !matches(s, value[k]))) return false;
  }
  return true;
}
export function validate(name, value) { if (!matches(wire.$defs[name], value)) throw integrationError('protocol'); return value; }

const matrix = readFileSync(new URL('../shared/evergreen-CAPABILITY-MATRIX.md', import.meta.url), 'utf8');
export const CAPABILITIES = DOMAINS.map((domain, i) => {
  const row = matrix.split('\n').filter(l => l.startsWith('| ') && !l.startsWith('| ---')).slice(1, 22)[i]?.split('|');
  return { domain, operations: ACTIONS.filter(a => actionDomain(a) === domain && a !== 'repayment.record'),
    read: domain !== 'photos', gap: domain === 'repayments' ? 'Personal mode cannot record between-member repayments. Recording is never a bank transfer.' : (row?.[4]?.trim() || 'Consult Evergreen’s capability matrix.') };
});


