/**
 * Separations: the list (waiting first), one separation (steps, details,
 * offboarding progress, assets to collect, the exit interview) and the
 * full and final statement (also printable). Managers see the kind and the
 * days; the reason, rehire and exit interview answers are HR's.
 */
import { useEffect, useState } from 'react';
import { Calculator, CheckCheck, LogOut, MoreHorizontal, Pencil, Plus, Printer, Undo2 } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Field, FactStrip, LoadError, Menu, MenuItem, Money, Notice, PageBody, PageHeader, Panel, Picker, Segmented, StatusDot, Stepper, Tag, Textarea, confirmAsk, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { panelNumbers, ProgressBar, SEPARATION_READS, SEPARATION_TONE, SkeletonRows } from '../../components/lifecycle/bits.tsx';
import { ReturnAssetDialog, SeparationDialog } from '../../components/lifecycle/dialogs.tsx';
import type { Asset, ExitQuestion, Separation, Settlement } from '../../components/lifecycle/types.ts';
import { errMessage, op } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtStampDay, relDay, today as officeToday } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { PrintHead, PrintTable } from '../print/index.tsx';

const REASONS = ['better_opportunity', 'compensation', 'career_change', 'relocation', 'personal', 'health', 'study', 'performance', 'conduct', 'redundancy', 'restructuring', 'probation', 'contract_end', 'retirement', 'death', 'other'];

/* ----------------------------------------------------------------- list */

