/**
 * Market heatmap: tiles sized by traded value (or equal), grouped by sector
 * or category, colored by today's change. Click a tile to show it.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutGrid } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Empty, Select, Seg, Spinner } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { pct, price, short } from '../lib/format.ts';
import { useApp } from '../lib/store.tsx';
import { chartColors, onThemeChange } from '../lib/themeColors.ts';
import type { Tile, Universe, Widget } from '../lib/types.ts';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Squarified treemap: items (weights, largest first) into a rectangle. */
function squarify<T>(items: { v: number; item: T }[], r: Rect): (Rect & { item: T })[] {
  const out: (Rect & { item: T })[] = [];
  const total = items.reduce((s, i) => s + i.v, 0);
  if (total <= 0 || r.w <= 0 || r.h <= 0) return out;
  const scale = (r.w * r.h) / total;
  let rest = items.map((i) => ({ a: i.v * scale, item: i.item }));
  let box = { ...r };
  const worst = (row: { a: number }[], side: number): number => {
    const s = row.reduce((t, x) => t + x.a, 0);
    let mx = 0;
    let mn = Infinity;
    for (const x of row) {
      mx = Math.max(mx, x.a);
      mn = Math.min(mn, x.a);
    }
    return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn));
  };
  while (rest.length > 0) {
    const side = Math.min(box.w, box.h);
    const row: { a: number; item: T }[] = [];
    let i = 0;
    while (i < rest.length) {
      const next = rest[i] as { a: number; item: T };
      if (row.length === 0 || worst([...row, next], side) <= worst(row, side)) {
        row.push(next);
        i++;
      } else break;
    }
    const s = row.reduce((t, x) => t + x.a, 0);
    const horizontal = box.w >= box.h;
    const thick = s / side;
    let off = 0;
    for (const x of row) {
      const len = x.a / thick;
      if (horizontal) out.push({ x: box.x, y: box.y + off, w: thick, h: len, item: x.item });
      else out.push({ x: box.x + off, y: box.y, w: len, h: thick, item: x.item });
      off += len;
    }
    box = horizontal ? { x: box.x + thick, y: box.y, w: box.w - thick, h: box.h } : { x: box.x, y: box.y + thick, w: box.w, h: box.h - thick };
    rest = rest.slice(i);
  }
  return out;
}

/** Dark or white text, whichever reads on the tile. */
function textOn(rgb: string): string {
  const m = /rgb\((\d+)\s+(\d+)\s+(\d+)\)/.exec(rgb);
  if (m === null) return '#ffffff';
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  const l = 0.2126 * lin(Number(m[1])) + 0.7152 * lin(Number(m[2])) + 0.0722 * lin(Number(m[3]));
  return l > 0.36 ? '#16181d' : '#ffffff';
}

function mixColor(change: number | null): string {
  const c = chartColors();
  if (change === null || !isFinite(change)) return c.dark ? 'rgb(60 60 60)' : 'rgb(225 225 225)';
  const k = Math.min(1, Math.abs(change) / 3);
  const target = change >= 0 ? c.up : c.down;
  const m = /rgb\((\d+)\s+(\d+)\s+(\d+)\)/.exec(target);
  const base = c.dark ? [44, 44, 46] : [236, 236, 238];
  if (m === null) return target;
  const t = [Number(m[1]), Number(m[2]), Number(m[3])];
  const mixv = (i: number): number => Math.round((base[i] ?? 0) + ((t[i] ?? 0) - (base[i] ?? 0)) * (0.25 + 0.75 * k));
  return `rgb(${mixv(0)} ${mixv(1)} ${mixv(2)})`;
}

