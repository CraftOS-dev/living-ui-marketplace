/**
 * Your AI agent: what waits for you (everything it proposed, confirm or
 * reject in bulk), the proposals that need approval before they run, what
 * you asked it to do and how each request went, your questions and its
 * answers, and its scorecard (how much of its work you kept).
 *
 *   In Needs you: Space or click selects, C confirms, R rejects the selection.
 */
import { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight, BookOpenText, Check, CheckCheck, CircleAlert, CornerUpLeft, FileQuestion, FileText, Lightbulb, MessageSquareText, NotebookPen, Quote, ScanText, Send, Sparkles, X } from 'lucide-react';
import { cn, getPbClient, toast } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { changed, listen, useLive } from '../lib/live.ts';
import { ago, clip, num, plural } from '../lib/format.ts';
import { navigate, replaceQuery } from '../lib/router.ts';
import type { AgentRequest, Ask, GNode, NeedsYou, Proposal, Relation, WorkRow } from '../lib/types.ts';
import { DecideButtons, decideNodes, decideRelations } from '../components/agent.tsx';
import { KIND_ICON } from '../components/project/ClaimsMap.tsx';
import { Cover, openPaper } from '../components/paper.tsx';
import { Badge, Button, Empty, LoadError, Modal, PageHeader, Panel, Segmented, Skeleton, Spinner, Tabs, textareaCls } from '../components/ui.tsx';

type Tab = 'needs' | 'proposals' | 'requests' | 'questions' | 'scorecard';

const TRIGGER_LABEL: Record<string, string> = {
  papers_waiting: 'Identify PDFs without metadata',
  ocr_requested: 'Read scanned pages',
  question_asked: 'Answer a question',
  claims_requested: 'Map claims and evidence',
  access_requested: 'Find a full-text PDF',
  proposal_returned: 'Revise a returned proposal',
  search_requested: 'Deep search',
  feed_review: 'Assess new candidates',
  experiment_requested: 'Plan or analyze an experiment',
  draft_requested: 'Draft text',
  support_check_requested: 'Check citations support the text',
  responses_requested: 'Split a review into comments',
  screening_requested: 'Screen records',
  references_requested: "Resolve a paper's references",
};

export default function AgentPage({ query }: { query: URLSearchParams }): React.JSX.Element {
  const tab = (query.get('tab') ?? 'needs') as Tab;
  const ny = useLive((signal) => op<NeedsYou>('agent.needs-you', { limit: 60 }, { quiet: true, signal }), ['nodes', 'relations', 'proposals', 'works', 'files', 'notes', 'ms_changes', 'response_items'], [], 250);
  const c = ny.data?.counts;
  return (
    <div className="flex flex-col gap-3">
      <PageHeader icon={Sparkles} title="Your AI agent" subtitle={ny.data ? (ny.data.total > 0 ? plural(ny.data.total, 'thing') + ' waiting for you' : 'Nothing waiting for you') : undefined} />
      <Tabs
        label="Agent"
        value={tab}
        onChange={(t) => replaceQuery({ tab: t === 'needs' ? undefined : t })}
        options={[
          { value: 'needs', label: <Counted label="Needs you" n={ny.data?.total ?? 0} /> },
          { value: 'proposals', label: <Counted label="Proposals" n={c?.proposals ?? 0} /> },
          { value: 'requests', label: 'Requests' },
          { value: 'questions', label: 'Questions' },
          { value: 'scorecard', label: 'Scorecard' },
        ]}
      />
      {tab === 'needs' && (ny.error !== null ? <LoadError message={ny.error} onRetry={ny.reload} /> : ny.data === null ? <Skeleton className="h-48" /> : <NeedsTab ny={ny.data} />)}
      {tab === 'proposals' && <ProposalsTab />}
      {tab === 'requests' && <RequestsTab />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'scorecard' && <ScorecardTab />}
    </div>
  );
}

function Counted({ label, n }: { label: string; n: number }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      {label}
      {n > 0 && <span className="num rounded-full bg-[var(--ro-accent-soft)] px-1.5 text-[12px] text-[var(--ro-accent-text)]">{num(n)}</span>}
    </span>
  );
}

/* ------------------------------------------------------------ needs you */

