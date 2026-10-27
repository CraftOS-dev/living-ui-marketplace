/**
 * Life OS: a life on one screen. Home shows today (the weather, the news,
 * your AI agent's note, the list, the habits to tap); the board holds every
 * card; the habits tracker; My life with each part of life as its own place
 * and its own tool (Health, Money, Friends and family, Work, Home, Growth,
 * Fun, Mind) and the goals that count themselves; projects as
 * journeys; the journal as a page of paper. Your AI agent works through the
 * same operations and hands bigger changes back to keep.
 */
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/nunito';
import './theme.css';
import { Suspense, lazy } from 'react';
import { getPbClient } from '../kit/index.ts';
import { GoalPanelProvider } from './components/goals.tsx';
import { HabitPanelProvider } from './components/habits.tsx';
import { CaptureProvider, PaletteProvider } from './components/overlays.tsx';
import { PersonPanelProvider } from './components/people.tsx';
import { Frame } from './components/Shell.tsx';
import { Snackbar } from './components/snack.tsx';
import { TaskPanelProvider } from './components/tasks.tsx';
import { MenuProvider, Spinner } from './components/ui.tsx';
import { AppDataProvider, useStatus } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';

const HomePage = lazy(() => import('./pages/Home.tsx'));
const WelcomePage = lazy(() => import('./pages/Welcome.tsx'));
const BoardPage = lazy(() => import('./pages/Board.tsx'));
const HabitsPage = lazy(() => import('./pages/Habits.tsx'));
const LifePage = lazy(() => import('./pages/Life.tsx'));
const AreaPage = lazy(() => import('./pages/Area.tsx'));
const ProjectsPage = lazy(() => import('./pages/Projects.tsx'));
const ProjectPage = lazy(() => import('./pages/Project.tsx'));
const JournalPage = lazy(() => import('./pages/Journal.tsx'));
const AgentPage = lazy(() => import('./pages/Agent.tsx'));
const SettingsPage = lazy(() => import('./pages/Settings.tsx'));

/** Once the first screen is up, fetch every page's code quietly, so moving around never waits for it. */
function warm(): void {
  const all = [
    () => import('./pages/Home.tsx'),
    () => import('./pages/Board.tsx'),
    () => import('./pages/Habits.tsx'),
    () => import('./pages/Life.tsx'),
    () => import('./pages/Area.tsx'),
    () => import('./pages/Projects.tsx'),
    () => import('./pages/Project.tsx'),
    () => import('./pages/Journal.tsx'),
    () => import('./pages/Agent.tsx'),
    () => import('./pages/Settings.tsx'),
    () => import('./components/areas/Health.tsx'),
    () => import('./components/areas/Money.tsx'),
    () => import('./components/areas/People.tsx'),
    () => import('./components/areas/Work.tsx'),
    () => import('./components/areas/Growth.tsx'),
    () => import('./components/areas/Fun.tsx'),
    () => import('./components/areas/HomeArea.tsx'),
    () => import('./components/areas/Mind.tsx'),
  ];
  for (const f of all) void f().catch(() => undefined);
}
if (typeof window !== 'undefined') window.setTimeout(warm, 1200);

getPbClient().pb.autoCancellation(false);
startThemeColors();
startLive();
trackTrail();

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  const status = useStatus().data;
  switch (page) {
    case 'welcome':
      return <WelcomePage />;
    case 'board':
      return <BoardPage query={query} />;
    case 'habits':
      return <HabitsPage />;
    case 'life':
      return <LifePage />;
    case 'area':
      return <AreaPage kind={query.get('kind') ?? ''} />;
    case 'projects':
      return <ProjectsPage query={query} />;
    case 'project':
      return <ProjectPage id={query.get('id') ?? ''} />;
    case 'journal':
      return <JournalPage query={query} />;
    case 'agent':
      return <AgentPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return status !== null && !status.onboarded ? <WelcomePage /> : <HomePage />;
  }
}

/** Which address changes remount a page (filters and tabs update in place). */
function keyOf(page: Page, q: URLSearchParams): string {
  if (page === 'project') return page + ':' + (q.get('id') ?? '');
  if (page === 'area') return page + ':' + (q.get('kind') ?? '');
  if (page === 'journal') return page + ':' + (q.get('entry') ?? '');
  return page;
}

function Root(): React.JSX.Element {
  const route = useRoute();
  const status = useStatus().data;
  // The first run fills the window (no sidebar): nothing in it leads anywhere yet.
  if (route.page === 'welcome' || (route.page === 'home' && status !== null && !status.onboarded))
    return (
      <main id="lo-main" data-scroll className="lo-paper h-dvh w-full overflow-y-auto overflow-x-hidden bg-[var(--lo-paper)] text-[var(--lo-ink)]">
        <Suspense fallback={null}>
          <WelcomePage />
        </Suspense>
      </main>
    );
  return (
    <Frame page={route.page} query={route.query}>
      <Suspense
        fallback={
          <div className="flex h-[60vh] items-center justify-center">
            <Spinner size={22} className="text-[var(--lo-moss)]" />
          </div>
        }
      >
        <div key={keyOf(route.page, route.query)}>
          <Content page={route.page} query={route.query} />
        </div>
      </Suspense>
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <MenuProvider>
        <TaskPanelProvider>
          <HabitPanelProvider>
            <PersonPanelProvider>
              <GoalPanelProvider>
                <CaptureProvider>
                  <PaletteProvider>
                    <Root />
                    <Snackbar />
                  </PaletteProvider>
                </CaptureProvider>
              </GoalPanelProvider>
            </PersonPanelProvider>
          </HabitPanelProvider>
        </TaskPanelProvider>
      </MenuProvider>
    </AppDataProvider>
  );
}
