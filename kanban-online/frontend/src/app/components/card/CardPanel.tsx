/**
 * A card, docked on the right while the board stays in view. At the top,
 * where the agent on it is with it: working (what it is doing, its plan,
 * the lease, Stop), queued for one agent or any agent, asking something
 * (anyone on the team may answer; a plan to approve; criteria to add),
 * handed back or failed (retry or take it), or waiting for review (the
 * evidence and Approve / Request changes / Reject). Then the card's
 * properties (who has it, who asked for it), description, acceptance
 * criteria and checklist, and the activity: comments and decisions as
 * messages from people and agents, each agent's steps folded into
 * "N steps" like CraftBot's actions.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  AlertTriangle,
  ArrowRight,
  ArrowUp,
  Ban,
  Bot,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleDashed,
  CircleDot,
  Clock,
  Hand,
  Lightbulb,
  ListChecks,
  MessageCircleQuestion,
  MoreHorizontal,
  Plus,
  RotateCcw,
  ShieldQuestion,
  Square,
  SquareKanban,
  Tag,
  Trash2,
  Undo2,
  X,
  Zap,
} from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { useApp } from '../../lib/context.tsx';
import { ago, dateInput, time, until } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { Markdown } from '../../lib/markdown.tsx';
import { href, navigate } from '../../lib/router.ts';
import type { CardDetail, CardFull, EventRec, Party } from '../../lib/types.ts';
import { CategoryIcon, LabelDot, PRIORITY_LABEL, PriorityIcon } from '../marks.tsx';
import { AssigneeMenu, PartyChip, assigneeKey, forAgents } from '../people.tsx';
import { AgentAvatar, Button, Dialog, EditableText, IconButton, MenuItem, MenuSep, PartyAvatar, Popover, Spinner, Textarea, errMessage, partyName, useConfirm } from '../ui.tsx';
import { ReviewActions, ReviewPacketView } from './Review.tsx';

const STEP_KINDS = new Set(['claimed', 'action', 'thought', 'note', 'result', 'plan', 'released']);
const REVERTIBLE = new Set(['updated', 'moved', 'assigned', 'proposed', 'created', 'archived', 'restored', 'blocked', 'unblocked']);

export function CardPanel({ id, onClose }: { id: string; onClose: () => void }): React.JSX.Element {
  const live = useLive(() => api.card(id), ['cards', 'events', 'runs', 'columns', 'labels'], [id], 100);
  const d = live.data;
  const [confirmEl, confirm] = useConfirm();
  const [menu, setMenu] = useState(false);
  const [blocking, setBlocking] = useState(false);
  const [reason, setReason] = useState('');
  const menuBtn = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    void api.reportUi({ view: 'card', card: id, board: d?.card.board }).catch(() => undefined);
  }, [id, d?.card.board]);

  if (live.error !== null && d === null) {
    return (
      <Shell onClose={onClose} title="Card">
        <div className="p-6 text-[13px] text-[var(--kb-muted)]">This card is not here any more.</div>
      </Shell>
    );
  }
  if (d === null) {
    return (
      <Shell onClose={onClose} title="Card">
        <div className="flex h-40 items-center justify-center text-[var(--kb-muted)]">
          <Spinner size={18} />
        </div>
      </Shell>
    );
  }
  const c = d.card;
  const err = (e: unknown): void => toast.error(errMessage(e));
  const update = (p: Parameters<typeof api.updateCard>[1]): void => {
    api.updateCard(c.id, p).catch(err);
  };
  return (
    <Shell
      onClose={onClose}
      title={
        <span className="flex min-w-0 items-center gap-2">
          <CategoryIcon category={c.category} />
          <span className="kb-num font-semibold">{c.key}</span>
          <a href={href('board', { id: c.board })} className="truncate text-[var(--kb-muted)] hover:text-[var(--kb-ink)] hover:underline">
            {d.board.name}
          </a>
        </span>
      }
      actions={
        <>
          <IconButton ref={menuBtn} icon={MoreHorizontal} label="More" onClick={() => setMenu((m) => !m)} />
          <Popover anchor={menuBtn} open={menu} onClose={() => setMenu(false)} align="end" width={220}>
            <MenuItem icon={SquareKanban} onClick={() => (setMenu(false), navigate('board', { id: c.board }))}>
              Open its board
            </MenuItem>
            {c.blocked ? (
              <MenuItem icon={Check} onClick={() => (setMenu(false), void api.unblock(c.id).catch(err))}>
                Clear blocked
              </MenuItem>
            ) : (
              <MenuItem
                icon={Ban}
                onClick={() => {
                  setMenu(false);
                  setReason('');
                  setBlocking(true);
                }}
              >
                Flag blocked
              </MenuItem>
            )}
            <MenuSep />
            <MenuItem
              icon={c.archived ? RotateCcw : Square}
              onClick={() => {
                setMenu(false);
                (c.archived ? api.restore([c.id]) : api.archive([c.id])).then(() => toast.info(c.archived ? 'Restored' : 'Archived')).catch(err);
              }}
            >
              {c.archived ? 'Restore' : 'Archive'}
            </MenuItem>
            <MenuItem
              icon={Trash2}
              danger
              onClick={() => {
                setMenu(false);
                void (async () => {
                  if (!(await confirm(`${c.key} and its activity are deleted for good. Archive it instead to keep the history.`, 'Delete this card?'))) return;
                  api
                    .deleteCard(c.id)
                    .then(() => onClose())
                    .catch(err);
                })();
              }}
            >
              Delete
            </MenuItem>
          </Popover>
        </>
      }
      footer={<Composer cardId={c.id} />}
    >
      <div className="flex flex-col gap-5 px-5 pb-6 pt-4">
        <EditableText label="Title" multiline minRows={1} value={c.title} onSave={(v) => v.trim() !== '' && update({ title: v.trim() })} className="border-transparent bg-transparent px-1 text-[17px] font-semibold leading-6 shadow-none hover:border-[var(--kb-line)]" />
        {c.archived && <div className="rounded-[var(--kb-radius-sm)] bg-[var(--kb-card)] px-3 py-2 text-[12.5px] text-[var(--kb-muted)]">This card is archived.</div>}
        <Session d={d} />
        <Properties d={d} />
        {c.blocked && (
          <div className="flex items-start gap-2 rounded-[var(--kb-radius-sm)] bg-[var(--kb-red-soft)] px-3 py-2 text-[13px]">
            <Ban size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--kb-red)]" />
            <span className="flex-1">
              <span className="font-semibold text-[var(--kb-red)]">Blocked</span> · {c.blocked_reason}
            </span>
            <button type="button" onClick={() => void api.unblock(c.id).catch(err)} className="text-[12px] font-medium text-[var(--kb-red)] hover:underline">
              Clear
            </button>
          </div>
        )}
        <TextBlock label="Description" value={c.description} placeholder="Add a description (markdown)…" onSave={(v) => update({ description: v })} />
        <TextBlock label="Acceptance criteria" hint="What done means. Agents check their work against it, one line each." value={c.acceptance} placeholder="One criterion per line…" onSave={(v) => update({ acceptance: v })} />
        <Checklist card={c} />
        <Activity d={d} />
      </div>
      {confirmEl}
      <Dialog
        open={blocking}
        onClose={() => setBlocking(false)}
        title="Flag blocked"
        width={420}
        footer={
          <>
            <Button onClick={() => setBlocking(false)}>Cancel</Button>
            <Button
              variant="primary"
              icon={Ban}
              disabled={reason.trim() === ''}
              onClick={() => {
                setBlocking(false);
                api.block(c.id, reason.trim()).catch(err);
              }}
            >
              Flag blocked
            </Button>
          </>
        }
      >
        <p className="mb-2 text-[12.5px] leading-5 text-[var(--kb-muted)]">It stays in its column and counts toward the WIP limit; agents skip it until someone clears the flag.</p>
        <Textarea autoFocus aria-label="What is it waiting for" value={reason} minRows={2} placeholder="What is it waiting for?" onChange={(e) => setReason(e.target.value)} />
      </Dialog>
    </Shell>
  );
}

function Shell({ title, actions, children, footer, onClose }: { title: React.ReactNode; actions?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode; onClose: () => void }): React.JSX.Element {
  return (
    <aside aria-label="Card" className="kb-slide fixed bottom-0 right-0 top-0 z-40 flex w-full max-w-[600px] flex-col border-l border-[var(--kb-line)] bg-[var(--kb-main)] shadow-[var(--kb-shadow-lg)]">
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--kb-hair)] pl-5 pr-2 text-[13px]">
        <div className="min-w-0 flex-1">{title}</div>
        {actions}
        <IconButton icon={X} label="Close (Esc)" onClick={onClose} />
      </header>
      <div className="kb-scroll min-h-0 flex-1 overflow-y-auto">{children}</div>
      {footer !== undefined && <div className="shrink-0 border-t border-[var(--kb-hair)] px-4 py-3">{footer}</div>}
    </aside>
  );
}

/* ---------------------------------------------------------------- session */

