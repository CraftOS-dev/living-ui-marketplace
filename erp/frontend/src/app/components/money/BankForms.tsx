/**
 * Forms for bank accounts: add one, change one, move money between two of
 * them, and add a statement line by hand. Anything that posts shows what
 * it posts before the button.
 */
import { useEffect, useState } from 'react';
import { ArrowDown, ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Plus } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel, today } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber } from '../../lib/format.ts';
import { baseCurrency, useMe } from '../../lib/me.ts';
import type { Bank, BankDetail, BankKind, BankLine, BankList, Currency } from '../../lib/types/money.ts';
import { Segmented } from '../controls.tsx';
import { BankPicker, DateField, MoneyInput } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, PillButton, PillSelect, Toggle, softInput } from '../ui.tsx';
import { bankKind } from './labels.ts';
import { PreviewPane, useLivePreview } from './LivePreview.tsx';
import { toMinor } from './RecordPayment.tsx';
import { MoreOptions } from './Step.tsx';

function bankOption(b: Bank): Option {
  return { id: b.id, label: b.name, sub: `${bankKind(b.kind).label} · ${b.currency}`, value: b.id, data: b };
}

/* -------------------------------------------------------------- add */

export function AddBankModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: (b: BankDetail) => void }): React.JSX.Element {
  const me = useMe();
  const base = baseCurrency(me);
  const [kind, setKind] = useState<BankKind>('bank');
  const [name, setName] = useState('');
  const [currency, setCurrency] = useState(base);
  const [bankName, setBankName] = useState('');
  const [number, setNumber] = useState('');
  const [code, setCode] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currencies, setCurrencies] = useState<Currency[]>([]);

  useEffect(() => {
    if (!open) return;
    setKind('bank');
    setName('');
    setCurrency(base);
    setBankName('');
    setNumber('');
    setCode('');
    setError(null);
    op<{ currencies: Currency[] }>('currencies.list', {}, { quiet: true })
      .then((r) => setCurrencies(r.currencies.filter((c) => !c.archived)))
      .catch(() => undefined);
  }, [open, base]);

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const b = await op<BankDetail>(
        'banks.add',
        { name: name.trim(), kind, currency, bank_name: bankName.trim() === '' ? undefined : bankName.trim(), account_number: number.trim() === '' ? undefined : number.trim(), code: code.trim() === '' ? undefined : code.trim() },
        { quiet: true },
      );
      toast.success(`${b.name} added`);
      onClose();
      onDone(b);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const placeholder = kind === 'cash' ? 'Petty cash' : kind === 'card' ? 'Company card' : 'Main current account';
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add an account"
      description="A bank account, a cash box or a company card. It gets its own place in the books."
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Plus} dot loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Add account
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          ariaLabel="Kind"
          value={kind}
          onChange={setKind}
          options={(['bank', 'cash', 'card'] as BankKind[]).map((k) => ({ value: k, label: bankKind(k).label, icon: bankKind(k).icon }))}
          className="w-full"
        />
        <Field label="Name" error={error}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={placeholder} aria-label="Name" className={softInput} autoFocus />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <PillSelect soft label="Currency" value={currency} onChange={setCurrency} options={(currencies.length > 0 ? currencies.map((c) => c.code) : [base]).map((c) => ({ value: c, label: c === base ? `${c} (your currency)` : c }))} />
          {kind !== 'cash' && (
            <Field label="Last digits" optional>
              <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} placeholder="1234" aria-label="Account number" className={softInput} />
            </Field>
          )}
        </div>
        {kind !== 'cash' && (
          <Field label={kind === 'card' ? 'Card issuer' : 'Bank'} optional>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={80} aria-label="Bank" className={softInput} />
          </Field>
        )}
        <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
          <Field label="Account code in the books" hint="Left empty, the next free code is used">
            <input value={code} onChange={(e) => setCode(e.target.value)} maxLength={20} aria-label="Account code" className={softInput} />
          </Field>
        </MoreOptions>
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------- edit */

