/**
 * Shared pieces for the rights area (Can we?, agreements, committees,
 * permissions): dimension names, date and number fields, the asset pickers
 * a grant or a question names, a row editor for JSON lists, the committee
 * consent-request dialog and the CraftBot email-draft dialog.
 */
import { useId, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Mail, Plus, Trash2 } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, Dialog, Input, Select, Textarea, cn, toast } from '../../kit/index.ts';
import { opToast } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { addDays, d10, fmtDate, today } from '../lib/format.ts';
import { t, tf } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import type { Page } from '../lib/router.ts';
import type { CommitteeRec, DimensionRec, FranchiseRec, MatterRec, RecordingRec, SongRec, TitleRec, CharacterRec } from '../lib/records.ts';
import type { DimSpec, DimSpecMap, ModuleKey } from '../lib/shapes.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { MultiRecordPicker, dimSpecLabel } from './pickers.tsx';
import { Field, Notice } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Dimensions                                                          */
/* ------------------------------------------------------------------ */

export const DIM_KEYS = ['territory', 'media', 'language', 'category', 'channel', 'platform'] as const;
export type DimKey = (typeof DIM_KEYS)[number];

function fallbackDimTitle(key: string): string {
  switch (key) {
    case 'territory':
      return t('Territory');
    case 'media':
      return t('Media');
    case 'language':
      return t('Language and version');
    case 'category':
      return t('Product category');
    case 'channel':
      return t('Sales channel');
    case 'platform':
      return t('Platform');
    default:
      return key;
  }
}

/** The rights dimensions in order, their names in the reader's language, and which are switched on. */
export function useRightsDims(): { keys: string[]; enabled: string[]; title: (key: string) => string } {
  const dims = useCollection<DimensionRec>('dimensions', { sort: 'order' });
  return useMemo(() => {
    const rows = dims.records;
    const keys = rows.length > 0 ? rows.map((d) => d.key) : [...DIM_KEYS];
    const enabled = rows.length > 0 ? rows.filter((d) => d.enabled).map((d) => d.key) : [...DIM_KEYS];
    const title = (key: string): string => {
      const d = rows.find((x) => x.key === key);
      return d !== undefined ? tf(d, 'label') || d.label : fallbackDimTitle(key);
    };
    return { keys, enabled, title };
  }, [dims.records]);
}

/** Drop empty include/exclude lists so a stored spec means exactly what was chosen. */
export function cleanDims(spec: DimSpecMap | null | undefined): DimSpecMap {
  const out: DimSpecMap = {};
  for (const [k, v] of Object.entries(spec ?? {})) {
    const inc = v.include ?? [];
    const exc = v.exclude ?? [];
    if (inc.length === 0 && exc.length === 0) continue;
    const s: DimSpec = {};
    if (inc.length > 0) s.include = inc;
    if (exc.length > 0) s.exclude = exc;
    out[k] = s;
  }
  return out;
}

/** "Media: Merchandise; Territory: Japan, Taiwan" for the narrowed dimensions of a spec. */
export function useDimSummary(): (spec: DimSpecMap | null | undefined, keys?: string[]) => { key: string; label: string; text: string }[] {
  const { dimValues } = useApp();
  const dims = useRightsDims();
  return (spec, keys) => {
    const s = spec ?? {};
    const list = keys ?? dims.keys;
    const out: { key: string; label: string; text: string }[] = [];
    for (const k of list) {
      const v = s[k];
      if (v === undefined || ((v.include ?? []).length === 0 && (v.exclude ?? []).length === 0)) continue;
      out.push({ key: k, label: dims.title(k), text: dimSpecLabel(dimValues.filter((x) => x.dimension === k), v) });
    }
    return out;
  };
}

/* ------------------------------------------------------------------ */
/* Dates, terms and numbers                                            */
/* ------------------------------------------------------------------ */

const fieldCls =
  'h-9 w-full min-w-0 rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--agent-app-ring)] disabled:opacity-60';

