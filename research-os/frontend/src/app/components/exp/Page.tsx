/**
 * One experiment: a notebook page with its journal beside it.
 *
 *   Top bar      Experiments / EXP-003 (one click back to all of them),
 *                previous and next, the status buttons (Start, Pause, Resume,
 *                Finish, Reopen), Bench mode, Run again, your AI agent, more
 *   Header       title, status and outcome, kind, dates, tags, what it repeats
 *   Sections     Objective, Design (variables and materials), Protocol (steps
 *                ticked off with their time, timed steps, a note per step),
 *                Runs, Results, Conclusion; a bar that follows the scroll
 *   Journal      on the right (a drawer on narrow screens)
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookOpenText, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, CircleHelp, Download, FlaskConical, Lightbulb, Link2, ListOrdered, Maximize2, MessageSquarePlus, MoreHorizontal, NotebookPen, Package, Pause, Play, Plus, Repeat2, RotateCcw, Sparkles, Square, Target, Timer, Trash2, X } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { download, op } from '../../lib/api.ts';
import { changed, useLive } from '../../lib/live.ts';
import { ago, clip, plural } from '../../lib/format.ts';
import { navigate, replaceQuery } from '../../lib/router.ts';
import type { ExpEntry, ExpKind, ExpMaterial, ExpOutcome, ExpRun, ExpStatus, ExpStep, ExpVariable, Experiment, GNode, Project, VarRole, VarType } from '../../lib/types.ts';
import { askAgent, RequestStatus } from '../agent.tsx';
import { Button, Field, IconButton, LoadError, Modal, Popover, Spinner, inputCls, menuItem, textareaCls, useConfirm } from '../ui.tsx';
import type { ReadingRow } from '../../pages/Project.tsx';
import { Bench } from './Bench.tsx';
import { Journal, LOG } from './Journal.tsx';
import { ResultsSection, RunsSection } from './Runs.tsx';
import { clock, dayLabel, KIND, newId, OUTCOME, OutcomeFlag, parseAt, saveExp, saving, span, StatusChip, useNow } from './shared.tsx';

const SECTIONS: { id: string; label: string }[] = [
  { id: 'objective', label: 'Objective' },
  { id: 'design', label: 'Design' },
  { id: 'protocol', label: 'Protocol' },
  { id: 'runs', label: 'Runs' },
  { id: 'results', label: 'Results' },
  { id: 'conclusion', label: 'Conclusion' },
];

/** Local copy of a list from the server, refreshed when the server's changes (our own saves come back the same). */
function useSynced<T>(server: T, id: string): [T, React.Dispatch<React.SetStateAction<T>>] {
  const [local, setLocal] = useState(server);
  const last = useRef(JSON.stringify(server));
  useEffect(() => {
    const s = JSON.stringify(server);
    // A copy from between two of this page's saves is older than what is typed: wait for the last one.
    if (s !== last.current && !saving(id)) {
      last.current = s;
      setLocal(server);
    }
  }, [server, id]);
  return [local, setLocal];
}

