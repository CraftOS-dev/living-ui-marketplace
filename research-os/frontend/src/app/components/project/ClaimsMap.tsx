/**
 * The claims map: a project's questions, claims and evidence with their
 * links. Each claim is a column with its evidence under it and its question
 * above; a card you drag stays where you put it (Tidy hands it back).
 *
 *   Drag a card's top dot onto another card to link them (the kinds the
 *   grammar allows are offered: supports or opposes a claim, informs a
 *   question). What your AI agent proposed is dashed; C and R confirm or
 *   reject the selection, Delete removes it, F fits the map.
 *   Double click empty space to add a question or a claim there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpenText, CircleHelp, LayoutGrid, Lightbulb, List, Network, Plus, Quote, Search, Sparkles, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { changed, READS, useLive } from '../../lib/live.ts';
import { KIND_LABEL, clip, num, plural } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Anchor, GNode, NodeKind, Project, RelKind, Relation } from '../../lib/types.ts';
import { askAgent, DecideButtons, decideNodes, decideRelations, RequestStatus } from '../agent.tsx';
import { BalanceBar, Badge, Button, Empty, IconButton, LoadError, Segmented, Spinner, textareaCls, useConfirm } from '../ui.tsx';
import { bounds, gridStyle, linkPath, LinkMarkers, useCanvas, ZoomControls } from './canvas.tsx';
import type { Box } from './canvas.tsx';

const W = 240;
const H: Record<NodeKind, number> = { question: 78, claim: 100, evidence: 108 };
const GAP_X = 36;
const GAP_Y = 18;
const CLAIM_Y = H.question + 96;
const EV_Y = CLAIM_Y + H.claim + 56;

export const KIND_ICON: Record<NodeKind, LucideIcon> = { question: CircleHelp, claim: Lightbulb, evidence: Quote };

interface MapData {
  nodes: GNode[];
  relations: Relation[];
}

/** Which kinds of link may go from one node to another. */
export function allowedLinks(from: NodeKind, to: NodeKind): RelKind[] {
  if (from === 'question') return [];
  if (to === 'claim') return ['supports', 'opposes'];
  if (to === 'question') return ['informs'];
  return [];
}

/** Columns: each claim with what hangs under it, grouped under its question; then what is not linked. */
function layout(nodes: GNode[], rels: Relation[]): Record<string, { x: number; y: number }> {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent: Record<string, string> = {};
  for (const r of rels) {
    if (r.status === 'researcher_rejected' || parent[r.from] !== undefined) continue;
    const a = byId.get(r.from);
    const b = byId.get(r.to);
    if (a === undefined || b === undefined || a.kind === 'question') continue;
    parent[r.from] = r.to;
  }
  const rootClaim = (id: string): string | null => {
    let cur = id;
    const seen = new Set<string>();
    while (!seen.has(cur)) {
      seen.add(cur);
      const p = parent[cur];
      const pn = p !== undefined ? byId.get(p) : undefined;
      if (pn === undefined || pn.kind !== 'claim') return byId.get(cur)?.kind === 'claim' ? cur : null;
      cur = pn.id;
    }
    return cur;
  };
  const stacks = new Map<string, string[]>(); // root claim -> what hangs under it
  const qCols = new Map<string, string[]>(); // question -> its column heads (claims, or 'direct:' + question)
  const qDirect = new Map<string, string[]>(); // question -> evidence informing it directly
  const looseClaims: string[] = [];
  const looseEvidence: string[] = [];
  for (const n of nodes) if (n.kind === 'question') qCols.set(n.id, []);
  for (const n of nodes) {
    if (n.kind !== 'claim') continue;
    const root = rootClaim(n.id);
    if (root !== n.id && root !== null) {
      stacks.set(root, [...(stacks.get(root) ?? []), n.id]);
      continue;
    }
    const p = parent[n.id];
    if (p !== undefined && qCols.has(p)) qCols.get(p)?.push(n.id);
    else looseClaims.push(n.id);
  }
  for (const n of nodes) {
    if (n.kind !== 'evidence') continue;
    const p = parent[n.id];
    const pn = p !== undefined ? byId.get(p) : undefined;
    if (pn?.kind === 'claim') {
      const root = rootClaim(pn.id) ?? pn.id;
      stacks.set(root, [...(stacks.get(root) ?? []), n.id]);
    } else if (pn?.kind === 'question') qDirect.set(pn.id, [...(qDirect.get(pn.id) ?? []), n.id]);
    else looseEvidence.push(n.id);
  }
  const out: Record<string, { x: number; y: number }> = {};
  let x = 0;
  const column = (head: string | null, items: string[]): void => {
    let y = EV_Y;
    if (head !== null) out[head] = { x, y: CLAIM_Y };
    else y = CLAIM_Y;
    for (const id of items) {
      out[id] = { x, y };
      y += H[byId.get(id)?.kind ?? 'evidence'] + GAP_Y;
    }
    x += W + GAP_X;
  };
  for (const [q, heads] of qCols) {
    const start = x;
    for (const c of heads) column(c, stacks.get(c) ?? []);
    const direct = qDirect.get(q) ?? [];
    if (direct.length > 0) column(null, direct);
    if (x === start) x += W + GAP_X;
    out[q] = { x: (start + x - GAP_X) / 2 - W / 2, y: 0 };
    x += 40;
  }
  if (looseClaims.length + looseEvidence.length > 0 && x > 0) x += 60;
  for (const c of looseClaims) column(c, stacks.get(c) ?? []);
  const perCol = 4;
  for (let i = 0; i < looseEvidence.length; i += perCol) column(null, looseEvidence.slice(i, i + perCol));
  return out;
}

