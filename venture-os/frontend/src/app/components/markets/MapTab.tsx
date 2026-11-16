/**
 * Market map (fix 3): the thesis's market as columns (segments) of company
 * tiles, each coloured and labelled by its relation to the firm (In
 * portfolio, In pipeline, Passed come from deals and holdings; Watching and
 * Competitor as placed), with the legend always shown. Drag a tile to sort
 * it or move it to another segment (its place is kept); click it for its
 * source and Move to. Add company, edit the columns, compare companies, see
 * last quarter's map, and accept or dismiss what your AI agent suggests.
 */
import { SourceLink } from './SourceLink.tsx';
import { useRef, useState } from 'react';
import { Check, Columns3, GitCompareArrows, LayoutGrid, Plus, Sparkle, X } from 'lucide-react';
import { AgentMark, AgentTag, Button, ChipPicker, Empty, IconButton, Input, LinkButton, LoadError, Notice, Popover, SearchInput, Segmented, Skeleton, Tag } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { addDays, fmtDay, today } from '../../lib/format.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import { compareCompanies } from '../diligence/compare.ts';
import { MapBoard, RelationLegend, type BoardMode } from './MapBoard.tsx';
import type { MapEntry, MapProposal, MapSummary, MarketMap, ThesisTile } from './types.ts';
import { agoWords, RELATION_TONE, RELATION_WORD, word } from './types.ts';
import { AskAgent, askWith, stateOfTrack } from '../agent.tsx';

const READS = ['maps', 'map_entries', 'proposals', 'deals', 'agent_requests', 'companies'];

type View = 'now' | 'quarter';

/** A new map starts from the thesis's sectors (or three plain columns). */
function firstSegments(t: ThesisTile): string[] {
  const c = t.criteria.find((x) => x.key === 'sector' && x.op === 'in');
  const v = (c?.values ?? []).map((x) => word(String(x))).slice(0, 6);
  return v.length > 0 ? v : ['Core', 'Adjacent', 'Competitors'];
}

export function MapTab({ thesis, canEdit }: { thesis: ThesisTile; canEdit: boolean }): React.JSX.Element {
  const list = useOp<{ maps: MapSummary[] }>('maps.list', { thesis: thesis.id }, READS, { name: 'markets.maps' });
  const [busy, setBusy] = useState(false);
  if (list.data === null) return list.error !== null ? <LoadError message={list.error} onRetry={list.reload} /> : <Skeleton className="h-64 w-full" />;
  const first = list.data.maps[0];
  if (first === undefined) {
    const create = async (): Promise<void> => {
      setBusy(true);
      await act([], () => op('maps.save', { name: thesis.name, thesis: thesis.id, segments: firstSegments(thesis) }), READS);
      setBusy(false);
    };
    return (
      <Empty
        icon={LayoutGrid}
        title="The companies of this market, grouped by segment, will appear here"
        action={
          canEdit ? (
            <Button icon={Plus} busy={busy} onClick={() => void create()}>
              Create the market map
            </Button>
          ) : undefined
        }
      />
    );
  }
  return <MapView id={first.id} canEdit={canEdit} />;
}

