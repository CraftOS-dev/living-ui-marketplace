/**
 * A meeting brief in a Sheet: while your AI agent prepares it, the
 * StepTrack (Queued, Reading, Ready) and "Waiting for your AI agent"; once
 * ready, the attendees with the firm's strength (the app's numbers) and the
 * written sections: who they are, history, the deal, questions, news with
 * links.
 */
import { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { AgentTag, Avatar, Button, IconButton, LoadError, Notice, Section, Sheet, SheetHeader, Skeleton, StepTrack, Tag } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, fmtDateTime, time } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { BAND_TIP, MEETING_READS, StrengthBar } from './parts.tsx';
import type { BriefView } from './types.ts';
import { AskStatus } from '../agent.tsx';

function Text({ children }: { children: string }): React.JSX.Element {
  return <p className="vo-wrap whitespace-pre-line text-[13px] leading-5 text-[var(--vo-ink)]">{children}</p>;
}

function Body({ b }: { b: BriefView }): React.JSX.Element {
  const s = b.sections;
  const ready = b.state === 'ready';
  const ext = b.attendees.filter((a) => a.external);
  return (
    <div className="flex min-w-0 flex-col gap-6">
      {b.event !== null && (
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-[var(--vo-ink-2)]">
          <span className="vo-mono vo-num">{fmtDateTime(b.event.start_at)}</span>
          {b.event.end_at !== '' && <span className="text-[var(--vo-muted)]">to <span className="vo-mono vo-num">{time(b.event.end_at)}</span></span>}
          {b.company !== null && (
            <a className="vo-link hit" href={'#/companies/' + b.company.id}>
              {b.company.name}
            </a>
          )}
          {b.deal !== null && <Tag>{b.deal.stage_label}</Tag>}
          {b.event.meet !== '' && (
            <a className="vo-link hit inline-flex items-center gap-1" href={b.event.meet} target="_blank" rel="noreferrer">
              Join
              <ExternalLink size={12} aria-hidden />
            </a>
          )}
        </div>
      )}
      {!ready && (
        <div className="flex min-w-0 flex-col gap-3">
          <StepTrack labels={b.steps.labels} at={b.state === 'failed' ? 1 : b.steps.at} />
          {b.state === 'failed' ? <Notice tone="bad">{b.error !== '' ? b.error : 'No brief this time.'}</Notice> : <AskStatus state={b.ask} idle={<span className="text-[13px] text-[var(--vo-muted)]">Your AI agent is writing it</span>} />}
        </div>
      )}
      <Section title={<span title={BAND_TIP}>Attendees</span>}>
        <ul className="flex min-w-0 flex-col">
          {ext.map((a) => (
            <li key={a.email} className="flex min-h-10 min-w-0 items-center gap-2.5">
              <Avatar name={a.name} size={24} />
              {a.person !== null ? (
                <a className="vo-focus flex min-h-9 min-w-0 flex-1 items-center" href={'#/people/' + a.person}>
                  <span className="vo-link truncate text-[13px] font-medium">{a.name}</span>
                </a>
              ) : (
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{a.name}</span>
              )}
              {a.strength !== null && a.strength.best_member !== null && <span className="max-w-[30%] truncate text-[12px] text-[var(--vo-muted)] max-sm:hidden">{a.strength.best_member.name}</span>}
              <StrengthBar score={a.strength?.score ?? 0} band={a.strength?.band ?? 'none'} className="w-[110px] shrink-0" />
            </li>
          ))}
        </ul>
      </Section>
      {ready && s.who.length > 0 && (
        <Section title="Who">
          <div className="flex min-w-0 flex-col gap-3">
            {s.who.map((w) => (
              <div key={w.email + w.name} className="min-w-0">
                <div className="text-[13px] font-medium text-[var(--vo-ink)]">{w.name}</div>
                <Text>{w.text}</Text>
              </div>
            ))}
          </div>
        </Section>
      )}
      {ready && s.history !== '' && (
        <Section title="History">
          <Text>{s.history}</Text>
        </Section>
      )}
      {ready && s.deal !== '' && (
        <Section title="Deal">
          <Text>{s.deal}</Text>
        </Section>
      )}
      {ready && s.questions.length > 0 && (
        <Section title="Questions">
          <ol className="flex min-w-0 list-decimal flex-col gap-1.5 pl-5 text-[13px] leading-5 text-[var(--vo-ink)]">
            {s.questions.map((q) => (
              <li key={q} className="vo-wrap">
                {q}
              </li>
            ))}
          </ol>
        </Section>
      )}
      {ready && s.news.length > 0 && (
        <Section title="News">
          <ul className="flex min-w-0 flex-col">
            {s.news.map((n) => (
              <li key={n.url}>
                <a href={n.url} target="_blank" rel="noreferrer" className="vo-focus vo-tap flex min-h-9 min-w-0 items-center gap-2 rounded-[var(--vo-radius-sm)] px-1.5 transition-colors duration-150 hover:bg-[var(--vo-hover)]">
                  <span className="vo-wrap min-w-0 flex-1 text-[13px] text-[var(--vo-ink)]">{n.title}</span>
                  {n.day !== '' && <span className="vo-mono vo-num shrink-0 text-[12px] text-[var(--vo-muted)]">{fmtDay(n.day)}</span>}
                  <ExternalLink size={12} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
                </a>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </div>
  );
}

/** The brief of a calendar event in a Sheet (`event` is the cal_events id; '' closes it). */
export function BriefSheet({ event, onClose }: { event: string; onClose: () => void }): React.JSX.Element | null {
  const open = event !== '';
  const live = useOp<{ brief: BriefView }>('briefs.get', { event }, MEETING_READS, { skip: !open });
  const [busy, setBusy] = useState(false);
  const b = live.data?.brief ?? null;
  const again = async (): Promise<void> => {
    setBusy(true);
    await act([], () => op('briefs.request', { event, again: true }), MEETING_READS);
    setBusy(false);
  };
  return (
    <Sheet open={open} onClose={onClose} label="Brief" width={560}>
      <SheetHeader
        title={b?.event?.title ?? 'Brief'}
        onClose={onClose}
        actions={
          <>
            {b !== null && b.agent && b.state === 'ready' && <AgentTag />}
            {b !== null && (b.state === 'ready' || b.state === 'failed') && <IconButton icon={RefreshCw} label="Ask again" onClick={() => void again()} disabled={busy} />}
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
        {live.error !== null && b === null ? (
          live.code === 'no_brief' ? (
            <div className="flex flex-col items-start gap-3">
              <Button variant="primary" busy={busy} onClick={() => void again()}>
                Get brief
              </Button>
            </div>
          ) : (
            <LoadError message={live.error} onRetry={live.reload} />
          )
        ) : b === null ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <Body b={b} />
        )}
      </div>
    </Sheet>
  );
}