export function ClaimsMap({ project, focus }: { project: Project; focus: string }): React.JSX.Element {
  const data = useLive((signal) => op<MapData>('graph.map', { project: project.id }, { quiet: true, signal }), READS.graph, [project.id], 200);
  const [mode, setMode] = useState<'map' | 'list'>(() => {
    try {
      return localStorage.getItem('ro_map_mode') === 'list' ? 'list' : 'map';
    } catch {
      return 'map';
    }
  });
  const [sel, setSel] = useState<{ type: 'node' | 'rel'; id: string } | null>(focus !== '' ? { type: 'node', id: focus } : null);
  const [multi, setMulti] = useState<Set<string>>(new Set());
  const [show, setShow] = useState<Record<NodeKind, boolean>>({ question: true, claim: true, evidence: true });
  const [onlyProposed, setOnlyProposed] = useState(false);
  const [q, setQ] = useState('');
  const [req, setReq] = useState('');
  const setModeKeep = (m: 'map' | 'list'): void => {
    setMode(m);
    try {
      localStorage.setItem('ro_map_mode', m);
    } catch {
      /* a convenience */
    }
  };
  const nodes = data.data?.nodes ?? [];
  const rels = data.data?.relations ?? [];
  const visible = nodes.filter((n) => show[n.kind] && (!onlyProposed || n.status === 'agent_proposed'));
  const counts = { question: 0, claim: 0, evidence: 0 } as Record<NodeKind, number>;
  for (const n of nodes) counts[n.kind]++;
  const proposed = nodes.filter((n) => n.status === 'agent_proposed').length + rels.filter((r) => r.status === 'agent_proposed').length;
  const matches = q.trim().length >= 2 ? new Set(visible.filter((n) => n.title.toLowerCase().includes(q.trim().toLowerCase())).map((n) => n.id)) : null;

  if (data.error !== null) return <div className="p-4"><LoadError message={data.error} onRetry={data.reload} /></div>;
  if (data.data === null) return <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>;
  const selectedNodes = sel?.type === 'node' ? new Set([sel.id, ...multi]) : multi;
  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
          <Segmented label="View" size="sm" value={mode} onChange={setModeKeep} options={[{ value: 'map', label: 'Map', icon: Network }, { value: 'list', label: 'List', icon: List }]} />
          <span className="mx-1 h-5 w-px bg-[var(--ro-line)]" />
          {(['question', 'claim', 'evidence'] as NodeKind[]).map((k) => {
            const Icon = KIND_ICON[k];
            return (
              <button key={k} type="button" aria-pressed={show[k]} onClick={() => setShow((s) => ({ ...s, [k]: !s[k] }))} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold transition-colors', show[k] ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)] line-through hover:bg-[var(--ro-row)]')} title={(show[k] ? 'Hide ' : 'Show ') + KIND_LABEL[k]?.toLowerCase()}>
                <Icon size={13} style={{ color: `var(--ro-kind-${k}-text)` }} />
                <span className="num">{counts[k]}</span>
                <span className="hidden @min-[900px]:inline">{k === 'evidence' ? 'evidence' : plural(counts[k], k).replace(/^\d+ /, '')}</span>
              </button>
            );
          })}
          {proposed > 0 && (
            <button type="button" aria-pressed={onlyProposed} onClick={() => setOnlyProposed((v) => !v)} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', onlyProposed ? 'bg-[var(--ro-accent-soft)] text-[var(--ro-accent-text)] outline outline-1 outline-[var(--ro-accent)]' : 'text-[var(--ro-accent-text)] hover:bg-[var(--ro-accent-soft)]')} title="Show only what your AI agent proposed">
              <Sparkles size={13} /> <span className="num">{proposed}</span> proposed
            </button>
          )}
          <span className="flex-1" />
          <label className="flex h-7 w-44 items-center gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] px-2 focus-within:border-[var(--ro-ink)]">
            <Search size={13} className="shrink-0 text-[var(--ro-muted)]" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find" aria-label="Find on the map" className="min-w-0 flex-1 bg-transparent text-[12px] outline-none" />
            {q !== '' && <button type="button" aria-label="Clear" onClick={() => setQ('')} className="text-[var(--ro-muted)]"><X size={12} /></button>}
          </label>
          {req !== '' && <RequestStatus id={req} />}
          {project.confidentiality !== 'confidential' && (
            <Button size="sm" icon={Sparkles} onClick={() => void askAgent('claims_requested', { project: project.id }, 'Your AI agent is asked to map the claims of the reading list').then(setReq)} title="Your AI agent reads the reading list and proposes questions, claims and evidence, each on its passage">
              Map with your AI agent
            </Button>
          )}
          <NewNodeButton project={project.id} onMade={(id) => setSel({ type: 'node', id })} />
        </div>
        {nodes.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-6">
            <Empty icon={Network} title="The map is empty" action={<span className="flex gap-2"><NewNodeButton project={project.id} onMade={(id) => setSel({ type: 'node', id })} label="Add a question" kind="question" primary /><Button icon={BookOpenText} onClick={() => navigate('project', { id: project.id, view: 'papers' })}>Reading list</Button></span>}>
              Questions, claims and evidence from your papers appear here.
            </Empty>
          </div>
        ) : mode === 'map' ? (
          <MapCanvas project={project} nodes={visible} rels={rels} sel={sel} selected={selectedNodes} matches={matches} focus={focus} onSelect={(s, add) => { if (add && s?.type === 'node') { setMulti((m) => { const n = new Set(m); if (sel?.type === 'node') n.add(sel.id); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return n; }); setSel(null); } else { setMulti(new Set()); setSel(s); } }} />
        ) : (
          <MapList nodes={visible} rels={rels} matches={matches} sel={sel} onSelect={(s) => { setMulti(new Set()); setSel(s); }} />
        )}
      </div>
      {multi.size > 0 && sel === null ? (
        <MultiPanel ids={[...multi]} nodes={nodes} onClose={() => setMulti(new Set())} />
      ) : sel?.type === 'node' && nodes.some((n) => n.id === sel.id) ? (
        <NodeInspector key={sel.id} id={sel.id} nodes={nodes} onSelect={(id) => setSel({ type: 'node', id })} onClose={() => setSel(null)} />
      ) : sel?.type === 'rel' && rels.some((r) => r.id === sel.id) ? (
        <RelInspector rel={rels.find((r) => r.id === sel.id) as Relation} nodes={nodes} onSelect={(id) => setSel({ type: 'node', id })} onClose={() => setSel(null)} />
      ) : null}
    </div>
  );
}

