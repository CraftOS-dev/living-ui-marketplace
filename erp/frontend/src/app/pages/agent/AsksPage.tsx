/**
 * Ask your AI agent a question about the business ("Who owes us the most?")
 * and read the answers here as they come back. Answers respect the asker's
 * rights, and your AI agent changes nothing to answer. Questions are picked
 * up while your AI agent is running, and the page says so.
 */
import { useEffect, useRef, useState } from 'react';
import { MessageCircleQuestion, Send, Sparkles, Trash2 } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { ageSeconds, stamp } from '../../components/agent/words.ts';
import { Avatar, Card, CircleButton, Empty, LoadError, PageHeader, PillButton, Skeleton, StatusPill, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import { changed, useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { Ask, AskCreated } from '../../lib/types/agent.ts';

const SUGGESTIONS = ['Who owes us the most?', 'What did we spend on rent this year?', 'Which items should I reorder?', 'How did sales do last month?'];

export function AsksPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const box = useRef<HTMLTextAreaElement | null>(null);
  const list = useLive(() => op<{ asks: Ask[] }>('asks.list', { limit: 100 }, { quiet: true }), ['asks'], []);
  const wantNew = query.get('new') !== null;
  const [, tick] = useState(0);

  useEffect(() => {
    if (!wantNew) return;
    box.current?.focus();
    replaceQuery('asks', {});
  }, [wantNew]);

  // Re-render now and then so "waiting" can say when it has waited a while.
  const pending = (list.data?.asks ?? []).some((a) => a.status === 'waiting' || a.status === 'working');
  useEffect(() => {
    if (!pending) return;
    const t = setInterval(() => tick((n) => n + 1), 15000);
    return () => clearInterval(t);
  }, [pending]);

  const ask = async (): Promise<void> => {
    const q = text.trim();
    if (q === '') {
      box.current?.focus();
      return;
    }
    setBusy(true);
    try {
      const r = await op<AskCreated>('asks.create', { question: q });
      setText('');
      if (r.asked) toast.success('Sent to your AI agent');
      else toast.success('Saved. Your AI agent answers it when it next runs.');
      changed('asks');
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };

  const asks = list.data?.asks ?? [];
  const first = me.member.name.split(' ')[0] ?? me.member.name;

  return (
    <div className="mx-auto max-w-[880px]">
      <PageHeader title="Questions" subtitle="Ask your AI agent about the business. It answers with what your role may see." />

      <Card delay={1} className="mb-6">
        <label htmlFor="ask-box" className="sr-only">
          Your question
        </label>
        <textarea
          id="ask-box"
          ref={box}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              void ask();
            }
          }}
          maxLength={2000}
          placeholder={`What would you like to know, ${first}?`}
          className="min-h-[120px] w-full resize-y rounded-[20px] bg-[var(--erp-row)] px-5 py-4 text-[15px] leading-6 text-[var(--erp-ink)] outline-none ring-[var(--erp-ink)] transition-shadow focus-visible:ring-2"
        />
        <div className="mt-4 flex flex-col gap-4 @min-[640px]:flex-row @min-[640px]:items-end @min-[640px]:justify-between">
          <div className="erp-strip -mx-1 flex gap-2 relative overflow-x-auto px-1 py-0.5 @min-[640px]:flex-wrap">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => {
                  setText(s);
                  box.current?.focus();
                }}
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full bg-[var(--erp-row)] px-4 text-[13px] font-semibold text-[var(--erp-ink-2)] transition-colors hover:bg-[var(--erp-row-hover)] hover:text-[var(--erp-ink)]"
              >
                <Sparkles size={13} aria-hidden />
                {s}
              </button>
            ))}
          </div>
          <PillButton icon={Send} dot loading={busy} onClick={() => void ask()} className="self-end">
            Ask
          </PillButton>
        </div>
        <p className="mt-3 px-1 text-[12px] text-[var(--erp-muted)]">Answers come back here while your AI agent is running. It only reads to answer and changes nothing.</p>
      </Card>

      {list.data === null && list.error !== null ? (
        <LoadError message={list.error} onRetry={list.reload} />
      ) : list.data === null ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24" rounded="rounded-[24px]" />
          <Skeleton className="h-24" rounded="rounded-[24px]" />
        </div>
      ) : asks.length === 0 ? (
        <Card delay={2}>
          <Empty icon={MessageCircleQuestion} title="No questions yet">
            Ask about money owed, sales, spending or stock, in your own words.
          </Empty>
        </Card>
      ) : (
        <ol className="flex flex-col gap-4">
          {asks.map((a, i) => (
            <AskItem key={a.id} a={a} delay={Math.min(5, i + 2)} onDeleted={list.reload} />
          ))}
        </ol>
      )}
    </div>
  );
}

function AskItem({ a, delay, onDeleted }: { a: Ask; delay: number; onDeleted: () => void }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const waitedLong = a.status === 'waiting' && ageSeconds(a.created) > 30;
  const remove = async (): Promise<void> => {
    if (!(await confirm('The question and its answer are removed.', 'Delete this question?'))) return;
    try {
      await op('asks.delete', { ask: a.id });
      onDeleted();
    } catch {
      /* shown */
    }
  };
  return (
    <li className={cn('erp-rise rounded-[24px] bg-[var(--erp-card)] p-4 @min-[640px]:p-5', `erp-d${delay}`)}>
      <div className="flex items-start justify-end gap-2">
        <div className="flex min-w-0 max-w-[85%] flex-col items-end">
          <p className="erp-on-ink rounded-[20px] rounded-br-[6px] bg-[var(--erp-ink)] px-4 py-2.5 text-[14px] leading-6 text-[var(--erp-shell)]">{a.question}</p>
          <p className="mt-1 px-1 text-[12px] text-[var(--erp-muted)]">
            {a.who !== '' ? `${a.who} · ` : ''}
            {ago(a.created)}
          </p>
        </div>
        <CircleButton icon={Trash2} label="Delete this question" variant="ghost" size={32} onClick={() => void remove()} />
      </div>
      <div className="mt-3 flex items-start gap-3">
        <Avatar name="Your AI agent" agent size={32} tone="accent" />
        <div className="min-w-0 flex-1">
          {a.status === 'answered' ? (
            <>
              <p className="whitespace-pre-wrap rounded-[20px] rounded-tl-[6px] bg-[var(--erp-row)] px-4 py-3 text-[14px] leading-6">{a.answer}</p>
              <p className="mt-1 px-1 text-[12px] text-[var(--erp-muted)]">Answered {a.answered_at !== '' ? stamp(a.answered_at) : ''}</p>
            </>
          ) : a.status === 'failed' ? (
            <div className="rounded-[20px] rounded-tl-[6px] bg-[var(--erp-red)]/10 px-4 py-3">
              <p className="text-[12px] font-bold text-[var(--erp-red-text)]">Could not answer</p>
              <p className="mt-0.5 whitespace-pre-wrap text-[14px] leading-6">{a.answer !== '' ? a.answer : 'Your AI agent could not answer this.'}</p>
            </div>
          ) : (
            <div className="flex flex-col items-start gap-1.5 pt-1">
              <StatusPill tone={a.status === 'working' ? 'info' : 'warn'} pulse={a.status === 'working'}>
                {a.status === 'working' ? 'Working on it' : 'Waiting for your AI agent'}
              </StatusPill>
              {waitedLong && <span className="px-1 text-[12px] text-[var(--erp-ink-2)]">It picks this up while your AI agent is running.</span>}
            </div>
          )}
        </div>
      </div>
      {confirmEl}
    </li>
  );
}
