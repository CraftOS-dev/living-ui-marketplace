/**
 * Shared pieces of the protect area (trademarks, designs, renewals,
 * enforcement): Nice class headings, number matching, date fields and
 * cells, matter chips, copy buttons, UTC and JST capture times, record
 * history (events) and the "not found" state of record pages.
 */
import { useState } from 'react';
import type { ReactNode } from 'react';
import { Check, Copy, FileText, History, SearchX } from 'lucide-react';
import { Button, Card, cn, toast } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { fileUrl, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, daysUntil, fmtDate, relLabel } from '../lib/format.ts';
import { enumLabel, t, tf } from '../lib/i18n.ts';
import { toneOf } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { DocumentRec, EventRec, FamilyRec, MatterRec } from '../lib/records.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { EmptyHint, ErrorBox, Loading, Pill, Ref, Section, TONE_DOT, TONE_TEXT, Tag } from './ui.tsx';

/* ------------------------------------------------------------------ */
/* Classes                                                             */
/* ------------------------------------------------------------------ */

export const NICE_CLASSES: number[] = Array.from({ length: 45 }, (_v, i) => i + 1);

/** The class set a VTuber debut usually covers (goods, events, streaming). */
export const DEBUT_CLASSES: number[] = [9, 14, 16, 18, 20, 21, 24, 25, 26, 28, 30, 35, 41];

/** Short heading of a Nice class in the reader's language. */
export function niceHeading(n: number): string {
  const all = [
    t('Chemicals|nice'),
    t('Paints|nice'),
    t('Cosmetics and cleaning|nice'),
    t('Oils and fuels|nice'),
    t('Pharmaceuticals|nice'),
    t('Common metals|nice'),
    t('Machines|nice'),
    t('Hand tools|nice'),
    t('Electronics, software and recordings|nice'),
    t('Medical apparatus|nice'),
    t('Lighting and heating|nice'),
    t('Vehicles|nice'),
    t('Firearms and fireworks|nice'),
    t('Jewellery and watches|nice'),
    t('Musical instruments|nice'),
    t('Paper goods and printed matter|nice'),
    t('Rubber and plastics|nice'),
    t('Bags and leather goods|nice'),
    t('Building materials|nice'),
    t('Furniture and plastic goods|nice'),
    t('Household utensils and tableware|nice'),
    t('Ropes and fibres|nice'),
    t('Yarns|nice'),
    t('Textiles and towels|nice'),
    t('Clothing and footwear|nice'),
    t('Badges, buttons and hair accessories|nice'),
    t('Floor coverings|nice'),
    t('Toys, games and figures|nice'),
    t('Processed foods|nice'),
    t('Confectionery and staples|nice'),
    t('Fresh produce|nice'),
    t('Soft drinks and beer|nice'),
    t('Alcoholic beverages|nice'),
    t('Tobacco|nice'),
    t('Advertising and retail|nice'),
    t('Finance and insurance|nice'),
    t('Construction and repair|nice'),
    t('Telecommunications and streaming|nice'),
    t('Transport and travel|nice'),
    t('Treatment of materials|nice'),
    t('Entertainment and education|nice'),
    t('Software and technology services|nice'),
    t('Food and lodging|nice'),
    t('Medical and beauty services|nice'),
    t('Legal and personal services|nice'),
  ];
  return all[n - 1] ?? '';
}

/** "Class 25" / "第25類". */
export function classLabel(n: number): string {
  return t('Class {n}', { n });
}

/** Distinct sorted classes from comma, space or any separator text ("9, 25 28"). */
export function parseClasses(s: string): number[] {
  const out = new Set<number>();
  for (const part of s.split(/[^0-9]+/)) {
    const n = Number(part);
    if (Number.isInteger(n) && n >= 1 && n <= 45) out.add(n);
  }
  return [...out].sort((a, b) => a - b);
}

