import type { Entry } from './types';

export type CommandContext = { label: string; message: string; recordIds: string[] };

// Resolve the exact visible records; the server independently checks their revisions.
export function resolveCommandSources(records: Entry[], ids: string[], pending: ReadonlySet<string>) {
  const unique = [...new Set(ids)];
  if (unique.length > 6) throw new Error('Choose up to six items, including the attached context.');
  return unique.map(id => {
    const record = records.find(item => item.id === id && !item.deleted && item.status !== 'archived');
    if (!record) throw new Error('An attached item is no longer available. Remove the context or choose the item again.');
    if (pending.has(id) || record.rev < 1) throw new Error('Sync the attached items before sharing them with ChatGPT.');
    return { id: record.id, rev: record.rev };
  });
}
