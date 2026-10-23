/**
 * Discover: search the open registries (Crossref, arXiv, OpenAlex, PubMed)
 * with every executed query and count shown, triage what comes back, keep
 * searches with an alert, hand a question to your AI agent for a deep search,
 * and map the citations around your papers.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Bell, BellOff, Check, CircleDot, ExternalLink, Filter, Library, Network, Plus, RefreshCw, Save, Search as SearchIcon, Sparkles, Star, Telescope, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { op, OpError } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { changed, useLive } from '../lib/live.ts';
import { ago, byline, clip, num, plural } from '../lib/format.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { Candidate, Search, SearchRun } from '../lib/types.ts';
import { askAgent, RequestStatus } from '../components/agent.tsx';
import { AgentMark } from '../components/paper.tsx';
import { Badge, Button, Empty, IconButton, LoadError, PageHeader, Popover, Segmented, Select, Skeleton, Spinner, Tabs, Toggle, inputCls, useConfirm } from '../components/ui.tsx';

type Tab = 'search' | 'saved' | 'map';
const SOURCES: { key: string; label: string }[] = [
  { key: 'crossref', label: 'Crossref' },
  { key: 'openalex', label: 'OpenAlex' },
  { key: 'arxiv', label: 'arXiv' },
  { key: 'pubmed', label: 'PubMed' },
];

export default function DiscoverPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const tab = (query.get('tab') ?? 'search') as Tab;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader icon={Telescope} title="Discover" />
      <Tabs label="Discover" value={tab} onChange={(t) => replaceQuery({ tab: t === 'search' ? undefined : t })} options={[{ value: 'search', label: 'Search' }, { value: 'saved', label: 'Saved searches' }, { value: 'map', label: 'Citation map' }]} />
      {tab === 'search' && <SearchTab searchId={query.get('search') ?? ''} />}
      {tab === 'saved' && <SavedTab />}
      {tab === 'map' && <MapTab />}
    </div>
  );
}

/* --------------------------------------------------------------- search */

