/**
 * Settings, Your AI agent (SPEC 9): REPORT Table 37 read-only (what it does
 * alone, prepares for a person, never does), the Table 38 promotion
 * switches (settings.autonomy), whether it sees fund data, its triggers in
 * plain words (one per task: what asks it, how often at most) with the
 * switch that lets the app ask it on its own beside each automatic one (all
 * off by default: settings.update --agent_policy), and the AI use inventory
 * (ai.inventory: every trigger and, per module, how many operations it may
 * run alone, may only propose, and may never run).
 */
import { useState } from 'react';
import { cn } from '../../../kit/index.ts';
import { AgentMark, DataTable, LoadError, Panel, Row, Skeleton, SubHeader, Tabs, Tip, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, refreshMe, useMe } from '../../lib/auth.ts';
import { humanize, num } from '../../lib/format.ts';
import { act, reshape, useOp } from '../../lib/live.ts';
import type { AgentTrigger } from '../../lib/types.ts';

/** REPORT Table 37: the fixed policy, shown read-only (the catalog's agent rules enforce it). */
const TABLE_37: { area: string; alone: string[]; prepares: string[]; never: string[] }[] = [
  { area: 'Intake', alone: ['File inbound items and uploads', 'Extract facts with grades and anchors', 'Flag missing slides', 'Surface prior history'], prepares: ['Pass drafts', 'Merges of duplicate items'], never: ['Advance, pass or hold a deal', "Judge founders' personal traits", 'Contact a founder'] },
  { area: 'Records', alone: ['Create people and companies from captured touches', 'Fill empty fields from public sources'], prepares: ['Changes to values a person entered', 'Merges', 'Stage moves', 'Owner changes'], never: ['Delete records', 'Restrict or unrestrict a deal'] },
  { area: 'Relationships', alone: ['Rank intro paths'], prepares: ['Intro asks'], never: ['Send an intro', 'Read mailboxes beyond consent'] },
  { area: 'Meetings', alone: ['Briefs', 'Summaries of transcripts'], prepares: ['Field changes and tasks from notes'], never: ['Record a meeting', "Edit a person's note"] },
  { area: 'Diligence', alone: ['Proposed answers with anchors', 'Back-channel suggestions', 'Comparison grids'], prepares: [], never: ['Mark an answer confirmed', 'Call references', "Read another deal's NDA files"] },
  { area: 'Committee', alone: ['Bear-case pre-reads on request'], prepares: ['Memo sections as tracked changes', 'Agenda items'], never: ['Write the thesis or recommendation', 'Submit a memo', 'Vote or see votes before reveal', 'Record a decision'] },
  { area: 'Portfolio', alone: ['Stage KPIs', 'Board briefs'], prepares: ['Asks', 'Securities and rounds from closing documents'], never: ['Verify a KPI', 'Acknowledge an alert', 'Change alert rules'] },
  { area: 'Marks', alone: [], prepares: ['Calibration notes and suggested marks', 'Reserve assumptions', 'Scenarios'], never: ['Approve a mark', 'Allocate reserves'] },
  { area: 'Capital', alone: ['Review notes on notices'], prepares: ['Draft calls and distributions', 'Payment matches', 'Reconciliation notes', 'LP record updates'], never: ['Issue or void a notice', 'See or change wire details', 'Change commitments', 'Send to an LP'] },
  { area: 'LP reporting', alone: [], prepares: ['The quarterly letter', 'LP question answers'], never: ['Freeze or finalise a quarter', 'Send a pack', 'Export'] },
  { area: 'Sourcing', alone: ['Run radars', 'Add sourced candidates', 'Tag licensed data'], prepares: ['Map entries', 'Thesis and radar changes'], never: ['Contact founders', 'Use paid data outside the licence'] },
  { area: 'Settings', alone: ['Read everything except sealed values'], prepares: [], never: ['Members, roles, PINs, autonomy', 'Capture consent, retention, exports'] },
];

/** settings.get (the parts this section reads). */
interface AgentSettingsRow {
  autonomy: Record<string, 'auto' | 'ask'>;
  promotable: { kind: string; label: string }[];
  agent_sees_fund_data: boolean;
  /** The switches that let the app ask your AI agent on its own (all off by default). */
  agent_policy: Record<string, boolean>;
  agent_switches: { key: string; label: string; tip: string; triggers: string[] }[];
  /** Every trigger, one per task. */
  agent_triggers: AgentTrigger[];
}

/** ai.inventory (the parts the inventory shows). */
export interface Inventory {
  triggers: AgentTrigger[];
  modules: { module: string; allow: string[]; propose: { op: string; kind: string }[]; deny: string[] }[];
}

