/**
 * One LP: per fund its capital account as figures, a small chart of what it
 * contributed and received over time, and its notices with their paid bars.
 */
import { useState } from 'react';
import { MessageCircleQuestion, Pencil } from 'lucide-react';
import { Button, DataTable, Dialog, FigureStrip, LoadError, Menu, MenuItem, PageBody, PageHeader, Panel, Skeleton, Tag, Textarea } from '../ui.tsx';
import { LineChart } from '../charts.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, money } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { FUND_READS, PaidBar, major, shortQ } from './common.tsx';
import { LpSheet } from './LpsTab.tsx';
import type { Account } from './types.ts';

interface LpFund {
  fund: { id: string; name: string; short_name: string; currency: string };
  commitment: { id: string; status: string; amount_minor: number; fee_paying: boolean; fee_override: boolean; fee_rate_ppm: number; waiver_ppm: number; side_letter: string[]; closing_day: string };
  account: Account;
  nav_share_minor: number;
  series: { quarter: string; contributed_minor: number; distributed_minor: number }[];
  lines: { id: string; event: string; number: string; kind: string; status: string; notice_day: string; total_minor: number; paid: number }[];
}

interface LpDetail {
  lp: { id: string; name: string; kind: string; contacts: { name: string; email: string }[]; country: string; tax_id: string };
  funds: LpFund[];
}

function FundBlock({ f }: { f: LpFund }): React.JSX.Element {
  const cur = f.fund.currency;
  const a = f.account;
  const c = (v: number): string => money(v, cur, { compact: true });
  return (
    <Panel label={f.fund.short_name || f.fund.name} aside={f.commitment.status === 'soft' ? <Tag tone="warn">Soft</Tag> : undefined}>
      <div className="flex min-w-0 flex-col gap-5">
        <FigureStrip
          items={[
            { label: 'Commitment', value: c(a.commitment_minor) },
            { label: 'Called', value: c(a.contributed_minor) },
            { label: 'Distributed', value: c(a.distributed_minor) },
            { label: 'Unfunded', value: c(a.unfunded_minor) },
            { label: 'NAV share', value: c(f.nav_share_minor), tip: 'An estimate: pro rata of signed commitments.' },
          ]}
        />
        {f.series.length > 1 && (
          <LineChart
            label="Contributed and distributed"
            height={140}
            labels={f.series.map((s) => shortQ(s.quarter))}
            series={[
              { key: 'c', label: 'Contributed', values: f.series.map((s) => major(s.contributed_minor, cur)), tone: 'a' },
              { key: 'd', label: 'Distributed', values: f.series.map((s) => major(s.distributed_minor, cur)), tone: 'b' },
            ]}
            format={(v) => money(Math.round(v * 100), cur, { compact: true })}
            yFormat={(v) => money(Math.round(v * 100), cur, { compact: true, bare: true })}
          />
        )}
        {f.lines.length > 0 && (
          <DataTable<LpFund['lines'][number]>
            label="Notices"
            rows={f.lines}
            rowKey={(r) => r.id}
            rowHref={(r) => `#/funds/${f.fund.id}/events/${r.event}`}
            stickyTop={0}
            columns={[
              { key: 'n', label: 'Notice', width: '100px', fixed: true, phone: 'title', render: (r) => <span className="vo-mono">{r.number}</span> },
              { key: 'd', label: 'Day', mono: true, phone: 'sub', render: (r) => fmtDay(r.notice_day) },
              { key: 'a', label: 'Amount', align: 'right', mono: true, phone: 'end', render: (r) => money(r.total_minor, cur, { bare: true }) },
              { key: 'p', label: 'Paid', width: 'minmax(120px,1fr)', phone: 'hide', render: (r) => (r.status === 'void' ? <Tag tone="faint">Void</Tag> : <PaidBar paid={r.paid} total={r.total_minor} />) },
            ]}
          />
        )}
      </div>
    </Panel>
  );
}

export function LpPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<LpDetail>('lps.get', { lp: params['id'] ?? '' }, FUND_READS, { name: 'lps.get' });
  const [editing, setEditing] = useState<LpFund | null>(null);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const d = live.data;
  if (d === null) {
    return (
      <>
        <PageHeader title="LP" back="#/funds?tab=lps" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-80" />}</PageBody>
      </>
    );
  }
  const edit = can(me, 'lps', 'edit');
  const first = d.funds[0];
  return (
    <>
      <PageHeader title={d.lp.name} back="#/funds?tab=lps">
        {edit && (
          <Menu label="More">
            {(close) => (
              <MenuItem icon={MessageCircleQuestion} onClick={() => (close(), setAsking(true))}>
                Log a question
              </MenuItem>
            )}
          </Menu>
        )}
        {edit && first !== undefined && (
          <Button icon={Pencil} onClick={() => setEditing(first)}>
            Edit
          </Button>
        )}
      </PageHeader>
      <PageBody>
        {d.funds.map((f) => (
          <FundBlock key={f.fund.id} f={f} />
        ))}
      </PageBody>
      {editing !== null && (
        <LpSheet
          fund={editing.fund}
          lp={{ id: d.lp.id, name: d.lp.name, kind: d.lp.kind, email: d.lp.contacts[0]?.email ?? '', commitment_minor: editing.commitment.amount_minor, fee_paying: editing.commitment.fee_paying, fee_rate_ppm: editing.commitment.fee_override ? editing.commitment.fee_rate_ppm : null, waiver_ppm: editing.commitment.waiver_ppm || null, side_letter: editing.commitment.side_letter, closing_day: editing.commitment.closing_day }}
          onClose={() => setEditing(null)}
        />
      )}
      <Dialog
        open={asking}
        onClose={() => setAsking(false)}
        title="Question"
        footer={
          <>
            <Button onClick={() => setAsking(false)}>Cancel</Button>
            <Button variant="primary" disabled={question.trim() === ''} onClick={() => void act([], () => op('lpq.log', { lp: d.lp.id, question, fund: first?.fund.id }), ['lp_questions', 'agent_requests']).then((r) => r !== null && (setAsking(false), setQuestion('')))}>
              Ask your AI agent
            </Button>
          </>
        }
      >
        <Textarea minRows={4} value={question} onChange={(e) => setQuestion(e.target.value)} aria-label="Question" autoFocus />
      </Dialog>
    </>
  );
}
