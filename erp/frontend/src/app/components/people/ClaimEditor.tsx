/**
 * The expense claim editor, a full screen: what it was for, then one card
 * per expense (amount, kind of expense, what it was, and a receipt photo
 * taken with the phone's camera or chosen from files), totals, and Save
 * draft or Submit. Dates, tax and projects per line sit under "More".
 * Receipts upload after the claim is saved, one per line.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Camera, ChevronDown, FileText, Plus, Receipt, Send, Tag, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op, opForm } from '../../lib/api.ts';
import { today } from '../../lib/dates.ts';
import { decimalsOf, minorToText, money, normalizeNumber, plural } from '../../lib/format.ts';
import type { ClaimDetail } from '../../lib/types/people.ts';
import { ScreenBar } from '../FullScreen.tsx';
import { DateField, MoneyInput, Picker, ProjectPicker, TaxPicker } from '../pickers.tsx';
import type { Option } from '../pickers.tsx';
import { CircleButton, Field, Notice, PillButton, softInput } from '../ui.tsx';
import { useReceipt } from './common.tsx';

interface LineDraft {
  key: string;
  id: string;
  date: string;
  description: string;
  amount: string;
  account: Option | null;
  tax: Option | null;
  project: Option | null;
  file: File | null;
  hadReceipt: boolean;
  more: boolean;
}

const LAST_ACCOUNT = 'erp.claims.account';

function lastAccount(): Option | null {
  try {
    const raw = window.localStorage.getItem(LAST_ACCOUNT);
    if (raw === null) return null;
    const o = JSON.parse(raw) as { id?: unknown; label?: unknown; value?: unknown };
    return typeof o.id === 'string' && typeof o.label === 'string' ? { id: o.id, label: o.label, value: typeof o.value === 'string' ? o.value : o.id } : null;
  } catch {
    return null;
  }
}

function rememberAccount(o: Option | null): void {
  if (o === null) return;
  try {
    window.localStorage.setItem(LAST_ACCOUNT, JSON.stringify({ id: o.id, label: o.label, value: o.value ?? o.id }));
  } catch {
    /* private mode */
  }
}

let seq = 0;
function blank(): LineDraft {
  seq += 1;
  return { key: `n${seq}`, id: '', date: '', description: '', amount: '', account: lastAccount(), tax: null, project: null, file: null, hadReceipt: false, more: false };
}

function fromClaim(c: ClaimDetail): LineDraft[] {
  return c.lines.map((l) => ({
    key: l.id,
    id: l.id,
    date: l.date === c.date ? '' : l.date,
    description: l.description,
    amount: minorToText(l.amount, c.currency),
    account: l.account !== null ? { id: l.account.id, label: l.account.name, sub: l.account.code, value: l.account.id } : null,
    tax: l.tax !== null ? { id: l.tax.id, label: l.tax.name, sub: l.tax.code, value: l.tax.code } : null,
    project: l.project !== null ? { id: l.project.id, label: l.project.name, sub: l.project.code, value: l.project.id } : null,
    file: null,
    hadReceipt: l.receipt !== null,
    more: false,
  }));
}

function isBlank(l: LineDraft): boolean {
  return l.amount === '' && l.description.trim() === '' && l.file === null && l.id === '';
}

/* --------------------------------------------------------- expense type */

/**
 * The kind of expense: the expense accounts a claim can use, from
 * claims.expense-types (employees cannot read the chart of accounts).
 */
function ExpenseTypePicker({ value, onChange, ariaLabel }: { value: Option | null; onChange: (o: Option | null) => void; ariaLabel: string }): React.JSX.Element {
  const search = useMemo(
    () => async (q: string) => {
      const r = await op<{ accounts: { id: string; code: string; name: string; used: number }[] }>('claims.expense-types', { q: q === '' ? undefined : q }, { quiet: true });
      return r.accounts.map((a) => ({ id: a.id, label: a.name, sub: a.used > 0 ? `${a.code} · used before` : a.code, value: a.id }));
    },
    [],
  );
  return <Picker value={value} onChange={onChange} search={search} icon={Tag} placeholder="Taxi, meals, supplies..." ariaLabel={ariaLabel} />;
}

