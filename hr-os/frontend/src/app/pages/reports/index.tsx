/**
 * Reports (home-reports module): the hub that lists every report in the
 * app (the people analytics here, and the modules' own reports by their
 * routes), and one page per people analytics report.
 */
import { useMemo } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, Banknote, BriefcaseBusiness, CalendarDays, ChartColumn, ChartLine, Clock, GraduationCap, Landmark, Network, PieChart, Receipt, Scale, Timer, TrendingUp, UserPlus, Users, Wallet } from 'lucide-react';
import { PageBody, PageHeader, Panel } from '../../components/ui.tsx';
import { resolve } from '../../components/shell/Frame.tsx';
import { allowed, useMe } from '../../lib/auth.tsx';
import type { NavChild, PageProps, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { allRoutes } from '../../routes.tsx';
import { AbsenceReport, CompBandsReport, CostReport, DiversityReport, HeadcountReport, HiringReport, LiabilityReport, MovementReport, SpanReport, TenureReport, TrainingReport } from './Views.tsx';

interface Entry {
  key: string;
  group: 'people' | 'pay' | 'time' | 'hiring' | 'growth';
  icon: LucideIcon;
  to: string;
  perm: string;
  mine: boolean;
}

/** Every report people can open, in the hub's groups. Module reports are listed by their routes. */
const CATALOG: Entry[] = [
  { key: 'headcount', group: 'people', icon: Users, to: '/reports/headcount', perm: 'reports:view', mine: true },
  { key: 'movement', group: 'people', icon: TrendingUp, to: '/reports/movement', perm: 'reports:view', mine: true },
  { key: 'tenure', group: 'people', icon: Timer, to: '/reports/tenure', perm: 'reports:view', mine: true },
  { key: 'span', group: 'people', icon: Network, to: '/reports/span', perm: 'reports:view', mine: true },
  { key: 'diversity', group: 'people', icon: PieChart, to: '/reports/diversity', perm: 'reports:view', mine: true },
  { key: 'org', group: 'people', icon: Network, to: '/people/org', perm: 'people:view|team', mine: false },
  { key: 'cost', group: 'pay', icon: ChartColumn, to: '/reports/cost', perm: 'payroll:view', mine: true },
  { key: 'comp-bands', group: 'pay', icon: Scale, to: '/reports/comp-bands', perm: 'payroll:view', mine: true },
  { key: 'register', group: 'pay', icon: Banknote, to: '/payroll/reports', perm: 'payroll:view|reports:view', mine: false },
  { key: 'remittance', group: 'pay', icon: Landmark, to: '/payroll/reports', perm: 'payroll:view|reports:view', mine: false },
  { key: 'filings', group: 'pay', icon: Landmark, to: '/payroll/filings', perm: 'payroll:view', mine: false },
  { key: 'year-end', group: 'pay', icon: Wallet, to: '/payroll/year-end', perm: 'payroll:view', mine: false },
  { key: 'leave-liability', group: 'time', icon: CalendarDays, to: '/reports/leave-liability', perm: 'reports:view|leave:view', mine: true },
  { key: 'absence', group: 'time', icon: Clock, to: '/reports/absence', perm: 'reports:view', mine: true },
  { key: 'balances', group: 'time', icon: CalendarDays, to: '/leave/balances', perm: 'leave:view|team', mine: false },
  { key: 'leave-register', group: 'time', icon: CalendarDays, to: '/leave/register', perm: 'leave:view', mine: false },
  { key: 'attendance', group: 'time', icon: Clock, to: '/time/attendance', perm: 'time:view|team', mine: false },
  { key: 'spend', group: 'time', icon: Receipt, to: '/expenses/claims', perm: 'expenses:view', mine: false },
  { key: 'hiring', group: 'hiring', icon: UserPlus, to: '/reports/hiring', perm: 'reports:view|hiring:view', mine: true },
  { key: 'plans', group: 'hiring', icon: BriefcaseBusiness, to: '/hiring/plans', perm: 'hiring:view', mine: false },
  { key: 'training', group: 'growth', icon: GraduationCap, to: '/reports/training', perm: 'reports:view|performance:view', mine: true },
  { key: 'calibration', group: 'growth', icon: ChartLine, to: '/performance/calibration', perm: 'performance:view', mine: false },
  { key: 'skills', group: 'growth', icon: GraduationCap, to: '/performance/skills', perm: 'performance:view|team', mine: false },
];

const QUERY: Record<string, string> = { register: '', remittance: '?tab=remittance' };

function HubPage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  const routes = useMemo(() => allRoutes(), []);
  const groups = useMemo(() => {
    const out: Record<Entry['group'], Entry[]> = { people: [], pay: [], time: [], hiring: [], growth: [] };
    for (const e of CATALOG) if (allowed(me, e.perm) && resolve(e.to, routes) !== null) out[e.group].push(e);
    return out;
  }, [me, routes]);
  const order: Entry['group'][] = ['people', 'pay', 'time', 'hiring', 'growth'];
  const count = order.reduce((a, g) => a + groups[g].length, 0);
  return (
    <>
      <PageHeader title={t('rep.title')} meta={t('rep.meta', { n: count })} />
      <PageBody>
        {/* One column: the report groups stack full width in a readable measure. */}
        <div className="flex max-w-[1200px] flex-col gap-3" data-ready="">
          {order
            .filter((g) => groups[g].length > 0)
            .map((g, gi) => (
              <Panel key={g} index={'0' + (gi + 1)} label={t('rep.group.' + g)} flush>
                <ul className="border-t border-[var(--hr-hair)]">
                  {groups[g].map((e) => {
                    const Icon = e.icon;
                    return (
                      <li key={e.key}>
                        <a href={'#' + e.to + (QUERY[e.key] ?? '')} className="hr-focus group flex min-h-11 min-w-0 items-center gap-3 border-b border-[var(--hr-hair)] px-3.5 py-2.5 transition-colors last:border-b-0 hover:bg-[var(--hr-hover)]">
                          <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--hr-line-2)] text-[var(--hr-ink-2)]">
                            <Icon size={13} strokeWidth={1.9} aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium">{t('rep.e.' + e.key)}</span>
                            <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{t('rep.e.' + e.key + '_sub')}</span>
                          </span>
                          {!e.mine && <span className="hr-label hidden shrink-0 sm:inline">{t('rep.module.' + e.to.split('/')[1])}</span>}
                          <ArrowRight size={14} aria-hidden className="shrink-0 text-[var(--hr-faint)] transition-transform group-hover:translate-x-0.5 group-hover:text-[var(--hr-ink)]" />
                        </a>
                      </li>
                    );
                  })}
                </ul>
              </Panel>
            ))}
        </div>
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [
  { path: '/reports', page: HubPage, title: t('rep.title'), perm: 'reports:view|payroll:view|leave:view|hiring:view|performance:view' },
  { path: '/reports/headcount', page: HeadcountReport, title: t('rep.headcount.title'), perm: 'reports:view' },
  { path: '/reports/movement', page: MovementReport, title: t('rep.movement.title'), perm: 'reports:view' },
  { path: '/reports/tenure', page: TenureReport, title: t('rep.tenure.title'), perm: 'reports:view' },
  { path: '/reports/span', page: SpanReport, title: t('rep.span.title'), perm: 'reports:view' },
  { path: '/reports/diversity', page: DiversityReport, title: t('rep.diversity.title'), perm: 'reports:view' },
  { path: '/reports/comp-bands', page: CompBandsReport, title: t('rep.comp.title'), perm: 'payroll:view' },
  { path: '/reports/cost', page: CostReport, title: t('rep.cost.title'), perm: 'payroll:view' },
  { path: '/reports/leave-liability', page: LiabilityReport, title: t('rep.liability.title'), perm: 'reports:view|leave:view' },
  { path: '/reports/absence', page: AbsenceReport, title: t('rep.absence.title'), perm: 'reports:view' },
  { path: '/reports/hiring', page: HiringReport, title: t('rep.hiring.title'), perm: 'reports:view|hiring:view' },
  { path: '/reports/training', page: TrainingReport, title: t('rep.training.title'), perm: 'reports:view|performance:view' },
];

export const nav: NavChild[] = [
  { key: 'headcount', label: t('rep.nav.headcount'), to: '/reports/headcount', perm: 'reports:view' },
  { key: 'movement', label: t('rep.nav.movement'), to: '/reports/movement', perm: 'reports:view' },
  { key: 'cost', label: t('rep.nav.cost'), to: '/reports/cost', perm: 'payroll:view' },
  { key: 'absence', label: t('rep.nav.absence'), to: '/reports/absence', perm: 'reports:view' },
];