export function DateField({
  label,
  value,
  onChange,
  help,
  error,
  required = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (day: string) => void;
  help?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
  disabled?: boolean | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={id}>
      <input id={id} type="date" className={cn(fieldCls, error !== undefined && error !== '' && 'border-red-500')} value={d10(value)} disabled={disabled} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

export function NumField({
  label,
  value,
  onChange,
  help,
  step,
  min,
  max,
  suffix,
  placeholder,
}: {
  label: string;
  value: number | null;
  onChange: (n: number | null) => void;
  help?: ReactNode | undefined;
  step?: number | undefined;
  min?: number | undefined;
  max?: number | undefined;
  suffix?: string | undefined;
  placeholder?: string | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} htmlFor={id}>
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          className={cn(fieldCls, 'tabular-nums')}
          value={value === null || Number.isNaN(value) ? '' : value}
          step={step ?? 'any'}
          min={min}
          max={max}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
        />
        {suffix !== undefined && <span className="shrink-0 text-xs text-[var(--agent-app-muted)]">{suffix}</span>}
      </div>
    </Field>
  );
}

/** A number for a PocketBase number field (empty means 0). */
export function num(n: number | null | undefined): number {
  return n === null || n === undefined || Number.isNaN(n) ? 0 : n;
}

/** "1 Apr 2026 to 31 Mar 2029", "From 1 Apr 2026, no end date", "" when nothing is set. */
export function termText(x: { term_start: string; term_end: string; perpetual?: boolean | undefined }): string {
  const s = d10(x.term_start);
  const e = d10(x.term_end);
  if (x.perpetual === true) return s !== '' ? t('From {date}, no end date', { date: fmtDate(s) }) : t('No end date');
  if (s !== '' && e !== '') return t('{start} to {end}', { start: fmtDate(s), end: fmtDate(e) });
  if (e !== '') return t('Until {date}', { date: fmtDate(e) });
  if (s !== '') return t('From {date}', { date: fmtDate(s) });
  return '';
}

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('Copied'));
  } catch {
    toast.error(t('Could not copy. Select the text and copy it by hand.|rights'));
  }
}

/* ------------------------------------------------------------------ */
/* Assets a grant or a question names                                  */
/* ------------------------------------------------------------------ */

export interface AssetSel {
  franchises: string[];
  works: string[];
  characters: string[];
  songs: string[];
  recordings: string[];
  matters: string[];
}

export type AssetField = keyof AssetSel;
export type AssetType = 'franchise' | 'work' | 'character' | 'song' | 'recording' | 'matter';

export const EMPTY_ASSETS: AssetSel = { franchises: [], works: [], characters: [], songs: [], recordings: [], matters: [] };

export const ASSET_TYPE: Record<AssetField, AssetType> = {
  franchises: 'franchise',
  works: 'work',
  characters: 'character',
  songs: 'song',
  recordings: 'recording',
  matters: 'matter',
};
export const ASSET_FIELD: Record<AssetType, AssetField> = {
  franchise: 'franchises',
  work: 'works',
  character: 'characters',
  song: 'songs',
  recording: 'recordings',
  matter: 'matters',
};

const ASSET_MODULE: Partial<Record<AssetField, ModuleKey>> = {
  franchises: 'franchises',
  characters: 'franchises',
  works: 'titles',
  songs: 'music',
  recordings: 'music',
};

export function assetCount(a: AssetSel): number {
  return a.franchises.length + a.works.length + a.characters.length + a.songs.length + a.recordings.length + a.matters.length;
}

export function assetList(a: AssetSel): { type: AssetType; id: string }[] {
  const out: { type: AssetType; id: string }[] = [];
  for (const f of Object.keys(ASSET_TYPE) as AssetField[]) for (const id of a[f]) out.push({ type: ASSET_TYPE[f], id });
  return out;
}

export function assetPage(type: string): Page | null {
  return (
    ({
      franchise: 'franchise',
      work: 'title',
      character: 'character',
      song: 'song',
      recording: 'recording',
      matter: 'matter',
      talent: 'talent',
      agreement: 'agreement',
      committee: 'committee',
      product: 'product',
    } as Record<string, Page>)[type] ?? null
  );
}

export function assetHref(type: string, id: string): string {
  const p = assetPage(type);
  return p === null ? '' : href(p, id);
}

const LINK_MODULE: Partial<Record<string, ModuleKey>> = {
  franchise: 'franchises',
  character: 'franchises',
  work: 'titles',
  song: 'music',
  recording: 'music',
  talent: 'talents',
  committee: 'committees',
  product: 'products',
};

