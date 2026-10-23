/**
 * Research OS: a research workspace. A library of papers with their PDFs,
 * a reader whose text layer the app stores (so every quote matches its page),
 * projects with questions, claims and evidence, a to-do list, boards, a
 * writing desk and systematic reviews. Your AI agent operates the same operations
 * through the agent-app CLI; what it judges waits for you to confirm.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { Suspense, lazy } from 'react';
import { getPbClient } from '../kit/index.ts';
import { AddPapersProvider } from './components/AddPapers.tsx';
import { AskProvider } from './components/agent.tsx';
import { PaletteProvider } from './components/Palette.tsx';
import { Frame } from './components/Shell.tsx';
import { MenuProvider, Spinner } from './components/ui.tsx';
import { AppDataProvider } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';

const HomePage = lazy(() => import('./pages/Home.tsx'));
const LibraryPage = lazy(() => import('./pages/Library.tsx'));
const PaperPage = lazy(() => import('./pages/Paper.tsx'));
const ReaderPage = lazy(() => import('./pages/Reader.tsx'));
const ProjectsPage = lazy(() => import('./pages/Projects.tsx'));
const ProjectPage = lazy(() => import('./pages/Project.tsx'));
const DiscoverPage = lazy(() => import('./pages/Discover.tsx'));
const NotesPage = lazy(() => import('./pages/Notes.tsx'));
const AgentPage = lazy(() => import('./pages/Agent.tsx'));
const ActivityPage = lazy(() => import('./pages/Activity.tsx'));
const SettingsPage = lazy(() => import('./pages/Settings.tsx'));

getPbClient().pb.autoCancellation(false);
startThemeColors();
startLive();
trackTrail();

const WIDE: Page[] = ['library', 'read', 'project', 'notes'];

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'library':
      return <LibraryPage query={query} />;
    case 'paper':
      return <PaperPage id={query.get('id') ?? ''} />;
    case 'read':
      return <ReaderPage file={query.get('file') ?? ''} page={Number(query.get('page') ?? '0')} />;
    case 'projects':
      return <ProjectsPage />;
    case 'project':
      return <ProjectPage query={query} />;
    case 'discover':
      return <DiscoverPage query={query} />;
    case 'notes':
      return <NotesPage query={query} />;
    case 'agent':
      return <AgentPage query={query} />;
    case 'activity':
      return <ActivityPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

/** Which address changes remount a page (filters and tabs update in place). */
function keyOf(page: Page, q: URLSearchParams): string {
  if (page === 'read') return 'read:' + (q.get('file') ?? '');
  if (page === 'project') return 'project:' + (q.get('id') ?? '');
  if (page === 'paper') return 'paper:' + (q.get('id') ?? '');
  return page;
}

function Root(): React.JSX.Element {
  const route = useRoute();
  const wide = WIDE.includes(route.page);
  return (
    <Frame page={route.page} wide={wide}>
      <Suspense
        fallback={
          <div className="flex h-[60vh] items-center justify-center">
            <Spinner size={20} className="text-[var(--ro-ink)]" />
          </div>
        }
      >
        <div key={keyOf(route.page, route.query)} className={wide ? 'h-full' : undefined}>
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
        <AddPapersProvider>
          <AskProvider>
            <PaletteProvider>
              <Root />
            </PaletteProvider>
          </AskProvider>
        </AddPapersProvider>
      </MenuProvider>
    </AppDataProvider>
  );
}
