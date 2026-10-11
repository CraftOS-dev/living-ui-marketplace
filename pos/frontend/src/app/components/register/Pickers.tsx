/**
 * The register's small dialogs: a discount (presets or typed, percent or
 * amount, on the order or one line), a price change, a customer (search,
 * or add one with what was typed), and a ticket name.
 *
 * A discount over the cashier limit or a changed price asks a manager at
 * once (their PIN, here), so the cashier knows before the customer pays.
 */
import { useCallback, useEffect, useState } from 'react';
import { Percent, Tag, UserPlus, Users } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api, requestApproval } from '../../lib/api.ts';
import type { LineDiscount } from '../../lib/cart.ts';
import { overLimit } from '../../lib/cart.ts';
import { useApp } from '../../lib/context.tsx';
import { money, percent } from '../../lib/format.ts';
import { can } from '../../lib/session.ts';
import type { Customer } from '../../lib/types.ts';
import { Keypad, pressAmount } from '../Keypad.tsx';
import type { KeypadKey } from '../Keypad.tsx';
import { Button, Empty, Modal, SearchField, Segmented, Spinner, TextField } from '../ui.tsx';

/* --------------------------------------------------------------- discount */

export function DiscountDialog({
  title,
  base,
  current,
  scope,
  onApply,
  onClose,
}: {
  title: string;
  /** What the discount applies to (for the limit check and the preview). */
  base: number;
  current: LineDiscount | null;
  scope: 'order' | 'item';
  onApply: (d: LineDiscount | null, approvals: string[]) => void;
  onClose: () => void;
}): React.JSX.Element {
  const { catalog, settings, currency, exp } = useApp();
  const presets = (catalog?.discounts ?? []).filter((d) => d.scope === scope);
  const [kind, setKind] = useState<'percent' | 'amount'>(current?.kind ?? 'percent');
  const [value, setValue] = useState<number>(current !== null && current.name === '' ? current.value : 0);
  const [busy, setBusy] = useState(false);
  const limit = settings?.cashier_discount_bp ?? 0;

  const apply = async (d: LineDiscount): Promise<void> => {
    if (d.value <= 0) return;
    let approvals: string[] = [];
    if (overLimit(base, d, limit) && !can('discount_over')) {
      setBusy(true);
      const got = await requestApproval(['discount_over'], `${title}: ${d.kind === 'percent' ? percent(d.value) : money(d.value, currency, exp)}`);
      setBusy(false);
      if (got === null) return;
      approvals = got;
    }
    onApply(d, approvals);
  };

  const onKey = useCallback(
    (k: KeypadKey): void => {
      setValue((v) => {
        if (kind === 'amount') return pressAmount(v, k);
        // Percent keys are whole percents: 1, 5 -> 15% (presets carry fractions such as 12.5%).
        const whole = Math.floor(v / 100);
        const next = k === 'back' ? Math.floor(whole / 10) : k === '.' ? whole : k === '00' ? whole * 100 : whole * 10 + Number(k);
        return Math.min(100, next) * 100;
      });
    },
    [kind],
  );
  const shown = kind === 'percent' ? percent(value) : money(value, currency, exp);
  const off = kind === 'percent' ? Math.min(base, Math.floor((base * value + 5000) / 10000)) : Math.min(base, value);
  return (
    <Modal open onClose={onClose} title={title} description={`On ${money(base, currency, exp)}`} wide>
      <div className="flex flex-col gap-4">
        {presets.length > 0 && (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {presets.map((d) => (
              <button
                key={d.id}
                type="button"
                disabled={busy}
                onClick={() => void apply({ kind: d.kind, value: d.value, name: d.name })}
                className={cn('ps-press flex min-h-14 flex-col justify-center rounded-[18px] px-4 py-2 text-left', current?.name === d.name ? 'ps-on-ink bg-[var(--ps-ink)] text-[var(--ps-shell)]' : 'bg-[var(--ps-card)] hover:bg-[var(--ps-row)]')}
              >
                <span className="truncate text-[14px] font-bold">{d.name}</span>
                <span className={cn('num text-[12px] font-semibold', current?.name === d.name ? 'text-[var(--ps-accent)]' : 'text-[var(--ps-muted)]')}>{d.kind === 'percent' ? percent(d.value) : money(d.value, currency, exp)}</span>
              </button>
            ))}
          </div>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="flex flex-1 flex-col gap-3">
            <Segmented
              label="Kind of discount"
              value={kind}
              onChange={(k) => {
                setKind(k);
                setValue(0);
              }}
              options={[
                { value: 'percent', label: 'Percent', icon: Percent },
                { value: 'amount', label: 'Amount' },
              ]}
            />
            <div className="ps-on-dark flex items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-dark)] px-5 py-5 text-[var(--ps-on-dark)]">
              <span className="text-[12px] font-semibold text-[var(--ps-muted)]">{kind === 'percent' ? 'Percent off' : 'Amount off'}</span>
              <span className="flex items-center gap-2">
                <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{shown}</span>
                <span aria-hidden className="ps-caret h-7 w-[3px] rounded-full bg-[var(--ps-accent)]" />
              </span>
            </div>
            <p className="num px-1 text-right text-[12px] text-[var(--ps-muted)]">
              {money(-off, currency, exp)}
              {limit > 0 && !can('discount_over') ? ` · over ${percent(limit)} needs a manager` : ''}
            </p>
          </div>
          <Keypad onKey={onKey} extra="00" size="md" tone="card" className="sm:w-[260px]" onEnter={() => void apply({ kind, value, name: '' })} />
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {current !== null && (
            <Button variant="light" className="text-[var(--ps-red-text)]" onClick={() => onApply(null, [])}>
              Remove discount
            </Button>
          )}
          <Button variant="primary" icon={Percent} dot disabled={value <= 0 || busy} loading={busy} onClick={() => void apply({ kind, value, name: '' })}>
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ price */

export function PriceDialog({ title, current, onApply, onClose }: { title: string; current: number; onApply: (price: number, approvals: string[]) => void; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [value, setValue] = useState(0);
  const [busy, setBusy] = useState(false);
  const onKey = useCallback((k: KeypadKey): void => setValue((v) => pressAmount(v, k)), []);
  const apply = async (): Promise<void> => {
    let approvals: string[] = [];
    if (!can('price_override')) {
      setBusy(true);
      const got = await requestApproval(['price_override'], `${title}: ${money(value, currency, exp)}`);
      setBusy(false);
      if (got === null) return;
      approvals = got;
    }
    onApply(value, approvals);
  };
  return (
    <Modal open onClose={onClose} title={`Price of ${title}`} description={`Now ${money(current, currency, exp)} each`}>
      <div className="flex flex-col gap-3">
        <div className="ps-on-dark flex items-center justify-between gap-3 rounded-[22px] bg-[var(--ps-dark)] px-5 py-5 text-[var(--ps-on-dark)]">
          <span className="text-[12px] font-semibold text-[var(--ps-muted)]">New price each</span>
          <span className="flex items-center gap-2">
            <span className="num text-[26px] font-extrabold leading-8 tracking-[-0.01em]">{money(value, currency, exp)}</span>
            <span aria-hidden className="ps-caret h-7 w-[3px] rounded-full bg-[var(--ps-accent)]" />
          </span>
        </div>
        <Keypad onKey={onKey} extra="00" size="md" tone="card" onEnter={() => void apply()} />
        <Button variant="primary" size="lg" icon={Tag} dot disabled={busy} loading={busy} onClick={() => void apply()} className="w-full">
          {can('price_override') ? 'Set the price' : 'Ask a manager'}
        </Button>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------------- customer */

export function CustomerDialog({ onPick, onClose }: { onPick: (c: { id: string; name: string }) => void; onClose: () => void }): React.JSX.Element {
  const { currency, exp } = useApp();
  const [q, setQ] = useState('');
  const [list, setList] = useState<Customer[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    const t = window.setTimeout(() => {
      api
        .customers({ q, limit: 20 })
        .then((r) => {
          if (live) setList(r.customers);
        })
        .catch(() => undefined);
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
  }, [q]);
  const startAdd = (): void => {
    const typed = q.trim();
    if (/^[+\d][\d\s().-]{3,}$/.test(typed)) setPhone(typed);
    else if (typed.includes('@')) setEmail(typed);
    else setName(typed);
    setAdding(true);
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const c = await api.addCustomer({ name: name.trim(), phone: phone.trim(), email: email.trim() });
      toast.success(`Added ${c.name}`);
      onPick({ id: c.id, name: c.name });
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open
      onClose={onClose}
      title={adding ? 'New customer' : 'Customer'}
      wide
      footer={
        adding ? (
          <>
            <Button variant="light" onClick={() => setAdding(false)}>
              Back
            </Button>
            <Button variant="primary" disabled={name.trim() === ''} loading={busy} onClick={() => void save()}>
              Add and attach
            </Button>
          </>
        ) : undefined
      }
    >
      {adding ? (
        <div className="flex flex-col gap-3">
          <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={80} tone="card" />
          <TextField label="Phone" value={phone} onChange={setPhone} type="tel" inputMode="tel" maxLength={40} tone="card" />
          <TextField label="Email (for receipts)" value={email} onChange={setEmail} type="email" inputMode="email" maxLength={120} onEnter={() => void save()} tone="card" />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <SearchField value={q} onChange={setQ} placeholder="Name, phone or email" label="Find a customer" autoFocus className="flex-1" tone="card" />
            <Button variant="light" icon={UserPlus} onClick={startAdd}>
              New
            </Button>
          </div>
          {list === null ? (
            <div className="flex justify-center py-6">
              <Spinner />
            </div>
          ) : list.length === 0 ? (
            <div className="rounded-[22px] bg-[var(--ps-card)]">
              <Empty
                icon={Users}
                title={q.trim() === '' ? 'No customers yet' : `Nobody matches "${q.trim()}"`}
                compact
                action={
                  <Button variant="primary" icon={UserPlus} dot onClick={startAdd}>
                    {q.trim() === '' ? 'Add a customer' : `Add "${q.trim()}"`}
                  </Button>
                }
              />
            </div>
          ) : (
            <ul className="flex max-h-[360px] flex-col gap-2 overflow-y-auto">
              {list.map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => onPick({ id: c.id, name: c.name })} className="ps-press flex w-full items-center gap-3 rounded-[18px] bg-[var(--ps-card)] px-4 py-3 text-left hover:bg-[var(--ps-row)]">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] font-bold">{c.name}</span>
                      <span className="block truncate text-[12px] text-[var(--ps-muted)]">{[c.phone, c.email].filter((x) => x !== '').join(' · ') || 'No contact details'}</span>
                    </span>
                    <span className="text-right text-[12px] text-[var(--ps-muted)]">
                      <span className="block">{c.visits === 1 ? '1 visit' : `${c.visits} visits`}</span>
                      <span className="num block">{money(c.spent, currency, exp)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

/* -------------------------------------------------------------- name/note */

export function TextDialog({
  title,
  label,
  initial,
  max,
  quick,
  confirmLabel,
  onSave,
  onClose,
}: {
  title: string;
  label: string;
  initial: string;
  max: number;
  quick?: string[];
  confirmLabel: string;
  onSave: (v: string) => void;
  onClose: () => void;
}): React.JSX.Element {
  const [value, setValue] = useState(initial);
  return (
    <Modal
      open
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" onClick={() => onSave(value.trim())}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <TextField label={label} value={value} onChange={setValue} autoFocus maxLength={max} onEnter={() => onSave(value.trim())} tone="card" />
        {quick !== undefined && quick.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {quick.map((q) => (
              <button key={q} type="button" onClick={() => onSave(q)} className="ps-press h-10 min-w-12 rounded-full bg-[var(--ps-card)] px-4 text-[13px] font-bold hover:bg-[var(--ps-row)]">
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </Modal>
  );
}
