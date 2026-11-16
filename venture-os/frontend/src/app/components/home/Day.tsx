/**
 * Today: the day as a horizontal timeline (08:00 to 19:00, wider when a
 * meeting falls outside), each external meeting a block in its hours, the
 * current time a thin line. Hovering a block shows when, who and the Brief
 * button (network's brief Sheet; asking your AI agent for the brief when
 * there is none); a click on the block opens its deal or company.
 */
import { useEffect, useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { fmtDay, time } from '../../lib/format.ts';
import { act } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { BriefSheet } from '../network/BriefSheet.tsx';
import { MEETING_READS } from '../network/parts.tsx';
import { AgentTag, Button, Empty, Panel, Skeleton } from '../ui.tsx';
import type { DayMeeting } from './types.ts';
import { useWidth } from './viz.tsx';

/** Minutes from midnight now in the firm's zone, ticking each minute. */
function useNowMin(zone: string): number {
  const at = (): number => {
    try {
      const p = new Intl.DateTimeFormat('en-US', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date());
      const h = Number(p.find((x) => x.type === 'hour')?.value ?? 0);
      const m = Number(p.find((x) => x.type === 'minute')?.value ?? 0);
      return h * 60 + m;
    } catch {
      const d = new Date();
      return d.getHours() * 60 + d.getMinutes();
    }
  };
  const [now, setNow] = useState(at);
  useEffect(() => {
    const t = window.setInterval(() => setNow(at()), 60000);
    return () => window.clearInterval(t);
  }, [zone]);
  return now;
}

const ROW = 34;
const GAP = 8;
const AXIS = 26;
const LABEL_W = 168;

/** One row per meeting, in order of start. */
function rowsOf(list: DayMeeting[]): DayMeeting[] {
  return list.slice().sort((a, b) => a.start_min - b.start_min || a.end_min - b.end_min);
}

function Block({ m, x, w, top, width, past, live, onBrief }: { m: DayMeeting; x: number; w: number; top: number; width: number; past: boolean; live: boolean; onBrief: (m: DayMeeting) => Promise<void> }): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const name = m.company !== null ? m.company.name : m.title;
  const go = (): void => {
    if (m.deal !== null) navigate('/deals/' + m.deal.number);
    else if (m.company !== null) navigate('/companies/' + m.company.id);
  };
  // The name sits after the block, or before it when the day's end is closer than its start.
  const room = width - (x + w + 8);
  const after = room >= Math.min(LABEL_W, 120) || room >= x - 8;
  const lw = Math.max(40, Math.min(LABEL_W, after ? room : x - 8));
  const flip = x + 232 > width;
  return (
    <div className="absolute inset-x-0" style={{ top, height: ROW }}>
      <div className="absolute inset-y-0" style={{ left: after ? x : Math.max(0, x - lw - 8), width: w + lw + 8 }} onPointerEnter={() => setOpen(true)} onPointerLeave={() => setOpen(false)} onFocus={() => setOpen(true)} onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node | null) && setOpen(false)}>
        <button
          type="button"
          onClick={go}
          aria-label={`${time(m.start_at)} ${name}`}
          className={cn('vo-focus group absolute inset-y-0 flex min-w-0 items-center gap-2 rounded-[4px] text-left', after ? 'left-0 flex-row' : 'right-0 flex-row-reverse')}
          style={{ width: w + lw + 8 }}
        >
          <span
            className={cn(
              'flex h-full shrink-0 items-center overflow-hidden rounded-[4px] border-l-2 px-1.5 transition-[background-color,filter] duration-150',
              past ? 'border-[var(--vo-line-2)] bg-[var(--vo-sunk)] group-hover:bg-[var(--vo-active)]' : 'border-[var(--vo-a)] bg-[var(--vo-a-soft)] group-hover:brightness-[0.95] dark:group-hover:brightness-[1.3]',
              live && 'ring-1 ring-inset ring-[var(--vo-a)]',
            )}
            style={{ width: w }}
          >
            {w >= 48 && <span className="vo-mono vo-num truncate text-[12px] text-[var(--vo-muted)]">{time(m.start_at)}</span>}
          </span>
          <span className={cn('min-w-0 truncate text-[12px] font-medium group-hover:underline', past ? 'text-[var(--vo-ink-2)]' : 'text-[var(--vo-ink)]', !after && 'text-right')}>{name}</span>
        </button>
        {open && (
          <div role="dialog" aria-label={name} className={cn('absolute top-full z-20 w-[232px] pt-1.5', flip ? 'right-0' : 'left-0')}>
            <div className="rounded-[var(--vo-radius)] border border-[var(--vo-line)] bg-[var(--vo-raised)] p-3 shadow-[var(--vo-shadow-lg)]">
              <div className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">
                {time(m.start_at)} to {time(m.end_at)}
              </div>
              <div className="vo-wrap mt-0.5 text-[13px] font-medium text-[var(--vo-ink)]">{m.title !== '' ? m.title : name}</div>
              {m.attendees.length > 0 && <div className="vo-wrap mt-0.5 text-[12px] text-[var(--vo-ink-2)]">{m.attendees.join(', ') + (m.more > 0 ? ' +' + String(m.more) : '')}</div>}
              <Button
                size="sm"
                busy={busy}
                className="mt-2.5"
                onClick={() => {
                  setBusy(true);
                  void onBrief(m).finally(() => setBusy(false));
                }}
              >
                {m.brief === 'ready' && <AgentTag />}
                Brief
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Timeline({ meetings, zone, onBrief }: { meetings: DayMeeting[]; zone: string; onBrief: (m: DayMeeting) => Promise<void> }): React.JSX.Element {
  const [ref, width] = useWidth<HTMLDivElement>();
  const now = useNowMin(zone);
  const rows = rowsOf(meetings);
  const first = Math.min(...meetings.map((m) => m.start_min));
  const last = Math.max(...meetings.map((m) => m.end_min));
  let from = Math.min(8, Math.floor(first / 60));
  let to = Math.max(19, Math.ceil(last / 60));
  if (width > 0 && width < 520) {
    // A phone: the hours that hold meetings (at least five), so each block has room.
    from = Math.max(0, Math.floor(first / 60));
    to = Math.min(24, Math.max(from + 5, Math.ceil(last / 60)));
  }
  const span = Math.max(1, to - from) * 60;
  const long = (width - 40) / Math.max(1, to - from) >= 46;
  // Room at both ends for the first and last hour's label, centred on its line.
  const pad = long ? 20 : 9;
  const X = (min: number): number => pad + ((min - from * 60) / span) * Math.max(10, width - pad * 2);
  const height = AXIS + rows.length * ROW + (rows.length - 1) * GAP + 6;
  const hours: number[] = [];
  for (let h = from; h <= to; h++) hours.push(h);
  const showNow = now >= from * 60 && now <= to * 60;
  return (
    <div ref={ref} className="relative w-full min-w-0" style={{ height }}>
      {width > 0 && (
        <>
          {hours.map((h) => (
            <div key={h} aria-hidden className="pointer-events-none absolute bottom-0 top-[20px] w-px bg-[var(--vo-hair)]" style={{ left: X(h * 60) }} />
          ))}
          {(() => {
            // Hour labels centred on their line, kept inside the frame, none crowding the one before.
            const half = long ? 19 : 8;
            let end = -Infinity;
            return hours.map((h) => {
              const x = Math.max(0, Math.min(width - half * 2, X(h * 60) - half));
              if (x < end + 8) return null;
              end = x + half * 2;
              return (
                <span key={'l' + h} aria-hidden className="vo-mono vo-num pointer-events-none absolute top-0 text-center text-[12px] leading-4 text-[var(--vo-muted)]" style={{ left: x, width: half * 2 }}>
                  {String(h % 24).padStart(2, '0') + (long ? ':00' : '')}
                </span>
              );
            });
          })()}
          {showNow && (
            <div aria-hidden className="pointer-events-none absolute bottom-0 w-px bg-[var(--vo-ink)]" style={{ left: X(now), top: 18 }}>
              <span className="absolute -left-[3px] -top-[3px] size-[7px] rounded-full bg-[var(--vo-ink)]" />
            </div>
          )}
          {rows.map((m, i) => {
            const x = X(Math.max(from * 60, m.start_min));
            const w = Math.max(10, X(Math.min(to * 60, m.end_min)) - x - 1);
            return <Block key={m.id} m={m} x={x} w={w} top={AXIS + i * (ROW + GAP)} width={width} past={m.end_min <= now} live={m.start_min <= now && now < m.end_min} onBrief={onBrief} />;
          })}
        </>
      )}
    </div>
  );
}

export function TodayBlock({ day, loading, className }: { day: { day: string; zone: string; meetings: DayMeeting[] } | null; loading: boolean; className?: string | undefined }): React.JSX.Element | null {
  const [event, setEvent] = useState('');
  if (!loading && day === null) return null;
  const brief = async (m: DayMeeting): Promise<void> => {
    if (m.brief === null || m.brief === 'failed') await act([], () => op('briefs.request', { event: m.id }), MEETING_READS);
    setEvent(m.id);
  };
  return (
    <Panel divided label="Today's meetings" tip="Your meetings with companies and LPs today. Point at one for who is coming and its brief." className={className} aside={day !== null ? <span className="text-[12px] text-[var(--vo-muted)]">{fmtDay(day.day, { weekday: true, year: 'never' })}</span> : undefined}>
      {loading || day === null ? (
        <Skeleton className="h-[128px] w-full" />
      ) : day.meetings.length === 0 ? (
        <Empty icon={CalendarDays} title="No meetings today" className="py-8" />
      ) : (
        <>
          <Timeline meetings={day.meetings} zone={day.zone} onBrief={brief} />
          <ul className="sr-only">
            {day.meetings.map((m) => (
              <li key={m.id}>
                {time(m.start_at)} {m.company !== null ? m.company.name : m.title}
              </li>
            ))}
          </ul>
        </>
      )}
      <BriefSheet event={event} onClose={() => setEvent('')} />
    </Panel>
  );
}
