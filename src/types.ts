export type Kind = 'inbox' | 'task' | 'note' | 'project' | 'person';
export type ItemStatus = 'open' | 'waiting' | 'done' | 'archived';
export interface Entry {
  id: string; kind: Kind; title: string; body: string; status: ItemStatus;
  priority: 'normal' | 'high'; dueDate: string; birthday: string; tags: string[];
  projectId: string; personId: string; sourceUrl: string; deleted: boolean;
  rev: number; createdAt: string; updatedAt: string;
  recall?: boolean; relationship?: string; aliases?: string[]; whatsappName?: string;
}
export interface Mutation { operationId: string; baseRev: number; record: Entry }
export interface Conflict { id: string; local: Entry; remote: Entry | null }
export interface LocalState {
  records: Entry[]; outbox: Mutation[]; conflicts: Conflict[]; serverId: string | null;
  lastSynced: string | null; backupAt: string | null; backupError: string | null;
}
export interface Snapshot { serverId: string; records: Entry[]; backupAt: string | null; backupError: string | null }
export type Connection = 'connecting' | 'online' | 'offline' | 'error' | 'changed';
