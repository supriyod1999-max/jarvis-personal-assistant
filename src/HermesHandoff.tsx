import { useRef, useState } from 'react';
import { Copy, Monitor, X } from 'lucide-react';

export default function HermesHandoff({ draft, disabled }: { draft: string; disabled: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [task, setTask] = useState(''), [feedback, setFeedback] = useState('');
  return <><button type="button" className="command-subtle" disabled={disabled || !draft.trim()} onClick={() => { setTask(draft); setFeedback(''); dialog.current?.showModal(); }}><Monitor size={14} />Computer task</button>
    <dialog ref={dialog} className="command-history-dialog hermes-handoff" aria-labelledby="hermes-heading"><div className="history-heading"><h2 id="hermes-heading">Hand off to Hermes</h2><button className="icon-button" aria-label="Close Hermes handoff" onClick={() => dialog.current?.close()}><X size={20} /></button></div>
      <p>Use Hermes when a task needs your computer, browser, or project files. Review the request, then paste it into your Hermes app on this PC.</p>
      <label>Task for Hermes<textarea aria-label="Task for Hermes" value={task} onChange={event => { setTask(event.target.value); setFeedback(''); }} maxLength={8000} /></label>
      <p>Only this request is copied. Your conversation and saved memories stay here. Hermes has its own approval controls; this handoff does not start a task.</p>
      <button className="secondary-button" disabled={!task.trim()} onClick={async () => {
        try {
          await navigator.clipboard.writeText(`Task from JARVIS:\n${task.trim()}\n\nBoundaries: Ask before sending messages, publishing posts, or destructive changes. Do not change credentials or startup configuration. Report what actually completed and anything still pending.`);
          setFeedback('Copied. Paste into Hermes on your computer.');
        } catch { setFeedback('Clipboard unavailable. Select the task text and copy it manually.'); }
      }}><Copy size={15} />Copy task for Hermes</button><p aria-live="polite">{feedback}</p>
    </dialog></>;
}
