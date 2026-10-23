/**
 * Fixed asset forms: register one (cost, when it went into service, how
 * long it lasts), change one, depreciate every asset through a month, and
 * dispose of one (sold or scrapped).
 */
import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Plus, Trash2 } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { OpError, errMessage, op } from '../../lib/api.ts';
import { addMonths, monthLabel, today } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber } from '../../lib/format.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import type { AssetDetail } from '../../lib/types/books.ts';
import { ConfirmPosting } from '../Books.tsx';
import { Segmented } from '../controls.tsx';
import { toMinor } from '../money/RecordPayment.tsx';
import { MoreOptions } from '../money/Step.tsx';
import { AccountPicker, DateField, MoneyInput, MonthField, NumberInput, accountOption } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, Notice, PillButton, softArea, softInput } from '../ui.tsx';

export function AssetModal({ open, onClose, asset, onDone }: { open: boolean; onClose: () => void; asset?: AssetDetail | undefined; onDone: (a: AssetDetail) => void }): React.JSX.Element {
  const me = useMe();
  const cur = baseCurrency(me);
  const editing = asset !== undefined;
  const locked = editing && asset.depreciated > 0;
  const [name, setName] = useState('');
  const [cost, setCost] = useState('');
  const [start, setStart] = useState(today());
  const [life, setLife] = useState('3');
  const [unit, setUnit] = useState<'years' | 'months'>('years');
  const [salvage, setSalvage] = useState('');
  const [assetAcc, setAssetAcc] = useState<Option | null>(null);
  const [accAcc, setAccAcc] = useState<Option | null>(null);
  const [expAcc, setExpAcc] = useState<Option | null>(null);
  const [notes, setNotes] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(asset?.name ?? '');
    setCost(asset !== undefined ? minorToText(asset.cost, cur) : '');
    setStart(asset?.start ?? today());
    const months = asset?.life_months ?? 36;
    if (months % 12 === 0) {
      setLife(String(months / 12));
      setUnit('years');
    } else {
      setLife(String(months));
      setUnit('months');
    }
    setSalvage(asset !== undefined && asset.salvage > 0 ? minorToText(asset.salvage, cur) : '');
    setAssetAcc(asset?.asset_account != null ? accountOption(asset.asset_account) : null);
    setAccAcc(asset?.accumulated_account != null ? accountOption(asset.accumulated_account) : null);
    setExpAcc(asset?.expense_account != null ? accountOption(asset.expense_account) : null);
    setNotes(asset?.notes ?? '');
    setMore(false);
    setError(null);
  }, [open, asset, cur]);

  const months = life !== '' ? Math.round(Number(life) * (unit === 'years' ? 12 : 1)) : 0;
  const costMinor = cost !== '' ? (toMinor(cost, cur) ?? 0) : 0;
  const salvageMinor = salvage !== '' ? (toMinor(salvage, cur) ?? 0) : 0;
  const monthly = months > 0 && costMinor > salvageMinor ? Math.floor((costMinor - salvageMinor) / months) : 0;

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const common = { name: name.trim(), notes: notes.trim() };
      const money_ = locked
        ? {}
        : {
            cost: normalizeNumber(cost, decimalsOf(cur)) ?? '',
            salvage: salvage !== '' ? (normalizeNumber(salvage, decimalsOf(cur)) ?? '') : '0',
            start,
            life_months: String(months),
          };
      const a = editing
        ? await op<AssetDetail>('assets.update', { asset: asset.id, ...common, ...money_ }, { quiet: true })
        : await op<AssetDetail>(
            'assets.add',
            {
              ...common,
              ...money_,
              asset_account: assetAcc?.value,
              accumulated_account: accAcc?.value,
              expense_account: expAcc?.value,
            },
            { quiet: true },
          );
      toast.success(editing ? 'Saved' : `${a.number} registered`);
      onClose();
      onDone(a);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? `Change ${asset.name}` : 'Register an asset'}
      description={editing ? (locked ? 'Depreciation has posted, so the cost, start and life stay as they are.' : undefined) : 'Something the business keeps for years: a van, machines, computers. Its cost is spread over its life, month by month.'}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={editing ? Check : Plus} dot loading={busy} disabled={name.trim() === '' || (!locked && (costMinor <= 0 || months <= 0))} onClick={() => void save()}>
            {editing ? 'Save' : 'Register asset'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" error={error}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={160} placeholder="Delivery van" aria-label="Name" className={softInput} autoFocus={!editing} />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="What it cost">
            <MoneyInput value={cost} onChange={setCost} currency={cur} ariaLabel="Cost" disabled={locked} />
          </Field>
          <Field label="In use from">
            <DateField value={start} onChange={(d) => setStart(d === '' ? today() : d)} ariaLabel="In use from" disabled={locked} />
          </Field>
        </div>
        <Field label="How long it lasts" hint={monthly > 0 ? `About ${money(monthly, cur)} a month, until ${monthLabel(addMonths(start.slice(0, 7), months - 1))}` : undefined}>
          <div className="flex gap-2">
            <NumberInput value={life} onChange={setLife} ariaLabel="Life" decimals={unit === 'years' ? 1 : 0} className="w-32" disabled={locked} />
            <Segmented
              ariaLabel="Unit"
              value={unit}
              onChange={setUnit}
              options={[
                { value: 'years', label: 'Years' },
                { value: 'months', label: 'Months' },
              ]}
            />
          </div>
        </Field>
        <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
          <Field label="Worth at the end" hint="What it will still be worth when its life ends (often nothing)" optional>
            <MoneyInput value={salvage} onChange={setSalvage} currency={cur} ariaLabel="Salvage value" disabled={locked} />
          </Field>
          {!editing && (
            <>
              <Field label="Asset account" hint="Default: Equipment">
                <AccountPicker value={assetAcc} onChange={setAssetAcc} types={['asset']} clearable />
              </Field>
              <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
                <Field label="Depreciation so far account">
                  <AccountPicker value={accAcc} onChange={setAccAcc} types={['asset']} clearable />
                </Field>
                <Field label="Depreciation cost account">
                  <AccountPicker value={expAcc} onChange={setExpAcc} types={['expense']} clearable />
                </Field>
              </div>
            </>
          )}
          <Field label="Notes" optional>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} aria-label="Notes" className={softArea} />
          </Field>
        </MoreOptions>
      </div>
    </Modal>
  );
}

