import { useEffect, useRef, useState, type RefObject } from 'react';
import type { TalkPhase } from './useTalk';

export function useIslandPresentation({ enabled, mode, awake, phase, level }: {
  enabled: boolean; mode: 'orb' | 'island'; awake: boolean; phase: TalkPhase; level: RefObject<number>;
}) {
  const [hover, setHover] = useState(false), [focused, setFocused] = useState(false);
  const [opened, setOpened] = useState(false), [linger, setLinger] = useState(false), [intro, setIntro] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => {
    const media = matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(media.matches); update(); media.addEventListener('change', update);
    const blur = () => { setHover(false); setFocused(false); setOpened(false); };
    window.addEventListener('blur', blur);
    return () => { media.removeEventListener('change', update); window.removeEventListener('blur', blur); clearTimeout(leaveTimer.current); };
  }, []);
  useEffect(() => {
    setOpened(false); setCollapsed(false); setHover(false); setFocused(false);
    if (!enabled || mode !== 'island') { setIntro(false); return; }
    setIntro(true); const timer = setTimeout(() => setIntro(false), 2300);
    return () => clearTimeout(timer);
  }, [enabled, mode]);
  useEffect(() => {
    if (!awake) { setLinger(false); setOpened(false); setCollapsed(false); return; }
    if (phase === 'transcribing') setCollapsed(false);
    setLinger(true);
    if (phase !== 'listening') return;
    let lastActivity = performance.now();
    const timer = setInterval(() => {
      if (level.current > .08) { lastActivity = performance.now(); setLinger(true); setCollapsed(false); }
      else if (performance.now() - lastActivity > 5200) setLinger(false);
    }, 120);
    return () => clearInterval(timer);
  }, [awake, phase, level]);
  const busy = awake && ['transcribing', 'thinking', 'speaking'].includes(phase);
  const presentation = mode === 'orb' ? 'expanded' : collapsed ? 'compact' : opened || busy || (awake && (linger || hover)) ? 'expanded'
    : hover || focused || intro || phase === 'preparing' ? 'peek' : 'compact';
  return { presentation, reducedMotion,
    expand: () => { setOpened(true); setCollapsed(false); },
    enter: () => { clearTimeout(leaveTimer.current); setCollapsed(false); setHover(true); },
    leave: () => { clearTimeout(leaveTimer.current); leaveTimer.current = setTimeout(() => setHover(false), 180); },
    focus: (value: boolean) => setFocused(value),
    toggle: () => { setOpened(presentation !== 'expanded'); setCollapsed(presentation === 'expanded'); if (presentation === 'expanded') { setLinger(false); setHover(false); setFocused(false); setIntro(false); } },
  };
}
