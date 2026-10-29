/**
 * Fields of people, companies and deals (built-in and custom): how a value
 * reads, and how it is edited in place. The same specs drive table cells,
 * the details panel and filters. Edits go through records.update, so the
 * server cleans the value (emails, domains, money) and logs it.
 */
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Check, ExternalLink, Star } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { day, money, parseMoney, relDay, since, toDecimal } from '../lib/format.ts';
import type { AppState } from '../lib/store.tsx';
import type { AnyRecord, Company, Deal, FieldDef, Obj, Person } from '../lib/types.ts';
import { DateInput, MoneyInput, Picker, ProvMark, RecordPicker, Tag, TagsInput } from './controls.tsx';
import { Select, area, input } from './ui.tsx';

export interface FSpec {
  key: string;
  label: string;
  type: string;
  options?: string[] | undefined;
  readOnly?: boolean | undefined;
}

export const SIZES = ['1-10', '11-50', '51-200', '201-1000', '1001-5000', '5000+'];

const BUILTIN: Record<Obj, FSpec[]> = {
  people: [
    { key: 'first_name', label: 'First name', type: 'text' },
    { key: 'last_name', label: 'Last name', type: 'text' },
    { key: 'emails', label: 'Emails', type: 'emails' },
    { key: 'phones', label: 'Phones', type: 'phones' },
    { key: 'title', label: 'Title', type: 'text' },
    { key: 'company', label: 'Company', type: 'company' },
    { key: 'linkedin', label: 'LinkedIn', type: 'url' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'birthday', label: 'Birthday', type: 'birthday' },
    { key: 'how_met', label: 'How you know them', type: 'longtext' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'keep_in_touch', label: 'Keep in touch', type: 'cadence' },
    { key: 'tags', label: 'Tags', type: 'tags' },
  ],
  companies: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'domains', label: 'Domains', type: 'domains' },
    { key: 'industry', label: 'Industry', type: 'text' },
    { key: 'size', label: 'Size', type: 'select', options: SIZES },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'description', label: 'Description', type: 'longtext' },
    { key: 'linkedin', label: 'LinkedIn', type: 'url' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'tags', label: 'Tags', type: 'tags' },
  ],
  deals: [
    { key: 'name', label: 'Name', type: 'text' },
    { key: 'value', label: 'Value', type: 'money' },
    { key: 'currency', label: 'Currency', type: 'currency' },
    { key: 'expected_close', label: 'Expected close', type: 'date' },
    { key: 'probability', label: 'Probability', type: 'percent' },
    { key: 'company', label: 'Company', type: 'company' },
    { key: 'next_step', label: 'Next step', type: 'text' },
    { key: 'next_step_date', label: 'Next step date', type: 'date' },
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'lost_reason', label: 'Lost reason', type: 'text' },
    { key: 'tags', label: 'Tags', type: 'tags' },
  ],
};

export function customSpec(f: FieldDef): FSpec {
  return { key: 'custom.' + f.key, label: f.label, type: 'custom_' + f.type, options: f.options };
}

export function specsOf(app: AppState, o: Obj): FSpec[] {
  return [...BUILTIN[o], ...app.fieldsOf(o).map(customSpec)];
}

export const CADENCES = [
  { value: '0', label: 'Not tracked' },
  { value: '7', label: 'Every week' },
  { value: '14', label: 'Every 2 weeks' },
  { value: '30', label: 'Every month' },
  { value: '60', label: 'Every 2 months' },
  { value: '90', label: 'Every quarter' },
  { value: '180', label: 'Twice a year' },
  { value: '365', label: 'Every year' },
];

/* ---------------------------------------------------------------- values */

export function rawValue(rec: AnyRecord, spec: FSpec): unknown {
  if (spec.key.startsWith('custom.')) {
    const v = rec.custom[spec.key.slice(7)];
    return v === undefined ? null : v;
  }
  if (spec.key === 'probability') {
    const d = rec as Deal;
    return d.prob_override >= 0 ? d.prob_override : null;
  }
  return (rec as unknown as Record<string, unknown>)[spec.key] ?? null;
}

