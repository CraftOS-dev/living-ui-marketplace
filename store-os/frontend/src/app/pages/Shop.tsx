/**
 * One shop, in two columns. The header holds one main action (the way this
 * shop's orders come in) and everything else in its menu; one strip of
 * figures. Main column: the setup checklist (only while the shop is being
 * opened), the latest orders, the policies your AI agent quotes (one at a
 * time). Side column: stock to set (only when there is some), how orders
 * come in, the rules as plain rows, and the details with an Edit dialog.
 * Settings that mean nothing for the Direct shop (commission, the stock a
 * marketplace shows) are left out there. Everything saves as you go.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, Check, ChevronDown, ExternalLink, FileText, Package, Pause, PenLine, Play, Plus, Rocket, RefreshCw, ShoppingBag, Sparkles, Store, Trash2, Upload } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { countryName, platformCountries } from '../components/AddShopDialog.tsx';
import type { Connection } from '../components/AddShopDialog.tsx';
import { OrderStatus } from '../components/badges.tsx';
import { ImportDialog } from '../components/ImportDialog.tsx';
import { AddOrderDialog } from '../components/OrderDialogs.tsx';
import { PlatformMark } from '../components/PlatformMark.tsx';
import {
  areaClass,
  Button,
  Card,
  CardHeader,
  confirmAsk,
  Dialog,
  Empty,
  Field,
  IconBadge,
  LinkButton,
  Menu,
  Meter,
  PageHeader,
  Pill,
  Select,
  Skeleton,
  Tabs,
  TaskBadge,
  TextInput,
  Tip,
} from '../components/ui.tsx';
import type { MenuItem } from '../components/ui.tsx';
import { op } from '../lib/api.ts';
import { ago, currencySign, money, num, plural } from '../lib/format.ts';
import { changed, useLive } from '../lib/live.ts';
import { go, href } from '../lib/router.ts';
import { useStore } from '../lib/store.tsx';
import { notify } from '../lib/toast.tsx';
import type { OrderList, SetupStep, ShopDetail, Task } from '../lib/types.ts';
import { CONNECTION_ICON, SHOP_STATUS } from './Shops.tsx';

/* ------------------------------------------------- inline save-on-blur */

const boxClass = 'flex h-10 min-w-0 items-center rounded-[12px] bg-[var(--so-tile)] ring-[var(--so-ink)] focus-within:ring-2';
const sideClass = 'shrink-0 text-[13px] font-semibold text-[var(--so-muted)]';

/** Keeps a draft while typing; follows the saved value otherwise. */
function useDraft(saved: string): { draft: string; setDraft: (v: string) => void; focused: React.RefObject<boolean>; skip: React.RefObject<boolean> } {
  const [draft, setDraft] = useState(saved);
  const focused = useRef(false);
  const skip = useRef(false);
  useEffect(() => {
    if (!focused.current) setDraft(saved);
  }, [saved]);
  return { draft, setDraft, focused, skip };
}

function keys(e: React.KeyboardEvent<HTMLInputElement>, revert: () => void, skip: React.RefObject<boolean>): void {
  if (e.key === 'Enter') e.currentTarget.blur();
  if (e.key === 'Escape') {
    skip.current = true;
    revert();
    e.currentTarget.blur();
  }
}

