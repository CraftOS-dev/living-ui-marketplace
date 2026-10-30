/**
 * Ledger: the chart of accounts with balances, an account's register with a
 * running balance, every entry with filters, and the entry inspector: its
 * lines, where it came from (statement line, document, rule, the AI agent's
 * reason), files and history, with edit, void, reverse and approve.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpen, Check as CheckIcon, ChevronDown, ChevronRight, CircleCheck, Copy, FileText, List, Lock, Paperclip, Pencil, Plus, Repeat, Scale, Search, Sparkles, Undo, Upload, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ACCOUNT_TYPE_LABEL, DOC_LABEL, KIND_LABEL, METHOD_LABEL, ago, day, money, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Account, TxnDetail } from '../lib/types.ts';
import { useDialogs } from '../components/dialogs.tsx';
import { AiChip, Check, Confidence, DateInput, Heading, KV, Money, Tabs } from '../components/controls.tsx';
import { AreaChart } from '../components/charts.tsx';
import { Btn, Chip, Empty, IconBtn, Menu, Modal, Select, Spinner, input } from '../components/ui.tsx';

const TYPES = ['asset', 'liability', 'equity', 'income', 'expense'] as const;

/** Balance as people read it: credit-normal accounts show their credit balance as positive. */
export function natural(a: Account, v: number | null | undefined): number {
  const x = v ?? 0;
  return a.type === 'asset' || a.type === 'expense' ? x : -x;
}

