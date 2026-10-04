/**
 * The invention disclosure form: every section the inventor fills in, an
 * explicit Save with an unsaved-changes indicator, CraftBot's structured
 * draft (copied in field by field, never saved on its own), the inventors
 * with their shares, attachments, and the submit step.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Bot, Check, FileText, Plus, Sparkles, Upload, UserPlus, X } from 'lucide-react';
import { Button, Dialog, Input, Select, TagInput, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl, q, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago, d10, fmtDate, toPb } from '../lib/format.ts';
import type { DisclosureRec, DocumentRec, InvolvementRec, PartyRec } from '../lib/types.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { UploadDialog } from './documents.tsx';
import { RecordPicker } from './pickers.tsx';
import { Dot, EmptyHint, Field, IdentityChip, Notice, Prose, Section, TONE_TEXT } from './ui.tsx';
import { GraceWarning } from './inventShared.tsx';
import type { InvolvementX } from './inventShared.tsx';

/* ------------------------------------------------------------------ */
/* Form state                                                          */
/* ------------------------------------------------------------------ */

export interface FormState {
  title: string;
  summary: string;
  problem: string;
  solution: string;
  novelty: string;
  advantages: string;
  uses: string;
  products: string;
  tech_tags: string[];
  property: string;
  public_disclosure_date: string;
  on_sale_date: string;
  nda_date: string;
  inventor_names: string;
}

export type TextField = 'summary' | 'problem' | 'solution' | 'novelty' | 'advantages' | 'uses';

export const TEXT_FIELDS: { key: TextField; label: string; help: string; rows: number }[] = [
  { key: 'summary', label: 'Summary', help: 'Two or three sentences someone outside your team would understand.', rows: 3 },
  { key: 'problem', label: 'Problem it solves', help: 'What was hard, slow or impossible before? How do people handle it today?', rows: 4 },
  { key: 'solution', label: 'How it works', help: 'Step by step, in enough detail that a colleague could build it. Attach drawings or diagrams.', rows: 12 },
  { key: 'novelty', label: 'What is new', help: 'What is different from existing products, papers or patents you know of?', rows: 4 },
  { key: 'advantages', label: 'Advantages', help: 'Faster, cheaper, better quality, a new capability.', rows: 3 },
  { key: 'uses', label: 'Where it could be used', help: 'Products, services or other fields that could use it.', rows: 3 },
];

function fromRecord(d: DisclosureRec): FormState {
  return {
    title: d.title,
    summary: d.summary,
    problem: d.problem,
    solution: d.solution,
    novelty: d.novelty,
    advantages: d.advantages,
    uses: d.uses,
    products: d.products,
    tech_tags: d.tech_tags ?? [],
    property: d.property,
    public_disclosure_date: d10(d.public_disclosure_date),
    on_sale_date: d10(d.on_sale_date),
    nda_date: d10(d.nda_date),
    inventor_names: d.inventor_names,
  };
}

function same(a: FormState, b: FormState): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface DisclosureForm {
  form: FormState | null;
  dirty: boolean;
  saving: boolean;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  save: () => Promise<boolean>;
  discard: () => void;
}

/** Explicit-save form over a disclosure; `onSaved` receives the updated record. */
export function useDisclosureForm(d: DisclosureRec | null, onSaved: (rec: DisclosureRec) => void): DisclosureForm {
  const [draft, setDraft] = useState<FormState | null>(null);
  const [saving, setSaving] = useState(false);
  const base = useMemo(() => (d !== null ? fromRecord(d) : null), [d]);
  const form = draft ?? base;
  const dirty = draft !== null && base !== null && !same(draft, base);

  // Once the saved record comes back, the draft is no longer needed.
  useEffect(() => {
    if (draft !== null && base !== null && same(draft, base)) setDraft(null);
  }, [draft, base]);

  // Warn before leaving the page with unsaved changes.
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onLeave);
    return () => window.removeEventListener('beforeunload', onLeave);
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setDraft((cur) => {
      const from = cur ?? base;
      return from === null ? null : { ...from, [key]: value };
    });
  };

  const save = async (): Promise<boolean> => {
    if (d === null || draft === null || !dirty) return true;
    if (draft.title.trim() === '') {
      toast.error('The invention needs a title.');
      return false;
    }
    setSaving(true);
    try {
      const rec = await updateRecord<DisclosureRec>('disclosures', d.id, {
        title: draft.title.trim(),
        summary: draft.summary,
        problem: draft.problem,
        solution: draft.solution,
        novelty: draft.novelty,
        advantages: draft.advantages,
        uses: draft.uses,
        products: draft.products,
        tech_tags: draft.tech_tags,
        property: draft.property,
        public_disclosure_date: toPb(draft.public_disclosure_date),
        on_sale_date: toPb(draft.on_sale_date),
        nda_date: toPb(draft.nda_date),
        inventor_names: draft.inventor_names,
      });
      onSaved(rec);
      toast.success('Saved');
      return true;
    } catch {
      /* toast shown by the client */
      return false;
    } finally {
      setSaving(false);
    }
  };

  return { form, dirty, saving, set, save, discard: () => setDraft(null) };
}

