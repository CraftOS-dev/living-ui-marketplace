/**
 * The weather drawn over a landscape: rain falling, snow drifting, clouds
 * passing, so the picture at the top of Home looks like the day outside.
 */
import { useMemo } from 'react';

function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

export function WeatherSky({ code }: { code: number }): React.JSX.Element | null {
  const kind = code >= 95 ? 'storm' : (code >= 51 && code <= 67) || (code >= 80 && code <= 82) ? 'rain' : (code >= 71 && code <= 77) || code === 85 || code === 86 ? 'snow' : code === 3 || code === 45 || code === 48 ? 'cloud' : null;
  const drops = useMemo(() => {
    const r = rng(code + 7);
    return Array.from({ length: kind === 'snow' ? 46 : 70 }, () => ({ x: r() * 100, d: 0.7 + r() * 0.8, delay: -r() * 2, len: 8 + r() * 10 }));
  }, [code, kind]);
  if (kind === null) return null;
  if (kind === 'cloud')
    return (
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        {[0, 1, 2].map((i) => (
          <svg key={i} className="lo-scene-cloud absolute" style={{ left: `${10 + i * 32}%`, top: `${8 + (i % 2) * 14}%`, animationDelay: `${-i * 7}s` }} width={140} height={50} viewBox="0 0 140 50">
            <path d="M24 46h86a18 18 0 0 0 2-36 26 26 0 0 0-48-6 20 20 0 0 0-40 42z" fill="var(--lo-art-cream)" opacity="0.75" />
          </svg>
        ))}
      </div>
    );
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {drops.map((p, i) =>
        kind === 'snow' ? (
          <span key={i} className="lo-snow absolute top-0 size-1.5 rounded-full bg-[var(--lo-art-white)] opacity-80" style={{ left: `${p.x}%`, animationDuration: `${p.d * 6}s`, animationDelay: `${p.delay * 3}s` }} />
        ) : (
          <span key={i} className="lo-rain absolute top-0 w-[1.5px] rounded-full bg-[var(--lo-art-water)] opacity-60" style={{ left: `${p.x}%`, height: p.len, animationDuration: `${p.d}s`, animationDelay: `${p.delay}s` }} />
        ),
      )}
    </div>
  );
}
