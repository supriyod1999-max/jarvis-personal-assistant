import { ArrowUpRight, Smartphone } from 'lucide-react';
import { verifiedAction } from '../shared/action-catalog.mjs';

export default function ActionCard({ value, turnId, current, onOpen }: { value: unknown; turnId: string; current: boolean; onOpen: () => void }) {
  const action = verifiedAction(value, turnId);
  if (!action) return null;
  const android = navigator.userAgent.includes('JARVISNativeTransfers/1');
  const href = android && action.nativeHref ? action.nativeHref : action.href;
  return <aside className="command-source command-action" aria-label="JARVIS action review">
    <strong>{action.title}</strong><p>{action.detail}</p>
    <div className="reply-actions"><a className="command-subtle" href={current ? href : undefined} aria-disabled={!current} tabIndex={current ? 0 : -1}
      onClick={event => { if (!current) { event.preventDefault(); return; } onOpen(); }}>
      {action.requiresPhone ? <Smartphone size={15} /> : <ArrowUpRight size={15} />}{android && action.nativeHref ? 'Continue on this phone' : action.requiresPhone ? 'Open setup and phone instructions' : 'Open '+action.title.toLowerCase()}
    </a></div>
    {!current && <small>This request is no longer current. Ask again to prepare a fresh action.</small>}
  </aside>;
}
