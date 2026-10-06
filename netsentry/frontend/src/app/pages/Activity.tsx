/**
 * Activity — what happened: network activity, changes NetSentry noticed, and
 * what people and the agent did (a readable slice of the audit log).
 */
import { Fragment, useMemo, useState } from 'react';
import { Button, EmptyState, ListRow, PageHeader, Pill, Section, Spinner, Tabs, TabsContent, TabsList, TabsTrigger, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { DrillList, DrillRow } from '../components/Breadcrumbs.tsx';
import { AlertIcon, ThumbUpIcon } from '../components/icons.tsx';
import { ActorLabel } from '../components/pills.tsx';
import { describeObservation, KIND_LABELS, observationTitle, pbSince, relTime } from '../lib/format.ts';
import type { Asset, AuditEntry, Change, DetectionRecord } from '../lib/types.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { Network } from './Network.tsx';
import { useAppNames } from '../components/ServerParts.tsx';

export type ActivityTab = 'inbox' | 'network' | 'changes' | 'actions';

const EVIDENCE_ORDER = ['program', 'publisher', 'signed', 'file', 'connected_to', 'user', 'path', 'name', 'command'];

/** Things that happened, to review: "Expected" closes them for good; "Looks wrong" makes an issue. */
function Inbox({ onOpenFinding }: { onOpenFinding: (id: string) => void }): React.JSX.Element {
  const { can } = useMe();
  const items = useCollection<DetectionRecord>('detections', { filter: 'verdict = "unreviewed"', sort: '-last_at' });
  const learned = useCollection<DetectionRecord>('detections', { filter: 'verdict = "learned" || verdict = "known_good"' });
  const assets = useCollection<Asset>('assets');
  const name = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  const [busy, setBusy] = useState<string | null>(null);
  const verdict = async (d: DetectionRecord, v: 'expected' | 'suspicious'): Promise<void> => {
    setBusy(d.id + v);
    try {
      const r = await runOp<{ finding_id: string }>('detections.verdict', { detection_id: d.id, verdict: v });
      toast.success(v === 'expected' ? 'Marked as expected — it won’t come back.' : 'Added to Needs you.');
      if (r.finding_id) onOpenFinding(r.finding_id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--agent-app-muted)]">
        Things that happened on the server — a new program, a new startup item, a changed system file. Most are updates or things you installed. Tell NetSentry which ones you expected.
        {learned.records.length ? ` (${learned.records.length} were learned quietly while NetSentry got to know the server, or come from your operating system's maker.)` : ''}
      </p>
      {items.loading ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : items.records.length === 0 ? (
        <EmptyState title="Nothing to review" message="New activity that needs a look will appear here." />
      ) : (
        items.records.map((d) => {
          const ev = (d.evidence ?? {}) as Record<string, unknown>;
          const facts = EVIDENCE_ORDER.filter((k) => ev[k] !== undefined && ev[k] !== '' && !(Array.isArray(ev[k]) && !(ev[k] as unknown[]).length));
          return (
            <div key={d.id} className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4">
              <p className="text-[15px] font-medium">{d.summary}</p>
              <p className="mt-0.5 text-[12px] text-[var(--agent-app-muted)]">
                {name[d.asset] ?? ''} · {relTime(d.last_at)}
                {d.count > 1 ? ` · seen ${d.count} times` : ''}
              </p>
              {facts.length > 0 && (
                <dl className="mt-2 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                  {facts.map((k) => (
                    <Fragment key={k}>
                      <dt className="text-[var(--agent-app-muted)]">{k.replace('_', ' ')}</dt>
                      <dd className="break-all">{Array.isArray(ev[k]) ? (ev[k] as unknown[]).join(', ') : String(ev[k])}</dd>
                    </Fragment>
                  ))}
                </dl>
              )}
              {can('analyst') && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button size="sm" loading={busy === d.id + 'expected'} onClick={() => void verdict(d, 'expected')}>
                    Expected
                  </Button>
                  <Button size="sm" variant="secondary" loading={busy === d.id + 'suspicious'} onClick={() => void verdict(d, 'suspicious')}>
                    Looks wrong
                  </Button>
                </div>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

function Changes({ onOpenItem }: { onOpenItem: (id: string) => void }): React.JSX.Element {
  const since = useMemo(() => pbSince(24 * 7), []);
  const changes = useCollection<Change>('changes', { filter: `at >= "${since}"`, sort: '-at' });
  const assets = useCollection<Asset>('assets');
  const name = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);
  const appNames = useAppNames();
  return (
    <>
      <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
        Everything that appeared, disappeared or changed between checks in the last 7 days — a new open port, a new user, a new startup program.
      </p>
      <Section title="What changed on the server (7 days)" meta={String(changes.records.length)} flush>
        {changes.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : changes.records.length === 0 ? (
          <EmptyState title="No changes" message="Nothing changed between checks this week." />
        ) : (
          changes.records.slice(0, 200).map((c) => (
            <ListRow
              key={c.id}
              primary={`${KIND_LABELS[c.kind] ?? c.kind}: ${observationTitle(c.kind, c.subject, (c.after ?? c.before) as Record<string, unknown>, appNames)}`}
              secondary={`${name[c.asset] ?? ''} · ${relTime(c.at)} · ${
                c.change === 'removed'
                  ? 'was ' + describeObservation(c.kind, c.before as Record<string, unknown>)
                  : describeObservation(c.kind, c.after as Record<string, unknown>)
              }`}
              trailing={<Pill tone={c.change === 'removed' ? 'warn' : c.change === 'added' ? 'info' : 'neutral'}>{c.change === 'added' ? 'new' : c.change === 'removed' ? 'gone' : 'changed'}</Pill>}
              onClick={() => onOpenItem(c.asset)}
            />
          ))
        )}
      </Section>
    </>
  );
}

function Actions(): React.JSX.Element {
  const since = useMemo(() => new Date(Date.now() - 7 * 86400000).toISOString(), []);
  const entries = useCollection<AuditEntry>('audit_log', { filter: `at >= "${since}"`, sort: '-seq' });
  return (
    <>
      <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
        What people, the agent and NetSentry itself did in the last 7 days. The full, tamper-evident record is in <a href="#/settings/audit" className="underline">Settings → More settings → Audit log</a>.
      </p>
      <Section title="Who did what (7 days)" meta={String(entries.records.length)} flush>
        {entries.loading ? (
          <div className="flex justify-center py-10">
            <Spinner />
          </div>
        ) : entries.records.length === 0 ? (
          <EmptyState title="Nothing yet" />
        ) : (
          entries.records.slice(0, 200).map((e) => (
            <ListRow
              key={e.id}
              leading={<ActorLabel label={e.actor_type === 'user' ? e.actor_label : e.actor_type} />}
              primary={e.summary}
              trailing={<span className="whitespace-nowrap text-[12px] text-[var(--agent-app-muted)]">{relTime(e.at)}</span>}
            />
          ))
        )}
      </Section>
    </>
  );
}

export function Activity({
  tab,
  onTab,
  onOpenFinding,
  onOpenItem,
}: {
  tab: ActivityTab;
  onTab: (t: ActivityTab) => void;
  onOpenFinding: (id: string) => void;
  onOpenItem: (id: string) => void;
}): React.JSX.Element {
  return (
    <>
      <PageHeader title="Activity" subtitle="What happened on the server and its network, and who did what." />
      <Tabs value={tab} onValueChange={(v) => onTab(v as ActivityTab)}>
        <TabsList className="max-w-full overflow-x-auto">
          <TabsTrigger value="inbox">To review</TabsTrigger>
          <TabsTrigger value="changes">On the server</TabsTrigger>
          <TabsTrigger value="network">Network</TabsTrigger>
          <TabsTrigger value="actions">Who did what</TabsTrigger>
        </TabsList>
        <TabsContent value="inbox">
          <Inbox onOpenFinding={onOpenFinding} />
        </TabsContent>
        <TabsContent value="network">
          <Network embedded onOpenFinding={onOpenFinding} />
        </TabsContent>
        <TabsContent value="changes">
          <Changes onOpenItem={onOpenItem} />
        </TabsContent>
        <TabsContent value="actions">
          <Actions />
        </TabsContent>
      </Tabs>
      <div className="mt-6">
        <DrillList>
          <DrillRow to="issues" icon={<AlertIcon size={18} />} label="All problems" hint="Open, being handled, accepted and fixed" />
          <DrillRow to="accepted" icon={<ThumbUpIcon size={18} />} label="Accepted risks" hint="What was decided is fine, why, and until when" />
        </DrillList>
      </div>
    </>
  );
}
