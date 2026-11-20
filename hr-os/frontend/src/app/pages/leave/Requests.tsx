/**
 * Leave requests: the list (waiting first, the team's or everyone's), and
 * one request with its days, the checks it went past, the approval and what
 * the viewer can do (approve or reject in one tap, withdraw, cancel, come
 * back early, add a certificate).
 */
import { useEffect, useState } from 'react';
import { Check, Download, FileText, Paperclip, Sparkle, Undo2, X } from 'lucide-react';
import { Button, DataTable, Empty, Fact, FileDrop, LoadError, Loading, Notice, PageBody, PageHeader, Panel, PersonChip, SearchInput, StatusDot, Tabs, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { TypeLabel, TypeMark } from '../../components/leave/LeaveIcon.tsx';
import { download, op, opForm } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { act, changed, patch, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { amount, READS, STATUS_TONE, statusLabel, whenText } from './data.ts';
import type { Balance, LeaveRequest } from './types.ts';

type View = 'waiting' | 'upcoming' | 'all';

interface ApprovalLite {
  id: string;
  status: string;
  steps: { type: string }[];
  step: number;
  approvers: string[];
  history: { at: string; event: string; by: string; note?: string }[];
  decided_by_name: string;
  note: string;
}

export function RequestsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const view = (query.get('view') as View | null) ?? (query.get('status') === 'pending' ? 'waiting' : 'waiting');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(60);
  const scope = can(me, 'leave', 'view') ? 'all' : isManager(me) ? 'team' : 'mine';
  const params = { view: scope, status: view === 'waiting' ? 'pending,cancelling' : view === 'upcoming' ? 'approved,cancelling' : undefined, from: view === 'upcoming' ? me.today : undefined, sort: view === 'upcoming' ? 'start' : undefined, entity: entity === '' || scope !== 'all' ? undefined : entity, limit };
  const live = useOp<{ requests: LeaveRequest[]; total: number }>('leave.requests', params, READS, { name: 'leave.requests' });
  const rows = (live.data?.requests ?? []).filter((r) => q.trim() === '' || (r.name + ' ' + r.number + ' ' + r.type_name).toLowerCase().includes(q.trim().toLowerCase()));
  const columns: Column<LeaveRequest>[] = [
    { key: 'person', label: t('leave.col.person'), width: 'minmax(170px,1.4fr)', sort: (r) => r.name, phone: 'title', render: (r) => <PersonChip name={r.name} sub={r.number} size={24} /> },
    { key: 'type', label: t('leave.type'), width: 'minmax(140px,1.2fr)', sort: (r) => r.type_name, render: (r) => <TypeLabel name={r.type_name} icon={r.icon} color={r.color} /> },
    { key: 'when', label: t('leave.col.when'), width: 'minmax(170px,1.5fr)', sort: (r) => r.start, render: (r) => whenText(r) },
    { key: 'days', label: t('leave.col.days'), width: '90px', align: 'right', mono: true, sort: (r) => r.amount, render: (r) => amount(r.amount, r.unit) },
    { key: 'asked', label: t('leave.col.asked'), width: '110px', hideBelow: 'lg', sort: (r) => r.created, render: (r) => <span className="text-[12px] text-[var(--hr-muted)]">{r.actor === 'agent' && <Sparkle size={11} aria-hidden className="mr-1 inline" />}{ago(r.created)}</span> },
    { key: 'status', label: t('leave.col.status'), width: '120px', sort: (r) => r.status, phone: 'end', render: (r) => <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} /> },
  ];
  return (
    <>
      <PageHeader title={t('leave.requests')} meta={live.data !== null ? t('leave.requests_n', { n: live.data.total }) : ''}>
        <SearchInput value={q} onChange={setQ} placeholder={t('leave.search_people')} className="w-full sm:w-[220px]" />
      </PageHeader>
      <PageBody>
        <Tabs
          value={view}
          onChange={(v) => setQuery({ view: v, status: undefined })}
          label={t('leave.requests')}
          className="mb-3"
          tabs={[
            { value: 'waiting', label: t('leave.view.waiting') },
            { value: 'upcoming', label: t('leave.view.upcoming') },
            { value: 'all', label: t('leave.view.all') },
          ]}
        />
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : live.data === null ? (
          <Loading />
        ) : (
          <div className="hr-panel hr-in min-w-0">
            <DataTable label={t('leave.requests')} columns={columns} rows={rows} rowKey={(r) => r.id} rowHref={(r) => `#/leave/requests/${r.id}`} hasMore={(live.data?.requests.length ?? 0) < (live.data?.total ?? 0)} onMore={() => setLimit((n) => n + 60)} empty={<Empty icon={Check} title={view === 'waiting' ? t('leave.nothing_waiting') : t('leave.no_requests')} />} />
          </div>
        )}
      </PageBody>
    </>
  );
}

