/**
 * Focus card body for a stalled deal (NextItem card 'stall'): where the deal
 * sits on its stage track (the current dot amber) and how long it has been
 * there against the stage's stall days. The frame draws the title, the
 * figures and Move, Pass, Snooze.
 */
import { Meter } from '../charts.tsx';
import { StageTrack } from '../ui.tsx';
import type { CardProps } from '../../lib/contract.ts';

export function StallCard({ item }: CardProps): React.JSX.Element | null {
  const d = item.data as { stage?: string; stages?: { key: string; label: string }[]; days_in_stage?: number; stall_days?: number } | null;
  if (d === null || d.stages === undefined || d.stage === undefined) return null;
  const days = d.days_in_stage ?? 0;
  const stall = Math.max(1, d.stall_days ?? 1);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <StageTrack stages={d.stages} current={d.stage} stalled />
      <Meter value={days} max={Math.max(days, stall * 2)} tone="warn" marks={[{ value: stall, label: 'Stall' }]} label="Days in stage" format={(v) => `${Math.round(v)}d`} />
    </div>
  );
}
