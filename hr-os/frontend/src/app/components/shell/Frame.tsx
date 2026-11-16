/**
 * The frame around every signed-in page: the sidebar (folded to a rail only
 * when the viewer folds it; no page folds it, and the choice is remembered),
 * the page, and on phones a bottom bar with the five jobs people do away from
 * a desk plus a drawer with everything else.
 */
import { useEffect, useMemo, useState } from 'react';
import { Lock, Menu as MenuLines, SearchX } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { allowed, can, isManager, useMe } from '../../lib/auth.tsx';
import type { RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { matchPath, navigate, under, useRoute } from '../../lib/router.ts';
import { setUi, useUi } from '../../lib/store.tsx';
import { allRoutes, phoneBar } from '../../routes.tsx';
import { Button, Empty, HeaderToolsProvider, MenuProvider, PageBody, PageHeader } from '../ui.tsx';
import { ShellCountsProvider } from './counts.ts';
import { HeaderTools } from './HeaderTools.tsx';
import { SearchPalette } from './SearchPalette.tsx';
import { Sidebar } from './Sidebar.tsx';

export interface Resolved {
  route: RouteDef;
  params: Record<string, string>;
}

/** The route for a path: exact paths first, then patterns with ':' segments. */
export function resolve(path: string, routes: RouteDef[]): Resolved | null {
  for (const r of routes) if (r.path === path) return { route: r, params: {} };
  for (const r of routes) {
    if (!r.path.includes(':')) continue;
    const params = matchPath(r.path, path);
    if (params !== null) return { route: r, params };
  }
  return null;
}

function NotFound(): React.JSX.Element {
  return (
    <>
      <PageHeader title={t('shell.not_found')} />
      <PageBody>
        <Empty icon={SearchX} title={t('shell.not_found')} action={<Button onClick={() => navigate('/home')}>{t('shell.go_home')}</Button>} />
      </PageBody>
    </>
  );
}

function NotAllowed(): React.JSX.Element {
  return (
    <>
      <PageHeader title={t('shell.not_allowed')} />
      <PageBody>
        <Empty icon={Lock} title={t('shell.not_allowed')} action={<Button onClick={() => navigate('/home')}>{t('shell.go_home')}</Button>}>
          {t('shell.not_allowed_text')}
        </Empty>
      </PageBody>
    </>
  );
}

function BottomBar({ onMore }: { onMore: () => void }): React.JSX.Element {
  const me = useMe();
  const { path } = useRoute();
  const admin = can(me, 'people', 'view') || can(me, 'payroll', 'view') || isManager(me) || can(me, 'admin', 'edit');
  const items = phoneBar(admin ? 'admin' : 'employee');
  return (
    <nav data-hr-shell-chrome="" aria-label={t('shell.quick')} className="fixed inset-x-0 bottom-0 z-30 flex border-t border-[var(--hr-line)] bg-[var(--hr-side)] pb-[env(safe-area-inset-bottom)] md:hidden">
      {items.map((it) => {
        const Icon = it.to === 'more' ? MenuLines : it.icon;
        const on = it.to !== 'more' && under(path, it.to);
        const cls = cn('hr-focus relative flex h-14 min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[12px] font-medium transition-colors', on ? 'text-[var(--hr-ink)]' : 'text-[var(--hr-muted)] hover:text-[var(--hr-ink)]');
        const inner = (
          <>
            {on && <span aria-hidden className="absolute top-0 h-[2px] w-8 rounded-full bg-[var(--hr-ink)]" />}
            <Icon size={19} strokeWidth={1.8} aria-hidden />
            <span className="max-w-full truncate px-1">{it.label}</span>
          </>
        );
        return it.to === 'more' ? (
          <button key="more" type="button" onClick={onMore} className={cls}>
            {inner}
          </button>
        ) : (
          <a key={it.to} href={'#' + it.to} aria-current={on ? 'page' : undefined} className={cls}>
            {inner}
          </a>
        );
      })}
    </nav>
  );
}

export function Frame(): React.JSX.Element {
  const me = useMe();
  const route = useRoute();
  const { rail } = useUi();
  const [drawer, setDrawer] = useState(false);
  const routes = useMemo(() => allRoutes(), []);
  const found = useMemo(() => resolve(route.path, routes), [route.path, routes]);
  const where = route.path + '|' + route.query.toString();
  useEffect(() => setDrawer(false), [where]);
  useEffect(() => {
    document.title = found !== null ? `${found.route.title} · HR OS` : 'HR OS';
  }, [found]);
  useEffect(() => {
    if (route.path === '/') navigate('/home');
  }, [route.path]);

  const ok = found !== null && allowed(me, found.route.perm);
  const Page = found?.route.page;
  const body = found === null ? <NotFound /> : !ok || Page === undefined ? <NotAllowed /> : <Page params={found.params} query={route.query} />;
  return (
    <ShellCountsProvider>
      <MenuProvider value={() => setDrawer(true)}>
        <HeaderToolsProvider value={<HeaderTools />}>
          <div className="flex h-[100dvh] w-full overflow-hidden bg-[var(--hr-page)] text-[13px] text-[var(--hr-ink)]" style={{ fontFamily: 'var(--hr-font)' }}>
            <div data-hr-shell-chrome="" className="hidden h-full md:flex">
              <Sidebar collapsed={rail} onCollapse={(v) => setUi({ rail: v })} />
            </div>
            <main key={(found?.route.path ?? 'none') + JSON.stringify(found?.params ?? {})} id="hr-main" className="hr-fade hr-scroll min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
              {body}
            </main>
            <BottomBar onMore={() => setDrawer(true)} />
            {drawer && (
              <div className="hr-scrim fixed inset-0 z-[66] md:hidden" onPointerDown={(e) => e.target === e.currentTarget && setDrawer(false)}>
                <div role="dialog" aria-modal="true" aria-label={t('shell.menu')} className="hr-drawer h-full w-[min(300px,88vw)] border-r border-[var(--hr-line)] shadow-[var(--hr-shadow-lg)]">
                  <Sidebar collapsed={false} onCollapse={() => setDrawer(false)} drawer onCloseDrawer={() => setDrawer(false)} />
                </div>
              </div>
            )}
            <SearchPalette />
          </div>
        </HeaderToolsProvider>
      </MenuProvider>
    </ShellCountsProvider>
  );
}
