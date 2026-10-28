/**
 * Screener: a universe (large caps, ETFs, indices, FX, futures, crypto,
 * Yahoo's market lists or a watchlist), filters on quote and technical
 * fields, sortable results; screens can be saved and the results turned
 * into a watchlist.
 */
import { useEffect, useMemo, useState } from 'react';
import { Filter, ListPlus, Plus, RefreshCw, Save, ScanLine, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { Btn, Change, Empty, IconBtn, Menu, Modal, Select, Spark, Spinner, input } from '../components/ui.tsx';
import type { MenuEntry } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { compact, num, pct, price, short, tone, TONE_TEXT } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useApp } from '../lib/store.tsx';
import type { Criterion, Field, ScreenResult, Universe, Widget } from '../lib/types.ts';
import { Title, WidgetShell } from '../workspace/WidgetShell.tsx';

const PRESETS: { label: string; criteria: Criterion[]; sort: string; desc: boolean }[] = [
  { label: 'Top gainers', criteria: [{ field: 'change_pct', op: '>', value: 0 }], sort: 'change_pct', desc: true },
  { label: 'Top losers', criteria: [{ field: 'change_pct', op: '<', value: 0 }], sort: 'change_pct', desc: false },
  { label: 'Oversold (RSI under 30)', criteria: [{ field: 'rsi14', op: '<', value: 30 }], sort: 'rsi14', desc: false },
  { label: 'Overbought (RSI over 70)', criteria: [{ field: 'rsi14', op: '>', value: 70 }], sort: 'rsi14', desc: true },
  { label: 'Uptrend pullback', criteria: [{ field: 'sma200_dist', op: '>', value: 0 }, { field: 'rsi14', op: '<', value: 45 }], sort: 'rsi14', desc: false },
  { label: 'At a 20-day high', criteria: [{ field: 'high_20', op: '>=', value: 1 }], sort: 'perf_1m', desc: true },
  { label: 'Unusual volume', criteria: [{ field: 'rvol', op: '>', value: 1.8 }], sort: 'rvol', desc: true },
  { label: 'Near 52-week high', criteria: [{ field: 'from_high_52w', op: '>', value: -3 }], sort: 'from_high_52w', desc: true },
  { label: 'Strongest month', criteria: [], sort: 'perf_1m', desc: true },
];

function fmtField(f: Field | undefined, v: unknown, hint?: number): React.JSX.Element {
  if (typeof v !== 'number' || !isFinite(v)) return <span className="text-[var(--tv-muted)]">-</span>;
  if (f?.unit === '%') return <span className={TONE_TEXT[f.key.startsWith('perf') || f.key.endsWith('dist') || f.key === 'change_pct' || f.key === 'gap_pct' ? tone(v) : 'flat']}>{pct(v)}</span>;
  if (f?.unit === 'x') return <span>{num(v, 2)}×</span>;
  if (f?.unit === 'flag') return <span>{v >= 1 ? 'Yes' : ''}</span>;
  if (f?.unit === 'price') return <span>{price(v, hint)}</span>;
  if (f?.key === 'volume' || f?.key === 'dollar_volume' || f?.key === 'market_cap') return <span>{compact(v)}</span>;
  return <span>{num(v, 2)}</span>;
}

