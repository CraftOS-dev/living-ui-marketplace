/**
 * Ask AI: a question about the books goes to the AI agent (trigger
 * agent_asked) with what is on screen; it answers from the reports and
 * entries, with links to what it used. Answers arrive live.
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

const SUGGESTIONS = ['How much did I spend on software this year?', 'Why is my profit lower than last month?', 'Which customers are late paying?', 'What should I set aside for tax this quarter?'];

export function openLink(l: { type: string; id: string }): void {
  if (l.type === 'transaction') go('ledger', { txn: l.id });
  else if (l.type === 'document') go('sales', { doc: l.id });
  else if (l.type === 'account') go('ledger', { account: l.id });
  else if (l.type === 'report') go('reports', { r: l.id });
  else if (l.type === 'line') go('inbox', { line: l.id });
  else if (l.type === 'contact') go('setup', { tab: 'contacts', contact: l.id });
}

function AskRow({ a }: { a: Ask }): React.JSX.Element {
  const busy = a.status === 'waiting' || a.status === 'working';
  return (
    <li className="group flex flex-col gap-1.5 border-b border-[var(--lf-hair)] px-3 py-2.5">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 text-[12.5px] font-semibold">{a.question || (a.kind === 'explain' ? 'Explain this report' : a.kind === 'reminder' ? 'Draft a payment reminder' : 'Question')}</p>
        <span className="shrink-0 text-[11px] text-[var(--lf-muted)]">{ago(a.created)}</span>
        <IconBtn icon={Trash2} label="Delete" size={20} className="opacity-0 group-hover:opacity-100" onClick={() => void api.deleteAsk(a.id)} />
      </div>
      {busy && (
        <p className="flex items-center gap-2 text-[12px] text-[var(--lf-accent-text)]">
          <Sparkles size={12} className="lf-pulse" /> {a.status === 'working' ? 'Your AI agent is looking into it' : 'Waiting for your AI agent'}
        </p>
      )}
      {a.status === 'done' && <p className="lf-prose text-[12.5px] leading-[18px] text-[var(--lf-ink-2)]">{a.answer}</p>}
      {a.status === 'failed' && <p className="text-[12px] text-[var(--lf-neg-text)]">{a.error || 'Your AI agent could not answer.'}</p>}
      {a.links.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {a.links.map((l, i) => (
            <button key={i} type="button" onClick={() => openLink(l)} className="h-6 rounded-[4px] border border-[var(--lf-line)] px-1.5 text-[11.5px] font-semibold hover:bg-[var(--lf-row)]">
              {l.label || l.type}
            </button>
          ))}
        </div>
      )}
    </li>
  );
}

export function AskPanel({ onClose }: { onClose: () => void }): React.JSX.Element {
  const asks = useLive(() => api.asks(20), ['asks'], []);
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState(false);
  const send = async (text: string): Promise<void> => {
    if (text.trim() === '') return;
    setBusy(true);
    try {
      const r = await api.ask(text.trim());
      setQ('');
      if (!r.asked && r.reason !== '') toast.error('Saved, but your AI agent was not reached: ' + r.reason);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const list = (asks.data?.asks ?? []).filter((a) => a.kind !== 'reminder');
  return (
    <div className="flex max-h-[min(72vh,620px)] flex-col">
      <div className="flex items-center gap-2 border-b border-[var(--lf-hair)] px-3 py-2">
        <Sparkles size={14} className="text-[var(--lf-accent-text)]" />
        <span className="text-[13px] font-bold">Ask your AI agent</span>
        <span className="flex-1" />
        <button type="button" onClick={onClose} className="text-[12px] font-semibold text-[var(--lf-muted)] hover:text-[var(--lf-ink)]">
          Close
        </button>
      </div>
      <div className="relative border-b border-[var(--lf-hair)] p-2">
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
          placeholder="Ask about your numbers. It sees what you have open."
          className={cn(area, 'resize-none pr-9')}
        />
        <button type="button" aria-label="Send" disabled={busy || q.trim() === ''} onClick={() => void send(q)} className="absolute bottom-4 right-4 flex size-6 items-center justify-center rounded-[5px] bg-[var(--lf-accent)] text-[var(--lf-on-accent)] disabled:opacity-40">
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
              <button key={s} type="button" onClick={() => void send(s)} className="rounded-[5px] px-2 py-1.5 text-left text-[12.5px] text-[var(--lf-ink-2)] hover:bg-[var(--lf-row)]">
                {s}
              </button>
            ))}
          </li>
        )}
      </ul>
    </div>
  );
}
