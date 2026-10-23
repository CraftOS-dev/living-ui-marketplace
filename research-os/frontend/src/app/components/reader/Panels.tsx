/**
 * The reader's side panels.
 *
 *   Left:  page thumbnails, the outline, highlights (filter by color; drag
 *          one into a note), evidence and claims drawn from this paper.
 *   Right: the paper's details, its literature note, its claims (with your
 *          AI agent's proposals), questions to your AI agent about it, and
 *          its reference list.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, CircleHelp, ExternalLink, Lightbulb, MessageSquareText, Plus, Quote, Sparkles } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { changed, useLive } from '../../lib/live.ts';
import { KIND_LABEL, ago, clip, num } from '../../lib/format.ts';
import { navigate } from '../../lib/router.ts';
import type { Anchor, Annotation, Ask, FileInfo, GNode, Note, Project } from '../../lib/types.ts';
import { DecideButtons, RequestStatus, askAgent, decideNodes } from '../agent.tsx';
import { PaperPane } from '../library/PaperPane.tsx';
import { DRAG_ANCHOR, NoteEditor } from '../notes/NoteEditor.tsx';
import { hueOfSlot } from '../paper.tsx';
import { Badge, Button, Empty, Select, Skeleton, Tabs, textareaCls } from '../ui.tsx';
import { drawPage } from './pdf.ts';
import type { PDFDocumentProxy } from './pdf.ts';

/* ------------------------------------------------------------------ left */

export type LeftTab = 'pages' | 'outline' | 'marks' | 'evidence';

export function LeftPanel({
  tab,
  onTab,
  info,
  doc,
  current,
  pageCount,
  marks,
  nodes,
  onJump,
  onJumpAnchor,
}: {
  tab: LeftTab;
  onTab: (t: LeftTab) => void;
  info: FileInfo;
  doc: PDFDocumentProxy | null;
  current: number;
  pageCount: number;
  marks: Annotation[];
  nodes: GNode[];
  onJump: (page: number) => void;
  onJumpAnchor: (a: Anchor) => void;
}): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        label="Sidebar"
        value={tab}
        onChange={onTab}
        options={[
          { value: 'pages', label: 'Pages' },
          { value: 'outline', label: 'Outline' },
          { value: 'marks', label: <>Highlights{marks.length > 0 && <span className="num text-[var(--ro-muted)]">{marks.length}</span>}</> },
          { value: 'evidence', label: <>Claims{nodes.length > 0 && <span className="num text-[var(--ro-muted)]">{nodes.length}</span>}</> },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'pages' && <Thumbs doc={doc} count={pageCount} current={current} onJump={onJump} />}
        {tab === 'outline' && <Outline info={info} current={current} onJump={onJump} />}
        {tab === 'marks' && <MarksList marks={marks} onJump={onJumpAnchor} />}
        {tab === 'evidence' && <NodesList nodes={nodes} onJump={onJumpAnchor} />}
      </div>
    </div>
  );
}

function Thumb({ doc, n, active, onJump }: { doc: PDFDocumentProxy | null; n: number; active: boolean; onJump: (n: number) => void }): React.JSX.Element {
  const ref = useRef<HTMLButtonElement | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const io = new IntersectionObserver((e) => {
      if (e[0]?.isIntersecting) setSeen(true);
    }, { rootMargin: '400px' });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (!seen || doc === null || canvas.current === null) return;
    let cancel: (() => void) | null = null;
    void doc.getPage(n).then((p) => {
      if (canvas.current) cancel = drawPage(p, canvas.current, 132 / p.getViewport({ scale: 1 }).width);
    });
    return () => cancel?.();
  }, [seen, doc, n]);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: 'nearest' });
  }, [active]);
  return (
    <button ref={ref} type="button" onClick={() => onJump(n)} className={cn('flex flex-col items-center gap-1 rounded-[var(--ro-r)] p-1.5', active ? 'bg-[var(--ro-row-hover)]' : 'hover:bg-[var(--ro-row)]')} aria-label={'Page ' + n}>
      <canvas ref={canvas} className={cn('w-[132px] bg-white shadow-[var(--ro-shadow-sm)]', active && 'outline outline-2 outline-[var(--ro-accent)]')} style={{ minHeight: 60 }} />
      <span className="num text-[12px] text-[var(--ro-muted)]">{n}</span>
    </button>
  );
}