export function ScreenerWidget({ w }: { w: Widget }): React.JSX.Element {
  const app = useApp();
  const cfg = w.config;
  const universe = cfg.universe ?? 'us_mega';
  const criteria = cfg.criteria ?? [];
  const sort = cfg.sort ?? 'change_pct';
  const desc = cfg.desc !== false;
  const [universes, setUniverses] = useState<Universe[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [result, setResult] = useState<ScreenResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [tick, setTick] = useState(0);
  const [saveName, setSaveName] = useState<string | null>(null);
  const screens = useLive(() => api.screens().then((r) => r.screens), ['screens'], []);
  const current = app.shows(w).symbol;

  useEffect(() => {
    void api
      .universes()
      .then((r) => setUniverses(r.universes))
      .catch(() => undefined);
    void api
      .fields()
      .then((r) => setFields(r.fields))
      .catch(() => undefined);
  }, [app.lists.length]);

  const key = JSON.stringify([universe, criteria, sort, desc, tick]);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    const run = (): void => {
      api
        .screen({ universe, criteria, sort, desc, limit: 100 })
        .then((r) => !cancelled && setResult(r))
        .catch((err: unknown) => !cancelled && setError(errMessage(err)))
        .finally(() => !cancelled && setLoading(false));
    };
    run();
    const t = setInterval(run, 90000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const byKey = useMemo(() => new Map(fields.map((f) => [f.key, f])), [fields]);
  const extra = useMemo(() => {
    const out: string[] = [];
    for (const c of criteria) if (!['change_pct', 'price'].includes(c.field) && !out.includes(c.field)) out.push(c.field);
    if (!['change_pct', 'price', 'volume'].includes(sort) && !out.includes(sort)) out.push(sort);
    return out.slice(0, 4);
  }, [criteria, sort]);

  const setSort = (k: string): void => app.configure(w, k === sort ? { desc: !desc } : { sort: k, desc: true });
  const head = (k: string, label: string, cls: string): React.JSX.Element => (
    <th className={cn('h-6 px-1.5 text-[10.5px] font-bold uppercase tracking-[0.03em] text-[var(--tv-muted)]', cls)}>
      <button type="button" className="hover:text-[var(--tv-ink)]" onClick={() => setSort(k)}>
        {label}
        {sort === k ? (desc ? ' ↓' : ' ↑') : ''}
      </button>
    </th>
  );

  const toWatchlist = async (): Promise<void> => {
    if (result === null || result.rows.length === 0) return;
    try {
      const name = (result.universe.name + ' screen').slice(0, 80);
      await api.createWatchlist(
        name,
        result.rows.slice(0, 60).map((r) => r.symbol),
      );
      toast.success('Created the watchlist "' + name + '"');
    } catch (err) {
      toast.error(errMessage(err));
    }
  };

  const savedMenu: MenuEntry[] = [
    { heading: 'Presets' },
    ...PRESETS.map((p) => ({ label: p.label, onClick: () => app.configure(w, { criteria: p.criteria, sort: p.sort, desc: p.desc }) })),
    ...((screens.data ?? []).length > 0 ? ([{ heading: 'Saved screens' }] as MenuEntry[]) : []),
    ...(screens.data ?? []).map((s) => ({ label: s.name + (s.added_by === 'agent' ? '  · AI' : ''), onClick: () => app.configure(w, { universe: s.universe, criteria: s.criteria, sort: s.sort || 'change_pct' }) })),
    'divider',
    { label: 'Save this screen', icon: Save, onClick: () => setSaveName('') },
    { label: 'Clear filters', icon: X, disabled: criteria.length === 0, onClick: () => app.configure(w, { criteria: [] }) },
  ];

  const uniOptions = universes.map((u) => ({ value: u.id, label: u.name, group: u.id.startsWith('yahoo:') ? 'Market lists' : u.id.startsWith('watchlist:') ? 'Watchlists' : 'Universes' }));
  if (!uniOptions.some((o) => o.value === universe)) uniOptions.unshift({ value: universe, label: universe, group: 'Universes' });

  return (
    <WidgetShell
      w={w}
      title={
        <span className="flex min-w-0 items-center gap-1.5">
          <Title detail={result !== null ? result.count + ' of ' + result.total : undefined}>Screener</Title>
          <Select small label="Universe" value={universe} onChange={(v) => app.configure(w, { universe: v })} options={uniOptions} className="tv-nodrag w-[150px]" />
        </span>
      }
      actions={
        <>
          {loading && <Spinner size={12} className="mx-1 text-[var(--tv-muted)]" />}
          <button type="button" onClick={() => setEditing(true)} className={cn('flex h-6 items-center gap-1 rounded-[4px] px-1.5 text-[11.5px] font-bold hover:bg-[var(--tv-row)]', criteria.length > 0 ? 'text-[var(--tv-ink)]' : 'text-[var(--tv-ink-2)]')}>
            <Filter size={13} /> Filters{criteria.length > 0 ? ' ' + criteria.length : ''}
          </button>
          <Menu align="right" items={savedMenu} trigger={(open, toggle) => <IconBtn icon={ScanLine} label="Presets and saved screens" size={24} active={open} onClick={toggle} />} />
          <IconBtn icon={RefreshCw} label="Run again" size={24} onClick={() => setTick((n) => n + 1)} />
        </>
      }
      menu={[{ label: 'Results to a new watchlist', icon: ListPlus, onClick: () => void toWatchlist() }]}
    >
      <div className="h-full overflow-auto">
        {error !== '' && result === null ? (
          <Empty icon={ScanLine} title="The screen did not run">
            {error}
          </Empty>
        ) : result === null ? (
          <div className="flex flex-col gap-1 p-2">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <span key={i} className="tv-skeleton h-5 rounded-[3px]" />
            ))}
          </div>
        ) : result.rows.length === 0 ? (
          <Empty icon={Filter} title="Nothing matches" action={<Btn onClick={() => app.configure(w, { criteria: [] })}>Clear filters</Btn>}>
            {result.total} instruments checked.
          </Empty>
        ) : (
          <table className="tv-table w-full border-collapse text-[12px]">
            <thead>
              <tr>
                <th className="h-6 w-[38%] px-1.5 text-left text-[10.5px] font-bold uppercase tracking-[0.03em] text-[var(--tv-muted)]">Symbol</th>
                {head('price', 'Price', 'text-right')}
                {head('change_pct', 'Chg%', 'text-right')}
                {head('volume', 'Vol', 'text-right')}
                {extra.map((k) => head(k, byKey.get(k)?.label ?? k, 'text-right'))}
                <th className="w-[66px]" />
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.symbol} onClick={() => app.show(w, { symbol: r.symbol })} className={cn('h-[26px] cursor-pointer border-b border-[var(--tv-hair)]', r.symbol === current ? 'bg-[var(--tv-row-hover)]' : 'hover:bg-[var(--tv-row)]')}>
                  <td className="max-w-[180px] px-1.5">
                    <span className="flex items-baseline gap-1.5 truncate">
                      <span className="font-bold">{short(r.symbol)}</span>
                      <span className="truncate text-[11px] text-[var(--tv-muted)]">{r.group || r.name}</span>
                    </span>
                  </td>
                  <td className="num px-1.5 text-right font-semibold">{price(r.price)}</td>
                  <td className="px-1.5 text-right">
                    <Change value={r.change_pct} className="font-semibold" />
                  </td>
                  <td className="num px-1.5 text-right text-[var(--tv-ink-2)]">{compact(r.volume)}</td>
                  {extra.map((k) => (
                    <td key={k} className="num px-1.5 text-right">
                      {fmtField(byKey.get(k), r[k])}
                    </td>
                  ))}
                  <td className="px-1.5">
                    <Spark values={r.spark} width={58} height={14} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {editing && (
        <CriteriaEditor
          fields={fields}
          value={criteria}
          onClose={() => setEditing(false)}
          onSave={(c) => {
            app.configure(w, { criteria: c });
            setEditing(false);
          }}
        />
      )}
      {saveName !== null && (
        <Modal
          open
          width="sm"
          onClose={() => setSaveName(null)}
          title="Save screen"
          footer={
            <>
              <Btn onClick={() => setSaveName(null)}>Cancel</Btn>
              <Btn
                variant="primary"
                disabled={saveName.trim() === ''}
                onClick={() =>
                  void api
                    .saveScreen({ name: saveName.trim(), universe, criteria, sort })
                    .then(() => {
                      toast.success('Saved');
                      setSaveName(null);
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Save
              </Btn>
            </>
          }
        >
          <input autoFocus className={input} value={saveName} maxLength={80} onChange={(e) => setSaveName(e.target.value)} placeholder="Name, e.g. Oversold uptrends" aria-label="Screen name" />
        </Modal>
      )}
    </WidgetShell>
  );
}

function CriteriaEditor({ fields, value, onClose, onSave }: { fields: Field[]; value: Criterion[]; onClose: () => void; onSave: (c: Criterion[]) => void }): React.JSX.Element {
  const [rows, setRows] = useState<(Omit<Criterion, 'value' | 'value2'> & { value: string; value2: string })[]>(value.map((c) => ({ field: c.field, op: c.op, value: String(c.value), value2: c.value2 !== undefined ? String(c.value2) : '' })));
  const options = fields.filter((f) => f.group !== 'fundamental').map((f) => ({ value: f.key, label: f.label, group: f.group === 'quote' ? 'Quote' : 'Technical (daily)' }));
  const save = (): void => {
    const out: Criterion[] = [];
    for (const r of rows) {
      const v = Number(r.value);
      if (r.value.trim() === '' || !isFinite(v)) continue;
      const c: Criterion = { field: r.field, op: r.op, value: v };
      if (r.op === 'between') {
        const v2 = Number(r.value2);
        if (!isFinite(v2) || r.value2.trim() === '') continue;
        c.value2 = v2;
      }
      out.push(c);
    }
    onSave(out);
  };
  return (
    <Modal
      open
      width="lg"
      onClose={onClose}
      title="Filters"
      description="Technical fields are read from daily bars (up to 100 instruments)."
      footer={
        <>
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save}>
            Apply
          </Btn>
        </>
      }
    >
      <div className="flex flex-col gap-1.5">
        {rows.length === 0 && <p className="text-[12px] text-[var(--tv-muted)]">No filters: every instrument of the universe is listed.</p>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_88px_90px_auto] items-center gap-1.5">
            <Select label="Field" value={r.field} onChange={(f) => setRows(rows.map((x, j) => (j === i ? { ...x, field: f } : x)))} options={options} />
            <Select
              label="Comparison"
              value={r.op}
              onChange={(o) => setRows(rows.map((x, j) => (j === i ? { ...x, op: o as Criterion['op'] } : x)))}
              options={['>', '>=', '<', '<=', 'between'].map((o) => ({ value: o, label: o === 'between' ? 'between' : o }))}
            />
            <span className="flex items-center gap-1">
              <input className={input + ' num'} inputMode="decimal" value={r.value} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)))} aria-label="Value" />
              {r.op === 'between' && <input className={input + ' num'} inputMode="decimal" value={r.value2} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, value2: e.target.value } : x)))} aria-label="Second value" />}
            </span>
            <IconBtn icon={Trash2} label="Remove filter" size={24} onClick={() => setRows(rows.filter((_, j) => j !== i))} />
          </div>
        ))}
        <Btn className="mt-1 self-start" icon={Plus} onClick={() => setRows([...rows, { field: 'rsi14', op: '<', value: '30', value2: '' }])}>
          Add filter
        </Btn>
      </div>
    </Modal>
  );
}
