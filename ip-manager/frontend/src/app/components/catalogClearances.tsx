/**
 * Clearance and chain of title for one work: items grouped by status with
 * a progress bar, add and edit dialogs, and a standard checklist per work
 * type (films get title and music clearances, games an open-source review,
 * and so on). Only items that are missing are added.
 */
import { useMemo, useState } from 'react';
import { ClipboardCheck, FileText, ListChecks, Plus, Trash2 } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, toPb, today } from '../lib/format.ts';
import { CLEARANCE_STATUS_LABEL, CLEARANCE_STATUS_TONE, CLEARANCE_TYPE_LABEL, DOC_TYPE_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import type { ClearanceRec, DocumentRec, WorkRec, WorkType } from '../lib/types.ts';
import { RecordPicker, UserSelect } from './pickers.tsx';
import { DateField } from './catalogShared.tsx';
import { EmptyHint, ErrorBox, Field, GroupHeader, IdentityChip, Loading, Pill, Section, TONE_BAR, TONE_TEXT, Tag } from './ui.tsx';

type ClearanceStatus = ClearanceRec['status'];

const FILM: WorkType[] = ['feature_film', 'series', 'season', 'episode', 'short'];
const GAME: WorkType[] = ['game', 'software'];
const BOOK: WorkType[] = ['book', 'comic', 'script'];
const MUSIC: WorkType[] = ['music_composition', 'sound_recording', 'album'];
const ART: WorkType[] = ['character', 'logo', 'artwork'];

/** Standard clearance items for a work type, in working order. */
export function standardItems(type: WorkType): string[] {
  if (FILM.includes(type)) {
    return [
      'title_report',
      'copyright_report',
      'script_clearance',
      'music_sync',
      'music_master',
      'talent_release',
      'location_release',
      'footage_license',
      'eo_insurance',
      'chain_of_title',
    ];
  }
  if (GAME.includes(type)) return ['chain_of_title', 'open_source_review', 'music_sync', 'trademark_search'];
  if (BOOK.includes(type)) return ['chain_of_title', 'copyright_report', 'artwork_clearance'];
  if (MUSIC.includes(type)) return ['chain_of_title', 'music_master', 'music_sync'];
  if (ART.includes(type)) return ['trademark_search', 'chain_of_title', 'artwork_clearance'];
  return ['chain_of_title'];
}

const GROUP_ORDER: ClearanceStatus[] = ['not_cleared', 'in_progress', 'requested', 'not_started', 'cleared_with_risk', 'cleared', 'not_applicable'];

const STATUS_OPTIONS = GROUP_ORDER.map((s) => ({ value: s, label: CLEARANCE_STATUS_LABEL[s] ?? s }));
const TYPE_OPTIONS = Object.entries(CLEARANCE_TYPE_LABEL).map(([value, label]) => ({ value, label }));

function isCleared(s: ClearanceStatus): boolean {
  return s === 'cleared' || s === 'cleared_with_risk';
}

/** Expiry within 60 days (or passed) on an item that is otherwise cleared. */
function expiryTone(c: ClearanceRec): Tone | null {
  const e = d10(c.expires);
  if (e === '' || c.status === 'not_applicable') return null;
  const n = daysUntil(e);
  if (n < 0) return 'bad';
  if (n <= 60) return 'warn';
  return null;
}

export function clearanceSummary(items: ClearanceRec[]): { total: number; cleared: number; risk: number; blocked: number } {
  const relevant = items.filter((c) => c.status !== 'not_applicable');
  return {
    total: relevant.length,
    cleared: relevant.filter((c) => isCleared(c.status)).length,
    risk: relevant.filter((c) => c.status === 'cleared_with_risk').length,
    blocked: relevant.filter((c) => c.status === 'not_cleared').length,
  };
}

export function ClearanceList({ work }: { work: WorkRec }): React.JSX.Element {
  const { can, userName, vocab } = useApp();
  const col = useCollection<ClearanceRec>('clearances', { filter: `work = ${q(work.id)}`, sort: 'created', expand: 'document' });
  const [editing, setEditing] = useState<ClearanceRec | 'new' | null>(null);
  const [adding, setAdding] = useState(false);

  const items = col.records;
  const sum = clearanceSummary(items);
  const expiring = items.filter((c) => expiryTone(c) !== null).length;

  const missing = useMemo(() => {
    const have = new Set(items.map((c) => c.item_type));
    return standardItems(work.work_type).filter((t) => !have.has(t));
  }, [items, work.work_type]);

  const groups = useMemo(() => {
    const byDue = (a: ClearanceRec, b: ClearanceRec): number => {
      const da = d10(a.due_date);
      const db = d10(b.due_date);
      if (da === db) return 0;
      if (da === '') return 1;
      if (db === '') return -1;
      return da.localeCompare(db);
    };
    return GROUP_ORDER.map((s) => ({ status: s, items: items.filter((c) => c.status === s).sort(byDue) })).filter((g) => g.items.length > 0);
  }, [items]);

  const addChecklist = async (): Promise<void> => {
    if (missing.length === 0) return;
    setAdding(true);
    let made = 0;
    try {
      for (const t of missing) {
        await createRecord<ClearanceRec>('clearances', {
          work: work.id,
          property: work.property,
          item_type: t,
          title: CLEARANCE_TYPE_LABEL[t] ?? t,
          status: 'not_started',
        });
        made += 1;
      }
      toast.success(`Added ${made} checklist item${made === 1 ? '' : 's'}`);
    } catch {
      if (made > 0) toast.info(`Added ${made} of ${missing.length} items`);
    } finally {
      setAdding(false);
    }
  };

  const pct = (n: number): string => `${sum.total > 0 ? (n / sum.total) * 100 : 0}%`;

  return (
    <Section
      title="Clearance and chain of title"
      meta={sum.total > 0 ? `${sum.cleared} of ${sum.total} cleared` : undefined}
      flush
      actions={
        can.edit ? (
          <>
            {missing.length > 0 && items.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => void addChecklist()} loading={adding} title={`Adds: ${missing.map((t) => CLEARANCE_TYPE_LABEL[t] ?? t).join(', ')}`}>
                <ListChecks size={13} aria-hidden /> Add standard checklist
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> Add item
            </Button>
          </>
        ) : undefined
      }
    >
      {col.loading && items.length === 0 ? (
        <Loading />
      ) : col.error !== null && items.length === 0 ? (
        <div className="p-4">
          <ErrorBox message={col.error} onRetry={col.refresh} />
        </div>
      ) : items.length === 0 ? (
        <EmptyHint
          compact
          icon={ClipboardCheck}
          title="No clearance items yet"
          message={`Track the reports, releases, licences and chain-of-title documents this ${vocab.work.toLowerCase()} needs before release. The standard checklist for this type adds ${missing.length} item${missing.length === 1 ? '' : 's'}.`}
          action={
            can.edit ? (
              <Button size="sm" onClick={() => void addChecklist()} loading={adding}>
                <ListChecks size={13} aria-hidden /> Add standard checklist
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <div className="border-b border-[var(--agent-app-border)] px-4 py-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span>
                <b className="tabular-nums">{sum.cleared}</b> of <span className="tabular-nums">{sum.total}</span> cleared
                {sum.risk > 0 && <span className={TONE_TEXT.warn}>, {sum.risk} with risk</span>}
                {sum.blocked > 0 && <span className={TONE_TEXT.bad}>, {sum.blocked} not cleared</span>}
              </span>
              {expiring > 0 && <span className={cn('text-xs', TONE_TEXT.warn)}>{expiring} expiring within 60 days or expired</span>}
            </div>
            <div className="mt-2 flex h-1.5 w-full overflow-hidden bg-[var(--agent-app-border)]/50" role="progressbar" aria-valuemin={0} aria-valuemax={sum.total} aria-valuenow={sum.cleared} aria-label="Clearance progress">
              <span className={TONE_BAR.good} style={{ width: pct(sum.cleared - sum.risk) }} />
              <span className={TONE_BAR.warn} style={{ width: pct(sum.risk) }} />
              <span className={TONE_BAR.bad} style={{ width: pct(sum.blocked) }} />
            </div>
          </div>
          {groups.map((g) => (
            <div key={g.status}>
              <GroupHeader label={CLEARANCE_STATUS_LABEL[g.status] ?? g.status} count={g.items.length} tone={g.status === 'not_cleared' ? 'bad' : g.status === 'cleared_with_risk' ? 'warn' : undefined} />
              {g.items.map((c) => (
                <ClearanceRow key={c.id} c={c} onEdit={can.edit ? () => setEditing(c) : undefined} userName={userName} />
              ))}
            </div>
          ))}
        </>
      )}
      {editing !== null && <ClearanceDialog work={work} item={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </Section>
  );
}

function ClearanceRow({ c, onEdit, userName }: { c: ClearanceRec; onEdit: (() => void) | undefined; userName: (id: string) => string }): React.JSX.Element {
  const doc = c.expand?.['document'] as DocumentRec | undefined;
  const exp = expiryTone(c);
  const due = d10(c.due_date);
  const overdue = due !== '' && !isCleared(c.status) && c.status !== 'not_applicable' && daysUntil(due) < 0;
  const person = userName(c.responsible);
  return (
    <div
      className={cn('border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0', onEdit !== undefined && 'cursor-pointer hover:bg-[var(--agent-app-border)]/20')}
      onClick={onEdit}
      role={onEdit !== undefined ? 'button' : undefined}
      tabIndex={onEdit !== undefined ? 0 : undefined}
      onKeyDown={
        onEdit !== undefined
          ? (e) => {
              if (e.key === 'Enter') onEdit();
            }
          : undefined
      }
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {c.title.trim().toLowerCase() !== (CLEARANCE_TYPE_LABEL[c.item_type] ?? c.item_type).toLowerCase() && <Tag>{CLEARANCE_TYPE_LABEL[c.item_type] ?? c.item_type}</Tag>}
        <span className="min-w-0 text-sm font-medium">{c.title}</span>
        <Pill tone={CLEARANCE_STATUS_TONE[c.status] ?? 'neutral'}>{CLEARANCE_STATUS_LABEL[c.status] ?? c.status}</Pill>
        {person !== '' && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-[var(--agent-app-muted)]">
            <IdentityChip name={person} size="xs" title={`Responsible: ${person}`} />
            <span className="hidden sm:inline">{person}</span>
          </span>
        )}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs tabular-nums text-[var(--agent-app-muted)]">
        {c.provider !== '' && <span>{c.provider}</span>}
        {due !== '' && <span className={cn(overdue && TONE_TEXT.bad, overdue && 'font-medium')}>Due {fmtDate(due)}{overdue ? ' (overdue)' : ''}</span>}
        {d10(c.cleared_date) !== '' && <span>Cleared {fmtDate(c.cleared_date)}</span>}
        {d10(c.expires) !== '' && (
          <span className={cn(exp !== null && TONE_TEXT[exp], exp !== null && 'font-medium')}>
            {exp === 'bad' ? 'Expired' : 'Expires'} {fmtDate(c.expires)}
          </span>
        )}
        {doc !== undefined && (
          <a
            href={fileUrl(doc, doc.file)}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 text-[var(--agent-app-accent)] hover:underline"
          >
            <FileText size={12} aria-hidden /> {doc.title}
          </a>
        )}
      </div>
      {c.notes !== '' && <p className="mt-1 line-clamp-2 text-xs text-[var(--agent-app-text)]/80">{c.notes}</p>}
    </div>
  );
}

function ClearanceDialog({ work, item, onClose }: { work: WorkRec; item: ClearanceRec | null; onClose: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [confirmEl, confirm] = useConfirm();
  const [type, setType] = useState(item?.item_type ?? 'chain_of_title');
  const [title, setTitle] = useState(item?.title ?? CLEARANCE_TYPE_LABEL['chain_of_title'] ?? '');
  const [status, setStatus] = useState<ClearanceStatus>(item?.status ?? 'not_started');
  const [provider, setProvider] = useState(item?.provider ?? '');
  const [due, setDue] = useState(d10(item?.due_date));
  const [cleared, setCleared] = useState(d10(item?.cleared_date));
  const [expires, setExpires] = useState(d10(item?.expires));
  const [responsible, setResponsible] = useState(item?.responsible ?? '');
  const [documentId, setDocumentId] = useState(item?.document ?? '');
  const [notes, setNotes] = useState(item?.notes ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const changeType = (t: string): void => {
    const prevLabel = CLEARANCE_TYPE_LABEL[type] ?? '';
    setType(t);
    if (title.trim() === '' || title === prevLabel) setTitle(CLEARANCE_TYPE_LABEL[t] ?? '');
  };

  const changeStatus = (s: ClearanceStatus): void => {
    setStatus(s);
    if (isCleared(s) && cleared === '') setCleared(today());
  };

  const save = async (): Promise<void> => {
    if (title.trim() === '') {
      setError('Give the item a title.');
      return;
    }
    setBusy(true);
    const body = {
      work: work.id,
      property: work.property,
      item_type: type,
      title: title.trim(),
      status,
      provider: provider.trim(),
      due_date: toPb(due),
      cleared_date: toPb(cleared),
      expires: toPb(expires),
      responsible,
      document: documentId,
      notes: notes.trim(),
    };
    try {
      if (item === null) await createRecord<ClearanceRec>('clearances', body);
      else await updateRecord<ClearanceRec>('clearances', item.id, body);
      toast.success(item === null ? 'Item added' : 'Saved');
      onClose();
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (item === null) return;
    if (!(await confirm(`Delete "${item.title}" from the clearance list?`, 'Delete clearance item'))) return;
    try {
      await deleteRecord('clearances', item.id);
      toast.success('Deleted');
      onClose();
    } catch {
      /* the client already showed the error */
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={item === null ? 'Add clearance item' : 'Edit clearance item'}
      className="w-[min(94vw,40rem)]"
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <span>
            {item !== null && can.manage && (
              <Button variant="ghost" className="text-red-600" onClick={() => void remove()}>
                <Trash2 size={14} aria-hidden /> Delete
              </Button>
            )}
          </span>
          <span className="flex gap-2">
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void save()} loading={busy}>
              {item === null ? 'Add item' : 'Save'}
            </Button>
          </span>
        </div>
      }
    >
      {confirmEl}
      <div className="flex max-h-[64vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Item" value={type} options={TYPE_OPTIONS} onChange={(e) => changeType(e.target.value)} />
          <Select label="Status" value={status} options={STATUS_OPTIONS} onChange={(e) => changeStatus(e.target.value as ClearanceStatus)} />
        </div>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} error={error !== '' ? error : undefined} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Provider or counterparty" value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="For example the research house or insurer" />
          <UserSelect label="Responsible" value={responsible} onChange={setResponsible} />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <DateField label="Due" value={due} onChange={setDue} />
          <DateField label="Cleared on" value={cleared} onChange={setCleared} />
          <DateField label="Expires" value={expires} onChange={setExpires} help="Licences and insurance that lapse are flagged 60 days ahead." />
        </div>
        <RecordPicker<DocumentRec>
          collection="documents"
          label="Supporting document"
          value={documentId}
          onChange={(id) => setDocumentId(id)}
          labelOf={(d) => `${d.title}${d.doc_type !== '' ? ` (${DOC_TYPE_LABEL[d.doc_type]})` : ''}`}
          searchFields={['title']}
          filter={`work = ${q(work.id)}`}
          placeholder="Search this work's documents"
        />
        <p className="-mt-2 text-xs text-[var(--agent-app-muted)]">Upload the report, release or licence in the Documents tab first, then link it here.</p>
        <Field label="Notes">
          <Textarea rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} aria-label="Notes" />
        </Field>
      </div>
    </Dialog>
  );
}