/* ----------------------------------------------------------------- map */

function MapCanvas({ project, nodes, rels, sel, selected, matches, focus, onSelect }: { project: Project; nodes: GNode[]; rels: Relation[]; sel: { type: 'node' | 'rel'; id: string } | null; selected: Set<string>; matches: Set<string> | null; focus: string; onSelect: (s: { type: 'node' | 'rel'; id: string } | null, add?: boolean) => void }): React.JSX.Element {
  const c = useCanvas();
  const [confirmNode, confirm] = useConfirm();
  const auto = useMemo(() => layout(nodes, rels), [nodes, rels]);
  const [local, setLocal] = useState<Record<string, { x: number; y: number }>>({});
  const [link, setLink] = useState<{ from: string; x: number; y: number } | null>(null);
  const [pick, setPick] = useState<{ from: string; to: string; kinds: RelKind[]; sx: number; sy: number } | null>(null);
  const [create, setCreate] = useState<{ x: number; y: number; sx: number; sy: number } | null>(null);
  const [hoverRel, setHoverRel] = useState('');
  const fitted = useRef(false);
  const ids = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);
  useEffect(() => setLocal({}), [nodes]);
  const box = useCallback(
    (n: GNode): Box => {
      const p = local[n.id] ?? (n.placed ? { x: n.x, y: n.y } : (auto[n.id] ?? { x: 0, y: 0 }));
      return { x: p.x, y: p.y, w: W, h: H[n.kind] };
    },
    [local, auto],
  );
  const byId = useMemo(() => new Map(nodes.map((n) => [n.id, n])), [nodes]);
  const fitAll = useCallback(() => c.fit(bounds(nodes.map(box)), 1), [c, nodes, box]);
  useEffect(() => {
    if (fitted.current || nodes.length === 0) return;
    fitted.current = true;
    const f = focus !== '' ? byId.get(focus) : undefined;
    if (f !== undefined) {
      const b = box(f);
      c.setVp((v) => ({ ...v, zoom: 1 }));
      setTimeout(() => c.centerOn(b.x + b.w / 2, b.y + b.h / 2), 0);
    } else setTimeout(fitAll, 0);
  }, [nodes.length, fitAll, focus, byId, box, c]);

  const startDrag = (e: React.PointerEvent, n: GNode): void => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const start = c.toWorld(e.clientX, e.clientY);
    const group = selected.has(n.id) && selected.size > 1 ? [...selected].filter((id) => byId.has(id)) : [n.id];
    const origin: Record<string, { x: number; y: number }> = {};
    for (const id of group) {
      const b = box(byId.get(id) as GNode);
      origin[id] = { x: b.x, y: b.y };
    }
    let moved = false;
    const onMove = (ev: PointerEvent): void => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      if (!moved && Math.hypot(p.x - start.x, p.y - start.y) * c.vp.zoom < 4) return;
      moved = true;
      const next: Record<string, { x: number; y: number }> = {};
      for (const id of group) next[id] = { x: Math.round((origin[id]?.x ?? 0) + p.x - start.x), y: Math.round((origin[id]?.y ?? 0) + p.y - start.y) };
      setLocal((l) => ({ ...l, ...next }));
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!moved) {
        onSelect({ type: 'node', id: n.id }, ev.shiftKey || ev.metaKey || ev.ctrlKey);
        return;
      }
      const p = c.toWorld(ev.clientX, ev.clientY);
      const positions = group.map((id) => ({ node: id, x: Math.round((origin[id]?.x ?? 0) + p.x - start.x), y: Math.round((origin[id]?.y ?? 0) + p.y - start.y) }));
      void op('nodes.move', { positions }, { quiet: true }).then(() => changed('nodes')).catch(() => setLocal({}));
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const startLink = (e: React.PointerEvent, n: GNode): void => {
    e.stopPropagation();
    e.preventDefault();
    const onMove = (ev: PointerEvent): void => {
      const p = c.toWorld(ev.clientX, ev.clientY);
      setLink({ from: n.id, x: p.x, y: p.y });
    };
    const onUp = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      setLink(null);
      const target = document.elementsFromPoint(ev.clientX, ev.clientY).find((el) => el.hasAttribute('data-node'));
      const to = target?.getAttribute('data-node');
      const tn = to ? byId.get(to) : undefined;
      if (tn === undefined || tn.id === n.id) return;
      const kinds = allowedLinks(n.kind, tn.kind);
      if (kinds.length === 0) {
        toast.error('A ' + n.kind + ' cannot link to a ' + tn.kind + '. Evidence and claims support or oppose a claim, or inform a question.');
        return;
      }
      if (kinds.length === 1) void makeLink(n.id, tn.id, kinds[0] as RelKind);
      else setPick({ from: n.id, to: tn.id, kinds, sx: ev.clientX, sy: ev.clientY });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const makeLink = async (from: string, to: string, kind: RelKind): Promise<void> => {
    setPick(null);
    try {
      const r = await op<{ relation: Relation }>('relations.create', { from, to, kind });
      changed('relations');
      onSelect({ type: 'rel', id: r.relation.id });
    } catch {
      /* toasted */
    }
  };

  const onKey = async (e: React.KeyboardEvent): Promise<void> => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    const ids = [...selected].filter((id) => byId.has(id));
    const proposedIds = ids.filter((id) => byId.get(id)?.status === 'agent_proposed');
    if (e.key === 'f' || e.key === 'F') fitAll();
    else if (e.key === 'Escape') onSelect(null);
    else if ((e.key === 'c' || e.key === 'C') && proposedIds.length > 0) await decideNodes(proposedIds, 'researcher_confirmed');
    else if ((e.key === 'r' || e.key === 'R') && proposedIds.length > 0) await decideNodes(proposedIds, 'researcher_rejected');
    else if ((e.key === 'Delete' || e.key === 'Backspace') && sel?.type === 'rel') {
      if (await confirm('Remove this link?', 'Remove link', 'Remove')) {
        await op('relations.delete', { relation: sel.id });
        changed('relations');
        onSelect(null);
      }
    } else if ((e.key === 'Delete' || e.key === 'Backspace') && ids.length === 1) {
      const n = byId.get(ids[0] as string) as GNode;
      if (await confirm('Delete "' + clip(n.title, 80) + '" and its links?', 'Delete', 'Delete')) {
        await op('nodes.delete', { node: n.id });
        changed('nodes', 'relations');
        onSelect(null);
      }
    }
  };

  const fromBox = link !== null ? box(byId.get(link.from) as GNode) : null;
  return (
    <div className="relative min-h-0 flex-1" tabIndex={0} onKeyDown={(e) => void onKey(e)} aria-label="Claims map">
      <div
        ref={c.ref}
        className={cn('ro-canvas absolute inset-0', c.panning && 'ro-panning')}
        style={gridStyle(c.vp)}
        onPointerDown={(e) => {
          if (e.target === e.currentTarget || (e.target as HTMLElement).hasAttribute('data-bg')) {
            if (c.onBackgroundPointerDown(e)) onSelect(null);
          }
        }}
        onDoubleClick={(e) => {
          if (e.target !== e.currentTarget && !(e.target as HTMLElement).hasAttribute('data-bg')) return;
          const p = c.toWorld(e.clientX, e.clientY);
          setCreate({ x: Math.round(p.x - W / 2), y: Math.round(p.y - 30), sx: e.clientX, sy: e.clientY });
        }}
      >
        <div data-bg className="absolute left-0 top-0 origin-top-left" style={{ transform: `translate(${c.vp.x}px, ${c.vp.y}px) scale(${c.vp.zoom})` }}>
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width="1" height="1">
            <LinkMarkers />
            {rels.map((r) => {
              const a = byId.get(r.from);
              const b = byId.get(r.to);
              if (a === undefined || b === undefined || !ids.has(a.id) || !ids.has(b.id)) return null;
              const path = linkPath(box(a), box(b));
              const isSel = sel?.type === 'rel' && sel.id === r.id;
              const prop = r.status === 'agent_proposed';
              const color = prop ? 'var(--ro-accent)' : `var(--ro-rel-${r.kind})`;
              return (
                <g key={r.id} className="pointer-events-auto cursor-pointer" onPointerDown={(e) => { e.stopPropagation(); onSelect({ type: 'rel', id: r.id }); }} onPointerEnter={() => setHoverRel(r.id)} onPointerLeave={() => setHoverRel('')}>
                  <path d={path.d} fill="none" stroke="transparent" strokeWidth={14} />
                  <path d={path.d} fill="none" style={{ stroke: color }} strokeWidth={isSel || hoverRel === r.id ? 3 : 1.75} strokeDasharray={prop ? '6 5' : undefined} markerEnd={`url(#ro-arrow-${prop ? 'proposed' : r.kind})`} opacity={sel !== null && !isSel && sel.type === 'rel' ? 0.45 : 1} />
                  {(isSel || hoverRel === r.id) && (
                    <foreignObject x={path.mid.x - 40} y={path.mid.y - 11} width={80} height={22} className="overflow-visible">
                      <div className="flex h-[22px] items-center justify-center">
                        <span className="rounded-full border border-[var(--ro-line)] bg-[var(--ro-card)] px-2 text-[12px] font-semibold leading-5" style={{ color }}>
                          {r.kind}
                        </span>
                      </div>
                    </foreignObject>
                  )}
                </g>
              );
            })}
            {link !== null && fromBox !== null && <path d={linkPath(fromBox, { x: link.x - 1, y: link.y - 1, w: 2, h: 2 }).d} fill="none" style={{ stroke: 'var(--ro-ink-2)' }} strokeWidth={2} strokeDasharray="4 4" markerEnd="url(#ro-arrow-draft)" />}
          </svg>
          {nodes.map((n) => {
            const b = box(n);
            return <NodeCard key={n.id} n={n} b={b} selected={selected.has(n.id)} dim={matches !== null && !matches.has(n.id)} hit={matches?.has(n.id) ?? false} linkTarget={link !== null && link.from !== n.id && allowedLinks(byId.get(link.from)?.kind ?? 'question', n.kind).length > 0} onPointerDown={(e) => startDrag(e, n)} onLinkStart={(e) => startLink(e, n)} />;
          })}
        </div>
      </div>
      <div className="pointer-events-none absolute bottom-3 left-3 flex flex-wrap items-center gap-3 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]/95 px-2.5 py-1.5 text-[12px] text-[var(--ro-ink-2)] shadow-[var(--ro-shadow-sm)]">
        {(['supports', 'opposes', 'informs'] as RelKind[]).map((k) => (
          <span key={k} className="flex items-center gap-1.5">
            <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" strokeWidth="2" style={{ stroke: `var(--ro-rel-${k})` }} /></svg>
            {k}
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden><line x1="0" y1="3" x2="22" y2="3" strokeWidth="2" strokeDasharray="5 4" style={{ stroke: 'var(--ro-accent)' }} /></svg>
          proposed
        </span>
      </div>
      <div className="absolute bottom-3 right-3 flex items-center gap-1.5">
        <Button size="sm" icon={LayoutGrid} title="Hand every card back to the automatic layout" onClick={() => void op('graph.tidy', { project: project.id }).then(() => { changed('nodes'); setTimeout(fitAll, 120); })}>
          Tidy
        </Button>
        <ZoomControls zoom={c.vp.zoom} onZoom={c.zoomBy} onFit={fitAll} />
      </div>
      {pick !== null && (
        <div style={{ position: 'fixed', left: pick.sx + 8, top: pick.sy + 8 }} className="ro-pop z-50 flex flex-col gap-0.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 shadow-[var(--ro-shadow)]" onKeyDown={(e) => e.key === 'Escape' && setPick(null)}>
          {pick.kinds.map((k, i) => (
            <button key={k} autoFocus={i === 0} type="button" onClick={() => void makeLink(pick.from, pick.to, k)} className="flex h-8 items-center gap-2 rounded-[var(--ro-r-sm)] px-2.5 text-[13px] font-semibold hover:bg-[var(--ro-row)]">
              <span className="h-0.5 w-5 rounded-full" style={{ background: `var(--ro-rel-${k})` }} /> {k === 'supports' ? 'Supports' : k === 'opposes' ? 'Opposes' : 'Informs'}
            </button>
          ))}
          <button type="button" onClick={() => setPick(null)} className="h-7 rounded-[var(--ro-r-sm)] px-2.5 text-left text-[12px] text-[var(--ro-muted)] hover:bg-[var(--ro-row)]">
            Cancel
          </button>
        </div>
      )}
      {create !== null && <CreateAt at={create} project={project.id} onClose={() => setCreate(null)} onMade={(id) => onSelect({ type: 'node', id })} />}
      {confirmNode}
    </div>
  );
}

export function NodeCard({ n, b, selected, dim, hit, linkTarget, onPointerDown, onLinkStart }: { n: GNode; b: Box; selected: boolean; dim: boolean; hit: boolean; linkTarget: boolean; onPointerDown: (e: React.PointerEvent) => void; onLinkStart: (e: React.PointerEvent) => void }): React.JSX.Element {
  const Icon = KIND_ICON[n.kind];
  const prop = n.status === 'agent_proposed';
  return (
    <div
      data-node={n.id}
      onPointerDown={onPointerDown}
      className={cn(
        'group absolute flex cursor-pointer select-none flex-col gap-1 overflow-hidden rounded-[var(--ro-r-md)] border bg-[var(--ro-card)] px-2.5 py-2 shadow-[var(--ro-shadow-sm)] transition-[opacity,box-shadow]',
        prop ? 'border-dashed border-[var(--ro-accent)]' : 'border-[var(--ro-line)]',
        selected && 'ring-2 ring-[var(--ro-ink)]',
        hit && 'ring-2 ring-[var(--ro-amber)]',
        linkTarget && 'hover:ring-2 hover:ring-[var(--ro-accent)]',
        dim && 'opacity-35',
        n.status === 'superseded' && 'opacity-60',
      )}
      style={{ left: b.x, top: b.y, width: b.w, height: b.h }}
    >
      <span aria-hidden className="absolute inset-y-0 left-0 w-[3px]" style={{ background: `var(--ro-kind-${n.kind})` }} />
      <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: `var(--ro-kind-${n.kind}-text)` }}>
        <Icon size={12} />
        <span className="truncate">{n.kind === 'evidence' ? (n.work_label !== '' ? n.work_label : 'Evidence') + (n.passage ? ', p. ' + n.passage.page : '') : KIND_LABEL[n.kind]}</span>
        <span className="flex-1" />
        {prop && <Sparkles size={12} className="shrink-0 text-[var(--ro-accent)]" aria-label="Proposed by your AI agent" />}
        {n.status === 'superseded' && <span className="text-[12px] text-[var(--ro-muted)]">superseded</span>}
      </span>
      <span className={cn('text-[var(--ro-ink)]', n.kind === 'evidence' ? 'line-clamp-2 text-[12px] font-semibold leading-4' : 'line-clamp-3 text-[13px] font-semibold leading-[17px]')}>{n.title}</span>
      {n.kind === 'evidence' && n.passage && <span className="serif line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]">{n.passage.quote}</span>}
      {n.kind === 'claim' && (
        <span className="mt-auto flex items-center gap-2">
          <BalanceBar className="flex-1" supports={n.balance?.supports ?? 0} opposes={n.balance?.opposes ?? 0} proposed={n.balance?.proposed ?? 0} />
          <span className="num shrink-0 text-[12px] text-[var(--ro-muted)]">
            {n.balance?.supports ?? 0}/{n.balance?.opposes ?? 0}
          </span>
        </span>
      )}
      {n.kind !== 'question' && (
        <span
          role="button"
          aria-label="Drag to link"
          title="Drag onto a claim or question to link"
          onPointerDown={onLinkStart}
          className="absolute left-1/2 top-0 z-10 flex size-4 -translate-x-1/2 -translate-y-1/2 cursor-crosshair items-center justify-center rounded-full border-2 border-[var(--ro-card)] opacity-0 shadow-sm transition-opacity group-hover:opacity-100"
          style={{ background: `var(--ro-kind-${n.kind})`, top: 1, opacity: selected ? 1 : undefined }}
        />
      )}
    </div>
  );
}

