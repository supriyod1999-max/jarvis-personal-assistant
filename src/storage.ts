import type { Entry, Kind, LocalState, Snapshot, Connection } from './types';
import { validateRecord, parseBackup } from '../shared/model.mjs';
import { acknowledge, overlaySnapshot, recordConflict } from '../shared/sync-state.mjs';

const empty = (): LocalState => ({ records: [], outbox: [], conflicts: [], serverId: null, lastSynced: null, backupAt: null, backupError: null });
let dbPromise: Promise<IDBDatabase> | undefined;
const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('second-brain') : null;
const listeners = new Set<() => void>();
channel?.addEventListener('message', () => listeners.forEach(fn => fn()));
export function subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; }
function notify() { listeners.forEach(fn => fn()); channel?.postMessage('changed'); }
function database() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open('second-brain-v1', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('state');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(new Error('Device storage is unavailable. Please allow site storage and try again.'));
  });
  return dbPromise;
}
export async function readState(): Promise<LocalState> {
  const db = await database();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('state', 'readonly'); const req = tx.objectStore('state').get('current');
    req.onsuccess = () => resolve(req.result ?? empty()); req.onerror = () => reject(req.error);
  });
}
async function writeState(state: LocalState) {
  const db = await database();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('state', 'readwrite', { durability: 'strict' });
    tx.objectStore('state').put(state, 'current');
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(new Error('Could not save on this device. Your changes are still in the form.'));
    tx.onabort = () => reject(new Error('Device storage is full or unavailable. Export a backup before clearing anything.'));
  });
  notify();
}
// Web Locks serialises mutations across tabs as well as across the sync worker and editor.
async function locked<T>(fn: () => Promise<T>): Promise<T> {
  if (!navigator.locks) throw new Error('This browser needs a secure connection with Web Locks support. Use a current Chrome, Edge, or Firefox.');
  return navigator.locks.request('second-brain-store', fn);
}
export function newEntry(kind: Kind = 'inbox'): Entry {
  const now = new Date().toISOString();
  return { id: crypto.randomUUID(), kind, title: '', body: '', status: 'open', priority: 'normal', dueDate: '', birthday: '', tags: [], projectId: '', personId: '', sourceUrl: '', deleted: false, rev: 0, createdAt: now, updatedAt: now };
}

export async function saveEntry(input: Entry, expectedRev?: number) {
  validateRecord(input);
  await locked(async () => {
    const state = await readState();
    if (state.conflicts.some(c => c.id === input.id)) throw new Error('Review the two versions in Settings before editing this item.');
    const current = state.records.find(r => r.id === input.id);
    if (expectedRev !== undefined && (current?.rev ?? 0) !== expectedRev) throw new Error('This item changed while you were editing. Close and reopen it to see the latest version; your draft remains here.');
    const baseRev = current?.rev ?? 0;
    const record: Entry = { ...input, title: input.title.trim(), rev: baseRev + 1, updatedAt: new Date().toISOString() };
    state.records = [...state.records.filter(r => r.id !== record.id), record];
    state.outbox.push({ operationId: crypto.randomUUID(), baseRev, record });
    await writeState(state);
  });
}

export async function resolveConflict(id: string, useLocal: boolean) {
  await locked(async () => {
    const state = await readState(); const conflict = state.conflicts.find(c => c.id === id);
    if (!conflict) return;
    state.conflicts = state.conflicts.filter(c => c.id !== id);
    state.records = state.records.filter(r => r.id !== id);
    if (useLocal) {
      const baseRev = conflict.remote?.rev ?? 0;
      const record = { ...conflict.local, rev: baseRev + 1, updatedAt: new Date().toISOString() };
      state.records.push(record);
      state.outbox.push({ operationId: crypto.randomUUID(), baseRev, record });
    } else if (conflict.remote) state.records.push(conflict.remote);
    await writeState(state);
  });
}

export async function importCopies(value: unknown) {
  const parsed = parseBackup(value) as Entry[];
  const mapping = new Map(parsed.map(r => [r.id, crypto.randomUUID()]));
  await locked(async () => {
    const state = await readState(); const now = new Date().toISOString();
    for (const source of parsed) {
      const record: Entry = { ...source, id: mapping.get(source.id)!, projectId: mapping.get(source.projectId) ?? '', personId: mapping.get(source.personId) ?? '', rev: 1, createdAt: now, updatedAt: now };
      state.records.push(record); state.outbox.push({ operationId: crypto.randomUUID(), baseRev: 0, record });
    }
    await writeState(state);
  });
  return parsed.length;
}

export function exportSnapshot(state: LocalState) {
  return { format: 'second-brain', version: 1, exportedAt: new Date().toISOString(), records: state.records.filter(r => !r.deleted) };
}

let syncing = false;
let syncAgain = false;
export async function sync(setConnection: (connection: Connection, message?: string) => void) {
  // A reconnect can arrive while an older offline request is still failing.
  // Remember that request instead of dropping it until the next periodic retry.
  if (syncing) { syncAgain = true; return; }
  syncing = true;
  try {
    await locked(async () => {
      let state = await readState();
      const response = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (response.status === 401 || response.status === 403) { setConnection('error', 'Access denied. Connect Tailscale with the same account as your computer, then sync again. Your saved items stay on this device.'); return; }
      if (!response.ok) throw new Error('Your computer could not open the memory store.');
      const snapshot: Snapshot = await response.json();
      if (state.serverId && state.serverId !== snapshot.serverId) {
        setConnection('changed', 'A different memory store is running. Export this device’s items before reconnecting.'); return;
      }
      state = overlaySnapshot(state, snapshot) as LocalState;
      // Persist the host identity before sending. A restarted host with a new database must never
      // silently receive changes intended for the old database.
      await writeState(state);
      for (const operation of [...state.outbox]) {
        if (!state.outbox.some(o => o.operationId === operation.operationId)) continue;
        const result = await fetch('/api/mutations', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Second-Brain': '1' },
          body: JSON.stringify({ ...operation, serverId: state.serverId }), signal: AbortSignal.timeout(8000),
        });
        const payload = await result.json();
        if (result.status === 409) state = recordConflict(state, operation.record.id, payload.current) as LocalState;
        else if (!result.ok) { setConnection('error', payload.error ?? 'A change needs attention. Your local copy is safe.'); return; }
        else state = acknowledge(state, operation.operationId, payload.record) as LocalState;
        // Save every acknowledgement. If the process dies before this commit the same operation ID
        // is replayed, and the server returns its original receipt without applying it twice.
        await writeState(state);
      }
      const latest = await fetch('/api/state', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
      if (!latest.ok) throw new Error('Could not confirm the latest saved state.');
      const confirmed: Snapshot = await latest.json();
      if (confirmed.serverId !== state.serverId) {
        setConnection('changed', 'A different memory store is running. Export this device’s items before reconnecting.'); return;
      }
      state = overlaySnapshot(state, confirmed) as LocalState;
      state.lastSynced = new Date().toISOString();
      await writeState(state);
      setConnection('online');
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    setConnection(message.includes('storage') || message.includes('Web Locks') ? 'error' : 'offline', message);
  } finally {
    syncing = false;
    if (syncAgain) { syncAgain = false; void sync(setConnection); }
  }
}