function AccountTree({ selected, proposed }: { selected: string; proposed: number }): React.JSX.Element {
  const app = useApp();
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');
  const groups = useMemo(() => {
    const t = q.trim().toLowerCase();
    return TYPES.map((type) => {
      const list = app.accounts.filter((a) => a.type === type && (t === '' || (a.name + ' ' + a.code).toLowerCase().includes(t))).sort((a, b) => (a.code < b.code ? -1 : 1));
      const total = list.reduce((s, a) => s + natural(a, a.balance), 0);
      return { type, list, total };
    });
  }, [app.accounts, q]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-[var(--lf-line)] p-2">
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--lf-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find account" className={cn(input, 'pl-7')} />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto py-1">
        <TreeItem icon={List} label="All entries" active={selected === ''} onClick={() => setQuery({ account: undefined, txn: undefined, status: undefined }, false)} />
        {proposed > 0 && <TreeItem icon={Sparkles} accent label="Waiting for approval" count={proposed} active={selected === 'proposed'} onClick={() => setQuery({ account: undefined, status: 'proposed' }, false)} />}
        {groups.map((g) => (
          <div key={g.type} className="mt-1">
            <button
              type="button"
              onClick={() =>
                setClosed((c) => {
                  const n = new Set(c);
                  if (n.has(g.type)) n.delete(g.type);
                  else n.add(g.type);
                  return n;
                })
              }
              className="flex h-7 w-full items-center gap-1 px-2 text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-[var(--lf-muted)] hover:text-[var(--lf-ink)]"
            >
              {closed.has(g.type) ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
              <span className="flex-1">{ACCOUNT_TYPE_LABEL[g.type]}</span>
              <span className="num normal-case tracking-normal">{money(g.total, app.home, { symbol: false })}</span>
            </button>
            {!closed.has(g.type) &&
              g.list.map((a) => (
                <button key={a.id} type="button" onClick={() => setQuery({ account: a.id, txn: undefined, status: undefined }, false)} aria-current={selected === a.id ? 'true' : undefined} className={cn('relative flex h-7 w-full items-center gap-2 pl-6 pr-2 text-left text-[12.5px] transition-colors', selected === a.id ? 'bg-[var(--lf-row-hover)] font-semibold' : 'hover:bg-[var(--lf-row)]', a.parent !== '' && 'pl-9')}>
                  {selected === a.id && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
                  <span className="num w-9 shrink-0 text-[11px] text-[var(--lf-muted)]">{a.code}</span>
                  <span className="min-w-0 flex-1 truncate">{a.name}</span>
                  <span className={cn('num shrink-0 text-[12px]', natural(a, a.balance) === 0 ? 'text-[var(--lf-muted)]' : '')}>{money(natural(a, a.balance), app.home, { symbol: false })}</span>
                </button>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function TreeItem({ icon: Icon, accent = false, label, count, active, onClick }: { icon: LucideIcon; accent?: boolean | undefined; label: string; count?: number | undefined; active: boolean; onClick: () => void }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('relative flex h-8 w-full items-center gap-2 px-3 text-left text-[12.5px] font-semibold transition-colors', active ? 'bg-[var(--lf-row-hover)]' : 'hover:bg-[var(--lf-row)]')}>
      {active && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
      <Icon size={14} strokeWidth={2} className={cn('shrink-0', accent ? 'text-[var(--lf-accent-text)]' : active ? 'text-[var(--lf-ink)]' : 'text-[var(--lf-muted)]')} />
      <span className="flex-1">{label}</span>
      {count !== undefined && count > 0 && <span className="num rounded-[4px] bg-[var(--lf-accent)] px-1.5 text-[10.5px] font-bold leading-[16px] text-[var(--lf-on-accent)]">{count}</span>}
    </button>
  );
}

const RANGES = [
  { value: '', label: 'All dates' },
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'this_quarter', label: 'This quarter' },
  { value: 'ytd', label: 'Year to date' },
  { value: 'last_year', label: 'Last year' },
];

function rangeDates(r: string, fy: number): { from?: string | undefined; to?: string | undefined } {
  const t = today();
  const y = Number(t.slice(0, 4));
  const m = Number(t.slice(5, 7));
  const pad = (n: number): string => String(n).padStart(2, '0');
  const end = (yy: number, mm: number): string => new Date(Date.UTC(yy, mm, 0)).toISOString().slice(0, 10);
  if (r === 'this_month') return { from: t.slice(0, 8) + '01', to: end(y, m) };
  if (r === 'last_month') {
    const yy = m === 1 ? y - 1 : y;
    const mm = m === 1 ? 12 : m - 1;
    return { from: `${yy}-${pad(mm)}-01`, to: end(yy, mm) };
  }
  if (r === 'this_quarter') {
    const qs = Math.floor((m - 1) / 3) * 3 + 1;
    return { from: `${y}-${pad(qs)}-01`, to: end(y, qs + 2) };
  }
  const fyY = m < fy ? y - 1 : y;
  if (r === 'ytd') return { from: `${fyY}-${pad(fy)}-01`, to: t };
  if (r === 'last_year') return { from: `${fyY - 1}-${pad(fy)}-01`, to: end(fy === 1 ? fyY - 1 : fyY, fy === 1 ? 12 : fy - 1) };
  return {};
}

/* -------------------------------------------------------------- register */

function RegisterPane({ account, sel, onSel }: { account: Account; sel: string; onSel: (txn: string) => void }): React.JSX.Element {
  const app = useApp();
  const d = useDialogs();
  const [range, setRange] = useState('');
  const [q, setQ] = useState('');
  const [recon, setRecon] = useState('');
  const dates = rangeDates(range, app.settings?.fiscal_year_start ?? 1);
  const live = useLive(() => api.register(account.id, { ...dates, q: q || undefined, recon: recon || undefined, limit: 2000 }), ['postings', 'transactions'], [account.id, range, q, recon], 250);
  const r = live.data;
  const cash = account.subtype === 'bank' || account.subtype === 'cash' || account.subtype === 'card';
  const ccy = account.currency || app.home;
  const credit = account.type === 'liability' || account.type === 'income' || account.type === 'equity';
  // The running balance by day (rows are newest first; the last entry of a day is its balance).
  const curve = useMemo(() => {
    if (r === null || r.rows.length < 2) return [];
    const byDay = new Map<string, number>();
    for (let i = r.rows.length - 1; i >= 0; i--) {
      const row = r.rows[i]!;
      if (row.status !== 'posted') continue;
      byDay.set(row.date, credit ? -row.balance : row.balance);
    }
    return [...byDay.entries()].map(([date, value]) => ({ date, value }));
  }, [r, credit]);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--lf-line)] px-3 py-1.5">
        <div className="min-w-0">
          <p className="truncate text-[13.5px] font-bold">
            <span className="num mr-1.5 text-[var(--lf-muted)]">{account.code}</span>
            {account.name}
          </p>
          {account.description !== '' && <p className="hidden truncate text-[11.5px] text-[var(--lf-muted)] xl:block">{account.description}</p>}
        </div>
        <span className="flex-1" />
        <span className="text-[12px] text-[var(--lf-muted)]">Balance</span>
        <Money value={natural(account, account.balance_ccy)} currency={ccy} bold className="text-[14px]" />
        <Select small label="Dates" value={range} onChange={setRange} options={RANGES} className="w-32" />
        <Select
          small
          label="Reconciliation"
          value={recon}
          onChange={setRecon}
          className="w-32"
          options={[
            { value: '', label: 'Any state' },
            { value: 'uncleared', label: 'Not cleared' },
            { value: 'cleared', label: 'Cleared' },
            { value: 'reconciled', label: 'Reconciled' },
          ]}
        />
        <div className="relative">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--lf-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" className={cn(input, 'h-6 w-32 pl-7 text-[12px]')} />
        </div>
        <Btn size="xs" icon={Plus} onClick={() => d.openEntry(cash ? 'expense' : account.type === 'income' ? 'income' : account.type === 'expense' ? 'expense' : 'journal', cash ? { from: account.id } : account.type === 'expense' || account.type === 'income' ? { category: account.id } : {})}>
          Entry
        </Btn>
        {(account.type === 'asset' || account.type === 'liability') && (
          <Btn size="xs" icon={Scale} onClick={() => go('reconcile', { account: account.id })}>
            Reconcile
          </Btn>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {curve.length > 1 && (
          <div className="border-b border-[var(--lf-line)] px-3 pb-1 pt-2">
            <AreaChart points={curve} currency={ccy} height={150} label={account.name + ' balance'} color={account.type === 'liability' ? 'var(--lf-neg)' : 'var(--lf-accent)'} />
          </div>
        )}
        {r === null ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : r.rows.length === 0 ? (
          <Empty icon={BookOpen} title="No entries">
            {range !== '' || q !== '' ? 'Nothing matches these filters.' : 'Entries on this account show here with a running balance.'}
          </Empty>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="w-[92px]">Date</th>
                <th>Description</th>
                <th className="hidden xl:table-cell">Contact</th>
                <th className="r w-[110px]">{cash ? 'Money in' : credit ? 'Increase' : 'Debit'}</th>
                <th className="r w-[110px]">{cash ? 'Money out' : credit ? 'Decrease' : 'Credit'}</th>
                <th className="r w-[120px]">Balance</th>
                <th className="w-[54px]" />
              </tr>
            </thead>
            <tbody>
              {r.rows.map((row) => {
                const inc = cash ? row.amount : credit ? -row.amount : row.amount;
                return (
                  <tr key={row.posting} data-sel={row.txn === sel} data-click="true" onClick={() => onSel(row.txn)} className={row.status === 'proposed' ? 'opacity-70' : ''}>
                    <td className="num text-[var(--lf-ink-2)]">{day(row.date, true)}</td>
                    <td className="max-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className="truncate">{row.narration || KIND_LABEL[row.kind] || row.kind}</span>
                        {row.status === 'proposed' && <Chip tone="warn">Proposed</Chip>}
                        {row.added_by === 'agent' && <AiChip />}
                      </div>
                    </td>
                    <td className="hidden max-w-[160px] truncate text-[var(--lf-ink-2)] xl:table-cell">{row.contact_name}</td>
                    <td className="r num">{inc > 0 ? money(inc, row.currency, { symbol: false }) : ''}</td>
                    <td className="r num">{inc < 0 ? money(-inc, row.currency, { symbol: false }) : ''}</td>
                    <td className="r num font-semibold">{money(credit ? -row.balance : row.balance, ccy, { symbol: false })}</td>
                    <td className="text-[var(--lf-muted)]">{row.recon_state === 'reconciled' ? <Lock size={12} aria-label="Reconciled" /> : row.recon_state === 'cleared' ? <CircleCheck size={12} aria-label="Cleared" /> : null}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      {r !== null && (
        <div className="flex h-8 shrink-0 items-center gap-4 border-t border-[var(--lf-line)] px-3 text-[11.5px] text-[var(--lf-muted)]">
          {dates.from !== undefined && (
            <span>
              Opening <b className="num text-[var(--lf-ink)]">{money(credit ? -r.opening : r.opening, ccy)}</b>
            </span>
          )}
          <span>
            Closing <b className="num text-[var(--lf-ink)]">{money(credit ? -r.closing : r.closing, ccy)}</b>
          </span>
          <span className="flex-1" />
          <span className="num">{r.total} entries</span>
        </div>
      )}
    </div>
  );
}

/* ----------------------------------------------------------- all entries */

function EntriesPane({ sel, onSel, status: initialStatus }: { sel: string; onSel: (txn: string) => void; status: string }): React.JSX.Element {
  const app = useApp();
  const [status, setStatus] = useState(initialStatus || '');
  const [by, setBy] = useState('');
  const [range, setRange] = useState('');
  const [q, setQ] = useState('');
  const [checked, setChecked] = useState<Set<string>>(new Set());
  useEffect(() => setStatus(initialStatus || ''), [initialStatus]);
  const dates = rangeDates(range, app.settings?.fiscal_year_start ?? 1);
  const live = useLive(() => api.transactions({ ...dates, status: status || undefined, added_by: by || undefined, q: q || undefined, limit: 500 }), ['transactions', 'postings'], [status, by, range, q], 250);
  const rows = live.data?.transactions ?? [];
  const proposedIds = [...checked].filter((id) => rows.some((r) => r.id === id && r.status === 'proposed'));
  const act = async (fn: () => Promise<unknown>, msg: string): Promise<void> => {
    try {
      await fn();
      toast.success(msg);
      setChecked(new Set());
    } catch (err) {
      toast.error(errMessage(err));
    }
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3">
        <Tabs
          value={status}
          onChange={setStatus}
          className="h-full"
          tabs={[
            { value: '', label: 'All' },
            { value: 'proposed', label: 'Waiting for approval', count: app.summary?.proposed },
            { value: 'voided', label: 'Voided' },
          ]}
        />
        <span className="flex-1" />
        <Select small label="Added by" value={by} onChange={setBy} className="w-28" options={[{ value: '', label: 'Anyone' }, { value: 'user', label: 'You' }, { value: 'agent', label: 'AI agent' }, { value: 'rule', label: 'Rules' }, { value: 'import', label: 'Import' }, { value: 'recurring', label: 'Recurring' }]} />
        <Select small label="Dates" value={range} onChange={setRange} options={RANGES} className="hidden w-32 sm:block" />
        <div className="relative hidden sm:block">
          <Search size={13} className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-[var(--lf-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Words or amount" className={cn(input, 'h-6 w-40 pl-7 text-[12px]')} />
        </div>
      </div>
      {proposedIds.length > 0 && (
        <div className="flex h-9 shrink-0 items-center gap-2 border-b border-[var(--lf-hair)] bg-[var(--lf-row)] px-3 text-[12.5px]">
          <span className="font-semibold">{proposedIds.length} selected</span>
          <Btn size="xs" variant="primary" icon={CheckIcon} onClick={() => void act(() => api.approve(proposedIds), 'Approved')}>
            Approve
          </Btn>
          <Btn size="xs" onClick={() => void act(() => api.reject(proposedIds), 'Rejected')}>
            Reject
          </Btn>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 && !live.loading ? (
          <Empty icon={BookOpen} title={status === 'proposed' ? 'Nothing waiting' : 'No entries'}>
            {status === 'proposed' ? 'Entries your AI agent or a schedule propose wait here for approval.' : 'Book bank lines in the Inbox or add an entry.'}
          </Empty>
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                {status === 'proposed' && <th className="w-8 pr-0" />}
                <th className="w-[92px]">Date</th>
                <th>Description</th>
                <th className="hidden w-[34%] lg:table-cell">Accounts</th>
                <th className="r w-[120px]">Amount</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => {
                const accs = [...new Set(t.postings.map((p) => app.accountName(p.account)).filter((x) => x !== ''))];
                return (
                  <tr key={t.id} data-sel={t.id === sel} data-click="true" onClick={() => onSel(t.id)} className={t.status === 'voided' ? 'opacity-50' : ''}>
                    {status === 'proposed' && (
                      <td className="pr-0">
                        <Check
                          checked={checked.has(t.id)}
                          onChange={(v) =>
                            setChecked((c) => {
                              const n = new Set(c);
                              if (v) n.add(t.id);
                              else n.delete(t.id);
                              return n;
                            })
                          }
                          label="Select"
                        />
                      </td>
                    )}
                    <td className="num text-[var(--lf-ink-2)]">{day(t.date, true)}</td>
                    <td className="max-w-0">
                      <div className="flex min-w-0 items-center gap-1.5">
                        <span className={cn('min-w-[40%] truncate', t.status === 'voided' && 'line-through')}>{t.narration || KIND_LABEL[t.kind]}</span>
                        {t.contact_name !== '' && !(t.narration || '').includes(t.contact_name) && <span className="hidden min-w-0 shrink-[3] truncate text-[12px] text-[var(--lf-muted)] xl:inline">{t.contact_name}</span>}
                        {t.status === 'proposed' && <Chip tone="warn">Proposed</Chip>}
                        {t.added_by === 'agent' && <AiChip title={t.reason} />}
                        {t.files > 0 && <Paperclip size={12} className="shrink-0 text-[var(--lf-muted)]" />}
                      </div>
                    </td>
                    <td className="hidden max-w-0 truncate text-[12px] text-[var(--lf-ink-2)] lg:table-cell">{accs.join(' · ')}</td>
                    <td className="r num">{money(t.total, app.home)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
      <div className="flex h-8 shrink-0 items-center border-t border-[var(--lf-line)] px-3 text-[11.5px] text-[var(--lf-muted)]">
        <span className="flex-1" />
        <span className="num">{live.data?.total ?? 0} entries</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- inspector */

export function TxnInspector({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const app = useApp();
  const d = useDialogs();
  const live = useLive(() => api.transaction(id), ['transactions', 'postings', 'files', 'activity'], [id]);
  const t: TxnDetail | null = live.data?.transaction ?? null;
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [rev, setRev] = useState(false);
  const [revDate, setRevDate] = useState(today());
  const fileRef = useRef<HTMLInputElement | null>(null);
  if (live.error !== null && t === null) return <Empty icon={BookOpen} title="Entry not found">{live.error}</Empty>;
  if (t === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner />
      </div>
    );
  const run = (p: Promise<unknown>, msg: string): void => {
    p.then(() => toast.success(msg)).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const debit = t.postings.reduce((s, p) => s + (p.home_amount > 0 ? p.home_amount : 0), 0);
  const canEdit = t.status !== 'voided' && t.document === '' && !t.locked;
  const docSide = t.document_info && (t.document_info.kind === 'bill' || t.document_info.kind === 'vendor_credit') ? 'purchases' : 'sales';
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-2 border-b border-[var(--lf-line)] px-4 py-3">
        <div className="min-w-0 flex-1">
          <p className={cn('truncate text-[14px] font-bold', t.status === 'voided' && 'line-through')}>{t.narration || KIND_LABEL[t.kind]}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--lf-muted)]">
            {day(t.date)} · {KIND_LABEL[t.kind] ?? t.kind}
            {t.contact_name !== '' && ' · ' + t.contact_name}
            {t.status === 'proposed' && <Chip tone="warn">Proposed</Chip>}
            {t.status === 'voided' && <Chip tone="neg">Void</Chip>}
            {t.locked && (
              <Chip>
                <Lock size={10} /> Locked
              </Chip>
            )}
          </p>
        </div>
        <Money value={debit} currency={app.home} className="text-[16px] font-bold leading-6" />
        <IconBtn icon={X} label="Close" onClick={onClose} className="md:hidden" />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {(t.added_by === 'agent' || t.method === 'agent' || t.reason !== '') && (
          <div className={cn('mb-3 rounded-[6px] border px-3 py-2.5', t.added_by === 'agent' || t.method === 'agent' ? 'border-[var(--lf-accent)] bg-[var(--lf-accent-soft)]' : 'border-[var(--lf-line)]')}>
            <div className="flex items-center gap-2">
              {t.added_by === 'agent' || t.method === 'agent' ? <AiChip>{t.added_by === 'agent' ? 'Added by your AI agent' : 'Categorized by your AI agent'}</AiChip> : <Chip>{METHOD_LABEL[t.method] ?? t.method}</Chip>}
              <Confidence value={t.confidence} />
            </div>
            {t.reason !== '' && <p className="mt-1.5 text-[12.5px] leading-[18px]">{t.reason}</p>}
            {t.run !== '' && (
              <button type="button" onClick={() => go('activity', { run: t.run })} className="mt-1 text-[11.5px] font-semibold text-[var(--lf-accent-text)] hover:underline">
                See the whole AI run
              </button>
            )}
          </div>
        )}
        {t.status === 'proposed' && (
          <div className="mb-3 flex gap-2">
            <Btn variant="primary" icon={CheckIcon} onClick={() => run(api.approve([t.id]), 'Approved')}>
              Approve
            </Btn>
            <Btn onClick={() => run(api.reject([t.id]).then(onClose), 'Rejected')}>Reject</Btn>
          </div>
        )}
        <table className="lf-table mb-3">
          <thead>
            <tr>
              <th className="pl-0">Account</th>
              <th className="r">Debit</th>
              <th className="r pr-0">Credit</th>
            </tr>
          </thead>
          <tbody>
            {t.postings.map((p) => (
              <tr key={p.id}>
                <td className="max-w-0 pl-0">
                  <button type="button" onClick={() => go('ledger', { account: p.account })} className="block w-full truncate text-left hover:underline">
                    <span className="num mr-1.5 text-[11px] text-[var(--lf-muted)]">{p.account_code}</span>
                    {p.account_name}
                  </button>
                  {(p.memo !== '' || p.tax_code_label) && (
                    <span className="block truncate text-[11px] text-[var(--lf-muted)]">
                      {p.tax_code_label ? p.tax_code_label + (p.tax_role === 'tax' ? ' tax' : '') + ' · ' : ''}
                      {p.memo}
                    </span>
                  )}
                </td>
                <td className="r num align-top">{p.amount > 0 ? money(p.amount, p.currency, { symbol: p.currency !== app.home }) : ''}</td>
                <td className="r num pr-0 align-top">{p.amount < 0 ? money(-p.amount, p.currency, { symbol: p.currency !== app.home }) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {t.void_reason !== '' && <KV k="Void reason">{t.void_reason}</KV>}
        {t.reference !== '' && <KV k="Reference">{t.reference}</KV>}
        {t.document_info && (
          <KV k="Document">
            <button type="button" className="font-semibold hover:underline" onClick={() => go(docSide, { doc: t.document_info!.id })}>
              {DOC_LABEL[t.document_info.kind]} {t.document_info.number}
            </button>
          </KV>
        )}
        {t.allocations.length > 0 && (
          <KV k="Pays">
            {t.allocations.map((a) => (
              <button key={a.id} type="button" className="mr-2 font-semibold hover:underline" onClick={() => go(t.kind === 'payment' && t.postings.some((p) => app.account(p.account)?.system === 'ap') ? 'purchases' : 'sales', { doc: a.document })}>
                {a.number} ({money(a.amount)})
              </button>
            ))}
          </KV>
        )}
        {t.lines.length > 0 && (
          <KV k="Bank line">
            {t.lines.map((l) => (
              <button key={l.id} type="button" className="block truncate text-left hover:underline" onClick={() => go('inbox', { line: l.id, status: 'done' })}>
                {day(l.date, true)} · {l.description}
              </button>
            ))}
          </KV>
        )}
        {t.reverses !== '' && (
          <KV k="Reverses">
            <button type="button" className="font-semibold hover:underline" onClick={() => go('ledger', { txn: t.reverses })}>
              Open the original
            </button>
          </KV>
        )}
        {t.reversed_by !== '' && (
          <KV k="Reversed by">
            <button type="button" className="font-semibold hover:underline" onClick={() => go('ledger', { txn: t.reversed_by })}>
              Open the reversal
            </button>
          </KV>
        )}
        <KV k="Added">
          {t.added_by === 'agent' ? 'AI agent' : t.added_by === 'user' ? 'You' : t.added_by} · {ago(t.created)}
        </KV>

        <div className="mt-4">
          <Heading
            action={
              <Btn size="xs" variant="ghost" icon={Upload} onClick={() => fileRef.current?.click()}>
                Attach
              </Btn>
            }
          >
            Files
          </Heading>
          <input
            ref={fileRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              const fs = Array.from(e.target.files ?? []);
              e.target.value = '';
              if (fs.length > 0) run(api.upload(fs, { link_type: 'transaction', link_id: t.id }), 'Attached');
            }}
          />
          {t.files.length === 0 && <p className="text-[12px] text-[var(--lf-muted)]">No receipt attached.</p>}
          {t.files.map((f) => (
            <a key={f.id} href={api.fileUrl(f.id)} target="_blank" rel="noreferrer" className="flex h-7 items-center gap-2 text-[12.5px] hover:underline">
              <FileText size={13} className="shrink-0 text-[var(--lf-ink-2)]" />
              <span className="truncate">{f.name}</span>
            </a>
          ))}
        </div>

        {t.history.length > 0 && (
          <div className="mt-4">
            <Heading>History</Heading>
            {t.history.map((h) => (
              <div key={h.id} className="flex items-start gap-2 border-b border-[var(--lf-hair)] py-1.5 text-[12px]">
                {h.actor === 'agent' ? <Sparkles size={12} className="mt-0.5 shrink-0 text-[var(--lf-accent-text)]" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--lf-muted)]" />}
                <span className="min-w-0 flex-1">{h.summary}</span>
                <span className="shrink-0 text-[11px] text-[var(--lf-muted)]">{ago(h.created)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      {t.status !== 'voided' && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-[var(--lf-line)] px-4 py-2.5">
          <Btn icon={Pencil} disabled={!canEdit} title={t.document !== '' ? 'Edit the document instead' : t.locked ? 'In a locked period' : undefined} onClick={() => d.editEntry(t)}>
            Edit
          </Btn>
          <Btn icon={Undo} disabled={t.locked} onClick={() => setRev(true)}>
            Reverse
          </Btn>
          <span className="flex-1" />
          <Menu
            align="right"
            trigger={(_, toggle) => (
              <Btn variant="ghost" onClick={toggle}>
                More
              </Btn>
            )}
            items={[
              {
                label: 'Repeat on a schedule',
                icon: Repeat,
                onClick: () => go('setup', { tab: 'recurring', from: 'transaction', id: t.id }),
              },
              {
                label: 'Copy as new entry',
                icon: Copy,
                onClick: () => d.openEntry('journal', { narration: t.narration, contact: t.contact }),
              },
              'divider',
              { label: 'Void', danger: true, disabled: t.document !== '' || t.locked, onClick: () => setVoiding(true) },
            ]}
          />
        </div>
      )}
      {voiding && (
        <Modal
          open
          width="sm"
          title="Void this entry?"
          description="It stays on record but leaves every balance. Its bank lines go back to the inbox."
          onClose={() => setVoiding(false)}
          footer={
            <>
              <Btn onClick={() => setVoiding(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setVoiding(false);
                  run(api.voidEntry(t.id, reason), 'Voided');
                }}
              >
                Void
              </Btn>
            </>
          }
        >
          <input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why (optional)" className={input} />
        </Modal>
      )}
      {rev && (
        <Modal
          open
          width="sm"
          title="Reverse this entry"
          description="Adds the opposite entry on the date you choose, e.g. the first day of next month for an accrual."
          onClose={() => setRev(false)}
          footer={
            <>
              <Btn onClick={() => setRev(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setRev(false);
                  api
                    .reverse(t.id, revDate)
                    .then((r) => {
                      toast.success('Reversed');
                      go('ledger', { txn: r.transaction.id });
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Reverse
              </Btn>
            </>
          }
        >
          <DateInput value={revDate} onChange={setRevDate} />
        </Modal>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ view */

export function LedgerView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const app = useApp();
  const account = app.account(q['account']);
  const sel = q['txn'] ?? '';
  const status = q['status'] ?? '';
  useReportScreen('ledger', sel ? { type: 'transaction', id: sel } : account ? { type: 'account', id: account.id } : null, { account: q['account'] ?? '', status });
  const setSel = (id: string): void => setQuery({ txn: id || undefined });
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[270px] shrink-0 border-r border-[var(--lf-line)] lg:block">
        <AccountTree selected={account?.id ?? (status === 'proposed' ? 'proposed' : '')} proposed={app.summary?.proposed ?? 0} />
      </aside>
      <section className={cn('min-w-0 flex-1', sel !== '' && 'hidden md:block')}>{account !== undefined ? <RegisterPane account={account} sel={sel} onSel={setSel} /> : <EntriesPane sel={sel} onSel={setSel} status={status} />}</section>
      {sel !== '' ? (
        <aside className="fixed inset-0 z-30 flex w-full flex-col bg-[var(--lf-card)] md:static md:z-auto md:w-[400px] md:shrink-0 md:border-l md:border-[var(--lf-line)]">
          <TxnInspector id={sel} onClose={() => setSel('')} />
        </aside>
      ) : null}
    </div>
  );
}
