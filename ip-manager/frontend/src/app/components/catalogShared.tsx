/**
 * Catalog helpers shared by the property and work pages: label tables for
 * property/work enums, thumbnails, date and image fields, tree helpers and
 * a tree table (parent/child rows with expand and collapse).
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Album,
  BookImage,
  BookOpen,
  Camera,
  ChevronDown,
  ChevronRight,
  Clapperboard,
  Code,
  Disc3,
  File,
  FileText,
  Film,
  Gamepad2,
  Globe,
  ImagePlus,
  LayoutTemplate,
  Layers,
  Megaphone,
  Music,
  Palette,
  PersonStanding,
  ScrollText,
  Shapes,
  Tv,
  X,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { RecordModel } from 'pocketbase';
import { Button, cn } from '../../kit/index.ts';
import { fileUrl } from '../lib/api.ts';
import { d10, fmtDate } from '../lib/format.ts';
import { WORK_TYPE_LABEL } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import type { PropertyRec, WorkRec, WorkType } from '../lib/types.ts';
import { Field, IdentityChip, Pill } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export type PropertyKind = Exclude<PropertyRec['kind'], ''>;
export type RightsBasis = Exclude<PropertyRec['rights_basis'], ''>;
export type PropertyStatus = Exclude<PropertyRec['status'], ''>;
export type WorkStatus = Exclude<WorkRec['status'], ''>;
export type AuthorKind = Exclude<WorkRec['author_kind'], ''>;

export const PROPERTY_KIND_LABEL: Record<PropertyKind, string> = {
  franchise: 'Franchise',
  brand: 'Brand',
  product_line: 'Product line',
  technology: 'Technology',
  portfolio: 'Portfolio',
  other: 'Other',
};

export const RIGHTS_BASIS_LABEL: Record<RightsBasis, string> = {
  owned: 'Owned outright',
  acquired: 'Acquired',
  mixed: 'Mixed',
};

export const RIGHTS_BASIS_TONE: Record<RightsBasis, Tone> = {
  owned: 'good',
  acquired: 'info',
  mixed: 'warn',
};

export const RIGHTS_BASIS_HELP =
  'Owned outright: you hold all rights, so everything is available unless licensed out. Acquired: only what agreements grant you is available.';

export const PROPERTY_STATUS_LABEL: Record<PropertyStatus, string> = {
  active: 'Active',
  dormant: 'Dormant',
  retired: 'Retired',
};

export const PROPERTY_STATUS_TONE: Record<PropertyStatus, Tone> = {
  active: 'good',
  dormant: 'neutral',
  retired: 'neutral',
};

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  development: 'In development',
  production: 'In production',
  released: 'Released',
  archived: 'Archived',
};

export const WORK_STATUS_TONE: Record<WorkStatus, Tone> = {
  development: 'neutral',
  production: 'info',
  released: 'good',
  archived: 'neutral',
};

export const AUTHOR_KIND_LABEL: Record<AuthorKind, string> = {
  individual: 'Individual author',
  joint: 'Joint authors',
  corporate: 'Organization (corporate author)',
  anonymous: 'Anonymous or pseudonymous',
};

export const WORK_TYPE_ICON: Record<WorkType, LucideIcon> = {
  feature_film: Film,
  series: Tv,
  season: Layers,
  episode: Clapperboard,
  short: Film,
  game: Gamepad2,
  book: BookOpen,
  comic: BookImage,
  music_composition: Music,
  sound_recording: Disc3,
  album: Album,
  character: PersonStanding,
  logo: Shapes,
  artwork: Palette,
  photograph: Camera,
  software: Code,
  website: Globe,
  format: LayoutTemplate,
  script: ScrollText,
  documentation: FileText,
  marketing_asset: Megaphone,
  other: File,
};

/** Agreement direction as a state tone: rights in = info, rights out = accent. */
export const DIRECTION_TONE: Record<string, Tone> = { in: 'info', out: 'accent', mutual: 'neutral', none: 'neutral' };

export const AGREEMENT_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  negotiating: 'Negotiating',
  active: 'Active',
  expired: 'Expired',
  terminated: 'Terminated',
  renewed: 'Renewed',
  superseded: 'Superseded',
};

/** The child type people usually add under a work of this type. */
export const CHILD_WORK_TYPE: Partial<Record<WorkType, WorkType>> = {
  series: 'season',
  season: 'episode',
  album: 'sound_recording',
  game: 'music_composition',
  feature_film: 'music_composition',
};

export function options<K extends string>(labels: Record<K, string>): { value: K; label: string }[] {
  return (Object.keys(labels) as K[]).map((k) => ({ value: k, label: labels[k] }));
}

export function RightsBasisPill({ basis, inherited }: { basis: PropertyRec['rights_basis']; inherited?: string | undefined }): React.JSX.Element {
  if (basis === '') return <span className="text-xs text-[var(--agent-app-muted)]">Not set</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <Pill tone={RIGHTS_BASIS_TONE[basis]} title={inherited !== undefined ? `Inherited from ${inherited}` : undefined}>
        {RIGHTS_BASIS_LABEL[basis]}
      </Pill>
      {inherited !== undefined && <span className="text-[11px] text-[var(--agent-app-muted)]">inherited</span>}
    </span>
  );
}

export function WorkStatusPill({ status }: { status: WorkRec['status'] }): React.JSX.Element | null {
  if (status === '') return null;
  return <Pill tone={WORK_STATUS_TONE[status]}>{WORK_STATUS_LABEL[status]}</Pill>;
}

export function PropertyStatusPill({ status }: { status: PropertyRec['status'] }): React.JSX.Element | null {
  if (status === '') return null;
  return <Pill tone={PROPERTY_STATUS_TONE[status]}>{PROPERTY_STATUS_LABEL[status]}</Pill>;
}

