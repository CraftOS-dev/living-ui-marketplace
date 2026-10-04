/**
 * Invention building blocks shared by the inventions list, the board and
 * the invention page: stage moves (with the decision note the inventor
 * reads), the grace-period warning, the score bar, inventor names and the
 * "new invention" dialog.
 */
import { useMemo, useState } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button, Dialog, Input, Textarea, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addMonths, d10, daysUntil, fmtDate } from '../lib/format.ts';
import { DISCLOSURE_STAGE_LABEL } from '../lib/labels.ts';
import { navigate } from '../lib/router.ts';
import type { DisclosureRec, DisclosureStage, InvolvementRec, MatterRec, PartyRec } from '../lib/types.ts';
import { Field, TONE_TEXT } from './ui.tsx';

export type DisclosureX = DisclosureRec & { expand?: { matter?: MatterRec } };
export type InvolvementX = InvolvementRec & { expand?: { party?: PartyRec } };

/** Pipeline columns on the board, in order. */
export const BOARD_STAGES: DisclosureStage[] = ['submitted', 'search', 'review', 'approved', 'drafting', 'filed'];

/** Stages kept off the board, shown in a separate list. */
export type OtherBucket = 'draft' | 'on_hold' | 'rejected' | 'archived';
export const OTHER_BUCKETS: Record<OtherBucket, { label: string; stages: DisclosureStage[] }> = {
  draft: { label: 'Drafts', stages: ['draft'] },
  on_hold: { label: 'On hold', stages: ['on_hold'] },
  rejected: { label: 'Not pursued', stages: ['rejected'] },
  archived: { label: 'Archived', stages: ['archived', 'merged'] },
};

/** Stages a person can move an invention to (merged happens elsewhere). */
export const MOVE_STAGES: DisclosureStage[] = ['draft', 'submitted', 'search', 'review', 'approved', 'drafting', 'filed', 'on_hold', 'rejected', 'archived'];

export function needsDecision(stage: DisclosureStage): boolean {
  return stage === 'rejected' || stage === 'on_hold';
}

/** Local calendar day of a timestamp (submitted, decided), '' when empty. */
export function stampDay(v: string | null | undefined): string {
  if (!v) return '';
  const t = new Date(v.replace(' ', 'T'));
  if (Number.isNaN(t.getTime())) return d10(v);
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
}

/* ------------------------------------------------------------------ */
/* Grace period                                                        */
/* ------------------------------------------------------------------ */

/** Earliest public disclosure or offer for sale, '' when none. */
export function barDate(d: Pick<DisclosureRec, 'public_disclosure_date' | 'on_sale_date'>): string {
  const dates = [d10(d.public_disclosure_date), d10(d.on_sale_date)].filter((x) => x !== '').sort();
  return dates[0] ?? '';
}

export interface GraceInfo {
  bar: string;
  fileBy: string;
  passed: boolean;
}

export function graceInfo(d: Pick<DisclosureRec, 'public_disclosure_date' | 'on_sale_date'>): GraceInfo | null {
  const bar = barDate(d);
  if (bar === '') return null;
  const fileBy = addMonths(bar, 12);
  return { bar, fileBy, passed: daysUntil(fileBy) < 0 };
}

