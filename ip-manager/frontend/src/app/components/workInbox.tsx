/**
 * Inbox detail: one item under review. Office changes show a field diff,
 * the new office events (with "Record as..." for codes the office used
 * that we do not recognize) and the deadlines each would create; documents
 * and CraftBot proposals show the document next to the proposed event,
 * editable before accepting; agreement drafts show the key terms, editable,
 * and the rights they grant. Accept and reject live in one footer that
 * knows about the second-reviewer rule.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, getPbClient, toast } from '../../kit/index.ts';
import { fileUrl, op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { mergeSelection, useLiveAsync, useLiveReload } from '../lib/live.ts';
import { d10, fmtDate, fmtDateTime, plural } from '../lib/format.ts';
import {
  AGREEMENT_TYPE_LABEL,
  CURRENCIES,
  DIRECTION_LABEL,
  DOC_TYPE_LABEL,
  KIND_LABEL,
  OFFICE_LABEL,
  STATUS_LABEL,
} from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, navigate } from '../lib/router.ts';
import type {
  AgreementType,
  Citation,
  DeadlineKind,
  DiffItem,
  DocType,
  DocumentRec,
  InboxRec,
  MatterRec,
  MatterStatus,
  Proposal,
  WorkRec,
} from '../lib/types.ts';
import { AgentStatus } from './craftbot.tsx';
import { ProposalList, eventCodesFor } from './events.tsx';
import { RecordPicker, dimSpecLabel } from './pickers.tsx';
import { Checkbox, ErrorBox, Fact, FactGrid, Loading, Notice, Pill, Prose, Ref, TONE_BG, Tag } from './ui.tsx';
import { DATE_INPUT_CLS, DateField, PaneHeading, errMsg, useLiveRecord } from './workShared.tsx';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export const INBOX_KIND_LABEL: Record<InboxRec['kind'], string> = {
  office_change: 'Office change',
  document: 'Document',
  agreement_draft: 'Agreement draft',
  agent_proposal: 'CraftBot proposal',
  email: 'Email',
  watch_hit: 'Watch notice',
};

export const INBOX_STATUS_LABEL: Record<InboxRec['status'], string> = {
  new: 'To review',
  awaiting_second: 'Needs second reviewer',
  accepted: 'Accepted',
  partially_accepted: 'Partly accepted',
  rejected: 'Rejected',
};

export const INBOX_STATUS_TONE: Record<InboxRec['status'], Tone> = {
  new: 'info',
  awaiting_second: 'warn',
  accepted: 'good',
  partially_accepted: 'good',
  rejected: 'neutral',
};

type Confidence = Exclude<InboxRec['confidence'], ''>;

export const CONFIDENCE_LABEL: Record<Confidence, string> = {
  high: 'High confidence',
  medium: 'Medium confidence',
  low: 'Low confidence',
  none: 'Not confident',
};

export const CONFIDENCE_SHORT: Record<Confidence, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'None',
};

export const CONFIDENCE_TONE: Record<Confidence, Tone> = {
  high: 'good',
  medium: 'info',
  low: 'warn',
  none: 'neutral',
};

const SOURCE_LABEL: Record<Exclude<InboxRec['source'], ''>, string> = {
  office_sync: 'Office data',
  agent: 'CraftBot',
  email: 'Email',
  user: 'Team member',
};

/** "CraftBot", "Office data · USPTO TSDR", "Team member · Jin Park" */
export function sourceLine(item: InboxRec): string {
  const src = item.source !== '' ? SOURCE_LABEL[item.source] : '';
  const by = item.proposed_by.trim();
  if (src === '') return by;
  if (by === '' || by === src) return src;
  return `${src} · ${by}`;
}

const STATUTORY = new Set<DeadlineKind>(['hard', 'extendable', 'designated']);

const DEADLINE_KINDS = Object.entries(KIND_LABEL).map(([value, label]) => ({ value, label }));

/* ------------------------------------------------------------------ */
/* Small value helpers for loosely typed proposal JSON                 */
/* ------------------------------------------------------------------ */

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

function str(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'number' && Number.isFinite(v)) return String(v);
  return '';
}

function strArr(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
}

function numArr(v: unknown): number[] {
  return Array.isArray(v) ? v.map((x) => Number(x)).filter((n) => Number.isInteger(n)) : [];
}

function strRecord(v: unknown): Record<string, string> {
  const r = asRecord(v);
  const out: Record<string, string> = {};
  if (r !== null) for (const [k, x] of Object.entries(r)) if (typeof x === 'string') out[k] = x;
  return out;
}

function firstDecision(item: InboxRec): Record<string, unknown> | null {
  return item.status === 'awaiting_second' ? asRecord(item.proposal?.first_decision) : null;
}

function humanField(f: string): string {
  const s = f.split('_').join(' ').trim();
  return s === '' ? '' : s.charAt(0).toUpperCase() + s.slice(1);
}

function toggled<T>(set: Set<T>, v: T, on: boolean): Set<T> {
  const n = new Set(set);
  if (on) n.add(v);
  else n.delete(v);
  return n;
}

/* ------------------------------------------------------------------ */
/* Plan contract between the bodies and the decision footer            */
/* ------------------------------------------------------------------ */

export type BodyMode = 'edit' | 'view' | 'decided';

export interface DecisionPlan {
  payload: Record<string, unknown>;
  creates: number;
  statutory: boolean;
  blocker: string;
  acceptLabel?: string | undefined;
}

interface BodyProps {
  item: InboxRec;
  mode: BodyMode;
  onPlan: (p: DecisionPlan) => void;
}

interface PreviewEvent {
  index: number;
  code: string;
  date: string;
  label: string;
  proposals: Proposal[];
}

interface DecideResult {
  status: InboxRec['status'];
  summary?: { fields: number; events: number; deadlines: number; created: { id: string; title: string; due_date: string }[] } | undefined;
  agreement_id?: string | undefined;
}

function acceptedText(r: DecideResult): string {
  const head = r.status === 'partially_accepted' ? 'Partly accepted' : 'Accepted';
  const s = r.summary;
  if (s === undefined) return `${head}.`;
  const parts: string[] = [];
  if (s.deadlines > 0) parts.push(`${plural(s.deadlines, 'deadline')} created`);
  if (s.fields > 0) parts.push(`${plural(s.fields, 'field')} updated`);
  if (s.events > 0) parts.push(`${plural(s.events, 'event')} recorded`);
  let text = parts.length ? `${head}: ${parts.join(', ')}.` : `${head}.`;
  if (s.created.length > 0) {
    const shown = s.created.slice(0, 3).map((c) => `${c.title} (due ${fmtDate(c.due_date)})`);
    text += ` ${shown.join('; ')}${s.created.length > 3 ? `; and ${s.created.length - 3} more` : ''}.`;
  }
  return text;
}

/* ------------------------------------------------------------------ */
/* Detail shell                                                        */
/* ------------------------------------------------------------------ */

