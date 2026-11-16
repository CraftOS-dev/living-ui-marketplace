/**
 * The month calendar of the request form: tap a day for one day, tap a
 * later day to make it a stretch (tapping an earlier day starts again).
 * Days off of the person's week are quiet, holidays carry a dot and their
 * name, leave already booked a coloured bar, locked days a padlock.
 */
import { useMemo } from 'react';
import { ChevronLeft, ChevronRight, Lock } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { IconButton } from '../ui.tsx';
import { addDays, dateOf, dayKey, fmtDay, monthName, weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { colorVar } from './LeaveIcon.tsx';

export interface DayMark {
  holiday?: string | undefined;
  half?: boolean | undefined;
  booked?: { color: string; label: string } | undefined;
  locked?: string | undefined;
}

function grid(month: string, weekStart: number): string[] {
  const first = dateOf(month.slice(0, 8) + '01');
  const lead = (first.getDay() - weekStart + 7) % 7;
  const start = addDays(dayKey(first), -lead);
  const out: string[] = [];
  for (let i = 0; i < 42; i++) out.push(addDays(start, i));
  // Drop a last row that is all next month.
  return out.slice(35, 42).every((d) => d.slice(0, 7) !== month.slice(0, 7)) ? out.slice(0, 35) : out;
}

export function RangeCalendar({ month, onMonth, from, to, onChange, weekOff, marks, min, max, weekStart = 1, today = dayKey() }: { month: string; onMonth: (m: string) => void; from: string; to: string; onChange: (from: string, to: string) => void; weekOff: number[]; marks: Record<string, DayMark>; min?: string | undefined; max?: string | undefined; weekStart?: number | undefined; today?: string | undefined }): React.JSX.Element {
  const days = useMemo(() => grid(month, weekStart), [month, weekStart]);
  const m = dateOf(month.slice(0, 8) + '01');
  const heads = days.slice(0, 7).map((d) => weekday(d, 'narrow'));
  const shift = (n: number): void => onMonth(dayKey(new Date(m.getFullYear(), m.getMonth() + n, 1)));
  const pick = (d: string): void => {
    if (from === '' || to !== from || d < from) onChange(d, d);
    else onChange(from, d);
  };
  return (
    <div className="w-full select-none">
      <div className="mb-1.5 flex items-center gap-1">
        <IconButton icon={ChevronLeft} label={t('ui.prev_month')} onClick={() => shift(-1)} size={40} />
        <div className="flex-1 text-center text-[14px] font-semibold">
          {monthName(m.getMonth() + 1)} <span className="hr-mono hr-num font-normal">{m.getFullYear()}</span>
        </div>
        <IconButton icon={ChevronRight} label={t('ui.next_month')} onClick={() => shift(1)} size={40} />
      </div>
      <div className="grid grid-cols-7 gap-1" role="grid" aria-label={t('leave.form.calendar')}>
        {heads.map((h, i) => (
          <span key={i} className="hr-label flex h-6 items-center justify-center">
            {h}
          </span>
        ))}
        {days.map((d) => {
          const other = d.slice(0, 7) !== month.slice(0, 7);
          const out = (min !== undefined && min !== '' && d < min) || (max !== undefined && max !== '' && d > max);
          const mk = marks[d] ?? {};
          const off = weekOff.includes(dateOf(d).getDay());
          const isEnd = d === from || d === to;
          const inside = from !== '' && d > from && d < to;
          const label = [fmtDay(d, { year: 'always', weekday: true }), mk.holiday, mk.booked?.label, mk.locked !== undefined ? t('leave.form.locked_day', { reason: mk.locked }) : undefined].filter((x) => x !== undefined && x !== '').join(', ');
          return (
            <button
              key={d}
              type="button"
              disabled={out}
              onClick={() => pick(d)}
              aria-label={label}
              aria-pressed={isEnd || inside}
              title={label}
              className={cn(
                'hr-focus relative flex h-10 flex-col items-center justify-center rounded-[var(--hr-radius-sm)] text-[13px] transition-colors disabled:cursor-default disabled:opacity-30',
                isEnd ? 'bg-[var(--hr-ink)] font-semibold text-[var(--hr-on-ink)]' : inside ? 'bg-[var(--hr-active)] text-[var(--hr-ink)] hover:bg-[var(--hr-line)]' : off || mk.holiday !== undefined ? 'bg-[var(--hr-sunk)] text-[var(--hr-muted)] hover:bg-[var(--hr-hover)]' : 'text-[var(--hr-ink)] hover:bg-[var(--hr-hover)]',
                other && !isEnd && !inside && 'opacity-55',
                d === today && !isEnd && 'ring-1 ring-inset ring-[var(--hr-line-2)]',
              )}
            >
              <span className="hr-mono hr-num leading-none">{Number(d.slice(8))}</span>
              {mk.holiday !== undefined && <span aria-hidden className={cn('mt-1 size-1 rounded-full', isEnd ? 'bg-[var(--hr-on-ink)]' : 'bg-[var(--hr-warn)]')} />}
              {mk.booked !== undefined && <span aria-hidden className="absolute bottom-1 left-2 right-2 h-[2px] rounded-full" style={{ background: colorVar(mk.booked.color) }} />}
              {mk.locked !== undefined && <Lock aria-hidden size={9} className={cn('absolute right-1 top-1', isEnd ? 'text-[var(--hr-on-ink)]' : 'text-[var(--hr-muted)]')} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}
