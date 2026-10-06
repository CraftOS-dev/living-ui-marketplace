/**
 * Apps (#/apps, #/app/<id>) — every app on the server beside the one you chose (v4 §16, N-B27).
 * On wide screens the list (Running / Stopped, with live CPU and memory) stays on the left and the
 * chosen app's page opens on the right; on phones they are two pages. "Add an app" installs one from
 * NetSentry's list, secure by default.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, EmptyState, Pill, SearchInput, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { Breadcrumbs } from '../components/Breadcrumbs.tsx';
import { AppIcon } from '../components/Apps.tsx';
import { TONE_COLOR } from '../components/visual.tsx';
import { appName, loadCatalogue } from '../lib/apps.ts';
import { agoWords, useLive } from '../lib/liveStatus.tsx';
import { useMe } from '../lib/me.tsx';
import { go, to } from '../lib/nav.ts';
import type { AppRecord, CatalogueApp, Finding, Observation } from '../lib/types.ts';
import { AppPage, type AppPart } from './AppPage.tsx';

/** Wide enough for the list beside the app? */
function useWide(): boolean {
  const q = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = (): void => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, []);
  return wide;
}

function bytesShort(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)} GB`;
  if (n >= 1e6) return `${Math.round(n / 1e6)} MB`;
  return `${Math.round(n / 1e3)} KB`;
}

function AppList({ selected, onPick }: { selected: string | null; onPick: (id: string) => void }): React.JSX.Element {
  const { can } = useMe();
  const live = useLive();
  const apps = useCollection<AppRecord>('apps', { filter: 'status = "active"', sort: 'display_name' });
  // The same problems Home counts on each app and the app's page lists: open, naming the app.
  const fails = useCollection<Finding>('findings', { filter: 'status = "open"' });
  const reports = useCollection<Observation>('observations', { filter: 'kind = "container" && present = true' });
  const [cat, setCat] = useState<CatalogueApp[]>([]);
  useEffect(() => void loadCatalogue().then(setCat), []);
  const [q, setQ] = useState('');

  const stateOf = (a: AppRecord): 'running' | 'stopped' | 'unknown' => {
    const l = live.app(a.container);
    if (l) return l.running ? 'running' : 'stopped';
    const d = reports.records.find((o) => o.asset === a.asset && o.subject === a.container)?.data as { state?: string; running?: boolean } | undefined;
    if (!d) return a.container ? 'unknown' : 'running';
    return d.running === false || (d.state && d.state !== 'running' && d.state !== 'restarting') ? 'stopped' : 'running';
  };
  const shown = apps.records.filter((a) => !q || appName(a).toLowerCase().includes(q.toLowerCase()));
  const groups: Array<[string, AppRecord[]]> = [
    ['Running', shown.filter((a) => stateOf(a) === 'running')],
    ['Stopped', shown.filter((a) => stateOf(a) === 'stopped')],
    ['Not reported yet', shown.filter((a) => stateOf(a) === 'unknown')],
  ];
  // Bars compare the apps with each other: the one using the most memory fills its bar.
  // Not live (nobody's sample is fresh): the last numbers, said to be from then — never its running/stopped.
  const numbers = live.sample ?? live.last;
  const memMax = Math.max(0, ...(numbers?.apps ?? []).map((x) => (x.running && x.mem) || 0));

  return (
    <div className="flex flex-col">
      <div className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] p-3">
        <SearchInput onSearch={setQ} placeholder="Find an app" label="Find an app" />
      </div>
      {apps.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : shown.length === 0 ? (
        <div className="p-4">
          <EmptyState title={q ? 'No app matches' : 'No apps yet'} message={q ? 'Try another name.' : 'NetSentry lists the apps it finds on this server here — or add one.'} />
        </div>
      ) : (
        <div className="relative lg:max-h-[calc(100vh-260px)] lg:min-h-[320px] lg:overflow-y-auto">
        {groups
          .filter(([, list]) => list.length > 0)
          .map(([title, list]) => (
            <div key={title} role="listbox" aria-label={title}>
              <div className="flex items-center justify-between px-4 pb-1.5 pt-3.5 text-[12px] font-medium uppercase tracking-wide text-[var(--agent-app-muted)]">
                <span>{title}</span>
                <span className="tabular-nums">{list.length}</span>
              </div>
              {list.map((a) => {
                const l = stateOf(a) === 'running' ? live.app(a.container) ?? numbers?.apps.find((x) => x.container === a.container && x.running) ?? null : null;
                const mine = fails.records.filter((f) => (f.evidence as { app_id?: string } | null)?.app_id === a.id);
                const serious = mine.some((e) => e.severity === 'critical' || e.severity === 'high');
                const entry = cat.find((c) => c.id === a.app_type);
                const on = a.id === selected;
                const memPct = l?.mem && memMax ? Math.max(2, Math.min(100, (100 * l.mem) / memMax)) : null;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={on}
                    onClick={() => onPick(a.id)}
                    className={`flex w-full items-center gap-3 border-l-[3px] px-4 py-2.5 text-left ${on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-selected)]' : 'border-transparent hover:bg-[var(--agent-app-surface-2)]'}`}
                  >
                    <span className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-[var(--agent-app-surface-2)] text-[var(--agent-app-muted)]">
                      <AppIcon category={entry?.category ?? ''} size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-1.5">
                        <span className="truncate text-[14px] font-medium">{appName(a)}</span>
                        {mine.length > 0 && <Pill tone={serious ? 'bad' : 'warn'}>{mine.length}</Pill>}
                      </span>
                      <span className="block truncate text-[12px] text-[var(--agent-app-muted)]">
                        {[entry?.what ?? '', a.version ? `v${a.version}` : ''].filter(Boolean).join(' · ') || a.app_type}
                      </span>
                      {l?.running && l.mem !== null && (
                        <span className="mt-1 flex items-center gap-2">
                          <span className="h-1 flex-1 overflow-hidden rounded-full bg-[var(--agent-app-surface-2)]">
                            {memPct !== null && <span className="block h-full rounded-full transition-[width] duration-500" style={{ width: `${memPct}%`, background: live.fresh ? 'var(--agent-app-accent)' : 'var(--agent-app-muted)' }} />}
                          </span>
                          <span className="shrink-0 text-[11.5px] tabular-nums text-[var(--agent-app-muted)]">
                            {bytesShort(l.mem)}
                            {l.cpu !== null ? ` · ${Math.round(l.cpu)}% CPU` : ''}
                          </span>
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      )}
      {can('admin') && (
        <div className="p-3">
          <Button variant="secondary" className="w-full" onClick={() => go('install')}>
            Add an app
          </Button>
        </div>
      )}
    </div>
  );
}

