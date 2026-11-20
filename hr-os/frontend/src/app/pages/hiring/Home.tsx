/**
 * Hiring home: what needs you first (scorecards you owe, people ready to
 * hire, offers to move, approved requests without an opening, candidates
 * past retention), then the open roles as one compact row each with the
 * candidates per stage, then interviews today and this week.
 */
import { useState } from 'react';
import { Briefcase, ChevronRight, ClipboardPen, FilePlus2, FileSignature, Handshake, Plus, ShieldAlert, UserCheck } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Button, Empty, LoadError, Loading, PageBody, PageHeader, Panel, RowCue, StatTile } from '../../components/ui.tsx';
import { OpeningDialog, RequisitionDialog } from '../../components/hiring/forms.tsx';
import { AsideLink, StageStrip, Status, whenText } from '../../components/hiring/bits.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { HiringHome as Home, Interview } from './types.ts';
import { READS } from './types.ts';

function NeedRow({ icon: Icon, text, sub, to, action }: { icon: LucideIcon; text: string; sub?: string | undefined; to: string; action: string }): React.JSX.Element {
  return (
    <a href={'#' + to} className="hr-focus group flex min-w-0 cursor-pointer items-center gap-3 rounded-[var(--hr-radius-sm)] px-2 py-2 transition-colors hover:bg-[var(--hr-hover)]">
      <Icon size={15} className="shrink-0 text-[var(--hr-muted)]" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="hr-wrap block text-[13px]">{text}</span>
        {sub !== undefined && sub !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{sub}</span>}
      </span>
      <span className="hidden shrink-0 text-[12px] text-[var(--hr-ink-2)] sm:inline">{action}</span>
      <ChevronRight size={14} className="shrink-0 text-[var(--hr-faint)]" aria-hidden />
    </a>
  );
}

export function InterviewRow({ iv, today }: { iv: Interview; today: string }): React.JSX.Element {
  return (
    <a href={`#/hiring/interviews/${iv.id}`} className="group hr-focus flex min-w-0 cursor-pointer items-start gap-3 rounded-[var(--hr-radius-sm)] px-2 py-2 transition-colors hover:bg-[var(--hr-hover)]">
      <span className="hr-mono hr-num w-[54px] shrink-0 pt-px text-[13px]">{iv.start}</span>
      <span className="min-w-0 flex-1">
        <span className="hr-wrap block text-[13px] font-medium">{iv.candidate_name}</span>
        <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">
          {[iv.day === today ? t('hiring.today') : fmtDay(iv.day, { weekday: true }), iv.title, iv.opening_title].filter((x) => x !== '').join(' · ')}
        </span>
      </span>
      {iv.mine && iv.my_scorecard !== 'submitted' && <span className="hr-label shrink-0 pt-0.5">{t('hiring.you_interview')}</span>}
      <RowCue />
    </a>
  );
}