export function ExperimentPage({ project, id }: { project: Project; id: string }): React.JSX.Element {
  const x = useLive((signal) => op<{ experiment: Experiment }>('exp.get', { experiment: id }, { quiet: true, signal }).then((r) => r.experiment), ['experiments', 'exp_runs', 'exp_log', 'nodes', 'works'], [id], 100);
  const siblings = useLive((signal) => op<{ experiments: Experiment[] }>('exp.list', { project: project.id }, { quiet: true, signal }).then((r) => r.experiments.map((e) => ({ id: e.id, code: e.code }))), ['experiments'], [project.id], 300);
  const journal = useLive((signal) => op<{ entries: ExpEntry[]; total: number }>('exp.entries', { experiment: id }, { quiet: true, signal }), ['exp_log'], [id], 100);
  const runsLive = useLive((signal) => op<{ runs: ExpRun[] }>('exp.runs', { experiment: id }, { quiet: true, signal }).then((r) => r.runs), ['exp_runs'], [id], 100);
  const [runs, setRuns] = useState<ExpRun[] | null>(null);
  useEffect(() => {
    if (runsLive.data !== null) setRuns(runsLive.data);
  }, [runsLive.data]);
  const [bench, setBench] = useState(false);
  const [drawer, setDrawer] = useState(false);
  const scroller = useRef<HTMLDivElement | null>(null);
  const [active, setActive] = useState('objective');
  useEffect(() => {
    const root = scroller.current;
    if (root === null) return;
    const io = new IntersectionObserver(
      (items) => {
        const seen = items.filter((i) => i.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (seen) setActive(seen.target.id.replace('sec-', ''));
      },
      { root, rootMargin: '-80px 0px -60% 0px' },
    );
    for (const s of SECTIONS) {
      const el = document.getElementById('sec-' + s.id);
      if (el) io.observe(el);
    }
    return () => io.disconnect();
  }, [x.data !== null]);
  const goTo = (sec: string): void => document.getElementById('sec-' + sec)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  const flash = (el: Element | null): void => {
    if (el === null) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.classList.add('ro-flash');
    window.setTimeout(() => el.classList.remove('ro-flash'), 1600);
  };
  const jump = (ref: { kind: 'step' | 'run'; id: string }): void => {
    setDrawer(false);
    flash(document.getElementById((ref.kind === 'step' ? 'step-' : 'run-') + ref.id));
  };
  if (x.error !== null)
    return (
      <div className="p-4">
        <LoadError message={x.error} onRetry={x.reload} />
      </div>
    );
  if (x.data === null)
    return (
      <div className="flex flex-1 items-center justify-center">
        <Spinner size={20} />
      </div>
    );
  const e = x.data;
  const sib = siblings.data ?? [];
  const at = sib.findIndex((s) => s.id === e.id);
  const prev = at > 0 ? sib[at - 1] : undefined;
  const next = at >= 0 && at < sib.length - 1 ? sib[at + 1] : undefined;
  const entries = journal.data?.entries ?? null;
  const journalNode = <Journal e={e} entries={entries} total={journal.data?.total ?? 0} error={journal.error} reload={journal.reload} runs={runs ?? []} onJump={jump} />;
  return (
    <div className="relative flex min-h-0 flex-1">
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar e={e} project={project} prev={prev} next={next} onBench={() => setBench(true)} onJournal={() => setDrawer(true)} onFinished={() => window.setTimeout(() => goTo('conclusion'), 200)} />
        <div ref={scroller} data-scroll className="min-h-0 flex-1 overflow-y-auto bg-[var(--ro-stage)]">
          <div className="mx-auto flex w-full max-w-[1000px] flex-col gap-3 p-4">
            <Header e={e} />
            <nav aria-label="Sections" className="sticky top-0 z-[5] -mx-1 flex gap-1 overflow-x-auto rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-1 shadow-[var(--ro-shadow-sm)]">
              {SECTIONS.map((s) => (
                <button key={s.id} type="button" onClick={() => goTo(s.id)} aria-current={active === s.id ? 'true' : undefined} className={cn('inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--ro-r-sm)] px-2.5 text-[12px] font-semibold', active === s.id ? 'bg-[var(--ro-row-hover)] text-[var(--ro-ink)]' : 'text-[var(--ro-muted)] hover:text-[var(--ro-ink)]')}>
                  {s.label}
                  {s.id === 'protocol' && e.counts.steps > 0 && <span className="num font-normal">{e.counts.steps_done}/{e.counts.steps}</span>}
                  {s.id === 'runs' && e.counts.runs > 0 && <span className="num font-normal">{e.counts.done}/{e.counts.runs}</span>}
                  {s.id === 'conclusion' && e.outcome !== '' && <span className="size-1.5 rounded-full" style={{ background: OUTCOME[e.outcome].text }} />}
                </button>
              ))}
            </nav>
            <article className="flex flex-col rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
              <Sec id="objective" title="Objective" hint="What you want to find out, and what you expect">
                <Objective e={e} />
              </Sec>
              <Sec id="design" title="Design" hint="What you vary, what you keep the same, what you measure">
                <Variables e={e} />
                <Materials e={e} />
                <Tests e={e} project={project} />
              </Sec>
              <Sec
                id="protocol"
                title="Protocol"
                hint={e.counts.steps > 0 ? `${e.counts.steps_done} of ${e.counts.steps} steps done` : 'The steps, in order'}
                actions={
                  e.counts.steps > 0 && (
                    <Button size="sm" icon={Maximize2} onClick={() => setBench(true)}>
                      Bench mode
                    </Button>
                  )
                }
              >
                <Protocol e={e} entries={entries ?? []} />
              </Sec>
              <Sec id="runs" title="Runs" hint="One row per trial, sample, participant or simulation">
                <RunsSection e={e} runs={runs} onRuns={(fn) => setRuns((rs) => fn(rs ?? []))} reload={runsLive.reload} />
              </Sec>
              <Sec id="results" title="Results" hint="Every measure, by group">
                <ResultsSection e={e} />
              </Sec>
              <Sec id="conclusion" title="Conclusion" hint="The outcome, what the data show, and what to do next" last>
                <Conclusion e={e} secret={project.confidentiality === 'confidential'} />
              </Sec>
            </article>
          </div>
        </div>
      </div>
      <aside className="hidden w-[380px] shrink-0 flex-col border-l border-[var(--ro-line)] bg-[var(--ro-card)] @min-[1100px]:flex">{journalNode}</aside>
      {drawer && (
        <div className="absolute inset-0 z-30 flex justify-end bg-black/30 @min-[1100px]:hidden" onClick={() => setDrawer(false)}>
          <div className="flex h-full w-full max-w-[420px] flex-col bg-[var(--ro-card)] shadow-[var(--ro-shadow)]" onClick={(ev) => ev.stopPropagation()}>
            <div className="flex justify-end border-b border-[var(--ro-hair)] p-1">
              <IconButton icon={X} label="Close the journal" onClick={() => setDrawer(false)} />
            </div>
            {journalNode}
          </div>
        </div>
      )}
      {bench && <Bench e={e} runs={runs ?? []} entries={entries ?? []} onClose={() => setBench(false)} />}
    </div>
  );
}

function Sec({ id, title, hint, actions, last = false, children }: { id: string; title: string; hint?: string; actions?: React.ReactNode; last?: boolean; children: React.ReactNode }): React.JSX.Element {
  return (
    <section id={'sec-' + id} className={cn('flex scroll-mt-14 flex-col gap-3 px-5 py-5', !last && 'border-b border-[var(--ro-line)]')}>
      <header className="flex flex-wrap items-baseline gap-2">
        <h2 className="text-[15px] font-bold">{title}</h2>
        {hint !== undefined && <span className="text-[12px] text-[var(--ro-muted)]">{hint}</span>}
        <span className="flex-1" />
        {actions}
      </header>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------- top bar */

function TopBar({ e, project, prev, next, onBench, onJournal, onFinished }: { e: Experiment; project: Project; prev: { id: string; code: string } | undefined; next: { id: string; code: string } | undefined; onBench: () => void; onJournal: () => void; onFinished: () => void }): React.JSX.Element {
  const [request, setRequest] = useState('');
  const [tplOpen, setTplOpen] = useState(false);
  const [confirmNode, confirm] = useConfirm();
  const askBtn = useRef<HTMLButtonElement | null>(null);
  const moreBtn = useRef<HTMLButtonElement | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const status = async (s: ExpStatus): Promise<void> => {
    const r = await saveExp(e.id, { status: s });
    if (r !== null && s === 'done') {
      toast.success(e.code + ' finished. Set its outcome in the Conclusion.');
      onFinished();
    }
  };
  const again = async (): Promise<void> => {
    try {
      const r = await op<{ experiment: Experiment }>('exp.repeat', { experiment: e.id });
      changed('experiments', 'exp_log', 'projects');
      toast.success('Planned ' + r.experiment.code + ', a repeat of ' + e.code);
      replaceQuery({ exp: r.experiment.id });
    } catch {
      /* toasted */
    }
  };
  const ask = (what: 'plan' | 'analyze'): void => {
    setAskOpen(false);
    void askAgent('experiment_requested', { experiment: e.id, ask: what }, what === 'plan' ? 'Asked your AI agent to plan the experiment' : 'Asked your AI agent to analyze the runs').then((rid) => rid !== '' && setRequest(rid));
  };
  const close = (fn: () => void): (() => void) => () => {
    setMoreOpen(false);
    fn();
  };
  const remove = async (): Promise<void> => {
    const pre = await op<{ takes: { runs: number; log: number } }>('exp.delete', { experiment: e.id, preview: true }).catch(() => null);
    const t = pre?.takes ?? { runs: 0, log: 0 };
    if (!(await confirm(`Delete ${e.code} "${clip(e.title, 60)}" with ${plural(t.runs, 'run')} and ${plural(t.log, 'journal entry', 'journal entries')}? Files in the journal go too. This cannot be undone.`, 'Delete experiment', 'Delete'))) return;
    await op('exp.delete', { experiment: e.id });
    changed('experiments', 'projects');
    replaceQuery({ exp: undefined });
  };
  const exportCsv = async (): Promise<void> => {
    const r = await op<{ filename: string; content: string }>('exp.export', { experiment: e.id });
    download(r.filename, r.content, 'text/csv;charset=utf-8');
  };
  const secret = project.confidentiality === 'confidential';
  const benchable = e.counts.steps > 0 || e.counts.runs > 0;
  // On a phone the secondary actions shrink to icons and "Run again" moves into the menu.
  const bar = useRef<HTMLDivElement | null>(null);
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const el = bar.current;
    if (el === null) return;
    const ro = new ResizeObserver((en) => setNarrow((en[0]?.contentRect.width ?? 1000) < 640));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={bar} className="flex shrink-0 flex-col border-b border-[var(--ro-line)] bg-[var(--ro-card)]">
      <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
        <button type="button" onClick={() => replaceQuery({ exp: undefined })} className="inline-flex h-7 items-center gap-1.5 rounded-[var(--ro-r-sm)] px-1.5 text-[13px] font-semibold text-[var(--ro-ink-2)] hover:bg-[var(--ro-row)] hover:text-[var(--ro-ink)]">
          <FlaskConical size={14} /> Experiments
        </button>
        <span className="text-[var(--ro-line)]">/</span>
        <span className="num text-[13px] font-semibold">{e.code}</span>
        <IconButton icon={ChevronLeft} label={prev ? 'Previous: ' + prev.code : 'No previous experiment'} size={26} disabled={!prev} onClick={() => prev && replaceQuery({ exp: prev.id })} />
        <IconButton icon={ChevronRight} label={next ? 'Next: ' + next.code : 'No next experiment'} size={26} disabled={!next} onClick={() => next && replaceQuery({ exp: next.id })} />
        <span className="flex-1" />
        {e.status === 'planned' && (
          <Button variant="primary" icon={Play} onClick={() => void status('running')}>
            Start
          </Button>
        )}
        {e.status === 'running' && (
          <>
            <Button icon={Pause} onClick={() => void status('paused')}>
              Pause
            </Button>
            <Button variant="primary" icon={Square} onClick={() => void status('done')}>
              Finish
            </Button>
          </>
        )}
        {e.status === 'paused' && (
          <>
            <Button variant="primary" icon={Play} onClick={() => void status('running')}>
              Resume
            </Button>
            <Button icon={Square} onClick={() => void status('done')}>
              Finish
            </Button>
          </>
        )}
        {(e.status === 'done' || e.status === 'cancelled') && (
          <Button icon={RotateCcw} onClick={() => void status('running')}>
            Reopen
          </Button>
        )}
        {narrow ? (
          <IconButton icon={Maximize2} label="Bench mode" variant="secondary" onClick={onBench} disabled={!benchable} />
        ) : (
          <>
            <Button icon={Maximize2} onClick={onBench} disabled={!benchable} title="One step at a time, big, with timers and quick data entry">
              Bench mode
            </Button>
            {e.status !== 'planned' && (
              <Button icon={Repeat2} onClick={() => void again()} title="A new experiment with the same plan and protocol">
                Run again
              </Button>
            )}
          </>
        )}
        {!secret && <IconButton ref={askBtn} icon={Sparkles} label="Your AI agent" variant="secondary" onClick={() => setAskOpen((o) => !o)} />}
        <IconButton ref={moreBtn} icon={MoreHorizontal} label="More" variant="secondary" onClick={() => setMoreOpen((o) => !o)} />
        <span className="contents @min-[1100px]:hidden">
          <IconButton icon={NotebookPen} label="Journal" variant="secondary" onClick={onJournal} />
        </span>
      </div>
      {request !== '' && (
        <div className="px-3 pb-2">
          <RequestStatus id={request} />
        </div>
      )}
      <Popover open={askOpen} anchor={askBtn} onClose={() => setAskOpen(false)} align="right" className="w-72 p-1">
        <button type="button" className={cn(menuItem, 'h-auto items-start py-1.5')} onClick={() => ask('plan')}>
          <ListOrdered size={13} className="mt-0.5" />
          <span>
            <span className="block font-semibold">Plan this experiment</span>
            <span className="block text-[12px] font-normal text-[var(--ro-muted)]">Hypothesis, variables, protocol and materials, from your aim and papers</span>
          </span>
        </button>
        <button type="button" className={cn(menuItem, 'h-auto items-start py-1.5')} onClick={() => ask('analyze')}>
          <Target size={13} className="mt-0.5" />
          <span>
            <span className="block font-semibold">Analyze the results</span>
            <span className="block text-[12px] font-normal text-[var(--ro-muted)]">An outcome and conclusion from the runs and the journal, for you to keep</span>
          </span>
        </button>
      </Popover>
      <Popover open={moreOpen} anchor={moreBtn} onClose={() => setMoreOpen(false)} align="right" className="w-60 p-1">
        {narrow && e.status !== 'planned' && (
          <button type="button" className={menuItem} onClick={close(() => void again())}>
            <Repeat2 size={13} /> Run it again
          </button>
        )}
        <button type="button" className={menuItem} onClick={close(() => setTplOpen(true))}>
          <BookOpenText size={13} /> Save as a template
        </button>
        <button type="button" className={menuItem} onClick={close(() => void exportCsv())} disabled={e.counts.runs === 0}>
          <Download size={13} /> Export the runs (CSV)
        </button>
        {(e.status === 'planned' || e.status === 'running' || e.status === 'paused') && (
          <button type="button" className={menuItem} onClick={close(() => void status('cancelled'))}>
            <X size={13} /> Cancel the experiment
          </button>
        )}
        {e.status !== 'planned' && (
          <button type="button" className={menuItem} onClick={close(() => void status('planned'))}>
            <RotateCcw size={13} /> Back to planned
          </button>
        )}
        <button type="button" className={cn(menuItem, 'text-[var(--ro-red-text)]')} onClick={close(() => void remove())}>
          <Trash2 size={13} /> Delete the experiment
        </button>
      </Popover>
      <SaveTemplate e={e} open={tplOpen} onClose={() => setTplOpen(false)} />
      {confirmNode}
    </div>
  );
}

function SaveTemplate({ e, open, onClose }: { e: Experiment; open: boolean; onClose: () => void }): React.JSX.Element {
  const [name, setName] = useState(e.title);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setName(e.title.replace(/ \(repeat\)$/, ''));
  }, [open, e.title]);
  const go = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('exp.save-template', { experiment: e.id, name: name.trim() });
      changed('exp_templates');
      toast.success('Saved "' + name.trim() + '" as a template');
      onClose();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal open={open} onClose={onClose} title="Save as a template" icon={BookOpenText} description="The objective, design, materials and protocol, ready to start a new experiment in any project. Runs, journal and conclusion stay here." footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" loading={busy} disabled={name.trim() === ''} onClick={() => void go()}>Save template</Button></>}>
      <Field label="Template name">
        <input autoFocus value={name} onChange={(ev) => setName(ev.target.value)} onKeyDown={(ev) => ev.key === 'Enter' && name.trim() !== '' && void go()} className={inputCls} />
      </Field>
    </Modal>
  );
}

