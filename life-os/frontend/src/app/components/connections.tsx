/**
 * The connection map: you in the middle, the people in your life on rings
 * around you (the closer the ring, the closer the circle: partner, then
 * family, then friends). Each person sits next to the
 * people they know, so the thin lines between friends stay short. The line
 * from you shows how things stand: green when you were in touch lately,
 * dashed amber when it is time to reach out. Tap a face to open the person.
 */
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn } from '../../kit/index.ts';
import { enter } from '../lib/motion.ts';
import type { Circle, Person } from '../lib/types.ts';
import { Avatar } from './art.tsx';
import { ThingArt } from './art2.tsx';

const RANK: Record<Circle, number> = { partner: 0, family: 1, friends: 2 };
const RING_NAMES: Record<Circle, string> = { partner: 'Partner', family: 'Family', friends: 'Friends' };

/** How far out each ring sits (share of the map's radius), by how many rings there are. */
function radii(m: number): number[] {
  if (m === 1) return [0.72];
  if (m === 2) return [0.52, 0.94];
  if (m === 3) return [0.36, 0.66, 0.95];
  return Array.from({ length: m }, (_, k) => 0.3 + (0.65 * k) / (m - 1));
}

function lineOf(p: Person): { color: string; width: number; dash?: string | undefined } {
  if (p.keep_in_touch_days > 0 && p.due) return { color: 'var(--lo-amber)', width: 2, dash: '5 5' };
  const d = p.days_since;
  if (p.keep_in_touch_days > 0 && d !== null && d <= 30) return { color: 'var(--lo-moss)', width: d <= 7 ? 2.5 : 2 };
  return { color: 'var(--lo-line)', width: 1.5 };
}

/** The smallest turn between two angles. */
function apart(a: number, b: number): number {
  const d = Math.abs(a - b) % (Math.PI * 2);
  return d > Math.PI ? Math.PI * 2 - d : d;
}

