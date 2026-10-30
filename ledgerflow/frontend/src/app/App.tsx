/**
 * Ledgerflow: double-entry books for a business, a household or both, kept
 * together with an AI agent. Bank statements land in the inbox, where rules,
 * memory, matching and the AI agent propose how to book each line; invoices
 * and bills, reconciliation, reports and month-end close build on the same
 * ledger. The AI agent operates the same operations through the agent-app
 * CLI; what it does is labelled with its reason, gated by the person's
 * posting policy and lock dates, and can be undone or reverted per run.
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
import { InboxView } from './views/Inbox.tsx';
import { LedgerView } from './views/Ledger.tsx';
import { ReconcileView } from './views/Reconcile.tsx';
import { DocsView } from './views/Docs.tsx';
import { ReportsView } from './views/Reports.tsx';
import { CloseView } from './views/Close.tsx';
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
      if (!mod && !e.altKey && e.key === 'n' && route.view !== 'inbox') {
        e.preventDefault();
        dialogs.openEntry('expense');
      }
      if (!mod && !e.altKey && e.key === 'i' && route.view !== 'inbox') {
        e.preventDefault();
        dialogs.openImport();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [route.view, dialogs]);

  if (!app.ready || app.settings === null) {
    return (
      <div className="flex h-dvh items-center justify-center bg-[var(--lf-card)] text-[var(--lf-muted)]">
        <Spinner size={18} />
      </div>
    );
  }
  if (!app.settings.setup_done || onboarding.step2) return <Onboarding />;

  const v = route.view;
  return (
    <Frame view={v} onPalette={() => setPalette(true)}>
      <div key={v} className="lf-view h-full">
        {v === 'home' && <HomeView />}
        {v === 'inbox' && <InboxView q={route.q} />}
        {v === 'ledger' && <LedgerView q={route.q} />}
        {v === 'reconcile' && <ReconcileView q={route.q} />}
        {v === 'sales' && <DocsView side="sales" q={route.q} />}
        {v === 'purchases' && <DocsView side="purchases" q={route.q} />}
        {v === 'reports' && <ReportsView q={route.q} />}
        {v === 'close' && <CloseView q={route.q} />}
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
