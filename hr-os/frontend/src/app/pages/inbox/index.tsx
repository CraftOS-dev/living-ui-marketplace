/**
 * Inbox: every decision waiting for you (approvals with the context to
 * decide, one tap to approve), your AI agent's proposals with before and
 * after, the requests you made, and your questions to your AI agent with
 * their state and answers.
 * Filters by kind; empty views say so in one line.
 */
import { useMemo, useState } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Check, ListChecks, Send, Sparkle } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, Avatar, Button, Checkbox, Empty, ItemFacts, LinkButton, LoadError, Loading, Money, PageBody, PageHeader, PersonChip, Segmented, StatusDot, Tabs, Tag, Textarea } from '../../components/ui.tsx';
import type { ItemFact } from '../../components/ui.tsx';
import { AskBox } from '../../components/shell/AgentPanel.tsx';
import type { Question } from '../../components/shell/AgentPanel.tsx';
import { AgentAskStatus } from '../../components/agent.tsx';
import { sections, useShellCounts } from '../../components/shell/counts.ts';
import { askPin, op } from '../../lib/api.ts';
import { DecisionButton, DecisionRow, OUTCOME_ICON, decide } from '../../components/decision.tsx';
import type { ApprovalViewProps, InboxSection, PageProps, RouteDef } from '../../lib/contract.ts';
import { ago, dayOf, fmtDay, humanize, relDay, today } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { kindLabel } from '../../lib/kinds.ts';
import { act, changed, drop, patch, reshape, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { MODULE_EXPORTS } from '../../routes.tsx';

export interface Approval {
  id: string;
  kind: string;
  ref_collection: string;
  ref_id: string;
  entity: string;
  employment: string;
  employee: string;
  employee_name: string;
  requester: string;
  requester_name: string;
  requester_actor: 'person' | 'agent' | 'system';
  steps: { type: string; role?: string; member?: string; label?: string }[];
  step: number;
  approvers: string[];
  approver_role: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  decided_by: string;
  decided_by_name: string;
  decided_at: string;
  note: string;
  summary: string;
  amount_minor: number;
  currency: string;
  payload: Record<string, unknown>;
  /** Structured facts (days, money, states); the summary is for the CLI and shows only when there are none. */
  facts?: ItemFact[] | undefined;
  history: { at?: string; who?: string; decision?: string; note?: string }[];
  needs_pin: boolean;
  due: string;
  created: string;
}

export interface Proposal {
  id: string;
  kind: string;
  title: string;
  why: string;
  origin: 'agent' | 'rule';
  status: string;
  risk: 'low' | 'medium' | 'high' | '';
  target: string;
  note: string;
  items: { index: number; op: string; label: string; fields: { name: string; before: unknown; after: unknown }[]; notes: string[]; risk: string; state: string; error: string }[];
  created: string;
}

type View = 'approvals' | 'proposals' | 'requests' | 'agent';


const READS = ['approvals', 'proposals', 'agent_questions'];

/** The shell's counts drop with the decision at once (tabs, header, sidebar badge), not after the reload. */
function fewer(key: 'approvals_total' | 'proposals_total', n = 1): ReturnType<typeof reshape> {
  return reshape('shell.home', (d) => {
    const h = d as Record<string, unknown>;
    return { ...h, [key]: Math.max(0, Number(h[key] ?? 0) - n) };
  });
}

function shown(v: unknown): string {
  if (v === null || v === undefined || v === '') return t('ui.none');
  if (typeof v === 'boolean') return v ? t('ui.yes') : t('ui.no');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** The decision context a module draws for its approval kind (registry from every index.tsx). */
function approvalView(kind: string): ComponentType<ApprovalViewProps> | null {
  for (const m of Object.values(MODULE_EXPORTS)) {
    const v = m.approvalViews?.[kind];
    if (v !== undefined) return v;
  }
  return null;
}

/** The card's heading: the kind and the person when the server sent facts, else its plain summary. */
function approvalTitle(a: Approval): string {
  return (a.facts ?? []).length > 0 ? kindLabel(a.kind) : a.summary;
}

/**
 * The one shape of every Inbox card (approvals of each kind, proposals): the
 * mark (your AI agent, or the person asking) on the left, and on one left
 * edge beside it the tag row, the title 8px under it, the quote or facts 8px
 * under that, then the preview and the actions 12px apart.
 */
function CardShell({ id, mark, tags, title, aside, quote, preview, children }: { id: string; mark: ReactNode; tags: ReactNode; title: ReactNode; aside?: ReactNode; quote?: ReactNode; preview?: ReactNode; children?: ReactNode }): React.JSX.Element {
  return (
    <DecisionRow id={id} className="hr-panel hr-in grid grid-cols-[26px_minmax(0,1fr)] gap-x-3 p-3.5">
      <span className="flex h-5 items-center">{mark}</span>
      <div className="flex min-w-0 flex-col">
        <div className="flex min-h-5 flex-wrap items-center gap-1.5">{tags}</div>
        <div className="mt-2 flex items-start gap-3">
          <div className="hr-wrap min-w-0 flex-1 text-[14px] font-medium leading-5">{title}</div>
          {aside}
        </div>
        {quote !== undefined && quote !== null && quote !== false && <div className="mt-2 min-w-0">{quote}</div>}
        {preview !== undefined && preview !== null && preview !== false && <div className="mt-3 min-w-0">{preview}</div>}
        {children !== undefined && children !== null && children !== false && <div className="mt-3 min-w-0">{children}</div>}
      </div>
    </DecisionRow>
  );
}

function ApprovalCard({ a, mine }: { a: Approval; mine: boolean }): React.JSX.Element {
  const [rejecting, setRejecting] = useState(false);
  const facts = a.facts ?? [];
  const title = approvalTitle(a);
  const moneyFact = facts.some((f) => f.type === 'money');
  const [note, setNote] = useState('');
  const Ctx = approvalView(a.kind);
  // The row shows the outcome and folds away, then the decision goes (a PIN, when needed, is asked first).
  const run = async (decision: 'approved' | 'rejected'): Promise<void> => {
    let pin: string | undefined;
    if (a.needs_pin) {
      const got = await askPin({ title: decision === 'approved' ? t('inbox.approve') : t('inbox.reject'), text: a.employee_name !== '' ? `${title} \u00b7 ${a.employee_name}` : title });
      if (got === null) return;
      pin = got;
    }
    const why = note.trim() === '' ? undefined : note.trim();
    decide(a.id, decision, () => act([drop(a.id), fewer('approvals_total')], () => op('approvals.decide', { approval: a.id, decision, note: why, pin }), READS));
  };
  const stepLabel = a.steps.length > 1 ? t('inbox.step', { n: a.step + 1, of: a.steps.length }) : '';
  const asker = a.requester_name !== '' ? a.requester_name : a.employee_name;
  return (
    <CardShell
      id={a.id}
      mark={a.requester_actor === 'agent' ? <AgentMark size={26} /> : <Avatar name={asker !== '' ? asker : '?'} size={26} />}
      tags={
        <>
          {facts.length === 0 && <Tag>{kindLabel(a.kind)}</Tag>}
          {a.requester_actor === 'agent' && <Tag tone="agent">{t('ui.agent_short')}</Tag>}
          {a.needs_pin && <Tag tone="warn">{t('inbox.pin')}</Tag>}
          {stepLabel !== '' && <span className="hr-label">{stepLabel}</span>}
          <span className="hr-label">{ago(a.created)}</span>
        </>
      }
      title={title}
      aside={!moneyFact && a.amount_minor !== 0 && a.currency !== '' ? <Money minor={a.amount_minor} currency={a.currency} display="auto" className="text-[15px]" /> : undefined}
      quote={
        <div className="flex flex-col gap-1">
          {facts.length > 0 && Ctx === null && <ItemFacts facts={facts} entity={a.entity} labelled skip={a.employee_name !== '' ? ['person', 'employee'] : undefined} className="text-[13px]" />}
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[var(--hr-muted)]">
            {a.employee_name !== '' && <PersonChip name={a.employee_name} size={18} strong={false} />}
            {a.requester_name !== '' && a.requester_name !== a.employee_name && <span>{t('inbox.by', { who: a.requester_name })}</span>}
            {a.due !== '' && <span className={dayOf(a.due, { entity: a.entity }) < today({ entity: a.entity }) ? 'text-[var(--hr-bad)]' : ''}>{t('inbox.due', { when: relDay(dayOf(a.due, { entity: a.entity }), today({ entity: a.entity })) })}</span>}
          </div>
        </div>
      }
      preview={
        Ctx !== null && (
          <div className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] p-3">
            <Ctx approval={a as unknown as Record<string, unknown>} />
          </div>
        )
      }
    >
      {a.status === 'pending' && mine && (
        <div className="flex flex-col gap-2">
          {rejecting && <Textarea value={note} onChange={(e) => setNote(e.target.value)} minRows={2} placeholder={t('inbox.reason_ph')} aria-label={t('inbox.reason')} autoFocus />}
          <div className="flex flex-wrap items-center justify-end gap-2">
            {rejecting ? (
              <>
                <Button variant="ghost" onClick={() => setRejecting(false)}>
                  {t('ui.cancel')}
                </Button>
                <DecisionButton outcome="rejected" variant="danger" onClick={() => void run('rejected')}>
                  {t('inbox.reject')}
                </DecisionButton>
              </>
            ) : (
              <>
                <DecisionButton outcome="rejected" onClick={() => setRejecting(true)}>
                  {t('inbox.reject')}
                </DecisionButton>
                <DecisionButton outcome="approved" onClick={() => void run('approved')}>
                  {t('inbox.approve')}
                </DecisionButton>
              </>
            )}
          </div>
        </div>
      )}
      {!mine && a.status === 'pending' && (
        <div className="flex items-center justify-between gap-2">
          <StatusDot tone="warn" label={t('inbox.waiting')} />
          <LinkButton tone="danger" onClick={() => void act([patch(a.id, { status: 'cancelled' })], () => op('approvals.cancel', { approval: a.id }), READS)}>
            {t('inbox.withdraw')}
          </LinkButton>
        </div>
      )}
      {a.status !== 'pending' && (
        <StatusDot tone={a.status === 'approved' ? 'good' : a.status === 'rejected' ? 'bad' : 'faint'} label={`${t(`inbox.status.${a.status}`)}${a.decided_by_name !== '' ? ' · ' + a.decided_by_name : ''}${a.note !== '' ? ' · ' + a.note : ''}`} />
      )}
    </CardShell>
  );
}

function ProposalCard({ p }: { p: Proposal }): React.JSX.Element {
  const [picked, setPicked] = useState<Set<number>>(() => new Set(p.items.map((i) => i.index)));
  const many = p.items.length > 1;
  const accept = (): void => {
    const items = many ? [...picked] : undefined;
    decide(p.id, 'accepted', () => act([drop(p.id), fewer('proposals_total')], () => op('proposals.accept', { proposal: p.id, items }), READS));
  };
  const dismiss = (): void => decide(p.id, 'dismissed', () => act([drop(p.id), fewer('proposals_total')], () => op('proposals.dismiss', { proposal: p.id }), READS));
  return (
    <CardShell
      id={p.id}
      mark={<AgentMark size={26} />}
      tags={
        <>
          <Tag>{t(`kind.p.${p.kind}`)}</Tag>
          {p.risk !== '' && <Tag tone={p.risk === 'high' ? 'bad' : p.risk === 'medium' ? 'warn' : 'neutral'}>{t(`inbox.risk.${p.risk}`)}</Tag>}
          <span className="hr-label">{ago(p.created)}</span>
        </>
      }
      title={p.title}
      quote={p.why !== '' && <p className="hr-wrap border-l-2 border-[var(--hr-agent)] pl-2.5 text-[13px] leading-[18px] text-[var(--hr-ink-2)]">{p.why}</p>}
      preview={
        <ul className="flex flex-col gap-2">
          {p.items.map((it) => (
            <li key={it.index} className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-sunk)] p-2.5">
              <div className="flex items-start gap-2">
                {many && <Checkbox checked={picked.has(it.index)} onChange={(v) => setPicked((s) => { const n = new Set(s); if (v) n.add(it.index); else n.delete(it.index); return n; })} label={it.label} hideLabel />}
                <span className="hr-wrap min-w-0 flex-1 text-[13px] font-medium">{it.label}</span>
              </div>
              {it.fields.length > 0 && (
                <dl className="mt-2 grid grid-cols-[minmax(90px,auto)_1fr] gap-x-3 gap-y-1 text-[12px]">
                  {it.fields.map((f) => (
                    <div key={f.name} className="contents">
                      <dt className="text-[var(--hr-muted)]">{humanize(f.name)}</dt>
                      <dd className="hr-wrap min-w-0">
                        {f.before !== '' && f.before !== null && f.before !== undefined && (
                          <>
                            <span className="text-[var(--hr-muted)] line-through decoration-[var(--hr-line-2)]">{shown(f.before)}</span>
                            <span className="mx-1.5 text-[var(--hr-faint)]">{'>'}</span>
                          </>
                        )}
                        <span className="font-medium">{shown(f.after)}</span>
                      </dd>
                    </div>
                  ))}
                </dl>
              )}
              {it.notes.map((n, i) => (
                <p key={i} className="hr-wrap mt-1.5 text-[12px] text-[var(--hr-muted)]">
                  {n}
                </p>
              ))}
            </li>
          ))}
        </ul>
      }
    >
      <div className="flex flex-wrap items-center justify-end gap-2">
        <DecisionButton outcome="dismissed" onClick={dismiss}>
          {t('inbox.dismiss')}
        </DecisionButton>
        <DecisionButton outcome="accepted" disabled={many && picked.size === 0} onClick={accept}>
          {many && picked.size < p.items.length ? t('inbox.accept_n', { n: picked.size }) : t('inbox.accept')}
        </DecisionButton>
      </div>
    </CardShell>
  );
}

