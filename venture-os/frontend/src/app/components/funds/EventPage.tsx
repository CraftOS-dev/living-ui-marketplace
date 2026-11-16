/**
 * One call or distribution: its steps (Draft, Preview, Issued, Paid), the
 * paid bar filling as payments are recorded, and every LP's line with its
 * own bar, delivery, notice and Record received.
 */
import { useState } from 'react';
import { Ban, Check, FileText, Mail } from 'lucide-react';
import { Button, DataTable, FigureStrip, IconButton, LoadError, Menu, MenuItem, PageBody, PageHeader, Panel, Skeleton, StatusDot, StepTrack, Tag } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import { download, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, money, pct } from '../../lib/format.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { FUND_READS, PaidBar } from './common.tsx';
import { CallSheet, LinesTable, ReviewNote } from './CallSheet.tsx';
import type { CapitalEvent, EventLine, FundDash } from './types.ts';

const SENT: Record<string, { label: string; tone: 'good' | 'neutral' | 'bad' | 'faint' | 'warn' }> = {
  sent: { label: 'Sent', tone: 'good' },
  approved: { label: 'Sending', tone: 'neutral' },
  sending: { label: 'Sending', tone: 'neutral' },
  failed: { label: 'Not sent', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'faint' },
  no_email: { label: 'No email', tone: 'warn' },
};

export function EventPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const fundId = params['fund'] ?? '';
  const live = useOp<{ event: CapitalEvent }>('calls.get', { event: params['event'] ?? '' }, FUND_READS.concat(['outbound']), { name: 'calls.get' });
  const fund = useOp<FundDash>('funds.get', { fund: fundId }, ['entities'], { name: 'funds.get' });
  const [editing, setEditing] = useState(false);
  const e = live.data?.event;
  const back = `#/funds/${fundId}?tab=capital`;
  if (e === undefined) {
    return (
      <>
        <PageHeader title="Notice" back={back} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-80" />}</PageBody>
      </>
    );
  }
  const cur = e.currency;
  const call = e.kind === 'call';
  const issued = e.status === 'issued' || e.status === 'settled';
  const edit = can(me, 'funds', 'edit');
  const full = can(me, 'funds', 'full');
  const record = (l: EventLine): void => {
    void act([patch(l.id, { paid_minor: l.total_minor, left_minor: 0, paid_ppm: 1000000 })], () => op('payments.record', { line: l.id }), ['payments', 'capital_events']);
  };
  return (
    <>
      <PageHeader title={e.number} back={back}>
        {full && e.status !== 'void' && (
          <Menu label="More">
            {(close) => (
              <MenuItem icon={Ban} danger onClick={() => (close(), void act([], () => op('calls.void', { event: e.id }), ['capital_events', 'ledger']))}>
                Void
              </MenuItem>
            )}
          </Menu>
        )}
        {edit && (e.status === 'draft' || e.status === 'previewed') && fund.data !== null && (
          <Button variant="primary" onClick={() => setEditing(true)}>
            {e.status === 'previewed' && full ? (call ? 'Issue call' : 'Issue') : 'Continue'}
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <Panel>
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex min-w-0 items-center gap-3">
              <Tag tone={call ? 'a' : 'b'}>{call ? 'Call' : 'Distribution'}</Tag>
              {e.status === 'void' && <Tag tone="bad">Void</Tag>}
              <StepTrack className="min-w-0 flex-1" labels={e.steps.labels} at={e.steps.done === true ? 4 : e.steps.at} />
            </div>
            <FigureStrip
              items={[
                { label: call ? 'Called' : 'Distributed', value: money(e.preview?.totals['total_minor'] ?? e.total_minor, cur, { compact: true }) },
                { label: call ? 'Due' : 'Paid on', value: fmtDay(e.due_day, { year: 'auto' }) },
                ...(issued ? [{ label: 'Paid', value: e.paid_ppm !== null ? pct(e.paid_ppm, 0) : null }] : []),
              ]}
            />
            {issued && <Meter value={e.paid_minor} max={(e.preview?.totals['total_minor'] ?? e.total_minor) || 1} label="Paid" tone={e.status === 'settled' ? 'good' : 'ink'} height={8} />}
          </div>
        </Panel>
        {!issued && e.preview !== undefined && e.preview.lines.length > 0 && (
          <>
            <div className="vo-panel vo-in min-w-0 overflow-hidden">
              <LinesTable lines={e.preview.lines} totals={e.preview.totals} currency={cur} kind={e.kind} />
            </div>
            <ReviewNote e={e} />
          </>
        )}
        {issued && e.lines !== undefined && (
          <Panel flush>
            <DataTable<EventLine>
              label="Lines"
              rows={e.lines}
              rowKey={(r) => r.id}
              stickyTop={0}
              columns={[
                { key: 'lp', label: 'LP', width: 'minmax(170px,2fr)', fixed: true, phone: 'title', render: (r) => <a className="vo-wrap hover:underline" href={'#/funds/lps/' + r.lp}>{r.lp_name}</a> },
                { key: 'amount', label: 'Amount', align: 'right', mono: true, phone: 'end', sort: (r) => r.total_minor, render: (r) => money(r.total_minor, cur, { bare: true }) },
                { key: 'paid', label: 'Paid', width: 'minmax(140px,1.4fr)', phone: 'sub', render: (r) => <PaidBar paid={r.paid_minor} total={r.total_minor} /> },
                { key: 'sent', label: 'Notice', width: '110px', phone: 'hide', render: (r) => (SENT[r.sent] ? <StatusDot tone={SENT[r.sent]?.tone ?? 'neutral'} label={SENT[r.sent]?.label} /> : '') },
                {
                  key: 'act',
                  label: '',
                  width: '84px',
                  align: 'right',
                  phone: 'end',
                  render: (r) => (
                    <span className="flex justify-end gap-0.5">
                      {r.has_notice && <IconButton icon={FileText} label="Open notice" onRow size={28} onClick={() => void download('calls.notice', { line: r.id }, 'open', e.number + '.pdf')} />}
                      {edit && r.left_minor > 0 && <IconButton icon={Check} label={call ? 'Record received' : 'Record paid'} onRow size={28} onClick={() => record(r)} />}
                    </span>
                  ),
                },
              ]}
            />
          </Panel>
        )}
        {issued && (e.no_email ?? []).length > 0 && (
          <div className="flex items-center gap-2 text-[13px] text-[var(--vo-warn)]">
            <Mail size={14} aria-hidden />
            {(e.no_email ?? []).join(', ')}
          </div>
        )}
      </PageBody>
      {editing && fund.data !== null && <CallSheet fund={fund.data.fund} kind={e.kind} event={e} onClose={() => setEditing(false)} />}
    </>
  );
}