function CreateAt({ at, project, onClose, onMade }: { at: { x: number; y: number; sx: number; sy: number }; project: string; onClose: () => void; onMade: (id: string) => void }): React.JSX.Element {
  return (
    <div style={{ position: 'fixed', left: Math.min(window.innerWidth - 330, at.sx - 150), top: Math.min(window.innerHeight - 200, at.sy - 20) }} className="z-50">
      <NewNodeForm project={project} at={{ x: at.x, y: at.y }} onClose={onClose} onMade={onMade} />
    </div>
  );
}

function NewNodeForm({ project, at, kind: initial = 'claim', onClose, onMade }: { project: string; at?: { x: number; y: number }; kind?: 'question' | 'claim'; onClose: () => void; onMade: (id: string) => void }): React.JSX.Element {
  const [kind, setKind] = useState<'question' | 'claim'>(initial);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);
  const save = async (): Promise<void> => {
    if (title.trim() === '') return;
    setBusy(true);
    try {
      const r = await op<{ node: GNode }>('nodes.create', { project, kind, title: title.trim(), claim_basis: kind === 'claim' ? 'interpretation' : undefined });
      if (at !== undefined) await op('nodes.move', { positions: [{ node: r.node.id, x: at.x, y: at.y }] }, { quiet: true });
      changed('nodes');
      onMade(r.node.id);
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div ref={ref} className="ro-pop flex w-[320px] flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5 shadow-[var(--ro-shadow)]">
      <Segmented label="Kind" size="sm" value={kind} onChange={setKind} options={[{ value: 'question', label: 'Question', icon: CircleHelp }, { value: 'claim', label: 'Claim', icon: Lightbulb }]} />
      <textarea
        autoFocus
        rows={3}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            void save();
          }
          if (e.key === 'Escape') onClose();
        }}
        placeholder={kind === 'question' ? 'The question' : 'The claim, in one sentence'}
        className={textareaCls}
        aria-label="Title"
      />
      <div className="flex justify-end gap-1">
        <Button size="sm" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" loading={busy} disabled={title.trim() === ''} onClick={() => void save()}>
          Add
        </Button>
      </div>
    </div>
  );
}

