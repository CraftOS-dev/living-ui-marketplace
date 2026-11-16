/**
 * Settings, Portfolio: the KPI definitions (on or off, add one), the alert
 * thresholds, the founder request email and the Gmail label updates are
 * filed from.
 */
import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { Button, Field, Input, LoadError, More, Panel, Row, Segmented, Skeleton, SubHeader, Tag, Textarea, Toggle } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { act, patch, useOp } from '../../lib/live.ts';
import type { KpiDef, RequestsList } from './types.ts';

interface Rules {
  runway_months: number;
  cash_months: number;
  burn_up_pct: number;
  missed_update_days: number;
}

function Metrics({ edit }: { edit: boolean }): React.JSX.Element {
  const live = useOp<{ defs: KpiDef[] }>('kpi-defs.list', {}, ['kpi_defs'], { name: 'kpi-defs.list' });
  const [label, setLabel] = useState('');
  const [kind, setKind] = useState<'flow' | 'stock' | 'ratio'>('stock');
  const [unit, setUnit] = useState<'money' | 'count' | 'percent'>('count');
  if (live.data === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const add = (): void => {
    const l = label.trim();
    if (l === '') return;
    const key = l
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 30);
    setLabel('');
    void act([], () => op('kpi-defs.save', { key: /^[a-z]/.test(key) ? key : 'k_' + key, label: l, kind, unit }), ['kpi_defs']);
  };
  return (
    <>
      <SubHeader title="Metrics" />
      <Panel flush>
        <ul aria-label="Metrics">
          {live.data.defs.map((d) => (
            <li key={d.id} className="flex min-h-9 items-center gap-3 border-b border-[var(--vo-hair)] px-4 last:border-b-0">
              <span className="min-w-0 flex-1 truncate">{d.label}</span>
              <Tag tone="faint">{d.kind === 'computed' ? 'Computed' : d.unit === 'money' ? 'Money' : d.unit === 'percent' ? 'Percent' : 'Count'}</Tag>
              <Toggle checked={d.active} disabled={!edit || d.kind === 'computed'} label={'Use ' + d.label} onChange={(v) => void act([patch(d.id, { active: v })], () => op('kpi-defs.save', { key: d.key, active: v }), ['kpi_defs'])} />
            </li>
          ))}
        </ul>
      </Panel>
      {edit && (
        <More label="Add metric">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Name">
              <Input value={label} onChange={(e) => setLabel(e.target.value)} aria-label="Metric name" placeholder="Pipeline value" className="w-56" />
            </Field>
            <Field label="Kind" tip="Flow: summed over a period (revenue). Stock: a balance at a day (cash). Ratio: a percent (margin).">
              <Segmented
                size="sm"
                label="Kind"
                value={kind}
                onChange={setKind}
                options={[
                  { value: 'flow', label: 'Flow' },
                  { value: 'stock', label: 'Stock' },
                  { value: 'ratio', label: 'Ratio' },
                ]}
              />
            </Field>
            <Field label="Unit">
              <Segmented
                size="sm"
                label="Unit"
                value={unit}
                onChange={setUnit}
                options={[
                  { value: 'money', label: 'Money' },
                  { value: 'count', label: 'Count' },
                  { value: 'percent', label: 'Percent' },
                ]}
              />
            </Field>
            <Button icon={Plus} disabled={label.trim() === ''} onClick={add}>
              Add
            </Button>
          </div>
        </More>
      )}
    </>
  );
}