function QuestionRowFull({ q }: { q: Question }): React.JSX.Element {
  return (
    <li className="hr-panel hr-in flex flex-col gap-2 p-3.5">
      <div className="flex flex-wrap items-center gap-2">
        {q.status === 'answered' ? <StatusDot tone="neutral" label={t('agent.answered')} /> : q.status === 'cancelled' ? <StatusDot tone="faint" label={t('agent.cancelled')} /> : <AgentAskStatus ask={q.ask} reads={['agent_questions']} />}
        <span className="flex-1" />
        <span className="hr-label">{ago(q.created)}</span>
        {q.status === 'asked' && (
          <LinkButton tone="danger" onClick={() => void act([patch(q.id, { status: 'cancelled' })], () => op('questions.cancel', { question: q.id }), ['agent_questions'])}>
            {t('ui.cancel')}
          </LinkButton>
        )}
      </div>
      <div className="hr-wrap text-[13px] leading-5">{q.question}</div>
      {q.answer !== '' && <div className="hr-wrap whitespace-pre-wrap border-l-2 border-[var(--hr-agent)] pl-2.5 text-[13px] leading-5 text-[var(--hr-ink-2)]">{q.answer}</div>}
    </li>
  );
}

/**
 * A module's block in "For you": its open items as rows that open, with their small actions. One grid for
 * the block (person, item, due, actions; each row is a subgrid of it), so every column starts at one x.
 */
