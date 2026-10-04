/**
 * Goods and services of a trademark, class by class: the specification,
 * class status, first use dates, whether the mark is in use, and the use
 * evidence each class needs before a declaration of use or a renewal.
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Paperclip, Plus, Tags, Trash2, Upload, X } from 'lucide-react';
import { Button, Select, Switch, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, relLabel, toPb, today } from '../lib/format.ts';
import type { DeadlineRec, GoodsServicesRec, MatterRec } from '../lib/types.ts';
import { CLASS_STATUS_LABEL, CLASS_STATUS_TONE, DATE_INPUT_CLASS, NICE_CLASSES, NICE_HEADING, toOptions } from './matterShared.tsx';
import { EmptyHint, Field, Loading, Notice, Pill, Section } from './ui.tsx';

const MAX_EVIDENCE = 5;

export function GoodsServicesEditor({
  matter,
  declarationDue,
}: {
  matter: MatterRec;
  /** An open US declaration of use or renewal deadline, when there is one. */
  declarationDue?: DeadlineRec | null | undefined;
}): React.JSX.Element {
  const { can } = useApp();
  const rows = useCollection<GoodsServicesRec>('goods_services', { filter: `matter = ${q(matter.id)}`, sort: 'nice_class' });
  const [confirmEl, confirm] = useConfirm();
  const [adding, setAdding] = useState('');
  const [busy, setBusy] = useState(false);
  const used = new Set(rows.records.map((r) => r.nice_class));
  const free = NICE_CLASSES.filter((n) => !used.has(n));

  const addClass = async (): Promise<void> => {
    const n = Number(adding);
    if (!(n >= 1 && n <= 45)) {
      toast.error('Choose a class from 1 to 45.');
      return;
    }
    setBusy(true);
    try {
      await createRecord<GoodsServicesRec>('goods_services', {
        matter: matter.id,
        nice_class: n,
        spec: '',
        class_status: matter.status_group === 'live' ? 'registered' : 'pending',
      });
      toast.success(`Class ${n} added`);
      setAdding('');
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (g: GoodsServicesRec): Promise<void> => {
    const ok = await confirm(
      `Delete class ${g.nice_class} from ${matter.ref}? Its specification and ${g.use_evidence.length > 0 ? `${g.use_evidence.length} evidence file${g.use_evidence.length === 1 ? '' : 's'}` : 'notes'} are removed. To record that the office deleted the class, change its status instead.`,
      `Delete class ${g.nice_class}`,
    );
    if (!ok) return;
    try {
      await deleteRecord('goods_services', g.id);
      toast.success(`Class ${g.nice_class} deleted`);
    } catch {
      /* the client already showed the error */
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {confirmEl}
      {declarationDue !== null && declarationDue !== undefined && (
        <Notice tone="warn" icon={Paperclip}>
          <b>{declarationDue.title}</b> is due {fmtDate(declarationDue.due_date)} ({relLabel(declarationDue.due_date)}). Use evidence is needed for each class before filing the
          declaration: attach a current specimen per class and untick any goods no longer in use.
        </Notice>
      )}
      <Section
        title="Goods and services"
        meta={rows.records.length > 0 ? `${rows.records.length} class${rows.records.length === 1 ? '' : 'es'}` : undefined}
        flush
        actions={
          can.edit && free.length > 0 ? (
            <div className="flex items-center gap-1.5">
              <div className="w-44">
                <Select
                  aria-label="Class to add"
                  value={adding}
                  placeholder="Add a class"
                  className="h-8"
                  options={free.map((n) => ({ value: String(n), label: `Class ${n}: ${NICE_HEADING[n] ?? ''}` }))}
                  onChange={(e) => setAdding(e.target.value)}
                />
              </div>
              <Button size="sm" onClick={() => void addClass()} loading={busy} disabled={adding === ''}>
                <Plus size={13} aria-hidden /> Add
              </Button>
            </div>
          ) : undefined
        }
      >
        {rows.loading ? (
          <Loading />
        ) : rows.error !== null ? (
          <div className="p-4">
            <Notice tone="bad">{rows.error}</Notice>
          </div>
        ) : rows.records.length === 0 ? (
          <EmptyHint
            compact
            icon={Tags}
            title="No classes recorded"
            message={
              can.edit
                ? 'Pick each Nice class the mark is filed in with Add a class, then enter the goods and services as the office lists them.'
                : 'The classes and their goods and services appear here once an editor adds them.'
            }
          />
        ) : (
          rows.records.map((g) => <ClassCard key={g.id} g={g} canEdit={can.edit} onDelete={() => void remove(g)} />)
        )}
      </Section>
    </div>
  );
}

function ClassCard({ g, canEdit, onDelete }: { g: GoodsServicesRec; canEdit: boolean; onDelete: () => void }): React.JSX.Element {
  const [spec, setSpec] = useState(g.spec);
  const [note, setNote] = useState(g.evidence_note);
  const [uploading, setUploading] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);

  useEffect(() => setSpec(g.spec), [g.spec]);
  useEffect(() => setNote(g.evidence_note), [g.evidence_note]);

  // Saves run one after another: two overlapping updates of the same record
  // (for example leaving the text box by clicking the In use switch) would
  // otherwise let the second write back the value the first one replaced.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const save = (patch: Record<string, unknown> | FormData, message?: string): Promise<void> => {
    const run = async (): Promise<void> => {
      try {
        await updateRecord<GoodsServicesRec>('goods_services', g.id, patch);
        if (message !== undefined) toast.success(message);
      } catch {
        /* the client already showed the error */
      }
    };
    queue.current = queue.current.then(run);
    return queue.current;
  };

  const upload = async (files: FileList | null): Promise<void> => {
    if (files === null || files.length === 0) return;
    if (g.use_evidence.length + files.length > MAX_EVIDENCE) {
      toast.error(`A class holds up to ${MAX_EVIDENCE} evidence files. Remove one first.`);
      return;
    }
    setUploading(true);
    const fd = new FormData();
    for (const f of Array.from(files)) fd.append('use_evidence+', f);
    await save(fd, files.length === 1 ? 'Evidence attached' : `${files.length} files attached`);
    setUploading(false);
    if (fileInput.current !== null) fileInput.current.value = '';
  };

  const status = g.class_status;
  const evidence = g.use_evidence;

  return (
    <div className="border-b border-[var(--agent-app-border)] px-4 py-4 last:border-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-sm font-semibold tabular-nums">Class {g.nice_class}</span>
            <span className="truncate text-xs text-[var(--agent-app-muted)]">{NICE_HEADING[g.nice_class] ?? ''}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {canEdit ? (
            <div className="w-40">
              <Select
                aria-label={`Status of class ${g.nice_class}`}
                value={status}
                placeholder="No status"
                className="h-8"
                options={toOptions(CLASS_STATUS_LABEL)}
                onChange={(e) => void save({ class_status: e.target.value }, `Class ${g.nice_class}: ${CLASS_STATUS_LABEL[e.target.value] ?? 'status cleared'}`)}
              />
            </div>
          ) : status !== '' ? (
            <Pill tone={CLASS_STATUS_TONE[status] ?? 'neutral'}>{CLASS_STATUS_LABEL[status] ?? status}</Pill>
          ) : null}
          {canEdit && (
            <button type="button" className="flex size-8 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" aria-label={`Delete class ${g.nice_class}`} onClick={onDelete}>
              <Trash2 size={14} />
            </button>
          )}
        </div>
      </div>

      <div className="mt-3">
        {canEdit ? (
          <Textarea
            aria-label={`Goods and services in class ${g.nice_class}`}
            rows={3}
            value={spec}
            placeholder="The goods or services as listed by the office, separated by semicolons"
            onChange={(e) => setSpec(e.target.value)}
            onBlur={() => {
              if (spec !== g.spec) void save({ spec }, `Class ${g.nice_class} specification saved`);
            }}
          />
        ) : (
          <p className={cn('whitespace-pre-wrap text-[13px] leading-relaxed', g.spec === '' && 'text-[var(--agent-app-muted)]')}>
            {g.spec !== '' ? g.spec : 'No specification recorded.'}
          </p>
        )}
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <DateCell label="First use" value={g.first_use} canEdit={canEdit} onChange={(v) => void save({ first_use: toPb(v) }, `Class ${g.nice_class}: first use saved`)} />
        <DateCell
          label="First use in commerce"
          value={g.first_use_commerce}
          canEdit={canEdit}
          onChange={(v) => void save({ first_use_commerce: toPb(v) }, `Class ${g.nice_class}: first use in commerce saved`)}
        />
        <Field label="In use">
          <div className="flex h-9 items-center">
            <Switch
              checked={g.in_use}
              disabled={!canEdit}
              onCheckedChange={(v) => void save({ in_use: v }, v ? `Class ${g.nice_class} marked in use` : `Class ${g.nice_class} marked not in use`)}
              label={g.in_use ? 'In use' : 'Not in use'}
            />
          </div>
        </Field>
        <Field label="Last reviewed">
          {canEdit ? (
            <div className="flex items-center gap-1.5">
              <BlurDate
                label={`Class ${g.nice_class} last reviewed`}
                value={g.last_reviewed}
                onCommit={(v) => void save({ last_reviewed: toPb(v) }, `Class ${g.nice_class}: review date saved`)}
              />
              <Button size="sm" variant="outline" className="h-9 shrink-0 px-2 text-xs" onClick={() => void save({ last_reviewed: toPb(today()) }, `Class ${g.nice_class} reviewed today`)}>
                Today
              </Button>
            </div>
          ) : (
            <span className="text-[13px]">{g.last_reviewed !== '' ? fmtDate(g.last_reviewed) : '-'}</span>
          )}
        </Field>
      </div>

      <div className="mt-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
            Use evidence <span className="font-normal tabular-nums">{evidence.length} of {MAX_EVIDENCE}</span>
          </span>
          {canEdit && evidence.length < MAX_EVIDENCE && (
            <>
              <Button size="sm" variant="outline" className="h-7 text-xs" loading={uploading} onClick={() => fileInput.current?.click()}>
                <Upload size={12} aria-hidden /> Attach evidence
              </Button>
              <input ref={fileInput} type="file" multiple className="hidden" onChange={(e) => void upload(e.target.files)} />
            </>
          )}
        </div>
        {evidence.length === 0 ? (
          <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">No evidence attached. Add photos of the goods, packaging, or screenshots showing the mark with the services.</p>
        ) : (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {evidence.map((name) => (
              <span key={name} className="inline-flex max-w-full items-center gap-1.5 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-1 text-xs">
                <FileText size={12} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
                <a className="truncate hover:underline" href={fileUrl(g, name)} target="_blank" rel="noreferrer">
                  {name}
                </a>
                {canEdit && (
                  <button
                    type="button"
                    aria-label={`Remove ${name}`}
                    className="text-[var(--agent-app-muted)] hover:text-red-600"
                    onClick={() => void save({ 'use_evidence-': [name] }, 'Evidence removed')}
                  >
                    <X size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
        {canEdit ? (
          <Textarea
            aria-label={`Evidence note for class ${g.nice_class}`}
            className="mt-2 min-h-[44px]"
            rows={1}
            value={note}
            placeholder="Note on the evidence, for example where and when each specimen was captured"
            onChange={(e) => setNote(e.target.value)}
            onBlur={() => {
              if (note !== g.evidence_note) void save({ evidence_note: note }, 'Evidence note saved');
            }}
          />
        ) : (
          g.evidence_note !== '' && <p className="mt-2 text-xs text-[var(--agent-app-text)]/80">{g.evidence_note}</p>
        )}
      </div>
    </div>
  );
}

/** Date input that saves when the field loses focus (not on every keystroke). */
function BlurDate({ label, value, onCommit }: { label: string; value: string; onCommit: (v: string) => void }): React.JSX.Element {
  const [v, setV] = useState(d10(value));
  useEffect(() => setV(d10(value)), [value]);
  return (
    <input
      type="date"
      aria-label={label}
      className={DATE_INPUT_CLASS}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== d10(value) && (v === '' || /^\d{4}-\d{2}-\d{2}$/.test(v))) onCommit(v);
      }}
    />
  );
}

function DateCell({ label, value, canEdit, onChange }: { label: string; value: string; canEdit: boolean; onChange: (v: string) => void }): React.JSX.Element {
  return (
    <Field label={label}>
      {canEdit ? <BlurDate label={label} value={value} onCommit={onChange} /> : <span className="text-[13px]">{d10(value) !== '' ? fmtDate(value) : '-'}</span>}
    </Field>
  );
}
