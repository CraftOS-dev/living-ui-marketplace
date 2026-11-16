/**
 * Pieces of the Me pages: what I must acknowledge, my requests across the
 * modules with their status, the answers from your AI agent, and the
 * "New request" menu that opens each module's own form.
 */
import { CalendarPlus, ChevronRight, Clock, FileCheck2, HandCoins, Plus, Receipt, Repeat, Send, Sparkle } from 'lucide-react';
import { Button, Empty, Menu, MenuItem, Money, Panel, RowCue, Skeleton, StatusDot, Tag } from '../../components/ui.tsx';
import type { Tone } from '../../components/ui.tsx';
import { AskBox } from '../../components/shell/AgentPanel.tsx';
import { AgentAskStatus } from '../../components/agent.tsx';
import type { Group } from '../../components/home/parts.tsx';
import { op } from '../../lib/api.ts';
import { ago, fmtStampDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { kindLabel } from '../../lib/kinds.ts';
import { act, drop } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { MeHomeData } from '../../components/home/types.ts';

export const ME_READS = ['documents', 'agent_questions', 'approvals', 'employments', 'job_records', 'employees', 'leave_requests', 'leave_ledger', 'checkins', 'attendance', 'goals', 'tasks'];

/** Documents I was asked to read, as a To do group with one-tap Acknowledge. */
export function documentGroup(docs: MeHomeData['documents']): Group[] {
  if (docs.length === 0) return [];
  return [
    {
      key: 'documents',
      label: t('me.need.documents'),
      icon: FileCheck2,
      tone: 'neutral',
      count: docs.length,
      link: '#/me/documents',
      rows: docs.map((d) => ({
        id: d.id,
        title: d.title,
        sub: d.category !== '' ? d.category : undefined,
        link: '#/me/documents',
        actions: [
          {
            label: t('me.acknowledge'),
            primary: true,
            run: () =>
              void act([drop(d.id)], () => op('documents.ack', { document: d.id }), ['documents']).then((r) => {
                if (r !== null) toast.success(t('me.acknowledged', { title: d.title }));
              }),
          },
        ],
      })),
    },
  ];
}

/* ------------------------------------------------------------- requests */

export interface RequestRow {
  id: string;
  kind: string;
  ref_collection: string;
  ref_id: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  summary: string;
  amount_minor: number;
  currency: string;
  created: string;
  decided_at: string;
  decided_by_name: string;
  note: string;
  steps: { label?: string | undefined }[];
  step: number;
}

/** Where a request opens, by the collection it was made on (each module's own page). */
const REF_ROUTE: Record<string, (id: string) => string> = {
  leave_requests: (id) => '#/leave/requests/' + id,
  leave_encash_requests: () => '#/leave/me',
  leave_comp_offs: () => '#/leave/me',
  attendance_requests: () => '#/time/requests',
  shift_requests: () => '#/time/requests',
  overtime_requests: () => '#/time/requests',
  timesheets: () => '#/time/timesheets',
  claims: (id) => '#/expenses/claims/' + id,
  advances: (id) => '#/expenses/advances/' + id,
  travel_requests: (id) => '#/expenses/travel/' + id,
  loans: () => '#/payroll/loans',
  tax_declarations: () => '#/payroll/declarations',
  comp_changes: () => '#/payroll',
  bank_accounts: () => '#/me/profile',
  separations: (id) => '#/lifecycle/separations/' + id,
  requisitions: () => '#/hiring/requisitions',
  offers: (id) => '#/hiring/offers/' + id,
};

export function requestLink(r: RequestRow): string {
  const f = REF_ROUTE[r.ref_collection];
  return f !== undefined ? f(r.ref_id) : '#/inbox?view=requests';
}

const STATUS_TONE: Record<RequestRow['status'], Tone> = { pending: 'warn', approved: 'good', rejected: 'bad', cancelled: 'faint' };

export function RequestStatus({ r }: { r: RequestRow }): React.JSX.Element {
  const waiting = r.status === 'pending' && r.steps.length > 1 ? t('me.req.step', { n: r.step + 1, of: r.steps.length }) : '';
  return <StatusDot tone={STATUS_TONE[r.status]} label={t('me.req.status.' + r.status) + (waiting !== '' ? ' · ' + waiting : '')} />;
}

export function RequestItem({ r }: { r: RequestRow }): React.JSX.Element {
  return (
    <li>
      <a href={requestLink(r)} className="hr-focus group flex min-w-0 items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 transition-colors hover:bg-[var(--hr-hover)]">
        <span className="min-w-0 flex-1">
          <span className="mb-0.5 flex items-center gap-1.5">
            <Tag>{kindLabel(r.kind)}</Tag>
            <span className="hr-label">{ago(r.created)}</span>
          </span>
          <span className="hr-wrap block text-[13px]">{r.summary}</span>
          {r.status !== 'pending' && r.note !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{r.note}</span>}
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <RequestStatus r={r} />
          {r.amount_minor !== 0 && r.currency !== '' && <Money minor={r.amount_minor} currency={r.currency} className="text-[12px]" />}
        </span>
        <RowCue />
      </a>
    </li>
  );
}

export function NewRequestMenu(): React.JSX.Element {
  return (
    <Menu icon={Plus} label={t('me.req.new')} width={240}>
      {(close) => (
        <>
          <MenuItem icon={CalendarPlus} onClick={() => (close(), navigate('/leave/me'))}>
            {t('me.req.leave')}
          </MenuItem>
          <MenuItem icon={Receipt} onClick={() => (close(), navigate('/expenses/mine'))}>
            {t('me.req.expense')}
          </MenuItem>
          <MenuItem icon={Clock} onClick={() => (close(), navigate('/time/requests'))}>
            {t('me.req.attendance')}
          </MenuItem>
          <MenuItem icon={Repeat} onClick={() => (close(), navigate('/time/schedule'))}>
            {t('me.req.shift')}
          </MenuItem>
          <MenuItem icon={HandCoins} onClick={() => (close(), navigate('/expenses/advances'))}>
            {t('me.req.advance')}
          </MenuItem>
        </>
      )}
    </Menu>
  );
}

/** My requests across every module (the kernel approvals I asked for), newest first; the first ones come with the page's read. */
export function RequestsPanel({ index, className, limit, data }: { index?: string | undefined; className?: string | undefined; limit: number; data: MeHomeData | null }): React.JSX.Element {
  const d = data !== null ? { approvals: data.requests.slice(0, limit), total: data.requests_total } : null;
  const pending = data?.requests_pending ?? 0;
  return (
    <Panel index={index} label={t('me.requests')} flush className={className} aside={<span className="flex items-center gap-2">{pending > 0 && <span className="hr-label">{t('me.req.waiting_n', { n: pending })}</span>}<NewRequestMenu /></span>}>
      {d === null ? (
        <div className="px-3.5 pb-3.5">
          <Skeleton className="h-16 w-full" />
        </div>
      ) : d.approvals.length === 0 ? (
        <Empty icon={Send} title={t('me.req.none')} className="py-6">
          {t('me.req.none_text')}
        </Empty>
      ) : (
        <>
          <ul className="border-t border-[var(--hr-hair)]">
            {d.approvals.map((r) => (
              <RequestItem key={r.id} r={r} />
            ))}
          </ul>
          {d.total > d.approvals.length && (
            <a href="#/me/requests" className="hr-focus hr-label hit flex items-center gap-0.5 px-3.5 py-2.5 hover:!text-[var(--hr-ink)]">
              {t('home.all_n', { n: d.total })}
              <ChevronRight size={12} strokeWidth={2} aria-hidden />
            </a>
          )}
        </>
      )}
    </Panel>
  );
}

/* ---------------------------------------------------------------- ask */

export function AskPanel({ index, answers, className, all }: { index?: string | undefined; answers: MeHomeData['answers'] | null; className?: string | undefined; all?: boolean | undefined }): React.JSX.Element {
  const list = answers === null ? null : all === true ? answers : answers.slice(0, 3);
  return (
    <Panel index={index} label={t('me.ask.title')} className={className} bodyClass="flex flex-col gap-3" aside={answers !== null && answers.length > 3 && all !== true ? <a href="#/me/ask" className="hr-label hover:text-[var(--hr-ink)]">{t('me.ask.all')}</a> : undefined}>
      <AskBox />
      {list === null ? (
        <Skeleton className="h-12 w-full" />
      ) : list.length === 0 ? (
        <p className="flex items-center gap-2 text-[12px] text-[var(--hr-muted)]">
          <Sparkle size={14} aria-hidden /> {t('me.ask.empty')}
        </p>
      ) : (
        <ul className="flex flex-col">
          {list.map((a) => (
            <li key={a.id} className="border-t border-[var(--hr-hair)] py-2.5 first:border-t-0">
              <div className="flex items-start gap-2">
                <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium">{a.question}</span>
                <span className="hr-label shrink-0">{fmtStampDay(a.created)}</span>
              </div>
              {a.answer !== '' ? (
                <p className="hr-wrap mt-1.5 whitespace-pre-wrap border-l-2 border-[var(--hr-agent)] pl-2.5 text-[13px] leading-5 text-[var(--hr-ink-2)]">{a.answer}</p>
              ) : a.status === 'cancelled' ? (
                <StatusDot tone="faint" label={t('agent.cancelled')} className="mt-1" />
              ) : (
                <AgentAskStatus ask={a.ask} reads={['agent_questions']} className="mt-1" />
              )}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
