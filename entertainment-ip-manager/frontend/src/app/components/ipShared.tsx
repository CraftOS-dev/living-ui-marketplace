/**
 * Building blocks shared by the IP catalogue pages (franchises, characters,
 * talents, titles): names in every script, thumbnails, date, birthday and
 * image fields, JSON row editors, a people multi-select, tree helpers and a
 * tree table, a small responsive table, and the tab strip of a record page.
 */
import { Fragment, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, ImagePlus, Plus, X } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, Input, Select, Tabs, TabsList, TabsTrigger, cn } from '../../kit/index.ts';
import { fileUrl, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtShort, today } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import type { CastingRec } from '../lib/records.ts';
import type { NameEntry } from '../lib/shapes.ts';
import { Field, IdentityChip, Tag } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Names in every script                                               */
/* ------------------------------------------------------------------ */

export const NAME_SCRIPTS = ['ja', 'kana', 'en', 'romaji', 'zh_hans', 'zh_hant', 'ko'] as const;

export function scriptLabel(s: string): string {
  switch (s) {
    case 'ja':
      return t('Japanese');
    case 'kana':
      return t('Kana reading');
    case 'en':
      return t('English');
    case 'romaji':
      return t('Romaji');
    case 'zh_hans':
      return t('Simplified Chinese');
    case 'zh_hant':
      return t('Traditional Chinese');
    case 'ko':
      return t('Korean');
    default:
      return s;
  }
}

/** The non-empty entries of a names JSON field. */
export function namesOf(v: NameEntry[] | null | undefined): NameEntry[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x) => typeof x === 'object' && x !== null && typeof x.value === 'string' && x.value.trim() !== '');
}

/** Every way a record is written, joined for searching. */
export function namesText(v: NameEntry[] | null | undefined): string {
  return namesOf(v)
    .map((n) => n.value)
    .join(' ');
}

/** Case-insensitive match of a search term against several texts. */
export function matchesTerm(term: string, ...texts: string[]): boolean {
  const q = term.trim().toLowerCase();
  if (q === '') return true;
  return texts.some((x) => x.toLowerCase().includes(q));
}

/** Names in other scripts, shown under a record's main name. */
export function NamesLine({ names, primary, className }: { names: NameEntry[] | null | undefined; primary: string; className?: string | undefined }): React.JSX.Element | null {
  const list = namesOf(names).filter((n) => n.value !== primary);
  if (list.length === 0) return null;
  return (
    <div className={cn('flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--agent-app-muted)]', className)}>
      {list.map((n, i) => (
        <span key={`${n.script}-${i}`} className="inline-flex min-w-0 items-center gap-1.5">
          <Tag>{scriptLabel(n.script)}</Tag>
          <span className="min-w-0 break-words text-[var(--agent-app-text)]/85">{n.value}</span>
        </span>
      ))}
    </div>
  );
}

/** First name in another script (for list secondary lines). */
export function altName(names: NameEntry[] | null | undefined, primary: string): string {
  return namesOf(names).find((n) => n.value !== primary)?.value ?? '';
}

export function NamesEditor({ value, onChange }: { value: NameEntry[]; onChange: (v: NameEntry[]) => void }): React.JSX.Element {
  const options = NAME_SCRIPTS.map((s) => ({ value: s, label: scriptLabel(s) }));
  const set = (i: number, patch: Partial<NameEntry>): void => onChange(value.map((n, j) => (j === i ? { ...n, ...patch } : n)));
  const nextScript = NAME_SCRIPTS.find((s) => !value.some((n) => n.script === s)) ?? 'en';
  return (
    <Field label={t('Names in other scripts')} help={t('Japanese, kana reading, English, romaji, Chinese and Korean spellings. Search finds a record by any of them.')}>
      <div className="flex flex-col gap-2">
        {value.map((n, i) => (
          <div key={i} className="flex min-w-0 items-center gap-2">
            <div className="w-32 shrink-0 sm:w-40">
              <Select aria-label={t('Script|writing system')} value={n.script} options={options} onChange={(e) => set(i, { script: e.target.value })} />
            </div>
            <div className="min-w-0 flex-1">
              <Input aria-label={scriptLabel(n.script)} value={n.value} onChange={(e) => set(i, { value: e.target.value })} />
            </div>
            <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
              <X size={14} aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { script: nextScript, value: '' }])}>
            <Plus size={13} aria-hidden /> {t('Add a name')}
          </Button>
        </div>
      </div>
    </Field>
  );
}

