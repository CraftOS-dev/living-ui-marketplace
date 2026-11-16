/**
 * Lifecycle home: who starts and who leaves in the next 30 days with their
 * checklist progress, the viewer's own tasks, what is overdue, letters to
 * issue and (HR only) open concerns. An employee who lands here sees their
 * own onboarding (the welcome page).
 */
import { useState } from 'react';
import { ChevronRight, ListChecks, LogOut, Mail, Plus, ShieldAlert, UserPlus, Wand2 } from 'lucide-react';
import { Button, Empty, LoadError, Notice, PageBody, PageHeader, Panel, PersonChip, StatTile, Tag, toast } from '../../components/ui.tsx';
import { Acts, PhoneActs } from '../../components/lifecycle/Acts.tsx';
import { kindName, panelNumbers, ProgressBar, SkeletonRows, TASK_READS } from '../../components/lifecycle/bits.tsx';
import { StartChecklistDialog } from '../../components/lifecycle/dialogs.tsx';
import { TaskRow } from '../../components/lifecycle/TaskRow.tsx';
import type { LifecycleHome, Mover } from '../../components/lifecycle/types.ts';
import { op } from '../../lib/api.ts';
import { can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, relDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { WelcomePage } from './Welcome.tsx';

const READS = [...TASK_READS, 'employments', 'separations', 'letters', 'grievances', 'checklist_templates', 'job_records'];

function MoverRow({ m, kind, today }: { m: Mover; kind: 'starting' | 'leaving'; today: string }): React.JSX.Element {
  const link = m.checklist !== null ? `#/lifecycle/checklists/${m.checklist.id}` : m.separation !== null ? `#/lifecycle/separations/${m.separation.id}` : `#/people/${m.number}`;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,1.4fr)_120px_minmax(120px,1fr)]">
      <a href={link} className="hr-focus min-w-0 rounded-[3px] [&_.hr-wrap]:underline [&_.hr-wrap]:decoration-[var(--hr-line-2)] [&_.hr-wrap]:underline-offset-[3px] hover:[&_.hr-wrap]:decoration-current">
        <PersonChip name={m.name} sub={[m.title, m.entity_name].filter((x) => x !== '').join(' · ')} size={26} />
      </a>
      <span className="text-right sm:text-left">
        <span className="hr-mono hr-num block text-[12px]">{fmtDay(m.day)}</span>
        <span className="hr-label block">{relDay(m.day, today)}</span>
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 sm:col-span-1">
        {m.checklist !== null ? <ProgressBar progress={m.checklist.progress} /> : <span className="text-[12px] text-[var(--hr-muted)]">{kind === 'starting' ? t('lifecycle.no_checklist') : t('lifecycle.no_offboarding')}</span>}
        {m.separation !== null && <Tag tone={m.separation.status === 'pending' ? 'warn' : 'neutral'}>{kindName(m.separation.kind)}</Tag>}
        {kind === 'starting' && !m.has_member && <Tag tone="faint" title={t('lifecycle.no_account_hint')}>{t('lifecycle.no_account')}</Tag>}
      </span>
    </li>
  );
}

export function LifecycleHomePage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const hr = can(me, 'people', 'view');
  const manager = isManager(me);
  if (!hr && !manager) return <WelcomePage params={{}} query={new URLSearchParams()} />;
  return <HomeView hrEdit={can(me, 'people', 'edit')} hrFull={can(me, 'people', 'full')} canHire={can(me, 'people', 'full')} />;
}

