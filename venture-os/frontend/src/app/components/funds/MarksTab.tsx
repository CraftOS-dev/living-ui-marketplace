/**
 * Marks: per holding the method, the value and its change this quarter;
 * your AI agent's drafts carry the Sparkle. Approve all asks the PIN once.
 * A row opens the calibration note with its sourced inputs.
 */
import { useState } from 'react';
import { Check, Scale, Sparkle } from 'lucide-react';
import { AgentTag, Avatar, Button, ChipPicker, DataTable, Empty, Field, LoadError, MoneyInput, Panel, Sheet, SheetHeader, Skeleton, StatusDot, Tip } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { majorParam, money } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { Change, FUND_READS, HiddenHoldings, MethodTag } from './common.tsx';
import type { FundView, Mark, MarksList } from './types.ts';
import { METHOD_LABEL } from './types.ts';
import { AskAgent, AskStatus, askWith } from '../agent.tsx';

type Row = MarksList['holdings'][number];
const METHODS = ['calibrated_round', 'round_adjusted', 'multiples', 'write_down', 'write_off'] as const;
type Method = (typeof METHODS)[number];

/** Approver: finance (funds edit) or a partner (portfolio and committee edit). */
export function useApprover(): boolean {
  const me = useMe();
  return can(me, 'funds', 'edit') || (can(me, 'portfolio', 'edit') && can(me, 'committee', 'edit'));
}

