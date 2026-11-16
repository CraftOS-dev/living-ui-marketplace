/**
 * Company page `#/companies/:id` and Person page `#/people/:id`: the
 * identity row (letter avatar, domain or email, owner), a FigureStrip
 * (strength, last contact, deals, invested), and tabs from the registry
 * (`companyTabs`, `personTabs`): network's Overview (timeline, people or
 * members with strength) and Network (paths and intros), then other
 * modules' tabs. The one black button asks for the intro on the selected
 * path. Fix 5: a company shows its logo (its own, else its website icon,
 * else its letter); people who may edit it click the logo to choose a new
 * one and get Edit, the company's edit sheet.
 */
import { createContext, Suspense, useContext, useMemo, useState } from 'react';
import { Building2, Pencil, User, Waypoints } from 'lucide-react';
import { Avatar, Button, Empty, LoadError, PageBody, PageHeader, Panel, PersonChip, Skeleton, Tabs } from '../../components/ui.tsx';
import type { Figure } from '../../components/ui.tsx';
import { FigureStrip } from '../../components/ui.tsx';
import { PathsView, usePaths } from '../../components/network/Paths.tsx';
import type { PathsState } from '../../components/network/Paths.tsx';
import { Timeline } from '../../components/network/Timeline.tsx';
import { BAND_TIP, NET_READS, StrengthBar } from '../../components/network/parts.tsx';
import type { Band, MemberRef, RecordFigures } from '../../components/network/types.ts';
import { fmtDay, money } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { CompanyTab, PageProps, PersonTab, RecordLike } from '../../lib/contract.ts';
import { companyTabs, personTabs } from '../../registry.ts';
import { CompanyLogo, LogoPicker } from '../../components/portfolio/Logo.tsx';
import { setCompanyLogo } from '../../components/company/actions.ts';
import { lazyPage } from '../../lib/lazy.ts';

const EditCompanySheet = lazyPage(() => import('../../components/company/EditCompany.tsx'), 'EditCompanySheet');

/** The page's paths (the header's Ask for intro and the Network tab share them). */
const PathsCtx = createContext<PathsState | null>(null);

interface CompanyView {
  id: string;
  name: string;
  domain: string;
  website: string;
  /** The company's own logo ('' when none) and the domain whose website icon stands in. */
  logo_url?: string | undefined;
  logo_domain?: string | undefined;
  sector: string;
  people: { id: string; name: string; email: string; title: string }[];
  [k: string]: unknown;
}

interface PersonView {
  id: string;
  name: string;
  email: string;
  title: string;
  company: { id: string; name: string; domain: string } | null;
  [k: string]: unknown;
}

/** A last contact as a short figure: "40m", "5h", "12d", else the day. */
function since(ts: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(ts)) / 1000);
  if (!Number.isFinite(s)) return '';
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  if (s < 86400 * 60) return `${Math.round(s / 86400)}d`;
  return fmtDay(ts, { year: 'auto' });
}

/** The record as tabs receive it: the record with `invested` and `holdings` (other modules' tabs decide on first render). */
function withHoldings(rec: { id: string } | null, f: RecordFigures | null): RecordLike | null {
  if (rec === null || f === null) return null;
  return { ...rec, invested: f.invested, holdings: f.holdings } as RecordLike;
}

function figuresOf(f: RecordFigures | null, kind: 'company' | 'person'): Figure[] {
  if (f === null) return [];
  const out: Figure[] = [
    { label: 'Strength', value: f.score > 0 ? String(f.score) : '0', tip: BAND_TIP },
    { label: 'Last contact', value: f.last_at !== null ? since(f.last_at) : 'Never' },
    { label: 'Deals', value: String(f.deals) },
  ];
  if (kind === 'company' && f.invested_cost.length > 0) {
    const first = f.invested_cost[0];
    if (first !== undefined) out.push({ label: 'Invested', value: money(first.cost_minor, first.currency, { compact: true }) + (f.invested_cost.length > 1 ? ' +' + String(f.invested_cost.length - 1) : '') });
  }
  return out;
}

function Identity({ name, square, line, owner, logo, action }: { name: string; square: boolean; line: React.ReactNode; owner: MemberRef | null; logo?: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-4 gap-y-2">
      {logo ?? <Avatar name={name} size={40} square={square} />}
      <div className="min-w-0 text-[13px] text-[var(--vo-ink-2)]">{line}</div>
      {owner !== null && (
        <span className="flex min-w-0 items-center gap-2 text-[12px] text-[var(--vo-muted)]">
          <span>Owner</span>
          <PersonChip name={owner.name} size={22} />
        </span>
      )}
      {action !== undefined && action !== null && <span className="ml-auto flex shrink-0 items-center">{action}</span>}
    </div>
  );
}

