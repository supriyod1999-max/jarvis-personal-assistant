export const normalName = value => String(value || '').normalize('NFKC').toLowerCase().replace(/['’]s\b/g, '').replace(/[\uFE0E\uFE0F]/g, '').replace(/[^\p{L}\p{N}@\p{Extended_Pictographic}]+/gu, ' ').trim().replace(/\s+/g, ' ');
export const recallable = record => record.recall === true && !record.deleted && record.status !== 'archived';
export function personNames(record) {
  return [...new Set([record.title, ...(record.aliases || []), record.whatsappName, record.relationship, record.relationship && `my ${record.relationship}`].filter(Boolean).map(normalName))];
}
const containsPhrase = (text, name) => !!name && ` ${text} `.includes(` ${name} `);
const stop = new Set('a an the this that these those my me i you your we us our and or to of in on for with is are was were be been it its tell about what who when where how why do does did can could would should please remember recall know information have has had from at as by any all some she her he him his they them their'.split(' '));
const tokens = value => new Set(normalName(value).split(' ').filter(t => t.length > 1 && !stop.has(t)).map(t => t.length > 4 ? t.replace(/s$/, '') : t));
export function recallMemories(records, message, history = [], limit = 6) {
  const candidates = records.filter(recallable), query = normalName(message);
  const prior = /\b(she|her|he|him|his|they|them|their|that person)\b/i.test(message) ? history.filter(t => t.status === 'complete').slice(-2).map(t => t.message).join(' ') : '';
  const personQuery = normalName(`${message} ${prior}`);
  const people = candidates.filter(r => r.kind === 'person' && personNames(r).some(n => containsPhrase(personQuery, n)));
  const personIds = new Set(people.map(r => r.id));
  const q = tokens(message);
  const broad = /\b(what|which|list|show)\b.*\b(remember|memories|saved facts)\b/i.test(message) && q.size <= 3;
  return candidates.map(record => {
    const title = tokens([record.title, ...(record.aliases || []), record.relationship || '', ...record.tags].join(' '));
    const body = tokens(record.body);
    let score = personIds.has(record.id) ? 100 : personIds.has(record.personId) ? 40 : 0;
    for (const word of q) score += title.has(word) ? 6 : body.has(word) ? 1 : 0;
    if (broad) score += 1;
    return { record, score };
  }).filter(row => row.score > 0).sort((a, b) => b.score - a.score || (b.record.updatedAt || '').localeCompare(a.record.updatedAt || '')).slice(0, limit).map(row => row.record);
}
export function resolveContact(records, query, chats) {
  const name = normalName(query);
  if (!name) return { matches: [], people: [] };
  const live = records.filter(r => r.kind === 'person' && recallable(r));
  const people = live.filter(r => personNames(r).includes(name));
  if (people.length > 1) return { matches: [], people, ambiguousPeople: true };
  // An explicitly reviewed contact name wins over a different chat with the real name.
  // No fuzzy fallback when that mapping is missing or renamed; ask the owner instead.
  if (people[0]?.whatsappName) {
    const contactName = normalName(people[0].whatsappName);
    return { matches: chats.filter(c => normalName(c.name) === contactName), people };
  }
  const variants = new Set([name, ...(people[0] ? personNames(people[0]) : [])]);
  const exact = chats.filter(c => variants.has(normalName(c.name)) || normalName(c.id) === name);
  const matches = exact.length ? exact : chats.filter(c => normalName(c.name).includes(name) || (/^\d{7,}$/.test(name) && c.id.split('@')[0].endsWith(name)));
  return { matches, people };
}
