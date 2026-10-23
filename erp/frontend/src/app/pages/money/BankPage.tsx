/**
 * One bank account and its reconciliation. On top, what the books say is
 * in the account against the statement, its last 90 days, and how much is
 * left to reconcile (your AI agent can do it). Below, the statement lines:
 * each one to reconcile is a card with the best match and the ways to
 * settle it; matched and ignored lines and past imports have their own
 * tabs. "Import statement" opens the full-screen import.
 */
import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, CheckCircle2, FileUp, History, Landmark, PenLine, Plus, Undo2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { AskAgent } from '../../components/AskAgent.tsx';
import { AreaLine } from '../../components/charts.tsx';
import { Menu, ProgressRing, SearchBox, Tabs, useDebounced } from '../../components/controls.tsx';
import { useFullScreen } from '../../components/FullScreen.tsx';
import { AddLineModal, EditBankModal, TransferModal } from '../../components/money/BankForms.tsx';
import { Signed } from '../../components/money/bits.tsx';
import { ImportStatement } from '../../components/money/ImportStatement.tsx';
import { bankKind } from '../../components/money/labels.ts';
import { BookLineModal, CreatePaymentModal } from '../../components/money/LineActions.tsx';
import { IgnoredRow, LineCard, MatchedRow } from '../../components/money/StatementLine.tsx';
import type { LineAction } from '../../components/money/StatementLine.tsx';
import { ProposalCard } from '../../components/Proposal.tsx';
import { Pager } from '../../components/table.tsx';
import { Card, CardHeader, Empty, LoadError, PageHeader, PageSkeleton, PillButton, StatusPill, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago, dayLabel, shortDay } from '../../lib/dates.ts';
import { compact, decimalsOf, money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { back, navigate, replaceQuery, useSection } from '../../lib/router.ts';
import type { Proposal } from '../../lib/types.ts';
import type { BankDetail, BankLine, BankLines, ImportRecord, LineStatus, Suggestion } from '../../lib/types/money.ts';
import type { PageProps } from '../../routes.tsx';

type Tab = 'reconcile' | 'matched' | 'ignored' | 'imports';
const LIMIT = 30;
const STATUS_OF: Record<Exclude<Tab, 'imports'>, LineStatus> = { reconcile: 'unmatched', matched: 'matched', ignored: 'ignored' };

export function BankPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const tabQ = query.get('tab') as Tab | null;
  const tab: Tab = tabQ !== null && ['reconcile', 'matched', 'ignored', 'imports'].includes(tabQ) ? tabQ : 'reconcile';
  const [q, setQ] = useState('');
  const dq = useDebounced(q, 250);
  const [offset, setOffset] = useState(0);
  const [action, setAction] = useState<{ kind: LineAction; line: BankLine; s?: Suggestion | undefined } | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState(false);
  const [transfer, setTransfer] = useState(false);
  const [confirmEl, confirm] = useConfirm();
  useSection('bank', id !== '' ? `bank:${id}` : null);

  const detail = useLive(() => op<BankDetail>('banks.get', { bank: id }, { quiet: true }), READS.money, [id]);
  const b = detail.data;
  useEffect(() => setOffset(0), [tab, dq, id]);

  const lines = useLive(
    () => (tab === 'imports' ? Promise.resolve(null) : op<BankLines>('bank.lines', { bank: id, status: STATUS_OF[tab], q: dq === '' ? undefined : dq, limit: LIMIT, offset }, { quiet: true })),
    [...READS.money, 'documents', 'imports'],
    [id, tab, dq, offset],
  );
  const unmatchedAll = useLive(() => op<BankLines>('bank.lines', { bank: id, status: 'unmatched', limit: 1 }, { quiet: true }), READS.money, [id]);
  const imports = useLive(() => (tab === 'imports' ? op<{ imports: ImportRecord[] }>('bank.imports', { bank: id }, { quiet: true }) : Promise.resolve(null)), ['imports', 'bank_lines'], [id, tab]);
  const proposals = useLive(() => op<{ proposals: Proposal[] }>('proposals.list', { status: 'waiting' }, { quiet: true }).then((r) => r.proposals), ['proposals', 'bank_lines'], []);

  const fs = useFullScreen();

  const lineIds = useMemo(() => new Set((lines.data?.lines ?? []).map((l) => l.id)), [lines.data]);
  const byLine = useMemo(() => {
    const m = new Map<string, Proposal>();
    for (const p of proposals.data ?? []) {
      const line = typeof p.params['line'] === 'string' ? p.params['line'] : '';
      if (line !== '' && lineIds.has(line)) m.set(line, p);
    }
    return m;
  }, [proposals.data, lineIds]);
  const general = (proposals.data ?? []).filter((p) => p.target.entity === 'banks' && p.target.id === id && !(typeof p.params['line'] === 'string' && lineIds.has(p.params['line'])));

  if (detail.error !== null && b === null) return <LoadError message={detail.error} onRetry={detail.reload} />;
  if (b === null) return <PageSkeleton />;

  const k = bankKind(b.kind);
  const canEdit = b.can.edit;
  const canPost = b.can.full;
  const counts = lines.data?.counts ?? unmatchedAll.data?.counts ?? {};
  const unmatched = counts.unmatched ?? b.unmatched;
  const matched = counts.matched ?? 0;
  const totalLines = unmatched + matched;
  const share = totalLines > 0 ? matched / totalLines : 1;
  const um = unmatchedAll.data;
  const reload = (): void => {
    lines.reload();
    unmatchedAll.reload();
    detail.reload();
    proposals.reload();
  };
  const setTab = (t: Tab): void => replaceQuery('bank', { id, tab: t === 'reconcile' ? undefined : t });

  const undo = async (r: ImportRecord): Promise<void> => {
    const ok = await confirm(<>The lines {r.filename} added are removed, except those already matched (they stay).</>, 'Undo this import?', 'Undo import');
    if (!ok) return;
    try {
      const res = await op<{ removed: number; kept_matched: number }>('bank.import-undo', { import_id: r.id });
      toast.success(`${res.removed} ${res.removed === 1 ? 'line' : 'lines'} removed${res.kept_matched > 0 ? `, ${res.kept_matched} matched kept` : ''}`);
      reload();
      imports.reload();
    } catch {
      /* shown */
    }
  };

  const list = lines.data?.lines ?? [];
  const bal = b.balance;
  const stmt = b.statement_balance;

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        back={() => back('banks')}
        eyebrow={
          <>
            <span>{k.label}</span>
            <span>{b.currency}</span>
            {b.account !== null && <span className="num">{b.account.code} in the books</span>}
            {b.archived && (
              <StatusPill tone="neutral" size="sm">
                Archived
              </StatusPill>
            )}
          </>
        }
        title={b.name}
        subtitle={[b.bank_name, b.account_number !== '' ? `ending ${b.account_number.slice(-4)}` : ''].filter((x) => x !== '').join(' · ') || undefined}
        actions={
          <>
            {canEdit && (
              <PillButton icon={FileUp} dot onClick={(e) => fs.open(e.currentTarget)}>
                Import statement
              </PillButton>
            )}
            <Menu
              items={[
                { label: 'Add a line by hand', icon: Plus, onClick: () => setAdding(true), hidden: !canEdit },
                { label: 'Move money to another account', icon: ArrowLeftRight, onClick: () => setTransfer(true), hidden: !canPost },
                { label: 'Change the account', icon: PenLine, onClick: () => setEditing(true), hidden: !can(me, 'banking', 'full') },
                { label: 'Open its ledger', icon: History, onClick: () => navigate('account', { id: b.account?.id ?? '' }), hidden: b.account === null },
              ]}
            />
          </>
        }
      />

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card tone="dark" className="@min-[900px]:col-span-8" delay={1}>
          <div className="grid grid-cols-1 gap-4 @min-[480px]:grid-cols-2">
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">{b.kind === 'card' ? 'Owed on the card, in the books' : 'In the books'}</p>
              <p className={cn('num text-[26px] font-extrabold leading-8 tracking-[-0.02em]', bal < 0 && b.kind !== 'card' && 'text-[var(--erp-red-on-dark)]')}>{money(bal, b.currency)}</p>
              <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">Every payment and entry posted to it</p>
            </div>
            <div>
              <p className="text-[12px] font-semibold text-[var(--erp-on-dark-muted)]">On the statement</p>
              <p className="num text-[26px] font-extrabold leading-8 tracking-[-0.02em]">{stmt !== null ? money(stmt, b.currency) : b.last_statement_date !== '' ? shortDay(b.last_statement_date) : 'No statement'}</p>
              <p className="mt-1 text-[12px] text-[var(--erp-on-dark-muted)]">
                {stmt !== null ? `Balance on the last line, ${b.last_statement_date !== '' ? shortDay(b.last_statement_date) : ''}` : b.last_statement_date !== '' ? 'Date of the last statement line' : 'Import one to start reconciling'}
              </p>
            </div>
          </div>
          <div className="mt-5">
            <AreaLine dark height={140} format={(n) => (Math.abs(n) <= 1 ? '0' : compact(n))} points={b.history.map((h) => ({ key: h.date, label: dayLabel(h.date), value: h.balance / 10 ** decimalsOf(b.currency), text: money(h.balance, b.currency) }))} />
            <p className="mt-2 text-[12px] text-[var(--erp-on-dark-muted)]">Balance in the books over the last 90 days</p>
          </div>
        </Card>

        <Card tone="sand" className="@min-[900px]:col-span-4" delay={2}>
          <CardHeader title="Reconciling" subtitle="Each statement line matched to the books" />
          <div className="flex items-center gap-4">
            <ProgressRing value={share} size={72} tone={unmatched === 0 ? 'green' : 'accent'}>
              {totalLines === 0 ? '-' : `${Math.round(share * 100)}%`}
            </ProgressRing>
            <div className="min-w-0">
              <p className="num text-[26px] font-extrabold leading-8">{unmatched}</p>
              <p className="text-[13px] text-[var(--erp-ink-2)]">{unmatched === 1 ? 'line to reconcile' : 'lines to reconcile'}</p>
            </div>
          </div>
          {um !== null && unmatched > 0 && (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <div className="rounded-[16px] bg-[var(--erp-card)] p-3">
                <span className="block text-[12px] text-[var(--erp-muted)]">Waiting in</span>
                <Signed minor={um.money_in} currency={b.currency} className="text-[14px]" />
              </div>
              <div className="rounded-[16px] bg-[var(--erp-card)] p-3">
                <span className="block text-[12px] text-[var(--erp-muted)]">Waiting out</span>
                <Signed minor={-um.money_out} currency={b.currency} className="text-[14px]" />
              </div>
            </div>
          )}
          {unmatched > 0 && canEdit && (
            <div className="mt-4">
              <AskAgent kind="bank_lines_waiting" params={{ bank: b.id }} label="Ask your AI agent to reconcile" variant="dark" align="start" size="sm" />
            </div>
          )}
          {unmatched === 0 && totalLines > 0 && (
            <p className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-[var(--erp-green-text)]">
              <CheckCircle2 size={15} aria-hidden /> All reconciled
            </p>
          )}
        </Card>
      </div>

      {general.length > 0 && (
        <div className="flex flex-col gap-3">
          {general.map((p) => (
            <ProposalCard key={p.id} p={p} onDecided={reload} />
          ))}
        </div>
      )}

      <div className="flex flex-col">
        <div className="min-w-0">
          <Tabs
            ariaLabel="Statement lines"
            value={tab}
            onChange={setTab}
            tabs={[
              { value: 'reconcile', label: 'To reconcile', count: unmatched },
              { value: 'matched', label: 'Matched' },
              { value: 'ignored', label: 'Ignored' },
              { value: 'imports', label: 'Imports' },
            ]}
            className="mb-3"
          />
          <Card delay={2}>
            {tab !== 'imports' && (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <p className="text-[13px] text-[var(--erp-muted)]">
                  {lines.data !== null ? `${lines.data.total} ${lines.data.total === 1 ? 'line' : 'lines'}` : ''}
                  {lines.data !== null && lines.data.total > 0 && tab === 'reconcile' ? `, newest first` : ''}
                </p>
                <SearchBox value={q} onChange={setQ} soft placeholder="Search the description" ariaLabel="Search lines" className="w-full @min-[480px]:w-64" />
              </div>
            )}
            {tab === 'imports' ? (
              imports.data === null ? (
                <div className="h-24 animate-none" />
              ) : imports.data.imports.length === 0 ? (
                <Empty icon={FileUp} title="No statements imported yet" action={canEdit ? <PillButton icon={FileUp} dot onClick={(e) => fs.open(e.currentTarget)}>Import statement</PillButton> : undefined}>
                  Each import is listed here with what it added. An import can be undone.
                </Empty>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {imports.data.imports.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-row)] px-4 py-3">
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-card)]">
                        <FileUp size={15} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[14px] font-bold">{r.filename}</span>
                        <span className="block text-[12px] text-[var(--erp-muted)]">
                          {ago(r.created)} · {r.status === 'previewed' ? 'Not imported' : `${r.added} added${r.skipped > 0 ? `, ${r.skipped} skipped` : ''}`}
                        </span>
                      </span>
                      {r.status === 'undone' ? (
                        <StatusPill tone="neutral" size="sm">
                          Undone
                        </StatusPill>
                      ) : r.status === 'imported' && canEdit ? (
                        <button type="button" onClick={() => void undo(r)} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[var(--erp-card)] px-3 text-[12px] font-semibold text-[var(--erp-ink-2)] hover:text-[var(--erp-ink)]">
                          <Undo2 size={13} aria-hidden /> Undo
                        </button>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )
            ) : lines.loading && lines.data === null ? (
              <div className="flex flex-col gap-2">
                {[0, 1, 2].map((i) => (
                  <span key={i} className="erp-skeleton block h-24 rounded-[22px]" />
                ))}
              </div>
            ) : list.length === 0 ? (
              tab === 'reconcile' ? (
                <Empty
                  icon={CheckCircle2}
                  title={dq !== '' ? 'No lines match' : totalLines === 0 ? 'No statement lines yet' : 'All reconciled'}
                  action={canEdit && dq === '' ? <PillButton icon={FileUp} dot onClick={(e) => fs.open(e.currentTarget)}>Import statement</PillButton> : undefined}
                >
                  {dq !== '' ? 'Try another search.' : totalLines === 0 ? 'Import the CSV your bank gives you and match each line to the books.' : 'Every statement line is matched. Import the next statement when it comes.'}
                </Empty>
              ) : (
                <Empty icon={tab === 'matched' ? Landmark : CheckCircle2} title={tab === 'matched' ? 'Nothing matched yet' : 'Nothing ignored'} compact>
                  {tab === 'matched' ? 'Lines you match show here, each with what it matched.' : 'Lines you ignore (duplicates, things already booked another way) show here.'}
                </Empty>
              )
            ) : (
              <ul className="flex flex-col gap-2">
                {list.map((l) =>
                  tab === 'reconcile' ? (
                    <LineCard key={l.id} line={l} bank={b} canEdit={canEdit} canPost={canPost} proposal={byLine.get(l.id)} onAction={(kind, line, s) => setAction({ kind, line, s })} onChanged={reload} />
                  ) : tab === 'matched' ? (
                    <MatchedRow key={l.id} line={l} bank={b} canEdit={canEdit} onChanged={reload} />
                  ) : (
                    <IgnoredRow key={l.id} line={l} bank={b} canEdit={canEdit} onChanged={reload} />
                  ),
                )}
              </ul>
            )}
            {tab !== 'imports' && lines.data !== null && <Pager offset={offset} limit={LIMIT} total={lines.data.total} onChange={setOffset} />}
          </Card>
        </div>
      </div>
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-2 @min-[900px]:items-start">
          <Card delay={3}>
            <CardHeader title="Latest in the books" subtitle="What was posted to this account" />
            {b.recent.length === 0 ? (
              <p className="text-[13px] text-[var(--erp-muted)]">Nothing posted yet.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {b.recent.slice(0, 6).map((r, i) => (
                  <li key={`${r.journal}-${i}`} className="flex items-center gap-3 rounded-[14px] px-1 py-1.5">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-semibold">{r.label !== '' ? r.label : r.memo}</span>
                      <span className="block text-[12px] text-[var(--erp-muted)]">{dayLabel(r.date)}</span>
                    </span>
                    <Signed minor={r.amount} currency={b.currency} className="text-[13px]" />
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <RecordActivity entity="banks" refId={b.id} />
      </div>

      {fs.node(<ImportStatement bank={b} onClose={fs.close} onDone={() => {
        setTab('reconcile');
        reload();
      }} />, { title: 'Import a statement' })}
      {action !== null && action.kind === 'payment' && (
        <CreatePaymentModal
          open
          onClose={() => setAction(null)}
          line={action.line}
          bank={b}
          initialParty={action.s?.party_id !== undefined && action.s.party_id !== '' ? { id: action.s.party_id, name: action.s.party } : undefined}
          initialDoc={action.s !== undefined && (action.s.kind === 'invoice' || action.s.kind === 'bill') ? action.s.id : undefined}
          onDone={reload}
        />
      )}
      {action !== null && action.kind === 'book' && <BookLineModal open onClose={() => setAction(null)} line={action.line} bank={b} onDone={reload} />}
      {action !== null && action.kind === 'transfer' && <TransferModal open onClose={() => setAction(null)} line={action.line} lineBank={b} onDone={reload} />}
      <TransferModal open={transfer} onClose={() => setTransfer(false)} onDone={reload} />
      <AddLineModal open={adding} onClose={() => setAdding(false)} bank={b} onDone={reload} />
      <EditBankModal open={editing} onClose={() => setEditing(false)} bank={b} onDone={detail.reload} />
      {confirmEl}
    </div>
  );
}
