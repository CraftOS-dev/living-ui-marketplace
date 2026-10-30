/**
 * Inbox: imported bank lines waiting to become bookkeeping, and receipts
 * waiting to be filed.
 *
 * Each line shows its suggestion (match, pays a document, transfer, rule,
 * like before, or the AI agent's proposal with its reason and confidence).
 * Review by keyboard: J/K or arrows move, Enter books the suggestion, X
 * excludes, Space ticks, A asks the AI agent. The inspector changes the
 * decision: a category (with tax), a split, a transfer or a match.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowDownToLine, ArrowLeftRight, Ban, Banknote, Check as CheckIcon, CircleCheck, CreditCard, FileText, Inbox as InboxIcon, Landmark, Layers, Link2, RefreshCw, RotateCcw, Search, Sparkles, Upload, Wand2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import type { Decision } from '../lib/api.ts';
import { METHOD_LABEL, bytes, day, money, parseMoney, toDecimal } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Doc, Line } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { AccountPicker, AiChip, Check, Confidence, ContactPicker, Heading, KV, Money, MoneyInput, Tabs, TaxPicker, isCash, isPostable } from '../components/controls.tsx';
import { Btn, Chip, Empty, IconBtn, Spinner, input, useConfirm } from '../components/ui.tsx';
import { Meter } from '../components/charts.tsx';

type Status = 'open' | 'ai' | 'auto' | 'none' | 'done' | 'excluded';

const FILTERS: Record<Status, Record<string, string>> = {
  open: { status: 'open' },
  ai: { status: 'open', suggestion: 'agent' },
  auto: { status: 'open', suggestion: 'match' },
  none: { status: 'open', suggestion: 'none' },
  done: { status: 'done' },
  excluded: { status: 'excluded' },
};

function typing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('input, textarea, select, [contenteditable="true"]');
}

/** The suggestion in a few words: method and where it goes. */
function SuggestionCell({ line }: { line: Line }): React.JSX.Element {
  const app = useApp();
  const s = line.suggestion;
  if (line.status === 'posted' || line.status === 'matched') {
    const fin = s?.final;
    return (
      <span className="flex min-w-0 items-center gap-1.5 text-[var(--lf-muted)]">
        <CircleCheck size={13} className="shrink-0 text-[var(--lf-pos)]" />
        <span className="truncate">{line.status === 'matched' ? 'Matched' : fin?.account ? app.accountName(fin.account) : 'Booked'}</span>
      </span>
    );
  }
  if (line.status === 'excluded') return <span className="text-[var(--lf-muted)]">Excluded</span>;
  const aiBusy = line.agent_state === 'waiting' || line.agent_state === 'working';
  if (aiBusy && s === null)
    return (
      <span className="flex items-center gap-1.5 text-[var(--lf-accent-text)]">
        <Sparkles size={12} className="lf-pulse" /> {line.agent_state === 'working' ? 'AI is on it' : 'Waiting for AI'}
      </span>
    );
  if (s === null) return <span className="text-[var(--lf-muted)]">Choose a category</span>;
  let target = '';
  if (s.method === 'match' || s.method === 'document' || s.method === 'transfer') target = s.match?.label ?? (s.transfer_account ? app.accountName(s.transfer_account) : '');
  else if (s.splits && s.splits.length > 0) target = 'Split ' + s.splits.length + ' ways';
  else target = app.accountName(s.account);
  return (
    <span className="flex min-w-0 items-center gap-1.5" title={s.reason}>
      {s.method === 'agent' ? <AiChip title={s.reason} /> : <Chip tone={s.method === 'rule' ? 'ink' : 'neutral'}>{METHOD_LABEL[s.method] ?? s.method}</Chip>}
      <span className="truncate font-medium">{target}</span>
      <Confidence value={s.confidence} />
      {aiBusy && <Sparkles size={11} className="lf-pulse shrink-0 text-[var(--lf-accent-text)]" aria-label="Your AI agent is looking at it" />}
    </span>
  );
}

/* ------------------------------------------------------------- inspector */

type Mode = 'category' | 'split' | 'transfer' | 'match';

