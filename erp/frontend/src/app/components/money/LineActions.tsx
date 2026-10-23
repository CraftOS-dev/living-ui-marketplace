/**
 * Turning a statement line into something in the books: a payment from a
 * customer or to a supplier (settling their open invoices or bills), or an
 * entry against an account (bank fees, interest, a tax payment, owner
 * money). Each shows what it posts, live, before the button.
 */
import { useEffect, useMemo, useState } from 'react';
import { Check } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { dayLabel } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber } from '../../lib/format.ts';
import type { Account, AccountList } from '../../lib/types/books.ts';
import type { Bank, BankLine, DocList, DocRow } from '../../lib/types/money.ts';
import { AccountPicker, PartyPicker, Picker, ProjectPicker, TaxPicker, accountOption, partyOption } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { Field, Modal, PillButton, Skeleton, cellInput, softInput } from '../ui.tsx';
import { Signed } from './bits.tsx';
import { PreviewPane, useLivePreview } from './LivePreview.tsx';
import { toMinor } from './RecordPayment.tsx';
import { MoreOptions } from './Step.tsx';

function LineHead({ line, currency }: { line: BankLine; currency: string }): React.JSX.Element {
  return (
    <div className="erp-on-sand flex items-center gap-3 rounded-[18px] bg-[var(--erp-sand)] px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] font-bold">{line.description !== '' ? line.description : 'Statement line'}</span>
        <span className="block text-[12px] text-[var(--erp-muted)]">
          {dayLabel(line.date)}
          {line.reference !== '' ? ` · ${line.reference}` : ''}
        </span>
      </span>
      <Signed minor={line.amount} currency={currency} className="text-[15px]" />
    </div>
  );
}

/* ---------------------------------------------------- create a payment */

