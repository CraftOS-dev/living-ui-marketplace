/**
 * CRM System: people, companies and deals for a founder or a small team,
 * kept together with an AI agent. Home shows how the business is doing,
 * Today what needs doing, People and Companies the relationships, Deals the
 * pipelines; Review holds what the AI agent proposed for you to decide. The
 * agent works through the same operations: everything it writes is marked
 * as its own, what it may only propose waits in Review, and every change can
 * be undone or reverted per agent run.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useEffect, useState } from 'react';
import { getPbClient, toast } from '../kit/index.ts';
import { api, errMessage } from './lib/api.ts';
import { startLive } from './lib/live.ts';
import { useRoute } from './lib/router.ts';
import { AppProvider, useApp } from './lib/store.tsx';
import { startThemeColors } from './lib/themeColors.ts';
import { DialogsProvider, useDialogs } from './components/dialogs.tsx';
import { Frame } from './components/Shell.tsx';
import { Palette } from './components/Palette.tsx';
import { Spinner } from './components/ui.tsx';
import { Onboarding, onboarding } from './views/Onboarding.tsx';
import { HomeView } from './views/Home.tsx';
import { TodayView } from './views/Today.tsx';
import { RecordsView } from './views/Records.tsx';
import { DealsView } from './views/Deals.tsx';
import { ReviewView } from './views/Review.tsx';
import { ReportsView } from './views/Reports.tsx';
import { ActivityView } from './views/Activity.tsx';
import { SetupView } from './views/Setup.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();

function typing(): boolean {
  const el = document.activeElement;
  return el instanceof HTMLElement && el.matches('input, textarea, select, [contenteditable="true"]');
}

function Main(): React.JSX.Element {
  const app = useApp();
  const route = useRoute();
  const dialogs = useDialogs();
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPalette(true);
        return;
      }
      if (typing() || document.querySelector('[role="dialog"]') !== null) return;
      if (mod && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        api
          .undo()
          .then((r) => toast.success('Undone: ' + r.entry.summary))
          .catch((err: unknown) => toast.error(errMessage(err)));
        return;
      }
      if (mod && (e.key.toLowerCase() === 'y' || (e.shiftKey && e.key.toLowerCase() === 'z'))) {
        e.preventDefault();
        api
          .redo()
          .then((r) => toast.success('Redone: ' + r.entry.summary))
          .catch((err: unknown) => toast.error(errMessage(err)));
        return;
      }
      if (mod || e.altKey) return;
      // Record pages and Today own their single keys (l, t, e, n, x, s, j, k).
      const onRecord = route.q['id'] !== undefined;
      if (e.key === 'p' && !onRecord) {
        e.preventDefault();
        dialogs.openNew('person');
      } else if (e.key === 'd' && !onRecord) {
        e.preventDefault();
        dialogs.openNew('deal');
      } else if (e.key === 'l' && !onRecord && route.view !== 'today') {
        e.preventDefault();
        dialogs.openLog();
      } else if (e.key === 't' && !onRecord && route.view !== 'today') {
        e.preventDefault();
        dialogs.openTask();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.view, route.q, dialogs]);

  if (!app.ready || app.settings === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--cr-card)] text-[var(--cr-muted)]">
        <Spinner size={18} />
      </div>
    );
  }
  if (!app.settings.setup_done || onboarding.step2) return <Onboarding />;

  const v = route.view;
  return (
    <Frame view={v} onPalette={() => setPalette(true)}>
      <div key={v + (route.q['id'] ? ':' + route.q['id'] : '')} className="cr-view h-full">
        {v === 'home' && <HomeView />}
        {v === 'today' && <TodayView />}
        {v === 'people' && <RecordsView object="people" q={route.q} />}
        {v === 'companies' && <RecordsView object="companies" q={route.q} />}
        {v === 'deals' && <DealsView q={route.q} />}
        {v === 'review' && <ReviewView q={route.q} />}
        {v === 'reports' && <ReportsView q={route.q} />}
        {v === 'activity' && <ActivityView q={route.q} />}
        {v === 'setup' && <SetupView q={route.q} />}
      </div>
      <Palette open={palette} onClose={() => setPalette(false)} />
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppProvider>
      <DialogsProvider>
        <Main />
      </DialogsProvider>
    </AppProvider>
  );
}