function useTabs<P>(all: { key: string; label: string; order: number; component: React.ComponentType<P>; show?: ((p: P) => boolean) | undefined; perm?: string | undefined }[], props: P | null) {
  const me = useMe();
  return useMemo(() => all.filter((t) => allowed(me, t.perm) && (props === null || t.show === undefined || t.show(props))).slice(0, 6), [all, me, props]);
}

function AskButton({ state, onNetwork }: { state: PathsState; onNetwork: boolean }): React.JSX.Element | null {
  const me = useMe();
  if (!allowed(me, 'network:edit')) return null;
  if (!onNetwork)
    return (
      <Button variant="primary" icon={Waypoints} onClick={() => setQuery({ tab: 'network' })} aria-label="Ask for intro" title="Ask for intro">
        <span className="max-sm:sr-only">Ask for intro</span>
      </Button>
    );
  return (
    <Button variant="primary" icon={Waypoints} busy={state.asking} disabled={!state.canAsk} onClick={() => void state.ask()} aria-label={state.askLabel} title={state.askLabel}>
      <span className="max-sm:sr-only">{state.askLabel}</span>
    </Button>
  );
}

/* --------------------------------------------------------------- company */

export function CompanyPage({ params, query }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const me = useMe();
  const canEdit = allowed(me, 'network:edit');
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const live = useOp<{ company: CompanyView }>('companies.get', { company: id }, NET_READS, { name: 'net.company' });
  const fig = useOp<RecordFigures>('network.record', { company: id }, NET_READS, { name: 'net.company.fig' });
  const state = usePaths({ company: id });
  const company = live.data?.company ?? null;
  const rec = useMemo(() => withHoldings(company, fig.data), [company, fig.data]);
  const tabs = useTabs<{ company: RecordLike }>(companyTabs() as CompanyTab[], rec !== null ? { company: rec } : null);
  const tabKey = tabs.some((t) => t.key === query.get('tab')) ? (query.get('tab') ?? '') : (tabs[0]?.key ?? '');
  const Tab = tabs.find((t) => t.key === tabKey)?.component;
  if (live.error !== null && company === null)
    return (
      <>
        <PageHeader title="Company" back="#/network" />
        <PageBody>
          <LoadError message={live.error} onRetry={live.reload} />
        </PageBody>
      </>
    );
  return (
    <PathsCtx.Provider value={state}>
      <PageHeader title={company?.name ?? ''} back="#/network">
        <AskButton state={state} onNetwork={tabKey === 'network'} />
      </PageHeader>
      <PageBody>
        {company === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <Identity
              name={company.name}
              square
              logo={
                canEdit ? (
                  <LogoPicker
                    name={company.name}
                    domain={company.logo_domain ?? ''}
                    logoUrl={company.logo_url ?? ''}
                    size={48}
                    busy={uploading}
                    label="Change the logo"
                    onFile={(f) => {
                      setUploading(true);
                      void setCompanyLogo(company.id, f).finally(() => setUploading(false));
                    }}
                  />
                ) : (
                  <CompanyLogo name={company.name} domain={company.logo_domain ?? ''} logoUrl={company.logo_url ?? ''} size={48} />
                )
              }
              action={
                canEdit ? (
                  <Button size="sm" icon={Pencil} onClick={() => setEditing(true)} aria-label="Edit company" title="Edit the company: logo, details, founders and team">
                    Edit
                  </Button>
                ) : null
              }
              line={
                company.domain !== '' ? (
                  <a className="vo-link vo-mono hit text-[12px]" href={company.website !== '' ? company.website : 'https://' + company.domain} target="_blank" rel="noreferrer">
                    {company.domain}
                  </a>
                ) : null
              }
              owner={fig.data?.best_member ?? null}
            />
            <FigureStrip items={figuresOf(fig.data, 'company')} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          {rec === null ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <>
              <Tabs value={tabKey} onChange={(t) => setQuery({ tab: t })} label="Company" tabs={tabs.map((t) => ({ value: t.key, label: t.label }))} />
              {Tab !== undefined && (
                <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                  <Tab company={rec} />
                </Suspense>
              )}
            </>
          )}
        </div>
      </PageBody>
      {company !== null && editing && (
        <Suspense fallback={null}>
          <EditCompanySheet company={company.id} open onClose={() => setEditing(false)} />
        </Suspense>
      )}
    </PathsCtx.Provider>
  );
}

interface CompanyStrength {
  score: number;
  band: Band;
  people: { person: { id: string; name: string; email: string }; score: number; band: Band; last_at: string | null; best_member: MemberRef | null }[];
  people_total: number;
}