export function Apps({ selected, part }: { selected: string | null; part: AppPart | null }): React.JSX.Element {
  const wide = useWide();
  const live = useLive();
  const apps = useCollection<AppRecord>('apps', { filter: 'status = "active"', sort: 'display_name' });
  // Wide and nothing chosen yet: show the first app (the address stays #/apps).
  const shownId = selected ?? (wide ? apps.records[0]?.id ?? null : null);
  const count = useMemo(() => apps.records.length, [apps.records.length]);

  if (!wide && selected) return <AppPage key={selected} appId={selected} part={part} />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: 'Apps' }]} />
          <h1 className="text-[20px] font-semibold">Apps</h1>
        </div>
        <span className="text-[13px] text-[var(--agent-app-muted)]">
          {count} app{count === 1 ? '' : 's'} on this server
          {live.fresh ? (
            <>
              {' · '}
              <span style={{ color: TONE_COLOR.good }}>live</span>
            </>
          ) : live.at && live.last ? (
            ` · not live — numbers from ${agoWords(live.at)}`
          ) : (
            ''
          )}
        </span>
      </div>
      <div className="grid grid-cols-1 overflow-hidden rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] lg:grid-cols-[300px_minmax(0,1fr)]">
        <div className="border-[var(--agent-app-border)] lg:border-r">
          <AppList selected={shownId} onPick={(id) => go(to.app(id))} />
        </div>
        {wide && (
          <div className="min-w-0 p-5">
            {shownId ? <AppPage key={shownId} appId={shownId} part={selected ? part : null} embedded /> : <EmptyState title="No apps yet" message="Add one, or wait for the monitor to find the ones already running." />}
          </div>
        )}
      </div>
    </div>
  );
}