function SearchTab({ searchId }: { searchId: string }): React.JSX.Element {
  const { projects } = useApp();
  const [q, setQ] = useState('');
  const [sources, setSources] = useState<string[]>(['crossref', 'openalex', 'arxiv']);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [oa, setOa] = useState(false);
  const [busy, setBusy] = useState(false);
  const [project, setProject] = useState('');
  const [req, setReq] = useState('');
  const filtersBtn = useRef<HTMLButtonElement | null>(null);
  const [filters, setFilters] = useState(false);
  const s = useLive((signal) => (searchId !== '' ? op<{ search: Search; runs: SearchRun[] }>('search.get', { search: searchId }, { quiet: true, signal }) : Promise.resolve(null)), ['searches', 'search_runs'], [searchId], 200);
  useEffect(() => {
    const x = s.data?.search;
    if (x) {
      setQ(x.query);
      setSources(x.sources.length > 0 ? x.sources : ['crossref', 'openalex', 'arxiv']);
      setFrom(x.filters.from_year ? String(x.filters.from_year) : '');
      setTo(x.filters.to_year ? String(x.filters.to_year) : '');
      setOa(!!x.filters.oa);
      if (x.project !== '') setProject(x.project);
    }
  }, [s.data?.search]);
  const run = async (opts: { deep?: boolean } = {}): Promise<void> => {
    if (q.trim() === '' || sources.length === 0) return;
    setBusy(true);
    try {
      const r = await op<{ search: Search; run: SearchRun }>('search.run', { query: q.trim(), sources: sources.join(','), from_year: from ? Number(from) : undefined, to_year: to ? Number(to) : undefined, oa: oa || undefined, project: project || undefined, save: opts.deep ? true : undefined });
      changed('searches', 'search_runs', 'candidates');
      replaceQuery({ search: r.search.id });
      if (opts.deep) {
        const id = await askAgent('search_requested', { search: r.search.id }, 'Asked your AI agent to search in depth and explain each paper it files');
        if (id !== '') setReq(id);
      }
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const runs = s.data?.runs ?? [];
  const lastRun = runs[0] ?? null;
  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-2 rounded-[var(--ro-r-lg)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3 shadow-[var(--ro-shadow-sm)]"
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <div className="flex items-center gap-2">
          <SearchIcon size={16} className="shrink-0 text-[var(--ro-muted)]" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search papers: a topic, a question, an author" aria-label="Search papers" className="h-9 min-w-0 flex-1 bg-transparent text-[15px] outline-none" />
          <Button type="submit" variant="primary" icon={SearchIcon} loading={busy} disabled={q.trim() === '' || sources.length === 0}>
            Search
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--ro-hair)] pt-2">
          {SOURCES.map((src) => {
            const on = sources.includes(src.key);
            return (
              <button key={src.key} type="button" aria-pressed={on} onClick={() => setSources((l) => (on ? l.filter((x) => x !== src.key) : [...l, src.key]))} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', on ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]')}>
                {on && <Check size={12} />} {src.label}
              </button>
            );
          })}
          <span className="mx-1 h-5 w-px bg-[var(--ro-line)]" />
          <Button ref={filtersBtn} size="sm" variant="ghost" icon={Filter} onClick={() => setFilters((f) => !f)}>
            {from || to || oa ? [from || to ? (from || '...') + '–' + (to || 'now') : '', oa ? 'open access' : ''].filter((x) => x !== '').join(', ') : 'Filters'}
          </Button>
          <Popover open={filters} anchor={filtersBtn} onClose={() => setFilters(false)} className="w-64 p-3">
            <div className="flex flex-col gap-2.5">
              <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Published</span>
              <div className="flex items-center gap-2">
                <input value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="From" aria-label="From year" inputMode="numeric" className={cn(inputCls, 'w-20')} />
                <span className="text-[12px] text-[var(--ro-muted)]">to</span>
                <input value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 4))} placeholder="Now" aria-label="To year" inputMode="numeric" className={cn(inputCls, 'w-20')} />
              </div>
              <label className="flex items-center justify-between gap-2 text-[13px]">
                Open access only <Toggle checked={oa} onChange={setOa} label="Open access only" />
              </label>
            </div>
          </Popover>
          <span className="flex-1" />
          {projects.filter((p) => p.state === 'active').length > 0 && <Select ariaLabel="For project" className="w-52" value={project} onChange={setProject} options={[{ value: '', label: 'Not for a project' }, ...projects.filter((p) => p.state === 'active').map((p) => ({ value: p.id, label: p.name }))]} />}
          <Button size="sm" icon={Sparkles} disabled={q.trim() === '' || busy} onClick={() => void run({ deep: true })} title="Your AI agent searches further, reads the abstracts and files the papers worth reading, each with its reason">
            Deep search
          </Button>
        </div>
      </form>
      {req !== '' && <RequestStatus id={req} />}
      {searchId === '' ? (
        <Empty icon={Telescope} title="Find papers">
          Results show where they came from and why each was suggested; nothing enters your library until you add it.
        </Empty>
      ) : s.data === null ? (
        <Skeleton className="h-40" />
      ) : (
        <div className="grid grid-cols-1 gap-3 @min-[1100px]:grid-cols-[260px_minmax(0,1fr)]">
          <RunRail search={s.data.search} run={lastRun} />
          <Candidates search={s.data.search} project={project} />
        </div>
      )}
    </div>
  );
}

