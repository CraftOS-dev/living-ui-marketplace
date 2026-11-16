/**
 * Home (home-reports module), the first page everyone sees, per role:
 *   HR, payroll and finance: the setup guide until setup is done, the company
 *     globe (every office now, with the company's readouts around it), what
 *     needs you beside the pay runs at one height, twelve months of people and
 *     cost, then even panels (your AI agent, who is out, starting and leaving,
 *     open roles, expenses; components/home/even.tsx);
 *   managers: what needs you, their clock, the team today, team readouts and
 *     the manager widgets;
 *   everyone else: their own Home (pages/me/Home.tsx), clock and leave first.
 *
 * One combined read per page (home.admin, home.manager) draws every panel of
 * this module; it is sent while the page renders. The modules' Inbox
 * sections come from the shell's counts and their widgets mount once it
 * answered. The grid (components/home/grid.tsx) reads in page order at every
 * width and numbers only the panels this viewer sees, once it has settled.
 */
import { useMemo } from 'react';
import { AsideLink, attentionGroups, ClockCard, HOME_READS, NeedsYou, PayCalendar, PeopleCostChart, Readouts, SetupGuide, TeamToday, useModuleGroups, widgetsFor } from '../../components/home/parts.tsx';
import { EvenPlace, evenPanels } from '../../components/home/even.tsx';
import { CompanyGlobe } from '../../components/home/globe.tsx';
import { HomeGrid } from '../../components/home/grid.tsx';
import type { Place } from '../../components/home/grid.tsx';
import type { Tile } from '../../components/home/parts.tsx';
import { usePageOp } from '../../components/home/load.tsx';
import type { AdminHome, ManagerHome as ManagerData } from '../../components/home/types.ts';
import { LoadError, PageBody, PageHeader } from '../../components/ui.tsx';
import { allowed, can, isManager, useMe } from '../../lib/auth.tsx';
import type { PageProps, RouteDef } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { MeHome } from '../me/Home.tsx';
import { FirstPeople } from '../people/Start.tsx';

export const ADMIN_PERM = 'people:view|payroll:view|reports:view';

function meta(parts: (string | number | null | undefined)[]): string {
  return parts
    .filter((x) => x !== null && x !== undefined && x !== '')
    .join(' · ')
    .toUpperCase();
}

function AdminHomePage(): React.JSX.Element {
  const me = useMe();
  const live = usePageOp<AdminHome>('home.admin', {}, HOME_READS, 'home.admin');
  const d = live.data;
  const mod = useModuleGroups();
  const groups = useMemo(() => (d === null ? [] : attentionGroups(d.attention)).concat(mod.groups), [d, mod.groups]);
  const payView = allowed(me, 'payroll:view');
  const manager = isManager(me);
  const hasPeople = d !== null && d.readouts.headcount + d.readouts.starting_30 > 0;
  // The setup guide (admins) until every step is done; while nobody is in it leads with "Add your first people".
  const guide = d?.setup !== undefined && d.setup.done < d.setup.total;
  // Nobody in and no guide on screen: the kernel's first step on its own, for whoever may add people.
  const firstPeople = d !== null && !hasPeople && !guide && can(me, 'people', 'edit');
  const team = payView && manager && d?.team !== null && d?.team !== undefined ? d.team : null;
  const missing = d === null ? [] : [...new Set(d.cost_missing_fx.map((x) => x.currency))];
  // Every place in reading order; the grid numbers the ones this viewer sees.
  const places: Place[] = [];
  if (guide && d?.setup !== undefined) {
    const setup = d.setup;
    places.push({ key: 'setup', span: 12, numbers: 1, render: ([i]) => <SetupGuide index={i} setup={setup} /> });
  }
  if (firstPeople)
    places.push({
      key: 'first',
      span: 12,
      numbers: 0,
      render: () => (
        <section className="hr-panel hr-in">
          <FirstPeople />
        </section>
      ),
    });
  // The company globe: right after the setup guide (at the top once it is gone).
  if (d !== null && hasPeople && d.globe !== null && d.globe !== undefined) {
    const g = d.globe;
    places.push({ key: 'globe', span: 12, numbers: 1, render: ([i]) => <CompanyGlobe index={i} g={g} headcount={d.readouts.headcount} reporting={d.company.reporting_currency} /> });
  }
  // Needs you beside the pay runs (or, for a manager without payroll, the team today), at one height: the
  // partner sets the row's height from lg up and Needs you scrolls inside it; alone it takes its own height.
  const partner = payView ? 'pay' : manager ? 'team' : null;
  places.push({
    key: 'needs',
    span: partner !== null ? 7 : 12,
    numbers: 1,
    render: ([i]) =>
      partner !== null ? (
        <div className="relative lg:min-h-[220px]">
          <NeedsYou index={i} groups={groups} loading={d === null} settled={mod.done} scroll className="lg:absolute lg:inset-0" />
        </div>
      ) : (
        <NeedsYou index={i} groups={groups} loading={d === null} settled={mod.done} />
      ),
  });
  if (partner !== null) places.push({ key: 'side', span: 5, numbers: 1, render: ([i]) => (partner === 'pay' ? <PayCalendar index={i} pay={d?.pay ?? null} /> : <TeamToday index={i} board={d?.team ?? null} />) });
  if (d !== null && hasPeople) places.push({ key: 'chart', span: 12, numbers: 1, render: ([i]) => <PeopleCostChart index={i} series={d.series} currency={d.cost_currency} pay={d.pay_visible} missing={missing} /> });
  // Even panels, two to a row: equal width and height, each with one "See all" (your AI agent first; alone,
  // before anyone is in, it takes the row).
  const ready = live.answered && d !== null;
  if (d !== null) {
    const even = evenPanels(me, team !== null, hasPeople);
    for (const k of even) places.push({ key: 'even.' + k, span: 6, keep: even.length > 1, numbers: 1, render: ([i]) => <EvenPlace k={k} index={i} ready={ready} team={team} agent={d.agent} /> });
  }
  return (
    <>
      <PageHeader title={t('home.title')} meta={d === null ? fmtDay(me.today, { weekday: true }).toUpperCase() : meta([d.company.name, tn('home.meta.entities', d.company.entities), tn('home.meta.people', d.readouts.headcount), fmtDay(d.today, { weekday: true })])} />
      <PageBody>{live.error !== null && d === null ? <LoadError message={live.error} onRetry={live.reload} /> : <HomeGrid places={places} ready={ready} painted={d !== null} />}</PageBody>
    </>
  );
}