function Box({ tone, icon: Icon, title, children, action }: { tone: 'green' | 'amber' | 'red' | 'blue' | 'violet' | 'neutral'; icon: LucideIcon; title: React.ReactNode; children?: React.ReactNode; action?: React.ReactNode }): React.JSX.Element {
  return (
    <div
      className={cn(
        'flex flex-col gap-2.5 rounded-[var(--kb-radius)] border px-3.5 py-3',
        tone === 'green' && 'border-[color-mix(in_srgb,var(--kb-green),transparent_70%)] bg-[var(--kb-green-soft)]',
        tone === 'amber' && 'border-[color-mix(in_srgb,var(--kb-amber),transparent_70%)] bg-[var(--kb-amber-soft)]',
        tone === 'red' && 'border-[color-mix(in_srgb,var(--kb-red),transparent_70%)] bg-[var(--kb-red-soft)]',
        tone === 'blue' && 'border-[color-mix(in_srgb,var(--kb-blue),transparent_75%)] bg-[var(--kb-blue-soft)]',
        tone === 'violet' && 'border-[color-mix(in_srgb,var(--kb-violet),transparent_70%)] bg-[var(--kb-violet-soft)]',
        tone === 'neutral' && 'border-[var(--kb-hair)] bg-[var(--kb-card)]',
      )}
    >
      <div className="flex items-start gap-2">
        <Icon size={15} aria-hidden className={cn('mt-0.5 shrink-0', tone === 'green' ? 'text-[var(--kb-green)]' : tone === 'amber' ? 'text-[var(--kb-amber)]' : tone === 'red' ? 'text-[var(--kb-red)]' : tone === 'blue' ? 'text-[var(--kb-blue)]' : tone === 'violet' ? 'text-[var(--kb-violet)]' : 'text-[var(--kb-muted)]')} />
        <div className="min-w-0 flex-1 text-[13px] leading-5">{title}</div>
        {action}
      </div>
      {children}
    </div>
  );
}

