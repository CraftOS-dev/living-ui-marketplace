/**
 * The one "Add expense" action. On a phone it opens the camera at once: the
 * photo becomes a draft line and your AI agent reads it. On a desktop a
 * dialog takes receipts by drop or file, or the expense typed in one line
 * (category, amount, day, where). Mileage is distance times the rate.
 * Photos are made smaller before they are sent (2000 px, JPEG), so a
 * receipt uploads in a moment on a phone network.
 */
import { useMemo, useRef, useState } from 'react';
import { Camera, Plus } from 'lucide-react';
import { Money, Button, DayPicker, Dialog, Field, FileDrop, Input, LinkButton, MoneyInput, Select, majorParam, toast } from '../ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed } from '../../lib/live.ts';
import { today } from '../../lib/format.ts';
import { exponent } from '../../lib/money.ts';
import { navigate } from '../../lib/router.ts';
import type { Category, Claim, Line } from '../../pages/expenses/types.ts';
import { CategoryIcon } from './parts.tsx';

export interface AddResult {
  line: Line;
  claim: Claim;
  started: boolean;
}

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'MYR', 'INR', 'AUD', 'CAD', 'CNY', 'HKD', 'THB', 'IDR', 'PHP', 'KRW', 'TWD', 'VND', 'AED', 'SAR', 'CHF', 'NZD'];
const READS = ['claims', 'claim_lines'];

/** A per-unit rate in minor units as major-unit text (72.5 cents -> "0.725"). */
export function rateText(minor: number, currency: string): string {
  return String(Math.round((minor / 10 ** exponent(currency)) * 10000) / 10000);
}

/** A phone (or any touch-first screen): the camera is the first step. */
export function isPhone(): boolean {
  try {
    return window.matchMedia('(max-width: 767px)').matches || window.matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** A photo made smaller (long side 2000 px, JPEG 85) when it is large; PDFs and HEIC go as they are. */
export async function shrink(file: File): Promise<File> {
  if (!file.type.startsWith('image/') || /hei[cf]/i.test(file.type) || file.size < 700000) return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const g = canvas.getContext('2d');
    if (g === null) return file;
    g.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.85));
    if (blob === null || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg' });
  } catch {
    return file;
  }
}

/** Send receipt files as new lines (each one a line your AI agent reads). */
export async function uploadReceipts(files: File[], target: { claim?: string | undefined; employment?: string | undefined }): Promise<AddResult[]> {
  const out: AddResult[] = [];
  for (const f of files) {
    try {
      const small = await shrink(f);
      out.push(await opForm<AddResult>('claim-lines.add', { claim: target.claim, employment: target.employment }, { receipt: small }));
    } catch {
      /* the toast says why */
    }
  }
  changed(...READS);
  if (out.length > 0) {
    const claim = out[out.length - 1]?.claim;
    toast.success(tn('exp.add.receipts_added', out.length), claim !== undefined ? { label: t('exp.open_claim'), run: () => navigate(`/expenses/claims/${claim.number}`) } : undefined);
  }
  return out;
}

export function AddExpense({ categories, currency, entity, claim, employment, onAdded, variant = 'primary', size = 'md', label, className }: { categories: Category[]; currency: string; entity?: string | undefined; claim?: string | undefined; employment?: string | undefined; onAdded?: ((r: AddResult[]) => void) | undefined; variant?: 'primary' | 'default' | undefined; size?: 'sm' | 'md' | 'lg' | undefined; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const camera = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const target = { claim, employment };
  const snap = async (files: File[]): Promise<void> => {
    setBusy(true);
    const r = await uploadReceipts(files, target);
    setBusy(false);
    if (r.length > 0) onAdded?.(r);
  };
  return (
    <>
      <Button
        variant={variant}
        size={size}
        icon={Plus}
        busy={busy}
        className={className}
        onClick={() => {
          if (isPhone()) camera.current?.click();
          else setOpen(true);
        }}
      >
        {label ?? t('exp.add.title')}
      </Button>
      <input
        ref={camera}
        type="file"
        accept="image/*,application/pdf"
        capture="environment"
        className="hidden"
        aria-label={t('exp.add.photo')}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (files.length > 0) void snap(files);
        }}
      />
      {isPhone() && (
        <LinkButton onClick={() => setOpen(true)} className="md:hidden">
          {t('exp.add.type_in')}
        </LinkButton>
      )}
      {open && (
        <AddDialog
          categories={categories}
          currency={currency}
          entity={entity}
          target={target}
          onClose={() => setOpen(false)}
          onAdded={(r) => {
            setOpen(false);
            onAdded?.(r);
          }}
        />
      )}
    </>
  );
}