export function CompanyOverview({ company }: { company: RecordLike }): React.JSX.Element {
  const s = useOp<CompanyStrength>('network.strength', { company: company.id }, NET_READS, { name: 'net.company.people' });
  const people = (company['people'] as { id: string; name: string; title: string }[] | undefined) ?? [];
  const score: Record<string, CompanyStrength['people'][number]> = {};
  for (const p of s.data?.people ?? []) score[p.person.id] = p;
  const rows = [...people].sort((a, b) => (score[b.id]?.score ?? 0) - (score[a.id]?.score ?? 0));
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <Timeline target={{ company: company.id }} />
      </Panel>
      <Panel label="People" flush>
        {rows.length === 0 ? (
          <Empty icon={User} title="Nobody known yet" className="py-6" />
        ) : (
          <ul className="flex min-w-0 flex-col px-3 pb-3">
            {rows.map((p) => (
              <li key={p.id}>
                <a href={'#/people/' + p.id} className="vo-focus vo-tap flex h-10 min-w-0 items-center gap-2.5 rounded-[var(--vo-radius-sm)] px-2 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                  <Avatar name={p.name} size={24} />
                  <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--vo-ink)]">{p.name}</span>
                  <StrengthBar score={score[p.id]?.score ?? 0} band={score[p.id]?.band ?? 'none'} className="w-[110px] shrink-0" />
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** Network tab: the page's paths (shared with the header's Ask for intro). */
export function NetworkTab(): React.JSX.Element {
  const state = useContext(PathsCtx);
  if (state === null) return <Empty icon={Waypoints} title="No warm path yet" />;
  return (
    <Panel>
      <PathsView state={state} />
    </Panel>
  );
}

/* ---------------------------------------------------------------- person */

export function PersonPage({ params, query }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const live = useOp<{ person: PersonView }>('people.get', { person: id }, NET_READS, { name: 'net.person' });
  const fig = useOp<RecordFigures>('network.record', { person: id }, NET_READS, { name: 'net.person.fig' });
  const state = usePaths({ person: id });
  const person = live.data?.person ?? null;
  const rec = useMemo(() => withHoldings(person, fig.data), [person, fig.data]);
  const tabs = useTabs<{ person: RecordLike }>(personTabs() as PersonTab[], rec !== null ? { person: rec } : null);
  const tabKey = tabs.some((t) => t.key === query.get('tab')) ? (query.get('tab') ?? '') : (tabs[0]?.key ?? '');
  const Tab = tabs.find((t) => t.key === tabKey)?.component;
  if (live.error !== null && person === null)
    return (
      <>
        <PageHeader title="Person" back="#/network" />
        <PageBody>
          <LoadError message={live.error} onRetry={live.reload} />
        </PageBody>
      </>
    );
  return (
    <PathsCtx.Provider value={state}>
      <PageHeader title={person?.name ?? ''} back="#/network">
        <AskButton state={state} onNetwork={tabKey === 'network'} />
      </PageHeader>
      <PageBody>
        {person === null ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <div className="flex min-w-0 flex-col gap-5">
            <Identity
              name={person.name}
              square={false}
              line={
                <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
                  {person.email !== '' && (
                    <a className="vo-link vo-mono vo-wrap hit text-[12px]" href={'mailto:' + person.email}>
                      {person.email}
                    </a>
                  )}
                  {person.company !== null && (
                    <a className="vo-link hit inline-flex items-center gap-1" href={'#/companies/' + person.company.id}>
                      <Building2 size={13} aria-hidden />
                      {person.company.name}
                    </a>
                  )}
                </span>
              }
              owner={fig.data?.best_member ?? null}
            />
            <FigureStrip items={figuresOf(fig.data, 'person')} />
          </div>
        )}
        <div className="flex min-w-0 flex-col gap-4">
          {rec === null ? (
            <Skeleton className="h-9 w-full" />
          ) : (
            <>
              <Tabs value={tabKey} onChange={(t) => setQuery({ tab: t })} label="Person" tabs={tabs.map((t) => ({ value: t.key, label: t.label }))} />
              {Tab !== undefined && (
                <Suspense fallback={<Skeleton className="h-40 w-full" />}>
                  <Tab person={rec} />
                </Suspense>
              )}
            </>
          )}
        </div>
      </PageBody>
    </PathsCtx.Provider>
  );
}

interface PersonStrength {
  members: { member: MemberRef; score: number; band: Band; last_at: string | null; touches: number }[];
}

export function PersonOverview({ person }: { person: RecordLike }): React.JSX.Element {
  const s = useOp<PersonStrength>('network.strength', { person: person.id }, NET_READS, { name: 'net.person.members' });
  const members = s.data?.members ?? [];
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Panel>
        <Timeline target={{ person: person.id }} />
      </Panel>
      <Panel label="Who knows" flush>
        {members.length === 0 ? (
          <Empty icon={User} title="Nobody yet" className="py-6" />
        ) : (
          <ul className="flex min-w-0 flex-col px-3 pb-3">
            {members.map((m) => (
              <li key={m.member.id} className="flex h-10 min-w-0 items-center gap-2.5 px-2">
                <Avatar name={m.member.name} size={24} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--vo-ink)]">{m.member.name}</span>
                <StrengthBar score={m.score} band={m.band} className="w-[110px] shrink-0" />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