function LineInspector({ id, onDone, onClose }: { id: string; onDone: () => void; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.line(id), ['statement_lines', 'transactions'], [id]);
  const line = live.data?.line ?? null;
  const [mode, setMode] = useState<Mode>('category');
  const [account, setAccount] = useState('');
  const [contact, setContact] = useState('');
  const [tax, setTax] = useState('');
  const [memo, setMemo] = useState('');
  const [narration, setNarration] = useState('');
  const [rule, setRule] = useState(false);
  const [splits, setSplits] = useState<{ account: string; amount: string }[]>([]);
  const [transfer, setTransfer] = useState('');
  const [match, setMatch] = useState<{ type: 'posting' | 'document' | 'line'; id: string } | null>(null);
  const [docs, setDocs] = useState<Doc[]>([]);
  const [busy, setBusy] = useState(false);
  const seeded = useRef('');

  // Seed the form from the suggestion once per line.
  useEffect(() => {
    if (line === null || seeded.current === line.id + ':' + JSON.stringify(line.suggestion)) return;
    seeded.current = line.id + ':' + JSON.stringify(line.suggestion);
    const s = line.suggestion;
    setAccount(s?.account ?? s?.final?.account ?? '');
    setContact(s?.contact ?? s?.contact_name ?? '');
    setTax(s?.tax_code ?? '');
    setMemo('');
    setNarration(s?.narration ?? '');
    setRule(false);
    setTransfer(s?.transfer_account ?? '');
    setMatch(s?.match ? { type: s.match.type, id: s.match.id } : null);
    const ccy = line.currency;
    const abs0 = Math.abs(line.amount);
    setSplits(s?.splits && s.splits.length > 0 ? s.splits.map((x) => ({ account: x.account, amount: toDecimal(Math.round((abs0 * Number(x.percent)) / 100), ccy) })) : [{ account: s?.account ?? '', amount: toDecimal(abs0, ccy) }, { account: '', amount: '' }]);
    setMode(s?.match ? 'match' : s?.transfer_account ? 'transfer' : s?.splits && s.splits.length > 0 ? 'split' : 'category');
  }, [line]);

  // Open documents for exactly this amount, for matching.
  useEffect(() => {
    if (line === null || mode !== 'match') return;
    api
      .docs({ side: line.amount > 0 ? 'sales' : 'purchases', state: 'unpaid', limit: 200 })
      .then((r) => setDocs(r.docs.filter((d) => d.currency === line.currency)))
      .catch(() => setDocs([]));
  }, [line, mode]);

  if (line === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );

  const acc = app.account(line.account);
  const s = line.suggestion;
  const booked = line.status === 'posted' || line.status === 'matched';
  const abs = Math.abs(line.amount);
  const splitTotal = splits.reduce((t, x) => t + (parseMoney(x.amount, line.currency) ?? 0), 0);

  const decision = (): Decision | null => {
    if (mode === 'category') {
      if (account === '') return null;
      return { account, contact: contact || undefined, tax_code: tax || undefined, memo: memo || undefined, narration: narration || undefined };
    }
    if (mode === 'split') {
      const rows = splits.filter((x) => x.account !== '' && (parseMoney(x.amount, line.currency) ?? 0) > 0);
      if (rows.length < 2 || splitTotal !== abs) return null;
      return { splits: rows.map((x) => ({ account: x.account, percent: (((parseMoney(x.amount, line.currency) ?? 0) / abs) * 100).toFixed(6) })), contact: contact || undefined, narration: narration || undefined };
    }
    if (mode === 'transfer') return transfer === '' ? null : { transfer_account: transfer, narration: narration || undefined };
    return match === null ? null : { match };
  };

  const book = async (useSuggestion: boolean): Promise<void> => {
    const d = useSuggestion ? null : decision();
    if (!useSuggestion && d === null) {
      toast.error(mode === 'split' ? 'The split must add up to ' + money(abs, line.currency) : 'Choose where it goes');
      return;
    }
    setBusy(true);
    try {
      await api.accept(line.id, d, rule && mode === 'category');
      toast.success('Booked' + (rule ? ' and a rule made' : ''));
      onDone();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const suggestionSame = s !== null && mode === 'category' && account === (s.account ?? '') && tax === (s.tax_code ?? '') && memo === '' && !rule;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-[var(--lf-line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-bold">{line.payee || line.description}</p>
          <p className="mt-0.5 text-[12px] text-[var(--lf-muted)]">
            {day(line.date)} · {acc?.name ?? ''}
          </p>
        </div>
        <Money value={line.amount} currency={line.currency} tone="in" className="text-[18px] font-bold leading-6" />
        <IconBtn icon={X} label="Close" onClick={onClose} className="md:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mono mb-3 break-words text-[var(--lf-ink-2)]">{line.description}</p>

        {booked && line.transaction && (
          <div className="mb-3 flex flex-col gap-2">
            <Heading
              action={
                <Btn size="xs" variant="ghost" onClick={() => go('ledger', { txn: line.txn })}>
                  Open entry
                </Btn>
              }
            >
              Booked
            </Heading>
            {line.transaction.postings.map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 text-[12.5px]">
                <span className="truncate">{p.account_name}</span>
                <Money value={p.amount} currency={p.currency} />
              </div>
            ))}
            <div>
              <Btn
                size="sm"
                icon={RotateCcw}
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  api
                    .unmatch(line.id)
                    .then(() => toast.success('Back in the inbox'))
                    .catch((err: unknown) => toast.error(errMessage(err)))
                    .finally(() => setBusy(false));
                }}
              >
                Unbook
              </Btn>
            </div>
          </div>
        )}

        {line.status === 'excluded' && (
          <div className="mb-3 flex flex-col gap-2">
            <p className="text-[12.5px] text-[var(--lf-muted)]">Excluded from the books{line.note ? ': ' + line.note : ''}.</p>
            <div>
              <Btn size="sm" icon={RotateCcw} onClick={() => void api.exclude([line.id], true).catch((err: unknown) => toast.error(errMessage(err)))}>
                Restore
              </Btn>
            </div>
          </div>
        )}

        {!booked && line.status !== 'excluded' && (
          <>
            {s !== null && (
              <div className={cn('mb-3 rounded-[6px] border px-3 py-2.5', s.method === 'agent' ? 'border-[var(--lf-accent)] bg-[var(--lf-accent-soft)]' : 'border-[var(--lf-line)]')}>
                <div className="flex items-center gap-2">
                  {s.method === 'agent' ? <AiChip>AI proposal</AiChip> : <Chip tone={s.method === 'rule' ? 'ink' : 'neutral'}>{METHOD_LABEL[s.method] ?? s.method}</Chip>}
                  <Confidence value={s.confidence} />
                  <span className="flex-1" />
                  <Btn size="xs" variant="primary" icon={CheckIcon} loading={busy} onClick={() => void book(true)}>
                    Book
                  </Btn>
                </div>
                {s.reason && <p className="mt-1.5 text-[12.5px] leading-[18px]">{s.reason}</p>}
                {s.similar && s.similar.length > 0 && <p className="mt-1 text-[11.5px] text-[var(--lf-muted)]">Based on {s.similar.length} earlier line{s.similar.length === 1 ? '' : 's'}</p>}
              </div>
            )}
            {(line.agent_state === 'waiting' || line.agent_state === 'working') && (
              <p className="mb-3 flex items-center gap-2 text-[12.5px] text-[var(--lf-accent-text)]">
                <Sparkles size={13} className="lf-pulse" /> Your AI agent is categorizing this line.
              </p>
            )}

            <div className="mb-3 h-8 border-b border-[var(--lf-hair)]">
              <Tabs
                value={mode}
                onChange={setMode}
                tabs={[
                  { value: 'category', label: 'Category' },
                  { value: 'split', label: 'Split' },
                  { value: 'transfer', label: 'Transfer' },
                  { value: 'match', label: 'Match' },
                ]}
              />
            </div>

            {mode === 'category' && (
              <div className="flex flex-col gap-2">
                <AccountPicker value={account} onChange={setAccount} filter={(a) => isPostable(a) && a.id !== line.account} order={line.amount < 0 ? ['expense', 'liability', 'asset', 'equity', 'income'] : ['income', 'liability', 'asset', 'equity', 'expense']} placeholder="Category" label="Category" />
                <div className="grid grid-cols-2 gap-2">
                  <ContactPicker value={contact} onChange={(v) => setContact(v)} placeholder={line.payee || 'Contact'} kind={line.amount < 0 ? 'vendor' : 'customer'} />
                  {app.taxCodes.length > 0 ? <TaxPicker value={tax} onChange={setTax} scope={line.amount < 0 ? 'purchases' : 'sales'} /> : <span />}
                </div>
                <input value={narration} onChange={(e) => setNarration(e.target.value)} className={input} placeholder={'Description: ' + (line.payee || line.description).slice(0, 40)} />
                <input value={memo} onChange={(e) => setMemo(e.target.value)} className={input} placeholder="Memo" />
                <label className="flex items-center gap-2 text-[12.5px]">
                  <Check checked={rule} onChange={setRule} label="Make a rule" />
                  Always book “{(line.payee || line.description).slice(0, 32)}” like this
                </label>
              </div>
            )}

            {mode === 'split' && (
              <div className="flex flex-col gap-2">
                {splits.map((x, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <AccountPicker label="Split account" value={x.account} onChange={(v) => setSplits((ss) => ss.map((y, j) => (j === i ? { ...y, account: v } : y)))} filter={(a) => isPostable(a) && a.id !== line.account} className="min-w-0 flex-1" />
                    <MoneyInput value={x.amount} onChange={(v) => setSplits((ss) => ss.map((y, j) => (j === i ? { ...y, amount: v } : y)))} className="w-28" label="Amount" />
                    <IconBtn icon={X} label="Remove" size={24} onClick={() => setSplits((ss) => (ss.length > 2 ? ss.filter((_, j) => j !== i) : ss))} />
                  </div>
                ))}
                <div className="flex items-center justify-between text-[12px]">
                  <Btn size="xs" variant="ghost" onClick={() => setSplits((ss) => [...ss, { account: '', amount: splitTotal < abs ? toDecimal(abs - splitTotal, line.currency) : '' }])}>
                    Add line
                  </Btn>
                  <span className={cn('num font-semibold', splitTotal === abs ? 'text-[var(--lf-muted)]' : 'text-[var(--lf-neg-text)]')}>
                    {money(splitTotal, line.currency)} of {money(abs, line.currency)}
                  </span>
                </div>
              </div>
            )}

            {mode === 'transfer' && (
              <div className="flex flex-col gap-2">
                <p className="text-[12px] text-[var(--lf-muted)]">Money moved {line.amount < 0 ? 'to' : 'from'} another of your accounts. If the other side is in the inbox too, it is booked with this one.</p>
                <AccountPicker label="Other account" value={transfer} onChange={setTransfer} filter={(a) => (a.type === 'asset' || a.type === 'liability') && a.id !== line.account && isPostable(a)} order={['asset', 'liability']} placeholder="Other account" />
              </div>
            )}

            {mode === 'match' && (
              <div className="flex flex-col gap-1">
                {s?.match && (
                  <MatchRow selected={match?.id === s.match.id} onClick={() => setMatch({ type: s.match!.type, id: s.match!.id })} title={s.match.label || (s.match.type === 'posting' ? 'Entry in the books' : 'Other line')} sub={(s.match.date ? day(s.match.date) + ' · ' : '') + (s.match.type === 'document' ? 'Open document' : s.match.type === 'line' ? 'Transfer line' : 'Existing entry')} />
                )}
                {docs
                  .filter((d) => d.id !== s?.match?.id)
                  .sort((a, b) => Math.abs(a.open - abs) - Math.abs(b.open - abs))
                  .slice(0, 12)
                  .map((d) => (
                    <MatchRow key={d.id} selected={match?.id === d.id} onClick={() => setMatch({ type: 'document', id: d.id })} title={(d.number || 'Draft') + ' · ' + d.contact_name} sub={'Open ' + money(d.open, d.currency) + (d.open !== abs ? ' (differs)' : '') + ' · due ' + day(d.due_date)} disabled={d.open < abs} />
                  ))}
                {s?.match === undefined && docs.length === 0 && <p className="py-2 text-[12px] text-[var(--lf-muted)]">No entry or open {line.amount > 0 ? 'invoice' : 'bill'} to match. Use Category instead.</p>}
              </div>
            )}

            <div className="mt-3 flex items-center gap-2">
              <Btn variant="primary" loading={busy} onClick={() => void book(suggestionSame)} icon={CheckIcon}>
                Book
              </Btn>
              <Btn
                icon={Ban}
                onClick={() =>
                  void api
                    .exclude([line.id])
                    .then(() => onDone())
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              >
                Exclude
              </Btn>
              <span className="flex-1" />
              {line.agent_state !== 'waiting' && line.agent_state !== 'working' && s?.by !== 'agent' && (
                <Btn
                  variant="ghost"
                  icon={Sparkles}
                  onClick={() =>
                    void api
                      .askAgentLines([line.id])
                      .then((r) => toast.success(r.asked ? 'Sent to your AI agent' : 'Queued for your AI agent' + (r.reason ? ' (' + r.reason + ')' : '')))
                      .catch((err: unknown) => toast.error(errMessage(err)))
                  }
                >
                  Ask AI
                </Btn>
              )}
            </div>
          </>
        )}

        {line.similar !== undefined && line.similar.length > 0 && (
          <div className="mt-5">
            <Heading>Booked before</Heading>
            {line.similar.map((x) => (
              <div key={x.id} className="flex h-7 items-center gap-2 border-b border-[var(--lf-hair)] text-[12px]">
                <span className="num w-[72px] shrink-0 text-[var(--lf-muted)]">{day(x.date, true)}</span>
                <span className="min-w-0 flex-1 truncate">{app.accountName(x.account) || '—'}</span>
                <Money value={x.amount} currency={line.currency} />
              </div>
            ))}
          </div>
        )}
        <div className="mt-5">
          <Heading>Statement</Heading>
          <KV k="Bank reference">{line.bank_id || '—'}</KV>
          <KV k="Imported">{day(line.created.slice(0, 10))}</KV>
        </div>
      </div>
    </div>
  );
}

