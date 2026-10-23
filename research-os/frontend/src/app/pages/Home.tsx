/**
 * Home: one obvious way in (add papers), the project shelf (every project
 * as a card you scroll through, with its stage, its visual and its next
 * step), then the library with what to continue reading beside what needs
 * you, every project's open tasks, new papers from saved searches, and what
 * changed.
 */
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, ArrowUpRight, BookOpenText, CircleAlert, FileQuestion, FolderPlus, Lightbulb, Library, MessageSquareText, Plus, ScanText, Sparkles, Telescope, X } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, useLive } from '../lib/live.ts';
import { ago, byline, clip, greeting, num, plural, todayLong } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { ActivityEntry, Candidate, Counts, NeedsYou, Project, WorkRow } from '../lib/types.ts';
import { useAddPapers } from '../components/AddPapers.tsx';
import { useAsk } from '../components/agent.tsx';
import { Ring, YearBars } from '../components/charts.tsx';
import { AgentMark, Cover, openPaper } from '../components/paper.tsx';
import { ProjectShelf } from '../components/home/ProjectCarousel.tsx';
import { TodoPanel } from '../components/tasks/TodoPanel.tsx';
import { Badge, Button, Empty, LoadError, Panel, Skeleton, TextLink } from '../components/ui.tsx';

interface Summary {
  library: Counts;
  continue_reading: WorkRow[];
  recently_added: WorkRow[];
  projects: Project[];
  needs_you: NeedsYou;
  recent: ActivityEntry[];
  this_week: { added: number; highlights: number; nodes: number; read: number };
  candidates: Candidate[];
  settings: { welcome_done: boolean };
}

export default function HomePage(): React.JSX.Element {
  const add = useAddPapers();
  const ask = useAsk();
  const s = useLive((signal) => op<Summary>('home.summary', {}, { quiet: true, signal }), ['works', 'files', 'annotations', 'nodes', 'relations', 'projects', 'project_works', 'activity', 'candidates', 'proposals', 'settings', 'notes'], [], 300);
  const d = s.data;
  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--ro-line)] pb-3">
        <div>
          <h1 className="text-[15px] font-bold leading-[22px]">{greeting()}</h1>
          <p className="text-[12px] text-[var(--ro-muted)]">{todayLong()}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button icon={MessageSquareText} onClick={() => ask.open({ scope: 'library', label: 'About your library' })}>
            Ask your AI agent
          </Button>
          <Button variant="primary" icon={Plus} onClick={() => add.open({})}>
            Add papers
          </Button>
        </div>
      </header>
      {s.error !== null && <LoadError message={s.error} onRetry={s.reload} />}
      {d === null && s.error === null && <HomeSkeleton />}
      {d !== null && (
        <>
          {(d.library.total === 0 || !d.settings.welcome_done) && <FirstRun total={d.library.total} projects={d.projects.length} />}
          <ProjectShelf />
          <div className="grid grid-cols-1 gap-4 @min-[900px]:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <LibraryPanel c={d.library} week={d.this_week} works={d.continue_reading} recent={d.recently_added} />
            <NeedsCard ny={d.needs_you} />
          </div>
          <TodoPanel />
          <div className="grid grid-cols-1 gap-4 @min-[900px]:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
            <CandidatesPanel rows={d.candidates} />
            <RecentPanel rows={d.recent} />
          </div>
        </>
      )}
    </div>
  );
}

function HomeSkeleton(): React.JSX.Element {
  return (
    <div className="grid grid-cols-1 gap-4 @min-[900px]:grid-cols-3">
      {[0, 1, 2].map((i) => (
        <div key={i} className="flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3">
          <Skeleton className="w-1/3" />
          <Skeleton className="h-24" />
          <Skeleton className="w-2/3" />
        </div>
      ))}
    </div>
  );
}

