/**
 * Inbox detail: one proposal under review. The server previews every kind
 * (inbox/preview) and applies the decision (inbox/decide); nothing here
 * writes records directly.
 *
 *   office_change      field diffs (tick each) and office events with the deadlines they create
 *   document, agent_proposal, email
 *                      the record, the event (editable before accepting), the deadlines it
 *                      creates, extra deadlines, citations and the document
 *   agreement_draft    the agreement's common fields (editable) and its grants with conflicts
 *   royalty_statement  statement lines priced by the server from the agreement
 *   permission         old and new values of a third-party permission
 *   watch_hit          suspected listings or marks, accept the ones ticked
 *
 * The footer knows the second-reviewer rule: statutory deadlines proposed
 * by automation need a second, different person when the setting is on.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowLeft, ExternalLink, FileText, Plus, Trash2 } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { fileUrl, listAll, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { mergeSelection, useLiveAsync, useLiveReload } from '../lib/live.ts';
import { d10, fmtDate, fmtDateTime, fmtMoney, fmtNumber, fmtPct } from '../lib/format.ts';
import { bi, enumLabel, enumOptions, isJa, joinList, t, tn } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href, navigate, subjectHref } from '../lib/router.ts';
import type { AgreementRec, DocumentRec, InboxItemRec } from '../lib/records.ts';
import type { Bi, Citation, Proposal } from '../lib/shapes.ts';
import { CraftBotBadge } from './craftbot.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { kindHelp } from './deadlines.tsx';
import { ProposalList, useEventCodes, useEventLabel } from './events.tsx';
import type { SubjectType } from './events.tsx';
import { CatalogSelect, RecordPicker, dimSpecLabel } from './pickers.tsx';
import { Checkbox, EnumPill, ErrorBox, Fact, FactGrid, JurChip, Loading, Notice, Pill, Prose, Ref, TONE_BG, TONE_TEXT, Tag } from './ui.tsx';
import {
  DateField,
  PaneHeading,
  SubjectPicker,
  asArray,
  asRecord,
  errMsg,
  humanField,
  isPickType,
  normSubjectType,
  num,
  numArr,
  recordLabel,
  str,
  strArr,
  subjectTypeLabel,
  toggled,
  useLiveRecord,
} from './workShared.tsx';
import type { PickType } from './workShared.tsx';

type Item = InboxItemRec;

/** Relations the detail shows: the subject and the document. */
export const INBOX_EXPAND = 'matter,agreement,work,character,talent,product,permission,committee,case_ref,document';
/** Relations the list shows: the subject only. */
export const INBOX_LIST_EXPAND = 'matter,agreement,work,character,talent,product,permission,committee,case_ref';

const STATUTORY = new Set(['hard', 'extendable', 'designated']);

/* ------------------------------------------------------------------ */
/* Labels and small pieces shared with the list                        */
/* ------------------------------------------------------------------ */

const CONFIDENCE_TONE: Record<string, Tone> = { high: 'good', medium: 'info', low: 'warn', none: 'neutral' };

export function ConfidencePill({ confidence }: { confidence: string }): React.JSX.Element | null {
  if (confidence === '') return null;
  return (
    <Pill tone={CONFIDENCE_TONE[confidence] ?? 'neutral'} title={t('How sure the proposer is about what it read')}>
      {t('Confidence: {level}', { level: enumLabel('inbox_items.confidence', confidence) })}
    </Pill>
  );
}

/** Where an item came from; CraftBot items carry the CraftBot badge. */
export function SourceTag({ source }: { source: string }): React.JSX.Element | null {
  if (source === '') return null;
  if (source === 'agent') return <CraftBotBadge />;
  return <Tag>{enumLabel('inbox_items.source', source)}</Tag>;
}

const SUBJECT_FIELDS: [string, string][] = [
  ['matter', 'matter'],
  ['agreement', 'agreement'],
  ['work', 'work'],
  ['character', 'character'],
  ['talent', 'talent'],
  ['product', 'product'],
  ['permission', 'permission'],
  ['committee', 'committee'],
  ['case_ref', 'case'],
];

/** The record an item is about (its own subject type first), with a label from the expand. */
export function inboxSubject(item: Item): { type: string; id: string; label: string } | null {
  const rec = item as unknown as Record<string, unknown>;
  const ex = (item.expand ?? {}) as Record<string, unknown>;
  const wanted = normSubjectType(item.subject_type);
  const order = [...SUBJECT_FIELDS].sort((a, b) => (a[1] === wanted ? -1 : b[1] === wanted ? 1 : 0));
  for (const [field, type] of order) {
    const id = str(rec[field]);
    if (id !== '') return { type, id, label: recordLabel(type, asRecord(ex[field])) };
  }
  return null;
}

