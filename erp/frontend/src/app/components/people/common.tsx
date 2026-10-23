/**
 * Small pieces the People screens share: a person's avatar with their
 * photo, leave type icons, the words and tones of each state, working-day
 * counting for a leave request, a receipt fetched with the session, and
 * posted entries in the shape the books components draw.
 */
import { useEffect, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Baby, Briefcase, CalendarOff, GraduationCap, Heart, Home, Plane, Sun, Thermometer, Umbrella } from 'lucide-react';
import { cn, getPbClient } from '../../../kit/index.ts';
import { addDays, dayLabel, shortDay, today } from '../../lib/dates.ts';
import { initials, qty } from '../../lib/format.ts';
import { segmentColor } from '../../lib/palette.ts';
import type { JournalPreviewLine } from '../../lib/types.ts';
import type { ClaimStatus, Employment, Entry, LeaveIcon, LeaveStatus, PayFrequency, RunStatus } from '../../lib/types/people.ts';
import type { Tone } from '../ui.tsx';

/* --------------------------------------------------------------- people */

/** A photo path from the server ('/api/files/...') as a URL, with a thumbnail size. */
export function photoSrc(path: string | null | undefined, thumb: '96x96' | '400x400' = '96x96'): string | null {
  if (path === undefined || path === null || path === '') return null;
  return `${getPbClient().pb.buildURL(path)}?thumb=${thumb}`;
}

function hashOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** A person's photo, or their initials on a color of their own (the same person always gets the same one). */
export function PersonAvatar({ name, photo, size = 36, ring = false }: { name: string; photo?: string | null | undefined; size?: number | undefined; ring?: boolean | undefined; tone?: string | undefined }): React.JSX.Element {
  const src = photoSrc(photo, size > 96 ? '400x400' : '96x96');
  const cls = cn('shrink-0 rounded-full', ring && 'ring-4 ring-[var(--erp-shell)]');
  if (src !== null) return <img src={src} alt="" className={cn(cls, 'object-cover')} style={{ width: size, height: size }} />;
  const c = segmentColor(hashOf(name) % 5, false);
  const font = size >= 72 ? 26 : size >= 48 ? 15 : size >= 36 ? 14 : 12;
  return (
    <span aria-hidden className={cn(cls, 'flex items-center justify-center font-bold')} style={{ width: size, height: size, fontSize: font, background: c.fill, color: c.text }}>
      {initials(name)}
    </span>
  );
}

export const EMPLOYMENT_LABEL: Record<Employment, string> = {
  full_time: 'Full time',
  part_time: 'Part time',
  contractor: 'Contractor',
  intern: 'Intern',
  temporary: 'Temporary',
};

export const FREQUENCY_LABEL: Record<PayFrequency, string> = {
  monthly: 'Monthly',
  semi_monthly: 'Twice a month',
  biweekly: 'Every two weeks',
  weekly: 'Weekly',
};

export const EMPLOYEE_STATUS: Record<string, { label: string; tone: Tone }> = {
  active: { label: 'Active', tone: 'good' },
  on_leave: { label: 'On leave', tone: 'warn' },
  left: { label: 'Left', tone: 'neutral' },
};

/* ---------------------------------------------------------------- leave */

export const LEAVE_ICONS: Record<LeaveIcon, LucideIcon> = {
  sun: Sun,
  thermometer: Thermometer,
  'calendar-off': CalendarOff,
  baby: Baby,
  heart: Heart,
  plane: Plane,
  'graduation-cap': GraduationCap,
  briefcase: Briefcase,
  home: Home,
  umbrella: Umbrella,
};

export function leaveIcon(icon: string | undefined): LucideIcon {
  return LEAVE_ICONS[(icon ?? 'calendar-off') as LeaveIcon] ?? CalendarOff;
}