export function SeparationsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'people', 'edit');
  const manager = isManager(me);
  const status = (['open', 'completed', 'all'] as const).find((s) => s === query.get('status')) ?? 'open';
  const [limit, setLimit] = useState(50);
  const [dialog, setDialog] = useState<'record' | 'self' | null>(null);
  const live = useOp<{ separations: Separation[]; total: number }>('separations.list', { status, limit }, SEPARATION_READS, { name: 'lifecycle.separations' });
  const d = live.data;
  const mine = d?.separations.find((s) => s.see === 'self' && (s.status === 'pending' || s.status === 'approved')) ?? null;
  const action =
    hr || manager ? (
      <Button variant="primary" icon={Plus} onClick={() => setDialog('record')}>
        {t('lifecycle.record_separation')}
      </Button>
    ) : me.employee !== null && mine === null && d !== null ? (
      <Button icon={LogOut} onClick={() => setDialog('self')}>
        {t('lifecycle.hand_in_notice')}
      </Button>
    ) : null;
  const columns: Column<Separation>[] = [
    { key: 'person', label: t('lifecycle.person'), width: 'minmax(200px,1.6fr)', phone: 'title', sort: (r) => r.employee_name, render: (r) => <span className="font-medium">{r.employee_name}</span> },
    { key: 'kind', label: t('lifecycle.f.separation_kind'), width: '140px', sort: (r) => r.kind, render: (r) => r.kind_label },
    { key: 'last', label: t('lifecycle.f.last_day'), width: '150px', sort: (r) => r.last_day, render: (r) => <span><span className="hr-mono hr-num">{fmtDay(r.last_day)}</span> <span className="hr-label">{relDay(r.last_day)}</span></span> },
    { key: 'progress', label: t('lifecycle.offboarding'), width: 'minmax(140px,1fr)', hideBelow: 'lg', render: (r) => (r.checklist !== null ? <ProgressBar progress={r.checklist.progress} wide /> : <span className="text-[var(--hr-muted)]">-</span>) },
    { key: 'status', label: t('lifecycle.status'), width: '130px', phone: 'end', sort: (r) => r.status, render: (r) => <StatusDot tone={SEPARATION_TONE[r.status] ?? 'neutral'} label={t(`lifecycle.sep_status.${r.status}`)} /> },
  ];
  return (
    <>
      <PageHeader title={t('lifecycle.separations')} meta={d !== null ? tn('lifecycle.meta_separations', d.total) : ''} back={hr || manager ? '#/lifecycle' : undefined}>
        {action !== null && <Acts>{action}</Acts>}
      </PageHeader>
      <PageBody>
        {action !== null && <PhoneActs>{action}</PhoneActs>}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <Segmented
              value={status}
              onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
              label={t('lifecycle.status')}
              size="sm"
              options={[
                { value: 'open', label: t('lifecycle.in_progress') },
                { value: 'completed', label: t('lifecycle.sep_status.completed') },
                { value: 'all', label: t('lifecycle.all') },
              ]}
            />
          </div>
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <SkeletonRows />
            )
          ) : (
            <DataTable
              label={t('lifecycle.separations')}
              columns={columns}
              rows={d.separations}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/lifecycle/separations/${r.id}`}
              hasMore={d.total > d.separations.length}
              onMore={() => setLimit((l) => l + 50)}
              loadingMore={live.loading}
              empty={<Empty icon={LogOut} title={t('lifecycle.no_separations')} />}
            />
          )}
        </div>
      </PageBody>
      <SeparationDialog open={dialog !== null} onClose={() => setDialog(null)} self={dialog === 'self'} hr={hr} />
    </>
  );
}

/* --------------------------------------------------------------- detail */

function EditDialog({ open, onClose, s }: { open: boolean; onClose: () => void; s: Separation }): React.JSX.Element {
  const [last, setLast] = useState(s.last_day);
  const [notice, setNotice] = useState(s.notice_day);
  const [reasonCode, setReasonCode] = useState(s.reason_code ?? '');
  const [reason, setReason] = useState(s.reason ?? '');
  const [rehire, setRehire] = useState<'yes' | 'no' | 'unsure'>((s.rehire_eligible as 'yes' | 'no' | 'unsure' | undefined) ?? 'unsure');
  const [note, setNote] = useState(s.hr_note ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (open) {
      setLast(s.last_day);
      setNotice(s.notice_day);
      setErr(null);
    }
  }, [open, s.last_day, s.notice_day]);
  const save = async (): Promise<void> => {
    if (s.status === 'approved' && last !== s.last_day && !(await confirmAsk(t('lifecycle.move_last_day_text', { day: fmtDay(last) }), t('lifecycle.move_last_day'), t('lifecycle.move'), 'primary'))) return;
    setBusy(true);
    setErr(null);
    try {
      await op('separations.update', { separation: s.id, last_day: last, notice_day: notice, reason_code: reasonCode, reason, rehire_eligible: rehire, hr_note: note }, { quiet: true });
      changed(...SEPARATION_READS);
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('lifecycle.edit_separation')}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button variant="primary" busy={busy} onClick={() => void save()}>
            {t('ui.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('lifecycle.f.notice_day')}>
            <DayPicker value={notice} onChange={setNotice} label={t('lifecycle.f.notice_day')} />
          </Field>
          <Field label={t('lifecycle.f.last_day')}>
            <DayPicker value={last} onChange={setLast} label={t('lifecycle.f.last_day')} min={notice} />
          </Field>
        </div>
        <Field label={t('lifecycle.f.reason_code')} optional>
          <Picker value={reasonCode} onChange={(v) => setReasonCode(v)} items={REASONS.map((r) => ({ value: r, label: t(`lifecycle.reason.${r}`) }))} label={t('lifecycle.f.reason_code')} clearable placeholder={t('lifecycle.choose')} />
        </Field>
        <Field label={t('lifecycle.f.reason')} optional>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} />
        </Field>
        <Field label={t('lifecycle.f.rehire')}>
          <Segmented
            value={rehire}
            onChange={setRehire}
            label={t('lifecycle.f.rehire')}
            options={[
              { value: 'yes', label: t('ui.yes') },
              { value: 'no', label: t('ui.no') },
              { value: 'unsure', label: t('lifecycle.unsure') },
            ]}
          />
        </Field>
        <Field label={t('lifecycle.f.hr_note')} optional>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} />
        </Field>
        {err !== null && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

function QuestionInput({ q, value, onChange, disabled }: { q: ExitQuestion; value: string | number | undefined; onChange: (v: string | number) => void; disabled?: boolean | undefined }): React.JSX.Element {
  if (q.type === 'rating')
    return <Segmented value={value === undefined ? '' : String(value)} onChange={(v) => onChange(Number(v))} label={q.label} options={['1', '2', '3', '4', '5'].map((n) => ({ value: n, label: n }))} />;
  if (q.type === 'yes_no')
    return (
      <Segmented
        value={value === undefined ? '' : String(value)}
        onChange={(v) => onChange(v)}
        label={q.label}
        options={[
          { value: 'yes', label: t('ui.yes') },
          { value: 'no', label: t('ui.no') },
        ]}
      />
    );
  if (q.type === 'choice') return <Picker value={value === undefined ? '' : String(value)} onChange={(v) => onChange(v)} items={(q.options ?? []).map((o) => ({ value: o, label: o }))} label={q.label} placeholder={t('lifecycle.choose')} disabled={disabled} />;
  return <Textarea value={value === undefined ? '' : String(value)} onChange={(e) => onChange(e.target.value)} minRows={2} disabled={disabled} />;
}

function ExitInterview({ s, self }: { s: Separation; self: boolean }): React.JSX.Element {
  const questions = s.exit_interview?.questions ?? s.form?.questions ?? [];
  const [answers, setAnswers] = useState<Record<string, string | number>>(s.exit_interview?.answers ?? {});
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(self);
  const done = s.exit_interview_done;
  const canFill = s.can?.exit_interview === true;
  const send = async (submit: boolean): Promise<void> => {
    setBusy(true);
    try {
      await op('separations.exit-interview', { separation: s.id, answers, done: submit });
      changed('separations');
      toast.success(submit ? (self ? t('lifecycle.thanks_exit') : t('lifecycle.exit_sent')) : t('ui.saved'));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  if (self && done) return <Notice tone="good">{t('lifecycle.exit_thanks_done')}</Notice>;
  if (!canFill && !done) return <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.exit_not_yet')}</span>;
  if (!self && !done && !open)
    return (
      <div className="flex flex-wrap items-center gap-3">
        <span className="min-w-0 flex-1 text-[13px] text-[var(--hr-muted)]">{t('lifecycle.exit_waiting', { name: s.employee_name })}</span>
        <Button onClick={() => setOpen(true)}>{t('lifecycle.fill_in_together')}</Button>
      </div>
    );
  if (!canFill && done)
    return (
      <dl className="flex flex-col gap-3">
        {questions.map((q) => (
          <div key={q.key}>
            <dt className="text-[12px] text-[var(--hr-muted)]">{q.label}</dt>
            <dd className="hr-wrap text-[13px]">{answers[q.key] !== undefined ? String(answers[q.key]) : '-'}</dd>
          </div>
        ))}
      </dl>
    );
  return (
    <div className="flex flex-col gap-3">
      {!self && done && <Notice tone="good">{t('lifecycle.exit_done_on', { day: fmtStampDay(s.exit_interview?.done_at, { entity: s.entity }) })}</Notice>}
      {questions.map((q) => (
        <Field key={q.key} label={q.label}>
          <QuestionInput q={q} value={answers[q.key]} onChange={(v) => setAnswers((a) => ({ ...a, [q.key]: v }))} />
        </Field>
      ))}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" busy={busy} onClick={() => void send(true)}>
          {self ? t('lifecycle.send_answers') : done ? t('ui.save') : t('lifecycle.save_and_close')}
        </Button>
        {!done && (
          <Button variant="ghost" onClick={() => void send(false)}>
            {t('lifecycle.save_for_later')}
          </Button>
        )}
      </div>
    </div>
  );
}

export function SeparationPage({ params }: PageProps): React.JSX.Element {
  const live = useOp<{ separation: Separation }>('separations.get', { separation: params['id'] ?? '' }, SEPARATION_READS, { name: 'lifecycle.separation' });
  const [editing, setEditing] = useState(false);
  const [returning, setReturning] = useState<Asset | null>(null);
  const s = live.data?.separation ?? null;
  if (s === null) {
    return (
      <>
        <PageHeader title={t('lifecycle.separation')} back="#/lifecycle/separations" />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  }
  const today = officeToday({ entity: s.entity });
  const ix = panelNumbers();
  const withdraw = async (): Promise<void> => {
    if (!(await confirmAsk(t('lifecycle.withdraw_text'), t('lifecycle.withdraw'), t('lifecycle.withdraw'), 'primary'))) return;
    try {
      await op('separations.withdraw', { separation: s.id });
      changed(...SEPARATION_READS);
    } catch {
      /* toast shown */
    }
  };
  const complete = async (): Promise<void> => {
    try {
      await op('separations.complete', { separation: s.id });
      changed(...SEPARATION_READS);
      toast.success(t('lifecycle.separation_completed'));
    } catch {
      /* toast shown */
    }
  };
  const steps = [
    { key: 'pending', label: t('lifecycle.step.asked') },
    { key: 'approved', label: t('lifecycle.step.approved') },
    { key: 'last', label: t('lifecycle.step.last_day') },
    { key: 'completed', label: t('lifecycle.step.completed') },
  ];
  const current = s.status === 'completed' ? 'completed' : s.status === 'approved' ? (s.last_day < today ? 'last' : 'approved') : 'pending';
  const doneSteps = s.status === 'completed' ? ['pending', 'approved', 'last', 'completed'] : s.status === 'approved' ? (s.last_day < today ? ['pending', 'approved', 'last'] : ['pending', 'approved']) : [];
  const hr = s.see === 'hr';
  const canComplete = s.can?.complete === true && s.last_day < today;
  const actions =
    s.can?.settlement === true || canComplete ? (
      <>
        {s.can?.settlement === true && (
          <Button icon={Calculator} onClick={() => navigate(`/lifecycle/separations/${s.id}/settlement`)}>
            {t('lifecycle.full_and_final')}
          </Button>
        )}
        {canComplete && (
          <Button variant="primary" icon={CheckCheck} onClick={() => void complete()}>
            {t('lifecycle.complete')}
          </Button>
        )}
      </>
    ) : null;
  return (
    <>
      <PageHeader title={s.employee_name + ': ' + s.kind_label} meta={[s.number, t('lifecycle.last_day') + ' ' + fmtDay(s.last_day), t(`lifecycle.sep_status.${s.status}`)].join(' · ')} back="#/lifecycle/separations">
        {actions !== null && <Acts>{actions}</Acts>}
        {(s.can?.edit === true || s.can?.withdraw === true) && (
          <Menu icon={MoreHorizontal} label={t('lifecycle.separation_menu')}>
            {(close) => (
              <>
                {s.can?.edit === true && (
                  <MenuItem icon={Pencil} onClick={() => (close(), setEditing(true))}>
                    {t('ui.edit')}
                  </MenuItem>
                )}
                {s.can?.withdraw === true && (
                  <MenuItem icon={Undo2} onClick={() => (close(), void withdraw())}>
                    {t('lifecycle.withdraw')}
                  </MenuItem>
                )}
              </>
            )}
          </Menu>
        )}
      </PageHeader>
      <PageBody>
        {actions !== null && <PhoneActs>{actions}</PhoneActs>}
        {s.status !== 'rejected' && s.status !== 'withdrawn' ? (
          <div className="hr-panel hr-in mb-3 px-3.5 py-3">
            <Stepper steps={steps} current={current} done={doneSteps} />
          </div>
        ) : (
          <Notice className="mb-3">{t(`lifecycle.sep_status_long.${s.status}`)}</Notice>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
            <Panel index={ix()} label={t('lifecycle.details')}>
              <FactStrip
                items={[
                  { label: t('lifecycle.f.separation_kind'), value: s.kind_label },
                  { label: t('lifecycle.f.notice_day'), value: fmtDay(s.notice_day), mono: true },
                  { label: t('lifecycle.f.last_day'), value: fmtDay(s.last_day, { weekday: true }), mono: true },
                  { label: t('lifecycle.asked_by'), value: s.requested_by_name || '-' },
                  ...(hr ? [{ label: t('lifecycle.f.rehire'), value: t(`lifecycle.rehire.${s.rehire_eligible ?? 'unsure'}`) }] : []),
                ]}
              />
              {(hr || s.see === 'self') && (s.reason ?? '') !== '' && (
                <div className="mt-3">
                  <div className="hr-label mb-1">{t('lifecycle.reason_label')}</div>
                  <div className="hr-wrap whitespace-pre-wrap text-[13px]">{s.reason}</div>
                </div>
              )}
              {hr && (s.reason_code ?? '') !== '' && <Tag className="mt-3">{t(`lifecycle.reason.${s.reason_code ?? 'other'}`)}</Tag>}
              {hr && (s.hr_note ?? '') !== '' && (
                <Notice className="mt-3">
                  <span className="hr-label mr-2">{t('lifecycle.hr_only')}</span>
                  {s.hr_note}
                </Notice>
              )}
            </Panel>
            {(hr || s.see === 'self') && s.status !== 'rejected' && s.status !== 'withdrawn' && (
              <Panel index={ix()} label={t('lifecycle.exit_interview')} aside={hr ? <Tag tone="faint">{t('lifecycle.hr_only')}</Tag> : undefined}>
                <ExitInterview s={s} self={s.see === 'self'} />
              </Panel>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
            <Panel index={ix()} label={t('lifecycle.offboarding')}>
              {s.checklist !== null ? (
                <a href={`#/lifecycle/checklists/${s.checklist.id}`} className="hr-focus block rounded-[3px]">
                  <span className="hr-link mb-1.5 block text-[13px] font-medium">{s.checklist.name}</span>
                  <ProgressBar progress={s.checklist.progress} wide />
                </a>
              ) : (
                <span className="text-[13px] text-[var(--hr-muted)]">{s.status === 'pending' ? t('lifecycle.offboarding_after_approval') : t('lifecycle.no_offboarding')}</span>
              )}
            </Panel>
            {s.assets !== undefined && (
              <Panel index={ix()} label={t('lifecycle.assets_to_collect')} flush>
                {s.assets.length === 0 ? (
                  <Empty icon={CheckCheck} title={t('lifecycle.nothing_to_collect')} className="py-6" />
                ) : (
                  <ul className="px-3.5 pb-1">
                    {s.assets.map((a) => (
                      <li key={a.id} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] font-medium">{a.name}</span>
                          <span className="hr-mono block text-[12px] text-[var(--hr-muted)]">{[a.tag, a.serial].filter((x) => x !== '').join(' · ')}</span>
                        </span>
                        {hr && (
                          <Button size="sm" onClick={() => setReturning(a)}>
                            {t('lifecycle.mark_returned')}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>
            )}
          </div>
        </div>
      </PageBody>
      {hr && <EditDialog open={editing} onClose={() => setEditing(false)} s={s} />}
      <ReturnAssetDialog open={returning !== null} onClose={() => setReturning(null)} asset={returning} />
    </>
  );
}

/* ----------------------------------------------------------- settlement */

function SettlementBody({ d, print }: { d: Settlement; print?: boolean | undefined }): React.JSX.Element {
  const money = (minor: number | null, currency: string): React.ReactNode => (minor === null ? '-' : <Money minor={minor} currency={currency} always={print === true} />);
  const rows = (list: Settlement['pay']): React.ReactNode[][] => list.map((x) => [x.label, x.ref, money(x.amount_minor, x.currency)]);
  const fromRun = d.totals.length > 0 && d.totals.every((x) => x.source === 'payrun');
  const leaveValue = (l: Settlement['leave'][number]): React.ReactNode => (l.amount_minor !== null ? money(l.amount_minor, l.currency) : l.valued === 'payrun' ? '-' : t('lifecycle.valued_in_final_pay'));
  const leaveNote = d.leave_from === 'payrun' ? t('lifecycle.leave_from_run') : d.leave_from === 'requests' ? t('lifecycle.leave_from_requests') : t('lifecycle.leave_from_balance');
  if (print === true)
    return (
      <>
        <PrintHead entity={d.entity.legal_name} title={t('lifecycle.full_and_final')} meta={[d.separation.number, d.separation.employee_name, t('lifecycle.last_day') + ' ' + fmtDay(d.separation.last_day, { year: 'always' })].join(' · ')} />
        <h3 className="mb-1 mt-4 text-[13px] font-semibold">{t('lifecycle.to_pay')}</h3>
        <PrintTable head={[{ label: t('lifecycle.item') }, { label: t('lifecycle.ref') }, { label: t('lifecycle.amount'), right: true }]} rows={rows(d.pay)} />
        <h3 className="mb-1 mt-4 text-[13px] font-semibold">{t('lifecycle.to_recover')}</h3>
        <PrintTable head={[{ label: t('lifecycle.item') }, { label: t('lifecycle.ref') }, { label: t('lifecycle.amount'), right: true }]} rows={rows(d.recover)} />
        <h3 className="mb-1 mt-4 text-[13px] font-semibold">{t('lifecycle.leave_to_encash')}</h3>
        <PrintTable head={[{ label: t('lifecycle.leave_type') }, { label: t('lifecycle.balance'), right: true }, { label: t('lifecycle.amount'), right: true }]} rows={d.leave.map((l) => [l.name, l.balance + ' ' + t('lifecycle.unit.' + l.unit), leaveValue(l)])} />
        <h3 className="mb-1 mt-4 text-[13px] font-semibold">{fromRun ? t('lifecycle.final_pay_totals') : t('lifecycle.estimate_totals')}</h3>
        {fromRun ? (
          <PrintTable head={[{ label: t('lifecycle.currency') }, { label: t('lifecycle.gross'), right: true }, { label: t('lifecycle.deductions'), right: true }, { label: t('lifecycle.reimbursements'), right: true }, { label: t('lifecycle.net'), right: true }]} rows={d.totals.map((x) => [x.currency, money(x.gross_minor, x.currency), money(x.deductions_minor, x.currency), money(x.reimbursement_minor, x.currency), money(x.net_minor, x.currency)])} />
        ) : (
          <PrintTable head={[{ label: t('lifecycle.currency') }, { label: t('lifecycle.to_pay'), right: true }, { label: t('lifecycle.to_recover'), right: true }, { label: t('lifecycle.net'), right: true }]} rows={d.totals.map((x) => [x.currency, money(x.pay_minor, x.currency), money(x.recover_minor, x.currency), money(x.net_minor, x.currency)])} />
        )}
        <p className="mt-6 text-[12px] text-[#555]">{d.payrun !== null ? t('lifecycle.payrun_note', { status: d.payrun.status, day: fmtDay(d.payrun.pay_date) }) : t('lifecycle.no_payrun_yet')}</p>
      </>
    );
  const List = ({ items, empty }: { items: Settlement['pay']; empty: string }): React.JSX.Element =>
    items.length === 0 ? (
      <span className="text-[13px] text-[var(--hr-muted)]">{empty}</span>
    ) : (
      <ul>
        {items.map((x, i) => (
          <li key={i} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
            <span className="hr-wrap min-w-0 flex-1 text-[13px]">{x.label}</span>
            <span className="hr-mono hr-num text-[13px]">{money(x.amount_minor, x.currency)}</span>
          </li>
        ))}
      </ul>
    );
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
        {d.pay_hidden && <Notice tone="warn">{t('lifecycle.amounts_hidden')}</Notice>}
        <Panel index="01" label={t('lifecycle.to_pay')}>
          <List items={d.pay} empty={t('lifecycle.nothing_to_pay')} />
        </Panel>
        <Panel index="02" label={t('lifecycle.to_recover')}>
          <List items={d.recover} empty={t('lifecycle.nothing_to_recover')} />
        </Panel>
        <Panel index="03" label={t('lifecycle.leave_to_encash')} aside={d.leave.length > 0 ? <span className="hr-label">{leaveNote}</span> : undefined}>
          {d.leave.length === 0 ? (
            <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.no_leave_left')}</span>
          ) : (
            <ul>
              {d.leave.map((l, i) => (
                <li key={l.type + i} className="grid grid-cols-[minmax(0,1fr)_96px_110px] items-center gap-x-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                  <span className="hr-wrap min-w-0 text-[13px]">{l.name}</span>
                  <span className="hr-mono hr-num text-right text-[13px]">
                    {l.balance} {t('lifecycle.unit.' + l.unit)}
                  </span>
                  <span className={'text-right text-[13px] ' + (l.amount_minor !== null ? 'hr-mono hr-num' : 'text-[var(--hr-muted)]')}>{leaveValue(l)}</span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
      <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
        {d.totals.map((x) =>
          x.source === 'payrun' ? (
            <div key={x.currency} className="hr-panel hr-in px-3.5 py-3">
              <div className="hr-label">{t('lifecycle.final_net_in', { currency: x.currency })}</div>
              <div className="hr-mono hr-num mt-1.5 text-[26px] font-light leading-none">{money(x.net_minor, x.currency)}</div>
              <div className="mt-2 flex flex-wrap justify-between gap-x-3 gap-y-0.5 text-[12px] text-[var(--hr-muted)]">
                <span>
                  {t('lifecycle.gross')} {money(x.gross_minor, x.currency)}
                </span>
                <span>
                  {t('lifecycle.deductions')} {money(x.deductions_minor, x.currency)}
                </span>
                {x.reimbursement_minor !== null && x.reimbursement_minor !== 0 && (
                  <span>
                    {t('lifecycle.reimbursements')} {money(x.reimbursement_minor, x.currency)}
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div key={x.currency} className="hr-panel hr-in px-3.5 py-3">
              <div className="hr-label">{(x.net_minor ?? 0) < 0 ? t('lifecycle.net_owed', { currency: x.currency }) : t('lifecycle.net_in', { currency: x.currency })}</div>
              <div className="hr-mono hr-num mt-1.5 text-[26px] font-light leading-none">{money(x.net_minor === null ? null : Math.abs(x.net_minor), x.currency)}</div>
              <div className="mt-2 flex justify-between gap-3 text-[12px] text-[var(--hr-muted)]">
                <span>
                  {t('lifecycle.to_pay')} {money(x.pay_minor, x.currency)}
                </span>
                <span>
                  {t('lifecycle.to_recover')} {money(x.recover_minor, x.currency)}
                </span>
              </div>
              <div className="hr-label mt-2">{t('lifecycle.estimate_until_run')}</div>
            </div>
          ),
        )}
        <Panel index="04" label={t('lifecycle.termination_run')}>
          {d.payrun === null ? (
            <span className="text-[13px] text-[var(--hr-muted)]">{t('lifecycle.no_payrun_yet')}</span>
          ) : (
            <a href={'#/payroll/runs/' + d.payrun.id} className="hr-focus block rounded-[3px]">
              <StatusDot tone={d.payrun.status === 'paid' || d.payrun.status === 'locked' ? 'good' : 'warn'} label={t('lifecycle.payrun_status', { status: d.payrun.status })} />
              <span className="hr-link mt-1 block text-[12px] text-[var(--hr-muted)]">{[d.payrun.number, t('lifecycle.pay_date', { day: fmtDay(d.payrun.pay_date) })].filter((v) => v !== '').join(' · ')}</span>
              {!d.payrun.calculated && <span className="mt-1 block text-[12px] text-[var(--hr-muted)]">{t('lifecycle.run_not_calculated')}</span>}
            </a>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function SettlementPage({ params }: PageProps): React.JSX.Element {
  const live = useOp<Settlement>('separations.settlement', { separation: params['id'] ?? '' }, [...SEPARATION_READS, 'payruns', 'payslips', 'claims', 'advances', 'loans', 'leave_ledger'], { name: 'lifecycle.settlement' });
  const d = live.data;
  const printBtn = (
    <Button icon={Printer} onClick={() => navigate(`/print/lifecycle/settlement/${params['id'] ?? ''}`)}>
      {t('lifecycle.print')}
    </Button>
  );
  return (
    <>
      <PageHeader title={d !== null ? d.separation.employee_name + ': ' + t('lifecycle.full_and_final') : t('lifecycle.full_and_final')} meta={d !== null ? [d.separation.number, t('lifecycle.last_day') + ' ' + fmtDay(d.separation.last_day), d.entity.name].join(' · ') : ''} back={`#/lifecycle/separations/${params['id'] ?? ''}`}>
        {d !== null && <Acts>{printBtn}</Acts>}
      </PageHeader>
      <PageBody>
        {d !== null && <PhoneActs>{printBtn}</PhoneActs>}{d === null ? live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows /> : <SettlementBody d={d} />}</PageBody>
    </>
  );
}

export function SettlementPrint({ params }: PageProps): React.JSX.Element {
  const live = useOp<Settlement>('separations.settlement', { separation: params['id'] ?? '' }, [], { name: 'lifecycle.settlement.print' });
  if (live.data === null) return live.error !== null ? <p>{live.error}</p> : <p>{t('ui.loading')}</p>;
  return <SettlementBody d={live.data} print />;
}

