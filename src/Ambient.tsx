import { useEffect, useState } from 'react';

export default function Ambient() {
  const [paused, setPaused] = useState(document.hidden);
  useEffect(() => {
    const update = () => setPaused(document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className={`ambient ${paused ? 'paused' : ''}`} aria-hidden="true"><div className="ambient-cloud one" /><div className="ambient-cloud two" /><div className="ambient-stars" /><div className="ambient-grid" /></div>;
}