function HomeView({ hrEdit, hrFull, canHire }: { hrEdit: boolean; hrFull: boolean; canHire: boolean }): React.JSX.Element {
  const live = useOp<LifecycleHome>('lifecycle.home', {}, READS, { name: 'lifecycle.home' });
  const [start, setStart] = useState(false);
  const [seeding, setSeeding] = useState('');
  const h = live.data;
  const seed = async (entity: string): Promise<void> => {
    setSeeding(entity);
    try {
      await op('checklist-templates.seed', { entity });
      changed('checklist_templates', 'letter_templates');
      toast.success(t('lifecycle.defaults_added'), { label: t('lifecycle.see_templates'), run: () => navigate('/lifecycle/templates') });
    } catch {
      /* toast shown */
    } finally {
      setSeeding('');
    }
  };
  const startBtn = hrEdit ? (
    <Button variant="primary" icon={Plus} onClick={() => setStart(true)}>
      {t('lifecycle.start_checklist')}
    </Button>
  ) : null;
  const ix = panelNumbers();
  const meta = h === null ? '' : [tn('lifecycle.meta_starting', h.starting.length), tn('lifecycle.meta_leaving', h.leaving.length), t('lifecycle.meta_days', { n: h.days })].join(' · ');
  return (
    <>
      <PageHeader title={t('lifecycle.title')} meta={meta}>
        {startBtn !== null && <Acts>{startBtn}</Acts>}
      </PageHeader>
      <PageBody>
        {startBtn !== null && <PhoneActs>{startBtn}</PhoneActs>}
        {h === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <SkeletonRows />
          )
        ) : (
          <>
            {(h.templates_missing ?? []).map((e) => (
              <Notice
                key={e.id}
                tone="warn"
                className="mb-3"
                action={
                  hrEdit ? (
                    <Button size="sm" icon={Wand2} busy={seeding === e.id} onClick={() => void seed(e.id)}>
                      {t('lifecycle.add_defaults')}
                    </Button>
                  ) : undefined
                }
              >
                {t('lifecycle.no_template_for', { entity: e.name })}
              </Notice>
            ))}
            <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
              <StatTile label={t('lifecycle.kpi.starting')} value={h.starting.length} sub={t('lifecycle.next_days', { n: h.days })} />
              <StatTile label={t('lifecycle.kpi.leaving')} value={h.leaving.length} sub={t('lifecycle.next_days', { n: h.days })} onClick={() => navigate('/lifecycle/separations')} />
              <StatTile label={t('lifecycle.kpi.overdue')} value={h.overdue_total} tone={h.overdue_total > 0 ? 'bad' : undefined} onClick={() => navigate('/lifecycle/tasks', { view: 'all', overdue: 1 })} />
              {h.letters_to_issue !== undefined && <StatTile label={t('lifecycle.kpi.letters')} value={h.letters_to_issue} onClick={() => navigate('/lifecycle/letters', { status: 'draft' })} />}
              {h.grievances_open !== undefined && hrFull && <StatTile label={t('lifecycle.kpi.concerns')} value={h.grievances_open} tone={h.grievances_open > 0 ? 'warn' : undefined} onClick={() => navigate('/lifecycle/grievances')} />}
            </div>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-8">
                <Panel index={ix()} label={t('lifecycle.starting')} flush>
                  {h.starting.length === 0 ? (
                    <Empty icon={UserPlus} title={t('lifecycle.none_starting', { n: h.days })} className="py-8" action={canHire ? <Button icon={UserPlus} onClick={() => navigate('/people/new')}>{t('lifecycle.hire_someone')}</Button> : undefined} />
                  ) : (
                    <ul className="px-3.5 pb-1">
                      {h.starting.map((m) => (
                        <MoverRow key={m.employment} m={m} kind="starting" today={h.today} />
                      ))}
                    </ul>
                  )}
                </Panel>
                <Panel index={ix()} label={t('lifecycle.leaving')} flush aside={<a href="#/lifecycle/separations" className="hr-focus hr-label hit inline-flex h-6 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">{t('lifecycle.all_separations')}<ChevronRight size={12} strokeWidth={2} aria-hidden /></a>}>
                  {h.leaving.length === 0 ? (
                    <Empty icon={LogOut} title={t('lifecycle.none_leaving', { n: h.days })} className="py-8">
                      {h.separations_pending !== undefined && h.separations_pending > 0 ? tn('lifecycle.pending_separations', h.separations_pending) : undefined}
                    </Empty>
                  ) : (
                    <ul className="px-3.5 pb-1">
                      {h.leaving.map((m) => (
                        <MoverRow key={m.employment} m={m} kind="leaving" today={h.today} />
                      ))}
                    </ul>
                  )}
                </Panel>
              </div>
              <div className="flex min-w-0 flex-col gap-3 lg:col-span-4">
                <Panel index={ix()} label={t('lifecycle.your_tasks')} flush aside={h.my_tasks_total > h.my_tasks.length ? <a href="#/lifecycle/tasks" className="hr-focus hr-label hit inline-flex h-6 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">{t('lifecycle.see_all', { n: h.my_tasks_total })}<ChevronRight size={12} strokeWidth={2} aria-hidden /></a> : undefined}>
                  {h.my_tasks.length === 0 ? (
                    <Empty icon={ListChecks} title={t('lifecycle.no_tasks')} className="py-8" />
                  ) : (
                    <ul className="px-3.5 pb-1">
                      {h.my_tasks.map((x) => (
                        <TaskRow key={x.id} task={x} today={h.today} compact leaves />
                      ))}
                    </ul>
                  )}
                </Panel>
                {h.hr && h.overdue.length > 0 && (
                  <Panel index={ix()} label={t('lifecycle.overdue')} flush aside={<a href="#/lifecycle/tasks?view=all&overdue=1" className="hr-focus hr-label hit inline-flex h-6 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">{t('lifecycle.see_all', { n: h.overdue_total })}<ChevronRight size={12} strokeWidth={2} aria-hidden /></a>}>
                    <ul className="px-3.5 pb-1">
                      {h.overdue.map((x) => (
                        <TaskRow key={x.id} task={x} today={h.today} show="lane" compact leaves />
                      ))}
                    </ul>
                  </Panel>
                )}
                {(h.letters ?? []).length > 0 && (
                  <Panel index={ix()} label={t('lifecycle.letters_to_issue')} flush>
                    <ul className="px-3.5 pb-1">
                      {(h.letters ?? []).map((l) => (
                        <li key={l.id} className="flex items-center gap-2 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                          <Mail size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                          <a href={`#/lifecycle/letters/${l.id}`} className="hr-focus min-w-0 flex-1 rounded-[3px]">
                            <span className="hr-link hr-wrap block text-[13px] font-medium">{l.title}</span>
                            <span className="block truncate text-[12px] text-[var(--hr-muted)]">{[l.number, l.employee_name].join(' · ')}</span>
                          </a>
                          {l.agent_drafting && <Tag tone="agent">{t('lifecycle.agent_drafting')}</Tag>}
                        </li>
                      ))}
                    </ul>
                  </Panel>
                )}
                {hrFull && h.grievances_open !== undefined && h.grievances_open > 0 && (
                  <Notice tone="warn" action={<Button size="sm" icon={ShieldAlert} onClick={() => navigate('/lifecycle/grievances')}>{t('lifecycle.open')}</Button>}>
                    {tn('lifecycle.concerns_open', h.grievances_open)}
                  </Notice>
                )}
              </div>
            </div>
          </>
        )}
      </PageBody>
      <StartChecklistDialog open={start} onClose={() => setStart(false)} />
    </>
  );
}
