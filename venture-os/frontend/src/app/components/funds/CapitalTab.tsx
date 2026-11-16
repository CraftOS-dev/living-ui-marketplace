/**
 * Capital: calls and distributions as rows with their paid bar; an event
 * opens its page. Statements with open differences show below; importing
 * one is a drop (CSV or XLSX) and the differences come back at once.
 */
import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Check, Plus, ScrollText, Sparkle } from 'lucide-react';
import { AgentTag, Button, DataTable, DayPicker, Empty, Field, FileDrop, LoadError, Panel, Segmented, Sheet, SheetHeader, Skeleton, StatusDot, Tag, Tip } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { fmtDay, money } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { readTable } from '../../lib/sheets.ts';
import { FUND_READS, PaidBar } from './common.tsx';
import type { CapitalEvent, FundView } from './types.ts';
import { AskAgent, askWith } from '../agent.tsx';
import type { AgentAsks } from '../../lib/types.ts';

const STATUS: Record<CapitalEvent['status'], { label: string; tone: 'neutral' | 'warn' | 'good' | 'faint' | 'a' }> = {
  draft: { label: 'Draft', tone: 'faint' },
  previewed: { label: 'Ready', tone: 'a' },
  issued: { label: 'Issued', tone: 'neutral' },
  settled: { label: 'Paid', tone: 'good' },
  void: { label: 'Void', tone: 'faint' },
};

interface StatementRow {
  id: string;
  source: 'administrator' | 'bank';
  period_end: string;
  name: string;
  status: string;
  differences: number;
  open: number;
  agent?: AgentAsks | undefined;
}

interface Diff {
  index: number;
  kind: string;
  lp_name: string;
  field: string;
  ours_minor: number | null;
  theirs_minor: number | null;
  diff_minor: number | null;
  explanation: string;
  explained_by: string;
  state: string;
  match?: { number: string; lp_name: string } | null | undefined;
}

