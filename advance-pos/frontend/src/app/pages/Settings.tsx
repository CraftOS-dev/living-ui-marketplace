/**
 * Settings, one section at a time, each saved on its own: the store and
 * its logo; receipts (with a live preview at the printer's width); tax
 * rates; payments (card terminal codes, extra tenders, cash rounding, the
 * notes and coins counted, tips); loyalty; registers and this device; and
 * how the register behaves (drawer sessions, stock, locking, reviews).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Check, CreditCard, ImagePlus, Lock, MonitorSmartphone, Pencil, Percent, Plus, ReceiptText, Star, Store, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import { useStore } from '../lib/context.tsx';
import { plain, toMinor } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { receiptHtml } from '../lib/print.ts';
import { href, replaceQuery } from '../lib/router.ts';
import { useSession } from '../lib/session.tsx';
import type { Receipt, Register, Settings, Tax } from '../lib/types.ts';
import { MoneyField } from '../components/common.tsx';
import { DeleteButton } from '../components/DeleteButton.tsx';
import { Badge, Button, Field, IconButton, Modal, PageHeader, Panel, Segmented, Select, Toggle, inputCls, textareaCls } from '../components/ui.tsx';

type Section = 'store' | 'receipts' | 'taxes' | 'payments' | 'loyalty' | 'registers' | 'behaviour';

const SECTIONS: { id: Section; label: string; icon: LucideIcon }[] = [
  { id: 'store', label: 'Store', icon: Store },
  { id: 'receipts', label: 'Receipts', icon: ReceiptText },
  { id: 'taxes', label: 'Taxes', icon: Percent },
  { id: 'payments', label: 'Payments', icon: CreditCard },
  { id: 'loyalty', label: 'Loyalty', icon: Star },
  { id: 'registers', label: 'Registers', icon: MonitorSmartphone },
  { id: 'behaviour', label: 'Register rules', icon: Lock },
];

function useSave(): [boolean, (fields: Record<string, unknown>, logo?: File | null) => Promise<boolean>] {
  const [busy, setBusy] = useState(false);
  const save = async (fields: Record<string, unknown>, logo?: File | null): Promise<boolean> => {
    setBusy(true);
    try {
      const r = (await api.saveSettings(fields, logo)) as Settings & { changed?: string[] };
      toast.success(r.changed !== undefined && r.changed.length === 0 ? 'Nothing changed' : 'Settings saved');
      return true;
    } catch {
      return false;
    } finally {
      setBusy(false);
    }
  };
  return [busy, save];
}

function SaveBar({ busy, dirty, onSave, onReset }: { busy: boolean; dirty: boolean; onSave: () => void; onReset: () => void }): React.JSX.Element {
  return (
    <div className="mt-4 flex justify-end gap-2 border-t border-[var(--ps-hair)] pt-3">
      <Button disabled={!dirty || busy} onClick={onReset}>
        Undo changes
      </Button>
      <Button variant="primary" icon={Check} loading={busy} disabled={!dirty} onClick={onSave}>
        Save
      </Button>
    </div>
  );
}

/* ------------------------------------------------------------------ store */