export function CreatePaymentModal({
  open,
  onClose,
  line,
  bank,
  initialParty,
  initialDoc,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  line: BankLine;
  bank: Bank;
  initialParty?: { id: string; name: string } | undefined;
  initialDoc?: string | undefined;
  onDone: () => void;
}): React.JSX.Element {
  const incoming = line.amount > 0;
  const cur = bank.currency;
  const total = Math.abs(line.amount);
  const [party, setParty] = useState<Option | null>(null);
  const [docs, setDocs] = useState<DocRow[] | null>(null);
  const [alloc, setAlloc] = useState<Record<string, { on: boolean; text: string }>>({});
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMemo('');
    setParty(initialParty !== undefined ? partyOption({ id: initialParty.id, name: initialParty.name }) : null);
  }, [open, initialParty]);

  useEffect(() => {
    setDocs(null);
    setAlloc({});
    if (!open || party === null) return;
    let live = true;
    op<DocList>('docs.list', { type: incoming ? 'invoice' : 'bill', status: 'unpaid', party: party.id, sort: 'due', desc: false, limit: 200 }, { quiet: true })
      .then((r) => {
        if (!live) return;
        const list = r.docs.filter((d) => d.currency === cur);
        setDocs(list);
        const next: Record<string, { on: boolean; text: string }> = {};
        const pre = initialDoc !== undefined ? list.find((d) => d.id === initialDoc) : undefined;
        let rest = total;
        const order = pre !== undefined ? [pre, ...list.filter((d) => d.id !== pre.id)] : list;
        for (const d of order) {
          if (rest <= 0) break;
          const take = Math.min(rest, d.balance);
          next[d.id] = { on: true, text: minorToText(take, cur) };
          rest -= take;
        }
        setAlloc(next);
      })
      .catch(() => {
        if (live) setDocs([]);
      });
    return () => {
      live = false;
    };
  }, [open, party, incoming, cur, total, initialDoc]);

  const chosen = (docs ?? []).filter((d) => alloc[d.id]?.on === true);
  const applied = chosen.reduce((s, d) => s + (toMinor(alloc[d.id]?.text ?? '', cur) ?? 0), 0);
  const bad = chosen.some((d) => {
    const v = toMinor(alloc[d.id]?.text ?? '', cur);
    return v === null || v <= 0 || v > d.balance;
  });
  const over = applied > total;
  const allocations = chosen.map((d) => ({ doc: d.number, amount: normalizeNumber(alloc[d.id]?.text ?? '', decimalsOf(cur)) ?? '' }));
  const params = party !== null && !bad && !over && docs !== null ? { line: line.id, party: party.id, allocations, memo: memo.trim() === '' ? undefined : memo.trim() } : null;
  const preview = useLivePreview('bank.preview-create-payment', open ? params : null);

  const run = async (): Promise<void> => {
    if (params === null) return;
    setBusy(true);
    try {
      await op('bank.create-payment', params);
      toast.success(incoming ? 'Payment recorded and matched' : 'Payment recorded and matched');
      onDone();
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={incoming ? 'Record money in from a customer' : 'Record money out to a supplier'}
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={params === null || preview.error !== null || preview.preview === null} onClick={() => void run()}>
            Record and match
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LineHead line={line} currency={cur} />
        <Field label={incoming ? 'Who paid' : 'Who was paid'}>
          <PartyPicker value={party} onChange={setParty} role={incoming ? 'customer' : 'supplier'} />
        </Field>
        {party !== null && (
          <Field label="What it settles" hint={docs !== null && docs.length > 0 ? `${money(applied, cur)} applied, ${money(Math.max(0, total - applied), cur)} left as credit` : undefined}>
            {docs === null ? (
              <Skeleton className="h-14" />
            ) : docs.length === 0 ? (
              <p className="rounded-[18px] bg-[var(--erp-row)] px-4 py-3 text-[13px] text-[var(--erp-muted)]">Nothing open in {cur}. The money stays as credit on {party.label}.</p>
            ) : (
              <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto">
                {docs.map((d) => {
                  const a = alloc[d.id];
                  const on = a?.on === true;
                  const v = on ? toMinor(a.text, cur) : null;
                  const wrong = on && (v === null || v <= 0 || v > d.balance);
                  return (
                    <li key={d.id} className={cn('flex items-center gap-3 rounded-[16px] px-3 py-2', on ? 'bg-[var(--erp-accent-soft)]' : 'bg-[var(--erp-row)]')}>
                      <button
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        aria-label={`Settle ${d.number}`}
                        onClick={() => setAlloc({ ...alloc, [d.id]: { on: !on, text: a?.text ?? minorToText(Math.min(d.balance, Math.max(0, total - applied)) || d.balance, cur) } })}
                        className={cn('flex size-6 shrink-0 items-center justify-center rounded-full', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-card)]')}
                      >
                        {on && <Check size={14} strokeWidth={3} />}
                      </button>
                      <span className="min-w-0 flex-1">
                        <span className="num block truncate text-[13px] font-bold">{d.number}</span>
                        <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                          {d.due_date !== '' ? `Due ${dayLabel(d.due_date)}` : dayLabel(d.date)} · {money(d.balance, cur)} open
                        </span>
                      </span>
                      <input
                        value={a?.text ?? ''}
                        onChange={(e) => setAlloc({ ...alloc, [d.id]: { on: true, text: e.target.value } })}
                        inputMode="decimal"
                        aria-label={`Amount for ${d.number}`}
                        aria-invalid={wrong}
                        className={cn(cellInput, 'num w-28 shrink-0 bg-[var(--erp-card)] text-right', wrong && 'ring-2 ring-[var(--erp-red)]')}
                      />
                    </li>
                  );
                })}
              </ul>
            )}
          </Field>
        )}
        {over && <p className="text-[13px] font-semibold text-[var(--erp-red-text)]">That settles {money(applied - total, cur)} more than the line brought.</p>}
        <Field label="Memo" optional>
          <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} aria-label="Memo" className={softInput} />
        </Field>
        <PreviewPane state={preview} empty={incoming ? 'Choose the customer.' : 'Choose the supplier.'} />
      </div>
    </Modal>
  );
}

/* ------------------------------------------------ book against an account */

/** Accounts people book bank lines to most, by the app's own keys. */
const QUICK_OUT = ['bank_fees', 'general_expense', 'travel'];
const QUICK_IN = ['other_income'];

