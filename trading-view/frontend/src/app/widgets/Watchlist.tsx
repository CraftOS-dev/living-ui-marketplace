/**
 * Watchlist: live quotes in sections, flag colors and notes per row, sort by
 * any column, drag to reorder, arrow keys to step through symbols (linked
 * widgets follow), and the AI agent's flags and notes show up as it writes
 * them.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BellPlus, ChevronDown, ChevronRight, Columns3, FilePlus2, ListPlus, Pencil, Plus, Sparkles, StickyNote, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Btn, Empty, IconBtn, Menu, Modal, ContextMenu, Spark, input } from '../components/ui.tsx';
import type { MenuEntry } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { compact, pct, price, short, signed, tone, TONE_TEXT } from '../lib/format.ts';
import { primeQuotes, useLive, useQuotes } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import type { Quote, WatchItem, Widget } from '../lib/types.ts';
import { useDialogs } from '../workspace/Dialogs.tsx';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

const COLS: Record<string, { label: string; w: string; title: string }> = {
  last: { label: 'Last', w: 'w-[74px]', title: 'Last price' },
  chg: { label: 'Chg', w: 'w-[62px]', title: 'Change' },
  chg_pct: { label: 'Chg%', w: 'w-[58px]', title: 'Change in percent' },
  ext: { label: 'Ext', w: 'w-[58px]', title: 'Pre/post-market change' },
  volume: { label: 'Vol', w: 'w-[54px]', title: 'Volume' },
  high: { label: 'High', w: 'w-[66px]', title: 'Day high' },
  low: { label: 'Low', w: 'w-[66px]', title: 'Day low' },
  range: { label: 'Day', w: 'w-[54px]', title: 'Day range' },
  spark: { label: 'Today', w: 'w-[60px]', title: 'Intraday' },
  high_52w: { label: '52W H', w: 'w-[66px]', title: '52-week high' },
  low_52w: { label: '52W L', w: 'w-[66px]', title: '52-week low' },
};
const FLAG_COLORS: Record<string, string> = { red: 'var(--tv-down)', amber: 'var(--tv-warn)', green: 'var(--tv-up)', blue: 'var(--tv-link-1)', violet: 'var(--tv-link-5)' };

type SortKey = '' | 'symbol' | 'last' | 'chg' | 'chg_pct' | 'volume' | 'ext';

function sortValue(k: SortKey, it: WatchItem, q: Quote | undefined): number | string | null {
  if (k === 'symbol') return short(it.symbol);
  if (q === undefined) return null;
  if (k === 'last') return q.price;
  if (k === 'chg') return q.change;
  if (k === 'chg_pct') return q.change_pct;
  if (k === 'volume') return q.volume;
  if (k === 'ext') return q.ext_change_pct;
  return null;
}

function Cell({ col, q }: { col: string; q: Quote | undefined }): React.JSX.Element {
  const meta = COLS[col];
  const w = meta?.w ?? 'w-[60px]';
  if (q === undefined) return <span className={cn('shrink-0 text-right text-[var(--tv-muted)]', w)}>-</span>;
  switch (col) {
    case 'last':
      return <TickPrice q={q} className={w} />;
    case 'chg':
      return <span className={cn('num shrink-0 text-right', w, TONE_TEXT[tone(q.change)])}>{signed(q.change, q.price_hint)}</span>;
    case 'chg_pct':
      return <span className={cn('num shrink-0 text-right font-semibold', w, TONE_TEXT[tone(q.change_pct)])}>{pct(q.change_pct)}</span>;
    case 'ext':
      return <span className={cn('num shrink-0 text-right', w, TONE_TEXT[tone(q.ext_change_pct)])}>{q.ext_change_pct === null ? '' : pct(q.ext_change_pct)}</span>;
    case 'volume':
      return <span className={cn('num shrink-0 text-right text-[var(--tv-ink-2)]', w)}>{compact(q.volume)}</span>;
    case 'high':
      return <span className={cn('num shrink-0 text-right text-[var(--tv-ink-2)]', w)}>{price(q.high, q.price_hint)}</span>;
    case 'low':
      return <span className={cn('num shrink-0 text-right text-[var(--tv-ink-2)]', w)}>{price(q.low, q.price_hint)}</span>;
    case 'high_52w':
      return <span className={cn('num shrink-0 text-right text-[var(--tv-ink-2)]', w)}>{price(q.high_52w, q.price_hint)}</span>;
    case 'low_52w':
      return <span className={cn('num shrink-0 text-right text-[var(--tv-ink-2)]', w)}>{price(q.low_52w, q.price_hint)}</span>;
    case 'range': {
      const ok = q.high !== null && q.low !== null && q.price !== null && q.high > q.low;
      const p = ok ? ((q.price as number) - (q.low as number)) / ((q.high as number) - (q.low as number)) : 0;
      return (
        <span className={cn('relative flex shrink-0 items-center justify-end pl-2', w)} title={`${price(q.low, q.price_hint)} – ${price(q.high, q.price_hint)}`}>
          <span className="relative h-[3px] w-full rounded-full bg-[var(--tv-row-hover)]">{ok && <span className="absolute top-1/2 h-[8px] w-[2px] -translate-y-1/2 bg-[var(--tv-ink)]" style={{ left: `${p * 100}%` }} />}</span>
        </span>
      );
    }
    case 'spark':
      return (
        <span className={cn('flex shrink-0 justify-end', w)}>
          <Spark values={q.spark} base={q.prev_close} width={56} height={16} />
        </span>
      );
    default:
      return <span className={w} />;
  }
}

/** The last price, washing up or down for a moment when it ticks. */
function TickPrice({ q, className }: { q: Quote; className: string }): React.JSX.Element {
  const prev = useRef<number | null>(q.price);
  const [flash, setFlash] = useState<{ dir: 'up' | 'down'; n: number } | null>(null);
  useEffect(() => {
    const p = prev.current;
    if (p !== null && q.price !== null && q.price !== p) setFlash((f) => ({ dir: (q.price as number) > p ? 'up' : 'down', n: (f?.n ?? 0) + 1 }));
    prev.current = q.price;
  }, [q.price]);
  return (
    <span key={flash?.n ?? 0} className={cn('num shrink-0 rounded-[2px] text-right font-semibold', className, flash !== null && (flash.dir === 'up' ? 'tv-tick-up' : 'tv-tick-down'), q.stale === true && 'opacity-60')}>
      {price(q.price, q.price_hint)}
    </span>
  );
}

