/**
 * Ask AI: a question or a job for the AI agent (trigger agent_asked) with
 * what is on screen; it answers from the CRM, or does the job through the
 * same operations, with links to what it used. Answers arrive live.
 */
import { useState } from 'react';
import { ArrowUp, Sparkles, Trash2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go } from '../lib/router.ts';
import type { Ask } from '../lib/types.ts';
import { IconBtn, Spinner, area } from './ui.tsx';

const SUGGESTIONS = ['Who should I follow up with this week?', 'Which deals are slipping, and why?', 'Prepare me for my next meeting with this person', 'Fill the CRM from my email and calendar of the last 30 days'];

export function openLink(l: { type: string; id: string }): void {
  const t = l.type === 'person' ? 'people' : l.type === 'company' ? 'companies' : l.type === 'deal' ? 'deals' : l.type;
  if (t === 'people' || t === 'companies' || t === 'deals') go(t, { id: l.id });
  else if (t === 'report') go('reports', { r: l.id });
  else if (t === 'proposal') go('review');
}

function AskRow({ a }: { a: Ask }): React.JSX.Element {
  const busy = a.status === 'waiting' || a.status === 'working';
  return (
    <li className="group flex flex-col gap-1.5 border-b border-[var(--cr-hair)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold">{a.question || (a.kind === 'explain' ? 'Explain this report' : a.kind === 'brief' ? 'Prepare my day' : 'Question')}</p>
        <span className="shrink-0 text-[11px] text-[var(--cr-muted)]">{ago(a.created)}</span>
        <IconBtn icon={Trash2} label="Delete" size={20} className="opacity-0 group-hover:opacity-100" onClick={() => void api.deleteAsk(a.id)} />
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-[12px] text-[var(--cr-accent-text)]">
          <Sparkles size={12} className="cr-pulse" /> {a.status === 'working' ? 'Your AI agent is looking into it' : 'Waiting for your AI agent'}
        </p>
      )}
      {a.status === 'done' && <p className="cr-prose text-[12.5px] leading-[18px] text-[var(--cr-ink-2)]">{a.answer}</p>}
      {a.status === 'failed' && <p className="text-[12px] text-[var(--cr-neg-text)]">{a.error || 'Your AI agent could not answer.'}</p>}
      {a.links.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {a.links.map((l, i) => (
            <button key={i} type="button" onClick={() => openLink(l)} className="h-6 border border-[var(--cr-line)] px-1.5 text-[11.5px] font-semibold hover:bg-[var(--cr-row)]">
              {l.label || l.type}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export function AskPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const asks = useLive(() => api.asks(), ['asks'], []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (text: string): Promise<void> => {
    if (text.trim() === '') return;
    setBusy(true);
    try {
      const r = await api.ask(text.trim(), /^(fill|research|draft|import|prepare|find)/i.test(text.trim()) ? 'job' : 'question');
      setQ('');
      if (!r.asked && r.reason !== '') toast.error('Saved, but your AI agent was not reached: ' + r.reason);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const list = asks.data?.asks ?? [];
  return (
    <div className="flex max-h-[min(72vh,620px)] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--cr-hair)] px-3 py-2">
        <Sparkles size={14} className="text-[var(--cr-accent-text)]" />
        <span className="text-[13px] font-bold">Ask your AI agent</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="text-[12px] font-semibold text-[var(--cr-muted)] hover:text-[var(--cr-ink)]">
          Close
        </button>
      </div>
      <div className="relative border-b border-[var(--cr-hair)] p-2">
        <textarea
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(q);
            }
          }}
          rows={2}
          placeholder="Ask about your people and deals, or give it a job. It sees what you have open."
          className={cn(area, 'resize-none pr-9')}
        />
        <button type="button" aria-label="Send" disabled={busy || q.trim() === ''} onClick={() => void send(q)} className="absolute bottom-4 right-4 flex size-6 items-center justify-center bg-[var(--cr-accent)] text-[var(--cr-on-accent)] disabled:opacity-40">
          {busy ? <Spinner size={11} /> : <ArrowUp size={14} strokeWidth={2.4} />}
        </button>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto">
        {list.map((a) => (
          <AskRow key={a.id} a={a} />
        ))}
        {list.length === 0 && (
          <li className="flex flex-col gap-1 p-2">
            {SUGGESTIONS.map((s) => (
              <button key={s} type="button" onClick={() => void send(s)} className="px-2 py-1.5 text-left text-[12.5px] text-[var(--cr-ink-2)] hover:bg-[var(--cr-row)]">
                {s}
              </button>
            ))}
          </li>
        )}
      </ul>
    </div>
  );
}