/* ---------------------------------------------------------------- header */

function Header({ e }: { e: Experiment }): React.JSX.Element {
  const [title, setTitle] = useState(e.title);
  useEffect(() => setTitle(e.title), [e.title]);
  const [tag, setTag] = useState('');
  const kindBtn = useRef<HTMLButtonElement | null>(null);
  const [kindOpen, setKindOpen] = useState(false);
  const now = useNow(30000);
  const K = KIND[e.kind];
  const addTag = (): void => {
    const t = tag.trim().toLowerCase();
    setTag('');
    if (t !== '' && !e.tags.includes(t)) void saveExp(e.id, { tags: [...e.tags, t] });
  };
  const started = e.started_at !== '' ? parseAt(e.started_at) : null;
  const ended = e.ended_at !== '' ? parseAt(e.ended_at) : null;
  return (
    <header className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] px-5 py-4">
      <div className="flex flex-col">
        <span className="num text-[12px] font-semibold tracking-wide text-[var(--ro-muted)]">{e.code}</span>
        <textarea
          rows={1}
          value={title}
          onChange={(ev) => setTitle(ev.target.value.replace(/\n/g, ' '))}
          onBlur={() => title.trim() !== '' && title.trim() !== e.title && void saveExp(e.id, { title: title.trim() })}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') {
              ev.preventDefault();
              (ev.target as HTMLTextAreaElement).blur();
            }
          }}
          aria-label="Title"
          className="w-full min-w-0 resize-none rounded-[var(--ro-r-sm)] bg-transparent py-0.5 text-[26px] font-bold leading-8 outline-none [field-sizing:content] focus:bg-[var(--ro-row)]"
        />
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-[var(--ro-ink-2)]">
        <StatusChip status={e.status} />
        <OutcomeFlag outcome={e.outcome} />
        <button ref={kindBtn} type="button" onClick={() => setKindOpen((o) => !o)} className="inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-1 font-semibold hover:bg-[var(--ro-row)]">
          <K.icon size={13} /> {K.label}
        </button>
        {e.status === 'planned' ? (
          <span className="inline-flex flex-wrap items-center gap-1.5">
            <span className="text-[var(--ro-muted)]">Planned</span>
            <input type="date" value={e.planned_start} onChange={(ev) => void saveExp(e.id, { planned_start: ev.target.value })} aria-label="Planned start" className={cn(inputCls, 'h-6 w-[136px] px-1 text-[12px]')} />
            <span className="text-[var(--ro-muted)]">to</span>
            <input type="date" value={e.planned_end} min={e.planned_start || undefined} onChange={(ev) => void saveExp(e.id, { planned_end: ev.target.value })} aria-label="Planned end" className={cn(inputCls, 'h-6 w-[136px] px-1 text-[12px]')} />
          </span>
        ) : (
          started !== null && (
            <span className="num">
              Started {dayLabel(started)} {clock(e.started_at)}
              {ended !== null ? ', ended ' + dayLabel(ended) + ' ' + clock(e.ended_at) + ' (ran ' + span(ended.getTime() - started.getTime()) + ')' : ', ' + (e.status === 'paused' ? 'paused at ' : 'running for ') + span(now - started.getTime())}
            </span>
          )
        )}
        {e.parent !== null && (
          <button type="button" onClick={() => e.parent && replaceQuery({ exp: e.parent.id })} className="inline-flex items-center gap-1 font-semibold hover:text-[var(--ro-ink)]">
            <Repeat2 size={12} /> Repeat of {e.parent.code}
          </button>
        )}
        {e.repeats.length > 0 && (
          <span className="inline-flex flex-wrap items-center gap-1">
            <Repeat2 size={12} /> Repeated as
            {e.repeats.map((r) => (
              <button key={r.id} type="button" onClick={() => replaceQuery({ exp: r.id })} className="num font-semibold hover:text-[var(--ro-ink)]">
                {r.code}
              </button>
            ))}
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {e.tags.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-0.5 rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] pl-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)]">
            #{t}
            <button type="button" aria-label={'Remove ' + t} onClick={() => void saveExp(e.id, { tags: e.tags.filter((x) => x !== t) })} className="rounded-[3px] p-0.5 hover:bg-[var(--ro-row-hover)]">
              <X size={10} />
            </button>
          </span>
        ))}
        <input
          value={tag}
          onChange={(ev) => setTag(ev.target.value)}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter' || ev.key === ',') {
              ev.preventDefault();
              addTag();
            }
          }}
          onBlur={addTag}
          placeholder="Add a tag"
          aria-label="Add a tag"
          className="h-6 w-28 bg-transparent text-[12px] outline-none"
        />
        <span className="flex-1" />
        <span className="num text-[12px] text-[var(--ro-muted)]">
          {[e.counts.steps > 0 ? e.counts.steps_done + '/' + e.counts.steps + ' steps' : '', e.counts.runs > 0 ? e.counts.done + '/' + e.counts.runs + ' runs' : '', plural(e.counts.log, 'journal entry', 'journal entries') + (e.last_log !== '' ? ', last ' + ago(e.last_log) : '')].filter(Boolean).join(' · ')}
        </span>
      </div>
      <Popover open={kindOpen} anchor={kindBtn} onClose={() => setKindOpen(false)} className="w-56 p-1">
        {(Object.keys(KIND) as ExpKind[]).map((k) => {
          const I = KIND[k].icon;
          return (
            <button
              key={k}
              type="button"
              className={cn(menuItem, e.kind === k && 'bg-[var(--ro-row)]')}
              onClick={() => {
                setKindOpen(false);
                void saveExp(e.id, { kind: k });
              }}
            >
              <I size={13} /> {KIND[k].label}
            </button>
          );
        })}
      </Popover>
    </header>
  );
}

