/**
 * Your AI agent, visible but quiet (U12): the card at the foot of the
 * sidebar (state dot, how many requests it has open) and the panel it
 * opens: the "Tell your AI agent" field (chat.ask asks a question, trigger
 * question_asked; the panel follows it until its answer shows), what it is
 * working on and what was sent to it (the platform's requests, followed
 * live), and the last answers. While no answer has come the panel says so
 * honestly.
 *
 *   const ask = await askAgent('Summarise Acme', '/deals/D-12');   // opens the panel on that question
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { ArrowRight, Send } from 'lucide-react';
import { cn, useAgentRequest } from '../../../kit/index.ts';
import type { AgentRequestRecord } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { useOp } from '../../lib/live.ts';
import { navigate, useRoute } from '../../lib/router.ts';
import type { AgentQuestion, AgentTrigger } from '../../lib/types.ts';
import { useRequests } from '../agent.tsx';
import { AgentMark, AgentTag, Button, Count, Sheet, SheetHeader, Spinner, StatusDot, Textarea } from '../ui.tsx';
import { useShellCounts } from './counts.ts';

/* --------------------------------------------------------------- state */

let panel: { open: boolean; ask: string } = { open: false, ask: '' };
const subs = new Set<() => void>();
function setPanel(next: Partial<typeof panel>): void {
  panel = { ...panel, ...next };
  for (const fn of subs) fn();
}
function usePanel(): typeof panel {
  return useSyncExternalStore(
    (fn) => {
      subs.add(fn);
      return () => subs.delete(fn);
    },
    () => panel,
  );
}

/** Open the agent panel (on one question when given). */
export function openAgent(ask = ''): void {
  setPanel({ open: true, ask: ask !== '' ? ask : panel.ask });
}

/** Send a question or instruction to your AI agent (trigger question_asked); the panel opens on it. Returns the question id. */
export async function askAgent(text: string, context: string, opts: { open?: boolean | undefined } = {}): Promise<string | null> {
  const t = text.trim();
  if (t === '') return null;
  try {
    const r = await op<{ ask: AgentQuestion }>('chat.ask', { text: t, context });
    if (opts.open !== false) setPanel({ open: true, ask: r.ask.id });
    return r.ask.id;
  } catch {
    return null;
  }
}

/** The labels of the triggers (settings.get), for request rows. */
export function useTriggerLabels(skip = false): Record<string, string> {
  const s = useOp<{ agent_triggers: AgentTrigger[] }>('settings.get', {}, ['settings'], { name: 'settings.get', skip });
  const out: Record<string, string> = {};
  for (const t of s.data?.agent_triggers ?? []) out[t.name] = t.label;
  return out;
}

/** A request's state in words, with the tone of its dot. */
export function requestState(r: AgentRequestRecord): { label: string; tone: 'good' | 'bad' | 'warn' | 'agent' | 'faint' } {
  if (r.status === 'claimed') return { label: 'Working', tone: 'good' };
  if (r.status === 'done') return { label: 'Done', tone: 'good' };
  if (r.status === 'rejected') return { label: 'Could not', tone: 'bad' };
  const age = Date.now() - Date.parse(r.created.replace(' ', 'T'));
  return age >= 24 * 3600 * 1000 ? { label: "Not picked up", tone: 'warn' } : { label: 'Sent', tone: 'agent' };
}

/** One request as the panel and the agent page show it: what was asked, its state, its answer. */
export function RequestItem({ r, labels, action }: { r: AgentRequestRecord; labels: Record<string, string>; action?: React.ReactNode }): React.JSX.Element {
  const s = requestState(r);
  const text = r.status === 'rejected' ? r.error : r.status === 'done' ? r.result : '';
  return (
    <li className="flex flex-col gap-1 border-b border-[var(--vo-hair)] py-2.5 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="vo-wrap min-w-0 flex-1 text-[13px] leading-[18px]">{labels[r.trigger] ?? r.trigger.replace(/_/g, ' ')}</span>
        <StatusDot tone={s.tone} label={s.label} pulse={r.status === 'claimed'} />
        <span className="vo-mono shrink-0 text-[12px] text-[var(--vo-muted)]">{ago(r.updated || r.created)}</span>
        {action}
      </div>
      {text !== '' && <div className={cn('vo-wrap text-[12px] leading-[18px]', r.status === 'rejected' ? 'text-[var(--vo-bad)]' : 'text-[var(--vo-ink-2)]')}>{text}</div>}
    </li>
  );
}