function StoreSection({ s }: { s: Settings }): React.JSX.Element {
  const init = (): Record<string, string> => ({ business_name: s.business_name, address: s.address, phone: s.phone, email: s.email, website: s.website, tax_number: s.tax_number, currency: s.currency });
  const [f, setF] = useState(init);
  const [logo, setLogo] = useState<File | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [preview, setPreview] = useState('');
  const [busy, save] = useSave();
  const file = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (logo === null) {
      setPreview('');
      return;
    }
    const u = URL.createObjectURL(logo);
    setPreview(u);
    return () => URL.revokeObjectURL(u);
  }, [logo]);
  const dirty = JSON.stringify(f) !== JSON.stringify(init()) || logo !== null || removeLogo;
  const set = (k: string, v: string): void => setF({ ...f, [k]: v });
  const shown = preview !== '' ? preview : !removeLogo && s.logo !== '' ? s.logo : '';
  const submit = async (): Promise<void> => {
    const fields: Record<string, unknown> = { ...f };
    if (f['currency'] === s.currency) delete fields['currency'];
    if (removeLogo && logo === null) fields['remove_logo'] = true;
    if (await save(fields, logo)) {
      setLogo(null);
      setRemoveLogo(false);
    }
  };
  return (
    <Panel title="Store" subtitle="Printed on receipts and shown on the customer display">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Business name">
            <input className={inputCls} value={f['business_name']} onChange={(e) => set('business_name', e.target.value)} maxLength={120} />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Address">
            <textarea className={textareaCls} rows={2} value={f['address']} onChange={(e) => set('address', e.target.value)} maxLength={600} />
          </Field>
        </div>
        <Field label="Phone">
          <input className={inputCls} value={f['phone']} onChange={(e) => set('phone', e.target.value)} maxLength={60} />
        </Field>
        <Field label="Email">
          <input className={inputCls} value={f['email']} onChange={(e) => set('email', e.target.value)} maxLength={200} />
        </Field>
        <Field label="Website">
          <input className={inputCls} value={f['website']} onChange={(e) => set('website', e.target.value)} maxLength={200} />
        </Field>
        <Field label="Tax number" hint="VAT, GST or sales tax registration">
          <input className={inputCls} value={f['tax_number']} onChange={(e) => set('tax_number', e.target.value)} maxLength={80} />
        </Field>
        <Field label="Currency" hint={s.has_sales ? 'Fixed once sales are recorded' : 'Three letters, like USD or EUR'}>
          <input className={inputCls + ' uppercase'} value={f['currency']} disabled={s.has_sales} onChange={(e) => set('currency', e.target.value.toUpperCase().slice(0, 3))} />
        </Field>
        <Field group label="Logo" hint="PNG, JPEG, WebP or SVG, up to 2 MB">
          <div className="flex items-center gap-2">
            {shown !== '' ? <img src={shown} alt="" className="h-10 max-w-[120px] rounded-[var(--ps-r-sm)] border border-[var(--ps-line)] object-contain" /> : <span className="flex h-10 w-16 items-center justify-center rounded-[var(--ps-r-sm)] border border-dashed border-[var(--ps-line)] text-[12px] text-[var(--ps-muted)]">None</span>}
            <Button size="sm" icon={ImagePlus} onClick={() => file.current?.click()}>
              Choose
            </Button>
            {shown !== '' && (
              <IconButton
                icon={X}
                label="Remove the logo"
                onClick={() => {
                  setLogo(null);
                  setRemoveLogo(true);
                }}
              />
            )}
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              className="hidden"
              onChange={(e) => {
                const x = e.target.files?.[0];
                if (x !== undefined) {
                  if (x.size > 2 * 1024 * 1024) toast.error('The logo is larger than 2 MB');
                  else {
                    setLogo(x);
                    setRemoveLogo(false);
                  }
                }
                e.target.value = '';
              }}
            />
          </div>
        </Field>
      </div>
      <SaveBar
        busy={busy}
        dirty={dirty}
        onSave={() => void submit()}
        onReset={() => {
          setF(init());
          setLogo(null);
          setRemoveLogo(false);
        }}
      />
    </Panel>
  );
}

/* --------------------------------------------------------------- receipts */

function sampleReceipt(s: Settings, f: Record<string, string>, digits: number): Receipt {
  const unit = 10 ** digits;
  const a = Math.round(4.5 * unit);
  const b = Math.round(3.25 * unit);
  const sub = a * 2 + b;
  const tax = Math.round((sub * 8) / 100);
  return {
    number: (f['receipt_prefix'] ?? '') + String(s.next_receipt),
    status: 'paid',
    date: new Date().toISOString(),
    register: 'Register 1',
    cashier: 'Sam',
    label: '',
    note: '',
    customer: null,
    currency: s.currency,
    prices_include_tax: s.prices_include_tax,
    store: { name: s.business_name, address: s.address, phone: s.phone, email: s.email, website: s.website, tax_number: s.tax_number, header: f['receipt_header'] ?? '', footer: f['receipt_footer'] ?? '', logo: s.logo, width: (f['receipt_width'] ?? '80') as '58' | '80' },
    lines: [
      { kind: 'item', name: 'Flat white', qty: 2, unit: '', each: a, gross: a * 2, discount: 0, total: a * 2, is_return: false, modifiers: [{ name: 'Oat milk', price: 0 }], line_discount: null, promotion: null, gift_code: '', note: '' },
      { kind: 'item', name: 'Croissant', qty: 1, unit: '', each: b, gross: b, discount: 0, total: b, is_return: false, modifiers: [], line_discount: null, promotion: null, gift_code: '', note: '' },
    ],
    subtotal: sub,
    discount_total: 0,
    order_discount: null,
    taxes: [{ id: 't', name: 'Sales tax', rate: 8, base: sub, tax }],
    tax_total: tax,
    total: sub + tax,
    tip: 0,
    rounding: 0,
    due: sub + tax,
    payments: [{ tender: 'card', label: '', amount: sub + tax, tendered: 0, change: 0, reference: '1234' }],
    change: 0,
    points_earned: 0,
    text: '',
  };
}

