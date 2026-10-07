/**
 * Expenses tracker: a personal expense tracker. Home is a dashboard; the
 * "+" opens the entry screen. An AI agent operates the same operations
 * through the agent-app CLI.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { getPbClient } from '../kit/index.ts';
import { EntryProvider } from './components/Entry.tsx';
import { Frame } from './components/Shell.tsx';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { BudgetsPage } from './pages/Budgets.tsx';
import { CategoriesPage } from './pages/Categories.tsx';
import { ExpensesPage } from './pages/Expenses.tsx';
import { HomePage } from './pages/Home.tsx';
import { ImportExportPage } from './pages/ImportExport.tsx';
import { InsightsPage } from './pages/Insights.tsx';
import { ReceiptsPage } from './pages/Receipts.tsx';
import { RecurringPage } from './pages/Recurring.tsx';
import { SettingsPage } from './pages/Settings.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'expenses':
      return <ExpensesPage key={query.toString()} query={query} />;
    case 'insights':
      return <InsightsPage />;
    case 'budgets':
      return <BudgetsPage />;
    case 'recurring':
      return <RecurringPage />;
    case 'categories':
      return <CategoriesPage />;
    case 'receipts':
      return <ReceiptsPage />;
    case 'import':
      return <ImportExportPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

function Root(): React.JSX.Element {
  const { ready } = useApp();
  const route = useRoute();
  return (
    <Frame page={route.page}>
      {ready ? (
        <div key={`${route.page}?${route.query.toString()}`}>
          <Content page={route.page} query={route.query} />
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center">
          <span aria-label="Loading" className="size-8 animate-spin rounded-full border-[3px] border-[var(--et-ink)] border-t-transparent" />
        </div>
      )}
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <EntryProvider>
        <Root />
      </EntryProvider>
    </AppDataProvider>
  );
}
