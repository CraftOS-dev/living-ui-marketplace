/**
 * A project: one research question and everything built for it.
 *
 *   Overview      the numbers, the project's to-do at a glance, the claims
 *                 and how well each is supported, what was made, what changed
 *   To-do         the project's tasks: a list by due day or a board by status
 *   Reading list  the project's papers with their status and role
 *   Claims map    questions, claims and evidence with their links
 *   Experiments   plans, runs, results and a log for each experiment
 *   Boards        free canvases of cards (one child per board)
 *   Writing       manuscripts with live citations
 *   Screening     systematic reviews
 *   Notes         the project's notes
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Archive, ArchiveRestore, ArrowRight, BookOpenText, CircleHelp, Download, FileText, Filter, FlaskConical, FolderKanban, FolderTree, LayoutDashboard, Library, Lightbulb, ListChecks, ListTodo, Lock, LockOpen, MessageSquareText, MoreHorizontal, Network, NotebookPen, Palette, Pencil, Pin, PinOff, Plus, Quote, Sparkles, SquareKanban, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { download, op } from '../lib/api.ts';
import type { Params } from '../lib/api.ts';
import { changed, READS, useLive } from '../lib/live.ts';
import { ago, byline, num, plural } from '../lib/format.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { ProjectColor } from '../lib/themeColors.ts';
import type { ActivityEntry, GNode, Project, Relation, WorkRow } from '../lib/types.ts';
import { useAddPapers } from '../components/AddPapers.tsx';
import { useAsk } from '../components/agent.tsx';
import { Ring } from '../components/charts.tsx';
import { DRAG_WORKS, Row } from '../components/library/LibraryTree.tsx';
import { AgentMark, Cover, openPaper, PaperState, ReadDot } from '../components/paper.tsx';
import { BalanceBar, Badge, Button, Empty, Field, IconButton, LoadError, Modal, Panel, Popover, Skeleton, Spinner, TextLink, Toggle, inputCls, menuItem, textareaCls, useConfirm, useContextMenu } from '../components/ui.tsx';
import { ColorPicker } from './Projects.tsx';
import { ClaimsMap } from '../components/project/ClaimsMap.tsx';
import { BoardView } from '../components/project/Board.tsx';
import { Writing } from '../components/project/Writing.tsx';
import { Screening } from '../components/project/Screening.tsx';
import { NotesWorkspace } from './Notes.tsx';
import { ExperimentsPanel, ExperimentsView, NewExperiment } from '../components/exp/Hub.tsx';
import { TasksView } from '../components/project/Tasks.tsx';
import { RepositoryView } from '../components/repo/Repository.tsx';
import { notesZip, type NotesExport } from '../lib/notesZip.ts';
import { TodoPanel } from '../components/tasks/TodoPanel.tsx';

type View = 'overview' | 'tasks' | 'papers' | 'map' | 'exp' | 'repo' | 'board' | 'ms' | 'screen' | 'notes';

interface Children {
  boards: { id: string; name: string; items: number }[];
  manuscripts: { id: string; title: string; status: string; words: number }[];
  reviews: { id: string; title: string; stage: string; counts: Record<string, number> }[];
}

export interface ReadingRow {
  link: string;
  status: 'to_read' | 'reading' | 'read' | 'excluded';
  role: 'core' | 'background';
  note: string;
  project_added_by: string;
  added: string;
  project_nodes: number;
  project_proposed: number;
  work: WorkRow;
}

export default function ProjectPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const id = query.get('id') ?? '';
  const asked = query.get('view') ?? 'overview';
  const view: View = SECTIONS.some((x) => x.view === asked) ? (asked as View) : 'overview';
  const pr = useLive((signal) => op<{ project: Project; recent: ActivityEntry[] }>('projects.get', { project: id }, { quiet: true, signal }), READS.project, [id], 250);
  const kids = useLive(
    async (signal) => {
      const [b, m, s] = await Promise.all([
        op<{ boards: Children['boards'] }>('boards.list', { project: id }, { quiet: true, signal }),
        op<{ manuscripts: Children['manuscripts'] }>('ms.list', { project: id }, { quiet: true, signal }),
        op<{ reviews: Children['reviews'] }>('screen.list', { project: id }, { quiet: true, signal }),
      ]);
      return { boards: b.boards, manuscripts: m.manuscripts, reviews: s.reviews } as Children;
    },
    ['boards', 'board_items', 'manuscripts', 'reviews', 'review_records', 'decisions'],
    [id],
    300,
  );
  useEffect(() => {
    if (id !== '') void op('projects.opened', { project: id }, { quiet: true }).catch(() => undefined);
  }, [id]);
  if (pr.error !== null)
    return (
      <div className="p-4">
        <LoadError message={pr.error} onRetry={pr.reload} />
      </div>
    );
  if (pr.data === null)
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  const p = pr.data.project;
  const k = kids.data ?? { boards: [], manuscripts: [], reviews: [] };
  return (
    <div className="flex h-full min-h-0 @container">
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--ro-line)] bg-[var(--ro-card)] @min-[760px]:flex">
        <ProjectTree p={p} view={view} query={query} kids={k} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <NarrowNav view={view} />
        <div className={cn('min-h-0 flex-1', view === 'map' || view === 'board' || view === 'ms' || view === 'notes' || view === 'tasks' || view === 'exp' || view === 'repo' ? 'flex flex-col' : 'overflow-y-auto')}>
          {view === 'overview' && <Overview p={p} recent={pr.data.recent} kids={k} />}
          {view === 'tasks' && <TasksView project={p} taskId={query.get('task') ?? ''} />}
          {view === 'papers' && <ReadingList p={p} />}
          {view === 'map' && <ClaimsMap project={p} focus={query.get('node') ?? ''} />}
          {view === 'board' && <BoardView project={p} boardId={query.get('board') ?? k.boards[0]?.id ?? ''} />}
          {view === 'ms' && <Writing project={p} msId={query.get('ms') ?? k.manuscripts[0]?.id ?? ''} />}
          {view === 'screen' && <Screening project={p} reviewId={query.get('review') ?? k.reviews[0]?.id ?? ''} />}
          {view === 'notes' && <NotesWorkspace project={p.id} noteId={query.get('note') ?? ''} />}
          {view === 'exp' && <ExperimentsView project={p} expId={query.get('exp') ?? ''} />}
          {view === 'repo' && <RepositoryView project={p} itemId={query.get('item') ?? ''} />}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ tree */