function ReceiptsSection({ s }: { s: Settings }): React.JSX.Element {
  const { money } = useStore();
  const init = (): Record<string, string> => ({ receipt_header: s.receipt_header, receipt_footer: s.receipt_footer, receipt_width: s.receipt_width, receipt_prefix: s.receipt_prefix, next_receipt: String(s.next_receipt) });
  const [f, setF] = useState(init);
  const start = useRef(String(s.next_receipt));
  const [busy, save] = useSave();
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const set = (k: string, v: string): void => setF({ ...f, [k]: v });
  const html = useMemo(() => receiptHtml(sampleReceipt(s, f, money.digits), money), [s, f, money]);
  const nextOk = /^\d+$/.test(f['next_receipt'] ?? '') && Number(f['next_receipt']) >= 1;
  return (
    <Panel title="Receipts">
      <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
        <div className="grid content-start gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Message at the top">
              <textarea className={textareaCls} rows={2} value={f['receipt_header']} onChange={(e) => set('receipt_header', e.target.value)} maxLength={600} placeholder="Welcome!" />
            </Field>
          </div>
          <div className="sm:col-span-2">
            <Field label="Message at the bottom" hint="Returns policy, opening hours, a thank-you">
              <textarea className={textareaCls} rows={3} value={f['receipt_footer']} onChange={(e) => set('receipt_footer', e.target.value)} maxLength={600} placeholder="Returns within 30 days with this receipt." />
            </Field>
          </div>
          <Field group label="Paper width">
            <Segmented
              label="Paper width"
              value={f['receipt_width'] ?? '80'}
              onChange={(v) => set('receipt_width', v)}
              options={[
                { value: '80', label: '80 mm' },
                { value: '58', label: '58 mm' },
              ]}
            />
          </Field>
          <Field group label="Receipt numbers" hint="Prefix, then the next number" error={nextOk ? null : 'A whole number'}>
            <div className="flex gap-2">
              <input className={inputCls + ' w-20'} value={f['receipt_prefix']} onChange={(e) => set('receipt_prefix', e.target.value)} maxLength={12} placeholder="None" aria-label="Prefix" />
              <input className={inputCls + ' num flex-1 text-right'} inputMode="numeric" value={f['next_receipt']} onChange={(e) => set('next_receipt', e.target.value.replace(/\D/g, ''))} aria-label="Next number" />
            </div>
          </Field>
        </div>
        <div>
          <p className="mb-1 text-[12px] font-semibold text-[var(--ps-ink-2)]">Preview</p>
          <iframe title="Receipt preview" srcDoc={html} className="h-[420px] rounded-[var(--ps-r-md)] border border-[var(--ps-line)] bg-white" style={{ width: f['receipt_width'] === '58' ? 240 : 320 }} />
        </div>
      </div>
      <SaveBar
        busy={busy}
        dirty={dirty}
        onSave={() => {
          if (!nextOk) return;
          const fields: Record<string, unknown> = { receipt_header: f['receipt_header'], receipt_footer: f['receipt_footer'], receipt_width: f['receipt_width'], receipt_prefix: f['receipt_prefix'] };
          // The next number moves with every sale; send it only when it was changed here.
          if (f['next_receipt'] !== start.current) fields['next_receipt'] = Number(f['next_receipt']);
          void save(fields);
        }}
        onReset={() => setF(init())}
      />
    </Panel>
  );
}