/** Link to a record's page, or '' when its module is switched off. */
export function useAssetHref(): (type: string, id: string) => string {
  const { on } = useApp();
  return (type: string, id: string) => {
    const m = LINK_MODULE[type];
    if (m !== undefined && !on(m)) return '';
    return assetHref(type, id);
  };
}

export function assetTypeLabel(type: string): string {
  switch (type) {
    case 'franchise':
      return t('Franchise');
    case 'work':
      return t('Title');
    case 'character':
      return t('Character');
    case 'song':
      return t('Song');
    case 'recording':
      return t('Recording');
    case 'matter':
      return t('Trademark or design');
    default:
      return type;
  }
}

const SEARCH_NAME = ['name'];
const SEARCH_TITLE = ['title'];
const SEARCH_MATTER = ['ref', 'title', 'application_no', 'registration_no'];
const franchiseLabel = (r: FranchiseRec): string => r.name;
const titleLabel = (r: TitleRec): string => r.title;
const characterLabel = (r: CharacterRec): string => r.name;
const songLabel = (r: SongRec): string => r.title;
const recordingLabel = (r: RecordingRec): string => r.title;
const matterLabel = (r: MatterRec): string => `${r.ref} ${r.title}`.trim();

/** One searchable multi-picker per asset kind; kinds of switched-off modules hide unless already chosen. */
export function AssetPickers({
  value,
  onChange,
  fields,
  className,
}: {
  value: AssetSel;
  onChange: (v: AssetSel) => void;
  fields?: AssetField[] | undefined;
  className?: string | undefined;
}): React.JSX.Element {
  const { on } = useApp();
  const list = (fields ?? (Object.keys(ASSET_TYPE) as AssetField[])).filter((f) => {
    const m = ASSET_MODULE[f];
    return m === undefined || on(m) || value[f].length > 0;
  });
  const set = (f: AssetField) => (ids: string[]) => onChange({ ...value, [f]: ids });
  return (
    <div className={cn('grid gap-3 sm:grid-cols-2 lg:grid-cols-3', className)}>
      {list.map((f) => {
        switch (f) {
          case 'franchises':
            return <MultiRecordPicker<FranchiseRec> key={f} collection="franchises" label={t('Franchises')} value={value.franchises} onChange={set(f)} labelOf={franchiseLabel} searchFields={SEARCH_NAME} />;
          case 'works':
            return <MultiRecordPicker<TitleRec> key={f} collection="titles" label={t('Titles')} value={value.works} onChange={set(f)} labelOf={titleLabel} searchFields={SEARCH_TITLE} />;
          case 'characters':
            return <MultiRecordPicker<CharacterRec> key={f} collection="characters" label={t('Characters')} value={value.characters} onChange={set(f)} labelOf={characterLabel} searchFields={SEARCH_NAME} />;
          case 'songs':
            return <MultiRecordPicker<SongRec> key={f} collection="songs" label={t('Songs')} value={value.songs} onChange={set(f)} labelOf={songLabel} searchFields={SEARCH_TITLE} />;
          case 'recordings':
            return <MultiRecordPicker<RecordingRec> key={f} collection="recordings" label={t('Recordings')} value={value.recordings} onChange={set(f)} labelOf={recordingLabel} searchFields={SEARCH_TITLE} />;
          case 'matters':
            return <MultiRecordPicker<MatterRec> key={f} collection="matters" label={t('Trademarks and designs')} value={value.matters} onChange={set(f)} labelOf={matterLabel} searchFields={SEARCH_MATTER} />;
          default:
            return null;
        }
      })}
    </div>
  );
}

/** Names for the assets of a grant, from its expand (works, franchises, ...). */
export function expandedAssets(rec: RecordModel): { type: AssetType; id: string; label: string }[] {
  const ex = (rec.expand ?? {}) as Record<string, unknown>;
  const out: { type: AssetType; id: string; label: string }[] = [];
  for (const f of Object.keys(ASSET_TYPE) as AssetField[]) {
    const raw = ex[f];
    const list = Array.isArray(raw) ? (raw as Record<string, unknown>[]) : raw !== undefined && raw !== null ? [raw as Record<string, unknown>] : [];
    for (const r of list) {
      const id = typeof r['id'] === 'string' ? r['id'] : '';
      const name = typeof r['name'] === 'string' && r['name'] !== '' ? r['name'] : typeof r['title'] === 'string' ? r['title'] : '';
      const label = f === 'matters' ? `${typeof r['ref'] === 'string' ? r['ref'] : ''} ${name}`.trim() : name;
      if (id !== '') out.push({ type: ASSET_TYPE[f], id, label });
    }
  }
  return out;
}

