/**
 * Month calendar (the Command Center calendar language): oversized day
 * number for today, past days muted, dots per deadline tinted by severity,
 * click a day to list its deadlines.
 */
import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button, cn } from '../../kit/index.ts';
import { d10, deadlineSeverity, today } from '../lib/format.ts';
import type { DeadlineRec } from '../lib/types.ts';
import { TONE_DOT } from './ui.tsx';

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ymd(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

export function CalendarMonth({
  deadlines,
  selectedDay,
  onSelectDay,
}: {
  deadlines: DeadlineRec[];
  selectedDay: string;
  onSelectDay: (day: string) => void;
}): React.JSX.Element {
  const t = today();
  const [cursor, setCursor] = useState(() => ({ y: Number((selectedDay || t).slice(0, 4)), m: Number((selectedDay || t).slice(5, 7)) - 1 }));
  const byDay = useMemo(() => {
    const map = new Map<string, DeadlineRec[]>();
    for (const d of deadlines) {
      const k = d10(d.due_date);
      if (k === '') continue;
      const arr = map.get(k) ?? [];
      arr.push(d);
      map.set(k, arr);
    }
    return map;
  }, [deadlines]);
  const first = new Date(Date.UTC(cursor.y, cursor.m, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const days = new Date(Date.UTC(cursor.y, cursor.m + 1, 0)).getUTCDate();
  const cells: (string | null)[] = [];
  for (let i = 0; i < offset; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(ymd(cursor.y, cursor.m, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const move = (n: number): void => {
    setCursor((c) => {
      const m = c.m + n;
      return { y: c.y + Math.floor(m / 12), m: ((m % 12) + 12) % 12 };
    });
  };
  const isThisMonth = cursor.y === Number(t.slice(0, 4)) && cursor.m === Number(t.slice(5, 7)) - 1;
  return (
    <div>
      <div className="mb-3 flex items-end justify-between gap-3">
        <div className="flex items-end gap-3">
          {isThisMonth && <span className="text-[44px] font-extrabold leading-none tabular-nums text-[var(--agent-app-accent)]">{Number(t.slice(8, 10))}</span>}
          <div className="pb-1">
            <div className="text-sm font-semibold uppercase tracking-wider">{MONTHS[cursor.m]}</div>
            <div className="text-xs text-[var(--agent-app-muted)]">{cursor.y}</div>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => move(-1)} aria-label="Previous month">
            <ChevronLeft size={14} />
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 px-2 text-xs"
            onClick={() => {
              setCursor({ y: Number(t.slice(0, 4)), m: Number(t.slice(5, 7)) - 1 });
              onSelectDay(t);
            }}
          >
            Today
          </Button>
          <Button size="sm" variant="outline" className="h-7 px-2" onClick={() => move(1)} aria-label="Next month">
            <ChevronRight size={14} />
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-7 border-l border-t border-[var(--agent-app-border)]">
        {WEEKDAYS.map((w) => (
          <div key={w} className="border-b border-r border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (c === null) return <div key={`e${i}`} className="min-h-[76px] border-b border-r border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10" />;
          const list = byDay.get(c) ?? [];
          const open = list.filter((d) => d.status === 'open');
          const past = c < t;
          const isToday = c === t;
          const weekend = i % 7 >= 5;
          return (
            <button
              key={c}
              type="button"
              onClick={() => onSelectDay(c)}
              className={cn(
                'flex min-h-[76px] flex-col items-start gap-1 border-b border-r border-[var(--agent-app-border)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--agent-app-border)]/25',
                weekend && 'bg-[var(--agent-app-border)]/10',
                selectedDay === c && 'outline outline-2 -outline-offset-2 outline-[var(--agent-app-accent)]',
              )}
            >
              <span
                className={cn(
                  'text-xs tabular-nums',
                  isToday && 'bg-[var(--agent-app-accent)] px-1 font-bold text-[var(--agent-app-accent-contrast)]',
                  past && !isToday && 'text-[var(--agent-app-muted)]',
                )}
              >
                {Number(c.slice(8, 10))}
              </span>
              {open.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {open.slice(0, 4).map((d) => (
                    <span key={d.id} className={cn('size-1.5 rounded-full', TONE_DOT[deadlineSeverity(d).tone])} />
                  ))}
                  {open.length > 4 && <span className="text-[10px] text-[var(--agent-app-muted)]">+{open.length - 4}</span>}
                </div>
              )}
              {open.slice(0, 2).map((d) => (
                <span key={d.id} className="w-full truncate text-[10.5px] leading-tight text-[var(--agent-app-text)]/80">
                  {d.ref !== '' ? `${d.ref} ` : ''}
                  {d.title}
                </span>
              ))}
            </button>
          );
        })}
      </div>
    </div>
  );
}
