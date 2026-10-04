/**
 * Settings: one page, tabs in the hash (?tab=...). Administrators see every
 * tab. Managers also see the reference data they maintain (calendars,
 * fees, exchange rates, dimensions, rules to read, office sync, import and
 * the audit log). Other internal roles read Organization and edit their
 * own account. Outside accounts see only My account.
 */
import type { LucideIcon } from 'lucide-react';
import { Building2, CalendarOff, Coins, FileClock, Gavel, Layers3, LayoutGrid, Plug, TrendingUp, Upload, UserRound, Users } from 'lucide-react';
import { Select, cn } from '../../kit/index.ts';
import type { Can } from '../lib/context.tsx';
import { useApp } from '../lib/context.tsx';
import { t } from '../lib/i18n.ts';
import { useHashParam } from '../lib/router.ts';
import { PageHeader } from '../components/ui.tsx';
import { OrganizationTab } from '../components/orgOrganization.tsx';
import { ModulesTab } from '../components/orgModules.tsx';
import { AccessTab } from '../components/orgAccess.tsx';
import { OfficesTab } from '../components/orgOffices.tsx';
import { CalendarsTab } from '../components/orgCalendars.tsx';
import { RulesTab } from '../components/orgRules.tsx';
import { FeesTab } from '../components/orgFees.tsx';
import { RatesTab } from '../components/orgRates.tsx';
import { DimensionsTab } from '../components/orgDimensions.tsx';
import { ImportTab } from '../components/orgImport.tsx';
import { AuditTab } from '../components/orgAudit.tsx';
import { AccountTab } from '../components/orgAccount.tsx';

type TabKey = 'organization' | 'modules' | 'people' | 'offices' | 'calendars' | 'rules' | 'fees' | 'rates' | 'dimensions' | 'import' | 'audit' | 'account';

interface TabDef {
  key: TabKey;
  label: string;
  icon: LucideIcon;
  visible: (can: Can) => boolean;
}

function tabs(): TabDef[] {
  return [
    { key: 'organization', label: t('Organization|settings tab'), icon: Building2, visible: (c) => c.read },
    { key: 'modules', label: t('Modules'), icon: LayoutGrid, visible: (c) => c.admin },
    { key: 'people', label: t('People and roles'), icon: Users, visible: (c) => c.admin },
    { key: 'offices', label: t('Office connections'), icon: Plug, visible: (c) => c.manage },
    { key: 'calendars', label: t('Calendars'), icon: CalendarOff, visible: (c) => c.manage },
    { key: 'rules', label: t('Rules'), icon: Gavel, visible: (c) => c.manage },
    { key: 'fees', label: t('Fees'), icon: Coins, visible: (c) => c.manage },
    { key: 'rates', label: t('Exchange rates'), icon: TrendingUp, visible: (c) => c.manage },
    { key: 'dimensions', label: t('Rights dimensions'), icon: Layers3, visible: (c) => c.manage },
    { key: 'import', label: t('Import'), icon: Upload, visible: (c) => c.manage },
    { key: 'audit', label: t('Audit log'), icon: FileClock, visible: (c) => c.manage },
    { key: 'account', label: t('My account'), icon: UserRound, visible: () => true },
  ];
}

export function SettingsPage(): React.JSX.Element {
  const { can } = useApp();
  const fallback: TabKey = can.admin ? 'organization' : 'account';
  const [raw, setTab] = useHashParam('tab', fallback);
  const all = tabs();
  const visible = all.filter((x) => x.visible(can));
  const current: TabKey = visible.find((x) => x.key === raw)?.key ?? fallback;
  const def = all.find((x) => x.key === current);

  return (
    <div>
      <PageHeader
        title={visible.length > 1 ? t('Settings') : t('My account')}
        subtitle={
          can.external
            ? t('Your name, language and sign-in.')
            : visible.length > 2
              ? t('Organization, modules, people, offices, rules and your own account.')
              : t('How the organization is set up, and your own account.')
        }
      />
      <div className={cn('grid gap-6', visible.length > 1 && 'lg:grid-cols-[210px_minmax(0,1fr)]')}>
        {visible.length > 1 && (
          <>
            <div className="lg:hidden">
              <Select aria-label={t('Settings section')} value={current} options={visible.map((x) => ({ value: x.key, label: x.label }))} onChange={(e) => setTab(e.target.value)} />
            </div>
            <nav aria-label={t('Settings sections')} className="hidden lg:block">
              <div role="tablist" aria-orientation="vertical" className="sticky top-4 flex flex-col gap-px">
                {visible.map((x) => {
                  const Icon = x.icon;
                  const on = x.key === current;
                  return (
                    <button
                      key={x.key}
                      type="button"
                      role="tab"
                      aria-selected={on}
                      onClick={() => setTab(x.key)}
                      className={cn(
                        'relative flex h-8 items-center gap-2 px-3 text-left text-[13px] transition-colors',
                        on
                          ? 'bg-[var(--agent-app-accent)]/10 font-medium text-[var(--agent-app-accent)]'
                          : 'text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30 hover:text-[var(--agent-app-text)]',
                      )}
                    >
                      {on && <span aria-hidden className="absolute bottom-0 left-0 h-full w-0.5 bg-[var(--agent-app-accent)]" />}
                      <Icon size={14} aria-hidden className="shrink-0" />
                      <span className="min-w-0 truncate">{x.label}</span>
                    </button>
                  );
                })}
              </div>
            </nav>
          </>
        )}
        <div role="tabpanel" aria-label={def?.label} className="min-w-0">
          {current === 'organization' && <OrganizationTab />}
          {current === 'modules' && <ModulesTab />}
          {current === 'people' && <AccessTab />}
          {current === 'offices' && <OfficesTab />}
          {current === 'calendars' && <CalendarsTab />}
          {current === 'rules' && <RulesTab />}
          {current === 'fees' && <FeesTab />}
          {current === 'rates' && <RatesTab />}
          {current === 'dimensions' && <DimensionsTab />}
          {current === 'import' && <ImportTab />}
          {current === 'audit' && <AuditTab />}
          {current === 'account' && <AccountTab />}
        </div>
      </div>
    </div>
  );
}
