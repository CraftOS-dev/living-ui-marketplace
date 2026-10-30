/**
 * Image Utility: crop, resize, adjust, cut out, mark up with layers (text,
 * arrows, boxes, steps, redactions, logos) and export images on this
 * computer, one at a time or in batches. Edits are a stack over the
 * untouched original, rendered by a local image engine. An AI agent operates the same operations through the agent-app
 * CLI, and everything it does shows up here live (as proposals, unless the
 * person lets it edit directly).
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { getPbClient } from '../kit/index.ts';
import { ImporterProvider } from './components/Importer.tsx';
import { Frame } from './components/Shell.tsx';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { BatchesPage } from './pages/Batches.tsx';
import { ExportsPage } from './pages/Exports.tsx';
import { HomePage } from './pages/Home.tsx';
import { ImagePage } from './pages/Image.tsx';
import { RequestsPage } from './pages/Requests.tsx';
import { SettingsPage } from './pages/Settings.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();
// Back buttons follow the app's own trail (see router.ts).
trackTrail();

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'image':
      return <ImagePage id={query.get('id') ?? ''} />;
    case 'batches':
      return <BatchesPage />;
    case 'exports':
      return <ExportsPage query={query} />;
    case 'requests':
      return <RequestsPage />;
    case 'activity':
      return <ActivityPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

function Root(): React.JSX.Element {
  const { ready } = useApp();
  const route = useRoute();
  const wide = route.page === 'image';
  return (
    <Frame page={route.page} wide={wide}>
      {ready ? (
        <div key={wide ? 'image:' + (route.query.get('id') ?? '') : route.page} className={wide ? 'h-full' : undefined}>
          <Content page={route.page} query={route.query} />
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center">
          <span aria-label="Loading" className="size-5 animate-spin rounded-full border-2 border-[var(--iu-ink)] border-t-transparent" />
        </div>
      )}
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <ImporterProvider>
        <Root />
      </ImporterProvider>
    </AppDataProvider>
  );
}
