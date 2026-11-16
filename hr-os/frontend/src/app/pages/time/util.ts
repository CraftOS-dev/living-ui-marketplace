/** Small shared pieces of the time pages: words and tones for states, reads, week maths. */
import type { Tone } from '../../components/ui.tsx';
import { can, isManager } from '../../lib/auth.tsx';
import { addDays, dateOf, minutes } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import type { Me } from '../../lib/types.ts';
import type { AttStatus, BoardState, PunchKind } from './types.ts';

/** The collections a time view reloads on. */
export const READS = {
  clock: ['checkins', 'attendance', 'shift_assignments', 'kiosk_pins'],
  board: ['checkins', 'attendance', 'shift_assignments', 'leave_requests'],
  week: ['shift_assignments', 'shift_types', 'shift_requests', 'leave_requests', 'job_records'],
  month: ['attendance', 'checkins', 'leave_requests'],
  sheets: ['timesheets', 'timesheet_entries', 'attendance', 'checkins'],
  requests: ['attendance_requests', 'shift_requests', 'overtime_requests', 'approvals'],
  rules: ['overtime_rules', 'shift_types', 'shift_patterns', 'kiosk_devices', 'locations'],
};

/** "7h 30m"; "0m" for zero. */
export function hm(m: number | null | undefined): string {
  return minutes(m ?? 0);
}

/** Hours with one decimal ("7.5"). */
export function hours(m: number): string {
  return (Math.round((m / 60) * 10) / 10).toLocaleString(undefined, { maximumFractionDigits: 1 });
}

export const STATE_TONE: Record<BoardState, Tone> = {
  in: 'good',
  break: 'warn',
  out: 'neutral',
  late: 'bad',
  absent: 'bad',
  on_leave: 'lh',
  remote: 'rh',
  on_duty: 'rh',
  expected: 'faint',
  off: 'faint',
  untracked: 'faint',
  none: 'faint',
};

export function stateLabel(s: BoardState): string {
  return t(`time.state.${s}`);
}

export const STATUS_TONE: Record<AttStatus, Tone> = {
  present: 'good',
  absent: 'bad',
  half_day: 'warn',
  on_leave: 'lh',
  holiday: 'faint',
  weekly_off: 'faint',
  remote: 'rh',
  on_duty: 'rh',
};

export function statusLabel(s: string): string {
  return t(`time.status.${s}`);
}

export function punchLabel(k: PunchKind): string {
  return t(`time.punch.${k}`);
}

/** May the viewer see other people's time (HR with time rights, or a manager)? */
export function seesOthers(me: Me): boolean {
  return can(me, 'time', 'view') || isManager(me);
}

export function editsTime(me: Me): boolean {
  return can(me, 'time', 'edit') || isManager(me);
}

/** The first day of the week holding `day` (weekStart 0 = Sunday). */
export function weekStartOf(day: string, weekStart: number): string {
  const wd = dateOf(day).getUTCDay();
  return addDays(day, -((wd - weekStart + 7) % 7));
}

/** Local "HH:MM" of now. */
export function nowTime(): string {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

/** "09:00 to 18:00". */
export function span(a: string, b: string): string {
  if (a === '' && b === '') return '';
  return t('time.span', { from: a, to: b });
}

export function flagLabel(f: string): string {
  return t(`time.flag.${f}`);
}

/** A device description for a punch ("phone" or "web") from the browser, kept short. */
export function deviceKind(): 'phone' | 'web' {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches ? 'phone' : 'web';
}

/** The location at the punch, asked only then (never tracked); null when refused or unavailable. */
export function locate(timeoutMs = 6000): Promise<{ lat: number; lng: number; accuracy_m: number } | null> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || navigator.geolocation === undefined) {
      resolve(null);
      return;
    }
    let done = false;
    const finish = (v: { lat: number; lng: number; accuracy_m: number } | null): void => {
      if (done) return;
      done = true;
      resolve(v);
    };
    setTimeout(() => finish(null), timeoutMs);
    try {
      navigator.geolocation.getCurrentPosition(
        (p) => finish({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy_m: Math.round(p.coords.accuracy) }),
        () => finish(null),
        { enableHighAccuracy: true, maximumAge: 60000, timeout: timeoutMs },
      );
    } catch {
      finish(null);
    }
  });
}