export function HiringHomePage(_props: PageProps): React.JSX.Element {
  const live = useOp<Home>('hiring.home', {}, READS, { name: 'hiring.home' });
  const [newOpening, setNewOpening] = useState(false);
  const [newReq, setNewReq] = useState(false);
  const h = live.data;
  if (h === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const inProcess = h.openings.reduce((a, o) => a + o.active, 0);
  const week = h.interviews_today.length + h.interviews_week.length;
  const offersOut = h.offers_waiting.length + h.ready_to_hire.length;
  const needs = h.feedback_owed.length + h.ready_to_hire.length + h.offers_waiting.length + h.requisitions_waiting.length + (h.retention_due > 0 ? 1 : 0);
  const canOpen = h.can.edit && h.broad;
  const actions = (
    <>
      {h.can.edit && (
        <Button variant={canOpen ? 'default' : 'primary'} icon={FilePlus2} onClick={() => setNewReq(true)} aria-label={t('hiring.request_role')} className={canOpen ? 'hidden sm:inline-flex' : undefined}>
          <span className="hidden sm:inline">{t('hiring.request_role')}</span>
        </Button>
      )}
      {canOpen && (
        <Button variant="primary" icon={Plus} onClick={() => setNewOpening(true)} aria-label={t('hiring.new_opening')}>
          <span className="hidden sm:inline">{t('hiring.new_opening')}</span>
        </Button>
      )}
    </>
  );
  return (
    <>
      <PageHeader title={t('hiring.title')} meta={[tn('hiring.meta_open', h.openings.length), tn('hiring.meta_in_process', inProcess)].join(' · ')}>
        {actions}
      </PageHeader>
      <PageBody>
        <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile index="01" label={t('hiring.kpi.open_roles')} value={h.openings.length} onClick={() => navigate('/hiring/openings')} />
          <StatTile index="02" label={t('hiring.kpi.in_process')} value={inProcess} onClick={() => navigate('/hiring/candidates', { view: 'active' })} />
          <StatTile index="03" label={t('hiring.kpi.interviews_week')} value={week} onClick={() => navigate('/hiring/interviews')} />
          <StatTile index="04" label={t('hiring.kpi.offers_out')} value={offersOut} onClick={() => navigate('/hiring/offers')} />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
            <Panel index="05" label={t('hiring.open_roles')} flush aside={<AsideLink href="#/hiring/openings">{t('hiring.all_openings')}</AsideLink>}>
              {h.openings.length === 0 ? (
                <Empty
                  icon={Briefcase}
                  title={t('hiring.no_open_roles')}
                  action={
                    h.can.edit ? (
                      canOpen ? (
                        <Button icon={Plus} onClick={() => setNewOpening(true)}>
                          {t('hiring.new_opening')}
                        </Button>
                      ) : (
                        <Button icon={FilePlus2} onClick={() => setNewReq(true)}>
                          {t('hiring.request_role')}
                        </Button>
                      )
                    ) : undefined
                  }
                >
                  {h.can.edit ? t('hiring.no_open_roles_text') : t('hiring.no_open_roles_viewer')}
                </Empty>
              ) : (
                <ul className="divide-y divide-[var(--hr-line)]">
                  {h.openings.map((o) => (
                    <li key={o.id}>
                      <a href={`#/hiring/openings/${o.id}`} className="group relative pr-10 hr-focus grid min-w-0 cursor-pointer grid-cols-1 items-center gap-2 px-4 py-2.5 transition-colors hover:bg-[var(--hr-hover)] md:grid-cols-[minmax(180px,0.9fr)_minmax(0,1.6fr)]">
                        <span className="min-w-0">
                          <span className="hr-wrap block text-[13px] font-medium">{o.title}</span>
                          <span className="hr-mono mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-[var(--hr-muted)]">
                            <span>{o.number}</span>
                            <span>{o.entity_name}</span>
                            {o.status !== 'open' && <Status kind="opening" status={o.status} />}
                          </span>
                        </span>
                        <StageStrip stages={o.stages} positions={o.positions} hired={o.hired} />
                        <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel index="07" label={t('hiring.interviews')} aside={<AsideLink href="#/hiring/interviews">{t('hiring.calendar_list')}</AsideLink>}>
              {week === 0 ? (
                <p className="py-1 text-[13px] text-[var(--hr-muted)]">{t('hiring.no_interviews_week')}</p>
              ) : (
                <div className="flex flex-col">
                  {[...h.interviews_today, ...h.interviews_week].map((iv) => (
                    <InterviewRow key={iv.id} iv={iv} today={h.today} />
                  ))}
                </div>
              )}
            </Panel>
          </div>
          <Panel index="06" label={t('hiring.needs_you')} className="order-first lg:order-none lg:col-span-4" aside={needs > 0 ? <span className="hr-label">{needs}</span> : undefined}>
            {needs === 0 ? (
              <p className="py-1 text-[13px] text-[var(--hr-muted)]">{t('hiring.nothing_waiting')}</p>
            ) : (
              <div className="-mx-1 flex flex-col">
                {h.feedback_owed.map((f) => (
                  <NeedRow key={f.scorecard} icon={ClipboardPen} text={t('hiring.need.scorecard', { name: f.candidate_name })} sub={[f.title, whenText(f.day, f.start, f.timezone)].join(' · ')} to={`/hiring/interviews/${f.interview}`} action={t('hiring.write')} />
                ))}
                {h.ready_to_hire.map((o) => (
                  <NeedRow key={o.id} icon={UserCheck} text={t('hiring.need.hire', { name: o.candidate_name })} sub={[o.title, o.start_day !== '' ? t('hiring.starts', { day: fmtDay(o.start_day) }) : ''].filter((x) => x !== '').join(' · ')} to={`/hiring/offers/${o.id}`} action={h.can.hire ? t('hiring.hire') : t('hiring.open')} />
                ))}
                {h.offers_waiting.map((o) => (
                  <NeedRow key={o.id} icon={FileSignature} text={t(`hiring.need.offer_${o.status}`, { name: o.candidate_name })} sub={o.title} to={`/hiring/offers/${o.id}`} action={t('hiring.open')} />
                ))}
                {h.requisitions_waiting.map((r) => (
                  <NeedRow key={r.id} icon={FilePlus2} text={r.status === 'approved' ? t('hiring.need.req_approved', { title: r.title }) : t('hiring.need.req_pending', { title: r.title })} sub={[r.number, r.entity_name].join(' · ')} to={`/hiring/requisitions?open=${r.id}`} action={r.status === 'approved' ? t('hiring.create_opening') : t('hiring.open')} />
                ))}
                {h.retention_due > 0 && <NeedRow icon={ShieldAlert} text={tn('hiring.need.retention', h.retention_due)} to="/hiring/candidates?view=retention" action={t('hiring.review')} />}
              </div>
            )}
            {h.referrals > 0 && (
              <a href="#/hiring/referrals" className="group hr-focus mt-2 flex cursor-pointer items-center gap-2 rounded-[var(--hr-radius-sm)] px-1 py-1.5 text-[13px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)]">
                <Handshake size={13} aria-hidden />
                {tn('hiring.your_referrals_n', h.referrals)}
                <RowCue />
              </a>
            )}
          </Panel>
        </div>
      </PageBody>
      <OpeningDialog open={newOpening} onClose={() => setNewOpening(false)} />
      <RequisitionDialog open={newReq} onClose={() => setNewReq(false)} />
    </>
  );
}