function AddDialog({ categories, currency, entity, target, onClose, onAdded }: { categories: Category[]; currency: string; entity?: string | undefined; target: { claim?: string | undefined; employment?: string | undefined }; onClose: () => void; onAdded: (r: AddResult[]) => void }): React.JSX.Element {
  const active = categories.filter((c) => !c.archived);
  const [cat, setCat] = useState<string>('');
  const [cur, setCur] = useState(currency);
  const [amount, setAmount] = useState<number | null>(null);
  const [distance, setDistance] = useState('');
  const [day, setDay] = useState(() => today({ entity }));
  const [merchant, setMerchant] = useState('');
  const [busy, setBusy] = useState(false);
  const chosen = active.find((c) => c.code === cat) ?? null;
  const mileage = chosen?.kind === 'mileage';
  const km = Number(distance.replace(',', '.'));
  const mileageMinor = mileage && Number.isFinite(km) && km > 0 && chosen !== null ? Math.round(km * chosen.mileage_rate_minor) : null;
  const ready = chosen !== null && (mileage ? mileageMinor !== null && mileageMinor > 0 : amount !== null && amount > 0) && day !== '';
  const currencies = useMemo(() => [currency, ...CURRENCIES.filter((c) => c !== currency)], [currency]);

  const save = async (): Promise<void> => {
    if (!ready || chosen === null) return;
    setBusy(true);
    try {
      const r = await op<AddResult>('claim-lines.add', {
        claim: target.claim,
        employment: target.employment,
        category: chosen.code,
        day,
        ...(merchant.trim() === '' ? {} : mileage ? { description: merchant.trim() } : { merchant: merchant.trim() }),
        ...(mileage ? { distance: km } : { amount: majorParam(amount, cur), currency: cur }),
      });
      changed(...READS);
      toast.success(t('exp.add.added', { what: chosen.name }), { label: t('exp.open_claim'), run: () => navigate(`/expenses/claims/${r.claim.number}`) });
      onAdded([r]);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.add.title')}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Plus} busy={busy} disabled={!ready} onClick={() => void save()}>
            {t('exp.add.title')}
          </Button>
        </>
      }
    >
      <FileDrop label={t('exp.add.choose')} accept="image/*,application/pdf" multiple onFiles={(files) => void uploadReceipts(files, target).then((r) => r.length > 0 && onAdded(r))}>
        <Camera size={18} strokeWidth={1.7} aria-hidden className="text-[var(--hr-muted)]" />
        <div className="text-[12px] text-[var(--hr-muted)]">{t('exp.add.drop')}</div>
      </FileDrop>
      <div className="my-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-[var(--hr-hair)]" />
        <span className="hr-label">{t('exp.add.or_type')}</span>
        <span className="h-px flex-1 bg-[var(--hr-hair)]" />
      </div>
      <div className="flex flex-col gap-3">
        <Field label={t('exp.f.category')}>
          <div role="radiogroup" aria-label={t('exp.f.category')} className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {active.map((c) => (
              <button
                key={c.id}
                type="button"
                role="radio"
                aria-checked={cat === c.code}
                onClick={() => setCat(c.code)}
                title={c.description}
                className={`hr-focus flex h-10 min-w-0 cursor-pointer items-center gap-2 rounded-[var(--hr-radius-sm)] border px-2.5 text-left text-[13px] transition-colors ${cat === c.code ? 'border-[var(--hr-ink)] bg-[var(--hr-active)] text-[var(--hr-ink)]' : 'border-[var(--hr-line)] bg-[var(--hr-raised)] text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)]'}`}
              >
                <CategoryIcon name={c.icon} size={14} className="shrink-0" />
                <span className="truncate">{c.name}</span>
              </button>
            ))}
          </div>
        </Field>
        {mileage && chosen !== null ? (
          <Field label={t('exp.f.distance', { unit: t(`exp.unit.${chosen.unit}`) })} hint={chosen.mileage_rate_minor > 0 ? t('exp.add.rate', { rate: rateText(chosen.mileage_rate_minor, currency), unit: t(`exp.unit.${chosen.unit}`), currency }) : t('exp.add.no_rate')}>
            <div className="flex items-center gap-3">
              <Input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" aria-label={t('exp.f.distance', { unit: chosen.unit })} className="w-32 text-right" autoFocus />
              <span className="text-[12px] text-[var(--hr-muted)]">=</span>
              <Money minor={mileageMinor ?? 0} currency={currency} className="text-[13px]" />
            </div>
          </Field>
        ) : (
          <Field label={t('exp.f.amount')}>
            <div className="flex gap-2">
              <MoneyInput value={amount} onChange={setAmount} currency={cur} label={t('exp.f.amount')} className="flex-1" />
              <Select value={cur} onChange={(e) => setCur(e.target.value)} aria-label={t('exp.f.currency')} className="w-24">
                {currencies.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </Field>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('exp.f.day')}>
            <DayPicker value={day} onChange={setDay} label={t('exp.f.day')} max={today({ entity })} />
          </Field>
          <Field label={t('exp.f.merchant')} optional>
            <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} aria-label={t('exp.f.merchant')} placeholder={mileage ? t('exp.add.route_ph') : t('exp.add.merchant_ph')} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
