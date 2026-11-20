/**
 * The new hire's welcome page (before and after the first day): how many
 * days to go, where and when to arrive, who to ask for and what to bring,
 * their own tasks with one-tap checks, and what to read or acknowledge.
 */
import { BookOpen, CheckCheck, FileText, ListChecks, MapPin, Package, UserRound } from 'lucide-react';
import { Button, Empty, LoadError, PageBody, PageHeader, Panel, StatusDot, toast } from '../../components/ui.tsx';
import { HANDBOOK_READS, LETTER_READS, panelNumbers, ProgressBar, SkeletonRows, TASK_READS } from '../../components/lifecycle/bits.tsx';
import { TaskRow } from '../../components/lifecycle/TaskRow.tsx';
import type { Welcome } from '../../components/lifecycle/types.ts';
import { download, op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';

function addressLines(a: Record<string, string> | null | undefined): string {
  if (a === null || a === undefined) return '';
  return ['line1', 'line2', 'city', 'region', 'postcode']
    .map((k) => a[k] ?? '')
    .filter((x) => x !== '')
    .join(', ');
}

export function WelcomePage(_props: PageProps): React.JSX.Element {
  const live = useOp<Welcome>('lifecycle.welcome', {}, [...TASK_READS, ...LETTER_READS, ...HANDBOOK_READS, 'employments', 'job_records'], { name: 'lifecycle.welcome' });
  const w = live.data;
  if (w === null)
    return (
      <>
        <PageHeader title={t('lifecycle.welcome')} />
        <PageBody>{live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <SkeletonRows />}</PageBody>
      </>
    );
  if (!w.linked)
    return (
      <>
        <PageHeader title={t('lifecycle.welcome')} />
        <PageBody>
          <div className="hr-panel">
            <Empty icon={UserRound} title={t('lifecycle.not_linked')}>
              {t('lifecycle.not_linked_text')}
            </Empty>
          </div>
        </PageBody>
      </>
    );
  if (w.joining !== true)
    return (
      <>
        <PageHeader title={t('lifecycle.welcome')} />
        <PageBody>
          <div className="hr-panel">
            <Empty icon={BookOpen} title={t('lifecycle.welcome_over')} action={<Button icon={BookOpen} onClick={() => navigate('/lifecycle/handbook')}>{t('lifecycle.open_handbook')}</Button>}>
              {t('lifecycle.welcome_over_text')}
            </Empty>
          </div>
        </PageBody>
      </>
    );
  const fd = w.first_day ?? null;
  const tasks = w.tasks ?? [];
  const open = tasks.filter((x) => x.status === 'open');
  const docs = (w.documents ?? []).filter((d) => d.acked_at === '');
  const pages = w.handbook ?? [];
  const ackDoc = async (id: string, letter: string): Promise<void> => {
    try {
      if (letter !== '') await op('letters.acknowledge', { letter });
      else await op('documents.ack', { document: id });
      changed('documents', 'letters');
      toast.success(t('lifecycle.thanks_ack'));
    } catch {
      /* toast shown */
    }
  };
  const ahead = fd !== null && fd.days_to_go > 0;
  const ix = panelNumbers();
  return (
    <>
      <PageHeader title={t('lifecycle.welcome_name', { name: w.employee?.name ?? '' })} meta={[w.entity?.name ?? '', fd !== null ? t('lifecycle.first_day_label') + ' ' + fmtDay(fd.day) : ''].filter((x) => x !== '').join(' · ')} />
      <PageBody>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-5">
            {fd !== null && (
              <div className="hr-panel hr-in px-4 py-4">
                <div className="hr-label">{ahead ? t('lifecycle.until_first_day') : t('lifecycle.since_first_day')}</div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="hr-mono hr-num text-[26px] font-light leading-none">{Math.abs(fd.days_to_go)}</span>
                  <span className="text-[13px] text-[var(--hr-muted)]">{tn('lifecycle.days_word', Math.abs(fd.days_to_go))}</span>
                </div>
                <div className="mt-1 text-[13px]">{fmtDay(fd.day, { weekday: true, year: 'always' })}</div>
              </div>
            )}
            {fd !== null && (
              <Panel index={ix()} label={t('lifecycle.first_day')}>
                <dl className="flex flex-col gap-3 text-[13px]">
                  <div className="flex gap-3">
                    <dt className="hr-label w-20 shrink-0 pt-0.5">{t('lifecycle.f.arrive')}</dt>
                    <dd className="hr-mono hr-num">{fd.time !== '' ? fd.time : t('lifecycle.ask_manager')}</dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="hr-label w-20 shrink-0 pt-0.5">{t('lifecycle.f.place')}</dt>
                    <dd className="hr-wrap min-w-0">
                      <span className="inline-flex items-start gap-1.5">
                        <MapPin size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--hr-muted)]" />
                        <span>
                          {fd.place !== '' ? fd.place : (w.job?.location ?? '') || t('lifecycle.ask_manager')}
                          {addressLines(fd.address) !== '' && <span className="block text-[12px] text-[var(--hr-muted)]">{addressLines(fd.address)}</span>}
                        </span>
                      </span>
                    </dd>
                  </div>
                  <div className="flex gap-3">
                    <dt className="hr-label w-20 shrink-0 pt-0.5">{t('lifecycle.f.contact')}</dt>
                    <dd>{fd.contact !== '' ? fd.contact : '-'}</dd>
                  </div>
                  {fd.bring !== '' && (
                    <div className="flex gap-3">
                      <dt className="hr-label w-20 shrink-0 pt-0.5">{t('lifecycle.f.bring')}</dt>
                      <dd className="hr-wrap inline-flex min-w-0 items-start gap-1.5">
                        <Package size={13} aria-hidden className="mt-0.5 shrink-0 text-[var(--hr-muted)]" />
                        {fd.bring}
                      </dd>
                    </div>
                  )}
                </dl>
                {fd.note !== '' && <p className="hr-wrap mt-3 border-l-2 border-[var(--hr-line-2)] pl-3 text-[13px] leading-5 text-[var(--hr-ink-2)]">{fd.note}</p>}
              </Panel>
            )}
            {w.job !== null && w.job !== undefined && (
              <Panel index={ix()} label={t('lifecycle.your_role')}>
                <div className="text-[14px] font-semibold">{w.job.title}</div>
                <div className="text-[13px] text-[var(--hr-muted)]">{[w.job.department, w.manager !== null && w.manager !== undefined ? t('lifecycle.reports_to', { name: w.manager.name }) : ''].filter((x) => x !== '').join(' · ')}</div>
              </Panel>
            )}
          </div>
          <div className="flex min-w-0 flex-col gap-3 lg:col-span-7">
            <Panel index={ix()} label={t('lifecycle.your_tasks')} aside={w.checklist !== null && w.checklist !== undefined ? <ProgressBar progress={w.checklist.progress} /> : undefined} flush>
              {tasks.length === 0 ? (
                <Empty icon={ListChecks} title={t('lifecycle.no_tasks')} className="py-8" />
              ) : (
                <ul className="px-3.5 pb-1">
                  {[...open, ...tasks.filter((x) => x.status !== 'open')].map((x) => (
                    <TaskRow key={x.id} task={x} today={w.today} show="none" />
                  ))}
                </ul>
              )}
            </Panel>
            <Panel index={ix()} label={t('lifecycle.to_read')} flush>
              {docs.length === 0 && pages.length === 0 ? (
                <Empty icon={CheckCheck} title={t('lifecycle.nothing_to_read')} className="py-8" />
              ) : (
                <ul className="px-3.5 pb-1">
                  {docs.map((d) => (
                    <li key={d.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                      <FileText size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                      {d.letter !== '' ? (
                        <a href={`#/lifecycle/letters/${d.letter}`} className="hr-link hr-focus hr-wrap min-w-0 flex-1 rounded-[3px] text-[13px] font-medium pointer-coarse:-my-2.5 pointer-coarse:py-2.5">
                          {d.title}
                        </a>
                      ) : (
                        <button type="button" onClick={() => void download('documents.file', { document: d.id }, 'open').catch(() => undefined)} className="hr-link hr-focus hr-wrap min-w-0 flex-1 pointer-coarse:-my-2.5 pointer-coarse:py-2.5 cursor-pointer rounded-[3px] text-left text-[13px] font-medium">
                          {d.title}
                        </button>
                      )}
                      <Button size="sm" variant="primary" icon={CheckCheck} onClick={() => void ackDoc(d.id, d.letter)}>
                        {t('lifecycle.acknowledge')}
                      </Button>
                    </li>
                  ))}
                  {pages.map((p) => (
                    <li key={p.id} className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-hair)] py-2.5 last:border-b-0">
                      <BookOpen size={14} aria-hidden className="shrink-0 text-[var(--hr-muted)]" />
                      <a href={`#/lifecycle/handbook/${p.id}`} className="hr-link hr-focus hr-wrap min-w-0 flex-1 rounded-[3px] text-[13px] font-medium pointer-coarse:-my-2.5 pointer-coarse:py-2.5">
                        {p.title}
                      </a>
                      <StatusDot tone="warn" label={t('lifecycle.handbook_page')} />
                      <Button size="sm" onClick={() => navigate(`/lifecycle/handbook/${p.id}`)}>
                        {t('lifecycle.read')}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
    </>
  );
}
