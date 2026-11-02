import { useEffect, useState } from 'react';

export default function AppUpdate() {
  const [waiting, setWaiting] = useState<ServiceWorker | null>(null);
  const [review, setReview] = useState(false);
  const [applying, setApplying] = useState(false);
  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    let alive = true;
    const inspect = async () => {
      try {
        const registration = await navigator.serviceWorker.getRegistration();
        if (alive) setWaiting(registration?.waiting ?? null);
      } catch { /* Offline support is optional; leave the current app usable. */ }
    };
    void inspect();
    const timer = setInterval(() => void inspect(), 10000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  useEffect(() => {
    if (!applying) return;
    const ready = () => location.reload();
    navigator.serviceWorker.addEventListener('controllerchange', ready);
    waiting?.postMessage({ type: 'JARVIS_ACTIVATE_UPDATE' });
    return () => navigator.serviceWorker.removeEventListener('controllerchange', ready);
  }, [applying, waiting]);
  if (!waiting) return null;
  return <aside className="app-update" aria-label="Application update">
    {review ? <><span>Save any unfinished edits first. This reloads this window; saved records and pairing stay intact.</span><button disabled={applying} onClick={() => setApplying(true)}>{applying ? 'Updating…' : 'Update and reload'}</button><button disabled={applying} onClick={() => setReview(false)}>Later</button></> : <button onClick={() => setReview(true)}>New JARVIS version available ↗</button>}
  </aside>;
}
