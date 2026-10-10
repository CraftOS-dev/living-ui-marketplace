/**
 * Inventory: what a small team has in stock, where it is kept and when to
 * reorder. Home is a dashboard; the "+" opens the stock change screen.
 * An AI agent operates the same operations through the agent-app CLI.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useState } from 'react';
import { Link2, Plus } from 'lucide-react';
import { getPbClient, toast } from '../kit/index.ts';
import { ItemEditorProvider, useItemEditor } from './components/ItemEditor.tsx';
import { ItemSearch } from './components/pickers.tsx';
import { Frame } from './components/Shell.tsx';
import { StockChangeProvider } from './components/StockChange.tsx';
import { Modal, PillButton } from './components/ui.tsx';
import { api } from './lib/api.ts';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { startLive } from './lib/live.ts';
import { navigate, trackTrail, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { useScanner } from './lib/scanner.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { ActivityPage } from './pages/Activity.tsx';
import { CountPage } from './pages/Count.tsx';
import { CountsPage } from './pages/Counts.tsx';
import { DataPage } from './pages/Data.tsx';
import { HomePage } from './pages/Home.tsx';
import { ItemPage } from './pages/Item.tsx';
import { ItemsPage } from './pages/Items.tsx';
import { LabelsPage } from './pages/Labels.tsx';
import { LocationsPage } from './pages/Locations.tsx';
import { OrderPage } from './pages/Order.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { ReorderPage } from './pages/Reorder.tsx';
import { ScanPage } from './pages/Scan.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { SuppliersPage } from './pages/Suppliers.tsx';

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
    case 'items':
      return <ItemsPage query={query} />;
    case 'item':
      return <ItemPage id={query.get('id') ?? ''} />;
    case 'locations':
      return <LocationsPage selected={query.get('id') ?? ''} />;
    case 'scan':
      return <ScanPage />;
    case 'reorder':
      return <ReorderPage />;
    case 'orders':
      return <OrdersPage query={query} />;
    case 'order':
      return <OrderPage id={query.get('id') ?? ''} />;
    case 'counts':
      return <CountsPage query={query} />;
    case 'count':
      return <CountPage id={query.get('id') ?? ''} />;
    case 'activity':
      return <ActivityPage query={query} />;
    case 'suppliers':
      return <SuppliersPage selected={query.get('id') ?? ''} />;
    case 'labels':
      return <LabelsPage query={query} />;
    case 'data':
      return <DataPage />;
    case 'settings':
      return <SettingsPage />;
    default:
      return <HomePage />;
  }
}

/**
 * A scan anywhere outside a form opens what it belongs to. A code nothing
 * has yet can become a new item or be added to an existing one.
 */
function GlobalScan(): React.JSX.Element {
  const editor = useItemEditor();
  const [unknown, setUnknown] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  useScanner((code) => {
    api
      .lookup(code)
      .then((hit) => {
        if (hit.type === 'item') navigate('item', { id: hit.item.id });
        else if (hit.type === 'location') navigate('locations', { id: hit.location.id });
        else {
          setLinking(false);
          setUnknown(code);
        }
      })
      .catch(() => undefined);
  });
  const close = (): void => setUnknown(null);
  return (
    <Modal
      open={unknown !== null}
      onClose={close}
      title="A new code"
      description={unknown !== null ? `Nothing has the code ${unknown} yet.` : undefined}
      wide={linking}
      footer={
        linking ? (
          <PillButton variant="light" onClick={() => setLinking(false)}>
            Back
          </PillButton>
        ) : undefined
      }
    >
      {unknown !== null &&
        (linking ? (
          <ItemSearch
            autoFocus
            scanning={false}
            onPick={(it) => {
              const code = unknown;
              close();
              api
                .addBarcode(it.id, code)
                .then(() => {
                  toast.success(`Added the code to ${it.name}`);
                  navigate('item', { id: it.id });
                })
                .catch(() => undefined);
            }}
          />
        ) : (
          <div className="flex flex-col gap-2">
            <PillButton
              variant="dark"
              icon={Plus}
              dot
              onClick={(e) => {
                const code = unknown;
                close();
                editor.create(e.currentTarget, { barcode: code });
              }}
            >
              Create a new item with this code
            </PillButton>
            <PillButton variant="light" icon={Link2} onClick={() => setLinking(true)}>
              Add it to an existing item
            </PillButton>
          </div>
        ))}
    </Modal>
  );
}

function Root(): React.JSX.Element {
  const { ready } = useApp();
  const route = useRoute();
  return (
    <Frame page={route.page}>
      {/* First, so pages and full screens that listen for scans mount above it. */}
      <GlobalScan />
      {ready ? (
        <div key={`${route.page}?${route.query.toString()}`}>
          <Content page={route.page} query={route.query} />
        </div>
      ) : (
        <div className="flex h-[60vh] items-center justify-center">
          <span aria-label="Loading" className="size-8 animate-spin rounded-full border-[3px] border-[var(--iv-ink)] border-t-transparent" />
        </div>
      )}
    </Frame>
  );
}

export function App(): React.JSX.Element {
  return (
    <AppDataProvider>
      <StockChangeProvider>
        <ItemEditorProvider>
          <Root />
        </ItemEditorProvider>
      </StockChangeProvider>
    </AppDataProvider>
  );
}
