/**
 * Reorder: everything at or below its reorder point (counting what is
 * already on order), grouped by supplier, with a suggested quantity that
 * fills it back up to its target level. Each suggestion says why in plain
 * words and can be changed. One click turns a supplier's lines into a draft
 * purchase order; your AI agent can draft them all, or do it on its own
 * whenever something runs low.
 */
import { useMemo, useRef, useState } from 'react';
import { CircleCheck, Info, ShoppingCart, Sparkles, Store, Truck } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AskAgent } from '../components/AskAgent.tsx';
import { LevelBar, Stepper } from '../components/controls.tsx';
import { Card, Empty, PageHeader, PillButton, Popover, TextLink, Toggle } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { dayPhrase } from '../lib/dates.ts';
import { money, normalizeNumber, plain, plural, qty, unitCost } from '../lib/format.ts';
import { ItemThumb } from '../lib/icons.tsx';
import { useLive } from '../lib/live.ts';
import { navigate } from '../lib/router.ts';
import type { ReorderGroup, ReorderLine } from '../lib/types.ts';

function Why({ text }: { text: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement | null>(null);
  return (
    <span className="relative">
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} aria-label="Why this quantity" title="Why this quantity" className="flex size-8 items-center justify-center rounded-full text-[var(--iv-ink-2)] hover:bg-[var(--iv-row-hover)]">
        <Info size={15} />
      </button>
      <Popover open={open} onClose={() => setOpen(false)} keep={btn} align="right" className="w-72 p-4">
        <p className="text-[13px] leading-5">{text}</p>
      </Popover>
    </span>
  );
}

function Line({
  line,
  value,
  picked,
  onQty,
  onPick,
  currency,
}: {
  line: ReorderLine;
  value: string;
  picked: boolean;
  onQty: (v: string) => void;
  onPick: (v: boolean) => void;
  currency: string;
}): React.JSX.Element {
  const n = Number(value) || 0;
  return (
    <li className={cn('flex flex-col gap-3 rounded-[20px] p-3 transition-colors md:flex-row md:items-center', picked ? 'bg-[var(--iv-row)]' : 'bg-[var(--iv-row)]/45')}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <input type="checkbox" checked={picked} onChange={(e) => onPick(e.target.checked)} aria-label={`Order ${line.name}`} className="size-4 shrink-0 accent-[var(--iv-ink)]" />
        <button type="button" onClick={() => navigate('item', { id: line.id })} className="flex min-w-0 flex-1 items-center gap-3 text-left">
          <ItemThumb photo={line.photo} icon={line.icon} size={44} tone="card" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[14px] font-bold">{line.name}</span>
            <span className="block truncate text-[12px] text-[var(--iv-muted)]">
              {qty(line.on_hand)} on hand{line.incoming > 0 ? ` + ${qty(line.incoming)} coming` : ''} · reorder at {qty(line.min_qty)}
              {line.on_hand <= 0 ? ' · out of stock' : line.days_left !== null ? ` · lasts ${plural(line.days_left, 'day')}` : ''}
            </span>
            <LevelBar onHand={line.on_hand} min={line.min_qty} max={line.max_qty} status={line.status} className="mt-2 max-w-64" />
          </span>
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 sm:pl-7 md:pl-0">
        <div className="flex items-center gap-3">
          {line.in_drafts.length > 0 && (
            <button type="button" onClick={() => navigate('order', { id: line.in_drafts[0]?.id ?? '' })} className="inline-flex h-7 items-center rounded-full bg-[var(--iv-card)] px-2.5 text-[12px] font-semibold hover:underline">
              On {line.in_drafts[0]?.number}
            </button>
          )}
          <Why text={line.why} />
        </div>
        <div className="ml-auto flex items-center gap-3">
          <Stepper value={value} onChange={onQty} fractional={line.fractional} min={0} ariaLabel={`${line.name} to order`} size="sm" />
          <span className="num min-w-16 text-right sm:w-24">
            <span className="block text-[13px] font-bold">{line.unit_cost_e4 > 0 ? money(Math.round(n * line.unit_cost_e4), currency) : `${qty(n)} ${line.unit}`}</span>
            {line.unit_cost_e4 > 0 && <span className="block text-[12px] text-[var(--iv-muted)]">{unitCost(line.unit_cost, currency)} each</span>}
          </span>
        </div>
      </div>
    </li>
  );
}