/** A number that saves when you leave it. `onDraft` follows the typing (for live examples). */
export function SaveNumber({
  value,
  onSave,
  label,
  prefix,
  suffix,
  integer = false,
  min,
  max,
  onDraft,
  disabled = false,
  className,
}: {
  value: number;
  onSave: (v: number) => Promise<unknown>;
  label: string;
  prefix?: ReactNode;
  suffix?: ReactNode;
  integer?: boolean;
  min?: number;
  max?: number;
  onDraft?: (v: number | null) => void;
  disabled?: boolean;
  className?: string;
}): React.JSX.Element {
  const saved = String(value);
  const { draft, setDraft, focused, skip } = useDraft(saved);
  const revert = (): void => {
    setDraft(saved);
    onDraft?.(null);
  };
  const commit = async (): Promise<void> => {
    focused.current = false;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const t = draft.trim().replace(',', '.');
    const n = Number(t);
    if (t === '' || !Number.isFinite(n) || (integer && !Number.isInteger(n))) {
      if (t !== '') notify.error(label + (integer ? ' is a whole number' : ' is a number'));
      revert();
      return;
    }
    if ((min !== undefined && n < min) || (max !== undefined && n > max)) {
      notify.error(label + ' is from ' + num(min ?? 0) + ' to ' + num(max ?? 0));
      revert();
      return;
    }
    if (n === value) {
      setDraft(saved);
      return;
    }
    try {
      await onSave(n);
      notify.info('Saved');
    } catch {
      revert();
    }
  };
  return (
    <span className={cn(boxClass, disabled && 'opacity-60', className)}>
      {prefix !== undefined && <span className={cn(sideClass, 'pl-3.5 pr-1')}>{prefix}</span>}
      <input
        aria-label={label}
        inputMode={integer ? 'numeric' : 'decimal'}
        value={draft}
        disabled={disabled}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => {
          setDraft(e.target.value);
          const n = Number(e.target.value.trim().replace(',', '.'));
          onDraft?.(e.target.value.trim() !== '' && Number.isFinite(n) ? n : null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => keys(e, revert, skip)}
        className={cn('num h-full min-w-0 flex-1 bg-transparent text-[14px] text-[var(--so-ink)] outline-none', prefix === undefined && 'pl-3.5', suffix === undefined && 'pr-3.5')}
      />
      {suffix !== undefined && <span className={cn(sideClass, 'pl-1 pr-3.5')}>{suffix}</span>}
    </span>
  );
}

/** A line of text that saves when you leave it. */
export function SaveText({
  value,
  onSave,
  label,
  type = 'text',
  placeholder,
  required = false,
  maxLength,
  className,
}: {
  value: string;
  onSave: (v: string) => Promise<unknown>;
  label: string;
  type?: 'text' | 'url' | 'email';
  placeholder?: string;
  required?: boolean;
  maxLength?: number;
  className?: string;
}): React.JSX.Element {
  const { draft, setDraft, focused, skip } = useDraft(value);
  const commit = async (): Promise<void> => {
    focused.current = false;
    if (skip.current) {
      skip.current = false;
      return;
    }
    const t = draft.trim();
    if (t === value.trim()) {
      setDraft(value);
      return;
    }
    if (required && t === '') {
      notify.error(label + ' cannot be empty');
      setDraft(value);
      return;
    }
    try {
      await onSave(t);
      notify.info('Saved');
    } catch {
      setDraft(value);
    }
  };
  return (
    <span className={cn(boxClass, className)}>
      <input
        aria-label={label}
        type={type}
        value={draft}
        placeholder={placeholder}
        maxLength={maxLength}
        onFocus={() => {
          focused.current = true;
        }}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => keys(e, () => setDraft(value), skip)}
        className="h-full min-w-0 flex-1 bg-transparent px-3.5 text-[14px] text-[var(--so-ink)] outline-none"
      />
    </span>
  );
}

/** A text area that saves when you leave it. */
function SaveArea({ value, onSave, label, placeholder, rows = 3 }: { value: string; onSave: (v: string) => Promise<unknown>; label: string; placeholder?: string; rows?: number }): React.JSX.Element {
  const { draft, setDraft, focused } = useDraft(value);
  const commit = async (): Promise<void> => {
    focused.current = false;
    if (draft === value) return;
    try {
      await onSave(draft);
      notify.info('Saved');
    } catch {
      setDraft(value);
    }
  };
  return (
    <textarea
      aria-label={label}
      value={draft}
      rows={rows}
      placeholder={placeholder}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => void commit()}
      className={areaClass}
    />
  );
}

/* ------------------------------------------------------------------ page */

type ShopData = { shop: ShopDetail } | null;

export function ShopPage({ id }: { id: string }): React.JSX.Element {
  const live = useLive<ShopData>(
    'shop:' + id,
    (signal) => (id === '' ? Promise.resolve(null) : op<{ shop: ShopDetail }>('shops.get', { shop: id }, { signal, quiet: true })),
    ['shops', 'orders', 'threads', 'listings', 'tasks', 'imports', 'variants', 'stock_moves', 'settings'],
    [id],
  );
  const s = live.data?.shop;

  const back = (
    <a href={href('shops')} className="mb-2 inline-flex h-8 items-center gap-1.5 text-[13px] font-semibold text-[var(--so-muted)] hover:text-[var(--so-ink)]">
      <ArrowLeft size={14} strokeWidth={2} aria-hidden />
      Shops
    </a>
  );

  if (s === undefined || s.id !== id) {
    if (live.error !== null || (id === '' && !live.loading)) {
      return (
        <div>
          <PageHeader title="Shop" back={back} />
          <Card>
            <Empty icon={Store} title="This shop is not here" action={<LinkButton href={href('shops')}>All shops</LinkButton>}>
              {live.error ?? 'It may have been deleted.'}
            </Empty>
          </Card>
        </div>
      );
    }
    return (
      <div>
        <PageHeader title={<Skeleton className="h-[34px] w-60" />} back={back} />
        <Skeleton className="h-[86px] rounded-[20px]" />
        <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
          <Skeleton className="h-[320px] rounded-[20px]" />
          <Skeleton className="h-[320px] rounded-[20px]" />
        </div>
      </div>
    );
  }

  return <ShopView key={s.id} shop={s} back={back} onShop={(d) => live.set({ shop: d })} />;
}

