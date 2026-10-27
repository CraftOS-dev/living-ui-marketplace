/**
 * One part of life. Each has its own tool at the top (Health: water,
 * sleep, steps, weight and workouts; Money: the month, a quick spend, jars
 * and bills; the people areas: faces, birthdays and plans; Work: a focus
 * timer and wins; Growth: a bookshelf and things being learned; Fun: trips
 * and a bucket list; Home: chores by room and the shopping list; Mind: a
 * mood calendar and breathing). Under it: its goals, its habits and its
 * cards.
 */
import { lazy, Suspense } from 'react';
import { EyeOff } from 'lucide-react';
import { op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { changed, READS, useLive } from '../lib/live.ts';
import { href, navigate } from '../lib/router.ts';
import type { AreaPage as AreaData } from '../lib/types.ts';
import { AREA_BLURB, AREA_KINDS, AREA_NAMES, AreaArt, HabitArt } from '../components/art.tsx';
import type { AreaKind } from '../components/art.tsx';
import { ColumnArt, ThingArt } from '../components/art2.tsx';
import { kindColor, switchArea } from '../components/bits.tsx';
import { Panel, PanelLink } from '../components/panel.tsx';
import { GoalTrail, NewGoalButton, useGoalPanel } from '../components/goals.tsx';
import { HabitIdeas, HabitTile, ideasFor } from '../components/habits.tsx';
import { snack } from '../components/snack.tsx';
import { QuickAdd, TaskRow } from '../components/tasks.tsx';
import { Button, LoadError, Skeleton } from '../components/ui.tsx';

const HealthTool = lazy(() => import('../components/areas/Health.tsx'));
const MoneyTool = lazy(() => import('../components/areas/Money.tsx'));
const PeopleTool = lazy(() => import('../components/areas/People.tsx'));
const WorkTool = lazy(() => import('../components/areas/Work.tsx'));
const GrowthTool = lazy(() => import('../components/areas/Growth.tsx'));
const FunTool = lazy(() => import('../components/areas/Fun.tsx'));
const HomeTool = lazy(() => import('../components/areas/HomeArea.tsx'));
const MindTool = lazy(() => import('../components/areas/Mind.tsx'));

function Tool({ kind }: { kind: AreaKind }): React.JSX.Element {
  switch (kind) {
    case 'health':
      return <HealthTool />;
    case 'money':
      return <MoneyTool />;
    case 'relationships':
      return <PeopleTool />;
    case 'work':
      return <WorkTool />;
    case 'growth':
      return <GrowthTool />;
    case 'fun':
      return <FunTool />;
    case 'home':
      return <HomeTool />;
    case 'mind':
      return <MindTool />;
  }
}

export default function AreaPage({ kind: raw }: { kind: string }): React.JSX.Element {
  const kind = (AREA_KINDS as string[]).includes(raw) ? (raw as AreaKind) : 'health';
  const status = useStatus().data;
  const goals = useGoalPanel();
  const live = useLive<AreaData>((signal) => op('life.area', { area: kind }, { quiet: true, signal }), READS.life, [kind]);
  const d = live.data;
  const today = status?.today ?? '';
  const off = async (): Promise<void> => {
    snack(`${AREA_NAMES[kind]} is put away. Turn it on again in My life`, { undo: false });
    navigate('life');
    await switchArea(kind, false);
  };
  const open = (d?.tasks ?? []).filter((t) => t.state === 'open');
  return (
    <div>
      <header className="relative overflow-hidden border-b border-[var(--lo-hair)]" style={{ background: kindColor(kind, 'soft') }}>
        <div className="mx-auto flex max-w-[1320px] items-center gap-5 px-5 py-6 md:px-8">
          <span className="relative shrink-0">
            <span aria-hidden className="absolute inset-x-2 bottom-1 h-6 rounded-[50%] bg-[var(--lo-card)] opacity-60" />
            <AreaArt kind={kind} size={112} className="relative" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[13px] font-bold" style={{ color: kindColor(kind, 'text') }}>
              {AREA_BLURB[kind]}
            </p>
            <h1 className="serif text-[26px] font-semibold leading-9">{AREA_NAMES[kind]}</h1>
            {d !== null && <p className="mt-0.5 text-[14px] font-semibold text-[var(--lo-ink-2)]">{d.area.pulse.line}</p>}
          </div>
          {d !== null && d.area.enabled && (
            <Button variant="ghost" size="sm" icon={EyeOff} onClick={() => void off()} className="hidden sm:inline-flex" title="Take this part of life off your island">
              Put away
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto grid max-w-[1320px] grid-cols-1 items-start gap-5 px-4 pb-12 pt-5 md:px-8 xl:grid-cols-12">
        {/* The area's own tool. */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-8">
          <Suspense fallback={<Skeleton className="h-48 w-full" />}>
            <Tool kind={kind} />
          </Suspense>
        </div>

        {/* The same three things on every area: its goals, its cards, its habits. */}
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-4">
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <Skeleton className="h-32 w-full" />
            )
          ) : (
            <>
              <Panel title="Goals" art={<ThingArt kind="flag" size={24} />} note={d.goals.length > 0 ? String(d.goals.length) : undefined} bodyClassName="p-2 md:p-3">
                <div className="flex flex-col">
                  {d.goals.map((g) => (
                    <GoalTrail key={g.id} goal={g} onOpen={() => goals.open(g.id)} />
                  ))}
                </div>
                <div className={d.goals.length > 0 ? 'mt-2 px-1' : 'px-1'}>
                  <NewGoalButton area={kind} label={d.goals.length === 0 ? 'Set a goal here' : 'Another goal'} />
                </div>
                {d.done_goals.length > 0 && <p className="mt-2 px-2 text-[12px] font-semibold text-[var(--lo-muted)]">{d.done_goals.length} reached before: {d.done_goals.map((g) => g.title).join(', ')}</p>}
              </Panel>

              <Panel title="To do" art={<ColumnArt kind="today" size={24} />} note={open.length > 0 ? String(open.length) : undefined} action={<PanelLink to={href('board', { area: kind })}>Board</PanelLink>}>
                <QuickAdd defaults={{ area: kind, column: 'today' }} placeholder={`Something for ${AREA_NAMES[kind].toLowerCase()}`} />
                {open.length > 0 ? (
                  <div className="-mx-2 mt-1.5 flex flex-col">
                    {open.map((t) => (
                      <TaskRow key={t.id} task={t} today={today} showArea={false} />
                    ))}
                  </div>
                ) : (
                  <p className="px-1 pt-2 text-[13px] text-[var(--lo-muted)]">Nothing waiting here.</p>
                )}
              </Panel>

              {(d.habits.length > 0 || ideasFor(d.habits, kind, []).length > 0) && (
                <Panel title="Habits" art={<HabitArt art="sprout" size={24} />} action={<PanelLink to={href('habits')}>Tracker</PanelLink>}>
                  {d.habits.length > 0 && (
                    <div className="mb-4 grid grid-cols-3 justify-items-center gap-y-4">
                      {d.habits.map((h) => (
                        <HabitTile key={h.id} habit={h} size="sm" />
                      ))}
                    </div>
                  )}
                  <HabitIdeas have={d.habits} area={kind} limit={4} />
                </Panel>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