export function WatchlistWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const dialogs = useDialogs();
  const listId = w.config.list !== undefined && w.config.list !== '' && app.lists.some((l) => l.id === w.config.list) ? w.config.list : (app.lists[0]?.id ?? '');
  const live = useLive(() => (listId === '' ? Promise.resolve(null) : api.watchlist(listId).then((r) => r.watchlist)), ['watch_items', 'watchlists'], [listId], (e) => e.record['list'] === listId || e.record['id'] === listId);
  const [items, setItems] = useState<WatchItem[]>([]);
  useEffect(() => setItems(live.data?.items ?? []), [live.data]);
  const list = live.data;
  const columns = (list?.columns ?? ['last', 'chg', 'chg_pct']).filter((c) => COLS[c] !== undefined);
  const symbols = useMemo(() => items.filter((i) => i.kind === 'symbol').map((i) => i.symbol), [items]);
  const quotes = useQuotes(symbols);
  const current = app.shows(w).symbol;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: '', desc: false });
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<{ at: { x: number; y: number }; item: WatchItem } | null>(null);
  const [note, setNote] = useState<{ item: WatchItem; value: string } | null>(null);
  const [naming, setNaming] = useState<{ mode: 'new' | 'rename' | 'section'; value: string } | null>(null);
  const [colsOpen, setColsOpen] = useState(false);
  const [dragId, setDragId] = useState('');
  const [dropAt, setDropAt] = useState(-1);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // First quotes in one call so the rows fill at once.
  useEffect(() => {
    if (symbols.length === 0) return;
    api
      .quotes(symbols)
      .then((r) => primeQuotes(r.quotes))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listId, symbols.length]);

  const rows = useMemo(() => {
    if (sort.key === '') return items;
    const syms = items.filter((i) => i.kind === 'symbol');
    return syms.slice().sort((a, b) => {
      const x = sortValue(sort.key, a, quotes[a.symbol]);
      const y = sortValue(sort.key, b, quotes[b.symbol]);
      if (x === null) return 1;
      if (y === null) return -1;
      const r = typeof x === 'string' && typeof y === 'string' ? x.localeCompare(y) : (x as number) - (y as number);
      return sort.desc ? -r : r;
    });
  }, [items, sort, quotes]);

  // Visible rows (sections collapse their symbols).
  const visible = useMemo(() => {
    const out: WatchItem[] = [];
    let hide = false;
    for (const it of rows) {
      if (it.kind === 'section') {
        hide = collapsed[it.id] === true;
        out.push(it);
      } else if (!hide || sort.key !== '') out.push(it);
    }
    return out;
  }, [rows, collapsed, sort.key]);

  const step = (dir: 1 | -1): void => {
    const syms = visible.filter((i) => i.kind === 'symbol');
    const i = syms.findIndex((x) => x.symbol === current);
    const next = syms[Math.max(0, Math.min(syms.length - 1, i + dir))];
    if (next !== undefined) {
      app.show(w, { symbol: next.symbol });
      bodyRef.current?.querySelector(`[data-sym="${CSS.escape(next.symbol)}"]`)?.scrollIntoView({ block: 'nearest' });
    }
  };

  const add = (): void =>
    dialogs.searchSymbol(
      '',
      (s) => {
        if (listId === '') return;
        api
          .addToList(listId, { symbols: [s] })
          .then((r) => {
            if (r.added.length === 0) toast.info(short(s) + ' is already in this list');
            else app.show(w, { symbol: r.added[0]?.symbol ?? s });
          })
          .catch((err: unknown) => toast.error(errMessage(err)));
      },
      'Add to ' + (list?.name ?? 'watchlist'),
    );

  const remove = (it: WatchItem): void => {
    setItems((xs) => xs.filter((x) => x.id !== it.id));
    api.removeFromList({ item: it.id }).catch((err: unknown) => {
      toast.error(errMessage(err));
      live.reload();
    });
  };

  const setFlag = (it: WatchItem, flag: string): void => {
    setItems((xs) => xs.map((x) => (x.id === it.id ? { ...x, flag: flag as WatchItem['flag'] } : x)));
    api.editItem(it.id, { flag }).catch((err: unknown) => toast.error(errMessage(err)));
  };

  const drop = (index: number): void => {
    const it = items.find((x) => x.id === dragId);
    setDragId('');
    setDropAt(-1);
    if (it === undefined) return;
    const from = items.indexOf(it);
    const to = index > from ? index - 1 : index;
    if (to === from) return;
    const next = items.filter((x) => x.id !== it.id);
    next.splice(to, 0, it);
    setItems(next);
    api.moveItem(it.id, to).catch((err: unknown) => {
      toast.error(errMessage(err));
      live.reload();
    });
  };

  const rowMenu = (it: WatchItem): MenuEntry[] =>
    it.kind === 'section'
      ? [
          { label: 'Rename section', icon: Pencil, onClick: () => setNaming({ mode: 'section', value: it.label }) },
          { label: 'Remove section', icon: Trash2, danger: true, onClick: () => remove(it) },
        ]
      : [
          { heading: short(it.symbol) },
          ...['red', 'amber', 'green', 'blue', 'violet'].map((f) => ({ label: f[0]?.toUpperCase() + f.slice(1) + ' flag', swatch: FLAG_COLORS[f] ?? '', checked: it.flag === f, onClick: () => setFlag(it, it.flag === f ? '' : f) })),
          ...(it.flag !== '' ? [{ label: 'Clear flag', icon: X, onClick: () => setFlag(it, '') }] : []),
          'divider',
          { label: it.note !== '' ? 'Edit note' : 'Add note', icon: StickyNote, onClick: () => setNote({ item: it, value: it.note }) },
          { label: 'New alert', icon: BellPlus, onClick: () => dialogs.newAlert({ symbol: it.symbol, ...(quotes[it.symbol]?.price !== null && quotes[it.symbol]?.price !== undefined ? { price: quotes[it.symbol]?.price as number } : {}) }) },
          { label: 'Ask AI about ' + short(it.symbol), icon: Sparkles, onClick: () => dialogs.askAI({ symbol: it.symbol, interval: app.shows(w).interval }) },
          { label: 'Open in a new chart', icon: FilePlus2, onClick: () => void app.addWidget('chart', { link: '', config: { symbol: it.symbol, interval: '1D' } }) },
          'divider',
          { label: 'Remove from list', icon: Trash2, danger: true, onClick: () => remove(it) },
        ];

  const saveName = async (): Promise<void> => {
    if (naming === null) return;
    const v = naming.value.trim();
    if (v === '') return;
    try {
      if (naming.mode === 'new') {
        const r = await api.createWatchlist(v);
        app.configure(w, { list: r.watchlist.id });
      } else if (naming.mode === 'rename' && listId !== '') await api.updateWatchlist(listId, { name: v });
      else if (naming.mode === 'section' && menu !== null) await api.editItem(menu.item.id, { label: v });
      else if (naming.mode === 'section' && listId !== '') await api.addToList(listId, { section: v });
      setNaming(null);
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  const listMenu: MenuEntry[] = [
    { heading: 'Watchlists' },
    ...app.lists.map((l) => ({ label: l.name + (l.count !== undefined ? '  ' + l.count : ''), checked: l.id === listId, onClick: () => app.configure(w, { list: l.id }) })),
    'divider',
    { label: 'New watchlist', icon: Plus, onClick: () => setNaming({ mode: 'new', value: '' }) },
    { label: 'Rename', icon: Pencil, disabled: listId === '', onClick: () => setNaming({ mode: 'rename', value: list?.name ?? '' }) },
    { label: 'Add section', icon: ListPlus, disabled: listId === '', onClick: () => setNaming({ mode: 'section', value: '' }) },
    { label: 'Columns', icon: Columns3, disabled: listId === '', onClick: () => setColsOpen(true) },
    { label: 'Ask AI to review this list', icon: Sparkles, disabled: listId === '', onClick: () => dialogs.askAI({ watchlist: listId, watchlistName: list?.name ?? '' }) },
    'divider',
    {
      label: 'Delete watchlist',
      icon: Trash2,
      danger: true,
      disabled: listId === '',
      onClick: () =>
        void api
          .deleteWatchlist(listId)
          .then(() => toast.success('Deleted "' + (list?.name ?? '') + '". Undo brings it back.'))
          .catch((err: unknown) => toast.error(errMessage(err))),
    },
  ];

  const header = (
    <Menu
      align="left"
      items={listMenu}
      trigger={(open, toggle) => (
        <button type="button" onClick={toggle} className={cn('tv-nodrag flex min-w-0 items-center gap-1 rounded-[4px] px-1 hover:bg-[var(--tv-row)]', open && 'bg-[var(--tv-row)]')}>
          <Title detail={symbols.length > 0 ? symbols.length : undefined}>{list?.name ?? 'Watchlist'}</Title>
          <ChevronDown size={13} className="shrink-0 text-[var(--tv-muted)]" />
        </button>
      )}
    />
  );

  const sortBy = (k: SortKey): void => setSort((s) => (s.key !== k ? { key: k, desc: k !== 'symbol' } : s.desc ? { key: k, desc: false } : { key: '', desc: false }));
  const arrow = (k: SortKey): string => (sort.key === k ? (sort.desc ? ' ↓' : ' ↑') : '');

  return (
    <WidgetShell w={w} title={header} actions={<IconBtn icon={Plus} label="Add symbol" size={24} onClick={add} />} menu={listMenu.filter((x) => x !== 'divider' && !('heading' in (x as object)))}>
      <div
        ref={bodyRef}
        tabIndex={0}
        className="h-full overflow-y-auto outline-none"
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') {
            e.preventDefault();
            step(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            step(-1);
          } else if (e.key === 'Delete') {
            const it = items.find((x) => x.symbol === current);
            if (it !== undefined) remove(it);
          }
        }}
      >
        {live.loading && items.length === 0 ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <span key={i} className="tv-skeleton h-5 rounded-[3px]" />
            ))}
          </div>
        ) : app.lists.length === 0 ? (
          <Empty icon={ListPlus} title="No watchlists" action={<Btn icon={Plus} onClick={() => setNaming({ mode: 'new', value: '' })}>New watchlist</Btn>}>
            Keep the symbols you follow with live prices.
          </Empty>
        ) : items.length === 0 ? (
          <Empty icon={ListPlus} title="This list is empty" action={<Btn icon={Plus} onClick={add}>Add symbol</Btn>}>
            Add stocks, ETFs, indices, currencies, futures or crypto pairs.
          </Empty>
        ) : (
          <div className="text-[12px]">
            <div className="tv-table sticky top-0 z-[1] flex h-6 items-center gap-1 bg-[var(--tv-card)] pl-2 pr-1.5 text-[10.5px] font-bold uppercase tracking-[0.03em] text-[var(--tv-muted)] shadow-[inset_0_-1px_0_var(--tv-hair)]">
              <button type="button" onClick={() => sortBy('symbol')} className="min-w-0 flex-1 text-left hover:text-[var(--tv-ink)]">
                Symbol{arrow('symbol')}
              </button>
              {columns.map((c) => (
                <button key={c} type="button" title={COLS[c]?.title} onClick={() => ['last', 'chg', 'chg_pct', 'volume', 'ext'].includes(c) && sortBy(c as SortKey)} className={cn('shrink-0 text-right hover:text-[var(--tv-ink)]', COLS[c]?.w)}>
                  {COLS[c]?.label}
                  {arrow(c as SortKey)}
                </button>
              ))}
            </div>
            {visible.map((it) => {
              const idx = items.indexOf(it);
              if (it.kind === 'section')
                return (
                  <div
                    key={it.id}
                    className={cn('flex h-6 items-center gap-1 border-t border-[var(--tv-hair)] px-1.5 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--tv-muted)]', dropAt === idx && 'shadow-[inset_0_2px_0_var(--tv-accent)]')}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setMenu({ at: { x: e.clientX, y: e.clientY }, item: it });
                    }}
                    draggable={sort.key === ''}
                    onDragStart={() => setDragId(it.id)}
                    onDragOver={(e) => {
                      if (dragId === '') return;
                      e.preventDefault();
                      setDropAt(idx);
                    }}
                    onDrop={() => drop(idx)}
                  >
                    <button type="button" onClick={() => setCollapsed((c) => ({ ...c, [it.id]: !(c[it.id] === true) }))} className="flex items-center gap-1 hover:text-[var(--tv-ink)]">
                      {collapsed[it.id] === true ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      {it.label}
                    </button>
                  </div>
                );
              const q = quotes[it.symbol];
              const on = it.symbol === current;
              return (
                <div
                  key={it.id}
                  data-sym={it.symbol}
                  role="button"
                  tabIndex={-1}
                  onClick={() => app.show(w, { symbol: it.symbol })}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMenu({ at: { x: e.clientX, y: e.clientY }, item: it });
                  }}
                  draggable={sort.key === ''}
                  onDragStart={() => setDragId(it.id)}
                  onDragOver={(e) => {
                    if (dragId === '') return;
                    e.preventDefault();
                    setDropAt(idx);
                  }}
                  onDragEnd={() => {
                    setDragId('');
                    setDropAt(-1);
                  }}
                  onDrop={() => drop(idx)}
                  className={cn('group relative flex h-[26px] cursor-pointer items-center gap-1 pl-2 pr-1.5', on ? 'bg-[var(--tv-row-hover)]' : 'hover:bg-[var(--tv-row)]', dropAt === idx && 'shadow-[inset_0_2px_0_var(--tv-accent)]', dragId === it.id && 'opacity-50')}
                >
                  {it.flag !== '' && <span className="absolute inset-y-[3px] left-0 w-[3px] rounded-r-[2px]" style={{ background: FLAG_COLORS[it.flag] }} />}
                  <span className="flex min-w-0 flex-1 items-center gap-1">
                    <span className="truncate font-bold">{short(it.symbol)}</span>
                    {it.note !== '' && (
                      <span title={it.note} className="shrink-0 text-[var(--tv-muted)]">
                        <StickyNote size={11} />
                      </span>
                    )}
                    {q?.state !== undefined && q.state !== 'open' && q.provider === 'yahoo' && <span className="size-1 shrink-0 rounded-full bg-[var(--tv-muted)]" title={q.state === 'closed' ? 'Market closed' : q.state === 'pre' ? 'Pre-market' : 'After hours'} />}
                  </span>
                  {columns.map((c) => (
                    <Cell key={c} col={c} q={q} />
                  ))}
                </div>
              );
            })}
            {dragId !== '' && (
              <div className="h-6" onDragOver={(e) => (e.preventDefault(), setDropAt(items.length))} onDrop={() => drop(items.length)}>
                {dropAt === items.length && <span className="block h-0.5 bg-[var(--tv-accent)]" />}
              </div>
            )}
          </div>
        )}
      </div>
      <ContextMenu at={menu?.at ?? null} items={menu !== null ? rowMenu(menu.item) : []} onClose={() => setMenu(null)} />
      {note !== null && (
        <Modal
          open
          width="sm"
          onClose={() => setNote(null)}
          title={'Note on ' + short(note.item.symbol)}
          footer={
            <>
              <Btn onClick={() => setNote(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  api.editItem(note.item.id, { note: note.value }).catch((err: unknown) => toast.error(errMessage(err)));
                  setItems((xs) => xs.map((x) => (x.id === note.item.id ? { ...x, note: note.value } : x)));
                  setNote(null);
                }}
              >
                Save
              </Btn>
            </>
          }
        >
          <textarea autoFocus rows={4} maxLength={2000} value={note.value} onChange={(e) => setNote({ ...note, value: e.target.value })} className={input + ' h-auto py-1.5'} aria-label="Note" placeholder="Why you are watching it, levels, catalysts" />
        </Modal>
      )}
      {naming !== null && (
        <Modal
          open
          width="sm"
          onClose={() => setNaming(null)}
          title={naming.mode === 'new' ? 'New watchlist' : naming.mode === 'rename' ? 'Rename watchlist' : 'Section'}
          footer={
            <>
              <Btn onClick={() => setNaming(null)}>Cancel</Btn>
              <Btn variant="primary" onClick={() => void saveName()}>
                Save
              </Btn>
            </>
          }
        >
          <input autoFocus className={input} value={naming.value} maxLength={80} onChange={(e) => setNaming({ ...naming, value: e.target.value })} onKeyDown={(e) => e.key === 'Enter' && void saveName()} aria-label="Name" placeholder="Name" />
        </Modal>
      )}
      {colsOpen && list !== null && (
        <Modal open width="sm" onClose={() => setColsOpen(false)} title="Columns">
          <div className="flex flex-col">
            {Object.entries(COLS).map(([k, c]) => {
              const on = columns.includes(k);
              return (
                <label key={k} className="flex h-8 items-center justify-between gap-2 rounded-[4px] px-1 hover:bg-[var(--tv-row)]">
                  <span className="text-[12.5px]">{c.title}</span>
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const next = on ? columns.filter((x) => x !== k) : Object.keys(COLS).filter((x) => x === k || columns.includes(x));
                      void api.updateWatchlist(list.id, { columns: next }).catch((err: unknown) => toast.error(errMessage(err)));
                    }}
                  />
                </label>
              );
            })}
          </div>
        </Modal>
      )}
    </WidgetShell>
  );
}