/* ------------------------------------------------------------------ */
/* Form                                                                */
/* ------------------------------------------------------------------ */

function ReadBlock({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
      {value.trim() !== '' ? <Prose className="mt-1">{value}</Prose> : <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">Not given</p>}
    </div>
  );
}

export function DisclosureFormView({
  d,
  f,
  editable,
  showInventorNames,
  aside,
}: {
  d: DisclosureRec;
  f: DisclosureForm;
  editable: boolean;
  showInventorNames: boolean;
  aside: ReactNode;
}): React.JSX.Element {
  const { vocab, properties, propertyName } = useApp();
  const form = f.form;
  if (form === null) return <></>;
  const dateCls = 'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm';

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <div className="flex min-w-0 flex-col gap-4 lg:col-span-2">
        <Section title="The invention">
          <div className="flex flex-col gap-5">
            {editable ? (
              <Input label="Title" value={form.title} maxLength={300} onChange={(e) => f.set('title', e.target.value)} />
            ) : null}
            {TEXT_FIELDS.map((t) =>
              editable ? (
                <Field key={t.key} label={t.label} help={t.help} htmlFor={`inv-${t.key}`}>
                  <Textarea id={`inv-${t.key}`} rows={t.rows} value={form[t.key]} onChange={(e) => f.set(t.key, e.target.value)} />
                </Field>
              ) : (
                <ReadBlock key={t.key} label={t.label} value={form[t.key]} />
              ),
            )}
          </div>
        </Section>

        <Section title="Products and technology">
          {editable ? (
            <div className="flex flex-col gap-4">
              <Input label="Products" value={form.products} maxLength={600} placeholder="Products that use it or could use it" onChange={(e) => f.set('products', e.target.value)} />
              <TagInput label="Technology tags" value={form.tech_tags} onChange={(v) => f.set('tech_tags', v)} placeholder="For example: audio, machine learning. Press Enter after each" />
              {properties.length > 0 && (
                <Select
                  label={vocab.property}
                  value={form.property}
                  placeholder="None"
                  options={properties.map((p) => ({ value: p.id, label: p.name }))}
                  onChange={(e) => f.set('property', e.target.value)}
                />
              )}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <ReadBlock label="Products" value={form.products} />
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Technology tags</div>
                {form.tech_tags.length === 0 ? (
                  <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">Not given</p>
                ) : (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {form.tech_tags.map((t) => (
                      <span key={t} className="border border-[var(--agent-app-border)] px-1.5 py-0.5 text-xs">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              {properties.length > 0 && <ReadBlock label={vocab.property} value={propertyName(form.property)} />}
            </div>
          )}
        </Section>

        <Section title="Public disclosure and sale">
          <div className="flex flex-col gap-4">
            <Notice tone="warn">
              If the invention was shown publicly or offered for sale, the US and Japan allow 12 months to file; Europe and most other countries do not allow any grace period.
            </Notice>
            <div className="grid gap-4 sm:grid-cols-3">
              {(
                [
                  ['public_disclosure_date', 'Shown in public on', 'A talk, paper, demo, website or trade show'],
                  ['on_sale_date', 'Offered for sale on', 'A quote, offer or sale, even to one customer'],
                  ['nda_date', 'Shared under NDA on', 'Shown to others under a confidentiality agreement'],
                ] as const
              ).map(([key, label, help]) =>
                editable ? (
                  <Field key={key} label={label} help={help} htmlFor={`inv-${key}`}>
                    <input id={`inv-${key}`} type="date" className={dateCls} value={form[key]} onChange={(e) => f.set(key, e.target.value)} />
                  </Field>
                ) : (
                  <div key={key}>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
                    <p className={cn('mt-1 text-[13px]', form[key] === '' && 'text-[var(--agent-app-muted)]')}>{form[key] !== '' ? fmtDate(form[key]) : 'Not given'}</p>
                  </div>
                ),
              )}
            </div>
            {d.matter === '' && <GraceWarning d={{ public_disclosure_date: form.public_disclosure_date, on_sale_date: form.on_sale_date }} />}
          </div>
        </Section>

        {showInventorNames && (
          <Section title="Inventors">
            {editable ? (
              <Field
                label="Inventor names"
                htmlFor="inv-names"
                help="Everyone who contributed to the idea, separated by commas. The IP team records each inventor and their share."
              >
                <Input id="inv-names" value={form.inventor_names} maxLength={600} onChange={(e) => f.set('inventor_names', e.target.value)} placeholder="For example: Mika Sato, Jon Reyes" />
              </Field>
            ) : (
              <ReadBlock label="Inventor names" value={form.inventor_names} />
            )}
          </Section>
        )}

        <CraftBotDraft d={d} f={f} editable={editable} />

        {editable && (
          <div
            className={cn(
              'sticky bottom-3 z-10 flex flex-wrap items-center justify-between gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2',
              f.dirty && 'shadow-lg',
            )}
          >
            <span className="flex items-center gap-2 text-[13px]">
              <Dot tone={f.dirty ? 'warn' : 'good'} />
              {f.dirty ? 'Unsaved changes' : 'All changes saved'}
            </span>
            <div className="flex gap-2">
              {f.dirty && (
                <Button size="sm" variant="ghost" onClick={f.discard}>
                  Discard
                </Button>
              )}
              <Button size="sm" onClick={() => void f.save()} disabled={!f.dirty} loading={f.saving}>
                Save
              </Button>
            </div>
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">{aside}</div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* CraftBot                                                            */
/* ------------------------------------------------------------------ */

interface CraftDraft {
  fields: Partial<Record<TextField, string>>;
  questions: string[];
  draftedAt: string;
}

function readDraft(answers: Record<string, unknown> | null): CraftDraft | null {
  const raw = answers?.['craftbot_draft'];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const fields: Partial<Record<TextField, string>> = {};
  for (const t of TEXT_FIELDS) {
    const v = o[t.key];
    if (typeof v === 'string' && v.trim() !== '') fields[t.key] = v;
  }
  const qs = Array.isArray(o['questions']) ? o['questions'].filter((x): x is string => typeof x === 'string' && x.trim() !== '') : [];
  const at = typeof o['drafted_at'] === 'string' ? o['drafted_at'] : '';
  if (Object.keys(fields).length === 0 && qs.length === 0) return null;
  return { fields, questions: qs, draftedAt: at };
}

function CraftBotDraft({ d, f, editable }: { d: DisclosureRec; f: DisclosureForm; editable: boolean }): React.JSX.Element | null {
  const draft = readDraft(d.answers);
  if (draft === null || f.form === null) return null;
  const form = f.form;
  return (
    <Section title="CraftBot's draft" meta={draft.draftedAt !== '' ? `Drafted ${ago(draft.draftedAt)}` : undefined}>
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--agent-app-muted)]">
          A clearer version of each section, written from your notes. Nothing changes until you choose Use this and then Save.
        </p>
        {TEXT_FIELDS.filter((t) => draft.fields[t.key] !== undefined).map((t) => {
          const text = draft.fields[t.key] ?? '';
          const inForm = form[t.key] === text;
          return (
            <div key={t.key} className="border border-[var(--agent-app-border)] px-3 py-2.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t.label}</span>
                {editable &&
                  (inForm ? (
                    <span className={cn('inline-flex items-center gap-1 text-xs', TONE_TEXT.good)}>
                      <Check size={12} aria-hidden /> In the form
                    </span>
                  ) : (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => {
                        f.set(t.key, text);
                        toast.info(`${t.label} copied into the form. Save to keep it.`);
                      }}
                    >
                      Use this
                    </Button>
                  ))}
              </div>
              <Prose>{text}</Prose>
            </div>
          );
        })}
        {draft.questions.length > 0 && (
          <div>
            <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Questions to answer</div>
            <ol className="flex list-decimal flex-col gap-1 pl-5 text-[13px] leading-relaxed">
              {draft.questions.map((x, i) => (
                <li key={`${i}-${x}`}>{x}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Section>
  );
}

export function AskCraftBotPanel({ d, f, onFinished }: { d: DisclosureRec; f: DisclosureForm; onFinished: () => void }): React.JSX.Element {
  const [requestId, setRequestId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const ask = async (): Promise<void> => {
    setBusy(true);
    try {
      if (f.dirty && !(await f.save())) return;
      const id = await handToCraftBot('invention_assist_requested', { disclosure_id: d.id });
      if (id !== null) setRequestId(id);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Section title="Structure my notes" actions={<Bot size={14} className="text-[var(--agent-app-accent)]" aria-hidden />}>
      <div className="flex flex-col gap-3">
        <p className="text-[13px] leading-relaxed text-[var(--agent-app-muted)]">
          CraftBot reads your notes and attachments and drafts each section more clearly. It never changes your text: you choose what to copy in.
        </p>
        <Button variant="outline" onClick={() => void ask()} loading={busy}>
          <Sparkles size={14} aria-hidden /> Ask CraftBot to structure my notes
        </Button>
        <AgentStatus
          requestId={requestId}
          workingText="CraftBot is reading your notes..."
          doneText="CraftBot's draft is ready below the form."
          compact
          onDone={onFinished}
        />
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Inventors (IP team)                                                 */
/* ------------------------------------------------------------------ */

function ShareInput({ inv }: { inv: InvolvementRec }): React.JSX.Element {
  const [v, setV] = useState(String(inv.share || 0));
  useEffect(() => setV(String(inv.share || 0)), [inv.share]);
  const commit = async (): Promise<void> => {
    const n = Number(v);
    if (Number.isNaN(n) || n < 0 || n > 100) {
      toast.error('A share is a percentage from 0 to 100.');
      setV(String(inv.share || 0));
      return;
    }
    if (n === inv.share) return;
    try {
      await updateRecord('involvements', inv.id, { share: n });
      toast.success('Share saved');
    } catch {
      setV(String(inv.share || 0));
    }
  };
  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number"
        min={0}
        max={100}
        step="any"
        aria-label="Share in percent"
        className="h-7 w-16 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-1.5 text-right text-[13px] tabular-nums"
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        }}
      />
      <span className="text-xs text-[var(--agent-app-muted)]">%</span>
    </span>
  );
}

export function InventorsPanel({ d, editable }: { d: DisclosureRec; editable: boolean }): React.JSX.Element {
  const list = useCollection<InvolvementX>('involvements', { filter: `disclosure = ${q(d.id)} && role = "inventor"`, expand: 'party', sort: 'created' });
  const [confirmEl, confirm] = useConfirm();
  const [mode, setMode] = useState<'none' | 'pick' | 'new'>('none');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const total = list.records.reduce((a, i) => a + (i.share || 0), 0);
  const remaining = Math.max(0, Math.round((100 - total) * 100) / 100);

  const add = async (partyId: string): Promise<void> => {
    if (list.records.some((i) => i.party === partyId)) {
      toast.info('This person is already listed as an inventor.');
      return;
    }
    try {
      await createRecord('involvements', { party: partyId, role: 'inventor', disclosure: d.id, share: remaining });
      toast.success('Inventor added');
      setMode('none');
      list.refresh();
    } catch {
      /* toast shown by the client */
    }
  };

  const createPerson = async (): Promise<void> => {
    if (name.trim() === '') {
      toast.error("Enter the inventor's name.");
      return;
    }
    setBusy(true);
    try {
      const p = await createRecord<PartyRec>('parties', { name: name.trim(), kind: 'person', email: email.trim(), roles: ['inventor'] });
      await add(p.id);
      setName('');
      setEmail('');
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };

  const remove = async (i: InvolvementX): Promise<void> => {
    const who = i.expand?.party?.name ?? 'this inventor';
    if (!(await confirm(`Remove ${who} from the inventors of this invention? The person stays in People.`, 'Remove inventor'))) return;
    try {
      await deleteRecord('involvements', i.id);
      toast.success('Inventor removed');
      list.refresh();
    } catch {
      /* toast shown by the client */
    }
  };

  const splitEqually = async (): Promise<void> => {
    const n = list.records.length;
    if (n === 0) return;
    const each = Math.floor((100 / n) * 100) / 100;
    try {
      await Promise.all(
        list.records.map((i, idx) => updateRecord('involvements', i.id, { share: idx === n - 1 ? Math.round((100 - each * (n - 1)) * 100) / 100 : each })),
      );
      toast.success('Shares split equally');
      list.refresh();
    } catch {
      /* toast shown by the client */
    }
  };

  return (
    <Section
      title="Inventors"
      meta={list.records.length > 0 ? String(list.records.length) : undefined}
      flush
      actions={
        editable && mode === 'none' ? (
          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMode('pick')}>
            <UserPlus size={13} aria-hidden /> Add
          </Button>
        ) : undefined
      }
    >
      {confirmEl}
      {list.records.length === 0 && mode === 'none' ? (
        <EmptyHint
          compact
          title="No inventors recorded"
          message={d.inventor_names !== '' ? `The submitter named: ${d.inventor_names}` : 'Record everyone who contributed to the idea, with their share.'}
          action={
            editable ? (
              <Button size="sm" onClick={() => setMode('pick')}>
                Add an inventor
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          {list.records.map((i) => {
            const p = i.expand?.party;
            return (
              <div key={i.id} className="flex items-center gap-2.5 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0">
                <IdentityChip name={p?.name ?? '?'} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13px] font-medium">{p?.name ?? 'Unknown person'}</div>
                  {p?.email ? <div className="truncate text-xs text-[var(--agent-app-muted)]">{p.email}</div> : null}
                </div>
                {editable ? <ShareInput inv={i} /> : <span className="text-[13px] tabular-nums">{i.share || 0}%</span>}
                {editable && (
                  <button type="button" aria-label={`Remove ${p?.name ?? 'inventor'}`} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" onClick={() => void remove(i)}>
                    <X size={14} />
                  </button>
                )}
              </div>
            );
          })}
          {list.records.length > 0 && Math.abs(total - 100) > 0.01 && (
            <div className="border-t border-[var(--agent-app-border)] px-4 py-2.5">
              <Notice tone="warn">
                Shares add up to {Math.round(total * 100) / 100}%. They should total 100%.
                {editable && (
                  <>
                    {' '}
                    <button type="button" className="font-medium text-[var(--agent-app-accent)] hover:underline" onClick={() => void splitEqually()}>
                      Split equally
                    </button>
                  </>
                )}
              </Notice>
            </div>
          )}
          {d.inventor_names !== '' && list.records.length > 0 && (
            <p className="border-t border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">Named by the submitter: {d.inventor_names}</p>
          )}
        </>
      )}
      {editable && mode !== 'none' && (
        <div className="flex flex-col gap-2.5 border-t border-[var(--agent-app-border)] px-4 py-3">
          {mode === 'pick' ? (
            <>
              <RecordPicker<PartyRec>
                collection="parties"
                value=""
                allowClear={false}
                label="Add an inventor"
                placeholder="Search people by name or email"
                filter='kind = "person"'
                searchFields={['name', 'email', 'organization']}
                labelOf={(p) => (p.email ? `${p.name} (${p.email})` : p.name)}
                onChange={(id) => {
                  if (id !== '') void add(id);
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-[var(--agent-app-accent)] hover:underline" onClick={() => setMode('new')}>
                  <Plus size={12} aria-hidden /> Not in the list? Add a new person
                </button>
                <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setMode('none')}>
                  Done
                </Button>
              </div>
            </>
          ) : (
            <>
              <Input label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
              <Input label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
              <div className="flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setMode('pick')}>
                  Back
                </Button>
                <Button size="sm" onClick={() => void createPerson()} loading={busy} disabled={name.trim() === ''}>
                  Add inventor
                </Button>
              </div>
            </>
          )}
          <p className="text-xs text-[var(--agent-app-muted)]">New inventors get the remaining share ({remaining}%). Adjust shares so they total 100%.</p>
        </div>
      )}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Attachments for inventors (they upload to their own inventions)     */
/* ------------------------------------------------------------------ */

export function InventorAttachments({ d }: { d: DisclosureRec }): React.JSX.Element {
  const docs = useCollection<DocumentRec>('documents', { filter: `disclosure = ${q(d.id)}`, sort: '-created' });
  const [upload, setUpload] = useState(false);
  return (
    <Section
      title="Attachments"
      meta={docs.records.length > 0 ? String(docs.records.length) : undefined}
      flush
      actions={
        <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setUpload(true)}>
          <Upload size={13} aria-hidden /> Upload
        </Button>
      }
    >
      {docs.records.length === 0 ? (
        <EmptyHint
          compact
          icon={FileText}
          title="No attachments yet"
          message="Add sketches, diagrams, lab notes or slides. They help the IP team understand the invention."
          action={
            <Button size="sm" onClick={() => setUpload(true)}>
              Upload a file
            </Button>
          }
        />
      ) : (
        docs.records.map((doc) => (
          <div key={doc.id} className="flex items-center gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
            <FileText size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
            <div className="min-w-0 flex-1">
              <a href={fileUrl(doc, doc.file)} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium hover:underline">
                {doc.title}
              </a>
              <div className="text-xs text-[var(--agent-app-muted)]">{fmtDate(doc.doc_date || doc.created)}</div>
            </div>
          </div>
        ))
      )}
      {upload && <UploadDialog relation="disclosure" relationId={d.id} defaultType="disclosure" onClose={() => setUpload(false)} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Submit                                                              */
/* ------------------------------------------------------------------ */

export function SubmitDialog({
  form,
  hasInventors,
  onClose,
  onSubmit,
}: {
  form: FormState;
  hasInventors: boolean;
  onClose: () => void;
  onSubmit: () => Promise<void>;
}): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const described = form.summary.trim() !== '' || form.solution.trim() !== '';
  const checks: { ok: boolean; text: string; required: boolean }[] = [
    { ok: described, text: 'A summary or an explanation of how it works', required: true },
    { ok: form.problem.trim() !== '', text: 'The problem it solves', required: false },
    { ok: form.novelty.trim() !== '', text: 'What is new', required: false },
    { ok: hasInventors, text: 'Who the inventors are', required: false },
  ];
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Submit for review"
      description="The IP team is notified and reviews the invention. You can no longer edit it after submitting, so check it is complete."
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Keep editing
          </Button>
          <Button
            disabled={!described}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onSubmit().finally(() => setBusy(false));
            }}
          >
            Submit for review
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {checks.map((c) => (
          <div key={c.text} className="flex items-start gap-2 text-[13px]">
            {c.ok ? (
              <Check size={15} className={cn('mt-0.5 shrink-0', TONE_TEXT.good)} aria-hidden />
            ) : (
              <X size={15} className={cn('mt-0.5 shrink-0', c.required ? TONE_TEXT.bad : TONE_TEXT.warn)} aria-hidden />
            )}
            <span>
              {c.text}
              {!c.ok && <span className="text-[var(--agent-app-muted)]">{c.required ? ' (required)' : ' (recommended)'}</span>}
            </span>
          </div>
        ))}
        {(form.public_disclosure_date !== '' || form.on_sale_date !== '') && <GraceWarning d={form} className="mt-2" />}
      </div>
    </Dialog>
  );
}

/** Delete a draft invention (submitter or manager). */
export function useDeleteDraft(d: DisclosureRec | null, onDeleted: () => void): { el: ReactNode; run: () => void } {
  const [confirmEl, confirm] = useConfirm();
  const run = (): void => {
    if (d === null) return;
    void (async () => {
      if (!(await confirm(`Delete the draft "${d.title}"? This cannot be undone.`, 'Delete draft'))) return;
      try {
        await deleteRecord('disclosures', d.id);
        toast.success('Draft deleted');
        onDeleted();
      } catch {
        /* toast shown by the client */
      }
    })();
  };
  return { el: confirmEl, run };
}

