/**
 * Settings: one page, tabs in the hash (?tab=...). Admins see everything;
 * managers edit calendars, fees, dimensions, scoring and imports; everyone
 * else reads what is marked read-only and edits only their own account.
 * Inventors see only My account.
 */
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarOff, Coins, FileClock, Gavel, Layers3, Plug, SlidersHorizontal, Upload, UserRound, Users } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import type { Can } from '../lib/context.tsx';
import { useApp } from '../lib/context.tsx';
import { useHashParam } from '../lib/router.ts';
import { PageHeader } from '../components/ui.tsx';
import { OrganizationTab } from '../components/adminOrganization.tsx';
import { AccessTab } from '../components/adminAccess.tsx';
import { OfficesTab } from '../components/adminOffices.tsx';
import { RulesTab } from '../components/adminRules.tsx';
import { CalendarsTab } from '../components/adminCalendars.tsx';
import { FeesTab } from '../components/adminFees.tsx';
import { DimensionsTab } from '../components/adminDimensions.tsx';
import { ScoringTab } from '../components/adminScoring.tsx';
import { ImportTab } from '../components/adminImport.tsx';
import { AuditTab } from '../components/adminAudit.tsx';
import { AccountTab } from '../components/adminAccount.tsx';

type TabKey = 'organization' | 'people' | 'offices' | 'rules' | 'calendars' | 'fees' | 'dimensions' | 'scoring' | 'import' | 'audit' | 'account';

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  visible: (can: Can) => boolean;
}

const TABS: TabDef[] = [
  { key: 'organization', label: 'Organization', icon: Building2, visible: (c) => c.read },
  { key: 'people', label: 'People and access', icon: Users, visible: (c) => c.read },
  { key: 'offices', label: 'Office connections', icon: Plug, visible: (c) => c.admin },
  { key: 'rules', label: 'Deadline rules', icon: Gavel, visible: (c) => c.read },
  { key: 'calendars', label: 'Office closure days', icon: CalendarOff, visible: (c) => c.read },
  { key: 'fees', label: 'Fees and currency', icon: Coins, visible: (c) => c.read },
  { key: 'dimensions', label: 'Rights dimensions', icon: Layers3, visible: (c) => c.read },
  { key: 'scoring', label: 'Invention scoring', icon: SlidersHorizontal, visible: (c) => c.read },
  { key: 'import', label: 'Import', icon: Upload, visible: (c) => c.edit },
  { key: 'audit', label: 'Audit log', icon: FileClock, visible: (c) => c.edit },
  { key: 'account', label: 'My account', icon: UserRound, visible: () => true },
];

export function SettingsPage(): React.JSX.Element {
  const { can } = useApp();
  const fallback: TabKey = can.admin ? 'organization' : 'account';
  const [raw, setTab] = useHashParam('tab', fallback);
  const tabs = TABS.filter((t) => t.visible(can));
  const current: TabKey = tabs.find((t) => t.key === raw)?.key ?? fallback;
  const def = TABS.find((t) => t.key === current);

  return (
    <div>
      <PageHeader title="Settings" subtitle={tabs.length > 1 ? 'Organization, people, rules, offices and your own account.' : 'Your account, calendar link and daily digest.'} />
      <div className={cn('grid gap-6', tabs.length > 1 && 'lg:grid-cols-[200px_minmax(0,1fr)]')}>
        {tabs.length > 1 && (
          <nav aria-label="Settings sections" className="-mx-4 overflow-x-auto px-4 lg:mx-0 lg:overflow-visible lg:px-0">
            <div role="tablist" aria-orientation="vertical" className="flex gap-1 border-b border-[var(--agent-app-border)] pb-2 lg:sticky lg:top-4 lg:flex-col lg:gap-px lg:border-b-0 lg:pb-0">
              {tabs.map((t) => {
                const Icon = t.icon;
                const on = t.key === current;
                return (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      'relative flex h-8 shrink-0 items-center gap-2 whitespace-nowrap px-3 text-[13px] transition-colors',
                      on
                        ? 'bg-[var(--agent-app-accent)]/10 font-medium text-[var(--agent-app-accent)]'
                        : 'text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30 hover:text-[var(--agent-app-text)]',
                    )}
                  >
                    {on && <span aria-hidden className="absolute bottom-0 left-0 hidden h-full w-0.5 bg-[var(--agent-app-accent)] lg:block" />}
                    <Icon size={14} aria-hidden />
                    {t.label}
                  </button>
                );
              })}
            </div>
          </nav>
        )}
        <div role="tabpanel" aria-label={def?.label} className="min-w-0">
          {current === 'organization' && <OrganizationTab />}
          {current === 'people' && <AccessTab />}
          {current === 'offices' && <OfficesTab />}
          {current === 'rules' && <RulesTab />}
          {current === 'calendars' && <CalendarsTab />}
          {current === 'fees' && <FeesTab />}
          {current === 'dimensions' && <DimensionsTab />}
          {current === 'scoring' && <ScoringTab />}
          {current === 'import' && <ImportTab />}
          {current === 'audit' && <AuditTab />}
          {current === 'account' && <AccountTab />}
        </div>
      </div>
    </div>
  );
}
