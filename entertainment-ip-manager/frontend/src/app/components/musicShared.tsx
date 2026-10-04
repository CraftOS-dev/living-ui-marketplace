/**
 * Shared pieces of the music area: identifier display (ISRC, ISWC), the
 * shapes of the JSON fields (master owners, society shares, reservations,
 * Content ID ownership, release tracks), share categories, streaming
 * platforms, a wrapping tab bar and small row editors.
 */
import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { CalendarClock, Plus, Trash2 } from 'lucide-react';
import { Button, Input, Select, cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { enumLabel, t, tf } from '../lib/i18n.ts';
import { deadlineSeverity, fmtPct, fmtShort } from '../lib/format.ts';
import { useCollection } from '../lib/live.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { DeadlineRec, InvolvementRec, PartyRec, RecordingRec, SongRec } from '../lib/records.ts';
import type { NameEntry } from '../lib/shapes.ts';
import { PartyPicker } from './pickers.tsx';
import { Notice, Pill, TONE_TEXT } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

export function normIsrc(code: string): string {
  return code.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/** Shape check only (the server validates on save): country, registrant, year, number. */
export function isrcShapeOk(code: string): boolean {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{7}$/.test(normIsrc(code));
}

/** "JPABC2600001" to "JP-ABC-26-00001". */
export function fmtIsrc(code: string): string {
  const c = normIsrc(code);
  if (!isrcShapeOk(c)) return code;
  return `${c.slice(0, 2)}-${c.slice(2, 5)}-${c.slice(5, 7)}-${c.slice(7)}`;
}

/** "T1234567890" to "T-123.456.789-0" (the server stores the formatted form already). */
export function fmtIswc(code: string): string {
  const c = code.toUpperCase().replace(/[^T0-9]/g, '');
  if (!/^T\d{10}$/.test(c)) return code;
  return `T-${c.slice(1, 4)}.${c.slice(4, 7)}.${c.slice(7, 10)}-${c.slice(10)}`;
}

/* ------------------------------------------------------------------ */
/* JSON shapes                                                         */
/* ------------------------------------------------------------------ */

export type MasterOwnerType = 'owned' | 'licence' | 'assignment' | 'co_owned';
export const MASTER_OWNER_TYPES: MasterOwnerType[] = ['owned', 'licence', 'assignment', 'co_owned'];

/** recordings.master_owners rows. */
export interface MasterOwner {
  party: string;
  name: string;
  pct: number;
  type: MasterOwnerType | '';
}

/** content_id_assets.ownership rows. */
export interface TerritoryShare {
  territory: string;
  pct: number;
}

/** releases.tracks rows. */
export interface Track {
  recording: string;
  track_no: number;
  disc: number;
}

export type ReservationType = 'cm' | 'film' | 'game' | 'broadcast';
export const RESERVATION_TYPES: ReservationType[] = ['cm', 'film', 'game', 'broadcast'];

/** society_registrations.reservations rows (a tie-up use the publisher keeps back). */
export interface Reservation {
  type: ReservationType;
  party: string;
  product: string;
  from: string;
  to: string;
  note: string;
}

/** Right categories a society registration files shares for. */
export type RegCategory = 'performance' | 'mechanical' | 'print' | 'film' | 'video' | 'game' | 'ad' | 'broadcast' | 'interactive';
export const REG_CATEGORIES: RegCategory[] = ['performance', 'mechanical', 'print', 'film', 'video', 'game', 'ad', 'broadcast', 'interactive'];

/** Right categories kept on a writer's involvement. */
export type WriterCategory = 'performance' | 'mechanical' | 'sync' | 'other';
export const WRITER_CATEGORIES: WriterCategory[] = ['performance', 'mechanical', 'sync', 'other'];

/** society_registrations.shares rows, as edited (percentages as text while typing). */
export interface RegShareRow {
  party: string;
  name: string;
  role: string;
  vals: Partial<Record<RegCategory, string>>;
}

export function rows<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

export function obj(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

export function num(v: unknown): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

export function masterOwners(v: unknown): MasterOwner[] {
  return rows<Record<string, unknown>>(v).map((o) => {
    const ty = str(o['type']);
    return {
      party: str(o['party']),
      name: str(o['name']),
      pct: num(o['pct']),
      type: (MASTER_OWNER_TYPES as string[]).includes(ty) ? (ty as MasterOwnerType) : '',
    };
  });
}

export function masterOwnersJson(list: MasterOwner[]): Record<string, unknown>[] {
  return list
    .filter((o) => o.party !== '' || o.name.trim() !== '')
    .map((o) => {
      const out: Record<string, unknown> = { name: o.name.trim(), pct: o.pct };
      if (o.party !== '') out['party'] = o.party;
      if (o.type !== '') out['type'] = o.type;
      return out;
    });
}

export function territoryShares(v: unknown): TerritoryShare[] {
  return rows<Record<string, unknown>>(v).map((o) => ({ territory: str(o['territory']) || 'WORLD', pct: num(o['pct']) }));
}

export function regShareRows(v: unknown): RegShareRow[] {
  return rows<Record<string, unknown>>(v).map((s) => {
    const vals: Partial<Record<RegCategory, string>> = {};
    for (const c of REG_CATEGORIES) {
      const x = s[c];
      if (x !== undefined && x !== null && x !== '') vals[c] = str(x);
    }
    return { party: str(s['party']), name: str(s['name']), role: str(s['role']), vals };
  });
}

export function regShareJson(list: RegShareRow[]): Record<string, unknown>[] {
  return list
    .filter((r) => r.party !== '' || r.name.trim() !== '')
    .map((r) => {
      const out: Record<string, unknown> = { name: r.name.trim(), role: r.role };
      if (r.party !== '') out['party'] = r.party;
      for (const c of REG_CATEGORIES) {
        const v = r.vals[c];
        if (v !== undefined && v.trim() !== '') out[c] = num(v);
      }
      return out;
    });
}

export function reservations(v: unknown): Reservation[] {
  return rows<Record<string, unknown>>(v).map((r) => {
    const ty = str(r['type']);
    return {
      type: (RESERVATION_TYPES as string[]).includes(ty) ? (ty as ReservationType) : 'cm',
      party: str(r['party']),
      product: str(r['product']),
      from: str(r['from']).slice(0, 10),
      to: str(r['to']).slice(0, 10),
      note: str(r['note']),
    };
  });
}

export function reservationsJson(list: Reservation[]): Record<string, unknown>[] {
  return list.map((r) => {
    const out: Record<string, unknown> = { type: r.type };
    if (r.party !== '') out['party'] = r.party;
    if (r.product.trim() !== '') out['product'] = r.product.trim();
    if (r.from !== '') out['from'] = r.from;
    if (r.to !== '') out['to'] = r.to;
    if (r.note.trim() !== '') out['note'] = r.note.trim();
    return out;
  });
}

export function tracks(v: unknown): Track[] {
  return rows<Record<string, unknown>>(v)
    .map((x) => ({ recording: str(x['recording']), track_no: num(x['track_no']), disc: num(x['disc']) || 1 }))
    .filter((x) => x.recording !== '');
}

/** An involvement's shares per writer category. */
export function writerShares(i: InvolvementRec): Partial<Record<WriterCategory, number>> {
  const o = obj(i.shares);
  const out: Partial<Record<WriterCategory, number>> = {};
  for (const c of WRITER_CATEGORIES) {
    const v = o[c];
    if (v !== undefined && v !== null && v !== '') out[c] = num(v);
  }
  return out;
}

export function total(list: number[]): number {
  return Math.round(list.reduce((s, x) => s + x, 0) * 100) / 100;
}

export function isHundred(n: number): boolean {
  return Math.abs(n - 100) < 0.01;
}

/* ------------------------------------------------------------------ */
/* Labels                                                              */
/* ------------------------------------------------------------------ */

export function regCategoryLabel(c: RegCategory): string {
  switch (c) {
    case 'performance':
      return t('Performance|share category');
    case 'mechanical':
      return t('Mechanical|share category');
    case 'print':
      return t('Print|share category');
    case 'film':
      return t('Film|share category');
    case 'video':
      return t('Video|share category');
    case 'game':
      return t('Game|share category');
    case 'ad':
      return t('Advertising|share category');
    case 'broadcast':
      return t('Broadcast|share category');
    case 'interactive':
      return t('Interactive|share category');
  }
}

export function writerCategoryLabel(c: WriterCategory): string {
  switch (c) {
    case 'performance':
      return t('Performance|share category');
    case 'mechanical':
      return t('Mechanical|share category');
    case 'sync':
      return t('Sync|share category');
    case 'other':
      return t('Other|share category');
  }
}

export function ownerTypeLabel(v: MasterOwnerType | ''): string {
  switch (v) {
    case 'owned':
      return t('Owned|master');
    case 'licence':
      return t('Licensed|master');
    case 'assignment':
      return t('Assigned|master');
    case 'co_owned':
      return t('Co-owned|master');
    default:
      return '';
  }
}

export function reservationTypeLabel(v: ReservationType): string {
  switch (v) {
    case 'cm':
      return t('Commercial (CM)');
    case 'film':
      return t('Film|reservation');
    case 'game':
      return t('Game|reservation');
    case 'broadcast':
      return t('Broadcast|reservation');
  }
}

export const PLATFORMS = ['YOUTUBE', 'TIKTOK', 'TWITCH', 'NICONICO', 'INSTAGRAM', 'TWITCASTING', 'BILIBILI', 'X', 'OTHER'] as const;

export function platformLabel(code: string): string {
  switch (code.toUpperCase()) {
    case 'YOUTUBE':
      return t('YouTube');
    case 'TIKTOK':
      return t('TikTok');
    case 'TWITCH':
      return t('Twitch');
    case 'NICONICO':
      return t('niconico');
    case 'INSTAGRAM':
      return t('Instagram');
    case 'TWITCASTING':
      return t('TwitCasting');
    case 'BILIBILI':
      return t('bilibili');
    case 'X':
      return t('X');
    case 'OTHER':
      return t('Other');
    default:
      return code;
  }
}

const SCRIPTS = ['ja', 'kana', 'en', 'romaji', 'zh_hans', 'zh_hant', 'ko'] as const;

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

export function scriptOptions(): { value: string; label: string }[] {
  return SCRIPTS.map((s) => ({ value: s, label: scriptLabel(s) }));
}

/** Every other way the title is written, joined. */
export function namesText(names: NameEntry[] | null | undefined, title?: string | undefined): string {
  const seen = new Set<string>(title !== undefined ? [title] : []);
  const out: string[] = [];
  for (const n of names ?? []) {
    const v = (n.value ?? '').trim();
    if (v !== '' && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out.join(' / ');
}

export const LYRICS_LANGUAGES = ['ja', 'en', 'ko', 'zh', 'multi', 'instrumental', 'other'] as const;

export function lyricsLanguageLabel(v: string): string {
  switch (v) {
    case 'ja':
      return t('Japanese');
    case 'en':
      return t('English');
    case 'ko':
      return t('Korean');
    case 'zh':
      return t('Chinese');
    case 'multi':
      return t('Several languages');
    case 'instrumental':
      return t('Instrumental (no lyrics)');
    case 'other':
      return t('Other');
    default:
      return v;
  }
}

export const WRITER_ROLES = ['composer', 'lyricist', 'arranger', 'publisher', 'other'] as const;
export const PERFORMER_ROLES = ['singer', 'performer', 'voice_actor', 'producer', 'arranger', 'label', 'other'] as const;

export function roleOptions(roles: readonly string[]): { value: string; label: string }[] {
  return roles.map((r) => ({ value: r, label: enumLabel('involvements.role', r) }));
}

/** Party expanded on an involvement (expand: 'party'). */
export function partyOf(i: InvolvementRec): PartyRec | undefined {
  return i.expand?.['party'] as PartyRec | undefined;
}

export function partyLabel(i: InvolvementRec): string {
  return i.credit_name || partyOf(i)?.name || '';
}

/** "Composer: A, Lyricist: B" for a song's writers. */
export function writersSummary(list: InvolvementRec[]): string {
  const order = ['composer', 'lyricist', 'arranger', 'publisher'];
  const by = new Map<string, string[]>();
  for (const i of list) {
    if (!order.includes(i.role)) continue;
    const arr = by.get(i.role) ?? [];
    const name = partyLabel(i);
    if (name !== '' && !arr.includes(name)) arr.push(name);
    by.set(i.role, arr);
  }
  return order
    .filter((r) => (by.get(r) ?? []).length > 0)
    .map((r) => `${enumLabel('involvements.role', r)}: ${(by.get(r) ?? []).join(', ')}`)
    .join(' / ');
}

/** "JP 100%, WORLD 50%" */
export function ownershipText(v: unknown): string {
  return territoryShares(v)
    .map((o) => `${o.territory === 'WORLD' ? t('Worldwide') : o.territory} ${fmtPct(o.pct)}`)
    .join(', ');
}

export function ownersText(v: unknown): string {
  return masterOwners(v)
    .map((o) => `${o.name || '?'} ${fmtPct(o.pct)}`)
    .join(', ');
}

/* ------------------------------------------------------------------ */
/* Links                                                               */
/* ------------------------------------------------------------------ */

export function SongLink({ song, id, fallback }: { song?: SongRec | undefined; id: string; fallback?: string | undefined }): React.JSX.Element | null {
  if (id === '') return null;
  return (
    <a className="min-w-0 break-words hover:underline" href={href('song', id)} onClick={(e) => e.stopPropagation()}>
      {song?.title ?? fallback ?? t('Open song')}
    </a>
  );
}

export function RecordingLink({ rec, id, fallback }: { rec?: RecordingRec | undefined; id: string; fallback?: string | undefined }): React.JSX.Element | null {
  if (id === '') return null;
  return (
    <a className="min-w-0 break-words hover:underline" href={href('recording', id)} onClick={(e) => e.stopPropagation()}>
      {rec?.title ?? fallback ?? t('Open recording')}
    </a>
  );
}

/** Links to catalogue records (franchise, title, characters, talents), plain text when the module is off. */
export function CatalogLinks({ kind, ids }: { kind: 'franchise' | 'work' | 'character' | 'talent'; ids: string[] }): React.JSX.Element | null {
  const { nameOf, on } = useApp();
  const list = ids.filter((x) => x !== '');
  if (list.length === 0) return null;
  const page = kind === 'franchise' ? 'franchise' : kind === 'work' ? 'title' : kind === 'character' ? 'character' : 'talent';
  const enabled = kind === 'work' ? on('titles') : kind === 'talent' ? on('talents') : on('franchises');
  return (
    <span className="inline-flex min-w-0 flex-wrap gap-x-2 gap-y-0.5">
      {list.map((id, i) => {
        const name = nameOf(kind, id) || t('Unnamed|party');
        return (
          <span key={id} className="min-w-0 break-words">
            {enabled ? (
              <a className="hover:underline" href={href(page, id)}>
                {name}
              </a>
            ) : (
              name
            )}
            {i < list.length - 1 ? ',' : ''}
          </span>
        );
      })}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Layout pieces                                                       */
/* ------------------------------------------------------------------ */

/** Underlined tabs that wrap on narrow screens (no horizontal scroll). */
export function TabBar<T extends string>({
  value,
  onChange,
  tabs,
}: {
  value: T;
  onChange: (v: T) => void;
  tabs: ReadonlyArray<{ value: T; label: string; count?: number | undefined }>;
}): React.JSX.Element {
  return (
    <div role="tablist" className="mb-4 flex flex-wrap gap-x-1 border-b border-[var(--agent-app-border)]">
      {tabs.map((tb) => {
        const on = tb.value === value;
        return (
          <button
            key={tb.value}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onChange(tb.value)}
            className={cn(
              '-mb-px border-b-2 px-3 py-2 text-[13px] font-medium transition-colors',
              on ? 'border-[var(--agent-app-accent)] text-[var(--agent-app-text)]' : 'border-transparent text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]',
            )}
          >
            {tb.label}
            {tb.count !== undefined && tb.count > 0 && <span className="ml-1.5 text-xs tabular-nums text-[var(--agent-app-muted)]">{tb.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** A percentage total: green at 100, amber otherwise. */
export function PctTotal({ value, label }: { value: number; label?: string | undefined }): React.JSX.Element {
  return (
    <Pill tone={isHundred(value) ? 'good' : 'warn'}>
      {label !== undefined ? `${label} ` : ''}
      {fmtPct(value)}
    </Pill>
  );
}

/** Small label above a block of form rows. */
export function RowsHeader({ title, help, action }: { title: string; help?: ReactNode | undefined; action?: ReactNode | undefined }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-end justify-between gap-2">
      <div className="min-w-0">
        <div className="text-[13px] font-medium">{title}</div>
        {help !== undefined && <div className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</div>}
      </div>
      {action}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row editors                                                         */
/* ------------------------------------------------------------------ */

/** Master owners: party or name, percent, kind of holding. Must add to 100. */
export function OwnersEditor({ value, onChange }: { value: MasterOwner[]; onChange: (v: MasterOwner[]) => void }): React.JSX.Element {
  const set = (i: number, patch: Partial<MasterOwner>): void => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const sum = total(value.map((o) => o.pct));
  return (
    <div className="flex flex-col gap-2">
      <RowsHeader
        title={t('Master owners')}
        help={t('Who owns the recording (原盤権) and in what percentage. The percentages must add to 100.')}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { party: '', name: '', pct: value.length === 0 ? 100 : 0, type: 'owned' }])}>
            <Plus size={13} aria-hidden /> {t('Add owner')}
          </Button>
        }
      />
      {value.map((o, i) => (
        <div key={i} className="grid gap-2 border border-[var(--agent-app-border)] p-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_6rem_8rem_auto] sm:items-end">
          <PartyPicker label={t('Person or company')} value={o.party} onChange={(id, r) => set(i, { party: id, name: r?.name ?? o.name })} />
          <Input label={t('Name as credited')} value={o.name} onChange={(e) => set(i, { name: e.target.value })} />
          <Input label={t('Percent|share')} type="number" min={0} max={100} step="0.01" value={String(o.pct)} onChange={(e) => set(i, { pct: num(e.target.value) })} />
          <Select
            label={t('Holding|master')}
            value={o.type}
            placeholder={t('Not set')}
            options={MASTER_OWNER_TYPES.map((x) => ({ value: x, label: ownerTypeLabel(x) }))}
            onChange={(e) => set(i, { type: e.target.value as MasterOwnerType | '' })}
          />
          <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      ))}
      {value.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
          <PctTotal value={sum} label={t('Total')} />
          {!isHundred(sum) && <span>{t('Master ownership must add to 100%.')}</span>}
        </div>
      )}
    </div>
  );
}

const TERRITORY_CODES = ['JP', 'US', 'CN', 'KR', 'TW', 'HK', 'SG', 'TH', 'ID', 'PH', 'MY', 'VN', 'IN', 'AU', 'CA', 'MX', 'BR', 'GB', 'DE', 'FR', 'IT', 'ES'];

export function territoryOptions(current: string[]): { value: string; label: string }[] {
  const codes = ['WORLD', ...TERRITORY_CODES];
  for (const c of current) if (c !== '' && !codes.includes(c)) codes.push(c);
  return codes.map((c) => ({ value: c, label: c === 'WORLD' ? t('Worldwide') : `${c} · ${jurisdictionName(c)}` }));
}

/** Content ID ownership per territory. */
export function TerritoryEditor({ value, onChange }: { value: TerritoryShare[]; onChange: (v: TerritoryShare[]) => void }): React.JSX.Element {
  const set = (i: number, patch: Partial<TerritoryShare>): void => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const opts = territoryOptions(value.map((v) => v.territory));
  return (
    <div className="flex flex-col gap-2">
      <RowsHeader
        title={t('Ownership by territory')}
        help={t('The share of the asset we claim in each territory. Claims over 100% in a territory show up as conflicts.')}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { territory: 'WORLD', pct: 100 }])}>
            <Plus size={13} aria-hidden /> {t('Add territory')}
          </Button>
        }
      />
      {value.map((o, i) => (
        <div key={i} className="grid grid-cols-[minmax(0,1fr)_6rem_auto] items-end gap-2">
          <Select label={t('Territory|content id')} value={o.territory} options={opts} onChange={(e) => set(i, { territory: e.target.value })} />
          <Input label={t('Percent|share')} type="number" min={0} max={100} step="0.01" value={String(o.pct)} onChange={(e) => set(i, { pct: num(e.target.value) })} />
          <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** Other ways the title is written (Japanese, kana reading, English...). */
export function NamesEditor({ value, onChange }: { value: NameEntry[]; onChange: (v: NameEntry[]) => void }): React.JSX.Element {
  const set = (i: number, patch: Partial<NameEntry>): void => onChange(value.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  return (
    <div className="flex flex-col gap-2">
      <RowsHeader
        title={t('Other names')}
        help={t('Every way the title is written, so search finds it in any script.')}
        action={
          <Button size="sm" variant="outline" onClick={() => onChange([...value, { script: 'kana', value: '' }])}>
            <Plus size={13} aria-hidden /> {t('Add name')}
          </Button>
        }
      />
      {value.map((n, i) => (
        <div key={i} className="grid grid-cols-[8rem_minmax(0,1fr)_auto] items-end gap-2">
          <Select aria-label={t('Script|writing system')} value={n.script} options={scriptOptions()} onChange={(e) => set(i, { script: e.target.value })} />
          <Input aria-label={t('Name')} value={n.value} onChange={(e) => set(i, { value: e.target.value })} />
          <Button size="icon" variant="ghost" aria-label={t('Remove')} onClick={() => onChange(value.filter((_, j) => j !== i))}>
            <Trash2 size={14} aria-hidden />
          </Button>
        </div>
      ))}
    </div>
  );
}

/** A labelled yes/no checkbox row with a help line. */
export function CheckRow({
  checked,
  onChange,
  label,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  help?: ReactNode | undefined;
}): React.JSX.Element {
  return (
    <label className="flex items-start gap-2 text-[13px]">
      <input type="checkbox" className="mt-0.5 size-3.5 shrink-0 accent-[var(--agent-app-accent)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="min-w-0">
        <span className="font-medium">{label}</span>
        {help !== undefined && <span className="block text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</span>}
      </span>
    </label>
  );
}

/** Explains Copyright Act art. 91(2) and warns when consent is missing. */
export function ConsentNotice({ captured, consent }: { captured: boolean; consent: boolean }): React.JSX.Element | null {
  if (!captured) return null;
  if (consent) {
    return <Notice tone="good">{t('The performers consented to a sound-only release of this performance.')}</Notice>;
  }
  return (
    <Notice tone="warn">
      {t(
        'This performance was recorded for a film or anime. Under Copyright Act art. 91(2) the performers agreed to the film only, so a sound-only release (single, album, streaming) needs their fresh consent. Record the consent before release.',
      )}
    </Notice>
  );
}

/** "-" placeholder for empty cells. */
export function Dash(): React.JSX.Element {
  return <span className="text-[var(--agent-app-muted)]">-</span>;
}

/* ------------------------------------------------------------------ */
/* Deadlines of music records                                          */
/* ------------------------------------------------------------------ */

/** Open deadlines grouped by the record they belong to (registration, claim or society contract). */
export function useOpenDeadlinesBy(field: 'registration' | 'claim' | 'society_contract'): { byId: Map<string, DeadlineRec[]>; loading: boolean } {
  const list = useCollection<DeadlineRec>('deadlines', { filter: `${field} != "" && status = "open"`, sort: 'due_date' });
  const byId = useMemo(() => {
    const m = new Map<string, DeadlineRec[]>();
    for (const d of list.records) {
      const id = d[field];
      const arr = m.get(id) ?? [];
      arr.push(d);
      m.set(id, arr);
    }
    return m;
  }, [list.records, field]);
  return { byId, loading: list.loading };
}

/** A deadline as a compact button: title and due date in its severity colour; opens "Why this date?". */
export function DeadlineChip({ d, onWhy, short = false }: { d: DeadlineRec; onWhy: (d: DeadlineRec) => void; short?: boolean | undefined }): React.JSX.Element {
  const sev = deadlineSeverity(d);
  return (
    <button
      type="button"
      title={t('Why this date?')}
      onClick={(e) => {
        e.stopPropagation();
        onWhy(d);
      }}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1 text-left text-xs hover:underline', TONE_TEXT[sev.tone])}
    >
      <CalendarClock size={12} className="shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        {short ? '' : `${tf(d, 'title')} · `}
        {fmtShort(d.due_date)} ({sev.label})
      </span>
    </button>
  );
}
