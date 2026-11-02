export const KINDS = ['inbox', 'task', 'note', 'project', 'person'];
export const STATUSES = ['open', 'waiting', 'done', 'archived'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function validDate(value) {
  if (value === '') return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export function validateRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid item.');
  if (!UUID.test(value.id)) throw new Error('Invalid item identifier.');
  if (!KINDS.includes(value.kind)) throw new Error('Choose a valid item type.');
  if (typeof value.title !== 'string' || !value.title.trim() || value.title.length > 200) {
    throw new Error('Add a title of up to 200 characters.');
  }
  if (typeof value.body !== 'string' || value.body.length > 50000) throw new Error('Notes must be under 50,000 characters.');
  if (!STATUSES.includes(value.status)) throw new Error('Invalid item status.');
  if (!['normal', 'high'].includes(value.priority)) throw new Error('Invalid priority.');
  if (!validDate(value.dueDate) || !validDate(value.birthday)) throw new Error('Choose a valid date.');
  if (!Array.isArray(value.tags) || value.tags.length > 12 || value.tags.some(t => typeof t !== 'string' || !t.trim() || t.length > 40)) {
    throw new Error('Use up to 12 tags, each under 40 characters.');
  }
  for (const key of ['projectId', 'personId']) {
    if (value[key] !== '' && (typeof value[key] !== 'string' || !UUID.test(value[key]))) throw new Error('Invalid linked item.');
  }
  if (typeof value.sourceUrl !== 'string' || value.sourceUrl.length > 2048) throw new Error('Invalid source link.');
  if (value.sourceUrl) {
    let url;
    try { url = new URL(value.sourceUrl); } catch { throw new Error('Use a full http or https source link.'); }
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Source links must begin with http or https.');
  }
  if (typeof value.deleted !== 'boolean') throw new Error('Invalid item state.');
  if (value.recall !== undefined && typeof value.recall !== 'boolean') throw new Error('Choose whether to recall this memory.');
  if (value.relationship !== undefined && (typeof value.relationship !== 'string' || value.relationship.length > 100)) throw new Error('Keep the relationship under 100 characters.');
  if (value.whatsappName !== undefined && (typeof value.whatsappName !== 'string' || value.whatsappName.length > 200)) throw new Error('Keep the WhatsApp contact name under 200 characters.');
  if (value.aliases !== undefined && (!Array.isArray(value.aliases) || value.aliases.length > 20 || value.aliases.some(a => typeof a !== 'string' || !a.trim() || a.length > 100))) throw new Error('Use up to 20 names or aliases, each under 100 characters.');
  return {
    id: value.id, kind: value.kind, title: value.title.trim(), body: value.body,
    status: value.status, priority: value.priority, dueDate: value.dueDate, birthday: value.birthday,
    tags: [...new Set(value.tags.map(t => t.trim()))], projectId: value.projectId,
    personId: value.personId, sourceUrl: value.sourceUrl, deleted: value.deleted,
    // Optional fields preserve legacy mutation receipts and old backup formats.
    ...(value.recall !== undefined ? { recall: value.recall } : {}),
    ...(value.relationship !== undefined ? { relationship: value.relationship.trim() } : {}),
    ...(value.whatsappName !== undefined ? { whatsappName: value.whatsappName.trim() } : {}),
    ...(value.aliases !== undefined ? { aliases: [...new Set(value.aliases.map(a => a.trim()))] } : {}),
  };
}

export function parseBackup(value) {
  if (!value || value.format !== 'second-brain' || value.version !== 1 || !Array.isArray(value.records)) {
    throw new Error('This is not a supported JARVIS backup.');
  }
  if (value.records.length > 10000) throw new Error('Import up to 10,000 items at a time.');
  const records = value.records.map(validateRecord).filter(r => !r.deleted);
  if (new Set(records.map(r => r.id)).size !== records.length) throw new Error('The backup contains duplicate identifiers.');
  return records;
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
