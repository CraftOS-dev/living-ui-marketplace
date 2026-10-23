/**
 * Settings (the owner's): the business and its receipts, taxes and money,
 * how the counter sells, payment methods, registers, staff, and what your
 * AI agent does here. The sections are pills across the top; each is a
 * column of cards and each card saves on its own. Changing a rate or a
 * setting never changes a past sale: every sale keeps what it was made with.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Banknote, Building2, Check, CreditCard, ImagePlus, KeyRound, Mail, MonitorSmartphone, NotebookPen, Percent, Plus, QrCode, ScanLine, ShoppingCart, Sparkles, Trash2, UserCog, Users, Wallet } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ROLE_LABEL, majorText, parseMoney, parsePercent, percent, plural, symbolOf } from '../lib/format.ts';
import { replaceQuery } from '../lib/router.ts';
import { can, session, useSession } from '../lib/session.ts';
import type { OrderType, Role, Settings, Staff, TaxClass, Tender, TenderKind } from '../lib/types.ts';
import { ColorPicker } from '../components/products/ProductEditor.tsx';
import { Avatar, Badge, Button, Card, CardHeader, Field, IconBadge, IconButton, Modal, PageHeader, Segmented, Select, Spinner, Tabs, TextField, Toggle, pillInput, rowCls, textareaCls, useConfirm } from '../components/ui.tsx';

type Section = 'business' | 'taxes' | 'selling' | 'payments' | 'registers' | 'staff' | 'agent';

const SECTIONS: { value: Section; label: string; icon: LucideIcon; owner: boolean }[] = [
  { value: 'business', label: 'Business and receipts', icon: Building2, owner: true },
  { value: 'taxes', label: 'Taxes and money', icon: Percent, owner: true },
  { value: 'selling', label: 'Selling', icon: ShoppingCart, owner: true },
  { value: 'payments', label: 'Payment methods', icon: CreditCard, owner: true },
  { value: 'registers', label: 'Registers', icon: MonitorSmartphone, owner: true },
  { value: 'staff', label: 'Staff', icon: Users, owner: true },
  { value: 'agent', label: 'Your AI agent', icon: Sparkles, owner: false },
];

const TENDER_ICON: Record<TenderKind, LucideIcon> = { cash: Banknote, card: CreditCard, qr: QrCode, other: Wallet };

/* A white surface for controls that sit on a soft row. */
const onRow = 'bg-[var(--ps-card)] hover:bg-[var(--ps-row-hover)]';

/** A setting: its name and what it does on the left, the control on the right. */
function Row({ label, hint, error, children }: { label: string; hint?: string; error?: string | null; children: ReactNode }): React.JSX.Element {
  return (
    <div className={cn(rowCls, 'flex flex-wrap items-center justify-between gap-x-4 gap-y-3 px-4 py-3')}>
      <div className="min-w-0 flex-1 basis-[180px]">
        <p className="text-[14px] font-semibold">{label}</p>
        {error ? <p className="mt-0.5 text-[12px] font-medium leading-4 text-[var(--ps-red-text)]">{error}</p> : hint !== undefined ? <p className="mt-0.5 text-[12px] leading-4 text-[var(--ps-muted)]">{hint}</p> : null}
      </div>
      <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

/** A list card's header: the action drops under a long title on a narrow screen. */
function ListHead({ title, subtitle, action }: { title: string; subtitle: string; action?: ReactNode }): React.JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-start justify-between gap-x-3 gap-y-3">
      <div className="min-w-0 flex-1 basis-[200px]">
        <h2 className="text-[15px] font-bold leading-[22px]">{title}</h2>
        <p className="mt-0.5 text-[13px] text-[var(--ps-muted)]">{subtitle}</p>
      </div>
      {action !== undefined && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  );
}

/** A white pill that picks an image file. */
function FilePill({ children, onFile }: { children: ReactNode; onFile: (file: File) => void }): React.JSX.Element {
  return (
    <label className={cn('ps-press inline-flex h-11 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-5 text-[14px] font-semibold text-[var(--ps-ink)] ring-[var(--ps-ink)] has-[:focus-visible]:ring-2', onRow)}>
      <ImagePlus size={16} aria-hidden /> {children}
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="sr-only"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) onFile(f);
        }}
      />
    </label>
  );
}