function NewNodeButton({ project, onMade, label = 'Add', kind = 'claim', primary = false }: { project: string; onMade: (id: string) => void; label?: string; kind?: 'question' | 'claim'; primary?: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative">
      <Button size={primary ? 'md' : 'sm'} variant={primary ? 'primary' : 'secondary'} icon={Plus} onClick={() => setOpen((o) => !o)}>
        {label}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-40 mt-1">
          <NewNodeForm project={project} kind={kind} onClose={() => setOpen(false)} onMade={onMade} />
        </div>
      )}
    </span>
  );
}

/* ---------------------------------------------------------------- list */

function MapList({ nodes, rels, matches, sel, onSelect }: { nodes: GNode[]; rels: Relation[]; matches: Set<string> | null; sel: { type: 'node' | 'rel'; id: string } | null; onSelect: (s: { type: 'node' | 'rel'; id: string } | null) => void }): React.JSX.Element {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const children = new Map<string, { n: GNode; r: Relation }[]>();
  const hasParent = new Set<string>();
  for (const r of rels) {
    const from = byId.get(r.from);
    if (from === undefined || !byId.has(r.to) || r.status === 'researcher_rejected') continue;
    children.set(r.to, [...(children.get(r.to) ?? []), { n: from, r }]);
    hasParent.add(r.from);
  }
  const roots = [...nodes.filter((n) => n.kind === 'question'), ...nodes.filter((n) => n.kind !== 'question' && !hasParent.has(n.id))];
  const row = (n: GNode, depth: number, r: Relation | null, trail: Set<string>): React.ReactNode => {
    const Icon = KIND_ICON[n.kind];
    const kids = trail.has(n.id) ? [] : (children.get(n.id) ?? []);
    const next = new Set(trail).add(n.id);
    return (
      <li key={(r?.id ?? 'root') + n.id}>
        <div
          role="button"
          tabIndex={0}
          onClick={() => onSelect({ type: 'node', id: n.id })}
          onKeyDown={(e) => e.key === 'Enter' && onSelect({ type: 'node', id: n.id })}
          className={cn('flex cursor-pointer items-start gap-2 border-b border-[var(--ro-hair)] py-1.5 pr-3 hover:bg-[var(--ro-row)]', sel?.type === 'node' && sel.id === n.id && 'bg-[var(--ro-row-hover)]', matches !== null && !matches.has(n.id) && 'opacity-40')}
          style={{ paddingLeft: 12 + depth * 22 }}
        >
          {r !== null && (
            <span className={cn('mt-0.5 w-16 shrink-0 text-right text-[12px] font-semibold', r.status === 'agent_proposed' && 'italic')} style={{ color: r.status === 'agent_proposed' ? 'var(--ro-accent-text)' : `var(--ro-rel-${r.kind})` }}>
              {r.kind}
            </span>
          )}
          <Icon size={14} className="mt-0.5 shrink-0" style={{ color: `var(--ro-kind-${n.kind}-text)` }} />
          <span className="min-w-0 flex-1">
            <span className={cn('block leading-[18px]', n.kind === 'evidence' ? 'text-[12px]' : 'text-[13px] font-semibold')}>{n.title}</span>
            {n.kind === 'evidence' && n.passage && (
              <span className="block truncate text-[12px] text-[var(--ro-muted)]">
                {n.work_label}, p. {n.passage.page}
              </span>
            )}
          </span>
          {n.kind === 'claim' && <BalanceBar className="mt-1.5 w-16 shrink-0" supports={n.balance?.supports ?? 0} opposes={n.balance?.opposes ?? 0} proposed={n.balance?.proposed ?? 0} />}
          {n.status === 'agent_proposed' && <DecideButtons compact onConfirm={() => decideNodes([n.id], 'researcher_confirmed')} onReject={() => decideNodes([n.id], 'researcher_rejected')} />}
        </div>
        {kids.length > 0 && <ul>{kids.map((k) => row(k.n, depth + 1, k.r, next))}</ul>}
      </li>
    );
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-[var(--ro-card)]">
      <ul>{roots.map((n) => row(n, 0, null, new Set()))}</ul>
    </div>
  );
}

