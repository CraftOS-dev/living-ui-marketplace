/**
 * The frame around every signed-in page: the sidebar (folded or open only by
 * the person's click, remembered in this browser), the page, and on phones a
 * bottom bar (Home, Next, Deals, Portfolio, More) with a drawer for
 * everything else. The frame is fixed to the viewport: the page scrolls
 * inside #vo-main (relative, so absolutely placed helpers stay inside it), so
 * the sidebar and the page background always reach the bottom of the window.
 * Mounted once here: the search palette, the agent panel, the drop overlay.
 */
import { Suspense, useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { House, ListTodo, Lock, Menu as MenuLines, SearchX } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { RouteDef } from '../../lib/contract.ts';
import { matchPath, navigate, under, useRoute } from '../../lib/router.ts';
import { prefetchPages } from '../../lib/lazy.ts';
import { setUi, useUi } from '../../lib/store.ts';
import { navItems, routes } from '../../registry.ts';
import { Button, Count, Empty, HeaderToolsProvider, PageBody, PageHeader } from '../ui.tsx';
import { AgentPanel } from './AgentPanel.tsx';
import { ShellCountsProvider, useShellCounts } from './counts.ts';
import { DropOverlay } from './DropOverlay.tsx';
import { SearchPalette } from './SearchPalette.tsx';
import { SourceHost } from './SourceHost.tsx';
import { Sidebar } from './Sidebar.tsx';
import { TopTools } from './TopTools.tsx';

export interface Resolved {
  route: RouteDef;
  params: Record<string, string>;
}

/** The route for a path: exact paths first, then patterns with ':' segments (registry order). */
export function resolve(path: string, list: RouteDef[]): Resolved | null {
  for (const r of list) if (r.path === path) return { route: r, params: {} };
  for (const r of list) {
    if (!r.path.includes(':')) continue;
    const params = matchPath(r.path, path);
    if (params !== null) return { route: r, params };
  }
  return null;
}

function NotFound(): React.JSX.Element {
  return (
    <>
      <PageHeader title="Not found" />
      <PageBody>
        <Empty icon={SearchX} title="Page not found" action={<Button onClick={() => navigate('/')}>Home</Button>} />
      </PageBody>
    </>
  );
}

function NotAllowed(): React.JSX.Element {
  return (
    <>
      <PageHeader title="No access" />
      <PageBody>
        <Empty icon={Lock} title="Not for your role" action={<Button onClick={() => navigate('/')}>Home</Button>} />
      </PageBody>
    </>
  );
}

function BottomBar({ onMore }: { onMore: () => void }): React.JSX.Element {
  const { path } = useRoute();
  const counts = useShellCounts();
  const items = navItems();
  const pick = (key: string): { label: string; icon: LucideIcon; to: string } | null => {
    const n = items.find((i) => i.key === key);
    return n === undefined ? null : { label: n.label, icon: n.icon, to: n.path };
  };
  const bar = [pick('home') ?? { label: 'Home', icon: House, to: '/' }, { label: 'Next', icon: ListTodo, to: '/focus' }, pick('deals'), pick('portfolio')].filter((x): x is { label: string; icon: LucideIcon; to: string } => x !== null);
  const cls = (on: boolean): string => cn('vo-focus relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-medium transition-colors duration-150', on ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)] hover:text-[var(--vo-ink)]');
  return (
    <nav data-vo-chrome="" aria-label="Quick" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--vo-line)] bg-[var(--vo-side)] pb-[env(safe-area-inset-bottom)] md:hidden">
      {bar.map((it) => {
        const on = under(path, it.to);
        const Icon = it.icon;
        return (
          <a key={it.to} href={'#' + it.to} aria-current={on ? 'page' : undefined} className={cls(on)}>
            {on && <span aria-hidden className="absolute top-0 h-[2px] w-8 rounded-full bg-[var(--vo-ink)]" />}
            <span className="relative">
              <Icon size={19} strokeWidth={1.8} aria-hidden />
              {it.to === '/focus' && counts.next > 0 && (
                <span className="absolute -right-3.5 -top-1.5">
                  <Count n={counts.next} tone="agent" />
                </span>
              )}
            </span>
            <span className="max-w-full truncate px-1">{it.label}</span>
          </a>
        );
      })}
      <button type="button" onClick={onMore} className={cls(false)}>
        <MenuLines size={19} strokeWidth={1.8} aria-hidden />
        <span>More</span>
      </button>
    </nav>
  );
}

export function Frame(): React.JSX.Element {
  const me = useMe();
  const route = useRoute();
  const { rail } = useUi();
  const [drawer, setDrawer] = useState(false);
  const all = useMemo(() => routes(), []);
  const found = useMemo(() => resolve(route.path, all), [route.path, all]);
  const where = route.path + '|' + route.query.toString();
  useEffect(() => setDrawer(false), [where]);
  // Every page chunk in the background once the first page is on screen.
  useEffect(() => prefetchPages(), []);
  const label = found?.route.title ?? navItems().find((n) => n.path === found?.route.path)?.label ?? '';
  useEffect(() => {
    document.title = label !== '' ? `${label} · Venture OS` : 'Venture OS';
  }, [label]);
  const ok = found !== null && allowed(me, found.route.perm);
  const Page = found?.route.page;
  const body = found === null ? <NotFound /> : !ok || Page === undefined ? <NotAllowed /> : <Page params={found.params} query={route.query} />;
  return (
    <ShellCountsProvider>
      <HeaderToolsProvider value={{ tools: <TopTools />, openMenu: () => setDrawer(true) }}>
        <div data-vo-frame="" className="fixed inset-0 flex overflow-hidden bg-[var(--vo-page)] text-[13px] text-[var(--vo-ink)]" style={{ fontFamily: 'var(--vo-font)' }}>
          <div data-vo-chrome="" className="hidden h-full md:flex">
            <Sidebar collapsed={rail} onCollapse={(v) => setUi({ rail: v })} />
          </div>
          <Suspense fallback={<div id="vo-main" className="relative min-w-0 flex-1" />}>
            <main key={(found?.route.path ?? 'none') + JSON.stringify(found?.params ?? {})} id="vo-main" className="vo-scroll relative min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {body}
            </main>
          </Suspense>
          <BottomBar onMore={() => setDrawer(true)} />
          {drawer && (
            <div className="vo-scrim fixed inset-0 z-[66] md:hidden" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
              <div role="dialog" aria-modal="true" aria-label="Menu" className="h-full w-[min(300px,88vw)] border-r border-[var(--vo-line)] shadow-[var(--vo-shadow-lg)]">
                <Sidebar collapsed={false} onCollapse={() => setDrawer(false)} drawer onCloseDrawer={() => setDrawer(false)} />
              </div>
            </div>
          )}
          <SearchPalette />
          <AgentPanel />
          <SourceHost />
          <DropOverlay />
        </div>
      </HeaderToolsProvider>
    </ShellCountsProvider>
  );
}