/* ------------------------------------------------------------------ taxes */

function TaxesSection({ s }: { s: Settings }): React.JSX.Element {
  const list = useLive(() => api.taxes(), ['taxes'], []);
  const [edit, setEdit] = useState<Tax | 'new' | null>(null);
  const [name, setName] = useState('');
  const [rate, setRate] = useState('');
  const [isDefault, setIsDefault] = useState(false);
  const [busy, setBusy] = useState(false);
  const [busyInc, saveInc] = useSave();
  useEffect(() => {
    if (edit === 'new') {
      setName('');
      setRate('');
      setIsDefault((list.data?.taxes ?? []).length === 0);
    } else if (edit !== null) {
      setName(edit.name);
      setRate(String(edit.rate));
      setIsDefault(edit.is_default);
    }
  }, [edit, list.data]);
  const r = Number(rate.replace(',', '.'));
  const ok = name.trim() !== '' && rate.trim() !== '' && Number.isFinite(r) && r >= 0 && r <= 100;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveTax({ id: edit !== 'new' && edit !== null ? edit.id : undefined, name: name.trim(), rate: r, is_default: isDefault });
      setEdit(null);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-4">
      <Panel title="How prices are entered">
        <label className="flex items-center justify-between gap-3">
          <span>
            <span className="block text-[13px] font-semibold">Prices include tax</span>
            <span className="block text-[12px] text-[var(--ps-muted)]">On: the shelf price is what the customer pays (VAT, GST). Off: tax is added at the till (sales tax).</span>
          </span>
          {busyInc ? <span className="text-[12px] text-[var(--ps-muted)]">Saving</span> : <Toggle checked={s.prices_include_tax} onChange={(v) => void saveInc({ prices_include_tax: v })} label="Prices include tax" />}
        </label>
      </Panel>
      <Panel
        title="Tax rates"
        subtitle="Products use the default rate unless they name another"
        padded={false}
        actions={
          <Button size="sm" icon={Plus} onClick={() => setEdit('new')}>
            New rate
          </Button>
        }
      >
        <ul className="divide-y divide-[var(--ps-hair)]">
          {(list.data?.taxes ?? []).map((t) => (
            <li key={t.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 text-[13px] font-semibold">{t.name}</span>
              <span className="num text-[13px]">{t.rate}%</span>
              {t.is_default && <Badge tone="info">Default</Badge>}
              <IconButton icon={Pencil} label={'Edit ' + t.name} onClick={() => setEdit(t)} />
              <DeleteButton collection="taxes" id={t.id} name={t.name} />
            </li>
          ))}
          {(list.data?.taxes ?? []).length === 0 && <li className="px-3 py-4 text-center text-[12px] text-[var(--ps-muted)]">No tax rates: nothing is taxed</li>}
        </ul>
      </Panel>
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'New tax rate' : 'Edit tax rate'}
        description={edit !== 'new' && edit !== null ? 'A new rate applies to new sales; past sales keep the rate they were sold with.' : undefined}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={Check} loading={busy} disabled={!ok} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Sales tax" />
          </Field>
          <Field label="Rate %">
            <input className={inputCls + ' num text-right'} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} placeholder="8.875" />
          </Field>
          <label className="col-span-2 flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
            <span className="text-[13px] font-semibold">The store's default rate</span>
            <Toggle checked={isDefault} onChange={setIsDefault} label="Default rate" />
          </label>
        </div>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- payments */