function SectionBlock({ section }: { section: InboxSection }): React.JSX.Element | null {
  // The items come from the shell's one read (the section's hook runs once, in the provider).
  const items = useShellCounts().items[section.key] ?? null;
  if (items === null || items.length === 0) return null;
  const now = today();
  const people = items.some((it) => it.person !== undefined && it.person !== '');
  return (
    <section className="hr-in mt-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="hr-label flex-1">{section.label}</span>
        <span className="hr-label">{items.length}</span>
      </div>
      <ul className={cn('hr-panel grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 px-4', people ? 'sm:grid-cols-[176px_minmax(0,1fr)_auto_auto]' : 'sm:grid-cols-[minmax(0,1fr)_auto_auto]')}>
        {items.map((it) => {
          const due = it.due !== undefined && it.due !== '' ? <span className={cn('hr-label whitespace-nowrap', it.due < now && '!text-[var(--hr-bad)]')}>{t('inbox.due', { when: relDay(it.due) })}</span> : null;
          return (
            <DecisionRow key={it.id} id={it.id} className="col-span-full grid min-h-[52px] grid-cols-subgrid items-center border-b border-[var(--hr-hair)] py-2 last:border-b-0">
              {people && <span className="hidden min-w-0 sm:block">{it.person !== undefined && it.person !== '' && <PersonChip name={it.person} size={22} strong={false} className="max-w-full" />}</span>}
              <a href={it.link ?? '#/inbox'} className="hr-focus hr-tap flex min-w-0 flex-col justify-center rounded-[3px]">
                <span className="hr-wrap hr-link block text-[13px] font-medium">{it.title}</span>
                {it.sub !== undefined && it.sub !== '' && <span className="block truncate text-[12px] text-[var(--hr-muted)]">{it.sub}</span>}
                {due !== null && <span className="sm:hidden">{due}</span>}
              </a>
              <span className="hidden sm:block">{due}</span>
              <span className="flex items-center justify-end gap-2">
                {(it.actions ?? []).map((a) => {
                  const out = a.outcome;
                  return (
                    <Button key={a.label} size="sm" icon={out !== undefined ? OUTCOME_ICON[out] : a.primary === true ? Check : undefined} onClick={() => (out !== undefined ? decide(it.id, out, a.run) : void a.run())}>
                      {a.label}
                    </Button>
                  );
                })}
              </span>
            </DecisionRow>
          );
        })}
      </ul>
    </section>
  );
}

