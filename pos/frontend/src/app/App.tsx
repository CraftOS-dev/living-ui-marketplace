/**
 * POS: a point of sale for cafes, restaurants and shops. Home is the
 * register. The first open sets up the business; then each device picks its
 * register and the person at it signs in with their PIN. The back office
 * (orders, kitchen, products, customers, cash and shifts, reports,
 * settings) shows what each person's role may use.
 *
 * Your AI agent operates the same operations through the agent-app CLI,
 * except money: payments, refunds and cash happen only at the counter.
 */
import '@fontsource-variable/manrope';
import './theme.css';
import { useEffect } from 'react';
import { getPbClient } from '../kit/index.ts';
import { ApprovalProvider } from './components/Approval.tsx';
import { LockScreen, RegisterPicker } from './components/LockScreen.tsx';
import { Setup } from './components/Setup.tsx';
import { Frame, canOpen } from './components/Shell.tsx';
import { api } from './lib/api.ts';
import { cartStore } from './lib/cart.ts';
import { AppDataProvider, useApp } from './lib/context.tsx';
import { setReloadGuard, startLive } from './lib/live.ts';
import { PrintHost } from './lib/print.tsx';
import { CUSTOMER_FACING, useRoute } from './lib/router.ts';
import type { Page } from './lib/router.ts';
import { session, useSession } from './lib/session.ts';
import { startThemeColors } from './lib/themeColors.ts';
import { BoardPage, DisplayPage } from './pages/CustomerScreens.tsx';
import { CustomersPage } from './pages/Customers.tsx';
import { KitchenPage } from './pages/Kitchen.tsx';
import { OrdersPage } from './pages/Orders.tsx';
import { ProductsPage } from './pages/Products.tsx';
import { RegisterPage } from './pages/Register.tsx';
import { ReportsPage } from './pages/Reports.tsx';
import { SettingsPage } from './pages/Settings.tsx';
import { ShiftsPage } from './pages/Shifts.tsx';

// Views legitimately load the same operation twice; the SDK's auto-cancel
// of same-path requests would blank one of them.
getPbClient().pb.autoCancellation(false);
// Colors follow the host theme (see themeColors.ts).
startThemeColors();
// All realtime subscriptions in one tick, before any view mounts (see live.ts).
startLive();
// A new version never reloads the page under a sale being rung up.
setReloadGuard(() => cartStore.get().lines.length > 0);

function Content({ page, query }: { page: Page; query: URLSearchParams }): React.JSX.Element {
  switch (page) {
    case 'orders':
      return <OrdersPage query={query} />;
    case 'kitchen':
      return <KitchenPage />;
    case 'products':
      return <ProductsPage query={query} />;
    case 'customers':
      return <CustomersPage query={query} />;
    case 'reports':
      return <ReportsPage />;
    case 'shifts':
      return <ShiftsPage />;
    case 'settings':
      return <SettingsPage query={query} />;
    default:
      return <RegisterPage query={query} />;
  }
}

/** Lock the register after the idle time the owner set (the cart is kept). */
function useIdleLock(minutes: number, signedIn: boolean): void {
  useEffect(() => {
    if (minutes <= 0 || !signedIn) return;
    let last = Date.now();
    const touch = (): void => {
      last = Date.now();
    };
    const events = ['pointerdown', 'keydown', 'wheel'] as const;
    for (const ev of events) window.addEventListener(ev, touch, { passive: true });
    const t = window.setInterval(() => {
      // Never in the middle of taking a payment.
      if (document.querySelector('[data-paying="true"]') !== null) return;
      if (Date.now() - last >= minutes * 60000) {
        void api.logout().finally(() => session.clear());
      }
    }, 15000);
    return () => {
      for (const ev of events) window.removeEventListener(ev, touch);
      window.clearInterval(t);
    };
  }, [minutes, signedIn]);
}

function Gate(): React.JSX.Element {
  const { ready, settings, registers, staff } = useApp();
  const { register, session: current } = useSession();
  const route = useRoute();

  // The server is the judge of a session (it may have ended elsewhere).
  useEffect(() => {
    if (current === null) return;
    api
      .me()
      .then((r) => {
        if (r.staff === null) session.clear();
        else session.updateStaff(r.staff);
      })
      .catch(() => undefined);
  }, [current?.token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Role, training mode or "off" changed by the owner: follow it here.
  useEffect(() => {
    if (current === null) return;
    const me = staff.find((s) => s.id === current.staff.id);
    if (me === undefined) return;
    if (!me.active) session.clear();
    else if (me.role !== current.staff.role || me.training !== current.staff.training || me.name !== current.staff.name || me.color !== current.staff.color) session.updateStaff(me);
  }, [staff, current]);

  // One register: this device is it.
  const live = registers.filter((r) => !r.archived);
  useEffect(() => {
    if (!ready) return;
    if (live.some((r) => r.id === register)) return;
    if (live.length === 1 && live[0] !== undefined) session.setRegister(live[0].id);
  }, [ready, live, register]);

  useIdleLock(settings?.lock_minutes ?? 0, current !== null);

  if (!ready || settings === null) {
    return (
      <div className="flex h-screen items-center justify-center bg-[var(--ps-canvas)]">
        <span aria-label="Loading" className="size-8 animate-spin rounded-full border-[3px] border-[var(--ps-ink)] border-t-transparent" />
      </div>
    );
  }
  if (!settings.setup_done) return <Setup />;
  if (!live.some((r) => r.id === register)) return live.length > 1 ? <RegisterPicker registers={live} /> : <span />;
  if (current === null) return <LockScreen />;
  const page = canOpen(route.page, current.staff.permissions, settings.kitchen_enabled) ? route.page : 'register';
  return (
    <ApprovalProvider>
      <Frame page={page}>
        <div key={page}>
          <Content page={page} query={route.query} />
        </div>
      </Frame>
    </ApprovalProvider>
  );
}

function Root(): React.JSX.Element {
  const route = useRoute();
  if (CUSTOMER_FACING.includes(route.page)) {
    return route.page === 'display' ? <DisplayPage query={route.query} /> : <BoardPage />;
  }
  return (
    <AppDataProvider>
      <Gate />
    </AppDataProvider>
  );
}

export function App(): React.JSX.Element {
  return (
    <>
      <Root />
      <PrintHost />
    </>
  );
}