function PaymentsSection({ s }: { s: Settings }): React.JSX.Element {
  const { money } = useStore();
  const init = (): { card: string; round: string; denoms: string; tips: boolean; presets: string; basis: string; tenders: { id?: string | undefined; label: string }[] } => ({
    card: s.card_reference,
    round: s.cash_round_to === 0 ? '' : plain(s.cash_round_to, money.digits),
    denoms: s.denominations.map((d) => plain(d, money.digits)).join(', '),
    tips: s.tips_enabled,
    presets: s.tip_presets.join(', '),
    basis: s.tip_basis,
    tenders: s.custom_tenders.map((t) => ({ id: t.id, label: t.label })),
  });
  const [f, setF] = useState(init);
  const [busy, save] = useSave();
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const denoms = f.denoms
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const denomsOk = denoms.every((x) => (toMinor(x, money.digits) ?? 0) > 0);
  const presets = f.presets
    .split(',')
    .map((x) => x.trim())
    .filter((x) => x !== '');
  const presetsOk = presets.length <= 5 && presets.every((x) => Number(x) > 0 && Number(x) <= 100);
  const roundOk = f.round.trim() === '' || (toMinor(f.round, money.digits) ?? -1) >= 0;
  const tendersOk = f.tenders.every((t) => t.label.trim() !== '');
  const ok = denomsOk && presetsOk && roundOk && tendersOk;
  return (
    <Panel title="Payments">
      <div className="flex flex-col gap-5">
        <section className="grid gap-3 sm:grid-cols-2">
          <Field label="Card terminal code" hint="The approval code or last 4 digits, typed after a card payment">
            <Select
              ariaLabel="Card terminal code"
              value={f.card}
              onChange={(v) => setF({ ...f, card: v })}
              options={[
                { value: 'optional', label: 'Ask, but it can be skipped' },
                { value: 'required', label: 'Required for every card payment' },
                { value: 'off', label: 'Do not ask' },
              ]}
            />
          </Field>
          <Field label="Round cash totals to" hint="Empty for no rounding; 0.05 where 1 and 2 cent coins are gone">
            <MoneyField value={f.round} onChange={(v) => setF({ ...f, round: v })} money={money} label="Round cash to" placeholder="No rounding" />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Notes and coins" hint="Counted when the drawer opens and closes; used for the cash suggestions at checkout" error={denomsOk ? null : 'Amounts separated by commas'}>
              <input className={inputCls + ' num'} value={f.denoms} onChange={(e) => setF({ ...f, denoms: e.target.value })} />
            </Field>
          </div>
        </section>
        <section className="flex flex-col gap-2 border-t border-[var(--ps-hair)] pt-4">
          <h3 className="text-[12px] font-bold text-[var(--ps-ink-2)]">Other ways to pay</h3>
          <p className="text-[12px] text-[var(--ps-muted)]">Cash, card, gift cards, store credit and points are built in. Add others, like a bank transfer or a delivery app.</p>
          {f.tenders.map((t, i) => (
            <div key={t.id ?? 'n' + i} className="flex items-center gap-2">
              <input className={inputCls + ' max-w-xs'} value={t.label} onChange={(e) => setF({ ...f, tenders: f.tenders.map((x, k) => (k === i ? { ...x, label: e.target.value } : x)) })} maxLength={40} placeholder="Bank transfer" aria-label="Tender name" />
              <IconButton icon={Trash2} label={'Remove ' + t.label} variant="danger" onClick={() => setF({ ...f, tenders: f.tenders.filter((_, k) => k !== i) })} />
            </div>
          ))}
          <Button size="sm" variant="ghost" icon={Plus} className="self-start" disabled={f.tenders.length >= 10} onClick={() => setF({ ...f, tenders: [...f.tenders, { label: '' }] })}>
            Add a way to pay
          </Button>
        </section>
        <section className="grid gap-3 border-t border-[var(--ps-hair)] pt-4 sm:grid-cols-2">
          <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 sm:col-span-2">
            <span className="text-[13px] font-semibold">Ask for a tip at checkout</span>
            <Toggle checked={f.tips} onChange={(v) => setF({ ...f, tips: v })} label="Tips" />
          </label>
          {f.tips && (
            <>
              <Field label="Tip choices (%)" error={presetsOk ? null : 'Up to 5 percentages'}>
                <input className={inputCls + ' num'} value={f.presets} onChange={(e) => setF({ ...f, presets: e.target.value })} placeholder="10, 15, 20" />
              </Field>
              <Field label="Tips are a share of">
                <Select
                  ariaLabel="Tip basis"
                  value={f.basis}
                  onChange={(v) => setF({ ...f, basis: v })}
                  options={[
                    { value: 'before_tax', label: 'The total before tax' },
                    { value: 'after_tax', label: 'The total with tax' },
                  ]}
                />
              </Field>
            </>
          )}
        </section>
      </div>
      <SaveBar
        busy={busy}
        dirty={dirty}
        onSave={() =>
          ok &&
          void save({
            card_reference: f.card,
            cash_round_to: f.round.trim() === '' ? '0' : f.round.trim(),
            denominations: denoms,
            tips_enabled: f.tips,
            tip_presets: presets.map(Number),
            tip_basis: f.basis,
            tenders: f.tenders.map((t) => ({ id: t.id, label: t.label.trim() })),
          })
        }
        onReset={() => setF(init())}
      />
    </Panel>
  );
}