export function RequestPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ request: LeaveRequest; approval: ApprovalLite | null; cancel_approval: ApprovalLite | null; balance: Balance | null; can: { withdraw: boolean; cancel: boolean; attach: boolean; started: boolean; decide: boolean } }>('leave.get', { request: params['id'] ?? '' }, READS, { name: 'leave.get' });
  const [note, setNote] = useState('');
  const [rejecting, setRejecting] = useState(false);
  useEffect(() => {
    setRejecting(false);
    setNote('');
  }, [params]);
  const d = live.data;
  if (live.error !== null)
    return (
      <>
        <PageHeader title={t('leave.request_title')} back="#/leave" />
        <PageBody>
          <LoadError message={live.error} onRetry={live.reload} />
        </PageBody>
      </>
    );
  if (d === null)
    return (
      <>
        <PageHeader title={t('leave.request_title')} back="#/leave" />
        <PageBody>
          <Loading />
        </PageBody>
      </>
    );
  const r = d.request;
  const pendingApproval = d.cancel_approval !== null && d.cancel_approval.status === 'pending' ? d.cancel_approval : d.approval !== null && d.approval.status === 'pending' ? d.approval : null;
  const decide = (decision: 'approved' | 'rejected'): void => {
    if (pendingApproval === null) return;
    void act([patch(r.id, { status: decision === 'approved' ? (r.status === 'cancelling' ? 'cancelled' : 'approved') : r.status === 'cancelling' ? 'approved' : 'rejected' })], () => op('approvals.decide', { approval: pendingApproval.id, decision, note: note.trim() === '' ? undefined : note.trim() }), READS).then((x) => x !== null && toast.success(decision === 'approved' ? t('leave.decided.approved') : t('leave.decided.rejected')));
  };
  const withdraw = (): void => void act([patch(r.id, { status: 'withdrawn' })], () => op('leave.withdraw', { request: r.id }), READS).then((x) => x !== null && toast.success(t('leave.withdrawn')));
  const cancel = async (from?: string): Promise<void> => {
    const ok = await confirmAsk(d.can.started ? t('leave.cancel_started_text') : t('leave.cancel_text', { when: whenText(r) }), from !== undefined ? t('leave.back_early') : t('leave.cancel'), t('leave.cancel_ok'));
    if (!ok) return;
    const res = await act([], () => op<{ cancelled: boolean }>('leave.cancel', { request: r.id, from }), READS);
    if (res !== null) toast.success(res.cancelled ? t('leave.cancelled_done') : t('leave.cancel_sent'));
  };
  const attach = async (files: File[]): Promise<void> => {
    const f = files[0];
    if (f === undefined) return;
    try {
      await opForm('leave.attach', { request: r.id }, { attachment: f });
      changed(...READS);
      toast.success(t('leave.attached'));
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={r.name} meta={`${r.number} · ${r.type_name}`} back={can(me, 'leave', 'view') || isManager(me) ? '#/leave/requests' : '#/leave'}>
        <StatusDot tone={STATUS_TONE[r.status]} label={statusLabel(r.status)} />
      </PageHeader>
      <PageBody>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex flex-col gap-3 lg:col-span-7">
            <Panel index="01" label={t('leave.request_title')}>
              <div className="flex items-start gap-3 pt-1">
                <TypeMark icon={r.icon} color={r.color} size={36} />
                <div className="min-w-0 flex-1">
                  <div className="hr-wrap text-[15px] font-semibold leading-6">{whenText(r)}</div>
                  <div className="text-[13px] text-[var(--hr-muted)]">{amount(r.amount, r.unit)} · {r.paid ? t('leave.paid') : t('leave.unpaid')}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
                <Fact label={t('leave.col.asked')}>{ago(r.created)}{r.actor === 'agent' ? ` · ${t('ui.agent_short')}` : ''}</Fact>
                {d.balance !== null && d.balance.tracked && <Fact label={t('leave.available')} mono>{amount(d.balance.available, d.balance.unit)}</Fact>}
                {r.recorded && <Fact label={t('leave.recorded')}>{r.decided_note}</Fact>}
              </div>
              {r.reason !== '' && <p className="hr-wrap mt-3 border-l-2 border-[var(--hr-line-2)] pl-2.5 text-[13px] leading-5 text-[var(--hr-ink-2)]">{r.reason}</p>}
              {r.warnings.filter((w) => w.code !== 'clash').map((w) => (
                <Notice key={w.code + w.message} tone={w.overridden === true ? 'warn' : 'neutral'} className="mt-2">
                  {w.overridden === true ? t('leave.went_past', { what: w.message }) : w.message}
                </Notice>
              ))}
              {r.cancel_from !== '' && r.status !== 'cancelled' && <Notice tone="warn" className="mt-2">{r.status === 'cancelling' ? t('leave.cancel_waiting', { day: fmtDay(r.cancel_from) }) : t('leave.shortened', { day: fmtDay(r.cancel_from) })}</Notice>}
              {r.decided_note !== '' && !r.recorded && <p className="hr-wrap mt-3 text-[13px] text-[var(--hr-muted)]">{t('leave.decision_note', { note: r.decided_note })}</p>}
            </Panel>
            {(r.day_list ?? []).length > 1 && (
              <Panel index="02" label={t('leave.days_taken')} flush>
                <ul className="grid grid-cols-2 sm:grid-cols-4">
                  {(r.day_list ?? []).map((x) => (
                    <li key={x.day} className="flex items-center justify-between gap-2 border-b border-r border-[var(--hr-hair)] px-3 py-1.5 text-[12px]">
                      <span>{fmtDay(x.day, { weekday: true })}</span>
                      <span className="hr-mono hr-num text-[var(--hr-muted)]">{x.half !== '' ? t(`leave.half.${x.half}`) : x.hours > 0 ? `${x.hours}h` : x.amount}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
          <div className="flex flex-col gap-3 lg:col-span-5">
            {d.can.decide && pendingApproval !== null && (
              <Panel index="03" label={r.status === 'cancelling' ? t('leave.decide_cancel') : t('leave.decide')}>
                {rejecting && <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} placeholder={t('inbox.reason_ph')} aria-label={t('inbox.reason')} className="mb-2" autoFocus />}
                <div className="flex flex-wrap justify-end gap-2">
                  {rejecting ? (
                    <>
                      <Button variant="ghost" onClick={() => setRejecting(false)}>{t('ui.cancel')}</Button>
                      <Button variant="danger" icon={X} onClick={() => decide('rejected')}>{t('inbox.reject')}</Button>
                    </>
                  ) : (
                    <>
                      <Button icon={X} onClick={() => setRejecting(true)}>{t('inbox.reject')}</Button>
                      <Button variant="primary" icon={Check} onClick={() => decide('approved')}>{t('inbox.approve')}</Button>
                    </>
                  )}
                </div>
              </Panel>
            )}
            {(d.can.withdraw || d.can.cancel || d.can.attach || r.has_attachment) && (
              <Panel index="04" label={t('leave.actions')}>
                <div className="flex flex-col gap-2">
                  {d.can.withdraw && <Button icon={X} onClick={withdraw}>{t('leave.withdraw')}</Button>}
                  {d.can.cancel && r.end >= me.today && <Button icon={X} onClick={() => void cancel()}>{t('leave.cancel')}</Button>}
                  {d.can.cancel && d.can.started && r.end > me.today && <Button icon={Undo2} onClick={() => void cancel(me.today)}>{t('leave.back_early')}</Button>}
                  {r.has_attachment && <Button icon={FileText} onClick={() => void download('leave.attachment', { request: r.id }, 'open')}>{t('leave.open_certificate')}</Button>}
                  {d.can.attach && <FileDrop onFiles={(f) => void attach(f)} accept="image/*,application/pdf" label={r.has_attachment ? t('leave.replace_certificate') : t('leave.form.add_certificate')} />}
                </div>
              </Panel>
            )}
            {d.approval !== null && (
              <Panel index="05" label={t('leave.approval')}>
                <ul className="flex flex-col gap-1.5">
                  {[...(d.approval.history ?? []), ...(d.cancel_approval?.history ?? [])].map((h, i) => (
                    <li key={i} className="flex items-start gap-2 text-[13px]">
                      <span className="hr-mono w-20 shrink-0 text-[12px] text-[var(--hr-muted)]">{ago(h.at)}</span>
                      <span className="hr-wrap min-w-0 flex-1">
                        {t(`leave.history.${h.event}`)}
                        {h.note !== undefined && h.note !== '' ? `: ${h.note}` : ''}
                      </span>
                    </li>
                  ))}
                </ul>
                {d.approval.status === 'pending' && <Tag tone="warn" className="mt-2">{t('leave.waiting_for', { step: d.approval.step + 1, of: d.approval.steps.length })}</Tag>}
              </Panel>
            )}
            {r.has_attachment === false && r.warnings.some((w) => w.code === 'attachment') && (
              <Notice tone="warn">
                <Paperclip size={12} aria-hidden className="mr-1 inline" />
                {t('leave.needs_certificate')}
              </Notice>
            )}
            {r.has_attachment && (
              <Button variant="ghost" icon={Download} onClick={() => void download('leave.attachment', { request: r.id, download: true }, 'save', 'certificate')}>
                {t('leave.save_certificate')}
              </Button>
            )}
          </div>
        </div>
      </PageBody>
    </>
  );
}