export function EditBankModal({ open, onClose, bank, onDone }: { open: boolean; onClose: () => void; bank: Bank; onDone: () => void }): React.JSX.Element {
  const [name, setName] = useState(bank.name);
  const [bankName, setBankName] = useState(bank.bank_name);
  const [number, setNumber] = useState(bank.account_number);
  const [archived, setArchived] = useState(bank.archived);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setName(bank.name);
    setBankName(bank.bank_name);
    setNumber(bank.account_number);
    setArchived(bank.archived);
    setError(null);
  }, [open, bank]);
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await op('banks.update', { bank: bank.id, name: name.trim(), bank_name: bankName.trim(), account_number: number.trim(), archived }, { quiet: true });
      toast.success('Saved');
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Change the account"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton loading={busy} disabled={name.trim() === ''} onClick={() => void save()}>
            Save
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Field label="Name" error={error}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} aria-label="Name" className={softInput} />
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Bank" optional>
            <input value={bankName} onChange={(e) => setBankName(e.target.value)} maxLength={80} aria-label="Bank" className={softInput} />
          </Field>
          <Field label="Last digits" optional>
            <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} aria-label="Account number" className={softInput} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-4 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
          <div>
            <p className="text-[14px] font-semibold">Archived</p>
            <p className="text-[12px] text-[var(--erp-muted)]">Hidden from pickers and the sidebar; its history stays.</p>
          </div>
          <Toggle checked={archived} onChange={setArchived} label="Archived" />
        </div>
      </div>
    </Modal>
  );
}

/* --------------------------------------------------------- transfer */

/**
 * Move money between two of your accounts. From a statement line, the
 * line's account, direction and amount are fixed and the line is matched.
 */