/* ---------------------------------------------------------------- loyalty */

function LoyaltySection({ s }: { s: Settings }): React.JSX.Element {
  const { money } = useStore();
  const init = (): { on: boolean; per: string; value: string; min: string } => ({ on: s.loyalty_enabled, per: String(s.points_per_unit), value: plain(s.point_value, money.digits), min: String(s.points_min_redeem) });
  const [f, setF] = useState(init);
  const [busy, save] = useSave();
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const perOk = Number.isFinite(Number(f.per)) && Number(f.per) >= 0;
  const valueOk = (toMinor(f.value, money.digits) ?? -1) >= 0;
  const minOk = /^\d+$/.test(f.min);
  const worth = toMinor(f.value, money.digits) ?? 0;
  return (
    <Panel title="Loyalty points" subtitle="Customers earn points on what they spend and pay with them later">
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2 sm:col-span-3">
          <span className="text-[13px] font-semibold">Points are on</span>
          <Toggle checked={f.on} onChange={(v) => setF({ ...f, on: v })} label="Points are on" />
        </label>
        <Field label={'Points per ' + money.fmt(10 ** money.digits) + ' spent'} error={perOk ? null : 'A number'}>
          <input className={inputCls + ' num text-right'} inputMode="decimal" value={f.per} onChange={(e) => setF({ ...f, per: e.target.value })} />
        </Field>
        <Field label="One point is worth" error={valueOk ? null : 'An amount'}>
          <MoneyField value={f.value} onChange={(v) => setF({ ...f, value: v })} money={money} label="Point value" />
        </Field>
        <Field label="Fewest points to pay with" error={minOk ? null : 'A whole number'}>
          <input className={inputCls + ' num text-right'} inputMode="numeric" value={f.min} onChange={(e) => setF({ ...f, min: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      {perOk && valueOk && Number(f.per) > 0 && worth > 0 && (
        <p className="mt-3 text-[12px] text-[var(--ps-muted)]">
          A customer who spends {money.fmt(100 * 10 ** money.digits)} earns {Math.floor(100 * Number(f.per))} points, worth {money.fmt(Math.floor(100 * Number(f.per)) * worth)} next time.
        </p>
      )}
      <SaveBar busy={busy} dirty={dirty} onSave={() => perOk && valueOk && minOk && void save({ loyalty_enabled: f.on, points_per_unit: Number(f.per), point_value: f.value.trim(), points_min_redeem: Number(f.min) })} onReset={() => setF(init())} />
    </Panel>
  );
}

/* -------------------------------------------------------------- registers */

function RegistersSection(): React.JSX.Element {
  const { deviceRegister, setDeviceRegister, register } = useSession();
  const list = useLive(() => api.registers(), ['registers', 'shifts'], []);
  const [edit, setEdit] = useState<Register | 'new' | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (edit === 'new') setName('');
    else if (edit !== null) setName(edit.name);
  }, [edit]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.saveRegister({ id: edit !== 'new' && edit !== null ? edit.id : undefined, name: name.trim() });
      setEdit(null);
    } catch {
      // Shown by the transport.
    } finally {
      setBusy(false);
    }
  };
  const toggle = async (r: Register): Promise<void> => {
    try {
      await api.saveRegister({ id: r.id, active: !r.active });
    } catch {
      // Shown by the transport.
    }
  };
  const regs = list.data?.registers ?? [];
  return (
    <div className="flex flex-col gap-4">
      <Panel
        title="Registers"
        subtitle="Each counter or device that sells has its own drawer"
        padded={false}
        actions={
          <Button size="sm" icon={Plus} onClick={() => setEdit('new')}>
            New register
          </Button>
        }
      >
        <ul className="divide-y divide-[var(--ps-hair)]">
          {regs.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">
                  {r.name}
                  {register !== null && r.id === register.id && <span className="font-normal text-[var(--ps-muted)]"> (this device)</span>}
                </span>
                <span className="block text-[12px] text-[var(--ps-muted)]">{r.shift !== null ? 'Drawer open' : 'Drawer closed'}</span>
              </span>
              <a href={href('display', { register: r.id })} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-[var(--ps-r)] px-2 text-[12px] font-semibold text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)]">
                <MonitorSmartphone size={13} />
                Customer display
              </a>
              <Toggle checked={r.active} onChange={() => void toggle(r)} label={(r.active ? 'Turn off ' : 'Turn on ') + r.name} />
              <IconButton icon={Pencil} label={'Rename ' + r.name} onClick={() => setEdit(r)} />
              <DeleteButton collection="registers" id={r.id} name={r.name} />
            </li>
          ))}
        </ul>
      </Panel>
      <Panel title="This device">
        <Field label="This device sells as" hint="Takes effect the next time someone signs in here">
          <Select ariaLabel="This device sells as" value={deviceRegister} onChange={setDeviceRegister} className="max-w-xs" options={regs.filter((r) => r.active).map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
      </Panel>
      <Modal
        open={edit !== null}
        onClose={() => setEdit(null)}
        title={edit === 'new' ? 'New register' : 'Rename register'}
        footer={
          <>
            <Button onClick={() => setEdit(null)}>Cancel</Button>
            <Button variant="primary" icon={Check} loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
              Save
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() !== '') void save();
          }}
        >
          <Field label="Name">
            <input autoFocus className={inputCls} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Front counter" />
          </Field>
        </form>
      </Modal>
    </div>
  );
}

