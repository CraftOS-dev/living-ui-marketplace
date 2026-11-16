/** Shared helpers of the leave pages. */
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import type { LeaveRequest, RequestStatus, Unit } from './types.ts';
import type { Tone } from '../../components/ui.tsx';

/** Collections the leave screens read (live reload when any changes). */
export const READS = ['leave_requests', 'leave_ledger', 'leave_types', 'leave_policies', 'leave_policy_assignments', 'leave_blocks', 'leave_encash_requests', 'leave_comp_offs', 'approvals'];

/** "3 days", "0.5 day", "4 hours", "1 day". */
export function amount(n: number | null | undefined, unit: Unit | string = 'day'): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  const v = Math.round(n * 100) / 100;
  const shown = v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  if (unit === 'hour') return t(Math.abs(v) === 1 ? 'leave.unit.hour_one' : 'leave.unit.hours', { n: shown });
  return t(Math.abs(v) === 1 ? 'leave.unit.day_one' : 'leave.unit.days', { n: shown });
}

/** The number alone, for big readouts: "12", "2.5", "-1". */
export function figure(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '';
  return (Math.round(n * 100) / 100).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function unitWord(unit: Unit | string, n: number | null | undefined): string {
  const one = n !== null && n !== undefined && Math.abs(n) === 1;
  return unit === 'hour' ? t(one ? 'leave.unit.hour_word' : 'leave.unit.hours_word') : t(one ? 'leave.unit.day_word' : 'leave.unit.days_word');
}

export const STATUS_TONE: Record<RequestStatus, Tone> = { pending: 'warn', approved: 'good', rejected: 'bad', cancelled: 'faint', withdrawn: 'faint', cancelling: 'warn' };

export function statusLabel(s: string): string {
  return t(`leave.status.${s}`);
}

/** The days of a request as people read them, with half days and hours. */
export function whenText(r: Pick<LeaveRequest, 'start' | 'end' | 'start_half' | 'end_half' | 'hours'>): string {
  const range = fmtRange(r.start, r.end);
  if (r.hours > 0) return t('leave.when.hours', { day: fmtDay(r.start), n: r.hours });
  if (r.start === r.end && r.start_half !== '') return t(r.start_half === 'am' ? 'leave.when.morning' : 'leave.when.afternoon', { day: fmtDay(r.start) });
  const parts: string[] = [range];
  if (r.start_half === 'pm') parts.push(t('leave.when.from_noon'));
  if (r.end_half === 'am') parts.push(t('leave.when.until_noon'));
  return parts.join(', ');
}

/** Monday on or before a day (week starts per entity; 1 = Monday). */
export function weekStartOf(day: string, weekStart = 1): string {
  const d = new Date(day + 'T12:00:00');
  const diff = (d.getDay() - weekStart + 7) % 7;
  d.setDate(d.getDate() - diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
