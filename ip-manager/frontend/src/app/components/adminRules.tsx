/**
 * Settings, Deadline rules: the catalog the engine uses to turn events into
 * deadlines. Everyone reads (with a plain-language summary and a test
 * bench); admins add, edit, switch off or delete rules.
 */
import { useMemo, useState } from 'react';
import { BookOpenCheck, FlaskConical, Gavel, Pencil, Plus, Scale, Search, Trash2, X } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Switch, Textarea, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, errText, op, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, today, toPb, weekdayName } from '../lib/format.ts';
import { CATEGORY_LABEL, IP_TYPE_LABEL, JURISDICTION_OPTIONS, KIND_HELP, KIND_LABEL, ROUTE_LABEL, jurisdictionName } from '../lib/labels.ts';
import type { Category, DeadlineKind, Extension, RuleRec } from '../lib/types.ts';
import { DataTable } from './DataTable.tsx';
import type { Col } from './DataTable.tsx';
import { EmptyHint, ErrorBox, Fact, FactGrid, Field, JurChip, Loading, Notice, Prose, Ref, Section, Segmented, Tag } from './ui.tsx';
import { DateField, ReadOnlyNote, num } from './adminShared.tsx';

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

const RULE_IP_TYPES = ['patent', 'utility_model', 'design', 'trademark', 'copyright', 'domain', 'work', 'agreement', 'any'] as const;

const RULE_IP_LABEL: Record<string, string> = {
  ...IP_TYPE_LABEL,
  work: 'Work (copyright)',
  agreement: 'Agreement',
  any: 'Any IP type',
};

const RULE_IP_NOUN: Record<string, string> = {
  patent: 'a patent',
  utility_model: 'a utility model',
  design: 'a design',
  trademark: 'a trademark',
  copyright: 'a copyright',
  domain: 'a domain name',
  work: 'a work',
  agreement: 'an agreement',
  any: 'any right',
};

const BASES = ['event_date', 'filing_date', 'priority_date', 'publication_date', 'registration_date', 'expiry_date', 'signed_date', 'term_end'] as const;

const BASE_LABEL: Record<string, string> = {
  event_date: 'Event date',
  filing_date: 'Filing date',
  priority_date: 'Earliest priority date',
  publication_date: 'Publication date',
  registration_date: 'Registration or grant date',
  expiry_date: 'Expiry date',
  signed_date: 'Agreement signature date',
  term_end: 'Agreement term end',
};

const KINDS: DeadlineKind[] = ['hard', 'extendable', 'designated', 'internal', 'reminder'];
const STATUTORY = new Set<DeadlineKind>(['hard', 'extendable', 'designated']);
const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

const OFFICE_NAME: Record<string, string> = { US: 'USPTO', EP: 'EPO', EM: 'EUIPO', JP: 'JPO', WO: 'WIPO', GB: 'UK IPO', CN: 'CNIPA', KR: 'KIPO', DE: 'DPMA', FR: 'INPI', CA: 'CIPO', AU: 'IP Australia' };

function officeName(code: string): string {
  const c = code.toUpperCase();
  return OFFICE_NAME[c] ?? `${c} office`;
}

function offsetText(y: number, m: number, d: number): string {
  const parts: string[] = [];
  if (y) parts.push(`${y} ${Math.abs(y) === 1 ? 'year' : 'years'}`);
  if (m) parts.push(`${m} ${Math.abs(m) === 1 ? 'month' : 'months'}`);
  if (d) parts.push(`${d} ${Math.abs(d) === 1 ? 'day' : 'days'}`);
  return parts.length ? parts.join(', ') : 'no offset';
}

function ruleOffset(r: RuleRec): string {
  return offsetText(r.offset_years, r.offset_months, r.offset_days) + (r.due_end_of_month ? ' then month end' : '');
}

function recurringText(r: RuleRec): string {
  if (r.recurring_years <= 0) return '';
  const first = r.recurring_first_cycle || 1;
  let t = r.recurring_years === 1 ? `every year from year ${first}` : `every ${r.recurring_years} years${first > 1 ? ` from cycle ${first}` : ''}`;
  if (r.recurring_until_years > 0) t += `, up to ${r.recurring_until_years} years`;
  return t;
}

/* ------------------------------------------------------------------ */
/* Conditions                                                          */
/* ------------------------------------------------------------------ */

const CONDITION_HELP: { key: string; text: string }[] = [
  { key: 'first_filing', text: 'true: only first filings (no priority claim, not a continuation or national phase)' },
  { key: 'not_routes', text: 'list of routes to skip, for example ["madrid", "designation"]' },
  { key: 'tm_register', text: '"principal" or "supplemental" (US trademark register)' },
  { key: 'option', text: 'name of a matter option that must be on, for example "jp_split_fee"' },
  { key: 'stop_on_event', text: 'event code that ends the series, for example "EP_GRANT_MENTION"' },
  { key: 'stop_at_expiry', text: 'true: stop repeating at the expiry date' },
  { key: 'no_copyright_registration', text: 'true: only while the work has no copyright registration' },
  { key: 'cycle', text: 'number used to look up the fee cycle, for example 2 for the 7.5-year US fee' },
];