function ShopView({ shop: s, back, onShop }: { shop: ShopDetail; back: ReactNode; onShop: (d: ShopDetail) => void }): React.JSX.Element {
  const { catalog } = useStore();
  const [importing, setImporting] = useState(false);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const status = SHOP_STATUS[s.status] ?? SHOP_STATUS.active;
  const direct = s.platform === 'direct';
  const syncOpen = s.task !== null && s.task.kind === 'sync';

  const update = async (fields: Record<string, unknown>): Promise<void> => {
    const res = await op<{ shop: ShopDetail }>('shops.update', { shop: s.id, ...fields });
    onShop(res.shop);
    changed('shops');
  };

  const sync = async (): Promise<void> => {
    setSyncing(true);
    try {
      await op('shops.sync', { shop: s.id });
      changed('tasks', 'shops');
      notify.info('Asked your AI agent to sync');
    } catch {
      /* the notice says why */
    } finally {
      setSyncing(false);
    }
  };

  const setStatus = async (next: ShopDetail['status'], note: string): Promise<void> => {
    try {
      await update({ status: next });
      notify.info(note);
    } catch {
      /* the notice says why */
    }
  };

  // One main action: the way this shop's orders come in.
  const main: 'sync' | 'import' | 'add' = s.connection === 'agent' && !direct ? 'sync' : s.connection === 'files' ? 'import' : 'add';
  const actions = {
    sync: (
      <Button icon={RefreshCw} loading={syncing} disabled={syncOpen} onClick={() => void sync()}>
        Sync now
      </Button>
    ),
    import: (
      <Button icon={Upload} onClick={() => setImporting(true)}>
        Import orders
      </Button>
    ),
    add: (
      <Button icon={Plus} onClick={() => setAdding(true)}>
        New order
      </Button>
    ),
  };

  const menu: MenuItem[] = [];
  if (main !== 'add') menu.push({ label: 'New order', icon: Plus, onSelect: () => setAdding(true) });
  if (main !== 'import') menu.push({ label: 'Import orders', icon: Upload, onSelect: () => setImporting(true) });
  menu.push({ label: 'Edit details', icon: PenLine, onSelect: () => setEditing(true) });
  if (s.status === 'setting_up') menu.push({ label: 'Mark as open', icon: Rocket, onSelect: () => void setStatus('active', 'Shop is open') });
  if (s.status === 'paused') menu.push({ label: 'Activate shop', icon: Play, onSelect: () => void setStatus('active', 'Shop activated') });
  else menu.push({ label: 'Pause shop', icon: Pause, onSelect: () => void setStatus('paused', 'Shop paused') });
  if (!direct)
    menu.push({
      label: 'Delete shop',
      icon: Trash2,
      danger: true,
      onSelect: () => {
        void confirmAsk('Delete ' + s.name + '?', 'Its ' + plural(s.orders, 'order') + ', listings and conversations are deleted too. This cannot be undone.', 'Continue', { danger: true }).then((ok) => {
          if (ok) setDeleting(true);
        });
      },
    });

  return (
    <div>
      <PageHeader
        back={back}
        title={
          <span className="flex min-w-0 items-center gap-3">
            <PlatformMark platform={s.platform} size={44} onCard={false} />
            <span className="truncate">{s.name}</span>
          </span>
        }
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <span>{[s.platform_name, countryName(catalog, s.region), s.currency].filter((x) => x !== '').join(' · ')}</span>
            <Pill tone={status.tone}>{status.label}</Pill>
          </span>
        }
        actions={
          <>
            {s.task !== null && <TaskBadge task={s.task} />}
            {!direct && s.admin_url !== '' && (
              <LinkButton variant="secondary" icon={ExternalLink} href={s.admin_url} target="_blank" rel="noreferrer">
                Seller centre
              </LinkButton>
            )}
            {actions[main]}
            <Menu items={menu} variant="card" size={40} label="More for this shop" />
          </>
        }
      />

      <Figures shop={s} />

      <div className="mt-4 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_360px] xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="flex min-w-0 flex-col gap-4">
          {s.status === 'setting_up' && <SetupCard shop={s} onShop={onShop} />}
          <OrdersCard shop={s} empty={actions[main]} />
          <PoliciesCard shop={s} />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          {s.stock_plan > 0 && <StockCard shop={s} />}
          <ConnectionCard shop={s} update={update} />
          <RulesCard shop={s} update={update} />
          <DetailsCard shop={s} onEdit={() => setEditing(true)} />
        </div>
      </div>

      <ImportDialog open={importing} onClose={() => setImporting(false)} kind="orders" shopId={s.id} />
      <AddOrderDialog open={adding} onClose={() => setAdding(false)} shopId={s.id} />
      <DetailsDialog open={editing} onClose={() => setEditing(false)} shop={s} update={update} />
      <DeleteShopDialog open={deleting} onClose={() => setDeleting(false)} shop={s} />
    </div>
  );
}

/* --------------------------------------------------------------- figures */