function FirstRun({ total, projects }: { total: number; projects: number }): React.JSX.Element {
  const add = useAddPapers();
  const dismiss = async (): Promise<void> => {
    await op('settings.update', { welcome_done: true });
    changed('settings');
  };
  const steps: { n: number; title: string; done: boolean; icon: LucideIcon; action: React.JSX.Element }[] = [
    { n: 1, title: 'Add your first papers', done: total > 0, icon: Library, action: <Button size="sm" variant="primary" icon={Plus} onClick={() => add.open({})}>Add papers</Button> },
    { n: 2, title: 'Start a project around a question', done: projects > 0, icon: FolderPlus, action: <Button size="sm" icon={FolderPlus} onClick={() => navigate('projects', { new: '1' })}>New project</Button> },
    { n: 3, title: 'Read, highlight, and let your AI agent map the claims', done: false, icon: Lightbulb, action: <Button size="sm" icon={BookOpenText} onClick={() => navigate('library')}>Open the library</Button> },
  ];
  return (
    <Panel tone="sand" padded={false}>
      <div className="flex flex-col gap-3 p-4 @min-[900px]:flex-row @min-[900px]:items-center">
        <div className="min-w-0 @min-[900px]:w-64">
          <p className="text-[14px] font-bold">Your research, in one place</p>
          <p className="mt-0.5 text-[12px] text-[var(--ro-muted)]">Every quote stays tied to its page. Your AI agent reads and proposes; you decide.</p>
        </div>
        <ol className="grid min-w-0 flex-1 grid-cols-1 gap-2 @min-[640px]:grid-cols-3">
          {steps.map((st) => (
            <li key={st.n} className={cn('ro-on-card flex flex-col gap-2 rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)] p-3', st.done && 'opacity-60')}>
              <span className="flex items-center gap-2">
                <span className="flex size-6 items-center justify-center rounded-[var(--ro-r-sm)] bg-[var(--ro-row)] text-[var(--ro-ink-2)]">
                  <st.icon size={14} />
                </span>
                <span className="text-[12px] font-bold text-[var(--ro-muted)]">Step {st.n}</span>
              </span>
              <span className="text-[13px] font-semibold leading-[18px]">{st.title}</span>
              <span>{st.done ? <Badge tone="good">Done</Badge> : st.action}</span>
            </li>
          ))}
        </ol>
        {total > 0 && (
          <button type="button" onClick={() => void dismiss()} aria-label="Hide" title="Hide" className="self-start rounded-[var(--ro-r)] p-1 text-[var(--ro-muted)] hover:bg-[var(--ro-row)]">
            <X size={14} />
          </button>
        )}
      </div>
    </Panel>
  );
}