/** Post depreciation for every active asset through a month (previewed). */
export function DepreciateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [month, setMonth] = useState(today().slice(0, 7));
  useEffect(() => {
    if (open) setMonth(today().slice(0, 7));
  }, [open]);
  return (
    <ConfirmPosting
      open={open}
      onClose={onClose}
      title="Post depreciation"
      verb={`Post through ${monthLabel(month, true)}`}
      previewOp="assets.preview-depreciate"
      runOp="assets.depreciate"
      params={{ month }}
      intro={
        <div className="flex flex-col gap-3">
          <p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">Each asset's monthly share of its cost moves to the depreciation cost, once per month. Months already posted are never posted twice.</p>
          <Field label="Through">
            <MonthField value={month} onChange={setMonth} ariaLabel="Through month" max={today().slice(0, 7)} />
          </Field>
        </div>
      }
      onDone={(r) => {
        const res = r as { posted: number; message?: string | undefined };
        toast.success(res.posted > 0 ? `Posted ${res.posted} ${res.posted === 1 ? 'month' : 'months'}` : (res.message ?? 'Already posted'));
        onDone();
      }}
    />
  );
}

/** Sold or scrapped: removes the asset from the books, gain or loss shown first. */
export function DisposeModal({ open, onClose, asset, onDone, onDepreciate }: { open: boolean; onClose: () => void; asset: AssetDetail; onDone: () => void; onDepreciate: () => void }): React.JSX.Element {
  const cur = asset.currency;
  const [date, setDate] = useState(today());
  const [proceeds, setProceeds] = useState('');
  const [account, setAccount] = useState<Option | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ message: string; code: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    setDate(today());
    setProceeds('');
    setAccount(null);
    setError(null);
  }, [open]);
  const got = proceeds !== '' ? (toMinor(proceeds, cur) ?? 0) : 0;
  const result = got - asset.book_value;
  const run = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('assets.dispose', { asset: asset.id, date, proceeds: got > 0 ? (normalizeNumber(proceeds, decimalsOf(cur)) ?? '') : undefined, proceeds_account: got > 0 ? account?.value : undefined }, { quiet: true });
      toast.success(`${asset.name} disposed of`);
      onDone();
      onClose();
    } catch (e) {
      setError({ message: errMessage(e), code: e instanceof OpError ? e.code : '' });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Dispose of ${asset.name}`}
      description="Sold, scrapped or given away: it leaves the books, with a gain or loss against what it was still worth."
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton variant="danger" icon={Trash2} loading={busy} disabled={got > 0 && account === null} onClick={() => void run()}>
            Dispose of it
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="When">
            <DateField value={date} onChange={(d) => setDate(d === '' ? today() : d)} ariaLabel="Date" />
          </Field>
          <Field label="Money received" optional>
            <MoneyInput value={proceeds} onChange={setProceeds} currency={cur} ariaLabel="Money received" />
          </Field>
        </div>
        {got > 0 && (
          <Field label="Where the money went">
            <AccountPicker value={account} onChange={setAccount} types={['asset']} postable placeholder="The bank or cash account" />
          </Field>
        )}
        <div className="erp-on-sand rounded-[18px] bg-[var(--erp-sand)] p-4 text-[13px]">
          <div className="flex justify-between gap-3">
            <span className="text-[var(--erp-ink-2)]">Still worth in the books</span>
            <span className="num font-bold">{money(asset.book_value, cur)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-3">
            <span className="text-[var(--erp-ink-2)]">Received</span>
            <span className="num font-bold">{money(got, cur)}</span>
          </div>
          <div className="mt-2 flex justify-between gap-3 border-t border-[var(--erp-line)] pt-2">
            <span className="font-semibold">{result >= 0 ? 'Gain' : 'Loss'}</span>
            <span className={result < 0 ? 'num font-extrabold text-[var(--erp-red-text)]' : 'num font-extrabold text-[var(--erp-green-text)]'}>{money(Math.abs(result), cur)}</span>
          </div>
        </div>
        {error !== null && (
          <Notice
            tone="bad"
            icon={AlertTriangle}
            action={
              error.code === 'depreciation_due' ? (
                <PillButton size="sm" variant="light" onClick={onDepreciate}>
                  Depreciate first
                </PillButton>
              ) : undefined
            }
          >
            {error.message}
          </Notice>
        )}
      </div>
    </Modal>
  );
}
