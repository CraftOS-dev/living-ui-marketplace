/**
 * Settings: one hub with a list of sections on the left and the chosen
 * section on the right (`?tab=`). On phones the list is its own page and a
 * section opens on top of it with a back button. Each person sees the
 * sections their role may use; landing on another says so in one line.
 */
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, BookKey, Building2, ChevronRight, Coins, Hash, LayoutGrid, Lock, Percent, ScrollText, ShieldCheck, Sparkles, Timer, Upload, Users, Wallet } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentSection } from '../../components/settings/Agent.tsx';
import { AuditSection } from '../../components/settings/Audit.tsx';
import { CompanySection } from '../../components/settings/Company.tsx';
import { DefaultAccountsSection } from '../../components/settings/DefaultAccounts.tsx';
import { ImportExportSection } from '../../components/settings/ImportExport.tsx';
import { CurrenciesSection, TaxesSection, TermsSection } from '../../components/settings/Lists.tsx';
import { LocksSection } from '../../components/settings/Locks.tsx';
import { ModulesSection } from '../../components/settings/Modules.tsx';
import { NumberingSection } from '../../components/settings/Numbering.tsx';
import { OpeningSection } from '../../components/settings/Opening.tsx';
import { RolesSection } from '../../components/settings/Roles.tsx';
import { NoRights } from '../../components/settings/shared.tsx';
import { TeamSection } from '../../components/settings/Team.tsx';
import { CircleButton, LoadError, PageHeader, PageSkeleton } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import { can, useMe } from '../../lib/me.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { CompanySettings } from '../../lib/types/settings.ts';
import type { Me } from '../../lib/types.ts';

export type SettingsTab = 'company' | 'modules' | 'team' | 'roles' | 'numbering' | 'taxes' | 'terms' | 'currencies' | 'accounts' | 'agent' | 'locks' | 'opening' | 'import' | 'audit';

interface Section {
  key: SettingsTab;
  label: string;
  sub: string;
  icon: LucideIcon;
  group: string;
  /** May this person open it at all? */
  allowed: (me: Me) => boolean;
  /** The sentence shown to someone without the rights. */
  denied: string;
}

const ADMIN = (me: Me): boolean => me.admin;
/** People who work with documents and the books see the shared lists. */
const BOOKS = (me: Me): boolean => me.admin || can(me, 'sales') || can(me, 'purchasing') || can(me, 'accounting') || can(me, 'banking');
const DATA = (me: Me): boolean => me.admin || (Object.keys(me.levels) as (keyof Me['levels'])[]).some((m) => can(me, m));

const SECTIONS: Section[] = [
  { key: 'company', label: 'Company', sub: 'Name, logo, address, fiscal year', icon: Building2, group: 'Company', allowed: () => true, denied: '' },
  { key: 'modules', label: 'Modules', sub: 'What the company uses', icon: LayoutGrid, group: 'Company', allowed: ADMIN, denied: 'Only an administrator switches modules on and off.' },
  { key: 'agent', label: 'Your AI agent', sub: 'What it may do on its own', icon: Sparkles, group: 'Company', allowed: ADMIN, denied: "Only an administrator changes what your AI agent may do on its own." },
  { key: 'team', label: 'Team', sub: 'Members, invites and sign-ins', icon: Users, group: 'People and access', allowed: ADMIN, denied: 'Only an administrator manages the team.' },
  { key: 'roles', label: 'Roles', sub: 'Who reaches what', icon: ShieldCheck, group: 'People and access', allowed: ADMIN, denied: 'Only an administrator changes roles.' },
  { key: 'numbering', label: 'Numbering', sub: 'Prefixes and next numbers', icon: Hash, group: 'Books', allowed: ADMIN, denied: 'Only an administrator changes numbering.' },
  { key: 'taxes', label: 'Taxes', sub: 'Rates and tax accounts', icon: Percent, group: 'Books', allowed: BOOKS, denied: 'Taxes are looked after by Sales, Purchasing and Accounting.' },
  { key: 'terms', label: 'Payment terms', sub: 'When things fall due', icon: Timer, group: 'Books', allowed: BOOKS, denied: 'Payment terms are looked after by Sales, Purchasing and Accounting.' },
  { key: 'currencies', label: 'Currencies', sub: 'Exchange rates', icon: Coins, group: 'Books', allowed: BOOKS, denied: 'Currencies are looked after by Accounting.' },
  { key: 'accounts', label: 'Default accounts', sub: 'Where postings land', icon: BookKey, group: 'Books', allowed: ADMIN, denied: 'Only an administrator changes the default accounts.' },
  { key: 'locks', label: 'Lock dates', sub: 'Closed and locked periods', icon: Lock, group: 'Books', allowed: ADMIN, denied: 'Only an administrator changes lock dates.' },
  { key: 'opening', label: 'Opening balances', sub: 'Where the books start', icon: Wallet, group: 'Books', allowed: (me) => can(me, 'accounting', 'full'), denied: 'Opening balances are entered by someone with full Accounting rights.' },
  { key: 'import', label: 'Import and export', sub: 'CSV in and out', icon: Upload, group: 'Data', allowed: DATA, denied: 'Your role has nothing to import or export.' },
  { key: 'audit', label: 'Audit trail', sub: 'Who did what, when', icon: ScrollText, group: 'Data', allowed: (me) => me.admin || can(me, 'accounting'), denied: 'The audit trail is for administrators and accountants.' },
];

const ALIASES: Record<string, SettingsTab> = { members: 'team', data: 'import', export: 'import', autonomy: 'agent', defaults: 'accounts' };

function tabOf(raw: string | null): SettingsTab | '' {
  if (raw === null || raw === '') return '';
  const t = ALIASES[raw] ?? raw;
  return SECTIONS.some((s) => s.key === t) ? (t as SettingsTab) : '';
}