/* -------------------------------------------------------------- receipt */

function ReceiptSlot({ line, onFile }: { line: LineDraft; onFile: (f: File | null) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [local, setLocal] = useState<string | null>(null);
  const saved = useReceipt(line.file === null && line.hadReceipt && line.id !== '' ? line.id : null);
  useEffect(() => {
    if (line.file === null || !line.file.type.startsWith('image/')) {
      setLocal(null);
      return;
    }
    const u = URL.createObjectURL(line.file);
    setLocal(u);
    return () => URL.revokeObjectURL(u);
  }, [line.file]);
  const shown = local ?? (saved.image ? saved.url : null);
  const has = line.file !== null || line.hadReceipt;
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => input.current?.click()}
        aria-label={has ? 'Change the receipt' : 'Add a receipt photo'}
        className={cn(
          'flex h-24 w-full flex-col items-center justify-center gap-1.5 overflow-hidden rounded-[18px] text-[13px] font-semibold transition-colors @min-[480px]:size-28',
          shown !== null ? 'bg-[var(--erp-row)]' : has ? 'bg-[var(--erp-row)] text-[var(--erp-ink)]' : 'border-2 border-dashed border-[var(--erp-line)] text-[var(--erp-ink-2)] hover:border-[var(--erp-ink-2)] hover:bg-[var(--erp-row)]',
        )}
      >
        {shown !== null ? (
          <img src={shown} alt="Receipt" className="size-full object-cover" />
        ) : has ? (
          <>
            <FileText size={22} aria-hidden />
            <span className="max-w-full truncate px-2 text-[12px]">{line.file?.name ?? 'Receipt'}</span>
          </>
        ) : (
          <>
            <Camera size={22} aria-hidden />
            Receipt
          </>
        )}
      </button>
      {line.file !== null && (
        <button
          type="button"
          onClick={() => onFile(null)}
          aria-label="Remove this photo"
          className="erp-on-ink absolute -right-1.5 -top-1.5 flex size-7 items-center justify-center rounded-full bg-[var(--erp-ink)] text-[var(--erp-shell)] ring-2 ring-[var(--erp-card)]"
        >
          <X size={13} aria-hidden />
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f !== undefined) onFile(f);
          e.target.value = '';
        }}
      />
    </div>
  );
}

/* ---------------------------------------------------------------- lines */

