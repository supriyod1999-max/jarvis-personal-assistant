// Pure state transitions shared by the browser and the recovery tests.
export function overlaySnapshot(state, remote) {
  const records = new Map(remote.records.map(r => [r.id, r]));
  for (const operation of state.outbox) records.set(operation.record.id, operation.record);
  for (const conflict of state.conflicts) records.set(conflict.id, conflict.local);
  return { ...state, ...remote, records: [...records.values()] };
}

export function acknowledge(state, operationId, record) {
  const outbox = state.outbox.filter(o => o.operationId !== operationId);
  const later = outbox.filter(o => o.record.id === record.id).at(-1);
  const records = state.records.filter(r => r.id !== record.id);
  records.push(later?.record ?? record);
  return { ...state, outbox, records };
}

export function recordConflict(state, id, remote) {
  const local = state.outbox.filter(o => o.record.id === id).at(-1)?.record;
  if (!local) return state;
  return {
    ...state,
    outbox: state.outbox.filter(o => o.record.id !== id),
    conflicts: [...state.conflicts.filter(c => c.id !== id), { id, local, remote }],
  };
}