const SECTIONS: { view: View; label: string; icon: LucideIcon }[] = [
  { view: 'overview', label: 'Overview', icon: LayoutDashboard },
  { view: 'tasks', label: 'To-do', icon: ListTodo },
  { view: 'papers', label: 'Reading list', icon: Library },
  { view: 'map', label: 'Claims map', icon: Network },
  { view: 'exp', label: 'Experiments', icon: FlaskConical },
  { view: 'repo', label: 'Repository', icon: FolderTree },
  { view: 'board', label: 'Boards', icon: SquareKanban },
  { view: 'ms', label: 'Writing', icon: FileText },
  { view: 'screen', label: 'Screening', icon: ListChecks },
  { view: 'notes', label: 'Notes', icon: NotebookPen },
];

function NarrowNav({ view }: { view: View }): React.JSX.Element {
  return (
    <nav aria-label="Project" className="flex shrink-0 gap-1 overflow-x-auto border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-2 py-1.5 @min-[760px]:hidden">
      {SECTIONS.map((s) => (
        <button key={s.view} type="button" onClick={() => replaceQuery({ view: s.view === 'overview' ? undefined : s.view })} className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold', view === s.view ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)]')}>
          <s.icon size={13} /> {s.label}
        </button>
      ))}
    </nav>
  );
}

