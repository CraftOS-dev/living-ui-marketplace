/**
 * The stockroom map on Home: the places and their stock as a 3D isometric
 * model to turn, zoom and work in (reference/requirements.md 33-42).
 *
 * The three.js engine loads on its own (it is most of the map's weight), so
 * Home shows at once and the map fills in. Selection, filters and arrange
 * mode live here; the engine draws them and reports clicks, drops and moves.
 */
import { Box, Focus, Maximize2, Minimize2, Minus, Move, Plus, Search, X } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { money, qty } from '../../lib/format.ts';
import { KIND_LABELS } from '../../lib/icons.tsx';
import { useLive } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { onThemeColors } from '../../lib/themeColors.ts';
import { STATUS_LABEL } from '../controls.tsx';
import { ItemSearch } from '../pickers.tsx';
import { reveal, useStockChange } from '../StockChange.tsx';
import { CircleButton, Empty, PillButton, Popover } from '../ui.tsx';
import type { MapEngine, MapEvents, Palette, Pick, Placement, StatusFilter } from './engine.ts';
import { layoutWorld } from './layout.ts';
import type { World } from './layout.ts';
import { ItemPanel, PlacePanel, figures } from './MapPanel.tsx';
import type { Sel } from './MapPanel.tsx';

type Filter = 'all' | 'low' | 'out' | 'over';
const HINT_KEY = 'iv-map-hint-seen';
const PANEL_W = 368;
/** The phone sheet covers up to this share of the map. */
const SHEET = 0.58;

/** Relative luminance of "rgb(r g b)" or "#rrggbb". */
function luminance(css: string): number {
  const hex = css.startsWith('#') ? css.slice(1, 7) : null;
  const n = hex !== null ? [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16)) : (css.match(/[\d.]+/g) ?? []).map(Number);
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(n[0] ?? 0) + 0.7152 * lin(n[1] ?? 0) + 0.0722 * lin(n[2] ?? 0);
}

function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

function readPalette(): Palette {
  const st = getComputedStyle(document.documentElement);
  const v = (k: string, fallback: string): string => st.getPropertyValue(k).trim() || fallback;
  const accent = v('--iv-accent-base', '#ff4f18');
  const row = v('--iv-row', '#f2f2f2');
  const ink = v('--iv-ink', '#1f1e1b');
  return {
    // Outlines mark the selection on the stage: the accent when it shows there, the ink otherwise.
    mark: contrast(accent, row) >= 2.2 ? accent : ink,
    card: v('--iv-card', '#ffffff'),
    sand: v('--iv-floor', '#e9e4dc'),
    row: v('--iv-row', '#f2f2f2'),
    line: v('--iv-line', '#d8d8d8'),
    ink: v('--iv-ink', '#1f1e1b'),
    ink2: v('--iv-ink-2', '#55524c'),
    accent,
    green: v('--iv-green', '#4f9a6c'),
    amber: v('--iv-amber', '#e2a43a'),
    red: v('--iv-red', '#de4b33'),
  };
}