export function SettingsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const tab = tabOf(query.get('tab'));
  const visible = SECTIONS.filter((s) => s.allowed(me));
  const shown = tab !== '' ? tab : 'company';
  const section = SECTIONS.find((s) => s.key === shown) ?? SECTIONS[0];
  const settings = useLive(() => op<CompanySettings>('settings.get', {}, { quiet: true }), ['settings', 'counters', 'accounts', 'taxes', 'warehouses', 'banks', 'payment_terms'], []);
  const groups = [...new Set(visible.map((s) => s.group))];
  const open = (k: SettingsTab): void => replaceQuery('settings', { tab: k });

  return (
    <div>
      <div className={cn(tab !== '' && 'hidden @min-[900px]:block')}>
        <PageHeader title="Settings" subtitle={me.company.name} />
      </div>
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-[260px_minmax(0,1fr)] @min-[1100px]:grid-cols-[280px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className={cn('erp-rise erp-d1 flex flex-col gap-4 @min-[900px]:sticky @min-[900px]:top-6 @min-[900px]:self-start', tab !== '' && 'hidden @min-[900px]:flex')}>
          {groups.map((g) => (
            <div key={g}>
              <p className="mb-1.5 px-3 text-[12px] font-semibold text-[var(--erp-muted)]">{g}</p>
              <ul className="flex flex-col gap-0.5 rounded-[22px] bg-[var(--erp-card)] p-1.5 @min-[900px]:bg-transparent @min-[900px]:p-0">
                {visible
                  .filter((s) => s.group === g)
                  .map((s) => {
                    const Icon = s.icon;
                    const on = s.key === shown;
                    return (
                      <li key={s.key}>
                        <button
                          type="button"
                          onClick={() => open(s.key)}
                          aria-current={on ? 'page' : undefined}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-[16px] px-3 py-2.5 text-left transition-colors',
                            on ? '@min-[900px]:bg-[var(--erp-card)] @min-[900px]:shadow-[var(--erp-shadow)]' : 'hover:bg-[var(--erp-row)] @min-[900px]:hover:bg-[var(--erp-card)]/60',
                          )}
                        >
                          <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', on ? 'bg-[var(--erp-row)] @min-[900px]:bg-[var(--erp-solid)] @min-[900px]:text-[var(--erp-on-solid)]' : 'bg-[var(--erp-row)] @min-[900px]:bg-[var(--erp-card)]')}>
                            <Icon size={16} aria-hidden />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[14px] font-semibold">{s.label}</span>
                            <span className="block truncate text-[12px] text-[var(--erp-muted)] @min-[900px]:hidden @min-[1100px]:block">{s.sub}</span>
                          </span>
                          <ChevronRight size={16} aria-hidden className="shrink-0 text-[var(--erp-muted)] @min-[900px]:hidden" />
                        </button>
                      </li>
                    );
                  })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn('min-w-0', tab === '' && 'hidden @min-[900px]:block')}>
          {section !== undefined && (
            <>
              <header className="erp-rise mb-5 flex items-start gap-3">
                <CircleButton icon={ArrowLeft} label="All settings" variant="light" size={40} onClick={() => replaceQuery('settings', {})} className="mt-[-3px] shrink-0 @min-[900px]:hidden" />
                <div className="min-w-0">
                  <h1 className="text-[26px] font-bold leading-[34px] tracking-[-0.01em] @min-[900px]:text-[15px] @min-[900px]:leading-[22px] @min-[900px]:tracking-normal">{section.label}</h1>
                  <p className="mt-0.5 text-[13px] text-[var(--erp-muted)]">{section.sub}</p>
                </div>
              </header>
              <Body section={section} me={me} settings={settings} query={query} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Body({ section, me, settings, query }: { section: Section; me: Me; settings: Live<CompanySettings>; query: URLSearchParams }): React.JSX.Element {
  if (!section.allowed(me)) return <NoRights>{section.denied}</NoRights>;
  const needsSettings: SettingsTab[] = ['company', 'modules', 'numbering', 'accounts', 'agent', 'locks', 'opening'];
  if (needsSettings.includes(section.key)) {
    if (settings.data === null && settings.error !== null) return <LoadError message={settings.error} onRetry={settings.reload} />;
    if (settings.data === null) return <PageSkeleton rows={4} />;
  }
  const s = settings.data;
  const saved = (next: CompanySettings): void => settings.set(next);
  switch (section.key) {
    case 'company':
      return s !== null ? <CompanySection s={s} admin={me.admin} onSaved={saved} /> : <PageSkeleton />;
    case 'modules':
      return s !== null ? <ModulesSection s={s} onSaved={saved} /> : <PageSkeleton />;
    case 'team':
      return <TeamSection />;
    case 'roles':
      return <RolesSection query={query} />;
    case 'numbering':
      return s !== null ? <NumberingSection s={s} onSaved={saved} /> : <PageSkeleton />;
    case 'taxes':
      return <TaxesSection />;
    case 'terms':
      return <TermsSection />;
    case 'currencies':
      return <CurrenciesSection />;
    case 'accounts':
      return s !== null ? <DefaultAccountsSection s={s} onSaved={saved} /> : <PageSkeleton />;
    case 'agent':
      return s !== null ? <AgentSection s={s} onSaved={saved} /> : <PageSkeleton />;
    case 'locks':
      return s !== null ? <LocksSection s={s} onSaved={saved} /> : <PageSkeleton />;
    case 'opening':
      return s !== null ? <OpeningSection s={s} /> : <PageSkeleton />;
    case 'import':
      return <ImportExportSection />;
    case 'audit':
      return <AuditSection />;
  }
}