/** A cooldown in plain words: "At most once a minute", "At most once every 20 hours". */
function cooldownText(s: number): string {
  if (s < 3600) {
    const m = Math.round(s / 60);
    return m <= 1 ? 'At most once a minute' : `At most once every ${num(m)} minutes`;
  }
  const h = Math.round(s / 3600);
  return h === 1 ? 'At most once an hour' : `At most once every ${num(h)} hours`;
}

/**
 * The triggers in plain words: what each asks your AI agent for, what fires
 * it, how often at most; an automatic one carries the switch that lets the
 * app ask on its own (two triggers may share one switch).
 */
function TriggerList({ s, canEdit }: { s: AgentSettingsRow; canEdit: boolean }): React.JSX.Element {
  const set = (key: string, on: boolean): void => {
    void act([reshape('settings.get', (d) => ({ ...(d as AgentSettingsRow), agent_policy: { ...(d as AgentSettingsRow).agent_policy, [key]: on } }))], () => op('settings.update', { agent_policy: { [key]: on } }), ['settings']);
  };
  const sw: Record<string, { label: string; tip: string }> = {};
  for (const x of s.agent_switches) sw[x.key] = x;
  return (
    <ul className="flex flex-col divide-y divide-[var(--vo-hair)] px-5">
      {s.agent_triggers.map((t) => {
        const on = t.policy !== '' && s.agent_policy[t.policy] === true;
        return (
          <li key={t.name} className="flex min-w-0 flex-col gap-1 py-3">
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-[13px] font-medium">{t.label}</span>
              <span className="text-[12px] text-[var(--vo-muted)]">{cooldownText(t.cooldown_seconds)}</span>
              <span className="flex-1" />
              {t.policy !== '' && sw[t.policy] !== undefined && (
                <Tip text={sw[t.policy]!.tip} className="flex items-center gap-2">
                  <span className={cn('text-[12px]', on ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)]')}>{sw[t.policy]!.label}</span>
                  <Toggle checked={on} disabled={!canEdit} onChange={(v) => set(t.policy, v)} label={sw[t.policy]!.label} />
                </Tip>
              )}
            </div>
            <p className="vo-wrap text-[12px] leading-[18px] text-[var(--vo-ink-2)]">Asked by: {t.fires}</p>
          </li>
        );
      })}
    </ul>
  );
}

function Items({ list, tone }: { list: string[]; tone: 'alone' | 'prepares' | 'never' }): React.JSX.Element {
  if (list.length === 0) return <span className="text-[12px] text-[var(--vo-muted)]">None</span>;
  return (
    <ul className="flex flex-col gap-1">
      {list.map((x) => (
        <li key={x} className="vo-wrap flex items-start gap-1.5 text-[12px] leading-4">
          <span aria-hidden className={cn('mt-[5px] size-1.5 shrink-0 rounded-full', tone === 'alone' ? 'bg-[var(--vo-ink)]' : tone === 'prepares' ? 'border border-[var(--vo-ink-2)]' : 'bg-[var(--vo-bad)]')} />
          <span className={tone === 'never' ? 'text-[var(--vo-ink-2)]' : 'text-[var(--vo-ink)]'}>{x}</span>
        </li>
      ))}
    </ul>
  );
}