/* ----------------------------------------------------------- inspector */

interface NodeDetail {
  node: GNode & { anchors: Anchor[] };
  links: (Relation & { direction: 'in' | 'out'; node: GNode | null })[];
  boards: { id: string; name: string }[];
}

function Side({ title, icon: Icon, color, onClose, children }: { title: React.ReactNode; icon: LucideIcon; color: string; onClose: () => void; children: React.ReactNode }): React.JSX.Element {
  return (
    <aside className="flex w-[340px] shrink-0 flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)] max-[760px]:absolute max-[760px]:inset-y-0 max-[760px]:right-0 max-[760px]:z-30 max-[760px]:w-full max-[760px]:shadow-[var(--ro-shadow)]">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-[var(--ro-hair)] px-3">
        <Icon size={14} style={{ color }} />
        <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{title}</span>
        <IconButton icon={X} label="Close (Esc)" size={24} onClick={onClose} />
      </div>
      <div data-scroll className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
        {children}
      </div>
    </aside>
  );
}

const LINK_GROUPS: { key: string; label: string; dir: 'in' | 'out'; kind: RelKind }[] = [
  { key: 'in-supports', label: 'Supported by', dir: 'in', kind: 'supports' },
  { key: 'in-opposes', label: 'Opposed by', dir: 'in', kind: 'opposes' },
  { key: 'in-informs', label: 'Informed by', dir: 'in', kind: 'informs' },
  { key: 'out-supports', label: 'Supports', dir: 'out', kind: 'supports' },
  { key: 'out-opposes', label: 'Opposes', dir: 'out', kind: 'opposes' },
  { key: 'out-informs', label: 'Informs', dir: 'out', kind: 'informs' },
];

