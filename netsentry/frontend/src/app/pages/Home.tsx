/**
 * Server › Details › Security score (#/score). The score and how it's worked out — nothing else:
 * what to fix lives on Home (one list, one count — v4 §5.1), every problem in the problems table.
 */
import { useEffect, useState } from 'react';
import { ProgressRing, Section, Spinner } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { Breadcrumbs, DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { AlertIcon, GaugeIcon } from '../components/icons.tsx';
import { runOp } from '../lib/ops.ts';
import type { Finding, Overview } from '../lib/types.ts';

const WORD: Record<string, string> = { critical: 'Urgent', high: 'Important', medium: 'Soon', low: 'When you have time', info: 'For your information' };

export function Home(): React.JSX.Element {
  const findings = useCollection<Finding>('findings', { filter: 'status = "open"' });
  const signature = findings.records.map((f) => f.id + f.status + f.severity).join(',');
  const data = useOp<Overview>('posture.overview', {}, { deps: signature }).data;
  const p = data?.posture;
  const raw = p ? (['critical', 'high', 'medium', 'low', 'info'] as const).reduce((t, s) => t + (p.bySeverity[s] ?? 0) * (p.weights[s] ?? 0), 0) : 0;

  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs trail={[{ label: 'Server', to: 'server' }, { label: 'Details', to: 'server/details' }, { label: 'Security score' }]} />
      <h1 className="mb-4 text-[20px] font-semibold">Security score</h1>
      <div className="mb-5 flex flex-wrap items-center gap-4 rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
        {p ? <ProgressRing value={p.score / 100} size={64} /> : <Spinner />}
        <div className="min-w-0 flex-1 text-[14px]">
          <p className="text-[18px] font-semibold">{p ? `${p.score} out of 100` : '…'}</p>
          <p className="text-[var(--agent-app-muted)]">100 means nothing is open. Every open problem takes points off — urgent ones the most — so the score goes up as you fix them.</p>
        </div>
      </div>
      {p && (
        <Section title="Where the points go" flush>
          <dl className="grid grid-cols-[1fr_max-content_max-content] gap-x-6 gap-y-2 p-4 text-[14px]">
            {(['critical', 'high', 'medium', 'low'] as const).map((s) => (
              <div key={s} className="contents">
                <dt>{WORD[s]}</dt>
                <dd className="text-right">{p.bySeverity[s] ?? 0} open</dd>
                <dd className="text-right text-[var(--agent-app-muted)]">−{p.weights[s] ?? 0} each</dd>
              </div>
            ))}
          </dl>
          <p className="border-t border-[var(--agent-app-border)] px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">
            {raw > p.perAssetCap
              ? `Together that is ${raw} points, but a server loses at most ${p.perAssetCap} — so the score starts rising once fewer than ${p.perAssetCap} points' worth are open. Fix the urgent ones first: they count the most.`
              : `Together: ${raw} points taken off.`}
            {' '}Home counts things to fix, not problems: problems with one cause (say, four apps Docker opens to every network) are one thing to fix there.
          </p>
        </Section>
      )}
      <div className="mt-5">
        <DrillList>
          <DrillRow to="home" icon={<GaugeIcon size={18} />} label="What to fix" hint="On Home: grouped by cause, each with the button that fixes it" />
          <DrillRow to="issues/all" icon={<AlertIcon size={18} />} label="Every problem, one by one" hint="The full table, with technical names" />
        </DrillList>
      </div>
    </div>
  );
}
