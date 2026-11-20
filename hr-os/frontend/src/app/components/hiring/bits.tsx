/**
 * Small hiring pieces shared by the pages: status tones and labels, the
 * stage strip of an opening, the stage chain of an application, the
 * recommendation badge, people pickers, the protected file viewer, times.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { getPbClient } from '../../../kit/index.ts';
import { Avatar, Money, Picker, StatusDot, Tag, Toggle } from '../ui.tsx';
import type { PickItem, Tone } from '../ui.tsx';
import { fmtDay, time } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import type { Person, Recommendation, Stage } from '../../pages/hiring/types.ts';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter((p) => typeof p === 'string' && p !== '').join(' ');
}

const TONES: Record<string, Record<string, Tone>> = {
  opening: { draft: 'faint', open: 'good', on_hold: 'warn', closed: 'faint' },
  application: { active: 'rh', hired: 'good', rejected: 'bad', withdrawn: 'faint' },
  offer: { draft: 'faint', pending: 'warn', approved: 'lh', sent: 'rh', accepted: 'good', declined: 'bad', withdrawn: 'faint' },
  requisition: { draft: 'faint', pending: 'warn', approved: 'good', rejected: 'bad', filled: 'rh', closed: 'faint' },
  interview: { scheduled: 'rh', done: 'good', cancelled: 'faint', no_show: 'bad' },
  referral: { submitted: 'neutral', in_process: 'rh', hired: 'good', not_selected: 'faint', withdrawn: 'faint' },
  plan: { draft: 'faint', active: 'good', closed: 'faint' },
};

export type StatusKind = keyof typeof TONES;

export function statusTone(kind: StatusKind, status: string): Tone {
  return TONES[kind]?.[status] ?? 'neutral';
}

export function statusLabel(kind: StatusKind, status: string): string {
  return t(`hiring.status.${kind}.${status}`);
}

export function Status({ kind, status }: { kind: StatusKind; status: string }): React.JSX.Element {
  return <StatusDot tone={statusTone(kind, status)} label={statusLabel(kind, status)} />;
}

const REC_TONE: Record<Recommendation, Tone> = { strong_no: 'bad', no: 'warn', yes: 'good', strong_yes: 'good' };

export function RecBadge({ value }: { value: Recommendation | '' }): React.JSX.Element | null {
  if (value === '') return null;
  return <Tag tone={REC_TONE[value]}>{t(`hiring.rec.${value}`)}</Tag>;
}

/**
 * An opening's pipeline as one compact strip: each stage with its count,
 * the hired stage as hired of positions. Counts are mono numerals.
 */