export function GraceWarning({ d, className }: { d: Pick<DisclosureRec, 'public_disclosure_date' | 'on_sale_date'>; className?: string | undefined }): React.JSX.Element | null {
  const g = graceInfo(d);
  if (g === null) return null;
  return (
    <div className={cn('flex items-start gap-1.5 text-xs', g.passed ? TONE_TEXT.bad : TONE_TEXT.warn, className)}>
      <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden />
      <span>
        Disclosed on {fmtDate(g.bar)}: file by {fmtDate(g.fileBy)} (US and JP grace period){g.passed ? ', now passed' : ''}
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Score                                                               */
/* ------------------------------------------------------------------ */

export function ScoreBar({ score, reviews, className }: { score: number; reviews: number; className?: string | undefined }): React.JSX.Element {
  if (reviews === 0) return <span className={cn('text-xs text-[var(--agent-app-muted)]', className)}>Not scored</span>;
  const pct = Math.max(0, Math.min(100, score));
  return (
    <span className={cn('inline-flex items-center gap-2', className)} title={`Average score ${score} of 100 from ${reviews} review${reviews === 1 ? '' : 's'}`}>
      <span className="text-[12.5px] font-semibold tabular-nums">{Math.round(score)}</span>
      <span className="h-1.5 w-14 bg-[var(--agent-app-border)]" aria-hidden>
        <span className="block h-full bg-[var(--agent-app-text)]/55" style={{ width: `${pct}%` }} />
      </span>
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Inventors                                                           */
/* ------------------------------------------------------------------ */

/** Inventor names per disclosure from involvements (role inventor). */
export function useInventorNames(enabled: boolean): Map<string, string[]> {
  const inv = useCollection<InvolvementX>('involvements', {
    filter: enabled ? 'disclosure != "" && role = "inventor"' : 'id = ""',
    expand: 'party',
    sort: 'created',
  });
  return useMemo(() => {
    const m = new Map<string, string[]>();
    for (const i of inv.records) {
      const name = i.expand?.party?.name ?? '';
      if (name === '') continue;
      const arr = m.get(i.disclosure) ?? [];
      arr.push(name);
      m.set(i.disclosure, arr);
    }
    return m;
  }, [inv.records]);
}

/** Recorded inventors first, then any names the submitter typed that are not recorded yet. */
export function inventorLabel(d: DisclosureRec, recorded: string[] | undefined): string {
  const names = [...(recorded ?? [])];
  const seen = new Set(names.map((n) => n.trim().toLowerCase()));
  for (const n of d.inventor_names.split(',')) {
    const t = n.trim();
    if (t !== '' && !seen.has(t.toLowerCase())) {
      names.push(t);
      seen.add(t.toLowerCase());
    }
  }
  return names.join(', ');
}

/* ------------------------------------------------------------------ */
/* Stage moves                                                         */
/* ------------------------------------------------------------------ */

function DecisionDialog({
  d,
  stage,
  onClose,
  onDone,
}: {
  d: DisclosureRec;
  stage: DisclosureStage;
  onClose: () => void;
  onDone?: (() => void) | undefined;
}): React.JSX.Element {
  const [note, setNote] = useState(needsDecision(stage) ? '' : d.decision);
  const [busy, setBusy] = useState(false);
  const required = needsDecision(stage);
  const submit = async (): Promise<void> => {
    if (required && note.trim() === '') {
      toast.error('Explain the decision so the inventor knows why.');
      return;
    }
    setBusy(true);
    try {
      await op('disclosures/move', { id: d.id, stage, ...(note.trim() !== '' ? { decision: note.trim() } : {}) });
      toast.success(`${d.ref || d.title} moved to ${DISCLOSURE_STAGE_LABEL[stage]}`);
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Move to ${DISCLOSURE_STAGE_LABEL[stage]}`}
      description={required ? 'Explain the decision. The inventor sees this note on their invention.' : 'Add a note for the inventor and the history (optional).'}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={stage === 'rejected' ? 'danger' : 'primary'} onClick={() => void submit()} loading={busy} disabled={required && note.trim() === ''}>
            Move to {DISCLOSURE_STAGE_LABEL[stage]}
          </Button>
        </>
      }
    >
      <Field label={required ? 'Decision' : 'Note'} required={required}>
        <Textarea
          rows={4}
          autoFocus
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={
            stage === 'rejected'
              ? 'For example: prior art already covers this, or it does not fit our product plans'
              : stage === 'on_hold'
                ? 'For example: waiting for test results before deciding'
                : 'What happens next'
          }
        />
      </Field>
    </Dialog>
  );
}

/** Move an invention between stages; asks for the decision note only where it is required. */
export function useStageMover(onDone?: () => void): { request: (d: DisclosureRec, stage: DisclosureStage, withNote?: boolean) => void; dialog: React.JSX.Element | null } {
  const [pending, setPending] = useState<{ d: DisclosureRec; stage: DisclosureStage } | null>(null);
  const request = (d: DisclosureRec, stage: DisclosureStage, withNote = false): void => {
    if (stage === d.stage) return;
    if (withNote || needsDecision(stage)) {
      setPending({ d, stage });
      return;
    }
    op('disclosures/move', { id: d.id, stage })
      .then(() => {
        toast.success(`${d.ref || d.title} moved to ${DISCLOSURE_STAGE_LABEL[stage]}`);
        onDone?.();
      })
      .catch((err: unknown) => toast.error(err instanceof Error ? err.message : String(err)));
  };
  const dialog = pending !== null ? <DecisionDialog d={pending.d} stage={pending.stage} onClose={() => setPending(null)} onDone={onDone} /> : null;
  return { request, dialog };
}

/* ------------------------------------------------------------------ */
/* New invention                                                       */
/* ------------------------------------------------------------------ */

export function NewInventionDialog({ onClose, heading = 'New invention' }: { onClose: () => void; heading?: string | undefined }): React.JSX.Element {
  const { me } = useApp();
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (title.trim() === '') {
      toast.error('Give the invention a short title.');
      return;
    }
    if (me === null) {
      toast.error('Your account is still loading. Try again in a moment.');
      return;
    }
    setBusy(true);
    try {
      const rec = await createRecord<DisclosureRec>('disclosures', { title: title.trim(), stage: 'draft', submitted_by: me.id });
      toast.success('Draft created. Describe the invention, then submit it for review.');
      onClose();
      navigate('invention', rec.id);
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={heading}
      description="Start with a working title. You describe the invention on the next page and can save a draft before submitting it."
      className="w-[min(94vw,30rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={title.trim() === ''}>
            Create draft
          </Button>
        </>
      }
    >
      <Input
        label="Title"
        autoFocus
        value={title}
        maxLength={300}
        placeholder="For example: Adaptive lip sync for dubbed dialogue"
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit();
        }}
      />
    </Dialog>
  );
}