function GroupCard({ group, currency, index }: { group: ReorderGroup; currency: string; index: number }): React.JSX.Element {
  const [qtys, setQtys] = useState<Record<string, string>>({});
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const valueOf = (l: ReorderLine): string => qtys[l.id] ?? plain(l.suggested);
  const chosen = group.items.filter((l) => !skip.has(l.id) && Number(valueOf(l)) > 0);
  const total = chosen.reduce((s, l) => s + Math.round(Number(valueOf(l)) * l.unit_cost_e4), 0);
  const draft = async (): Promise<void> => {
    const items = [];
    for (const l of chosen) {
      const n = normalizeNumber(valueOf(l), l.fractional ? 3 : 0);
      if (n === null) {
        toast.error(`Check the quantity of ${l.name}`);
        return;
      }
      items.push({ item: l.id, qty: n });
    }
    if (items.length === 0) return;
    setBusy(true);
    try {
      const r = await api.createOrders(items);
      const o = r.orders[0];
      toast.success(o !== undefined ? `Draft ${o.number} is ready to check and send` : 'Draft order ready');
      if (o !== undefined) navigate('order', { id: o.id });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const sup = group.supplier;
  return (
    <Card delay={Math.min(5, index + 2)}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
          <Store size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[15px] font-bold">{sup !== null ? sup.name : 'No supplier yet'}</h2>
          <p className="truncate text-[13px] text-[var(--iv-muted)]">
            {sup !== null
              ? [sup.lead_time_days > 0 ? `Usually ${plural(sup.lead_time_days, 'day')} to arrive` : null, sup.email !== '' ? sup.email : null].filter((x) => x !== null).join(' · ') || 'No contact details'
              : 'Give these items a supplier to order them together'}
          </p>
        </div>
        <span className="num text-right">
          <span className="block text-[15px] font-bold">{money(total, currency)}</span>
          <span className="block text-[12px] text-[var(--iv-muted)]">{plural(chosen.length, 'line')}</span>
        </span>
      </div>
      <ul className="flex flex-col gap-2">
        {group.items.map((l) => (
          <Line
            key={l.id}
            line={l}
            value={valueOf(l)}
            picked={!skip.has(l.id)}
            currency={currency}
            onQty={(v) => setQtys((q) => ({ ...q, [l.id]: v }))}
            onPick={(v) =>
              setSkip((s) => {
                const n = new Set(s);
                if (v) n.delete(l.id);
                else n.add(l.id);
                return n;
              })
            }
          />
        ))}
      </ul>
      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {sup !== null && (
          <TextLink tone="muted" onClick={() => navigate('suppliers', { id: sup.id })}>
            Supplier details
          </TextLink>
        )}
        <PillButton variant="dark" icon={ShoppingCart} dot loading={busy} disabled={chosen.length === 0} onClick={() => void draft()}>
          Create draft order
        </PillButton>
      </div>
    </Card>
  );
}

export function ReorderPage(): React.JSX.Element {
  const { currency, settings } = useApp();
  const list = useLive(() => api.reorder(), ['items', 'stock', 'orders', 'order_lines', 'suppliers', 'settings'], []);
  const data = list.data;
  const [busy, setBusy] = useState(false);
  const auto = settings?.auto_restock ?? false;

  const createAll = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.createOrders(null);
      toast.success(`${plural(r.orders.length, 'draft order')} ready to check and send`);
      navigate('orders', { status: 'draft' });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };

  const setAuto = async (on: boolean): Promise<void> => {
    try {
      await api.updateSettings({ auto_restock: on });
      toast.success(on ? 'Your AI agent drafts orders when something runs low' : 'Automatic drafts are off');
    } catch {
      /* toasted */
    }
  };

  const groups = useMemo(() => data?.groups ?? [], [data]);

  return (
    <div>
      <PageHeader
        title="Reorder"
        subtitle={data !== null ? (data.count > 0 ? <span className="num">{plural(data.count, 'item')} to reorder · about {money(data.value, currency)}</span> : 'Nothing to reorder') : ' '}
        actions={
          data !== null && data.count > 0 ? (
            <>
              <AskAgent trigger="restock_review" label="Ask your AI agent to draft them" variant="light" />
              <PillButton variant="dark" icon={Truck} dot loading={busy} onClick={() => void createAll()}>
                Draft all orders
              </PillButton>
            </>
          ) : undefined
        }
      />

      <Card tone="sand" className="mb-5 flex flex-wrap items-center gap-4 !py-4" delay={1}>
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[var(--iv-solid)] text-[var(--iv-on-solid)]">
          <Sparkles size={17} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-bold">Let your AI agent draft orders when something runs low</p>
          <p className="text-[13px] text-[var(--iv-ink-2)]">
            It prepares draft purchase orders with its reasons; it never sends them or changes stock.
            {settings !== null && settings.restock_asked_on !== '' ? ` Last asked ${dayPhrase(settings.restock_asked_on)}.` : ''}
          </p>
        </div>
        <Toggle checked={auto} onChange={(v) => void setAuto(v)} label="Let your AI agent draft orders when something runs low" />
      </Card>

      {data === null ? (
        <div className="flex flex-col gap-5">
          <span className="h-48 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />
          <span className="h-48 animate-pulse rounded-[24px] bg-[var(--iv-card)]" />
        </div>
      ) : groups.length === 0 ? (
        <Card>
          <Empty icon={CircleCheck} title="Nothing to reorder" action={<PillButton variant="light" onClick={() => navigate('items')}>Open items</PillButton>}>
            Items show up here when what is on hand and on order drops to their reorder point. Set a reorder point on each item you never want to run out of.
          </Empty>
        </Card>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map((g, i) => (
            <GroupCard key={g.supplier?.id ?? 'none'} group={g} currency={currency} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}