function hintSeen(): boolean {
  try {
    return window.localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

function useNarrow(): boolean {
  const query = '(max-width: 767px)';
  const [narrow, setNarrow] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const m = window.matchMedia(query);
    const on = (): void => setNarrow(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return narrow;
}

function pickOf(sel: Sel | null): Pick | null {
  if (sel === null) return null;
  if (sel.kind === 'zone') return { type: 'zone', id: sel.id };
  if (sel.kind === 'unit') return { type: 'unit', id: sel.id };
  return sel.slot !== null ? { type: 'slot', key: sel.slot } : null;
}

/* ------------------------------------------------------------- the card */

export function StockMapCard(): React.JSX.Element {
  const change = useStockChange();
  const narrow = useNarrow();
  const motion = useMemo(() => !window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const live = useLive(() => api.map(), ['stock', 'items', 'locations', 'categories', 'settings'], []);
  const data = live.data;
  const world = useMemo(() => (data === null ? null : layoutWorld(data)), [data]);
  const worldRef = useRef<World | null>(null);
  worldRef.current = world;

  const cardRef = useRef<HTMLElement | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const labelsRef = useRef<HTMLDivElement | null>(null);
  const tipRef = useRef<HTMLDivElement | null>(null);
  const expandRef = useRef<HTMLButtonElement | null>(null);
  const searchRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<MapEngine | null>(null);
  const [engine, setEngine] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [hover, setHover] = useState<Pick | null>(null);
  const [sel, setSel] = useState<Sel | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [arrange, setArrange] = useState(false);
  const [saving, setSaving] = useState(false);
  const [full, setFull] = useState(false);
  const [searching, setSearching] = useState(false);
  const [hint, setHint] = useState(() => !hintSeen());
  const [carry, setCarry] = useState<{ name: string; to: string | null } | null>(null);
  const [arrangeFocus, setArrangeFocus] = useState<{ name: string; w: number; d: number } | null>(null);
  const carryRef = useRef<HTMLDivElement | null>(null);

  const dismissHint = useCallback(() => {
    setHint(false);
    try {
      window.localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* a convenience only */
    }
  }, []);

  // The engine's events reach the latest state through this ref.
  const handlers = useRef<MapEvents | null>(null);
  handlers.current = {
    hover: (pick, x, y) => {
      setHover((h) => (JSON.stringify(h) === JSON.stringify(pick) ? h : pick));
      const tip = tipRef.current;
      const host = hostRef.current;
      if (tip !== null && host !== null) {
        const maxX = host.clientWidth - tip.offsetWidth - 8;
        const maxY = host.clientHeight - tip.offsetHeight - 8;
        tip.style.transform = `translate(${Math.round(Math.max(8, Math.min(maxX, x + 16)))}px, ${Math.round(Math.max(8, Math.min(maxY, y + 16)))}px)`;
      }
    },
    select: (pick) => {
      const w = worldRef.current;
      if (pick === null || w === null) {
        setSel(null);
        return;
      }
      if (pick.type === 'zone') setSel({ kind: 'zone', id: pick.id, fly: true });
      else if (pick.type === 'unit') {
        const u = w.units.get(pick.id);
        // Furniture standing on its own and loose stock select the place they stand for.
        if (u?.self === true || (u?.floor === true && u.place.id === u.zone)) setSel({ kind: 'zone', id: u.zone, fly: true });
        else if (u?.floor === true) setSel({ kind: 'unit', id: u.place.id, fly: true });
        else setSel({ kind: 'unit', id: pick.id, fly: true });
      } else {
        const s = w.slots.find((x) => x.key === pick.key);
        if (s !== undefined) setSel({ kind: 'item', item: s.item.id, slot: s.key, fly: false });
      }
    },
    move: (slot, to, clientX, clientY) => {
      change.open({ x: clientX, y: clientY }, { item: { id: slot.item.id }, mode: 'move', location: slot.place, to });
    },
    carry: (info) => {
      if (info === null) {
        setCarry(null);
        return;
      }
      const to = info.to !== null ? (worldRef.current?.places.get(info.to)?.name ?? null) : null;
      setCarry((c) => (c !== null && c.name === info.slot.item.name && c.to === to ? c : { name: info.slot.item.name, to }));
      const el = carryRef.current;
      const host = hostRef.current;
      if (el !== null && host !== null) {
        const x = Math.max(8, Math.min(host.clientWidth - el.offsetWidth - 8, info.x - el.offsetWidth / 2));
        const y = Math.max(8, Math.min(host.clientHeight - el.offsetHeight - 8, info.y + 26));
        el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    },
    arrange: (placements) => {
      void saveLayout(placements);
    },
    arrangeFocus: (info) => {
      setArrangeFocus((f) => (f !== null && info !== null && f.name === info.name && f.w === info.w && f.d === info.d ? f : info));
    },
    refuse: (message) => toast.info(message),
    interact: () => {
      if (hint) dismissHint();
    },
  };

  // One save for the whole change: it all lands or none of it does.
  const saveLayout = async (placements: Placement[]): Promise<void> => {
    if (placements.length === 0) return;
    setSaving(true);
    try {
      await api.arrangeMap(placements.map(({ id, ...p }) => ({ location: id, ...p })));
    } catch {
      // Back to the saved layout; the error was shown.
      if (worldRef.current !== null) engineRef.current?.setWorld(worldRef.current);
    } finally {
      setSaving(false);
    }
  };

  // Load the engine once the card is on screen.
  useEffect(() => {
    let alive = true;
    const host = hostRef.current;
    const labels = labelsRef.current;
    if (host === null || labels === null) return;
    import('./engine.ts')
      .then(({ MapEngine: Engine }) => {
        if (!alive) return;
        try {
          const events: MapEvents = {
            hover: (...a) => handlers.current?.hover(...a),
            select: (...a) => handlers.current?.select(...a),
            move: (...a) => handlers.current?.move(...a),
            carry: (...a) => handlers.current?.carry(...a),
            arrange: (...a) => handlers.current?.arrange(...a),
            arrangeFocus: (...a) => handlers.current?.arrangeFocus(...a),
            refuse: (...a) => handlers.current?.refuse(...a),
            interact: () => handlers.current?.interact(),
          };
          const e = new Engine(host, labels, events, motion);
          e.setPalette(readPalette());
          engineRef.current = e;
          setEngine('ready');
        } catch {
          setEngine('failed');
        }
      })
      .catch(() => {
        if (alive) setEngine('failed');
      });
    const off = onThemeColors(() => engineRef.current?.setPalette(readPalette()));
    return () => {
      alive = false;
      off();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
  }, [motion]);

  useEffect(() => {
    if (engine === 'ready' && world !== null) engineRef.current?.setWorld(world);
  }, [engine, world]);

  // A selection that no longer exists (deleted place, item moved away) closes.
  useEffect(() => {
    if (world === null || sel === null) return;
    const gone =
      (sel.kind === 'zone' && !world.zones.some((z) => z.id === sel.id)) ||
      (sel.kind === 'unit' && !world.units.has(sel.id)) ||
      (sel.kind === 'item' && !world.items.has(sel.item));
    if (gone) setSel(null);
    else if (sel.kind === 'item' && sel.slot !== null && !world.slots.some((s) => s.key === sel.slot)) {
      setSel({ kind: 'item', item: sel.item, slot: world.slots.find((s) => s.item.id === sel.item)?.key ?? null, fly: false });
    }
  }, [world, sel]);

  // A new selection shows (and flies to) it, framed in the space the panel
  // leaves; new data alone never moves the view (the engine keeps the selection).
  useEffect(() => {
    const e = engineRef.current;
    if (e === null || engine !== 'ready') return;
    const sheet = sel !== null && narrow ? Math.round((hostRef.current?.clientHeight ?? 0) * SHEET) : 0;
    e.setInset(sel !== null && !narrow ? PANEL_W : 0, sheet);
    e.select(pickOf(sel), sel?.fly ?? false);
    e.focusItem(sel?.kind === 'item' ? sel.item : null, sel?.kind === 'item' && sel.slot === null && sel.fly);
  }, [sel, engine, narrow]);

  useEffect(() => {
    engineRef.current?.setFilter(filter === 'all' ? null : (filter as StatusFilter));
  }, [filter, engine, world]);

  useEffect(() => {
    engineRef.current?.setArrange(arrange);
    if (arrange) setSel(null);
  }, [arrange, engine]);

  // Full screen: grow from the expand button, lock the page behind it.
  useLayoutEffect(() => {
    if (!full) return;
    const el = cardRef.current;
    const b = expandRef.current?.getBoundingClientRect();
    if (el !== null && b !== undefined) reveal(el, { x: b.left + b.width / 2, y: b.top + b.height / 2 }, true);
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [full]);

  const closeFull = useCallback(() => {
    const el = cardRef.current;
    const b = expandRef.current?.getBoundingClientRect();
    const anim = el !== null && b !== undefined ? reveal(el, { x: b.left + b.width / 2, y: b.top + b.height / 2 }, false) : null;
    if (anim === null) setFull(false);
    else anim.onfinish = () => setFull(false);
  }, []);

  const onKey = (e: React.KeyboardEvent): void => {
    const en = engineRef.current;
    if (en === null) return;
    const k = e.key;
    if (k === 'ArrowLeft') en.pan(-1, 0);
    else if (k === 'ArrowRight') en.pan(1, 0);
    else if (k === 'ArrowUp') en.pan(0, 1);
    else if (k === 'ArrowDown') en.pan(0, -1);
    else if (k === '+' || k === '=') en.zoomBy(1.3);
    else if (k === '-' || k === '_') en.zoomBy(1 / 1.3);
    else if (k === '0') en.fit();
    else if (k === 'Escape') {
      if (en.cancelGesture()) {
        /* put back */
      } else if (arrange) setArrange(false);
      else if (sel !== null) setSel(null);
      else if (full) closeFull();
      else return;
    } else return;
    e.preventDefault();
    if (hint) dismissHint();
  };

  const counts = data?.counts ?? { ok: 0, low: 0, out: 0, over: 0 };
  const totals = data?.totals;
  const noStock = world !== null && world.slots.length === 0;
  const subtitle =
    totals === undefined
      ? 'Loading your places'
      : `${totals.places} ${totals.places === 1 ? 'place' : 'places'} · ${qty(totals.units)} ${totals.units === 1 ? 'unit' : 'units'} on hand${totals.value > 0 ? ` · ${money(totals.value, data?.currency ?? '')}` : ''}`;

  return (
    <section
      ref={cardRef}
      aria-label="Stockroom map"
      className={cn(
        'iv-on-card flex flex-col bg-[var(--iv-card)] text-[var(--iv-ink)]',
        full ? 'fixed inset-0 z-[66] p-3 md:p-4' : 'iv-rise iv-d1 rounded-[24px] p-3 md:p-4',
      )}
    >
      <header className="flex flex-wrap items-start justify-between gap-3 px-2 pb-3 pt-1 md:px-2">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold leading-[22px]">Stockroom map</h2>
          <p className="mt-0.5 truncate text-[13px] text-[var(--iv-muted)]">{subtitle}</p>
        </div>
        <div className="flex max-w-full flex-wrap items-center gap-2">
          <FilterChips value={filter} onChange={setFilter} counts={counts} />
          <div ref={searchRef} className="relative">
            <CircleButton icon={Search} label="Find an item on the map" variant="row" size={40} onClick={() => setSearching((o) => !o)} aria-expanded={searching} />
            <Popover open={searching} onClose={() => setSearching(false)} align="right" keep={searchRef} className="w-[min(320px,calc(100vw-48px))] p-3">
              <ItemSearch
                autoFocus
                limit={6}
                onPick={(it) => {
                  setSearching(false);
                  const w = worldRef.current;
                  const first = w?.slots.find((s) => s.item.id === it.id);
                  if (first === undefined) {
                    toast.info(`${it.name} is not on the map: it has no stock and no home place.`);
                    return;
                  }
                  setSel({ kind: 'item', item: it.id, slot: null, fly: true });
                }}
              />
            </Popover>
          </div>
          <PillButton
            variant={arrange ? 'dark' : 'soft'}
            icon={Move}
            onClick={() => setArrange((a) => !a)}
            aria-pressed={arrange}
            disabled={engine !== 'ready' || world === null || world.zones.length === 0}
            className="h-10 px-4 text-[13px]"
          >
            Arrange
          </PillButton>
          <button
            ref={expandRef}
            type="button"
            aria-label={full ? 'Close full screen' : 'Full screen'}
            title={full ? 'Close full screen' : 'Full screen'}
            onClick={() => (full ? closeFull() : setFull(true))}
            className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--iv-row)] text-[var(--iv-ink)] transition-colors hover:bg-[var(--iv-row-hover)]"
          >
            {full ? <Minimize2 size={17} aria-hidden /> : <Maximize2 size={17} aria-hidden />}
          </button>
        </div>
      </header>

      <div
        tabIndex={0}
        onKeyDown={onKey}
        aria-label="Stockroom map. Arrow keys move around, plus and minus zoom, 0 fits everything, Escape closes the panel."
        className={cn(
          'relative overflow-hidden rounded-[20px] bg-[var(--iv-row)] outline-none ring-[var(--iv-ink)] focus-visible:ring-2',
          full ? 'min-h-0 flex-1' : 'h-[500px] md:h-[480px]',
        )}
      >
        <div ref={hostRef} className="absolute inset-0" />
        <div ref={labelsRef} className="pointer-events-none absolute inset-0 overflow-hidden" />

        {engine === 'loading' && <MapSkeleton />}
        {engine === 'failed' && (
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <Empty
              icon={Box}
              title="This browser cannot draw the 3D map"
              action={
                <PillButton variant="soft" onClick={() => navigate('locations')}>
                  Open locations
                </PillButton>
              }
            >
              Your places and what is in them are on the Locations page.
            </Empty>
          </div>
        )}

        {/* Where a carried box would go. */}
        <div
          ref={carryRef}
          aria-live="polite"
          className={cn(
            'iv-on-ink pointer-events-none absolute left-0 top-0 z-30 max-w-[280px] truncate rounded-full px-3.5 py-1.5 text-[12px] font-semibold shadow-lg transition-opacity duration-100',
            carry === null ? 'opacity-0' : 'opacity-100',
            carry !== null && carry.to !== null ? 'bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'bg-[var(--iv-card)] text-[var(--iv-ink)] ring-1 ring-[var(--iv-line)]',
          )}
        >
          {carry === null ? '' : carry.to !== null ? `Move ${carry.name} to ${carry.to}` : 'Drop it on a place'}
        </div>

        {/* What is under the pointer. */}
        <div
          ref={tipRef}
          aria-hidden
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-30 max-w-[240px] rounded-[14px] bg-[var(--iv-card)] px-3 py-2 shadow-[0_14px_34px_-16px_rgba(0,0,0,0.5)] ring-1 ring-[var(--iv-line)] transition-opacity duration-150',
            hover !== null && world !== null && !arrange && carry === null ? 'opacity-100' : 'opacity-0',
          )}
        >
          {hover !== null && world !== null && <Tip world={world} pick={hover} />}
        </div>

        {engine === 'ready' && (
          <>
            <div className="absolute bottom-3 left-3 z-10 flex flex-col items-center gap-0.5 rounded-full bg-[var(--iv-card)] p-1 shadow-[0_12px_30px_-16px_rgba(0,0,0,0.5)] ring-1 ring-[var(--iv-line)]">
              {!narrow && (
                <>
                  <ViewButton icon={Plus} label="Zoom in" onClick={() => engineRef.current?.zoomBy(1.3)} />
                  <ViewButton icon={Minus} label="Zoom out" onClick={() => engineRef.current?.zoomBy(1 / 1.3)} />
                  <span aria-hidden className="my-0.5 h-px w-6 bg-[var(--iv-line)]" />
                </>
              )}
              <ViewButton icon={Focus} label="Fit everything" onClick={() => engineRef.current?.fit()} />
            </div>
            {!narrow && sel === null && <Legend />}
          </>
        )}

        {arrange && (
          <div className="iv-pop iv-on-ink absolute left-1/2 top-3 z-20 flex max-w-[calc(100%-24px)] -translate-x-1/2 flex-wrap items-center justify-center gap-2 rounded-[22px] bg-[var(--iv-ink)] p-1.5 pl-4 text-[var(--iv-shell)] shadow-xl">
            <span className="min-w-0 truncate text-[13px] font-semibold">
              {saving ? (
                'Saving the layout'
              ) : arrangeFocus !== null ? (
                <>
                  {arrangeFocus.name}
                  <span className="num font-normal opacity-75">
                    {' '}
                    · {metres(arrangeFocus.w)} × {metres(arrangeFocus.d)} m · drag its corners to resize
                  </span>
                </>
              ) : (
                'Drag any place to where it is in your space'
              )}
            </span>
            <button
              type="button"
              onClick={() => {
                void api
                  .resetMap()
                  .then(() => toast.success('Back to the automatic layout'))
                  .catch(() => undefined);
              }}
              className="h-8 rounded-full px-3 text-[13px] font-semibold text-[var(--iv-shell)] underline-offset-2 hover:underline"
            >
              Reset layout
            </button>
            <button type="button" onClick={() => setArrange(false)} className="h-8 rounded-full bg-[var(--iv-accent)] px-4 text-[13px] font-bold text-[var(--iv-on-accent)]">
              Done
            </button>
          </div>
        )}

        {engine === 'ready' && noStock && !arrange && sel === null && (
          <div className="absolute inset-x-3 bottom-3 z-10 flex justify-center">
            <div className="flex max-w-[460px] flex-wrap items-center justify-center gap-3 rounded-[20px] bg-[var(--iv-card)] px-4 py-3 text-center shadow-[0_14px_34px_-18px_rgba(0,0,0,0.5)] ring-1 ring-[var(--iv-line)]">
              <span className="text-[13px] text-[var(--iv-ink-2)]">Stock you add shows up here as boxes on its shelves.</span>
              <PillButton variant="dark" icon={Plus} dot onClick={(e) => change.open(e.currentTarget)} className="h-9 text-[13px]">
                Stock change
              </PillButton>
            </div>
          </div>
        )}

        {engine === 'ready' && hint && !noStock && !arrange && sel === null && (
          <div className="pointer-events-none absolute inset-x-3 top-3 z-10 flex justify-center">
            <div className="iv-pop pointer-events-auto flex items-center gap-2 rounded-full bg-[var(--iv-card)] py-1.5 pl-4 pr-1.5 shadow-[0_12px_30px_-16px_rgba(0,0,0,0.5)] ring-1 ring-[var(--iv-line)]">
              <span className="text-[12px] font-semibold text-[var(--iv-ink-2)]">
                {narrow ? 'Drag to move around · pinch to zoom · hold an item to move it' : 'Drag to move around · scroll to zoom · drag an item onto a place to move it'}
              </span>
              <CircleButton icon={X} label="Got it" variant="row" size={26} onClick={dismissHint} />
            </div>
          </div>
        )}

        {world !== null && sel !== null && (sel.kind === 'item' ? (
          <ItemPanel world={world} sel={sel} narrow={narrow} onSelect={setSel} />
        ) : (
          <PlacePanel world={world} sel={sel} currency={data?.currency ?? ''} narrow={narrow} onSelect={setSel} />
        ))}

        {/* The places, for keyboards and screen readers. */}
        {world !== null && (
          <ul className="sr-only" aria-label="Places on the map">
            {world.zones.map((z) => (
              <li key={z.id}>
                <button type="button" onClick={() => setSel({ kind: 'zone', id: z.id, fly: true })}>
                  Show {z.place.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- the pieces */

const metres = (v: number): string => (Math.round(v * 100) / 100).toString();

function ViewButton({ icon: Icon, label, onClick }: { icon: typeof Plus; label: string; onClick: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-9 items-center justify-center rounded-full text-[var(--iv-ink)] transition-colors hover:bg-[var(--iv-row)] active:scale-95"
    >
      <Icon size={16} strokeWidth={2} aria-hidden />
    </button>
  );
}

const FILTERS: { value: Filter; label: string; dot: string | null }[] = [
  { value: 'all', label: 'All', dot: null },
  { value: 'low', label: 'Low', dot: 'var(--iv-amber)' },
  { value: 'out', label: 'Out', dot: 'var(--iv-red)' },
  { value: 'over', label: 'Over', dot: 'var(--iv-ink-2)' },
];

function FilterChips({ value, onChange, counts }: { value: Filter; onChange: (f: Filter) => void; counts: { ok: number; low: number; out: number; over: number } }): React.JSX.Element {
  return (
    <div role="radiogroup" aria-label="Show on the map" className="flex w-full max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-[var(--iv-row)] p-1 sm:w-auto">
      {FILTERS.map((f) => {
        const on = value === f.value;
        const n = f.value === 'all' ? null : counts[f.value];
        return (
          <button
            key={f.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(f.value)}
            className={cn(
              'inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full px-2 text-[13px] font-semibold transition-colors sm:flex-none sm:px-3',
              on ? 'iv-on-ink bg-[var(--iv-ink)] text-[var(--iv-shell)]' : 'text-[var(--iv-ink-2)] hover:bg-[var(--iv-row-hover)] hover:text-[var(--iv-ink)]',
            )}
          >
            {f.dot !== null && <span aria-hidden className="size-2 rounded-full" style={{ background: f.dot }} />}
            {f.label}
            {n !== null && <span className={cn('num text-[12px]', on ? 'text-[var(--iv-shell)]' : 'text-[var(--iv-muted)]')}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Legend(): React.JSX.Element {
  const rows: { label: string; dot: string }[] = [
    { label: STATUS_LABEL.ok, dot: 'var(--iv-green)' },
    { label: STATUS_LABEL.low, dot: 'var(--iv-amber)' },
    { label: 'Over', dot: 'var(--iv-ink-2)' },
  ];
  return (
    <div className="absolute bottom-3 right-3 z-10 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-full bg-[var(--iv-card)] px-3.5 py-2 shadow-[0_12px_30px_-16px_rgba(0,0,0,0.5)] ring-1 ring-[var(--iv-line)]">
      {rows.map((r) => (
        <span key={r.label} className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--iv-ink-2)]">
          <span aria-hidden className="size-2.5 rounded-[3px]" style={{ background: r.dot }} />
          {r.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5 text-[12px] font-semibold text-[var(--iv-ink-2)]">
        <span aria-hidden className="size-2.5 rounded-[3px] border border-dashed border-[var(--iv-red)]" />
        Out of stock
      </span>
    </div>
  );
}

function Tip({ world, pick }: { world: World; pick: Pick }): React.JSX.Element | null {
  if (pick.type === 'slot') {
    const s = world.slots.find((x) => x.key === pick.key);
    if (s === undefined) return null;
    return (
      <>
        <span className="block truncate text-[13px] font-bold">{s.item.name}</span>
        <span className="num block text-[12px] text-[var(--iv-ink-2)]">
          {s.boxes === 0 ? `Out of stock · belongs at ${world.places.get(s.place)?.name ?? ''}` : `${qty(s.qty)} ${s.item.unit} here · ${STATUS_LABEL[s.item.status]}`}
        </span>
      </>
    );
  }
  const zone = pick.type === 'zone' ? world.zones.find((z) => z.id === pick.id) : undefined;
  const unit = pick.type === 'unit' ? world.units.get(pick.id) : undefined;
  const place = zone?.place ?? unit?.place;
  if (place === undefined) return null;
  const f = figures(world, zone?.holds ?? unit?.holds ?? []);
  return (
    <>
      <span className="block truncate text-[13px] font-bold">{unit?.floor === true ? `${place.name}, kept loose` : place.name}</span>
      <span className="num block text-[12px] text-[var(--iv-ink-2)]">
        {KIND_LABELS[place.kind]} · {f.items === 0 ? 'empty' : `${f.items} ${f.items === 1 ? 'item' : 'items'}, ${qty(f.units)} ${f.units === 1 ? 'unit' : 'units'}`}
        {unit !== undefined && unit.hidden > 0 ? ` (${unit.hidden} more not drawn)` : ''}
      </span>
    </>
  );
}

/** A quiet stand-in while the 3D engine loads: three platforms in perspective. */
function MapSkeleton(): React.JSX.Element {
  return (
    <div aria-label="Loading the map" className="absolute inset-0 flex items-center justify-center">
      <div className="flex items-end gap-10" style={{ transform: 'rotateX(55deg) rotateZ(-45deg)', transformStyle: 'preserve-3d' }}>
        {[96, 132, 84].map((s, i) => (
          <span key={s} className="block animate-pulse rounded-[18px] bg-[var(--iv-sand)]" style={{ width: s, height: s * 0.8, animationDelay: `${i * 160}ms` }} />
        ))}
      </div>
    </div>
  );
}