export const LEAVE_STATE: Record<LeaveStatus, { label: string; tone: Tone }> = {
  submitted: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'good' },
  rejected: { label: 'Rejected', tone: 'bad' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

/** "1 day", "2.5 days", "Half a day". */
export function daysText(n: number): string {
  if (n === 0.5) return 'Half a day';
  return `${qty(n)} ${n === 1 ? 'day' : 'days'}`;
}

/** "Mon, Oct 26" or "Oct 26 to Oct 30". */
export function rangeLabel(from: string, to: string): string {
  if (from === to || to === '') return dayLabel(from);
  const sameYear = from.slice(0, 4) === to.slice(0, 4) && from.slice(0, 4) === today().slice(0, 4);
  return sameYear ? `${shortDay(from)} to ${shortDay(to)}` : `${dayLabel(from)} to ${dayLabel(to)}`;
}

/** ISO weekday 1 (Monday) .. 7 (Sunday). */
export function weekday(day: string): number {
  const d = new Date(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return ((d.getDay() + 6) % 7) + 1;
}

/**
 * Working days from..to the way the server counts them: the company's
 * working weekdays, less holidays; a half day is 0.5. Also the holidays
 * that fell on working days (named, so the person sees why).
 */
export function countWorkingDays(from: string, to: string, half: boolean, holidays: Map<string, string>, workingDays: number[]): { days: number; skipped: { date: string; name: string }[] } {
  if (from === '' || to === '' || to < from) return { days: 0, skipped: [] };
  let days = 0;
  const skipped: { date: string; name: string }[] = [];
  let d = from;
  let guard = 0;
  while (d <= to && guard < 800) {
    if (workingDays.includes(weekday(d))) {
      const h = holidays.get(d);
      if (h !== undefined) skipped.push({ date: d, name: h });
      else days += 1;
    }
    d = addDays(d, 1);
    guard += 1;
  }
  if (half && days > 0) days = 0.5;
  return { days, skipped };
}

/* --------------------------------------------------------------- claims */

export const CLAIM_STATE: Record<ClaimStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  submitted: { label: 'Waiting', tone: 'warn' },
  approved: { label: 'Approved', tone: 'info' },
  rejected: { label: 'Rejected', tone: 'bad' },
  posted: { label: 'To pay', tone: 'accent' },
  paid: { label: 'Paid', tone: 'good' },
};

/** A claim line's receipt, fetched with the session (an <img> cannot send it). */
export function useReceipt(lineId: string | null): { url: string | null; image: boolean; failed: boolean } {
  const [state, setState] = useState<{ url: string | null; image: boolean; failed: boolean }>({ url: null, image: false, failed: false });
  useEffect(() => {
    if (lineId === null) return;
    let gone = false;
    let made: string | null = null;
    const pb = getPbClient().pb;
    const u = new URL(pb.buildURL('/api/ops/claims/receipt'));
    u.searchParams.set('line', lineId);
    fetch(u.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}, credentials: 'include' })
      .then(async (res) => {
        if (gone) return;
        if (!res.ok) {
          setState({ url: null, image: false, failed: true });
          return;
        }
        const blob = await res.blob();
        if (gone) return;
        made = URL.createObjectURL(blob);
        setState({ url: made, image: blob.type.startsWith('image/'), failed: false });
      })
      .catch(() => {
        if (!gone) setState({ url: null, image: false, failed: true });
      });
    return () => {
      gone = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [lineId]);
  return state;
}

/* -------------------------------------------------------------- payroll */

export const RUN_STATE: Record<RunStatus, { label: string; tone: Tone }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  approved: { label: 'Approved', tone: 'info' },
  posted: { label: 'To pay', tone: 'accent' },
  paid: { label: 'Paid', tone: 'good' },
};

/* ---------------------------------------------------------------- books */

/** A posted entry's lines in the shape JournalLines and BooksDetail draw. */
export function entryLines(entry: Entry | null | undefined): JournalPreviewLine[] {
  if (entry === null || entry === undefined) return [];
  return entry.lines.map((l) => ({ account: l.account, debit: l.debit, credit: l.credit, memo: l.memo, party: l.party?.name ?? '' }));
}