/* --------------------------------------------------------------- behaviour */

function BehaviourSection({ s }: { s: Settings }): React.JSX.Element {
  const init = (): { shift: boolean; negative: boolean; low: string; idle: string; afterSale: boolean; review: boolean; tilePrices: boolean } => ({ shift: s.require_shift, negative: s.allow_negative_stock, low: String(s.low_stock_default), idle: String(s.lock_idle_minutes), afterSale: s.lock_after_sale, review: s.auto_shift_review, tilePrices: s.show_tile_prices });
  const [f, setF] = useState(init);
  const [busy, save] = useSave();
  const dirty = JSON.stringify(f) !== JSON.stringify(init());
  const idleOk = /^\d+$/.test(f.idle) && Number(f.idle) <= 240;
  const lowOk = Number.isFinite(Number(f.low)) && Number(f.low) >= 0;
  const row = (label: string, hint: string, checked: boolean, on: (v: boolean) => void): React.JSX.Element => (
    <label className="flex items-center justify-between gap-3 rounded-[var(--ps-r)] bg-[var(--ps-row)] px-3 py-2">
      <span>
        <span className="block text-[13px] font-semibold">{label}</span>
        <span className="block text-[12px] text-[var(--ps-muted)]">{hint}</span>
      </span>
      <Toggle checked={checked} onChange={on} label={label} />
    </label>
  );
  return (
    <Panel title="Register rules">
      <div className="flex flex-col gap-2">
        {row('Open the drawer before taking payments', 'Every payment belongs to a counted drawer session.', f.shift, (v) => setF({ ...f, shift: v }))}
        {row('Sell items that are out of stock', 'Off: the register refuses to sell more than is on hand.', f.negative, (v) => setF({ ...f, negative: v }))}
        {row('Show prices on product tiles', 'Off: a tile shows the picture and the name only; the price still shows on the sale.', f.tilePrices, (v) => setF({ ...f, tilePrices: v }))}
        {row('Lock after every sale', 'The next sale starts with a PIN, so every sale has the right name on it.', f.afterSale, (v) => setF({ ...f, afterSale: v }))}
        {row('Ask your AI agent to review every closed drawer', 'It looks for cash differences, voids, refunds and drawer opens.', f.review, (v) => setF({ ...f, review: v }))}
        <div className="mt-2 grid gap-3 sm:grid-cols-2">
          <Field label="Lock when idle for (minutes)" hint="0 never locks by itself" error={idleOk ? null : '0 to 240'}>
            <input className={inputCls + ' num text-right'} inputMode="numeric" value={f.idle} onChange={(e) => setF({ ...f, idle: e.target.value.replace(/\D/g, '') })} />
          </Field>
          <Field label="Low stock level for new items" error={lowOk ? null : 'A number'}>
            <input className={inputCls + ' num text-right'} inputMode="decimal" value={f.low} onChange={(e) => setF({ ...f, low: e.target.value })} />
          </Field>
        </div>
      </div>
      <SaveBar busy={busy} dirty={dirty} onSave={() => idleOk && lowOk && void save({ require_shift: f.shift, allow_negative_stock: f.negative, low_stock_default: Number(f.low), lock_idle_minutes: Number(f.idle), lock_after_sale: f.afterSale, auto_shift_review: f.review, show_tile_prices: f.tilePrices })} onReset={() => setF(init())} />
    </Panel>
  );
}

