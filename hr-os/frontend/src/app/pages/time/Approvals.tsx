/**
 * Decision context for the time approval kinds inside an Inbox card: what
 * the person asks against what the punches say (attendance fixes), the
 * days and shifts that change (shift requests and swaps), the week's
 * numbers with its exceptions (timesheets, one tap to approve), and the
 * overtime asked against the planned day.
 */
import { cn } from '../../../kit/index.ts';
import { StatusDot, Tag } from '../../components/ui.tsx';
import type { ApprovalViewProps } from '../../lib/contract.ts';
import { fmtDay, weekday } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import type { Exception, Totals } from './types.ts';
import { hm, punchLabel, statusLabel } from './util.ts';

type P = Record<string, unknown>;

function payloadOf(a: Record<string, unknown>): P {
  const p = a['payload'];
  return p !== null && typeof p === 'object' ? (p as P) : {};
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

function Line({ label, children }: { label: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex items-baseline gap-3 text-[13px]">
      <span className="hr-label w-24 shrink-0">{label}</span>
      <span className="hr-wrap min-w-0 flex-1">{children}</span>
    </div>
  );
}

export function AttendanceRequestView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = payloadOf(approval);
  const kind = str(p['kind']);
  const punches = Array.isArray(p['punches']) ? (p['punches'] as { kind: 'in' | 'out' | 'break_start' | 'break_end'; time: string; voided: boolean }[]) : [];
  const cur = p['current'] !== null && typeof p['current'] === 'object' ? (p['current'] as { status: string; worked_min: number; flags: string[] }) : null;
  const from = str(p['from_day']);
  const to = str(p['to_day']);
  return (
    <div className="flex flex-col gap-1.5">
      <Line label={t('time.appr.days')}>{from === to || to === '' ? fmtDay(from, { weekday: true }) : fmtDay(from) + ' to ' + fmtDay(to)}</Line>
      {(kind === 'missed_punch' || kind === 'correction') && (
        <>
          <Line label={t('time.appr.asks')}>
            <span className="hr-mono hr-num">
              {str(p['in_time']) !== '' ? t('time.req.in') + ' ' + str(p['in_time']) : ''}
              {str(p['in_time']) !== '' && str(p['out_time']) !== '' ? ' · ' : ''}
              {str(p['out_time']) !== '' ? t('time.req.out') + ' ' + str(p['out_time']) : ''}
            </span>
          </Line>
          <Line label={t('time.appr.punched')}>
            {punches.length === 0 ? (
              <span className="text-[var(--hr-muted)]">{t('time.clock.no_punches')}</span>
            ) : (
              <span className="flex flex-wrap gap-x-3">
                {punches.map((x, i) => (
                  <span key={i} className={cn('hr-mono hr-num', x.voided && 'line-through opacity-50')}>
                    {punchLabel(x.kind)} {x.time}
                  </span>
                ))}
              </span>
            )}
          </Line>
        </>
      )}
      {cur !== null && (
        <Line label={t('time.appr.now')}>
          {statusLabel(cur.status)}
          {cur.worked_min > 0 ? ' · ' + hm(cur.worked_min) : ''}
          {(cur.flags ?? []).some((f) => f.startsWith('missed')) && <Tag tone="bad" className="ml-2">{t('time.flag.missed_out')}</Tag>}
        </Line>
      )}
      {str(p['reason']) !== '' && <Line label={t('time.req.reason')}>{str(p['reason'])}</Line>}
    </div>
  );
}

