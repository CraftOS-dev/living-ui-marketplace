/**
 * Asking your AI agent from a record (fix 8): one trigger per task, its
 * params naming the record. A button runs the op where a person asks
 * (agent.ask, or a module op such as Brief or Draft); the record keeps the
 * request id (its `agent` field) and the line beside the button follows
 * that request with the kit's useAgentRequest: sent, on it, done with its
 * answer, or refused. Nobody picked it up in 24 hours: Retry asks again.
 *
 *   <AskAgent label="Ask your AI agent" state={item.agent?.deck_triage} onAsk={(again) => op('intake.retriage', { item: item.id, again })} reads={INTAKE_READS} />
 *   <AgentSteps track={dd.ask} />          // a StepTrack that moves on while your AI agent is on it
 */
import { useEffect, useState } from 'react';
import { RotateCcw, Sparkle } from 'lucide-react';
import { cn, getPbClient, useAgentRequest } from '../../kit/index.ts';
import type { AgentRequestRecord } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { act, useLive } from '../lib/live.ts';
import type { Collection, Live } from '../lib/live.ts';
import type { AgentAskState, AgentTrack } from '../lib/types.ts';
import { Button, StatusDot, StepTrack } from './ui.tsx';

/** Where an ask is: never asked, sent (waiting for your AI agent), on it, done, refused, nobody picked it up (stale), or it could not (failed). */
export type AskPhase = 'idle' | 'sent' | 'working' | 'done' | 'rejected' | 'stale' | 'failed';

/** Follow a record's ask live. */
export function useAsk(state: AgentAskState | null | undefined): { phase: AskPhase; request: AgentRequestRecord | null } {
  const { request } = useAgentRequest(state && state.request !== '' ? state.request : null);
  if (!state || state.request === '') return { phase: 'idle', request: null };
  if (state.error !== '') return { phase: 'failed', request };
  if (state.done_at !== '') return { phase: 'done', request };
  const st = request?.status;
  if (st === 'done') return { phase: 'done', request };
  if (st === 'rejected') return { phase: 'rejected', request };
  if (st === 'claimed') return { phase: 'working', request };
  return { phase: state.stale ? 'stale' : 'sent', request };
}

/** After 20 seconds still pending: say it waits for your AI agent to run. */
function useSlow(phase: AskPhase): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    if (phase !== 'sent') return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [phase]);
  return slow;
}

/** The ask's state in words (no button): for lists and cards. */
export function AskStatus({ state, className, idle }: { state: AgentAskState | null | undefined; className?: string | undefined; idle?: React.ReactNode }): React.JSX.Element | null {
  const { phase, request } = useAsk(state);
  const slow = useSlow(phase);
  if (phase === 'idle') return idle === undefined ? null : <>{idle}</>;
  if (phase === 'sent') return <StatusDot tone="agent" label={slow ? 'Sent; it picks this up while your AI agent is running' : 'Sent to your AI agent'} className={className} />;
  if (phase === 'working') return <StatusDot tone="good" pulse label="Your AI agent is on it" className={className} />;
  if (phase === 'stale') return <StatusDot tone="warn" label="Your AI agent hasn't picked this up" title="Asked 24 hours ago and never started. Retry asks it once more." className={className} />;
  if (phase === 'failed') return <StatusDot tone="bad" label={state?.error || 'Your AI agent could not do it'} className={className} />;
  if (phase === 'rejected') return <StatusDot tone="bad" label={request?.error || 'Your AI agent could not do it'} className={className} />;
  return <StatusDot tone="good" label={request?.result ? request.result : 'Done'} className={className} />;
}

/**
 * The ask button with its live state: the button while nothing waits (again
 * after an answer or a refusal), the state while it waits or works, Retry
 * once nobody picked it up in 24 hours. onAsk gets the request id a screen
 * saw done or rejected (the server then asks once more).
 */
