/**
 * Working with your AI agent on the screens: asking it for a piece of work
 * (and following the request honestly: asked, working, done, or "no agent
 * connected yet"), its proposals as cards whose items a person ticks (Apply
 * selected, Send back with a note, Decline), and its field suggestions as
 * dashed chips.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, CornerUpLeft, Send, Sparkles, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast, useAgentRequest } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { act, ALL, changed, drop, useLive } from '../lib/live.ts';
import { leave } from '../lib/motion.ts';
import { ago } from '../lib/format.ts';
import type { Proposal, Suggestion } from '../lib/types.ts';
import { Button, Spinner, textareaCls } from './ui.tsx';
import type { ButtonSize, ButtonVariant } from './ui.tsx';

/* --------------------------------------------------------------- asking */

const asked = new Map<string, { id: string; at: number }>();

export function AgentButton({
  kind,
  params = {},
  label,
  icon = Sparkles,
  variant = 'soft',
  size = 'md',
  className,
  onAsked,
}: {
  kind: 'day_plan' | 'inbox' | 'breakdown' | 'habit_help' | 'recap';
  params?: Record<string, string> | undefined;
  label: string;
  icon?: LucideIcon | undefined;
  variant?: ButtonVariant | undefined;
  size?: ButtonSize | undefined;
  className?: string | undefined;
  onAsked?: (() => void) | undefined;
}): React.JSX.Element {
  const key = kind + ':' + JSON.stringify(params);
  const [req, setReq] = useState<string | null>(() => {
    const a = asked.get(key);
    return a !== undefined && Date.now() - a.at < 30 * 60 * 1000 ? a.id : null;
  });
  const [busy, setBusy] = useState(false);
  const { request, working } = useAgentRequest(req);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (request === null || request.status !== 'pending') {
      setStale(false);
      return;
    }
    const t = setTimeout(() => setStale(true), 25000);
    return () => clearTimeout(t);
  }, [request]);
  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ request: string }>('agent.request', { kind, ...params });
      asked.set(key, { id: r.request, at: Date.now() });
      setReq(r.request);
      onAsked?.();
    } finally {
      setBusy(false);
    }
  };
  let note: string | null = null;
  if (request !== null) {
    if (request.status === 'pending') note = stale ? 'Waiting: no agent has picked this up yet' : 'Asked';
    else if (request.status === 'claimed') note = 'Working on it';
    else if (request.status === 'done') note = 'Done';
    else note = 'Could not: ' + (request.error || 'refused');
  }
  return (
    <span className={cn('inline-flex flex-wrap items-center gap-2', className)}>
      <Button variant={variant} size={size} icon={icon} loading={busy || (working && request?.status === 'claimed')} onClick={() => void ask()} disabled={working && !stale}>
        {label}
      </Button>
      {note !== null && (
        <span className={cn('inline-flex items-center gap-1.5 text-[12px] font-semibold', request?.status === 'rejected' ? 'text-[var(--lo-red-text)]' : 'text-[var(--lo-muted)]')} title={request?.result || undefined}>
          {request?.status === 'claimed' && <Spinner size={11} />}
          {note}
        </span>
      )}
    </span>
  );
}

/* ------------------------------------------------------------ proposals */

export function useProposals(kinds?: string[] | undefined): { proposals: Proposal[]; loading: boolean } {
  const live = useLive<{ proposals: Proposal[] }>((signal) => op('proposals.list', {}, { quiet: true, signal }), ['proposals'], []);
  const all = live.data?.proposals ?? [];
  return { proposals: kinds === undefined ? all : all.filter((p) => kinds.includes(p.kind)), loading: live.loading };
}