export function StageStrip({ stages, positions, hired, className }: { stages: Stage[]; positions?: number | undefined; hired?: number | undefined; className?: string | undefined }): React.JSX.Element {
  return (
    <div className={cx('grid min-w-0 gap-px overflow-hidden rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-line)]', className)} style={{ gridTemplateColumns: `repeat(${Math.max(1, stages.length)}, minmax(0, 1fr))` }}>
      {stages.map((s) => {
        const n = s.kind === 'hired' ? (hired ?? s.count ?? 0) : (s.count ?? 0);
        return (
          <div key={s.key} className="min-w-0 bg-[var(--hr-panel)] px-2 py-1.5">
            <div className="hr-label truncate" title={s.name}>
              {s.name}
            </div>
            <div className={cx('hr-mono hr-num text-[13px]', n === 0 ? 'text-[var(--hr-faint)]' : 'text-[var(--hr-ink)]')}>
              {s.kind === 'hired' && positions !== undefined ? `${n}/${positions}` : n}
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** Where an application is: a chain of small dots, the current stage named. */
export function StageChain({ stages, current, status }: { stages: Stage[]; current: string; status: string }): React.JSX.Element {
  const at = stages.findIndex((s) => s.key === current);
  const name = stages[at]?.name ?? current;
  return (
    <span className="inline-flex min-w-0 items-center gap-2">
      <span className="inline-flex items-center gap-1" aria-hidden>
        {stages.map((s, i) => (
          <span key={s.key} className={cx('size-1.5 rounded-full', i < at ? 'bg-[var(--hr-ink-2)]' : i === at ? (status === 'active' ? 'bg-[var(--hr-rh)]' : status === 'hired' ? 'bg-[var(--hr-good)]' : 'bg-[var(--hr-faint)]') : 'bg-[var(--hr-line-2)]')} />
        ))}
      </span>
      <span className="truncate text-[13px]">{name}</span>
    </span>
  );
}

/** Active members for pickers (interviewers, hiring managers, team). */
export function usePeople(skip = false): Person[] | null {
  const live = useOp<{ people: Person[] }>('hiring.people', {}, ['members'], { name: 'hiring.people', skip });
  return live.data?.people ?? null;
}

export function personItems(people: Person[] | null, skip: string[] = []): PickItem[] {
  return (people ?? []).filter((p) => !skip.includes(p.id)).map((p) => ({ value: p.id, label: p.name, sub: [p.title, p.role].filter((x) => x !== '').join(' · ') || p.email, person: true }));
}

/** Several people: chips with a remove button and a picker to add one more. */
export function PeoplePicker({ value, onChange, people, label, placeholder }: { value: string[]; onChange: (ids: string[]) => void; people: Person[] | null; label: string; placeholder?: string | undefined }): React.JSX.Element {
  const byId = useMemo(() => new Map((people ?? []).map((p) => [p.id, p])), [people]);
  return (
    <div className="flex flex-col gap-2">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((id) => {
            const p = byId.get(id);
            return (
              <span key={id} className="inline-flex min-w-0 items-center gap-1.5 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] bg-[var(--hr-raised)] py-0.5 pl-1 pr-0.5 text-[13px]">
                <Avatar name={p?.name ?? '?'} size={20} />
                <span className="max-w-[160px] truncate">{p?.name ?? id}</span>
                <button type="button" aria-label={t('hiring.remove_person', { name: p?.name ?? '' })} onClick={() => onChange(value.filter((x) => x !== id))} className="hr-focus flex size-6 cursor-pointer items-center justify-center rounded-[4px] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)] hover:text-[var(--hr-ink)]">
                  <X size={13} aria-hidden />
                </button>
              </span>
            );
          })}
        </div>
      )}
      <Picker value="" onChange={(v) => v !== '' && onChange([...value, v])} items={personItems(people, value)} label={label} placeholder={placeholder ?? t('hiring.add_person')} />
    </div>
  );
}

/**
 * A protected file as an object URL (fetched with the session), for the
 * resume viewer. Returns { url, type, error }; the URL is released on unmount.
 */
export function useFileUrl(path: string | null, version = ''): { url: string | null; type: string; error: string | null } {
  const [state, setState] = useState<{ url: string | null; type: string; error: string | null }>({ url: null, type: '', error: null });
  useEffect(() => {
    if (path === null) {
      setState({ url: null, type: '', error: null });
      return;
    }
    let link: string | null = null;
    let alive = true;
    const pb = getPbClient().pb;
    const ctl = new AbortController();
    void fetch(pb.buildURL(path), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}, signal: ctl.signal })
      .then(async (res) => {
        if (!res.ok) throw new Error(t('hiring.resume_error'));
        const blob = await res.blob();
        link = URL.createObjectURL(blob);
        if (alive) setState({ url: link, type: blob.type, error: null });
      })
      .catch((e: unknown) => {
        if (alive && !(e instanceof DOMException && e.name === 'AbortError')) setState({ url: null, type: '', error: e instanceof Error ? e.message : t('hiring.resume_error') });
      });
    return () => {
      alive = false;
      ctl.abort();
      if (link !== null) URL.revokeObjectURL(link);
    };
  }, [path, version]);
  return state;
}

/** The one link style in a panel header (as in the other modules): mono caps, no underline, ink on hover, a 40 px touch area. */
export function AsideLink({ href, children }: { href: string; children: ReactNode }): React.JSX.Element {
  return (
    <a href={href} className="hr-focus hr-label hit inline-flex h-6 shrink-0 items-center gap-0.5 rounded-[3px] hover:!text-[var(--hr-ink)]">
      {children}
      <ChevronRight size={12} strokeWidth={2} aria-hidden />
    </a>
  );
}

/** The city of a time zone ('Asia/Singapore' -> 'Singapore'). */
export function zoneName(zone: string): string {
  const last = zone.split('/').pop() ?? zone;
  return last.replace(/_/g, ' ');
}

/** "Thu 5 Nov, 10:00 Singapore" (the interview's own wall time and zone). */
export function whenText(day: string, start: string, zone: string): string {
  return `${fmtDay(day, { weekday: true })}, ${start} ${zoneName(zone)}`;
}

/** The viewer's own wall time of an instant, when it differs from the interview zone. */
export function localTime(at: string): string {
  return time(at);
}

/** A pay range ("SGD 6,000.00 to SGD 8,000.00 a month"), each amount through Money. */
export function PayRange({ lo, hi, currency, per, className }: { lo: number | null | undefined; hi: number | null | undefined; currency: string; per?: string | undefined; className?: string | undefined }): React.JSX.Element | null {
  const a = lo !== null && lo !== undefined && lo > 0 ? lo : null;
  const b = hi !== null && hi !== undefined && hi > 0 ? hi : null;
  if ((a === null && b === null) || currency === '') return null;
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-1', className)}>
      {a !== null && <Money minor={a} currency={currency} />}
      {a !== null && b !== null && <span className="text-[var(--hr-muted)]">{t('hiring.to')}</span>}
      {b !== null && <Money minor={b} currency={currency} />}
      {per !== undefined && per !== '' && <span className="text-[var(--hr-muted)]">{t(`hiring.per.${per}`)}</span>}
    </span>
  );
}

/** One amount with how often it is paid ("SGD 3,000.00 once"). */
export function PayAmount({ minor, currency, per }: { minor: number | null | undefined; currency: string; per?: string | undefined }): React.JSX.Element | null {
  if (minor === null || minor === undefined || currency === '') return null;
  return (
    <span className="inline-flex flex-wrap items-baseline gap-x-1">
      <Money minor={minor} currency={currency} />
      {per !== undefined && per !== '' && <span className="text-[var(--hr-muted)]">{t(`hiring.per.${per}`)}</span>}
    </span>
  );
}

/** A labelled line of facts in a row (label in mono caps, value after). */
export function KV({ label, children }: { label: ReactNode; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-baseline gap-3 py-1.5">
      <span className="hr-label w-[112px] shrink-0">{label}</span>
      <span className="hr-wrap min-w-0 flex-1 text-[13px]">{children}</span>
    </div>
  );
}

/** A switch with its words beside it (the kit's Toggle carries only an aria label). */
export function ToggleRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string | undefined; disabled?: boolean | undefined }): React.JSX.Element {
  return (
    <div className="flex min-w-0 items-center justify-between gap-3">
      <span className="min-w-0">
        <span className="hr-wrap block text-[13px]">{label}</span>
        {hint !== undefined && hint !== '' && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{hint}</span>}
      </span>
      <Toggle checked={checked} onChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

/** Member names joined. */
export function names(list: { name: string }[]): string {
  return list.map((x) => x.name).join(', ');
}
