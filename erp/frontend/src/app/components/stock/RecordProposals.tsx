/**
 * Waiting proposals from your AI agent that concern one record (a build to
 * complete or void, a stock change to void) or one operation (new stock
 * changes), shown where the decision belongs. Nothing renders when there
 * are none, or when the person cannot decide them.
 */
import { Sparkles } from 'lucide-react';
import { ProposalCard } from '../Proposal.tsx';
import { Card, CardHeader } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { useLive } from '../../lib/live.ts';
import type { Collection } from '../../lib/live.ts';
import type { Proposal } from '../../lib/types.ts';

export function RecordProposals({
  match,
  title = 'Your AI agent proposes',
  watch = [],
  className,
}: {
  /** Which waiting proposals belong here. */
  match: (p: Proposal) => boolean;
  title?: string | undefined;
  watch?: Collection[] | undefined;
  className?: string | undefined;
}): React.JSX.Element | null {
  const live = useLive(() => op<{ proposals: Proposal[] }>('proposals.list', { status: 'waiting', limit: 100 }, { quiet: true }).then((r) => r.proposals), ['proposals', ...watch], []);
  const mine = (live.data ?? []).filter(match);
  if (mine.length === 0) return null;
  return (
    <Card tone="sand" className={className} delay={1}>
      <CardHeader title={title} subtitle={mine.length === 1 ? 'Waiting for a decision' : `${mine.length} waiting for a decision`} icon={Sparkles} />
      <div className="flex flex-col gap-3">
        {mine.map((p) => (
          <ProposalCard key={p.id} p={p} compact onDecided={live.reload} />
        ))}
      </div>
    </Card>
  );
}
