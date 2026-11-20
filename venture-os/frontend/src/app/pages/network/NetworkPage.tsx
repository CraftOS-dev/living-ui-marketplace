/**
 * Network (SPEC 3, 7.5): one big "Who knows" field; the answer draws as a
 * PathGraph (member, connector, target, strength on each edge) with the
 * paths as rows; beside it the coverage Ring of pipeline and portfolio
 * companies by warmest connection. The one black button asks for the intro
 * on the selected path (your AI agent drafts; the draft lands in Next).
 * Below: People and Companies.
 */
import { useEffect, useRef, useState } from 'react';
import { Building2, Search, User, Waypoints } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Avatar, Button, Empty, PageBody, PageHeader, Panel, Segmented, Skeleton, Tabs } from '../../components/ui.tsx';
import { Ring, TONE } from '../../components/charts.tsx';
import { PathsView, usePaths } from '../../components/network/Paths.tsx';
import type { Target } from '../../components/network/Paths.tsx';
import { CompaniesTable, PeopleTable } from '../../components/network/Tables.tsx';
import { BAND_LABEL, BAND_TONE, NET_READS } from '../../components/network/parts.tsx';
import type { Band, Coverage, FindHit } from '../../components/network/types.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery, useRoute } from '../../lib/router.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';

const ORDER: Band[] = ['strong', 'good', 'weak', 'none'];