function RunRail({ search, run }: { search: Search; run: SearchRun | null }): React.JSX.Element {
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await op('search.update', { search: search.id, ...patch });
    changed('searches');
  };
  return (
    <aside className="flex flex-col gap-3 self-start rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3">
      <div className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{search.name || search.query}</span>
        {!search.saved ? (
          <Button size="sm" icon={Save} onClick={() => void save({ saved: true })}>
            Keep
          </Button>
        ) : (
          <Badge tone="good">Saved</Badge>
        )}
      </div>
      {search.saved && <Segmented label="Alert" size="sm" value={search.alert} onChange={(v) => void save({ alert: v })} options={[{ value: 'off', label: 'No alert', icon: BellOff }, { value: 'daily', label: 'Daily', icon: Bell }, { value: 'weekly', label: 'Weekly' }]} />}
      {run !== null && (
        <>
          <div className="grid grid-cols-3 gap-1 text-center">
            {[
              { l: 'Looked at', n: run.evaluated },
              { l: 'Found', n: run.found },
              { l: 'New', n: run.new },
            ].map((x) => (
              <div key={x.l} className="rounded-[var(--ro-r)] bg-[var(--ro-row)] py-1.5">
                <div className="num text-[15px] font-bold">{num(x.n)}</div>
                <div className="text-[12px] text-[var(--ro-muted)]">{x.l}</div>
              </div>
            ))}
          </div>
          <ol className="flex flex-col gap-1.5">
            {run.queries.map((qq, i) => (
              <li key={i} className="flex flex-col gap-0.5 border-l-2 border-[var(--ro-line)] pl-2">
                <span className="flex items-center gap-1.5 text-[12px] font-semibold">
                  <CircleDot size={10} className={qq.error !== '' ? 'text-[var(--ro-red)]' : 'text-[var(--ro-green-text)]'} />
                  {SOURCES.find((x) => x.key === qq.source)?.label ?? qq.source}
                  <span className="num ml-auto text-[var(--ro-muted)]">
                    {num(qq.count)}
                    {qq.total > qq.count ? ' of ' + num(qq.total) : ''}
                  </span>
                </span>
                <span className="break-words font-mono text-[12px] leading-4 text-[var(--ro-muted)]">{clip(qq.query, 160)}</span>
                {qq.error !== '' && <span className="text-[12px] text-[var(--ro-red-text)]">{qq.error}</span>}
              </li>
            ))}
          </ol>
          {run.stop_reason !== '' && <p className="text-[12px] leading-4 text-[var(--ro-muted)]">Stopped: {run.stop_reason}</p>}
          <p className="flex items-center gap-1 text-[12px] text-[var(--ro-muted)]">
            {run.actor === 'agent' && <AgentMark title="Run by your AI agent" />}
            {ago(run.finished_at || run.created)}
          </p>
        </>
      )}
    </aside>
  );
}

const TRIAGE: { v: string; label: string }[] = [
  { v: 'new,relevant', label: 'To look at' },
  { v: 'relevant', label: 'Relevant' },
  { v: 'added', label: 'Added' },
  { v: 'not_relevant,dismissed', label: 'Set aside' },
];