function PlanSteps({ c }: { c: CardFull }): React.JSX.Element | null {
  if (c.plan_steps.length === 0) return null;
  return (
    <ol className="flex flex-col gap-1 pl-[23px]">
      {c.plan_steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 text-[13px]">
          {s.status === 'done' ? <CheckCircle2 size={14} aria-label="Done" className="mt-0.5 shrink-0 text-[var(--kb-green)]" /> : s.status === 'doing' ? <CircleDot size={14} aria-label="Doing" className="mt-0.5 shrink-0 text-[var(--kb-amber)]" /> : s.status === 'skipped' ? <CircleDashed size={14} aria-label="Skipped" className="mt-0.5 shrink-0 text-[var(--kb-faint)]" /> : <Circle size={14} aria-label="To do" className="mt-0.5 shrink-0 text-[var(--kb-muted)]" />}
          <span className={cn(s.status === 'skipped' && 'text-[var(--kb-muted)] line-through', s.status === 'done' && 'text-[var(--kb-ink-2)]')}>{s.text}</span>
        </li>
      ))}
    </ol>
  );
}

function Session({ d }: { d: CardDetail }): React.JSX.Element | null {
  const app = useApp();
  const c = d.card;
  // The agent on the card: the one working it, else the one it is assigned to.
  const agent = c.claimed_by ?? (c.assignee?.kind === 'agent' ? c.assignee : null);
  const agentName = agent?.name ?? 'The agent';
  const asker = c.question?.by_party ?? agent;
  const askerName = asker?.name ?? 'The agent';
  const mineToReview = c.requester === null || c.requester.id === app.me?.id;
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const err = (e: unknown): void => toast.error(errMessage(e));
  const act = async (fn: () => Promise<unknown>, msg?: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      if (msg !== undefined) toast.success(msg);
      setText('');
    } catch (e) {
      err(e);
    } finally {
      setBusy(false);
    }
  };
  const stop = (
    <Button size="sm" variant="default" icon={Hand} onClick={() => void act(() => api.stop(c.id), 'Stopped. The card is yours.')}>
      Stop
    </Button>
  );

  if (c.review_state === 'pending') {
    return (
      <Box
        tone="blue"
        icon={ShieldQuestion}
        title={
          <span>
            <span className="font-semibold">{mineToReview ? 'Waiting for your review' : 'Waiting for review'}</span>
            {!mineToReview && c.requester !== null && <span className="text-[var(--kb-ink-2)]"> · {c.requester.name} asked for it; anyone on the team may decide</span>}
          </span>
        }
      >
        <div className="pl-[23px]">
          <ReviewPacketView card={c} />
        </div>
        <div className="pl-[23px]">
          <ReviewActions card={c} />
        </div>
      </Box>
    );
  }
  if (c.agent_state === 'working') {
    const col = d.column;
    return (
      <Box
        tone="green"
        icon={Bot}
        title={
          <span>
            <span className="font-semibold">{agentName}</span> is working on it
            {c.progress !== '' && <span className="text-[var(--kb-ink-2)]"> · {c.progress}</span>}
            <div className="text-[12px] text-[var(--kb-muted)]">
              Lease ends in {until(c.lease_until)} · attempt {c.attempt} of {col.max_attempts}
              {c.cost > 0 ? ` · cost ${c.cost.toFixed(2)}` : ''}
            </div>
          </span>
        }
        action={stop}
      >
        <PlanSteps c={c} />
      </Box>
    );
  }
  if (c.agent_state === 'queued') {
    return (
      <Box
        tone="neutral"
        icon={Clock}
        title={
          c.assignee?.kind === 'pool' ? (
            <span>
              Queued for <span className="font-semibold">any agent</span>: the first one with room takes it.
            </span>
          ) : (
            <span>
              Queued for <span className="font-semibold">{agentName}</span>. It takes the card when it has room.
            </span>
          )
        }
        action={stop}
      >
        {c.feedback !== '' && <div className="pl-[23px] text-[12.5px] text-[var(--kb-ink-2)]">It will read: {c.feedback}</div>}
      </Box>
    );
  }
  if (c.agent_state === 'needs_input' && c.question !== null) {
    const q = c.question;
    if (q.kind === 'plan') {
      return (
        <Box tone="amber" icon={ListChecks} title={<span><span className="font-semibold">{askerName}</span> wants a go-ahead on this plan</span>}>
          <PlanSteps c={c} />
          <div className="flex flex-col gap-2 pl-[23px]">
            <Textarea aria-label="What to change in the plan" value={text} minRows={2} placeholder="Or say what to change (it revises the plan)…" onChange={(e) => setText(e.target.value)} />
            <div className="flex gap-2">
              <Button variant="primary" size="sm" icon={Check} busy={busy} onClick={() => void act(() => api.approvePlan(c.id, text.trim() || undefined), 'Plan approved')}>
                Approve plan
              </Button>
              <Button size="sm" icon={RotateCcw} disabled={text.trim() === ''} onClick={() => void act(() => api.answer(c.id, text.trim()), 'Sent back to revise')}>
                Ask to revise
              </Button>
            </div>
          </div>
        </Box>
      );
    }
    const send = (v: string): void => void act(() => api.answer(c.id, v), q.kind === 'criteria' ? 'Criteria added; an agent can start' : `Answered; it goes back to ${askerName}`);
    return (
      <Box tone="amber" icon={q.kind === 'criteria' ? ShieldQuestion : MessageCircleQuestion} title={q.kind === 'criteria' ? <span className="font-semibold">{q.text}</span> : <span><span className="font-semibold">{askerName} asks:</span> {q.text}</span>}>
        <div className="flex flex-col gap-2 pl-[23px]">
          {(q.options ?? []).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {(q.options ?? []).map((o) => (
                <Button key={o} size="sm" variant="pill" onClick={() => send(o)}>
                  {o}
                </Button>
              ))}
            </div>
          )}
          <Textarea aria-label="Your answer" value={text} minRows={2} placeholder={q.kind === 'criteria' ? 'What does done look like? One criterion per line…' : 'Your answer…'} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && text.trim() !== '' && send(text.trim())} />
          <div className="flex gap-2">
            <Button variant="primary" size="sm" icon={ArrowUp} busy={busy} disabled={text.trim() === ''} onClick={() => send(text.trim())}>
              {q.kind === 'criteria' ? 'Add criteria' : 'Answer'}
            </Button>
            <Button size="sm" variant="ghost" icon={Hand} onClick={() => void act(() => api.stop(c.id), 'The card is yours')}>
              Take it over
            </Button>
          </div>
        </div>
      </Box>
    );
  }
  if (c.agent_state === 'needs_attention') {
    const canRetry = forAgents(assigneeKey(c.assignee));
    return (
      <Box tone="red" icon={AlertTriangle} title={<span><span className="font-semibold">Needs attention.</span> {c.attention}</span>}>
        <div className="flex flex-col gap-2 pl-[23px]">
          {canRetry && <Textarea aria-label="Note for the retry" value={text} minRows={1} placeholder={`What should ${c.assignee?.kind === 'pool' ? 'the next agent' : agentName} do differently? (optional)`} onChange={(e) => setText(e.target.value)} />}
          <div className="flex flex-wrap gap-2">
            {canRetry && (
              <Button variant="primary" size="sm" icon={RotateCcw} busy={busy} onClick={() => void act(() => api.retry(c.id, text.trim() || undefined), 'Queued again')}>
                Retry
              </Button>
            )}
            {!canRetry && (
              <Button size="sm" icon={Bot} busy={busy} onClick={() => void act(() => api.assign(c.id, 'pool'), 'Queued for any agent')}>
                Give it to any agent
              </Button>
            )}
            <Button size="sm" variant="ghost" icon={Check} onClick={() => void act(() => api.stop(c.id), 'Cleared; the card is yours')}>
              I'll handle it
            </Button>
          </div>
        </div>
      </Box>
    );
  }
  if (c.proposed) {
    return (
      <Box tone="violet" icon={Lightbulb} title={<span><span className="font-semibold">{partyName(c.created_by)}</span> proposed this card</span>}>
        <div className="flex gap-2 pl-[23px]">
          <Button variant="primary" size="sm" icon={Check} busy={busy} onClick={() => void act(() => api.accept(c.id), 'Accepted')}>
            Accept
          </Button>
          <Button size="sm" variant="ghost" icon={X} onClick={() => void act(() => api.archive([c.id]), 'Dismissed (archived)')}>
            Dismiss
          </Button>
        </div>
      </Box>
    );
  }
  return null;
}

