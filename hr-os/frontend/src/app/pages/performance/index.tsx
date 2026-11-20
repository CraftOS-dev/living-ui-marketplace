/**
 * Performance: goals and OKRs, review cycles and the review form,
 * calibration, continuous feedback and praise, the skills matrix and
 * training. The root page (/performance) serves every role: it opens on
 * what the viewer owes. Exports the module page contract (routes.tsx).
 */
import { useMemo, useState } from 'react';
import { Heart, Plus, Target } from 'lucide-react';
import { Button, Empty, LoadError, Panel, RowCue, Skeleton } from '../../components/ui.tsx';
import { FeedbackDialog, GoalDialog } from '../../components/performance/dialogs.tsx';
import { AsideLink, GoalStatusDot, kindLabel, ProgressBar } from '../../components/performance/bits.tsx';
import type { FeedbackRow, Goal, GoalList, Owed } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { useMe } from '../../lib/auth.tsx';
import type { HomeWidget, HomeWidgetProps, InboxItem, InboxSection, NavChild, ProfileTab, RouteDef } from '../../lib/contract.ts';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { CalibrationPage } from './Calibration.tsx';
import { CyclePage, CyclesPage } from './Cycles.tsx';
import { CycleWizard } from './CycleWizard.tsx';
import { FeedbackPage } from './Feedback.tsx';
import { GoalPage } from './GoalPage.tsx';
import { GoalsPage } from './Goals.tsx';
import { PerformanceHome } from './Home.tsx';
import { PerformanceTab } from './ProfileTab.tsx';
import { ReviewPage } from './Review.tsx';
import { SettingsPage } from './Settings.tsx';
import { SkillsPage } from './Skills.tsx';
import { SessionPage, TrainingPage } from './Training.tsx';

export const routes: RouteDef[] = [
  { path: '/performance', page: PerformanceHome, title: t('perf.title') },
  { path: '/performance/goals', page: GoalsPage, title: t('perf.goals.title') },
  { path: '/performance/goals/:id', page: GoalPage, title: t('perf.goal.goal') },
  { path: '/performance/cycles', page: CyclesPage, title: t('perf.cycles.title') },
  { path: '/performance/cycles/new', page: CycleWizard, title: t('perf.wiz.title'), perm: 'performance:full' },
  { path: '/performance/cycles/:id/edit', page: CycleWizard, title: t('perf.wiz.edit_title'), perm: 'performance:full' },
  { path: '/performance/cycles/:id', page: CyclePage, title: t('perf.cycles.title') },
  { path: '/performance/reviews/:id', page: ReviewPage, title: t('perf.review.title') },
  { path: '/performance/calibration', page: CalibrationPage, title: t('perf.calib.title'), perm: 'performance:view|team' },
  { path: '/performance/feedback', page: FeedbackPage, title: t('perf.fb.title') },
  { path: '/performance/skills', page: SkillsPage, title: t('perf.skills.title') },
  { path: '/performance/training', page: TrainingPage, title: t('perf.tr.title') },
  { path: '/performance/training/:id', page: SessionPage, title: t('perf.tr.title') },
  { path: '/performance/settings', page: SettingsPage, title: t('perf.set.title'), perm: 'performance:view' },
];

export const nav: NavChild[] = [
  { key: 'goals', label: t('perf.goals.title'), to: '/performance/goals' },
  { key: 'cycles', label: t('perf.cycles.nav'), to: '/performance/cycles' },
  { key: 'calibration', label: t('perf.calib.title'), to: '/performance/calibration', perm: 'performance:view|team' },
  { key: 'feedback', label: t('perf.fb.title'), to: '/performance/feedback' },
  { key: 'skills', label: t('perf.skills.title'), to: '/performance/skills' },
  { key: 'training', label: t('perf.tr.title'), to: '/performance/training' },
  { key: 'settings', label: t('perf.set.nav'), to: '/performance/settings', perm: 'performance:view' },
];

export const profileTabs: ProfileTab[] = [{ key: 'performance', label: t('perf.title'), component: PerformanceTab, order: 70, perm: 'performance:view', selfAndTeam: true }];

interface InboxData {
  reviews: Owed[];
  acknowledge: { participant: string; review: string; cycle: { id: string; name: string } }[];
  requests: { id: string; from: { name: string } | null; text: string; due: string }[];
}