function AlertRules({ edit }: { edit: boolean }): React.JSX.Element {
  const live = useOp<{ rules: Rules }>('alerts.list', { status: 'open' }, ['settings'], { name: 'alerts.rules' });
  const [draft, setDraft] = useState<Rules | null>(null);
  useEffect(() => {
    if (live.data !== null && draft === null) setDraft(live.data.rules);
  }, [live.data, draft]);
  if (live.data === null || draft === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-32 w-full" />;
  const r = live.data.rules;
  const dirty = JSON.stringify(r) !== JSON.stringify(draft);
  const field = (k: keyof Rules, label: string, tip: string): React.JSX.Element => (
    <Field label={label} tip={tip}>
      <Input type="number" className="vo-mono w-24" value={String(draft[k])} disabled={!edit} onChange={(e) => setDraft({ ...draft, [k]: Number(e.target.value) })} aria-label={label} />
    </Field>
  );
  return (
    <>
      <SubHeader title="Alerts">
        {edit && (
          <Button variant="primary" disabled={!dirty} onClick={() => void act([], () => op('alerts.rules-save', { ...draft }), ['settings', 'alerts'])}>
            Save
          </Button>
        )}
      </SubHeader>
      <Panel>
        <div className="grid max-w-[620px] gap-4 sm:grid-cols-2">
          {field('runway_months', 'Runway months', 'Alert when verified runway falls under this many months.')}
          {field('cash_months', 'Cash months', 'Urgent when cash covers fewer months of burn than this.')}
          {field('burn_up_pct', 'Burn up %', 'Alert when net burn grows this much quarter on quarter.')}
          {field('missed_update_days', 'Missed update days', 'Alert when no update came this many days after the period a request asked for.')}
        </div>
      </Panel>
    </>
  );
}

function RequestTemplate({ edit }: { edit: boolean }): React.JSX.Element {
  const live = useOp<RequestsList>('requests.list', {}, ['settings', 'requests'], { name: 'requests.list' });
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    if (live.data === null) return;
    if (subject === null) setSubject(live.data.template.subject);
    if (body === null) setBody(live.data.template.body);
    if (label === null) setLabel(live.data.updates_label);
  }, [live.data, subject, body, label]);
  if (live.data === null || subject === null || body === null || label === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-40 w-full" />;
  const t = live.data;
  const dirty = subject !== t.template.subject || body !== t.template.body || label !== t.updates_label;
  const save = (): void => {
    const p: Record<string, unknown> = {};
    if (subject !== t.template.subject) p['subject'] = subject;
    if (body !== t.template.body) p['body'] = body;
    if (label !== t.updates_label) p['updates_label'] = label;
    void act([], () => op('requests.template-save', p), ['settings', 'requests']);
  };
  return (
    <>
      <SubHeader title="Requests">
        {edit && (
          <Button disabled={!dirty} onClick={save}>
            Save
          </Button>
        )}
      </SubHeader>
      <Panel>
        <div className="grid max-w-[620px] gap-4">
          <Field label="Subject" tip="{company} and {period} are filled in for each company.">
            <Input value={subject} disabled={!edit} onChange={(e) => setSubject(e.target.value)} aria-label="Request subject" />
          </Field>
          <Field label="Email" tip="{first_name}, {company}, {period}, {metrics}, {firm} and {sender} are filled in.">
            <Textarea value={body} minRows={6} disabled={!edit} onChange={(e) => setBody(e.target.value)} aria-label="Request email" />
          </Field>
          <Field label="Gmail label" tip="Founder updates carrying this label are filed to their company.">
            <Input value={label} disabled={!edit} onChange={(e) => setLabel(e.target.value)} aria-label="Gmail label" />
          </Field>
          <Row label="Company mail" tip="File every email from a portfolio company (its domains, its founders) as an update. Off: only the label and replies to requests.">
            <Toggle checked={t.company_mail} disabled={!edit} label="File company mail" onChange={(v) => void act([], () => op('requests.template-save', { company_mail: v }), ['settings', 'requests'])} />
          </Row>
        </div>
      </Panel>
    </>
  );
}

export function PortfolioSettings(): React.JSX.Element {
  const me = useMe();
  const edit = allowed(me, 'portfolio:edit');
  return (
    <div className="flex flex-col gap-6">
      <AlertRules edit={edit} />
      <Metrics edit={edit} />
      <RequestTemplate edit={edit} />
    </div>
  );
}
