/**
 * Licensed product approvals: the product card, the drawer where a
 * reviewer sees every image and round and decides, and the dialog that
 * logs a new product a licensee submitted.
 */
import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Package, Trash2, Upload, X } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, cn, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, getRecord, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, daysUntil, fmtDate, fmtShort, relLabel, toPb } from '../lib/format.ts';
import { APPROVAL_STAGE_LABEL, APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { AgreementRec, ApprovalRec, ApprovalRoundRec, ApprovalStage, ApprovalStatus, PartyRec } from '../lib/types.ts';
import { RecordPicker } from './pickers.tsx';
import { Checkbox, Fact, FactGrid, Field, Notice, Pill, Prose, Ref, TONE_TEXT } from './ui.tsx';
import { DateField, newest } from './dealsShared.tsx';

export const STAGES: ApprovalStage[] = ['concept', 'pre_production', 'production_sample', 'packaging', 'final'];
const STAGE_OPTIONS = STAGES.map((s) => ({ value: s, label: APPROVAL_STAGE_LABEL[s] }));

/** Merchandise deals and anything licensed out can carry product approvals. */
export const APPROVAL_AGREEMENT_FILTER = 'agreement_type = "merchandise" || direction = "out"';
export const AGREEMENT_SEARCH = ['ref', 'title'];
export const PARTY_SEARCH = ['name', 'organization'];
export const agreementLabel = (a: AgreementRec): string => `${a.ref} ${a.title}`.trim();
export const partyLabel = (p: PartyRec): string => p.name;

/** Waiting on us: submitted or in review. */
export function awaitingDecision(status: ApprovalStatus): boolean {
  return status === 'submitted' || status === 'in_review';
}

export function DueLabel({ a, className }: { a: Pick<ApprovalRec, 'due_date' | 'status'>; className?: string | undefined }): React.JSX.Element | null {
  const due = d10(a.due_date);
  if (due === '') return null;
  const late = awaitingDecision(a.status) && daysUntil(due) < 0;
  const soon = awaitingDecision(a.status) && !late && daysUntil(due) <= 3;
  return (
    <span className={cn('whitespace-nowrap text-xs tabular-nums', late ? TONE_TEXT.bad : soon ? TONE_TEXT.warn : 'text-[var(--agent-app-muted)]', className)} title={fmtDate(due)}>
      Due {fmtShort(due)}
      {awaitingDecision(a.status) ? ` · ${relLabel(due)}` : ''}
    </span>
  );
}

export function Thumb({ a, size = 'md' }: { a: ApprovalRec; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  const first = a.images[0];
  const box = size === 'sm' ? 'size-9' : 'size-12';
  if (first === undefined) {
    return (
      <span className={cn('flex shrink-0 items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/25 text-[var(--agent-app-muted)]', box)} aria-hidden>
        <Package size={size === 'sm' ? 14 : 18} />
      </span>
    );
  }
  return <img src={fileUrl(a, first, '100x100')} alt="" loading="lazy" className={cn('shrink-0 border border-[var(--agent-app-border)] object-cover', box)} />;
}

/* ------------------------------------------------------------------ */
/* Board card                                                          */
/* ------------------------------------------------------------------ */

export function ApprovalCard({ a, licensee, onOpen }: { a: ApprovalRec; licensee: string; onOpen: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex w-full items-start gap-3 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 text-left transition-colors hover:border-[var(--agent-app-accent)]/50"
    >
      <Thumb a={a} />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px] font-medium">{a.product_name}</div>
        {licensee !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{licensee}</div>}
        {a.sku !== '' && <Ref className="block truncate text-[11px]">{a.sku}</Ref>}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <Pill tone={APPROVAL_STATUS_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Pill>
          <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">Rev {a.revision || 1}</span>
        </div>
        <DueLabel a={a} className="mt-1 block" />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* File picking                                                        */
/* ------------------------------------------------------------------ */

function ImagePicker({ files, onChange, label }: { files: File[]; onChange: (f: File[]) => void; label: string }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [drag, setDrag] = useState(false);
  const add = (list: FileList | null): void => {
    if (list === null) return;
    const picked = Array.from(list).filter((f) => f.type.startsWith('image/') || f.type === 'application/pdf');
    onChange([...files, ...picked].slice(0, 10));
  };
  return (
    <Field label={label} help="Images or PDFs, up to 10 per product and 20 MB each.">
      <div
        role="button"
        tabIndex={0}
        onClick={() => input.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') input.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          add(e.dataTransfer.files);
        }}
        className={cn(
          'flex items-center justify-center gap-2 border border-dashed px-3 py-4 text-[13px] text-[var(--agent-app-muted)]',
          drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]',
        )}
      >
        <ImagePlus size={16} aria-hidden /> Drop images here or click to choose
        <input
          ref={input}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => {
            add(e.target.files);
            e.target.value = '';
          }}
        />
      </div>
      {files.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {files.map((f, i) => (
            <span key={`${f.name}-${i}`} className="inline-flex max-w-full items-center gap-1 border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
              <span className="truncate">{f.name}</span>
              <button type="button" aria-label={`Remove ${f.name}`} className="text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => onChange(files.filter((_, j) => j !== i))}>
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* New product                                                         */
/* ------------------------------------------------------------------ */

export function NewProductDialog({ defaultAgreement = '', onClose, onCreated }: { defaultAgreement?: string | undefined; onClose: () => void; onCreated?: ((a: ApprovalRec) => void) | undefined }): React.JSX.Element {
  const { properties, vocab } = useApp();
  const [agreement, setAgreement] = useState(defaultAgreement);
  const [property, setProperty] = useState('');
  const [licensee, setLicensee] = useState('');
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [category, setCategory] = useState('');
  const [stage, setStage] = useState<ApprovalStage>('concept');
  const [due, setDue] = useState('');
  const [notes, setNotes] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const applyAgreement = (rec: AgreementRec | null): void => {
    if (rec === null) return;
    if (rec.property !== '') setProperty(rec.property);
    if (rec.counterparty !== '') setLicensee(rec.counterparty);
  };

  // A preselected licence fills in its property and licensee.
  useEffect(() => {
    if (defaultAgreement === '') return;
    let cancelled = false;
    getRecord<AgreementRec>('agreements', defaultAgreement)
      .then((rec) => {
        if (cancelled) return;
        if (rec.property !== '') setProperty(rec.property);
        if (rec.counterparty !== '') setLicensee(rec.counterparty);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [defaultAgreement]);

  const submit = async (): Promise<void> => {
    const errs: Record<string, string> = {};
    if (agreement === '') errs['agreement'] = 'Choose the licence this product is made under.';
    if (name.trim() === '') errs['name'] = 'Enter the product name.';
    setErrors(errs);
    const first = Object.values(errs)[0];
    if (first !== undefined) {
      toast.error(first);
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('agreement', agreement);
      fd.append('property', property);
      fd.append('licensee', licensee);
      fd.append('product_name', name.trim());
      fd.append('sku', sku.trim());
      fd.append('category', category.trim());
      fd.append('stage', stage);
      fd.append('status', 'submitted');
      fd.append('revision', '1');
      fd.append('due_date', toPb(due));
      fd.append('notes', notes.trim());
      for (const f of files) fd.append('images', f);
      const rec = await createRecord<ApprovalRec>('approvals', fd);
      toast.success(`${rec.product_name} added at ${APPROVAL_STAGE_LABEL[rec.stage]}`);
      onCreated?.(rec);
      onClose();
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
      title="New product"
      description="Log a product the licensee submitted for approval. It starts as submitted, revision 1."
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            Add product
          </Button>
        </>
      }
    >
      <div className="flex max-h-[66vh] flex-col gap-3 overflow-y-auto pr-1">
        <div className="flex flex-col gap-1">
          <RecordPicker<AgreementRec>
            collection="agreements"
            label="Licence"
            value={agreement}
            onChange={(id, rec) => {
              setAgreement(id);
              applyAgreement(rec);
            }}
            labelOf={agreementLabel}
            searchFields={AGREEMENT_SEARCH}
            filter={APPROVAL_AGREEMENT_FILTER}
            placeholder="Search merchandise and out-licences"
          />
          {errors['agreement'] !== undefined && <p className="text-xs text-red-600 dark:text-red-400">{errors['agreement']}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            label={vocab.property}
            value={property}
            placeholder="None"
            options={properties.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(e) => setProperty(e.target.value)}
          />
          <RecordPicker<PartyRec>
            collection="parties"
            label="Licensee"
            value={licensee}
            onChange={(id) => setLicensee(id)}
            labelOf={partyLabel}
            searchFields={PARTY_SEARCH}
            placeholder="Search people and companies"
          />
        </div>
        <Input label="Product name" value={name} error={errors['name']} placeholder="For example: Starfall plush, 30 cm" onChange={(e) => setName(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="SKU" value={sku} className="font-mono" onChange={(e) => setSku(e.target.value)} />
          <Input label="Category" value={category} placeholder="For example: Toys" onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Stage" value={stage} options={STAGE_OPTIONS} onChange={(e) => setStage(e.target.value as ApprovalStage)} />
          <DateField label="Decision due" value={due} help="When the licensee needs an answer." onChange={setDue} />
        </div>
        <ImagePicker label="Images" files={files} onChange={setFiles} />
        <Textarea label="Notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer                                                              */
/* ------------------------------------------------------------------ */

type Decision = Exclude<ApprovalStatus, 'submitted'>;

const DECISION_DONE: Record<Decision, string> = {
  in_review: 'Marked in review',
  approved: 'Approved',
  approved_with_changes: 'Approved with changes',
  resubmit: 'Resubmission requested',
  rejected: 'Rejected',
};

export function ApprovalDrawer({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged?: (() => void) | undefined }): React.JSX.Element {
  const { can, me, userName, propertyName, vocab } = useApp();
  const live = useRecord<ApprovalRec>('approvals', id);
  const [saved, setSaved] = useState<ApprovalRec | null>(null);
  const a = newest(live.record, saved);
  const loading = live.loading;
  const agreement = useRecord<AgreementRec>('agreements', a !== null && a.agreement !== '' ? a.agreement : null);
  const licensee = useRecord<PartyRec>('parties', a !== null && a.licensee !== '' ? a.licensee : null);
  const rounds = useCollection<ApprovalRoundRec>('approval_rounds', { filter: `approval = "${id}"`, sort: '-created' });
  const [comment, setComment] = useState('');
  const [advance, setAdvance] = useState(true);
  const [busy, setBusy] = useState<Decision | 'resubmit-record' | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [changeNote, setChangeNote] = useState('');
  const [resubmitOpen, setResubmitOpen] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  /** Show a change at once (and in the lists) even if a realtime event is missed. */
  const reload = async (): Promise<void> => {
    try {
      setSaved(await getRecord<ApprovalRec>('approvals', id));
    } catch {
      /* deleted meanwhile */
    }
    rounds.refresh();
    onChanged?.();
  };

  const decide = async (status: Decision): Promise<void> => {
    if (a === null) return;
    if (status !== 'approved' && status !== 'in_review' && comment.trim() === '') {
      toast.error('Add a comment telling the licensee what to change.');
      return;
    }
    setBusy(status);
    try {
      const r = await op<{ ok: boolean; stage: ApprovalStage; status: ApprovalStatus }>('approvals/decide', {
        id: a.id,
        status,
        comment: comment.trim(),
        advance: (status === 'approved' || status === 'approved_with_changes') && advance,
      });
      const moved = r.stage !== a.stage;
      toast.success(moved ? `${DECISION_DONE[status]}. Moved to ${APPROVAL_STAGE_LABEL[r.stage]}.` : `${DECISION_DONE[status]}.`);
      setComment('');
      await reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const recordResubmission = async (): Promise<void> => {
    if (a === null) return;
    if (files.length === 0) {
      toast.error('Add the new images the licensee sent.');
      return;
    }
    if (a.images.length + files.length > 10) {
      toast.error(`A product holds up to 10 images. It has ${a.images.length}; remove some files or older images first.`);
      return;
    }
    const rev = (a.revision || 1) + 1;
    setBusy('resubmit-record');
    try {
      const fd = new FormData();
      for (const f of files) fd.append('images+', f);
      fd.append('revision', String(rev));
      fd.append('status', 'submitted');
      setSaved(await updateRecord<ApprovalRec>('approvals', a.id, fd));
      const rd = new FormData();
      rd.append('approval', a.id);
      rd.append('revision', String(rev));
      rd.append('stage', a.stage);
      rd.append('status', 'submitted');
      rd.append('comment', changeNote.trim() !== '' ? changeNote.trim() : 'Resubmitted by the licensee');
      if (me !== null) rd.append('decided_by', me.id);
      for (const f of files) rd.append('images', f);
      await createRecord<ApprovalRoundRec>('approval_rounds', rd);
      toast.success(`Revision ${rev} recorded`);
      setFiles([]);
      setChangeNote('');
      setResubmitOpen(false);
      await reload();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (a === null) return;
    if (!(await confirm(`Delete "${a.product_name}" and its review history? This cannot be undone.`, 'Delete product'))) return;
    try {
      await deleteRecord('approvals', a.id);
      toast.success('Product deleted');
      onChanged?.();
      onClose();
    } catch {
      /* toast shown by the client */
    }
  };

  const removeImage = async (img: string): Promise<void> => {
    if (a === null) return;
    if (!(await confirm('Remove this image from the product? Images kept on earlier review rounds stay.', 'Remove image'))) return;
    try {
      setSaved(await updateRecord<ApprovalRec>('approvals', a.id, { 'images-': [img] }));
      toast.success('Image removed');
      onChanged?.();
    } catch {
      /* toast shown by the client */
    }
  };

  const stageIndex = a !== null ? STAGES.indexOf(a.stage) : -1;
  const nextStage = stageIndex >= 0 && stageIndex < STAGES.length - 1 ? STAGES[stageIndex + 1] : undefined;

  return (
    <Drawer open onClose={onClose} title={a?.product_name ?? 'Product'} width={560}>
      {confirmEl}
      {a === null ? (
        <p className="text-sm text-[var(--agent-app-muted)]">{loading ? 'Loading...' : 'This product no longer exists.'}</p>
      ) : (
        <div className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <Pill tone={APPROVAL_STATUS_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Pill>
            <span className="text-[13px] font-medium">{APPROVAL_STAGE_LABEL[a.stage]}</span>
            <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">Rev {a.revision || 1}</span>
            <DueLabel a={a} />
          </div>

          {/* Stage track */}
          <ol className="grid grid-cols-5 gap-1" aria-label="Stages">
            {STAGES.map((s, i) => (
              <li key={s} className="min-w-0">
                <div className={cn('h-1', i < stageIndex ? 'bg-emerald-500' : i === stageIndex ? 'bg-[var(--agent-app-accent)]' : 'bg-[var(--agent-app-border)]')} />
                <div className={cn('mt-1 truncate text-[10.5px]', i === stageIndex ? 'font-semibold' : 'text-[var(--agent-app-muted)]')} title={APPROVAL_STAGE_LABEL[s]}>
                  {APPROVAL_STAGE_LABEL[s]}
                </div>
              </li>
            ))}
          </ol>

          {a.images.length > 0 ? (
            <div className="grid grid-cols-3 gap-2">
              {a.images.map((img) => (
                <div key={img} className="group relative">
                  <a href={fileUrl(a, img)} target="_blank" rel="noreferrer" title="Open full size in a new tab" className="block">
                    <img src={fileUrl(a, img, '400x0')} alt={a.product_name} loading="lazy" className="aspect-square w-full border border-[var(--agent-app-border)] object-cover" />
                  </a>
                  {can.edit && (
                    <button
                      type="button"
                      aria-label="Remove image"
                      onClick={() => void removeImage(img)}
                      className="absolute right-1 top-1 hidden size-6 items-center justify-center bg-[var(--agent-app-surface)]/90 text-[var(--agent-app-muted)] hover:text-red-600 group-hover:flex group-focus-within:flex"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 border border-dashed border-[var(--agent-app-border)] px-3 py-4 text-[13px] text-[var(--agent-app-muted)]">
              <Package size={16} aria-hidden /> No images yet. Add them when the licensee sends the next revision.
            </div>
          )}

          <FactGrid cols={2}>
            <Fact
              label="Licence"
              value={
                agreement.record !== null ? (
                  <a className="hover:underline" href={href('agreement', agreement.record.id)}>
                    <Ref className="mr-1.5">{agreement.record.ref}</Ref>
                    {agreement.record.title}
                  </a>
                ) : (
                  ''
                )
              }
            />
            <Fact
              label="Licensee"
              value={
                licensee.record !== null ? (
                  <a className="hover:underline" href={href('people', licensee.record.id)}>
                    {licensee.record.name}
                  </a>
                ) : (
                  ''
                )
              }
            />
            <Fact label={vocab.property} value={a.property !== '' ? <a className="hover:underline" href={href('property', a.property)}>{propertyName(a.property)}</a> : ''} />
            <Fact label="Category" value={a.category} />
            <Fact label="SKU" value={a.sku} mono />
            <Fact label="Due" value={d10(a.due_date) !== '' ? fmtDate(a.due_date) : ''} />
            <Fact label="Last decision" value={a.decided_by !== '' ? `${userName(a.decided_by)}${a.decided_at ? `, ${ago(a.decided_at)}` : ''}` : ''} />
            <Fact label="Added" value={fmtDate(a.created)} />
          </FactGrid>
          {a.notes !== '' && <Prose className="border-l-2 border-[var(--agent-app-border)] pl-3">{a.notes}</Prose>}

          {can.edit && (
            <section className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
              <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Decide on revision {a.revision || 1}</h3>
              <Textarea
                aria-label="Comment to the licensee"
                rows={3}
                value={comment}
                placeholder="Comment to the licensee. Needed for everything except a plain approval."
                onChange={(e) => setComment(e.target.value)}
              />
              {nextStage !== undefined && (
                <Checkbox checked={advance} onChange={setAdvance} label={`Move to the next stage when approved (${APPROVAL_STAGE_LABEL[nextStage]})`} />
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => void decide('approved')} loading={busy === 'approved'} disabled={busy !== null}>
                  Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => void decide('approved_with_changes')} loading={busy === 'approved_with_changes'} disabled={busy !== null}>
                  Approve with changes
                </Button>
                <Button size="sm" variant="outline" onClick={() => void decide('resubmit')} loading={busy === 'resubmit'} disabled={busy !== null}>
                  Request resubmission
                </Button>
                <Button size="sm" variant="outline" className="text-red-600" onClick={() => void decide('rejected')} loading={busy === 'rejected'} disabled={busy !== null}>
                  Reject
                </Button>
                {a.status === 'submitted' && (
                  <Button size="sm" variant="ghost" onClick={() => void decide('in_review')} loading={busy === 'in_review'} disabled={busy !== null}>
                    Mark in review
                  </Button>
                )}
              </div>
            </section>
          )}

          {can.edit && (
            <section className="flex flex-col gap-3">
              {!resubmitOpen ? (
                <Button size="sm" variant="outline" className="w-fit" onClick={() => setResubmitOpen(true)}>
                  <Upload size={13} aria-hidden /> Record resubmission
                </Button>
              ) : (
                <div className="flex flex-col gap-3 border border-[var(--agent-app-border)] p-3">
                  <h3 className="text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Revision {(a.revision || 1) + 1} from the licensee</h3>
                  <ImagePicker label="New images" files={files} onChange={setFiles} />
                  <Input aria-label="What changed" value={changeNote} placeholder="What changed (optional)" onChange={(e) => setChangeNote(e.target.value)} />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => void recordResubmission()} loading={busy === 'resubmit-record'} disabled={busy !== null && busy !== 'resubmit-record'}>
                      Record revision {(a.revision || 1) + 1}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setResubmitOpen(false);
                        setFiles([]);
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </section>
          )}

          <section>
            <h3 className="mb-2 text-[12px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Review rounds</h3>
            {rounds.records.length === 0 ? (
              <p className="text-[13px] text-[var(--agent-app-muted)]">No decisions yet. Each decision and resubmission is kept here.</p>
            ) : (
              <ol className="flex flex-col border border-[var(--agent-app-border)]">
                {rounds.records.map((r) => (
                  <li key={r.id} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold tabular-nums">Rev {r.revision || 1}</span>
                      {r.stage !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{APPROVAL_STAGE_LABEL[r.stage]}</span>}
                      {r.status !== '' && <Pill tone={APPROVAL_STATUS_TONE[r.status]}>{APPROVAL_STATUS_LABEL[r.status]}</Pill>}
                      <span className="ml-auto text-xs text-[var(--agent-app-muted)]" title={r.created}>
                        {r.decided_by !== '' ? `${userName(r.decided_by)}, ` : ''}
                        {ago(r.created)}
                      </span>
                    </div>
                    {r.comment !== '' && <Prose className="mt-1 text-[var(--agent-app-text)]/85">{r.comment}</Prose>}
                    {r.images.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {r.images.map((img) => (
                          <a key={img} href={fileUrl(r, img)} target="_blank" rel="noreferrer" title="Open full size in a new tab">
                            <img src={fileUrl(r, img, '100x100')} alt="" loading="lazy" className="size-12 border border-[var(--agent-app-border)] object-cover" />
                          </a>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>

          {!can.edit && (
            <Notice>Decisions on products are made by IP managers and counsel. You can follow every round here.</Notice>
          )}

          {can.manage && (
            <div className="border-t border-[var(--agent-app-border)] pt-3">
              <Button size="sm" variant="ghost" className="text-red-600" onClick={() => void remove()}>
                <Trash2 size={13} aria-hidden /> Delete product
              </Button>
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
