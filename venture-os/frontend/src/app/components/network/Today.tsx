/**
 * Today (Home's block, SPEC 3.1): today's external meetings for me, the
 * time in mono, the company and the attendees, and a Brief button that
 * opens the brief in a Sheet (asking your AI agent for it when there is
 * none). While a brief is being prepared its StepTrack shows in the row.
 *
 *   <Today />        the rows (Home puts them in its own panel)
 *   <TodayPanel />   the rows in a panel labelled Today
 */
import { useState } from 'react';
import { CalendarDays } from 'lucide-react';
import { AgentTag, Button, Empty, LoadError, Panel, Skeleton, StepTrack } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { time } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { BriefSheet } from './BriefSheet.tsx';
import { MEETING_READS } from './parts.tsx';
import type { CalendarAnswer, MeetingView } from './types.ts';

function MeetingRow({ m, onBrief }: { m: MeetingView; onBrief: (id: string) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false);
  const who = m.attendees.filter((a) => a.external).map((a) => a.name || a.email);
  const preparing = m.brief !== null && (m.brief.state === 'queued' || m.brief.state === 'reading');
  const open = async (): Promise<void> => {
    if (m.brief === null || m.brief.state === 'failed') {
      setBusy(true);
      await act([], () => op('briefs.request', { event: m.id }), MEETING_READS);
      setBusy(false);
    }
    onBrief(m.id);
  };
  return (
    <li className="flex min-h-12 min-w-0 items-center gap-3 py-1.5">
      <span className="vo-mono vo-num w-12 shrink-0 text-[13px] text-[var(--vo-ink)]">{time(m.start_at)}</span>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="vo-wrap text-[13px] font-medium text-[var(--vo-ink)]">{m.company !== null ? m.company.name : m.title}</span>
        <span className="truncate text-[12px] text-[var(--vo-muted)]">{who.slice(0, 3).join(', ') + (who.length > 3 ? ' +' + String(who.length - 3) : '')}</span>
      </div>
      {preparing && m.brief !== null && <StepTrack labels={m.brief.steps.labels} at={m.brief.steps.at} compact className="w-14 shrink-0" />}
      <Button size="sm" busy={busy} onClick={() => void open()} className="shrink-0">
        {m.brief !== null && m.brief.state === 'ready' && <AgentTag />}
        Brief
      </Button>
    </li>
  );
}

/** Today's external meetings as rows, with the brief Sheet. */
export function Today(): React.JSX.Element {
  const live = useOp<CalendarAnswer>('calendar.list', {}, MEETING_READS, { name: 'net.today' });
  const [event, setEvent] = useState('');
  if (live.error !== null && live.data === null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-24 w-full" />;
  const rows = live.data.events.filter((m) => m.status !== 'cancelled');
  return (
    <>
      {rows.length === 0 ? (
        <Empty icon={CalendarDays} title="No meetings" className="py-6" />
      ) : (
        <ul className="flex min-w-0 flex-col divide-y divide-[var(--vo-hair)]">
          {rows.map((m) => (
            <MeetingRow key={m.id} m={m} onBrief={setEvent} />
          ))}
        </ul>
      )}
      <BriefSheet event={event} onClose={() => setEvent('')} />
    </>
  );
}

export function TodayPanel(): React.JSX.Element {
  return (
    <Panel label="Today">
      <Today />
    </Panel>
  );
}