function ProjectTree({ p, view, query, kids }: { p: Project; view: View; query: URLSearchParams; kids: Children }): React.JSX.Element {
  const add = useAddPapers();
  const menu = useContextMenu();
  const [confirmNode, confirm] = useConfirm();
  const [open, setOpen] = useState<Record<string, boolean>>({ board: true, ms: true, screen: true });
  const [editing, setEditing] = useState('');
  const [newMs, setNewMs] = useState(false);
  const [newReview, setNewReview] = useState(false);
  const [newExp, setNewExp] = useState(false);
  const s = p.stats;
  const go = (v: View, extra: Record<string, string | undefined> = {}): void => replaceQuery({ view: v === 'overview' ? undefined : v, board: undefined, ms: undefined, review: undefined, note: undefined, node: undefined, task: undefined, exp: undefined, item: undefined, tab: undefined, ...extra });
  const newBoard = async (): Promise<void> => {
    const r = await op<{ board: { id: string } }>('boards.create', { project: p.id });
    changed('boards');
    go('board', { board: r.board.id });
  };
  const rename = async (opName: 'boards.update' | 'ms.update' | 'screen.update', params: Params): Promise<void> => {
    setEditing('');
    await op(opName, params);
    changed('boards', 'manuscripts', 'reviews');
  };
  const remove = async (what: string, opName: 'boards.delete' | 'ms.delete' | 'screen.delete', params: Params): Promise<void> => {
    if (!(await confirm(`Delete ${what}? This cannot be undone.`, 'Delete', 'Delete'))) return;
    await op(opName, params);
    changed('boards', 'manuscripts', 'reviews');
    go(view);
  };
  const childRow = (key: string, label: string, active: boolean, onClick: () => void, opName: 'boards.update' | 'ms.update' | 'screen.update', del: 'boards.delete' | 'ms.delete' | 'screen.delete', idParam: string, nameParam: string, icon: LucideIcon, count?: number) => (
    <Row
      key={key}
      icon={icon}
      label={label}
      count={count}
      active={active}
      depth={1}
      onClick={onClick}
      editing={editing === key}
      onDoubleClick={() => setEditing(key)}
      onRename={(name) => (name === null || name.trim() === '' || name === label ? setEditing('') : void rename(opName, { [idParam]: key, [nameParam]: name.trim() }))}
      onContextMenu={(e) =>
        menu(e, [
          { label: 'Rename', icon: Pencil, onClick: () => setEditing(key) },
          { label: 'Delete', icon: Trash2, danger: true, onClick: () => void remove('"' + label + '"', del, { [idParam]: key }) },
        ])
      }
    />
  );
  const section = (v: View, label: string, icon: LucideIcon, count?: number) => <Row key={v} icon={icon} label={label} count={count} active={view === v} onClick={() => go(v)} />;
  const parent = (v: View, label: string, icon: LucideIcon, kidsList: React.ReactNode[], onPlus: () => void, plusLabel: string) => (
    <div key={v}>
      <Row icon={icon} label={label} active={view === v && kidsList.length === 0} chevron={kidsList.length === 0 ? 'none' : open[v] ? 'open' : 'closed'} onChevron={() => setOpen((o) => ({ ...o, [v]: !o[v] }))} onClick={() => (kidsList.length === 0 ? go(v) : setOpen((o) => ({ ...o, [v]: !o[v] })))} onPlus={onPlus} plusLabel={plusLabel} />
      {open[v] && kidsList}
    </div>
  );
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-[var(--ro-hair)] p-3">
        <button type="button" onClick={() => navigate('projects')} className="mb-1 flex items-center gap-1 text-[12px] font-semibold text-[var(--ro-muted)] hover:text-[var(--ro-ink)]">
          <FolderKanban size={12} /> Projects
        </button>
        <div className="flex items-start gap-2">
          <span className="mt-1 size-2.5 shrink-0 rounded-full" style={{ background: `var(--ro-pc-${p.color})` }} />
          <span className="min-w-0 flex-1 text-[14px] font-bold leading-5">{p.name}</span>
          <ProjectMenu p={p} />
        </div>
        {p.confidentiality === 'confidential' && (
          <span className="mt-1.5 inline-flex">
            <Badge tone="neutral" title="Your AI agent cannot open this project">
              <Lock size={10} /> Confidential
            </Badge>
          </span>
        )}
      </div>
      <div role="tree" aria-label="Project" className="flex min-h-0 flex-1 flex-col gap-px overflow-y-auto p-2">
        {section('overview', 'Overview', LayoutDashboard)}
        {section('tasks', 'To-do', ListTodo, s?.tasks_open)}
        <Row icon={Library} label="Reading list" count={s?.papers} active={view === 'papers'} onClick={() => go('papers')} onPlus={() => add.open({ project: p.id })} plusLabel="Add papers" onDropWorks={(ids) => void op('projects.add-works', { project: p.id, works: ids }).then(() => changed('project_works'))} />
        {section('map', 'Claims map', Network, s ? s.questions + s.claims + s.evidence : undefined)}
        {/* One row: the experiments page is the place to see them all (a table, a board, a timeline). */}
        <Row icon={FlaskConical} label="Experiments" count={s !== undefined && s.experiments > 0 ? s.experiments : undefined} active={view === 'exp'} onClick={() => go('exp')} onPlus={() => setNewExp(true)} plusLabel="New experiment" />
        {section('repo', 'Repository', FolderTree, s !== undefined && s.repo_files > 0 ? s.repo_files : undefined)}
        {parent('board', 'Boards', SquareKanban, kids.boards.map((b) => childRow(b.id, b.name, view === 'board' && (query.get('board') ?? kids.boards[0]?.id) === b.id, () => go('board', { board: b.id }), 'boards.update', 'boards.delete', 'board', 'name', SquareKanban, b.items)), () => void newBoard(), 'New board')}
        {parent('ms', 'Writing', FileText, kids.manuscripts.map((m) => childRow(m.id, m.title, view === 'ms' && (query.get('ms') ?? kids.manuscripts[0]?.id) === m.id, () => go('ms', { ms: m.id }), 'ms.update', 'ms.delete', 'manuscript', 'title', FileText)), () => setNewMs(true), 'New manuscript')}
        {parent('screen', 'Screening', ListChecks, kids.reviews.map((r) => childRow(r.id, r.title, view === 'screen' && (query.get('review') ?? kids.reviews[0]?.id) === r.id, () => go('screen', { review: r.id }), 'screen.update', 'screen.delete', 'review', 'title', ListChecks, r.counts['identified'])), () => setNewReview(true), 'New review')}
        {section('notes', 'Notes', NotebookPen, s?.notes)}
      </div>
      {confirmNode}
      <NewManuscript project={p.id} open={newMs} onClose={() => setNewMs(false)} onMade={(id) => go('ms', { ms: id })} />
      <NewReview project={p.id} question={p.question} open={newReview} onClose={() => setNewReview(false)} onMade={(id) => go('screen', { review: id })} />
      <NewExperiment project={p.id} open={newExp} onClose={() => setNewExp(false)} onMade={(id) => go('exp', { exp: id })} />
    </div>
  );
}