/* ------------------------------------------------------------- objective */

const proseCls = 'w-full resize-none rounded-[var(--ro-r)] border border-transparent bg-transparent px-2 py-1.5 text-[13px] leading-5 outline-none [field-sizing:content] hover:bg-[var(--ro-row)] focus:border-[var(--ro-line)] focus:bg-[var(--ro-shell)]';

function Objective({ e }: { e: Experiment }): React.JSX.Element {
  const [aim, setAim] = useState(e.aim);
  const [hyp, setHyp] = useState(e.hypothesis);
  useEffect(() => setAim(e.aim), [e.aim]);
  useEffect(() => setHyp(e.hypothesis), [e.hypothesis]);
  return (
    <div className="grid grid-cols-1 gap-3 @min-[760px]:grid-cols-2">
      <label className="flex flex-col gap-1">
        <span className="px-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">Aim</span>
        <textarea rows={2} value={aim} onChange={(ev) => setAim(ev.target.value)} onBlur={() => aim !== e.aim && void saveExp(e.id, { aim })} placeholder="What this experiment sets out to find" className={cn(proseCls, 'min-h-14')} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="px-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">Hypothesis</span>
        <textarea rows={2} value={hyp} onChange={(ev) => setHyp(ev.target.value)} onBlur={() => hyp !== e.hypothesis && void saveExp(e.id, { hypothesis: hyp })} placeholder="What you expect to see, and why" className={cn(proseCls, 'min-h-14')} />
      </label>
    </div>
  );
}

/* ---------------------------------------------------------------- design */

const ROLE: Record<VarRole, { label: string; add: string; example: string; hint: string }> = {
  condition: { label: 'Varied', add: 'What you vary', example: 'Temperature', hint: 'its levels' },
  constant: { label: 'Kept the same', add: 'What you keep the same', example: 'Medium', hint: 'its value' },
  measure: { label: 'Measured', add: 'What you measure', example: 'Yield', hint: 'per run' },
};
const TYPE_LABEL: Record<VarType, string> = { number: 'Number', text: 'Text', category: 'Category', yesno: 'Yes or no' };

