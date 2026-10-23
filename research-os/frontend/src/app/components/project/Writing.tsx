/**
 * The writing desk: the manuscript in the middle, its outline on the left,
 * and on the right what a careful author checks before sending it out:
 * the sources it cites (and whether each can be cited), the ready checks,
 * your AI agent's proposed changes, how much of the text came from where
 * (and the disclosure statement that follows), snapshots, and the reviews
 * received with a response to each comment.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { AlertTriangle, BadgeCheck, BookOpenText, Camera, Check, CheckCheck, CircleAlert, ClipboardCopy, Download, FileText, History, Lightbulb, ListTree, MessageSquareQuote, MessagesSquare, PenLine, Plus, Quote, RotateCcw, ScrollText, ShieldCheck, Sparkles, Trash2, Undo2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, op, opUrl } from '../../lib/api.ts';
import type { DocxParagraph } from '../../lib/docx.ts';
import { changed, useLive } from '../../lib/live.ts';
import { ago, clip, plural, shortDate } from '../../lib/format.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { GNode, Project, WorkRow } from '../../lib/types.ts';
import { askAgent, RequestStatus } from '../agent.tsx';
import { openPaper } from '../paper.tsx';
import { Badge, Button, Empty, Field, IconButton, LoadError, Modal, Popover, Segmented, Select, Spinner, Tabs, inputCls, menuItem, textareaCls, useConfirm } from '../ui.tsx';
import { BLOCK_KINDS, CitePicker, DRAG_NODE, Editor, focusBlock, goToBlock, MdLine, SegText } from './Editor.tsx';
import type { Block, BuildIssue, Change, Num, Rendered, Seg } from './Editor.tsx';
import type { FigureFile } from './Figure.tsx';
import { exportZip, fileBase, LatexSettings, PdfPane, toastBuilding, useBuild, useBuildKey, VENUES, type Author } from './Pdf.tsx';
import { KIND_ICON } from './ClaimsMap.tsx';
import type { ReadingRow } from '../../pages/Project.tsx';

interface Ms {
  id: string;
  project: string;
  title: string;
  style: string;
  template: string;
  status: 'draft' | 'ready';
  words: number;
  authors: Author[];
  /** Your own LaTeX preamble ('' follows the venue). */
  preamble: string;
  style_folder: string;
  ready_at: string;
  updated: string;
}

interface MsData {
  manuscript: Ms;
  blocks: Block[];
  rendered: Record<string, (Rendered | null)[]>;
  bibliography: { work: string; n: number; suffix: string; text: string; md: string; html: string }[];
  sources: WorkRow[];
  claims: Record<string, { id: string; title: string; kind: string; status: string }>;
  changes: Change[];
  checks: { code: string; title: string; blocking: boolean; acknowledgeable?: boolean; work?: string; node?: string; block?: string }[];
  shares: { sections: { title: string; typed: number; pasted: number; agent: number }[]; total: { typed: number; pasted: number; agent: number } };
  disclosure: { template: string; place: string; text: string; measured: { typed: number; pasted: number; agent: number; characters: number } };
  marks: { record: string; field: string; confidence: string; reason: string }[];
  numbers: Record<string, Num>;
  figures: Record<string, FigureFile | null>;
}

const STYLES = [
  { value: 'apa', label: 'APA 7' },
  { value: 'chicago', label: 'Chicago (author-date)' },
  { value: 'harvard', label: 'Harvard' },
  { value: 'mla', label: 'MLA 9' },
  { value: 'ieee', label: 'IEEE' },
  { value: 'vancouver', label: 'Vancouver' },
  { value: 'nature', label: 'Nature' },
];

type SideTab = 'sources' | 'check' | 'changes' | 'ai' | 'history' | 'reviews';

export function Writing({ project, msId }: { project: Project; msId: string }): React.JSX.Element {
  if (msId === '') return <NoManuscript project={project} />;
  return <Desk key={msId} project={project} msId={msId} />;
}

function NoManuscript({ project }: { project: Project }): React.JSX.Element {
  const make = async (): Promise<void> => {
    const r = await op<{ manuscript: { id: string } }>('ms.create', { project: project.id, outline: 'imrad' });
    changed('manuscripts', 'ms_blocks');
    replaceQuery({ view: 'ms', ms: r.manuscript.id });
  };
  return (
    <div className="flex flex-1 items-center justify-center p-6">
      <Empty icon={FileText} title="Nothing written yet" action={<Button variant="primary" icon={Plus} onClick={() => void make()}>New manuscript</Button>}>
        Write with live citations from your library; every source is checked before you send it.
      </Empty>
    </div>
  );
}

