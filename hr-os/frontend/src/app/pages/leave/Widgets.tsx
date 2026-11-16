/**
 * Home widgets (placed by the Home page): who is out, for admins and managers; my leave, for employees.
 * Each numbers its panel with the host's `index`; Home owns the page's one primary action.
 */
import { useState } from 'react';
import { CalendarPlus, Users } from 'lucide-react';
import { Button, Panel, PersonChip, Skeleton } from '../../components/ui.tsx';
import { TypeMark } from '../../components/leave/LeaveIcon.tsx';
import { addDays, fmtDay } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { amount, figure, READS, unitWord } from './data.ts';
import { useMine } from './Mine.tsx';
import { RequestSheet } from './Request.tsx';
import type { HomeWidgetProps } from '../../lib/contract.ts';
import type { Home } from './types.ts';

export function WhosOutWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const live = useOp<Home>('leave.home', {}, READS, { name: 'leave.home.widget' });
  const d = live.data;
  return (
    <Panel index={index} label={t('leave.widget.out')} aside={<a href="#/leave/calendar" className="hr-label hr-focus hit rounded-[3px] hover:text-[var(--hr-ink)]">{t('leave.calendar.title')}</a>} flush>
      {d === null ? (
        <div className="p-3.5">
          <Skeleton className="h-8 w-full" />
        </div>
      ) : d.out_today.length === 0 ? (
        <p className="flex items-center gap-2 px-3.5 py-3 text-[13px] text-[var(--hr-muted)]">
          <Users size={14} aria-hidden />
          {t('leave.home.everyone_in')}
        </p>
      ) : (
        <ul>
          {d.out_today.slice(0, 6).map((r) => (
            <li key={r.id} className="flex min-h-10 items-center gap-2 border-t border-[var(--hr-hair)] px-3.5 py-2 first:border-t-0">
              <PersonChip name={r.name} size={22} strong={false} />
              <span className="hr-wrap ml-auto text-right text-[12px] text-[var(--hr-muted)]">
                {r.away_only === true ? t('leave.away') : r.type_name} · {t('leave.back_on', { day: fmtDay(addDays(r.end, 1)) })}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export function MyLeaveWidget({ index }: HomeWidgetProps): React.JSX.Element {
  const live = useMine(undefined);
  const [open, setOpen] = useState(false);
  const d = live.data;
  const top = (d?.balances ?? []).filter((b) => b.tracked && b.method !== 'manual').slice(0, 2);
  return (
    <Panel
      index={index}
      label={t('leave.my')}
      aside={
        d !== null && d.employment !== null ? (
          <Button size="sm" icon={CalendarPlus} onClick={() => setOpen(true)}>
            {t('leave.request_short')}
          </Button>
        ) : undefined
      }
    >
      {d === null ? (
        <Skeleton className="h-10 w-full" />
      ) : d.employment === null ? (
        <p className="text-[13px] text-[var(--hr-muted)]">{d.reason}</p>
      ) : (
        <div className="grid grid-cols-2 gap-3">
          {top.map((b) => (
            <button key={b.type} type="button" onClick={() => navigate('/leave')} className="hr-focus flex min-w-0 flex-col gap-1 rounded-[var(--hr-radius-sm)] border border-[var(--hr-line)] p-2.5 text-left transition-colors hover:border-[var(--hr-line-2)] hover:bg-[var(--hr-hover)]">
              <span className="flex min-w-0 items-start gap-1.5">
                <TypeMark icon={b.icon} size={18} />
                <span className="hr-label hr-wrap min-w-0 leading-[18px]">{b.name}</span>
              </span>
              <span>
                <span className="hr-mono hr-num text-[26px] font-light leading-none">{figure(b.available)}</span> <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{unitWord(b.unit, b.available)}</span>
              </span>
              {b.pending > 0 && <span className="hr-num whitespace-nowrap text-[12px] text-[var(--hr-warn)]">{t('leave.widget.waiting', { n: amount(b.pending, b.unit) })}</span>}
            </button>
          ))}
        </div>
      )}
      {open && d !== null && d.employment !== null && <RequestSheet open onClose={() => setOpen(false)} target={{ employment: d.employment, number: d.person.number, name: d.person.name, self: true }} types={d.types} />}
    </Panel>
  );
}
