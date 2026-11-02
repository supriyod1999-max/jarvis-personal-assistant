import { useEffect, useRef, type RefObject } from 'react';

export type OrbState = 'ready' | 'listening' | 'thinking' | 'speaking' | 'offline' | 'error' | 'preparing';
const colours: Record<OrbState, [number, number, number]> = {
  ready: [116, 224, 229], listening: [117, 253, 205], thinking: [165, 145, 255],
  speaking: [131, 197, 255], offline: [99, 120, 145], error: [245, 184, 121], preparing: [164, 211, 223],
};

export default function AiOrb({ state, level }: { state: OrbState; level: RefObject<number> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef(state); stateRef.current = state;
  const redraw = useRef<(() => void) | null>(null);
  useEffect(() => { redraw.current?.(); }, [state]);
  useEffect(() => {
    const surface = canvas.current!; const ctx = surface.getContext('2d'); if (!ctx) return;
    const reduced = matchMedia('(prefers-reduced-motion: reduce)');
    let width = 440, dpr = 1, tick = 0, last = 0, amplitude = 0, raf = 0;
    let tint = [...colours[stateRef.current]];
    const pointer = { x: 0, y: 0 };
    const colour = (alpha: number) => `rgba(${tint.map(Math.round).join(',')},${alpha})`;
    const point = (lat: number, lng: number, radius: number, time: number) => {
      const ripple = 1 + (0.022 + amplitude * .065) * Math.sin(lng * 6 + lat * 9 + time * 1.4) + .018 * Math.cos(lng * 9 - time);
      const r = radius * ripple, x = r * Math.cos(lat) * Math.cos(lng), y = r * Math.sin(lat), z = r * Math.cos(lat) * Math.sin(lng);
      const spin = time * .09 + pointer.x * .14, tilt = -.32 + Math.sin(time * .14) * .2 + pointer.y * .12;
      const xx = x * Math.cos(spin) - z * Math.sin(spin), zz = x * Math.sin(spin) + z * Math.cos(spin);
      return { x: xx, y: y * Math.cos(tilt) - zz * Math.sin(tilt), z: y * Math.sin(tilt) + zz * Math.cos(tilt) };
    };
    const draw = (now: number, force = false) => {
      if (!force && now - last < 30) { raf = requestAnimationFrame(draw); return; }
      const elapsed = Math.min(.05, (now - last) / 1000 || .03); last = now;
      const current = stateRef.current;
      if (!reduced.matches) tick += elapsed * (current === 'thinking' ? 2 : current === 'offline' ? .3 : 1);
      const target = current === 'listening' || current === 'speaking' ? level.current : current === 'thinking' ? .09 : 0;
      amplitude += (target - amplitude) * .13;
      tint = tint.map((value, i) => value + (colours[current][i] - value) * (reduced.matches ? 1 : .06));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, width, width);
      const center = width / 2, radius = width * (.31 + (reduced.matches ? 0 : amplitude * .035));
      ctx.translate(center, center); ctx.globalCompositeOperation = 'source-over';
      const halo = ctx.createRadialGradient(0, 0, radius * .45, 0, 0, radius * 1.5);
      halo.addColorStop(0, colour(.05)); halo.addColorStop(.5, colour(.1)); halo.addColorStop(1, colour(0));
      ctx.fillStyle = halo; ctx.fillRect(-center, -center, width, width);
      const sphere = ctx.createRadialGradient(-radius * .3, -radius * .4, 0, 0, 0, radius);
      sphere.addColorStop(0, '#153547'); sphere.addColorStop(.5, '#0b1d2e'); sphere.addColorStop(.88, '#091422'); sphere.addColorStop(1, colour(.22));
      ctx.beginPath(); ctx.arc(0, 0, radius * .99, 0, Math.PI * 2); ctx.fillStyle = sphere; ctx.fill();
      ctx.globalCompositeOperation = 'screen';
      // Flowing latitude filaments form a volume, with a brighter near hemisphere.
      for (let band = 0; band < 38; band++) {
        const latitude = (band / 37 - .5) * Math.PI * .98;
        ctx.beginPath();
        for (let step = 0; step <= 112; step++) {
          const lng = step / 112 * Math.PI * 2;
          const warp = .065 * Math.sin(lng * 3 + tick * .6 + band * .13);
          const p = point(latitude + warp, lng, radius, tick);
          if (step === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
        }
        ctx.strokeStyle = colour(.12 + .25 * Math.sin((band / 37) * Math.PI));
        ctx.lineWidth = band % 5 === 0 ? 1.3 : .6; ctx.stroke();
      }
      for (let i = 0; i < 640; i++) {
        const lat = Math.asin(-1 + 2 * i / 639), lng = i * 2.399963;
        const p = point(lat, lng, radius * 1.015, tick);
        const near = (p.z / radius + 1) * .5;
        ctx.beginPath(); ctx.arc(p.x, p.y, .45 + near * .9, 0, Math.PI * 2);
        ctx.fillStyle = colour(.1 + near * .65); ctx.fill();
      }
      // A few elliptical satellites locate the core in space, without fake metrics.
      for (let ring = 0; ring < 3; ring++) {
        ctx.save(); ctx.rotate(-.42 + ring * 1.02 + tick * .025);
        ctx.beginPath(); ctx.ellipse(0, 0, radius * (1.19 + ring * .09), radius * .65, 0, 0, Math.PI * 2);
        ctx.strokeStyle = colour(.1); ctx.lineWidth = .65; ctx.stroke();
        const angle = tick * .25 + ring * 2.2;
        ctx.beginPath(); ctx.arc(Math.cos(angle) * radius * (1.19 + ring * .09), Math.sin(angle) * radius * .65, 1.6, 0, Math.PI * 2); ctx.fillStyle = colour(.8); ctx.fill(); ctx.restore();
      }
      if (!reduced.matches && !document.hidden) raf = requestAnimationFrame(draw);
    };
    const restart = () => { cancelAnimationFrame(raf); last = performance.now(); draw(last, true); };
    const resize = new ResizeObserver(entries => { width = entries[0].contentRect.width; dpr = Math.min(devicePixelRatio || 1, 1.5); surface.width = Math.round(width * dpr); surface.height = Math.round(width * dpr); restart(); });
    resize.observe(surface);
    const move = (event: PointerEvent) => { const bounds = surface.getBoundingClientRect(); pointer.x = (event.clientX - bounds.left) / bounds.width - .5; pointer.y = (event.clientY - bounds.top) / bounds.height - .5; };
    const leave = () => { pointer.x = 0; pointer.y = 0; };
    const visibility = () => { cancelAnimationFrame(raf); if (!document.hidden) restart(); };
    surface.addEventListener('pointermove', move); surface.addEventListener('pointerleave', leave);
    document.addEventListener('visibilitychange', visibility); reduced.addEventListener('change', restart);
    redraw.current = () => { if (reduced.matches) restart(); };
    restart();
    return () => { cancelAnimationFrame(raf); resize.disconnect(); redraw.current = null; surface.removeEventListener('pointermove', move); surface.removeEventListener('pointerleave', leave); document.removeEventListener('visibilitychange', visibility); reduced.removeEventListener('change', restart); };
  }, [level]);
  return <div className={`ai-orb orb-${state}`} data-state={state}><div className="orb-aura" /><canvas ref={canvas} aria-hidden="true" /><span className="orb-fallback" aria-hidden="true" /></div>;
}