/* ------------------------------------------------------------------ */
/* Thumbnails, dates, images                                           */
/* ------------------------------------------------------------------ */

/** Record image thumbnail, or a square identity chip when there is none. */
export function Thumb({ record, image, name, size = 'md' }: { record: RecordModel; image: string; name: string; size?: 'sm' | 'md' | 'lg' | 'xl' | undefined }): React.JSX.Element {
  const box = size === 'sm' ? 'size-6' : size === 'md' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-20';
  const label = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || name;
  if (image !== '') {
    return (
      <img
        src={fileUrl(record, image, size === 'xl' || size === 'lg' ? '400x0' : '100x100')}
        alt=""
        loading="lazy"
        className={cn(box, 'shrink-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] object-cover')}
      />
    );
  }
  if (size === 'lg' || size === 'xl') return <IdentityChip name={label} square className={cn(box, size === 'xl' ? 'text-xl' : 'text-sm')} />;
  return <IdentityChip name={label} square size={size === 'sm' ? 'sm' : 'md'} />;
}

const DATE_CLASS = 'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm';

/** Calendar-day input bound to 'YYYY-MM-DD' ('' when empty). */
export function DateField({
  label,
  value,
  onChange,
  help,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode | undefined;
  required?: boolean | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} required={required} htmlFor={id}>
      <input id={id} type="date" className={DATE_CLASS} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

const MMDD = /^(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isMonthDay(v: string): boolean {
  return MMDD.test(v);
}

/** A "MM-DD" birthday as "14 Mar" / "3月14日". */
export function fmtBirthday(v: string): string {
  if (!MMDD.test(v)) return v;
  return fmtShort(`${today().slice(0, 4)}-${v}`);
}

export function BirthdayField({ value, onChange, label }: { value: string; onChange: (v: string) => void; label?: string | undefined }): React.JSX.Element {
  const id = useId();
  const bad = value !== '' && !MMDD.test(value);
  return (
    <Field label={label ?? t('Birthday')} htmlFor={id} help={t('Month and day only, as MM-DD (for example 03-14).')} error={bad ? t('Use the form MM-DD, for example 03-14.') : undefined}>
      <input id={id} className={DATE_CLASS} placeholder="MM-DD" maxLength={5} value={value} onChange={(e) => onChange(e.target.value.trim())} />
    </Field>
  );
}

/** Image chooser with preview, keep, replace or remove. */
export function ImageField({
  record,
  current,
  file,
  removed,
  onFile,
  onRemove,
}: {
  record: RecordModel | null;
  current: string;
  file: File | null;
  removed: boolean;
  onFile: (f: File | null) => void;
  onRemove: (v: boolean) => void;
}): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState('');
  useEffect(() => {
    if (file === null) {
      setPreview('');
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const existing = record !== null && current !== '' && !removed ? fileUrl(record, current, '100x100') : '';
  const shown = preview || existing;
  return (
    <Field label={t('Image')} help={t('PNG, JPG, WebP or SVG, up to 10 MB.')}>
      <div className="flex flex-wrap items-center gap-3">
        {shown !== '' ? (
          <img src={shown} alt="" className="size-14 shrink-0 border border-[var(--agent-app-border)] object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center border border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-muted)]">
            <ImagePlus size={18} aria-hidden />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            {shown !== '' ? t('Replace') : t('Choose image')}
          </Button>
          {shown !== '' && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                if (file !== null) onFile(null);
                else onRemove(true);
              }}
            >
              <X size={13} aria-hidden /> {t('Remove')}
            </Button>
          )}
        </div>
        <input
          ref={input}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) {
              onFile(f);
              onRemove(false);
            }
            e.target.value = '';
          }}
        />
      </div>
    </Field>
  );
}