/** Toggle chips for picking Nice classes. */
export function ClassPicker({ value, onChange, options = NICE_CLASSES }: { value: number[]; onChange: (v: number[]) => void; options?: number[] | undefined }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {options.map((n) => {
        const on = value.includes(n);
        return (
          <button
            key={n}
            type="button"
            title={niceHeading(n)}
            aria-pressed={on}
            onClick={() => onChange(on ? value.filter((x) => x !== n) : [...value, n].sort((a, b) => a - b))}
            className={cn(
              'h-7 min-w-8 border px-1.5 font-mono text-xs tabular-nums',
              on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 font-semibold text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/75 hover:bg-[var(--agent-app-border)]/30',
            )}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Numbers and offices                                                 */
/* ------------------------------------------------------------------ */

/** Office numbers compared without punctuation or spaces. */
export function normNum(s: string): string {
  return s.replace(/[^0-9A-Za-z]/g, '').toLowerCase();
}

/** The office data feed for a type and office (mirrors the server's sourceFor). */
export function officeSource(ipType: string, office: string): '' | 'jpo' | 'uspto_tsdr' | 'euipo' {
  const j = office.toUpperCase();
  if (j === 'US') return ipType === 'trademark' ? 'uspto_tsdr' : '';
  if (j === 'EM') return 'euipo';
  if (j === 'JP') return 'jpo';
  return '';
}

/** Offices whose records are always entered by hand. */
export const MANUAL_OFFICES = ['CN', 'KR', 'TW'];

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

/** A native date input (YYYY-MM-DD) with a label. */
export function DateField({
  label,
  value,
  onChange,
  help,
  required = false,
  max,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: ReactNode | undefined;
  required?: boolean | undefined;
  max?: string | undefined;
}): React.JSX.Element {
  return (
    <label className="flex min-w-0 flex-col gap-1.5">
      <span className="text-[13px] font-medium">
        {label}
        {required && <span className={cn('ml-0.5', TONE_TEXT.bad)}>*</span>}
      </span>
      <input
        type="date"
        className="h-9 w-full min-w-0 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm"
        value={d10(value)}
        max={max}
        onChange={(e) => onChange(e.target.value)}
      />
      {help !== undefined && <span className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{help}</span>}
    </label>
  );
}

export function DateCell({ v, rel = false }: { v: string; rel?: boolean | undefined }): React.JSX.Element {
  const d = d10(v);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
  return (
    <span className="whitespace-nowrap tabular-nums">
      {fmtDate(d)}
      {rel && <span className="ml-1 text-xs text-[var(--agent-app-muted)]">{relLabel(d)}</span>}
    </span>
  );
}

/** Tone of a due date: red when past, amber within 30 days. */
export function dueTone(day: string): 'bad' | 'warn' | 'neutral' {
  const d = d10(day);
  if (d === '') return 'neutral';
  const n = daysUntil(d);
  if (n < 0) return 'bad';
  if (n <= 30) return 'warn';
  return 'neutral';
}

/** Tone of a validity date: red when past, amber within 60 days. */
export function validityTone(day: string): 'bad' | 'warn' | 'neutral' {
  const d = d10(day);
  if (d === '') return 'neutral';
  const n = daysUntil(d);
  if (n < 0) return 'bad';
  if (n <= 60) return 'warn';
  return 'neutral';
}

/** A matter's next deadline (derived on the server) with its title. */
export function NextDeadlineCell({ m }: { m: Pick<MatterRec, 'next_deadline' | 'next_deadline_title' | 'next_deadline_title_ja'> }): React.JSX.Element {
  const d = d10(m.next_deadline);
  if (d === '') return <span className="text-[var(--agent-app-muted)]">-</span>;
  const title = tf(m, 'next_deadline_title');
  const tone = dueTone(d);
  return (
    <div className="min-w-0 max-w-[16rem]">
      <div className={cn('whitespace-nowrap tabular-nums', tone !== 'neutral' && TONE_TEXT[tone])}>
        {fmtDate(d)} <span className="text-xs text-[var(--agent-app-muted)]">{relLabel(d)}</span>
      </div>
      {title !== '' && (
        <div className="truncate text-xs text-[var(--agent-app-muted)]" title={title}>
          {title}
        </div>
      )}
    </div>
  );
}

/** Capture time in UTC and in Japan time (JST, UTC+9), both "YYYY-MM-DD HH:mm". */
export function utcJst(iso: string): { utc: string; jst: string } | null {
  if (iso.trim() === '') return null;
  const ms = new Date(iso.trim().replace(' ', 'T')).getTime();
  if (Number.isNaN(ms)) return null;
  const f = (x: number): string => new Date(x).toISOString().slice(0, 16).replace('T', ' ');
  return { utc: f(ms), jst: f(ms + 9 * 3600000) };
}

/* ------------------------------------------------------------------ */
/* Matters                                                             */
/* ------------------------------------------------------------------ */

/** Status pill of a trademark or design. */
export function MatterStatus({ m }: { m: Pick<MatterRec, 'status' | 'office_status'> }): React.JSX.Element | null {
  if (m.status === '') return null;
  return (
    <Pill tone={toneOf('matters.status', m.status)} title={m.office_status !== '' ? t('Office: {status}', { status: m.office_status }) : undefined}>
      {enumLabel('matters.status', m.status)}
    </Pill>
  );
}

/** Compact link to a filing: office code, reference, status dot tone. */
export function MatterChip({ m, current = false }: { m: MatterRec; current?: boolean | undefined }): React.JSX.Element {
  const dead = m.status_group === 'dead';
  return (
    <a
      href={href('matter', m.id)}
      title={`${m.ref} ${m.title} (${enumLabel('matters.status', m.status)})`}
      className={cn(
        'inline-flex max-w-full items-center gap-1.5 border px-1.5 py-0.5 text-xs hover:bg-[var(--agent-app-border)]/30',
        current ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]',
      )}
    >
      <span className="font-mono font-semibold">{m.jurisdiction}</span>
      <Ref dead={dead} className="truncate text-[11.5px]">
        {m.ref}
      </Ref>
      <span className={cn('size-1.5 shrink-0 rounded-full', toneDot(toneOf('matters.status', m.status)))} aria-hidden />
    </a>
  );
}

function toneDot(tone: string): string {
  return TONE_DOT[(['good', 'warn', 'bad', 'info', 'accent'].includes(tone) ? tone : 'neutral') as Tone];
}

/** The mark as filed: the family's image, else its word element, else the matter title. */
export function MarkBox({ family, fallback, size = 'md' }: { family: FamilyRec | null | undefined; fallback: string; size?: 'sm' | 'md' | undefined }): React.JSX.Element {
  if (family !== null && family !== undefined && family.mark_image !== '') {
    return (
      <span className={cn('inline-flex max-w-full items-center justify-center border border-[var(--agent-app-border)] bg-[var(--agent-app-bg)] p-1', size === 'sm' ? 'size-10' : 'h-20 min-w-20')}>
        <img src={fileUrl(family, family.mark_image, size === 'sm' ? '100x100' : '400x0')} alt={family.title} className="max-h-full max-w-full object-contain" />
      </span>
    );
  }
  const word = family?.word_element || fallback;
  return <span className="inline-block max-w-full break-words border border-[var(--agent-app-border)] px-3 py-1.5 text-base font-semibold tracking-wide">{word}</span>;
}

/** Links to the franchise, character and talent a record is filed for. */
export function SubjectLinks({ franchise, character, talent, className }: { franchise: string; character: string; talent: string; className?: string | undefined }): React.JSX.Element | null {
  const { nameOf, on } = useApp();
  const items: ReactNode[] = [];
  if (franchise !== '' && on('franchises')) {
    items.push(
      <a key="f" href={href('franchise', franchise)} className="hover:underline">
        <span className="text-[var(--agent-app-muted)]">{t('Franchise')}: </span>
        {nameOf('franchise', franchise) || t('Open|action')}
      </a>,
    );
  }
  if (character !== '' && on('franchises')) {
    items.push(
      <a key="c" href={href('character', character)} className="hover:underline">
        <span className="text-[var(--agent-app-muted)]">{t('Character')}: </span>
        {nameOf('character', character) || t('Open|action')}
      </a>,
    );
  }
  if (talent !== '' && on('talents')) {
    items.push(
      <a key="t" href={href('talent', talent)} className="hover:underline">
        <span className="text-[var(--agent-app-muted)]">{t('Talent')}: </span>
        {nameOf('talent', talent) || t('Open|action')}
      </a>,
    );
  }
  if (items.length === 0) return null;
  return <div className={cn('flex flex-wrap gap-x-4 gap-y-1 text-[13px]', className)}>{items}</div>;
}

/* ------------------------------------------------------------------ */
/* Small controls                                                      */
/* ------------------------------------------------------------------ */

export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(t('Copied'));
  } catch {
    toast.error(t('Could not copy. Select the text and copy it by hand.'));
  }
}

export function CopyButton({ text, label, className }: { text: string; label?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="outline"
      className={cn('h-7 px-2 text-xs', className)}
      disabled={text === ''}
      onClick={() => {
        void copyText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={12} aria-hidden /> : <Copy size={12} aria-hidden />} {label ?? t('Copy')}
    </Button>
  );
}

/** Label above a header value. */
export function HeaderCell({ label, children }: { label: string; children: ReactNode }): React.JSX.Element {
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{label}</div>
      {children}
    </div>
  );
}

/** Record page fallback: nothing chosen, or not available. */
export function RecordMissing({ title, message, back, backLabel }: { title: string; message: string; back: string; backLabel: string }): React.JSX.Element {
  return (
    <Card>
      <EmptyHint
        icon={SearchX}
        title={title}
        message={message}
        action={
          <a href={back} className="text-[13px] font-medium text-[var(--agent-app-accent)] hover:underline">
            {backLabel}
          </a>
        }
      />
    </Card>
  );
}

/** Option list for a Select from enumOptions pairs. */
export function opts(pairs: [string, string][]): { value: string; label: string }[] {
  return pairs.map(([value, label]) => ({ value, label }));
}

/* ------------------------------------------------------------------ */
/* History: the events recorded on a record                            */
/* ------------------------------------------------------------------ */

export function EventHistory({ field, id, emptyText }: { field: 'matter' | 'case_ref'; id: string; emptyText: string }): React.JSX.Element {
  const { meta, userName } = useApp();
  const events = useCollection<EventRec>('events', { filter: `${field} = ${q(id)}`, sort: '-date,-created', expand: 'document' });
  return (
    <Section title={t('History')} meta={events.records.length > 0 ? String(events.records.length) : undefined} flush>
      {events.loading && events.records.length === 0 ? (
        <Loading />
      ) : events.error !== null ? (
        <div className="p-4">
          <ErrorBox message={events.error} onRetry={events.refresh} />
        </div>
      ) : events.records.length === 0 ? (
        <EmptyHint compact icon={History} title={t('No events recorded')} message={emptyText} />
      ) : (
        events.records.map((ev) => {
          const def = meta?.event_codes[ev.code];
          const codeLabel = def !== undefined ? tf(def, 'label') : ev.code;
          const own = tf(ev, 'label');
          const doc = ev.expand?.['document'] as DocumentRec | undefined;
          return (
            <div key={ev.id} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 sm:flex-row sm:items-center sm:gap-4">
              <span className="w-32 shrink-0 text-[13px] tabular-nums text-[var(--agent-app-muted)]">{fmtDate(ev.date)}</span>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium">{codeLabel}</div>
                {own !== '' && own !== codeLabel && <div className="break-words text-xs text-[var(--agent-app-muted)]">{own}</div>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                {ev.source !== '' && <Tag>{enumLabel('events.source', ev.source)}</Tag>}
                {ev.created_by !== '' && <span>{userName(ev.created_by)}</span>}
                {doc !== undefined && doc.file !== '' && (
                  <a href={fileUrl(doc, doc.file)} target="_blank" rel="noreferrer" className="inline-flex max-w-[14rem] items-center gap-1 text-[var(--agent-app-accent)] hover:underline">
                    <FileText size={12} aria-hidden /> <span className="truncate">{doc.title}</span>
                  </a>
                )}
                <DeleteButton collection="events" id={ev.id} iconOnly label={t('Delete this event')} />
              </div>
            </div>
          );
        })
      )}
    </Section>
  );
}