export const ASSET_EXPAND = 'franchises,works,characters,songs,recordings,matters';

/* ------------------------------------------------------------------ */
/* Row editor for JSON list fields                                     */
/* ------------------------------------------------------------------ */

export interface RowCol<T> {
  key: string;
  label: string;
  /** Tailwind width class for the cell, e.g. "sm:w-36". Cells grow otherwise. */
  className?: string | undefined;
  render: (row: T, set: (patch: Partial<T>) => void) => ReactNode;
}

export function RowsEditor<T>({
  label,
  rows,
  onChange,
  blank,
  columns,
  addLabel,
  help,
  empty,
}: {
  label: string;
  rows: T[];
  onChange: (rows: T[]) => void;
  blank: () => T;
  columns: RowCol<T>[];
  addLabel?: string | undefined;
  help?: ReactNode | undefined;
  empty?: string | undefined;
}): React.JSX.Element {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium">{label}</span>
        <Button size="sm" variant="outline" className="h-7" onClick={() => onChange([...rows, blank()])}>
          <Plus size={13} aria-hidden /> {addLabel ?? t('Add a row')}
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className="border border-dashed border-[var(--agent-app-border)] px-3 py-2 text-xs text-[var(--agent-app-muted)]">{empty ?? t('No rows yet.')}</p>
      ) : (
        <div className="flex flex-col border border-[var(--agent-app-border)]">
          {rows.map((r, i) => (
            <div key={i} className="flex flex-wrap items-end gap-2 border-b border-[var(--agent-app-border)]/70 px-2 py-2 last:border-0">
              {columns.map((c) => (
                <div key={c.key} className={cn('flex min-w-[7rem] flex-1 flex-col gap-1', c.className)}>
                  <span className="text-[11px] text-[var(--agent-app-muted)]">{c.label}</span>
                  {c.render(r, (patch) => onChange(rows.map((x, j) => (j === i ? { ...x, ...patch } : x))))}
                </div>
              ))}
              <button
                type="button"
                aria-label={t('Remove row')}
                className="flex size-9 shrink-0 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600"
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
      {help !== undefined && <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</p>}
    </div>
  );
}

/** Plain inputs for RowsEditor cells (no label: the editor prints it). */
export function CellText({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string | undefined }): React.JSX.Element {
  return <input className={fieldCls} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />;
}

export function CellNum({ value, onChange, placeholder }: { value: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string | undefined }): React.JSX.Element {
  return (
    <input
      type="number"
      inputMode="decimal"
      step="any"
      className={cn(fieldCls, 'tabular-nums')}
      value={value === null || value === undefined || Number.isNaN(value) ? '' : value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    />
  );
}

export function CellDate({ value, onChange }: { value: string; onChange: (v: string) => void }): React.JSX.Element {
  return <input type="date" className={fieldCls} value={d10(value)} onChange={(e) => onChange(e.target.value)} />;
}

export function CellSelect({ value, onChange, options, placeholder }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; placeholder?: string | undefined }): React.JSX.Element {
  return <Select value={value} placeholder={placeholder} options={options} onChange={(e) => onChange(e.target.value)} />;
}

/* ------------------------------------------------------------------ */
/* Committee consent request (Copyright Act Art. 65)                   */
/* ------------------------------------------------------------------ */

export function ConsentOpenDialog({
  committeeId,
  subject: subjectIn,
  use,
  useLines,
  agreementId,
  onClose,
  onDone,
}: {
  committeeId: string;
  subject?: string | undefined;
  use?: Record<string, unknown> | undefined;
  useLines?: string[] | undefined;
  agreementId?: string | undefined;
  onClose: () => void;
  onDone?: ((id: string) => void) | undefined;
}): React.JSX.Element {
  const committees = useCollection<CommitteeRec>('committees', { sort: 'name' });
  const [committee, setCommittee] = useState(committeeId);
  const [subject, setSubject] = useState(subjectIn ?? '');
  const [due, setDue] = useState(addDays(today(), 14));
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    if (committee === '') {
      toast.error(t('Choose the committee.'));
      return;
    }
    if (subject.trim() === '') {
      toast.error(t('Describe the use you are asking about.'));
      return;
    }
    setBusy(true);
    const r = await opToast<{ id: string; status: string; answers: unknown[] }>(
      'consent/open',
      { committee_id: committee, subject: subject.trim(), use: use ?? {}, agreement_id: agreementId ?? '', due_date: due },
      t('Consent request opened. Members who use the portal answer there; record the others yourself.'),
    );
    setBusy(false);
    if (r === null) return;
    onDone?.(r.id);
    onClose();
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Ask the committee')}
      description={t('Every member is asked to approve the use. A member may refuse only with a reason (Copyright Act Art. 65(3)).')}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Send the request')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        {committeeId === '' && (
          <Select label={t('Committee')} value={committee} placeholder={t('Choose')} options={committees.records.map((c) => ({ value: c.id, label: c.name }))} onChange={(e) => setCommittee(e.target.value)} />
        )}
        <Textarea label={t('What are you asking about?')} rows={3} value={subject} onChange={(e) => setSubject(e.target.value)} placeholder={t('For example: acrylic stands of the main cast, sold in Taiwan through the window holder')} />
        {useLines !== undefined && useLines.length > 0 && (
          <div className="border border-[var(--agent-app-border)] px-3 py-2 text-xs leading-relaxed text-[var(--agent-app-muted)]">
            {useLines.map((l) => (
              <div key={l} className="break-words">
                {l}
              </div>
            ))}
          </div>
        )}
        <DateField label={t('Answer by')} value={due} onChange={setDue} help={t('Two weeks is usual. Members see the date in the portal.')} />
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Email draft by CraftBot                                             */
/* ------------------------------------------------------------------ */

export function EmailDraftDialog({
  subjectType,
  subjectId,
  defaultTo,
  suggestions,
  onClose,
}: {
  subjectType: string;
  subjectId: string;
  defaultTo?: string | undefined;
  suggestions?: string[] | undefined;
  onClose: () => void;
}): React.JSX.Element {
  const [purpose, setPurpose] = useState('');
  const [to, setTo] = useState(defaultTo ?? '');
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const send = async (): Promise<void> => {
    if (purpose.trim().length < 3) {
      toast.error(t('Say what the email is for.'));
      return;
    }
    setBusy(true);
    const params: Record<string, unknown> = { subject_type: subjectType, subject_id: subjectId, purpose: purpose.trim() };
    if (to.trim() !== '') params['to'] = to.trim();
    const id = await handToCraftBot('email_draft_requested', params);
    setBusy(false);
    if (id !== null) setRequestId(id);
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Email draft')}
      description={t('CraftBot drafts the email from this record, you check it and send it. Nothing is sent automatically.')}
      className="w-[min(94vw,36rem)]"
      footer={
        requestId === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void send()} loading={busy}>
              <Mail size={14} aria-hidden /> {t('Draft the email|rights')}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('Close')}</Button>
        )
      }
    >
      <div className="flex flex-col gap-3">
        <Textarea label={t('What is the email for?')} rows={3} value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={requestId !== null} />
        {requestId === null && suggestions !== undefined && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((s) => (
              <button key={s} type="button" className="border border-[var(--agent-app-border)] px-2 py-1 text-left text-xs text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-border)]/30" onClick={() => setPurpose(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <Input label={t('To (optional)')} type="email" value={to} onChange={(e) => setTo(e.target.value)} disabled={requestId !== null} placeholder="name@example.com" />
        {requestId !== null && <AgentStatus requestId={requestId} workingText={t('CraftBot is drafting the email...')} doneText={t('Draft ready. Check your email drafts, or read it here.')} />}
        {requestId === null && <Notice tone="neutral">{t('CraftBot drafts it, you send it.|rights')}</Notice>}
      </div>
    </Dialog>
  );
}