export function HeatmapWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const universe = w.config.universe ?? 'us_mega';
  const size = w.config.size ?? 'equal';
  const grouped = w.config.group !== false;
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [error, setError] = useState('');
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [, setTheme] = useState(0);
  const ref = useRef<HTMLDivElement | null>(null);
  const current = app.shows(w).symbol;

  useEffect(() => onThemeChange(() => setTheme((n) => n + 1)), []);
  useEffect(() => {
    void api
      .universes()
      .then((r) => setUniverses(r.universes.filter((u) => !u.id.startsWith('yahoo:'))))
      .catch(() => undefined);
  }, [app.lists.length]);
  useEffect(() => {
    let cancelled = false;
    setError('');
    const load = (): void => {
      api
        .heatmap(universe)
        .then((r) => !cancelled && setTiles(r.tiles))
        .catch((err: unknown) => !cancelled && setError(errMessage(err)));
    };
    setTiles(null);
    load();
    const t = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [universe]);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const ro = new ResizeObserver((e) => {
      const r = e[0]?.contentRect;
      if (r !== undefined) setBox({ w: Math.floor(r.width), h: Math.floor(r.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const layout = useMemo(() => {
    if (tiles === null || box.w === 0) return { groups: [] as (Rect & { item: string })[], cells: [] as (Rect & { item: Tile })[] };
    const weight = (t: Tile): number => (size === 'volume' ? Math.max(1, t.dollar_volume ?? 1) : 1);
    if (!grouped) {
      const items = tiles.map((t) => ({ v: weight(t), item: t })).sort((a, b) => b.v - a.v);
      return { groups: [], cells: squarify(items, { x: 0, y: 0, w: box.w, h: box.h }) };
    }
    const byGroup = new Map<string, Tile[]>();
    for (const t of tiles) {
      const g = t.group || 'Other';
      byGroup.set(g, [...(byGroup.get(g) ?? []), t]);
    }
    const groups = squarify(
      [...byGroup.entries()].map(([g, ts]) => ({ v: ts.reduce((s, t) => s + weight(t), 0), item: g })).sort((a, b) => b.v - a.v),
      { x: 0, y: 0, w: box.w, h: box.h },
    );
    const cells: (Rect & { item: Tile })[] = [];
    for (const g of groups) {
      const head = g.h > 40 && g.w > 50 ? 14 : 0;
      const items = (byGroup.get(g.item) ?? []).map((t) => ({ v: weight(t), item: t })).sort((a, b) => b.v - a.v);
      cells.push(...squarify(items, { x: g.x + 1, y: g.y + head + 1, w: g.w - 2, h: g.h - head - 2 }));
    }
    return { groups, cells };
  }, [tiles, box, size, grouped]);

  const uniOptions = universes.map((u) => ({ value: u.id, label: u.name }));
  if (!uniOptions.some((o) => o.value === universe)) uniOptions.unshift({ value: universe, label: universe });

  return (
    <WidgetShell
      w={w}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Title>Heatmap</Title>
          <Select small label="Universe" value={universe} onChange={(v) => app.configure(w, { universe: v })} options={uniOptions} className="tv-nodrag w-[140px]" />
        </span>
      }
      actions={
        <>
          <Seg
            size="xs"
            value={size}
            onChange={(v) => app.configure(w, { size: v })}
            options={[
              { value: 'equal', label: 'Equal', title: 'Same size for every tile' },
              { value: 'volume', label: 'Value', title: 'Sized by traded value today' },
            ]}
          />
          <button type="button" onClick={() => app.configure(w, { group: !grouped })} className={cn('h-6 rounded-[4px] px-1.5 text-[11px] font-bold hover:bg-[var(--tv-row)]', grouped ? 'bg-[var(--tv-row-hover)] text-[var(--tv-ink)]' : 'text-[var(--tv-muted)]')} title="Group by sector or category">
            Groups
          </button>
        </>
      }
    >
      <div ref={ref} className="absolute inset-0 overflow-hidden">
        {error !== '' && tiles === null ? (
          <Empty icon={LayoutGrid} title="No heatmap">
            {error}
          </Empty>
        ) : tiles === null ? (
          <div className="flex h-full items-center justify-center">
            <Spinner className="text-[var(--tv-muted)]" />
          </div>
        ) : (
          <>
            {layout.groups.map((g) => (
              <div key={g.item} className="pointer-events-none absolute border border-[var(--tv-card)]" style={{ left: g.x, top: g.y, width: g.w, height: g.h }}>
                {g.h > 40 && g.w > 50 && <span className="block truncate px-1 text-[10px] font-bold uppercase leading-[14px] tracking-[0.03em] text-[var(--tv-muted)]">{g.item}</span>}
              </div>
            ))}
            {layout.cells.map((c) => {
              const t = c.item;
              const big = c.w > 70 && c.h > 38;
              const show = c.w > 30 && c.h > 16;
              const bg = mixColor(t.change_pct);
              return (
                <button
                  key={t.symbol}
                  type="button"
                  title={`${t.name}\n${price(t.price)}  ${pct(t.change_pct)}`}
                  onClick={() => app.show(w, { symbol: t.symbol })}
                  className={cn('absolute flex flex-col items-center justify-center overflow-hidden border border-[var(--tv-card)] text-center transition-[filter] hover:brightness-110', t.symbol === current && 'outline outline-2 -outline-offset-2 outline-[var(--tv-ink)]')}
                  style={{ left: c.x, top: c.y, width: c.w, height: c.h, background: bg, color: textOn(bg) }}
                >
                  {show && <span className={cn('max-w-full truncate px-0.5 font-bold leading-tight', big ? 'text-[13px]' : 'text-[10.5px]')}>{short(t.symbol)}</span>}
                  {show && c.h > 28 && <span className={cn('num max-w-full truncate leading-tight', big ? 'text-[11.5px]' : 'text-[10px]')}>{pct(t.change_pct)}</span>}
                </button>
              );
            })}
          </>
        )}
      </div>
    </WidgetShell>
  );
}
