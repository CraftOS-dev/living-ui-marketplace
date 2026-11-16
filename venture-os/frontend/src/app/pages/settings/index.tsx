/**
 * Settings: a left list of sections and the chosen one (SPEC 3). The
 * kernel brings Firm, Funds, Members, Your AI agent, Data and Security;
 * modules add theirs through `settings` in their index (Pipelines, Theses,
 * Templates, Capture). A section starts with <SubHeader title>{one action}</SubHeader>.
 */
import { Suspense, useMemo } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { PageBody, PageHeader, Skeleton } from '../../components/ui.tsx';
import { allowed, useMe } from '../../lib/auth.ts';
import type { PageProps, RouteDef, SettingsSection } from '../../lib/contract.ts';
import { settingsSections } from '../../registry.ts';
import { lazyPage } from '../../lib/lazy.ts';

const FirmSettings = lazyPage(() => import('./Firm.tsx'), 'FirmSettings');
const FundsSettings = lazyPage(() => import('./Funds.tsx'), 'FundsSettings');
const MembersSettings = lazyPage(() => import('./Members.tsx'), 'MembersSettings');
const AgentSettings = lazyPage(() => import('./Agent.tsx'), 'AgentSettings');
const DataSettings = lazyPage(() => import('./Data.tsx'), 'DataSettings');
const SecuritySettings = lazyPage(() => import('./Security.tsx'), 'SecuritySettings');

export const settings: SettingsSection[] = [
  { key: 'firm', label: 'Firm', order: 10, component: FirmSettings },
  { key: 'funds', label: 'Funds', order: 20, component: FundsSettings },
  { key: 'members', label: 'Members', order: 30, component: MembersSettings },
  { key: 'agent', label: 'Your AI agent', order: 70, component: AgentSettings },
  { key: 'data', label: 'Data', order: 90, component: DataSettings },
  { key: 'security', label: 'Security', order: 100, component: SecuritySettings },
];

function SettingsPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const list = useMemo(() => settingsSections().filter((s) => allowed(me, s.perm)), [me]);
  const key = params['section'] ?? '';
  const cur = list.find((s) => s.key === key) ?? null;
  const shown = cur ?? list[0] ?? null;
  const Section = shown?.component;
  return (
    <>
      <PageHeader title="Settings" back={cur !== null ? '#/settings' : undefined} backOnPhone />
      <PageBody>
        <div className="grid min-w-0 gap-6 md:grid-cols-[200px_minmax(0,1fr)]">
          <nav aria-label="Settings" className={cn('flex min-w-0 flex-col gap-0.5', cur !== null && 'max-md:hidden')}>
            {list.map((s) => {
              const on = s.key === shown?.key;
              return (
                <a key={s.key} href={`#/settings/${s.key}`} aria-current={on ? 'page' : undefined} className={cn('vo-focus vo-tap relative flex h-9 items-center gap-2 rounded-[var(--vo-radius-sm)] px-3 text-[13px] transition-colors duration-150', on ? 'bg-[var(--vo-active)] font-semibold text-[var(--vo-ink)] hover:bg-[var(--vo-active-hover)] max-md:bg-transparent max-md:font-normal max-md:hover:bg-[var(--vo-hover)]' : 'text-[var(--vo-ink-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]')}>
                  {on && <span aria-hidden className="absolute left-0 top-2 h-5 w-[2px] rounded-full bg-[var(--vo-ink)] max-md:hidden" />}
                  <span className="min-w-0 flex-1 truncate">{s.label}</span>
                  <ChevronRight size={14} aria-hidden className="text-[var(--vo-muted)] md:hidden" />
                </a>
              );
            })}
          </nav>
          <div className={cn('vo-in flex min-w-0 flex-col gap-6', cur === null && 'max-md:hidden')}>{Section !== undefined && (
              <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                <Section />
              </Suspense>
            )}</div>
        </div>
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [
  { path: '/settings', page: SettingsPage, title: 'Settings' },
  { path: '/settings/:section', page: SettingsPage, title: 'Settings' },
];
