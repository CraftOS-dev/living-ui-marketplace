/**
 * Stock: what is on hand and what it is worth, what is low or out, and
 * every movement (sales, returns, deliveries, counts, damage). Deliveries,
 * counts and write-offs are entered here, scanning items in one after
 * another; every change keeps its history. Your AI agent can be asked for
 * a restock list from what sells and what is low.
 */
import { useEffect, useMemo, useState } from 'react';
import { Boxes, ClipboardList, PackagePlus, Plus, Sparkles, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { qty as qtyText, toMinor, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href, navigate, replaceQuery } from '../lib/router.ts';
import { useScanner } from '../lib/scanner.ts';
import type { StockLevel, StockReason } from '../lib/types.ts';
import { DateRange, Kpi, LoadMore, MoneyField, SearchField, StockBadge, presetRange, useDebounced } from '../components/common.tsx';
import type { Range } from '../components/common.tsx';
import { Button, Empty, Field, IconButton, Modal, PageHeader, Panel, Segmented, Select, Tabs, inputCls } from '../components/ui.tsx';

type ChangeReason = 'receive' | 'count' | 'adjust' | 'damage' | 'loss';

const REASONS: Record<StockReason, string> = {
  sale: 'Sale',
  return: 'Return',
  receive: 'Received',
  adjust: 'Adjusted',
  count: 'Counted',
  damage: 'Damaged',
  loss: 'Lost',
  opening: 'Opening stock',
};

const CHANGE_HELP: Record<ChangeReason, { title: string; qty: string; button: string }> = {
  receive: { title: 'Receive stock', qty: 'Received', button: 'Receive' },
  count: { title: 'Count stock', qty: 'Counted', button: 'Save the count' },
  adjust: { title: 'Adjust stock', qty: 'Change (+ or -)', button: 'Adjust' },
  damage: { title: 'Write off damaged stock', qty: 'Damaged', button: 'Write off' },
  loss: { title: 'Write off lost stock', qty: 'Lost', button: 'Write off' },
};

interface ChangeLine {
  variant: string;
  name: string;
  sku: string;
  onHand: number;
  unit: string;
  qty: string;
  cost: string;
}

export function StockChangeDialog({ open, onClose, initialReason = 'receive', initial }: { open: boolean; onClose: () => void; initialReason?: ChangeReason; initial?: ChangeLine[] | undefined }): React.JSX.Element {
  const { money, catalog } = useStore();
  const [reason, setReason] = useState<ChangeReason>(initialReason);
  const [lines, setLines] = useState<ChangeLine[]>([]);
  const [q, setQ] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setReason(initialReason);
      setLines(initial ?? []);
      setQ('');
      setNote('');
    }
  }, [open, initialReason, initial]);

  const variants = useMemo(() => {
    const out: ChangeLine[] = [];
    for (const p of catalog?.products ?? [])
      for (const v of p.variants) {
        if (v.archived) continue;
        out.push({ variant: v.id, name: p.name + (v.title !== '' ? ' · ' + v.title : ''), sku: v.sku !== '' ? v.sku : v.barcode, onHand: v.stock, unit: p.unit, qty: '', cost: v.cost === 0 ? '' : money.plain(v.cost) });
      }
    return out;
  }, [catalog, money]);

  const addLine = (l: ChangeLine): void => {
    setLines((cur) => {
      const i = cur.findIndex((x) => x.variant === l.variant);
      if (i >= 0) {
        // Scanning the same item again counts one more.
        if (reason === 'adjust') return cur;
        return cur.map((x, k) => (k === i ? { ...x, qty: String(Number(x.qty.replace(',', '.') || '0') + 1) } : x));
      }
      return [...cur, { ...l, qty: reason === 'adjust' ? '' : '1' }];
    });
    setQ('');
  };

  useScanner((code) => {
    const c = code.toLowerCase();
    const hit = (catalog?.products ?? []).flatMap((p) => p.variants.filter((v) => !v.archived && (v.barcode.toLowerCase() === c || v.sku.toLowerCase() === c)).map((v) => v.id))[0];
    const line = variants.find((x) => x.variant === hit);
    if (line !== undefined) addLine(line);
    else toast.error('No product has the code ' + code);
  }, open);

  const term = q.trim().toLowerCase();
  const matches = term === '' ? [] : variants.filter((v) => v.name.toLowerCase().includes(term) || v.sku.toLowerCase().includes(term)).slice(0, 8);
  const lineOk = (l: ChangeLine): boolean => {
    const n = Number(l.qty.replace(',', '.'));
    if (l.qty.trim() === '' || !Number.isFinite(n) || Math.round(n * 1000) !== n * 1000) return false;
    if (reason === 'count') return n >= 0;
    if (reason === 'adjust') return n !== 0;
    if (reason === 'receive' && l.cost.trim() !== '' && toMinor(l.cost, money.digits) === null) return false;
    return n > 0;
  };
  const ok = lines.length > 0 && lines.every(lineOk);
  const h = CHANGE_HELP[reason];

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.changeStock(
        reason,
        lines.map((l) => ({ variant: l.variant, qty: Number(l.qty.replace(',', '.')), cost: reason === 'receive' && l.cost.trim() !== '' ? l.cost.trim() : undefined })),
        note.trim() || undefined,
      );
      toast.success(h.title + ': ' + lines.length + (lines.length === 1 ? ' item' : ' items'));
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={h.title}
      xl
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={PackagePlus} loading={busy} disabled={!ok} onClick={() => void save()}>
            {h.button}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Segmented
          label="What happened"
          value={reason}
          onChange={setReason}
          options={[
            { value: 'receive', label: 'Received' },
            { value: 'count', label: 'Counted' },
            { value: 'adjust', label: 'Adjust' },
            { value: 'damage', label: 'Damaged' },
            { value: 'loss', label: 'Lost' },
          ]}
          className="self-start"
        />
        <div className="relative">
          <SearchField value={q} onChange={setQ} placeholder="Find an item, or scan its barcode" autoFocus onEnter={() => matches[0] !== undefined && addLine(matches[0])} />
          {matches.length > 0 && (
            <ul className="ps-on-card absolute left-0 right-0 top-[calc(100%+4px)] z-10 max-h-64 overflow-y-auto rounded-[var(--ps-r-md)] border border-[var(--ps-line)] bg-[var(--ps-card)] p-1 shadow-[var(--ps-shadow)]">
              {matches.map((m) => (
                <li key={m.variant}>
                  <button type="button" onClick={() => addLine(m)} className="flex w-full items-center gap-2 rounded-[var(--ps-r-sm)] px-2 py-1.5 text-left hover:bg-[var(--ps-row)]">
                    <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">{m.name}</span>
                    <span className="mono shrink-0 text-[var(--ps-muted)]">{m.sku}</span>
                    <span className="num shrink-0 text-[12px] text-[var(--ps-muted)]">{qtyText(m.onHand)} on hand</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        {lines.length === 0 ? (
          <p className="rounded-[var(--ps-r-md)] bg-[var(--ps-row)] px-3 py-6 text-center text-[13px] text-[var(--ps-muted)]">No items yet</p>
        ) : (
          <div className="overflow-x-auto rounded-[var(--ps-r-md)] border border-[var(--ps-line)]">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="text-right">On hand</th>
                  <th className="text-right">{h.qty}</th>
                  {reason === 'receive' && <th className="text-right">Unit cost</th>}
                  <th className="text-right">After</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const n = Number(l.qty.replace(',', '.'));
                  const after = !Number.isFinite(n) || l.qty.trim() === '' ? null : reason === 'count' ? n : reason === 'receive' || reason === 'adjust' ? l.onHand + n : l.onHand - n;
                  return (
                    <tr key={l.variant}>
                      <td>
                        <span className="block font-semibold">{l.name}</span>
                        {l.sku !== '' && <span className="mono block text-[var(--ps-muted)]">{l.sku}</span>}
                      </td>
                      <td className="num text-right text-[var(--ps-ink-2)]">{qtyText(l.onHand)}</td>
                      <td className="text-right">
                        <input className={cn(inputCls, 'num ml-auto w-24 text-right', l.qty !== '' && !lineOk(l) && 'border-[var(--ps-red)]')} inputMode="decimal" value={l.qty} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: e.target.value } : x)))} aria-label={h.qty} />
                      </td>
                      {reason === 'receive' && (
                        <td className="text-right">
                          <MoneyField value={l.cost} onChange={(v) => setLines(lines.map((x, k) => (k === i ? { ...x, cost: v } : x)))} money={money} label="Unit cost" className="ml-auto w-28" />
                        </td>
                      )}
                      <td className={cn('num text-right font-semibold', after !== null && after < 0 && 'text-[var(--ps-red-text)]')}>{after === null ? '' : qtyText(Math.round(after * 1000) / 1000)}</td>
                      <td>
                        <IconButton icon={Trash2} label={'Remove ' + l.name} variant="danger" onClick={() => setLines(lines.filter((_, k) => k !== i))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <Field label="Note">
          <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder={reason === 'receive' ? 'Supplier and delivery note number' : 'Why'} />
        </Field>
      </div>
    </Modal>
  );
}

function Levels({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { money } = useStore();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [status, setStatus] = useState(query.get('status') ?? '');
  const [change, setChange] = useState<{ reason: ChangeReason; lines?: ChangeLine[] } | null>(null);
  const [asking, setAsking] = useState(false);
  const term = useDebounced(q, 250);
  useEffect(() => replaceQuery('stock', { q: term, status }), [term, status]);
  const list = useLive(() => api.stock({ q: term.trim() || undefined, status: status || undefined }), ['variants', 'stock_moves', 'products'], [term, status]);
  const data = list.data;
  const rows = data?.levels ?? [];

  const lineOf = (l: StockLevel): ChangeLine => ({ variant: l.variant, name: l.name, sku: l.sku !== '' ? l.sku : l.barcode, onHand: l.stock, unit: l.unit, qty: '', cost: l.cost === 0 ? '' : money.plain(l.cost) });

  const askRestock = async (): Promise<void> => {
    setAsking(true);
    try {
      const r = await api.ask('restock', {});
      toast.success(r.asked ? 'Your AI agent is drafting a restock list' : r.message);
      navigate('requests');
    } catch {
      // Shown by the transport.
    } finally {
      setAsking(false);
    }
  };

  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Stock value at cost" value={data !== null ? money.fmt(data.value) : ''} tone="dark" />
        <Kpi label="Units on hand" value={data !== null ? qtyText(data.units) : ''} />
        <Kpi label="Low" value={data?.low ?? ''} note={(data?.low ?? 0) > 0 ? 'At or under their low level' : 'Nothing low'} tone="sand" />
        <Kpi label="Out of stock" value={data?.out ?? ''} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Name, SKU or barcode" className="w-full sm:w-64" />
        <Select
          ariaLabel="Which items"
          value={status}
          onChange={setStatus}
          className="w-40"
          options={[
            { value: '', label: 'All counted items' },
            { value: 'low', label: 'Low or out' },
            { value: 'out', label: 'Out of stock' },
          ]}
        />
        <span className="flex-1" />
        <Button icon={Sparkles} loading={asking} onClick={() => void askRestock()}>
          Restock list
        </Button>
        <Button icon={ClipboardList} onClick={() => setChange({ reason: 'count' })}>
          Count
        </Button>
        <Button variant="primary" icon={PackagePlus} onClick={() => setChange({ reason: 'receive' })}>
          Receive
        </Button>
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={Boxes} title={term !== '' || status !== '' ? 'Nothing matches' : 'No stock is counted yet'} compact>
            {term === '' && status === '' ? 'Turn on Count stock for a product, or receive a delivery.' : undefined}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="hidden md:table-cell">SKU</th>
                  <th className="text-right">On hand</th>
                  <th className="hidden text-right sm:table-cell">Low at</th>
                  <th className="hidden text-right lg:table-cell">Cost</th>
                  <th className="hidden text-right lg:table-cell">Value</th>
                  <th>Status</th>
                  <th className="w-24" />
                </tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.variant}>
                    <td>
                      <a href={href('product', { id: l.product })} className="font-semibold hover:underline">
                        {l.name}
                      </a>
                      {l.category !== null && <span className="block text-[12px] text-[var(--ps-muted)]">{l.category.name}</span>}
                    </td>
                    <td className="mono hidden text-[var(--ps-ink-2)] md:table-cell">{l.sku}</td>
                    <td className={cn('num text-right font-semibold', l.stock < 0 && 'text-[var(--ps-red-text)]')}>
                      {qtyText(l.stock)}
                      {l.unit !== '' ? ' ' + l.unit : ''}
                    </td>
                    <td className="num hidden text-right text-[var(--ps-ink-2)] sm:table-cell">{qtyText(l.low_at)}</td>
                    <td className="num hidden text-right text-[var(--ps-ink-2)] lg:table-cell">{money.fmt(Math.round(l.cost))}</td>
                    <td className="num hidden text-right lg:table-cell">{money.fmt(l.value)}</td>
                    <td>
                      <StockBadge status={l.status} />
                    </td>
                    <td className="text-right">
                      <Button size="sm" variant="ghost" icon={Plus} onClick={() => setChange({ reason: 'receive', lines: [{ ...lineOf(l), qty: '1' }] })}>
                        Stock
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <StockChangeDialog open={change !== null} onClose={() => setChange(null)} initialReason={change?.reason ?? 'receive'} initial={change?.lines} />
    </>
  );
}

function History(): React.JSX.Element {
  const { money } = useStore();
  const [range, setRange] = useState<Range>(presetRange('7d'));
  const [reason, setReason] = useState('');
  const [pages, setPages] = useState(1);
  useEffect(() => setPages(1), [range, reason]);
  const list = useLive(() => api.moves({ reason: reason || undefined, from: range.from, to: range.to, limit: 100 * pages }), ['stock_moves'], [range.from, range.to, reason, pages]);
  const rows = list.data?.moves ?? [];
  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <DateRange value={range} onChange={setRange} />
        <Select ariaLabel="Kind" value={reason} onChange={setReason} className="w-44" options={[{ value: '', label: 'Every movement' }, ...Object.entries(REASONS).map(([k, v]) => ({ value: k, label: v }))]} />
      </div>
      <Panel padded={false}>
        {list.loading && rows.length === 0 ? (
          <div className="py-10" />
        ) : rows.length === 0 ? (
          <Empty icon={Boxes} title="No stock movements in these days" compact />
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Item</th>
                  <th>What</th>
                  <th className="text-right">Change</th>
                  <th className="text-right">After</th>
                  <th className="hidden lg:table-cell">By</th>
                  <th className="hidden md:table-cell">Note</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((m) => (
                  <tr key={m.id}>
                    <td className="whitespace-nowrap text-[var(--ps-ink-2)]">{when(m.created)}</td>
                    <td className="font-semibold">
                      <a href={href('product', { id: m.product })} className="hover:underline">
                        {m.name}
                      </a>
                    </td>
                    <td>
                      {m.order !== '' ? (
                        <a href={href('order', { id: m.order })} className="hover:underline">
                          {REASONS[m.reason] ?? m.reason}
                        </a>
                      ) : (
                        (REASONS[m.reason] ?? m.reason)
                      )}
                      {m.reason === 'receive' && m.unit_cost > 0 ? <span className="text-[var(--ps-muted)]"> at {money.fmt(Math.round(m.unit_cost))}</span> : null}
                    </td>
                    <td className={cn('num text-right font-semibold', m.delta > 0 ? 'text-[var(--ps-green-text)]' : m.delta < 0 ? 'text-[var(--ps-red-text)]' : '')}>{(m.delta > 0 ? '+' : '') + qtyText(m.delta)}</td>
                    <td className="num text-right">{qtyText(m.after)}</td>
                    <td className="hidden text-[var(--ps-ink-2)] lg:table-cell">{m.by}</td>
                    <td className="hidden max-w-[240px] truncate text-[var(--ps-ink-2)] md:table-cell">{m.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <LoadMore more={list.data?.more === true} loading={list.loading} onMore={() => setPages((n) => n + 1)} />
      </Panel>
    </>
  );
}

export function StockPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [tab, setTab] = useState<'levels' | 'history'>(query.get('tab') === 'history' ? 'history' : 'levels');
  return (
    <div>
      <PageHeader title="Stock" subtitle="On hand, low and out, and every movement" />
      <Tabs
        label="Stock"
        value={tab}
        onChange={(t) => {
          setTab(t);
          replaceQuery('stock', { tab: t === 'history' ? 'history' : '' });
        }}
        className="mb-3 px-0"
        options={[
          { value: 'levels', label: 'On hand' },
          { value: 'history', label: 'History' },
        ]}
      />
      {tab === 'levels' ? <Levels query={query} /> : <History />}
    </div>
  );
}
