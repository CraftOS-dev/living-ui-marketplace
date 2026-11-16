/**
 * Following what your AI agent was asked (pb_hooks/lib_agent.js). A record
 * carries its ask: the request id, when it was asked and the person's note.
 * The kit's useAgentRequest follows the request itself, so every ask is
 * shown honestly: waiting to be sent (a cooldown), sent, working, done,
 * not picked up in a day (Retry) or not done (Retry). Retry asks once more
 * for that request (agent.retry); nothing is ever asked again on its own.
 */
import { useEffect, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { UnsubscribeFunc } from 'pocketbase';
import { cn, getPbClient, useAgentRequest } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { changed } from '../lib/live.ts';
import type { Collection } from '../lib/live.ts';
import { toast } from '../lib/toast.ts';
import { LinkButton, StatusDot } from './ui.tsx';
import type { Tone } from './ui.tsx';

/** An ask as the server shows it on a record (lib_agent.view). */
export interface AgentAsk {
  trigger: string;
  record: string;
  request: string;
  asked_at: string;
  by_name: string;
  note: string;
  source: string;
  ended_at: string;
  outcome: string;
  result: string;
  waiting: boolean;
  open: boolean;
  unanswered: boolean;
}

export type AskState = 'waiting' | 'sent' | 'working' | 'done' | 'unanswered' | 'failed' | 'closed';

const TONE: Record<AskState, Tone> = { waiting: 'faint', sent: 'warn', working: 'good', done: 'neutral', unanswered: 'bad', failed: 'bad', closed: 'faint' };

/** The state of an ask: the record's own knowledge first, then the request row. */
export function useAskState(ask: AgentAsk | null | undefined): { state: AskState | null; error: string; result: string } {
  const id = ask !== null && ask !== undefined && ask.request !== '' ? ask.request : null;
  const { request } = useAgentRequest(id);
  if (ask === null || ask === undefined) return { state: null, error: '', result: '' };
  if (ask.ended_at !== '') {
    if (ask.outcome === 'closed' || ask.outcome === 'cancelled') return { state: 'closed', error: '', result: ask.result };
    return { state: 'done', error: '', result: ask.result !== '' ? ask.result : (request?.result ?? '') };
  }
  if (ask.request === '') return { state: 'waiting', error: '', result: '' };
  if (request === null) return { state: ask.unanswered ? 'unanswered' : 'sent', error: '', result: '' };
  if (request.status === 'claimed') return { state: 'working', error: '', result: '' };
  if (request.status === 'done') return { state: 'done', error: '', result: request.result };
  if (request.status === 'rejected') return { state: 'failed', error: request.error, result: '' };
  return { state: ask.unanswered ? 'unanswered' : 'sent', error: '', result: '' };
}

/** Ask again for this request, once (people only). */
export async function retryAsk(ask: AgentAsk, reads: Collection[]): Promise<boolean> {
  try {
    await op('agent.retry', { trigger: ask.trigger, record: ask.record, request: ask.request });
    changed(...reads);
    toast.success(t('agent.asked_again'));
    return true;
  } catch {
    return false;
  }
}

/**
 * One line that follows an ask: what it is doing, since when, and Retry when
 * it was not picked up in a day or not done. `reads`: the collections the
 * page reloads after a Retry. `canRetry`: the viewer may ask again.
 */
export function AgentAskStatus({ ask, reads, canRetry = true, className }: { ask: AgentAsk | null | undefined; reads: Collection[]; canRetry?: boolean | undefined; className?: string | undefined }): React.JSX.Element | null {
  const { state, error, result } = useAskState(ask);
  const [busy, setBusy] = useState(false);
  if (state === null || state === 'closed' || ask === null || ask === undefined) return null;
  const when = state === 'done' && ask.ended_at !== '' ? ask.ended_at : ask.asked_at;
  const retry = canRetry && (state === 'unanswered' || state === 'failed');
  return (
    <span className={cn('inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[12px]', className)} title={state === 'done' && result !== '' ? result : undefined}>
      <StatusDot tone={TONE[state]} pulse={state === 'working'} label={t('agent.ask.' + state)} />
      {when !== '' && <span className="text-[var(--hr-muted)]">{ago(when)}</span>}
      {state === 'failed' && error !== '' && <span className="hr-wrap min-w-0 text-[var(--hr-bad)]">{error}</span>}
      {retry && (
        <LinkButton
          disabled={busy}
          onClick={() => {
            setBusy(true);
            void retryAsk(ask, reads).finally(() => setBusy(false));
          }}
          className="inline-flex items-center gap-1"
        >
          <RotateCcw size={12} aria-hidden />
          {t('agent.retry')}
        </LinkButton>
      )}
    </span>
  );
}

/**
 * How many requests of the last day wait for your AI agent and how many it is
 * working on now (the platform's request rows, followed live; older ones are
 * unanswered, shown with their record). The shell's agent card and Home read it.
 */
export function useAgentQueue(): { waiting: number; working: number } {
  const [n, setN] = useState({ waiting: 0, working: 0 });
  useEffect(() => {
    const client = getPbClient();
    let cancelled = false;
    let unsubscribe: UnsubscribeFunc | null = null;
    const count = (): void => {
      const since = new Date(Date.now() - 24 * 3600000).toISOString().replace('T', ' ');
      void Promise.all([
        client.call((pb) => pb.collection('agent_requests').getList(1, 1, { filter: pb.filter('status = "pending" && created >= {:since}', { since }), fields: 'id' })),
        client.call((pb) => pb.collection('agent_requests').getList(1, 1, { filter: pb.filter('status = "claimed" && created >= {:since}', { since }), fields: 'id' })),
      ])
        .then(([p, c]) => {
          if (!cancelled) setN({ waiting: p.totalItems, working: c.totalItems });
        })
        .catch(() => undefined);
    };
    count();
    client
      .call((pb) => pb.collection('agent_requests').subscribe('*', () => count()))
      .then((fn) => {
        unsubscribe = fn;
        if (cancelled) void fn();
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      if (unsubscribe !== null) void unsubscribe();
    };
  }, []);
  return n;
}