function isBlank(v: unknown): boolean {
  return v === null || v === undefined || v === '' || (Array.isArray(v) && v.length === 0) || v === 0 || v === false;
}

/** How a value reads. */
export function Display({ rec, spec, app, compact = false }: { rec: AnyRecord; spec: FSpec; app: AppState; compact?: boolean | undefined }): React.JSX.Element {
  const v = rawValue(rec, spec);
  const dim = <span className="text-[var(--cr-muted)]">{compact ? '' : 'Empty'}</span>;
  switch (spec.type) {
    case 'emails':
    case 'phones':
    case 'domains': {
      const list = (v as string[] | null) ?? [];
      if (list.length === 0) return dim;
      return (
        <span className={cn('flex min-w-0 gap-x-2', compact ? 'truncate' : 'flex-wrap')}>
          {list.map((x, i) =>
            spec.type === 'emails' ? (
              <a key={x} href={'mailto:' + x} onClick={(e) => e.stopPropagation()} className={cn('truncate hover:underline', i > 0 && 'text-[var(--cr-ink-2)]')}>
                {x}
              </a>
            ) : spec.type === 'domains' ? (
              <a key={x} href={'https://' + x} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="truncate hover:underline">
                {x}
              </a>
            ) : (
              <span key={x} className="num truncate">
                {x}
              </span>
            ),
          )}
        </span>
      );
    }
    case 'tags': {
      const list = (v as string[] | null) ?? [];
      if (list.length === 0) return dim;
      return (
        <span className={cn('flex min-w-0 gap-1', compact ? 'overflow-hidden' : 'flex-wrap')}>
          {list.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </span>
      );
    }
    case 'url':
    case 'custom_url':
      if (isBlank(v)) return dim;
      return (
        <a href={String(v)} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex min-w-0 items-center gap-1 truncate hover:underline">
          <span className="truncate">{String(v).replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '')}</span>
          <ExternalLink size={11} className="shrink-0 text-[var(--cr-muted)]" />
        </a>
      );
    case 'company': {
      const r = rec as Person | Deal;
      if (r.company === '') return dim;
      return <span className="truncate">{r.company_name}</span>;
    }
    case 'money': {
      const d = rec as Deal;
      return <span className="num">{money(d.value, d.currency)}</span>;
    }
    case 'percent': {
      const d = rec as Deal;
      return (
        <span className="num">
          {d.probability}%{d.prob_override < 0 && !compact && <span className="ml-1 text-[11px] text-[var(--cr-muted)]">from the stage</span>}
        </span>
      );
    }
    case 'cadence': {
      const n = v as number;
      if (!n) return dim;
      return <span>{CADENCES.find((c) => c.value === String(n))?.label ?? 'Every ' + n + ' days'}</span>;
    }
    case 'date':
    case 'custom_date':
      if (isBlank(v)) return dim;
      return <span className="num">{compact ? relDay(String(v)) : day(String(v))}</span>;
    case 'birthday': {
      if (isBlank(v)) return dim;
      const s = String(v);
      return <span className="num">{s.length === 5 ? day('2000-' + s).replace(' 2000', '') : day(s)}</span>;
    }
    case 'custom_currency':
      if (v === null) return dim;
      return <span className="num">{money(v as number, app.home)}</span>;
    case 'custom_checkbox':
      return v === true ? <Check size={14} strokeWidth={2.4} /> : dim;
    case 'custom_rating': {
      const n = (v as number | null) ?? 0;
      if (!n) return dim;
      return (
        <span className="inline-flex gap-px text-[var(--cr-warn)]" aria-label={n + ' of 5'}>
          {[1, 2, 3, 4, 5].map((i) => (
            <Star key={i} size={12} fill={i <= n ? 'currentColor' : 'none'} strokeWidth={1.8} className={i <= n ? '' : 'text-[var(--cr-line)]'} />
          ))}
        </span>
      );
    }
    case 'custom_multi_select': {
      const list = (v as string[] | null) ?? [];
      if (list.length === 0) return dim;
      return (
        <span className="flex min-w-0 flex-wrap gap-1">
          {list.map((t) => (
            <Tag key={t}>{t}</Tag>
          ))}
        </span>
      );
    }
    default:
      if (isBlank(v)) return dim;
      return <span className={cn(compact ? 'truncate' : 'cr-prose')}>{String(v)}</span>;
  }
}