export function StatementSheet({ fund, id, onClose }: { fund: FundView; id: string; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ statement: StatementRow & { diffs: Diff[] } }>('statements.get', { statement: id }, ['statements'], { name: 'statements.get' });
  const s = live.data?.statement;
  const cur = fund.currency;
  const open = (s?.diffs ?? []).filter((d) => d.state !== 'resolved');

  return (
    <Sheet open onClose={onClose} label="Statement" width={560}>
      <SheetHeader title={s?.name ?? 'Statement'} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-5">
        {s === undefined && <Skeleton className="h-40" />}
        {s !== undefined && open.length === 0 && <Empty icon={Check} title="Reconciled" />}
        {open.map((d) => (
          <div key={d.index} className="vo-panel flex min-w-0 flex-col gap-1.5 px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="vo-wrap min-w-0 flex-1 text-[13px] font-medium">{d.lp_name || 'Unknown LP'}</span>
              <Tag tone="faint">{d.kind === 'receipt' ? 'Receipt' : d.field}</Tag>
              <span className="vo-mono vo-num text-[13px]">{d.diff_minor === null ? '' : money(d.diff_minor, cur, { sign: true })}</span>
            </div>
            {d.kind === 'account' && (
              <div className="vo-mono vo-num flex gap-4 text-[12px] text-[var(--vo-muted)]">
                <span>Ours {money(d.ours_minor, cur)}</span>
                <span>Theirs {money(d.theirs_minor, cur)}</span>
              </div>
            )}
            {d.match && <div className="text-[12px] text-[var(--vo-ink-2)]">{d.match.number + ' ' + d.match.lp_name}</div>}
            {d.explanation !== '' && (
              <div className="vo-wrap flex items-start gap-1.5 text-[13px] text-[var(--vo-ink-2)]">
                {d.explained_by === 'agent' && <AgentTag />}
                <span className="min-w-0">{d.explanation}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {can(me, 'funds', 'edit') && open.length > 0 && (
        <div className="flex items-center justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
          <AskAgent label="Ask your AI agent" size="md" className="mr-auto" title="Matches receipts to LP lines and explains each difference; you accept them." state={s?.agent?.reconcile} onAsk={askWith('reconcile', id)} reads={['statements', 'agent_requests']} />
          <Button variant="primary" icon={Check} onClick={() => void act([], () => op('statements.resolve', { statement: id, all: true }), ['statements'])}>
            Accept all
          </Button>
        </div>
      )}
    </Sheet>
  );
}

/** Import an administrator or bank statement: drop the file, pick the day, see the differences. */
export function StatementImport({ fund, onClose }: { fund: FundView; onClose: () => void }): React.JSX.Element {
  const [source, setSource] = useState<'administrator' | 'bank'>('administrator');
  const [day, setDay] = useState('');
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [file, setFile] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState('');
  const read = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (f === undefined) return;
    const t = await readTable(f);
    const head = t.headers;
    setRows(t.rows.map((r) => Object.fromEntries(head.map((h, i) => [h, String(r[i] ?? '')]))));
    setFile(f.name);
  };
  const run = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op<{ statement: { id: string } }>('statements.import', { fund: fund.id, source, period_end: day || undefined, rows: JSON.stringify(rows ?? []), name: file }), ['statements']);
    setBusy(false);
    if (out !== null) setDone(out.statement.id);
  };
  if (done !== '') return <StatementSheet fund={fund} id={done} onClose={onClose} />;
  return (
    <Sheet open onClose={onClose} label="Import statement" width={460}>
      <SheetHeader title="Import statement" onClose={onClose} />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Segmented
          label="Source"
          value={source}
          onChange={setSource}
          options={[
            { value: 'administrator', label: 'Administrator' },
            { value: 'bank', label: 'Bank' },
          ]}
        />
        {source === 'administrator' && (
          <Field label="As of">
            <DayPicker value={day} onChange={setDay} label="As of" />
          </Field>
        )}
        <FileDrop label="CSV or Excel" accept=".csv,.tsv,.xlsx" onFiles={(f) => void read(f)}>
          {rows !== null && <span className="vo-mono text-[12px]">{file + ' ' + rows.length}</span>}
        </FileDrop>
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={rows === null || rows.length === 0 || (source === 'administrator' && day === '')} onClick={() => void run()}>
          Import
        </Button>
      </div>
    </Sheet>
  );
}

export function CapitalTab({ fund, statement, onNew }: { fund: FundView; statement: string; onNew?: ((k: 'call' | 'distribution') => void) | undefined }): React.JSX.Element {
  const live = useOp<{ events: CapitalEvent[] }>('calls.list', { fund: fund.id, status: 'all', limit: 300 }, FUND_READS, { name: 'calls.list' });
  const st = useOp<{ statements: StatementRow[] }>('statements.list', { fund: fund.id }, ['statements'], { name: 'statements.list' });
  const cur = fund.currency;
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const statements = (st.data?.statements ?? []).filter((s) => s.open > 0);
  return (
    <>
      <Panel flush>
        <DataTable<CapitalEvent>
          label="Calls and distributions"
          rows={live.data.events}
          rowKey={(r) => r.id}
          rowHref={(r) => `#/funds/${fund.id}/events/${r.id}`}
          stickyTop={0}
          empty={<Empty icon={ArrowDownToLine} title="No calls yet" action={onNew !== undefined ? <Button icon={Plus} onClick={() => onNew('call')}>New call</Button> : undefined} />}
          columns={[
            {
              key: 'number',
              label: 'Notice',
              width: 'minmax(130px,1fr)',
              fixed: true,
              phone: 'title',
              render: (r) => (
                <span className="flex items-center gap-2">
                  {r.kind === 'call' ? <ArrowDownToLine size={14} className="text-[var(--vo-a)]" aria-label="Call" /> : <ArrowUpFromLine size={14} className="text-[var(--vo-b)]" aria-label="Distribution" />}
                  <span className="vo-mono">{r.number}</span>
                </span>
              ),
            },
            { key: 'day', label: 'Notice day', mono: true, sort: (r) => r.notice_day, render: (r) => fmtDay(r.notice_day), phone: 'sub' },
            { key: 'total', label: 'Total', align: 'right', mono: true, sort: (r) => r.total_minor, render: (r) => money(r.total_minor, cur, { compact: true }), phone: 'end' },
            { key: 'paid', label: 'Paid', width: 'minmax(140px,1.2fr)', render: (r) => (r.status === 'issued' || r.status === 'settled' ? <PaidBar paid={r.paid_minor} total={r.total_minor} /> : ''), phone: 'hide' },
            { key: 'status', label: 'Status', width: '110px', render: (r) => <StatusDot tone={STATUS[r.status].tone} label={STATUS[r.status].label} />, phone: 'hide' },
          ]}
        />
      </Panel>
      {statements.length > 0 && (
        <Panel label="Statements" flush>
          <DataTable<StatementRow>
            label="Statements"
            rows={statements}
            rowKey={(r) => r.id}
            onRowClick={(r) => setQuery({ statement: r.id })}
            stickyTop={0}
            columns={[
              { key: 'name', label: 'Statement', fixed: true, phone: 'title', render: (r) => (<span className="flex items-center gap-2"><ScrollText size={14} className="text-[var(--vo-muted)]" aria-hidden />{r.name}</span>) },
              { key: 'open', label: 'Open', align: 'right', mono: true, width: '90px', render: (r) => String(r.open) },
            ]}
          />
        </Panel>
      )}
      {statement !== '' && <StatementSheet fund={fund} id={statement} onClose={() => setQuery({ statement: null })} />}
    </>
  );
}