/** Follow one question live (null id: nothing). */
export function useQuestion(id: string | null): AgentQuestion | null {
  const live = useOp<{ ask: AgentQuestion }>('chat.get', { ask: id ?? '' }, ['agent_asks', 'agent_requests'], { skip: id === null || id === '', name: 'agent.ask' });
  return live.data?.ask ?? null;
}

/** A question's state: answered, could not, or its request's live state. */
function QuestionState({ q }: { q: AgentQuestion }): React.JSX.Element {
  const { request } = useAgentRequest(q.status === 'waiting' && q.request !== '' ? q.request : null);
  if (q.status === 'answered')
    return (
      <div className="vo-wrap flex gap-2 text-[13px] leading-5">
        <AgentTag className="mt-0.5" />
        <span className="min-w-0 flex-1 whitespace-pre-wrap">{q.answer}</span>
      </div>
    );
  if (q.status === 'failed') return <StatusDot tone="bad" label={q.failure || 'Your AI agent could not answer.'} />;
  if (request?.status === 'claimed') return <StatusDot tone="good" pulse label="Your AI agent is on it" />;
  if (request?.status === 'rejected') return <StatusDot tone="bad" label={request.error || 'Your AI agent could not answer.'} />;
  if (request?.status === 'done') return <StatusDot tone="good" label={request.result || 'Done'} />;
  const stale = Date.now() - Date.parse(q.created.replace(' ', 'T')) >= 24 * 3600 * 1000;
  return <StatusDot tone={stale ? 'warn' : 'agent'} label={stale ? "Your AI agent hasn't picked this up; ask again" : 'Sent to your AI agent'} />;
}

/** The followed question: honest about where it is, then the answer in place. */
function Followed({ id }: { id: string }): React.JSX.Element | null {
  const q = useQuestion(id);
  if (q === null) return null;
  return (
    <div className="vo-fade flex flex-col gap-2 rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-panel)] p-3">
      <div className="vo-wrap text-[13px] font-medium">{q.question}</div>
      <QuestionState q={q} />
    </div>
  );
}

/** One answered question in a list. */
export function QuestionItem({ q }: { q: AgentQuestion }): React.JSX.Element {
  return (
    <li className="flex flex-col gap-1.5 border-b border-[var(--vo-hair)] py-3 last:border-b-0">
      <div className="flex min-w-0 items-center gap-2">
        <span className="vo-wrap min-w-0 flex-1 text-[13px] leading-[18px]">{q.question}</span>
        <span className="vo-mono shrink-0 text-[12px] text-[var(--vo-muted)]">{ago(q.answered_at || q.created)}</span>
      </div>
      <QuestionState q={q} />
    </li>
  );
}