function ProjectMenu({ p }: { p: Project }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const close = (): void => setOpen(false);
  const update = async (patch: Params): Promise<void> => {
    close();
    await op('projects.update', { project: p.id, ...patch });
    changed('projects');
  };
  const remove = async (): Promise<void> => {
    close();
    const prev = await op<{ takes: Record<string, number> }>('projects.delete', { project: p.id, preview: true }).catch(() => null);
    const t = prev?.takes ?? {};
    const parts = ['questions', 'claims', 'evidence', 'notes', 'experiments', 'boards', 'manuscripts', 'reviews', 'tasks_open', 'repo_files']
      .filter((k) => (t[k] ?? 0) > 0)
      .map((k) => (k === 'evidence' ? (t[k] ?? 0) + ' evidence' : k === 'tasks_open' ? plural(t[k] ?? 0, 'open task', 'open tasks') : k === 'repo_files' ? plural(t[k] ?? 0, 'repository file', 'repository files') : plural(t[k] ?? 0, k.replace(/s$/, ''), k)));
    if (!(await confirm('Delete "' + p.name + '"' + (parts.length > 0 ? ' and its ' + parts.join(', ') : '') + '? Its papers stay in the library.', 'Delete project', 'Delete'))) return;
    await op('projects.delete', { project: p.id });
    changed('projects');
    navigate('projects');
  };
  const exportNotes = async (): Promise<void> => {
    close();
    const r = await op<NotesExport>('export.notes', { project: p.id });
    download(p.name.replace(/[^\w\- ]+/g, '').trim() + '.zip', await notesZip(r), 'application/zip');
  };
  return (
    <>
      <IconButton ref={btn} icon={MoreHorizontal} label="Project actions" size={24} onClick={() => setOpen((o) => !o)} />
      <Popover open={open} anchor={btn} onClose={close} className="w-56">
        <button type="button" className={menuItem} onClick={() => { close(); setEdit(true); }}>
          <Pencil size={14} /> Rename and question
        </button>
        <button type="button" className={menuItem} onClick={() => void update({ pinned: !p.pinned })}>
          {p.pinned ? <PinOff size={14} /> : <Pin size={14} />} {p.pinned ? 'Unpin' : 'Pin'}
        </button>
        <button type="button" className={menuItem} onClick={() => void update({ confidentiality: p.confidentiality === 'confidential' ? 'normal' : 'confidential' })}>
          {p.confidentiality === 'confidential' ? <LockOpen size={14} /> : <Lock size={14} />} {p.confidentiality === 'confidential' ? 'Let your AI agent in' : 'Make confidential'}
        </button>
        <button type="button" className={menuItem} onClick={() => void exportNotes()}>
          <Download size={14} /> Export notes and boards
        </button>
        <button type="button" className={menuItem} onClick={() => void update({ state: p.state === 'archived' ? 'active' : 'archived' })}>
          {p.state === 'archived' ? <ArchiveRestore size={14} /> : <Archive size={14} />} {p.state === 'archived' ? 'Restore' : 'Archive'}
        </button>
        <div className="my-1 h-px bg-[var(--ro-hair)]" />
        <button type="button" className={cn(menuItem, 'text-[var(--ro-red)]')} onClick={() => void remove()}>
          <Trash2 size={14} /> Delete project
        </button>
      </Popover>
      <EditProject p={p} open={edit} onClose={() => setEdit(false)} />
      {confirmNode}
    </>
  );
}