function Thumbs({ doc, count, current, onJump }: { doc: PDFDocumentProxy | null; count: number; current: number; onJump: (n: number) => void }): React.JSX.Element {
  return (
    <div className="flex flex-col items-center gap-1 p-2">
      {Array.from({ length: count }, (_, i) => (
        <Thumb key={i} doc={doc} n={i + 1} active={current === i + 1} onJump={onJump} />
      ))}
    </div>
  );
}

function Outline({ info, current, onJump }: { info: FileInfo; current: number; onJump: (n: number) => void }): React.JSX.Element {
  const outline = info.outline ?? [];
  if (outline.length === 0) return <Empty compact icon={BookOpenText} title="This PDF has no outline" />;
  let active = -1;
  outline.forEach((o, i) => {
    if (o.page > 0 && o.page <= current) active = i;
  });
  return (
    <ul className="flex flex-col p-1.5">
      {outline.map((o, i) => (
        <li key={i}>
          <button type="button" disabled={o.page === 0} onClick={() => onJump(o.page)} className={cn('flex w-full items-baseline gap-2 rounded-[var(--ro-r-sm)] py-1 pr-1.5 text-left text-[12px] leading-4 hover:bg-[var(--ro-row)]', i === active && 'bg-[var(--ro-row)] font-semibold')} style={{ paddingLeft: 6 + o.depth * 12 }}>
            <span className="min-w-0 flex-1">{o.title}</span>
            <span className="num shrink-0 text-[var(--ro-muted)]">{o.page > 0 ? o.page : ''}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function MarksList({ marks, onJump }: { marks: Annotation[]; onJump: (a: Anchor) => void }): React.JSX.Element {
  const { slot } = useApp();
  const [only, setOnly] = useState(0);
  const slots = useMemo(() => Array.from(new Set(marks.map((m) => m.color_slot))).sort(), [marks]);
  const shown = only === 0 ? marks : marks.filter((m) => m.color_slot === only);
  if (marks.length === 0) return <Empty compact icon={Quote} title="No highlights yet" />;
  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap gap-1 border-b border-[var(--ro-hair)] p-2">
        <button type="button" onClick={() => setOnly(0)} className={cn('h-6 rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold', only === 0 ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>
          All {marks.length}
        </button>
        {slots.map((s) => (
          <button key={s} type="button" title={slot(s).meaning} onClick={() => setOnly(only === s ? 0 : s)} className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold', only === s ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>
            <span className="size-2.5 rounded-full" style={{ background: `var(--ro-hl-${hueOfSlot(s)})` }} />
            {slot(s).meaning !== '' ? clip(slot(s).meaning, 14) : ''}
          </button>
        ))}
      </div>
      <ul className="flex flex-col p-1.5">
        {shown.map((m) => (
          <li key={m.id}>
            <button
              type="button"
              draggable
              onDragStart={(e) => m.anchor && e.dataTransfer.setData(DRAG_ANCHOR, JSON.stringify({ anchor: m.anchor.id, quote: m.anchor.quote, page: m.anchor.page, work_label: m.anchor.work_label }))}
              onClick={() => m.anchor && onJump(m.anchor)}
              className="flex w-full gap-2 rounded-[var(--ro-r)] p-1.5 text-left hover:bg-[var(--ro-row)]"
              title={slot(m.color_slot).meaning}
            >
              <span className="w-1 shrink-0 rounded-full" style={{ background: `var(--ro-hl-${hueOfSlot(m.color_slot)})` }} />
              <span className="min-w-0 flex-1">
                <span className={cn('block text-[12px] leading-4', m.kind === 'area' && 'italic text-[var(--ro-muted)]')}>{m.kind === 'area' ? (m.anchor?.quote ? clip(m.anchor.quote, 160) : 'An area of the page') : clip(m.anchor?.quote ?? '', 220)}</span>
                {m.comment !== '' && <span className="mt-0.5 block rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] px-1.5 py-0.5 text-[12px] leading-4">{m.comment}</span>}
                <span className="mt-0.5 block text-[12px] text-[var(--ro-muted)]">Page {m.page}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function NodesList({ nodes, onJump }: { nodes: GNode[]; onJump: (a: Anchor) => void }): React.JSX.Element {
  if (nodes.length === 0) return <Empty compact icon={Lightbulb} title="No claims from this paper yet" />;
  return (
    <ul className="flex flex-col p-1.5">
      {nodes.map((n) => (
        <li key={n.id}>
          <div className={cn('mb-1 flex flex-col gap-1 rounded-[var(--ro-r)] border p-2', n.status === 'agent_proposed' ? 'border-dashed border-[var(--ro-accent)] bg-[var(--ro-accent-soft)]' : 'border-[var(--ro-line)]')}>
            <button type="button" onClick={() => n.anchors?.[0] && onJump(n.anchors[0])} className="text-left">
              <span className="flex items-center gap-1 text-[12px] font-semibold" style={{ color: `var(--ro-kind-${n.kind}-text)` }}>
                {n.kind === 'question' ? <CircleHelp size={12} /> : n.kind === 'claim' ? <Lightbulb size={12} /> : <Quote size={12} />}
                {KIND_LABEL[n.kind]}
                {n.anchors?.[0] && <span className="text-[var(--ro-muted)]"> · p. {n.anchors[0].page}</span>}
              </span>
              <span className="block text-[12px] font-semibold leading-4">{n.title}</span>
            </button>
            {n.status === 'agent_proposed' && (
              <div className="flex items-center gap-1">
                <Sparkles size={11} className="text-[var(--ro-accent-text)]" />
                <span className="flex-1 text-[12px] text-[var(--ro-muted)]">Proposed</span>
                <DecideButtons compact onConfirm={() => decideNodes([n.id], 'researcher_confirmed')} onReject={() => decideNodes([n.id], 'researcher_rejected')} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ----------------------------------------------------------------- right */

export type RightTab = 'paper' | 'note' | 'claims' | 'ask' | 'refs';

export function RightPanel({ tab, onTab, workId, projects, nodes, onJumpAnchor }: { tab: RightTab; onTab: (t: RightTab) => void; workId: string; projects: Project[]; nodes: GNode[]; onJumpAnchor: (a: Anchor) => void }): React.JSX.Element {
  return (
    <div className="flex h-full flex-col">
      <Tabs
        label="Panel"
        value={tab}
        onChange={onTab}
        options={[
          { value: 'paper', label: 'Paper' },
          { value: 'note', label: 'Note' },
          { value: 'claims', label: 'Claims' },
          { value: 'ask', label: 'Ask' },
          { value: 'refs', label: 'References' },
        ]}
      />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'paper' && <PaperPane id={workId} />}
        {tab === 'note' && <LiteratureNote workId={workId} onJump={onJumpAnchor} />}
        {tab === 'claims' && <ClaimsTab workId={workId} projects={projects} nodes={nodes} onJump={onJumpAnchor} />}
        {tab === 'ask' && <AskTab workId={workId} onJump={onJumpAnchor} />}
        {tab === 'refs' && <RefsTab workId={workId} />}
      </div>
    </div>
  );
}

function LiteratureNote({ workId, onJump }: { workId: string; onJump: (a: Anchor) => void }): React.JSX.Element {
  const [noteId, setNoteId] = useState<string | null>(null);
  useEffect(() => {
    void op<{ notes: Note[] }>('notes.list', { work: workId, kind: 'literature', limit: 1 }, { quiet: true }).then((r) => setNoteId(r.notes[0]?.id ?? ''));
  }, [workId]);
  const note = useLive((signal) => (noteId ? op<{ note: Note }>('notes.get', { note: noteId }, { quiet: true, signal }).then((r) => r.note) : Promise.resolve(null)), ['notes'], [noteId]);
  if (noteId === null) return <div className="p-3"><Skeleton /></div>;
  if (noteId === '')
    return (
      <Empty compact icon={MessageSquareText} title="No note for this paper yet" action={<Button icon={Plus} onClick={() => void op<{ note: Note }>('notes.for-work', { work: workId }).then((r) => { setNoteId(r.note.id); changed('notes'); })}>Start a note</Button>} />
    );
  if (note.data === null) return <div className="p-3"><Skeleton /></div>;
  return (
    <div className="p-3">
      <NoteEditor note={note.data} onJump={onJump} compact />
    </div>
  );
}

function ClaimsTab({ workId, projects, nodes, onJump }: { workId: string; projects: Project[]; nodes: GNode[]; onJump: (a: Anchor) => void }): React.JSX.Element {
  const { projects: all } = useApp();
  const [project, setProject] = useState(projects[0]?.id ?? '');
  const [req, setReq] = useState('');
  const options = (projects.length > 0 ? projects : all.filter((p) => p.state === 'active')).filter((p) => p.confidentiality !== 'confidential');
  const byProject = useMemo(() => {
    const m = new Map<string, GNode[]>();
    for (const n of nodes) m.set(n.project, [...(m.get(n.project) ?? []), n]);
    return m;
  }, [nodes]);
  const proposed = nodes.filter((n) => n.status === 'agent_proposed');
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5">
        <p className="flex items-center gap-1.5 text-[12px] font-semibold"><Sparkles size={13} className="text-[var(--ro-accent-text)]" /> Map this paper's claims</p>
        <div className="flex gap-1.5">
          <Select ariaLabel="Project" className="flex-1" value={project} onChange={setProject} options={options.length > 0 ? options.map((p) => ({ value: p.id, label: p.name })) : [{ value: '', label: 'Start a project first' }]} />
          <Button size="md" disabled={project === ''} onClick={() => void askAgent('claims_requested', { project, works: [workId] }, 'Your AI agent is asked to map the claims').then(setReq)}>
            Ask your AI agent
          </Button>
        </div>
        <RequestStatus id={req} />
      </div>
      {proposed.length > 1 && (
        <div className="flex items-center justify-between gap-2 rounded-[var(--ro-r)] bg-[var(--ro-accent-soft)] px-2.5 py-1.5">
          <span className="text-[12px] font-semibold">{num(proposed.length)} proposals from your AI agent</span>
          <Button size="sm" onClick={() => void decideNodes(proposed.map((n) => n.id), 'researcher_confirmed').then(() => toast.success('Confirmed'))}>
            Confirm all
          </Button>
        </div>
      )}
      {nodes.length === 0 && <Empty compact icon={Lightbulb} title="Nothing yet" />}
      {Array.from(byProject.entries()).map(([pid, list]) => {
        const p = all.find((x) => x.id === pid);
        return (
          <div key={pid} className="flex flex-col gap-1">
            <button type="button" onClick={() => navigate('project', { id: pid, view: 'map' })} className="flex items-center gap-1.5 text-[12px] font-bold hover:underline">
              <span className="size-2 rounded-full" style={{ background: `var(--ro-pc-${p?.color ?? 'ink'})` }} />
              {p?.name ?? 'Project'}
              <ExternalLink size={11} className="text-[var(--ro-muted)]" />
            </button>
            {list.map((n) => (
              <div key={n.id} className={cn('flex items-start gap-2 rounded-[var(--ro-r)] border p-2', n.status === 'agent_proposed' ? 'border-dashed border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}>
                <button type="button" onClick={() => n.anchors?.[0] && onJump(n.anchors[0])} className="min-w-0 flex-1 text-left">
                  <span className="text-[12px] font-semibold" style={{ color: `var(--ro-kind-${n.kind}-text)` }}>{KIND_LABEL[n.kind]}</span>
                  <span className="block text-[12px] leading-4">{n.title}</span>
                  {n.why !== '' && <span className="mt-0.5 block text-[12px] text-[var(--ro-muted)]">{clip(n.why, 160)}</span>}
                </button>
                {n.status === 'agent_proposed' ? <DecideButtons compact onConfirm={() => decideNodes([n.id], 'researcher_confirmed')} onReject={() => decideNodes([n.id], 'researcher_rejected')} /> : <Badge tone="good">Confirmed</Badge>}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function AskTab({ workId, onJump }: { workId: string; onJump: (a: Anchor) => void }): React.JSX.Element {
  const asks = useLive((signal) => op<{ asks: Ask[] }>('asks.list', { work: workId, limit: 30 }, { quiet: true, signal }).then((r) => r.asks), ['asks', 'agent_requests'], [workId]);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    if (q.trim() === '') return;
    setBusy(true);
    try {
      await op('asks.create', { scope: 'work', work: workId, question: q.trim() });
      setQ('');
      changed('asks');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3 p-3">
      <form className="flex flex-col gap-1.5" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Ask about this paper" className={textareaCls} aria-label="Question about this paper" />
        <div className="flex justify-end">
          <Button type="submit" size="sm" variant="primary" icon={Sparkles} loading={busy} disabled={q.trim() === ''}>
            Ask your AI agent
          </Button>
        </div>
      </form>
      {(asks.data ?? []).map((a) => (
        <div key={a.id} className="flex flex-col gap-1.5 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] p-2.5">
          <p className="text-[12px] font-bold">{a.question}</p>
          {a.status === 'answered' ? (
            <div className="flex flex-col gap-1.5">
              {a.answer.length === 0 && <p className="text-[12px] leading-4">{a.answer_text}</p>}
              {a.answer.map((b, i) =>
                b.type === 'quote' && b.ref ? (
                  <button key={i} type="button" onClick={() => b.ref && onJump(b.ref)} className="serif rounded-[var(--ro-r)] border-l-2 border-[var(--ro-accent)] bg-[var(--ro-row)] px-2 py-1 text-left text-[12px] leading-4 hover:bg-[var(--ro-row-hover)]">
                    {clip(b.ref.quote, 300)} <span className="font-sans text-[var(--ro-muted)]">p. {b.ref.page}</span>
                  </button>
                ) : b.text ? (
                  <p key={i} className={cn('text-[12px] leading-4', b.type === 'heading' && 'font-bold')}>{b.text}</p>
                ) : null,
              )}
              <span className="text-[12px] text-[var(--ro-muted)]">{ago(a.updated)}</span>
            </div>
          ) : a.status === 'failed' ? (
            <p className="text-[12px] text-[var(--ro-red-text)]">{a.failure || 'Your AI agent could not answer this from the library.'}</p>
          ) : (
            <RequestStatus id={a.request} />
          )}
        </div>
      ))}
    </div>
  );
}

interface RefRow {
  id: string;
  position: number;
  raw: string;
  doi: string;
  openalex_id: string;
  title: string;
  year: number;
  authors: string;
  venue: string;
  work: string;
  addable: boolean;
}

function RefsTab({ workId }: { workId: string }): React.JSX.Element {
  const r = useLive((signal) => op<{ refs: RefRow[]; unreachable?: boolean }>('references.list', { work: workId }, { quiet: true, signal }), ['work_refs', 'works'], [workId]);
  const [busy, setBusy] = useState<string | null>(null);
  if (r.data === null) return <div className="flex flex-col gap-2 p-3">{[0, 1, 2].map((i) => <Skeleton key={i} />)}</div>;
  if (r.data.unreachable) return <Empty compact icon={BookOpenText} title="The reference list did not load">The registry did not answer. Try again later.</Empty>;
  if (r.data.refs.length === 0) return <Empty compact icon={BookOpenText} title="No reference list found" />;
  const inLib = r.data.refs.filter((x) => x.work !== '').length;
  return (
    <div className="flex flex-col">
      <p className="border-b border-[var(--ro-hair)] px-3 py-2 text-[12px] text-[var(--ro-muted)]">
        {num(r.data.refs.length)} references · {num(inLib)} in your library
      </p>
      <ol className="flex flex-col">
        {r.data.refs.map((x) => (
          <li key={x.id} className="flex items-start gap-2 border-b border-[var(--ro-hair)] px-3 py-2 last:border-0">
            <span className="num w-6 shrink-0 text-right text-[12px] text-[var(--ro-muted)]">{x.position + 1}</span>
            <span className="min-w-0 flex-1">
              <span className="block text-[12px] font-semibold leading-4">{x.title !== '' ? x.title : clip(x.raw, 160)}</span>
              <span className="block truncate text-[12px] text-[var(--ro-muted)]">{[x.authors, x.venue, x.year > 0 ? x.year : ''].filter(Boolean).join(' · ')}</span>
            </span>
            {x.work !== '' ? (
              <Badge tone="neutral">In library</Badge>
            ) : x.addable ? (
              <Button
                size="sm"
                loading={busy === x.id}
                onClick={() => {
                  setBusy(x.id);
                  void op('works.add', { ids: x.doi !== '' ? x.doi : x.openalex_id, source: 'references' })
                    .then(() => {
                      changed('works', 'work_refs');
                      toast.success('Added');
                    })
                    .finally(() => setBusy(null));
                }}
              >
                Add
              </Button>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