function validateConditions(text: string, eventCodes: string[]): { value: Record<string, unknown>; error: string } {
  const t = text.trim();
  if (t === '') return { value: {}, error: '' };
  let parsed: unknown;
  try {
    parsed = JSON.parse(t);
  } catch {
    return { value: {}, error: 'This is not valid JSON. Use {"key": value} with double quotes.' };
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return { value: {}, error: 'Conditions must be an object, for example {"first_filing": true}.' };
  const obj = parsed as Record<string, unknown>;
  const problems: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    switch (k) {
      case 'first_filing':
      case 'stop_at_expiry':
      case 'no_copyright_registration':
        if (typeof v !== 'boolean') problems.push(`${k} must be true or false`);
        break;
      case 'not_routes':
        if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && ROUTE_LABEL[x] !== undefined)) problems.push(`not_routes must be a list of routes (${Object.keys(ROUTE_LABEL).join(', ')})`);
        break;
      case 'tm_register':
        if (v !== 'principal' && v !== 'supplemental') problems.push('tm_register must be "principal" or "supplemental"');
        break;
      case 'option':
        if (typeof v !== 'string' || v.trim() === '') problems.push('option must be the name of a matter option');
        break;
      case 'stop_on_event':
        if (typeof v !== 'string' || (eventCodes.length > 0 && !eventCodes.includes(v))) problems.push('stop_on_event must be a known event code');
        break;
      case 'cycle':
        if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) problems.push('cycle must be a whole number from 1');
        break;
      default:
        problems.push(`"${k}" is not a condition IP Manager understands`);
    }
  }
  return { value: obj, error: problems.join('. ') };
}

