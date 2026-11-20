/**
 * Your AI agent at the foot of the sidebar (black and white with a star, like
 * Piano Coach's coach): what it is doing now (the requests of the last day it
 * has not finished, followed live). Opening it shows the one-line "Ask your
 * AI agent" box (one question asks it once) and your latest questions with
 * their state and answers.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Send } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { navigate, useRoute } from '../../lib/router.ts';
import { AgentAskStatus, useAgentQueue } from '../agent.tsx';
import type { AgentAsk } from '../agent.tsx';
import { AgentMark, Button, Count, Popover, Spinner, Textarea, toast } from '../ui.tsx';
import { useShellCounts } from './counts.ts';

/** A question to your AI agent (questions.list). */
export interface Question {
  id: string;
  question: string;
  status: 'asked' | 'answered' | 'cancelled';
  answer: string;
  answered_at: string;
  ask: AgentAsk | null;
  created: string;
}

/** Send a question to your AI agent from anywhere (the palette uses it too). */
export async function askAgent(question: string, context: string): Promise<boolean> {
  const q = question.trim();
  if (q === '') return false;
  try {
    await op('questions.ask', { question: q, context });
    changed('agent_questions');
    toast.success(t('agent.sent'), { label: t('agent.see'), run: () => navigate('/inbox', { view: 'agent' }) });
    return true;
  } catch {
    return false;
  }
}

export function AskBox({ autoFocus, onSent }: { autoFocus?: boolean | undefined; onSent?: (() => void) | undefined }): React.JSX.Element {
  const { path } = useRoute();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const send = (): void => {
    if (text.trim() === '' || busy) return;
    setBusy(true);
    void askAgent(text, path)
      .then((ok) => {
        if (ok) {
          setText('');
          onSent?.();
        }
      })
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-end gap-1.5 rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-raised)] p-1 focus-within:border-[var(--hr-ink-2)]">
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
        maxRows={5}
        placeholder={t('agent.ask_placeholder')}
        aria-label={t('agent.ask')}
        className="border-0 bg-transparent shadow-none focus:shadow-none"
      />
      <Button variant="agent" icon={Send} busy={busy} disabled={text.trim() === ''} onClick={send} aria-label={t('agent.send')} className="h-8 w-8 px-0" />
    </div>
  );
}

function QuestionRow({ q }: { q: Question }): React.JSX.Element {
  return (
    <li className="border-b border-[var(--hr-hair)] px-2 py-2 last:border-b-0">
      <div className="flex items-center gap-2">
        {q.status === 'answered' ? <span className="text-[12px] text-[var(--hr-muted)]">{t('agent.answered')}</span> : q.status === 'cancelled' ? <span className="text-[12px] text-[var(--hr-muted)]">{t('agent.cancelled')}</span> : <AgentAskStatus ask={q.ask} reads={['agent_questions']} />}
        <span className="flex-1" />
        <span className="hr-label">{ago(q.created)}</span>
      </div>
      <div className="hr-wrap mt-1 text-[13px] leading-[18px]">{q.question}</div>
      {q.answer !== '' && <div className="hr-wrap mt-1 line-clamp-4 border-l-2 border-[var(--hr-agent)] pl-2 text-[13px] leading-[18px] text-[var(--hr-ink-2)]">{q.answer}</div>}
    </li>
  );
}

function AgentPopover({ onClose }: { onClose: () => void }): React.JSX.Element {
  const jobs = useOp<{ questions: Question[] }>('questions.list', { limit: 6 }, ['agent_questions'], { name: 'shell.questions' });
  return (
    <div className="flex w-full flex-col gap-2 p-2">
      <div className="flex items-center gap-2.5 px-1 pt-1">
        <AgentMark size={28} />
        <div className="min-w-0 flex-1 leading-tight">
          <div className="text-[13px] font-semibold">{t('agent.name')}</div>
          <div className="truncate text-[12px] text-[var(--hr-muted)]">{t('agent.tagline')}</div>
        </div>
      </div>
      <AskBox autoFocus onSent={undefined} />
      <div className="hr-label px-1 pt-1">{t('agent.latest')}</div>
      {jobs.data === null ? (
        <div className="flex h-16 items-center justify-center text-[var(--hr-muted)]">
          <Spinner />
        </div>
      ) : jobs.data.questions.length === 0 ? (
        <p className="px-1 pb-1 text-[12px] text-[var(--hr-muted)]">{t('agent.no_jobs')}</p>
      ) : (
        <ul className="rounded-[var(--hr-radius-sm)] border border-[var(--hr-hair)] bg-[var(--hr-panel)]">
          {jobs.data.questions.map((q) => (
            <QuestionRow key={q.id} q={q} />
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => {
          onClose();
          navigate('/inbox', { view: 'agent' });
        }}
        className="hr-focus flex h-8 items-center justify-between rounded-[var(--hr-radius-sm)] px-2 text-[13px] font-medium text-[var(--hr-ink-2)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]"
      >
        {t('agent.all_jobs')}
        <ArrowRight size={13} aria-hidden />
      </button>
    </div>
  );
}

export function AgentCard({ collapsed }: { collapsed: boolean }): React.JSX.Element {
  const counts = useShellCounts();
  const ref = useRef<HTMLButtonElement | null>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  // Going to another page closes the panel (it never covers the next page).
  const { path } = useRoute();
  useEffect(() => setOpen(false), [path]);
  const queue = useAgentQueue();
  const working = queue.working > 0;
  const line = working ? t('agent.working', { n: queue.working }) : queue.waiting > 0 ? t('agent.waiting', { n: queue.waiting }) : t('agent.ready');
  return (
    <>
      <button
        ref={ref}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        title={collapsed ? `${t('agent.name')} · ${line}` : undefined}
        className={cn('hr-focus mb-1 flex w-full items-center gap-2.5 rounded-[var(--hr-radius)] border border-[var(--hr-line)] bg-[var(--hr-panel)] text-left transition-colors hover:bg-[var(--hr-hover)]', collapsed ? 'mx-auto size-10 justify-center border-0 bg-transparent' : 'px-2.5 py-2')}
      >
        <AgentMark size={28} working={working ? true : queue.waiting > 0 ? 'waiting' : undefined} />
        {!collapsed && (
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-[13px] font-semibold">{t('agent.name')}</span>
            <span className="block truncate text-[12px] text-[var(--hr-muted)]">{line}</span>
          </span>
        )}
        {!collapsed && <Count n={counts.questions} tone="agent" />}
      </button>
      <Popover anchor={ref} open={open} onClose={close} side={collapsed ? 'right' : 'top'} width={340} label={t('agent.name')}>
        <AgentPopover onClose={close} />
      </Popover>
    </>
  );
}
