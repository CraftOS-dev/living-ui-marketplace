/**
 * Reports: each quarter close as a StepTrack (Open, Marks, Frozen, Letter,
 * Sent) with its one next step as the button; the letter editor shows your
 * AI agent's paragraphs with the Sparkle to keep, change or remove; packs
 * go out with Send packs.
 */
import { useEffect, useState } from 'react';
import { CalendarCheck, FileText, Plus, Send, Snowflake, Stamp, Trash2 } from 'lucide-react';
import { AgentMark, AgentTag, Button, DataTable, Empty, FigureStrip, IconButton, LoadError, Panel, Skeleton, StatusDot, StepTrack, Textarea } from '../ui.tsx';
import { download, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { fmtQuarter } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { FUND_READS, mult, rate } from './common.tsx';
import { useApprover } from './MarksTab.tsx';
import type { FundView, Paragraph, Quarter, QuarterDetail } from './types.ts';
import { AskAgent, AskStatus, askWith } from '../agent.tsx';

function Letter({ d }: { d: QuarterDetail }): React.JSX.Element {
  const approver = useApprover();
  const paras = d.letter?.paragraphs ?? [];
  const [draft, setDraft] = useState<Paragraph[]>(paras);
  const key = paras.map((p) => p.id + p.text.length + p.state).join('|');
  useEffect(() => setDraft(paras), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = JSON.stringify(draft.map((p) => [p.id, p.text])) !== JSON.stringify(paras.map((p) => [p.id, p.text])) || draft.some((p) => p.state === 'proposed') !== paras.some((p) => p.state === 'proposed');
  const save = (): void => void act([], () => op('reports.letter-save', { quarter: d.quarter.id, paragraphs: JSON.stringify(draft.filter((p) => p.text.trim() !== '').map((p) => ({ id: p.id, text: p.text }))) }), ['reports']);
  if (paras.length === 0 && draft.length === 0) {
    const letterAsk = d.quarter.agent?.lp_letter;
    return (
      <Empty
        icon={FileText}
        title="No letter yet"
        action={
          approver ? (
            <span className="flex flex-wrap items-center justify-center gap-2">
              {d.quarter.status === 'frozen' && <AskAgent label="Ask your AI agent to draft it" size="md" state={letterAsk} onAsk={askWith('lp_letter', d.quarter.id)} reads={['reports', 'quarters', 'agent_requests']} />}
              <Button icon={Plus} onClick={() => setDraft([{ id: 'n' + Date.now(), text: '', by: 'person', state: 'kept' }])}>
                Write
              </Button>
            </span>
          ) : letterAsk !== undefined ? (
            <AskStatus state={letterAsk} />
          ) : undefined
        }
      />
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-2">
      {draft.map((p, i) => (
        <div key={p.id} className="group flex min-w-0 items-start gap-2">
          <span className="mt-2 w-4 shrink-0">{p.by === 'agent' && p.state === 'proposed' && <AgentTag />}</span>
          <Textarea className="min-w-0 flex-1" minRows={2} value={p.text} disabled={!approver} aria-label={'Paragraph ' + (i + 1)} onChange={(e) => setDraft(draft.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} />
          {approver && <IconButton icon={Trash2} label="Remove" size={28} onClick={() => setDraft(draft.filter((_, j) => j !== i))} />}
        </div>
      ))}
      {approver && (
        <div className="flex items-center gap-2 pl-6">
          <Button size="sm" icon={Plus} onClick={() => setDraft([...draft, { id: 'n' + Date.now(), text: '', by: 'person', state: 'kept' }])}>
            Paragraph
          </Button>
          {(dirty || draft.some((p) => p.state === 'proposed')) && (
            <Button size="sm" onClick={save}>
              Keep
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function QuarterPanel({ fund, id }: { fund: FundView; id: string }): React.JSX.Element {
  const me = useMe();
  const approver = useApprover();
  const live = useOp<QuarterDetail>('quarters.get', { quarter: id }, FUND_READS, { name: 'quarters.get' });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const d = live.data;
  const q = d.quarter;
  const full = can(me, 'funds', 'full');
  const edit = can(me, 'funds', 'edit');
  let action: React.JSX.Element | null = null;
  if (q.status === 'open' && full && d.marks.draft === 0)
    action = (
      <Button variant="primary" size="sm" icon={Snowflake} onClick={() => void act([], () => op('quarters.freeze', { quarter: q.id }), ['quarters', 'nav', 'reports'])}>
        Freeze
      </Button>
    );
  else if (q.status === 'open' && d.marks.draft > 0)
    action = (
      <Button size="sm" onClick={() => setQuery({ tab: 'marks', quarter: null })}>
        Approve marks
      </Button>
    );
  else if (q.status === 'frozen' && approver && (d.letter?.paragraphs.length ?? 0) > 0)
    action = (
      <Button variant="primary" size="sm" icon={Stamp} onClick={() => void act([], () => op('reports.finalize', { quarter: q.id }), ['quarters', 'reports'])}>
        Finalize
      </Button>
    );
  else if (q.status === 'final' && edit && d.packs.some((p) => p.outbound === '' || p.status === 'failed'))
    action = (
      <Button variant="primary" size="sm" icon={Send} onClick={() => void act([], () => op('reports.send', { quarter: q.id }), ['reports', 'outbound'])}>
        Send packs
      </Button>
    );
  const m = d.metrics;
  return (
    <Panel label={q.label} aside={action}>
      <div className="flex min-w-0 flex-col gap-5">
        <StepTrack labels={q.steps.labels} at={q.steps.done === true ? 5 : q.steps.at} />
        {m !== null && (
          <FigureStrip
            items={[
              { label: 'TVPI', value: mult(m.tvpi_e8) },
              { label: 'Net IRR', value: rate(m.net_irr_ppm) },
              { label: 'Gross MOIC', value: mult(m.gross_moic_e8) },
              { label: 'Gross IRR', value: rate(m.gross_irr_ppm) },
            ]}
          />
        )}
        {q.status === 'frozen' && <Letter d={d} />}
        {(q.status === 'final' || q.status === 'sent') && d.packs.length > 0 && (
          <DataTable<QuarterDetail['packs'][number]>
            label="Packs"
            rows={d.packs}
            rowKey={(r) => r.id}
            stickyTop={0}
            columns={[
              { key: 'lp', label: 'LP', fixed: true, phone: 'title', render: (r) => r.lp_name },
              { key: 'status', label: 'Status', width: '120px', phone: 'end', render: (r) => <StatusDot tone={r.status === 'sent' ? 'good' : r.status === 'failed' ? 'bad' : r.outbound !== '' ? 'neutral' : 'faint'} label={r.status === 'sent' ? 'Sent' : r.status === 'failed' ? 'Not sent' : r.outbound !== '' ? 'Sending' : 'Ready'} /> },
              { key: 'open', label: '', width: '48px', align: 'right', render: (r) => <IconButton icon={FileText} label="Open pack" size={28} onRow onClick={() => void download('reports.pack', { report: r.id }, 'open', 'pack.pdf')} /> },
            ]}
          />
        )}
      </div>
    </Panel>
  );
}

export function ReportsTab({ fund, nextEnd, quarterId }: { fund: FundView; nextEnd: string; quarterId: string }): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ quarters: Quarter[]; next_period_end: string }>('quarters.list', { fund: fund.id }, FUND_READS, { name: 'quarters.list' });
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-60" />;
  const qs = live.data.quarters;
  const sel = quarterId !== '' && qs.some((q) => q.id === quarterId) ? quarterId : (qs[0]?.id ?? '');
  const canOpen = can(me, 'funds', 'edit') && !qs.some((q) => q.period_end === nextEnd);
  const openQ = (): void => void act([], () => op('quarters.open', { fund: fund.id, period_end: nextEnd }), ['quarters', 'agent_requests']);
  if (qs.length === 0) return <Empty icon={CalendarCheck} title="No quarter closed yet" action={canOpen ? <Button icon={Plus} onClick={openQ}>{'Open ' + fmtQuarter(nextEnd)}</Button> : undefined} />;
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
      <Panel flush aside={canOpen ? <Button size="sm" icon={Plus} onClick={openQ}>{'Open ' + fmtQuarter(nextEnd)}</Button> : undefined}>
        <DataTable<Quarter>
          label="Quarters"
          rows={qs}
          rowKey={(r) => r.id}
          onRowClick={(r) => setQuery({ quarter: r.id })}
          stickyTop={0}
          columns={[
            { key: 'label', label: 'Quarter', width: '90px', fixed: true, phone: 'title', render: (r) => <span className={r.id === sel ? 'font-semibold' : ''}>{r.label}</span> },
            { key: 'steps', label: 'Close', width: 'minmax(140px,1fr)', phone: 'sub', render: (r) => <StepTrack compact className="w-full max-w-[180px]" labels={r.steps.labels} at={r.steps.done === true ? 5 : r.steps.at} /> },
          ]}
        />
      </Panel>
      {sel !== '' && <QuarterPanel key={sel} fund={fund} id={sel} />}
    </div>
  );
}