/** Save an image field after the record itself was saved. */
export async function saveImage(collection: string, id: string, file: File | null, removed: boolean): Promise<void> {
  if (file !== null) {
    const fd = new FormData();
    fd.append('image', file);
    await updateRecord(collection, id, fd);
  } else if (removed) {
    await updateRecord(collection, id, { image: null });
  }
}

/** "1 Apr 2024 to 31 Mar 2026", "From 1 Apr 2024", "Until 31 Mar 2026". */
export function spanText(start: string, end: string): string {
  const s = d10(start);
  const e = d10(end);
  if (s !== '' && e !== '') return t('{from} to {to}|span', { from: fmtDate(s), to: fmtDate(e) });
  if (s !== '') return t('From {date}', { date: fmtDate(s) });
  if (e !== '') return t('Until {date}', { date: fmtDate(e) });
  return '';
}

/** Plain text of an editor field (which may hold HTML). */
export function plainText(v: string): string {
  if (v.trim() === '' || typeof DOMParser === 'undefined') return v;
  return new DOMParser().parseFromString(v, 'text/html').body.textContent ?? '';
}

export function yesNo(v: boolean): string {
  return v ? t('Yes') : t('No');
}

/** Rows of a JSON array field ([] when not an array). */
export function asRows<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** Country and region codes for copyright lines and publication countries. */
export const PLACE_CODES = ['JP', 'US', 'CN', 'KR', 'TW', 'HK', 'MO', 'SG', 'TH', 'VN', 'ID', 'MY', 'PH', 'IN', 'AU', 'NZ', 'CA', 'MX', 'BR', 'GB', 'EU', 'DE', 'FR', 'IT', 'ES', 'RU', 'SA', 'AE'];

export function placeOptions(): { value: string; label: string }[] {
  return PLACE_CODES.map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }));
}

/* ------------------------------------------------------------------ */
/* Castings: who plays a character now                                  */
/* ------------------------------------------------------------------ */

/** A casting runs today when it has started (or has no start) and has not ended. */
export function isCurrentCasting(c: CastingRec, day: string = today()): boolean {
  const s = d10(c.start_date);
  const e = d10(c.end_date);
  return (s === '' || s <= day) && (e === '' || e >= day);
}

/* ------------------------------------------------------------------ */
/* JSON row editor                                                     */
/* ------------------------------------------------------------------ */

export interface RowCol {
  key: string;
  label: string;
  kind?: 'text' | 'number' | 'select' | 'date' | undefined;
  options?: { value: string; label: string }[] | undefined;
  placeholder?: string | undefined;
  /** Relative width on wider screens. */
  grow?: number | undefined;
}

export type EditRow = Record<string, string>;

/** Editable rows of a JSON array field; every cell is a string while editing. */
export function RowsEditor({
  label,
  help,
  cols,
  rows,
  onChange,
  addLabel,
}: {
  label: string;
  help?: ReactNode | undefined;
  cols: RowCol[];
  rows: EditRow[];
  onChange: (rows: EditRow[]) => void;
  addLabel: string;
}): React.JSX.Element {
  const blank = (): EditRow => Object.fromEntries(cols.map((c) => [c.key, c.kind === 'select' ? (c.options?.[0]?.value ?? '') : ''])) as EditRow;
  const set = (i: number, key: string, v: string): void => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: v } : r)));
  return (
    <Field label={label} help={help}>
      <div className="flex flex-col gap-2">
        {rows.length > 0 && (
          <div className="hidden gap-2 pr-10 sm:flex">
            {cols.map((c) => (
              <span key={c.key} className="min-w-0 text-[11px] font-medium text-[var(--agent-app-muted)]" style={{ flex: `${c.grow ?? 1} 1 0` }}>
                {c.label}
              </span>
            ))}
          </div>
        )}
        {rows.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2 border-b border-[var(--agent-app-border)]/50 pb-2 sm:flex-nowrap sm:border-0 sm:pb-0">
            {cols.map((c) => (
              <div key={c.key} className="min-w-0 basis-full sm:basis-auto" style={{ flex: `${c.grow ?? 1} 1 0` }}>
                {c.kind === 'select' ? (
                  <Select aria-label={c.label} value={r[c.key] ?? ''} options={c.options ?? []} onChange={(e) => set(i, c.key, e.target.value)} />
                ) : (
                  <Input
                    aria-label={c.label}
                    placeholder={c.placeholder ?? c.label}
                    type={c.kind === 'number' ? 'number' : c.kind === 'date' ? 'date' : 'text'}
                    value={r[c.key] ?? ''}
                    onChange={(e) => set(i, c.key, e.target.value)}
                  />
                )}
              </div>
            ))}
            <Button size="icon" variant="ghost" className="size-8 shrink-0" aria-label={t('Remove')} onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X size={14} aria-hidden />
            </Button>
          </div>
        ))}
        <div>
          <Button size="sm" variant="outline" onClick={() => onChange([...rows, blank()])}>
            <Plus size={13} aria-hidden /> {addLabel}
          </Button>
        </div>
      </div>
    </Field>
  );
}