const SECTION_FIELDS: Record<Section, (keyof Settings)[]> = {
  store: ['business_name', 'address', 'phone', 'email', 'website', 'tax_number', 'currency', 'logo', 'has_sales'],
  receipts: ['receipt_header', 'receipt_footer', 'receipt_width', 'receipt_prefix'],
  taxes: ['prices_include_tax'],
  payments: ['card_reference', 'cash_round_to', 'denominations', 'tips_enabled', 'tip_presets', 'tip_basis', 'custom_tenders', 'currency_digits'],
  loyalty: ['loyalty_enabled', 'points_per_unit', 'point_value', 'points_min_redeem'],
  registers: [],
  behaviour: ['require_shift', 'allow_negative_stock', 'low_stock_default', 'lock_idle_minutes', 'lock_after_sale', 'auto_shift_review', 'show_tile_prices'],
};

function sectionKey(tab: Section, s: Settings): string {
  return tab + ':' + JSON.stringify(SECTION_FIELDS[tab].map((k) => s[k]));
}

export function SettingsPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const { settings } = useStore();
  const [tab, setTab] = useState<Section>((SECTIONS.find((x) => x.id === query.get('tab'))?.id ?? 'store') as Section);
  useEffect(() => replaceQuery('settings', { tab: tab === 'store' ? '' : tab }), [tab]);
  if (settings === null) return <div className="py-16" />;
  // A section re-reads the saved settings when its own fields change (a sale
  // moving the next receipt number must not wipe an edit in progress).
  const key = sectionKey(tab, settings);
  return (
    <div>
      <PageHeader title="Settings" />
      <div className="grid gap-4 md:grid-cols-[200px_1fr]">
        <nav aria-label="Settings" className="flex gap-1 overflow-x-auto md:flex-col">
          {SECTIONS.map((x) => {
            const Icon = x.icon;
            const on = x.id === tab;
            return (
              <button key={x.id} type="button" onClick={() => setTab(x.id)} aria-current={on ? 'page' : undefined} className={cn('flex h-8 shrink-0 items-center gap-2 rounded-[var(--ps-r)] px-2.5 text-left text-[13px] font-semibold', on ? 'bg-[var(--ps-row-hover)] text-[var(--ps-ink)]' : 'text-[var(--ps-ink-2)] hover:bg-[var(--ps-row)] hover:text-[var(--ps-ink)]')}>
                <Icon size={15} />
                {x.label}
              </button>
            );
          })}
        </nav>
        <div className="min-w-0" key={key}>
          {tab === 'store' && <StoreSection s={settings} />}
          {tab === 'receipts' && <ReceiptsSection s={settings} />}
          {tab === 'taxes' && <TaxesSection s={settings} />}
          {tab === 'payments' && <PaymentsSection s={settings} />}
          {tab === 'loyalty' && <LoyaltySection s={settings} />}
          {tab === 'registers' && <RegistersSection />}
          {tab === 'behaviour' && <BehaviourSection s={settings} />}
        </div>
      </div>
    </div>
  );
}