function LineCard({
  line,
  index,
  count,
  currency,
  errors,
  onChange,
  onRemove,
}: {
  line: LineDraft;
  index: number;
  count: number;
  currency: string;
  errors: { amount?: string | undefined; account?: string | undefined };
  onChange: (patch: Partial<LineDraft>) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <div className="erp-rise rounded-[24px] bg-[var(--erp-card)] p-4 @min-[640px]:p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-[12px] font-bold text-[var(--erp-muted)]">{count > 1 ? `Expense ${index + 1}` : 'Expense'}</span>
        {count > 1 && <CircleButton icon={Trash2} label={`Remove expense ${index + 1}`} variant="ghost" size={32} onClick={onRemove} />}
      </div>
      <div className="flex flex-col gap-4 @min-[480px]:flex-row">
        <ReceiptSlot line={line} onFile={(f) => onChange({ file: f })} />
        <div className="grid min-w-0 flex-1 grid-cols-1 gap-3 @min-[640px]:grid-cols-2">
          <Field label="Amount, tax included" error={errors.amount}>
            <MoneyInput value={line.amount} onChange={(v) => onChange({ amount: v })} currency={currency} ariaLabel={`Amount of expense ${index + 1}`} />
          </Field>
          <Field label="Kind of expense" error={errors.account}>
            <ExpenseTypePicker value={line.account} onChange={(o) => onChange({ account: o })} ariaLabel={`Kind of expense ${index + 1}`} />
          </Field>
          <Field label="What it was" optional className="@min-[640px]:col-span-2">
            <input value={line.description} onChange={(e) => onChange({ description: e.target.value })} aria-label={`What expense ${index + 1} was`} placeholder="e.g. Taxi to the client" className={softInput} />
          </Field>
          {line.more && (
            <>
              <Field label="Date" hint="When it differs from the claim's date">
                <DateField value={line.date} onChange={(v) => onChange({ date: v })} ariaLabel="Date of this expense" optional placeholder="Same as the claim" />
              </Field>
              <Field label="Tax in the amount" optional>
                <TaxPicker value={line.tax} onChange={(o) => onChange({ tax: o })} scope="purchase" />
              </Field>
              <Field label="Project" optional className="@min-[640px]:col-span-2">
                <ProjectPicker value={line.project} onChange={(o) => onChange({ project: o })} placeholder="None" />
              </Field>
            </>
          )}
        </div>
      </div>
      {!line.more && (
        <button type="button" onClick={() => onChange({ more: true })} className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
          Date, tax, project <ChevronDown size={14} aria-hidden />
        </button>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- screen */

export function ClaimEditor({ claim, currency, onClose, onSaved }: { claim: ClaimDetail | null; currency: string; onClose: () => void; onSaved: (id: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState(claim?.title ?? '');
  const [date, setDate] = useState(claim?.date ?? today());
  const [project, setProject] = useState<Option | null>(claim !== null && claim.project !== null ? { id: claim.project.id, label: claim.project.name, sub: claim.project.code, value: claim.project.id } : null);
  const [lines, setLines] = useState<LineDraft[]>(() => (claim !== null && claim.lines.length > 0 ? fromClaim(claim) : [blank()]));
  const [more, setMore] = useState(claim !== null && claim.project !== null);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState(false);
  const titleRef = useRef<HTMLInputElement | null>(null);
  const cur = claim?.currency ?? currency;

  useEffect(() => {
    if (claim === null && window.innerWidth >= 768) titleRef.current?.focus();
  }, [claim]);

  const kept = lines.filter((l) => !isBlank(l));
  const total = useMemo(() => kept.reduce((s, l) => s + Math.round(Number(normalizeNumber(l.amount, decimalsOf(cur)) ?? '0') * 10 ** decimalsOf(cur)), 0), [kept, cur]);
  const receipts = kept.filter((l) => l.file !== null || l.hadReceipt).length;
  const lineErrors = (l: LineDraft): { amount?: string | undefined; account?: string | undefined } => {
    if (!checked || isBlank(l)) return {};
    const n = Number(normalizeNumber(l.amount, 2) ?? '0');
    return { amount: n > 0 ? undefined : 'Type the amount', account: l.account !== null ? undefined : 'Choose what kind of expense it was' };
  };
  const titleError = checked && title.trim() === '' ? 'Say what the claim is for' : null;

  const update = (key: string, patch: Partial<LineDraft>): void => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const save = async (submit: boolean): Promise<void> => {
    setChecked(true);
    setError(null);
    const bad = title.trim() === '' || kept.length === 0 || kept.some((l) => !(Number(normalizeNumber(l.amount, 2) ?? '0') > 0) || l.account === null);
    if (bad) {
      if (kept.length === 0) setError('Add at least one expense with its amount.');
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    let savedId: string | null = claim?.id ?? null;
    try {
      const payload = kept.map((l) => ({
        id: l.id === '' ? undefined : l.id,
        date: l.date === '' ? undefined : l.date,
        account: l.account?.value ?? l.account?.id ?? '',
        description: l.description.trim(),
        amount: normalizeNumber(l.amount, 2) ?? l.amount,
        tax: l.tax !== null && l.tax.value !== 'none' ? l.tax.value : undefined,
        project: l.project?.value ?? undefined,
      }));
      let r =
        claim === null
          ? await op<ClaimDetail>('claims.create', { title: title.trim(), date, project: project?.value ?? undefined, lines: payload }, { quiet: true })
          : await op<ClaimDetail>('claims.update', { claim: claim.id, title: title.trim(), date, project: project?.value ?? '', lines: payload }, { quiet: true });
      savedId = r.id;
      for (let i = 0; i < kept.length; i++) {
        const f = kept[i]?.file ?? null;
        const line = r.lines[i];
        if (f !== null && line !== undefined) r = await opForm<ClaimDetail>('claims.add-receipt', { claim: r.id, line: line.id }, { file: f }, { quiet: true });
      }
      if (submit) r = await op<ClaimDetail>('claims.submit', { claim: r.id }, { quiet: true });
      rememberAccount(kept[kept.length - 1]?.account ?? null);
      toast.success(submit ? 'Sent for approval' : 'Saved as a draft');
      onSaved(r.id);
    } catch (e) {
      const msg = (e as Error).message;
      if (savedId !== null && claim === null) {
        // The claim exists; finish on its page.
        toast.error(msg);
        onSaved(savedId);
        return;
      }
      setError(msg);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex min-h-full flex-col">
      <ScreenBar width="narrow" title={claim === null ? 'New expense claim' : `Edit ${claim.number}`} sub={claim?.status === 'rejected' ? 'Rejected: change it and submit again' : undefined} onClose={onClose} />
      <div className="mx-auto w-full max-w-[760px] flex-1 px-4 pb-8 @min-[640px]:px-8">
        <div className="erp-rise rounded-[24px] bg-[var(--erp-card)] p-4 @min-[640px]:p-5">
          <Field label="What is this claim for" error={titleError}>
            <input ref={titleRef} value={title} onChange={(e) => setTitle(e.target.value)} aria-label="What is this claim for" placeholder="e.g. Client visit, Penang" className={cn(softInput, 'h-12 text-[15px] font-semibold')} />
          </Field>
          <div className="mt-3 grid grid-cols-1 gap-3 @min-[480px]:grid-cols-2">
            <Field label="Date">
              <DateField value={date} onChange={setDate} ariaLabel="Date of the claim" max={today()} />
            </Field>
            {more ? (
              <Field label="Project" optional>
                <ProjectPicker value={project} onChange={setProject} placeholder="None" />
              </Field>
            ) : (
              <div className="flex items-end">
                <button type="button" onClick={() => setMore(true)} className="inline-flex h-11 items-center gap-1.5 px-1 text-[13px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                  For a project <ChevronDown size={14} aria-hidden />
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {lines.map((l, i) => (
            <LineCard
              key={l.key}
              line={l}
              index={i}
              count={lines.length}
              currency={cur}
              errors={lineErrors(l)}
              onChange={(patch) => update(l.key, patch)}
              onRemove={() => setLines((ls) => ls.filter((x) => x.key !== l.key))}
            />
          ))}
          <button
            type="button"
            onClick={() => setLines((ls) => [...ls, { ...blank(), account: ls[ls.length - 1]?.account ?? lastAccount() }])}
            className="flex h-14 items-center justify-center gap-2 rounded-[20px] border-2 border-dashed border-[var(--erp-line)] text-[14px] font-semibold text-[var(--erp-ink-2)] transition-colors hover:border-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]"
          >
            <Plus size={16} aria-hidden /> Another expense
          </button>
        </div>
        {error !== null && (
          <div className="mt-4">
            <Notice tone="bad" icon={AlertTriangle}>
              {error}
            </Notice>
          </div>
        )}
      </div>

      <div className="sticky bottom-0 z-10 border-t border-[var(--erp-line)] bg-[var(--erp-shell)]/95 backdrop-blur-sm">
        <div className="mx-auto flex w-full max-w-[760px] flex-wrap items-center gap-3 px-4 py-3 @min-[640px]:px-8">
          <div className="min-w-0 flex-1">
            <p className="num text-[15px] font-extrabold">{money(total, cur)}</p>
            <p className="flex items-center gap-1.5 text-[12px] text-[var(--erp-muted)]">
              <Receipt size={12} aria-hidden />
              {plural(kept.length, 'expense')}, {receipts === kept.length && kept.length > 0 ? 'all with receipts' : `${receipts} with receipts`}
            </p>
          </div>
          <PillButton variant="light" loading={busy === 'draft'} disabled={busy !== null} onClick={() => void save(false)}>
            Save draft
          </PillButton>
          <PillButton icon={Send} dot loading={busy === 'submit'} disabled={busy !== null} onClick={() => void save(true)}>
            Submit
          </PillButton>
        </div>
      </div>
    </div>
  );
}
