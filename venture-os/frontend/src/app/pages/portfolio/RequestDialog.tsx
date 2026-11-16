/**
 * Request updates: one dialog. Pick companies (checkboxes), cadence and
 * metrics (chips); the request email a person wrote once sits behind More,
 * prefilled. Turn on, and the result shows in place: each company's dot
 * (requested now, or scheduled), and an email field where a founder's
 * address is missing.
 */
import { useEffect, useMemo, useState } from 'react';
import { Send } from 'lucide-react';
import { Button, Checkbox, ChipPicker, Dialog, Field, Input, LoadError, More, Segmented, Skeleton, StatusDot, Textarea } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { act, useOp } from '../../lib/live.ts';
import { fmtDay } from '../../lib/format.ts';
import type { KpiDef, RequestView, RequestsList } from './types.ts';

const READS = ['requests', 'outbound', 'settings', 'holdings'];

const STATE: Record<string, { tone: 'good' | 'neutral' | 'warn' | 'faint' | 'a'; label: string }> = {
  requested: { tone: 'good', label: 'Requested' },
  reminded: { tone: 'good', label: 'Reminded' },
  received: { tone: 'a', label: 'Received' },
  scheduled: { tone: 'neutral', label: 'Scheduled' },
  off: { tone: 'faint', label: 'Off' },
};