function EditProject({ p, open, onClose }: { p: Project; open: boolean; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(p.name);
  const [question, setQuestion] = useState(p.question);
  const [description, setDescription] = useState(p.description);
  const [color, setColor] = useState<ProjectColor>(p.color as ProjectColor);
  useEffect(() => {
    if (open) {
      setName(p.name);
      setQuestion(p.question);
      setDescription(p.description);
      setColor(p.color as ProjectColor);
    }
  }, [open, p]);
  const save = async (): Promise<void> => {
    await op('projects.update', { project: p.id, name: name.trim(), question: question.trim(), description: description.trim(), color });
    changed('projects');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Project" icon={Palette} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={name.trim() === ''} onClick={() => void save()}>Save</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Name">
          <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Research question">
          <textarea rows={2} value={question} onChange={(e) => setQuestion(e.target.value)} className={textareaCls} />
        </Field>
        <Field label="Scope">
          <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className={textareaCls} />
        </Field>
        <Field label="Color">
          <ColorPicker value={color} onChange={setColor} />
        </Field>
      </div>
    </Modal>
  );
}

function NewManuscript({ project, open, onClose, onMade }: { project: string; open: boolean; onClose: () => void; onMade: (id: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [outline, setOutline] = useState<'imrad' | 'review' | 'empty'>('imrad');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setTitle('');
  }, [open]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ manuscript: { id: string } }>('ms.create', { project, title: title.trim() || undefined, outline });
      changed('manuscripts', 'ms_blocks');
      onClose();
      onMade(r.manuscript.id);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const OUTLINES: { v: 'imrad' | 'review' | 'empty'; label: string; parts: string[] }[] = [
    { v: 'imrad', label: 'Research article', parts: ['Introduction', 'Methods', 'Results', 'Discussion'] },
    { v: 'review', label: 'Review', parts: ['Introduction', 'Methods', 'Findings', 'Conclusion'] },
    { v: 'empty', label: 'Blank', parts: [] },
  ];
  return (
    <Modal open={open} onClose={onClose} title="New manuscript" icon={FileText} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Start writing</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void save()} className={inputCls} placeholder="Untitled manuscript" />
        </Field>
        <div role="radiogroup" aria-label="Outline" className="grid grid-cols-3 gap-2">
          {OUTLINES.map((o) => (
            <button key={o.v} type="button" role="radio" aria-checked={outline === o.v} onClick={() => setOutline(o.v)} className={cn('flex flex-col gap-1.5 rounded-[var(--ro-r-md)] border p-2.5 text-left transition-colors', outline === o.v ? 'border-[var(--ro-ink)] bg-[var(--ro-card)]' : 'border-[var(--ro-line)] hover:bg-[var(--ro-row)]')}>
              <span className="text-[12px] font-bold">{o.label}</span>
              <span className="flex flex-col gap-1">
                {o.parts.length === 0 ? <span className="h-1.5 w-3/4 rounded-full bg-[var(--ro-row-hover)]" /> : o.parts.map((x) => <span key={x} className="truncate text-[12px] leading-4 text-[var(--ro-muted)]">{x}</span>)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}

function NewReview({ project, question, open, onClose, onMade }: { project: string; question: string; open: boolean; onClose: () => void; onMade: (id: string) => void }): React.JSX.Element {
  const [title, setTitle] = useState('');
  const [q, setQ] = useState(question);
  const [dual, setDual] = useState(true);
  const [agentSeat, setAgentSeat] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) {
      setTitle('');
      setQ(question);
    }
  }, [open, question]);
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ review: { id: string } }>('screen.create', { project, title: title.trim() || undefined, question: q.trim(), dual, blind: true, agent_seat: agentSeat });
      changed('reviews');
      onClose();
      onMade(r.review.id);
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="New systematic review" icon={ListChecks} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} onClick={() => void save()}>Create review</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Title">
          <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} className={inputCls} placeholder="Screening" />
        </Field>
        <Field label="Review question">
          <textarea rows={2} value={q} onChange={(e) => setQ(e.target.value)} className={textareaCls} />
        </Field>
        <div className="flex flex-col divide-y divide-[var(--ro-hair)] rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <label className="flex items-center gap-2 px-3 py-2">
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Two screeners</span>
              <span className="block text-[12px] text-[var(--ro-muted)]">Each record needs two decisions; disagreements become conflicts</span>
            </span>
            <Toggle checked={dual} onChange={setDual} label="Two screeners" />
          </label>
          <label className="flex items-center gap-2 px-3 py-2">
            <Sparkles size={14} className="shrink-0 text-[var(--ro-accent)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold">Your AI agent screens too</span>
              <span className="block text-[12px] text-[var(--ro-muted)]">Its decisions stay hidden until you have decided</span>
            </span>
            <Toggle checked={agentSeat} onChange={setAgentSeat} label="Your AI agent screens too" />
          </label>
        </div>
      </div>
    </Modal>
  );
}

/* -------------------------------------------------------------- overview */