/** Chips for a list of values (levels, options): type and press Enter or a comma. */
function Chips({ values, onChange, placeholder, label }: { values: string[]; onChange: (v: string[]) => void; placeholder: string; label: string }): React.JSX.Element {
  const [t, setT] = useState('');
  const add = (): void => {
    const parts = t
      .split(',')
      .map((x) => x.trim())
      .filter((x) => x !== '' && !values.some((v) => v.toLowerCase() === x.toLowerCase()));
    setT('');
    if (parts.length > 0) onChange([...values, ...parts]);
  };
  return (
    <span className="flex min-h-7 flex-wrap items-center gap-1 rounded-[var(--ro-r)] px-1 py-0.5 hover:bg-[var(--ro-row)] focus-within:bg-[var(--ro-shell)] focus-within:outline focus-within:outline-1 focus-within:outline-[var(--ro-line)]">
      {values.map((v) => (
        <span key={v} className="num inline-flex h-5 items-center gap-0.5 rounded-[var(--ro-r-sm)] bg-[var(--ro-row-hover)] pl-1.5 text-[12px] font-semibold">
          {v}
          <button type="button" aria-label={'Remove ' + v} onClick={() => onChange(values.filter((x) => x !== v))} className="rounded-[3px] p-0.5 hover:bg-[var(--ro-row)]">
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={t}
        onChange={(ev) => setT(ev.target.value)}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter' || ev.key === ',') {
            ev.preventDefault();
            add();
          } else if (ev.key === 'Backspace' && t === '' && values.length > 0) onChange(values.slice(0, -1));
        }}
        onBlur={add}
        placeholder={values.length === 0 ? placeholder : ''}
        aria-label={label}
        className="h-5 w-20 min-w-0 flex-1 bg-transparent px-1 text-[12px] outline-none"
      />
    </span>
  );
}

const cellInput = 'h-7 w-full min-w-0 rounded-[var(--ro-r-sm)] border border-transparent bg-transparent px-1.5 text-[13px] outline-none hover:bg-[var(--ro-row)] focus:border-[var(--ro-line)] focus:bg-[var(--ro-shell)]';