/* ---------------------------------------------------------------- editing */

/** The value to send for a field, from the editor's text. */
function toInput(spec: FSpec, text: string, rec: AnyRecord): unknown {
  if (spec.type === 'emails' || spec.type === 'phones' || spec.type === 'domains') return text.split(/[,;\n]+/).map((x) => x.trim()).filter((x) => x !== '');
  if (spec.type === 'money') {
    const v = parseMoney(text, (rec as Deal).currency);
    return v === null ? '' : toDecimal(v, (rec as Deal).currency);
  }
  return text;
}

export async function saveField(object: Obj, rec: AnyRecord, spec: FSpec, value: unknown): Promise<boolean> {
  try {
    const r = await api.update(object, rec.id, { [spec.key]: value });
    if (r.proposed) toast.success('Sent for review');
    return true;
  } catch (err) {
    toast.error(errMessage(err));
    return false;
  }
}

/**
 * An editor for one field, shown in place (a cell or a details row). It
 * commits on Enter or blur (Escape cancels); pickers commit on choice.
 */
export function Editor({ object, rec, spec, app, onDone }: { object: Obj; rec: AnyRecord; spec: FSpec; app: AppState; onDone: () => void }): React.JSX.Element {
  const v = rawValue(rec, spec);
  const initial = (() => {
    if (spec.type === 'emails' || spec.type === 'phones' || spec.type === 'domains') return ((v as string[] | null) ?? []).join(', ');
    if (spec.type === 'money') return toDecimal((rec as Deal).value, (rec as Deal).currency);
    if (spec.type === 'percent') return v === null ? '' : String(v);
    if (v === null || v === undefined) return '';
    return String(v);
  })();
  const [text, setText] = useState(initial);
  const done = useRef(false);
  const commit = async (val?: unknown): Promise<void> => {
    if (done.current) return;
    done.current = true;
    const next = val !== undefined ? val : toInput(spec, text, rec);
    if (val === undefined && text === initial) return onDone();
    await saveField(object, rec, spec, next);
    onDone();
  };
  const keys = {
    onKeyDown: (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !(spec.type === 'longtext' && e.shiftKey)) {
        e.preventDefault();
        void commit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done.current = true;
        onDone();
      }
    },
  };
  const box = 'h-7 w-full';
  switch (spec.type) {
    case 'longtext':
      return <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void commit()} rows={3} className={area} {...keys} />;
    case 'tags':
    case 'custom_multi_select':
      if (spec.type === 'custom_multi_select')
        return (
          <Picker
            autoOpen
            value=""
            onChange={(x) => {
              const cur = ((v as string[] | null) ?? []).slice();
              const next = cur.includes(x) ? cur.filter((y) => y !== x) : [...cur, x];
              void commit(next);
            }}
            options={(spec.options ?? []).map((o) => ({ value: o, label: o, hint: ((v as string[] | null) ?? []).includes(o) ? 'selected' : '' }))}
            label={spec.label}
          />
        );
      return <TagsEdit value={(v as string[] | null) ?? []} onCommit={(t) => void commit(t)} onCancel={onDone} />;
    case 'company':
      return (
        <RecordPicker
          object="companies"
          value={(rec as Person).company}
          valueLabel={(rec as Person).company_name}
          onChange={(id, name, created) => void commit(created ? name : id)}
          label="Company"
          create="Add company"
        />
      );
    case 'select':
    case 'custom_select':
      return <Picker autoOpen value={String(v ?? '')} onChange={(x) => void commit(x)} options={(spec.options ?? []).map((o) => ({ value: o, label: o }))} label={spec.label} clearable />;
    case 'currency':
      return <Picker autoOpen value={String(v ?? '')} onChange={(x) => void commit(x)} options={app.currencies.map((c) => ({ value: c.code, label: c.code, hint: c.name }))} label="Currency" />;
    case 'cadence':
      return <Select label={spec.label} value={String(v ?? 0)} onChange={(x) => void commit(Number(x))} options={CADENCES} className={box} />;
    case 'date':
    case 'custom_date':
      return <DateInput value={text} onChange={(x) => void commit(x)} label={spec.label} className={box} />;
    case 'money':
      return <MoneyInput autoFocus value={text} onChange={setText} onEnter={() => void commit()} label={spec.label} className={box} />;
    case 'custom_checkbox':
      return (
        <Select
          label={spec.label}
          value={v === true ? 'yes' : 'no'}
          onChange={(x) => void commit(x === 'yes')}
          options={[
            { value: 'yes', label: 'Yes' },
            { value: 'no', label: 'No' },
          ]}
          className={box}
        />
      );
    case 'custom_rating':
      return (
        <span className="inline-flex h-7 items-center gap-0.5">
          {[1, 2, 3, 4, 5].map((i) => (
            <button key={i} type="button" aria-label={i + ' stars'} onClick={() => void commit(i === v ? 0 : i)} className="text-[var(--cr-warn)]">
              <Star size={15} fill={i <= Number(v ?? 0) ? 'currentColor' : 'none'} />
            </button>
          ))}
        </span>
      );
    default:
      return <input autoFocus value={text} onChange={(e) => setText(e.target.value)} onBlur={() => void commit()} className={cn(input, box)} placeholder={spec.type === 'birthday' ? 'MM-DD or YYYY-MM-DD' : spec.type === 'percent' ? 'Empty for the stage probability' : spec.type === 'emails' ? 'a@x.com, b@y.com' : ''} {...keys} />;
  }
}