function Changes({ p }: { p: Proposal }): React.JSX.Element | null {
  const pv = (p.preview ?? {}) as { changes?: Record<string, { from: unknown; to: unknown }> | undefined; fields?: Record<string, unknown> | undefined };
  const rows: [string, string][] = [];
  if (pv.changes !== undefined) for (const [k, v] of Object.entries(pv.changes)) rows.push([k.replace(/_/g, ' '), String(v.to ?? '')]);
  else if (pv.fields !== undefined) for (const [k, v] of Object.entries(pv.fields)) if (v !== '' && v !== undefined && k !== 'why') rows.push([k.replace(/_/g, ' '), typeof v === 'object' ? JSON.stringify(v) : String(v)]);
  if (rows.length === 0) return null;
  return (
    <dl className="mt-2 grid grid-cols-[120px_1fr] gap-x-3 gap-y-1 text-[13px]">
      {rows.slice(0, 12).map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="font-semibold capitalize text-[var(--lo-muted)]">{k}</dt>
          <dd className="min-w-0 break-words">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A proposal: what your AI agent suggests, item by item, for a person to keep. */
export function ProposalCard({ proposal, className }: { proposal: Proposal; className?: string | undefined }): React.JSX.Element {
  const items = proposal.preview?.items ?? [];
  const [keep, setKeep] = useState<Set<string>>(() => new Set(items.map((i) => i.key)));
  const [busy, setBusy] = useState<string | null>(null);
  const [returning, setReturning] = useState(false);
  const [note, setNote] = useState('');
  const card = useRef<HTMLDivElement | null>(null);
  // The card folds away at once; what was kept appears as the server applies it.
  const decide = async (what: 'approve' | 'reject' | 'return'): Promise<void> => {
    setBusy(what);
    const l = leave(card.current);
    await l.done;
    const r = await act(
      [drop(proposal.id)],
      () => (what === 'approve' ? op('proposals.approve', items.length > 0 ? { proposal: proposal.id, items: [...keep] } : { proposal: proposal.id }) : what === 'reject' ? op('proposals.reject', { proposal: proposal.id }) : op('proposals.return', { proposal: proposal.id, note })),
      ALL,
    );
    if (r === undefined) l.back();
    else if (what === 'approve') toast.success(items.length > 0 && keep.size < items.length ? 'Kept the items you ticked' : 'Applied');
    setBusy(null);
  };
  return (
    <div ref={card} className={cn('lo-in rounded-[var(--lo-r-lg)] border border-dashed border-[var(--lo-accent)] bg-[var(--lo-accent-soft)] p-4', className)}>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--lo-card)] text-[var(--lo-accent-text)]">
          <Sparkles size={15} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-bold text-[var(--lo-accent-text)]">Your AI agent proposes · {ago(proposal.created)}</p>
          <p className="serif text-[15px] font-semibold leading-6">{proposal.title}</p>
          {proposal.why !== '' && <p className="mt-0.5 text-[13px] leading-5 text-[var(--lo-ink-2)]">{proposal.why}</p>}
          {proposal.preview?.note !== undefined && proposal.preview.note !== '' && proposal.preview.note !== proposal.why && <p className="mt-0.5 text-[13px] leading-5 text-[var(--lo-ink-2)]">{proposal.preview.note}</p>}
        </div>
      </div>
      {items.length > 0 ? (
        <ul className="mt-3 flex flex-col gap-1">
          {items.map((it) => {
            const on = keep.has(it.key);
            return (
              <li key={it.key}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded-[var(--lo-r-sm)] bg-[var(--lo-card)] px-3 py-2">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => {
                      const n = new Set(keep);
                      if (on) n.delete(it.key);
                      else n.add(it.key);
                      setKeep(n);
                    }}
                    className="mt-1 size-4 accent-[var(--lo-primary)]"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="mr-2 inline-flex h-5 items-center rounded-full bg-[var(--lo-sunk)] px-2 text-[12px] font-bold text-[var(--lo-ink-2)]">{it.label}</span>
                    <span className={cn('text-[14px] font-semibold', !on && 'text-[var(--lo-muted)] line-through')}>{it.title}</span>
                    {it.detail !== '' && <span className="block text-[12px] text-[var(--lo-muted)]">{it.detail}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <>
          {proposal.summary !== '' && proposal.preview?.fields === undefined && <p className="mt-2 text-[13px] text-[var(--lo-ink-2)]">{proposal.summary}</p>}
          <Changes p={proposal} />
        </>
      )}
      {returning && (
        <div className="mt-3 flex flex-col gap-2">
          <textarea autoFocus value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="What should it change?" className={textareaCls} />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setReturning(false)}>
              Cancel
            </Button>
            <Button size="sm" variant="primary" icon={Send} loading={busy === 'return'} disabled={note.trim() === ''} onClick={() => void decide('return')}>
              Send back
            </Button>
          </div>
        </div>
      )}
      {!returning && (
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button size="sm" variant="ghost" icon={X} loading={busy === 'reject'} onClick={() => void decide('reject')}>
            Decline
          </Button>
          <Button size="sm" variant="outline" icon={CornerUpLeft} onClick={() => setReturning(true)}>
            Send back
          </Button>
          <Button size="sm" variant="primary" icon={Check} loading={busy === 'approve'} disabled={items.length > 0 && keep.size === 0} onClick={() => void decide('approve')}>
            {items.length > 0 ? (keep.size === items.length ? 'Apply all' : `Apply ${keep.size}`) : 'Approve'}
          </Button>
        </div>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- suggestions */

const FIELD_WORDS: Record<string, string> = { goal: 'Goal', area: 'Area', project: 'Project', person: 'With', do_date: 'Do on', due_date: 'Due', duration_min: 'Takes', cue: 'After', time_of_day: 'Time of day', deadline: 'By', purpose: 'Why' };

export function SuggestionChip({ s }: { s: Suggestion }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  // The chip goes at once; a kept suggestion's change arrives with the server.
  const decide = async (accept: boolean): Promise<void> => {
    setBusy(true);
    await act([drop(s.id)], () => op(accept ? 'suggestions.accept' : 'suggestions.dismiss', { suggestion: s.id }), ['suggestions', 'tasks', 'habits', 'goals']);
    setBusy(false);
  };
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-full border border-dashed border-[var(--lo-accent)] bg-[var(--lo-accent-soft)] py-0.5 pl-2.5 pr-1 text-[12px] font-bold text-[var(--lo-accent-text)]" title={s.why !== '' ? 'Your AI agent: ' + s.why : 'Proposed by your AI agent'}>
      <Sparkles size={12} className="shrink-0" />
      <span className="truncate">
        {FIELD_WORDS[s.field] ?? s.field}: {String(s.shown ?? '')}
      </span>
      <button type="button" aria-label="Keep" disabled={busy} onClick={() => void decide(true)} className="flex size-5 items-center justify-center rounded-full hover:bg-[var(--lo-card)]">
        <Check size={12} strokeWidth={3} />
      </button>
      <button type="button" aria-label="Dismiss" disabled={busy} onClick={() => void decide(false)} className="flex size-5 items-center justify-center rounded-full hover:bg-[var(--lo-card)]">
        <X size={12} strokeWidth={3} />
      </button>
    </span>
  );
}

export function useSuggestions(): Suggestion[] {
  const live = useLive<{ suggestions: Suggestion[] }>((signal) => op('suggestions.list', {}, { quiet: true, signal }), ['suggestions'], []);
  return live.data?.suggestions ?? [];
}