function Overview({ p, recent, kids }: { p: Project; recent: ActivityEntry[]; kids: Children }): React.JSX.Element {
  const add = useAddPapers();
  const ask = useAsk();
  const s = p.stats;
  const graph = useLive((signal) => op<{ nodes: GNode[]; relations: Relation[] }>('graph.map', { project: p.id }, { quiet: true, signal }), READS.graph, [p.id], 300);
  const papers = useLive((signal) => op<{ works: ReadingRow[] }>('projects.works', { project: p.id }, { quiet: true, signal }).then((r) => r.works), ['project_works', 'works', 'files'], [p.id], 300);
  const go = (v: View, extra: Record<string, string | undefined> = {}): void => replaceQuery({ view: v === 'overview' ? undefined : v, ...extra });
  const claims = (graph.data?.nodes ?? []).filter((n) => n.kind === 'claim');
  const questions = (graph.data?.nodes ?? []).filter((n) => n.kind === 'question');
  const proposed = (graph.data?.nodes ?? []).filter((n) => n.status === 'agent_proposed').length + (graph.data?.relations ?? []).filter((r) => r.status === 'agent_proposed').length;
  const statusCounts = { to_read: 0, reading: 0, read: 0, excluded: 0 };
  for (const r of papers.data ?? []) statusCounts[r.status]++;
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 p-4">
      <header className="flex flex-wrap items-start gap-3">
        <div className="min-w-[260px] flex-1">
          <h1 className="text-[15px] font-bold leading-[22px]">{p.name}</h1>
          {p.question !== '' ? <p className="serif mt-1 max-w-[70ch] text-[15px] leading-[22px] text-[var(--ro-ink-2)]">{p.question}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          {p.confidentiality !== 'confidential' && (
            <Button icon={MessageSquareText} onClick={() => ask.open({ scope: 'project', project: p.id, label: 'About ' + p.name })}>
              Ask your AI agent
            </Button>
          )}
          <Button variant="primary" icon={Plus} onClick={() => add.open({ project: p.id })}>
            Add papers
          </Button>
        </div>
      </header>
      <div className="grid grid-cols-2 gap-3 @min-[900px]:grid-cols-4">
        <Panel padded={false}>
          <button type="button" onClick={() => go('papers')} className="flex w-full items-center gap-3 p-3 text-left hover:bg-[var(--ro-row)]">
            <Ring size={64} stroke={8} center={num(s?.papers ?? 0)} sub="" slices={[{ key: 'read', label: 'Read', value: statusCounts.read, color: 'var(--ro-ink-2)' }, { key: 'reading', label: 'Reading', value: statusCounts.reading, color: 'var(--ro-amber)' }, { key: 'to_read', label: 'To read', value: statusCounts.to_read, color: 'var(--ro-accent)' }]} />
            <span className="flex flex-col">
              <span className="text-[13px] font-bold">Papers</span>
              <span className="text-[12px] text-[var(--ro-muted)]">{num(statusCounts.read)} read</span>
              <span className="text-[12px] text-[var(--ro-muted)]">{num(statusCounts.reading)} reading</span>
            </span>
          </button>
        </Panel>
        <MetricCard icon={CircleHelp} label="Questions" n={s?.questions ?? 0} color="var(--ro-kind-question)" onClick={() => go('map')} />
        <MetricCard icon={Lightbulb} label="Claims" n={s?.claims ?? 0} color="var(--ro-kind-claim)" onClick={() => go('map')} extra={<BalanceBar className="mt-1 w-full" supports={s?.supports ?? 0} opposes={s?.opposes ?? 0} />} />
        <MetricCard icon={Quote} label="Evidence" n={s?.evidence ?? 0} color="var(--ro-kind-evidence)" onClick={() => go('map')} extra={<span className="text-[12px] text-[var(--ro-muted)]">{num(s?.highlights ?? 0)} highlights</span>} />
      </div>
      {proposed > 0 && (
        <button type="button" onClick={() => navigate('agent', { tab: 'needs' })} className="flex items-center gap-3 rounded-[var(--ro-r-md)] bg-[var(--ro-dark)] px-4 py-3 text-left text-[var(--ro-on-dark)] hover:bg-[var(--ro-dark-2)]">
          <Sparkles size={16} className="text-[var(--ro-accent)]" />
          <span className="num text-[15px] font-bold">{num(proposed)}</span>
          <span className="min-w-0 flex-1 text-[13px] text-[var(--ro-on-dark-muted)]">claims, evidence and links your AI agent proposed in this project</span>
          <span className="text-[12px] font-semibold">Review</span>
          <ArrowRight size={14} />
        </button>
      )}
      <TodoPanel project={p} />
      <ExperimentsPanel project={p} />
      <div className="grid grid-cols-1 gap-4 @min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <Panel title="Claims" subtitle={claims.length > 0 ? 'How well each is supported' : undefined} actions={claims.length > 0 ? <TextLink onClick={() => go('map')}>Map <ArrowRight size={12} /></TextLink> : undefined}>
          {graph.data === null ? (
            <Skeleton className="h-24" />
          ) : claims.length === 0 ? (
            <Empty compact icon={Lightbulb} title="No claims yet" action={<Button icon={Network} onClick={() => go('map')}>Open the claims map</Button>}>
              Select a passage in the reader and press Backslash.
            </Empty>
          ) : (
            <ul className="flex flex-col">
              {claims
                .slice()
                .sort((a, b) => (b.balance?.supports ?? 0) + (b.balance?.opposes ?? 0) - ((a.balance?.supports ?? 0) + (a.balance?.opposes ?? 0)))
                .slice(0, 8)
                .map((c) => (
                  <li key={c.id}>
                    <button type="button" onClick={() => go('map', { node: c.id })} className="flex w-full items-center gap-3 border-b border-[var(--ro-hair)] py-2 text-left last:border-0 hover:bg-[var(--ro-row)]">
                      <Lightbulb size={14} className="shrink-0" style={{ color: 'var(--ro-kind-claim-text)' }} />
                      <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                        {c.title}
                        {c.status === 'agent_proposed' && <Badge tone="agent" className="ml-1.5">Proposed</Badge>}
                      </span>
                      <span className="flex w-28 shrink-0 flex-col items-end gap-1">
                        <BalanceBar className="w-full" supports={c.balance?.supports ?? 0} opposes={c.balance?.opposes ?? 0} proposed={c.balance?.proposed ?? 0} />
                        <span className="num text-[12px] text-[var(--ro-muted)]">
                          {c.balance?.supports ?? 0} for, {c.balance?.opposes ?? 0} against
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
            </ul>
          )}
          {questions.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--ro-hair)] pt-3">
              {questions.map((q) => (
                <button key={q.id} type="button" onClick={() => go('map', { node: q.id })} className="inline-flex max-w-full items-center gap-1 rounded-[var(--ro-r)] bg-[var(--ro-row)] px-2 py-1 text-left text-[12px] hover:bg-[var(--ro-row-hover)]">
                  <CircleHelp size={12} className="shrink-0" style={{ color: 'var(--ro-kind-question-text)' }} />
                  <span className="truncate">{q.title}</span>
                </button>
              ))}
            </div>
          )}
        </Panel>
        <div className="flex flex-col gap-4">
          <Panel title="Made here">
            <ul className="grid grid-cols-2 gap-2">
              {[
                { label: 'Experiments', n: s?.experiments ?? 0, icon: FlaskConical, v: 'exp' as View },
                { label: 'Boards', n: kids.boards.length, icon: SquareKanban, v: 'board' as View },
                { label: 'Manuscripts', n: kids.manuscripts.length, icon: FileText, v: 'ms' as View },
                { label: 'Reviews', n: kids.reviews.length, icon: ListChecks, v: 'screen' as View },
                { label: 'Notes', n: s?.notes ?? 0, icon: NotebookPen, v: 'notes' as View },
              ].map((x) => (
                <li key={x.label}>
                  <button type="button" onClick={() => go(x.v)} className="flex w-full items-center gap-2 rounded-[var(--ro-r)] border border-[var(--ro-line)] px-2.5 py-2 text-left hover:bg-[var(--ro-row)]">
                    <x.icon size={14} className="text-[var(--ro-muted)]" />
                    <span className="flex-1 text-[12px] font-semibold">{x.label}</span>
                    <span className="num text-[13px] font-bold">{num(x.n)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          <Panel title="Recent">
            {recent.length === 0 ? (
              <Empty compact icon={Sparkles} title="Nothing yet" />
            ) : (
              <ul className="flex flex-col">
                {recent.slice(0, 8).map((a) => (
                  <li key={a.id} className="flex items-start gap-2 border-b border-[var(--ro-hair)] py-1.5 last:border-0">
                    {a.actor === 'agent' ? <AgentMark title="Your AI agent" /> : <span className="mt-1.5 size-1.5 shrink-0 rounded-full bg-[var(--ro-ink-2)]" />}
                    <span className="min-w-0 flex-1 text-[12px] leading-4">{a.label}</span>
                    <span className="shrink-0 text-[12px] text-[var(--ro-muted)]">{ago(a.created)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ icon: Icon, label, n, color, onClick, extra }: { icon: LucideIcon; label: string; n: number; color: string; onClick: () => void; extra?: React.ReactNode }): React.JSX.Element {
  return (
    <Panel padded={false}>
      <button type="button" onClick={onClick} className="flex h-full w-full flex-col gap-1 p-3 text-left hover:bg-[var(--ro-row)]">
        <span className="flex items-center gap-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">
          <Icon size={13} style={{ color }} /> {label}
        </span>
        <span className="num text-[26px] font-bold leading-8">{num(n)}</span>
        {extra}
      </button>
    </Panel>
  );
}

/* ---------------------------------------------------------- reading list */

const STATUS: { v: ReadingRow['status']; label: string }[] = [
  { v: 'to_read', label: 'To read' },
  { v: 'reading', label: 'Reading' },
  { v: 'read', label: 'Read' },
  { v: 'excluded', label: 'Excluded' },
];

function ReadingList({ p }: { p: Project }): React.JSX.Element {
  const add = useAddPapers();
  const menu = useContextMenu();
  const [filter, setFilter] = useState<'' | ReadingRow['status']>('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const list = useLive((signal) => op<{ works: ReadingRow[] }>('projects.works', { project: p.id }, { quiet: true, signal }).then((r) => r.works), ['project_works', 'works', 'files', 'nodes', 'work_tags'], [p.id], 250);
  const rows = (list.data ?? []).filter((r) => filter === '' || r.status === filter);
  const counts = useMemo(() => {
    const c: Record<string, number> = { to_read: 0, reading: 0, read: 0, excluded: 0 };
    for (const r of list.data ?? []) c[r.status] = (c[r.status] ?? 0) + 1;
    return c;
  }, [list.data]);
  const set = async (works: string[], patch: Params): Promise<void> => {
    await op('projects.set-work', { project: p.id, works, ...patch });
    changed('project_works');
  };
  const removeRows = async (works: string[]): Promise<void> => {
    await op('projects.remove-works', { project: p.id, works });
    changed('project_works');
    setSel(new Set());
    toast.success(plural(works.length, 'paper') + ' taken off the reading list');
  };
  const toggle = (id: string): void =>
    setSel((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  return (
    <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center gap-2">
        <h1 className="flex-1 text-[15px] font-bold">Reading list</h1>
        <Button variant="primary" icon={Plus} onClick={() => add.open({ project: p.id })}>
          Add papers
        </Button>
      </header>
      <div className="flex flex-wrap items-center gap-1.5">
        <Filter size={13} className="text-[var(--ro-muted)]" />
        <FilterChip on={filter === ''} onClick={() => setFilter('')} label="All" n={list.data?.length ?? 0} />
        {STATUS.map((s) => (
          <FilterChip key={s.v} on={filter === s.v} onClick={() => setFilter(s.v)} label={s.label} n={counts[s.v] ?? 0} />
        ))}
        {sel.size > 0 && (
          <span className="ml-auto flex items-center gap-1.5">
            <span className="text-[12px] font-semibold">{plural(sel.size, 'selected', 'selected')}</span>
            {STATUS.map((s) => (
              <Button key={s.v} size="sm" onClick={() => void set([...sel], { status: s.v })}>
                {s.label}
              </Button>
            ))}
            <Button size="sm" variant="danger" icon={X} onClick={() => void removeRows([...sel])}>
              Remove
            </Button>
          </span>
        )}
      </div>
      {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
      {list.data === null && list.error === null && <Skeleton className="h-48" />}
      {list.data !== null && list.data.length === 0 && (
        <Empty icon={Library} title="No papers in this project" action={<Button variant="primary" icon={Plus} onClick={() => add.open({ project: p.id })}>Add papers</Button>}>
          Drag papers from the library onto Reading list, or add them here.
        </Empty>
      )}
      {rows.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <table className="ro-table w-full min-w-[720px]">
            <thead>
              <tr>
                <th className="w-8">
                  <input type="checkbox" aria-label="Select all" checked={sel.size > 0 && sel.size === rows.length} onChange={(e) => setSel(e.target.checked ? new Set(rows.map((r) => r.work.id)) : new Set())} />
                </th>
                <th>Paper</th>
                <th className="w-28">Status</th>
                <th className="w-28">Role</th>
                <th className="w-24 text-right">From it</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.link}
                  draggable
                  onDragStart={(e) => {
                    e.dataTransfer.setData(DRAG_WORKS, JSON.stringify([r.work.id]));
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  onDoubleClick={() => openPaper(r.work)}
                  onContextMenu={(e) =>
                    menu(e, [
                      { label: r.work.file ? 'Read' : 'Open', icon: BookOpenText, onClick: () => openPaper(r.work) },
                      ...STATUS.map((s) => ({ label: 'Mark ' + s.label.toLowerCase(), onClick: () => void set([r.work.id], { status: s.v }) })),
                      { label: r.role === 'core' ? 'Make background' : 'Make core', onClick: () => void set([r.work.id], { role: r.role === 'core' ? 'background' : 'core' }) },
                      { label: 'Remove from the project', icon: X, danger: true, onClick: () => void removeRows([r.work.id]) },
                    ])
                  }
                  className={cn(sel.has(r.work.id) && 'ro-selected', r.status === 'excluded' && 'opacity-60')}
                >
                  <td>
                    <input type="checkbox" aria-label={'Select ' + r.work.title} checked={sel.has(r.work.id)} onChange={() => toggle(r.work.id)} />
                  </td>
                  <td>
                    <button type="button" onClick={() => openPaper(r.work)} className="flex w-full items-center gap-2.5 text-left">
                      <Cover work={r.work} width={28} />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-1.5">
                          <ReadDot state={r.work.read_state} />
                          <span className="truncate text-[13px] font-semibold">{r.work.title}</span>
                          <PaperState work={r.work} />
                        </span>
                        <span className="block truncate text-[12px] text-[var(--ro-muted)]">{byline(r.work)}</span>
                      </span>
                    </button>
                  </td>
                  <td>
                    <StatusPicker value={r.status} onChange={(v) => void set([r.work.id], { status: v })} />
                  </td>
                  <td>
                    <button type="button" onClick={() => void set([r.work.id], { role: r.role === 'core' ? 'background' : 'core' })} title={r.role === 'core' ? 'Core to the question (click for background)' : 'Background reading (click for core)'} className={cn('inline-flex h-6 items-center rounded-[var(--ro-r-sm)] px-2 text-[12px] font-semibold', r.role === 'core' ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
                      {r.role === 'core' ? 'Core' : 'Background'}
                    </button>
                  </td>
                  <td className="num text-right text-[12px]">
                    {r.project_nodes > 0 ? (
                      <span className="inline-flex items-center gap-1">
                        <Lightbulb size={12} className="text-[var(--ro-muted)]" />
                        {r.project_nodes}
                        {r.project_proposed > 0 && <Badge tone="agent">{r.project_proposed}</Badge>}
                      </span>
                    ) : (
                      <span className="text-[var(--ro-muted)]">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function FilterChip({ on, onClick, label, n }: { on: boolean; onClick: () => void; label: string; n: number }): React.JSX.Element {
  return (
    <button type="button" onClick={onClick} className={cn('inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r)] px-2 text-[12px] font-semibold transition-colors', on ? 'ro-on-ink bg-[var(--ro-ink)] text-[var(--ro-shell)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)] hover:bg-[var(--ro-row-hover)]')}>
      {label} <span className="num opacity-70">{n}</span>
    </button>
  );
}

const STATUS_COLOR: Record<string, string> = { to_read: 'var(--ro-accent)', reading: 'var(--ro-amber)', read: 'var(--ro-ink-2)', excluded: 'var(--ro-muted)' };

function StatusPicker({ value, onChange }: { value: ReadingRow['status']; onChange: (v: ReadingRow['status']) => void }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <button ref={btn} type="button" onClick={() => setOpen((o) => !o)} className="inline-flex h-6 items-center gap-1.5 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold hover:bg-[var(--ro-row)]">
        <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[value] }} />
        {STATUS.find((s) => s.v === value)?.label}
      </button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} className="w-36">
        {STATUS.map((s) => (
          <button
            key={s.v}
            type="button"
            className={menuItem}
            onClick={() => {
              setOpen(false);
              onChange(s.v);
            }}
          >
            <span className="size-2 rounded-full" style={{ background: STATUS_COLOR[s.v] }} /> {s.label}
          </button>
        ))}
      </Popover>
    </>
  );
}