function firstDecision(item: Item): Record<string, unknown> | null {
  return item.status === 'awaiting_second' ? asRecord(item.proposal?.['first_decision']) : null;
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
  item: Item;
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

interface EventPreview {
  kind: string;
  subject_type: string;
  subject_id: string;
  events: PreviewEvent[];
}

interface DecideResult {
  status: Item['status'];
  summary?: { fields: number; events: number; deadlines: number; created: { id: string; title: string; due_date: string }[] } | undefined;
  agreement_id?: string | undefined;
  report_id?: string | undefined;
  lines?: number | undefined;
  permission_id?: string | undefined;
  created?: boolean | undefined;
  hits?: number | undefined;
}

function acceptedText(r: DecideResult): string {
  const head = r.status === 'partially_accepted' ? t('Partly accepted.') : t('Accepted.');
  const s = r.summary;
  if (s === undefined) return head;
  const parts: string[] = [];
  if (s.deadlines > 0) parts.push(tn(s.deadlines, '{n} deadline created', '{n} deadlines created'));
  if (s.fields > 0) parts.push(tn(s.fields, '{n} field updated', '{n} fields updated'));
  if (s.events > 0) parts.push(tn(s.events, '{n} event recorded', '{n} events recorded'));
  return parts.length > 0 ? `${head} ${joinList(parts)}` : head;
}

/* ------------------------------------------------------------------ */
/* Detail shell                                                        */
/* ------------------------------------------------------------------ */

export function InboxDetail({
  itemId,
  onBack,
  onDecided,
  onDeleted,
}: {
  itemId: string;
  onBack: () => void;
  onDecided: (id: string) => void;
  onDeleted: () => void;
}): React.JSX.Element {
  const { can, me, userName, settings } = useApp();
  const { record: item, loading, error, refresh } = useLiveRecord<Item>('inbox_items', itemId, INBOX_EXPAND);
  const [plan, setPlan] = useState<DecisionPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const back = (
    <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] lg:hidden">
      <ArrowLeft size={13} aria-hidden /> {t('Inbox')}
    </button>
  );

  if (loading) {
    return (
      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {back}
        <Loading />
      </div>
    );
  }
  if (item === null) {
    return (
      <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {back}
        <ErrorBox message={error ?? t('This item could not be loaded.')} onRetry={refresh} />
      </div>
    );
  }

  const pending = item.status === 'new' || item.status === 'awaiting_second';
  const myId = me?.id ?? '';
  const iAmFirst = item.status === 'awaiting_second' && item.first_approver !== '' && item.first_approver === myId;
  const mode: BodyMode = !pending ? 'decided' : can.edit && !iAmFirst ? 'edit' : 'view';
  const fromAgent = item.source === 'agent' || item.kind === 'document' || item.kind === 'agent_proposal' || item.kind === 'email';
  const needsTwo = item.status === 'new' && settings?.second_reviewer === true && fromAgent && plan?.statutory === true;
  const subject = inboxSubject(item);

  let acceptLabel = t('Accept');
  if (item.status === 'awaiting_second') acceptLabel = t('Give the second approval');
  else if (needsTwo) acceptLabel = t('Give the first approval');
  else if (plan?.acceptLabel !== undefined) acceptLabel = plan.acceptLabel;
  else if (plan !== null && plan.creates > 0) acceptLabel = tn(plan.creates, 'Accept and create {n} deadline', 'Accept and create {n} deadlines');

  const accept = async (): Promise<void> => {
    if (plan === null) return;
    setBusy(true);
    try {
      const r = await op<DecideResult>('inbox/decide', { id: item.id, decision: 'accept', ...plan.payload });
      if (r.status === 'awaiting_second') {
        toast.success(t('First approval recorded. A different person must give the second approval.'));
        refresh();
        onDecided(item.id);
        return;
      }
      if (r.agreement_id !== undefined && r.agreement_id !== '') {
        toast.success(t('Agreement created from the draft.'));
        navigate('agreement', r.agreement_id);
        return;
      }
      if (r.report_id !== undefined) toast.success(tn(r.lines ?? 0, 'Statement recorded with {n} line.', 'Statement recorded with {n} lines.'));
      else if (r.permission_id !== undefined) toast.success(r.created === true ? t('Permission created.') : t('Permission updated.'));
      else if (r.hits !== undefined) toast.success(tn(r.hits, '{n} watch hit added.', '{n} watch hits added.'));
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
      <OfficeChangeBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : item.kind === 'agreement_draft' ? (
      <AgreementDraftBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : item.kind === 'royalty_statement' ? (
      <RoyaltyStatementBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : item.kind === 'permission' ? (
      <PermissionBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : item.kind === 'watch_hit' ? (
      <WatchHitBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    ) : (
      <EventProposalBody key={item.id} item={item} mode={mode} onPlan={setPlan} />
    );

  return (
    <div className="flex min-w-0 flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] lg:max-h-[calc(100vh-9rem)] lg:overflow-y-auto">
      <div className="border-b border-[var(--agent-app-border)] px-4 py-3">
        {back}
        <div className="flex flex-wrap items-center gap-2">
          <Tag>{enumLabel('inbox_items.kind', item.kind)}</Tag>
          <EnumPill field="inbox_items.status" value={item.status} />
          <ConfidencePill confidence={item.confidence} />
          <SourceTag source={item.source} />
          <span className="ml-auto">
            <DeleteButton collection="inbox_items" id={item.id} iconOnly label={t('Delete this Inbox item')} onDeleted={onDeleted} />
          </span>
        </div>
        <h2 className="mt-2 break-words text-base font-semibold leading-snug">{item.title}</h2>
        <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--agent-app-muted)]">
          {item.proposed_by !== '' && <span className="min-w-0 break-words">{t('Proposed by {name}', { name: item.proposed_by })}</span>}
          <span className="tabular-nums">{fmtDateTime(item.created)}</span>
          {subject !== null && (
            <a href={subjectHref(subject.type, subject.id)} className="min-w-0 break-words font-medium text-[var(--agent-app-accent)] hover:underline">
              {subjectTypeLabel(subject.type)}
              {subject.label !== '' ? `: ${subject.label}` : ''}
            </a>
          )}
        </div>
      </div>

      <div className="min-w-0">{body}</div>

      <div className={cn('mt-auto border-t border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-3', pending && can.edit && 'sticky bottom-0 z-10')}>
        {pending ? (
          <div className="flex flex-col gap-3">
            {item.status === 'awaiting_second' && (
              <Notice tone="warn">
                {t('Waiting for a second reviewer: {name} accepted first.', { name: userName(item.first_approver) || t('a reviewer') })}{' '}
                {iAmFirst ? t('A different person must give the second approval.') : t('Check the choices above, then give the second approval.')}
              </Notice>
            )}
            {!can.edit ? (
              <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Only people who can edit records accept or reject Inbox items. You can read everything here.')}</p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="w-full min-w-0 text-xs text-[var(--agent-app-muted)] sm:w-auto sm:flex-1">
                  {iAmFirst
                    ? t('You gave the first approval.')
                    : plan !== null && plan.blocker !== ''
                      ? plan.blocker
                      : needsTwo
                        ? t('Statutory deadlines proposed by automation need two reviewers. Yours is the first approval.')
                        : t('Nothing changes until you accept.')}
                </p>
                <div className="ml-auto flex shrink-0 flex-wrap justify-end gap-2">
                  <Button variant="outline" onClick={() => setRejectOpen(true)} disabled={busy}>
                    {t('Reject')}
                  </Button>
                  <Button onClick={() => void accept()} loading={busy} disabled={plan === null || plan.blocker !== '' || iAmFirst}>
                    {iAmFirst ? t('Waiting for a second reviewer') : acceptLabel}
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

function Outcome({ item }: { item: Item }): React.JSX.Element {
  const { userName } = useApp();
  const who = item.decided_by !== '' ? userName(item.decided_by) : '';
  const subject = inboxSubject(item);
  return (
    <div className="flex flex-col gap-1.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <EnumPill field="inbox_items.status" value={item.status} />
        <span className="text-[var(--agent-app-muted)]">
          {who !== '' ? t('by {name}', { name: who }) : ''}
          {item.decided_at !== '' ? ` ${fmtDateTime(item.decided_at)}` : ''}
        </span>
      </div>
      {item.requires_second && item.first_approver !== '' && (
        <p className="text-xs text-[var(--agent-app-muted)]">
          {t('First approval by {name}, {date}.', { name: userName(item.first_approver), date: fmtDateTime(item.first_approved_at) })}
        </p>
      )}
      {item.note !== '' && <p className="break-words border-l-2 border-[var(--agent-app-border)] pl-3 text-[var(--agent-app-text)]/85">{item.note}</p>}
      {item.status !== 'rejected' && subject !== null && (
        <a href={subjectHref(subject.type, subject.id)} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
          {t('Open the record')}
        </a>
      )}
    </div>
  );
}

function RejectDialog({ item, onClose, onDone }: { item: Item; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [note, setNote] = useState('');
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const missing = note.trim() === '';
  const submit = async (): Promise<void> => {
    setTried(true);
    if (missing) return;
    setBusy(true);
    try {
      await op<DecideResult>('inbox/decide', { id: item.id, decision: 'reject', note: note.trim() });
      toast.success(t('Rejected. Nothing was changed.'));
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
      title={t('Reject this item')}
      description={t('Nothing changes on the records. The item keeps your note in its history.')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy}>
            {t('Reject')}
          </Button>
        </>
      }
    >
      <Textarea
        label={t('Reason')}
        rows={3}
        value={note}
        error={tried && missing ? t('Say why, so the history stays clear.') : undefined}
        onChange={(e) => setNote(e.target.value)}
        placeholder={t('For example: already recorded by outside counsel')}
      />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Shared body pieces                                                  */
/* ------------------------------------------------------------------ */

function SummaryBlock({ item }: { item: Item }): React.JSX.Element | null {
  const extra = str(item.proposal?.['summary']);
  const docType = str(item.proposal?.['document_type']);
  if (item.summary === '' && extra === '' && docType === '') return null;
  return (
    <div className="min-w-0">
      <PaneHeading right={docType !== '' ? <Tag>{enumLabel('documents.doc_type', docType)}</Tag> : undefined}>{t('Summary')}</PaneHeading>
      {item.summary !== '' && <Prose className="break-words">{item.summary}</Prose>}
      {extra !== '' && extra !== item.summary && <Prose className="mt-2 break-words text-[var(--agent-app-text)]/85">{extra}</Prose>}
    </div>
  );
}

function DocumentLink({ item }: { item: Item }): React.JSX.Element | null {
  if (item.document === '') return null;
  const doc = (item.expand?.['document'] ?? null) as DocumentRec | null;
  const url = doc !== null && doc.file !== '' ? fileUrl(doc, doc.file) : '';
  return (
    <div className="min-w-0">
      <PaneHeading>{t('Document')}</PaneHeading>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1.5 border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
        <FileText size={14} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
        <span className="min-w-0 flex-1 break-words font-medium">{doc !== null ? doc.title || doc.file : t('Document attached')}</span>
        {doc !== null && doc.doc_type !== '' && <Tag>{enumLabel('documents.doc_type', doc.doc_type)}</Tag>}
        {doc !== null && d10(doc.doc_date) !== '' && <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(doc.doc_date)}</span>}
        {url !== '' && (
          <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
            <ExternalLink size={12} aria-hidden /> {t('Open the file')}
          </a>
        )}
      </div>
    </div>
  );
}

function CitationList({ citations }: { citations: Citation[] }): React.JSX.Element | null {
  if (citations.length === 0) return null;
  return (
    <div className="min-w-0">
      <PaneHeading>{t('Where it was read')}</PaneHeading>
      <div className="flex flex-col gap-3">
        {citations.map((c, i) => (
          <div key={`${i}-${c.field ?? ''}`} className="min-w-0">
            <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--agent-app-muted)]">
              {c.field !== undefined && c.field !== '' && <span className="font-medium text-[var(--agent-app-text)]/85">{humanField(c.field)}</span>}
              {c.page !== undefined && <span>{t('Page {n}', { n: c.page })}</span>}
              {c.url !== undefined && c.url !== '' && (
                <a href={c.url} target="_blank" rel="noreferrer" className="min-w-0 break-all text-[var(--agent-app-accent)] hover:underline">
                  {c.url}
                </a>
              )}
            </div>
            {c.quote !== undefined && c.quote !== '' && (
              <blockquote className="mt-1 whitespace-pre-wrap break-words border-l-2 border-[var(--agent-app-accent)]/60 bg-[var(--agent-app-border)]/15 px-3 py-1.5 text-[13px] italic leading-relaxed">
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
  if (error !== '') return <Notice tone="warn">{error}</Notice>;
  if (proposals === null) return <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Working out deadlines...')}</p>;
  return <ProposalList proposals={proposals} selected={selected} onToggle={editable ? onToggle : () => undefined} />;
}

function countCreates(proposals: Proposal[] | null | undefined, sel: Set<string>): { creates: number; statutory: boolean } {
  let creates = 0;
  let statutory = false;
  for (const p of proposals ?? []) {
    if (sel.has(p.key) && !p.exists) {
      creates += 1;
      if (STATUTORY.has(p.kind)) statutory = true;
    }
  }
  return { creates, statutory };
}

const byDefault = (p: Proposal): boolean => p.selected && !p.exists;

/* ------------------------------------------------------------------ */
/* Office change                                                       */
/* ------------------------------------------------------------------ */

interface DiffItem {
  field: string;
  label: string;
  current: string;
  incoming: string;
  kind: string;
}

function diffFieldLabel(field: string, fallback: string): string {
  switch (field) {
    case 'title':
      return t('Title|mark');
    case 'filing_date':
      return t('Filing date');
    case 'publication_no':
      return t('Publication number');
    case 'publication_date':
      return t('Publication date');
    case 'registration_no':
      return t('Registration number');
    case 'registration_date':
      return t('Registration date');
    case 'owner_of_record':
      return t('Owner of record');
    case 'office_status':
      return t('Office status');
    case 'status':
      return t('Status');
    default:
      return fallback !== '' ? fallback : humanField(field);
  }
}

function diffValue(d: DiffItem, v: string): string {
  if (v === '') return '';
  if (d.kind === 'date') return fmtDate(v) || v;
  if (d.field === 'status') return enumLabel('matters.status', v);
  return v;
}

function OfficeChangeBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const eventLabel = useEventLabel();
  const first = firstDecision(item);
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const diffs = useMemo(
    (): DiffItem[] =>
      (item.diffs ?? []).map((d) => ({ field: str(d['field']), label: str(d['label']), current: str(d['current']), incoming: str(d['incoming']), kind: str(d['kind']) })).filter((d) => d.field !== ''),
    [item.diffs],
  );
  const events = useMemo(
    () =>
      asArray(item.proposal?.['events']).map((x) => {
        const ev = asRecord(x) ?? {};
        return { code: str(ev['code']), raw: str(ev['raw_code']), date: d10(str(ev['date'])), label: str(ev['label']) };
      }),
    [item.proposal],
  );
  const annuities = useMemo(
    () =>
      asArray(item.proposal?.['annuity_updates']).map((x) => {
        const a = asRecord(x) ?? {};
        return { id: str(a['deadline_id']), title: str(a['title']), current: d10(str(a['current'])), incoming: d10(str(a['incoming'])) };
      }),
    [item.proposal],
  );

  const [fields, setFields] = useState<Set<string>>(() =>
    first !== null && Array.isArray(first['fields']) ? new Set(strArr(first['fields'])) : new Set(diffs.map((d) => d.field)),
  );
  const [included, setIncluded] = useState<Set<number>>(() => {
    if (first !== null && Array.isArray(first['events'])) return new Set(numArr(first['events']));
    const s = new Set<number>();
    events.forEach((ev, i) => {
      if (ev.code !== '' && ev.date !== '') s.add(i);
    });
    return s;
  });
  const [annuityOn, setAnnuityOn] = useState(true);
  const [preview, setPreview] = useState<Record<number, Proposal[]> | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [sel, setSel] = useState<Record<number, Set<string>>>({});
  const usedFirst = useRef(false);
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const previewRef = useRef(preview);
  previewRef.current = preview;
  // Another person or an agent changing the record's deadlines changes the preview; keep the ticks.
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events', 'matters'], () => setLiveTick((x) => x + 1), live);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    op<EventPreview>('inbox/preview', { id: item.id })
      .then((r) => {
        if (cancelled) return;
        const before = previewRef.current;
        const next: Record<number, Proposal[]> = {};
        for (const ev of r.events) next[ev.index] = ev.proposals;
        setPreview(next);
        setPreviewErr('');
        const prior = first !== null ? asRecord(first['deadlines']) : null;
        const useFirst = !fromLive && prior !== null && !usedFirst.current;
        if (useFirst) usedFirst.current = true;
        setSel((s) => {
          const out: Record<number, Set<string>> = {};
          for (const ev of r.events) {
            if (fromLive && before !== null) out[ev.index] = mergeSelection(s[ev.index] ?? new Set<string>(), before[ev.index] ?? null, ev.proposals, byDefault);
            else if (useFirst && Array.isArray(prior?.[String(ev.index)])) out[ev.index] = new Set(strArr(prior?.[String(ev.index)]));
            else out[ev.index] = new Set(ev.proposals.filter(byDefault).map((p) => p.key));
          }
          return out;
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setPreview({});
        setPreviewErr(errMsg(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, live, liveTick]);

  useEffect(() => {
    if (!live) return;
    const inc = [...included].filter((i) => preview !== null && preview[i] !== undefined).sort((a, b) => a - b);
    const deadlines: Record<string, string[]> = {};
    let creates = 0;
    let statutory = false;
    for (const i of inc) {
      const s = sel[i] ?? new Set<string>();
      deadlines[String(i)] = [...s];
      const c = countCreates(preview?.[i], s);
      creates += c.creates;
      statutory = statutory || c.statutory;
    }
    const annuityApplies = annuityOn && annuities.length > 0;
    let blocker = '';
    if (preview === null) blocker = t('Working out deadlines...');
    else if (previewErr !== '') blocker = t('The deadlines could not be worked out: {error}', { error: previewErr });
    else if (fields.size === 0 && inc.length === 0 && !annuityApplies) blocker = t('Nothing is ticked. Tick what to accept, or reject the item.');
    onPlan({ payload: { fields: [...fields], events: inc, deadlines, annuity: annuityOn }, creates, statutory, blocker });
  }, [fields, included, preview, previewErr, sel, annuityOn, annuities.length, live, onPlan]);

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />

      {diffs.length > 0 && (
        <div className="min-w-0">
          <PaneHeading
            right={
              editable && diffs.length > 1 ? (
                <Checkbox
                  checked={fields.size === diffs.length}
                  indeterminate={fields.size > 0 && fields.size < diffs.length}
                  onChange={(v) => setFields(v ? new Set(diffs.map((d) => d.field)) : new Set())}
                  label={<span className="text-xs text-[var(--agent-app-muted)]">{t('All fields')}</span>}
                />
              ) : undefined
            }
          >
            {t('Field changes')}
          </PaneHeading>
          <div className="overflow-x-auto border border-[var(--agent-app-border)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  {live && <th className="w-9 px-3 py-2" aria-label={t('Accept')} />}
                  <th className="px-3 py-2">{t('Field')}</th>
                  <th className="px-3 py-2">{t('On the record')}</th>
                  <th className="px-3 py-2">{t('From the office')}</th>
                </tr>
              </thead>
              <tbody>
                {diffs.map((d) => {
                  const on = fields.has(d.field);
                  const label = diffFieldLabel(d.field, d.label);
                  return (
                    <tr key={d.field} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                      {live && (
                        <td className="px-3 py-2 align-top">
                          <Checkbox checked={on} disabled={!editable} onChange={(v) => setFields((s) => toggled(s, d.field, v))} ariaLabel={t('Accept {field}', { field: label })} />
                        </td>
                      )}
                      <td className="whitespace-nowrap px-3 py-2 align-top font-medium">{label}</td>
                      <td className={cn('min-w-[8rem] break-words px-3 py-2 align-top text-[var(--agent-app-muted)]', live && on && d.current !== '' && 'line-through decoration-1')}>
                        {diffValue(d, d.current) || <span className="text-[var(--agent-app-muted)]/70">{t('Empty')}</span>}
                      </td>
                      <td className="min-w-[8rem] break-words px-3 py-2 align-top">
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
          <PaneHeading>{t('New office events')}</PaneHeading>
          <div className="border border-[var(--agent-app-border)]">
            {events.map((ev, i) => {
              const recordable = ev.code !== '' && ev.date !== '';
              const on = included.has(i) && recordable;
              const pv = preview?.[i];
              return (
                <div key={`${i}-${ev.code}-${ev.date}`} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {live && (
                      <div className="pt-0.5">
                        <Checkbox
                          checked={on}
                          disabled={!editable || !recordable}
                          onChange={(v) => setIncluded((s) => toggled(s, i, v))}
                          ariaLabel={t('Record {event}', { event: ev.code !== '' ? eventLabel(ev.code) : ev.label })}
                        />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="text-[13px] font-medium">{ev.code !== '' ? eventLabel(ev.code) : t('Office event not recognized')}</span>
                        <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{ev.date !== '' ? fmtDate(ev.date) : t('No date')}</span>
                        {ev.raw !== '' && <span className="break-all font-mono text-[11px] text-[var(--agent-app-muted)]">{ev.raw}</span>}
                      </div>
                      {ev.label !== '' && <div className="mt-0.5 break-words text-xs text-[var(--agent-app-muted)]">{ev.label}</div>}
                      {!recordable && <div className="mt-1 text-xs text-[var(--agent-app-muted)]">{t('It cannot be recorded from here. Record it on the trademark page if it matters.')}</div>}
                      {live && on && (
                        <div className="mt-2 min-w-0">
                          <PreviewBlock
                            proposals={preview === null ? null : (pv ?? [])}
                            error={previewErr}
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
          <PaneHeading>{t('Official payment dates')}</PaneHeading>
          <div className="border border-[var(--agent-app-border)] px-3 py-2.5">
            {live && (
              <Checkbox
                checked={annuityOn}
                disabled={!editable}
                onChange={setAnnuityOn}
                label={t('Use the official due dates from the office. They replace the calculated dates and are locked.')}
              />
            )}
            <div className="mt-2 flex flex-col gap-1.5">
              {annuities.map((a) => (
                <div key={a.id} className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-[13px]">
                  <a href={href('deadlines', a.id)} className="min-w-0 break-words hover:underline">
                    {a.title}
                  </a>
                  <span className="tabular-nums">
                    <span className="font-medium">{t('Official {date}', { date: fmtDate(a.incoming) })}</span>
                    <span className="text-[var(--agent-app-muted)]"> · {t('calculated {date}', { date: fmtDate(a.current) })}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {diffs.length === 0 && events.length === 0 && annuities.length === 0 && <Notice>{t('This office change has no field changes, events or dates to apply.')}</Notice>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Document, CraftBot proposal, email                                  */
/* ------------------------------------------------------------------ */

interface ExtraRow {
  key: number;
  title: string;
  title_ja: string;
  due_date: string;
  kind: string;
  category: string;
  reason: string;
  citation: string;
}

const DEADLINE_KINDS = ['hard', 'extendable', 'designated', 'internal', 'reminder'];

function initialExtras(item: Item): ExtraRow[] {
  const first = firstDecision(item);
  const src = first !== null && Array.isArray(first['extra_deadlines']) ? first['extra_deadlines'] : item.proposal?.['extra_deadlines'];
  return asArray(src)
    .map((x) => asRecord(x))
    .filter((x): x is Record<string, unknown> => x !== null)
    .map((x, i) => ({
      key: i,
      title: str(x['title']),
      title_ja: str(x['title_ja']),
      due_date: d10(str(x['due_date'])),
      kind: DEADLINE_KINDS.includes(str(x['kind'])) ? str(x['kind']) : 'internal',
      category: str(x['category']),
      reason: str(x['reason']),
      citation: str(x['citation']),
    }));
}

function EventProposalBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const eventLabel = useEventLabel();
  const first = firstDecision(item);
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const proposal = useMemo(() => asRecord(item.proposal) ?? {}, [item.proposal]);
  const ev0 = asRecord(proposal['event']);
  const hasEvent = ev0 !== null && str(ev0['code']) !== '';

  const start = useMemo((): Record<string, unknown> => {
    const ovr = first !== null ? asRecord(first['event_override']) : null;
    if (ovr !== null && str(ovr['code']) !== '') return ovr;
    return ev0 ?? {};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // The record: the person's earlier choice, then the item's own link. Records
  // that cannot be picked here (Content ID claims, recordations) stay as proposed.
  const initial = useMemo((): { type: PickType | ''; id: string; fixed: boolean } => {
    if (first !== null) {
      const ft = normSubjectType(str(first['subject_type']));
      if (isPickType(ft) && str(first['subject_id']) !== '') return { type: ft, id: str(first['subject_id']), fixed: false };
    }
    const s = inboxSubject(item);
    if (s !== null && isPickType(s.type)) return { type: s.type, id: s.id, fixed: false };
    const st = normSubjectType(item.subject_type);
    if (st !== '' && !isPickType(st) && str(proposal['subject_id']) !== '') return { type: '', id: '', fixed: true };
    return { type: '', id: '', fixed: false };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);
  const fixed = initial.fixed;
  const [subjType, setSubjType] = useState<PickType | ''>(initial.type);
  const [subjId, setSubjId] = useState(initial.id);
  const codeType = (fixed ? normSubjectType(item.subject_type) : subjType) as SubjectType;
  const catalog = useEventCodes(codeType);

  const [code, setCode] = useState(str(start['code']));
  const [date, setDate] = useState(d10(str(start['date'])));
  const [label, setLabel] = useState(str(start['label']));
  const [months, setMonths] = useState(str(start['period_months']));
  const [days, setDays] = useState(str(start['period_days']));
  const [due, setDue] = useState(d10(str(start['due_date'])));
  const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date);

  const [proposals, setProposals] = useState<Proposal[] | null>(null);
  const [previewErr, setPreviewErr] = useState('');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [extras, setExtras] = useState<ExtraRow[]>(() => initialExtras(item));
  const usedFirst = useRef(false);
  const [liveTick, setLiveTick] = useState(0);
  const seenTick = useRef(0);
  const proposalsRef = useRef(proposals);
  proposalsRef.current = proposals;
  useLiveReload(['deadlines', 'rules', 'office_calendars', 'events'], () => setLiveTick((x) => x + 1), live && hasEvent);

  const override = useMemo((): Record<string, unknown> => {
    const o: Record<string, unknown> = { code, date, label };
    if (Number(months) > 0) o['period_months'] = Number(months);
    if (Number(days) > 0) o['period_days'] = Number(days);
    if (d10(due) !== '') o['due_date'] = d10(due);
    const jur = str(ev0?.['jurisdiction']);
    if (jur !== '') o['jurisdiction'] = jur;
    const md = str(ev0?.['mode']);
    if (md !== '') o['mode'] = md;
    return o;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, date, label, months, days, due]);

  const subjectPayload = useMemo((): Record<string, unknown> => (fixed || subjId === '' ? {} : { subject_type: subjType, subject_id: subjId }), [fixed, subjType, subjId]);

  useEffect(() => {
    if (!live || !hasEvent) return;
    if (!fixed && subjId === '') {
      setProposals([]);
      setPreviewErr(t('Choose the record this belongs to, to see the deadlines it creates.'));
      return;
    }
    if (!validDate || code === '') {
      setProposals([]);
      setPreviewErr(t('Enter the event and its date to see the deadlines it creates.'));
      return;
    }
    let cancelled = false;
    const fromLive = seenTick.current !== liveTick;
    seenTick.current = liveTick;
    const before = fromLive ? proposalsRef.current : null;
    if (!fromLive) setProposals(null);
    const timer = setTimeout(() => {
      op<EventPreview>('inbox/preview', { id: item.id, ...subjectPayload, event_override: override })
        .then((r) => {
          if (cancelled) return;
          if (r.subject_type === '') {
            setProposals([]);
            setPreviewErr(t('Choose the record this belongs to, to see the deadlines it creates.'));
            return;
          }
          const ps = r.events[0]?.proposals ?? [];
          setProposals(ps);
          setPreviewErr('');
          const prior = first !== null ? asRecord(first['deadlines'])?.['0'] : undefined;
          if (before !== null) setSel((s) => mergeSelection(s, before, ps, byDefault));
          else if (Array.isArray(prior) && !usedFirst.current) {
            usedFirst.current = true;
            setSel(new Set(strArr(prior)));
          } else setSel(new Set(ps.filter(byDefault).map((p) => p.key)));
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setProposals([]);
          setPreviewErr(errMsg(e));
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id, subjectPayload, override, live, hasEvent, validDate, code, fixed, subjId, liveTick]);

  useEffect(() => {
    if (!live) return;
    const valid = extras.filter((x) => x.title.trim() !== '' && d10(x.due_date) !== '');
    const partial = extras.some((x) => (x.title.trim() !== '') !== (d10(x.due_date) !== ''));
    const c = hasEvent && previewErr === '' ? countCreates(proposals, sel) : { creates: 0, statutory: false };
    const payload: Record<string, unknown> = {
      ...subjectPayload,
      extra_deadlines: valid.map((x) => ({
        title: x.title.trim(),
        ...(x.title_ja !== '' ? { title_ja: x.title_ja } : {}),
        due_date: d10(x.due_date),
        kind: x.kind,
        ...(x.category !== '' ? { category: x.category } : {}),
        ...(x.reason !== '' ? { reason: x.reason } : {}),
        ...(x.citation !== '' ? { citation: x.citation } : {}),
      })),
    };
    if (hasEvent) {
      payload['event_override'] = override;
      if (proposals !== null && previewErr === '') payload['deadlines'] = { '0': [...sel] };
    }
    let blocker = '';
    if (!fixed && subjId === '') blocker = t('Choose the record this belongs to.');
    else if (hasEvent && (!validDate || code === '')) blocker = t('Enter the event and its date.');
    else if (hasEvent && proposals === null) blocker = t('Working out deadlines...');
    else if (hasEvent && previewErr !== '') blocker = t('The deadlines could not be worked out: {error}', { error: previewErr });
    else if (partial) blocker = t('Give every extra deadline a title and a due date, or remove it.');
    onPlan({ payload, creates: c.creates + valid.length, statutory: c.statutory, blocker });
  }, [extras, proposals, previewErr, sel, subjectPayload, override, hasEvent, validDate, code, fixed, subjId, live, onPlan]);

  const codeOptions = useMemo(() => {
    const list = code !== '' && !catalog.includes(code) ? [code, ...catalog] : catalog;
    return list.map((c) => ({ value: c, label: eventLabel(c) }));
  }, [catalog, code, eventLabel]);

  const subject = inboxSubject(item);

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />
      <DocumentLink item={item} />

      <div className="min-w-0">
        <PaneHeading>{t('Record')}</PaneHeading>
        {fixed ? (
          <p className="text-[13px]">{t('{type}, as proposed', { type: subjectTypeLabel(normSubjectType(item.subject_type)) })}</p>
        ) : editable ? (
          <SubjectPicker
            type={subjType}
            id={subjId}
            onChange={(ty, id) => {
              setSubjType(ty);
              setSubjId(id);
            }}
          />
        ) : subject !== null ? (
          <a href={subjectHref(subject.type, subject.id)} className="break-words text-[13px] hover:underline">
            {subjectTypeLabel(subject.type)}
            {subject.label !== '' ? `: ${subject.label}` : ''}
          </a>
        ) : (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No record chosen yet.')}</p>
        )}
      </div>

      {hasEvent ? (
        <div className="min-w-0">
          <PaneHeading>{t('What happened')}</PaneHeading>
          {live ? (
            <div className="grid min-w-0 gap-3 sm:grid-cols-2">
              <Select label={t('Event')} value={code} options={codeOptions} placeholder={codeOptions.length === 0 ? t('Choose the record first') : undefined} disabled={!editable} onChange={(e) => setCode(e.target.value)} />
              <DateField label={t('Date on the document')} value={date} onChange={setDate} disabled={!editable} required />
              <div className="sm:col-span-2">
                <Input label={t('Description (optional)')} value={label} disabled={!editable} onChange={(e) => setLabel(e.target.value)} />
              </div>
              <Input label={t('Reply period (months)')} type="number" min={0} value={months} disabled={!editable} onChange={(e) => setMonths(e.target.value)} placeholder={t('Usual period')} />
              <Input label={t('or in days')} type="number" min={0} value={days} disabled={!editable} onChange={(e) => setDays(e.target.value)} placeholder={t('Usual period')} />
              <div className="sm:col-span-2">
                <DateField
                  label={t('Due date stated in the document')}
                  value={due}
                  onChange={setDue}
                  disabled={!editable}
                  help={t('Optional. When the document states the due date, it replaces the calculated one.')}
                />
              </div>
            </div>
          ) : (
            <FactGrid cols={2}>
              <Fact label={t('Event')} value={eventLabel(str(start['code']))} />
              <Fact label={t('Date')} value={fmtDate(str(start['date']))} />
              {str(start['label']) !== '' && <Fact label={t('Description')} value={str(start['label'])} />}
              {(num(start['period_months']) ?? 0) > 0 && <Fact label={t('Reply period')} value={tn(num(start['period_months']) ?? 0, '{n} month', '{n} months')} />}
              {(num(start['period_days']) ?? 0) > 0 && <Fact label={t('Reply period')} value={tn(num(start['period_days']) ?? 0, '{n} day', '{n} days')} />}
              {d10(str(start['due_date'])) !== '' && <Fact label={t('Due date stated in the document')} value={fmtDate(str(start['due_date']))} />}
            </FactGrid>
          )}
          {live && (
            <div className="mt-4 min-w-0">
              <PaneHeading>{t('Deadlines this creates')}</PaneHeading>
              <PreviewBlock proposals={proposals} error={previewErr} selected={sel} editable={editable} onToggle={(k, v) => setSel((s) => toggled(s, k, v))} />
            </div>
          )}
        </div>
      ) : (
        <Notice>{t('No event was proposed. Accepting links the document to the record and creates the extra deadlines below.')}</Notice>
      )}

      <ExtraDeadlines rows={extras} onChange={setExtras} editable={editable} live={live} />
      <CitationList citations={item.citations ?? []} />
    </div>
  );
}

function ExtraDeadlines({ rows, onChange, editable, live }: { rows: ExtraRow[]; onChange: (rows: ExtraRow[]) => void; editable: boolean; live: boolean }): React.JSX.Element {
  const update = (key: number, patch: Partial<ExtraRow>): void => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const add = (): void => {
    const next = rows.reduce((m, r) => Math.max(m, r.key), -1) + 1;
    onChange([...rows, { key: next, title: '', title_ja: '', due_date: '', kind: 'internal', category: '', reason: '', citation: '' }]);
  };
  const kindOptions = enumOptions('deadlines.kind').map(([value, label]) => ({ value, label }));
  return (
    <div className="min-w-0">
      <PaneHeading
        right={
          editable ? (
            <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={add}>
              <Plus size={13} aria-hidden /> {t('Add')}
            </Button>
          ) : undefined
        }
      >
        {t('Extra deadlines')}
      </PaneHeading>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{editable ? t('None proposed. Add one for a follow-up no rule covers, such as reporting to the licensor.') : t('None proposed.')}</p>
      ) : !live ? (
        <div className="border border-[var(--agent-app-border)]">
          {rows.map((r) => (
            <div key={r.key} className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--agent-app-border)]/70 px-3 py-2 text-[13px] last:border-0">
              <span className="min-w-0 break-words">{isJa() && r.title_ja !== '' ? r.title_ja : r.title}</span>
              <span className="flex items-center gap-2">
                <Tag>{enumLabel('deadlines.kind', r.kind)}</Tag>
                <span className="tabular-nums text-[var(--agent-app-muted)]">{fmtDate(r.due_date)}</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((r) => (
            <div key={r.key} className="min-w-0 border border-[var(--agent-app-border)] p-2">
              <div className="grid min-w-0 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,9.5rem)_minmax(0,9rem)_auto]">
                <Input aria-label={t('What needs to happen')} placeholder={t('What needs to happen')} value={r.title} disabled={!editable} onChange={(e) => update(r.key, { title: e.target.value })} />
                <input
                  type="date"
                  aria-label={t('Due date')}
                  className="h-9 w-full min-w-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm tabular-nums disabled:opacity-60"
                  value={r.due_date}
                  disabled={!editable}
                  onChange={(e) => update(r.key, { due_date: e.target.value })}
                />
                <Select aria-label={t('Kind')} title={kindHelp(r.kind)} value={r.kind} options={kindOptions} disabled={!editable} onChange={(e) => update(r.key, { kind: e.target.value })} />
                {editable && (
                  <Button size="icon" variant="ghost" aria-label={t('Remove this deadline')} title={t('Remove this deadline')} onClick={() => onChange(rows.filter((x) => x.key !== r.key))}>
                    <Trash2 size={14} aria-hidden />
                  </Button>
                )}
              </div>
              {(r.reason !== '' || r.citation !== '') && (
                <p className="mt-1.5 break-words text-xs text-[var(--agent-app-muted)]">
                  {r.reason}
                  {r.reason !== '' && r.citation !== '' ? ' · ' : ''}
                  {r.citation !== '' ? t('Basis: {citation}', { citation: r.citation }) : ''}
                </p>
              )}
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

const AG_DATES = ['signed_date', 'term_start', 'term_end'] as const;
const AG_NUMBERS = ['royalty_rate', 'advance', 'minimum_guarantee', 'flat_fee'] as const;
const AG_ENUMS = [
  ['agreement_type', 'agreements.agreement_type'],
  ['direction', 'agreements.direction'],
  ['exclusivity', 'agreements.exclusivity'],
  ['royalty_basis', 'agreements.royalty_basis'],
  ['reporting_frequency', 'agreements.reporting_frequency'],
] as const;

type AgDate = (typeof AG_DATES)[number];
type AgNumber = (typeof AG_NUMBERS)[number];
type AgEnum = (typeof AG_ENUMS)[number][0];

interface AgForm {
  title: string;
  counterparty_name: string;
  franchise_id: string;
  work_id: string;
  territory_summary: string;
  currency: string;
  copyright_notice: string;
  perpetual: boolean;
  auto_renew: boolean;
  dates: Record<AgDate, string>;
  numbers: Record<AgNumber, string>;
  enums: Record<AgEnum, string>;
}

function agLabel(key: string): string {
  switch (key) {
    case 'agreement_type':
      return t('Agreement type');
    case 'direction':
      return t('Direction');
    case 'exclusivity':
      return t('Exclusivity');
    case 'royalty_basis':
      return t('Royalty basis');
    case 'reporting_frequency':
      return t('Royalty reporting');
    case 'signed_date':
      return t('Signed');
    case 'term_start':
      return t('Term starts');
    case 'term_end':
      return t('Term ends');
    case 'royalty_rate':
      return t('Royalty rate (%)');
    case 'advance':
      return t('Advance');
    case 'minimum_guarantee':
      return t('Minimum guarantee');
    case 'flat_fee':
      return t('Flat fee');
    default:
      return humanField(key);
  }
}

function initialForm(a: Record<string, unknown>): AgForm {
  const enumOk = (field: string, v: string): string => (enumOptions(field).some(([x]) => x === v) ? v : '');
  return {
    title: str(a['title']),
    counterparty_name: str(a['counterparty_name']) || str(a['counterparty']),
    franchise_id: str(a['franchise_id']),
    work_id: str(a['work_id']),
    territory_summary: str(a['territory_summary']),
    currency: str(a['currency']).toUpperCase(),
    copyright_notice: str(a['copyright_notice']),
    perpetual: a['perpetual'] === true,
    auto_renew: a['auto_renew'] === true,
    dates: { signed_date: d10(str(a['signed_date'])), term_start: d10(str(a['term_start'])), term_end: d10(str(a['term_end'])) },
    numbers: { royalty_rate: str(a['royalty_rate']), advance: str(a['advance']), minimum_guarantee: str(a['minimum_guarantee']), flat_fee: str(a['flat_fee']) },
    enums: {
      agreement_type: enumOk('agreements.agreement_type', str(a['agreement_type'])) || 'other',
      direction: enumOk('agreements.direction', str(a['direction'])) || 'none',
      exclusivity: enumOk('agreements.exclusivity', str(a['exclusivity'])),
      royalty_basis: enumOk('agreements.royalty_basis', str(a['royalty_basis'])),
      reporting_frequency: enumOk('agreements.reporting_frequency', str(a['reporting_frequency'])),
    },
  };
}

interface Conflict {
  grant_index: number;
  asset: string;
  value: string;
  value_ja: string;
  status: string;
  reasons: { code: string; text: Bi; ref?: string }[];
}

function dimensionName(dim: string): string {
  switch (dim) {
    case 'territory':
      return t('Territory');
    case 'media':
      return t('Media');
    case 'language':
      return t('Language');
    case 'category':
      return t('Category');
    case 'channel':
      return t('Channel|dimension');
    case 'platform':
      return t('Platform');
    default:
      return humanField(dim);
  }
}

function AgreementDraftBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const { dimValues, nameOf, homeCurrency } = useApp();
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const original = useMemo(() => asRecord(item.proposal?.['agreement']) ?? {}, [item.proposal]);
  const grants = useMemo(() => asArray(item.proposal?.['grants']).map((g) => asRecord(g)).filter((g): g is Record<string, unknown> => g !== null), [item.proposal]);
  const [f, setF] = useState<AgForm>(() => initialForm(original));

  const conflicts = useLiveAsync(
    async () => (live ? (await op<{ conflicts: Conflict[] }>('inbox/preview', { id: item.id })).conflicts ?? [] : []),
    [item.id, live],
    ['grants', 'agreements'],
  );

  useEffect(() => {
    if (!live) return;
    const a: Record<string, unknown> = { ...original };
    const bad: string[] = [];
    a['title'] = f.title.trim();
    const cp = f.counterparty_name.trim();
    a['counterparty_name'] = cp;
    a['counterparty'] = cp;
    // An edited name means another counterparty than the one the reader matched.
    if (cp !== (str(original['counterparty_name']) || str(original['counterparty']))) delete a['counterparty_id'];
    a['franchise_id'] = f.franchise_id;
    a['work_id'] = f.work_id;
    a['territory_summary'] = f.territory_summary.trim();
    a['currency'] = f.currency;
    a['copyright_notice'] = f.copyright_notice.trim();
    a['perpetual'] = f.perpetual;
    a['auto_renew'] = f.auto_renew;
    for (const k of AG_DATES) a[k] = d10(f.dates[k]);
    for (const k of AG_NUMBERS) {
      const v = f.numbers[k].trim();
      if (v === '') a[k] = '';
      else if (Number.isFinite(Number(v))) a[k] = Number(v);
      else bad.push(agLabel(k));
    }
    for (const [k] of AG_ENUMS) a[k] = f.enums[k];
    let blocker = '';
    if (f.title.trim() === '') blocker = t('The agreement needs a title.');
    else if (bad.length > 0) blocker = t('These must be numbers: {fields}', { fields: joinList(bad) });
    else if (f.dates.term_start !== '' && f.dates.term_end !== '' && f.dates.term_end < f.dates.term_start) blocker = t('The term cannot end before it starts.');
    onPlan({ payload: { agreement: a, grants }, creates: 0, statutory: false, blocker, acceptLabel: t('Create the agreement') });
  }, [f, original, grants, live, onPlan]);

  const setDate = (k: AgDate, v: string): void => setF((x) => ({ ...x, dates: { ...x.dates, [k]: v } }));
  const setNumber = (k: AgNumber, v: string): void => setF((x) => ({ ...x, numbers: { ...x.numbers, [k]: v } }));
  const setEnum = (k: AgEnum, v: string): void => setF((x) => ({ ...x, enums: { ...x.enums, [k]: v } }));
  const currencyOptions = [...(f.currency !== '' && !CURRENCIES.includes(f.currency) ? [f.currency] : []), ...CURRENCIES].map((c) => ({ value: c, label: c }));
  const list = conflicts.data ?? [];

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />
      <DocumentLink item={item} />

      <div className="min-w-0">
        <PaneHeading>{t('Agreement')}</PaneHeading>
        {live ? (
          <div className="grid min-w-0 gap-3 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label={t('Agreement title')} value={f.title} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, title: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Input
                label={t('Counterparty')}
                value={f.counterparty_name}
                disabled={!editable}
                onChange={(e) => setF((x) => ({ ...x, counterparty_name: e.target.value }))}
                placeholder={t('Company or person on the other side')}
              />
            </div>
            {AG_ENUMS.map(([k, field]) => (
              <Select
                key={k}
                label={agLabel(k)}
                value={f.enums[k]}
                placeholder={k === 'agreement_type' || k === 'direction' ? undefined : t('Not stated|draft')}
                options={enumOptions(field).map(([value, label]) => ({ value, label }))}
                disabled={!editable}
                onChange={(e) => setEnum(k, e.target.value)}
              />
            ))}
            {editable ? (
              <>
                <CatalogSelect kind="franchise" label={t('Franchise')} value={f.franchise_id} onChange={(id) => setF((x) => ({ ...x, franchise_id: id }))} />
                <CatalogSelect kind="work" label={t('Title')} value={f.work_id} onChange={(id) => setF((x) => ({ ...x, work_id: id }))} />
              </>
            ) : (
              <>
                <Fact label={t('Franchise')} value={f.franchise_id !== '' ? nameOf('franchise', f.franchise_id) : ''} />
                <Fact label={t('Title')} value={f.work_id !== '' ? nameOf('work', f.work_id) : ''} />
              </>
            )}
            {AG_DATES.map((k) => (
              <DateField key={k} label={agLabel(k)} value={f.dates[k]} onChange={(v) => setDate(k, v)} disabled={!editable} />
            ))}
            <div className="flex flex-col justify-end gap-2 pb-1">
              <Checkbox checked={f.perpetual} disabled={!editable} onChange={(v) => setF((x) => ({ ...x, perpetual: v }))} label={t('No end date')} />
              <Checkbox checked={f.auto_renew} disabled={!editable} onChange={(v) => setF((x) => ({ ...x, auto_renew: v }))} label={t('Renews automatically')} />
            </div>
            <Select label={t('Currency')} value={f.currency} placeholder={t('Not stated|draft')} options={currencyOptions} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, currency: e.target.value }))} />
            {AG_NUMBERS.map((k) => (
              <Input key={k} label={agLabel(k)} type="number" step="any" value={f.numbers[k]} disabled={!editable} onChange={(e) => setNumber(k, e.target.value)} />
            ))}
            <div className="sm:col-span-2">
              <Input label={t('Territory')} value={f.territory_summary} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, territory_summary: e.target.value }))} />
            </div>
            <div className="sm:col-span-2">
              <Input label={t('Copyright notice')} value={f.copyright_notice} disabled={!editable} onChange={(e) => setF((x) => ({ ...x, copyright_notice: e.target.value }))} />
            </div>
          </div>
        ) : (
          <FactGrid cols={2}>
            <Fact label={t('Agreement title')} value={f.title} />
            <Fact label={t('Counterparty')} value={f.counterparty_name} />
            {AG_ENUMS.map(([k, field]) => (
              <Fact key={k} label={agLabel(k)} value={enumLabel(field, f.enums[k])} />
            ))}
            {AG_DATES.map((k) => (
              <Fact key={k} label={agLabel(k)} value={fmtDate(f.dates[k])} />
            ))}
            <Fact label={t('Royalty rate (%)')} value={f.numbers.royalty_rate !== '' ? fmtPct(Number(f.numbers.royalty_rate)) : ''} />
            <Fact label={t('Minimum guarantee')} value={f.numbers.minimum_guarantee !== '' ? fmtMoney(Number(f.numbers.minimum_guarantee), f.currency || homeCurrency) : ''} />
          </FactGrid>
        )}
      </div>

      <div className="min-w-0">
        <PaneHeading right={live && conflicts.loading ? <span className="text-xs text-[var(--agent-app-muted)]">{t('Checking for conflicts...')}</span> : undefined}>
          {t('Rights in this agreement')}
        </PaneHeading>
        {conflicts.error !== null && <Notice tone="warn">{t('Conflicts could not be checked: {error}', { error: conflicts.error })}</Notice>}
        {grants.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No rights grants were proposed. Add them on the agreement after creating it.')}</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--agent-app-border)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-3 py-2">{t('Grant')}</th>
                  <th className="px-3 py-2">{t('Covers')}</th>
                  <th className="px-3 py-2">{t('Scope')}</th>
                  <th className="px-3 py-2">{t('Term|grant')}</th>
                  {live && <th className="px-3 py-2">{t('Conflicts')}</th>}
                </tr>
              </thead>
              <tbody>
                {grants.map((g, i) => {
                  const covers = [
                    ...strArr(g['franchises']).map((id) => nameOf('franchise', id) || id),
                    ...strArr(g['works']).map((id) => nameOf('work', id) || id),
                    ...strArr(g['characters']).map((id) => nameOf('character', id) || id),
                  ];
                  const songs = strArr(g['songs']).length;
                  const recs = strArr(g['recordings']).length;
                  const marks = strArr(g['matters']).length;
                  if (songs > 0) covers.push(tn(songs, '{n} song', '{n} songs'));
                  if (recs > 0) covers.push(tn(recs, '{n} recording', '{n} recordings'));
                  if (marks > 0) covers.push(tn(marks, '{n} trademark', '{n} trademarks'));
                  const dims = asRecord(g['dims']) ?? {};
                  const ts = d10(str(g['term_start']));
                  const te = d10(str(g['term_end']));
                  const mine = list.filter((c) => c.grant_index === i);
                  return (
                    <tr key={i} className="border-b border-[var(--agent-app-border)]/60 align-top last:border-0">
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Tag>{enumLabel('grants.direction', str(g['direction']))}</Tag>
                          <Tag>{enumLabel('grants.kind', str(g['kind']) || 'grant')}</Tag>
                          <Tag>{g['exclusive'] === true ? t('Exclusive') : t('Non-exclusive')}</Tag>
                        </div>
                        {str(g['rights_text']) !== '' && <p className="mt-1 min-w-[10rem] break-words text-xs text-[var(--agent-app-muted)]">{str(g['rights_text'])}</p>}
                      </td>
                      <td className="min-w-[9rem] break-words px-3 py-2">{covers.length > 0 ? covers.join(', ') : <span className="text-[var(--agent-app-muted)]">{t('Not stated|draft')}</span>}</td>
                      <td className="min-w-[10rem] px-3 py-2 text-xs">
                        {Object.keys(dims).length === 0 ? (
                          <span className="text-[var(--agent-app-muted)]">{t('Everything')}</span>
                        ) : (
                          Object.entries(dims).map(([dim, spec]) => {
                            const sp = asRecord(spec);
                            return (
                              <div key={dim} className="break-words">
                                <span className="text-[var(--agent-app-muted)]">{dimensionName(dim)}: </span>
                                {dimSpecLabel(
                                  dimValues.filter((v) => v.dimension === dim),
                                  { include: strArr(sp?.['include']), exclude: strArr(sp?.['exclude']) },
                                )}
                              </div>
                            );
                          })
                        )}
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-xs tabular-nums">
                        {ts !== '' || te !== '' ? `${ts !== '' ? fmtDate(ts) : t('Start of term')} ~ ${te !== '' ? fmtDate(te) : t('No end date')}` : t('Agreement term')}
                      </td>
                      {live && (
                        <td className="min-w-[12rem] px-3 py-2 text-xs">
                          {conflicts.data === null ? (
                            ''
                          ) : mine.length === 0 ? (
                            <Pill tone="good">{t('No conflict')}</Pill>
                          ) : (
                            <div className="flex flex-col gap-1">
                              {mine.slice(0, 5).map((c, k) => (
                                <div key={k} className="break-words">
                                  <Pill tone={c.status === 'partial' ? 'warn' : 'bad'}>{c.status === 'partial' ? t('Partly taken') : t('Taken')}</Pill>{' '}
                                  <span className="font-medium">{c.asset}</span> · {isJa() ? c.value_ja || c.value : c.value}
                                  {c.reasons[0] !== undefined && <span className="text-[var(--agent-app-muted)]">: {bi(c.reasons[0].text)}</span>}
                                </div>
                              ))}
                              {mine.length > 5 && <span className="text-[var(--agent-app-muted)]">{t('and {n} more', { n: mine.length - 5 })}</span>}
                            </div>
                          )}
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        {live && list.length > 0 && (
          <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('Accepting keeps the conflicting grants with a note that they were accepted from the Inbox. Check them on the agreement afterwards.')}</p>
        )}
      </div>

      <CitationList citations={item.citations ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Royalty statement                                                   */
/* ------------------------------------------------------------------ */

interface PricedLine {
  product_id?: string | undefined;
  description?: string | undefined;
  territory?: string | undefined;
  manufactured_qty?: number | string | undefined;
  sold_qty?: number | string | undefined;
  retail_price?: number | string | undefined;
  wholesale_price?: number | string | undefined;
  royalty?: number | string | undefined;
  currency?: string | undefined;
  notes?: string | undefined;
  computed_royalty: number;
  computed_rate: number;
  explain: string;
  differs: boolean;
}

interface RoyaltyPreview {
  kind: string;
  agreement: { id: string; ref: string; basis: string } | null;
  lines: PricedLine[];
}

function RoyaltyStatementBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const { homeCurrency } = useApp();
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const proposal = useMemo(() => asRecord(item.proposal) ?? {}, [item.proposal]);
  const [agreementId, setAgreementId] = useState('');
  // A licence the reviewer picks prices the lines in the preview too.
  const preview = useLiveAsync(
    () => op<RoyaltyPreview>('inbox/preview', { id: item.id, ...(agreementId !== '' ? { agreement_id: agreementId } : {}) }),
    [item.id, agreementId],
    ['agreements'],
  );
  const [periodEnd, setPeriodEnd] = useState(d10(str(proposal['period_end'])));
  const lines = preview.data?.lines ?? [];
  const agreement = preview.data?.agreement ?? null;
  const currency = str(proposal['currency']) || homeCurrency;

  const productIds = useMemo(() => [...new Set(lines.map((l) => str(l.product_id)).filter((x) => x !== ''))], [lines]);
  const products = useLiveAsync(
    async () => {
      if (productIds.length === 0) return {} as Record<string, string>;
      const rows = await listAll<RecordModel>('products', { filter: productIds.map((id) => `id = ${q(id)}`).join(' || ') });
      const out: Record<string, string> = {};
      for (const r of rows) out[r.id] = recordLabel('product', r);
      return out;
    },
    [productIds.join(',')],
    ['products'],
  );

  useEffect(() => {
    if (!live) return;
    let blocker = '';
    if (preview.data === null) blocker = preview.error !== null ? t('The statement could not be priced: {error}', { error: preview.error }) : t('Pricing the lines...');
    else if (agreement === null && agreementId === '') blocker = t('Choose the agreement this statement belongs to.');
    else if (d10(periodEnd) === '') blocker = t('Enter the last day of the period.');
    onPlan({
      payload: { ...(agreementId !== '' ? { agreement_id: agreementId } : {}), ...(d10(periodEnd) !== '' ? { period_end: d10(periodEnd) } : {}) },
      creates: 0,
      statutory: false,
      blocker,
      acceptLabel: t('Record the statement'),
    });
  }, [preview.data, preview.error, agreement, agreementId, periodEnd, live, onPlan]);

  const reportedTotal = lines.reduce((a, l) => a + (num(l.royalty) ?? 0), 0);
  const computedTotal = lines.reduce((a, l) => a + l.computed_royalty, 0);
  const hasReported = lines.some((l) => num(l.royalty) !== null);
  const differing = lines.filter((l) => l.differs).length;
  const perUnit = agreement !== null && (agreement.basis === 'per_unit' || agreement.basis === 'per_seal');

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />
      <DocumentLink item={item} />

      <div className="min-w-0">
        <PaneHeading>{t('Statement')}</PaneHeading>
        <div className="grid min-w-0 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <div className="mb-1.5 text-[13px] font-medium">{t('Agreement')}</div>
            {agreement !== null && agreementId === '' ? (
              <a href={href('agreement', agreement.id)} className="inline-flex min-w-0 items-center gap-2 text-[13px] hover:underline">
                <Ref>{agreement.ref || agreement.id}</Ref>
                {agreement.basis !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{enumLabel('agreements.royalty_basis', agreement.basis)}</span>}
              </a>
            ) : editable ? (
              <RecordPicker<AgreementRec>
                collection="agreements"
                value={agreementId}
                onChange={(id) => setAgreementId(id)}
                labelOf={(a) => `${a.ref} ${a.title}`.trim()}
                searchFields={['ref', 'title']}
                placeholder={t('Search by name or reference')}
              />
            ) : (
              <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No agreement matched.')}</p>
            )}
          </div>
          {live && editable ? (
            <DateField label={t('Period ends')} value={periodEnd} onChange={setPeriodEnd} required />
          ) : (
            <Fact label={t('Period ends')} value={fmtDate(periodEnd)} />
          )}
          <Fact label={t('Period starts')} value={fmtDate(str(proposal['period_start']))} />
          <Fact label={t('Currency')} value={currency} />
        </div>
      </div>

      <div className="min-w-0">
        <PaneHeading right={differing > 0 ? <Pill tone="warn">{tn(differing, '{n} line differs from the licensee', '{n} lines differ from the licensee')}</Pill> : undefined}>
          {t('Lines')}
        </PaneHeading>
        {preview.data === null ? (
          preview.error !== null ? (
            <Notice tone="warn">{preview.error}</Notice>
          ) : (
            <Loading />
          )
        ) : lines.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('The statement has no lines.')}</p>
        ) : (
          <div className="overflow-x-auto border border-[var(--agent-app-border)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-3 py-2 text-left">{t('Product')}</th>
                  <th className="px-3 py-2 text-left">{t('Territory')}</th>
                  <th className="px-3 py-2 text-right">{t('Manufactured')}</th>
                  <th className="px-3 py-2 text-right">{t('Sold')}</th>
                  <th className="px-3 py-2 text-right">{t('Retail price')}</th>
                  <th className="px-3 py-2 text-right">{t('Reported by the licensee')}</th>
                  <th className="px-3 py-2 text-right">{t('Royalty')}</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l, i) => {
                  const cur = str(l.currency) || currency;
                  const reported = num(l.royalty);
                  const name = str(l.product_id) !== '' ? (products.data?.[str(l.product_id)] ?? '') : '';
                  return (
                    <tr key={i} className="border-b border-[var(--agent-app-border)]/60 align-top last:border-0">
                      <td className="min-w-[10rem] px-3 py-2">
                        <div className="break-words font-medium">{name || str(l.description) || t('Unmatched line')}</div>
                        {name !== '' && str(l.description) !== '' && <div className="break-words text-xs text-[var(--agent-app-muted)]">{str(l.description)}</div>}
                        {str(l.product_id) === '' && <div className={cn('text-xs', TONE_TEXT.warn)}>{t('No product matched')}</div>}
                        {l.differs && (
                          <div className={cn('mt-1 break-words text-xs', TONE_TEXT.warn)}>
                            {t('Licensee reported {reported}; the agreement gives {computed}.', { reported: fmtMoney(reported ?? 0, cur), computed: fmtMoney(l.computed_royalty, cur) })}
                            {l.explain !== '' && <span className="text-[var(--agent-app-muted)]"> ({l.explain})</span>}
                          </div>
                        )}
                        {str(l.notes) !== '' && <div className="mt-0.5 break-words text-xs text-[var(--agent-app-muted)]">{str(l.notes)}</div>}
                      </td>
                      <td className="px-3 py-2">{str(l.territory) !== '' ? <JurChip code={str(l.territory)} /> : ''}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNumber(num(l.manufactured_qty))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtNumber(num(l.sold_qty))}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMoney(num(l.retail_price), cur)}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--agent-app-muted)]">{reported !== null ? fmtMoney(reported, cur) : ''}</td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">
                        {fmtMoney(l.computed_royalty, cur)}
                        {l.computed_rate > 0 && !perUnit && <div className="text-[11px] font-normal text-[var(--agent-app-muted)]">{fmtPct(l.computed_rate)}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/15 font-semibold">
                  <td className="px-3 py-2" colSpan={5}>
                    {t('Total')}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums text-[var(--agent-app-muted)]">{hasReported ? fmtMoney(reportedTotal, currency) : ''}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">{fmtMoney(computedTotal, currency)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('Royalties are priced by the app from the agreement. What the licensee reported is kept as a note on each line.')}</p>
      </div>

      <CitationList citations={item.citations ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Permission                                                          */
/* ------------------------------------------------------------------ */

interface PermissionPreview {
  kind: string;
  existing: { id: string; title: string } | null;
  diffs: { field: string; current: string; incoming: string }[];
}

function permFieldLabel(field: string): string {
  switch (field) {
    case 'title':
      return t('Name');
    case 'permission_type':
      return t('Type');
    case 'subject_name':
      return t('Covers');
    case 'source':
      return t('Basis');
    case 'guideline_url':
      return t('Guideline address');
    case 'guideline_revision':
      return t('Guideline revision');
    case 'platforms':
      return t('Platforms');
    case 'monetization':
      return t('Monetization');
    case 'archive':
      return t('Archive');
    case 'content_limits':
      return t('Content limits');
    case 'credit_line':
      return t('Credit line');
    case 'regions':
      return t('Regions|permission');
    case 'start_date':
      return t('Start date');
    case 'end_date':
      return t('End date|field');
    case 'status':
      return t('Status');
    case 'recheck_days':
      return t('Check again every (days)');
    case 'notes':
      return t('Notes');
    case 'all_talents':
      return t('All talents');
    case 'talents':
      return t('Talents');
    case 'characters':
      return t('Characters');
    case 'counterparty':
      return t('Rights holder');
    default:
      return humanField(field);
  }
}

const PERM_ENUMS = new Set(['permission_type', 'source', 'archive', 'status']);
const PERM_DATES = new Set(['guideline_revision', 'start_date', 'end_date']);

function permValue(field: string, raw: unknown): string {
  let v: unknown = raw;
  if (typeof v === 'string' && /^[[{]/.test(v.trim())) {
    try {
      v = JSON.parse(v);
    } catch {
      /* plain text */
    }
  }
  if (v === null || v === undefined || v === '') return '';
  if (Array.isArray(v)) return v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ');
  if (typeof v === 'boolean' || v === 'true' || v === 'false') return v === true || v === 'true' ? t('Yes') : t('No');
  if (typeof v === 'object') return JSON.stringify(v);
  const s = String(v);
  if (PERM_DATES.has(field)) return fmtDate(s) || s;
  if (PERM_ENUMS.has(field)) return enumLabel(`permissions.${field}`, s);
  return s;
}

function PermissionBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const live = mode !== 'decided';
  const preview = useLiveAsync(() => op<PermissionPreview>('inbox/preview', { id: item.id }), [item.id], ['permissions']);
  const fields = useMemo(() => asRecord(item.proposal?.['fields']) ?? {}, [item.proposal]);
  // Once decided, the record already holds the new values: show what was proposed.
  const existing = live ? (preview.data?.existing ?? null) : null;
  const rows = useMemo(() => {
    if (!live) return Object.entries(fields).map(([k, v]) => ({ field: k, current: '', incoming: permValue(k, v) }));
    if (preview.data === null) return [];
    if (existing !== null) {
      return preview.data.diffs
        .map((d) => ({ field: d.field, current: permValue(d.field, d.current), incoming: permValue(d.field, d.incoming) }))
        .filter((d) => d.current !== d.incoming);
    }
    return Object.entries(fields).map(([k, v]) => ({ field: k, current: '', incoming: permValue(k, v) }));
  }, [preview.data, existing, fields, live]);

  useEffect(() => {
    if (!live) return;
    let blocker = '';
    if (preview.data === null) blocker = preview.error !== null ? t('The change could not be previewed: {error}', { error: preview.error }) : t('Loading');
    else if (existing === null && str(fields['title']) === '') blocker = t('The permission needs a name.');
    onPlan({ payload: {}, creates: 0, statutory: false, blocker, acceptLabel: existing !== null ? t('Apply the changes') : t('Create the permission') });
  }, [preview.data, preview.error, existing, fields, live, onPlan]);

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />
      <DocumentLink item={item} />
      <div className="min-w-0">
        <PaneHeading
          right={
            existing !== null ? (
              <a href={subjectHref('permission', existing.id)} className="min-w-0 break-words text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
                {existing.title}
              </a>
            ) : undefined
          }
        >
          {!live ? t('Proposed values') : existing !== null ? t('Changes to the permission') : t('New permission')}
        </PaneHeading>
        {live && preview.data === null ? (
          preview.error !== null ? (
            <Notice tone="warn">{preview.error}</Notice>
          ) : (
            <Loading />
          )
        ) : rows.length === 0 ? (
          <Notice>{t('No change: the guideline still says what the record says.')}</Notice>
        ) : (
          <div className="overflow-x-auto border border-[var(--agent-app-border)]">
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                  <th className="px-3 py-2">{t('Field')}</th>
                  {existing !== null && <th className="px-3 py-2">{t('On the record')}</th>}
                  <th className="px-3 py-2">{existing !== null ? t('Proposed') : t('Value')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.field} className="border-b border-[var(--agent-app-border)]/60 align-top last:border-0">
                    <td className="whitespace-nowrap px-3 py-2 font-medium">{permFieldLabel(r.field)}</td>
                    {existing !== null && (
                      <td className="min-w-[8rem] break-words px-3 py-2 text-[var(--agent-app-muted)]">{r.current || <span className="text-[var(--agent-app-muted)]/70">{t('Empty')}</span>}</td>
                    )}
                    <td className="min-w-[8rem] break-words px-3 py-2">
                      <span className={cn(existing !== null && 'px-1 py-0.5 font-medium', existing !== null && TONE_BG.warn)}>{r.incoming}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {live && existing !== null && <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('Accepting also records today as the last check of the guideline.')}</p>}
      </div>
      <CitationList citations={item.citations ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Watch hits                                                          */
/* ------------------------------------------------------------------ */

function WatchHitBody({ item, mode, onPlan }: BodyProps): React.JSX.Element {
  const { nameOf } = useApp();
  const editable = mode === 'edit';
  const live = mode !== 'decided';
  const preview = useLiveAsync(async () => (await op<{ hits: unknown[] }>('inbox/preview', { id: item.id })).hits ?? [], [item.id], []);
  const hits = useMemo(() => (preview.data ?? asArray(item.proposal?.['hits'])).map((h) => asRecord(h) ?? {}), [preview.data, item.proposal]);
  const [chosen, setChosen] = useState<Set<number> | null>(null);
  const picked = chosen ?? new Set(hits.map((_, i) => i));

  useEffect(() => {
    if (!live) return;
    const list = [...picked].sort((a, b) => a - b);
    let blocker = '';
    if (hits.length === 0) blocker = t('There are no hits to accept. Reject the item.');
    else if (list.length === 0) blocker = t('Tick the hits to keep, or reject the item.');
    onPlan({ payload: { hits: list }, creates: 0, statutory: false, blocker, acceptLabel: tn(list.length, 'Accept {n} hit', 'Accept {n} hits') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen, hits, live, onPlan]);

  const toggle = (i: number, v: boolean): void => setChosen(toggled(picked, i, v));

  return (
    <div className="flex min-w-0 flex-col gap-6 p-4">
      <SummaryBlock item={item} />
      <div className="min-w-0">
        <PaneHeading
          right={
            editable && hits.length > 1 ? (
              <Checkbox
                checked={picked.size === hits.length}
                indeterminate={picked.size > 0 && picked.size < hits.length}
                onChange={(v) => setChosen(v ? new Set(hits.map((_, i) => i)) : new Set())}
                label={<span className="text-xs text-[var(--agent-app-muted)]">{t('All hits')}</span>}
              />
            ) : undefined
          }
        >
          {tn(hits.length, '{n} hit', '{n} hits')}
        </PaneHeading>
        {hits.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No hits were proposed.')}</p>
        ) : (
          <div className="border border-[var(--agent-app-border)]">
            {hits.map((h, i) => {
              const title = str(h['their_mark']) || str(h['title']) || t('Listing');
              const seller = str(h['their_owner']) || str(h['seller']);
              const url = str(h['url']);
              const score = num(h['score']);
              const character = str(h['character_id']) !== '' ? nameOf('character', str(h['character_id'])) : '';
              const talent = str(h['talent_id']) !== '' ? nameOf('talent', str(h['talent_id'])) : '';
              return (
                <div key={i} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                  <div className="flex min-w-0 items-start gap-2.5">
                    {live && (
                      <div className="pt-0.5">
                        <Checkbox checked={picked.has(i)} disabled={!editable} onChange={(v) => toggle(i, v)} ariaLabel={t('Keep {name}', { name: title })} />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="min-w-0 break-words text-[13px] font-medium">{title}</span>
                        {str(h['kind']) !== '' && <Tag>{enumLabel('watch_hits.kind', str(h['kind']))}</Tag>}
                        {str(h['jurisdiction']) !== '' && <JurChip code={str(h['jurisdiction'])} />}
                        {score !== null && <Pill tone={score >= 70 ? 'bad' : score >= 40 ? 'warn' : 'neutral'}>{t('Score {n}', { n: Math.round(score) })}</Pill>}
                      </div>
                      <div className="mt-0.5 flex min-w-0 flex-wrap gap-x-3 text-xs text-[var(--agent-app-muted)]">
                        {seller !== '' && <span className="min-w-0 break-words">{t('Seller: {name}', { name: seller })}</span>}
                        {character !== '' && <span>{t('Character: {name}', { name: character })}</span>}
                        {talent !== '' && <span>{t('Talent: {name}', { name: talent })}</span>}
                      </div>
                      {(str(h['goods']) || str(h['description'])) !== '' && <p className="mt-1 break-words text-xs">{str(h['goods']) || str(h['description'])}</p>}
                      {str(h['notes']) !== '' && <p className="mt-1 break-words text-xs text-[var(--agent-app-muted)]">{str(h['notes'])}</p>}
                      {url !== '' && (
                        <a href={url} target="_blank" rel="noreferrer noopener" className="mt-1 inline-flex max-w-full items-center gap-1 break-all text-xs text-[var(--agent-app-accent)] hover:underline">
                          <ExternalLink size={11} className="shrink-0" aria-hidden /> {url}
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        {live && <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{t('Accepted hits go to the watch list under Enforcement for follow-up. Nothing is reported to any platform.')}</p>}
      </div>
      <CitationList citations={item.citations ?? []} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* How items arrive (empty detail pane)                                */
/* ------------------------------------------------------------------ */

export function HowItemsArrive(): React.JSX.Element {
  const rows: { title: string; text: string; badge?: ReactNode }[] = [
    { title: t('Office sync'), text: t('A connected trademark office reports a new status, date or event on one of your marks.') },
    { title: t('Documents read by CraftBot'), text: t('Someone uploads an office letter or platform notice; CraftBot proposes the event, the deadlines and where it read each value.'), badge: <CraftBotBadge /> },
    { title: t('Contracts and statements'), text: t('CraftBot reads a contract or a licensee sales report and proposes the agreement or the statement lines.'), badge: <CraftBotBadge /> },
    { title: t('Guidelines and marketplace scans'), text: t('CraftBot re-reads a publisher guideline or scans marketplaces and proposes the changes or the suspect listings.'), badge: <CraftBotBadge /> },
  ];
  return (
    <div className="p-5">
      <h2 className="text-[13px] font-semibold">{t('How items arrive here')}</h2>
      <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">{t('Automation proposes, people decide. Accepting applies an item; rejecting leaves everything as it is.')}</p>
      <div className="mt-4 flex flex-col border border-[var(--agent-app-border)]">
        {rows.map((r) => (
          <div key={r.title} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
              {r.title}
              {r.badge}
            </div>
            <div className="mt-0.5 text-xs leading-relaxed text-[var(--agent-app-muted)]">{r.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