/** Work type as an icon plus label. */
export function WorkTypeLabel({ type, iconOnly = false }: { type: WorkType; iconOnly?: boolean | undefined }): React.JSX.Element {
  const Icon = WORK_TYPE_ICON[type];
  return (
    <span className="inline-flex items-center gap-1.5 text-[var(--agent-app-muted)]" title={iconOnly ? WORK_TYPE_LABEL[type] : undefined}>
      <Icon size={14} aria-hidden className="shrink-0" />
      {!iconOnly && <span className="text-xs">{WORK_TYPE_LABEL[type]}</span>}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Thumbnails and fields                                               */
/* ------------------------------------------------------------------ */

/** Record image thumbnail, or a square identity chip when there is none. */
export function Thumb({
  record,
  image,
  name,
  size = 'md',
}: {
  record: RecordModel;
  image: string;
  name: string;
  size?: 'sm' | 'md' | 'lg' | 'xl' | undefined;
}): React.JSX.Element {
  const box = size === 'sm' ? 'size-6' : size === 'md' ? 'size-8' : size === 'lg' ? 'size-12' : 'size-20';
  // Initials from words only, so "The Keeper (film)" reads TK, not T(.
  const label = name.replace(/[^\p{L}\p{N}\s]/gu, ' ').trim() || name;
  if (image !== '') {
    return (
      <img
        src={fileUrl(record, image, size === 'xl' ? '400x0' : '100x100')}
        alt=""
        loading="lazy"
        className={cn(box, 'shrink-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] object-cover')}
      />
    );
  }
  if (size === 'lg' || size === 'xl') {
    return <IdentityChip name={label} square className={cn(box, size === 'xl' ? 'text-xl' : 'text-sm')} />;
  }
  return <IdentityChip name={label} square size={size === 'sm' ? 'sm' : 'md'} />;
}

const DATE_CLASS = 'h-9 w-full border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm';

/** Calendar-day input bound to 'YYYY-MM-DD' ('' when empty). */
export function DateField({
  label,
  value,
  onChange,
  help,
  error,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode | undefined;
  error?: string | undefined;
  required?: boolean | undefined;
}): React.JSX.Element {
  const id = useId();
  return (
    <Field label={label} help={help} error={error} required={required} htmlFor={id}>
      <input id={id} type="date" className={DATE_CLASS} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Image chooser with preview, keep, replace or remove. */
export function ImageField({
  label = 'Image',
  record,
  current,
  file,
  removed,
  onFile,
  onRemove,
}: {
  label?: string | undefined;
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
    <Field label={label} help="PNG, JPG, WebP or SVG, up to 10 MB.">
      <div className="flex items-center gap-3">
        {shown !== '' ? (
          <img src={shown} alt="" className="size-14 shrink-0 border border-[var(--agent-app-border)] object-cover" />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center border border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-muted)]">
            <ImagePlus size={18} aria-hidden />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            {shown !== '' ? 'Replace' : 'Choose image'}
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
              <X size={13} aria-hidden /> Remove
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

/** "12 Jan 2025 to 31 Dec 2030", "From 1 Jan 2025", "Perpetual". */
export function termText(start: string, end: string, perpetual = false): string {
  const s = d10(start);
  const e = d10(end);
  if (perpetual) return s !== '' ? `From ${fmtDate(s)}, perpetual` : 'Perpetual';
  if (s !== '' && e !== '') return `${fmtDate(s)} to ${fmtDate(e)}`;
  if (s !== '') return `From ${fmtDate(s)}`;
  if (e !== '') return `Until ${fmtDate(e)}`;
  return '';
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

/** Rights basis of a work, falling back to its parents and then its property. */
export function effectiveBasis(
  w: WorkRec,
  all: readonly WorkRec[],
  properties: readonly PropertyRec[],
): { basis: WorkRec['rights_basis']; from?: string } {
  if (w.rights_basis !== '') return { basis: w.rights_basis };
  const chain = ancestorsOf(all, w.id);
  const up = chain.find((a) => a.rights_basis !== '');
  if (up !== undefined) return { basis: up.rights_basis, from: up.title };
  const pid = w.property || chain.find((a) => a.property !== '')?.property || '';
  const byId = new Map(properties.map((p) => [p.id, p]));
  let cur = byId.get(pid);
  const seen = new Set<string>();
  while (cur !== undefined && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (cur.rights_basis !== '') return { basis: cur.rights_basis, from: cur.name };
    cur = cur.parent !== '' ? byId.get(cur.parent) : undefined;
  }
  return { basis: '' };
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
  title?: string | undefined;
}

/**
 * Parent/child rows in one table. Children are indented under their parent
 * and every parent expands or collapses. `visible` limits the rows shown
 * (pass matches plus their ancestors); `expandAll` opens everything, used
 * while filtering.
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
  /** When filtering, rows that are only shown as context are dimmed. */
  isMatch?: ((r: T) => boolean) | undefined;
}): React.JSX.Element {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const kids = useMemo(() => childrenOf(items), [items]);

  // Roots, plus anything unreachable from a root (defensive against cycles).
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
                    {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
                  </button>
                )}
              </span>
            </th>
            {columns.map((c) => (
              <th
                key={c.key}
                title={c.title}
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
                className={cn(
                  'cursor-pointer border-b border-[var(--agent-app-border)]/60 last:border-0 hover:bg-[var(--agent-app-border)]/20',
                  context && 'opacity-60',
                )}
              >
                <td className="py-2 pr-3" style={{ paddingLeft: 12 + depth * 22 }}>
                  <div className="flex min-w-0 items-center gap-2">
                    {hasKids ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={open ? 'Collapse' : 'Expand'}
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