function Candidates({ search, project }: { search: Search; project: string }): React.JSX.Element {
  const [triage, setTriage] = useState('new,relevant');
  const [sort, setSort] = useState<'rank' | 'cited_by' | 'year' | 'newest'>('rank');
  const list = useLive((signal) => op<{ candidates: Candidate[]; total: number }>('candidates.list', { search: search.id, triage, sort, limit: 200 }, { quiet: true, signal }), ['candidates', 'works'], [search.id, triage, sort], 150);
  const rows = list.data?.candidates ?? [];
  const setT = async (ids: string[], t: 'relevant' | 'not_relevant' | 'new' | 'dismissed'): Promise<void> => {
    await op('candidates.triage', { candidates: ids, triage: t });
    changed('candidates');
  };
  const add = async (ids: string[]): Promise<void> => {
    try {
      const r = await op<{ added: number; existing: number }>('candidates.add', { candidates: ids, project: project || undefined });
      changed('candidates', 'works', 'project_works');
      toast.success(plural(r.added, 'paper') + ' added to the library' + (r.existing > 0 ? ' (' + r.existing + ' already there)' : ''));
    } catch {
      /* toasted */
    }
  };
  const relevant = rows.filter((c) => c.triage === 'relevant');
  return (
    <section className="flex min-w-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {TRIAGE.map((t) => (
          <button key={t.v} type="button" onClick={() => setTriage(t.v)} className={cn('h-7 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', triage === t.v ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]')}>
            {t.label}
          </button>
        ))}
        <span className="num text-[12px] text-[var(--ro-muted)]">{list.data ? plural(list.data.total, 'paper') : ''}</span>
        <span className="flex-1" />
        {relevant.length > 1 && (
          <Button size="sm" icon={Plus} onClick={() => void add(relevant.map((c) => c.id))}>
            Add {relevant.length} relevant
          </Button>
        )}
        <Select ariaLabel="Order" className="w-40" value={sort} onChange={(v) => setSort(v as typeof sort)} options={[{ value: 'rank', label: 'Best match' }, { value: 'cited_by', label: 'Most cited' }, { value: 'year', label: 'Newest published' }, { value: 'newest', label: 'Newest found' }]} />
      </div>
      {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
      {list.data === null && list.error === null && <Skeleton className="h-40" />}
      {list.data !== null && rows.length === 0 && <Empty compact icon={SearchIcon} title="Nothing here" />}
      <ul className="flex flex-col gap-2">
        {rows.map((c) => (
          <li key={c.id} className={cn('flex gap-3 rounded-[var(--ro-r-md)] border bg-[var(--ro-card)] p-3', c.triage === 'relevant' ? 'border-[var(--ro-green)]/50' : 'border-[var(--ro-line)]')}>
            <div className="min-w-0 flex-1">
              <span className="flex items-start gap-2">
                <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">{c.title}</span>
                {c.relevance !== '' && <Badge tone={c.relevance === 'high' ? 'good' : c.relevance === 'medium' ? 'info' : 'neutral'}>{c.relevance}</Badge>}
              </span>
              <span className="mt-0.5 block truncate text-[12px] text-[var(--ro-muted)]">{byline({ authors_short: c.authors_short, container: c.venue, year: c.year })}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-[var(--ro-muted)]">
                {c.cited_by > 0 && (
                  <span className="num inline-flex items-center gap-1">
                    <Star size={11} /> {num(c.cited_by)} citations
                  </span>
                )}
                {c.oa_url !== '' && <Badge tone="good">Open access</Badge>}
                <span>{SOURCES.find((x) => x.key === c.source)?.label ?? c.source}</span>
                {c.identifier !== '' && (
                  <a href={c.doi !== '' ? 'https://doi.org/' + c.doi : c.arxiv_id !== '' ? 'https://arxiv.org/abs/' + c.arxiv_id : '#'} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 font-mono hover:text-[var(--ro-ink)]">
                    {clip(c.identifier, 40)} <ExternalLink size={10} />
                  </a>
                )}
              </span>
              {c.reason !== '' && (
                <p className="mt-1.5 flex items-start gap-1.5 text-[12px] leading-4 text-[var(--ro-ink-2)]">
                  <AgentMark title="Your AI agent's reason" />
                  {c.reason}
                </p>
              )}
              {c.abstract !== '' && <details className="mt-1.5"><summary className="cursor-pointer text-[12px] font-semibold text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">Abstract</summary><p className="serif mt-1 text-[13px] leading-5 text-[var(--ro-ink-2)]">{c.abstract}</p></details>}
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1">
              {c.triage === 'added' || c.work !== '' ? (
                <Button size="sm" icon={Library} onClick={() => navigate('paper', { id: c.work })}>
                  In library
                </Button>
              ) : (
                <Button size="sm" variant="primary" icon={Plus} onClick={() => void add([c.id])}>
                  Add
                </Button>
              )}
              <span className="flex gap-0.5">
                <IconButton icon={Check} label="Relevant" size={26} active={c.triage === 'relevant'} onClick={() => void setT([c.id], c.triage === 'relevant' ? 'new' : 'relevant')} className={c.triage === 'relevant' ? 'text-[var(--ro-green-text)]' : ''} />
                <IconButton icon={X} label="Not relevant" size={26} variant="danger" onClick={() => void setT([c.id], 'not_relevant')} />
              </span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

/* ---------------------------------------------------------------- saved */

function SavedTab(): React.JSX.Element {
  const list = useLive((signal) => op<{ searches: Search[] }>('search.list', { saved: true, limit: 200 }, { quiet: true, signal }).then((r) => r.searches), ['searches', 'search_runs', 'candidates'], [], 200);
  const [confirmNode, confirm] = useConfirm();
  const [running, setRunning] = useState('');
  const runAgain = async (s: Search): Promise<void> => {
    setRunning(s.id);
    try {
      await op('search.run', { search: s.id });
      changed('searches', 'search_runs', 'candidates');
    } catch {
      /* toasted */
    } finally {
      setRunning('');
    }
  };
  if (list.error !== null) return <LoadError message={list.error} onRetry={list.reload} />;
  if (list.data === null) return <Skeleton className="h-40" />;
  if (list.data.length === 0)
    return (
      <Empty icon={Save} title="No saved searches" action={<Button icon={SearchIcon} onClick={() => replaceQuery({ tab: undefined })}>Search</Button>}>
        Keep a search with an alert and new papers arrive on Home.
      </Empty>
    );
  return (
    <>
      <ul className="grid grid-cols-1 gap-2 @min-[900px]:grid-cols-2">
        {list.data.map((s) => (
          <li key={s.id} className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3">
            <button type="button" onClick={() => replaceQuery({ tab: undefined, search: s.id })} className="flex items-start gap-2 text-left">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{s.name || s.query}</span>
                <span className="block truncate font-mono text-[12px] text-[var(--ro-muted)]">{s.query}</span>
              </span>
              {s.new_count > 0 && <Badge tone="info">{num(s.new_count)} new</Badge>}
            </button>
            <span className="flex flex-wrap items-center gap-2 text-[12px] text-[var(--ro-muted)]">
              <span>{s.sources.map((x) => SOURCES.find((y) => y.key === x)?.label ?? x).join(', ')}</span>
              <span>{plural(s.candidates, 'candidate')}</span>
              {s.last_run_at !== '' && <span>ran {ago(s.last_run_at)}</span>}
              {s.actor === 'agent' && <AgentMark title="Made by your AI agent" />}
            </span>
            <span className="flex items-center gap-1.5">
              <Segmented label="Alert" size="sm" value={s.alert} onChange={(v) => void op('search.update', { search: s.id, alert: v }).then(() => changed('searches'))} options={[{ value: 'off', label: 'Off' }, { value: 'daily', label: 'Daily' }, { value: 'weekly', label: 'Weekly' }]} />
              <span className="flex-1" />
              <IconButton icon={RefreshCw} label="Run again" onClick={() => void runAgain(s)} className={running === s.id ? 'animate-spin' : ''} />
              <IconButton
                icon={Trash2}
                label="Delete"
                variant="danger"
                onClick={async () => {
                  if (!(await confirm('Delete "' + (s.name || s.query) + '" and its candidates? Papers you added stay.', 'Delete search', 'Delete'))) return;
                  await op('search.delete', { search: s.id });
                  changed('searches', 'candidates');
                }}
              />
            </span>
          </li>
        ))}
      </ul>
      {confirmNode}
    </>
  );
}

/* ------------------------------------------------------------------ map */

interface MapNode {
  id: string;
  doi: string;
  title: string;
  year: number;
  authors: string;
  venue: string;
  cited_by: number;
  type: string;
  oa_url: string;
  roles: string[];
  refs_from_seeds: number;
  cites_seeds: number;
  work: string;
}

interface MapData {
  seeds: { work: string; openalex_id: string; title: string }[];
  nodes: MapNode[];
  edges: { from: string; to: string }[];
  top_cited: MapNode[];
  top_citing: MapNode[];
  without_openalex: string[];
  unreachable: boolean;
}

function MapTab(): React.JSX.Element {
  const { projects, collections } = useApp();
  const active = projects.filter((p) => p.state === 'active');
  const [scope, setScope] = useState<string>(active[0] ? 'p:' + active[0].id : collections[0] ? 'c:' + collections[0].id : '');
  const [citing, setCiting] = useState(true);
  const [sel, setSel] = useState<MapNode | null>(null);
  const params = scope.startsWith('p:') ? { project: scope.slice(2) } : scope.startsWith('c:') ? { collection: scope.slice(2) } : null;
  // A project or collection with no papers yet has nothing to map: an empty map, not an error.
  const data = useLive(
    (signal) =>
      params !== null
        ? op<MapData>('citations.map', { ...params, citing }, { quiet: true, signal }).catch((err: unknown) => {
            if (err instanceof OpError && err.code === 'no_seeds') return { seeds: [], nodes: [], edges: [], top_cited: [], top_citing: [], without_openalex: [], unreachable: false } as MapData;
            throw err;
          })
        : Promise.resolve(null),
    ['project_works', 'collection_items'],
    [scope, citing],
    300,
  );
  const add = async (n: MapNode): Promise<void> => {
    const id = n.doi !== '' ? n.doi : n.id;
    try {
      await op('works.add', { ids: id, source: 'citation_map', project: scope.startsWith('p:') ? scope.slice(2) : undefined });
      changed('works', 'project_works');
      toast.success('Added to the library');
    } catch {
      /* toasted */
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Network size={14} className="text-[var(--ro-muted)]" />
        <span className="text-[13px] font-semibold">Around</span>
        <Select ariaLabel="Seed papers" className="w-64" value={scope} onChange={setScope} options={[...active.map((p) => ({ value: 'p:' + p.id, label: 'Project: ' + p.name })), ...collections.map((c) => ({ value: 'c:' + c.id, label: 'Collection: ' + c.name }))]} />
        <label className="flex items-center gap-2 text-[12px] font-semibold">
          <Toggle checked={citing} onChange={setCiting} label="Include papers citing them" /> Papers citing them
        </label>
      </div>
      {params === null ? (
        <Empty icon={Network} title="Nothing to map yet">
          The map starts from a project's reading list or a collection.
        </Empty>
      ) : data.error !== null ? (
        <LoadError message={data.error} onRetry={data.reload} />
      ) : data.data !== null && data.data.seeds.length === 0 ? (
        <Empty icon={Network} title="No papers here yet">
          Add papers to this project or collection and their citations appear here.
        </Empty>
      ) : data.data === null ? (
        <div className="flex h-72 flex-col items-center justify-center gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <Spinner size={20} />
          <span className="text-[12px] text-[var(--ro-muted)]">Following the citations in OpenAlex</span>
        </div>
      ) : (
        <>
          {data.data.unreachable && <Badge tone="warn">OpenAlex did not answer for some papers; the map may be partial</Badge>}
          {data.data.without_openalex.length > 0 && <p className="text-[12px] text-[var(--ro-muted)]">{plural(data.data.without_openalex.length, 'paper')} could not be found in OpenAlex.</p>}
          <div className="grid grid-cols-1 gap-3 @min-[1100px]:grid-cols-[minmax(0,1fr)_320px]">
            <Scatter d={data.data} sel={sel} onSel={setSel} />
            <aside className="flex flex-col gap-3">
              {sel !== null ? <NodeCard n={sel} onAdd={() => void add(sel)} onClose={() => setSel(null)} /> : null}
              <TopList title="Top cited" sub="Most referenced by your papers" rows={data.data.top_cited} metric={(n) => n.refs_from_seeds} onSel={setSel} onAdd={(n) => void add(n)} />
              <TopList title="Top citing" sub="Citing the most of your papers" rows={data.data.top_citing} metric={(n) => n.cites_seeds} onSel={setSel} onAdd={(n) => void add(n)} />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

const ROLE_COLOR: Record<string, string> = { seed: 'var(--ro-accent)', reference: 'var(--ro-pc-blue)', citing: 'var(--ro-pc-green)' };

function roleOf(n: MapNode): string {
  return n.roles.includes('seed') ? 'seed' : n.roles.includes('reference') ? 'reference' : 'citing';
}

function Scatter({ d, sel, onSel }: { d: MapData; sel: MapNode | null; onSel: (n: MapNode) => void }): React.JSX.Element {
  const [hover, setHover] = useState<MapNode | null>(null);
  const W = 900;
  const H = 460;
  const pad = { l: 48, r: 16, t: 16, b: 34 };
  const pts = d.nodes.filter((n) => n.year > 0);
  const years = pts.map((n) => n.year);
  const y0 = Math.min(...years, new Date().getFullYear() - 10);
  const y1 = Math.max(...years, new Date().getFullYear());
  const maxC = Math.max(1, ...pts.map((n) => n.cited_by));
  const x = (yr: number): number => pad.l + ((yr - y0) / Math.max(1, y1 - y0)) * (W - pad.l - pad.r);
  const y = (c: number): number => H - pad.b - (Math.log10(1 + c) / Math.log10(1 + maxC)) * (H - pad.t - pad.b);
  const r = (n: MapNode): number => 3.5 + Math.sqrt(n.refs_from_seeds + n.cites_seeds) * 2.2 + (roleOf(n) === 'seed' ? 2 : 0);
  const byId = useMemo(() => new Map(pts.map((n) => [n.id, n])), [pts]);
  // Deterministic jitter so papers of one year do not stack.
  const jitter = (id: string): number => {
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
    return ((h % 100) / 100) * 0.7 - 0.35;
  };
  const ticks: number[] = [];
  const step = Math.max(1, Math.ceil((y1 - y0) / 10));
  for (let t = y0; t <= y1; t += step) ticks.push(t);
  const cTicks = [0, 10, 100, 1000, 10000, 100000].filter((c) => c <= maxC * 1.2);
  const focus = hover ?? sel;
  return (
    <div className="relative rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Citation map: year published against citations">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={pad.t} y2={H - pad.b} style={{ stroke: 'var(--ro-hair)' }} />
            <text x={x(t)} y={H - 12} textAnchor="middle" style={{ fill: 'var(--ro-muted)', fontSize: 11 }}>
              {t}
            </text>
          </g>
        ))}
        {cTicks.map((c) => (
          <g key={c}>
            <line x1={pad.l} x2={W - pad.r} y1={y(c)} y2={y(c)} style={{ stroke: 'var(--ro-hair)' }} />
            <text x={pad.l - 6} y={y(c) + 4} textAnchor="end" style={{ fill: 'var(--ro-muted)', fontSize: 11 }}>
              {c >= 1000 ? c / 1000 + 'k' : c}
            </text>
          </g>
        ))}
        {focus !== null &&
          d.edges
            .filter((e) => e.from === focus.id || e.to === focus.id)
            .map((e, i) => {
              const a = byId.get(e.from);
              const b = byId.get(e.to);
              if (!a || !b) return null;
              return <line key={i} x1={x(a.year + jitter(a.id))} y1={y(a.cited_by)} x2={x(b.year + jitter(b.id))} y2={y(b.cited_by)} style={{ stroke: 'var(--ro-ink-2)' }} strokeOpacity={0.35} />;
            })}
        {pts
          .slice()
          .sort((a, b) => (roleOf(a) === 'seed' ? 1 : 0) - (roleOf(b) === 'seed' ? 1 : 0))
          .map((n) => {
            const role = roleOf(n);
            const isSel = sel?.id === n.id;
            return (
              <circle
                key={n.id}
                cx={x(n.year + jitter(n.id))}
                cy={y(n.cited_by)}
                r={r(n)}
                className="cursor-pointer"
                style={{ fill: ROLE_COLOR[role], stroke: n.work !== '' ? 'var(--ro-ink)' : 'var(--ro-card)' }}
                strokeWidth={isSel ? 3 : n.work !== '' ? 1.5 : 1}
                fillOpacity={role === 'seed' ? 0.95 : 0.7}
                onMouseEnter={() => setHover(n)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSel(n)}
              />
            );
          })}
      </svg>
      <div className="pointer-events-none absolute left-14 top-4 flex flex-wrap items-center gap-3 rounded-[var(--ro-r)] bg-[var(--ro-card)]/90 px-2 py-1 text-[12px]">
        {['seed', 'reference', 'citing'].map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-full" style={{ background: ROLE_COLOR[k] }} />
            {k === 'seed' ? 'Your papers' : k === 'reference' ? 'They cite' : 'Citing them'}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-[1.5px] border-[var(--ro-ink)]" /> In your library
        </span>
      </div>
      {hover !== null && (
        <div className="pointer-events-none absolute bottom-10 right-4 max-w-[320px] rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-2.5 py-1.5 shadow-[var(--ro-shadow-sm)]">
          <p className="line-clamp-2 text-[12px] font-semibold leading-4">{hover.title}</p>
          <p className="text-[12px] text-[var(--ro-muted)]">
            {hover.year} · {num(hover.cited_by)} citations
          </p>
        </div>
      )}
    </div>
  );
}

function NodeCard({ n, onAdd, onClose }: { n: MapNode; onAdd: () => void; onClose: () => void }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--ro-r-md)] border border-[var(--ro-ink)] bg-[var(--ro-card)] p-3">
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1 text-[13px] font-semibold leading-[18px]">{n.title || n.id}</span>
        <IconButton icon={X} label="Close" size={22} onClick={onClose} />
      </span>
      <span className="text-[12px] text-[var(--ro-muted)]">{[n.authors, n.year || '', n.venue].filter((x) => x !== '').join(' · ')}</span>
      <span className="flex flex-wrap gap-1.5 text-[12px]">
        <Badge tone="neutral">{num(n.cited_by)} citations</Badge>
        {n.refs_from_seeds > 0 && <Badge tone="info">cited by {n.refs_from_seeds} of yours</Badge>}
        {n.cites_seeds > 0 && <Badge tone="good">cites {n.cites_seeds} of yours</Badge>}
      </span>
      {n.work !== '' ? (
        <Button size="sm" icon={Library} onClick={() => navigate('paper', { id: n.work })}>
          In your library
        </Button>
      ) : (
        <Button size="sm" variant="primary" icon={Plus} onClick={onAdd}>
          Add to the library
        </Button>
      )}
    </div>
  );
}

function TopList({ title, sub, rows, metric, onSel, onAdd }: { title: string; sub: string; rows: MapNode[]; metric: (n: MapNode) => number; onSel: (n: MapNode) => void; onAdd: (n: MapNode) => void }): React.JSX.Element {
  return (
    <section className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
      <div className="border-b border-[var(--ro-hair)] px-3 py-2">
        <p className="text-[13px] font-bold">{title}</p>
        <p className="text-[12px] text-[var(--ro-muted)]">{sub}</p>
      </div>
      {rows.length === 0 ? (
        <p className="px-3 py-3 text-[12px] text-[var(--ro-muted)]">None</p>
      ) : (
        <ol className="max-h-72 overflow-y-auto">
          {rows.slice(0, 15).map((n) => (
            <li key={n.id} className="flex items-center gap-2 border-b border-[var(--ro-hair)] px-3 py-1.5 last:border-0">
              <span className="num w-6 shrink-0 text-right text-[13px] font-bold">{metric(n)}</span>
              <button type="button" onClick={() => onSel(n)} className="min-w-0 flex-1 text-left">
                <span className="line-clamp-2 text-[12px] font-semibold leading-4">{n.title}</span>
                <span className="block text-[12px] text-[var(--ro-muted)]">
                  {n.year} · {num(n.cited_by)} citations
                </span>
              </button>
              {n.work !== '' ? <Check size={14} className="shrink-0 text-[var(--ro-green-text)]" aria-label="In your library" /> : <IconButton icon={Plus} label="Add to the library" size={24} onClick={() => onAdd(n)} />}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