export function AskAgent({
  label,
  state,
  onAsk,
  reads = [],
  size = 'sm',
  variant = 'default',
  disabled = false,
  title,
  className,
}: {
  label: string;
  state: AgentAskState | null | undefined;
  onAsk: (again: string) => Promise<unknown>;
  reads?: Collection[] | undefined;
  size?: 'sm' | 'md' | undefined;
  variant?: 'primary' | 'default' | 'ghost' | undefined;
  disabled?: boolean | undefined;
  title?: string | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const { phase, request } = useAsk(state);
  const slow = useSlow(phase);
  const [busy, setBusy] = useState(false);
  const ask = (again: string): void => {
    setBusy(true);
    void act([], () => onAsk(again), reads).finally(() => setBusy(false));
  };
  const box = cn('inline-flex min-w-0 flex-wrap items-center gap-2', className);
  if (phase === 'sent' || phase === 'working')
    return (
      <span className={box}>
        <StatusDot tone={phase === 'working' ? 'good' : 'agent'} pulse={phase === 'working'} label={phase === 'working' ? 'Your AI agent is on it' : 'Sent to your AI agent'} title={slow ? 'It picks this up while your AI agent is running.' : undefined} />
        {slow && <span className="text-[12px] text-[var(--vo-muted)]">It picks this up while your AI agent is running.</span>}
      </span>
    );
  if (phase === 'stale')
    return (
      <span className={box}>
        <StatusDot tone="warn" label="Your AI agent hasn't picked this up" title="Asked 24 hours ago and never started. Retry asks it once more." />
        <Button size={size} icon={RotateCcw} busy={busy} disabled={disabled} onClick={() => ask('')}>
          Retry
        </Button>
      </span>
    );
  const again = phase === 'done' || phase === 'rejected' ? (state?.request ?? '') : '';
  const note = phase === 'done' ? request?.result || '' : phase === 'rejected' ? request?.error || 'Your AI agent could not do it.' : phase === 'failed' ? state?.error || 'Your AI agent could not do it.' : '';
  return (
    <span className={box}>
      <Button size={size} variant={variant} icon={phase === 'rejected' || phase === 'failed' ? RotateCcw : Sparkle} busy={busy} disabled={disabled} title={title} onClick={() => ask(again)}>
        {phase === 'rejected' || phase === 'failed' ? 'Retry' : label}
      </Button>
      {note !== '' && <span className={cn('vo-wrap min-w-0 text-[12px]', phase === 'done' ? 'text-[var(--vo-ink-2)]' : 'text-[var(--vo-bad)]')}>{note}</span>}
    </span>
  );
}

/** Ask with agent.ask (the generic op): the trigger and the record id. */
export function askWith(trigger: string, record: string, extra: Record<string, string> = {}): (again: string) => Promise<unknown> {
  return (again) => op('agent.ask', { trigger, record, ...extra, ...(again !== '' ? { again } : {}) });
}

/** A record's ask as a StepTrack: it moves to the second step while your AI agent is on it. */
export function AgentSteps({ track, className, compact }: { track: AgentTrack | null | undefined; className?: string | undefined; compact?: boolean | undefined }): React.JSX.Element | null {
  const { request } = useAgentRequest(track && track.open ? track.request : null);
  if (!track) return null;
  const at = track.open && request?.status === 'claimed' ? Math.max(track.at, 1) : track.at;
  return <StepTrack labels={track.labels} at={at} className={className} compact={compact} />;
}

/* ------------------------------------------------------------- requests */

/** The platform's request rows, newest first (screens read them; the app's hooks never do). */
export function useRequests(opts: { open?: boolean | undefined; limit?: number | undefined; skip?: boolean | undefined; name: string }): Live<AgentRequestRecord[]> {
  const limit = opts.limit ?? 50;
  // Open: claimed, or pending and asked less than 24 hours ago (an older one waits for Retry on its record).
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString().replace('T', ' ');
  const filter = opts.open === true ? `status = 'claimed' || (status = 'pending' && created >= '${since.slice(0, 16)}')` : '';
  return useLive(
    () =>
      getPbClient()
        .call((pb) => pb.collection('agent_requests').getList<AgentRequestRecord>(1, limit, { sort: '-created', filter, requestKey: null }), { silent: true })
        .then((r) => r.items),
    ['agent_requests'],
    [limit, opts.open === true, opts.skip === true],
    { name: opts.name, skip: opts.skip, keep: true },
  );
}

/** The record a request names, by its params (the first id param). */
export function recordOf(r: AgentRequestRecord): string {
  const p = r.params ?? {};
  for (const k of Object.keys(p)) if (k.endsWith('_id') && typeof p[k] === 'string') return p[k] as string;
  return '';
}

/** A StepTrack ask as the ask state AskAgent follows (null when never asked). */
export function stateOfTrack(t: AgentTrack | null | undefined): AgentAskState | null {
  if (!t || t.request === '') return null;
  return { request: t.request, at: t.asked_at, by: '', done_at: t.done_at, error: t.stale ? '' : t.error, pending: t.open, stale: t.stale };
}