function TagsEdit({ value, onCommit, onCancel }: { value: string[]; onCommit: (t: string[]) => void; onCancel: () => void }): React.JSX.Element {
  const [t, setT] = useState(value);
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent): void => {
      if (ref.current !== null && !ref.current.contains(e.target as Node)) {
        if (JSON.stringify(t) !== JSON.stringify(value)) onCommit(t);
        else onCancel();
      }
    };
    const tm = setTimeout(() => document.addEventListener('mousedown', onDoc), 0);
    return () => {
      clearTimeout(tm);
      document.removeEventListener('mousedown', onDoc);
    };
  }, [t, value, onCommit, onCancel]);
  return (
    <div
      ref={ref}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel();
        if (e.key === 'Enter' && (e.target as HTMLInputElement).value === '') onCommit(t);
      }}
    >
      <TagsInput value={t} onChange={setT} />
    </div>
  );
}

/** A details row: label, value (click to edit), the AI mark. */
export function DetailRow({ object, rec, spec, app, extra }: { object: Obj; rec: AnyRecord; spec: FSpec; app: AppState; extra?: ReactNode | undefined }): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const prov = rec.prov[spec.key];
  return (
    <div className="group flex min-h-8 items-start gap-2 py-1">
      <span className="w-[108px] shrink-0 pt-[5px] text-[12px] text-[var(--cr-muted)]">{spec.label}</span>
      <div className="min-w-0 flex-1">
        {editing && !spec.readOnly ? (
          <Editor object={object} rec={rec} spec={spec} app={app} onDone={() => setEditing(false)} />
        ) : (
          <button type="button" disabled={spec.readOnly} onClick={() => setEditing(true)} className="flex min-h-7 w-full min-w-0 items-center gap-1.5 px-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--cr-row)] disabled:hover:bg-transparent">
            <span className="min-w-0 flex-1">
              <Display rec={rec} spec={spec} app={app} />
            </span>
            <ProvMark prov={prov} />
          </button>
        )}
        {extra}
      </div>
    </div>
  );
}

/** "Last contacted 3 d ago" style helper. */
export function lastSeen(r: Person | Company): string {
  return r.last_interaction ? since(r.last_interaction) : 'never';
}