export function ShiftRequestView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = payloadOf(approval);
  const days = Array.isArray(p['days']) ? (p['days'] as { day: string; from: string; to: string; leave: boolean }[]) : [];
  const swap = p['swap'] !== null && typeof p['swap'] === 'object' ? (p['swap'] as { requester: { name: string; day: string; shift: string }; peer: { name: string; day: string; shift: string } }) : null;
  return (
    <div className="flex flex-col gap-1.5">
      {swap !== null ? (
        <>
          <Line label={swap.requester.name}>
            {fmtDay(swap.requester.day, { weekday: true })} · {swap.requester.shift}
          </Line>
          <Line label={swap.peer.name}>
            {fmtDay(swap.peer.day, { weekday: true })} · {swap.peer.shift}
          </Line>
          <p className="text-[12px] text-[var(--hr-muted)]">{t('time.appr.swap_agreed')}</p>
        </>
      ) : (
        <ul className="flex flex-col gap-0.5">
          {days.map((d) => (
            <li key={d.day} className="flex items-center gap-2 text-[13px]">
              <span className="hr-mono hr-num w-20 shrink-0">{fmtDay(d.day)}</span>
              <span className="min-w-0 flex-1 text-[var(--hr-muted)] line-through">{d.from}</span>
              <span className="min-w-0 flex-1">{d.to}</span>
              {d.leave && <Tag tone="lh">{t('time.week.leave')}</Tag>}
            </li>
          ))}
        </ul>
      )}
      {str(p['reason']) !== '' && <Line label={t('time.req.reason')}>{str(p['reason'])}</Line>}
    </div>
  );
}

export function TimesheetView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = payloadOf(approval);
  const totals = (p['totals'] ?? {}) as Totals;
  const days = Array.isArray(p['days']) ? (p['days'] as { day: string; status: string; kind: string; worked: number; regular: number; overtime: number; leave: number }[]) : [];
  const exc = Array.isArray(p['exceptions']) ? (p['exceptions'] as Exception[]) : [];
  const max = Math.max(60, ...days.map((d) => d.regular + d.overtime + d.leave));
  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {(['regular_min', 'overtime_min', 'leave_min', 'total_min'] as const).map((k) => (
          <span key={k} className="flex items-baseline gap-1.5">
            <span className="hr-label">{t('time.appr.' + k)}</span>
            <span className={cn('hr-mono hr-num text-[14px]', k === 'overtime_min' && (totals[k] ?? 0) > 0 && 'text-[var(--hr-rh)]')}>{hm(totals[k] ?? 0)}</span>
          </span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1.5" aria-hidden>
        {days.map((d) => {
          const h = 44;
          const r = (d.regular / max) * h;
          const o = (d.overtime / max) * h;
          const l = (d.leave / max) * h;
          return (
            <div key={d.day} className="flex flex-col items-center gap-1">
              <div className="flex h-11 w-full items-end justify-center">
                <div className="flex w-3 flex-col-reverse overflow-hidden rounded-[2px]">
                  <span className="bg-[var(--hr-ink-2)]" style={{ height: r }} />
                  <span className="bg-[var(--hr-rh)]" style={{ height: o }} />
                  <span className="bg-[var(--hr-lh)]" style={{ height: l }} />
                </div>
              </div>
              <span className="hr-label">{weekday(d.day, 'narrow')}</span>
              <span className="hr-mono hr-num text-[10.5px] text-[var(--hr-muted)]">{d.regular + d.overtime > 0 ? hm(d.regular + d.overtime) : ''}</span>
            </div>
          );
        })}
      </div>
      {exc.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {exc.map((x, i) => (
            <li key={i} className="flex items-start gap-2 text-[13px]">
              <StatusDot tone="warn" />
              <span className="hr-mono hr-num w-14 shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtDay(x.day)}</span>
              <span className="hr-wrap min-w-0 flex-1">{x.message}</span>
            </li>
          ))}
        </ul>
      ) : (
        <StatusDot tone="good" label={t('time.appr.clean')} />
      )}
      {str(p['note']) !== '' && <Line label={t('time.appr.note')}>{str(p['note'])}</Line>}
    </div>
  );
}

export function OvertimeView({ approval }: ApprovalViewProps): React.JSX.Element {
  const p = payloadOf(approval);
  return (
    <div className="flex flex-col gap-1.5">
      <Line label={t('time.appr.days')}>{fmtDay(str(p['day']), { weekday: true })}</Line>
      <Line label={t('time.appr.overtime')}>
        <span className="hr-mono hr-num">{hm(Number(p['minutes']) || 0)}</span>
      </Line>
      {str(p['planned']) !== '' && (
        <Line label={t('time.appr.planned')}>
          <span className="hr-mono hr-num">{str(p['planned'])}</span>
        </Line>
      )}
      {str(p['reason']) !== '' && <Line label={t('time.req.reason')}>{str(p['reason'])}</Line>}
    </div>
  );
}
