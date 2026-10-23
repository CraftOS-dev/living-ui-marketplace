/**
 * Promotions and gift cards. A promotion is a discount given by hand from
 * the register, applied by itself when its rules match (a happy hour, buy
 * two get one), or unlocked by a code; it can be limited to some products
 * or categories, a minimum spend, days and hours, and a date range. Gift
 * cards: what is outstanding, each card's balance and history, issuing a
 * card without a sale, adjusting and disabling.
 */
import { useEffect, useMemo, useState } from 'react';
import { BadgePercent, Check, Coins, CreditCard, Gift, Pencil, Plus } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import type { DiscountInput } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { toMinor, when } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { href, replaceQuery } from '../lib/router.ts';
import type { Discount, GiftCard } from '../lib/types.ts';
import { Kpi, MoneyField, SearchField, useDebounced } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Badge, Button, Empty, Field, IconButton, Modal, PageHeader, Panel, Segmented, Select, Tabs, Toggle, inputCls } from '../components/ui.tsx';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MODES: Record<Discount['mode'], string> = { manual: 'Given by hand', auto: 'Automatic', code: 'With a code' };

function PromotionEditor({ promo, open, onClose }: { promo: Discount | null; open: boolean; onClose: () => void }): React.JSX.Element {
  const { money, catalog } = useStore();
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Discount['kind']>('percent');
  const [value, setValue] = useState('');
  const [scope, setScope] = useState<Discount['scope']>('order');
  const [applies, setApplies] = useState<Discount['applies']>('all');
  const [cats, setCats] = useState<string[]>([]);
  const [prods, setProds] = useState<string[]>([]);
  const [mode, setMode] = useState<Discount['mode']>('manual');
  const [code, setCode] = useState('');
  const [minSubtotal, setMinSubtotal] = useState('');
  const [minQty, setMinQty] = useState('');
  const [buy, setBuy] = useState('1');
  const [get, setGet] = useState('1');
  const [days, setDays] = useState<number[]>([]);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [managerOnly, setManagerOnly] = useState(false);
  const [productQ, setProductQ] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    const d = promo;
    setName(d?.name ?? '');
    setKind(d?.kind ?? 'percent');
    setValue(d === null ? '' : d.kind === 'amount' ? money.plain(d.value) : String(d.value));
    setScope(d?.scope ?? 'order');
    setApplies(d?.applies ?? 'all');
    setCats(d?.categories ?? []);
    setProds(d?.products ?? []);
    setMode(d?.mode ?? 'manual');
    setCode(d?.code ?? '');
    setMinSubtotal(d !== null && d.min_subtotal > 0 ? money.plain(d.min_subtotal) : '');
    setMinQty(d !== null && d.min_qty > 0 ? String(d.min_qty) : '');
    setBuy(String(d !== null && d.buy_qty > 0 ? d.buy_qty : 1));
    setGet(String(d !== null && d.get_qty > 0 ? d.get_qty : 1));
    setDays(d?.days ?? []);
    setStart(d?.start_time ?? '');
    setEnd(d?.end_time ?? '');
    setFrom(d?.starts_on ?? '');
    setTo(d?.ends_on ?? '');
    setManagerOnly(d?.manager_only ?? false);
    setProductQ('');
  }, [open, promo, money]);

  const valueOk = kind === 'amount' ? (toMinor(value, money.digits) ?? 0) > 0 : Number(value) > 0 && Number(value) <= 100;
  const codeOk = mode !== 'code' || /^[A-Za-z0-9_-]{3,40}$/.test(code.trim());
  const targetOk = scope === 'order' || applies === 'all' || (applies === 'categories' ? cats.length > 0 : prods.length > 0);
  const ok = name.trim() !== '' && valueOk && codeOk && targetOk && (from === '' || to === '' || to >= from);

  const products = useMemo(() => {
    const t = productQ.trim().toLowerCase();
    return (catalog?.products ?? []).filter((p) => !p.archived && (t === '' || p.name.toLowerCase().includes(t) || prods.includes(p.id))).slice(0, 40);
  }, [catalog, productQ, prods]);

  const save = async (): Promise<void> => {
    setBusy(true);
    const input: DiscountInput = {
      id: promo?.id,
      name: name.trim(),
      kind,
      value: value.trim(),
      scope: kind === 'bogo' ? 'item' : scope,
      applies: scope === 'order' && kind !== 'bogo' ? 'all' : applies,
      categories: cats,
      products: prods,
      mode,
      code: mode === 'code' ? code.trim().toUpperCase() : undefined,
      min_subtotal: minSubtotal.trim() === '' ? '0' : minSubtotal.trim(),
      min_qty: minQty.trim() === '' ? 0 : Number(minQty),
      buy_qty: kind === 'bogo' ? Number(buy) : undefined,
      get_qty: kind === 'bogo' ? Number(get) : undefined,
      days,
      start_time: start,
      end_time: end,
      starts_on: from,
      ends_on: to,
      manager_only: managerOnly,
    };
    try {
      await api.saveDiscount(input);
      toast.success('Saved ' + name.trim());
      onClose();
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };

  const itemScope = kind === 'bogo' || scope === 'item';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={promo === null ? 'New promotion' : 'Edit ' + promo.name}
      xl
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <Field label="Name" hint="Shown on the receipt">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Happy hour" />
          </Field>
          <Field group label="Discount">
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Kind"
                value={kind}
                onChange={(k) => {
                  setKind(k);
                  setValue(k === 'bogo' ? '100' : '');
                }}
                options={[
                  { value: 'percent', label: 'Percent off' },
                  { value: 'amount', label: 'Amount off' },
                  { value: 'bogo', label: 'Buy X get Y' },
                ]}
              />
              {kind === 'amount' ? (
                <MoneyField value={value} onChange={setValue} money={money} label="Amount off" className="w-32" />
              ) : (
                <span className="flex items-center gap-1">
                  <input className={inputCls + ' num w-20 text-right'} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-label="Percent" />
                  <span className="text-[13px] text-[var(--ps-muted)]">%{kind === 'bogo' ? ' off the free items' : ''}</span>
                </span>
              )}
            </div>
          </Field>
          {kind === 'bogo' && (
            <div className="flex items-center gap-2 text-[13px]">
              Buy
              <input className={inputCls + ' num w-16 text-right'} inputMode="numeric" value={buy} onChange={(e) => setBuy(e.target.value.replace(/\D/g, ''))} aria-label="Buy" />
              get
              <input className={inputCls + ' num w-16 text-right'} inputMode="numeric" value={get} onChange={(e) => setGet(e.target.value.replace(/\D/g, ''))} aria-label="Get" />
              {Number(value) >= 100 ? 'free' : 'at ' + value + '% off'}
            </div>
          )}
          {kind !== 'bogo' && (
            <Field group label="Takes off">
              <Segmented
                label="Takes off"
                value={scope}
                onChange={setScope}
                options={[
                  { value: 'order', label: 'The whole sale' },
                  { value: 'item', label: 'Some items' },
                ]}
              />
            </Field>
          )}
          {itemScope && (
            <Field group label="Which items">
              <div className="flex flex-col gap-2">
                <Segmented
                  label="Which items"
                  value={applies}
                  onChange={setApplies}
                  options={[
                    { value: 'all', label: 'Everything' },
                    { value: 'categories', label: 'Categories' },
                    { value: 'products', label: 'Products' },
                  ]}
                  className="self-start"
                />
                {applies === 'categories' && (
                  <div className="flex flex-wrap gap-1.5">
                    {(catalog?.categories ?? []).map((c) => {
                      const on = cats.includes(c.id);
                      return (
                        <button key={c.id} type="button" aria-pressed={on} onClick={() => setCats(on ? cats.filter((x) => x !== c.id) : [...cats, c.id])} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ps-r)] border px-2 text-[12px] font-semibold', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] hover:bg-[var(--ps-row)]')}>
                          {on && <Check size={12} />}
                          {c.name}
                        </button>
                      );
                    })}
                  </div>
                )}
                {applies === 'products' && (
                  <div className="flex flex-col gap-1.5">
                    <SearchField value={productQ} onChange={setProductQ} placeholder="Find products" />
                    <ul className="max-h-48 overflow-y-auto rounded-[var(--ps-r)] border border-[var(--ps-line)]">
                      {products.map((p) => {
                        const on = prods.includes(p.id);
                        return (
                          <li key={p.id}>
                            <label className="flex items-center gap-2 px-2 py-1.5 text-[13px] hover:bg-[var(--ps-row)]">
                              <input type="checkbox" checked={on} onChange={() => setProds(on ? prods.filter((x) => x !== p.id) : [...prods, p.id])} />
                              {p.name}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                    <span className="text-[12px] text-[var(--ps-muted)]">{prods.length} chosen</span>
                  </div>
                )}
              </div>
            </Field>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <Field label="How it applies">
            <Select
              ariaLabel="How it applies"
              value={mode}
              onChange={(m) => setMode(m as Discount['mode'])}
              options={[
                { value: 'manual', label: 'Given by hand at the register' },
                { value: 'auto', label: 'By itself when the rules match' },
                { value: 'code', label: 'When the customer gives a code' },
              ]}
            />
          </Field>
          {mode === 'code' && (
            <Field label="Code" error={code !== '' && !codeOk ? '3 to 40 letters, digits, - or _' : null}>
              <input className={inputCls + ' uppercase tracking-wider'} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} placeholder="SUMMER10" />
            </Field>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Field label="Minimum spend">
              <MoneyField value={minSubtotal} onChange={setMinSubtotal} money={money} label="Minimum spend" />
            </Field>
            {itemScope && (
              <Field label="Minimum quantity">
                <input className={inputCls + ' num text-right'} inputMode="decimal" value={minQty} onChange={(e) => setMinQty(e.target.value)} placeholder="0" />
              </Field>
            )}
          </div>
          <Field group label="Days" hint="None chosen: every day">
            <div className="flex flex-wrap gap-1">
              {DAYS.map((d, i) => {
                const on = days.includes(i);
                return (
                  <button key={d} type="button" aria-pressed={on} onClick={() => setDays(on ? days.filter((x) => x !== i) : [...days, i].sort())} className={cn('h-7 w-11 rounded-[var(--ps-r)] border text-[12px] font-semibold', on ? 'ps-on-ink border-[var(--ps-ink)] bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'border-[var(--ps-line)] hover:bg-[var(--ps-row)]')}>
                    {d}
                  </button>
                );
              })}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-2">
            <Field label="From time">
              <input type="time" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
            </Field>
            <Field label="Until time">
              <input type="time" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
            </Field>
            <Field label="Starts on">
              <input type="date" className={inputCls} value={from} onChange={(e) => setFrom(e.target.value)} />
            </Field>
            <Field label="Ends on" error={from !== '' && to !== '' && to < from ? 'Before the start' : null}>
              <input type="date" className={inputCls} value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </Field>
          </div>
          <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
            <span>
              <span className="block text-[13px] font-semibold">Needs a manager</span>
              <span className="block text-[12px] text-[var(--ps-muted)]">Only someone with no discount limit may use it.</span>
            </span>
            <Toggle checked={managerOnly} onChange={setManagerOnly} label="Needs a manager" />
          </label>
        </section>
      </div>
    </Modal>
  );
}

function PromotionList(): React.JSX.Element {
  const list = useLive(() => api.discounts(), ['discounts'], []);
  const [edit, setEdit] = useState<Discount | 'new' | null>(null);
  const rows = list.data?.discounts ?? [];
  const toggle = async (d: Discount): Promise<void> => {
    try {
      await api.saveDiscount({ id: d.id, active: !d.active });
    } catch {
      // Shown by the transport.
    }
  };
  return (
    <>
      <div className="mb-3 flex justify-end">
        <Button variant="primary" icon={Plus} onClick={() => setEdit('new')}>
          New promotion
        </Button>
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? (
          <Empty icon={BadgePercent} title="No promotions yet" compact>
            Discounts given by hand, happy hours, buy two get one free and coupon codes.
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Promotion</th>
                  <th className="hidden md:table-cell">How</th>
                  <th className="text-right">Used</th>
                  <th>Now</th>
                  <th className="w-10">On</th>
                  <th className="w-20" />
                </tr>
              </thead>
              <tbody>
                {rows.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <span className="block font-semibold">{d.name}</span>
                      <span className="block text-[12px] text-[var(--ps-muted)]">{d.summary}</span>
                    </td>
                    <td className="hidden text-[var(--ps-ink-2)] md:table-cell">
                      {MODES[d.mode]}
                      {d.code !== '' && <span className="mono ml-1 font-semibold text-[var(--ps-ink)]">{d.code}</span>}
                    </td>
                    <td className="num text-right">{d.uses}</td>
                    <td>{!d.active ? <Badge tone="neutral">Off</Badge> : d.live ? <Badge tone="good">Running</Badge> : <Badge tone="warn">Waiting</Badge>}</td>
                    <td>
                      <Toggle checked={d.active} onChange={() => void toggle(d)} label={(d.active ? 'Turn off ' : 'Turn on ') + d.name} />
                    </td>
                    <td className="text-right">
                      <span className="inline-flex">
                        <IconButton icon={Pencil} label={'Edit ' + d.name} onClick={() => setEdit(d)} />
                        <DeleteButton collection="discounts" id={d.id} name={d.name} />
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <PromotionEditor promo={edit === 'new' ? null : edit} open={edit !== null} onClose={() => setEdit(null)} />
    </>
  );
}

function CardDialog({ card, onClose }: { card: GiftCard | null; onClose: () => void }): React.JSX.Element {
  const { money } = useStore();
  const d = useLive(() => (card === null ? Promise.resolve(null) : api.giftCard(card.code)), ['gift_cards', 'account_moves'], [card?.code]);
  const [delta, setDelta] = useState('');
  const [dir, setDir] = useState<'add' | 'take'>('add');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDelta('');
    setNote('');
    setDir('add');
  }, [card]);
  const g = d.data?.gift_card ?? card;
  const n = toMinor(delta, money.digits);
  const adjust = async (): Promise<void> => {
    if (g === null || n === null || n <= 0) return;
    setBusy(true);
    try {
      await api.adjustGiftCard(g.code, money.plain(dir === 'add' ? n : -n), note.trim());
      toast.success('Card balance changed');
      setDelta('');
      setNote('');
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  const setStatus = async (status: 'active' | 'disabled'): Promise<void> => {
    if (g === null) return;
    try {
      await api.saveGiftCard({ id: g.id, status });
      toast.success(status === 'active' ? 'Card turned on' : 'Card disabled');
    } catch {
      // Shown by the transport.
    }
  };
  return (
    <Modal
      open={card !== null}
      onClose={onClose}
      title={g !== null ? 'Gift card ' + g.masked : 'Gift card'}
      description={g !== null ? 'Number ' + g.code : undefined}
      wide
      footer={
        g !== null ? (
          <>
            <DeleteButton collection="gift_cards" id={g.id} name={'card ' + g.masked} variant="button" onDeleted={onClose} />
            <span className="flex-1" />
            {g.status === 'active' ? <Button onClick={() => void setStatus('disabled')}>Disable the card</Button> : <Button onClick={() => void setStatus('active')}>Turn the card on</Button>}
            <Button variant="primary" onClick={onClose}>
              Done
            </Button>
          </>
        ) : undefined
      }
    >
      {g !== null && (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Kpi label="Balance" value={money.fmt(g.balance)} tone="dark" note={g.status === 'disabled' ? 'Disabled' : undefined} />
            <Kpi label="Loaded in total" value={money.fmt(g.issued)} note={d.data?.customer !== null && d.data?.customer !== undefined ? 'Belongs to ' + d.data.customer.name : undefined} />
          </div>
          <section className="flex flex-col gap-2">
            <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">Adjust the balance</h3>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                label="Direction"
                value={dir}
                onChange={setDir}
                options={[
                  { value: 'add', label: 'Add' },
                  { value: 'take', label: 'Take off' },
                ]}
              />
              <MoneyField value={delta} onChange={setDelta} money={money} label="Amount" className="w-32" />
              <input className={inputCls + ' min-w-[160px] flex-1'} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} placeholder="Why" aria-label="Why" />
              <Button icon={Coins} loading={busy} disabled={n === null || n <= 0 || note.trim() === ''} onClick={() => void adjust()}>
                Save
              </Button>
            </div>
          </section>
          <section>
            <h3 className="mb-1 text-[12px] font-bold text-[var(--ps-ink-2)]">History</h3>
            <ul className="divide-y divide-[var(--ps-hair)] rounded-[var(--ps-r-md)] border border-[var(--ps-line)]">
              {(d.data?.moves ?? []).map((m) => (
                <li key={m.id} className="flex items-baseline gap-3 px-3 py-1.5 text-[12px]">
                  <span className="w-32 shrink-0 text-[var(--ps-muted)]">{when(m.created)}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {m.order !== '' ? (
                      <a href={href('order', { id: m.order })} className="hover:underline">
                        {m.note}
                      </a>
                    ) : (
                      m.note
                    )}
                  </span>
                  <span className={cn('num shrink-0 font-semibold', m.delta > 0 ? 'text-[var(--ps-green-text)]' : 'text-[var(--ps-red-text)]')}>{money.signed(m.delta)}</span>
                  <span className="num w-20 shrink-0 text-right">{money.fmt(m.after)}</span>
                </li>
              ))}
              {(d.data?.moves ?? []).length === 0 && <li className="px-3 py-3 text-center text-[12px] text-[var(--ps-muted)]">No history yet</li>}
            </ul>
          </section>
        </div>
      )}
    </Modal>
  );
}

function IssueDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element {
  const { money } = useStore();
  const [amount, setAmount] = useState('');
  const [code, setCode] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setAmount('');
      setCode('');
      setNote('');
    }
  }, [open]);
  const n = toMinor(amount, money.digits);
  const issue = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.saveGiftCard({ code: code.trim() || undefined, amount: money.plain(n ?? 0), note: note.trim() || undefined });
      toast.success('Card ' + r.gift_card.masked + ' issued with ' + money.fmt(r.gift_card.balance));
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
      title="Issue a gift card"
      description="Without a sale: a replacement, a prize or a goodwill gesture. Cards sold to customers are sold at the register."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Gift} loading={busy} disabled={n === null || n < 0 || note.trim() === ''} onClick={() => void issue()}>
            Issue
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Balance">
          <MoneyField value={amount} onChange={setAmount} money={money} label="Balance" autoFocus />
        </Field>
        <Field label="Card number" hint="Empty to make one">
          <input className={inputCls + ' mono'} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={40} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Why">
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} maxLength={400} placeholder="Replacement for a damaged card" />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function GiftCards({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { money } = useStore();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState<GiftCard | null>(null);
  const [issuing, setIssuing] = useState(false);
  const term = useDebounced(q, 250);
  const list = useLive(() => api.giftCards({ q: term.trim() || undefined, status: status || undefined, limit: 200 }), ['gift_cards'], [term, status]);
  const rows = list.data?.gift_cards ?? [];
  return (
    <>
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Owed on gift cards" value={list.data !== null ? money.fmt(list.data.outstanding) : ''} tone="dark" note="Balances customers can still spend" />
        <Kpi label="Cards in use" value={list.data?.active ?? ''} />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <SearchField value={q} onChange={setQ} placeholder="Card number" className="w-full sm:w-64" />
        <Select
          ariaLabel="Which cards"
          value={status}
          onChange={setStatus}
          className="w-44"
          options={[
            { value: '', label: 'All cards' },
            { value: 'with_balance', label: 'With a balance' },
            { value: 'active', label: 'Active' },
            { value: 'disabled', label: 'Disabled' },
          ]}
        />
        <span className="flex-1" />
        <Button variant="primary" icon={Plus} onClick={() => setIssuing(true)}>
          Issue a card
        </Button>
      </div>
      <Panel padded={false}>
        {rows.length === 0 ? (
          <Empty icon={CreditCard} title={term !== '' ? 'No card has that number' : 'No gift cards yet'} compact>
            {term === '' ? 'Gift cards are sold at the register from the keypad or the sale menu.' : undefined}
          </Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Card</th>
                  <th className="text-right">Balance</th>
                  <th className="hidden text-right sm:table-cell">Loaded</th>
                  <th className="hidden md:table-cell">Last used</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((g) => (
                  <tr key={g.id} className="cursor-pointer" onClick={() => setOpen(g)}>
                    <td className="mono font-semibold">{g.code}</td>
                    <td className="num text-right font-semibold">{money.fmt(g.balance)}</td>
                    <td className="num hidden text-right text-[var(--ps-ink-2)] sm:table-cell">{money.fmt(g.issued)}</td>
                    <td className="hidden text-[var(--ps-ink-2)] md:table-cell">{g.last_used !== '' ? when(g.last_used) : 'Never'}</td>
                    <td>{g.status === 'active' ? <Badge tone={g.balance > 0 ? 'good' : 'neutral'}>{g.balance > 0 ? 'Active' : 'Empty'}</Badge> : <Badge tone="bad">Disabled</Badge>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
      <CardDialog card={open} onClose={() => setOpen(null)} />
      <IssueDialog open={issuing} onClose={() => setIssuing(false)} />
    </>
  );
}

export function PromotionsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const [tab, setTab] = useState<'promotions' | 'gift_cards'>(query.get('tab') === 'gift_cards' ? 'gift_cards' : 'promotions');
  return (
    <div>
      <PageHeader title="Promotions and gift cards" subtitle="Discounts that apply by hand, by themselves or with a code; gift card balances" />
      <Tabs
        label="Promotions"
        value={tab}
        onChange={(t) => {
          setTab(t);
          replaceQuery('promotions', { tab: t === 'gift_cards' ? 'gift_cards' : '' });
        }}
        className="mb-3 px-0"
        options={[
          { value: 'promotions', label: 'Promotions' },
          { value: 'gift_cards', label: 'Gift cards' },
        ]}
      />
      {tab === 'promotions' ? <PromotionList /> : <GiftCards query={query} />}
    </div>
  );
}