function MapView({ id, canEdit }: { id: string; canEdit: boolean }): React.JSX.Element {
  const [view, setView] = useState<View>('now');
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [tile, setTile] = useState<{ entry: MapEntry; anchor: HTMLElement } | null>(null);
  const [busy, setBusy] = useState('');
  const asOf = view === 'quarter' ? addDays(today(), -91) : '';
  const live = useOp<{ map: MarketMap }>('maps.get', asOf !== '' ? { map: id, as_of: asOf } : { map: id }, READS, { name: 'markets.map', keep: true });
  const m = live.data?.map ?? null;
  if (m === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />;
  const past = m.as_of !== '';
  const mode: BoardMode = past ? 'read' : selecting ? 'select' : canEdit ? 'edit' : 'read';
  const proposals = past ? [] : m.proposals;

  const place = async (e: MapEntry, segment: string, position?: number): Promise<unknown> => {
    if (e.company === null) return null;
    const out = await act([patch(e.id, position !== undefined ? { segment, position } : { segment })], () => op('maps.place', position !== undefined ? { map: m.id, company: e.company?.id ?? '', segment, position } : { map: m.id, company: e.company?.id ?? '', segment }), READS);
    if (out === null) throw new Error('not saved');
    return out;
  };
  // The grid opens at once in diligence's grid view (compareCompanies navigates there).
  const compare = async (): Promise<void> => {
    setBusy('compare');
    await compareCompanies([...selected], 'markets', m.id);
    setBusy('');
  };

  const stopSelecting = (): void => {
    setSelecting(false);
    setSelected(new Set());
  };

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <RelationLegend />
        <span className="flex-1" />
        {!past && canEdit && !selecting && <AddCompany mapId={m.id} segments={m.segments} />}
        {!past && canEdit && !selecting && <EditColumns mapId={m.id} segments={m.segments} />}
        {!past && !selecting && (
          <Button size="sm" icon={GitCompareArrows} onClick={() => setSelecting(true)} title="Pick companies on the map and compare them side by side">
            Compare companies
          </Button>
        )}
        {!past && canEdit && !selecting && <AskAgent label="Suggest companies" title="Ask your AI agent to suggest companies and moves, each with its source" variant="ghost" state={stateOfTrack(m.refresh)} onAsk={askWith('map_refresh', m.id)} reads={READS} />}
        <Segmented
          size="sm"
          label="Show the map as of"
          value={view}
          onChange={(v) => {
            stopSelecting();
            setView(v);
          }}
          options={[
            { value: 'now', label: 'Today' },
            { value: 'quarter', label: 'Last quarter', title: `As it was on ${fmtDay(addDays(today(), -91))}` },
          ]}
        />
      </div>
      {selecting && (
        <Notice
          action={
            <span className="flex shrink-0 items-center gap-2">
              <Button size="sm" icon={X} onClick={stopSelecting}>
                Cancel
              </Button>
              <Button size="sm" variant="primary" icon={GitCompareArrows} busy={busy === 'compare'} disabled={selected.size < 2} onClick={() => void compare()}>
                {selected.size < 2 ? 'Compare' : `Compare ${selected.size} companies`}
              </Button>
            </span>
          }
        >
          Click the companies to compare, two or more.
        </Notice>
      )}
      {proposals.length > 0 && <Suggestions mapId={m.id} proposals={proposals} segments={m.segments} canEdit={canEdit} />}
      {past && <Notice>{`The map as it was on ${fmtDay(m.as_of)}. Switch to Today to change it.`}</Notice>}
      <MapBoard
        segments={m.segments}
        entries={m.entries}
        mode={mode}
        selected={selected}
        onToggle={(cid) =>
          setSelected((s) => {
            const n = new Set(s);
            if (n.has(cid)) n.delete(cid);
            else n.add(cid);
            return n;
          })
        }
        onMove={(e, segment, index) => place(e, segment, index)}
        onOpenTile={(entry, anchor) => setTile({ entry, anchor })}
      />
      {tile !== null && <TilePopover key={tile.entry.id} entry={tile.entry} anchor={tile.anchor} segments={m.segments} mapId={m.id} canEdit={canEdit && !past} onClose={() => setTile(null)} onMove={(e, s) => void place(e, s).catch(() => undefined)} />}
    </div>
  );
}