function Variables({ e }: { e: Experiment }): React.JSX.Element {
  const [vars, setVars] = useSynced<ExpVariable[]>(e.variables, e.id);
  const send = (next: ExpVariable[]): void => {
    setVars(next);
    void saveExp(e.id, { variables: next.filter((v) => v.name.trim() !== '') });
  };
  const edit = (id: string, patch: Partial<ExpVariable>, commit: boolean): void => {
    const next = vars.map((v) => (v.id === id ? { ...v, ...patch } : v));
    if (commit) send(next);
    else setVars(next);
  };
  const add = (role: VarRole): void => {
    const v: ExpVariable = { id: newId(), name: '', role, type: role === 'constant' ? 'text' : 'number', unit: '', ...(role === 'condition' ? { levels: [] } : {}), ...(role === 'constant' ? { value: '' } : {}) };
    // New variables go to the end of their role's group.
    const order: VarRole[] = ['condition', 'constant', 'measure'];
    const at = vars.findIndex((x) => order.indexOf(x.role) > order.indexOf(role));
    setVars(at < 0 ? [...vars, v] : [...vars.slice(0, at), v, ...vars.slice(at)]);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-var="${v.id}"]`)?.focus(), 30);
  };
  const ordered = (['condition', 'constant', 'measure'] as VarRole[]).flatMap((r) => vars.filter((v) => v.role === r));
  const combos = vars.filter((v) => v.role === 'condition' && (v.levels ?? []).length > 0);
  return (
    <div className="flex flex-col gap-2">
      <span className="flex items-baseline gap-2">
        <span className="text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">Variables</span>
        {combos.length > 0 && (
          <span className="num text-[12px] text-[var(--ro-muted)]">
            {combos.map((c) => (c.levels ?? []).length).join(' × ')} = {plural(combos.reduce((n, c) => n * (c.levels ?? []).length, 1), 'combination')}
          </span>
        )}
      </span>
      {ordered.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--ro-r)] border border-[var(--ro-line)]">
          <table className="w-full min-w-[640px] border-separate border-spacing-0 text-[13px]">
            <thead className="text-left text-[12px] text-[var(--ro-muted)]">
              <tr>
                <th className="h-8 w-36 border-b border-[var(--ro-line)] px-2 font-semibold">Role</th>
                <th className="h-8 border-b border-[var(--ro-line)] px-2 font-semibold">Name</th>
                <th className="h-8 w-32 border-b border-[var(--ro-line)] px-2 font-semibold">Type</th>
                <th className="h-8 w-24 border-b border-[var(--ro-line)] px-2 font-semibold">Unit</th>
                <th className="h-8 border-b border-[var(--ro-line)] px-2 font-semibold">Levels or value</th>
                <th className="h-8 w-9 border-b border-[var(--ro-line)]" />
              </tr>
            </thead>
            <tbody>
              {ordered.map((v) => (
                <tr key={v.id} className="group">
                  <td className="border-b border-[var(--ro-hair)] px-1 py-0.5">
                    <select value={v.role} onChange={(ev) => edit(v.id, { role: ev.target.value as VarRole, ...(ev.target.value === 'condition' ? { levels: v.levels ?? [] } : {}), ...(ev.target.value === 'constant' ? { value: v.value ?? '' } : {}) }, true)} aria-label={'Role of ' + (v.name || 'the variable')} className={cn(cellInput, 'cursor-pointer font-semibold', v.role === 'condition' ? 'text-[var(--ro-accent-text)]' : v.role === 'measure' ? 'text-[var(--ro-green-text)]' : 'text-[var(--ro-ink-2)]')}>
                      {(Object.keys(ROLE) as VarRole[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE[r].label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="border-b border-[var(--ro-hair)] px-1 py-0.5">
                    <input data-var={v.id} value={v.name} onChange={(ev) => edit(v.id, { name: ev.target.value }, false)} onBlur={() => send(vars)} placeholder={ROLE[v.role].example} aria-label="Name" className={cn(cellInput, 'font-semibold')} />
                  </td>
                  <td className="border-b border-[var(--ro-hair)] px-1 py-0.5">
                    {v.role !== 'constant' && (
                      <select value={v.type} onChange={(ev) => edit(v.id, { type: ev.target.value as VarType }, true)} aria-label="Type" className={cn(cellInput, 'cursor-pointer')}>
                        {(Object.keys(TYPE_LABEL) as VarType[]).map((t) => (
                          <option key={t} value={t}>
                            {TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="border-b border-[var(--ro-hair)] px-1 py-0.5">{(v.type === 'number' || v.role === 'constant') && <input value={v.unit} onChange={(ev) => edit(v.id, { unit: ev.target.value }, false)} onBlur={() => send(vars)} placeholder="Unit" aria-label="Unit" className={cellInput} />}</td>
                  <td className="border-b border-[var(--ro-hair)] px-1 py-0.5">
                    {v.role === 'constant' ? (
                      <input value={v.value ?? ''} onChange={(ev) => edit(v.id, { value: ev.target.value }, false)} onBlur={() => send(vars)} placeholder="Value" aria-label="Value" className={cellInput} />
                    ) : v.role === 'condition' && v.type !== 'yesno' ? (
                      <Chips values={v.levels ?? []} onChange={(l) => edit(v.id, { levels: l }, true)} placeholder={v.type === 'number' ? 'Levels: 20, 30, 37' : 'Levels: control, treated'} label={'Levels of ' + v.name} />
                    ) : v.role === 'condition' ? (
                      <button type="button" onClick={() => edit(v.id, { levels: (v.levels ?? []).length > 0 ? [] : ['yes', 'no'] }, true)} className="px-1.5 text-[12px] font-semibold text-[var(--ro-ink-2)] hover:text-[var(--ro-ink)]">
                        {(v.levels ?? []).length > 0 ? 'Both yes and no' : 'Plan both yes and no'}
                      </button>
                    ) : v.type === 'category' ? (
                      <Chips values={v.options ?? []} onChange={(o) => edit(v.id, { options: o }, true)} placeholder="Options: low, medium, high" label={'Options of ' + v.name} />
                    ) : (
                      <span className="px-1.5 text-[12px] text-[var(--ro-muted)]">Recorded for each run</span>
                    )}
                  </td>
                  <td className="border-b border-[var(--ro-hair)] px-1">
                    <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                      <IconButton icon={X} label={'Remove ' + (v.name || 'this variable')} size={22} variant="danger" onClick={() => send(vars.filter((x) => x.id !== v.id))} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <span className="flex flex-wrap gap-1.5">
        {(Object.keys(ROLE) as VarRole[]).map((r) => (
          <Button key={r} size="sm" variant="ghost" icon={Plus} onClick={() => add(r)}>
            {ROLE[r].add}
          </Button>
        ))}
      </span>
    </div>
  );
}

function Materials({ e }: { e: Experiment }): React.JSX.Element {
  const [items, setItems] = useSynced<ExpMaterial[]>(e.materials, e.id);
  const send = (next: ExpMaterial[]): void => {
    setItems(next);
    void saveExp(e.id, { materials: next.filter((m) => m.name.trim() !== '') });
  };
  const add = (): void => {
    const m = { id: newId(), name: '', detail: '' };
    setItems([...items, m]);
    window.setTimeout(() => document.querySelector<HTMLInputElement>(`[data-mat="${m.id}"]`)?.focus(), 30);
  };
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">
        <Package size={12} /> Materials and setup
        <span className="font-normal normal-case tracking-normal">reagents with lots, instruments, software and versions, datasets, participants</span>
      </span>
      {items.length > 0 && (
        <ul className="flex flex-col rounded-[var(--ro-r)] border border-[var(--ro-line)]">
          {items.map((m) => (
            <li key={m.id} className="group grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto] items-center gap-1 border-b border-[var(--ro-hair)] px-1 py-0.5 last:border-0">
              <input data-mat={m.id} value={m.name} onChange={(ev) => setItems(items.map((x) => (x.id === m.id ? { ...x, name: ev.target.value } : x)))} onBlur={() => send(items)} placeholder="Name" aria-label="Name" className={cn(cellInput, 'font-semibold')} />
              <input value={m.detail} onChange={(ev) => setItems(items.map((x) => (x.id === m.id ? { ...x, detail: ev.target.value } : x)))} onBlur={() => send(items)} placeholder="Amount, supplier, lot, version" aria-label="Detail" className={cn(cellInput, 'text-[var(--ro-ink-2)]')} />
              <span className="opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                <IconButton icon={X} label="Remove" size={22} variant="danger" onClick={() => send(items.filter((x) => x.id !== m.id))} />
              </span>
            </li>
          ))}
        </ul>
      )}
      <span>
        <Button size="sm" variant="ghost" icon={Plus} onClick={add}>
          Add an item
        </Button>
      </span>
    </div>
  );
}

function Tests({ e, project }: { e: Experiment; project: Project }): React.JSX.Element {
  const btn = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [options, setOptions] = useState<{ kind: 'work' | 'node'; id: string; title: string; nodeKind: string }[] | null>(null);
  useEffect(() => {
    if (!open || options !== null) return;
    void Promise.all([
      op<{ nodes: GNode[] }>('nodes.list', { project: project.id, passages: false, limit: 1000 }, { quiet: true }).then((r) => r.nodes.filter((n) => n.kind !== 'evidence' && n.status !== 'researcher_rejected').map((n) => ({ kind: 'node' as const, id: n.id, title: n.title, nodeKind: n.kind }))),
      op<{ works: ReadingRow[] }>('projects.works', { project: project.id }, { quiet: true }).then((r) => r.works.map((w) => ({ kind: 'work' as const, id: w.work.id, title: w.work.title, nodeKind: '' }))),
    ])
      .then((parts) => setOptions(parts.flat()))
      .catch(() => setOptions([]));
  }, [open, options, project.id]);
  const current = e.links.map((l) => ({ kind: l.kind, id: l.id }));
  const set = (links: { kind: 'work' | 'node'; id: string }[]): void => void saveExp(e.id, { links });
  const shown = useMemo(() => (options ?? []).filter((o) => !e.links.some((l) => l.kind === o.kind && l.id === o.id) && (q.trim() === '' || o.title.toLowerCase().includes(q.trim().toLowerCase()))).slice(0, 40), [options, e.links, q]);
  const iconOf = (kind: 'work' | 'node', nodeKind: string): LucideIcon => (kind === 'work' ? BookOpenText : nodeKind === 'question' ? CircleHelp : Lightbulb);
  return (
    <div className="flex flex-col gap-1.5">
      <span className="flex items-center gap-2">
        <span className="flex items-center gap-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">
          <Link2 size={12} /> What it tests
        </span>
        <span className="flex-1" />
        <Button ref={btn} size="sm" variant="ghost" icon={Plus} onClick={() => setOpen((o) => !o)}>
          Link a claim or paper
        </Button>
      </span>
      {e.links.length > 0 && (
        <ul className="flex flex-col">
          {e.links.map((l) => {
            const I = iconOf(l.kind, l.node_kind);
            return (
              <li key={l.kind + l.id} className="group flex items-center gap-2 rounded-[var(--ro-r-sm)] px-1 py-1 hover:bg-[var(--ro-row)]">
                <I size={13} className="shrink-0" style={{ color: l.kind === 'node' ? `var(--ro-kind-${l.node_kind === 'question' ? 'question' : 'claim'}-text)` : 'var(--ro-muted)' }} />
                <button type="button" onClick={() => (l.kind === 'work' ? navigate('paper', { id: l.id }) : navigate('project', { id: project.id, view: 'map', node: l.id }))} className="min-w-0 flex-1 truncate text-left text-[13px]">
                  {l.title}
                </button>
                <span className="opacity-0 group-hover:opacity-100">
                  <IconButton icon={X} label="Unlink" size={20} variant="danger" onClick={() => set(current.filter((c) => !(c.kind === l.kind && c.id === l.id)))} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Popover open={open} anchor={btn} onClose={() => setOpen(false)} align="right" className="w-80">
        <div className="border-b border-[var(--ro-hair)] p-1.5">
          <input autoFocus value={q} onChange={(ev) => setQ(ev.target.value)} placeholder="Find a claim, question or paper" aria-label="Find something to link" className={cn(inputCls, 'h-7 text-[12px]')} />
        </div>
        <div data-scroll className="max-h-72 overflow-y-auto py-1">
          {options === null ? (
            <div className="flex justify-center p-3">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <p className="px-3 py-2 text-[12px] text-[var(--ro-muted)]">Nothing to link</p>
          ) : (
            shown.map((o) => {
              const I = iconOf(o.kind, o.nodeKind);
              return (
                <button
                  key={o.kind + o.id}
                  type="button"
                  className={menuItem}
                  onClick={() => {
                    set([...current, { kind: o.kind, id: o.id }]);
                    setOpen(false);
                    setQ('');
                  }}
                >
                  <I size={13} /> <span className="truncate">{o.title}</span>
                </button>
              );
            })
          )}
        </div>
      </Popover>
    </div>
  );
}

/* -------------------------------------------------------------- protocol */

function Protocol({ e, entries }: { e: Experiment; entries: ExpEntry[] }): React.JSX.Element {
  const [steps, setSteps] = useSynced<ExpStep[]>(e.steps, e.id);
  const [text, setText] = useState('');
  const [noting, setNoting] = useState('');
  const send = (next: ExpStep[]): void => {
    setSteps(next);
    void saveExp(e.id, { steps: next.filter((s) => s.text.trim() !== '').map((s) => ({ id: s.id, text: s.text, minutes: s.minutes })) });
  };
  const tick = async (s: ExpStep): Promise<void> => {
    setSteps(steps.map((x) => (x.id === s.id ? { ...x, done: !x.done } : x)));
    try {
      await op('exp.step', { experiment: e.id, step: s.id, done: !s.done });
      changed('experiments', 'exp_log');
    } catch {
      setSteps(e.steps);
    }
  };
  const move = (i: number, d: -1 | 1): void => {
    const next = steps.slice();
    const [s] = next.splice(i, 1);
    if (s === undefined) return;
    next.splice(i + d, 0, s);
    send(next);
  };
  const notes = (id: string): number => entries.filter((x) => x.kind !== 'system' && x.ref?.kind === 'step' && x.ref.id === id && x.struck === '').length;
  const canTick = e.status === 'running' || e.status === 'paused';
  const done = steps.filter((s) => s.done).length;
  return (
    <div className="flex flex-col gap-2">
      {steps.length > 0 && (
        <span className="h-1 overflow-hidden rounded-full bg-[var(--ro-row-hover)]">
          <span className="block h-full bg-[var(--ro-green)]" style={{ width: `${(100 * done) / steps.length}%` }} />
        </span>
      )}
      <ol className="flex flex-col">
        {steps.map((s, i) => (
          <li key={s.id} id={'step-' + s.id} className="group flex flex-col rounded-[var(--ro-r)] border-b border-[var(--ro-hair)] py-1.5 last:border-0">
            <span className="flex items-start gap-2">
              <button
                type="button"
                role="checkbox"
                aria-checked={s.done}
                aria-label={'Step ' + (i + 1) + (s.done ? ' done' : ' not done')}
                disabled={!canTick}
                title={canTick ? (s.done ? 'Mark not done' : 'Mark done') : 'Start the experiment to tick steps off'}
                onClick={() => void tick(s)}
                className={cn('mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full border-[1.5px] text-[12px] font-bold', s.done ? 'border-[var(--ro-green)] bg-[var(--ro-green)] text-white' : 'border-[var(--ro-ink-2)] text-[var(--ro-ink-2)] enabled:hover:bg-[var(--ro-row-hover)] disabled:cursor-default disabled:opacity-70')}
              >
                {s.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </button>
              <textarea
                rows={1}
                value={s.text}
                onChange={(ev) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, text: ev.target.value } : x)))}
                onBlur={() => send(steps)}
                aria-label={'Step ' + (i + 1)}
                className={cn(proseCls, 'min-w-0 flex-1 py-0.5', s.done && 'text-[var(--ro-muted)] line-through')}
              />
              <span className="flex shrink-0 items-center gap-1 pt-0.5">
                <label className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-1 text-[12px]', s.minutes > 0 ? 'bg-[var(--ro-row)] font-semibold text-[var(--ro-ink-2)]' : 'text-[var(--ro-muted)] opacity-0 group-focus-within:opacity-100 group-hover:opacity-100')} title="Minutes this step takes: a timer in bench mode">
                  <Timer size={12} />
                  <input value={s.minutes > 0 ? String(s.minutes) : ''} onChange={(ev) => setSteps(steps.map((x) => (x.id === s.id ? { ...x, minutes: Number(ev.target.value.replace(/[^\d.]/g, '')) || 0 } : x)))} onBlur={() => send(steps)} placeholder="min" inputMode="decimal" aria-label={'Minutes for step ' + (i + 1)} className="num w-9 bg-transparent text-right outline-none" />
                  {s.minutes > 0 && 'min'}
                </label>
                {s.done && s.done_at !== '' && <span className="num text-[12px] text-[var(--ro-green-text)]">{clock(s.done_at)}</span>}
                {notes(s.id) > 0 && <span className="num text-[12px] text-[var(--ro-muted)]">{plural(notes(s.id), 'note')}</span>}
                <IconButton icon={MessageSquarePlus} label="Write a note or deviation about this step" size={24} onClick={() => setNoting(noting === s.id ? '' : s.id)} />
                <span className="flex opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
                  <IconButton icon={ChevronUp} label="Move up" size={22} disabled={i === 0} onClick={() => move(i, -1)} />
                  <IconButton icon={ChevronDown} label="Move down" size={22} disabled={i === steps.length - 1} onClick={() => move(i, 1)} />
                  <IconButton icon={X} label="Remove the step" size={22} variant="danger" onClick={() => send(steps.filter((x) => x.id !== s.id))} />
                </span>
              </span>
            </span>
            {noting === s.id && <StepNote e={e} step={s} index={i} onDone={() => setNoting('')} />}
          </li>
        ))}
      </ol>
      <form
        onSubmit={(ev) => {
          ev.preventDefault();
          if (text.trim() === '') return;
          send([...steps, { id: newId(), text: text.trim(), minutes: 0, done: false, done_at: '' }]);
          setText('');
        }}
        className="flex items-center gap-2 rounded-[var(--ro-r)] px-1 hover:bg-[var(--ro-row)] focus-within:bg-[var(--ro-shell)]"
      >
        <Plus size={14} className="ml-1 text-[var(--ro-muted)]" />
        <input value={text} onChange={(ev) => setText(ev.target.value)} placeholder="Add a step: one action, with amounts, times, temperatures, safety" aria-label="Add a step" className="h-8 min-w-0 flex-1 bg-transparent text-[13px] outline-none" />
      </form>
    </div>
  );
}

/** A note or deviation about one step, written into the journal. */
export function StepNote({ e, step, index, onDone }: { e: Experiment; step: ExpStep; index: number; onDone: () => void }): React.JSX.Element {
  const [kind, setKind] = useState<'note' | 'deviation' | 'observation'>('deviation');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const go = async (): Promise<void> => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    try {
      await op('exp.log', { experiment: e.id, kind, text: text.trim(), ref: { kind: 'step', id: step.id } });
      changed('exp_log', 'experiments');
      setText('');
      onDone();
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  return (
    <span className="ml-8 mt-1.5 flex flex-col gap-1.5 rounded-[var(--ro-r)] border border-[var(--ro-line)] bg-[var(--ro-shell)] p-2">
      <span className="flex flex-wrap items-center gap-1">
        <span className="mr-1 text-[12px] text-[var(--ro-muted)]">About step {index + 1}:</span>
        {(['deviation', 'observation', 'note'] as const).map((k) => (
          <button key={k} type="button" aria-pressed={kind === k} onClick={() => setKind(k)} className={cn('inline-flex h-6 items-center gap-1 rounded-[var(--ro-r-sm)] px-1.5 text-[12px] font-semibold', kind === k ? 'bg-[var(--ro-row-hover)]' : 'text-[var(--ro-muted)] hover:bg-[var(--ro-row)]')}>
            <span className="size-1.5 rounded-full" style={{ background: LOG[k].color }} /> {LOG[k].label}
          </button>
        ))}
      </span>
      <span className="flex items-center gap-1.5">
        <input autoFocus value={text} onChange={(ev) => setText(ev.target.value)} onKeyDown={(ev) => (ev.key === 'Enter' ? void go() : ev.key === 'Escape' ? onDone() : undefined)} placeholder={LOG[kind].placeholder} aria-label={'Journal entry about step ' + (index + 1)} className={cn(inputCls, 'h-8 min-w-0 flex-1 text-[13px]')} />
        <Button size="sm" variant="primary" loading={busy} disabled={text.trim() === ''} onClick={() => void go()}>
          Write
        </Button>
      </span>
    </span>
  );
}

/* ------------------------------------------------------------ conclusion */

function Conclusion({ e, secret }: { e: Experiment; secret: boolean }): React.JSX.Element {
  const [outcome, setOutcome] = useState<ExpOutcome | ''>(e.outcome);
  const [summary, setSummary] = useState(e.summary);
  const [nextSteps, setNextSteps] = useState(e.next_steps);
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState('');
  useEffect(() => {
    setOutcome(e.outcome);
    setSummary(e.summary);
    setNextSteps(e.next_steps);
  }, [e.outcome, e.summary, e.next_steps]);
  const dirty = outcome !== e.outcome || summary !== e.summary || nextSteps !== e.next_steps;
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('exp.conclude', { experiment: e.id, outcome, summary, next_steps: nextSteps });
      changed('experiments', 'exp_log');
    } catch {
      /* toasted */
    } finally {
      setBusy(false);
    }
  };
  const again = async (): Promise<void> => {
    try {
      const r = await op<{ experiment: Experiment }>('exp.repeat', { experiment: e.id });
      changed('experiments', 'exp_log', 'projects');
      toast.success('Planned ' + r.experiment.code + ', a repeat of ' + e.code);
      replaceQuery({ exp: r.experiment.id });
    } catch {
      /* toasted */
    }
  };
  const proposed = e.conclusion_by === 'agent';
  return (
    <div className={cn('flex flex-col gap-3', proposed && 'rounded-[var(--ro-r-md)] border border-[var(--ro-accent)] p-3')}>
      {(proposed || !secret) && (
        <span className="flex flex-wrap items-center gap-2">
          {proposed && (
            <span className="inline-flex items-center gap-1 rounded-[var(--ro-r-sm)] bg-[var(--ro-accent-soft)] px-1.5 py-0.5 text-[12px] font-semibold text-[var(--ro-accent-text)]">
              <Sparkles size={11} /> Proposed by your AI agent: keep it or change it
            </span>
          )}
          <span className="flex-1" />
          {!secret && (
            <Button size="sm" icon={Sparkles} onClick={() => void askAgent('experiment_requested', { experiment: e.id, ask: 'analyze' }, 'Asked your AI agent to analyze the runs').then((rid) => rid !== '' && setRequest(rid))}>
              Analyze with your AI agent
            </Button>
          )}
        </span>
      )}
      {request !== '' && <RequestStatus id={request} />}
      <div role="radiogroup" aria-label="Outcome" className="grid grid-cols-2 gap-1.5 @min-[760px]:grid-cols-4">
        {(Object.keys(OUTCOME) as ExpOutcome[]).map((o) => {
          const O = OUTCOME[o];
          const on = outcome === o;
          return (
            <button key={o} type="button" role="radio" aria-checked={on} onClick={() => setOutcome(on ? '' : o)} className={cn('flex items-center gap-2 rounded-[var(--ro-r)] border px-2.5 py-2 text-left text-[13px] font-semibold transition-colors', on ? 'border-[var(--ro-ink)] bg-[var(--ro-row)]' : 'border-[var(--ro-line)] hover:bg-[var(--ro-row)]')} style={{ color: on ? O.text : undefined }}>
              <O.icon size={15} style={{ color: O.text }} /> {O.label}
            </button>
          );
        })}
      </div>
      <label className="flex flex-col gap-1">
        <span className="px-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">What the data show</span>
        <textarea rows={3} value={summary} onChange={(ev) => setSummary(ev.target.value)} placeholder="The effect with its size and n, what failed or was excluded, what limits the conclusion" className={cn(textareaCls, '[field-sizing:content] min-h-20')} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="px-2 text-[12px] font-bold uppercase tracking-[0.12em] text-[var(--ro-muted)]">Next steps</span>
        <textarea rows={2} value={nextSteps} onChange={(ev) => setNextSteps(ev.target.value)} placeholder="What to run next, what to change" className={cn(textareaCls, '[field-sizing:content] min-h-14')} />
      </label>
      <span className="flex flex-wrap items-center justify-end gap-2">
        {(e.outcome === 'failed' || e.outcome === 'inconclusive') && !dirty && (
          <Button icon={Repeat2} onClick={() => void again()}>
            Run it again
          </Button>
        )}
        <span className="flex-1" />
        {dirty && (
          <Button
            onClick={() => {
              setOutcome(e.outcome);
              setSummary(e.summary);
              setNextSteps(e.next_steps);
            }}
          >
            Discard
          </Button>
        )}
        {(dirty || proposed) && (
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            {proposed && !dirty ? 'Keep it' : 'Save the conclusion'}
          </Button>
        )}
      </span>
    </div>
  );
}