function KindFilter({ kinds, value, onChange }: { kinds: string[]; value: string; onChange: (v: string) => void }): React.JSX.Element | null {
  if (kinds.length < 2) return null;
  return <Segmented value={value} onChange={onChange} label={t('inbox.kind')} size="sm" options={[{ value: '', label: t('inbox.all_kinds') }, ...kinds.map((k) => ({ value: k, label: kindLabel(k) }))]} />;
}

function InboxPage({ query }: PageProps): React.JSX.Element {
  const counts = useShellCounts();
  const view = (['approvals', 'proposals', 'requests', 'agent'] as View[]).includes(query.get('view') as View) ? (query.get('view') as View) : 'approvals';
  const kind = query.get('kind') ?? '';
  const approvals = useOp<{ approvals: Approval[]; total: number }>('approvals.list', { view: 'mine', status: 'pending', limit: 200 }, ['approvals'], { name: 'inbox.approvals' });
  const proposals = useOp<{ proposals: Proposal[]; total: number }>('proposals.list', { status: 'pending', limit: 100 }, ['proposals'], { name: 'inbox.proposals', skip: view !== 'proposals' });
  const requests = useOp<{ approvals: Approval[]; total: number }>('approvals.list', { view: 'requested', status: 'any', limit: 100 }, ['approvals'], { name: 'inbox.requests', skip: view !== 'requests' });
  const questions = useOp<{ questions: Question[]; total: number }>('questions.list', { limit: 100 }, ['agent_questions'], { name: 'inbox.questions', skip: view !== 'agent' });

  const list = view === 'approvals' ? approvals : view === 'requests' ? requests : null;
  const items = useMemo(() => (list?.data?.approvals ?? []).filter((a) => kind === '' || a.kind === kind), [list?.data, kind]);
  const kinds = useMemo(() => [...new Set((list?.data?.approvals ?? []).map((a) => a.kind))].sort(), [list?.data]);

  const tabs = [
    { value: 'approvals' as const, label: t('inbox.approvals'), count: counts.approvals + counts.sections },
    { value: 'proposals' as const, label: t('inbox.proposals'), count: counts.proposals },
    { value: 'requests' as const, label: t('inbox.requests') },
    { value: 'agent' as const, label: t('inbox.jobs'), count: counts.questions },
  ];
  const approveAll = (): void => {
    const pinFree = items.filter((a) => !a.needs_pin);
    decide(
      pinFree.map((a) => a.id),
      'approved',
      () =>
        act(
          [...pinFree.map((a) => drop(a.id)), fewer('approvals_total', pinFree.length)],
          async () => {
            for (const a of pinFree) await op('approvals.decide', { approval: a.id, decision: 'approved' });
            return true;
          },
          READS,
        ),
    );
  };

  return (
    <>
      <PageHeader title={t('inbox.title')} meta={t('inbox.meta', { n: counts.inbox })} />
      <PageBody className="max-w-[980px]">
        <Tabs value={view} onChange={(v) => setQuery({ view: v === 'approvals' ? undefined : v, kind: undefined })} tabs={tabs} label={t('inbox.title')} className="mb-3" />
        {(view === 'approvals' || view === 'requests') && (
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <KindFilter kinds={kinds} value={kind} onChange={(v) => setQuery({ kind: v === '' ? undefined : v })} />
            <span className="flex-1" />
            {view === 'approvals' && items.filter((a) => !a.needs_pin).length > 1 && (
              <DecisionButton outcome="approved" size="sm" variant="primary" onClick={approveAll}>
                {tn('inbox.approve_all', items.filter((a) => !a.needs_pin).length)}
              </DecisionButton>
            )}
          </div>
        )}
        {view === 'agent' ? (
          <div className="flex flex-col gap-3">
            <AskBox />
            {questions.data === null ? (
              questions.error !== null ? <LoadError message={questions.error} onRetry={questions.reload} /> : <Loading />
            ) : questions.data.questions.length === 0 ? (
              <Empty icon={Sparkle} title={t('inbox.no_jobs')}>
                {t('inbox.no_jobs_text')}
              </Empty>
            ) : (
              <ul className="flex flex-col gap-2">
                {questions.data.questions.map((q) => (
                  <QuestionRowFull key={q.id} q={q} />
                ))}
              </ul>
            )}
          </div>
        ) : view === 'proposals' ? (
          proposals.data === null ? (
            proposals.error !== null ? <LoadError message={proposals.error} onRetry={proposals.reload} /> : <Loading />
          ) : proposals.data.proposals.length === 0 ? (
            <Empty icon={Sparkle} title={t('inbox.no_proposals')}>
              {t('inbox.no_proposals_text')}
            </Empty>
          ) : (
            <ul className="flex flex-col gap-2">
              {proposals.data.proposals.map((p) => (
                <ProposalCard key={p.id} p={p} />
              ))}
            </ul>
          )
        ) : list === null || list.data === null ? (
          list?.error !== null && list?.error !== undefined ? <LoadError message={list.error} onRetry={list.reload} /> : <Loading />
        ) : items.length === 0 ? (
          view === 'approvals' ? (
            counts.sections > 0 ? null : (
              <Empty icon={ListChecks} title={t('inbox.clear')}>
                {t('inbox.clear_text')}
              </Empty>
            )
          ) : (
            <Empty icon={Send} title={t('inbox.no_requests')} />
          )
        ) : (
          <ul className={cn('flex flex-col gap-2')}>
            {items.map((a) => (
              <ApprovalCard key={a.id} a={a} mine={view === 'approvals'} />
            ))}
          </ul>
        )}
        {view === 'approvals' && sections().map((s) => <SectionBlock key={s.key} section={s} />)}
      </PageBody>
    </>
  );
}

export const routes: RouteDef[] = [{ path: '/inbox', page: InboxPage, title: t('inbox.title') }];