/** What your AI agent suggests for this map, one line each, with its source: Accept or Dismiss, or all at once. */
function Suggestions({ mapId, proposals, segments, canEdit }: { mapId: string; proposals: MapProposal[]; segments: { key: string; label: string }[]; canEdit: boolean }): React.JSX.Element {
  const [busy, setBusy] = useState('');
  const labelOf = (k: string): string => segments.find((s) => s.key === k || s.label.toLowerCase() === k.toLowerCase())?.label ?? k;
  const decide = async (pid: string, accept: boolean): Promise<void> => {
    setBusy(pid);
    await act([], () => (accept ? op('proposals.accept', { proposal: pid }) : op('proposals.dismiss', { proposal: pid })), READS);
    setBusy('');
  };
  const acceptAll = async (): Promise<void> => {
    setBusy('all');
    await act([], () => op('maps.accept', { map: mapId }), READS);
    setBusy('');
  };
  return (
    <section aria-label="Suggested by your AI agent" className="vo-panel flex min-w-0 flex-col px-4 py-3">
      <div className="flex min-w-0 items-center gap-2 pb-1">
        <AgentTag />
        <span className="min-w-0 flex-1 text-[13px] font-medium">{proposals.length === 1 ? 'Your AI agent suggests 1 change' : `Your AI agent suggests ${proposals.length} changes`}</span>
        {canEdit && proposals.length > 1 && (
          <Button size="sm" icon={Check} busy={busy === 'all'} onClick={() => void acceptAll()}>
            {`Accept all ${proposals.length}`}
          </Button>
        )}
      </div>
      <ul className="flex min-w-0 flex-col">
        {proposals.map((p) => (
          <li key={p.id} className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--vo-hair)] py-2 first:border-t-0">
            <span className="vo-wrap min-w-0 flex-1 text-[13px]">
              {p.remove ? `Take ${p.company.name} off the map` : `Add ${p.company.name} to ${labelOf(p.segment)}`}
              {p.why !== '' && <span className="text-[var(--vo-muted)]">{`: ${p.why}`}</span>}
            </span>
            {p.source_url !== '' && (
              <SourceLink href={p.source_url} tone="faint">
                Source
              </SourceLink>
            )}
            {canEdit && (
              <span className="flex shrink-0 items-center gap-1">
                <Button size="sm" icon={X} disabled={busy !== ''} onClick={() => void decide(p.id, false)}>
                  Dismiss
                </Button>
                <Button size="sm" icon={Check} busy={busy === p.id} disabled={busy !== '' && busy !== p.id} onClick={() => void decide(p.id, true)}>
                  Accept
                </Button>
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

interface CompanyHit {
  id: string;
  name: string;
  domain: string;
}

/** Add company: pick the segment, then find the company in the records or type a new one's name. */
function AddCompany({ mapId, segments }: { mapId: string; segments: { key: string; label: string }[] }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [segment, setSegment] = useState(segments[0]?.key ?? '');
  const hits = useOp<{ companies: CompanyHit[] }>('companies.list', { q: q.trim(), limit: 8 }, ['companies'], { name: 'markets.addtile', skip: !open || q.trim() === '', keep: true });
  const seg = segments.some((s) => s.key === segment) ? segment : (segments[0]?.key ?? '');
  const place = async (p: Record<string, unknown>): Promise<void> => {
    setOpen(false);
    setQ('');
    await act([], () => op('maps.place', { map: mapId, segment: seg, ...p }), READS);
  };
  const list = q.trim() === '' ? [] : (hits.data?.companies ?? []);
  return (
    <>
      <Button ref={ref} size="sm" icon={Plus} onClick={() => setOpen(true)}>
        Add company
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={320} label="Add a company to the map" className="flex flex-col gap-2 p-3">
        <ChipPicker label="Segment" value={seg} options={segments.map((s) => ({ value: s.key, label: s.label }))} onChange={(k) => setSegment(k)} />
        <SearchInput value={q} onChange={setQ} autoFocus label="Company name" />
        <div className="vo-scroll flex max-h-[240px] flex-col overflow-y-auto">
          {list.map((c) => (
            <button key={c.id} type="button" onClick={() => void place({ company: c.id })} className="vo-focus flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 text-left text-[13px] hover:bg-[var(--vo-hover)]">
              <span className="min-w-0 flex-1 truncate">{c.name}</span>
              <span className="truncate text-[12px] text-[var(--vo-muted)]">{c.domain}</span>
            </button>
          ))}
          {q.trim() !== '' && !list.some((c) => c.name.toLowerCase() === q.trim().toLowerCase()) && (
            <button type="button" onClick={() => void place({ name: q.trim() })} className="vo-focus flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-[var(--vo-radius-sm)] px-2 text-left text-[13px] hover:bg-[var(--vo-hover)]">
              <Plus size={13} aria-hidden className="text-[var(--vo-muted)]" />
              <span className="min-w-0 flex-1 truncate">{`Add "${q.trim()}" as a new company`}</span>
            </button>
          )}
          {q.trim() === '' && <span className="px-2 py-1.5 text-[12px] text-[var(--vo-muted)]">Type a company name</span>}
        </div>
      </Popover>
    </>
  );
}

/** Columns: rename a segment in place, add one (at most 12). */
function EditColumns({ mapId, segments }: { mapId: string; segments: { key: string; label: string }[] }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [fresh, setFresh] = useState('');
  const save = (segs: (string | { key: string; label: string })[]): void => {
    void act([], () => op('maps.save', { map: mapId, segments: segs }), READS);
  };
  return (
    <>
      <Button ref={ref} size="sm" icon={Columns3} onClick={() => setOpen(true)} title="Rename or add the segments (columns)">
        Columns
      </Button>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={300} label="Segments of the map" className="flex flex-col gap-2 p-3">
        {segments.map((s) => (
          <Input
            key={s.key}
            defaultValue={s.label}
            maxLength={40}
            aria-label={`Rename ${s.label}`}
            className="h-8 text-[13px]"
            onBlur={(e) => {
              const v = e.target.value.trim();
              if (v !== '' && v !== s.label) save(segments.map((x) => (x.key === s.key ? { key: s.key, label: v } : x)));
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            }}
          />
        ))}
        {segments.length < 12 && (
          <form
            className="flex min-w-0 items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (fresh.trim() === '') return;
              save([...segments, fresh.trim()]);
              setFresh('');
            }}
          >
            <Input value={fresh} maxLength={40} placeholder="New segment" aria-label="New segment" className="h-8 min-w-0 flex-1 text-[13px]" onChange={(e) => setFresh(e.target.value)} />
            <Button size="sm" icon={Plus} type="submit" disabled={fresh.trim() === ''}>
              Add
            </Button>
          </form>
        )}
      </Popover>
    </>
  );
}

/** A tile's details: its relation, deal, source, last move; move it or take it off. */
function TilePopover({
  entry,
  anchor,
  segments,
  mapId,
  canEdit,
  onClose,
  onMove,
}: {
  entry: MapEntry;
  anchor: HTMLElement;
  segments: { key: string; label: string }[];
  mapId: string;
  canEdit: boolean;
  onClose: () => void;
  onMove: (e: MapEntry, s: string) => void;
}): React.JSX.Element {
  const ref = useRef<HTMLElement | null>(anchor);
  const last = entry.moves[entry.moves.length - 1];
  const labelOf = (k: string): string => segments.find((s) => s.key === k)?.label ?? k;
  const remove = async (): Promise<void> => {
    onClose();
    await act([], () => op('maps.place', { map: mapId, company: entry.company?.id ?? '', remove: true }), READS);
  };
  const setRole = (role: 'tracked' | 'competitor'): void => {
    void act(
      [patch(entry.id, { role, relation: entry.relation === 'tracked' || entry.relation === 'competitor' ? role : entry.relation })],
      () => op('maps.place', { map: mapId, company: entry.company?.id ?? '', segment: entry.segment, role }),
      READS,
    );
  };
  const own = entry.relation === 'tracked' || entry.relation === 'competitor';
  return (
    <Popover anchor={ref} open onClose={onClose} width={300} label={entry.company?.name ?? 'Company'} className="flex flex-col gap-3 p-3">
      <div className="flex min-w-0 items-center gap-2">
        <a href={`#/companies/${entry.company?.id ?? ''}`} title="Open the company" className="vo-link vo-wrap min-w-0 flex-1 text-[13px] font-semibold">
          {entry.company?.name}
        </a>
        <Tag tone={RELATION_TONE[entry.relation]}>{RELATION_WORD[entry.relation]}</Tag>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--vo-muted)]">
        {entry.deal !== null && (
          <a href={`#/deals/${entry.deal.number}`} title="Open the deal" className="vo-focus inline-flex">
            <Tag>{`Deal ${entry.deal.number}${entry.deal.stage !== '' ? `, ${word(entry.deal.stage)}` : ''}`}</Tag>
          </a>
        )}
        {entry.source_url !== '' && (
          <SourceLink href={entry.source_url} tone="faint">
            Source
          </SourceLink>
        )}
        {entry.actor === 'agent' && <AgentTag />}
        {last !== undefined && <span>{last.from === '' ? `Added ${agoWords(last.at)}` : `Moved from ${labelOf(last.from)} ${agoWords(last.at)}`}</span>}
      </div>
      {entry.note !== '' && <p className="vo-wrap text-[13px] leading-5 text-[var(--vo-ink-2)]">{entry.note}</p>}
      {canEdit && (
        <>
          {own && (
            <Segmented
              size="sm"
              label="Relation"
              value={entry.role}
              onChange={(v) => setRole(v)}
              options={[
                { value: 'tracked', label: 'Watching' },
                { value: 'competitor', label: 'Competitor' },
              ]}
            />
          )}
          <span className="text-[12px] font-medium text-[var(--vo-ink-2)]">Move to</span>
          <ChipPicker
            label="Move to"
            value={entry.segment}
            options={segments.map((s) => ({ value: s.key, label: s.label }))}
            onChange={(k) => {
              if (k === entry.segment) return;
              onMove(entry, k);
              onClose();
            }}
          />
          <LinkButton tone="danger" onClick={() => void remove()}>
            Take off the map
          </LinkButton>
        </>
      )}
    </Popover>
  );
}