function NeedsCard({ ny }: { ny: NeedsYou }): React.JSX.Element {
  const c = ny.counts;
  const rows: { n: number; label: string; icon: LucideIcon; go: () => void; tone?: 'bad' | undefined }[] = [
    { n: c.nodes + c.relations, label: 'claims, evidence and links your AI agent proposed', icon: Lightbulb, go: () => navigate('agent', { tab: 'needs' }) },
    { n: c.proposals, label: 'proposals to approve', icon: Sparkles, go: () => navigate('agent', { tab: 'proposals' }) },
    { n: c.identities, label: 'identifications to confirm', icon: FileQuestion, go: () => navigate('library', { view: 'to_identify' }) },
    { n: c.unidentified, label: 'papers to identify', icon: FileQuestion, go: () => navigate('library', { view: 'to_identify' }) },
    { n: c.ms_changes, label: 'draft changes to keep or undo', icon: BookOpenText, go: () => navigate('agent', { tab: 'needs' }) },
    { n: c.notes, label: 'notes to keep', icon: BookOpenText, go: () => navigate('agent', { tab: 'needs' }) },
    { n: c.retracted, label: 'retracted papers in your library', icon: CircleAlert, go: () => navigate('library', { view: 'integrity' }), tone: 'bad' as const },
    { n: c.needs_ocr, label: 'scanned PDFs waiting to be read', icon: ScanText, go: () => navigate('library', { view: 'all' }) },
    { n: c.failed_text, label: 'PDFs that could not be read', icon: CircleAlert, go: () => navigate('library', { view: 'all' }), tone: 'bad' as const },
  ].filter((r) => r.n > 0);
  return (
    <Panel tone="dark" title="Needs you" subtitle={ny.total > 0 ? plural(ny.total, 'thing') + ' waiting' : 'Nothing waiting'} actions={<TextLink tone="muted" onClick={() => navigate('agent')}>Your AI agent <ArrowUpRight size={12} /></TextLink>}>
      {rows.length === 0 ? (
        <Empty dark compact icon={Sparkles} title="All caught up">
          What your AI agent proposes shows up here.
        </Empty>
      ) : (
        <ul className="flex flex-col gap-1">
          {rows.map((r) => (
            <li key={r.label}>
              <button type="button" onClick={r.go} className="flex w-full items-center gap-2.5 rounded-[var(--ro-r)] px-2 py-1.5 text-left hover:bg-[var(--ro-dark-2)]">
                <r.icon size={15} className={r.tone === 'bad' ? 'text-[var(--ro-red-on-dark)]' : 'text-[var(--ro-accent)]'} />
                <span className="num w-8 shrink-0 text-[15px] font-bold">{num(r.n)}</span>
                <span className="min-w-0 flex-1 text-[12px] leading-4 text-[var(--ro-on-dark-muted)]">{r.label}</span>
                <ArrowRight size={13} className="shrink-0 text-[var(--ro-on-dark-muted)]" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/** The library at a glance, with what to continue reading (or what was just added). */
function LibraryPanel({ c, week, works, recent }: { c: Counts; week: Summary['this_week']; works: WorkRow[]; recent: WorkRow[] }): React.JSX.Element {
  const add = useAddPapers();
  const list = works.length > 0 ? works : recent.filter((w) => w.file);
  return (
    <Panel title="Your library" subtitle={plural(c.total, 'paper')} actions={<TextLink onClick={() => navigate('library')}>Library <ArrowUpRight size={12} /></TextLink>}>
      <div className="grid grid-cols-1 gap-4 @min-[640px]:grid-cols-[196px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Ring
              size={96}
              stroke={11}
              center={num(c.total)}
              sub="papers"
              onPick={(k) => navigate('library', { view: k })}
              slices={[
                { key: 'unread', label: 'Unread', value: c.unread, color: 'var(--ro-accent)' },
                { key: 'reading', label: 'Reading', value: c.reading, color: 'var(--ro-amber)' },
                { key: 'read', label: 'Read', value: c.read, color: 'var(--ro-ink-2)' },
              ]}
            />
            <ul className="flex min-w-0 flex-1 flex-col gap-1">
              {[
                { k: 'unread', label: 'Unread', n: c.unread, color: 'var(--ro-accent)' },
                { k: 'reading', label: 'Reading', n: c.reading, color: 'var(--ro-amber)' },
                { k: 'read', label: 'Read', n: c.read, color: 'var(--ro-ink-2)' },
              ].map((x) => (
                <li key={x.k}>
                  <button type="button" onClick={() => navigate('library', { view: x.k })} className="flex w-full items-center gap-2 rounded-[var(--ro-r-sm)] px-1 py-0.5 text-left hover:bg-[var(--ro-row)]">
                    <span className="size-2 shrink-0 rounded-full" style={{ background: x.color }} />
                    <span className="flex-1 text-[12px]">{x.label}</span>
                    <span className="num text-[12px] font-bold">{num(x.n)}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
          <div className="grid grid-cols-4 gap-1 border-t border-[var(--ro-hair)] pt-2.5 text-center" title="This week">
            {[
              { label: 'Added', n: week.added },
              { label: 'Read', n: week.read },
              { label: 'Marks', n: week.highlights },
              { label: 'Claims', n: week.nodes },
            ].map((x) => (
              <div key={x.label}>
                <div className="num text-[15px] font-bold">{num(x.n)}</div>
                <div className="text-[12px] text-[var(--ro-muted)]">{x.label}</div>
              </div>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[12px] font-semibold text-[var(--ro-ink-2)]">By year published</p>
            <YearBars years={c.years} height={40} />
          </div>
        </div>
        <div className="flex min-w-0 flex-col gap-2 @min-[640px]:border-l @min-[640px]:border-[var(--ro-hair)] @min-[640px]:pl-4">
          <p className="text-[12px] font-semibold text-[var(--ro-ink-2)]">
            {works.length > 0 ? 'Continue reading' : 'Recently added'}
            {works.length > 0 && <span className="font-normal text-[var(--ro-muted)]"> · where you left off</span>}
          </p>
          {list.length === 0 ? (
            <Empty compact icon={BookOpenText} title="Nothing to read yet" action={<Button icon={Plus} onClick={() => add.open({ tab: 'pdf' })}>Add PDFs</Button>} />
          ) : (
            <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
              {list.slice(0, 10).map((w) => (
                <button key={w.id} type="button" onClick={() => openPaper(w)} className="group flex w-[112px] shrink-0 flex-col gap-1.5 text-left" title={w.title}>
                  <Cover work={w} width={112} className="transition-transform group-hover:-translate-y-0.5" />
                  <span className="line-clamp-2 text-[12px] font-semibold leading-4">{w.title}</span>
                  <span className="truncate text-[12px] text-[var(--ro-muted)]">{w.file && w.file.max_page > 0 ? `Page ${w.file.max_page} of ${w.file.pages}` : byline(w)}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}

function CandidatesPanel({ rows }: { rows: Candidate[] }): React.JSX.Element {
  const triage = async (c: Candidate, t: 'not_relevant'): Promise<void> => {
    await op('candidates.triage', { candidates: [c.id], triage: t });
    changed('candidates');
  };
  const add = async (c: Candidate): Promise<void> => {
    await op('candidates.add', { candidates: [c.id] });
    changed('candidates', 'works');
  };
  return (
    <Panel title="New from your searches" subtitle={rows.length > 0 ? 'Saved searches and deep searches' : undefined} actions={<TextLink onClick={() => navigate('discover')}>Discover <ArrowUpRight size={12} /></TextLink>}>
      {rows.length === 0 ? (
        <Empty compact icon={Telescope} title="Nothing new" action={<Button icon={Telescope} onClick={() => navigate('discover')}>Search for papers</Button>}>
          Save a search with an alert and new papers appear here.
        </Empty>
      ) : (
        <ul className="flex flex-col">
          {rows.map((c) => (
            <li key={c.id} className="flex items-start gap-3 border-b border-[var(--ro-hair)] py-2 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="block text-[13px] font-semibold leading-[18px]">{c.title}</span>
                <span className="block truncate text-[12px] text-[var(--ro-muted)]">{byline({ authors_short: c.authors_short, container: c.venue, year: c.year })}</span>
                {c.reason !== '' && (
                  <span className="mt-1 flex items-start gap-1 text-[12px] leading-4 text-[var(--ro-ink-2)]">
                    <AgentMark title="Your AI agent's reason" />
                    {clip(c.reason, 160)}
                  </span>
                )}
              </span>
              <span className="flex shrink-0 gap-1">
                <Button size="sm" onClick={() => void add(c)}>
                  Add
                </Button>
                <Button size="sm" variant="ghost" onClick={() => void triage(c, 'not_relevant')} title="Not relevant">
                  <X size={13} />
                </Button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

function RecentPanel({ rows }: { rows: ActivityEntry[] }): React.JSX.Element {
  return (
    <Panel title="Recent activity" actions={<TextLink onClick={() => navigate('activity')}>All <ArrowUpRight size={12} /></TextLink>}>
      {rows.length === 0 ? (
        <Empty compact icon={Sparkles} title="Nothing yet" />
      ) : (
        <ul className="flex flex-col">
          {rows.map((a) => (
            <li key={a.id} className="flex items-start gap-2 border-b border-[var(--ro-hair)] py-1.5 last:border-0">
              <span className={cn('mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-[var(--ro-r-sm)] text-[12px] font-bold', a.actor === 'agent' ? 'bg-[var(--ro-accent-soft)] text-[var(--ro-accent-text)]' : 'bg-[var(--ro-row)] text-[var(--ro-ink-2)]')}>{a.actor === 'agent' ? <Sparkles size={11} /> : a.actor === 'system' ? 'S' : 'Y'}</span>
              <span className="min-w-0 flex-1 text-[12px] leading-4">{a.label}</span>
              <span className="shrink-0 text-[12px] text-[var(--ro-muted)]">{ago(a.created)}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
