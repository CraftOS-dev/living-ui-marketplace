/**
 * Change one expense of a draft claim: category, amount and currency (with
 * the rate when it is another currency), day, merchant, what it was for,
 * who attended, tax, distance for mileage, a reason for a flag, and the
 * receipt (replace it, or read it again with your AI agent).
 */
import { useMemo, useRef, useState } from 'react';
import { Save, Upload } from 'lucide-react';
import { Money, Button, DayPicker, Dialog, Field, Input, LinkButton, MoneyInput, Select, Textarea, majorParam } from '../ui.tsx';
import { op, opForm } from '../../lib/api.ts';
import { t } from '../../lib/i18n.ts';
import { act, changed, patch } from '../../lib/live.ts';
import type { Category, Line } from '../../pages/expenses/types.ts';
import { shrink, rateText } from './AddExpense.tsx';
import { FlagList } from './parts.tsx';

const CURRENCIES = ['USD', 'EUR', 'GBP', 'JPY', 'SGD', 'MYR', 'INR', 'AUD', 'CAD', 'CNY', 'HKD', 'THB', 'IDR', 'PHP', 'KRW', 'TWD', 'VND', 'AED', 'SAR', 'CHF', 'NZD'];
const READS = ['claims', 'claim_lines'];

export function LineEditor({ line, categories, claimCurrency, onClose }: { line: Line; categories: Category[]; claimCurrency: string; onClose: () => void }): React.JSX.Element {
  const [cat, setCat] = useState(line.category_code);
  const [cur, setCur] = useState(line.currency || claimCurrency);
  const [amount, setAmount] = useState<number | null>(line.amount_minor > 0 ? line.amount_minor : null);
  const [tax, setTax] = useState<number | null>(line.tax_minor > 0 ? line.tax_minor : null);
  const [rate, setRate] = useState(line.fx_source === 'person' && line.fx_rate > 0 ? String(line.fx_rate) : '');
  const [distance, setDistance] = useState(line.distance > 0 ? String(line.distance) : '');
  const [day, setDay] = useState(line.day);
  const [merchant, setMerchant] = useState(line.merchant);
  const [description, setDescription] = useState(line.description);
  const [attendees, setAttendees] = useState(line.attendees);
  const [reason, setReason] = useState(line.reason);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement | null>(null);
  const chosen = categories.find((c) => c.code === cat) ?? null;
  const mileage = chosen?.kind === 'mileage';
  const foreign = !mileage && cur !== claimCurrency;
  const currencies = useMemo(() => [claimCurrency, ...CURRENCIES.filter((c) => c !== claimCurrency)], [claimCurrency]);
  const warnings = line.flags.filter((f) => f.severity === 'warning');

  const save = async (): Promise<void> => {
    setBusy(true);
    const p: Record<string, unknown> = { line: line.id, day, merchant, description, attendees, reason };
    if (cat !== line.category_code) p['category'] = cat;
    if (mileage) p['distance'] = Number(distance.replace(',', '.')) || 0;
    else {
      p['currency'] = cur;
      p['amount'] = amount === null ? '0' : majorParam(amount, cur);
      p['tax'] = tax === null ? '0' : majorParam(tax, cur);
      if (foreign) p['fx_rate'] = rate.trim() === '' ? 0 : Number(rate.replace(',', '.'));
    }
    // Shown at once (the dialog closes), then the server's own answer replaces it.
    const typed = mileage ? Math.round((Number(distance.replace(',', '.')) || 0) * (chosen?.mileage_rate_minor ?? 0)) : (amount ?? 0);
    const sameCur = mileage || cur === claimCurrency;
    const drop = new Set<string>([...(typed > 0 ? ['no_amount', 'no_distance', 'reading', 'review_reading'] : []), ...(chosen !== null ? ['no_category'] : [])]);
    const shown: Record<string, unknown> = {
      day,
      merchant,
      description,
      attendees,
      reason,
      category: chosen?.id ?? line.category,
      category_code: chosen?.code ?? line.category_code,
      category_name: chosen?.name ?? line.category_name,
      category_icon: chosen?.icon ?? line.category_icon,
      flags: line.flags.filter((f) => !drop.has(f.code)),
    };
    if (typed > 0) {
      shown['amount_minor'] = typed;
      shown['currency'] = mileage ? claimCurrency : cur;
      if (sameCur) shown['base_minor'] = typed;
      if (line.receipt_status === 'waiting' || line.receipt_status === 'reading') shown['receipt_status'] = 'none';
    }
    onClose();
    await act([patch(line.id, shown)], () => op('claim-lines.update', p), READS);
  };

  const replace = async (f: File): Promise<void> => {
    setBusy(true);
    try {
      await opForm('claim-lines.update', { line: line.id, read: amount === null }, { receipt: await shrink(f) });
      changed(...READS);
      onClose();
    } catch {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.edit.title')}
      meta={line.category_name}
      width={560}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" icon={Save} busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('exp.f.category')}>
          <Select value={cat} onChange={(e) => setCat(e.target.value)} aria-label={t('exp.f.category')}>
            {cat === '' && <option value="">{t('exp.f.pick_category')}</option>}
            {categories
              .filter((c) => !c.archived || c.code === line.category_code)
              .map((c) => (
                <option key={c.id} value={c.code}>
                  {c.name}
                </option>
              ))}
          </Select>
        </Field>
        {mileage && chosen !== null ? (
          <Field label={t('exp.f.distance', { unit: t(`exp.unit.${chosen.unit}`) })} hint={t('exp.add.rate', { rate: rateText(chosen.mileage_rate_minor, claimCurrency), unit: t(`exp.unit.${chosen.unit}`), currency: claimCurrency })}>
            <div className="flex items-center gap-3">
              <Input value={distance} onChange={(e) => setDistance(e.target.value)} inputMode="decimal" aria-label={t('exp.f.distance', { unit: chosen.unit })} className="w-32 text-right" />
              <span className="text-[12px] text-[var(--hr-muted)]">=</span>
              <Money minor={Math.round((Number(distance.replace(',', '.')) || 0) * chosen.mileage_rate_minor)} currency={claimCurrency} />
            </div>
          </Field>
        ) : (
          <>
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
            {foreign && (
              <Field label={t('exp.f.rate', { from: cur, to: claimCurrency })} hint={line.fx_source !== '' && line.fx_source !== 'person' ? t('exp.edit.rate_found', { rate: String(line.fx_rate), source: line.fx_source }) : t('exp.edit.rate_hint')} optional>
                <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" aria-label={t('exp.f.rate', { from: cur, to: claimCurrency })} placeholder={line.fx_rate > 0 ? String(line.fx_rate) : ''} className="w-40" />
              </Field>
            )}
            <Field label={t('exp.f.tax')} optional>
              <MoneyInput value={tax} onChange={setTax} currency={cur} label={t('exp.f.tax')} />
            </Field>
          </>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('exp.f.day')}>
            <DayPicker value={day} onChange={setDay} label={t('exp.f.day')} />
          </Field>
          {!mileage && (
            <Field label={t('exp.f.merchant')} optional>
              <Input value={merchant} onChange={(e) => setMerchant(e.target.value)} aria-label={t('exp.f.merchant')} />
            </Field>
          )}
        </div>
        <Field label={mileage ? t('exp.f.route') : t('exp.f.description')} optional>
          <Input value={description} onChange={(e) => setDescription(e.target.value)} aria-label={mileage ? t('exp.f.route') : t('exp.f.description')} />
        </Field>
        {chosen?.code === 'client_entertainment' && (
          <Field label={t('exp.f.attendees')}>
            <Input value={attendees} onChange={(e) => setAttendees(e.target.value)} aria-label={t('exp.f.attendees')} placeholder={t('exp.f.attendees_ph')} />
          </Field>
        )}
        {warnings.length > 0 && (
          <Field label={t('exp.f.reason')} hint={<FlagList flags={warnings} />}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} aria-label={t('exp.f.reason')} placeholder={t('exp.f.reason_ph')} />
          </Field>
        )}
        {!mileage && (
          <div className="flex items-center gap-3 border-t border-[var(--hr-hair)] pt-3">
            <Button size="sm" icon={Upload} onClick={() => file.current?.click()}>
              {line.receipt ? t('exp.edit.replace_receipt') : t('exp.edit.attach_receipt')}
            </Button>
            {line.receipt && (
              <LinkButton
                tone="danger"
                onClick={() =>
                  void op('claim-lines.update', { line: line.id, clear_receipt: true }).then(() => {
                    changed(...READS);
                    onClose();
                  })
                }
              >
                {t('exp.edit.remove_receipt')}
              </LinkButton>
            )}
            <input
              ref={file}
              type="file"
              accept="image/*,application/pdf"
              className="hidden"
              aria-label={t('exp.edit.attach_receipt')}
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (f !== undefined) void replace(f);
              }}
            />
          </div>
        )}
      </div>
    </Dialog>
  );
}
