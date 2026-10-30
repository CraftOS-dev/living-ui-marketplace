/**
 * Asking your AI agent to review a board, following the review honestly
 * (sent, working, done, could not), and reading it: the review itself, the
 * notes it added and the links it proposed, kept or rejected in one go.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw, Sparkles, X } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { AutoTextarea, CircleButton, PillButton, Popover, StatusPill, softArea } from '../components/ui.tsx';
import { api, errMessage } from '../lib/api.ts';
import { ago } from '../lib/dates.ts';
import type { Board } from '../lib/types.ts';

export function AskReview({ board, onAsked }: { board: Board; onAsked: () => void }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [focus, setFocus] = useState(board.review_focus);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const [slow, setSlow] = useState(false);
  const state = board.review_state;
  useEffect(() => {
    setSlow(false);
    if (state !== 'waiting') return;
    const t = setTimeout(() => setSlow(true), 20000);
    return () => clearTimeout(t);
  }, [state]);

  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await api.requestReview(board.id, focus.trim());
      setOpen(false);
      onAsked();
      if (!r.asked_agent) toast.info('Saved. Your AI agent is asked as soon as it can take more work.');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (state === 'waiting' || state === 'working') {
    return (
      <span className="inline-flex items-center gap-2" title={slow ? 'It picks this up while your AI agent is running.' : undefined}>
        <StatusPill tone="info" pulse>
          {state === 'waiting' ? (slow ? 'Waiting for your AI agent' : 'Sent to your AI agent') : 'Your AI agent is reviewing'}
        </StatusPill>
        {state === 'waiting' && (
          <button type="button" onClick={() => void api.cancelReview(board.id).catch(() => undefined)} className="text-[12px] font-semibold text-[var(--rb-ink-2)] hover:text-[var(--rb-ink)]">
            Cancel
          </button>
        )}
      </span>
    );
  }

  return (
    <div ref={ref} className="relative">
      <PillButton variant="light" icon={Sparkles} onClick={() => setOpen((o) => !o)} aria-expanded={open} disabled={board.cards === 0} title={board.cards === 0 ? 'Add a few cards first' : 'Your AI agent reads the board, adds what is missing and proposes links'}>
        <span className="hidden xl:inline">Ask your AI agent to review</span>
        <span className="xl:hidden">AI review</span>
      </PillButton>
      <Popover open={open} onClose={() => setOpen(false)} keep={ref} align="right" className="w-[22rem] p-3.5">
        <p className="text-[15px] font-bold">Review this board</p>
        <p className="mt-1 text-[13px] leading-5 text-[var(--rb-ink-2)]">Your AI agent reads every card, adds notes on what is missing, proposes links between related cards (you keep or reject each) and writes a short review.</p>
        <AutoTextarea autoFocus value={focus} onChange={setFocus} minRows={2} placeholder="Anything to look at in particular? (optional)" aria-label="Focus of the review" className={cn(softArea, 'mt-3 text-[13px]')} />
        <div className="mt-3 flex justify-end">
          <PillButton variant="dark" icon={Sparkles} loading={busy} onClick={() => void ask()}>
            Ask for a review
          </PillButton>
        </div>
      </Popover>
    </div>
  );
}

export function ReviewPanel({ board, onClose, onShowProposals }: { board: Board; onClose: () => void; onShowProposals: () => void }): React.JSX.Element {
  const [busy, setBusy] = useState<'' | 'keep' | 'reject' | 'again'>('');
  const decide = async (d: 'confirm' | 'reject'): Promise<void> => {
    setBusy(d === 'confirm' ? 'keep' : 'reject');
    try {
      const r = await api.decideLinks(d, { board: board.id });
      toast.success(`${d === 'confirm' ? 'Kept' : 'Rejected'} ${r.decided} ${r.decided === 1 ? 'link' : 'links'}`);
    } catch {
      /* toasted */
    } finally {
      setBusy('');
    }
  };
  const again = async (): Promise<void> => {
    setBusy('again');
    try {
      await api.requestReview(board.id, board.review_focus);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const failed = board.review_state === 'failed';
  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-start gap-2.5">
        <span className="flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-[var(--rb-line)] text-[var(--rb-accent)]">
          <Sparkles size={14} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-bold">{failed ? 'The review could not be done' : 'Review by your AI agent'}</span>
          <span className="block text-[12px] text-[var(--rb-ink-2)]">{ago(board.review_at)}</span>
        </span>
        <CircleButton icon={X} label="Close" size={28} onClick={onClose} />
      </div>
      {board.review_focus !== '' && (
        <p className="rounded-[8px] bg-[var(--rb-row)] px-3 py-2 text-[12.5px] leading-5 text-[var(--rb-ink-2)]">
          <span className="font-semibold text-[var(--rb-ink)]">You asked:</span> {board.review_focus}
        </p>
      )}
      <p className={cn('rb-prose text-[13.5px] leading-[22px]', failed && 'text-[var(--rb-red-text)]')}>{board.review_note}</p>
      {board.proposed > 0 && (
        <div className="rounded-[8px] border border-dashed border-[var(--rb-accent)] p-3">
          <button type="button" onClick={onShowProposals} className="text-left text-[13px] font-semibold hover:underline">
            {board.proposed} proposed {board.proposed === 1 ? 'link waits' : 'links wait'} for you
          </button>
          <p className="mt-0.5 text-[12px] text-[var(--rb-ink-2)]">Dashed on the board. Click one to see why, or decide all at once.</p>
          <div className="mt-3 flex gap-2">
            <PillButton variant="dark" size="sm" icon={Check} loading={busy === 'keep'} onClick={() => void decide('confirm')}>
              Keep all
            </PillButton>
            <button type="button" disabled={busy !== ''} onClick={() => void decide('reject')} className="inline-flex h-7 items-center gap-1.5 rounded-[6px] border border-[var(--rb-line)] px-2.5 text-[12px] font-semibold hover:bg-[var(--rb-row)]">
              <X size={14} /> Reject all
            </button>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" disabled={busy !== ''} onClick={() => void again()} className="inline-flex h-8 items-center gap-1.5 rounded-[7px] border border-[var(--rb-line)] px-3 text-[13px] font-semibold hover:bg-[var(--rb-row)]">
          <RefreshCw size={13} className={busy === 'again' ? 'animate-spin' : ''} /> {failed ? 'Try again' : 'Review again'}
        </button>
        <button type="button" onClick={() => void api.dismissReview(board.id).then(onClose).catch(() => undefined)} className="inline-flex h-8 items-center rounded-[7px] px-3 text-[13px] font-semibold text-[var(--rb-ink-2)] hover:bg-[var(--rb-row)] hover:text-[var(--rb-ink)]">
          Dismiss
        </button>
      </div>
    </div>
  );
}
