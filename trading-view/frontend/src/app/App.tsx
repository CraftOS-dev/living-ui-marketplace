/**
 * Trading View: workspaces of drag-and-resize widgets (charts, watchlists,
 * details, news, alerts, screener, heatmap, AI analyst) over live market
 * data from Yahoo Finance and Binance. An AI agent operates the same
 * operations through the agent-app CLI: it analyzes charts, draws levels,
 * sets alerts, reviews watchlists and explains alerts when they fire; every
 * change it makes can be reviewed and reverted.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useEffect, useState } from 'react';
import { getPbClient, toast } from '../kit/index.ts';
import { api, errMessage } from './lib/api.ts';
import { startLive } from './lib/live.ts';
import { AppProvider, useApp } from './lib/store.tsx';
import { startThemeColors } from './lib/themeColors.ts';
import { DialogsProvider } from './workspace/Dialogs.tsx';
import { Grid } from './workspace/Grid.tsx';
import { Palette } from './workspace/Palette.tsx';
import { TopBar, WidgetCatalogue } from './workspace/TopBar.tsx';
import { Modal } from './components/ui.tsx';

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

function Shell(): React.JSX.Element {
  const app = useApp();
  const [palette, setPalette] = useState(false);
  const [catalogue, setCatalogue] = useState(false);

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
      if (e.key === 'Escape' && app.maximized !== '') app.setMaximized('');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [app]);

  return (
    <div className="flex h-dvh min-h-0 flex-col overflow-hidden bg-[var(--tv-card)] text-[var(--tv-ink)]">
      <TopBar onPalette={() => setPalette(true)} />
      <Grid onAddWidget={() => setCatalogue(true)} />
      <Palette open={palette} onClose={() => setPalette(false)} />
      {catalogue && (
        <Modal open width="lg" title="Add widget" onClose={() => setCatalogue(false)}>
          <WidgetCatalogue
            onPick={(t) => {
              setCatalogue(false);
              void app.addWidget(t);
            }}
          />
        </Modal>
      )}
    </div>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppProvider>
      <DialogsProvider>
        <Shell />
      </DialogsProvider>
    </AppProvider>
  );
}
