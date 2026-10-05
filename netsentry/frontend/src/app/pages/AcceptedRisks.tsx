/**
 * Accepted risks (plan §12.2, §12.3, P5): everything someone decided is fine —
 * who, why, until when. An acceptance with an end date lapses by itself: the
 * issue counts again and the daily summary says so.
 */
import { Button, EmptyState, Pill, Spinner, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { Breadcrumbs } from '../components/Breadcrumbs.tsx';
import { relTime } from '../lib/format.ts';
import { useMe } from '../lib/me.tsx';
import { go, to } from '../lib/nav.ts';
import { runOp } from '../lib/ops.ts';
import type { Asset, Finding } from '../lib/types.ts';
import type { RecordModel } from 'pocketbase';

interface Suppression extends RecordModel {
  fingerprint: string;
  reason: string;
  until: string;
  created_by: string;
}

function day(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

export function AcceptedRisks(): React.JSX.Element {
  const { can } = useMe();
  const sup = useCollection<Suppression>('suppressions', { sort: 'until' });
  // The issue behind each acceptance, whatever its state now (a lapsed one is open again).
  const fps = sup.records.map((x) => x.fingerprint).slice(0, 60);
  const findings = useCollection<Finding>('findings', { filter: fps.length ? fps.map((f) => `fingerprint = ${JSON.stringify(f)}`).join(' || ') : 'id = ""' });
  const assets = useCollection<Asset>('assets');
  const now = new Date().toISOString();
  const live = sup.records.filter((s) => !s.until || s.until.replace(' ', 'T') > now);
  const lapsed = sup.records.filter((s) => s.until && s.until.replace(' ', 'T') <= now);
  const findingOf = (s: Suppression): Finding | undefined => findings.records.find((f) => f.fingerprint === s.fingerprint);
  const where = (f: Finding | undefined): string => {
    const a = f ? assets.records.find((x) => x.id === f.asset) : undefined;
    return a ? a.label || a.identifier : '';
  };
  const stop = async (f: Finding): Promise<void> => {
    try {
      await runOp('findings.unsuppress', { finding_id: f.id, note: 'No longer accepted.' });
      toast.success('It counts again.');
    } catch {
      /* toast shown */
    }
  };

  const row = (s: Suppression): React.JSX.Element => {
    const f = findingOf(s);
    const soon = s.until && Date.parse(s.until.replace(' ', 'T')) - Date.now() < 14 * 86400000;
    return (
      <div key={s.id} className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] py-3 last:border-b-0 sm:flex-row sm:items-center">
        <button className="min-w-0 flex-1 text-left" onClick={() => f && go(to.issue(f.id))} disabled={!f}>
          <span className="block text-[14px] font-medium">
            {f ? f.plain_title || f.title : 'An issue NetSentry no longer has'}
            {f && f.status === 'open' && s.until && s.until.replace(' ', 'T') <= now ? ' — open again' : ''}
            {f && f.status === 'resolved' ? ' — fixed since' : ''}
          </span>
          <span className="block text-[12px] text-[var(--agent-app-muted)]">
            {where(f) ? `on ${where(f)} · ` : ''}“{s.reason}” — accepted by {s.created_by} {relTime(s.created)}
          </span>
        </button>
        <div className="flex items-center gap-2">
          {s.until ? <Pill tone={soon ? 'warn' : 'neutral'}>until {day(s.until)}</Pill> : <Pill tone="neutral">no end date</Pill>}
          {f && f.status === 'suppressed' && can('analyst') && (
            <Button size="sm" variant="ghost" onClick={() => void stop(f)}>
              Stop accepting
            </Button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <div>
        <Breadcrumbs trail={[{ label: 'Home', to: 'home' }, { label: 'Accepted risks' }]} />
        <h1 className="text-[20px] font-semibold">Accepted risks</h1>
        <p className="mt-1 text-[14px] text-[var(--agent-app-muted)]">What people decided is fine, why, and until when. When the date passes it counts again and NetSentry says so.</p>
      </div>
      {sup.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : live.length === 0 ? (
        <EmptyState title="Nothing accepted" message="When you press “It's fine” on an issue, it is listed here with your reason and its end date." />
      ) : (
        <section className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4">{live.map(row)}</section>
      )}
      {lapsed.length > 0 && (
        <section>
          <h2 className="mb-1 px-1 text-[13px] font-semibold">Lapsed — counting again</h2>
          <div className="rounded-xl border border-[var(--agent-app-border)] px-4">{lapsed.map(row)}</div>
        </section>
      )}
    </div>
  );
}