function MarkSheet({ row, currency, onClose }: { row: Row; currency: string; onClose: () => void }): React.JSX.Element {
  const m = row.quarter_mark as Mark;
  const approver = useApprover();
  const [method, setMethod] = useState<Method>(m.method as Method);
  const [value, setValue] = useState<number | null>(m.value_minor);
  const [busy, setBusy] = useState(false);
  const approve = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op('marks.approve', { mark: m.id, method, value: majorParam(value ?? 0, currency) }), ['marks']);
    setBusy(false);
    if (out !== null) onClose();
  };
  return (
    <Sheet open onClose={onClose} label={row.name} width={520}>
      <SheetHeader title={row.name} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        <Field label="Method">
          <ChipPicker label="Method" value={method} onChange={setMethod} options={METHODS.map((x) => ({ value: x, label: METHOD_LABEL[x] ?? x }))} />
        </Field>
        <Field label="Value">
          <MoneyInput value={method === 'write_off' ? 0 : value} onChange={setValue} currency={currency} label="Value" />
        </Field>
        <div className="vo-wrap flex items-start gap-2 text-[13px] leading-5 text-[var(--vo-ink-2)]">
          {m.actor === 'agent' && <AgentTag />}
          <p className="min-w-0 whitespace-pre-line">{m.rationale}</p>
        </div>
        {m.inputs.length > 0 && (
          <dl className="grid grid-cols-[minmax(110px,auto)_auto_1fr] gap-x-4 gap-y-1.5 rounded-[var(--vo-radius-sm)] bg-[var(--vo-sunk)] px-4 py-3 text-[13px]">
            {m.inputs.map((x, i) => (
              <div key={i} className="contents">
                <dt className="text-[var(--vo-muted)]">{x.label}</dt>
                <dd className="vo-mono vo-num">{x.value}</dd>
                <dd className="vo-wrap min-w-0 text-[var(--vo-ink-2)]">{x.source}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      {approver && m.status === 'draft' && (
        <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" icon={Check} busy={busy} onClick={() => void approve()}>
            Approve
          </Button>
        </div>
      )}
    </Sheet>
  );
}

export function MarksTab({ fund }: { fund: FundView }): React.JSX.Element {
  const me = useMe();
  const approver = useApprover();
  const live = useOp<MarksList>('marks.list', { fund: fund.id }, FUND_READS, { name: 'marks.list' });
  const [open, setOpen] = useState<Row | null>(null);
  const cur = fund.currency;
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const d = live.data;
  const q = d.quarter;
  const quarterOpen = q !== null && q.status === 'open';
  const drafts = d.totals.drafts;
  const openQuarter = (): void => void act([], () => op('quarters.open', { fund: fund.id }), ['quarters', 'agent_requests']);
  // The quarter's marks: Ask your AI agent (one request for the whole quarter: trigger mark_notes), then its state, followed live.
  const markAsk = q?.agent?.mark_notes;
  const agentState =
    quarterOpen && q !== null && can(me, 'funds', 'edit') && d.holdings.length > 0 && (drafts < d.holdings.length || markAsk !== undefined) ? (
      <AskAgent label="Ask your AI agent for marks" title="Drafts a calibrated mark for each holding without one, in one request." state={markAsk} onAsk={askWith('mark_notes', q.id)} reads={['marks', 'quarters', 'agent_requests']} />
    ) : quarterOpen && markAsk !== undefined ? (
      <AskStatus state={markAsk} />
    ) : null;
  const action =
    approver && quarterOpen && drafts > 0 ? (
      <span className="flex items-center gap-2">
        {agentState}
        <Button size="sm" icon={Check} onClick={() => void act([], () => op('marks.approve', { quarter: q.id }), ['marks', 'quarters'])}>
          Approve all
        </Button>
      </span>
    ) : agentState !== null ? (
      agentState
    ) : !quarterOpen && can(me, 'funds', 'edit') && d.holdings.length > 0 ? (
      <Button size="sm" onClick={openQuarter}>
        Open quarter
      </Button>
    ) : undefined;
  return (
    <>
      <Panel
        flush
        label={q !== null ? q.label : undefined}
        aside={
          d.hidden > 0 ? (
            <span className="flex items-center gap-2">
              <HiddenHoldings n={d.hidden} />
              {action}
            </span>
          ) : (
            action
          )
        }
      >
        <DataTable<Row>
          label="Marks"
          rows={d.holdings}
          rowKey={(r) => r.holding}
          onRowClick={(r) => (r.quarter_mark !== null ? setOpen(r) : undefined)}
          stickyTop={0}
          initialSort={{ key: 'value', dir: 'desc' }}
          empty={<Empty icon={Scale} title="No holdings yet" />}
          columns={[
            {
              key: 'name',
              label: 'Holding',
              width: 'minmax(180px,2fr)',
              fixed: true,
              phone: 'title',
              sort: (r) => r.name,
              render: (r) => (
                <span className="flex min-w-0 items-center gap-2">
                  <Avatar name={r.name} size={22} square />
                  <span className="vo-wrap min-w-0 truncate">{r.name}</span>
                  {r.quarter_mark !== null && r.quarter_mark.status === 'draft' && r.quarter_mark.actor === 'agent' && <AgentTag />}
                </span>
              ),
            },
            { key: 'method', label: 'Method', width: '120px', phone: 'sub', render: (r) => <MethodTag method={r.quarter_mark !== null ? r.quarter_mark.method : r.method} /> },
            { key: 'value', label: 'Value', align: 'right', mono: true, phone: 'end', sort: (r) => (r.quarter_mark !== null ? r.quarter_mark.value_minor : r.value_minor), render: (r) => money(r.quarter_mark !== null ? r.quarter_mark.value_minor : r.value_minor, cur, { compact: true, bare: true }) },
            { key: 'change', label: 'Change', align: 'right', mono: true, phone: 'hide', sort: (r) => (r.quarter_mark !== null ? r.quarter_mark.change_minor : 0), render: (r) => (r.quarter_mark !== null ? <Change minor={r.quarter_mark.change_minor} currency={cur} /> : '') },
            { key: 'cost', label: 'Cost', align: 'right', mono: true, optional: true, sort: (r) => r.cost_minor, render: (r) => money(r.cost_minor, cur, { compact: true, bare: true }) },
          ]}
        />
      </Panel>
      {open !== null && <MarkSheet row={open} currency={cur} onClose={() => setOpen(null)} />}
    </>
  );
}
