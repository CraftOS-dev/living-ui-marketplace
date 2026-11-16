/**
 * Settings: a list of sections on the left (a strip on phones) and the
 * section on the right. What a person sees follows their role: everyone has
 * Security and Notifications; administrators the rest.
 */
import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Bell, Bot, Building, Building2, CalendarDays, ClipboardList, Clock, Database, KeyRound, Landmark, Lock, MapPin, Network, ShieldCheck, Users } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, PageBody, PageHeader } from '../../components/ui.tsx';
import { allowed, useMe } from '../../lib/auth.tsx';
import type { PageProps, RouteDef } from '../../lib/contract.ts';
import { t } from '../../lib/i18n.ts';
import { navigate } from '../../lib/router.ts';
import { useOp } from '../../lib/live.ts';
import { SecurityPanels } from '../auth/Security.tsx';
import { CalendarsSection, SchedulesSection } from './Calendars.tsx';
import { AgentSection, CompanySection, NotificationsSection } from './Company.tsx';
import { AuditSection, DataSection } from './DataAudit.tsx';
import { EntitiesSection, EntityDetail } from './Entities.tsx';
import { FlowsSection } from './Flows.tsx';
import { MembersSection, RolesSection } from './Members.tsx';
import { LocationsSection, OrgSection } from './OrgLists.tsx';
import { useEffect } from 'react';

interface Section {
  key: string;
  label: string;
  icon: LucideIcon;
  perm: string;
  component: ComponentType<PageProps>;
  group: 'company' | 'people' | 'access' | 'you';
}

function sections(): Section[] {
  return [
    { key: 'company', label: t('settings.company'), icon: Building, perm: 'admin:view', component: CompanySection, group: 'company' },
    { key: 'entities', label: t('settings.entities'), icon: Building2, perm: 'admin:view', component: EntitiesSection, group: 'company' },
    { key: 'locations', label: t('settings.locations'), icon: MapPin, perm: 'people:view|admin:view', component: LocationsSection, group: 'company' },
    { key: 'org', label: t('settings.org'), icon: Network, perm: 'people:view|admin:view', component: OrgSection, group: 'people' },
    { key: 'calendars', label: t('settings.calendars'), icon: CalendarDays, perm: 'people:view|time:view|admin:view', component: CalendarsSection, group: 'people' },
    { key: 'schedules', label: t('settings.schedules'), icon: Clock, perm: 'people:view|time:view|admin:view', component: SchedulesSection, group: 'people' },
    { key: 'approvals', label: t('settings.approvals'), icon: ClipboardList, perm: 'admin:view', component: FlowsSection, group: 'people' },
    { key: 'members', label: t('settings.members'), icon: Users, perm: 'admin:view', component: MembersSection, group: 'access' },
    { key: 'roles', label: t('settings.roles'), icon: ShieldCheck, perm: 'admin:view', component: RolesSection, group: 'access' },
    { key: 'agent', label: t('settings.agent'), icon: Bot, perm: 'admin:view', component: AgentSection, group: 'access' },
    { key: 'data', label: t('settings.data'), icon: Database, perm: 'people:full|admin:view', component: DataSection, group: 'access' },
    { key: 'audit', label: t('settings.audit'), icon: Landmark, perm: 'admin:view', component: AuditSection, group: 'access' },
    { key: 'security', label: t('settings.security'), icon: KeyRound, perm: 'signed', component: () => <SecurityPanels />, group: 'you' },
    { key: 'notifications', label: t('settings.notifications'), icon: Bell, perm: 'signed', component: NotificationsSection, group: 'you' },
  ];
}

const GROUPS: Section['group'][] = ['company', 'people', 'access', 'you'];

function SettingsPage(props: PageProps): React.JSX.Element {
  const me = useMe();
  const list = sections().filter((s) => allowed(me, s.perm));
  const key = props.params['section'] ?? '';
  const current = list.find((s) => s.key === key) ?? null;
  // A section that exists but is not this role's says so, as every other page does (no silent jump).
  const barred = current === null && key !== '' && sections().some((s) => s.key === key);
  useEffect(() => {
    if (current === null && !barred && list[0] !== undefined) navigate(`/settings/${list[0].key}`);
  }, [current, barred, list]);
  if (barred)
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
  const Body = current?.component;
  return (
    <>
      <PageHeader title={t('settings.title')} meta={current?.label} />
      <PageBody>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[208px_minmax(0,1fr)]">
          <nav aria-label={t('settings.title')} className="hr-scroll -mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:px-0 lg:pb-0">
            {GROUPS.map((g) => {
              const items = list.filter((s) => s.group === g);
              if (items.length === 0) return null;
              return (
                <div key={g} className="flex shrink-0 gap-1 lg:mb-3 lg:flex-col lg:gap-0.5">
                  <div className="hr-label hidden px-2.5 pb-1 lg:block">{t(`settings.group.${g}`)}</div>
                  {items.map((s) => {
                    const Icon = s.icon;
                    const on = s.key === current?.key;
                    return (
                      <a
                        key={s.key}
                        href={`#/settings/${s.key}`}
                        aria-current={on ? 'page' : undefined}
                        className={cn('hr-focus hr-tap relative flex h-8 shrink-0 items-center gap-2 whitespace-nowrap rounded-[var(--hr-radius-sm)] px-2.5 text-[13px] transition-colors', on ? 'bg-[var(--hr-active)] font-semibold text-[var(--hr-ink)]' : 'text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]')}
                      >
                        {on && <span aria-hidden className="absolute left-0 top-1.5 hidden h-5 w-[2px] rounded-full bg-[var(--hr-ink)] lg:block" />}
                        <Icon size={14} strokeWidth={1.8} aria-hidden />
                        {s.label}
                      </a>
                    );
                  })}
                </div>
              );
            })}
          </nav>
          {/* One column: every section stacks its panels full width in a readable measure. */}
          <div className="min-w-0 max-w-[880px]">{Body !== undefined && <Body {...props} />}</div>
        </div>
      </PageBody>
    </>
  );
}

function EntityPage(props: PageProps): React.JSX.Element {
  const id = props.params['id'] ?? '';
  const live = useOp<{ entity: { name: string; country: string; currency: string } }>('entities.get', { entity: id }, ['entities'], { name: 'settings.entity' });
  const ent = live.data?.entity ?? null;
  return (
    <>
      <PageHeader title={ent?.name ?? t('settings.entities')} meta={ent !== null ? `${t('settings.entities')} · ${ent.country} · ${ent.currency}` : undefined} back="#/settings/entities" />
      <PageBody>
        <div className="max-w-[880px]">
          <EntityDetail id={props.params['id'] ?? ''} />
        </div>
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [
  { path: '/settings', page: SettingsPage, title: t('settings.title') },
  { path: '/settings/:section', page: SettingsPage, title: t('settings.title') },
  { path: '/settings/entities/:id', page: EntityPage, title: t('settings.entities'), perm: 'admin:view' },
];