/** Who has the card: you, a teammate, one agent, any agent or nobody. */
function AssigneePicker({ card, columnMode }: { card: CardFull; columnMode: string }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const set = (key: string): void => {
    setOpen(false);
    if (key === assigneeKey(card.assignee)) return;
    api
      .assign(card.id, key)
      .then((r) => {
        const a = r.card.assignee;
        const name = a?.kind === 'pool' ? 'any agent' : (a?.name ?? 'nobody');
        toast.info(r.card.agent_state === 'needs_input' && r.card.question?.kind === 'criteria' ? 'Add acceptance criteria so an agent can start' : r.card.agent_state === 'queued' ? `Queued for ${name}: it starts as soon as it has room` : `Assigned to ${a === null ? 'nobody' : partyName(a)}`);
      })
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <>
      <PickButton ref={ref} onClick={() => setOpen((o) => !o)}>
        <PartyChip party={card.assignee} size={18} />
      </PickButton>
      <Popover anchor={ref} open={open} onClose={() => setOpen(false)} width={250}>
        <AssigneeMenu value={assigneeKey(card.assignee)} only={columnMode === 'any' ? 'agents' : undefined} onPick={set} />
      </Popover>
    </>
  );
}

/* ------------------------------------------------------------- properties */

function Prop({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="grid grid-cols-[110px_1fr] items-center gap-2">
      <span className="text-[12.5px] text-[var(--kb-muted)]">{label}</span>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function PickButton({ children, onClick, ref }: { children: React.ReactNode; onClick: () => void; ref?: React.Ref<HTMLButtonElement> }): React.JSX.Element {
  return (
    <button ref={ref} type="button" onClick={onClick} className="kb-focus inline-flex h-7 max-w-full items-center gap-1.5 rounded-[var(--kb-radius-sm)] px-1.5 text-[13px] hover:bg-[var(--kb-main-hover)]">
      {children}
    </button>
  );
}

function Properties({ d }: { d: CardDetail }): React.JSX.Element {
  const app = useApp();
  const c = d.card;
  const [open, setOpen] = useState<'' | 'status' | 'priority' | 'labels'>('');
  const refs = { status: useRef<HTMLButtonElement | null>(null), priority: useRef<HTMLButtonElement | null>(null), labels: useRef<HTMLButtonElement | null>(null) };
  const err = (e: unknown): void => toast.error(errMessage(e));
  const close = (): void => setOpen('');
  const createdBy = c.created_by !== null && c.created_by.kind !== 'system' ? partyName(c.created_by, app.me?.id).replace(/^You$/, 'you') : undefined;
  return (
    <div className="flex flex-col gap-1">
      <Prop label="Status">
        <PickButton ref={refs.status} onClick={() => setOpen(open === 'status' ? '' : 'status')}>
          <CategoryIcon category={c.category} />
          {c.column_name}
        </PickButton>
        <Popover anchor={refs.status} open={open === 'status'} onClose={close} width={240}>
          {d.columns.map((col) => (
            <MenuItem
              key={col.id}
              selected={col.id === c.column}
              hint={col.agent_mode === 'any' ? 'any agent' : col.agent_mode === 'one' ? 'one agent' : undefined}
              onClick={() => {
                close();
                api
                  .moveCard(c.id, col.id, {})
                  .then((r) => r.warnings.forEach((w) => toast.info(w)))
                  .catch(err);
              }}
            >
              <span className="inline-flex items-center gap-2">
                <CategoryIcon category={col.category} /> {col.name}
              </span>
            </MenuItem>
          ))}
        </Popover>
      </Prop>
      <Prop label="Assignee">
        <AssigneePicker card={c} columnMode={d.column.agent_mode} />
      </Prop>
      <Prop label="Requester">
        <span className="inline-flex px-1.5 text-[13px]" title="The person who asked for it: agents' questions and results go to them">
          <PartyChip party={c.requester} size={18} muted="Nobody yet" />
        </span>
      </Prop>
      <Prop label="Priority">
        <PickButton ref={refs.priority} onClick={() => setOpen(open === 'priority' ? '' : 'priority')}>
          <PriorityIcon priority={c.priority} />
          {PRIORITY_LABEL[c.priority]}
        </PickButton>
        <Popover anchor={refs.priority} open={open === 'priority'} onClose={close} width={180}>
          {[1, 2, 3, 4, 0].map((p) => (
            <MenuItem key={p} selected={p === c.priority} onClick={() => (close(), void api.updateCard(c.id, { priority: p }).catch(err))}>
              <span className="inline-flex items-center gap-2">
                <PriorityIcon priority={p} /> {PRIORITY_LABEL[p]}
              </span>
            </MenuItem>
          ))}
        </Popover>
      </Prop>
      <Prop label="Labels">
        <PickButton ref={refs.labels} onClick={() => setOpen(open === 'labels' ? '' : 'labels')}>
          {c.labels.length === 0 ? (
            <span className="inline-flex items-center gap-1.5 text-[var(--kb-muted)]">
              <Tag size={13} aria-hidden /> Add labels
            </span>
          ) : (
            c.labels.map((l) => (
              <span key={l.id} className="inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[12px] ring-1 ring-inset ring-[var(--kb-hair)]">
                <LabelDot color={l.color} size={7} /> {l.name}
              </span>
            ))
          )}
        </PickButton>
        <Popover anchor={refs.labels} open={open === 'labels'} onClose={close} width={220}>
          {d.labels.length === 0 && <div className="px-2 py-2 text-[12.5px] text-[var(--kb-muted)]">This board has no labels yet (Board settings, Labels).</div>}
          {d.labels.map((l) => {
            const on = c.labels.some((x) => x.id === l.id);
            return (
              <MenuItem key={l.id} selected={on} onClick={() => void api.updateCard(c.id, { labels: on ? c.labels.filter((x) => x.id !== l.id).map((x) => x.id) : [...c.labels.map((x) => x.id), l.id] }).catch(err)}>
                <span className="inline-flex items-center gap-2">
                  <LabelDot color={l.color} /> {l.name}
                </span>
              </MenuItem>
            );
          })}
        </Popover>
      </Prop>
      <Prop label="Due">
        <span className="inline-flex items-center gap-1.5 px-1.5">
          <CalendarDays size={13} aria-hidden className="text-[var(--kb-muted)]" />
          <input type="date" aria-label="Due date" value={dateInput(c.due)} onChange={(e) => void api.updateCard(c.id, { due: e.target.value }).catch(err)} className="h-7 bg-transparent text-[13px] outline-none [color-scheme:inherit]" />
          {c.due !== '' && (
            <button type="button" aria-label="Clear the due date" onClick={() => void api.updateCard(c.id, { due: '' }).catch(err)} className="text-[var(--kb-muted)] hover:text-[var(--kb-ink)]">
              <X size={12} aria-hidden />
            </button>
          )}
        </span>
      </Prop>
      <Prop label="Created">
        <span className="px-1.5 text-[12.5px] text-[var(--kb-ink-2)]">
          {ago(c.created)}
          {createdBy !== undefined ? ` by ${createdBy}` : ''}
          {c.done_at !== '' ? ` · done ${ago(c.done_at)}` : ''}
        </span>
      </Prop>
    </div>
  );
}

/* ------------------------------------------------------------- text, list */

function TextBlock({ label, hint, value, placeholder, onSave }: { label: string; hint?: string; value: string; placeholder: string; onSave: (v: string) => void }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-baseline gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">{label}</h3>
        {hint !== undefined && <span className="truncate text-[11.5px] text-[var(--kb-faint)]">{hint}</span>}
      </div>
      {editing ? (
        <Textarea
          autoFocus
          aria-label={label}
          value={draft}
          minRows={4}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            setEditing(false);
            if (draft !== value) onSave(draft);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              setDraft(value);
              setEditing(false);
            }
          }}
        />
      ) : (
        <button type="button" onClick={() => setEditing(true)} className="kb-focus min-h-9 rounded-[var(--kb-radius-sm)] px-1.5 py-1 text-left hover:bg-[var(--kb-main-hover)]">
          {value.trim() === '' ? <span className="text-[13px] text-[var(--kb-faint)]">{placeholder}</span> : <Markdown text={value} />}
        </button>
      )}
    </section>
  );
}