/** Numbers typed into a row editor: '' stays empty, anything else becomes a number. */
export function numOrNull(v: string | undefined): number | null {
  if (v === undefined || v.trim() === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------ */
/* People                                                              */
/* ------------------------------------------------------------------ */

const EXTERNAL = new Set(['licensee', 'committee_member', 'reviewer']);

export function UserMultiSelect({ value, onChange, label, help }: { value: string[]; onChange: (ids: string[]) => void; label: string; help?: ReactNode | undefined }): React.JSX.Element {
  const { users, userName } = useApp();
  const pool = users.filter((u) => !EXTERNAL.has(u.role) && !value.includes(u.id)).map((u) => ({ value: u.id, label: u.name || u.email }));
  return (
    <Field label={label} help={help}>
      <div className="flex flex-col gap-2">
        {value.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {value.map((id) => (
              <span key={id} className="inline-flex max-w-full items-center gap-1.5 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-2 py-0.5 text-xs">
                <IdentityChip name={userName(id)} size="xs" />
                <span className="truncate">{userName(id)}</span>
                <button type="button" aria-label={t('Remove')} onClick={() => onChange(value.filter((x) => x !== id))} className="text-[var(--agent-app-muted)] hover:text-red-600">
                  <X size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <Select
          aria-label={label}
          value=""
          placeholder={t('Add a person')}
          options={pool}
          onChange={(e) => {
            if (e.target.value !== '') onChange([...value, e.target.value]);
          }}
        />
      </div>
    </Field>
  );
}

export function PeopleChips({ ids }: { ids: string[] }): React.JSX.Element | null {
  const { userName } = useApp();
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex min-w-0 flex-wrap items-center gap-1.5">
      {ids.map((id) => (
        <span key={id} className="inline-flex items-center gap-1">
          <IdentityChip name={userName(id)} size="xs" />
          <span className="text-[13px]">{userName(id)}</span>
        </span>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Trees                                                               */
/* ------------------------------------------------------------------ */

interface TreeNode {
  id: string;
  parent: string;
}

/** Children by parent id; '' holds the roots (no parent, or a parent not in the list). */
export function childrenOf<T extends TreeNode>(items: readonly T[]): Map<string, T[]> {
  const ids = new Set(items.map((i) => i.id));
  const m = new Map<string, T[]>();
  for (const it of items) {
    const p = it.parent !== '' && it.parent !== it.id && ids.has(it.parent) ? it.parent : '';
    const arr = m.get(p);
    if (arr === undefined) m.set(p, [it]);
    else arr.push(it);
  }
  return m;
}

/** Every id below `rootId` (not including it). */
export function descendantIds<T extends TreeNode>(items: readonly T[], rootId: string): Set<string> {
  const kids = childrenOf(items);
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (cur === undefined) break;
    for (const c of kids.get(cur) ?? []) {
      if (!out.has(c.id) && c.id !== rootId) {
        out.add(c.id);
        stack.push(c.id);
      }
    }
  }
  return out;
}

/** Ancestors of an item, nearest first. */
export function ancestorsOf<T extends TreeNode>(items: readonly T[], id: string): T[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out: T[] = [];
  const seen = new Set<string>([id]);
  let cur = byId.get(id)?.parent ?? '';
  while (cur !== '' && !seen.has(cur)) {
    seen.add(cur);
    const node = byId.get(cur);
    if (node === undefined) break;
    out.push(node);
    cur = node.parent;
  }
  return out;
}

/** Matching ids plus all their ancestors, so filtered trees keep their context. */
export function withAncestors<T extends TreeNode>(items: readonly T[], match: (t: T) => boolean): Set<string> {
  const byId = new Map(items.map((i) => [i.id, i]));
  const out = new Set<string>();
  for (const it of items) {
    if (!match(it)) continue;
    let cur: T | undefined = it;
    while (cur !== undefined && !out.has(cur.id)) {
      out.add(cur.id);
      cur = cur.parent !== '' ? byId.get(cur.parent) : undefined;
    }
  }
  return out;
}

export interface TreeCol<T> {
  key: string;
  label: string;
  render: (r: T) => ReactNode;
  align?: 'left' | 'right' | undefined;
  /** Extra classes on th and td, e.g. 'hidden md:table-cell'. */
  className?: string | undefined;
}

/**
 * Parent and child rows in one table: children indented under their parent,
 * every parent expands or collapses. `visible` limits the rows (matches plus
 * their ancestors); `expandAll` opens everything while filtering.
 */
export function TreeTable<T extends TreeNode>({
  items,
  primaryLabel,
  primary,
  columns,
  rowHref,
  visible = null,
  expandAll = false,
  isMatch,
}: {
  items: readonly T[];
  primaryLabel: string;
  primary: (r: T) => ReactNode;
  columns: TreeCol<T>[];
  rowHref: (r: T) => string;
  visible?: Set<string> | null | undefined;
  expandAll?: boolean | undefined;
  isMatch?: ((r: T) => boolean) | undefined;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const kids = useMemo(() => childrenOf(items), [items]);
  const roots = useMemo(() => {
    const base = kids.get('') ?? [];
    const reach = new Set<string>();
    const stack = [...base];
    while (stack.length > 0) {
      const cur = stack.pop();
      if (cur === undefined || reach.has(cur.id)) continue;
      reach.add(cur.id);
      for (const c of kids.get(cur.id) ?? []) stack.push(c);
    }
    return [...base, ...items.filter((i) => !reach.has(i.id))];
  }, [kids, items]);

  const rows: { item: T; depth: number; hasKids: boolean; open: boolean }[] = [];
  const seen = new Set<string>();
  const walk = (list: readonly T[], depth: number): void => {
    for (const it of list) {
      if (seen.has(it.id)) continue;
      if (visible !== null && !visible.has(it.id)) continue;
      seen.add(it.id);
      const ch = (kids.get(it.id) ?? []).filter((c) => visible === null || visible.has(c.id));
      const open = expandAll || !collapsed.has(it.id);
      rows.push({ item: it, depth, hasKids: ch.length > 0, open });
      if (open) walk(ch, depth + 1);
    }
  };
  walk(roots, 0);

  const parents = items.filter((i) => (kids.get(i.id) ?? []).length > 0).map((i) => i.id);
  const toggle = (id: string): void =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
            <th className="whitespace-nowrap px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
              <span className="inline-flex items-center gap-3">
                {primaryLabel}
                {parents.length > 0 && !expandAll && (
                  <button
                    type="button"
                    className="font-normal normal-case tracking-normal text-[var(--agent-app-accent)] hover:underline"
                    onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(parents))}
                  >
                    {collapsed.size > 0 ? t('Expand all') : t('Collapse all')}
                  </button>
                )}
              </span>
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                className={cn(
                  'whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]',
                  c.align === 'right' ? 'text-right' : 'text-left',
                  c.className,
                )}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ item, depth, hasKids, open }) => {
            const context = isMatch !== undefined && visible !== null && !isMatch(item);
            return (
              <tr
                key={item.id}
                onClick={() => {
                  window.location.hash = rowHref(item);
                }}
                className={cn('cursor-pointer border-b border-[var(--agent-app-border)]/60 last:border-0 hover:bg-[var(--agent-app-border)]/20', context && 'opacity-60')}
              >
                <td className="py-2 pr-3" style={{ paddingLeft: 12 + Math.min(depth, 4) * 18 }}>
                  <div className="flex min-w-0 items-center gap-2">
                    {hasKids ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? t('Collapse') : t('Expand')}
                        disabled={expandAll}
                        className="flex size-5 shrink-0 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] disabled:opacity-60"
                        onClick={(e) => {
                          e.stopPropagation();
                          toggle(item.id);
                        }}
                      >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      </button>
                    ) : (
                      <span className="w-5 shrink-0" aria-hidden />
                    )}
                    {primary(item)}
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.key} className={cn('px-3 py-2 align-middle', c.align === 'right' ? 'text-right tabular-nums' : 'text-left', c.className)}>
                    {c.render(item)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A primary-cell link that keeps row clicks from firing twice. */
export function RowLink({ to, children, className }: { to: string; children: ReactNode; className?: string | undefined }): React.JSX.Element {
  return (
    <a href={to} onClick={(e) => e.stopPropagation()} className={cn('min-w-0 truncate font-medium hover:underline', className)}>
      {children}
    </a>
  );
}

/** Count shown in a table cell: muted when zero. */
export function CountCell({ n }: { n: number }): React.JSX.Element {
  return <span className={cn('tabular-nums', n === 0 && 'text-[var(--agent-app-muted)]/70')}>{n}</span>;
}

/* ------------------------------------------------------------------ */
/* Simple table with responsive columns                                */
/* ------------------------------------------------------------------ */

export interface SimpleCol<T> {
  key: string;
  label: string;
  render: (r: T) => ReactNode;
  className?: string | undefined;
  align?: 'left' | 'right' | undefined;
}

export function SimpleTable<T extends { id: string }>({
  rows,
  cols,
  onRowClick,
  subRow,
}: {
  rows: readonly T[];
  cols: SimpleCol<T>[];
  onRowClick?: ((r: T) => void) | undefined;
  /** An extra full-width row under a row (notes, issues). */
  subRow?: ((r: T) => ReactNode) | undefined;
}): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
            {cols.map((c) => (
              <th
                key={c.key}
                className={cn('whitespace-nowrap px-3 py-2 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]', c.align === 'right' ? 'text-right' : 'text-left', c.className)}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const extra = subRow?.(r);
            return (
              <Fragment key={r.id}>
                <tr
                  onClick={onRowClick !== undefined ? () => onRowClick(r) : undefined}
                  className={cn(
                    'border-[var(--agent-app-border)]/60',
                    extra === null || extra === undefined ? 'border-b last:border-0' : '',
                    onRowClick !== undefined && 'cursor-pointer hover:bg-[var(--agent-app-border)]/20',
                  )}
                >
                  {cols.map((c) => (
                    <td key={c.key} className={cn('px-3 py-2 align-top', c.align === 'right' ? 'text-right tabular-nums' : 'text-left', c.className)}>
                      {c.render(r)}
                    </td>
                  ))}
                </tr>
                {extra !== null && extra !== undefined && (
                  <tr className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                    <td colSpan={cols.length} className="px-3 pb-2.5 pt-0">
                      {extra}
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Record page tabs                                                    */
/* ------------------------------------------------------------------ */

export interface TabDef {
  value: string;
  label: string;
  count?: number | undefined;
}

/** Tab strip of a record page; scrolls sideways on its own on narrow screens. */
export function RecordTabs({ tabs, value, onChange, children }: { tabs: TabDef[]; value: string; onChange: (v: string) => void; children: ReactNode }): React.JSX.Element {
  return (
    <Tabs value={value} onValueChange={onChange}>
      <div className="-mx-1 overflow-x-auto px-1 pb-1">
        <TabsList>
          {tabs.map((tb) => (
            <TabsTrigger key={tb.value} value={tb.value} className="whitespace-nowrap">
              {tb.label}
              {tb.count !== undefined && tb.count > 0 && <span className="ml-1.5 text-xs tabular-nums text-[var(--agent-app-muted)]">{tb.count}</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {children}
    </Tabs>
  );
}

/** The tab to show: the one in the hash when it exists here, else the first. */
export function pickTab(tabs: TabDef[], wanted: string): string {
  return tabs.some((x) => x.value === wanted) ? wanted : (tabs[0]?.value ?? 'overview');
}