export function ConnectionMap({ people, owner, circles, hint, onOpen }: { people: Person[]; owner: string; circles: Circle[]; hint: string; onOpen: (id: string) => void }): React.JSX.Element {
  const box = useRef<HTMLDivElement | null>(null);
  const [w, setW] = useState(720);
  const [hover, setHover] = useState<string | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const set = (): void => setW(Math.max(280, Math.round(el.getBoundingClientRect().width)));
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const small = w < 480;
  const face = small ? 32 : 44;
  const me = small ? 44 : 60;
  // On a narrow screen the rings stretch into ovals so there is room above and below.
  // Nobody yet: a shorter map, just you and the empty rings.
  const h = people.length === 0 ? 340 : small ? Math.max(500, Math.round(w * 1.5)) : Math.round(Math.min(620, Math.max(300, w * 0.92)));
  const cx = w / 2;
  // Nobody yet: the rings sit higher, leaving room under them for the hint.
  const foot = people.length === 0 ? 44 : 0;
  const cy = (h - foot) / 2;
  const edge = face / 2 + 24;
  const Ry = (h - foot) / 2 - edge;
  const Rx = Math.min(w / 2 - edge, Ry * 1.35);

  const ranks = useMemo(() => [...new Set(circles.map((c) => RANK[c]))].sort((a, b) => a - b), [circles]);
  const ringOf = useMemo(() => {
    const rs = radii(ranks.length);
    return new Map(ranks.map((k, i) => [k, rs[i] ?? 0.95]));
  }, [ranks]);
  const ringLabel = (k: number): string => circles.filter((c) => RANK[c] === k).map((c) => RING_NAMES[c]).join(' and ');

  // Rings fill from the inside out. Each ring is turned so its seats clear the faces already
  // seated (and you), then everyone takes the free seat closest to the people they know;
  // the top of each ring stays clear for its name.
  const placed = useMemo(() => {
    const shown = people.filter((p) => circles.includes(p.circle));
    const ids = new Set(shown.map((p) => p.id));
    const knows = new Map(shown.map((p) => [p.id, new Set<string>()]));
    for (const p of shown) for (const o of p.links) if (ids.has(o)) {
      knows.get(p.id)?.add(o);
      knows.get(o)?.add(p.id);
    }
    const angle = new Map<string, number>();
    const out = new Map<string, { x: number; y: number; p: Person }>();
    // A person takes up their face and the name under it.
    const box = (x: number, y: number): [number, number, number, number] => [x - (small ? 32 : 40), x + (small ? 32 : 40), y - face / 2 - 4, y + face / 2 + 22];
    const you: [number, number, number, number] = [cx - me / 2 - 4, cx + me / 2 + 4, cy - me / 2 - 4, cy + me / 2 + 4];
    const overlap = (a: number[], b: number[]): boolean => (a[0] as number) < (b[1] as number) && (b[0] as number) < (a[1] as number) && (a[2] as number) < (b[3] as number) && (b[2] as number) < (a[3] as number);
    const covers = (x: number, y: number): boolean => overlap(box(x, y), you) || [...out.values()].some((o) => overlap(box(x, y), box(o.x, o.y)));
    ranks.forEach((k, ri) => {
      const r = ringOf.get(k) ?? 0.95;
      const on = shown.filter((p) => RANK[p.circle] === k);
      if (on.length === 0) return;
      const half = ringLabel(k).length * 3.6 + 10 + face / 2 + 6;
      const gap = Math.min(1.6, Math.max(0.4, 2 * Math.asin(Math.min(1, half / Math.max(1, Rx * r)))));
      const seatsAt = (f: number): number[] => on.map((_, i) => -Math.PI / 2 + gap / 2 + ((i + f) / on.length) * (Math.PI * 2 - gap));
      const clashes = (f: number): number => seatsAt(f).filter((a) => covers(cx + Math.cos(a) * Rx * r, cy + Math.sin(a) * Ry * r)).length;
      let f = [0.5, 0.3, 0.7][ri % 3] ?? 0.5;
      for (let g = 0.1; g < 0.95; g += 0.1) if (clashes(g) < clashes(f)) f = g;
      const seats = seatsAt(f);
      const free = new Set(seats.map((_, i) => i));
      const left = [...on];
      while (left.length > 0) {
        let best = 0;
        let bestKnown = -1;
        left.forEach((p, i) => {
          const n = [...(knows.get(p.id) ?? [])].filter((o) => angle.has(o)).length;
          if (n > bestKnown) {
            best = i;
            bestKnown = n;
          }
        });
        const p = left.splice(best, 1)[0] as Person;
        const near = [...(knows.get(p.id) ?? [])].map((o) => angle.get(o)).filter((a): a is number => a !== undefined);
        const want = near.length > 0 ? Math.atan2(near.reduce((s, a) => s + Math.sin(a), 0), near.reduce((s, a) => s + Math.cos(a), 0)) : null;
        // A seat where the face would cover someone already seated (or you) is the last resort.
        const cost = (i: number): number => {
          const a = seats[i] as number;
          return (covers(cx + Math.cos(a) * Rx * r, cy + Math.sin(a) * Ry * r) ? 10 : 0) + (want === null ? i * 0.01 : apart(a, want));
        };
        let seat = Math.min(...free);
        for (const i of free) if (cost(i) < cost(seat)) seat = i;
        free.delete(seat);
        const a = seats[seat] as number;
        angle.set(p.id, a);
        out.set(p.id, { x: cx + Math.cos(a) * Rx * r, y: cy + Math.sin(a) * Ry * r, p });
      }
    });
    return out;
    // ringLabel depends only on circles
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [people, circles, ranks, ringOf, cx, cy, Rx, Ry, face, me, small]);

  const links: [string, string][] = [];
  for (const p of placed.values()) for (const o of p.p.links) if (p.p.id < o && placed.has(o)) links.push([p.p.id, o]);
  const near = (id: string): boolean => hover === null || hover === id || links.some(([a, b]) => (a === hover && b === id) || (b === hover && a === id));

  // Soft bands, darker toward you, each holding one ring.
  const rs = ranks.map((k) => ringOf.get(k) ?? 0.95);
  const bands = rs.map((r, i) => (i < rs.length - 1 ? (r + (rs[i + 1] as number)) / 2 : r + (face / 2 + 12) / Ry));

  return (
    <div ref={box} className="relative w-full overflow-hidden rounded-[var(--lo-r-lg)] bg-[var(--lo-sunk)]" style={{ height: h }}>
      <svg width={w} height={h} className="absolute inset-0" aria-hidden>
        {[...bands].reverse().map((b) => (
          <ellipse key={b} cx={cx} cy={cy} rx={Rx * b} ry={Ry * b} fill="var(--lo-card)" fillOpacity={0.45} stroke="var(--lo-line)" strokeWidth={1} />
        ))}
        {links.map(([a, b]) => {
          const pa = placed.get(a);
          const pb = placed.get(b);
          if (pa === undefined || pb === undefined) return null;
          // Bend each line away from the middle so it never runs through you.
          const mx = (pa.x + pb.x) / 2;
          const my = (pa.y + pb.y) / 2;
          let ux = mx - cx;
          let uy = my - cy;
          const ul = Math.hypot(ux, uy);
          if (ul < 1) {
            ux = -(pb.y - pa.y);
            uy = pb.x - pa.x;
          }
          const n = Math.max(1, Math.hypot(ux, uy));
          const bend = Math.hypot(pb.x - pa.x, pb.y - pa.y) * 0.28;
          const on = hover === null || hover === a || hover === b;
          return <path key={a + b} d={`M ${pa.x} ${pa.y} Q ${mx + (ux / n) * bend} ${my + (uy / n) * bend} ${pb.x} ${pb.y}`} fill="none" stroke="var(--lo-ink-2)" strokeWidth={1.25} opacity={on ? 0.4 : 0.08} />;
        })}
        {[...placed.values()].map(({ x, y, p }) => {
          const l = lineOf(p);
          const mx = (cx + x) / 2 + (y - cy) * 0.1;
          const my = (cy + y) / 2 - (x - cx) * 0.1;
          return <path key={p.id} d={`M ${cx} ${cy} Q ${mx} ${my} ${x} ${y}`} fill="none" stroke={l.color} strokeWidth={l.width} strokeDasharray={l.dash} strokeLinecap="round" opacity={near(p.id) ? 0.9 : 0.12} />;
        })}
      </svg>
      {ranks.map((k) => (
        <span key={k} className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-[var(--lo-r-xs)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-1.5 text-[12px] font-bold leading-5 text-[var(--lo-muted)]" style={{ left: cx, top: cy - Ry * (ringOf.get(k) ?? 0.95) }}>
          {ringLabel(k)}
        </span>
      ))}
      <span
        title={owner !== '' ? owner : undefined}
        className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-[var(--lo-card)] bg-[var(--lo-primary)] shadow-[var(--lo-shadow)]"
        style={{ left: cx, top: cy, width: me, height: me }}
      >
        <span className={cn('font-extrabold leading-none text-white', small ? 'text-[12px]' : 'text-[14px]')}>You</span>
      </span>
      {[...placed.values()].map(({ x, y, p }) => {
        const bday = p.next_birthday !== null && p.next_birthday.in_days <= 7;
        return (
          <button
            key={p.id}
            type="button"
            onClick={() => onOpen(p.id)}
            onMouseEnter={() => setHover(p.id)}
            onMouseLeave={() => setHover(null)}
            onFocus={() => setHover(p.id)}
            onBlur={() => setHover(null)}
            title={p.due ? `Time to get in touch with ${p.name}` : p.relation !== '' ? `${p.name}, ${p.relation}` : p.name}
            className={cn('absolute flex -translate-x-1/2 flex-col items-center transition-opacity', enter(p.id), !near(p.id) && 'opacity-40')}
            style={{ left: x, top: y - face / 2 - 3 }}
          >
            <span className={cn('relative rounded-full border-[3px] bg-[var(--lo-card)] shadow-[var(--lo-shadow-sm)] transition-transform hover:scale-110', p.due ? 'border-[var(--lo-amber)]' : 'border-[var(--lo-card)]')}>
              <Avatar look={p.look} size={face} label={p.name} />
              {bday && (
                <span className="absolute -right-2 -top-2">
                  <ThingArt kind="cake" size={small ? 16 : 20} />
                </span>
              )}
            </span>
            <span className="mt-0.5 max-w-[96px] truncate rounded-[var(--lo-r-xs)] bg-[var(--lo-card)] px-1.5 text-[12px] font-bold shadow-[var(--lo-shadow-sm)]">{p.name}</span>
          </button>
        );
      })}
      {people.length === 0 && <p className="absolute inset-x-4 bottom-4 text-center text-[13px] font-semibold text-[var(--lo-ink-2)]">{hint}</p>}
    </div>
  );
}

/** What the lines mean. */
export function MapKey(): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px] font-semibold text-[var(--lo-ink-2)]">
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="21" y2="3" stroke="var(--lo-moss)" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
        In touch lately
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="21" y2="3" stroke="var(--lo-amber)" strokeWidth="2" strokeDasharray="5 5" strokeLinecap="round" />
        </svg>
        Time to reach out
      </span>
      <span className="inline-flex items-center gap-1.5">
        <svg width="22" height="6" aria-hidden>
          <line x1="1" y1="3" x2="21" y2="3" stroke="var(--lo-ink-2)" strokeWidth="1.25" opacity="0.4" />
        </svg>
        Know each other
      </span>
    </div>
  );
}