export function TransferModal({ open, onClose, line, lineBank, onDone }: { open: boolean; onClose: () => void; line?: BankLine | undefined; lineBank?: Bank | undefined; onDone: () => void }): React.JSX.Element {
  const [from, setFrom] = useState<Option | null>(null);
  const [to, setTo] = useState<Option | null>(null);
  const [amount, setAmount] = useState('');
  const [arrives, setArrives] = useState('');
  const [date, setDate] = useState(today());
  const [memo, setMemo] = useState('');
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const outgoing = line !== undefined && line.amount < 0;
  useEffect(() => {
    if (!open) return;
    setMemo('');
    setDate(line?.date ?? today());
    op<BankList>('banks.list', {}, { quiet: true })
      .then((r) => {
        const list = r.banks.filter((b) => !b.archived);
        if (line !== undefined && lineBank !== undefined) {
          const mine = bankOption(lineBank);
          const other = list.find((b) => b.id !== lineBank.id && b.kind === 'bank') ?? list.find((b) => b.id !== lineBank.id && b.kind !== 'card');
          if (outgoing) {
            setFrom(mine);
            setTo(other !== undefined ? bankOption(other) : null);
          } else {
            setTo(mine);
            setFrom(other !== undefined ? bankOption(other) : null);
          }
        } else {
          setFrom(list[0] !== undefined ? bankOption(list[0]) : null);
          setTo(list[1] !== undefined ? bankOption(list[1]) : null);
        }
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, line?.id]);

  const fromBank = (from?.data as Bank | undefined) ?? null;
  const toBank = (to?.data as Bank | undefined) ?? null;
  const fc = fromBank?.currency ?? '';
  const tc = toBank?.currency ?? '';
  const differ = fc !== '' && tc !== '' && fc !== tc;

  // A statement line fixes what moved on its side.
  useEffect(() => {
    if (line === undefined) return;
    const abs = Math.abs(line.amount);
    const cur = lineBank?.currency ?? '';
    if (outgoing) {
      setAmount(minorToText(abs, cur));
      if (!differ) setArrives('');
    } else if (differ) {
      setArrives(minorToText(abs, cur));
    } else {
      setAmount(minorToText(abs, cur));
      setArrives('');
    }
  }, [line, lineBank, outgoing, differ]);

  const amountMinor = fc !== '' && amount !== '' ? (toMinor(amount, fc) ?? 0) : 0;
  const ready = fromBank !== null && toBank !== null && fromBank.id !== toBank.id && amountMinor > 0 && (!differ || arrives !== '');
  const params = ready
    ? {
        from_bank: fromBank.id,
        to_bank: toBank.id,
        amount: normalizeNumber(amount, decimalsOf(fc)) ?? '',
        to_amount: differ ? (normalizeNumber(arrives, decimalsOf(tc)) ?? '') : undefined,
        date: line === undefined ? date : undefined,
        line: line?.id,
        memo: memo.trim() === '' ? undefined : memo.trim(),
      }
    : null;
  const preview = useLivePreview('bank.preview-transfer', params);

  const run = async (): Promise<void> => {
    if (params === null) return;
    setBusy(true);
    try {
      await op('bank.transfer', params);
      toast.success('Transfer recorded');
      onDone();
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  const lockFrom = line !== undefined && outgoing;
  const lockTo = line !== undefined && !outgoing;

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Move money between accounts"
      description={line !== undefined ? `Statement line of ${dayLabel(line.date)}: ${line.description}` : 'From one of your accounts to another. Nothing is income or expense.'}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={ArrowLeftRight} dot loading={busy} disabled={params === null || preview.error !== null || preview.preview === null} onClick={() => void run()}>
            {amountMinor > 0 ? `Move ${money(amountMinor, fc)}` : 'Move money'}
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2">
          <Field label="From">{lockFrom ? <LockedBank bank={lineBank} /> : <BankPicker value={from} onChange={setFrom} />}</Field>
          <span className="flex justify-center text-[var(--erp-muted)]" aria-hidden>
            <ArrowDown size={16} />
          </span>
          <Field label="To">{lockTo ? <LockedBank bank={lineBank} /> : <BankPicker value={to} onChange={setTo} />}</Field>
        </div>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label={differ ? `Amount sent (${fc})` : 'Amount'}>
            <MoneyInput value={amount} onChange={setAmount} currency={fc !== '' ? fc : 'USD'} ariaLabel="Amount" disabled={line !== undefined && outgoing} />
          </Field>
          {differ ? (
            <Field label={`Amount arrived (${tc})`}>
              <MoneyInput value={arrives} onChange={setArrives} currency={tc} ariaLabel="Amount arrived" disabled={line !== undefined && !outgoing} />
            </Field>
          ) : (
            line === undefined && (
              <Field label="Date">
                <DateField value={date} onChange={setDate} ariaLabel="Date" />
              </Field>
            )
          )}
        </div>
        {differ && line === undefined && (
          <Field label="Date">
            <DateField value={date} onChange={setDate} ariaLabel="Date" />
          </Field>
        )}
        <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
          <Field label="Memo" optional>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} aria-label="Memo" className={softInput} />
          </Field>
        </MoreOptions>
        <PreviewPane state={preview} empty="Choose both accounts and the amount." />
      </div>
    </Modal>
  );
}

function LockedBank({ bank }: { bank: Bank | undefined }): React.JSX.Element {
  return (
    <div className="flex h-11 items-center gap-2 rounded-full bg-[var(--erp-row)] px-5 text-[14px] font-semibold">
      {bank?.name ?? ''}
      <span className="text-[12px] font-medium text-[var(--erp-muted)]">{bank !== undefined ? `${bankKind(bank.kind).label} · ${bank.currency}` : ''}</span>
    </div>
  );
}

/* ---------------------------------------------------------- add line */

export function AddLineModal({ open, onClose, bank, onDone }: { open: boolean; onClose: () => void; bank: Bank; onDone: () => void }): React.JSX.Element {
  const [dir, setDir] = useState<'in' | 'out'>('out');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(today());
  const [description, setDescription] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    setAmount('');
    setDescription('');
    setReference('');
    setDate(today());
    setError(null);
  }, [open]);
  const save = async (): Promise<void> => {
    const n = normalizeNumber(amount, decimalsOf(bank.currency));
    if (n === null) return;
    setBusy(true);
    setError(null);
    try {
      await op('bank.add-line', { bank: bank.id, date, amount: dir === 'out' ? `-${n}` : n, description: description.trim(), reference: reference.trim() === '' ? undefined : reference.trim() }, { quiet: true });
      toast.success('Line added');
      onDone();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add a statement line"
      description={`A line as it shows on the ${bank.name} statement. Reconcile it like any imported line.`}
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={amount === '' || description.trim() === ''} onClick={() => void save()}>
            Add line
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Segmented
          ariaLabel="Money in or out"
          value={dir}
          onChange={setDir}
          options={[
            { value: 'out', label: 'Money out', icon: ArrowUpRight },
            { value: 'in', label: 'Money in', icon: ArrowDownLeft },
          ]}
          className="w-full"
        />
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Amount" error={error}>
            <MoneyInput value={amount} onChange={setAmount} currency={bank.currency} ariaLabel="Amount" />
          </Field>
          <Field label="Date">
            <DateField value={date} onChange={setDate} ariaLabel="Date" />
          </Field>
        </div>
        <Field label="Description">
          <input value={description} onChange={(e) => setDescription(e.target.value)} maxLength={500} placeholder="As written on the statement" aria-label="Description" className={softInput} />
        </Field>
        <Field label="Reference" optional>
          <input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={200} aria-label="Reference" className={softInput} />
        </Field>
      </div>
    </Modal>
  );
}