function Rules(): React.JSX.Element {
  return (
    <div className="vo-scroll overflow-x-auto">
      <table className="w-full min-w-[680px] border-collapse">
        <thead>
          <tr className="h-8 border-b border-[var(--vo-line)] text-left text-[12px] text-[var(--vo-muted)]">
            <th className="w-[130px] px-4 font-medium">Area</th>
            <th className="px-3 font-medium">Alone</th>
            <th className="px-3 font-medium">Prepares</th>
            <th className="px-3 font-medium">Never</th>
          </tr>
        </thead>
        <tbody>
          {TABLE_37.map((r) => (
            <tr key={r.area} className="border-b border-[var(--vo-hair)] align-top last:border-b-0">
              <td className="px-4 py-2.5 text-[13px] font-medium">{r.area}</td>
              <td className="px-3 py-2.5">
                <Items list={r.alone} tone="alone" />
              </td>
              <td className="px-3 py-2.5">
                <Items list={r.prepares} tone="prepares" />
              </td>
              <td className="px-3 py-2.5">
                <Items list={r.never} tone="never" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Switches({ s, canEdit }: { s: AgentSettingsRow; canEdit: boolean }): React.JSX.Element {
  const setAuto = (kind: string, auto: boolean): void => {
    const next = auto ? 'auto' : 'ask';
    void act([reshape('settings.get', (d) => ({ ...(d as AgentSettingsRow), autonomy: { ...(d as AgentSettingsRow).autonomy, [kind]: next } }))], () => op('settings.autonomy', { autonomy: { [kind]: next } }), ['settings']);
  };
  const setFundData = (on: boolean): void => {
    void act([reshape('settings.get', (d) => ({ ...(d as AgentSettingsRow), agent_sees_fund_data: on }))], () => op('settings.update', { agent_sees_fund_data: on }), ['settings']).then((r) => {
      if (r !== null) void refreshMe();
    });
  };
  return (
    <div className="flex flex-col divide-y divide-[var(--vo-hair)] px-5">
      {s.promotable.map((p) => {
        const auto = s.autonomy[p.kind] === 'auto';
        return (
          <Row key={p.kind} label={p.label}>
            <span className={cn('text-[12px]', auto ? 'text-[var(--vo-ink)]' : 'text-[var(--vo-muted)]')}>{auto ? 'Automatic' : 'Propose'}</span>
            <Toggle checked={auto} disabled={!canEdit} onChange={(v) => setAuto(p.kind, v)} label={p.label} />
          </Row>
        );
      })}
      <Row label="Fund data" tip="Commitments and capital accounts, to draft notices and letters.">
        <Toggle checked={s.agent_sees_fund_data} disabled={!canEdit} onChange={setFundData} label="Fund data visible to your AI agent" />
      </Row>
    </div>
  );
}

function InventoryView({ inv }: { inv: Inventory }): React.JSX.Element {
  return (
    <div className="flex flex-col">
      <div className="grid gap-x-8 gap-y-2 border-b border-[var(--vo-hair)] px-5 py-4 sm:grid-cols-2 lg:grid-cols-3">
        {inv.modules.map((m) => (
          <div key={m.module} className="flex items-center gap-3 text-[13px]">
            <span className="min-w-0 flex-1 truncate">{humanize(m.module)}</span>
            <Tip text={m.allow.length > 0 ? `Alone: ${m.allow.join(', ')}` : 'Alone: none'} className="vo-mono text-[12px] text-[var(--vo-ink)]">
              {num(m.allow.length)}
            </Tip>
            <Tip text={m.propose.length > 0 ? `Proposes: ${m.propose.map((x) => x.op).join(', ')}` : 'Proposes: none'} className="vo-mono text-[12px] text-[var(--vo-ink-2)]">
              {num(m.propose.length)}
            </Tip>
            <Tip text={m.deny.length > 0 ? `Never: ${m.deny.join(', ')}` : 'Never: none'} className="vo-mono text-[12px] text-[var(--vo-bad)]">
              {num(m.deny.length)}
            </Tip>
          </div>
        ))}
      </div>
      <DataTable
        label="AI use inventory"
        rows={inv.triggers}
        rowKey={(t) => t.name}
        stickyTop={0}
        columns={[
          { key: 'summary', label: 'Task', width: 'minmax(220px,3fr)', phone: 'title', render: (t) => <span className="vo-wrap">{t.summary ?? t.description}</span> },
          { key: 'module', label: 'Module', width: '120px', render: (t) => humanize(t.module) },
          { key: 'name', label: 'Trigger', width: '160px', mono: true, phone: 'end', render: (t) => t.name },
        ]}
      />
    </div>
  );
}

export function AgentSettings(): React.JSX.Element {
  const me = useMe();
  const [tab, setTab] = useState<'rules' | 'switches' | 'triggers' | 'jobs'>('switches');
  const settings = useOp<AgentSettingsRow>('settings.get', {}, ['settings'], { name: 'settings.get', skip: tab !== 'switches' && tab !== 'triggers' });
  const inv = useOp<Inventory>('ai.inventory', {}, ['settings'], { name: 'settings.ai', skip: tab !== 'jobs' });
  const canEdit = allowed(me, 'settings:full');
  const live = tab === 'jobs' ? inv : settings;
  return (
    <>
      <SubHeader
        title={
          <span className="flex items-center gap-2">
            <AgentMark size={22} />
            Your AI agent
          </span>
        }
      />
      <Tabs label="Your AI agent" value={tab} onChange={setTab} tabs={[{ value: 'switches', label: 'Switches' }, { value: 'triggers', label: 'What asks it' }, { value: 'rules', label: 'Rules' }, { value: 'jobs', label: 'Inventory' }]} />
      <Panel flush label={tab === 'triggers' ? 'What asks your AI agent' : undefined} tip={tab === 'triggers' ? 'One request per task, naming its record. Everything without a switch asks only when someone clicks; the switches are off until you turn them on.' : undefined}>
        {tab === 'rules' ? (
          <Rules />
        ) : live.data === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <div className="p-5">
              <Skeleton className="h-32 w-full" />
            </div>
          )
        ) : tab === 'switches' && settings.data !== null ? (
          <Switches s={settings.data} canEdit={canEdit} />
        ) : tab === 'triggers' && settings.data !== null ? (
          <TriggerList s={settings.data} canEdit={canEdit} />
        ) : inv.data !== null ? (
          <InventoryView inv={inv.data} />
        ) : null}
      </Panel>
    </>
  );
}
