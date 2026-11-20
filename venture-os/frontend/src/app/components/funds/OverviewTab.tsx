/**
 * Overview: commitment, called, unfunded and distributed, the called share
 * as a bar, and the latest quarter close as a StepTrack.
 */
import { FigureStrip, Panel, StepTrack, Tag } from '../ui.tsx';
import { Meter } from '../charts.tsx';
import { money, pct } from '../../lib/format.ts';
import { setQuery } from '../../lib/router.ts';
import type { FundDash } from './types.ts';

export function OverviewTab({ d }: { d: FundDash }): React.JSX.Element {
  const cur = d.fund.currency;
  const o = d.overview;
  const q = d.quarter;
  return (
    <div className="grid min-w-0 gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <Panel>
        <FigureStrip
          items={[
            { label: 'Commitment', value: money(o.commitment_minor, cur, { compact: true }) },
            { label: 'Called', value: money(o.called_minor, cur, { compact: true }) },
            { label: 'Unfunded', value: money(o.unfunded_minor, cur, { compact: true }) },
            { label: 'Distributed', value: money(o.distributed_minor, cur, { compact: true }) },
          ]}
        />
        <Meter className="mt-5" label="Called" value={o.commitment_minor > 0 ? o.called_minor : null} max={o.commitment_minor || 1} format={() => (o.called_ppm === null ? '' : pct(o.called_ppm, 1))} height={8} />
      </Panel>
      <button type="button" onClick={() => setQuery({ tab: 'reports', quarter: q?.id ?? null })} className="vo-panel vo-in vo-focus flex min-w-0 cursor-pointer flex-col gap-4 px-5 py-4 text-left transition-colors duration-150 hover:bg-[var(--vo-hover)]">
        <div className="flex items-center gap-2">
          <span className="text-[14px] font-medium">{q !== null ? q.label : 'Quarter close'}</span>
          {q !== null && q.status === 'sent' && <Tag tone="good">Sent</Tag>}
        </div>
        <StepTrack labels={q !== null ? q.steps.labels : ['Open', 'Marks', 'Frozen', 'Letter', 'Sent']} at={q === null ? -1 : q.steps.done === true ? 5 : q.steps.at} />
      </button>
    </div>
  );
}