/** The "Tell your AI agent" field. */
export function TellField({ onSent, autoFocus, className }: { onSent?: ((ask: string) => void) | undefined; autoFocus?: boolean | undefined; className?: string | undefined }): React.JSX.Element {
  const { path } = useRoute();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (): void => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    void askAgent(text, path)
      .then((ask) => {
        if (ask !== null) {
          setText('');
          onSent?.(ask);
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className={cn('flex items-end gap-1.5 rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] p-1 transition-colors duration-150 focus-within:border-[var(--vo-ink-2)]', className)}>
      <Textarea
        value={text}
        autoFocus={autoFocus}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        minRows={1}
        maxRows={6}
        placeholder="Tell your AI agent"
        aria-label="Tell your AI agent"
        className="border-0 bg-transparent shadow-none focus:shadow-none"
      />
      <Button variant="primary" icon={Send} busy={busy} disabled={text.trim() === ''} onClick={send} aria-label="Send" title="Send" className="h-8 w-8 px-0" />
    </div>
  );
}

function stateOf(working: number, open: number): { tone: 'good' | 'faint' | 'neutral'; label: string; pulse: boolean } {
  if (working > 0) return { tone: 'good', label: 'Working', pulse: true };
  if (open > 0) return { tone: 'faint', label: 'Asked', pulse: false };
  return { tone: 'neutral', label: 'Ready', pulse: false };
}

/** The panel (mounted once in the frame; opened from the sidebar, Ctrl K or Home). */
export function AgentPanel(): React.JSX.Element | null {
  const p = usePanel();
  const counts = useShellCounts();
  const { path } = useRoute();
  useEffect(() => {
    setPanel({ open: false });
  }, [path]);
  const labels = useTriggerLabels(!p.open);
  const answers = useOp<{ asks: AgentQuestion[] }>('chat.list', { status: 'answered', mine: true, limit: 6 }, ['agent_asks'], { name: 'agent.answers', skip: !p.open });
  const recent = useRequests({ limit: 8, skip: !p.open, name: 'agent.recent' });
  const st = stateOf(counts.working, counts.asked);
  const open = counts.openRequests.filter((r) => r.trigger !== 'question_asked');
  const ended = (recent.data ?? []).filter((r) => r.trigger !== 'question_asked' && (r.status === 'done' || r.status === 'rejected')).slice(0, 4);
  const shown = (answers.data?.asks ?? []).filter((q) => q.id !== p.ask);
  return (
    <Sheet open={p.open} onClose={() => setPanel({ open: false })} label="Your AI agent" width={440}>
      <SheetHeader
        title={
          <span className="flex items-center gap-2.5">
            <AgentMark size={24} />
            <span>Your AI agent</span>
            <StatusDot tone={st.tone} label={st.label} pulse={st.pulse} className="font-normal" />
          </span>
        }
        onClose={() => setPanel({ open: false })}
      />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
        <TellField autoFocus onSent={(ask) => setPanel({ ask })} />
        {p.ask !== '' && <Followed id={p.ask} />}
        {open.length > 0 && (
          <section>
            <div className="vo-label mb-1">Asked</div>
            <ul>
              {open.map((r) => (
                <RequestItem key={r.id} r={r} labels={labels} />
              ))}
            </ul>
          </section>
        )}
        {ended.length > 0 && (
          <section>
            <div className="vo-label mb-1">Finished</div>
            <ul>
              {ended.map((r) => (
                <RequestItem key={r.id} r={r} labels={labels} />
              ))}
            </ul>
          </section>
        )}
        <section>
          <div className="vo-label mb-1">Answers</div>
          {answers.data === null ? (
            <div className="flex h-16 items-center justify-center text-[var(--vo-muted)]">
              <Spinner />
            </div>
          ) : shown.length === 0 ? (
            <p className="py-2 text-[12px] text-[var(--vo-muted)]">None yet</p>
          ) : (
            <ul>
              {shown.map((q) => (
                <QuestionItem key={q.id} q={q} />
              ))}
            </ul>
          )}
        </section>
      </div>
      <div className="shrink-0 border-t border-[var(--vo-hair)] p-2">
        <button type="button" onClick={() => navigate('/agent')} className="vo-focus flex h-8 w-full items-center justify-between rounded-[var(--vo-radius-sm)] px-2 text-[13px] font-medium text-[var(--vo-ink-2)] transition-colors duration-150 hover:bg-[var(--vo-hover)] hover:text-[var(--vo-ink)]">
          Everything you asked
          <ArrowRight size={13} aria-hidden />
        </button>
      </div>
    </Sheet>
  );
}

/** The sidebar foot card: the mark with its state dot, the name, how many requests are open. */
export function AgentCard({ collapsed, onOpen }: { collapsed: boolean; onOpen?: (() => void) | undefined }): React.JSX.Element {
  const counts = useShellCounts();
  const st = stateOf(counts.working, counts.asked);
  return (
    <button
      type="button"
      onClick={() => {
        onOpen?.();
        openAgent();
      }}
      title={collapsed ? `Your AI agent: ${st.label}` : undefined}
      aria-label={`Your AI agent: ${st.label}`}
      className={cn('vo-focus vo-tap mb-1 flex w-full items-center gap-2.5 rounded-[var(--vo-radius)] text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]', collapsed ? 'mx-auto size-10 justify-center' : 'h-11 px-2')}
    >
      <AgentMark size={collapsed ? 26 : 26} working={counts.working > 0 ? true : counts.asked > 0 ? 'waiting' : undefined} />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate text-[13px] font-medium">Your AI agent</span>
          <Count n={counts.asked} tone="agent" />
        </>
      )}
    </button>
  );
}