function MatchRow({ title, sub, selected, onClick, disabled = false }: { title: string; sub: string; selected: boolean; onClick: () => void; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <button type="button" disabled={disabled} onClick={onClick} className={cn('flex w-full items-center gap-2 rounded-[5px] border px-2.5 py-1.5 text-left transition-colors disabled:opacity-45', selected ? 'border-[var(--lf-ink)] bg-[var(--lf-row)]' : 'border-[var(--lf-line)] hover:bg-[var(--lf-row)]')}>
      <Link2 size={13} className="shrink-0 text-[var(--lf-ink-2)]" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{title}</span>
        <span className="block truncate text-[11.5px] text-[var(--lf-muted)]">{sub}</span>
      </span>
      {selected && <CheckIcon size={14} strokeWidth={2.4} />}
    </button>
  );
}

/* ------------------------------------------------------------------ files */

function FileInspector({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const live = useLive(() => api.file(id), ['files', 'transactions'], [id]);
  const [confirmEl, confirm] = useConfirm();
  const f = live.data?.file ?? null;
  if (f === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  const x = f.extracted;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {confirmEl}
      <div className="flex items-center gap-2 border-b border-[var(--lf-line)] px-4 py-3">
        <FileText size={15} className="shrink-0 text-[var(--lf-ink-2)]" />
        <p className="min-w-0 flex-1 truncate text-[13.5px] font-bold">{f.name}</p>
        <IconBtn icon={X} label="Close" onClick={onClose} className="md:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b border-[var(--lf-hair)] bg-[var(--lf-row)]">
          {f.image ? (
            <img src={api.fileUrl(f.id)} alt={f.name} className="mx-auto max-h-[340px] object-contain" />
          ) : f.mime === 'application/pdf' ? (
            <iframe title={f.name} src={api.fileUrl(f.id)} className="h-[340px] w-full border-0" />
          ) : (
            <div className="flex h-24 items-center justify-center text-[12px] text-[var(--lf-muted)]">
              <a href={api.fileUrl(f.id, true)} className="font-semibold underline">
                Download {bytes(f.size)}
              </a>
            </div>
          )}
        </div>
        <div className="px-4 py-3">
          {(f.agent_state === 'waiting' || f.agent_state === 'working') && (
            <p className="mb-3 flex items-center gap-2 text-[12.5px] text-[var(--lf-accent-text)]">
              <Sparkles size={13} className="lf-pulse" /> {f.agent_state === 'working' ? 'Your AI agent is reading this file.' : 'Waiting for your AI agent to read it.'}
            </p>
          )}
          {f.agent_state === 'failed' && <p className="mb-3 text-[12.5px] text-[var(--lf-neg-text)]">{f.note || 'Your AI agent could not read it.'}</p>}
          <Heading>What it says</Heading>
          {x !== null ? (
            <>
              <KV k="From">{x.vendor || '—'}</KV>
              <KV k="Date">{x.date ? day(x.date) : '—'}</KV>
              <KV k="Total">{x.total ? (x.currency ?? '') + ' ' + x.total : '—'}</KV>
              {x.tax && <KV k="Tax">{x.tax}</KV>}
              {x.number && <KV k="Number">{x.number}</KV>}
            </>
          ) : (
            <p className="py-1 text-[12px] text-[var(--lf-muted)]">Not read yet.</p>
          )}
          {f.note && f.agent_state !== 'failed' && <p className="mt-2 text-[12px] text-[var(--lf-ink-2)]">{f.note}</p>}
          <div className="mt-4">
            <Heading>Attached to</Heading>
            {f.linked_type !== '' ? (
              <div className="flex items-center gap-2">
                <Chip tone="pos">{f.linked_type}</Chip>
                <Btn size="xs" variant="ghost" onClick={() => (f.linked_type === 'transaction' ? go('ledger', { txn: f.linked_id }) : f.linked_type === 'document' ? go('purchases', { doc: f.linked_id }) : go('inbox', { line: f.linked_id }))}>
                  Open
                </Btn>
                <Btn size="xs" variant="ghost" onClick={() => void api.linkFile(f.id, 'none', '').catch((err: unknown) => toast.error(errMessage(err)))}>
                  Detach
                </Btn>
              </div>
            ) : (
              <>
                {(f.candidates ?? []).length === 0 && <p className="py-1 text-[12px] text-[var(--lf-muted)]">{x === null ? 'Once read, entries with the same total show here.' : 'No entry with this total near this date.'}</p>}
                {(f.candidates ?? []).map((c) => (
                  <div key={c.txn} className="flex h-8 items-center gap-2 border-b border-[var(--lf-hair)] text-[12px]">
                    <span className="num w-[64px] shrink-0 text-[var(--lf-muted)]">{day(c.date, true)}</span>
                    <span className="min-w-0 flex-1 truncate">{c.narration}</span>
                    <Money value={c.amount} currency={app.home} />
                    <Btn size="xs" onClick={() => void api.linkFile(f.id, 'transaction', c.txn).then(() => toast.success('Attached')).catch((err: unknown) => toast.error(errMessage(err)))}>
                      Attach
                    </Btn>
                  </div>
                ))}
              </>
            )}
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {f.agent_state !== 'waiting' && f.agent_state !== 'working' && (
              <Btn size="sm" icon={Sparkles} onClick={() => void api.askAgentFile(f.id).then((r) => toast.success(r.asked ? 'Sent to your AI agent' : 'Queued for your AI agent')).catch((err: unknown) => toast.error(errMessage(err)))}>
                {x === null ? 'Ask AI to read' : 'Ask AI again'}
              </Btn>
            )}
            <Btn size="sm" onClick={() => void api.archiveFile(f.id, f.status !== 'archived').catch((err: unknown) => toast.error(errMessage(err)))}>
              {f.status === 'archived' ? 'Restore' : 'Archive'}
            </Btn>
            <Btn
              size="sm"
              variant="danger"
              onClick={() =>
                void confirm('The file is deleted for good.', 'Delete ' + f.name + '?').then((ok) => {
                  if (ok)
                    api
                      .deleteFile(f.id)
                      .then(onClose)
                      .catch((err: unknown) => toast.error(errMessage(err)));
                })
              }
            >
              Delete
            </Btn>
          </div>
        </div>
      </div>
    </div>
  );
}

function FilesPane({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }): React.JSX.Element {
  const d = useDialogs();
  const [st, setSt] = useState<'open' | 'linked' | 'archived'>('open');
  const live = useLive(() => api.files({ status: st, limit: 300 }), ['files'], [st]);
  const files = live.data?.files ?? [];
  const [over, setOver] = useState(false);
  const drop = async (list: File[]): Promise<void> => {
    try {
      const r = await api.upload(list);
      toast.success('Added ' + r.files.length + ' file' + (r.files.length === 1 ? '' : 's'));
    } catch (err) {
      toast.error(errMessage(err));
    }
  };
  return (
    <div
      className={cn('flex h-full min-h-0 flex-col', over && 'bg-[var(--lf-accent-soft)]')}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        void drop(Array.from(e.dataTransfer.files));
      }}
    >
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3">
        <Tabs
          value={st}
          onChange={setSt}
          tabs={[
            { value: 'open', label: 'To file' },
            { value: 'linked', label: 'Attached' },
            { value: 'archived', label: 'Archived' },
          ]}
          className="h-full"
        />
        <span className="flex-1" />
        <Btn size="sm" icon={Upload} onClick={() => d.openUpload()}>
          Add files
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {files.length === 0 && !live.loading && (
          <Empty icon={FileText} title={st === 'open' ? 'No receipts waiting' : 'Nothing here'}>
            {st === 'open' ? 'Drop receipts, supplier invoices or PDF statements here. Your AI agent reads them and attaches each to its entry.' : undefined}
          </Empty>
        )}
        <table className="lf-table">
          <tbody>
            {files.map((f) => (
              <tr key={f.id} data-sel={f.id === selected} data-click="true" onClick={() => onSelect(f.id)}>
                <td className="w-full max-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileText size={14} className="shrink-0 text-[var(--lf-ink-2)]" />
                    <span className="truncate font-medium">{f.extracted?.vendor || f.name}</span>
                    {f.extracted?.vendor && <span className="truncate text-[12px] text-[var(--lf-muted)]">{f.name}</span>}
                  </div>
                </td>
                <td className="num text-[var(--lf-muted)]">{f.extracted?.date ? day(f.extracted.date, true) : day(f.created.slice(0, 10), true)}</td>
                <td className="r num">{f.extracted?.total ? (f.extracted.currency ?? '') + ' ' + f.extracted.total : ''}</td>
                <td className="w-[110px]">{f.agent_state === 'waiting' || f.agent_state === 'working' ? <AiChip>{f.agent_state === 'working' ? 'Reading' : 'Queued'}</AiChip> : f.agent_state === 'failed' ? <Chip tone="neg">Unread</Chip> : f.linked_type ? <Chip tone="pos">Attached</Chip> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- view */

export function InboxView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const d = useDialogs();
  const tab = q['tab'] === 'files' ? 'files' : 'lines';
  const account = q['account'] ?? '';
  const status = (q['status'] as Status | undefined) ?? 'open';
  const [search, setSearch] = useState('');
  const [sel, setSel] = useState(q['line'] ?? '');
  const [fileSel, setFileSel] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);

  const live = useLive(() => api.inbox({ ...FILTERS[status], account: account || undefined, q: search || undefined, limit: 1000 }), ['statement_lines'], [status, account, search], 250);
  const lines = useMemo(() => live.data?.lines ?? [], [live.data]);
  const files = useLive(() => api.files({ status: 'open', limit: 1 }), ['files'], []);
  const fileCount = app.summary?.files_inbox ?? files.data?.files.length ?? 0;

  useReportScreen('inbox', tab === 'files' ? (fileSel ? { type: 'file', id: fileSel } : null) : sel ? { type: 'line', id: sel } : null, { status, account, tab });

  useEffect(() => {
    if (q['line'] !== undefined && q['line'] !== sel) setSel(q['line']);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q['line']]);

  // Keep a valid selection: the first line when nothing (or a vanished line) is selected.
  const index = lines.findIndex((l) => l.id === sel);
  useEffect(() => {
    if (tab !== 'lines') return;
    if (lines.length === 0) return;
    if (sel === '' && window.innerWidth >= 768) setSel(lines[0]?.id ?? '');
  }, [lines, sel, tab]);

  const advance = useCallback(() => {
    const i = lines.findIndex((l) => l.id === sel);
    const next = lines[i + 1] ?? lines[i - 1];
    setSel(next !== undefined && next.id !== sel ? next.id : '');
  }, [lines, sel]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-id="${sel}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [sel]);

  // Keyboard review.
  useEffect(() => {
    if (tab !== 'lines') return;
    const onKey = (e: KeyboardEvent): void => {
      if (typing() || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('[role="dialog"]') !== null) return;
      const i = lines.findIndex((l) => l.id === sel);
      const cur = lines[i];
      if (e.key === 'j' || e.key === 'ArrowDown') {
        e.preventDefault();
        const n = lines[Math.min(lines.length - 1, i + 1)];
        if (n) setSel(n.id);
      } else if (e.key === 'k' || e.key === 'ArrowUp') {
        e.preventDefault();
        const n = lines[Math.max(0, i - 1)];
        if (n) setSel(n.id);
      } else if (e.key === 'Enter' && cur !== undefined && cur.suggestion !== null && (cur.status === 'new' || cur.status === 'proposed')) {
        e.preventDefault();
        api
          .accept(cur.id, null)
          .then(() => {
            toast.success('Booked');
            advance();
          })
          .catch((err: unknown) => toast.error(errMessage(err)));
      } else if (e.key === 'x' && cur !== undefined && (cur.status === 'new' || cur.status === 'proposed')) {
        e.preventDefault();
        api
          .exclude([cur.id])
          .then(advance)
          .catch((err: unknown) => toast.error(errMessage(err)));
      } else if (e.key === ' ' && cur !== undefined) {
        e.preventDefault();
        setChecked((c) => {
          const n = new Set(c);
          if (n.has(cur.id)) n.delete(cur.id);
          else n.add(cur.id);
          return n;
        });
      } else if (e.key === 'a' && cur !== undefined) {
        e.preventDefault();
        void api
          .askAgentLines([cur.id])
          .then(() => toast.success('Sent to your AI agent'))
          .catch((err: unknown) => toast.error(errMessage(err)));
      } else if (e.key === 'i') {
        e.preventDefault();
        d.openImport(account || undefined);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lines, sel, tab, advance, d, account]);

  const banks = useMemo(() => app.accounts.filter(isCash), [app.accounts]);
  const totalOpen = banks.reduce((t, a) => t + (a.inbox ?? 0), 0);
  const highIds = lines.filter((l) => (l.status === 'new' || l.status === 'proposed') && l.suggestion !== null && l.suggestion.confidence === 'high').map((l) => l.id);
  const byMethod = (...m: string[]): number => lines.filter((l) => l.suggestion !== null && m.includes(l.suggestion.method)).length;
  const mix = [
    { label: 'AI proposals', value: byMethod('agent'), color: 'var(--lf-accent)' },
    { label: 'by rules', value: byMethod('rule'), color: 'var(--lf-ink-2)' },
    { label: 'matched', value: byMethod('match', 'document', 'transfer'), color: 'var(--lf-c2)' },
    { label: 'like before', value: byMethod('memory'), color: 'var(--lf-c1)' },
    { label: 'need a category', value: lines.filter((l) => l.suggestion === null).length, color: 'var(--lf-line)' },
  ];
  const checkedIds = [...checked].filter((id) => lines.some((l) => l.id === id));
  const counts = live.data?.counts ?? {};

  const bulk = async (ids: string[], what: 'book' | 'exclude' | 'ai'): Promise<void> => {
    if (ids.length === 0) return;
    setBusy(true);
    try {
      if (what === 'book') {
        const r = await api.acceptMany(ids);
        toast.success('Booked ' + r.booked + (r.skipped.length > 0 ? '; ' + r.skipped.length + ' need a category' : ''));
      } else if (what === 'exclude') {
        await api.exclude(ids);
        toast.success('Excluded ' + ids.length);
      } else {
        const r = await api.askAgentLines(ids);
        toast.success(r.asked ? 'Sent ' + r.waiting + ' to your AI agent' : 'Queued for your AI agent' + (r.reason ? ' (' + r.reason + ')' : ''));
      }
      setChecked(new Set());
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const setStatus = (v: Status): void => setQuery({ status: v === 'open' ? undefined : v });
  const selected = lines[index];

  return (
    <div className="flex h-full min-h-0">
      {/* accounts */}
      <aside className="hidden w-[236px] shrink-0 flex-col border-r border-[var(--lf-line)] lg:flex">
        <div className="flex-1 overflow-y-auto py-1.5">
          <SideItem icon={Layers} active={tab === 'lines' && account === ''} onClick={() => setQuery({ account: undefined, tab: undefined, line: undefined }, false)} label="All accounts" count={totalOpen} />
          {banks.map((a) => (
            <SideItem key={a.id} icon={a.subtype === 'card' ? CreditCard : a.subtype === 'cash' ? Banknote : Landmark} active={tab === 'lines' && account === a.id} onClick={() => setQuery({ account: a.id, tab: undefined }, false)} label={a.name} count={a.inbox ?? 0} sub={money(a.balance_ccy ?? 0, a.currency || app.home)} />
          ))}
          <div className="mx-3 my-1.5 h-px bg-[var(--lf-hair)]" />
          <SideItem icon={FileText} active={tab === 'files'} onClick={() => setQuery({ tab: 'files' }, false)} label="Receipts and documents" count={fileCount} />
        </div>
        <div className="flex flex-col gap-1.5 border-t border-[var(--lf-line)] p-2">
          <Btn icon={ArrowDownToLine} onClick={() => d.openImport(account || undefined)}>
            Import statement
          </Btn>
        </div>
      </aside>

      {tab === 'files' ? (
        <>
          <section className={cn('min-w-0 flex-1', fileSel !== '' && 'hidden md:block')}>
            <FilesPane selected={fileSel} onSelect={setFileSel} />
          </section>
          {fileSel !== '' && (
            <aside className="fixed inset-0 z-30 flex w-full flex-col bg-[var(--lf-card)] md:static md:z-auto md:w-[400px] md:shrink-0 md:border-l md:border-[var(--lf-line)]">
              <FileInspector id={fileSel} onClose={() => setFileSel('')} />
            </aside>
          )}
        </>
      ) : (
        <>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex h-10 shrink-0 items-center gap-3 border-b border-[var(--lf-line)] px-3">
              <Tabs
                value={status}
                onChange={setStatus}
                className="h-full"
                tabs={[
                  { value: 'open', label: 'To review', count: (counts['new'] ?? 0) + (counts['proposed'] ?? 0) },
                  { value: 'ai', label: 'AI proposals' },
                  { value: 'auto', label: 'Matches' },
                  { value: 'none', label: 'No suggestion' },
                  { value: 'done', label: 'Booked' },
                  { value: 'excluded', label: 'Excluded' },
                ]}
              />
              <span className="flex-1" />
              <div className="relative hidden sm:block">
                <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--lf-muted)]" />
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Find" className={cn(input, 'h-7 w-40 pl-7')} />
              </div>
              <IconBtn
                icon={RefreshCw}
                label="Recheck suggestions (after new rules, entries or documents)"
                onClick={() =>
                  void api
                    .refreshInbox()
                    .then((r) => toast.success('Rechecked' + (r.auto_posted > 0 ? '; ' + r.auto_posted + ' booked by rules' : '')))
                    .catch((err: unknown) => toast.error(errMessage(err)))
                }
              />
              <Btn icon={ArrowDownToLine} className="lg:hidden" onClick={() => d.openImport(account || undefined)}>
                Import
              </Btn>
            </div>
            {(checkedIds.length > 0 || (status === 'open' && highIds.length > 0)) && (
              <div className="flex h-9 shrink-0 items-center gap-3 border-b border-[var(--lf-hair)] bg-[var(--lf-row)] px-3 text-[12.5px]">
                {checkedIds.length > 0 ? (
                  <>
                    <span className="font-semibold">{checkedIds.length} selected</span>
                    <Btn size="xs" variant="primary" loading={busy} onClick={() => void bulk(checkedIds, 'book')}>
                      Book suggestions
                    </Btn>
                    <Btn size="xs" onClick={() => void bulk(checkedIds, 'ai')} icon={Sparkles}>
                      Ask AI
                    </Btn>
                    <Btn size="xs" onClick={() => void bulk(checkedIds, 'exclude')}>
                      Exclude
                    </Btn>
                    <Btn size="xs" variant="ghost" onClick={() => setChecked(new Set())}>
                      Clear
                    </Btn>
                  </>
                ) : (
                  <>
                    <Meter count width={120} items={mix} className="hidden overflow-hidden md:flex [&>span:last-child]:flex-nowrap" />
                    <span className="flex-1" />
                    <Wand2 size={13} className="shrink-0 text-[var(--lf-ink-2)]" />
                    <span className="shrink-0">
                      <b className="num">{highIds.length}</b> sure
                    </span>
                    <Btn size="xs" variant="primary" loading={busy} onClick={() => void bulk(highIds, 'book')}>
                      Book them
                    </Btn>
                  </>
                )}
              </div>
            )}
            <div ref={listRef} className="min-h-0 flex-1 overflow-auto">
              {lines.length === 0 && !live.loading ? (
                <Empty
                  icon={status === 'open' ? CircleCheck : InboxIcon}
                  title={status === 'open' ? (Object.values(counts).reduce((a, b) => a + b, 0) === 0 ? 'Import your first statement' : 'Inbox zero') : 'Nothing here'}
                  action={
                    status === 'open' ? (
                      <Btn icon={ArrowDownToLine} variant="primary" onClick={() => d.openImport(account || undefined)}>
                        Import statement
                      </Btn>
                    ) : undefined
                  }
                >
                  {status === 'open' ? (Object.values(counts).reduce((a, b) => a + b, 0) === 0 ? 'Bank and card statements from your bank (OFX, QFX, QIF, CSV, CAMT.053 or MT940) land here. Rules, your history and your AI agent suggest how to book each line.' : 'Every bank line is booked. Import the next statement to continue.') : undefined}
                </Empty>
              ) : (
                <>
                <ul className="md:hidden">
                  {lines.map((l) => (
                    <li key={l.id}>
                      <button type="button" onClick={() => setSel(l.id)} className="flex w-full items-start gap-3 border-b border-[var(--lf-hair)] px-3 py-2.5 text-left active:bg-[var(--lf-row)]">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-semibold">{l.payee || l.description}</span>
                          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[12px]">
                            <span className="num shrink-0 text-[var(--lf-muted)]">{day(l.date, true)}</span>
                            <SuggestionCell line={l} />
                          </span>
                        </span>
                        <Money value={l.amount} currency={l.currency} tone="in" className="shrink-0 text-[13px] font-semibold" />
                      </button>
                    </li>
                  ))}
                </ul>
                <table className="lf-table hidden md:table">
                  <thead>
                    <tr>
                      <th className="w-8 pr-0">
                        <Check checked={checkedIds.length > 0 && checkedIds.length === lines.length} indeterminate={checkedIds.length > 0 && checkedIds.length < lines.length} onChange={(v) => setChecked(v ? new Set(lines.map((l) => l.id)) : new Set())} label="Select all" />
                      </th>
                      <th className="w-[92px]">Date</th>
                      <th>Payee</th>
                      <th className="r w-[120px]">Amount</th>
                      <th className="w-[36%]">Suggestion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => (
                      <tr key={l.id} data-id={l.id} data-sel={l.id === sel} data-click="true" onClick={() => setSel(l.id)}>
                        <td className="pr-0">
                          <Check
                            checked={checked.has(l.id)}
                            onChange={(v) =>
                              setChecked((c) => {
                                const n = new Set(c);
                                if (v) n.add(l.id);
                                else n.delete(l.id);
                                return n;
                              })
                            }
                            label="Select line"
                          />
                        </td>
                        <td className="num text-[var(--lf-ink-2)]">{day(l.date, true)}</td>
                        <td className="max-w-0">
                          <div className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate font-semibold">{l.payee || l.description}</span>
                            {account === '' && <span className="hidden shrink-0 text-[11.5px] text-[var(--lf-muted)] xl:inline">{app.accountName(l.account)}</span>}
                          </div>
                        </td>
                        <td className="r">
                          <Money value={l.amount} currency={l.currency} tone="in" />
                        </td>
                        <td className="max-w-0">
                          <SuggestionCell line={l} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </>
              )}
            </div>
            <div className="hidden h-8 shrink-0 items-center gap-4 border-t border-[var(--lf-line)] px-3 text-[11.5px] text-[var(--lf-muted)] md:flex">
              <span>
                <b>J K</b> move
              </span>
              <span>
                <b>Enter</b> book
              </span>
              <span>
                <b>X</b> exclude
              </span>
              <span>
                <b>Space</b> select
              </span>
              <span>
                <b>A</b> ask AI
              </span>
              <span>
                <b>I</b> import
              </span>
              <span className="flex-1" />
              <span className="num">{live.data?.total ?? 0} lines</span>
            </div>
          </section>
          {selected !== undefined && (
            <aside className="fixed inset-0 z-30 flex w-full flex-col bg-[var(--lf-card)] md:static md:z-auto md:w-[400px] md:shrink-0 md:border-l md:border-[var(--lf-line)]">
              <LineInspector id={selected.id} onDone={advance} onClose={() => setSel('')} />
            </aside>
          )}
          {selected === undefined && lines.length > 0 && (
            <aside className="hidden w-[400px] shrink-0 border-l border-[var(--lf-line)] md:block">
              <Empty icon={ArrowLeftRight} title="Pick a line">
                Its suggestion and the ways to book it show here.
              </Empty>
            </aside>
          )}
        </>
      )}
    </div>
  );
}

function SideItem({ icon: Icon, label, count, sub, active, onClick }: { icon: LucideIcon; label: string; count: number; sub?: string | undefined; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} aria-current={active ? 'true' : undefined} className={cn('relative flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors', active ? 'bg-[var(--lf-row-hover)]' : 'hover:bg-[var(--lf-row)]')}>
      {active && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
      <Icon size={14} strokeWidth={2} className={cn('shrink-0', active ? 'text-[var(--lf-ink)]' : 'text-[var(--lf-muted)]')} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] font-semibold">{label}</span>
        {sub !== undefined && <span className="num block truncate text-[11.5px] text-[var(--lf-muted)]">{sub}</span>}
      </span>
      {count > 0 && <span className="num rounded-[4px] bg-[var(--lf-ink)] px-1.5 text-[10.5px] font-bold leading-[16px] text-[var(--lf-card)]">{count}</span>}
    </button>
  );
}