/** The sub-card that groups a dialog's fields. */
function DialogCard({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="ps-on-card flex flex-col gap-4 rounded-[22px] bg-[var(--ps-card)] p-4">{children}</div>;
}

function useSave(): [boolean, (p: Record<string, unknown> | FormData, done?: string) => Promise<void>] {
  const [busy, setBusy] = useState(false);
  const save = async (p: Record<string, unknown> | FormData, done = 'Saved'): Promise<void> => {
    setBusy(true);
    try {
      await api.updateSettings(p as Record<string, string>);
      toast.success(done);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return [busy, save];
}

/* ------------------------------------------------------------ business */

function Business({ s }: { s: Settings }): React.JSX.Element {
  const [f, setF] = useState({
    business_name: s.business_name,
    address: s.address,
    phone: s.phone,
    email: s.email,
    website: s.website,
    tax_reg_label: s.tax_reg_label,
    tax_reg_no: s.tax_reg_no,
    company_reg_no: s.company_reg_no,
    receipt_header: s.receipt_header,
    receipt_footer: s.receipt_footer,
  });
  const [busy, save] = useSave();
  const set = (k: keyof typeof f) => (v: string) => setF({ ...f, [k]: v });
  const uploadLogo = async (file: File): Promise<void> => {
    const form = new FormData();
    form.append('logo', file);
    await save(form, 'Logo saved');
  };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
      <Card delay={1}>
        <CardHeader
          title="Business"
          action={
            <Button variant="primary" loading={busy} onClick={() => void save(f)}>
              Save
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Business name" value={f.business_name} onChange={set('business_name')} maxLength={80} />
          <TextField label="Phone" value={f.phone} onChange={set('phone')} maxLength={40} type="tel" />
          <Field label="Address">
            <textarea value={f.address} maxLength={300} rows={4} onChange={(e) => set('address')(e.target.value)} className={cn(textareaCls, 'min-h-[132px] flex-1')} />
          </Field>
          <div className="flex flex-col gap-4">
            <TextField label="Email" value={f.email} onChange={set('email')} maxLength={120} type="email" />
            <TextField label="Website" value={f.website} onChange={set('website')} maxLength={200} />
          </div>
          <TextField label="Tax number label" value={f.tax_reg_label} onChange={set('tax_reg_label')} maxLength={40} placeholder="SST No." />
          <TextField label="Tax number" value={f.tax_reg_no} onChange={set('tax_reg_no')} maxLength={40} />
          <TextField label="Company registration number" value={f.company_reg_no} onChange={set('company_reg_no')} maxLength={40} />
        </div>
      </Card>
      <Card delay={2}>
        <CardHeader
          title="Receipts"
          action={
            <Button variant="primary" loading={busy} onClick={() => void save(f)}>
              Save
            </Button>
          }
        />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Printed at the top">
            <textarea value={f.receipt_header} maxLength={500} rows={3} onChange={(e) => set('receipt_header')(e.target.value)} className={textareaCls} />
          </Field>
          <Field label="Printed at the bottom">
            <textarea value={f.receipt_footer} maxLength={500} rows={3} onChange={(e) => set('receipt_footer')(e.target.value)} className={textareaCls} />
          </Field>
        </div>
        <div className="mt-4 flex flex-col gap-2">
          <Row label="Logo" hint="Printed in black and white at the top">
            {s.logo_url !== '' && <img src={s.logo_url} alt="Receipt logo" className="h-11 max-w-[120px] rounded-[14px] bg-[var(--ps-paper)] object-contain p-1" />}
            <FilePill onFile={(file) => void uploadLogo(file)}>{s.logo_url !== '' ? 'Change' : 'Add a logo'}</FilePill>
            {s.logo_url !== '' && (
              <Button variant="danger" className={onRow} onClick={() => void save({ clear_logo: true }, 'Logo removed')}>
                Remove
              </Button>
            )}
          </Row>
          <Row label="Paper width">
            <Segmented
              label="Paper width"
              className="bg-[var(--ps-card)]"
              value={s.receipt_width}
              onChange={(v) => void save({ receipt_width: v })}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' },
              ]}
            />
          </Row>
          <Row label="After a sale" hint="What happens to the receipt">
            <Segmented
              label="After a sale"
              className="bg-[var(--ps-card)]"
              value={s.after_sale}
              onChange={(v) => void save({ after_sale: v })}
              options={[
                { value: 'ask', label: 'Ask' },
                { value: 'print', label: 'Always print' },
                { value: 'none', label: 'No receipt' },
              ]}
            />
          </Row>
          <Row label="Receipt number as a barcode" hint="Scan it to start a return">
            <Toggle checked={s.receipt_barcode} onChange={(v) => void save({ receipt_barcode: v })} label="Receipt number as a barcode" />
          </Row>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ taxes */

function TaxDialog({ t, onClose }: { t: TaxClass | null; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(t?.name ?? '');
  const [rate, setRate] = useState(t?.rate ?? '');
  const [dineIn, setDineIn] = useState(t?.dine_in_rate ?? '');
  const [mark, setMark] = useState(t?.mark ?? '');
  const [def, setDef] = useState(t?.is_default ?? false);
  const [busy, setBusy] = useState(false);
  const ok = name.trim() !== '' && parsePercent(rate || 'x') !== null && (dineIn.trim() === '' || parsePercent(dineIn) !== null);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const p = { name: name.trim(), rate: rate.trim(), dine_in_rate: dineIn.trim(), mark: mark.trim(), is_default: def };
      if (t === null) await api.addTax(p);
      else await api.updateTax({ tax_class: t.id, ...p });
      toast.success('Saved');
      onClose();
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
      title={t === null ? 'New tax class' : `Edit ${t.name}`}
      description="Past sales keep the rate they were sold at."
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!ok} loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <DialogCard>
        <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} placeholder="SST 6%" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <TextField label="Rate %" value={rate} onChange={setRate} inputMode="decimal" placeholder="6" />
          <TextField label="Rate eaten in % (if different)" value={dineIn} onChange={setDineIn} inputMode="decimal" />
        </div>
        <TextField label="Mark on receipts (e.g. ※)" value={mark} onChange={setMark} maxLength={4} />
        <div className={cn(rowCls, 'flex items-center justify-between gap-3 px-4 py-3')}>
          <span className="text-[14px] font-semibold">New products get this class</span>
          <Toggle checked={def} onChange={setDef} label="Default" />
        </div>
      </DialogCard>
    </Modal>
  );
}

function Taxes({ s }: { s: Settings }): React.JSX.Element {
  const { taxes } = useApp();
  const [busy, save] = useSave();
  const [edit, setEdit] = useState<TaxClass | null | 'new'>(null);
  const [cashRound, setCashRound] = useState(s.cash_rounding > 0 ? majorText(s.cash_rounding, s.currency_decimals) : '');
  const [sc, setSc] = useState(s.service_charge_bp > 0 ? s.service_charge : '');
  const live = taxes.filter((t) => !t.archived);
  const badRound = cashRound.trim() !== '' && parseMoney(cashRound, s.currency_decimals) === null;
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
      <div className="flex min-w-0 flex-col gap-5">
        <Card delay={1}>
          <CardHeader title="Money" />
          <div className="flex flex-col gap-2">
            <Row label="Currency" hint="Fixed once the first sale is made">
              <span className="num pr-1 text-[14px] font-bold">{s.currency}</span>
            </Row>
            <Row label="Prices" hint="How prices are entered and shown">
              <Segmented
                label="Prices"
                className="bg-[var(--ps-card)]"
                value={s.price_mode}
                onChange={(v) => void save({ price_mode: v })}
                options={[
                  { value: 'inclusive', label: 'Include tax' },
                  { value: 'exclusive', label: 'Before tax' },
                ]}
              />
            </Row>
            <Row label="Tax rounding" hint="Tax is worked out once per rate on each receipt">
              <Segmented
                label="Tax rounding"
                className="bg-[var(--ps-card)]"
                value={s.tax_rounding}
                onChange={(v) => void save({ tax_rounding: v })}
                options={[
                  { value: 'half_up', label: 'Nearest' },
                  { value: 'floor', label: 'Down' },
                  { value: 'ceil', label: 'Up' },
                ]}
              />
            </Row>
            <Row label="Cash rounding" hint="The smallest coin cash totals round to (empty: no rounding)" error={badRound ? `An amount like ${s.currency_decimals === 0 ? '500' : '4.50'}` : null}>
              <div className="relative w-[124px]">
                <span className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-[13px] font-semibold text-[var(--ps-muted)]">{symbolOf(s.currency)}</span>
                <input
                  inputMode="decimal"
                  aria-label="Amount"
                  value={cashRound}
                  onChange={(e) => setCashRound(e.target.value)}
                  placeholder={s.currency_decimals === 0 ? '0' : '0.00'}
                  className={cn(pillInput, 'num pl-11 text-right', badRound && 'ring-2 ring-[var(--ps-red)]')}
                />
              </div>
              <Button variant="primary" loading={busy} disabled={badRound} onClick={() => void save({ cash_rounding: cashRound.trim() === '' ? '0' : cashRound.trim() })}>
                Save
              </Button>
            </Row>
          </div>
        </Card>
        <Card delay={3}>
          <CardHeader title="Service charge" />
          <div className="flex flex-col gap-2">
            <Row label="Service charge %" hint="Added to dine-in orders (or every order), before tax">
              <input value={sc} inputMode="decimal" onChange={(e) => setSc(e.target.value)} placeholder="0" aria-label="Service charge percent" className={cn(pillInput, 'num w-[88px] text-right')} />
              <Button variant="primary" loading={busy} disabled={sc.trim() !== '' && parsePercent(sc) === null} onClick={() => void save({ service_charge: sc.trim() === '' ? '0' : sc.trim() })}>
                Save
              </Button>
            </Row>
            <Row label="Charged on">
              <Segmented
                label="Charged on"
                className="bg-[var(--ps-card)]"
                value={s.service_charge_scope}
                onChange={(v) => void save({ service_charge_scope: v })}
                options={[
                  { value: 'dine_in', label: 'Dine-in orders' },
                  { value: 'all', label: 'Every order' },
                ]}
              />
            </Row>
            <Row label="Tax on the service charge">
              <Select tone="card" ariaLabel="Tax on the service charge" value={s.service_charge_tax} onChange={(v) => void save({ service_charge_tax: v })} options={[{ value: '', label: 'No tax' }, ...live.map((t) => ({ value: t.id, label: t.name }))]} className="w-[200px] max-w-full" />
            </Row>
          </div>
        </Card>
      </div>
      <Card delay={2}>
        <ListHead
          title="Tax classes"
          subtitle={plural(live.length, 'class', 'classes')}
          action={
            <Button variant="primary" icon={Plus} dot onClick={() => setEdit('new')}>
              New tax class
            </Button>
          }
        />
        <div role="list" className="flex flex-col gap-2">
          {live.map((t) => (
            <div role="listitem" key={t.id} className={cn(rowCls, 'flex items-center pr-2 hover:bg-[var(--ps-row-hover)]')}>
              <button type="button" onClick={() => setEdit(t)} className="flex min-w-0 flex-1 items-center gap-3 rounded-[18px] px-3 py-3 text-left">
                <IconBadge icon={Percent} size={40} tone="card" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="min-w-0 truncate text-[14px] font-bold">
                      {t.mark !== '' && <span className="mr-1 text-[var(--ps-muted)]">{t.mark}</span>}
                      {t.name}
                    </span>
                    {t.is_default && (
                      <Badge tone="neutral" className="bg-[var(--ps-card)]">
                        Default
                      </Badge>
                    )}
                  </span>
                  <span className="num mt-0.5 block text-[12px] text-[var(--ps-muted)]">
                    {t.dine_in_rate_bp >= 0 ? `Eaten in ${percent(t.dine_in_rate_bp)} · ` : ''}
                    {plural(t.products ?? 0, 'product')}
                  </span>
                </span>
                <span className="num shrink-0 text-[14px] font-bold">{percent(t.rate_bp)}</span>
              </button>
              {t.is_default ? (
                <span aria-hidden className="size-10 shrink-0" />
              ) : (
                <IconButton
                  icon={Trash2}
                  label={`Archive ${t.name}`}
                  variant="danger"
                  onClick={() => {
                    void api
                      .archiveTax(t.id, true)
                      .then(() => toast.success(`Archived ${t.name}`))
                      .catch(() => undefined);
                  }}
                />
              )}
            </div>
          ))}
        </div>
      </Card>
      {edit !== null && <TaxDialog t={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

/* ------------------------------------------------------------ selling */

function Selling({ s }: { s: Settings }): React.JSX.Element {
  const [, save] = useSave();
  const [limit, setLimit] = useState(s.cashier_discount);
  const toggleType = (t: OrderType): void => {
    const next = s.order_types.includes(t) ? s.order_types.filter((x) => x !== t) : [...s.order_types, t];
    void save({ order_types: next });
  };
  const LABEL: Record<OrderType, string> = { dine_in: 'Dine in', takeaway: 'Takeaway', delivery: 'Delivery' };
  return (
    <div className="grid grid-cols-1 gap-5 xl:grid-cols-2 xl:items-start">
      <Card delay={1}>
        <CardHeader title="Selling" />
        <div className="flex flex-col gap-2">
          <Row label="Order types" hint="Asked on each sale (none for a shop)">
            {(['dine_in', 'takeaway', 'delivery'] as OrderType[]).map((t) => {
              const on = s.order_types.includes(t);
              return (
                <label
                  key={t}
                  className={cn(
                    'ps-press inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13px] font-semibold ring-[var(--ps-ink)] ring-offset-2 ring-offset-[var(--ps-row)] has-[:focus-visible]:ring-2',
                    on ? 'ps-on-ink bg-[var(--ps-ink)] pl-3 text-[var(--ps-shell)]' : 'bg-[var(--ps-card)] text-[var(--ps-ink)] hover:bg-[var(--ps-row-hover)]',
                  )}
                >
                  <input type="checkbox" checked={on} onChange={() => toggleType(t)} className="sr-only" />
                  {on && <Check size={14} strokeWidth={3} aria-hidden className="text-[var(--ps-accent)]" />}
                  {LABEL[t]}
                </label>
              );
            })}
          </Row>
          {s.order_types.length > 1 && (
            <Row label="New sales start as">
              <Select tone="card" ariaLabel="New sales start as" value={s.default_order_type} onChange={(v) => void save({ default_order_type: v })} options={s.order_types.map((t) => ({ value: t, label: LABEL[t] }))} className="w-[180px] max-w-full" />
            </Row>
          )}
          <Row label="Order numbers" hint="A number to call, from 1 each day">
            <Toggle checked={s.order_numbers} onChange={(v) => void save({ order_numbers: v })} label="Order numbers" />
          </Row>
          <Row label="Prices on tiles" hint="Each product's price under its name on the register">
            <Toggle checked={s.show_tile_prices} onChange={(v) => void save({ show_tile_prices: v })} label="Prices on tiles" />
          </Row>
          <Row label="Kitchen screen" hint="Paid orders with kitchen items go to the Kitchen page and the order board">
            <Toggle checked={s.kitchen_enabled} onChange={(v) => void save({ kitchen_enabled: v })} label="Kitchen screen" />
          </Row>
        </div>
      </Card>
      <Card delay={2}>
        <CardHeader title="Limits and times" />
        <div className="flex flex-col gap-2">
          <Row label="Cashier discount limit" hint="Above this a manager approves">
            <input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} aria-label="Cashier discount limit percent" className={cn(pillInput, 'num w-[88px] text-right')} />
            <span className="text-[14px] font-semibold">%</span>
            <Button variant="primary" disabled={parsePercent(limit) === null} onClick={() => void save({ cashier_discount: limit.trim() })}>
              Save
            </Button>
          </Row>
          <Row label="Lock the register when idle">
            <Select
              tone="card"
              ariaLabel="Lock the register when idle"
              value={String(s.lock_minutes)}
              onChange={(v) => void save({ lock_minutes: v })}
              options={[
                { value: '0', label: 'Never' },
                { value: '1', label: 'After 1 minute' },
                { value: '2', label: 'After 2 minutes' },
                { value: '5', label: 'After 5 minutes' },
                { value: '15', label: 'After 15 minutes' },
                { value: '30', label: 'After 30 minutes' },
              ]}
              className="w-[200px] max-w-full"
            />
          </Row>
          <Row label="The trading day ends at" hint="Late sales count to the day they started">
            <Select
              tone="card"
              ariaLabel="The trading day ends at"
              value={String(s.day_cutoff_hour)}
              onChange={(v) => void save({ day_cutoff_hour: v })}
              options={Array.from({ length: 7 }, (_, h) => ({ value: String(h), label: h === 0 ? 'Midnight' : `${h}:00 in the morning` }))}
              className="w-[200px] max-w-full"
            />
          </Row>
        </div>
      </Card>
    </div>
  );
}

/* ------------------------------------------------------------ payments */

function Payments(): React.JSX.Element {
  const [list, setList] = useState<Tender[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<Tender['kind']>('qr');
  const load = (): void => {
    api
      .tenders(true)
      .then((r) => setList(r.tenders))
      .catch(() => setList([]));
  };
  useEffect(load, []);
  const update = async (t: Tender, p: Record<string, unknown> | FormData): Promise<void> => {
    try {
      if (p instanceof FormData) {
        p.append('tender', t.id);
        await api.updateTender(p);
      } else await api.updateTender({ tender: t.id, ...p } as Record<string, string>);
      load();
    } catch {
      /* toasted */
    }
  };
  const add = async (): Promise<void> => {
    try {
      await api.addTender({ name: name.trim(), kind });
      setAdding(false);
      setName('');
      load();
    } catch {
      /* toasted */
    }
  };
  const KIND: Record<Tender['kind'], string> = { cash: 'Cash', card: 'Card', qr: 'QR', other: 'Other' };
  return (
    <Card delay={1}>
      <ListHead
        title="Payment methods"
        subtitle="Card payments go through your own card terminal; QR payments show your QR code to the customer"
        action={
          <Button variant="primary" icon={Plus} dot onClick={() => setAdding(true)}>
            New method
          </Button>
        }
      />
      {list === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div role="list" className="flex flex-col gap-2">
          {list.map((t) => (
            <div role="listitem" key={t.id} className={cn(rowCls, 'flex flex-wrap items-center gap-x-5 gap-y-3 px-3 py-3')}>
              <span className="flex min-w-0 flex-1 basis-[200px] items-center gap-3">
                <IconBadge icon={TENDER_ICON[t.kind]} size={40} tone="card" />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold">{t.name}</span>
                  <span className="block text-[12px] text-[var(--ps-muted)]">{KIND[t.kind]}</span>
                </span>
                {!t.active && (
                  <Badge tone="neutral" className="bg-[var(--ps-card)]">
                    Off
                  </Badge>
                )}
              </span>
              {t.kind === 'qr' && (
                <span className="flex items-center gap-2">
                  {t.qr_url !== '' && <img src={t.qr_url} alt={`${t.name} QR`} className="size-11 rounded-[14px] bg-[var(--ps-paper)] object-contain p-0.5" />}
                  <FilePill
                    onFile={(file) => {
                      const form = new FormData();
                      form.append('qr', file);
                      void update(t, form);
                    }}
                  >
                    {t.qr_url !== '' ? 'Change QR' : 'Add your QR'}
                  </FilePill>
                </span>
              )}
              {t.kind !== 'cash' && (
                <label className="flex items-center gap-2 text-[13px] font-semibold">
                  <Toggle checked={t.ask_reference} onChange={(v) => void update(t, { ask_reference: v })} label="Ask for a reference" /> Reference
                </label>
              )}
              <label className="flex items-center gap-2 text-[13px] font-semibold">
                <Toggle checked={t.active} onChange={(v) => void update(t, { active: v })} label={`${t.name} on`} /> On
              </label>
            </div>
          ))}
        </div>
      )}
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title="New payment method"
          footer={
            <>
              <Button variant="light" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={name.trim() === ''} onClick={() => void add()}>
                Add
              </Button>
            </>
          }
        >
          <DialogCard>
            <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={30} placeholder="DuitNow QR" />
            <Field label="Kind">
              <Segmented
                label="Kind"
                className="self-start"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'card', label: 'Card' },
                  { value: 'qr', label: 'QR' },
                  { value: 'other', label: 'Other' },
                  { value: 'cash', label: 'Cash' },
                ]}
              />
            </Field>
          </DialogCard>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ registers */

function Registers(): React.JSX.Element {
  const { registers } = useApp();
  const { register: mine } = useSession();
  const [name, setName] = useState('');
  const [adding, setAdding] = useState(false);
  const add = async (): Promise<void> => {
    try {
      await api.addRegister(name.trim());
      toast.success(`Added ${name.trim()}`);
      setAdding(false);
      setName('');
    } catch {
      /* toasted */
    }
  };
  return (
    <Card delay={1}>
      <ListHead
        title="Registers"
        subtitle="Each counter device is one register, with its own receipt numbers and cash drawer"
        action={
          <Button variant="primary" icon={Plus} dot onClick={() => setAdding(true)}>
            New register
          </Button>
        }
      />
      <div role="list" className="flex flex-col gap-2">
        {registers.map((r) => (
          <div role="listitem" key={r.id} className={cn(rowCls, 'flex flex-wrap items-center gap-3 px-3 py-3')}>
            <span className="flex min-w-0 flex-1 basis-[180px] items-center gap-3">
              <IconBadge icon={MonitorSmartphone} size={40} tone="card" />
              <span className="min-w-0">
                <span className="block truncate text-[14px] font-bold">
                  {r.name} <span className="font-semibold text-[var(--ps-muted)]">{r.code}</span>
                </span>
                <span className="num block text-[12px] text-[var(--ps-muted)]">
                  {r.receipts} receipts · {r.shift !== null ? 'open' : 'closed'}
                </span>
              </span>
            </span>
            {r.id === mine ? (
              <Badge tone="info">This device</Badge>
            ) : (
              <Button className={onRow} onClick={() => session.setRegister(r.id)}>
                Use on this device
              </Button>
            )}
            {registers.length > 1 && r.shift === null && (
              <IconButton
                icon={Trash2}
                label={`Archive ${r.name}`}
                variant="danger"
                onClick={() =>
                  void api
                    .updateRegister({ register: r.id, archived: true })
                    .then(() => toast.success(`Archived ${r.name}`))
                    .catch(() => undefined)
                }
              />
            )}
          </div>
        ))}
      </div>
      {adding && (
        <Modal
          open
          onClose={() => setAdding(false)}
          title="New register"
          footer={
            <>
              <Button variant="light" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button variant="primary" disabled={name.trim() === ''} onClick={() => void add()}>
                Add
              </Button>
            </>
          }
        >
          <DialogCard>
            <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} placeholder="Bar" onEnter={() => void add()} />
          </DialogCard>
        </Modal>
      )}
    </Card>
  );
}

/* ------------------------------------------------------------ staff */

function StaffDialog({ person, onClose }: { person: Staff | null; onClose: () => void }): React.JSX.Element {
  const { staff } = useApp();
  const [name, setName] = useState(person?.name ?? '');
  const [role, setRole] = useState<Role>(person?.role ?? 'cashier');
  const [color, setColor] = useState(person?.color ?? (staff.length % 8) + 1);
  const [pin, setPin] = useState('');
  const [training, setTraining] = useState(person?.training ?? false);
  const [busy, setBusy] = useState(false);
  const pinOk = /^\d{4,6}$/.test(pin);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      if (person === null) await api.addStaff({ name: name.trim(), role, pin, color });
      else {
        const res = await api.updateStaff({ staff: person.id, name: name.trim(), role, color, training });
        session.updateStaff(res.staff);
        if (pin !== '') await api.setPin(person.id, pin);
      }
      toast.success(person === null ? `Added ${name.trim()}` : 'Saved');
      onClose();
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
      title={person === null ? 'New person' : `Edit ${person.name}`}
      wide
      footer={
        <>
          <Button variant="light" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={name.trim() === '' || (person === null ? !pinOk : pin !== '' && !pinOk)} loading={busy} onClick={() => void save()}>
            Save
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <DialogCard>
          <div className="flex items-end gap-3">
            <Avatar name={name} color={color} size={44} />
            <div className="min-w-0 flex-1">
              <TextField label="Name" value={name} onChange={setName} autoFocus maxLength={40} />
            </div>
          </div>
          <Field label="Color">
            <ColorPicker value={color} onChange={setColor} allowNone={false} noneLabel="" />
          </Field>
        </DialogCard>
        <DialogCard>
          <Field label="Role">
            <Segmented
              label="Role"
              className="self-start"
              value={role}
              onChange={setRole}
              options={[
                { value: 'cashier', label: 'Cashier' },
                { value: 'manager', label: 'Manager' },
                { value: 'owner', label: 'Owner' },
              ]}
            />
          </Field>
          <p className="px-1 text-[13px] leading-5 text-[var(--ps-ink-2)]">
            {role === 'cashier' ? 'Sells, saves tickets, opens and closes the register. A manager approves refunds, voids, cash in or out, bigger discounts and price changes.' : role === 'manager' ? 'Everything at the counter, approvals, products, stock and reports.' : 'Everything, including settings and staff.'}
          </p>
        </DialogCard>
        <DialogCard>
          <TextField label={person === null ? 'PIN (4 to 6 digits)' : 'New PIN (leave empty to keep it)'} value={pin} onChange={(v) => setPin(v.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" />
          {person !== null && (
            <div className={cn(rowCls, 'flex items-center justify-between gap-3 px-4 py-3')}>
              <span className="text-[13px] font-semibold">Training mode (their sales are practice, kept out of reports, stock and cash)</span>
              <Toggle checked={training} onChange={setTraining} label="Training mode" />
            </div>
          )}
        </DialogCard>
      </div>
    </Modal>
  );
}

function StaffSection(): React.JSX.Element {
  const [list, setList] = useState<Staff[] | null>(null);
  const [edit, setEdit] = useState<Staff | null | 'new'>(null);
  const [confirmEl, confirm] = useConfirm();
  const load = (): void => {
    api
      .staff(true)
      .then((r) => setList(r.staff))
      .catch(() => setList([]));
  };
  useEffect(load, [edit]);
  const act = async (fn: () => Promise<unknown>, done: string): Promise<void> => {
    try {
      await fn();
      toast.success(done);
      load();
    } catch {
      /* toasted */
    }
  };
  return (
    <Card delay={1}>
      <ListHead
        title="Staff"
        subtitle="Everyone signs in with their own PIN; sales, refunds and approvals are recorded with their name"
        action={
          can('staff') ? (
            <Button variant="primary" icon={Plus} dot onClick={() => setEdit('new')}>
              New person
            </Button>
          ) : undefined
        }
      />
      {list === null ? (
        <div className="flex justify-center py-8">
          <Spinner />
        </div>
      ) : (
        <div role="list" className="grid grid-cols-1 gap-2 xl:grid-cols-2">
          {list.map((p) => (
            <div role="listitem" key={p.id} className={cn(rowCls, 'flex flex-wrap items-center gap-3 px-3 py-3')}>
              <span className="flex min-w-0 flex-1 basis-[180px] items-center gap-3">
                <Avatar name={p.name} color={p.color} size={40} />
                <span className="min-w-0">
                  <span className="block truncate text-[14px] font-bold">{p.name}</span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--ps-muted)]">
                    {ROLE_LABEL[p.role]}
                    {!p.active && (
                      <Badge tone="neutral" className="bg-[var(--ps-card)]">
                        Off
                      </Badge>
                    )}
                    {p.training && <Badge tone="warn">Training</Badge>}
                    {!p.pin_set && <Badge tone="warn">Chooses a PIN at sign-in</Badge>}
                  </span>
                </span>
              </span>
              <span className="flex items-center gap-2">
                <Button icon={UserCog} className={onRow} onClick={() => setEdit(p)}>
                  Edit
                </Button>
                <IconButton
                  icon={KeyRound}
                  label={`Clear ${p.name}'s PIN`}
                  variant="light"
                  className="hover:bg-[var(--ps-row-hover)]"
                  onClick={() =>
                    void confirm(`${p.name} chooses a new PIN the next time they sign in.`, `Clear ${p.name}'s PIN?`, 'Clear PIN').then((ok) => {
                      if (ok) void act(() => api.resetPin(p.id), `${p.name} chooses a new PIN at sign-in`);
                    })
                  }
                />
                <Toggle checked={p.active} onChange={(v) => void act(() => api.updateStaff({ staff: p.id, active: v }), v ? `${p.name} is on` : `${p.name} is off`)} label={`${p.name} can sign in`} />
              </span>
            </div>
          ))}
        </div>
      )}
      {edit !== null && <StaffDialog person={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
      {confirmEl}
    </Card>
  );
}

/* ------------------------------------------------------------ agent */

function Agent(): React.JSX.Element {
  const items: { icon: LucideIcon; title: string; text: string }[] = [
    { icon: ScanLine, title: 'Reads your menus', text: 'Add a menu photo, a PDF or a price list on Products, Import: your AI agent adds the products for you to review.' },
    { icon: Mail, title: 'Emails receipts', text: 'Email a receipt after a sale or from Orders: your AI agent sends it from your email account.' },
    { icon: NotebookPen, title: 'Writes the day’s brief', text: 'When a register closes, your AI agent sends you the day’s sales, best sellers, the cash count and anything unusual.' },
    { icon: Sparkles, title: 'Runs the back office when you ask', text: 'Prices, products, sold out, stock, customers, reports, phone orders saved as tickets. It never takes payments, refunds or moves cash, and everything it does is in Reports, Activity.' },
  ];
  return (
    <Card tone="dark" delay={1}>
      <CardHeader title="Your AI agent" subtitle="What it does in this app" />
      <ul className="grid grid-cols-1 gap-2 lg:grid-cols-2">
        {items.map((it) => (
          <li key={it.title} className="flex items-start gap-3 rounded-[18px] bg-[var(--ps-dark-2)] px-3 py-3">
            <IconBadge icon={it.icon} size={36} tone="accent" />
            <span className="min-w-0">
              <span className="block text-[14px] font-bold">{it.title}</span>
              <span className="mt-0.5 block text-[13px] leading-5 text-[var(--ps-muted)]">{it.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ page */

export function SettingsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { settings } = useApp();
  const owner = can('settings');
  const sections = SECTIONS.filter((x) => !x.owner || owner || (x.value === 'staff' && can('staff')));
  const fallback = sections[0]?.value ?? 'agent';
  const section = (sections.find((x) => x.value === query.get('s'))?.value ?? fallback) as Section;
  const strip = useRef<HTMLDivElement | null>(null);
  const ready = settings !== null;
  // On a narrow screen the pills scroll sideways: keep the open section in view.
  useEffect(() => {
    const tab = strip.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
    const list = tab?.parentElement;
    if (tab === null || tab === undefined || list === null || list === undefined) return;
    const left = list.scrollLeft + tab.getBoundingClientRect().left - list.getBoundingClientRect().left - (list.clientWidth - tab.offsetWidth) / 2;
    list.scrollTo({ left: Math.max(0, left) });
  }, [section, ready]);
  if (settings === null) return <span />;
  return (
    <div>
      <PageHeader title="Settings" />
      <div ref={strip} className="ps-rise -mx-4 mb-5 md:mx-0">
        <Tabs
          value={section}
          onChange={(v) => replaceQuery('settings', { s: v })}
          label="Settings"
          className="px-4 md:px-0"
          options={sections.map((x) => {
            const I = x.icon;
            return {
              value: x.value,
              label: (
                <>
                  <I size={15} aria-hidden /> {x.label}
                </>
              ),
            };
          })}
        />
      </div>
      {section === 'business' && <Business key={settings.business_name} s={settings} />}
      {section === 'taxes' && <Taxes s={settings} />}
      {section === 'selling' && <Selling s={settings} />}
      {section === 'payments' && <Payments />}
      {section === 'registers' && <Registers />}
      {section === 'staff' && <StaffSection />}
      {section === 'agent' && <Agent />}
    </div>
  );
}