function Checklist({ card }: { card: CardFull }): React.JSX.Element {
  const [text, setText] = useState('');
  const items = card.checklist_items;
  const done = items.filter((i) => i.done).length;
  const err = (e: unknown): void => toast.error(errMessage(e));
  const add = (): void => {
    const t = text.trim();
    if (t === '') return;
    setText('');
    api.check(card.id, { add: t }).catch(err);
  };
  return (
    <section className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">Checklist</h3>
        {items.length > 0 && (
          <>
            <span className="kb-num text-[12px] text-[var(--kb-muted)]">
              {done}/{items.length}
            </span>
            <span className="h-1 w-24 overflow-hidden rounded-full bg-[var(--kb-card)]">
              <span className="block h-full rounded-full bg-[var(--kb-green)] transition-[width]" style={{ width: `${(done / items.length) * 100}%` }} />
            </span>
          </>
        )}
      </div>
      <div className="flex flex-col">
        {items.map((it, i) => (
          <div key={it.id} className="group flex min-h-8 items-start gap-2 rounded-[var(--kb-radius-sm)] px-1.5 py-1 hover:bg-[var(--kb-main-hover)]">
            <button type="button" role="checkbox" aria-checked={it.done} aria-label={it.text} onClick={() => void api.check(card.id, { item: String(i + 1), done: !it.done }).catch(err)} className={cn('mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-[4px] border-[1.5px]', it.done ? 'border-[var(--kb-ink)] bg-[var(--kb-ink)] text-[var(--kb-main)]' : 'border-[var(--kb-muted)]')}>
              {it.done && <Check size={11} strokeWidth={3} aria-hidden />}
            </button>
            <span className={cn('flex-1 text-[13px] leading-5', it.done && 'text-[var(--kb-muted)] line-through')}>{it.text}</span>
            <button type="button" aria-label="Remove item" onClick={() => void api.check(card.id, { item: it.id, remove: true }).catch(err)} className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100">
              <X size={13} aria-hidden className="text-[var(--kb-muted)] hover:text-[var(--kb-ink)]" />
            </button>
          </div>
        ))}
        <div className="flex items-center gap-2 px-1.5 py-1">
          <Plus size={14} aria-hidden className="shrink-0 text-[var(--kb-muted)]" />
          <input aria-label="Add a checklist item" value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && add()} onBlur={add} placeholder="Add an item" className="h-7 flex-1 bg-transparent text-[13px] outline-none placeholder:text-[var(--kb-faint)]" />
        </div>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- activity */

type Item = { kind: 'event'; ev: EventRec } | { kind: 'steps'; evs: EventRec[]; key: string };

function whoOf(ev: EventRec, meId: string | undefined): string {
  if (ev.actor !== null) return partyName(ev.actor, meId);
  if (ev.actor_kind === 'agent') return 'An agent';
  if (ev.actor_kind === 'rule') return 'A rule';
  return 'The board';
}

function describe(ev: EventRec, meId: string | undefined): string {
  const w = whoOf(ev, meId);
  const b = ev.before as Record<string, unknown> | string | null;
  const a = ev.after as Record<string, unknown> | string | null;
  switch (ev.kind) {
    case 'created':
      return `${w} created the card`;
    case 'proposed':
      return `${w} proposed this card${ev.meta['reason'] ? `: ${String(ev.meta['reason'])}` : ''}`;
    case 'accepted':
      return `${w} accepted the proposal`;
    case 'moved':
      return `${w} moved it from ${(b as { name?: string } | null)?.name ?? '?'} to ${(a as { name?: string } | null)?.name ?? '?'}${ev.text !== '' && ev.text !== 'Undo' ? ` · ${ev.text}` : ''}`;
    case 'assigned':
      return `${w}: ${ev.text}`;
    case 'updated':
      if (ev.field === 'priority') return `${w} set the priority to ${PRIORITY_LABEL[Number(a)] ?? ''}`;
      if (ev.field === 'title') return `${w} renamed it to “${String(a)}”`;
      if (ev.field === 'checklist') return `${w} updated the checklist`;
      if (ev.field === 'labels') return `${w} changed the labels`;
      if (ev.field === 'due') return a ? `${w} set the due date` : `${w} cleared the due date`;
      return `${w} changed the ${ev.field}`;
    case 'blocked':
      return `${w} flagged it blocked: ${ev.text}`;
    case 'unblocked':
      return `${w} cleared the blocked flag`;
    case 'archived':
      return `${w} archived it`;
    case 'restored':
      return `${w} restored it`;
    case 'stopped':
      return `${w} stopped the agent${ev.text ? `: ${ev.text}` : ''}`;
    case 'retried':
      return `${w} asked for another try${ev.text ? `: ${ev.text}` : ''}`;
    case 'expired':
      return 'The agent stopped responding; the card went back to the queue';
    case 'failed':
      return `${w} could not finish: ${ev.text}`;
    case 'returned':
      return `${w} handed it back: ${ev.text}`;
    case 'plan_approved':
      return `${w} approved the plan${ev.text ? `: ${ev.text}` : ''}`;
    case 'rule':
      return ev.text;
    case 'rule_stopped':
    case 'rule_failed':
      return ev.text;
    default:
      return `${w} ${ev.kind.replace(/_/g, ' ')}`;
  }
}

const MESSAGE_KINDS = new Set(['comment', 'question', 'answer', 'submitted', 'approved', 'changes_requested', 'rejected']);

function Activity({ d }: { d: CardDetail }): React.JSX.Element {
  const app = useApp();
  const items = useMemo(() => {
    const out: Item[] = [];
    for (const ev of d.events) {
      const last = out[out.length - 1];
      if (STEP_KINDS.has(ev.kind) && ev.actor_kind === 'agent') {
        if (last !== undefined && last.kind === 'steps' && last.evs[0]?.run === ev.run && last.evs[0]?.actor_id === ev.actor_id) last.evs.push(ev);
        else out.push({ kind: 'steps', evs: [ev], key: ev.id });
      } else out.push({ kind: 'event', ev });
    }
    return out;
  }, [d.events]);
  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-[12px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">Activity</h3>
      <div className="flex flex-col gap-2.5">
        {items.map((it) => (it.kind === 'steps' ? <Steps key={it.key} evs={it.evs} live={d.card.agent_state === 'working' && d.card.run === it.evs[0]?.run} /> : MESSAGE_KINDS.has(it.ev.kind) ? <Message key={it.ev.id} ev={it.ev} /> : <Line key={it.ev.id} ev={it.ev} text={describe(it.ev, app.me?.id)} />))}
      </div>
    </section>
  );
}

function Steps({ evs, live }: { evs: EventRec[]; live: boolean }): React.JSX.Element {
  const [open, setOpen] = useState(live);
  const first = evs[0]!;
  const n = evs.filter((e) => e.kind !== 'claimed' && e.kind !== 'released').length;
  return (
    <div className="flex flex-col">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="kb-focus inline-flex h-7 w-max items-center gap-2 rounded-[var(--kb-radius-sm)] px-1 text-[12.5px] text-[var(--kb-ink-2)] hover:text-[var(--kb-ink)]">
        {live ? <Spinner size={14} className="text-[var(--kb-green)]" /> : <CheckCircle2 size={14} aria-hidden className="text-[var(--kb-green)]" />}
        <AgentAvatar agent={first.actor?.kind === 'agent' ? first.actor : null} size={16} />
        <span>
          {first.actor?.name ?? 'Agent'} · {n === 0 ? 'started work' : `${n} step${n === 1 ? '' : 's'}`}
          {first.meta['attempt'] !== undefined && Number(first.meta['attempt']) > 1 ? ` · attempt ${String(first.meta['attempt'])}` : ''}
        </span>
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <span className="text-[var(--kb-faint)]">{time(first.created)}</span>
      </button>
      {open && (
        <ol className="ml-[15px] mt-1 flex flex-col gap-1.5 border-l border-[var(--kb-line)] pl-4">
          {evs.map((e) => (
            <li key={e.id} className="text-[12.5px] leading-[18px]">
              <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--kb-faint)]">{e.kind === 'claimed' ? 'start' : e.kind}</span>
              {e.kind === 'plan' ? <Markdown text={e.text} className="text-[12.5px]" /> : <span className="text-[var(--kb-ink-2)]">{e.text}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function Message({ ev }: { ev: EventRec }): React.JSX.Element {
  const app = useApp();
  const mine = ev.actor?.kind === 'person' && ev.actor.id === app.me?.id;
  const label: Record<string, string> = { question: 'asked', answer: 'answered', submitted: 'submitted for review', approved: 'approved', changes_requested: 'requested changes', rejected: 'rejected' };
  const tone = ev.kind === 'approved' ? 'border-[color-mix(in_srgb,var(--kb-green),transparent_65%)]' : ev.kind === 'changes_requested' || ev.kind === 'rejected' ? 'border-[color-mix(in_srgb,var(--kb-red),transparent_65%)]' : ev.kind === 'question' ? 'border-[color-mix(in_srgb,var(--kb-amber),transparent_60%)]' : 'border-[var(--kb-hair)]';
  return (
    <div className={cn('flex gap-2.5', mine && 'flex-row-reverse')}>
      <div className="pt-0.5">{ev.actor !== null ? <PartyAvatar party={ev.actor as Party} size={24} /> : <span className="flex size-6 items-center justify-center rounded-full bg-[var(--kb-card)] text-[var(--kb-muted)]"><Zap size={12} aria-hidden /></span>}</div>
      <div className={cn('min-w-0 max-w-[88%] rounded-[var(--kb-radius)] border px-3 py-2', tone, mine ? 'bg-[var(--kb-accent-soft)]' : 'bg-[var(--kb-card)]')}>
        <div className="mb-0.5 flex items-center gap-2 text-[12px]">
          <span className="font-semibold">{whoOf(ev, app.me?.id)}</span>
          {label[ev.kind] !== undefined && <span className="text-[var(--kb-muted)]">{label[ev.kind]}</span>}
          <span className="ml-auto text-[11.5px] text-[var(--kb-faint)]" title={ev.created}>
            {ago(ev.created)}
          </span>
        </div>
        {ev.text !== '' && <Markdown text={ev.text} />}
      </div>
    </div>
  );
}

function Line({ ev, text }: { ev: EventRec; text: string }): React.JSX.Element {
  const icon: LucideIcon = ev.kind === 'moved' ? ArrowRight : ev.kind === 'failed' || ev.kind === 'expired' || ev.kind === 'rule_failed' ? AlertTriangle : ev.kind === 'rule' || ev.kind === 'rule_stopped' ? Zap : ev.kind === 'assigned' ? Bot : ev.kind === 'blocked' ? Ban : Circle;
  const Icon = icon;
  const canRevert = REVERTIBLE.has(ev.kind) && !ev.reverted;
  return (
    <div className="group flex items-start gap-2 px-1 text-[12.5px] leading-[18px] text-[var(--kb-ink-2)]">
      <Icon size={12} aria-hidden className={cn('mt-[3px] shrink-0', ev.kind === 'failed' || ev.kind === 'expired' ? 'text-[var(--kb-red)]' : 'text-[var(--kb-faint)]')} />
      <span className={cn('min-w-0 flex-1', ev.reverted && 'line-through opacity-60')}>{text}</span>
      <span className="shrink-0 text-[11.5px] text-[var(--kb-faint)]" title={ev.created}>
        {ago(ev.created)}
      </span>
      {canRevert && (
        <button type="button" aria-label="Revert this change" title="Revert this change" onClick={() => void api.revert(ev.id).then((r) => toast.info(r.done.join(', ') || 'Reverted')).catch((err: unknown) => toast.error(errMessage(err)))} className="shrink-0 text-[var(--kb-muted)] opacity-0 transition-opacity hover:text-[var(--kb-ink)] group-hover:opacity-100 focus:opacity-100">
          <Undo2 size={12} aria-hidden />
        </button>
      )}
    </div>
  );
}

function Composer({ cardId }: { cardId: string }): React.JSX.Element {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (): Promise<void> => {
    const t = text.trim();
    if (t === '') return;
    setBusy(true);
    try {
      await api.comment(cardId, t);
      setText('');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="kb-field flex items-end gap-2 rounded-[var(--kb-radius-lg)] px-3 py-2">
      <Textarea
        aria-label="Comment"
        value={text}
        minRows={1}
        placeholder="Comment… an agent on the card reads it with its next heartbeat (Ctrl+Enter)"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            void send();
          }
        }}
        className="max-h-40 border-0 bg-transparent px-0 py-1 shadow-none focus:shadow-none"
      />
      <button type="button" aria-label="Send comment" disabled={text.trim() === '' || busy} onClick={() => void send()} className="kb-focus mb-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--kb-ink)] text-[var(--kb-main)] transition-opacity disabled:opacity-25">
        {busy ? <Spinner size={14} /> : <ArrowUp size={15} strokeWidth={2.2} aria-hidden />}
      </button>
    </div>
  );
}
