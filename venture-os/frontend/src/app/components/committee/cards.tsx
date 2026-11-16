/**
 * Focus card bodies for the committee's Next items (the kernel frame draws
 * the title, chips, figures and the actions):
 *   vote         the meeting, the memo and the cooling-off
 *   decide       the revealed tally and the rationales, junior first, with
 *                outcome, rule and pass reason as chips in place
 *   memo_drafts  each section your AI agent drafted, to keep or discard
 */
import { useEffect, useState } from 'react';
import { CalendarClock, FileText } from 'lucide-react';
import { ChipPicker, Tag } from '../ui.tsx';
import type { CardProps } from '../../lib/contract.ts';
import { fmtDay, time, dayOf } from '../../lib/format.ts';
import { Cooling, TallyView } from './parts.tsx';
import { OUTCOMES, PASS_REASONS, RULES, type TallyData } from './types.ts';

export function VoteCard({ item }: CardProps): React.JSX.Element {
  const d = item.data ?? {};
  const memo = d['memo'] as { number: string; version: number } | null | undefined;
  const startsAt = String(d['starts_at'] ?? '');
  const deal = String(d['deal'] ?? '');
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 text-[13px]">
      <span className="inline-flex items-center gap-1.5 text-[var(--vo-ink-2)]">
        <CalendarClock size={14} aria-hidden />
        <span className="vo-mono vo-num">
          {String(d['meeting'] ?? '')} {fmtDay(dayOf(startsAt), { weekday: true })} {time(startsAt)}
        </span>
      </span>
      {memo !== null && memo !== undefined && deal !== '' && (
        <a href={`#/deals/${deal}?tab=ic&part=memo`} className="vo-focus vo-link inline-flex items-center gap-1.5">
          <FileText size={14} aria-hidden />
          <span className="vo-mono">
            {memo.number} v{memo.version}
          </span>
        </a>
      )}
      <Cooling endsAt={String(d['cooling_end_at'] ?? '')} />
    </div>
  );
}

/** What the rule answers for these votes (the same rule as the server's tally): invest or pass. */
function ruleSays(tally: TallyData, rule: string, champion: string): 'invest' | 'pass' {
  const votes = tally.votes ?? [];
  if (votes.length === 0 || votes.some((v) => v.veto)) return 'pass';
  const yes = votes.filter((v) => v.lean === 'for').length;
  if (rule === 'consensus') return yes === votes.length ? 'invest' : 'pass';
  if (rule === 'champion') return votes.find((v) => v.member === champion)?.lean === 'for' ? 'invest' : 'pass';
  return yes * 2 > votes.length ? 'invest' : 'pass';
}

/**
 * The revealed tally and rationales, with the decision as chips in place:
 * outcome (the rule's answer preselected), rule (the fund's rule
 * preselected) and the pass reason. The card's Record decision button (A)
 * sends what is chosen, then asks the PIN.
 */
export function DecideCard({ item }: CardProps): React.JSX.Element | null {
  const tally = (item.data?.['tally'] ?? null) as TallyData | null;
  const champion = String(item.data?.['champion'] ?? '');
  const action = item.actions.find((a) => a.op === 'decisions.record');
  const [rule, setRule] = useState(String(item.data?.['rule'] ?? 'consensus'));
  const [outcome, setOutcome] = useState(String(item.data?.['outcome'] ?? ''));
  const [picked, setPicked] = useState(false);
  const [reason, setReason] = useState('');
  useEffect(() => {
    if (action === undefined) return;
    action.params = { ...(action.params ?? {}), outcome, rule, reason: outcome === 'pass' && reason !== '' ? reason : undefined };
  }, [action, outcome, rule, reason]);
  if (tally === null || tally.votes === undefined) return null;
  const members = tally.votes.map((v) => ({ id: v.member, name: v.name, voted: true, choice: v.choice, lean: v.lean as 'for' | 'against' | 'neutral', veto: v.veto, rationale: v.rationale }));
  const shown: TallyData = { ...tally, rule, result: ruleSays(tally, rule, champion) };
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <TallyView tally={shown} members={members} />
      {action !== undefined && (
        <div className="flex min-w-0 flex-col gap-3 border-t border-[var(--vo-hair)] pt-4">
          <ChipPicker
            label="Rule"
            options={RULES}
            value={rule as (typeof RULES)[number]['value']}
            onChange={(v) => {
              setRule(v);
              if (!picked) setOutcome(ruleSays(tally, v, champion));
            }}
          />
          <ChipPicker
            label="Outcome"
            keys
            options={OUTCOMES}
            value={outcome as (typeof OUTCOMES)[number]['value'] | ''}
            onChange={(v) => {
              setPicked(true);
              setOutcome(v);
            }}
          />
          {outcome === 'pass' && <ChipPicker label="Reason" options={PASS_REASONS} value={reason} onChange={setReason} />}
        </div>
      )}
    </div>
  );
}

export function MemoDraftsCard({ item }: CardProps): React.JSX.Element {
  const blocks = (item.data?.['blocks'] ?? []) as { id: string; label: string; content: string; uncited: number }[];
  return (
    <div className="flex min-w-0 flex-col gap-3">
      {blocks.map((b) => (
        <section key={b.id} className="flex min-w-0 flex-col gap-1 border-l-2 border-[var(--vo-agent)] bg-[var(--vo-agent-soft)] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold">{b.label}</span>
            {b.uncited > 0 && <Tag tone="warn">{b.uncited} uncited</Tag>}
          </div>
          <p className="vo-wrap line-clamp-4 whitespace-pre-wrap text-[13px] leading-5 text-[var(--vo-ink-2)]">{b.content.replace(/\s*\[(\d{1,3}|\?)\]/g, '')}</p>
        </section>
      ))}
    </div>
  );
}