const BASIS: { value: string; label: string }[] = [
  { value: 'data_result', label: 'Data' },
  { value: 'literature_finding', label: 'Literature' },
  { value: 'interpretation', label: 'Interpretation' },
  { value: 'hypothesis', label: 'Hypothesis' },
];

export function NodeInspector({ id, nodes, onSelect, onClose }: { id: string; nodes: GNode[]; onSelect: (id: string) => void; onClose: () => void }): React.JSX.Element {
  const d = useLive((signal) => op<NodeDetail>('nodes.get', { node: id }, { quiet: true, signal }), READS.graph.concat(['boards', 'board_items']), [id], 150);
  const [confirmNode, confirm] = useConfirm();
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const n = d.data?.node ?? nodes.find((x) => x.id === id);
  useEffect(() => {
    if (d.data) {
      setTitle(d.data.node.title);
      setBody(d.data.node.body);
    }
  }, [d.data]);
  if (n === undefined) return <></>;
  const Icon = KIND_ICON[n.kind];
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    await op('nodes.update', { node: n.id, ...patch });
    changed('nodes');
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm('Delete "' + clip(n.title, 80) + '" and its links?', 'Delete', 'Delete'))) return;
    await op('nodes.delete', { node: n.id });
    changed('nodes', 'relations');
    onClose();
  };
  const links = d.data?.links ?? [];
  return (
    <Side title={KIND_LABEL[n.kind]} icon={Icon} color={`var(--ro-kind-${n.kind})`} onClose={onClose}>
      {n.status === 'agent_proposed' && (
        <div className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)] p-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ro-accent-text)]">
            <Sparkles size={12} /> Proposed by your AI agent
          </span>
          {n.why !== '' && <p className="text-[12px] leading-4 text-[var(--ro-ink-2)]">{n.why}</p>}
          <DecideButtons onConfirm={() => decideNodes([n.id], 'researcher_confirmed')} onReject={() => decideNodes([n.id], 'researcher_rejected').then(onClose)} />
        </div>
      )}
      {n.status === 'researcher_confirmed' && n.actor === 'agent' && (
        <span className="flex items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
          <Sparkles size={12} /> From your AI agent, confirmed by you
        </span>
      )}
      <textarea rows={3} value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => title.trim() !== '' && title !== n.title && void save({ title: title.trim() })} className={cn(textareaCls, 'text-[13px] font-semibold')} aria-label="Title" />
      <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} onBlur={() => body !== n.body && void save({ body })} placeholder="Detail" className={textareaCls} aria-label="Detail" />
      {n.kind === 'claim' && (
        <div className="flex flex-col gap-2">
          <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Rests on</span>
          <Segmented label="Basis" size="sm" value={n.claim_basis || 'interpretation'} onChange={(v) => void save({ claim_basis: v })} options={BASIS} />
          <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">Confidence</span>
          <Segmented label="Confidence" size="sm" value={n.confidence || 'medium'} onChange={(v) => void save({ confidence: v })} options={[{ value: 'low', label: 'Low' }, { value: 'medium', label: 'Medium' }, { value: 'high', label: 'High' }]} />
          <BalanceBar supports={n.balance?.supports ?? links.filter((l) => l.direction === 'in' && l.kind === 'supports' && l.status === 'researcher_confirmed').length} opposes={n.balance?.opposes ?? links.filter((l) => l.direction === 'in' && l.kind === 'opposes' && l.status === 'researcher_confirmed').length} proposed={n.balance?.proposed ?? 0} />
        </div>
      )}
      {(d.data?.node.anchors ?? []).length > 0 && (
        <section className="flex flex-col gap-1.5">
          <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">{plural(d.data?.node.anchors.length ?? 0, 'passage')}</span>
          {d.data?.node.anchors.map((a) => (
            <div key={a.id} className="group relative rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)]">
              <button type="button" onClick={() => navigate('read', { file: a.file, page: String(a.page) })} className="flex w-full flex-col gap-1 p-2 text-left hover:bg-[var(--ro-row)]">
                <span className="serif line-clamp-5 text-[12px] leading-[17px]">{a.quote}</span>
                <span className="flex items-center gap-1 text-[12px] font-semibold text-[var(--ro-muted)]">
                  <BookOpenText size={11} /> {a.work_label}, p. {a.page} <ArrowRight size={11} />
                </span>
              </button>
              {(n.kind !== 'evidence' || (d.data?.node.anchors.length ?? 0) > 1) && (
                <span className="absolute right-1 top-1 hidden group-hover:block">
                  <IconButton icon={X} label="Take this passage off" size={22} variant="danger" onClick={() => void op('nodes.remove-passage', { node: n.id, anchor: a.id }).then(() => changed('node_anchors', 'nodes'))} />
                </span>
              )}
            </div>
          ))}
        </section>
      )}
      {LINK_GROUPS.map((g) => {
        const list = links.filter((l) => l.direction === g.dir && l.kind === g.kind && l.node !== null);
        if (list.length === 0) return null;
        return (
          <section key={g.key} className="flex flex-col gap-1">
            <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: `var(--ro-rel-${g.kind}-text)` }}>
              {g.label} <span className="num rounded-full bg-[var(--ro-row)] px-1.5 text-[var(--ro-ink-2)]">{list.length}</span>
            </span>
            {list.map((l) => {
              const other = l.node as GNode;
              const OIcon = KIND_ICON[other.kind];
              return (
                <div key={l.id} className={cn('group flex items-start gap-1.5 rounded-[var(--ro-r)] px-1.5 py-1 hover:bg-[var(--ro-row)]', l.status === 'agent_proposed' && 'outline-dashed outline-1 outline-[var(--ro-accent)]')}>
                  <OIcon size={13} className="mt-0.5 shrink-0" style={{ color: `var(--ro-kind-${other.kind}-text)` }} />
                  <button type="button" onClick={() => onSelect(other.id)} className="min-w-0 flex-1 text-left text-[12px] leading-4">
                    {other.title}
                  </button>
                  {l.status === 'agent_proposed' ? (
                    <DecideButtons compact onConfirm={() => decideRelations([l.id], 'researcher_confirmed')} onReject={() => decideRelations([l.id], 'researcher_rejected')} />
                  ) : (
                    <span className="hidden group-hover:inline-flex">
                      <IconButton icon={X} label="Remove the link" size={20} variant="danger" onClick={() => void op('relations.delete', { relation: l.id }).then(() => changed('relations'))} />
                    </span>
                  )}
                </div>
              );
            })}
          </section>
        );
      })}
      {(d.data?.boards ?? []).length > 0 && (
        <section className="flex flex-col gap-1">
          <span className="text-[12px] font-semibold text-[var(--ro-ink-2)]">On boards</span>
          <span className="flex flex-wrap gap-1">
            {d.data?.boards.map((b) => (
              <button key={b.id} type="button" onClick={() => navigate('project', { id: n.project, view: 'board', board: b.id })} className="rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-2 py-0.5 text-[12px] font-semibold hover:bg-[var(--ro-row-hover)]">
                {b.name}
              </button>
            ))}
          </span>
        </section>
      )}
      <div className="mt-auto flex items-center gap-2 border-t border-[var(--ro-hair)] pt-3">
        {n.status === 'researcher_confirmed' && (
          <Button size="sm" variant="ghost" onClick={() => void decideNodes([n.id], 'superseded')}>
            Mark superseded
          </Button>
        )}
        <span className="flex-1" />
        <Button size="sm" variant="danger" icon={Trash2} onClick={() => void remove()}>
          Delete
        </Button>
      </div>
      {confirmNode}
    </Side>
  );
}