function conditionLines(c: Record<string, unknown> | null, eventLabel: (code: string) => string): string[] {
  if (c === null) return [];
  const out: string[] = [];
  for (const [k, v] of Object.entries(c)) {
    if (k === 'first_filing' && v === true) out.push('Only first filings (no priority claim, not a continuation or national phase).');
    else if (k === 'not_routes' && Array.isArray(v)) out.push(`Not for these routes: ${v.map((x) => ROUTE_LABEL[String(x)] ?? String(x)).join(', ')}.`);
    else if (k === 'tm_register') out.push(`Only on the ${String(v)} register.`);
    else if (k === 'option') out.push(`Only when the matter option "${String(v)}" is on.`);
    else if (k === 'stop_on_event') out.push(`Stops once "${eventLabel(String(v))}" is recorded.`);
    else if (k === 'stop_at_expiry' && v === true) out.push('Stops at the expiry date.');
    else if (k === 'no_copyright_registration' && v === true) out.push('Only while the work has no copyright registration.');
    else if (k === 'cycle') out.push(`Looks up the fee for cycle ${String(v)}.`);
    else out.push(`${k}: ${JSON.stringify(v)}`);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Tab                                                                 */
/* ------------------------------------------------------------------ */

type EnabledFilter = 'all' | 'on' | 'off';

export function RulesTab(): React.JSX.Element {
  const { can, meta } = useApp();
  const rules = useCollection<RuleRec>('rules', { sort: 'code' });
  const [term, setTerm] = useState('');
  const [ipType, setIpType] = useState('');
  const [jur, setJur] = useState('');
  const [trigger, setTrigger] = useState('');
  const [enabled, setEnabled] = useState<EnabledFilter>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [editing, setEditing] = useState<RuleRec | 'new' | null>(null);

  const eventLabel = (code: string): string => meta?.event_codes[code]?.label ?? code;

  const jurisdictions = useMemo(() => [...new Set(rules.records.map((r) => r.jurisdiction))].sort(), [rules.records]);
  const triggers = useMemo(() => [...new Set(rules.records.map((r) => r.trigger_event))].sort(), [rules.records]);

  const rows = useMemo(() => {
    const t = term.trim().toLowerCase();
    return rules.records.filter((r) => {
      if (ipType !== '' && r.ip_type !== ipType) return false;
      if (jur !== '' && r.jurisdiction !== jur) return false;
      if (trigger !== '' && r.trigger_event !== trigger) return false;
      if (enabled === 'on' && !r.enabled) return false;
      if (enabled === 'off' && r.enabled) return false;
      if (t !== '' && !`${r.code} ${r.name} ${r.title} ${r.citation}`.toLowerCase().includes(t)) return false;
      return true;
    });
  }, [rules.records, term, ipType, jur, trigger, enabled]);

  const toggle = async (r: RuleRec, v: boolean): Promise<void> => {
    try {
      await updateRecord('rules', r.id, { enabled: v });
      toast.success(`${r.code} ${v ? 'switched on' : 'switched off'}`);
    } catch {
      /* the client already showed the server's message */
    }
  };

  const columns: Col<RuleRec>[] = [
    {
      key: 'enabled',
      label: 'On',
      value: (r) => (r.enabled ? 1 : 0),
      render: (r) => (
        <span onClick={(e) => e.stopPropagation()} className="inline-flex">
          <Switch checked={r.enabled} disabled={!can.admin} onCheckedChange={(v) => void toggle(r, v)} />
        </span>
      ),
    },
    { key: 'code', label: 'Code', render: (r) => <Ref className="whitespace-nowrap text-[11.5px]">{r.code}</Ref> },
    {
      key: 'name',
      label: 'Name',
      render: (r) => (
        <div className="min-w-[11rem]">
          <span className="font-medium">{r.name}</span>
          {r.system && (
            <Tag className="ml-1.5 align-middle" title="Shipped with IP Manager">
              Shipped
            </Tag>
          )}
        </div>
      ),
    },
    { key: 'ip_type', label: 'IP type', value: (r) => RULE_IP_LABEL[r.ip_type] ?? r.ip_type },
    { key: 'jurisdiction', label: 'Jurisdiction', value: (r) => r.jurisdiction, render: (r) => (r.jurisdiction === '*' ? <span className="text-xs text-[var(--agent-app-muted)]">Any</span> : <JurChip code={r.jurisdiction} />) },
    { key: 'trigger_event', label: 'Trigger', value: (r) => eventLabel(r.trigger_event), render: (r) => <div className="min-w-[7rem]">{eventLabel(r.trigger_event)}</div> },
    {
      key: 'offset',
      label: 'Offset',
      value: (r) => ruleOffset(r),
      render: (r) => (
        <div>
          <div className="whitespace-nowrap">{ruleOffset(r)}</div>
          {r.recurring_years > 0 && <div className="max-w-[11rem] text-xs text-[var(--agent-app-muted)]">{recurringText(r)}</div>}
        </div>
      ),
    },
    { key: 'kind', label: 'Kind', value: (r) => KIND_LABEL[r.kind], render: (r) => <Tag title={KIND_HELP[r.kind]}>{KIND_LABEL[r.kind]}</Tag> },
    { key: 'recurring', label: 'Repeats', optional: true, value: (r) => recurringText(r), render: (r) => <span className="whitespace-nowrap text-xs text-[var(--agent-app-muted)]">{recurringText(r)}</span> },
    { key: 'citation', label: 'Citation', optional: true, render: (r) => <span className="text-xs">{r.citation}</span> },
    { key: 'system', label: 'Source', optional: true, value: (r) => (r.system ? 'Shipped' : 'Added'), render: (r) => (r.system ? <Tag title="Shipped with IP Manager">Shipped</Tag> : <Tag>Added</Tag>) },
  ];

  const filtered = term !== '' || ipType !== '' || jur !== '' || trigger !== '' || enabled !== 'all';
  const current = openId !== null ? (rules.records.find((r) => r.id === openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {!can.admin && <ReadOnlyNote>Only admins can change rules. Open any rule to read how it works and test it with a sample date.</ReadOnlyNote>}
      <Section
        title="Deadline rules"
        meta={rules.loading ? undefined : `${rules.records.filter((r) => r.enabled).length} on, ${rules.records.length} in total`}
        flush
        actions={
          can.admin ? (
            <Button size="sm" onClick={() => setEditing('new')}>
              <Plus size={13} aria-hidden /> New rule
            </Button>
          ) : undefined
        }
      >
        {rules.loading ? (
          <Loading />
        ) : rules.error !== null ? (
          <div className="p-4">
            <ErrorBox message={rules.error} onRetry={rules.refresh} />
          </div>
        ) : (
          <DataTable<RuleRec>
            tableId="rules"
            exportName="deadline-rules"
            rows={rows}
            columns={columns}
            dense
            onRowClick={(r) => setOpenId(r.id)}
            rowClassName={(r) => (r.enabled ? '' : 'opacity-60')}
            toolbar={
              <>
                <div className="relative w-full sm:w-56">
                  <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
                  <Input aria-label="Search rules" placeholder="Code, name, citation" className="h-8 pl-8" value={term} onChange={(e) => setTerm(e.target.value)} />
                </div>
                <div className="w-36">
                  <Select aria-label="IP type" className="h-8" value={ipType} placeholder="Any IP type" options={RULE_IP_TYPES.map((t) => ({ value: t, label: RULE_IP_LABEL[t] ?? t }))} onChange={(e) => setIpType(e.target.value)} />
                </div>
                <div className="w-36">
                  <Select aria-label="Jurisdiction" className="h-8" value={jur} placeholder="Any jurisdiction" options={jurisdictions.map((j) => ({ value: j, label: j === '*' ? 'Any (*)' : `${j} · ${jurisdictionName(j)}` }))} onChange={(e) => setJur(e.target.value)} />
                </div>
                <div className="w-44">
                  <Select aria-label="Trigger" className="h-8" value={trigger} placeholder="Any trigger" options={triggers.map((t) => ({ value: t, label: eventLabel(t) }))} onChange={(e) => setTrigger(e.target.value)} />
                </div>
                <Segmented<EnabledFilter>
                  size="sm"
                  ariaLabel="Switched on"
                  value={enabled}
                  onChange={setEnabled}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'on', label: 'On' },
                    { value: 'off', label: 'Off' },
                  ]}
                />
                {filtered && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7"
                    onClick={() => {
                      setTerm('');
                      setIpType('');
                      setJur('');
                      setTrigger('');
                      setEnabled('all');
                    }}
                  >
                    <X size={12} aria-hidden /> Clear
                  </Button>
                )}
              </>
            }
            empty={
              rules.records.length === 0 ? (
                <EmptyHint icon={Gavel} title="No rules" message="Rules turn recorded events into deadlines." action={can.admin ? <Button onClick={() => setEditing('new')}>New rule</Button> : undefined} />
              ) : (
                <EmptyHint compact icon={Search} title="No rule matches these filters" message="Clear a filter to see more rules." />
              )
            }
          />
        )}
      </Section>

      {current !== null && (
        <RuleDrawer
          rule={current}
          onClose={() => setOpenId(null)}
          onEdit={() => setEditing(current)}
          onDeleted={() => setOpenId(null)}
        />
      )}
      {editing !== null && (
        <RuleForm
          rule={editing === 'new' ? null : editing}
          feeKinds={[...new Set(rules.records.map((r) => r.fee_kind).filter((k) => k !== ''))].sort()}
          onClose={() => setEditing(null)}
          onSaved={(r) => {
            setEditing(null);
            setOpenId(r.id);
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Drawer: summary, facts, test bench                                   */
/* ------------------------------------------------------------------ */

/** Offices and countries whose English name takes "the". */
const TAKES_THE = new Set(['US', 'EP', 'EM', 'WO', 'GB', 'NL', 'PH', 'AE', 'BX', 'EA', 'GC']);

function placeName(code: string): string {
  const c = code.toUpperCase();
  return `${TAKES_THE.has(c) ? 'the ' : ''}${jurisdictionName(c)}`;
}

function joinOr(items: string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} or ${items[items.length - 1] ?? ''}`;
}

function plainTitle(t: string): string {
  return t.split('{n0}').join('N').split('{n}').join('N');
}

function summaryOf(r: RuleRec, eventLabel: (c: string) => string): string[] {
  const jurText = r.jurisdiction === '*' ? 'any jurisdiction' : placeName(r.jurisdiction);
  const routes = (r.routes ?? []).map((x) => ROUTE_LABEL[x] ?? x);
  const routeText = routes.length > 0 ? ` (${joinOr(routes)} ${routes.length === 1 ? 'route' : 'routes'})` : '';
  const office = r.roll_office !== '' ? `the ${officeName(r.roll_office)}` : r.jurisdiction === '*' ? 'the office where it is due' : `the ${officeName(r.jurisdiction)}`;
  const base = (BASE_LABEL[r.base] ?? r.base).toLowerCase();
  let first = `When “${eventLabel(r.trigger_event)}” is recorded on ${RULE_IP_NOUN[r.ip_type] ?? r.ip_type} in ${jurText}${routeText}, the deadline “${plainTitle(r.title)}” is due ${offsetText(r.offset_years, r.offset_months, r.offset_days)} after the ${base}`;
  if (r.due_end_of_month) first += ', on the last day of that month';
  if (STATUTORY.has(r.kind)) first += `, moved to the next open day of ${office} when it falls on a weekend or closure day`;
  first += '.';
  const out = [first];
  if (r.kind === 'designated') out.push('The office sets the actual period in its communication; this is the usual one, and the period in the communication wins.');
  if (r.extensions !== null && r.extensions.length > 0) out.push(`It can be extended: ${r.extensions.map((x) => x.label).join('; ')}.`);
  if (r.final_offset_months > 0) out.push(`The final date is ${r.final_offset_months} months after the ${base}.`);
  if (r.window_months > 0) out.push(`It can be done from ${r.window_months} months before the due date.`);
  if (r.grace_months > 0) out.push(`A grace period of ${r.grace_months} months follows${r.grace_note !== '' ? `: ${r.grace_note.replace(/\.$/, '')}` : ''}.`);
  const rec = recurringText(r);
  if (rec !== '') out.push(`It repeats ${rec}.`);
  if (r.creates_renewal) out.push('Each occurrence also goes into the renewal decision queue with its fee.');
  if (r.kind === 'internal' || r.kind === 'reminder') out.push(KIND_HELP[r.kind]);
  return out;
}

interface RuleTestResult {
  base_date: string;
  base_label: string;
  nominal: string;
  due: string;
  target: string;
  final: string;
  window_opens: string;
  grace_end: string;
  steps: string[];
  office: string;
}

function RuleDrawer({ rule, onClose, onEdit, onDeleted }: { rule: RuleRec; onClose: () => void; onEdit: () => void; onDeleted: () => void }): React.JSX.Element {
  const { can, meta } = useApp();
  const [confirmEl, confirm] = useConfirm();
  const eventLabel = (code: string): string => meta?.event_codes[code]?.label ?? code;
  const conds = conditionLines(rule.conditions, eventLabel);

  const remove = async (): Promise<void> => {
    if (!(await confirm(`Delete rule ${rule.code}? Deadlines it already created stay as they are. To stop using a rule but keep it, switch it off instead.`, 'Delete this rule?'))) return;
    try {
      await deleteRecord('rules', rule.id);
      toast.success(`${rule.code} deleted`);
      onDeleted();
    } catch {
      /* the client already showed the server's message */
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={rule.name}
      width={640}
      footer={
        can.admin ? (
          <>
            {!rule.system && (
              <Button variant="ghost" className="mr-auto text-red-600" onClick={() => void remove()}>
                <Trash2 size={14} aria-hidden /> Delete
              </Button>
            )}
            <Button variant="outline" onClick={onEdit}>
              <Pencil size={14} aria-hidden /> Edit
            </Button>
          </>
        ) : undefined
      }
    >
      {confirmEl}
      <div className="flex flex-col gap-6">
        <div className="flex flex-wrap items-center gap-2">
          <Ref>{rule.code}</Ref>
          <Tag title={KIND_HELP[rule.kind]}>{KIND_LABEL[rule.kind]}</Tag>
          {rule.system && <Tag title="Shipped with IP Manager">Shipped</Tag>}
          {!rule.enabled && <Tag>Switched off</Tag>}
          <span className="text-xs text-[var(--agent-app-muted)]">Version {rule.version || 1}</span>
        </div>

        <div className="flex flex-col gap-2 border-l-2 border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5 px-3 py-2.5 text-[13px] leading-relaxed">
          {summaryOf(rule, eventLabel).map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </div>

        <FactGrid cols={2}>
          <Fact label="IP type" value={RULE_IP_LABEL[rule.ip_type] ?? rule.ip_type} />
          <Fact label="Jurisdiction" value={rule.jurisdiction === '*' ? 'Any' : `${rule.jurisdiction} · ${jurisdictionName(rule.jurisdiction)}`} />
          <Fact label="Routes" value={(rule.routes ?? []).map((x) => ROUTE_LABEL[x] ?? x).join(', ') || 'All routes'} />
          <Fact label="Trigger event" value={`${eventLabel(rule.trigger_event)} (${rule.trigger_event})`} />
          <Fact label="Counted from" value={BASE_LABEL[rule.base] ?? rule.base} />
          <Fact label="Offset" value={ruleOffset(rule)} />
          <Fact label="Category" value={rule.category !== '' ? CATEGORY_LABEL[rule.category] : ''} />
          <Fact label="Deadline title" value={rule.title} />
          <Fact label="Final date" value={rule.final_offset_months > 0 ? `${rule.final_offset_months} months after the base date` : ''} />
          <Fact label="Window opens" value={rule.window_months > 0 ? `${rule.window_months} months before due` : ''} />
          <Fact label="Grace period" value={rule.grace_months > 0 ? `${rule.grace_months} months` : ''} />
          <Fact label="Repeats" value={recurringText(rule)} />
          <Fact label="Cycle label" value={rule.cycle_label} />
          <Fact label="Closure days from" value={rule.roll_office !== '' ? officeName(rule.roll_office) : 'The matter jurisdiction'} />
          <Fact label="In force" value={`${d10(rule.effective_from) !== '' && d10(rule.effective_from) > '1900-01-01' ? `from ${fmtDate(rule.effective_from)}` : 'always'}${d10(rule.effective_to) !== '' ? ` to ${fmtDate(rule.effective_to)}` : ''}`} />
          <Fact label="Renewal queue" value={rule.creates_renewal ? `Yes${rule.fee_kind !== '' ? ` (fee kind ${rule.fee_kind})` : ''}` : 'No'} />
        </FactGrid>

        {(rule.extensions ?? []).length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Extensions</h4>
            <ul className="border border-[var(--agent-app-border)]">
              {(rule.extensions ?? []).map((x, i) => (
                <li key={i} className="flex items-baseline justify-between gap-3 border-b border-[var(--agent-app-border)]/70 px-3 py-1.5 text-[13px] last:border-0">
                  <span>{x.label}</span>
                  <span className="shrink-0 tabular-nums text-[var(--agent-app-muted)]">+{x.months} months</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {conds.length > 0 && (
          <div>
            <h4 className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Conditions</h4>
            <ul className="list-disc pl-5 text-[13px] leading-relaxed">
              {conds.map((c, i) => (
                <li key={i}>{c}</li>
              ))}
            </ul>
          </div>
        )}

        {rule.citation !== '' && (
          <div className="flex items-start gap-2 text-[13px]">
            <Scale size={14} className="mt-0.5 shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
            <div>
              <div className="text-[11px] text-[var(--agent-app-muted)]">Legal basis</div>
              <div>{rule.citation}</div>
            </div>
          </div>
        )}
        {rule.notes !== '' && (
          <div>
            <div className="text-[11px] text-[var(--agent-app-muted)]">Notes</div>
            <Prose className="mt-0.5">{rule.notes}</Prose>
          </div>
        )}
        {rule.grace_note !== '' && (
          <div>
            <div className="text-[11px] text-[var(--agent-app-muted)]">Grace note</div>
            <Prose className="mt-0.5">{rule.grace_note}</Prose>
          </div>
        )}

        <RuleTestPanel rule={rule} />
      </div>
    </Drawer>
  );
}

function RuleTestPanel({ rule }: { rule: RuleRec }): React.JSX.Element {
  const { settings } = useApp();
  const [base, setBase] = useState(today());
  const [cycle, setCycle] = useState(String(rule.recurring_first_cycle || 1));
  const [period, setPeriod] = useState('');
  const [jur, setJur] = useState(rule.jurisdiction === '*' ? (settings?.jurisdictions?.[0] ?? 'US') : rule.jurisdiction);
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<RuleTestResult | null>(null);
  const recurring = rule.recurring_years > 0;

  const run = async (): Promise<void> => {
    if (d10(base) === '') {
      toast.error('Enter a sample date.');
      return;
    }
    setBusy(true);
    try {
      const body: Record<string, unknown> = { rule_id: rule.id, base_date: base, jurisdiction: jur };
      if (recurring) body['cycle'] = Math.max(rule.recurring_first_cycle || 1, Math.round(num(cycle)));
      if (rule.kind === 'designated' && num(period) > 0) body['overrides'] = { period_months: Math.round(num(period)) };
      setRes(await op<RuleTestResult>('rules/test', body));
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  const dateCell = (v: string): React.JSX.Element | string =>
    d10(v) === '' ? '' : (
      <span>
        {fmtDate(v)} <span className="text-xs text-[var(--agent-app-muted)]">{weekdayName(v)}</span>
      </span>
    );

  return (
    <div className="border border-[var(--agent-app-border)]">
      <div className="flex items-center gap-2 border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 px-3 py-2">
        <FlaskConical size={14} className="text-[var(--agent-app-muted)]" aria-hidden />
        <h4 className="text-[13px] font-semibold">Test this rule</h4>
      </div>
      <div className="flex flex-col gap-3 p-3">
        <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
          Enter a sample date to see the dates this rule would give, with every step. The same date is used for the {(BASE_LABEL[rule.base] ?? 'base date').toLowerCase()}. Nothing is saved.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Sample base date" type="date" value={base} onChange={(e) => setBase(e.target.value)} />
          {rule.jurisdiction === '*' && (
            <Select label="Office" value={jur} options={JURISDICTION_OPTIONS} onChange={(e) => setJur(e.target.value)} />
          )}
          {recurring && (
            <Field label="Cycle" help={`${rule.cycle_label !== '' ? `${rule.cycle_label.split('{n}').join('N').split('{n0}').join('N')}. ` : ''}The first cycle is ${rule.recurring_first_cycle || 1}.`}>
              <Input aria-label="Cycle" type="number" min={rule.recurring_first_cycle || 1} value={cycle} onChange={(e) => setCycle(e.target.value)} />
            </Field>
          )}
          {rule.kind === 'designated' && (
            <Field label="Period set by the office (months)" help="Optional. Leave empty to use the usual period.">
              <Input aria-label="Period in months" type="number" min={1} max={24} value={period} onChange={(e) => setPeriod(e.target.value)} />
            </Field>
          )}
        </div>
        <div>
          <Button size="sm" variant="outline" loading={busy} onClick={() => void run()}>
            <BookOpenCheck size={13} aria-hidden /> Calculate
          </Button>
        </div>
        {res !== null && (
          <div className="flex flex-col gap-3 border-t border-[var(--agent-app-border)] pt-3">
            <FactGrid cols={2}>
              <Fact label="Target" value={dateCell(res.target)} />
              <Fact label="Due" value={dateCell(res.due)} />
              <Fact label="Final" value={dateCell(res.final)} />
              <Fact label="Window opens" value={dateCell(res.window_opens)} />
              <Fact label="Grace ends" value={dateCell(res.grace_end)} />
              <Fact label="Closure days from" value={res.office !== '' ? officeName(res.office) : 'None (not a statutory date)'} />
            </FactGrid>
            <ol className="list-decimal pl-5 text-[13px] leading-relaxed">
              {res.steps.map((s, i) => (
                <li key={i}>{s}</li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Create / edit                                                        */
/* ------------------------------------------------------------------ */

interface RuleDraft {
  code: string;
  name: string;
  ip_type: string;
  jurisdiction: string;
  routes: string[];
  trigger_event: string;
  conditions: string;
  base: string;
  offset_years: number;
  offset_months: number;
  offset_days: number;
  due_end_of_month: boolean;
  kind: DeadlineKind;
  category: Category | '';
  title: string;
  extensions: Extension[];
  final_offset_months: number;
  window_months: number;
  grace_months: number;
  grace_note: string;
  recurring_years: number;
  recurring_until_years: number;
  recurring_first_cycle: number;
  cycle_label: string;
  roll_office: string;
  citation: string;
  notes: string;
  effective_from: string;
  effective_to: string;
  version: number;
  enabled: boolean;
  creates_renewal: boolean;
  fee_kind: string;
}

function ruleDraft(r: RuleRec | null): RuleDraft {
  return {
    code: r?.code ?? '',
    name: r?.name ?? '',
    ip_type: r?.ip_type ?? 'patent',
    jurisdiction: r?.jurisdiction ?? '*',
    routes: r?.routes ?? [],
    trigger_event: r?.trigger_event ?? 'FILED',
    conditions: r?.conditions !== null && r?.conditions !== undefined && Object.keys(r.conditions).length > 0 ? JSON.stringify(r.conditions, null, 2) : '',
    base: r?.base ?? 'event_date',
    offset_years: r?.offset_years ?? 0,
    offset_months: r?.offset_months ?? 0,
    offset_days: r?.offset_days ?? 0,
    due_end_of_month: r?.due_end_of_month ?? false,
    kind: r?.kind ?? 'hard',
    category: r?.category ?? 'prosecution',
    title: r?.title ?? '',
    extensions: (r?.extensions ?? []).map((x) => ({ months: Number(x.months) || 0, label: String(x.label ?? '') })),
    final_offset_months: r?.final_offset_months ?? 0,
    window_months: r?.window_months ?? 0,
    grace_months: r?.grace_months ?? 0,
    grace_note: r?.grace_note ?? '',
    recurring_years: r?.recurring_years ?? 0,
    recurring_until_years: r?.recurring_until_years ?? 0,
    recurring_first_cycle: r?.recurring_first_cycle ?? 0,
    cycle_label: r?.cycle_label ?? '',
    roll_office: r?.roll_office ?? '',
    citation: r?.citation ?? '',
    notes: r?.notes ?? '',
    effective_from: d10(r?.effective_from) === '1900-01-01' ? '' : d10(r?.effective_from),
    effective_to: d10(r?.effective_to),
    version: r?.version || 1,
    enabled: r?.enabled ?? true,
    creates_renewal: r?.creates_renewal ?? false,
    fee_kind: r?.fee_kind ?? '',
  };
}

function NumField({ label, value, onChange, help, min = 0 }: { label: string; value: number; onChange: (n: number) => void; help?: string | undefined; min?: number | undefined }): React.JSX.Element {
  return (
    <Field label={label} help={help}>
      <Input aria-label={label} type="number" min={min} value={String(value)} onChange={(e) => onChange(Math.round(num(e.target.value)))} />
    </Field>
  );
}

function FormBlock({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-3 border-t border-[var(--agent-app-border)] pt-4 first:border-0 first:pt-0">
      <h4 className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{title}</h4>
      {children}
    </div>
  );
}

function RuleForm({ rule, feeKinds, onClose, onSaved }: { rule: RuleRec | null; feeKinds: string[]; onClose: () => void; onSaved: (r: RuleRec) => void }): React.JSX.Element {
  const { meta } = useApp();
  const [d, setD] = useState<RuleDraft>(() => ruleDraft(rule));
  const [busy, setBusy] = useState(false);
  const set = <K extends keyof RuleDraft>(k: K, v: RuleDraft[K]): void => setD((x) => ({ ...x, [k]: v }));
  const codes = Object.keys(meta?.event_codes ?? {});
  const cond = validateConditions(d.conditions, codes);
  const eventOptions = codes.map((c) => ({ value: c, label: `${meta?.event_codes[c]?.label ?? c} (${c})` }));
  if (d.trigger_event !== '' && !codes.includes(d.trigger_event)) eventOptions.push({ value: d.trigger_event, label: d.trigger_event });

  const missing: string[] = [];
  if (d.code.trim() === '') missing.push('code');
  if (d.name.trim() === '') missing.push('name');
  if (d.title.trim() === '') missing.push('deadline title');
  if (d.jurisdiction.trim() === '') missing.push('jurisdiction');
  if (d.trigger_event === '') missing.push('trigger event');
  const datesBad = d.effective_from !== '' && d.effective_to !== '' && d.effective_from > d.effective_to;

  const save = async (): Promise<void> => {
    if (missing.length > 0) {
      toast.error(`Fill in the ${missing.join(', ')}.`);
      return;
    }
    if (cond.error !== '') {
      toast.error('Fix the conditions first.');
      return;
    }
    if (datesBad) {
      toast.error('The rule ends before it starts.');
      return;
    }
    setBusy(true);
    const data: Record<string, unknown> = {
      code: d.code.trim().toUpperCase(),
      name: d.name.trim(),
      ip_type: d.ip_type,
      jurisdiction: d.jurisdiction.trim() === '*' ? '*' : d.jurisdiction.trim().toUpperCase(),
      routes: d.routes,
      trigger_event: d.trigger_event,
      conditions: cond.value,
      base: d.base,
      offset_years: d.offset_years,
      offset_months: d.offset_months,
      offset_days: d.offset_days,
      due_end_of_month: d.due_end_of_month,
      kind: d.kind,
      category: d.category,
      title: d.title.trim(),
      extensions: d.extensions.filter((x) => x.months > 0 && x.label.trim() !== '').map((x) => ({ months: x.months, label: x.label.trim() })),
      final_offset_months: d.final_offset_months,
      window_months: d.window_months,
      grace_months: d.grace_months,
      grace_note: d.grace_note.trim(),
      recurring_years: d.recurring_years,
      recurring_until_years: d.recurring_until_years,
      recurring_first_cycle: d.recurring_first_cycle,
      cycle_label: d.cycle_label.trim(),
      roll_office: d.roll_office.trim().toUpperCase(),
      citation: d.citation.trim(),
      notes: d.notes.trim(),
      effective_from: d.effective_from !== '' ? toPb(d.effective_from) : toPb('1900-01-01'),
      effective_to: toPb(d.effective_to),
      version: Math.max(1, d.version),
      enabled: d.enabled,
      creates_renewal: d.creates_renewal,
      fee_kind: d.fee_kind.trim(),
    };
    if (rule === null) data['system'] = false;
    try {
      const saved = rule === null ? await createRecord<RuleRec>('rules', data) : await updateRecord<RuleRec>('rules', rule.id, data);
      toast.success(rule === null ? `Rule ${saved.code} added` : `Rule ${saved.code} saved`);
      onSaved(saved);
    } catch {
      /* the client already showed the server's message */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={rule === null ? 'New deadline rule' : `Edit ${rule.code}`}
      className="max-h-[92vh] w-[min(96vw,52rem)] overflow-y-auto"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={busy} disabled={missing.length > 0 || cond.error !== '' || datesBad} onClick={() => void save()}>
            {rule === null ? 'Add rule' : 'Save rule'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Notice tone="warn" icon={Scale}>
          Rules decide legal deadlines. Have every new or changed rule reviewed by a qualified professional before relying on it.
          {rule?.system === true ? ' This rule shipped with IP Manager; your changes apply to deadlines computed from now on.' : ''}
        </Notice>

        <FormBlock title="What it is">
          <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)]">
            <Input label="Code" className="font-mono uppercase" value={d.code} onChange={(e) => set('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, ''))} />
            <Input label="Name" value={d.name} onChange={(e) => set('name', e.target.value)} />
          </div>
          <Field label="Deadline title" help="{n} is the cycle number (Year 5); {n0} is the cycle times the repeat interval (10-year renewal).">
            <Input aria-label="Deadline title" value={d.title} onChange={(e) => set('title', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Kind" help={KIND_HELP[d.kind]}>
              <Select aria-label="Kind" value={d.kind} options={KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))} onChange={(e) => set('kind', (KINDS as string[]).includes(e.target.value) ? (e.target.value as DeadlineKind) : 'hard')} />
            </Field>
            <Select
              label="Category"
              value={d.category}
              placeholder="None"
              options={CATEGORIES.map((c) => ({ value: c, label: CATEGORY_LABEL[c] }))}
              onChange={(e) => set('category', (CATEGORIES as string[]).includes(e.target.value) ? (e.target.value as Category) : '')}
            />
          </div>
        </FormBlock>

        <FormBlock title="When it applies">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select label="IP type" value={d.ip_type} options={RULE_IP_TYPES.map((t) => ({ value: t, label: RULE_IP_LABEL[t] ?? t }))} onChange={(e) => set('ip_type', e.target.value)} />
            <Select
              label="Jurisdiction"
              value={d.jurisdiction}
              options={[{ value: '*', label: '* · Any jurisdiction' }, ...JURISDICTION_OPTIONS, ...(d.jurisdiction !== '*' && !JURISDICTION_OPTIONS.some((o) => o.value === d.jurisdiction) ? [{ value: d.jurisdiction, label: d.jurisdiction }] : [])]}
              onChange={(e) => set('jurisdiction', e.target.value)}
            />
            <Select label="Trigger event" value={d.trigger_event} options={eventOptions} onChange={(e) => set('trigger_event', e.target.value)} />
          </div>
          <Field label="Routes" help="Leave all off to apply to every route.">
            <div className="flex flex-wrap gap-1.5">
              {Object.keys(ROUTE_LABEL).map((r) => {
                const on = d.routes.includes(r);
                return (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={on}
                    onClick={() => set('routes', on ? d.routes.filter((x) => x !== r) : [...d.routes, r])}
                    className={cn(
                      'border px-2 py-1 text-xs',
                      on ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 text-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)] text-[var(--agent-app-text)]/80 hover:bg-[var(--agent-app-border)]/30',
                    )}
                  >
                    {ROUTE_LABEL[r]}
                  </button>
                );
              })}
            </div>
          </Field>
          <Field
            label="Conditions (JSON)"
            error={cond.error !== '' ? cond.error : undefined}
            help={
              <span className="flex flex-col gap-0.5">
                {CONDITION_HELP.map((c) => (
                  <span key={c.key}>
                    <code className="font-mono text-[11px] text-[var(--agent-app-text)]/80">{c.key}</code>: {c.text}
                  </span>
                ))}
              </span>
            }
          >
            <Textarea aria-label="Conditions" rows={3} className="font-mono text-[12px]" placeholder='{"first_filing": true}' value={d.conditions} onChange={(e) => set('conditions', e.target.value)} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <DateField label="In force from" value={d.effective_from} onChange={(v) => set('effective_from', v)} help="Events before this date do not use this rule. Empty means always." />
            <DateField label="In force until" value={d.effective_to} onChange={(v) => set('effective_to', v)} help="Empty means no end." />
          </div>
        </FormBlock>

        <FormBlock title="How the date is computed">
          <Select label="Counted from" value={d.base} options={BASES.map((b) => ({ value: b, label: BASE_LABEL[b] ?? b }))} onChange={(e) => set('base', e.target.value)} />
          <div className="grid grid-cols-3 gap-3">
            <NumField label="Years" value={d.offset_years} onChange={(n) => set('offset_years', n)} min={-100} />
            <NumField label="Months" value={d.offset_months} onChange={(n) => set('offset_months', n)} min={-1200} />
            <NumField label="Days" value={d.offset_days} onChange={(n) => set('offset_days', n)} min={-3650} />
          </div>
          <Switch checked={d.due_end_of_month} onCheckedChange={(v) => set('due_end_of_month', v)} label="Due on the last day of that month" />
          <Field label="Closure days from" help="Office whose weekends and closure days move a statutory date to the next open day. Leave empty to use the matter's jurisdiction.">
            <Input aria-label="Closure days from" className="max-w-[8rem] font-mono uppercase" maxLength={3} placeholder="US" value={d.roll_office} onChange={(e) => set('roll_office', e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
          </Field>
        </FormBlock>

        <FormBlock title="Extensions, window and grace">
          <div className="flex flex-col gap-2">
            {d.extensions.map((x, i) => (
              <div key={i} className="grid grid-cols-[6rem_minmax(0,1fr)_auto] items-end gap-2">
                <Input label={i === 0 ? 'Months' : undefined} aria-label="Extension months" type="number" min={1} value={String(x.months)} onChange={(e) => set('extensions', d.extensions.map((y, j) => (j === i ? { ...y, months: Math.round(num(e.target.value)) } : y)))} />
                <Input label={i === 0 ? 'Label' : undefined} aria-label="Extension label" placeholder="One-month extension (fee)" value={x.label} onChange={(e) => set('extensions', d.extensions.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />
                <Button variant="ghost" size="icon" aria-label="Remove extension" onClick={() => set('extensions', d.extensions.filter((_, j) => j !== i))}>
                  <X size={14} aria-hidden />
                </Button>
              </div>
            ))}
            <div>
              <Button size="sm" variant="outline" onClick={() => set('extensions', [...d.extensions, { months: d.extensions.length + 1, label: '' }])}>
                <Plus size={13} aria-hidden /> Add extension
              </Button>
            </div>
            <p className="text-xs text-[var(--agent-app-muted)]">Months are counted from the due date. The last extension sets the final date unless a final offset is given.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label="Final date (months after base)" value={d.final_offset_months} onChange={(n) => set('final_offset_months', n)} help="0 means none." />
            <NumField label="Window opens (months before due)" value={d.window_months} onChange={(n) => set('window_months', n)} help="0 means any time." />
            <NumField label="Grace period (months after due)" value={d.grace_months} onChange={(n) => set('grace_months', n)} />
          </div>
          <Input label="Grace note" placeholder="Payable with a surcharge in the grace period." value={d.grace_note} onChange={(e) => set('grace_note', e.target.value)} />
        </FormBlock>

        <FormBlock title="Repeating deadlines">
          <div className="grid gap-3 sm:grid-cols-3">
            <NumField label="Repeat every (years)" value={d.recurring_years} onChange={(n) => set('recurring_years', n)} help="0 means it does not repeat." />
            <NumField label="Up to (years after base)" value={d.recurring_until_years} onChange={(n) => set('recurring_until_years', n)} help="0 means no limit." />
            <NumField label="First cycle" value={d.recurring_first_cycle} onChange={(n) => set('recurring_first_cycle', n)} help="For example 3 when annuities start in year 3." />
          </div>
          <Input label="Cycle label" placeholder="Year {n}" value={d.cycle_label} onChange={(e) => set('cycle_label', e.target.value)} />
          <Switch checked={d.creates_renewal} onCheckedChange={(v) => set('creates_renewal', v)} label="Add each occurrence to the renewal decision queue" />
          {d.creates_renewal && (
            <Field label="Fee kind" help="Matches fees in Fees and currency (for example renewal, annuity, maintenance, sec8).">
              <Input aria-label="Fee kind" list="ipm-fee-kinds" className="max-w-xs font-mono" value={d.fee_kind} onChange={(e) => set('fee_kind', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))} />
              <datalist id="ipm-fee-kinds">
                {feeKinds.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </Field>
          )}
        </FormBlock>

        <FormBlock title="Basis and status">
          <Input label="Legal citation" placeholder="35 U.S.C. 133; 37 CFR 1.134" value={d.citation} onChange={(e) => set('citation', e.target.value)} />
          <Textarea label="Notes" rows={3} value={d.notes} onChange={(e) => set('notes', e.target.value)} />
          <div className="grid items-end gap-3 sm:grid-cols-2">
            <NumField label="Version" value={d.version} onChange={(n) => set('version', n)} min={1} help="Code and version together must be unique." />
            <Switch checked={d.enabled} onCheckedChange={(v) => set('enabled', v)} label={d.enabled ? 'Switched on' : 'Switched off'} />
          </div>
        </FormBlock>
      </div>
    </Dialog>
  );
}
