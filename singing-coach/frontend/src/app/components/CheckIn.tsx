/**
 * The voice check: five questions from the NIDCD's warning signs, 1 (fine)
 * to 5 (bad), and pain. Answered before the day's first singing (when
 * check-ins are on) and whenever the person wants. A 4 or 5, or pain, makes
 * the day gentle; weeks of hoarseness bring the advice to see a doctor.
 */
import { useState } from 'react';
import { HeartPulse } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { api } from '../lib/api.ts';
import type { Checkin } from '../lib/types.ts';
import { Button, Dialog, errMessage } from './ui.tsx';

const QUESTIONS: { key: 'hoarse' | 'effort' | 'discomfort' | 'high_loss' | 'clearing'; label: string; hint: string }[] = [
  { key: 'hoarse', label: 'Hoarse or raspy', hint: 'How your speaking voice sounds today' },
  { key: 'effort', label: 'Speaking takes effort', hint: 'Talking feels like work' },
  { key: 'discomfort', label: 'Throat feels raw or strained', hint: 'Any soreness or tightness' },
  { key: 'high_loss', label: 'High notes are harder', hint: 'Compared with your usual voice' },
  { key: 'clearing', label: 'Clearing the throat a lot', hint: 'Coughing or clearing to speak' },
];

export function CheckInDialog({ open, onClose, onDone, when = 'before', sz }: { open: boolean; onClose: () => void; onDone: (c: Checkin, advice: string) => void; when?: 'before' | 'after' | 'other'; sz?: number | null | undefined }): React.JSX.Element | null {
  const [vals, setVals] = useState<Record<string, number>>({ hoarse: 1, effort: 1, discomfort: 1, high_loss: 1, clearing: 1 });
  const [pain, setPain] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      const r = await api.checkin({ when, hoarse: vals.hoarse ?? 1, effort: vals.effort ?? 1, discomfort: vals.discomfort ?? 1, high_loss: vals.high_loss ?? 1, clearing: vals.clearing ?? 1, pain, sz_ratio: sz ?? undefined });
      onDone(r.checkin, r.advice);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="How is your voice today?"
      width={500}
      footer={
        <>
          <Button onClick={onClose}>Not now</Button>
          <Button variant="primary" icon={HeartPulse} busy={busy} onClick={() => void submit()}>
            Save
          </Button>
        </>
      }
    >
      <p className="mb-3 text-[13px] leading-5 text-[var(--sc-ink-2)]">A few seconds. 1 is fine, 5 is bad. The app keeps the day gentle when your voice needs it.</p>
      <div className="flex flex-col gap-2.5">
        {QUESTIONS.map((q) => (
          <div key={q.key} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[13px] font-medium">{q.label}</div>
              <div className="text-[11.5px] text-[var(--sc-muted)]">{q.hint}</div>
            </div>
            <div role="radiogroup" aria-label={q.label} className="flex shrink-0 gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={vals[q.key] === n}
                  onClick={() => setVals((v) => ({ ...v, [q.key]: n }))}
                  className={cn(
                    'sc-focus sc-mono sc-num size-7 rounded-[var(--sc-radius-sm)] border text-[12px] transition-colors',
                    vals[q.key] === n ? (n >= 4 ? 'border-[var(--sc-warn)] bg-[var(--sc-warn-soft)] font-semibold text-[var(--sc-ink)]' : 'border-[var(--sc-ink)] bg-[var(--sc-ink)] font-semibold text-[var(--sc-page)]') : 'border-[var(--sc-line)] bg-[var(--sc-raised)] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)]',
                  )}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
        <label className="mt-1 flex items-center gap-2.5 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] px-3 py-2 text-[13px]">
          <input type="checkbox" checked={pain} onChange={(e) => setPain(e.target.checked)} className="size-4 accent-[var(--sc-bad)]" />
          <span>
            <span className="font-medium">It hurts</span> <span className="text-[var(--sc-muted)]">(pain when speaking, swallowing or singing)</span>
          </span>
        </label>
      </div>
      {error !== '' && <p className="mt-3 text-[12px] text-[var(--sc-bad)]">{error}</p>}
      <p className="mt-3 text-[11.5px] leading-4 text-[var(--sc-muted)]">Not medical advice. Hoarseness lasting four weeks, pain, or a sudden change in your voice: see an ENT doctor (laryngologist) or a speech-language pathologist. Trouble breathing, coughing blood or trouble swallowing: seek urgent care.</p>
    </Dialog>
  );
}

/** After "Stop: it hurts": what to do now. */
export function HurtDialog({ open, onClose }: { open: boolean; onClose: () => void }): React.JSX.Element | null {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Stop for today"
      width={460}
      footer={
        <Button variant="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="flex flex-col gap-2.5 text-[13px] leading-5 text-[var(--sc-ink-2)]">
        <p>Good call. Singing should never hurt. The session is closed and tomorrow's plan will be gentle.</p>
        <ul className="list-disc pl-5">
          <li>Rest your voice: speak little and softly, do not whisper.</li>
          <li>Sip water; keep the air from getting too dry.</li>
          <li>Try again only when speaking feels easy.</li>
        </ul>
        <p>
          If pain or hoarseness lasts, see an <span className="font-medium text-[var(--sc-ink)]">ENT doctor (laryngologist)</span> or a <span className="font-medium text-[var(--sc-ink)]">speech-language pathologist</span>. Trouble breathing, coughing blood or trouble swallowing: seek urgent care.
        </p>
        <p className="text-[11.5px] text-[var(--sc-muted)]">This is not medical advice.</p>
      </div>
    </Dialog>
  );
}