export function RelInspector({ rel, nodes, onSelect, onClose }: { rel: Relation; nodes: GNode[]; onSelect: (id: string) => void; onClose: () => void }): React.JSX.Element {
  const from = nodes.find((n) => n.id === rel.from);
  const to = nodes.find((n) => n.id === rel.to);
  const [reason, setReason] = useState(rel.reason);
  useEffect(() => setReason(rel.reason), [rel.reason]);
  if (from === undefined || to === undefined) return <></>;
  const kinds = allowedLinks(from.kind, to.kind);
  const end = (n: GNode): React.JSX.Element => {
    const Icon = KIND_ICON[n.kind];
    return (
      <button type="button" onClick={() => onSelect(n.id)} className="flex items-start gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] p-2 text-left hover:bg-[var(--ro-row)]">
        <Icon size={14} className="mt-0.5 shrink-0" style={{ color: `var(--ro-kind-${n.kind}-text)` }} />
        <span className="text-[12px] font-semibold leading-4">{n.title}</span>
      </button>
    );
  };
  return (
    <Side title="Link" icon={Network} color={`var(--ro-rel-${rel.kind})`} onClose={onClose}>
      {rel.status === 'agent_proposed' && (
        <div className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)] p-2.5">
          <span className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ro-accent-text)]">
            <Sparkles size={12} /> Proposed by your AI agent
          </span>
          <DecideButtons onConfirm={() => decideRelations([rel.id], 'researcher_confirmed')} onReject={() => decideRelations([rel.id], 'researcher_rejected').then(onClose)} />
        </div>
      )}
      {end(from)}
      {kinds.length > 1 ? (
        <Segmented label="Link" size="sm" value={rel.kind} onChange={(k) => void op('relations.update', { relation: rel.id, kind: k }).then(() => changed('relations'))} options={kinds.map((k) => ({ value: k, label: k }))} />
      ) : (
        <span className="text-[12px] font-bold" style={{ color: `var(--ro-rel-${rel.kind}-text)` }}>
          {rel.kind}
        </span>
      )}
      {end(to)}
      <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} onBlur={() => reason !== rel.reason && void op('relations.update', { relation: rel.id, reason }).then(() => changed('relations'))} placeholder="Why the link holds" className={textareaCls} aria-label="Reason" />
      <div className="mt-auto flex justify-end border-t border-[var(--ro-hair)] pt-3">
        <Button size="sm" variant="danger" icon={Trash2} onClick={() => void op('relations.delete', { relation: rel.id }).then(() => { changed('relations'); onClose(); })}>
          Remove link
        </Button>
      </div>
    </Side>
  );
}

function MultiPanel({ ids, nodes, onClose }: { ids: string[]; nodes: GNode[]; onClose: () => void }): React.JSX.Element {
  const list = nodes.filter((n) => ids.includes(n.id));
  const proposedIds = list.filter((n) => n.status === 'agent_proposed').map((n) => n.id);
  return (
    <Side title={plural(list.length, 'card') + ' selected'} icon={LayoutGrid} color="var(--ro-ink-2)" onClose={onClose}>
      {proposedIds.length > 0 && (
        <div className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)] p-2.5">
          <span className="text-[12px] font-bold text-[var(--ro-accent-text)]">{num(proposedIds.length)} proposed by your AI agent</span>
          <DecideButtons onConfirm={() => decideNodes(proposedIds, 'researcher_confirmed')} onReject={() => decideNodes(proposedIds, 'researcher_rejected').then(onClose)} />
        </div>
      )}
      <ul className="flex flex-col gap-1">
        {list.map((n) => {
          const Icon = KIND_ICON[n.kind];
          return (
            <li key={n.id} className="flex items-start gap-2 text-[12px] leading-4">
              <Icon size={13} className="mt-0.5 shrink-0" style={{ color: `var(--ro-kind-${n.kind}-text)` }} />
              <span className="min-w-0 flex-1">{n.title}</span>
              {n.status === 'agent_proposed' && <Badge tone="agent">Proposed</Badge>}
            </li>
          );
        })}
      </ul>
    </Side>
  );
}
