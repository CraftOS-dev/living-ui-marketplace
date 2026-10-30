/**
 * The agent's work, laid out for a fast and honest review: evidence first
 * (each acceptance criterion met or not, how it was checked, what it could
 * not verify), the summary after it, then Approve, Request changes (with
 * what to change; the agent reads it and reworks) or Reject (it comes back
 * to you).
 */
import { useState } from 'react';
import { Check, CircleAlert, CircleCheck, CircleX, RotateCcw, ThumbsDown, X } from 'lucide-react';
import { toast } from '../../../kit/index.ts';
import { api } from '../../lib/api.ts';
import { ago } from '../../lib/format.ts';
import { Markdown } from '../../lib/markdown.tsx';
import type { CardFull } from '../../lib/types.ts';
import { AgentAvatar, Button, Kbd, Textarea, errMessage } from '../ui.tsx';

export function ReviewPacketView({ card }: { card: CardFull }): React.JSX.Element | null {
  const r = card.review;
  if (r === null) return null;
  const unmet = r.criteria.filter((c) => !c.met).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--kb-ink-2)]">
        {r.by === 'agent' && <AgentAvatar size={20} />}
        <span>
          <span className="font-semibold text-[var(--kb-ink)]">{r.by === 'agent' ? 'The agent' : 'A rule'}</span> submitted {ago(r.at)}
          {r.attempt !== undefined && r.attempt > 1 ? ` · attempt ${r.attempt}` : ''}
          {r.from ? ` · from ${r.from}` : ''}
        </span>
      </div>
      {r.criteria.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">Acceptance criteria {unmet > 0 ? <span className="normal-case tracking-normal text-[var(--kb-red)]">· {unmet} not met</span> : <span className="normal-case tracking-normal text-[var(--kb-green)]">· all met</span>}</div>
          {r.criteria.map((c, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              {c.met ? <CircleCheck size={15} aria-label="Met" className="mt-0.5 shrink-0 text-[var(--kb-green)]" /> : <CircleX size={15} aria-label="Not met" className="mt-0.5 shrink-0 text-[var(--kb-red)]" />}
              <span>
                {c.text}
                {c.note ? <span className="text-[var(--kb-muted)]"> · {c.note}</span> : null}
              </span>
            </div>
          ))}
        </div>
      )}
      {r.evidence.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">How it was checked</div>
          {r.evidence.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <Check size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--kb-muted)]" />
              <Markdown text={e} />
            </div>
          ))}
        </div>
      )}
      {r.unverified.length > 0 && (
        <div className="flex flex-col gap-1 rounded-[var(--kb-radius-sm)] bg-[var(--kb-amber-soft)] px-3 py-2">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--kb-amber)]">Could not verify</div>
          {r.unverified.map((e, i) => (
            <div key={i} className="flex items-start gap-2 text-[13px]">
              <CircleAlert size={14} aria-hidden className="mt-0.5 shrink-0 text-[var(--kb-amber)]" />
              <span>{e}</span>
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--kb-muted)]">Summary</div>
        <Markdown text={r.summary} />
      </div>
    </div>
  );
}

/** Approve, request changes or reject. `compact` puts the buttons on one line with shortcuts. */
export function ReviewActions({ card, onDone, keys }: { card: CardFull; onDone?: () => void; keys?: boolean }): React.JSX.Element {
  const [mode, setMode] = useState<'' | 'changes' | 'reject'>('');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const run = async (fn: () => Promise<unknown>, msg: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast.success(msg);
      setMode('');
      setText('');
      onDone?.();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  if (mode !== '') {
    return (
      <div className="flex flex-col gap-2">
        <Textarea
          autoFocus
          aria-label={mode === 'changes' ? 'What to change' : 'Why'}
          value={text}
          minRows={3}
          placeholder={mode === 'changes' ? 'What should the agent change? It reads this and reworks the card.' : 'Why reject it? The card comes back to you.'}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setMode('');
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && text.trim() !== '') void run(() => (mode === 'changes' ? api.changes(card.id, text.trim()) : api.reject(card.id, text.trim())), mode === 'changes' ? 'Sent back for changes' : 'Rejected');
          }}
        />
        <div className="flex gap-2">
          <Button variant="primary" busy={busy} disabled={text.trim() === ''} icon={mode === 'changes' ? RotateCcw : ThumbsDown} onClick={() => void run(() => (mode === 'changes' ? api.changes(card.id, text.trim()) : api.reject(card.id, text.trim())), mode === 'changes' ? 'Sent back for changes' : 'Rejected')}>
            {mode === 'changes' ? 'Send back' : 'Reject'}
          </Button>
          <Button variant="ghost" icon={X} onClick={() => setMode('')}>
            Cancel
          </Button>
        </div>
      </div>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" icon={Check} busy={busy} onClick={() => void run(() => api.approve(card.id), 'Approved')}>
        Approve {keys === true && <Kbd>A</Kbd>}
      </Button>
      <Button icon={RotateCcw} onClick={() => setMode('changes')} data-kb-changes="">
        Request changes {keys === true && <Kbd>R</Kbd>}
      </Button>
      <Button variant="ghost" icon={ThumbsDown} onClick={() => setMode('reject')} data-kb-reject="">
        Reject
      </Button>
    </div>
  );
}