export function BookLineModal({ open, onClose, line, bank, onDone }: { open: boolean; onClose: () => void; line: BankLine; bank: Bank; onDone: () => void }): React.JSX.Element {
  const incoming = line.amount > 0;
  const [account, setAccount] = useState<Option | null>(null);
  const [tax, setTax] = useState<Option | null>({ id: 'none', label: 'No tax', value: 'none' });
  const [memo, setMemo] = useState('');
  const [project, setProject] = useState<Option | null>(null);
  const [dept, setDept] = useState<Option | null>(null);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    if (!open) return;
    setAccount(null);
    setTax({ id: 'none', label: 'No tax', value: 'none' });
    setMemo('');
    setProject(null);
    setDept(null);
    op<AccountList>('accounts.list', { balances: false }, { quiet: true })
      .then((r) => setAccounts(r.accounts))
      .catch(() => undefined);
  }, [open]);

  const quick = useMemo(() => (incoming ? QUICK_IN : QUICK_OUT).map((k) => accounts.find((a) => a.system_key === k)).filter((a): a is Account => a !== undefined), [accounts, incoming]);
  const searchDepts = useMemo(
    () => async (q: string) => {
      const r = await op<{ departments: { id: string; name: string }[] }>('departments.list', {}, { quiet: true });
      return r.departments.filter((d) => q === '' || d.name.toLowerCase().includes(q.toLowerCase())).map((d) => ({ id: d.id, label: d.name, value: d.id }));
    },
    [],
  );

  const params =
    account !== null
      ? {
          line: line.id,
          account: account.value ?? account.id,
          tax: tax?.value ?? 'none',
          memo: memo.trim() === '' ? undefined : memo.trim(),
          project: project?.value,
          department: dept?.value,
        }
      : null;
  const preview = useLivePreview('bank.preview-create-entry', open ? params : null);

  const run = async (): Promise<void> => {
    if (params === null) return;
    setBusy(true);
    try {
      await op('bank.create-entry', params);
      toast.success('Booked and matched');
      onDone();
      onClose();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={incoming ? 'Book as income' : 'Book as an expense'}
      description="For lines that are not a customer or supplier payment: bank fees, interest, a tax payment, money the owner put in or took out."
      size="lg"
      footer={
        <>
          <PillButton variant="soft" onClick={onClose}>
            Cancel
          </PillButton>
          <PillButton icon={Check} dot loading={busy} disabled={params === null || preview.error !== null || preview.preview === null} onClick={() => void run()}>
            Book and match
          </PillButton>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <LineHead line={line} currency={bank.currency} />
        <Field label={incoming ? 'What the money was for' : 'What it was spent on'}>
          <AccountPicker value={account} onChange={setAccount} postable placeholder="Choose an account" />
          {quick.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-2">
              {quick.map((a) => {
                const on = account?.id === a.id;
                return (
                  <button
                    key={a.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setAccount(accountOption(a))}
                    className={cn('inline-flex h-8 items-center rounded-full px-3 text-[12px] font-semibold transition-colors', on ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : 'bg-[var(--erp-row)] hover:bg-[var(--erp-row-hover)]')}
                  >
                    {a.name}
                  </button>
                );
              })}
            </div>
          )}
        </Field>
        <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
          <Field label="Tax in it" hint={incoming ? 'Tax you collected' : 'Tax you can claim back is split out'}>
            <TaxPicker value={tax} onChange={setTax} scope={incoming ? 'sales' : 'purchase'} />
          </Field>
          <Field label="Memo" optional>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={300} placeholder={line.description.slice(0, 60)} aria-label="Memo" className={softInput} />
          </Field>
        </div>
        <MoreOptions open={more} onToggle={() => setMore((m) => !m)}>
          <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
            <Field label="Project" optional>
              <ProjectPicker value={project} onChange={setProject} />
            </Field>
            <Field label="Department" optional>
              <Picker value={dept} onChange={setDept} search={searchDepts} placeholder="Choose a department" ariaLabel="Department" clearable />
            </Field>
          </div>
        </MoreOptions>
        <PreviewPane state={preview} empty="Choose the account." />
      </div>
    </Modal>
  );
}
