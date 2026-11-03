/** Dates, durations and music names as people read them. */
import type { Stage } from './types.ts';

export function ms(v: string | null | undefined): number {
  if (v === undefined || v === null || v === '') return 0;
  const t = Date.parse(v.replace(' ', 'T'));
  return Number.isFinite(t) ? t : 0;
}

/** "just now", "5 min ago", "3 h ago", "yesterday", "12 Oct". */
export function ago(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return 'just now';
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  if (s < 172800) return 'yesterday';
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} days ago`;
  return shortDay(v);
}

export function shortDay(v: string): string {
  const t = ms(v.length === 10 ? v + 'T12:00:00' : v);
  if (t === 0) return '';
  const d = new Date(t);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) });
}

export function time(v: string): string {
  const t = ms(v);
  if (t === 0) return '';
  return new Date(t).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/** A local calendar day key, like the server's: "2026-11-01". */
export function dayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function weekday(day: string, style: 'narrow' | 'short' = 'short'): string {
  return new Date(day + 'T12:00:00').toLocaleDateString(undefined, { weekday: style });
}

/** "Today", "Tomorrow", "in 3 days" for a due day. */
export function dueText(day: string): string {
  if (day === '') return '';
  const a = new Date(dayKey() + 'T12:00:00').getTime();
  const b = new Date(day + 'T12:00:00').getTime();
  const n = Math.round((b - a) / 86400000);
  if (n <= 0) return 'due';
  if (n === 1) return 'tomorrow';
  return `in ${n} d`;
}

export function pct(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  return `${Math.round(v * 100)}%`;
}

export function minutes(v: number | null | undefined): string {
  if (v === null || v === undefined) return '–';
  if (v < 1 && v > 0) return '<1 min';
  if (v < 60) return `${Math.round(v)} min`;
  const h = Math.floor(v / 60);
  const m = Math.round(v - h * 60);
  return m === 0 ? `${h} h` : `${h} h ${m}`;
}

/** 0:42, 3:05, 1:02:10 */
export function clock(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
}

export function plural(n: number, one: string, many?: string): string {
  return `${n} ${n === 1 ? one : (many ?? one + 's')}`;
}

export function pad2(n: number): string {
  return String(Math.max(0, Math.round(n))).padStart(2, '0');
}

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export function noteName(midi: number, octave = true): string {
  return (NAMES[((midi % 12) + 12) % 12] ?? '') + (octave ? String(Math.floor(midi / 12) - 1) : '');
}

export const LEVEL_NAMES = ['', 'First steps', 'Beginner', 'Elementary', 'Late elementary', 'Intermediate', 'Upper intermediate', 'Early advanced', 'Advanced', 'Concert', 'Virtuoso'];
export function levelName(n: number): string {
  return LEVEL_NAMES[n] ?? '';
}

export const STAGE_ORDER: Stage[] = ['new', 'learning', 'steady', 'mastered'];
export const STAGE_LABEL: Record<Stage, string> = { new: 'New', learning: 'Learning', steady: 'Steady', mastered: 'Mastered' };
export function stageIndex(s: Stage): number {
  return STAGE_ORDER.indexOf(s);
}

export function bars(from: number, to: number): string {
  return from === to ? `bar ${from}` : `bars ${from}–${to}`;
}