function NeedsTab({ ny }: { ny: NeedsYou }): React.JSX.Element {
  const c = ny.counts;
  const nodes = ny.nodes ?? [];
  const rels = ny.relations ?? [];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [focus, setFocus] = useState(0);
  const items = useMemo(() => [...nodes.map((n) => ({ type: 'node' as const, id: n.id, n })), ...rels.map((r) => ({ type: 'rel' as const, id: r.id, r }))], [nodes, rels]);
  const selectedNodes = [...sel].filter((id) => nodes.some((n) => n.id === id));
  const selectedRels = [...sel].filter((id) => rels.some((r) => r.id === id));
  const decide = async (status: 'researcher_confirmed' | 'researcher_rejected', ids?: { nodes: string[]; rels: string[] }): Promise<void> => {
    const n = ids?.nodes ?? selectedNodes;
    const r = ids?.rels ?? selectedRels;
    if (n.length > 0) await decideNodes(n, status);
    if (r.length > 0) await decideRelations(r, status);
    if (n.length + r.length > 0) toast.success(plural(n.length + r.length, 'item') + (status === 'researcher_confirmed' ? ' confirmed' : ' rejected'));
    setSel(new Set());
  };
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]') || e.ctrlKey || e.metaKey || e.altKey) return;
      const it = items[focus];
      if (e.key === 'ArrowDown' || e.key === 'j') setFocus((f) => Math.min(items.length - 1, f + 1));
      else if (e.key === 'ArrowUp' || e.key === 'k') setFocus((f) => Math.max(0, f - 1));
      else if (e.key === ' ' && it) {
        setSel((s) => {
          const n = new Set(s);
          if (n.has(it.id)) n.delete(it.id);
          else n.add(it.id);
          return n;
        });
      } else if ((e.key === 'c' || e.key === 'r') && (sel.size > 0 || it)) {
        const status = e.key === 'c' ? 'researcher_confirmed' : 'researcher_rejected';
        if (sel.size > 0) void decide(status);
        else if (it) void decide(status, it.type === 'node' ? { nodes: [it.id], rels: [] } : { nodes: [], rels: [it.id] });
      } else return;
      e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const queue: { n: number; label: string; icon: LucideIcon; go: () => void; tone?: 'bad' }[] = [
    { n: c.ms_changes, label: 'draft changes to keep or undo', icon: FileText, go: () => navigate('projects') },
    { n: c.notes, label: 'notes to keep', icon: NotebookPen, go: () => navigate('notes') },
    { n: c.responses, label: 'review responses to check', icon: MessageSquareText, go: () => navigate('projects') },
    { n: c.needs_ocr, label: 'scanned PDFs waiting to be read', icon: ScanText, go: () => navigate('library') },
    { n: c.failed_text, label: 'PDFs that could not be read', icon: CircleAlert, go: () => navigate('library'), tone: 'bad' as const },
  ].filter((x) => x.n > 0);
  const nothing = ny.total === 0 && queue.length === 0;
  if (nothing)
    return (
      <Empty icon={CheckCheck} title="All caught up">
        What your AI agent proposes waits here for you.
      </Empty>
    );
  return (
    <div className="flex flex-col gap-4">
      {items.length > 0 && (
        <Panel
          title="Claims, evidence and links"
          subtitle={plural(c.nodes + c.relations, 'proposal')}
          actions={
            <span className="flex items-center gap-1.5">
              <Button size="sm" onClick={() => setSel(sel.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
                {sel.size === items.length ? 'Select none' : 'Select all'}
              </Button>
              {sel.size > 0 && <DecideButtons onConfirm={() => decide('researcher_confirmed')} onReject={() => decide('researcher_rejected')} />}
            </span>
          }
        >
          <ul className="flex flex-col">
            {items.map((it, i) => (
              <li key={it.id}>
                <div
                  role="option"
                  aria-selected={sel.has(it.id)}
                  onClick={() => {
                    setFocus(i);
                    setSel((s) => {
                      const n = new Set(s);
                      if (n.has(it.id)) n.delete(it.id);
                      else n.add(it.id);
                      return n;
                    });
                  }}
                  className={cn('flex cursor-pointer items-start gap-3 border-b border-[var(--ro-hair)] px-1 py-2 last:border-0', sel.has(it.id) ? 'bg-[var(--ro-accent-soft)]' : 'hover:bg-[var(--ro-row)]', focus === i && 'outline outline-1 -outline-offset-1 outline-[var(--ro-ink-2)]')}
                >
                  <input type="checkbox" checked={sel.has(it.id)} readOnly aria-label="Select" className="mt-1" />
                  {it.type === 'node' ? <NodeRow n={it.n} /> : <RelRow r={it.r} />}
                  <span onClick={(e) => e.stopPropagation()}>
                    <DecideButtons compact onConfirm={() => decide('researcher_confirmed', it.type === 'node' ? { nodes: [it.id], rels: [] } : { nodes: [], rels: [it.id] })} onReject={() => decide('researcher_rejected', it.type === 'node' ? { nodes: [it.id], rels: [] } : { nodes: [], rels: [it.id] })} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
          {c.nodes + c.relations > items.length && <p className="mt-2 text-[12px] text-[var(--ro-muted)]">{num(c.nodes + c.relations - items.length)} more after these</p>}
        </Panel>
      )}
      <div className="grid grid-cols-1 gap-4 @min-[900px]:grid-cols-2">
        {(ny.identities ?? []).length > 0 && <WorksPanel title="Identifications to confirm" icon={FileQuestion} rows={ny.identities ?? []} n={c.identities} note="Your AI agent matched these PDFs to a paper; check each is right" />}
        {(ny.unidentified ?? []).length > 0 && <WorksPanel title="Papers to identify" icon={FileQuestion} rows={ny.unidentified ?? []} n={c.unidentified} />}
        {(ny.retracted ?? []).length > 0 && <WorksPanel title="Retracted papers" icon={CircleAlert} rows={ny.retracted ?? []} n={c.retracted} tone="bad" />}
        {(ny.proposals ?? []).length > 0 && (
          <Panel title="Proposals to approve" subtitle={plural(c.proposals, 'proposal')}>
            <ul className="flex flex-col gap-2">
              {(ny.proposals ?? []).slice(0, 4).map((p) => (
                <li key={p.id}>
                  <ProposalCard p={p} />
                </li>
              ))}
            </ul>
          </Panel>
        )}
        {queue.length > 0 && (
          <Panel title="Elsewhere">
            <ul className="flex flex-col gap-1">
              {queue.map((q) => (
                <li key={q.label}>
                  <button type="button" onClick={q.go} className="flex w-full items-center gap-2.5 rounded-[var(--ro-r)] px-2 py-1.5 text-left hover:bg-[var(--ro-row)]">
                    <q.icon size={15} className={q.tone === 'bad' ? 'text-[var(--ro-red)]' : 'text-[var(--ro-accent)]'} />
                    <span className="num w-8 text-[15px] font-bold">{num(q.n)}</span>
                    <span className="min-w-0 flex-1 text-[12px]">{q.label}</span>
                    <ArrowRight size={13} className="text-[var(--ro-muted)]" />
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
        )}
      </div>
    </div>
  );
}

function NodeRow({ n }: { n: GNode }): React.JSX.Element {
  const Icon = KIND_ICON[n.kind];
  const a = n.anchors?.[0];
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: `var(--ro-kind-${n.kind}-text)` }}>
        <Icon size={12} /> {n.kind === 'evidence' ? 'Evidence' : n.kind === 'claim' ? 'Claim' : 'Question'}
        <span className="font-normal text-[var(--ro-muted)]">in {n.project_name}</span>
        <span className="ml-auto font-normal text-[var(--ro-muted)]">{ago(n.created)}</span>
      </span>
      <span className="text-[13px] font-semibold leading-[18px]">{n.title}</span>
      {a !== undefined && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            navigate('read', { file: a.file, page: String(a.page) });
          }}
          className="serif line-clamp-2 border-l-2 border-[var(--ro-line)] pl-2 text-left text-[12px] leading-4 text-[var(--ro-ink-2)] hover:border-[var(--ro-ink)]"
          title="Read it in the paper"
        >
          {a.quote} <span className="font-sans font-semibold text-[var(--ro-muted)]">({a.work_label}, p. {a.page})</span>
        </button>
      )}
      {n.why !== '' && (
        <span className="flex items-start gap-1 text-[12px] leading-4 text-[var(--ro-muted)]">
          <Sparkles size={11} className="mt-0.5 shrink-0" />
          {clip(n.why, 200)}
        </span>
      )}
    </span>
  );
}

function RelRow({ r }: { r: Relation }): React.JSX.Element {
  const From = KIND_ICON[r.from_kind ?? 'evidence'];
  const To = KIND_ICON[r.to_kind ?? 'claim'];
  return (
    <span className="flex min-w-0 flex-1 flex-col gap-1">
      <span className="text-[12px] font-semibold text-[var(--ro-muted)]">Link</span>
      <span className="flex flex-wrap items-center gap-1.5 text-[12px] leading-4">
        <From size={12} style={{ color: `var(--ro-kind-${r.from_kind}-text)` }} />
        <span className="font-semibold">{clip(r.from_title ?? '', 90)}</span>
        <span className="rounded-full px-1.5 font-bold" style={{ color: `var(--ro-rel-${r.kind}-text)` }}>
          {r.kind}
        </span>
        <To size={12} style={{ color: `var(--ro-kind-${r.to_kind}-text)` }} />
        <span className="font-semibold">{clip(r.to_title ?? '', 90)}</span>
      </span>
      {r.reason !== '' && <span className="text-[12px] leading-4 text-[var(--ro-muted)]">{clip(r.reason, 200)}</span>}
    </span>
  );
}

function WorksPanel({ title, icon: Icon, rows, n, note, tone }: { title: string; icon: LucideIcon; rows: WorkRow[]; n: number; note?: string; tone?: 'bad' }): React.JSX.Element {
  return (
    <Panel title={title} subtitle={note ?? plural(n, 'paper')}>
      <ul className="flex flex-col">
        {rows.map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => navigate('paper', { id: w.id })} className="flex w-full items-center gap-2.5 border-b border-[var(--ro-hair)] py-1.5 text-left last:border-0 hover:bg-[var(--ro-row)]">
              <Cover work={w} width={26} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold">{w.title || 'Untitled PDF'}</span>
                <span className="block truncate text-[12px] text-[var(--ro-muted)]">{w.label}</span>
              </span>
              <Icon size={14} className={tone === 'bad' ? 'text-[var(--ro-red)]' : 'text-[var(--ro-muted)]'} />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/* ------------------------------------------------------------ proposals */

function ProposalsTab(): React.JSX.Element {
  const [status, setStatus] = useState<'waiting' | 'all'>('waiting');
  const list = useLive((signal) => op<{ proposals: Proposal[] }>('proposals.list', { status, limit: 200 }, { quiet: true, signal }).then((r) => r.proposals), ['proposals'], [status], 200);
  return (
    <div className="flex flex-col gap-3">
      <Segmented label="Show" size="sm" value={status} onChange={setStatus} options={[{ value: 'waiting', label: 'Waiting' }, { value: 'all', label: 'All' }]} />
      {list.error !== null && <LoadError message={list.error} onRetry={list.reload} />}
      {list.data === null && list.error === null && <Skeleton className="h-32" />}
      {list.data !== null && list.data.length === 0 && (
        <Empty icon={Sparkles} title={status === 'waiting' ? 'No proposals waiting' : 'No proposals yet'}>
          When your AI agent wants to trash, merge or delete something, it asks here first.
        </Empty>
      )}
      <ul className="grid grid-cols-1 gap-2 @min-[900px]:grid-cols-2">
        {(list.data ?? []).map((p) => (
          <li key={p.id}>
            <ProposalCard p={p} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function previewLines(p: Proposal): { k: string; v: string }[] {
  const pv = p.preview;
  if (pv === null || typeof pv !== 'object') return [];
  return Object.entries(pv)
    .filter(([, v]) => v !== null && v !== '' && (typeof v !== 'object' || Array.isArray(v)))
    .slice(0, 8)
    .map(([k, v]) => ({ k: k.replace(/_/g, ' '), v: Array.isArray(v) ? (v.length > 0 && typeof v[0] === 'object' ? plural(v.length, 'item') : v.join(', ')) : String(v) }));
}

function ProposalCard({ p }: { p: Proposal }): React.JSX.Element {
  const [busy, setBusy] = useState('');
  const [returning, setReturning] = useState(false);
  const act = async (which: 'approve' | 'reject'): Promise<void> => {
    setBusy(which);
    try {
      await op(which === 'approve' ? 'proposals.approve' : 'proposals.reject', { proposal: p.id });
      changed('proposals', 'works', 'files', 'activity');
      toast.success(which === 'approve' ? 'Approved and done' : 'Rejected');
    } catch {
      /* toasted */
    } finally {
      setBusy('');
    }
  };
  const lines = previewLines(p);
  return (
    <div className={cn('flex flex-col gap-2 rounded-[var(--ro-r-md)] border bg-[var(--ro-card)] p-3', p.status === 'waiting' ? 'border-dashed border-[var(--ro-accent)]' : 'border-[var(--ro-line)]')}>
      <span className="flex items-start gap-2">
        <Sparkles size={14} className="mt-0.5 shrink-0 text-[var(--ro-accent)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold leading-[18px]">{p.title}</span>
          {p.summary !== '' && <span className="block text-[12px] leading-4 text-[var(--ro-ink-2)]">{p.summary}</span>}
        </span>
        <Badge tone={p.status === 'waiting' ? 'agent' : p.status === 'approved' ? 'good' : p.status === 'rejected' ? 'bad' : 'neutral'}>{p.status}</Badge>
      </span>
      {lines.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 rounded-[var(--ro-r)] bg-[var(--ro-row)] px-2.5 py-2 text-[12px]">
          {lines.map((l) => (
            <div key={l.k} className="contents">
              <dt className="text-[var(--ro-muted)]">{l.k}</dt>
              <dd className="min-w-0 truncate">{l.v}</dd>
            </div>
          ))}
        </dl>
      )}
      {p.why !== '' && <p className="text-[12px] leading-4 text-[var(--ro-ink-2)]">Why: {p.why}</p>}
      {p.decision_note !== '' && <p className="text-[12px] leading-4 text-[var(--ro-muted)]">Your note: {p.decision_note}</p>}
      <span className="flex items-center gap-1.5">
        <span className="text-[12px] text-[var(--ro-muted)]">{ago(p.created)}</span>
        <span className="flex-1" />
        {p.status === 'waiting' && (
          <>
            <Button size="sm" variant="ghost" icon={CornerUpLeft} onClick={() => setReturning(true)}>
              Return
            </Button>
            <Button size="sm" variant="ghost" icon={X} loading={busy === 'reject'} onClick={() => void act('reject')}>
              Reject
            </Button>
            <Button size="sm" variant="primary" icon={Check} loading={busy === 'approve'} onClick={() => void act('approve')}>
              Approve
            </Button>
          </>
        )}
      </span>
      <ReturnDialog open={returning} p={p} onClose={() => setReturning(false)} />
    </div>
  );
}

function ReturnDialog({ open, p, onClose }: { open: boolean; p: Proposal; onClose: () => void }): React.JSX.Element {
  const [note, setNote] = useState('');
  return (
    <Modal open={open} onClose={onClose} title="Return to your AI agent" icon={CornerUpLeft} footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" icon={Send} disabled={note.trim() === ''} onClick={() => void op('proposals.return', { proposal: p.id, note: note.trim() }).then(() => { changed('proposals'); onClose(); })}>Return it</Button></>}>
      <p className="mb-2 text-[13px] font-semibold">{p.title}</p>
      <textarea autoFocus rows={4} value={note} onChange={(e) => setNote(e.target.value)} className={textareaCls} placeholder="What to change" aria-label="What to change" />
    </Modal>
  );
}

/* ------------------------------------------------------------- requests */

function RequestsTab(): React.JSX.Element {
  const [rows, setRows] = useState<AgentRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    const load = (): void => {
      void getPbClient()
        .call((pb) => pb.collection('agent_requests').getList<AgentRequest>(1, 100, { sort: '-created', requestKey: null }), { silent: true })
        .then((r) => !gone && setRows(r.items))
        .catch((e: unknown) => !gone && setError(String((e as Error).message ?? e)));
    };
    load();
    const off = listen(['agent_requests'], load);
    return () => {
      gone = true;
      off();
    };
  }, []);
  if (error !== null) return <LoadError message={error} />;
  if (rows === null) return <Skeleton className="h-32" />;
  if (rows.length === 0)
    return (
      <Empty icon={Send} title="Nothing asked yet">
        Buttons that ask your AI agent for work (map the claims, deep search, draft) show their progress here.
      </Empty>
    );
  const tone = (s: string): 'good' | 'bad' | 'info' | 'neutral' => (s === 'done' ? 'good' : s === 'rejected' ? 'bad' : s === 'claimed' ? 'info' : 'neutral');
  return (
    <div className="overflow-x-auto rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
      <table className="ro-table w-full min-w-[640px]">
        <thead>
          <tr>
            <th>Asked for</th>
            <th className="w-28">Status</th>
            <th className="w-32">When</th>
            <th>Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="text-[13px] font-semibold">{TRIGGER_LABEL[r.trigger] ?? r.trigger}</td>
              <td>
                <Badge tone={tone(r.status)}>{r.status === 'pending' ? 'waiting' : r.status === 'claimed' ? 'working' : r.status}</Badge>
              </td>
              <td className="text-[12px] text-[var(--ro-muted)]">{ago(r.created)}</td>
              <td className="text-[12px] leading-4 text-[var(--ro-ink-2)]">{clip(r.error !== '' ? r.error : r.result, 200)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------ questions */

function QuestionsTab(): React.JSX.Element {
  const list = useLive((signal) => op<{ asks: Ask[] }>('asks.list', { limit: 100 }, { quiet: true, signal }).then((r) => r.asks), ['asks'], [], 200);
  const [open, setOpen] = useState('');
  if (list.error !== null) return <LoadError message={list.error} onRetry={list.reload} />;
  if (list.data === null) return <Skeleton className="h-32" />;
  if (list.data.length === 0)
    return (
      <Empty icon={MessageSquareText} title="No questions yet">
        Ask about a paper, a project or the whole library; answers come back with the passages they rest on.
      </Empty>
    );
  return (
    <ul className="flex flex-col gap-2">
      {list.data.map((a) => (
        <li key={a.id} className="rounded-[var(--ro-r-md)] border border-[var(--ro-line)] bg-[var(--ro-card)]">
          <button type="button" onClick={() => setOpen(open === a.id ? '' : a.id)} className="flex w-full items-start gap-2 p-3 text-left">
            <MessageSquareText size={14} className="mt-0.5 shrink-0 text-[var(--ro-muted)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-semibold leading-[18px]">{a.question}</span>
              <span className="block text-[12px] text-[var(--ro-muted)]">
                {a.scope === 'library' ? 'The library' : a.scope} · {ago(a.created)}
              </span>
            </span>
            <Badge tone={a.status === 'answered' ? 'good' : a.status === 'failed' ? 'bad' : 'agent'}>{a.status}</Badge>
          </button>
          {open === a.id && (
            <div className="flex flex-col gap-2 border-t border-[var(--ro-hair)] p-3">
              {a.status === 'failed' && <p className="text-[12px] text-[var(--ro-red-text)]">{a.failure}</p>}
              {a.status !== 'answered' && a.status !== 'failed' && (
                <span className="flex items-center gap-1.5 text-[12px] text-[var(--ro-muted)]">
                  <Spinner size={11} /> {a.status === 'working' ? 'Your AI agent is on it' : 'Waiting for your AI agent'}
                </span>
              )}
              {a.answer.map((b, i) =>
                b.type === 'quote' && b.ref ? (
                  <button key={i} type="button" onClick={() => b.ref && navigate('read', { file: b.ref.file, page: String(b.ref.page) })} className="serif border-l-2 border-[var(--ro-accent)] pl-3 text-left text-[13px] leading-5 text-[var(--ro-ink-2)] hover:border-[var(--ro-ink)]">
                    {b.ref.quote}
                    <span className="mt-0.5 flex items-center gap-1 font-sans text-[12px] font-semibold text-[var(--ro-muted)]">
                      <Quote size={11} /> {b.ref.work_label}, p. {b.ref.page}
                    </span>
                  </button>
                ) : b.text ? (
                  <p key={i} className="serif whitespace-pre-wrap text-[14px] leading-[22px]">
                    {b.text}
                  </p>
                ) : null,
              )}
              {a.answer.length === 0 && a.answer_text !== '' && <p className="serif whitespace-pre-wrap text-[14px] leading-[22px]">{a.answer_text}</p>}
              {a.work !== '' && (
                <Button size="sm" variant="ghost" icon={BookOpenText} onClick={() => navigate('paper', { id: a.work })}>
                  The paper
                </Button>
              )}
            </div>
          )}
        </li>
      ))}
    </ul>
  );
}

/* ------------------------------------------------------------ scorecard */

interface ScoreRow {
  kind: string;
  status: string;
  n: number;
}

function ScorecardTab(): React.JSX.Element {
  const s = useLive((signal) => op<Record<'nodes' | 'relations' | 'proposals' | 'identities', ScoreRow[]>>('agent.scorecard', {}, { quiet: true, signal }), ['nodes', 'relations', 'proposals', 'works'], [], 400);
  if (s.error !== null) return <LoadError message={s.error} onRetry={s.reload} />;
  if (s.data === null) return <Skeleton className="h-32" />;
  const groups: { title: string; icon: LucideIcon; rows: ScoreRow[]; kept: string[]; dropped: string[]; waiting: string[] }[] = [
    { title: 'Claims, evidence and questions', icon: Lightbulb, rows: s.data.nodes, kept: ['researcher_confirmed', 'superseded'], dropped: ['researcher_rejected'], waiting: ['agent_proposed'] },
    { title: 'Links', icon: ArrowRight, rows: s.data.relations, kept: ['researcher_confirmed'], dropped: ['researcher_rejected'], waiting: ['agent_proposed'] },
    { title: 'Proposals', icon: Sparkles, rows: s.data.proposals, kept: ['approved'], dropped: ['rejected', 'returned'], waiting: ['waiting'] },
    { title: 'Identifications', icon: FileQuestion, rows: s.data.identities, kept: ['researcher_confirmed'], dropped: [], waiting: ['agent_proposed'] },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 @min-[900px]:grid-cols-2 @min-[1300px]:grid-cols-3">
      {groups.map((g) => {
        const sum = (st: string[]): number => g.rows.filter((r) => st.includes(r.status)).reduce((a, r) => a + r.n, 0);
        const kept = sum(g.kept);
        const dropped = sum(g.dropped);
        const waiting = sum(g.waiting);
        const decided = kept + dropped;
        const rate = decided > 0 ? Math.round((100 * kept) / decided) : null;
        return (
          <Panel key={g.title} title={g.title} actions={<g.icon size={14} className="text-[var(--ro-muted)]" />}>
            {kept + dropped + waiting === 0 ? (
              <p className="text-[12px] text-[var(--ro-muted)]">Nothing yet</p>
            ) : (
              <div className="flex flex-col gap-2">
                <span className="flex items-baseline gap-2">
                  <span className="num text-[26px] font-bold leading-8">{rate === null ? '–' : rate + '%'}</span>
                  <span className="text-[12px] text-[var(--ro-muted)]">kept of {plural(decided, 'decided')}</span>
                </span>
                <span className="flex h-2 overflow-hidden rounded-full bg-[var(--ro-row)]">
                  <span style={{ width: (100 * kept) / Math.max(1, kept + dropped + waiting) + '%', background: 'var(--ro-green)' }} />
                  <span style={{ width: (100 * dropped) / Math.max(1, kept + dropped + waiting) + '%', background: 'var(--ro-red)' }} />
                  <span style={{ width: (100 * waiting) / Math.max(1, kept + dropped + waiting) + '%', background: 'var(--ro-accent)', opacity: 0.5 }} />
                </span>
                <span className="flex gap-3 text-[12px]">
                  <span className="num"><b>{num(kept)}</b> kept</span>
                  <span className="num"><b>{num(dropped)}</b> rejected</span>
                  <span className="num"><b>{num(waiting)}</b> waiting</span>
                </span>
              </div>
            )}
          </Panel>
        );
      })}
    </div>
  );
}