export function RequestDialog({ open, onClose, only }: { open: boolean; onClose: () => void; only?: string | undefined }): React.JSX.Element | null {
  const live = useOp<RequestsList>('requests.list', {}, READS, { name: 'requests.list', skip: !open });
  const defs = useOp<{ defs: KpiDef[] }>('kpi-defs.list', {}, ['kpi_defs'], { name: 'kpi-defs.list', skip: !open });
  const [picked, setPicked] = useState<string[] | null>(null);
  const [cadence, setCadence] = useState<'monthly' | 'quarterly'>('monthly');
  const [metrics, setMetrics] = useState<string[] | null>(null);
  const [subject, setSubject] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ requests: RequestView[]; needs: { id: string; name: string }[] } | null>(null);
  const [emails, setEmails] = useState<Record<string, string>>({});

  const data = live.data;
  useEffect(() => {
    if (!open) {
      setPicked(null);
      setMetrics(null);
      setSubject(null);
      setBody(null);
      setResult(null);
      setEmails({});
      return;
    }
    if (data === null) return;
    if (picked === null) setPicked(only !== undefined ? [only] : data.companies.filter((c) => c.request === null || !c.request.enabled).map((c) => c.company.id));
    if (metrics === null) setMetrics(data.default_metrics);
    if (subject === null) setSubject(data.template.subject);
    if (body === null) setBody(data.template.body);
  }, [open, data, picked, metrics, subject, body, only]);

  const metricOptions = useMemo(() => (defs.data?.defs ?? []).filter((d) => d.active && d.kind !== 'computed').map((d) => ({ value: d.key, label: d.label })), [defs.data]);

  if (!open) return null;

  const turnOn = async (): Promise<void> => {
    if (data === null || picked === null || picked.length === 0) return;
    setBusy(true);
    const params: Record<string, unknown> = { companies: picked, cadence, metrics: metrics ?? [] };
    if (subject !== null && subject !== data.template.subject) params['subject'] = subject;
    if (body !== null && body !== data.template.body) params['body'] = body;
    const out = await act([], () => op<{ requests: RequestView[]; needs_email: { id: string; name: string }[] }>('requests.schedule', params), READS);
    setBusy(false);
    if (out !== null) setResult({ requests: out.requests, needs: out.needs_email });
  };

  const addEmail = async (companyId: string): Promise<void> => {
    const e = (emails[companyId] ?? '').trim();
    if (e === '') return;
    setBusy(true);
    const out = await act([], () => op<{ requests: RequestView[]; needs_email: { id: string; name: string }[] }>('requests.schedule', { companies: [companyId], cadence, metrics: metrics ?? [], to: [e] }), READS);
    setBusy(false);
    if (out !== null && result !== null) {
      const fresh = out.requests[0];
      setResult({ requests: result.requests.map((r) => (fresh !== undefined && r.company?.id === companyId ? fresh : r)), needs: result.needs.filter((n) => n.id !== companyId) });
    }
  };

  const footer =
    result === null ? (
      <>
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="primary" icon={Send} busy={busy} disabled={picked === null || picked.length === 0 || (metrics ?? []).length === 0} onClick={() => void turnOn()}>
          Turn on
        </Button>
      </>
    ) : (
      <Button variant="primary" onClick={onClose}>
        Done
      </Button>
    );

  return (
    <Dialog open={open} onClose={onClose} title="Request updates" footer={footer} width={560}>
      {live.error !== null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : data === null || picked === null ? (
        <Skeleton className="h-48 w-full" />
      ) : result !== null ? (
        <ul className="flex flex-col divide-y divide-[var(--vo-hair)]" aria-label="Requests">
          {result.requests.map((r) => {
            const need = result.needs.find((n) => n.id === r.company?.id);
            const st = STATE[r.state] ?? STATE['off'];
            return (
              <li key={r.id} className="flex min-h-9 flex-wrap items-center gap-3 py-1.5">
                <span className="min-w-0 flex-1 truncate font-medium">{r.company?.name}</span>
                {need !== undefined ? (
                  <span className="flex items-center gap-2">
                    <Input className="h-8 w-56" type="email" placeholder="founder@company.com" aria-label={'Founder email for ' + (r.company?.name ?? '')} value={emails[need.id] ?? ''} onChange={(e) => setEmails({ ...emails, [need.id]: e.target.value })} />
                    <Button size="sm" busy={busy} onClick={() => void addEmail(need.id)}>
                      Add
                    </Button>
                  </span>
                ) : (
                  <>
                    {r.state === 'scheduled' && r.next_day !== '' && <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{fmtDay(r.next_day)}</span>}
                    {st !== undefined && <StatusDot tone={st.tone} label={st.label} />}
                  </>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Companies">
            <ul className="vo-scroll flex max-h-[220px] flex-col overflow-y-auto rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)]">
              {data.companies.map((c) => (
                <li key={c.company.id} className="flex min-h-9 items-center gap-3 border-b border-[var(--vo-hair)] px-3 last:border-b-0">
                  <Checkbox checked={picked.includes(c.company.id)} onChange={(v) => setPicked(v ? [...picked, c.company.id] : picked.filter((x) => x !== c.company.id))} label={c.company.name} />
                  <span className="flex-1" />
                  {c.request !== null && c.request.enabled ? <StatusDot tone="good" label="On" /> : c.recipients.length === 0 ? <StatusDot tone="warn" label="No email" /> : <span className="vo-wrap truncate text-[12px] text-[var(--vo-muted)]">{c.recipients[0]}</span>}
                </li>
              ))}
            </ul>
          </Field>
          <Field label="Cadence">
            <Segmented
              label="Cadence"
              value={cadence}
              onChange={setCadence}
              options={[
                { value: 'monthly', label: 'Monthly' },
                { value: 'quarterly', label: 'Quarterly' },
              ]}
            />
          </Field>
          <Field label="Metrics">
            <ChipPicker multiple label="Metrics" options={metricOptions} value={metrics ?? []} onChange={setMetrics} />
          </Field>
          <More label="Email">
            <div className="flex flex-col gap-3">
              <Field label="Subject" tip="{company} and {period} are filled in for each company.">
                <Input value={subject ?? ''} onChange={(e) => setSubject(e.target.value)} aria-label="Subject" />
              </Field>
              <Field label="Body" tip="{first_name}, {company}, {period}, {metrics}, {firm} and {sender} are filled in.">
                <Textarea value={body ?? ''} minRows={6} onChange={(e) => setBody(e.target.value)} aria-label="Body" />
              </Field>
            </div>
          </More>
        </div>
      )}
    </Dialog>
  );
}