/** The shop's figures in one strip; each opens the list it counts. */
function Figures({ shop: s }: { shop: ShopDetail }): React.JSX.Element {
  const items: { label: string; value: number; to: string; sub?: string; bad?: boolean }[] = [
    { label: 'To ship', value: s.to_ship, to: href('orders', s.late > 0 ? 'at_risk' : 'to_ship'), sub: s.late > 0 ? s.late + ' late' : '', bad: s.late > 0 },
    { label: 'Open messages', value: s.open_threads, to: href('inbox', 'due') },
  ];
  if (s.platform !== 'direct') items.push({ label: 'Live listings', value: s.live_listings, to: href('products') });
  items.push({ label: 'All orders', value: s.orders, to: href('orders', 'all') });
  return (
    <div className={cn('grid grid-cols-2 gap-4', items.length === 4 ? 'lg:grid-cols-4' : 'lg:grid-cols-3')}>
      {items.map((f) => (
        <a key={f.label} href={f.to} className="so-rise so-edge block min-w-0 rounded-[20px] bg-[var(--so-card)] px-5 py-4">
          <p className="text-[13px] font-medium text-[var(--so-muted)]">{f.label}</p>
          <p className="mt-1 flex items-baseline gap-2">
            <span className="num text-[26px] font-semibold leading-[34px]">{num(f.value)}</span>
            {f.sub !== undefined && f.sub !== '' && <span className={cn('text-[12px] font-semibold', f.bad === true ? 'text-[var(--so-red-text)]' : 'text-[var(--so-muted)]')}>{f.sub}</span>}
          </p>
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------- setup checklist */

/** The newest setup-help task your AI agent has for a step. */
function stepTask(tasks: Task[], key: string): Task | undefined {
  return tasks.find((t) => t.kind === 'setup_help' && t.params.step === key);
}

function firstUndone(steps: SetupStep[]): string {
  return steps.find((x) => !x.done)?.key ?? '';
}

function SetupCard({ shop: s, onShop }: { shop: ShopDetail; onShop: (d: ShopDetail) => void }): React.JSX.Element | null {
  const steps = s.steps;
  const done = steps.filter((x) => x.done).length;
  const all = steps.length > 0 && done === steps.length;
  const [open, setOpen] = useState(s.status === 'setting_up' && !all);
  const [expanded, setExpanded] = useState(() => firstUndone(steps));
  const [busy, setBusy] = useState('');
  const [asking, setAsking] = useState('');

  if (steps.length === 0) return null;

  const tick = async (step: SetupStep): Promise<void> => {
    setBusy(step.key);
    try {
      const res = await op<{ shop: ShopDetail }>('shops.step', { shop: s.id, step: step.key, done: !step.done });
      onShop(res.shop);
      changed('shops');
      if (!step.done) {
        const next = res.shop.steps.find((x) => !x.done);
        setExpanded(next?.key ?? '');
        if (s.status === 'setting_up' && res.shop.status === 'active') notify.info('Setup done. The shop is open');
      }
    } catch {
      /* the notice says why */
    } finally {
      setBusy('');
    }
  };

  const ask = async (step: SetupStep): Promise<void> => {
    setAsking(step.key);
    try {
      await op('shops.help', { shop: s.id, step: step.key });
      changed('tasks', 'shops');
      notify.info('Asked your AI agent');
    } catch {
      /* the notice says why */
    } finally {
      setAsking('');
    }
  };

  const progress = (
    <span className="num text-[12px] font-semibold text-[var(--so-muted)]">
      {done} of {steps.length} done
    </span>
  );

  if (!open) {
    return (
      <Card flush>
        <button type="button" onClick={() => setOpen(true)} aria-expanded={false} className="flex w-full items-center gap-3 rounded-[20px] px-5 py-4 text-left hover:bg-[var(--so-row-hover)]">
          <IconBadge icon={all ? Check : Rocket} size={32} tone={all ? 'good' : 'accent'} />
          <span className="min-w-0 flex-1 text-[15px] font-semibold">{all ? 'Setup done' : 'Setup checklist'}</span>
          {progress}
          <ChevronDown size={16} className="shrink-0 text-[var(--so-muted)]" aria-hidden />
        </button>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title={all ? 'Setup done' : 'Setup checklist'}
        action={
          <>
            {progress}
            <button type="button" aria-label="Fold the checklist" aria-expanded onClick={() => setOpen(false)} className="hit flex size-8 items-center justify-center rounded-full text-[var(--so-muted)] hover:bg-[var(--so-tile)] hover:text-[var(--so-ink)]">
              <ChevronDown size={16} className="rotate-180" aria-hidden />
            </button>
          </>
        }
        className="mb-3"
      />
      <Meter value={done} max={steps.length} tone={all ? 'good' : 'accent'} className="mb-4" />
      <ol className="grid gap-1">
        {steps.map((step) => {
          const isOpen = expanded === step.key;
          const task = stepTask(s.tasks, step.key);
          return (
            <li key={step.key} className={cn('rounded-[14px] transition-colors', isOpen ? 'bg-[var(--so-tile)]' : 'hover:bg-[var(--so-row-hover)]')}>
              <div className="flex items-center gap-3 px-3 py-2">
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={step.done}
                  aria-label={step.done ? 'Mark "' + step.title + '" not done' : 'Mark "' + step.title + '" done'}
                  disabled={busy === step.key}
                  onClick={() => void tick(step)}
                  className={cn(
                    'hit flex size-6 shrink-0 items-center justify-center rounded-full transition-colors disabled:opacity-50',
                    step.done ? 'bg-[var(--so-primary)] text-[var(--so-on-primary)]' : 'border-[1.5px] border-dashed border-[var(--so-faint)] hover:border-solid hover:border-[var(--so-ink)]',
                  )}
                >
                  {step.done && <Check size={13} strokeWidth={3} aria-hidden />}
                </button>
                <button type="button" aria-expanded={isOpen} onClick={() => setExpanded(isOpen ? '' : step.key)} className={cn('min-h-8 min-w-0 flex-1 text-left text-[14px] font-semibold', step.done && !isOpen && 'text-[var(--so-muted)]')}>
                  {step.title}
                </button>
                {!isOpen && task !== undefined && <TaskBadge task={task} />}
              </div>
              {isOpen && (
                <div className="pb-3 pl-12 pr-3">
                  <p className="text-[13px] leading-5 text-[var(--so-muted)]">{step.body}</p>
                  {(step.link !== '' || step.help || task !== undefined) && (
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {step.help && (
                        <Button size="sm" icon={Sparkles} loading={asking === step.key} onClick={() => void ask(step)}>
                          Ask your AI agent
                        </Button>
                      )}
                      {step.link !== '' && (
                        <LinkButton size="sm" variant="secondary" icon={ExternalLink} href={step.link} target="_blank" rel="noreferrer" className="hover:bg-[var(--so-tile-hover)]">
                          Open
                        </LinkButton>
                      )}
                      {task !== undefined && <TaskBadge task={task} />}
                    </div>
                  )}
                  {task !== undefined && task.note !== '' && <p className="mt-2 text-[12px] leading-[18px] text-[var(--so-ink-2)]">{task.note}</p>}
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ---------------------------------------------------------------- orders */

/** The shop's latest orders; empty, it offers the way orders come in. */
function OrdersCard({ shop: s, empty }: { shop: ShopDetail; empty: ReactNode }): React.JSX.Element {
  const list = useLive<OrderList>('shop-orders:' + s.id, (signal) => op<OrderList>('orders.list', { view: 'all', shop: s.id, limit: 6 }, { signal, quiet: true }), ['orders', 'order_lines', 'shipments'], [s.id]);
  const rows = list.data?.orders ?? [];
  const hint = s.connection === 'agent' && s.platform !== 'direct' ? 'Your AI agent brings them in when it syncs.' : s.connection === 'files' ? "Import the platform's order export." : 'Add them as they come in.';
  return (
    <Card flush className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-5 pt-5">
        <div>
          <h2 className="text-[15px] font-semibold">Orders</h2>
          <p className="text-[12px] text-[var(--so-muted)]">{s.orders === 0 ? 'None yet' : 'The latest of ' + plural(s.orders, 'order')}</p>
        </div>
        {rows.length > 0 && (
          <LinkButton size="sm" variant="secondary" href={href('orders', 'all')}>
            All orders
          </LinkButton>
        )}
      </div>
      {list.data === null && list.loading ? (
        <div className="space-y-2 p-5">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <Empty icon={ShoppingBag} title="No orders yet" action={empty} className="py-8">
          {hint}
        </Empty>
      ) : (
        <ul className="px-2 pb-2 pt-3">
          {rows.map((o) => (
            <li key={o.id}>
              <a href={href('orders', 'all', o.id)} className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 hover:bg-[var(--so-row-hover)]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] font-semibold">{o.number}</span>
                  <span className="block truncate text-[12px] text-[var(--so-muted)]">
                    {[o.buyer_name, o.first_item].filter((x) => x !== '').join(', ')}
                  </span>
                </span>
                <span className="hidden w-[96px] text-right text-[12px] text-[var(--so-muted)] sm:block">{ago(o.placed_at)}</span>
                <span className="num w-[96px] text-right text-[14px] font-semibold">{money(o.total, o.currency)}</span>
                <span className="w-[112px]">
                  <OrderStatus status={o.status} health={o.health} />
                </span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/* ------------------------------------------------------- how orders come in */

const CONNECTIONS: { key: Connection; title: string; sub: string; direct: string }[] = [
  { key: 'agent', title: 'Your AI agent syncs it', sub: 'Orders, messages and listings', direct: 'From your chats and messages' },
  { key: 'files', title: 'Import files', sub: 'Seller-centre exports', direct: 'Spreadsheets of your sales' },
  { key: 'manual', title: 'Add them yourself', sub: 'As they come in', direct: 'As they come in' },
];

function ConnectionCard({ shop: s, update }: { shop: ShopDetail; update: (f: Record<string, unknown>) => Promise<void> }): React.JSX.Element {
  const [conn, setConn] = useState<Connection>(s.connection);
  useEffect(() => setConn(s.connection), [s.connection]);
  const direct = s.platform === 'direct';
  const choose = (c: Connection): void => {
    if (c === conn) return;
    const before = conn;
    setConn(c);
    update({ connection: c })
      .then(() => notify.info('Saved'))
      .catch(() => setConn(before));
  };
  const lastImport = s.imports[0];
  const last = s.sync_at !== '' ? 'Last sync ' + ago(s.sync_at) : lastImport !== undefined ? 'Last import ' + ago(lastImport.created) + ': ' + importLine(lastImport) : '';
  return (
    <Card>
      <CardHeader title="How orders come in" className="mb-3" />
      <div role="radiogroup" aria-label="How orders come in" className="-mx-2 space-y-0.5">
        {CONNECTIONS.map((c) => {
          const on = c.key === conn;
          const Icon = ConnIconFor(c.key);
          return (
            <button
              key={c.key}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => choose(c.key)}
              className={cn('flex w-full items-center gap-3 rounded-[14px] px-2 py-2 text-left', on ? 'bg-[var(--so-tile)]' : 'hover:bg-[var(--so-row-hover)]')}
            >
              <IconBadge icon={Icon} size={32} tone={on ? 'ink' : 'tile'} />
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-medium">{c.title}</span>
                <span className="block text-[12px] text-[var(--so-muted)]">{direct ? c.direct : c.sub}</span>
              </span>
              <span aria-hidden className={cn('flex size-[18px] shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--so-primary)]' : 'shadow-[inset_0_0_0_1.5px_var(--so-faint)]')}>
                {on && <span className="size-1.5 rounded-full bg-[var(--so-on-primary)]" />}
              </span>
            </button>
          );
        })}
      </div>
      {last !== '' && (
        <div className="mt-3 border-t border-[var(--so-line)] pt-3">
          <p className="text-[12px] font-semibold text-[var(--so-ink-2)]">{last}</p>
          {s.sync_note !== '' && <p className="mt-0.5 line-clamp-2 text-[12px] leading-[18px] text-[var(--so-muted)]">{s.sync_note}</p>}
        </div>
      )}
    </Card>
  );
}

function ConnIconFor(c: Connection): LucideIcon {
  return CONNECTION_ICON[c] ?? FileText;
}

function importLine(i: ShopDetail['imports'][number]): string {
  const parts = [plural(i.created_n, 'new', 'new'), num(i.updated_n) + ' updated'];
  if (i.skipped_n > 0) parts.push(num(i.skipped_n) + ' skipped');
  return parts.join(', ');
}

/* ----------------------------------------------------------------- rules */

/** What a shop shows for `available` under its stock rule (as the server counts it). */
function ruleQty(available: number, share: number, buffer: number, max: number): number {
  let q = Math.floor((Math.max(0, available) * Math.max(0, share)) / 100) - buffer;
  if (q < 0) q = 0;
  if (max > 0 && q > max) q = max;
  return q;
}

const EXAMPLE = 40;

/** A setting as one row: the name on the left, its value on the right. */
function Row({ label, tip, children }: { label: string; tip?: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="min-w-0 text-[13px] font-medium text-[var(--so-ink-2)]">{tip !== undefined ? <Tip text={tip}>{label}</Tip> : label}</span>
      <span className="w-[136px] shrink-0">{children}</span>
    </div>
  );
}

function Group({ title, children, first = false }: { title: string; children: ReactNode; first?: boolean }): React.JSX.Element {
  return (
    <div className={cn(!first && 'mt-3 border-t border-[var(--so-line)] pt-3')}>
      <p className="mb-1 text-[12px] font-semibold text-[var(--so-muted)]">{title}</p>
      {children}
    </div>
  );
}

function RulesCard({ shop: s, update }: { shop: ShopDetail; update: (f: Record<string, unknown>) => Promise<void> }): React.JSX.Element {
  const [share, setShare] = useState<number | null>(null);
  const [buffer, setBuffer] = useState<number | null>(null);
  const [max, setMax] = useState<number | null>(null);
  const shows = ruleQty(EXAMPLE, share ?? s.stock_share, buffer ?? s.stock_buffer, max ?? s.stock_max);
  const save = (k: string) => (v: number) => update({ [k]: v });
  const direct = s.platform === 'direct';
  return (
    <Card>
      <CardHeader title="Rules" subtitle={direct ? 'Used for profit and deadlines' : 'Used for profit, deadlines and stock'} className="mb-3" />
      <Group title="Fees" first>
        {!direct && (
          <Row label="Commission" tip="What the platform takes on items, to estimate profit until the payout says">
            <SaveNumber className="h-9" label="Commission" value={s.commission_pct} suffix="%" min={0} max={100} onSave={save('commission_pct')} />
          </Row>
        )}
        <Row label="Payment fee" tip="Payment or transaction fee on the order total">
          <SaveNumber className="h-9" label="Payment fee" value={s.payment_pct} suffix="%" min={0} max={100} onSave={save('payment_pct')} />
        </Row>
        <Row label="Fee per order">
          <SaveNumber className="h-9" label="Fee per order" value={s.fixed_fee} prefix={s.currency !== '' ? currencySign(s.currency) : undefined} min={0} onSave={save('fixed_fee')} />
        </Row>
      </Group>
      <Group title="Deadlines">
        <Row label="Ship within" tip="Days from order to hand-over: the ship-by clock">
          <SaveNumber className="h-9" label="Ship within" value={s.ship_days} suffix="days" integer min={0} max={60} onSave={save('ship_days')} />
        </Row>
        <Row label="Reply within" tip="Hours to answer a buyer: the reply clock">
          <SaveNumber className="h-9" label="Reply within" value={s.reply_hours} suffix="hours" integer min={0} max={720} onSave={save('reply_hours')} />
        </Row>
      </Group>
      {!direct && (
        <Group title="Stock this shop shows">
          <Row label="Share of available" tip="How much of your available stock this shop shows, so one sale elsewhere does not oversell here">
            <SaveNumber className="h-9" label="Share" value={s.stock_share} suffix="%" integer min={0} max={100} onDraft={setShare} onSave={(v) => update({ stock_share: v }).finally(() => setShare(null))} />
          </Row>
          <Row label="Hold back">
            <SaveNumber className="h-9" label="Hold back" value={s.stock_buffer} suffix="units" integer min={0} max={100000} onDraft={setBuffer} onSave={(v) => update({ stock_buffer: v }).finally(() => setBuffer(null))} />
          </Row>
          <Row label="At most" tip="0 means no limit">
            <SaveNumber className="h-9" label="At most" value={s.stock_max} suffix="units" integer min={0} max={1000000} onDraft={setMax} onSave={(v) => update({ stock_max: v }).finally(() => setMax(null))} />
          </Row>
          <p className="num mt-1 text-[12px] text-[var(--so-muted)]">
            {EXAMPLE} available shows as <span className="font-semibold text-[var(--so-ink)]">{shows}</span>
          </p>
        </Group>
      )}
    </Card>
  );
}

/* -------------------------------------------------------------- policies */

const POLICY_FIELDS: { key: keyof ShopDetail['policies']; label: string; placeholder: string }[] = [
  { key: 'returns', label: 'Returns', placeholder: 'Returns within 7 days of delivery, unused and in the box.' },
  { key: 'shipping', label: 'Shipping', placeholder: 'Ships in 1 to 2 days. Delivery in 3 to 5 days.' },
  { key: 'faq', label: 'FAQ', placeholder: 'Sizes, care, warranty, payment...' },
  { key: 'voice', label: 'Reply voice', placeholder: 'Friendly and short, sign off with your name.' },
];

function PoliciesCard({ shop: s }: { shop: ShopDetail }): React.JSX.Element {
  const [tab, setTab] = useState<keyof ShopDetail['policies']>('returns');
  const [asking, setAsking] = useState(false);
  const hasStep = s.steps.some((x) => x.key === 'policies');
  const task = stepTask(s.tasks, 'policies');
  const field = POLICY_FIELDS.find((f) => f.key === tab) ?? POLICY_FIELDS[0]!;
  const save = (k: string) => async (v: string) => {
    await op('shops.policies', { shop: s.id, [k]: v });
    changed('shops');
  };
  const ask = async (): Promise<void> => {
    setAsking(true);
    try {
      await op('shops.help', { shop: s.id, step: 'policies' });
      changed('tasks', 'shops');
      notify.info('Asked your AI agent');
    } catch {
      /* the notice says why */
    } finally {
      setAsking(false);
    }
  };
  return (
    <Card>
      <CardHeader
        title="Policies"
        subtitle="Your AI agent quotes these when it answers buyers"
        action={
          hasStep ? (
            <>
              {task !== undefined && <TaskBadge task={task} className="hidden sm:inline-flex" />}
              <Button size="sm" variant="secondary" icon={Sparkles} loading={asking} onClick={() => void ask()}>
                Write with your AI agent
              </Button>
            </>
          ) : undefined
        }
      />
      <Tabs size="sm" value={tab} onChange={setTab} className="mb-3 bg-[var(--so-tile)]" items={POLICY_FIELDS.map((f) => ({ key: f.key, label: f.label, alert: false }))} />
      <SaveArea key={field.key} label={field.label} value={s.policies[field.key]} placeholder={field.placeholder} rows={4} onSave={save(field.key)} />
    </Card>
  );
}

/* ----------------------------------------------------------------- stock */

/** Shown only when this shop's stock numbers need setting. */
function StockCard({ shop: s }: { shop: ShopDetail }): React.JSX.Element {
  const n = s.stock_plan;
  return (
    <Card className="flex items-center gap-3 p-4">
      <IconBadge icon={Package} size={36} tone="accent" />
      <p className="min-w-0 flex-1 text-[13px] font-semibold">{plural(n, 'SKU')} to set on this shop</p>
      <LinkButton size="sm" href={href('products', 'push')}>
        Set stock
      </LinkButton>
    </Card>
  );
}

/* --------------------------------------------------------------- details */

function DetailsCard({ shop: s, onEdit }: { shop: ShopDetail; onEdit: () => void }): React.JSX.Element {
  const { catalog } = useStore();
  const rows: [string, string][] = [
    ['Country', countryName(catalog, s.region) || 'Not set'],
    ['Currency', s.currency || 'Not set'],
    ['Shop link', s.url || 'Not set'],
  ];
  if (s.platform !== 'direct') rows.push(['Seller centre', s.admin_url || 'Not set']);
  return (
    <Card>
      <CardHeader
        title="Details"
        className="mb-2"
        action={
          <Button size="sm" variant="secondary" icon={PenLine} onClick={onEdit}>
            Edit
          </Button>
        }
      />
      <dl>
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-3 py-1.5 text-[13px]">
            <dt className="shrink-0 text-[var(--so-muted)]">{k}</dt>
            <dd className={cn('min-w-0 truncate text-right font-medium', v === 'Not set' && 'font-normal text-[var(--so-faint)]')}>{v}</dd>
          </div>
        ))}
      </dl>
    </Card>
  );
}

function DetailsDialog({ open, onClose, shop: s, update }: { open: boolean; onClose: () => void; shop: ShopDetail; update: (f: Record<string, unknown>) => Promise<void> }): React.JSX.Element | null {
  const { catalog, platform } = useStore();
  const countries = platformCountries(catalog, platform(s.platform));
  const list = countries.some((c) => c.code === s.region) || s.region === '' ? countries : [...countries, { code: s.region, name: countryName(catalog, s.region), currency: s.currency }];
  const currencies = catalog?.currencies ?? [];
  const curList = s.currency !== '' && !currencies.includes(s.currency) ? [...currencies, s.currency] : currencies;
  const pick = (k: 'region' | 'currency') => (e: React.ChangeEvent<HTMLSelectElement>) => {
    update({ [k]: e.target.value })
      .then(() => notify.info('Saved'))
      .catch(() => undefined);
  };
  return (
    <Dialog open={open} onClose={onClose} width={520} title="Shop details" subtitle="Changes save as you go" footer={<Button onClick={onClose}>Done</Button>}>
      <div className="grid gap-4 pb-2 sm:grid-cols-2">
        <Field label="Name" className="sm:col-span-2">
          <SaveText label="Name" value={s.name} required maxLength={80} onSave={(v) => update({ name: v })} />
        </Field>
        <Field label="Country">
          <Select value={s.region} onChange={pick('region')}>
            {s.region === '' && <option value="">Choose</option>}
            {list.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={<Tip text="Prices and orders on this shop are in this currency">Currency</Tip>}>
          <Select value={s.currency} onChange={pick('currency')}>
            {curList.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Shop link" className="sm:col-span-2">
          <SaveText label="Shop link" type="url" value={s.url} placeholder="https://" onSave={(v) => update({ url: v })} />
        </Field>
        {s.platform !== 'direct' && (
          <Field label="Seller centre" className="sm:col-span-2">
            <SaveText label="Seller centre" type="url" value={s.admin_url} placeholder="https://" onSave={(v) => update({ admin_url: v })} />
          </Field>
        )}
      </div>
    </Dialog>
  );
}

/* ---------------------------------------------------------------- delete */

function DeleteShopDialog({ open, onClose, shop }: { open: boolean; onClose: () => void; shop: ShopDetail }): React.JSX.Element | null {
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTyped('');
      setBusy(false);
    }
  }, [open]);
  const match = typed.trim() === shop.name;
  const remove = async (): Promise<void> => {
    if (!match) return;
    setBusy(true);
    try {
      await op('shops.remove', { shop: shop.id });
      onClose();
      go('shops');
      changed('shops', 'orders', 'order_lines', 'shipments', 'listings', 'threads', 'messages', 'imports', 'tasks', 'activity');
      notify.info('Shop deleted');
    } catch {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      width={440}
      title={'Delete ' + shop.name}
      subtitle="Type the shop name to delete it."
      footer={
        <>
          <Button variant="tile" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" icon={Trash2} disabled={!match} loading={busy} onClick={() => void remove()}>
            Delete shop
          </Button>
        </>
      }
    >
      <form
        className="pb-2"
        onSubmit={(e) => {
          e.preventDefault();
          void remove();
        }}
      >
        <TextInput autoFocus value={typed} placeholder={shop.name} aria-label="Shop name" onChange={(e) => setTyped(e.target.value)} />
      </form>
    </Dialog>
  );
}
