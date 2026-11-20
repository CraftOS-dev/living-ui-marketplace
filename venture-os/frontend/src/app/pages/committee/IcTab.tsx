/**
 * The deal page's IC tab (one tab, SPEC U8): the latest decision on top
 * when there is one (outcome, rule, Tally, conditions, history), the memo
 * below it. `?tab=ic&part=memo` scrolls to the memo.
 */
import { useEffect, useRef } from 'react';
import type { RecordLike } from '../../lib/contract.ts';
import { useRoute } from '../../lib/router.ts';
import { DecisionPart } from './DecisionPart.tsx';
import { MemoTab } from './MemoTab.tsx';

export function IcTab({ deal }: { deal: RecordLike }): React.JSX.Element {
  const route = useRoute();
  const memoRef = useRef<HTMLDivElement | null>(null);
  const part = route.query.get('part') ?? '';
  useEffect(() => {
    if (part !== 'memo') return;
    const t = setTimeout(() => memoRef.current?.scrollIntoView({ block: 'start' }), 350);
    return () => clearTimeout(t);
  }, [part, deal.id]);
  return (
    <div className="flex min-w-0 flex-col gap-8">
      <DecisionPart deal={deal} />
      <div ref={memoRef} className="min-w-0 scroll-mt-16">
        <MemoTab deal={deal} />
      </div>
    </div>
  );
}