/** Inbox: the reviews you owe or should read, and feedback requests to answer (one light read). */
function useInboxItems(): InboxItem[] | null {
  const me = useMe();
  const live = useOp<InboxData>('perf.inbox', {}, [...READS.reviews, ...READS.feedback], { name: 'perf.inbox', skip: me.employee === null });
  return useMemo(() => {
    if (me.employee === null) return [];
    if (live.data === null) return null;
    const out: InboxItem[] = [];
    for (const r of live.data.reviews) out.push({ id: `rv:${r.review}`, title: r.kind === 'self' ? t('perf.home.owe_self') : t('perf.home.owe_other', { kind: kindLabel(r.kind).toLowerCase(), name: r.employee?.name ?? '' }), sub: r.cycle.name, link: `#/performance/reviews/${r.review}`, due: r.due, person: r.kind === 'self' ? undefined : r.employee?.name });
    for (const a of live.data.acknowledge) out.push({ id: `ack:${a.participant}`, title: t('perf.home.read_review'), sub: a.cycle.name, link: `#/performance/reviews/${a.review}` });
    for (const f of live.data.requests) out.push({ id: `fr:${f.id}`, title: t('perf.home.answer_request', { name: f.from?.name ?? '' }), sub: f.text, link: '#/performance/feedback?view=requests', due: f.due, person: f.from?.name });
    return out;
  }, [me.employee, live.data]);
}

export const inboxSections: InboxSection[] = [{ key: 'performance', label: t('perf.inbox.label'), useItems: useInboxItems, order: 40 }];

/** While a widget's read is out: a quiet skeleton, never its empty state. */
function WidgetLoading(): React.JSX.Element {
  return (
    <div className="flex flex-col gap-2.5 py-1" role="status" aria-label={t('ui.loading')}>
      <Skeleton className="w-3/5" />
      <Skeleton className="w-2/5" />
    </div>
  );
}

function GoalsWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const me = useMe();
  const [adding, setAdding] = useState(false);
  const live = useOp<GoalList>('goals.list', { view: me.employee !== null ? 'mine' : 'company', needs_update: true, limit: 5 }, READS.goals, { name: 'perf.widget.goals' });
  const goals: Goal[] = live.data?.goals ?? [];
  return (
    <Panel index={index} label={t('perf.widget.goals')} aside={<AsideLink href="#/performance/goals">{t('perf.home.all_goals')}</AsideLink>}>
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <WidgetLoading />
        )
      ) : goals.length === 0 ? (
        <Empty
          icon={Target}
          title={t('perf.home.goals_fine')}
          className="py-6"
          action={
            me.employee !== null ? (
              <Button icon={Plus} onClick={() => setAdding(true)}>
                {t('perf.goal.add')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col">
          {goals.map((g) => (
            <li key={g.id}>
              <a href={`#/performance/goals/${g.id}`} className="group relative pr-10 hr-focus flex flex-col gap-1 rounded-[var(--hr-radius-sm)] border-b border-[var(--hr-hair)] px-1.5 py-2 last:border-b-0 hover:bg-[var(--hr-hover)]">
                <span className="hr-wrap text-[13px] font-medium">{g.title}</span>
                <span className="flex items-center gap-2">
                  <GoalStatusDot status={g.status} />
                  <ProgressBar value={g.progress} status={g.status} className="flex-1" label={g.title} />
                </span>
                <RowCue className="absolute right-4 top-1/2 -translate-y-1/2" />
              </a>
            </li>
          ))}
        </ul>
      )}
      {adding && <GoalDialog open onClose={() => setAdding(false)} />}
    </Panel>
  );
}

function PraiseWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const me = useMe();
  const [giving, setGiving] = useState(false);
  const live = useOp<{ feedback: FeedbackRow[] }>('feedback.list', { view: 'wall', limit: 4 }, READS.feedback, { name: 'perf.widget.praise' });
  const rows = live.data?.feedback ?? [];
  return (
    <Panel index={index} label={t('perf.widget.praise')} aside={<AsideLink href="#/performance/feedback">{t('perf.fb.wall')}</AsideLink>}>
      {live.data === null ? (
        live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : (
          <WidgetLoading />
        )
      ) : rows.length === 0 ? (
        <Empty
          icon={Heart}
          title={t('perf.home.no_praise')}
          className="py-6"
          action={
            me.employee !== null ? (
              <Button icon={Heart} onClick={() => setGiving(true)}>
                {t('perf.fb.give_praise')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((p) => (
            <li key={p.id} className="border-l-2 border-[var(--hr-line-2)] pl-2.5">
              <div className="text-[12px] text-[var(--hr-muted)]">
                {t('perf.widget.praise_line', { from: p.from?.name ?? p.from_name, to: p.to?.name ?? '' })} · {ago(p.created)}
              </div>
              <p className="hr-wrap text-[13px] leading-5">{p.text}</p>
            </li>
          ))}
        </ul>
      )}
      {giving && <FeedbackDialog open onClose={() => setGiving(false)} kind="praise" />}
    </Panel>
  );
}

export const homeWidgets: HomeWidget[] = [
  { key: 'perf_goals_employee', for: 'employee', component: GoalsWidget, order: 40, size: 'narrow' },
  { key: 'perf_goals_manager', for: 'manager', component: GoalsWidget, order: 40, size: 'narrow' },
  { key: 'perf_praise_employee', for: 'employee', component: PraiseWidget, order: 60, size: 'narrow' },
  { key: 'perf_praise_manager', for: 'manager', component: PraiseWidget, order: 60, size: 'narrow' },
  { key: 'perf_praise_admin', for: 'admin', component: PraiseWidget, order: 60, size: 'narrow' },
];