export function InboxDetail({
  itemId,
  onBack,
  onDecided,
}: {
  itemId: string;
  onBack: () => void;
  onDecided: (id: string) => void;
}): React.JSX.Element {
  const { can, me, userName, settings, meta } = useApp();
  const { record: item, loading, error, refresh } = useLiveRecord<InboxRec>('inbox_items', itemId);
  const matter = useLiveRecord<MatterRec>('matters', item?.matter ?? '');
  const [plan, setPlan] = useState<DecisionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const back = (
    <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] lg:hidden">
      <ArrowLeft size={13} aria-hidden /> Inbox
    </button>
  );

  if (loading) {
    return (
      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {back}
        <Loading label="Loading item" />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {back}
        <ErrorBox message={error ?? 'This item could not be loaded.'} onRetry={refresh} />
      </div>
    );
  }

  const pending = item.status === 'new' || item.status === 'awaiting_second';
  const myId = me?.id ?? '';
  const iAmFirst = item.status === 'awaiting_second' && item.first_approver !== '' && item.first_approver === myId;
  const mode: BodyMode = !pending ? 'decided' : can.edit && !iAmFirst ? 'edit' : 'view';
  const fromAgent = item.source === 'agent' || item.kind === 'document' || item.kind === 'agent_proposal' || item.kind === 'email';
  const needsTwo = item.status === 'new' && settings?.second_reviewer === true && fromAgent && plan?.statutory === true;
  const officeLabel = item.office !== '' ? (meta?.office_labels[item.office] ?? OFFICE_LABEL[item.office] ?? item.office) : '';

  let acceptLabel = 'Accept';
  if (plan?.acceptLabel !== undefined) acceptLabel = plan.acceptLabel;
  else if (item.status === 'awaiting_second') acceptLabel = 'Give second approval';
  else if (needsTwo) acceptLabel = 'Give first approval';
  else if (plan !== null && plan.creates > 0) acceptLabel = `Accept and create ${plural(plan.creates, 'deadline')}`;

  const accept = async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true);
    try {
      const r = await op<DecideResult>('inbox/decide', { id: item.id, decision: 'accept', ...plan.payload });
      if (r.agreement_id !== undefined && r.agreement_id !== '') {
        toast.success('Agreement created from the draft.');
        navigate('agreement', r.agreement_id);
        return;
      }
      if (r.status === 'awaiting_second') toast.success('First approval recorded. A different reviewer must give the second approval.');
      else toast.success(acceptedText(r));
      refresh();
      onDecided(item.id);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const body =
    item.kind === 'office_change' ? (
      <OfficeChangeBody key={item.id} item={item} matter={matter.record} mode={mode} onPlan={setPlan} />
    ) : item.kind === 'agreement_draft' ? (
      <AgreementDraftBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : (
      <ProposalBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    );

  const conf = item.confidence !== '' ? item.confidence : null;

  return (
    <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      <div className="border-b border-[var(--agent-app-border)] px-4 py-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{INBOX_KIND_LABEL[item.kind]}</Tag>
          <Pill tone={INBOX_STATUS_TONE[item.status]}>{INBOX_STATUS_LABEL[item.status]}</Pill>
          {conf !== null && (
            <Pill tone={CONFIDENCE_TONE[conf]} title="How sure the proposer is about what it read">
              {CONFIDENCE_LABEL[conf]}
            </Pill>
          )}
        </div>
        <h2 className="mt-2 text-base font-semibold leading-snug">{item.title}</h2>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--agent-app-muted)]">
          <span>{sourceLine(item)}</span>
          <span className="tabular-nums">{fmtDateTime(item.created)}</span>
          {officeLabel !== '' && officeLabel !== item.proposed_by && <span>{officeLabel}</span>}
          {matter.record !== null && (
            <a href={href('matter', matter.record.id)} className="inline-flex min-w-0 items-center gap-1.5 hover:underline">
              <Ref>{matter.record.ref}</Ref>
              <span className="truncate">{matter.record.title}</span>
            </a>
          )}
        </div>
      </div>

      {body}

      <div className={cn('border-t border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3', pending && can.edit && 'sticky bottom-0 z-10')}>
        {pending ? (
          <div className="flex flex-col gap-3">
            {item.status === 'awaiting_second' && (
              <Notice tone="warn">
                First approval by <b>{userName(item.first_approver) || 'a reviewer'}</b>
                {item.first_approved_at !== '' ? ` on ${fmtDateTime(item.first_approved_at)}` : ''}.{' '}
                {iAmFirst
                  ? 'Waiting for a second reviewer: a different person must give the second approval.'
                  : 'Statutory deadlines proposed by CraftBot need a second reviewer. Check the choices above, then give the second approval.'}
              </Notice>
            )}
            {!can.edit ? (
              <p className="text-[13px] text-[var(--agent-app-muted)]">
                Only admins, IP managers and counsel can accept or reject Inbox items. Everything here is visible to you for reference.
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="w-full text-xs text-[var(--agent-app-muted)] sm:w-auto sm:min-w-0 sm:flex-1">
                  {iAmFirst
                    ? 'You gave the first approval.'
                    : plan !== null && plan.blocker !== ''
                      ? plan.blocker
                      : needsTwo
                        ? 'Statutory deadlines from CraftBot need two reviewers. Yours is the first approval.'
                        : 'Nothing changes on the record until you accept.'}
                </p>
                <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                    Reject
                  </Button>
                  <Button onClick={() => void accept()} loading={busy} disabled={plan === null || plan.blocker !== '' || iAmFirst}>
                    {iAmFirst ? 'Waiting for a second reviewer' : acceptLabel}
                  </Button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Outcome item={item} />
        )}
      </div>

      {rejectOpen && (
        <RejectDialog
          item={item}
          onClose={() => setRejectOpen(false)}
          onDone={() => {
            refresh();
            onDecided(item.id);
          }}
        />
      )}
    </div>
  );
}

function Outcome({ item }: { item: InboxRec }): React.JSX.Element {
  const { userName } = useApp();
  const who = item.decided_by !== '' ? userName(item.decided_by) : '';
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={INBOX_STATUS_TONE[item.status]}>{INBOX_STATUS_LABEL[item.status]}</Pill>
        <span className="text-[var(--agent-app-muted)]">
          {who !== '' ? `by ${who}` : ''}
          {item.decided_at !== '' ? ` on ${fmtDateTime(item.decided_at)}` : ''}
        </span>
      </div>
      {item.requires_second && item.first_approver !== '' && (
        <p className="text-xs text-[var(--agent-app-muted)]">
          First approval by {userName(item.first_approver)}
          {item.first_approved_at !== '' ? ` on ${fmtDateTime(item.first_approved_at)}` : ''}.
        </p>
      )}
      {item.note !== '' && <p className="border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{item.note}</p>}
      {item.kind === 'agreement_draft' && item.agreement !== '' && (
        <a href={href('agreement', item.agreement)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
          Open the agreement →
        </a>
      )}
      {item.kind !== 'agreement_draft' && item.matter !== '' && item.status !== 'rejected' && (
        <a href={href('matter', item.matter)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
          Open the record →
        </a>
      )}
    </div>
  );
}

function RejectDialog({ item, onClose, onDone }: { item: InboxRec; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await op<DecideResult>('inbox/decide', { id: item.id, decision: 'reject', note: note.trim() });
      toast.success('Rejected. Nothing changed on the record.');
      onDone();
      onClose();
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Reject this item"
      description="Nothing changes on the record. The item moves to Decided with your note."
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy}>
            Reject
          </Button>
        </>
      }
    >
      <Textarea label="Note (optional)" rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: already docketed by outside counsel" />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared pieces                                                       */
/* ------------------------------------------------------------------ */

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg']);

function DocumentPreview({ id }: { id: string }): React.JSX.Element {
  const { record: doc, loading, error } = useLiveRecord<DocumentRec>('documents', id);
  if (loading) return <Loading label="Loading document" />;
  if (doc === null) return <Notice tone="warn">{error ?? 'The document could not be loaded.'}</Notice>;
  const url = doc.file !== '' ? fileUrl(doc, doc.file) : '';
  const ext = (doc.file.split('.').pop() ?? '').toLowerCase();
  return (
    <div className="min-w-0">
      <PaneHeading
        right={
          url !== '' ? (
            <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
              <ExternalLink size={12} aria-hidden /> Open in a new tab
            </a>
          ) : undefined
        }
      >
        Document
      </PaneHeading>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[13px]">
        <FileText size={14} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
        <span className="min-w-0 truncate font-medium">{doc.title}</span>
        {doc.doc_type !== '' && <Tag>{DOC_TYPE_LABEL[doc.doc_type]}</Tag>}
        {d10(doc.doc_date) !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(doc.doc_date)}</span>}
      </div>
      {url === '' ? (
        <Notice>No file is attached to this document.</Notice>
      ) : ext === 'pdf' ? (
        <iframe title={doc.title} src={url} className="h-[26rem] w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] lg:h-[34rem]" />
      ) : IMAGE_EXT.has(ext) ? (
        <img src={url} alt={doc.title} className="max-h-[34rem] w-full border border-[var(--agent-app-border)] object-contain" />
      ) : (
        <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 border border-[var(--agent-app-border)] px-3 py-2 text-[13px] hover:bg-[var(--agent-app-border)]/20">
          <FileText size={14} aria-hidden /> Open {doc.file}
        </a>
      )}
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }): React.JSX.Element | null {
  if (citations.length === 0) return null;
  return (
    <div className="min-w-0">
      <PaneHeading>Quoted from the document</PaneHeading>
      <div className="flex flex-col gap-3">
        {citations.map((c, i) => (
          <div key={`${i}-${c.field ?? ''}`}>
            <div className="flex flex-wrap items-baseline gap-2 text-xs text-[var(--agent-app-muted)]">
              {c.field !== undefined && c.field !== '' && <span className="font-medium text-[var(--agent-app-text)]/85">{humanField(c.field)}</span>}
              {c.page !== undefined && <span>page {c.page}</span>}
            </div>
            {c.quote !== undefined && c.quote !== '' && (
              <blockquote className="mt-1 border-l-2 border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-border)]/15 px-3 py-1.5 text-[13px] italic leading-relaxed">
                {c.quote}
              </blockquote>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function PreviewBlock({
  proposals,
  error,
  selected,
  onToggle,
  editable,
}: {
  proposals: Proposal[] | null;
  error: string;
  selected: Set<string>;
  onToggle: (key: string, on: boolean) => void;
  editable: boolean;
}): React.JSX.Element {
  if (proposals === null) return <p className="text-[13px] text-[var(--agent-app-muted)]">Working out the deadlines...</p>;
  if (error !== '') return <Notice tone="warn">{error}</Notice>;
  return <ProposalList proposals={proposals} selected={selected} onToggle={editable ? onToggle : () => undefined} />;
}

function useCodeLabel(): (code: string) => string {
  const { meta } = useApp();
  return (code: string) => meta?.event_codes[code]?.label ?? code;
}

/* ------------------------------------------------------------------ */
/* Office change                                                       */
/* ------------------------------------------------------------------ */

interface EventPreviewState {
  code: string;
  proposals: Proposal[] | null;
  error: string;
}

function diffValue(d: DiffItem, v: string): string {
  if (v === '') return '';
  if (d.kind === 'date') return fmtDate(v) || v;
  if (d.field === 'status') return STATUS_LABEL[v as MatterStatus] ?? v;
  return v;
}

function OfficeChangeBody({ item, matter, mode, onPlan }: BodyProps & { matter: MatterRec | null }): React.JSX.Element {
  const codeLabel = useCodeLabel();
  const { meta } = useApp();
  const first = firstDecision(item);
  const diffs = useMemo(() => item.diffs ?? [], [item.diffs]);
  const events = useMemo(() => item.proposal?.events ?? [], [item.proposal]);
  const annuities = useMemo(() => item.proposal?.annuity_updates ?? [], [item.proposal]);
  const editable = mode === 'edit';
  const live = mode !== 'decided';

  const [fields, setFields] = useState<Set<string>>(() =>
    first !== null && Array.isArray(first['fields']) ? new Set(strArr(first['fields'])) : new Set(diffs.map((d) => d.field)),
  );
  const [mapRaw, setMapRaw] = useState<Record<string, string>>(() => (first !== null ? strRecord(first['map_raw']) : {}));
  const [included, setIncluded] = useState<Set<number>>(() => {
    if (first !== null && Array.isArray(first['events'])) return new Set(numArr(first['events']));
    const s = new Set<number>();
    events.forEach((ev, i) => {
      if (ev.code !== '' && d10(ev.date) !== '') s.add(i);
    });
    return s;
  });
  const [annuityOn, setAnnuityOn] = useState(true);
  const [previews, setPreviews] = useState<Record<number, EventPreviewState>>({});
  const [sel, setSel] = useState<Record<number, Set<string>>>({});
  const usedFirst = useRef<Set<number>>(new Set());
  const requested = useRef<Record<number, string>>({});
  // Re-preview when the docket changes under us (a colleague or an agent),
  // keeping what the reviewer ticked.
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const seenTickRaw = useRef(0);
  const previewsRef = useRef(previews);
  previewsRef.current = previews;
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events', 'matters'], () => setLiveTick((t) => t + 1), live);

  const initialSel = (idx: number, proposals: Proposal[]): Set<string> => {
    const firstDl = first !== null ? asRecord(first['deadlines']) : null;
    const prior = firstDl !== null ? firstDl[String(idx)] : undefined;
    if (Array.isArray(prior) && !usedFirst.current.has(idx)) {
      usedFirst.current.add(idx);
      return new Set(strArr(prior));
    }
    return new Set(proposals.filter((p) => p.selected && !p.exists).map((p) => p.key));
  };

  // Deadlines for the events the office mapped to our codes: one call.
  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    op<{ matter_id: string; events: PreviewEvent[] }>('inbox/preview', { id: item.id })
      .then((r) => {
        if (cancelled) return;
        const pv: Record<number, EventPreviewState> = {};
        const before = previewsRef.current;
        for (const ev of r.events) {
          pv[ev.index] = { code: ev.code, proposals: ev.proposals, error: '' };
        }
        events.forEach((ev, i) => {
          if (ev.code !== '' && pv[i] === undefined) pv[i] = { code: ev.code, proposals: [], error: 'No deadline preview is available for this event.' };
        });
        setPreviews((p) => ({ ...p, ...pv }));
        setSel((s) => {
          const next = { ...s };
          for (const ev of r.events) {
            next[ev.index] = fromLive
              ? mergeSelection(s[ev.index] ?? new Set<string>(), before[ev.index]?.proposals ?? null, ev.proposals, (p) => p.selected && !p.exists)
              : initialSel(ev.index, ev.proposals);
          }
          return next;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const pv: Record<number, EventPreviewState> = {};
        events.forEach((ev, i) => {
          if (ev.code !== '') pv[i] = { code: ev.code, proposals: [], error: errMsg(e) };
        });
        setPreviews((p) => ({ ...p, ...pv }));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, live, liveTick]);

  // Deadlines for unrecognized office events a person chose to record as one of our codes.
  useEffect(() => {
    if (!live) return;
    const fromLive = seenTickRaw.current !== liveTick;
    seenTickRaw.current = liveTick;
    if (fromLive) requested.current = {};
    events.forEach((ev, idx) => {
      if (ev.code !== '') return;
      const code = mapRaw[String(idx)] ?? '';
      if (code === '') {
        if (requested.current[idx] !== undefined) {
          delete requested.current[idx];
          setPreviews((p) => {
            const n = { ...p };
            delete n[idx];
            return n;
          });
        }
        return;
      }
      if (requested.current[idx] === code) return;
      requested.current[idx] = code;
      const before = previewsRef.current[idx];
      const keep = fromLive && before !== undefined && before.code === code ? before.proposals : null;
      if (keep === null) setPreviews((p) => ({ ...p, [idx]: { code, proposals: null, error: '' } }));
      op<{ proposals: Proposal[] }>('matters/preview-event', { matter_id: item.matter, subject_type: 'matter', code, date: d10(ev.date) })
        .then((r) => {
          if (requested.current[idx] !== code) return;
          setPreviews((p) => ({ ...p, [idx]: { code, proposals: r.proposals, error: '' } }));
          setSel((s) => ({
            ...s,
            [idx]: keep !== null ? mergeSelection(s[idx] ?? new Set<string>(), keep, r.proposals, (p) => p.selected && !p.exists) : initialSel(idx, r.proposals),
          }));
        })
        .catch((e: unknown) => {
          if (requested.current[idx] !== code) return;
          setPreviews((p) => ({ ...p, [idx]: { code, proposals: [], error: errMsg(e) } }));
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapRaw, live, liveTick]);

  // Report the plan to the footer.
  useEffect(() => {
    if (!live) return;
    const inc = [...included]
      .filter((i) => {
        const ev = events[i];
        return ev !== undefined && d10(ev.date) !== '' && (ev.code !== '' || (mapRaw[String(i)] ?? '') !== '');
      })
      .sort((a, b) => a - b);
    const map_raw: Record<string, string> = {};
    const deadlines: Record<string, string[]> = {};
    let creates = 0;
    let statutory = false;
    let waiting = false;
    let failed = false;
    for (const i of inc) {
      if (events[i]?.code === '') map_raw[String(i)] = mapRaw[String(i)] ?? '';
      const pv = previews[i];
      if (pv === undefined || pv.proposals === null) {
        waiting = true;
        continue;
      }
      if (pv.error !== '') failed = true;
      const s = sel[i] ?? new Set<string>();
      deadlines[String(i)] = [...s];
      for (const p of pv.proposals) {
        if (s.has(p.key) && !p.exists) {
          creates += 1;
          if (STATUTORY.has(p.kind)) statutory = true;
        }
      }
    }
    const annuityApplies = annuityOn && annuities.length > 0;
    const nothing = fields.size === 0 && inc.length === 0 && !annuityApplies;
    onPlan({
      payload: { matter_id: item.matter, fields: [...fields], events: inc, map_raw, deadlines, annuity: annuityOn },
      creates,
      statutory,
      blocker: waiting
        ? 'Working out the deadlines...'
        : failed
          ? 'The deadlines for a ticked event could not be worked out. Untick that event or try again later.'
          : nothing
            ? 'Nothing is ticked. Tick what to accept, or reject the item.'
            : '',
    });
  }, [fields, included, mapRaw, previews, sel, annuityOn, events, annuities, item.matter, live, onPlan]);

  const codeOptions = useMemo(() => {
    const codes = matter !== null ? eventCodesFor(matter.ip_type) : Object.keys(meta?.event_codes ?? {});
    return [{ value: '', label: 'Do not record' }, ...codes.map((c) => ({ value: c, label: codeLabel(c) }))];
  }, [matter, meta, codeLabel]);

  return (
    <div className="flex flex-col gap-6 p-4">
      {item.summary !== '' && <Prose className="text-[var(--agent-app-text)]/90">{item.summary}</Prose>}

      {diffs.length > 0 && (
        <div className="min-w-0">
          <PaneHeading
            right={
              editable && diffs.length > 1 ? (
                <Checkbox
                  checked={fields.size === diffs.length}
                  indeterminate={fields.size > 0 && fields.size < diffs.length}
                  onChange={(v) => setFields(v ? new Set(diffs.map((d) => d.field)) : new Set())}
                  label={<span className="text-xs text-[var(--agent-app-muted)]">All fields</span>}
                />
              ) : undefined
            }
          >
            Field changes
          </PaneHeading>
          <div className="overflow-x-auto border border-[var(--agent-app-border)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  {live && <th className="w-9 px-3 py-2" aria-label="Accept" />}
                  <th className="px-3 py-2">Field</th>
                  <th className="px-3 py-2">On the record</th>
                  <th className="px-3 py-2">From the office</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => {
                  const on = fields.has(d.field);
                  return (
                    <tr key={d.field} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                      {live && (
                        <td className="px-3 py-2 align-top">
                          <Checkbox checked={on} disabled={!editable} onChange={(v) => setFields((s) => toggled(s, d.field, v))} ariaLabel={`Accept ${d.label}`} />
                        </td>
                      )}
                      <td className="px-3 py-2 align-top font-medium">{d.label}</td>
                      <td className={cn('px-3 py-2 align-top tabular-nums text-[var(--agent-app-muted)]', live && on && d.current !== '' && 'line-through decoration-1')}>
                        {diffValue(d, d.current) || <span className="text-[var(--agent-app-muted)]/70">Empty</span>}
                      </td>
                      <td className="px-3 py-2 align-top tabular-nums">
                        <span className={cn('px-1 py-0.5 font-medium', TONE_BG.warn)}>{diffValue(d, d.incoming)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {events.length > 0 && (
        <div className="min-w-0">
          <PaneHeading>New office events</PaneHeading>
          <div className="border border-[var(--agent-app-border)]">
            {events.map((ev, i) => {
              const mapped = mapRaw[String(i)] ?? '';
              const hasDate = d10(ev.date) !== '';
              const recordable = hasDate && (ev.code !== '' || mapped !== '');
              const on = included.has(i) && recordable;
              const pv = previews[i];
              return (
                <div key={`${i}-${ev.raw_code}-${ev.date}`} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                  <div className="flex items-start gap-2.5">
                    {live && (
                      <div className="pt-0.5">
                        <Checkbox
                          checked={on}
                          disabled={!editable || !recordable}
                          onChange={(v) => setIncluded((s) => toggled(s, i, v))}
                          ariaLabel={`Record ${ev.code !== '' ? codeLabel(ev.code) : ev.label || ev.raw_code}`}
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium">{ev.code !== '' ? codeLabel(ev.code) : 'Office event we do not recognize'}</span>
                        <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{hasDate ? fmtDate(ev.date) : 'No date'}</span>
                        {ev.raw_code !== '' && <span className="font-mono text-[11px] text-[var(--agent-app-muted)]">{ev.raw_code}</span>}
                      </div>
                      {ev.label !== '' && <div className="mt-0.5 text-xs text-[var(--agent-app-muted)]">{ev.label}</div>}
                      {ev.code === '' && live && (
                        <div className="mt-2 max-w-xs">
                          <Select
                            label="Record as..."
                            value={mapped}
                            disabled={!editable || !hasDate}
                            options={codeOptions}
                            onChange={(e) => {
                              const v = e.target.value;
                              setMapRaw((m) => ({ ...m, [String(i)]: v }));
                              setIncluded((s) => toggled(s, i, v !== ''));
                            }}
                          />
                        </div>
                      )}
                      {live && on && (
                        <div className="mt-2">
                          <PreviewBlock
                            proposals={pv === undefined ? null : pv.proposals}
                            error={pv?.error ?? ''}
                            selected={sel[i] ?? new Set<string>()}
                            editable={editable}
                            onToggle={(k, v) => setSel((s) => ({ ...s, [i]: toggled(s[i] ?? new Set<string>(), k, v) }))}
                          />
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {annuities.length > 0 && (
        <div className="min-w-0">
          <PaneHeading>Official annuity dates</PaneHeading>
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            {live && (
              <Checkbox
                checked={annuityOn}
                disabled={!editable}
                onChange={setAnnuityOn}
                label="Use the official due dates from the JPO. They replace the computed dates and are locked."
              />
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {annuities.map((a) => (
                <div key={a.deadline_id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
                  <a href={href('deadlines', a.deadline_id)} className="min-w-0 truncate hover:underline">
                    {a.title}
                  </a>
                  <span className="tabular-nums">
                    <span className="font-medium">Official {fmtDate(a.incoming)}</span>
                    <span className="text-[var(--agent-app-muted)]"> · computed {fmtDate(a.current)}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {diffs.length === 0 && events.length === 0 && annuities.length === 0 && (
        <Notice>This office change has no field changes, events or dates to apply.</Notice>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Document, CraftBot proposal, email, watch notice                    */
/* ------------------------------------------------------------------ */

interface ExtraRow {
  key: number;
  title: string;
  due_date: string;
  kind: DeadlineKind;
  reason: string;
}

function isKind(v: unknown): v is DeadlineKind {
  return typeof v === 'string' && v in KIND_LABEL;
}

function initialExtras(item: InboxRec): ExtraRow[] {
  const first = firstDecision(item);
  const src: unknown = first !== null && Array.isArray(first['extra_deadlines']) ? first['extra_deadlines'] : (item.proposal?.extra_deadlines ?? []);
  if (!Array.isArray(src)) return [];
  return src
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x !== null)
    .map((x, i) => ({
      key: i,
      title: str(x['title']),
      due_date: d10(str(x['due_date'])),
      kind: isKind(x['kind']) ? x['kind'] : 'internal',
      reason: str(x['reason']),
    }));
}

function ProposalBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const codeLabel = useCodeLabel();
  const first = firstDecision(item);
  const proposal = item.proposal;
  const ev0 = proposal?.event;
  const hasEvent = ev0 !== undefined && ev0.code !== '';
  const editable = mode === 'edit';
  const live = mode !== 'decided';

  const start = useMemo((): Record<string, unknown> => {
    const ovr = first !== null ? asRecord(first['event_override']) : null;
    if (ovr !== null && str(ovr['code']) !== '') return ovr;
    return ev0 !== undefined ? { ...ev0 } : {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  const [matterId, setMatterId] = useState(item.matter);
  const matter = useLiveRecord<MatterRec>('matters', matterId);
  const [code, setCode] = useState(str(start['code']));
  const [date, setDate] = useState(d10(str(start['date'])));
  const [months, setMonths] = useState(str(start['period_months']));
  const [days, setDays] = useState(str(start['period_days']));
  const [due, setDue] = useState(d10(str(start['due_date'])));
  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<ExtraRow[]>(() => initialExtras(item));
  const usedFirst = useRef(false);
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events', 'matters'], () => setLiveTick((t) => t + 1), live);

  const override = useMemo((): Record<string, unknown> => {
    const o: Record<string, unknown> = { code, date, label: ev0?.label ?? '' };
    if (Number(months) > 0) o['period_months'] = Number(months);
    if (Number(days) > 0) o['period_days'] = Number(days);
    if (d10(due) !== '') o['due_date'] = d10(due);
    return o;
  }, [code, date, months, days, due, ev0?.label]);

  useEffect(() => {
    if (!live || !hasEvent) return;
    if (matterId === '' || !validDate || code === '') {
      setProposals([]);
      setPreviewErr(matterId === '' ? 'Choose the matter to see the deadlines this creates.' : 'Enter the event and its date to see the deadlines this creates.');
      return;
    }
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const before = fromLive ? proposalsRef.current : null;
    if (!fromLive) setProposals(null);
    const t = setTimeout(() => {
      op<{ matter_id: string; events: PreviewEvent[] }>('inbox/preview', { id: item.id, matter_id: matterId, event_override: override })
        .then((r) => {
          if (cancelled) return;
          const ps = r.events[0]?.proposals ?? [];
          setProposals(ps);
          setPreviewErr('');
          const firstDl = first !== null ? asRecord(first['deadlines']) : null;
          const prior = firstDl !== null ? firstDl['0'] : undefined;
          if (before !== null) {
            setSel((sel) => mergeSelection(sel, before, ps, (p) => p.selected && !p.exists));
          } else if (Array.isArray(prior) && !usedFirst.current) {
            usedFirst.current = true;
            setSel(new Set(strArr(prior)));
          } else {
            setSel(new Set(ps.filter((p) => p.selected && !p.exists).map((p) => p.key)));
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setProposals([]);
          setPreviewErr(errMsg(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, matterId, override, live, hasEvent, validDate, liveTick]);

  useEffect(() => {
    if (!live) return;
    const valid = extras.filter((x) => x.title.trim() !== '' && d10(x.due_date) !== '');
    const partial = extras.some((x) => (x.title.trim() !== '') !== (d10(x.due_date) !== ''));
    let creates = valid.length;
    let statutory = false;
    if (hasEvent && proposals !== null && previewErr === '') {
      for (const p of proposals) {
        if (sel.has(p.key) && !p.exists) {
          creates += 1;
          if (STATUTORY.has(p.kind)) statutory = true;
        }
      }
    }
    const payload: Record<string, unknown> = {
      matter_id: matterId,
      extra_deadlines: valid.map((x) => ({
        title: x.title.trim(),
        due_date: d10(x.due_date),
        kind: x.kind,
        ...(x.reason !== '' ? { reason: x.reason } : {}),
      })),
    };
    if (hasEvent) {
      payload['event_override'] = override;
      if (proposals !== null) payload['deadlines'] = { '0': [...sel] };
    }
    let blocker = '';
    if (matterId === '') blocker = 'Choose the matter this belongs to.';
    else if (hasEvent && (!validDate || code === '')) blocker = 'Enter the event and its date.';
    else if (hasEvent && proposals === null) blocker = 'Working out the deadlines...';
    else if (hasEvent && previewErr !== '') blocker = `The deadlines could not be worked out: ${previewErr}`;
    else if (partial) blocker = 'Give every extra deadline a title and a due date, or remove it.';
    onPlan({ payload, creates, statutory, blocker });
  }, [extras, proposals, previewErr, sel, matterId, override, hasEvent, validDate, code, live, onPlan]);

  const codeOptions = useMemo(() => {
    const codes = eventCodesFor(matter.record?.ip_type ?? 'patent');
    const list = code !== '' && !codes.includes(code) ? [code, ...codes] : codes;
    return list.map((c) => ({ value: c, label: codeLabel(c) }));
  }, [matter.record, code, codeLabel]);

  const summaryText = item.summary !== '' ? item.summary : (proposal?.summary ?? '');
  const extraSummary = proposal?.summary !== undefined && proposal.summary !== '' && proposal.summary !== summaryText ? proposal.summary : '';
  const docType = proposal?.document_type ?? '';

  return (
    <div className="grid gap-6 p-4 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        {item.document !== '' ? (
          <DocumentPreview id={item.document} />
        ) : (
          <div>
            <PaneHeading>Document</PaneHeading>
            <p className="text-[13px] text-[var(--agent-app-muted)]">No document is attached to this proposal.</p>
          </div>
        )}
        <CitationList citations={item.citations ?? []} />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        <div>
          <PaneHeading>Matter</PaneHeading>
          {editable ? (
            <RecordPicker<MatterRec>
              collection="matters"
              value={matterId}
              onChange={(id) => setMatterId(id)}
              labelOf={(m) => `${m.ref} ${m.title}`.trim()}
              searchFields={MATTER_SEARCH}
              placeholder="Search by reference, title or office number"
            />
          ) : matter.record !== null ? (
            <a href={href('matter', matter.record.id)} className="inline-flex min-w-0 items-center gap-2 text-[13px] hover:underline">
              <Ref>{matter.record.ref}</Ref>
              <span className="truncate">{matter.record.title}</span>
            </a>
          ) : (
            <p className="text-[13px] text-[var(--agent-app-muted)]">No matter chosen.</p>
          )}
        </div>

        {(summaryText !== '' || extraSummary !== '') && (
          <div>
            <PaneHeading>Summary</PaneHeading>
            {summaryText !== '' && <Prose>{summaryText}</Prose>}
            {extraSummary !== '' && <Prose className="mt-2 text-[var(--agent-app-text)]/85">{extraSummary}</Prose>}
          </div>
        )}

        {docType !== '' && (
          <div>
            <PaneHeading>Document type</PaneHeading>
            <p className="text-[13px]">{DOC_TYPE_LABEL[docType as DocType] ?? humanField(docType)}</p>
          </div>
        )}

        {hasEvent ? (
          <div>
            <PaneHeading>What happened</PaneHeading>
            {live ? (
              <div className="grid gap-3 sm:grid-cols-2">
                <Select label="Event" value={code} options={codeOptions} disabled={!editable} onChange={(e) => setCode(e.target.value)} />
                <DateField label="Date on the document" value={date} onChange={setDate} disabled={!editable} required />
                <Input label="Reply period (months)" type="number" min={0} value={months} disabled={!editable} onChange={(e) => setMonths(e.target.value)} placeholder="Usual period" />
                <Input label="or in days" type="number" min={0} value={days} disabled={!editable} onChange={(e) => setDays(e.target.value)} placeholder="Usual period" />
                <div className="sm:col-span-2">
                  <DateField
                    label="Due date set by the office"
                    value={due}
                    onChange={setDue}
                    disabled={!editable}
                    help="Optional. Use it when the document states the due date; it replaces the calculated one."
                    className="sm:max-w-[12rem]"
                  />
                </div>
              </div>
            ) : (
              <FactGrid cols={2}>
                <Fact label="Event" value={codeLabel(ev0.code)} />
                <Fact label="Date" value={fmtDate(ev0.date)} />
                {ev0.period_months !== undefined && ev0.period_months > 0 && <Fact label="Reply period" value={plural(ev0.period_months, 'month')} />}
                {ev0.period_days !== undefined && ev0.period_days > 0 && <Fact label="Reply period" value={plural(ev0.period_days, 'day')} />}
                {ev0.due_date !== undefined && ev0.due_date !== '' && <Fact label="Due date set by the office" value={fmtDate(ev0.due_date)} />}
              </FactGrid>
            )}
            {live && (
              <div className="mt-4">
                <PaneHeading>Deadlines this creates</PaneHeading>
                <PreviewBlock
                  proposals={proposals}
                  error={previewErr}
                  selected={sel}
                  editable={editable}
                  onToggle={(k, v) => setSel((s) => toggled(s, k, v))}
                />
              </div>
            )}
          </div>
        ) : (
          <Notice>No event was proposed. Accepting links the document to the matter and creates any extra deadlines below.</Notice>
        )}

        <ExtraDeadlines rows={extras} onChange={setExtras} editable={editable} live={live} />
      </div>
    </div>
  );
}

const MATTER_SEARCH = ['ref', 'title', 'application_no', 'registration_no', 'publication_no'];

function ExtraDeadlines({
  rows,
  onChange,
  editable,
  live,
}: {
  rows: ExtraRow[];
  onChange: (rows: ExtraRow[]) => void;
  editable: boolean;
  live: boolean;
}): React.JSX.Element {
  const update = (key: number, patch: Partial<ExtraRow>): void => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (): void => {
    const next = rows.reduce((m, r) => Math.max(m, r.key), -1) + 1;
    onChange([...rows, { key: next, title: '', due_date: '', kind: 'internal', reason: '' }]);
  };
  return (
    <div>
      <PaneHeading
        right={
          editable ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={add}>
              <Plus size={13} aria-hidden /> Add
            </Button>
          ) : undefined
        }
      >
        Extra deadlines
      </PaneHeading>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{editable ? 'None proposed. Add one for internal follow-ups, such as reporting to the client.' : 'None proposed.'}</p>
      ) : !live ? (
        <div className="border border-[var(--agent-app-border)]">
          {rows.map((r) => (
            <div key={r.key} className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--agent-app-border)]/70 px-3 py-2 text-[13px] last:border-0">
              <span className="min-w-0 truncate">{r.title}</span>
              <span className="flex items-center gap-2">
                <Tag>{KIND_LABEL[r.kind]}</Tag>
                <span className="tabular-nums text-[var(--agent-app-muted)]">{fmtDate(r.due_date)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.key} className="border border-[var(--agent-app-border)] p-2">
              <div className="grid items-end gap-2 sm:grid-cols-[minmax(0,1fr)_9.5rem_8.5rem_auto]">
                <Input aria-label="Deadline title" placeholder="What needs to happen" value={r.title} disabled={!editable} onChange={(e) => update(r.key, { title: e.target.value })} />
                <input
                  type="date"
                  aria-label="Due date"
                  className={DATE_INPUT_CLS}
                  value={r.due_date}
                  disabled={!editable}
                  onChange={(e) => update(r.key, { due_date: e.target.value })}
                />
                <Select aria-label="Kind" value={r.kind} options={DEADLINE_KINDS} disabled={!editable} onChange={(e) => update(r.key, { kind: isKind(e.target.value) ? e.target.value : 'internal' })} />
                {editable && (
                  <Button size="icon" variant="ghost" aria-label="Remove this deadline" onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 size={14} aria-hidden />
                  </Button>
                )}
              </div>
              {r.reason !== '' && <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">{r.reason}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agreement draft                                                     */
/* ------------------------------------------------------------------ */

const AG_TEXT = ['title', 'counterparty_name'] as const;
const AG_DATES = ['signed_date', 'term_start', 'term_end', 'option_period_end'] as const;
const AG_NUMBERS = ['royalty_rate', 'advance', 'minimum_guarantee'] as const;
type AgKey =
  | (typeof AG_TEXT)[number]
  | (typeof AG_DATES)[number]
  | (typeof AG_NUMBERS)[number]
  | 'agreement_type'
  | 'direction'
  | 'currency'
  | 'reporting_frequency';

const REPORTING_LABEL: Record<string, string> = {
  none: 'No reports',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  semiannual: 'Twice a year',
  annual: 'Yearly',
};

const GRANT_KIND_LABEL: Record<string, string> = {
  grant: 'Grant',
  holdback: 'Holdback',
  restriction: 'Restriction',
  reservation: 'Reservation',
};

const NUMBER_LABEL: Record<(typeof AG_NUMBERS)[number], string> = {
  royalty_rate: 'Royalty rate (%)',
  advance: 'Advance',
  minimum_guarantee: 'Minimum guarantee',
};

const DATE_LABEL: Record<(typeof AG_DATES)[number], string> = {
  signed_date: 'Signed',
  term_start: 'Term starts',
  term_end: 'Term ends',
  option_period_end: 'Option period ends',
};

function initialAgreement(a: Record<string, unknown>): Record<AgKey, string> {
  const cp = str(a['counterparty_name']) || str(a['counterparty']);
  return {
    title: str(a['title']),
    counterparty_name: cp,
    agreement_type: str(a['agreement_type']) in AGREEMENT_TYPE_LABEL ? str(a['agreement_type']) : 'other',
    direction: str(a['direction']) in DIRECTION_LABEL ? str(a['direction']) : 'none',
    signed_date: d10(str(a['signed_date'])),
    term_start: d10(str(a['term_start'])),
    term_end: d10(str(a['term_end'])),
    option_period_end: d10(str(a['option_period_end'])),
    currency: str(a['currency']).toUpperCase(),
    royalty_rate: str(a['royalty_rate']),
    advance: str(a['advance']),
    minimum_guarantee: str(a['minimum_guarantee']),
    reporting_frequency: str(a['reporting_frequency']),
  };
}

function AgreementDraftBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const { dimensions, dimValues, propertyName } = useApp();
  const original = useMemo(() => asRecord(item.proposal?.agreement) ?? {}, [item.proposal]);
  const grants = useMemo(
    () => (item.proposal?.grants ?? []).map((g) => asRecord(g)).filter((g): g is Record<string, unknown> => g !== null),
    [item.proposal],
  );
  const [f, setF] = useState<Record<AgKey, string>>(() => initialAgreement(original));
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const set = (k: AgKey, v: string): void => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!live) return;
    const agreement: Record<string, unknown> = { ...original };
    const bad: string[] = [];
    for (const k of AG_TEXT) agreement[k] = f[k].trim();
    agreement['counterparty'] = f.counterparty_name.trim();
    for (const k of AG_DATES) agreement[k] = d10(f[k]);
    for (const k of AG_NUMBERS) {
      const v = f[k].trim();
      if (v === '') agreement[k] = '';
      else if (Number.isFinite(Number(v))) agreement[k] = Number(v);
      else bad.push(NUMBER_LABEL[k]);
    }
    agreement['agreement_type'] = f.agreement_type;
    agreement['direction'] = f.direction;
    agreement['currency'] = f.currency;
    agreement['reporting_frequency'] = f.reporting_frequency;
    let blocker = '';
    if (f.title.trim() === '') blocker = 'The agreement needs a title.';
    else if (bad.length) blocker = `${bad.join(', ')} must be a number.`;
    onPlan({ payload: { agreement, grants }, creates: 0, statutory: false, blocker, acceptLabel: 'Create agreement' });
  }, [f, original, grants, live, onPlan]);

  // Names for the titles and records the grants point at.
  const assetIds = useMemo(() => {
    const works = new Set<string>();
    const matters = new Set<string>();
    for (const g of grants) {
      for (const w of strArr(g['works'])) works.add(w);
      for (const m of strArr(g['matters'])) matters.add(m);
    }
    return { works: [...works], matters: [...matters] };
  }, [grants]);
  const names = useLiveAsync(async () => {
    const out: Record<string, string> = {};
    const filterFor = (ids: string[]): string => ids.map((id) => `id = "${id.replace(/"/g, '')}"`).join(' || ');
    const [works, matters] = await Promise.all([
      assetIds.works.length > 0
        ? getPbClient().call((p) => p.collection('works').getFullList<WorkRec>({ filter: filterFor(assetIds.works) }), { silent: true })
        : Promise.resolve<WorkRec[]>([]),
      assetIds.matters.length > 0
        ? getPbClient().call((p) => p.collection('matters').getFullList<MatterRec>({ filter: filterFor(assetIds.matters) }), { silent: true })
        : Promise.resolve<MatterRec[]>([]),
    ]);
    for (const w of works) out[w.id] = w.title;
    for (const m of matters) out[m.id] = m.ref !== '' ? m.ref : m.title;
    return out;
  }, [assetIds], ['works', 'matters']);

  const dimName = (key: string): string => dimensions.find((d) => d.key === key)?.label ?? humanField(key);

  const typeOptions = Object.entries(AGREEMENT_TYPE_LABEL).map(([value, label]) => ({ value: value as AgreementType, label }));
  const directionOptions = Object.entries(DIRECTION_LABEL).map(([value, label]) => ({ value, label }));
  const currencyOptions = [...(f.currency !== '' && !CURRENCIES.includes(f.currency) ? [f.currency] : []), ...CURRENCIES].map((c) => ({ value: c, label: c }));
  const reportingOptions = Object.entries(REPORTING_LABEL).map(([value, label]) => ({ value, label }));
  const summary = item.summary !== '' ? item.summary : str(original['summary']);

  return (
    <div className="grid gap-6 p-4 xl:grid-cols-2">
      <div className="flex min-w-0 flex-col gap-5">
        {item.document !== '' ? (
          <DocumentPreview id={item.document} />
        ) : (
          <div>
            <PaneHeading>Document</PaneHeading>
            <p className="text-[13px] text-[var(--agent-app-muted)]">No contract file is attached to this draft.</p>
          </div>
        )}
        <CitationList citations={item.citations ?? []} />
      </div>

      <div className="flex min-w-0 flex-col gap-5">
        {summary !== '' && (
          <div>
            <PaneHeading>Summary</PaneHeading>
            <Prose>{summary}</Prose>
          </div>
        )}

        <div>
          <PaneHeading>Key terms</PaneHeading>
          {live ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Input label="Title" value={f.title} disabled={!editable} onChange={(e) => set('title', e.target.value)} />
              </div>
              <Select label="Type" value={f.agreement_type} options={typeOptions} disabled={!editable} onChange={(e) => set('agreement_type', e.target.value)} />
              <Select label="Direction" value={f.direction} options={directionOptions} disabled={!editable} onChange={(e) => set('direction', e.target.value)} />
              <div className="sm:col-span-2">
                <Input label="Counterparty" value={f.counterparty_name} disabled={!editable} onChange={(e) => set('counterparty_name', e.target.value)} placeholder="Company or person on the other side" />
              </div>
              {AG_DATES.map((k) => (
                <DateField key={k} label={DATE_LABEL[k]} value={f[k]} onChange={(v) => set(k, v)} disabled={!editable} />
              ))}
              <Select label="Currency" value={f.currency} placeholder="Not stated" options={currencyOptions} disabled={!editable} onChange={(e) => set('currency', e.target.value)} />
              <Select
                label="Royalty reporting"
                value={f.reporting_frequency}
                placeholder="Not stated"
                options={reportingOptions}
                disabled={!editable}
                onChange={(e) => set('reporting_frequency', e.target.value)}
              />
              {AG_NUMBERS.map((k) => (
                <Input key={k} label={NUMBER_LABEL[k]} type="number" step="any" value={f[k]} disabled={!editable} onChange={(e) => set(k, e.target.value)} />
              ))}
            </div>
          ) : (
            <FactGrid cols={2}>
              <Fact label="Title" value={f.title} />
              <Fact label="Type" value={AGREEMENT_TYPE_LABEL[f.agreement_type as AgreementType] ?? f.agreement_type} />
              <Fact label="Direction" value={DIRECTION_LABEL[f.direction] ?? f.direction} />
              <Fact label="Counterparty" value={f.counterparty_name} />
              {AG_DATES.map((k) => (
                <Fact key={k} label={DATE_LABEL[k]} value={fmtDate(f[k])} />
              ))}
              <Fact label="Currency" value={f.currency} />
              <Fact label="Royalty reporting" value={REPORTING_LABEL[f.reporting_frequency] ?? ''} />
              {AG_NUMBERS.map((k) => (
                <Fact key={k} label={NUMBER_LABEL[k]} value={f[k]} />
              ))}
            </FactGrid>
          )}
        </div>

        <div>
          <PaneHeading>Rights in this agreement</PaneHeading>
          {grants.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">No rights grants were proposed. You can add them on the agreement after creating it.</p>
          ) : (
            <div className="border border-[var(--agent-app-border)]">
              {grants.map((g, i) => {
                const dims = asRecord(g['dims']) ?? {};
                const props = strArr(g['properties']);
                const works = strArr(g['works']);
                const matters = strArr(g['matters']);
                const assets: string[] = [
                  ...props.map((id) => propertyName(id) || 'Unknown property'),
                  ...works.map((id) => names.data?.[id] ?? '...'),
                  ...matters.map((id) => names.data?.[id] ?? '...'),
                ];
                const ts = d10(str(g['term_start']));
                const te = d10(str(g['term_end']));
                const direction = str(g['direction']);
                return (
                  <div key={i} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Tag>{DIRECTION_LABEL[direction] ?? direction}</Tag>
                      <Tag>{GRANT_KIND_LABEL[str(g['kind'])] ?? 'Grant'}</Tag>
                      <Tag>{g['exclusive'] === true ? 'Exclusive' : 'Non-exclusive'}</Tag>
                      {(ts !== '' || te !== '') && (
                        <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">
                          {ts !== '' ? fmtDate(ts) : 'Start'} to {te !== '' ? fmtDate(te) : 'no end date'}
                        </span>
                      )}
                    </div>
                    {assets.length > 0 && <div className="mt-1.5 text-[13px]">{assets.join(', ')}</div>}
                    {Object.keys(dims).length > 0 && (
                      <dl className="mt-1.5 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 text-xs">
                        {Object.entries(dims).map(([dim, spec]) => {
                          const sp = asRecord(spec);
                          const values = dimValues.filter((v) => v.dimension === dim);
                          return (
                            <FragmentRow
                              key={dim}
                              label={dimName(dim)}
                              value={dimSpecLabel(values, { include: strArr(sp?.['include']), exclude: strArr(sp?.['exclude']) })}
                            />
                          );
                        })}
                      </dl>
                    )}
                    {str(g['rights_text']) !== '' && <p className="mt-1.5 text-xs leading-relaxed text-[var(--agent-app-text)]/80">{str(g['rights_text'])}</p>}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FragmentRow({ label, value }: { label: string; value: ReactNode }): React.JSX.Element {
  return (
    <>
      <dt className="text-[var(--agent-app-muted)]">{label}</dt>
      <dd className="min-w-0">{value}</dd>
    </>
  );
}

/** Re-exported for the Inbox list rows. */
export function ConfidencePill({ confidence }: { confidence: InboxRec['confidence'] }): React.JSX.Element | null {
  if (confidence === '') return null;
  return (
    <Pill tone={CONFIDENCE_TONE[confidence]} title={CONFIDENCE_LABEL[confidence]}>
      {CONFIDENCE_SHORT[confidence]}
    </Pill>
  );
}

/** Status line shown after an upload hand-off (used by the Inbox upload dialog). */
export function DocketStatus({ requestId }: { requestId: string | null }): React.JSX.Element | null {
  return (
    <AgentStatus
      requestId={requestId}
      workingText="CraftBot is reading the document..."
      doneText="CraftBot filed a proposal. It is in the Inbox, ready to review."
    />
  );
}