function Desk({ project, msId }: { project: Project; msId: string }): React.JSX.Element {
  const g = useLive((signal) => op<MsData>('ms.get', { manuscript: msId }, { quiet: true, signal }), ['manuscripts', 'ms_blocks', 'ms_changes', 'works', 'nodes', 'field_marks'], [msId], 250);
  const reading = useLive((signal) => op<{ works: ReadingRow[] }>('projects.works', { project: project.id }, { quiet: true, signal }).then((r) => r.works.map((x) => x.work)), ['project_works', 'works'], [project.id], 400);
  const [tab, setTab] = useState<SideTab>('sources');
  const [pick, setPick] = useState<{ at: DOMRect; marker: HTMLElement; block: string } | null>(null);
  const [chip, setChip] = useState<{ el: HTMLElement; block: string } | null>(null);
  const [draft, setDraft] = useState(false);
  const [request, setRequest] = useState('');
  const [outline, setOutline] = useState(true);
  const [pdf, setPdfOpen] = useState(() => {
    try {
      return localStorage.getItem('ro_ms_pdf') === '1';
    } catch {
      return false;
    }
  });
  const [settings, setSettings] = useState(false);
  const build = useBuild(msId, pdf);
  const showPdf = (open: boolean): void => {
    setPdfOpen(open);
    try {
      localStorage.setItem('ro_ms_pdf', open ? '1' : '0');
    } catch {
      /* a convenience */
    }
  };
  const buildNow = (): void => {
    showPdf(true);
    if (build.state?.build?.status !== 'running') void build.start();
  };
  useBuildKey(buildNow);
  // What the latest build said about each block (shown while the PDF is open).
  const issues = useMemo(() => {
    const by: Record<string, BuildIssue[]> = {};
    if (!pdf || build.state?.build?.status === 'running') return by;
    for (const e of build.state?.build?.errors ?? []) if (e.block !== undefined) (by[e.block] ??= []).push(e);
    return by;
  }, [pdf, build.state]);
  const labels = useMemo(() => {
    const m = new Map<string, WorkRow>();
    for (const w of reading.data ?? []) m.set(w.id, w);
    for (const w of g.data?.sources ?? []) m.set(w.id, w);
    return m;
  }, [reading.data, g.data?.sources]);
  if (g.error !== null) return <div className="p-4"><LoadError message={g.error} onRetry={g.reload} /></div>;
  if (g.data === null) return <div className="flex flex-1 items-center justify-center"><Spinner size={20} /></div>;
  const d = g.data;
  const m = d.manuscript;
  const update = async (patch: Record<string, unknown>): Promise<void> => {
    await op('ms.update', { manuscript: m.id, ...patch });
    changed('manuscripts');
  };
  const blocking = d.checks.filter((c) => c.blocking).length;
  /** Where a block is, in words: "Figure 2", or "Paragraph in Results". */
  const where = (id: string): string => {
    const i = d.blocks.findIndex((b) => b.id === id);
    const b = d.blocks[i];
    if (b === undefined) return 'A block no longer here';
    const num = d.numbers[id];
    if (num !== undefined && num.kind !== 'section') return num.label;
    const kind = BLOCK_KINDS.find((k) => k.type === b.type)?.label ?? 'Text';
    const head = [...d.blocks.slice(0, i + 1)].reverse().find((x) => x.type === 'h1');
    const name = head?.content.filter((s): s is Extract<Seg, { t: 'text' }> => s.t === 'text').map((s) => s.v).join('') ?? '';
    return (b.type === 'paragraph' ? 'Paragraph' : kind) + (head !== undefined && head.id !== b.id && name !== '' ? ' in ' + name : '');
  };
  const sideCount: Partial<Record<SideTab, number>> = { check: d.checks.length, changes: d.changes.length };
  const heads = d.blocks.filter((b) => b.type === 'h1' || b.type === 'h2' || b.type === 'h3');
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-[var(--ro-line)] bg-[var(--ro-card)] px-3 py-2">
        <IconButton icon={ListTree} label="Outline" active={outline} onClick={() => setOutline((o) => !o)} className="hidden @min-[1100px]:inline-flex" />
        <span className="min-w-0 max-w-[260px] truncate text-[13px] font-bold">{m.title}</span>
        <Badge tone={m.status === 'ready' ? 'good' : 'neutral'}>{m.status === 'ready' ? 'Ready' : 'Draft'}</Badge>
        <span className="num text-[12px] text-[var(--ro-muted)]">{plural(m.words, 'word')}</span>
        <span className="flex-1" />
        {request !== '' && <RequestStatus id={request} />}
        <Select ariaLabel="Citation style" className="w-44" value={m.style} onChange={(v) => void update({ style: v })} options={STYLES} />
        {project.confidentiality !== 'confidential' && <AskMenu onDraft={() => setDraft(true)} onCheck={() => void askAgent('support_check_requested', { manuscript: m.id }, 'Asked your AI agent to check each citation against its source').then((id) => id !== '' && setRequest(id))} />}
        <Button size="sm" icon={FileText} aria-pressed={pdf} onClick={() => showPdf(!pdf)} className={cn(pdf && 'bg-[var(--ro-row-hover)]')} title="The manuscript as a PDF, typeset with LaTeX">
          PDF
        </Button>
        <ExportMenu ms={m} pdf={build.state} onBuild={buildNow} />
        <ReadyButton m={m} blocking={blocking} onShowChecks={() => setTab('check')} />
      </div>
      <div className="relative flex min-h-0 flex-1">
        {outline && (
          <nav aria-label="Outline" className="hidden w-52 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-[var(--ro-line)] bg-[var(--ro-card)] p-2 @min-[1100px]:flex">
            <span className="px-2 pb-1 pt-1 text-[12px] font-bold text-[var(--ro-muted)]">Outline</span>
            {heads.length === 0 && <span className="px-2 text-[12px] text-[var(--ro-muted)]">No headings</span>}
            {heads.map((h) => (
              <button key={h.id} type="button" onClick={() => { document.querySelector(`[data-block="${h.id}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); focusBlock(h.id); }} className={cn('truncate rounded-[var(--ro-r-sm)] px-2 py-1 text-left text-[12px] hover:bg-[var(--ro-row)]', h.type === 'h1' ? 'font-semibold' : h.type === 'h2' ? 'pl-4 text-[var(--ro-ink-2)]' : 'pl-6 text-[var(--ro-muted)]')}>
                {h.content.filter((s): s is Extract<Seg, { t: 'text' }> => s.t === 'text').map((s) => s.v).join('') || 'Untitled section'}
              </button>
            ))}
          </nav>
        )}
        <div data-scroll className="min-h-0 flex-1 overflow-y-auto bg-[var(--ro-card)]">
          <Editor
            ms={m.id}
            project={project.id}
            title={m.title}
            blocks={d.blocks}
            rendered={d.rendered}
            claims={d.claims}
            changes={d.changes}
            labels={labels}
            bibliography={d.bibliography}
            numbers={d.numbers}
            figures={d.figures}
            issues={issues}
            onTitle={(t) => void update({ title: t })}
            onCitePick={setPick}
            onChip={(el, block) => setChip({ el, block })}
          />
        </div>
        {pdf && (
          <PdfPane
            ms={m.id}
            title={m.title}
            state={build.state}
            start={build.start}
            starting={build.starting}
            where={where}
            onClose={() => showPdf(false)}
            onSettings={() => setSettings(true)}
            onGoTo={goToBlock}
            className="absolute inset-0 z-20 @min-[900px]:static @min-[900px]:z-auto @min-[900px]:w-[46%] @min-[900px]:min-w-[380px] @min-[900px]:max-w-[920px] @min-[900px]:shrink-0"
          />
        )}
        <aside className={cn('hidden w-[360px] shrink-0 flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)]', !pdf && '@min-[900px]:flex')}>
          <Tabs
            label="Panel"
            value={tab}
            onChange={setTab}
            className="shrink-0 gap-2.5 overflow-x-auto px-2"
            options={(
              [
                { value: 'sources', label: 'Sources' },
                { value: 'check', label: 'Check' },
                { value: 'changes', label: 'Changes' },
                { value: 'ai', label: 'AI use' },
                { value: 'history', label: 'History' },
                { value: 'reviews', label: 'Reviews' },
              ] as { value: SideTab; label: string }[]
            ).map((o) => ({ value: o.value, label: sideCount[o.value] ? <span className="inline-flex items-center gap-1">{o.label}<span className={cn('num rounded-full px-1.5 text-[12px]', o.value === 'check' && blocking > 0 ? 'bg-[var(--ro-red)] text-[var(--ro-on-red)]' : 'bg-[var(--ro-accent-soft)] text-[var(--ro-accent-text)]')}>{sideCount[o.value]}</span></span> : o.label }))}
          />
          <div data-scroll className="min-h-0 flex-1 overflow-y-auto p-3">
            {tab === 'sources' && <SourcesPanel d={d} project={project} />}
            {tab === 'check' && <CheckPanel d={d} />}
            {tab === 'changes' && <ChangesPanel d={d} labels={labels} />}
            {tab === 'ai' && <AiPanel d={d} onVenue={(v) => void update({ template: v })} />}
            {tab === 'history' && <HistoryPanel ms={m.id} />}
            {tab === 'reviews' && <ReviewsPanel ms={m.id} blocks={d.blocks} canAsk={project.confidentiality !== 'confidential'} />}
          </div>
        </aside>
      </div>
      {pick !== null && <CitePicker at={pick.at} marker={pick.marker} block={pick.block} works={[...(reading.data ?? [])].sort((a, b) => Number(b.citable) - Number(a.citable))} onClose={() => setPick(null)} />}
      {chip !== null && <ChipPopover chip={chip} labels={labels} claims={d.claims} project={project.id} onClose={() => setChip(null)} />}
      <DraftDialog open={draft} onClose={() => setDraft(false)} ms={m.id} onSent={setRequest} />
      <LatexSettings open={settings} onClose={() => setSettings(false)} ms={m.id} project={project.id} template={m.template} authors={m.authors} preamble={m.preamble} />
    </div>
  );
}

/* ----------------------------------------------------------- toolbar */

function AskMenu({ onDraft, onCheck }: { onDraft: () => void; onCheck: () => void }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button ref={btn} size="sm" icon={Sparkles} onClick={() => setOpen((o) => !o)}>
        Your AI agent
      </Button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} align="right" className="w-72">
        <button type="button" className={menuItem} onClick={() => { setOpen(false); onDraft(); }}>
          <PenLine size={14} /> Draft a passage from your claims and sources
        </button>
        <button type="button" className={menuItem} onClick={() => { setOpen(false); onCheck(); }}>
          <ShieldCheck size={14} /> Check each citation against its source
        </button>
      </Popover>
    </>
  );
}

function ExportMenu({ ms, pdf, onBuild }: { ms: Ms; pdf: ReturnType<typeof useBuild>['state']; onBuild: () => void }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const base = fileBase(ms.title);
  const run = async (format: 'latex' | 'markdown' | 'docx' | 'text'): Promise<void> => {
    setOpen(false);
    try {
      if (format === 'docx') {
        const r = await op<{ title: string; paragraphs: DocxParagraph[] }>('ms.export', { manuscript: ms.id, format });
        const { docx, docxMedia } = await import('../../lib/docx.ts');
        download(base + '.docx', docx(r.title, r.paragraphs, await docxMedia(r.paragraphs)), 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
        return;
      }
      if (format === 'text') {
        const r = await op<{ files: { path: string; content: string }[] }>('ms.export', { manuscript: ms.id, format });
        if (r.files[0]) download(base + '.txt', r.files[0].content);
        return;
      }
      download(base + (format === 'latex' ? '-latex' : '-markdown') + '.zip', await exportZip(ms.id, format), 'application/zip');
    } catch {
      /* toasted */
    }
  };
  // The PDF as it is now: the latest build when nothing changed since, otherwise a new build first.
  const pdfNow = (): void => {
    setOpen(false);
    const b = pdf?.build;
    if (b !== undefined && b !== null && b.status === 'done' && b.has_pdf && pdf?.current === true) {
      const a = document.createElement('a');
      a.href = opUrl('ms.pdf', { build: b.id, download: true });
      a.rel = 'noopener';
      document.body.appendChild(a);
      a.click();
      a.remove();
      return;
    }
    onBuild();
    toastBuilding();
  };
  return (
    <>
      <Button ref={btn} size="sm" icon={Download} onClick={() => setOpen((o) => !o)}>
        Export
      </Button>
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} align="right" className="w-64">
        <button type="button" className={menuItem} onClick={pdfNow}>
          <FileText size={14} /> PDF (typeset with LaTeX)
        </button>
        <button type="button" className={menuItem} onClick={() => void run('docx')}>
          <FileText size={14} /> Word (.docx)
        </button>
        <button type="button" className={menuItem} onClick={() => void run('latex')}>
          <ScrollText size={14} /> LaTeX source with figures (.zip)
        </button>
        <button type="button" className={menuItem} onClick={() => void run('markdown')}>
          <ScrollText size={14} /> Markdown with figures (.zip)
        </button>
        <button type="button" className={menuItem} onClick={() => void run('text')}>
          <FileText size={14} /> Plain text
        </button>
      </Popover>
    </>
  );
}

function ReadyButton({ m, blocking, onShowChecks }: { m: Ms; blocking: number; onShowChecks: () => void }): React.JSX.Element {
  const [confirmNode, confirm] = useConfirm();
  const ready = async (ack = false): Promise<void> => {
    try {
      await op('ms.set-status', { manuscript: m.id, status: 'ready', acknowledge_retracted: ack || undefined }, { quiet: true });
      changed('manuscripts');
      toast.success('Marked ready');
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (code === 'cites_retracted' && (await confirm('This manuscript cites a retracted paper. Mark it ready anyway, knowing that?', 'Cites a retracted paper', 'Mark ready'))) return ready(true);
      onShowChecks();
      toast.error((err as Error).message);
    }
  };
  if (m.status === 'ready')
    return (
      <Button size="sm" icon={RotateCcw} onClick={() => void op('ms.set-status', { manuscript: m.id, status: 'draft' }).then(() => changed('manuscripts'))}>
        Back to draft
      </Button>
    );
  return (
    <>
      <Button size="sm" variant="primary" icon={BadgeCheck} onClick={() => (blocking > 0 ? onShowChecks() : void ready())} title={blocking > 0 ? plural(blocking, 'thing') + ' to fix first' : 'Every source resolved and confirmed'}>
        Mark ready
      </Button>
      {confirmNode}
    </>
  );
}

function DraftDialog({ open, onClose, ms, onSent }: { open: boolean; onClose: () => void; ms: string; onSent: (id: string) => void }): React.JSX.Element {
  const [brief, setBrief] = useState('');
  useEffect(() => {
    if (open) setBrief('');
  }, [open]);
  const send = async (): Promise<void> => {
    const id = await askAgent('draft_requested', { manuscript: ms, brief: brief.trim() }, 'Asked your AI agent for a draft; it arrives as changes to keep or undo');
    if (id !== '') onSent(id);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Draft with your AI agent" icon={PenLine} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Sparkles} disabled={brief.trim() === ''} onClick={() => void send()}>Ask for a draft</Button></>}>
      <Field label="What to draft">
        <textarea autoFocus rows={4} value={brief} onChange={(e) => setBrief(e.target.value)} className={textareaCls} placeholder="A related-work paragraph on preference fine-tuning, from the confirmed claims" />
      </Field>
      <p className="mt-2 flex items-start gap-1.5 text-[12px] leading-4 text-[var(--ro-muted)]">
        <Sparkles size={12} className="mt-0.5 shrink-0" /> It can cite only papers whose identifiers resolved, and every sentence it writes waits for your Keep.
      </p>
    </Modal>
  );
}

function ChipPopover({ chip, labels, claims, project, onClose }: { chip: { el: HTMLElement; block: string }; labels: Map<string, WorkRow>; claims: MsData['claims']; project: string; onClose: () => void }): React.JSX.Element {
  const el = chip.el;
  const isCite = el.dataset['works'] !== undefined;
  const [works, setWorks] = useState<string[]>(isCite ? (el.dataset['works'] ?? '').split(',').filter((x) => x !== '') : []);
  const [locator, setLocator] = useState(el.dataset['locator'] ?? '');
  const r = el.getBoundingClientRect();
  const ref = useRef<HTMLDivElement | null>(null);
  const commit = (): void => {
    const block = document.querySelector<HTMLElement>(`[data-block="${chip.block}"]`);
    block?.dispatchEvent(new Event('input', { bubbles: true }));
  };
  useEffect(() => {
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node) && e.target !== el) onClose();
    };
    const t = setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose, el]);
  const removeChip = (): void => {
    el.remove();
    commit();
    onClose();
  };
  const claim = !isCite ? claims[el.dataset['claim'] ?? ''] : undefined;
  return (
    <div ref={ref} style={{ position: 'fixed', left: Math.max(8, Math.min(window.innerWidth - 320, r.left)), top: r.bottom + 6 }} className="ro-pop z-50 flex w-[300px] flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-2.5 shadow-[var(--ro-shadow)]">
      {isCite ? (
        <>
          <span className="text-[12px] font-bold text-[var(--ro-muted)]">Citation</span>
          <ul className="flex flex-col gap-1">
            {works.map((id) => {
              const w = labels.get(id);
              return (
                <li key={id} className="flex items-start gap-1.5">
                  <button type="button" onClick={() => w && openPaper(w)} className="min-w-0 flex-1 text-left">
                    <span className="block text-[12px] font-semibold">{w?.label ?? 'Source'}</span>
                    <span className="line-clamp-2 text-[12px] leading-4 text-[var(--ro-muted)]">{w?.title}</span>
                  </button>
                  {works.length > 1 && (
                    <IconButton
                      icon={X}
                      label="Take this paper out"
                      size={22}
                      variant="danger"
                      onClick={() => {
                        const next = works.filter((x) => x !== id);
                        setWorks(next);
                        el.dataset['works'] = next.join(',');
                        commit();
                      }}
                    />
                  )}
                </li>
              );
            })}
          </ul>
          <input
            value={locator}
            onChange={(e) => setLocator(e.target.value)}
            onBlur={() => {
              el.dataset['locator'] = locator.trim();
              commit();
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            placeholder="Page or section (p. 4)"
            aria-label="Page or section"
            className={inputCls}
          />
        </>
      ) : (
        <>
          <span className="flex items-center gap-1.5 text-[12px] font-bold" style={{ color: 'var(--ro-kind-claim-text)' }}>
            <Lightbulb size={12} /> Linked claim
          </span>
          <span className="text-[13px] font-semibold leading-[18px]">{claim?.title ?? 'A claim that was deleted'}</span>
          {claim?.status === 'agent_proposed' && <Badge tone="agent">Still a proposal</Badge>}
          {claim !== undefined && (
            <Button size="sm" icon={Lightbulb} onClick={() => navigate('project', { id: project, view: 'map', node: claim.id })}>
              Open in the claims map
            </Button>
          )}
        </>
      )}
      <div className="flex justify-end border-t border-[var(--ro-hair)] pt-2">
        <Button size="sm" variant="danger" icon={Trash2} onClick={removeChip}>
          Remove
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- panels */

function Section({ title, icon: Icon, children, actions }: { title: string; icon: LucideIcon; children: React.ReactNode; actions?: React.ReactNode }): React.JSX.Element {
  return (
    <section className="mb-4 flex flex-col gap-2">
      <span className="flex items-center gap-1.5 text-[12px] font-bold text-[var(--ro-ink-2)]">
        <Icon size={13} className="text-[var(--ro-muted)]" /> <span className="flex-1">{title}</span>
        {actions}
      </span>
      {children}
    </section>
  );
}

function SourcesPanel({ d, project }: { d: MsData; project: Project }): React.JSX.Element {
  const nodes = useLive((signal) => op<{ nodes: GNode[] }>('nodes.list', { project: project.id, passages: false, limit: 1000 }, { quiet: true, signal }).then((r) => r.nodes.filter((n) => n.kind !== 'question' && n.status !== 'researcher_rejected')), ['nodes'], [project.id], 300);
  const byId = new Map(d.sources.map((w) => [w.id, w]));
  return (
    <>
      <Section title={plural(d.bibliography.length, 'source') + ' cited'} icon={BookOpenText}>
        {d.bibliography.length === 0 ? (
          <p className="text-[12px] text-[var(--ro-muted)]">Type @ in the text to cite a paper.</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {d.bibliography.map((e) => {
              const w = byId.get(e.work);
              const bad = w === undefined || !w.citable || w.trashed;
              return (
                <li key={e.work}>
                  <button type="button" onClick={() => w && openPaper(w)} className={cn('flex w-full items-start gap-2 rounded-[var(--ro-r)] px-1.5 py-1 text-left hover:bg-[var(--ro-row)]', bad && 'bg-[var(--ro-red)]/8')}>
                    {e.n > 0 && <span className="num w-5 shrink-0 pt-0.5 text-right text-[12px] font-bold text-[var(--ro-muted)]">{e.n}</span>}
                    <span className="serif min-w-0 flex-1 text-[12px] leading-[17px]">
                      <MdLine md={e.md} />
                    </span>
                    {w?.integrity === 'retracted' && <CircleAlert size={13} className="mt-0.5 shrink-0 text-[var(--ro-red)]" aria-label="Retracted" />}
                    {w?.identity === 'agent_proposed' && <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[var(--ro-amber)]" aria-label="Identification to confirm" />}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Claims and evidence" icon={Lightbulb}>
        {nodes.data === null ? (
          <Spinner />
        ) : nodes.data.length === 0 ? (
          <p className="text-[12px] text-[var(--ro-muted)]">None in this project yet.</p>
        ) : (
          <ul className="flex flex-col">
            {nodes.data.map((n) => {
              const Icon = KIND_ICON[n.kind];
              return (
                <li key={n.id}>
                  <div
                    draggable
                    onDragStart={(e) => {
                      e.dataTransfer.setData(DRAG_NODE, JSON.stringify({ node: n.id, kind: n.kind, work: n.work, citable: n.work !== '' }));
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    title="Drag into a sentence to cite and link it"
                    className="flex cursor-grab items-start gap-2 rounded-[var(--ro-r)] px-1.5 py-1 hover:bg-[var(--ro-row)] active:cursor-grabbing"
                  >
                    <Icon size={13} className="mt-0.5 shrink-0" style={{ color: `var(--ro-kind-${n.kind}-text)` }} />
                    <span className="min-w-0 flex-1">
                      <span className="line-clamp-2 text-[12px] leading-4">{n.title}</span>
                      {n.work_label !== '' && <span className="block truncate text-[12px] text-[var(--ro-muted)]">{n.work_label}</span>}
                    </span>
                    {n.status === 'agent_proposed' && <Sparkles size={11} className="mt-1 shrink-0 text-[var(--ro-accent)]" aria-label="Proposed" />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
    </>
  );
}

function CheckPanel({ d }: { d: MsData }): React.JSX.Element {
  if (d.checks.length === 0)
    return (
      <div className="flex flex-col items-center gap-2 py-8 text-center">
        <span className="flex size-10 items-center justify-center rounded-full bg-[var(--ro-green)]/15 text-[var(--ro-green-text)]">
          <CheckCheck size={18} />
        </span>
        <span className="text-[13px] font-bold">Nothing stands in the way</span>
        <span className="text-[12px] text-[var(--ro-muted)]">Every cited paper resolved, confirmed and not retracted</span>
      </div>
    );
  return (
    <ul className="flex flex-col gap-1.5">
      {d.checks.map((c, i) => (
        <li key={i} className={cn('flex items-start gap-2 rounded-[var(--ro-r)] border px-2.5 py-2', c.blocking ? 'border-[var(--ro-red)]/40 bg-[var(--ro-red)]/6' : 'border-[var(--ro-amber)]/40 bg-[var(--ro-amber)]/8')}>
          {c.blocking ? <CircleAlert size={14} className="mt-0.5 shrink-0 text-[var(--ro-red)]" /> : <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--ro-amber)]" />}
          <span className="min-w-0 flex-1 text-[12px] leading-4">{c.title}</span>
          {c.work !== undefined && c.work !== '' && (
            <button type="button" onClick={() => navigate('paper', { id: c.work })} className="shrink-0 text-[12px] font-semibold underline-offset-2 hover:underline">
              Open
            </button>
          )}
          {c.block !== undefined && c.block !== '' && (
            <button type="button" onClick={() => goToBlock(c.block as string)} className="shrink-0 text-[12px] font-semibold underline-offset-2 hover:underline">
              Go to
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function ChangesPanel({ d, labels }: { d: MsData; labels: Map<string, WorkRow> }): React.JSX.Element {
  const act = async (which: 'ms.keep' | 'ms.undo', ids: string[]): Promise<void> => {
    const r = await op<{ stale?: string[] }>(which, { changes: ids });
    if ((r.stale ?? []).length > 0) toast.error(plural(r.stale?.length ?? 0, 'suggestion') + ' set aside: the paragraph changed since');
    changed('ms_changes', 'ms_blocks', 'manuscripts');
  };
  if (d.changes.length === 0) return <Empty compact icon={Sparkles} title="No changes waiting" />;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex gap-1.5">
        <Button size="sm" icon={Check} onClick={() => void act('ms.keep', d.changes.map((c) => c.id))}>
          Keep all {d.changes.length}
        </Button>
        <Button size="sm" variant="ghost" icon={Undo2} onClick={() => void act('ms.undo', d.changes.map((c) => c.id))}>
          Undo all
        </Button>
      </div>
      {d.changes.map((c) => (
        <button key={c.id} type="button" onClick={() => document.querySelector(`[data-block="${c.block || c.after_block}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })} className="flex flex-col gap-1 rounded-[var(--ro-r)] border border-dashed border-[var(--ro-accent)] p-2 text-left hover:bg-[var(--ro-row)]">
          <span className="text-[12px] font-bold text-[var(--ro-accent-text)]">{c.kind === 'insert' ? 'Add' : c.kind === 'replace' ? 'Reword' : 'Remove'}</span>
          <span className="line-clamp-3 text-[12px] leading-4">
            <SegText segs={(c.after ?? c.before)?.content ?? []} labels={labels} numbers={d.numbers} />
          </span>
          <span className="text-[12px] text-[var(--ro-muted)]">{ago(c.created)}</span>
        </button>
      ))}
    </div>
  );
}

function AiPanel({ d, onVenue }: { d: MsData; onVenue: (v: string) => void }): React.JSX.Element {
  const m = d.disclosure.measured;
  const bar = [
    { k: 'typed', label: 'Typed', v: m.typed, color: 'var(--ro-ink-2)' },
    { k: 'pasted', label: 'Pasted', v: m.pasted, color: 'var(--ro-amber)' },
    { k: 'agent', label: 'From your AI agent', v: m.agent, color: 'var(--ro-accent)' },
  ];
  return (
    <>
      <Section title="Where the text came from" icon={MessageSquareQuote}>
        <div className="flex h-2.5 overflow-hidden rounded-full bg-[var(--ro-row)]">
          {bar.map((b) => (b.v > 0 ? <span key={b.k} style={{ width: b.v + '%', background: b.color }} /> : null))}
        </div>
        <ul className="flex flex-col gap-1">
          {bar.map((b) => (
            <li key={b.k} className="flex items-center gap-2 text-[12px]">
              <span className="size-2 rounded-full" style={{ background: b.color }} />
              <span className="flex-1">{b.label}</span>
              <span className="num font-bold">{b.v}%</span>
            </li>
          ))}
        </ul>
        {d.shares.sections.length > 1 && (
          <ul className="mt-1 flex flex-col gap-1 border-t border-[var(--ro-hair)] pt-2">
            {d.shares.sections.map((s) => {
              const all = Math.max(1, s.typed + s.pasted + s.agent);
              return (
                <li key={s.title} className="flex items-center gap-2 text-[12px]">
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                  <span className="flex h-1.5 w-20 overflow-hidden rounded-full bg-[var(--ro-row)]">
                    <span style={{ width: (100 * s.typed) / all + '%', background: 'var(--ro-ink-2)' }} />
                    <span style={{ width: (100 * s.pasted) / all + '%', background: 'var(--ro-amber)' }} />
                    <span style={{ width: (100 * s.agent) / all + '%', background: 'var(--ro-accent)' }} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </Section>
      <Section title="Disclosure statement" icon={ScrollText} actions={<IconButton icon={ClipboardCopy} label="Copy" size={22} onClick={() => void navigator.clipboard.writeText(d.disclosure.text).then(() => toast.success('Copied'))} />}>
        <Select ariaLabel="Venue" value={d.disclosure.template} onChange={onVenue} options={VENUES} />
        <p className="text-[12px] leading-4 text-[var(--ro-muted)]">Goes in {d.disclosure.place}.</p>
        <p className="serif rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] p-2.5 text-[13px] leading-5">{d.disclosure.text}</p>
      </Section>
    </>
  );
}

function HistoryPanel({ ms }: { ms: string }): React.JSX.Element {
  const list = useLive((signal) => op<{ snapshots: { id: string; label: string; words: number; actor: string; created: string }[] }>('ms.snapshots', { manuscript: ms }, { quiet: true, signal }).then((r) => r.snapshots), ['ms_snapshots'], [ms], 200);
  const [label, setLabel] = useState('');
  const [confirmNode, confirm] = useConfirm();
  const save = async (): Promise<void> => {
    await op('ms.snapshot', { manuscript: ms, label: label.trim() || undefined });
    setLabel('');
    changed('ms_snapshots');
    toast.success('Snapshot saved');
  };
  return (
    <>
      <form className="mb-3 flex gap-1.5" onSubmit={(e) => { e.preventDefault(); void save(); }}>
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label (Sent to co-authors)" aria-label="Snapshot label" className={inputCls} />
        <Button size="sm" icon={Camera} onClick={() => void save()}>
          Save
        </Button>
      </form>
      {list.data === null ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty compact icon={History} title="No snapshots yet" />
      ) : (
        <ul className="flex flex-col">
          {list.data.map((s) => (
            <li key={s.id} className="group flex items-center gap-2 border-b border-[var(--ro-hair)] py-1.5 last:border-0">
              <History size={13} className="shrink-0 text-[var(--ro-muted)]" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-semibold">{s.label || 'Snapshot'}</span>
                <span className="block text-[12px] text-[var(--ro-muted)]">
                  {shortDate(s.created)} · {plural(s.words, 'word')}
                </span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                icon={RotateCcw}
                onClick={async () => {
                  if (!(await confirm('Go back to "' + (s.label || 'this snapshot') + '"? The current text is saved as a snapshot first.', 'Restore', 'Restore'))) return;
                  await op('ms.restore', { snapshot: s.id });
                  changed('ms_blocks', 'ms_snapshots', 'manuscripts', 'ms_changes');
                }}
              >
                Restore
              </Button>
            </li>
          ))}
        </ul>
      )}
      {confirmNode}
    </>
  );
}

interface ReviewItem {
  id: string;
  comment: string;
  kind: string;
  strategy: string;
  status: string;
  response: string;
  change_block: string;
  change_text: string;
  change_note: string;
  actor: string;
  confirmed: boolean;
}

function ReviewsPanel({ ms, blocks, canAsk }: { ms: string; blocks: Block[]; canAsk: boolean }): React.JSX.Element {
  const list = useLive((signal) => op<{ reviews: { id: string; label: string; body: string; received_on: string; items: ReviewItem[] }[] }>('responses.list', { manuscript: ms }, { quiet: true, signal }).then((r) => r.reviews), ['reviews_received', 'response_items', 'ms_blocks'], [ms], 200);
  const [adding, setAdding] = useState(false);
  const [req, setReq] = useState('');
  const letter = async (): Promise<void> => {
    const r = await op<{ filename: string; content: string }>('responses.letter', { manuscript: ms });
    download(r.filename, r.content, 'text/markdown;charset=utf-8');
  };
  return (
    <>
      <div className="mb-3 flex gap-1.5">
        <Button size="sm" icon={Plus} onClick={() => setAdding(true)}>
          Paste a review
        </Button>
        {(list.data ?? []).length > 0 && (
          <Button size="sm" variant="ghost" icon={Download} onClick={() => void letter()}>
            Response letter
          </Button>
        )}
      </div>
      {req !== '' && <RequestStatus id={req} className="mb-2" />}
      {list.data === null ? (
        <Spinner />
      ) : list.data.length === 0 ? (
        <Empty compact icon={MessagesSquare} title="No reviews yet" />
      ) : (
        list.data.map((r) => (
          <section key={r.id} className="mb-4 flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <span className="flex-1 text-[13px] font-bold">{r.label}</span>
              {canAsk && r.items.length === 0 && (
                <Button size="sm" icon={Sparkles} onClick={() => void askAgent('responses_requested', { review: r.id }, 'Asked your AI agent to split the review into comments').then((id) => id !== '' && setReq(id))}>
                  Split into comments
                </Button>
              )}
            </div>
            {r.items.length === 0 && <p className="line-clamp-4 whitespace-pre-wrap text-[12px] leading-4 text-[var(--ro-muted)]">{r.body}</p>}
            {r.items.map((it, i) => (
              <ReviewItemRow key={it.id} it={it} n={i + 1} blocks={blocks} />
            ))}
          </section>
        ))
      )}
      <AddReview open={adding} ms={ms} onClose={() => setAdding(false)} />
    </>
  );
}

const STATUS_TONE: Record<string, 'good' | 'warn' | 'neutral' | 'bad'> = { open: 'warn', addressed: 'good', declined: 'neutral', unresolved: 'bad' };

function ReviewItemRow({ it, n, blocks }: { it: ReviewItem; n: number; blocks: Block[] }): React.JSX.Element {
  const [response, setResponse] = useState(it.response);
  const btn = useRef<HTMLButtonElement | null>(null);
  const [linking, setLinking] = useState(false);
  useEffect(() => setResponse(it.response), [it.response]);
  const save = async (patch: Record<string, unknown>): Promise<void> => {
    try {
      await op('responses.update', { item: it.id, ...patch });
      changed('response_items');
    } catch {
      /* toasted */
    }
  };
  return (
    <div className={cn('flex flex-col gap-1.5 rounded-[var(--ro-r)] border p-2', it.actor === 'agent' && !it.confirmed ? 'border-dashed border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}>
      <span className="flex items-center gap-1.5">
        <span className="num text-[12px] font-bold text-[var(--ro-muted)]">{n}</span>
        <Badge tone={it.kind === 'major' ? 'bad' : it.kind === 'praise' ? 'good' : 'neutral'}>{it.kind}</Badge>
        <span className="flex-1" />
        <Badge tone={STATUS_TONE[it.status] ?? 'neutral'}>{it.status}</Badge>
      </span>
      <p className="text-[12px] leading-4">{it.comment}</p>
      <Segmented label="Strategy" size="sm" value={it.strategy || 'accept'} onChange={(v) => void save({ strategy: v })} options={[{ value: 'accept', label: 'Accept' }, { value: 'clarify', label: 'Clarify' }, { value: 'defend', label: 'Defend' }, { value: 'experiment', label: 'New work' }]} />
      <textarea rows={2} value={response} onChange={(e) => setResponse(e.target.value)} onBlur={() => response !== it.response && void save({ response })} placeholder="Your response" className={textareaCls} aria-label="Response" />
      <span className="flex flex-wrap items-center gap-1.5">
        <Button ref={btn} size="sm" variant="ghost" icon={Quote} onClick={() => setLinking((o) => !o)}>
          {it.change_block !== '' ? clip(it.change_text || 'Linked paragraph', 28) : 'Link the change'}
        </Button>
        <span className="flex-1" />
        {it.status !== 'addressed' ? (
          <Button size="sm" icon={Check} disabled={it.change_block === ''} title={it.change_block === '' ? 'Link the paragraph you changed first' : 'Mark addressed'} onClick={() => void save({ status: 'addressed' })}>
            Addressed
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => void save({ status: 'open' })}>
            Reopen
          </Button>
        )}
      </span>
      <Popover open={linking} anchor={btn} onClose={() => setLinking(false)} className="max-h-72 w-72 overflow-y-auto">
        {blocks
          .filter((b) => b.content.length > 0)
          .map((b) => (
            <button key={b.id} type="button" className={cn(menuItem, 'items-start')} onClick={() => { setLinking(false); void save({ change_block: b.id }); }}>
              <span className="line-clamp-2 text-left text-[12px] leading-4">{b.content.filter((s): s is Extract<Seg, { t: 'text' }> => s.t === 'text').map((s) => s.v).join('') || 'A paragraph with citations'}</span>
            </button>
          ))}
      </Popover>
    </div>
  );
}

function AddReview({ open, ms, onClose }: { open: boolean; ms: string; onClose: () => void }): React.JSX.Element {
  const [label, setLabel] = useState('');
  const [body, setBody] = useState('');
  useEffect(() => {
    if (open) {
      setLabel('');
      setBody('');
    }
  }, [open]);
  const save = async (): Promise<void> => {
    await op('responses.add-review', { manuscript: ms, label: label.trim() || undefined, body });
    changed('reviews_received');
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="A review received" icon={MessagesSquare} wide footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={body.trim() === ''} onClick={() => void save()}>Add review</Button></>}>
      <div className="flex flex-col gap-3">
        <Field label="Reviewer">
          <input autoFocus value={label} onChange={(e) => setLabel(e.target.value)} className={inputCls} placeholder="Reviewer 2" />
        </Field>
        <Field label="The review">
          <textarea rows={10} value={body} onChange={(e) => setBody(e.target.value)} className={textareaCls} />
        </Field>
      </div>
    </Modal>
  );
}

