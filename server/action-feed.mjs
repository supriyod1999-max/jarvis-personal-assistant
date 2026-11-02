// A projection of existing receipts, never a second execution queue.
export function actionFeed(snapshot) {
  const items = [];
  const add = (source, id, title, state, detail, href, updatedAt = null) => items.push({ id: `${source}:${id}`, source, title, state, detail, href, updatedAt });
  for (const turn of snapshot.requests || []) {
    const state = ({running:'running',complete:'completed',error:'failed',interrupted:'interrupted',cancelled:'cancelled'})[turn.status] || 'unknown';
    add('conversation', turn.id, turn.title, state,
      ({running:'JARVIS is preparing a reply.',completed:'Reply finished. Open the conversation to see its result and any action review.',failed:'The reply failed. Review the conversation before trying again.',interrupted:'The computer restarted before the reply finished. Nothing was replayed.',cancelled:'Reply stopped.'})[state] || 'Current progress is unavailable.',
      `?conversation=${encodeURIComponent(turn.conversationId)}#/command`, turn.updatedAt);
  }
  for (const review of snapshot.reviews || []) add('review', review.id, review.title, 'needs_review', 'A proposed memory is waiting for your review. Opening it does not approve it.', ({task:'#/tasks',note:'#/knowledge',person:'#/people',project:'#/projects',inbox:'#/inbox'})[review.kind] || '#/command');
  for (const transfer of snapshot.transfers || []) {
    const state = transfer.state === 'complete' ? 'completed' : transfer.state === 'cancelled' ? 'cancelled' : 'waiting';
    add('transfer', transfer.id, transfer.name, state, state === 'completed' ? 'Upload committed to the laptop.' : state === 'cancelled' ? 'Upload cancelled.' : 'Saved upload progress. Resume from the sending device.', '#/files');
  }
  for (const session of snapshot.coding?.sessions || []) {
    const observed = session.status || session.state;
    const state = session.stale ? 'unknown' : ({working:'running',running:'running',waiting:'waiting',attention:'needs_attention',complete:'completed',completed:'completed',interrupted:'interrupted',idle:'waiting'})[observed] || 'unknown';
    add('coding', session.id, session.title, state, session.stale ? 'Last observation is stale. Current execution is not confirmed.' : 'Observed coding activity. Inspect the agent app for authoritative progress and approvals.', '#/agent-town');
  }
  const routes = new Set(['#/settings','#/settings/assistant','#/settings/connections','#/whatsapp']);
  for (const service of snapshot.connections?.services || []) if (!['ready','idle'].includes(service.state)) add('connection', service.id, service.name, 'needs_attention', service.detail, routes.has(service.href) ? service.href : '#/settings');
  const order = ['needs_review','failed','interrupted','needs_attention','running','waiting','unknown','completed','cancelled'];
  return items.sort((a,b) => order.indexOf(a.state)-order.indexOf(b.state) || String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))).slice(0,150);
}