function ManagerHomePage(): React.JSX.Element {
  const me = useMe();
  const live = usePageOp<ManagerData>('home.manager', {}, ['approvals', 'employments', 'job_records', 'leave_requests', 'checkins', 'attendance', 'shift_assignments'], 'home.manager');
  const d = live.data;
  const mod = useModuleGroups();
  const groups = useMemo(() => (d === null ? [] : attentionGroups(d.attention)).concat(mod.groups), [d, mod.groups]);
  const tiles: Tile[] =
    d === null
      ? []
      : [
          { key: 'team', label: t('home.kpi.team'), value: d.team, aside: <span className="hr-label">{tn('home.kpi.direct', d.direct)}</span>, href: '#/people' },
          { key: 'out', label: t('home.kpi.out_today'), value: d.readouts.out_today, aside: <span className="hr-label">{t('home.kpi.of_people', { n: d.team })}</span>, href: '#/leave/calendar' },
          { key: 'leave', label: t('home.kpi.leave_month'), value: d.readouts.leave_days_month, aside: <span className="hr-label">{t('home.kpi.days')}</span>, href: '#/leave/calendar' },
          { key: 'prob', label: t('home.kpi.probation'), value: d.readouts.probation_30, href: '#/people' },
        ];
  const clockOn = me.employee !== null;
  const places: Place[] = [
    { key: 'needs', span: 7, numbers: 1, render: ([i]) => <NeedsYou index={i} groups={groups} loading={d === null} settled={mod.done} emptyText={t('home.all_clear_team')} /> },
    {
      key: 'side',
      span: 5,
      numbers: clockOn ? 2 : 1,
      render: (ix) => (
        <>
          {clockOn && <ClockCard compact index={ix[0]} clock={d?.clock ?? null} />}
          <TeamToday index={ix[ix.length - 1]} board={d?.board ?? null} team={d?.team} />
        </>
      ),
    },
  ];
  if (d !== null) places.push({ key: 'readouts', span: 12, numbers: 1, render: ([i]) => <Readouts index={i} tiles={tiles} /> });
  for (const w of widgetsFor('manager')) places.push({ key: 'w.' + w.key, widget: w });
  return (
    <>
      <PageHeader title={t('home.title')} meta={meta([me.company.name, d !== null ? tn('home.meta.team', d.team) : '', fmtDay(me.today, { weekday: true })])} />
      <PageBody>{live.error !== null && d === null ? <LoadError message={live.error} onRetry={live.reload} /> : <HomeGrid places={places} ready={live.answered && d !== null} painted={d !== null} />}</PageBody>
    </>
  );
}

function HomePage(_props: PageProps): React.JSX.Element {
  const me = useMe();
  if (allowed(me, ADMIN_PERM)) return <AdminHomePage />;
  if (isManager(me)) return <ManagerHomePage />;
  return <MeHome />;
}

export const routes: RouteDef[] = [{ path: '/home', page: HomePage, title: t('home.title') }];

export { AsideLink };