/** The "Who knows" field with its suggestions (companies and people with their band). */
function WhoKnows({ onPick, picked, autoFocus }: { onPick: (h: FindHit | null) => void; picked: { name: string; kind: string } | null; autoFocus: boolean }): React.JSX.Element {
  const [q, setQ] = useState(picked?.name ?? '');
  const [open, setOpen] = useState(false);
  const [cursor, setCursor] = useState(0);
  const input = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (picked !== null) setQ(picked.name);
  }, [picked]);
  useEffect(() => {
    if (autoFocus) input.current?.focus();
  }, [autoFocus]);
  const query = q.trim();
  const live = useOp<{ results: FindHit[] }>('network.find', { q: query, limit: 6 }, [], { skip: !open || query.length < 1, keep: true });
  const hits = open && query.length > 0 ? (live.data?.results ?? []) : [];
  const pick = (h: FindHit): void => {
    setQ(h.name);
    setOpen(false);
    onPick(h);
  };
  return (
    <div className="relative min-w-0">
      <Search size={18} aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-[var(--vo-muted)]" />
      <input
        ref={input}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setCursor(0);
          if (e.target.value.trim() === '') onPick(null);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setCursor((c) => Math.min(c + 1, Math.max(0, hits.length - 1)));
          else if (e.key === 'ArrowUp') setCursor((c) => Math.max(0, c - 1));
          else if (e.key === 'Enter' && hits[cursor] !== undefined) pick(hits[cursor]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        placeholder="Who knows..."
        aria-label="Who knows"
        role="combobox"
        aria-expanded={hits.length > 0}
        className="vo-focus h-12 w-full rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] pl-11 pr-3 text-[15px] text-[var(--vo-ink)] outline-none transition-colors duration-150 placeholder:text-[var(--vo-muted)] hover:border-[var(--vo-line-2)]"
      />
      {hits.length > 0 && (
        <ul role="listbox" aria-label="Matches" className="absolute left-0 right-0 top-full z-30 mt-1 overflow-hidden rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] p-1 shadow-[var(--vo-shadow-lg)]">
          {hits.map((h, i) => (
            <li key={h.kind + h.id} role="option" aria-selected={i === cursor}>
              <button type="button" onPointerDown={(e) => e.preventDefault()} onClick={() => pick(h)} onPointerEnter={() => setCursor(i)} className={cn('vo-tap flex h-10 w-full min-w-0 items-center gap-2.5 rounded-[var(--vo-radius-sm)] px-2 text-left transition-colors duration-150', i === cursor ? 'bg-[var(--vo-hover)]' : '')}>
                <Avatar name={h.name} size={24} square={h.kind === 'company'} />
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[var(--vo-ink)]">{h.name}</span>
                <span className="max-w-[40%] truncate text-[12px] text-[var(--vo-muted)]">{h.sub}</span>
                {h.kind === 'company' ? <Building2 size={13} aria-hidden className="shrink-0 text-[var(--vo-muted)]" /> : <User size={13} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Coverage: pipeline and portfolio companies by warmest connection. */
function CoveragePanel({ onBand }: { onBand: (b: Band) => void }): React.JSX.Element {
  const [scope, setScope] = useState<'all' | 'pipeline' | 'portfolio'>('all');
  const live = useOp<Coverage>('network.coverage', { scope, limit: 12 }, NET_READS, { keep: true });
  const c = live.data;
  const warm = c === null ? 0 : c.bands.strong + c.bands.good;
  return (
    <Panel label="Coverage" aside={<Segmented size="sm" value={scope} onChange={setScope} label="Scope" options={[{ value: 'all', label: 'All' }, { value: 'pipeline', label: 'Pipeline' }, { value: 'portfolio', label: 'Portfolio' }]} />}>
      {c === null ? (
        <Skeleton className="h-36 w-full" />
      ) : (
        <div className="flex min-w-0 items-center gap-5">
          <Ring size={128} thickness={12} segments={c.total === 0 ? [{ label: 'None', value: 1, tone: 'muted' }] : ORDER.map((b) => ({ label: BAND_LABEL[b], value: c.bands[b], tone: BAND_TONE[b] }))} center={c.total === 0 ? '0' : `${Math.round((warm / c.total) * 100)}%`} format={(v) => String(Math.round(v))} label="Coverage by warmest connection" />
          <div className="flex min-w-0 flex-1 flex-col">
            {ORDER.map((b) => (
              <button key={b} type="button" onClick={() => onBand(b)} className="vo-focus vo-tap flex h-8 min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-1.5 text-left text-[13px] text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
                <span aria-hidden className="size-2 shrink-0 rounded-full" style={{ background: TONE[BAND_TONE[b]] }} />
                <span className="min-w-0 flex-1 truncate">{BAND_LABEL[b]}</span>
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-ink)]">{c.bands[b]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </Panel>
  );
}

export function NetworkPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const route = useRoute();
  const person = query.get('person') ?? '';
  const company = query.get('company') ?? '';
  const tab = (query.get('tab') ?? 'people') === 'companies' ? 'companies' : 'people';
  const [band, setBand] = useState<Band | undefined>(undefined);
  const [picked, setPicked] = useState<{ name: string; kind: string } | null>(null);
  const target: Target | null = person !== '' ? { person } : company !== '' ? { company } : null;
  const state = usePaths(target);
  const name = state.live.data?.target.name;
  useEffect(() => {
    if (name !== undefined && target !== null) setPicked({ name, kind: target.person !== undefined ? 'person' : 'company' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name]);
  const pickHit = (h: FindHit | null): void => {
    if (h === null) {
      setPicked(null);
      setQuery({ person: null, company: null });
      return;
    }
    setPicked({ name: h.name, kind: h.kind });
    setQuery(h.kind === 'person' ? { person: h.id, company: null } : { company: h.id, person: null });
  };
  const canAsk = allowed(me, 'network:edit');
  const quick = useOp<Coverage>('network.coverage', { scope: 'pipeline', limit: 6 }, NET_READS, { skip: target !== null, name: 'network.coverage.quick' });
  return (
    <>
      <PageHeader title="Network">
        {canAsk && (
          <Button variant="primary" icon={Waypoints} busy={state.asking} disabled={!state.canAsk} onClick={() => void state.ask()} aria-label={state.askLabel} title={state.askLabel}>
            <span className="max-sm:sr-only">{state.askLabel}</span>
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel>
            <div className="flex min-w-0 flex-col gap-5">
              <WhoKnows onPick={pickHit} picked={picked} autoFocus={route.query.get('focus') === '1'} />
              {target !== null ? (
                <PathsView state={state} />
              ) : (quick.data?.companies ?? []).length > 0 ? (
                <div className="flex min-w-0 flex-wrap gap-2">
                  {(quick.data?.companies ?? []).map((c) => (
                    <button key={c.id} type="button" onClick={() => pickHit({ kind: 'company', id: c.id, name: c.name, sub: '', score: c.score, band: c.band })} className="vo-focus vo-tap inline-flex h-8 min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)] bg-[var(--vo-raised)] px-2.5 text-[13px] text-[var(--vo-ink-2)] transition-colors duration-150 hover:border-[var(--vo-line-2)] hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
                      <Avatar name={c.name} size={18} square />
                      <span className="max-w-[180px] truncate">{c.name}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <Empty icon={Waypoints} title="Find a warm path" className="py-6" />
              )}
            </div>
          </Panel>
          <CoveragePanel
            onBand={(b) => {
              setBand(b);
              setQuery({ tab: 'companies' });
            }}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <Tabs value={tab} onChange={(t) => setQuery({ tab: t === 'people' ? null : t })} label="Lists" tabs={[{ value: 'people', label: 'People' }, { value: 'companies', label: 'Companies' }]} />
          {tab === 'people' ? <PeopleTable /> : <CompaniesTable band={band} />}
        </div>
      </PageBody>
    </>
  );
}
