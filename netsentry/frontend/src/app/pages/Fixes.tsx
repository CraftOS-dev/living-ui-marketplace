/**
 * Fixes — the remediation pipeline. A fix is planned (by the agent or a
 * person), approved by an admin against the exact plan, executed, and only
 * counted as done when NetSentry's re-check passes.
 */
import { useMemo, useState } from 'react';
import { Button, Dialog, EmptyState, ListRow, PageHeader, Pill, Section, Select, Spinner, Textarea, toast, useAgentRequest } from '../../kit/index.ts';
import { useCollection, useRecord } from '../store/collections.ts';
import type { Tone } from '../../kit/index.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { capitalize, fmtDateTime, relTime } from '../lib/format.ts';
import type { Asset, Finding, Remediation, Settings } from '../lib/types.ts';
import { FIX_STATUS, RISK_WORDS } from '../lib/words.ts';
import { fixTitle, issueTitle, useDetailed, DetailScope } from '../lib/view.tsx';
import { go, to } from '../lib/nav.ts';
import { Breadcrumbs, DrillList, DrillRow, type Crumb } from '../components/Breadcrumbs.tsx';
import { AlertIcon, CodeIcon } from '../components/icons.tsx';

export const FIX_STATUS_TONE: Record<string, Tone> = {
  plan_requested: 'warn', planned: 'info', approved: 'accent', executing: 'warn', verifying: 'info',
  done: 'good', failed: 'bad', rolled_back: 'bad', rejected: 'neutral', expired: 'neutral', cancelled: 'neutral',
};
export function fixLabel(s: string): string {
  return FIX_STATUS[s] ?? capitalize(s.replace('_', ' '));
}

/** Where a fix is, as five steps, and who acts next. */
const STEPS: Array<{ label: string; who: string }> = [
  { label: 'Plan', who: 'agent' },
  { label: 'Approval', who: 'admin' },
  { label: 'Applying', who: 'agent' },
  { label: 'Checking', who: 'NetSentry' },
  { label: 'Fixed', who: '' },
];
const AT_STEP: Record<string, number> = { plan_requested: 0, planned: 1, approved: 2, executing: 2, verifying: 3, done: 4 };

export function FixStepper({ status, guided }: { status: string; guided: boolean }): React.JSX.Element {
  const at = AT_STEP[status];
  const stopped = at === undefined;
  const steps = guided ? [STEPS[0]!, { label: 'You do it', who: 'you' }, STEPS[3]!, STEPS[4]!] : STEPS;
  const pos = at === undefined ? -1 : guided ? (at <= 0 ? 0 : at <= 2 ? 1 : at === 3 ? 2 : 3) : at;
  return (
    <ol className="flex flex-wrap items-center gap-1 text-[12px]" aria-label="Fix progress">
      {steps.map((st, i) => {
        const done = !stopped && (i < pos || status === 'done');
        const current = !stopped && i === pos && status !== 'done';
        return (
          <li key={st.label} className="flex items-center gap-1">
            <span
              className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${
                current ? 'border-[var(--agent-app-accent)] font-semibold' : done ? 'border-emerald-500/50' : 'border-[var(--agent-app-border)] text-[var(--agent-app-muted)]'
              }`}
              aria-current={current ? 'step' : undefined}
            >
              {done ? '✓' : i + 1} {st.label}
              {current && st.who ? <span className="font-normal text-[var(--agent-app-muted)]"> · {st.who}</span> : null}
            </span>
            {i < steps.length - 1 && <span className="text-[var(--agent-app-muted)]">→</span>}
          </li>
        );
      })}
      {stopped && <li className="ml-1"><Pill tone={FIX_STATUS_TONE[status] ?? 'neutral'}>{fixLabel(status)}</Pill></li>}
    </ol>
  );
}

// The agent is only expected to act while a plan is requested or an approved fix waits to be run.
function AgentLine({ id, status }: { id: string; status: string }): React.JSX.Element | null {
  const { request } = useAgentRequest(id && (status === 'plan_requested' || status === 'approved') ? id : null);
  if (!request) return null;
  const t = request.status === 'pending' ? 'Waiting for an agent to pick this up.' : request.status === 'claimed' ? 'The agent is working on it…' : request.status === 'done' ? `Agent finished${request.result ? ': ' + request.result : '.'}` : `Agent could not do it${request.error ? ': ' + request.error : '.'}`;
  return <p className="text-[12px] text-[var(--agent-app-muted)]" role="status">{t}</p>;
}

/**
 * A fix's page (#/fix/<id>): where it is, what the plan does, and the buttons
 * for whoever acts next. #/fix/<id>/technical adds the exact commands,
 * rollbacks and the plan fingerprint the approval is bound to.
 */
/** NetSentry's own fixes are applied (and undone) by the monitor on the machine. */
function MonitorLine({ rem }: { rem: Remediation }): React.JSX.Element | null {
  const typed = (rem.plan?.steps ?? []).length > 0 && (rem.plan?.steps ?? []).every((s) => !!(s as { action?: string }).action);
  if (!typed) return null;
  const log = rem.steps_log ?? [];
  const undone = log.some((e) => e.step === -2);
  const text =
    rem.status === 'planned'
      ? 'NetSentry will make exactly these changes itself once you approve them — the monitor on this server applies them.'
      : rem.status === 'approved'
        ? 'Approved — the monitor on this server applies it at its next check-in (within about 30 seconds).'
        : rem.status === 'executing'
          ? 'The monitor is applying it now…'
          : rem.status === 'verifying'
            ? 'Applied — NetSentry is checking it worked and that the app still answers.'
            : rem.status === 'failed' && !undone
              ? 'It did not work — the monitor is putting everything back as it was.'
              : rem.status === 'rolled_back' || undone
                ? 'Everything was put back as it was.'
                : rem.status === 'done'
                  ? 'Done and checked: the problem is gone.'
                  : '';
  return text ? (
    <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]" role="status">
      {text}
    </p>
  ) : null;
}

export function FixPage({ id, technical }: { id: string; technical: boolean }): React.JSX.Element {
  const { can } = useMe();
  const { record: r } = useRecord<Remediation>('remediations', id);
  const { record: issue } = useRecord<Finding>('findings', r?.finding ? r.finding : null);
  const { record: asset } = useRecord<Asset>('assets', r?.asset ? r.asset : null);
  const detailed = technical;
  const onOpenIssue = (fid: string): void => go(to.issue(fid));
  const settings = useCollection<Settings>('settings');
  const paused = settings.records[0]?.remediation_paused ?? false;
  const [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<'reject' | 'manual' | null>(null);
  const [note, setNote] = useState('');

  const act = async (key: string, op: string, params: Record<string, string>, ok: string): Promise<boolean> => {
    if (!r) return false;
    setBusy(key);
    try {
      const res = await runOp<{ message?: string }>(op, { remediation_id: r.id, ...params });
      toast.success(res.message ?? ok);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  };

  const steps = r?.plan?.steps ?? [];
  const log = r?.steps_log ?? [];
  const guided = r?.risk_class === 'guided';
  const trail: Crumb[] = [{ label: 'Home', to: 'home' }];
  if (asset) trail.push({ label: asset.label || asset.identifier, to: to.item(asset.id) });
  else trail.push({ label: 'Fixes', to: 'issues/fixes' });
  if (issue) trail.push({ label: issue.plain_title || issue.title, to: to.issue(issue.id) });
  if (technical) trail.push({ label: 'Fix', to: to.fix(id) }, { label: 'Technical details' });
  else trail.push({ label: 'Fix' });
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs trail={trail} />
      <DetailScope on={detailed}>
      {r === null ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : (
        <div className="flex flex-col gap-5 text-[13px]">
          <div>
            <div className="mb-2 flex flex-wrap gap-2">
              <Pill tone={FIX_STATUS_TONE[r.status] ?? 'neutral'}>{r.status === 'planned' && r.risk_class === 'guided' ? 'Your turn' : fixLabel(r.status)}</Pill>
              <Pill tone={RISK_WORDS[r.risk_class]?.tone ?? 'neutral'}>{RISK_WORDS[r.risk_class]?.label ?? r.risk_class}</Pill>
            </div>
            <h2 className="text-base font-semibold">{fixTitle(r, detailed)}</h2>
            <div className="mt-2">
              <FixStepper status={r.status} guided={guided} />
            </div>
            {issue !== null && (
              <p className="mt-2">
                For the issue:{' '}
                {onOpenIssue ? (
                  <button type="button" className="text-left text-[var(--agent-app-accent)] hover:underline" onClick={() => onOpenIssue(issue.id)}>
                    {issueTitle(issue, detailed)}
                  </button>
                ) : (
                  <span className="font-medium">{issueTitle(issue, detailed)}</span>
                )}
                <span className="text-[var(--agent-app-muted)]"> — {issue.status === 'resolved' ? 'fixed' : issue.status === 'suppressed' ? 'muted' : 'not fixed yet'}</span>
              </p>
            )}
            <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">{RISK_WORDS[r.risk_class]?.help}</p>
            <p className="mt-1 text-[12px] text-[var(--agent-app-muted)]">
              Requested by {r.requested_by || '—'}
              {r.planned_by ? ` · planned by ${r.planned_by === 'playbook (guided)' ? 'NetSentry (standard steps)' : r.planned_by}` : ''}
              {r.approved_by ? ` · approved by ${r.approved_by} ${relTime(r.approved_at)}` : ''}
              {r.executor ? ` · executed by ${r.executor}` : ''}
            </p>
            <AgentLine id={r.agent_request} status={r.status} />
            <MonitorLine rem={r} />
            {paused && !['done', 'cancelled', 'rejected'].includes(r.status) && (
              <p className="mt-2 font-medium text-amber-700 dark:text-amber-400">Fixes are paused by an admin (Settings → Fix policy) — nothing will be applied.</p>
            )}
            {r.failure_reason && <p className="mt-2 text-red-600 dark:text-red-400">{r.failure_reason}</p>}
          </div>

          <div className="flex flex-wrap gap-2">
            {can('admin') && r.status === 'planned' && !guided && (
              <>
                <Button size="sm" loading={busy === 'approve'} disabled={paused} onClick={() => void act('approve', 'remediations.approve', {}, 'Approved — the agent will execute exactly this plan.')}>
                  Approve this exact plan
                </Button>
                <Button size="sm" variant="secondary" onClick={() => { setNote(''); setDialog('reject'); }}>
                  Reject…
                </Button>
              </>
            )}
            {can('analyst') && ['planned', 'approved', 'failed'].includes(r.status) && (
              <Button size="sm" variant="secondary" onClick={() => { setNote(''); setDialog('manual'); }}>
                {guided ? 'I did this — verify it' : 'I fixed it myself — verify'}
              </Button>
            )}
            {can('analyst') && ['plan_requested', 'planned', 'approved', 'failed', 'rolled_back', 'rejected', 'expired'].includes(r.status) && (
              <Button size="sm" variant="ghost" loading={busy === 'cancel'} onClick={() => void act('cancel', 'remediations.cancel', { note: 'cancelled from the UI' }, 'Cancelled.')}>
                Cancel fix
              </Button>
            )}
          </div>

          {r.status === 'plan_requested' ? (
            <p className="text-[var(--agent-app-muted)]">Waiting for a concrete plan from the agent. Nothing runs until an admin approves a plan.</p>
          ) : (
            <section>
              <h3 className="mb-2 font-semibold">Plan{detailed && r.plan_hash ? <span className="ml-2 font-mono text-[11px] text-[var(--agent-app-muted)]">#{r.plan_hash.slice(0, 12)}</span> : null}</h3>
              <ol className="flex flex-col gap-3">
                {steps.map((s, i) => {
                  const done = log.filter((l) => l.step === i).slice(-1)[0];
                  return (
                    <li key={i} className="rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] p-3">
                      <div className="flex items-start justify-between gap-2">
                        <p>
                          <span className="mr-1 font-semibold">{i + 1}.</span>
                          {s.description}
                        </p>
                        {done && <Pill tone={done.outcome === 'ok' ? 'good' : done.outcome === 'failed' ? 'bad' : 'neutral'}>{done.outcome}</Pill>}
                      </div>
                      {detailed && s.command && <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded bg-[var(--agent-app-surface-2)] p-2 font-mono text-[12px]">{s.command}</pre>}
                      {s.target && <p className="mt-1 text-[12px] text-[var(--agent-app-muted)]">on {s.target}</p>}
                      {detailed && s.rollback && <p className="mt-1 text-[12px] text-[var(--agent-app-muted)]">Rollback: <span className="font-mono">{s.rollback}</span></p>}
                      {done?.output && <p className="mt-1 whitespace-pre-wrap text-[12px]">{done.output}</p>}
                    </li>
                  );
                })}
              </ol>
            </section>
          )}

          {(r.preconditions?.length ?? 0) > 0 && (
            <section>
              <h3 className="mb-1 font-semibold">{detailed ? 'Before executing' : 'Check first'}</h3>
              <ul className="list-disc pl-5">{r.preconditions!.map((p) => <li key={p}>{p}</li>)}</ul>
            </section>
          )}
          <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
            {r.blast_radius && (<><dt className="text-[var(--agent-app-muted)]">Could affect</dt><dd>{r.blast_radius}</dd></>)}
            <dt className="text-[var(--agent-app-muted)]">Downtime</dt><dd>{r.downtime || '—'}</dd>
            <dt className="text-[var(--agent-app-muted)]">Cost</dt><dd>{r.cost_note || '—'}</dd>
            {r.backup_ref && (<><dt className="text-[var(--agent-app-muted)]">Backup</dt><dd className="break-all">{r.backup_ref}</dd></>)}
          </dl>
          {r.verify_result && (
            <section>
              <h3 className="mb-1 font-semibold">Verification</h3>
              <p>
                {r.verify_result.result === 'passed'
                  ? `Passed — ${r.verify_result.rule} no longer detects the problem (${fmtDateTime(String(r.verify_result.at ?? ''))}).`
                  : r.verify_result.result === 'still detected'
                    ? `Failed — ${r.verify_result.rule} still detects the problem.`
                    : r.verify_result.note ?? 'Waiting for a fresh scan.'}
              </p>
            </section>
          )}
          {!detailed && (
            <DrillList>
              {issue && <DrillRow to={to.issue(issue.id)} icon={<AlertIcon size={18} />} label="The problem this fixes" hint={issue.plain_title || issue.title} />}
              <DrillRow to={to.fix(id, true)} icon={<CodeIcon size={18} />} label="Technical details" hint="Exact commands, how to undo each step, the plan fingerprint" />
            </DrillList>
          )}
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(o) => !o && setDialog(null)}
        title={dialog === 'reject' ? 'Reject this plan' : 'Mark as done'}
        description={dialog === 'reject' ? 'Say what is wrong so it can be re-planned.' : 'NetSentry will re-check; it only counts as done if the problem is gone.'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>Cancel</Button>
            <Button
              disabled={!note.trim()}
              loading={busy === 'dialog'}
              onClick={async () => {
                const ok = dialog === 'reject'
                  ? await act('dialog', 'remediations.reject', { note: note.trim() }, 'Rejected.')
                  : await act('dialog', 'remediations.mark-manual', { note: note.trim() }, 'Recorded — verifying.');
                if (ok) setDialog(null);
              }}
            >
              {dialog === 'reject' ? 'Reject' : 'Verify'}
            </Button>
          </>
        }
      >
        <Textarea label={dialog === 'reject' ? 'Reason' : 'What was done'} value={note} onChange={(e) => setNote(e.target.value)} rows={3} />
      </Dialog>
      </DetailScope>
    </div>
  );
}

const GROUPS: Array<[string, string[]]> = [
  ['Needs approval', ['planned']],
  ['Waiting for a plan', ['plan_requested']],
  ['In progress', ['approved', 'executing', 'verifying']],
  ['Did not work', ['failed', 'rolled_back', 'expired']],
  ['Done', ['done']],
  ['Closed', ['cancelled', 'rejected']],
];

export function Fixes({ embedded }: { embedded?: boolean }): React.JSX.Element {
  const detailed = useDetailed();
  const [view, setView] = useState('open');
  const filter = view === 'open' ? ['done', 'failed', 'rolled_back', 'expired', 'cancelled', 'rejected'].map((s) => `status != "${s}"`).join(' && ') : view === 'all' ? '' : `status = "${view}"`;
  const fixes = useCollection<Remediation>('remediations', filter ? { filter, sort: '-updated' } : { sort: '-updated' });
  const assets = useCollection<Asset>('assets');
  const names = useMemo(() => Object.fromEntries(assets.records.map((a) => [a.id, a.label || a.identifier])), [assets.records]);

  return (
    <>
      {!embedded && <PageHeader title="Fixes" meta={String(fixes.records.length)} />}
      {detailed && (
        <p className="mb-3 text-[13px] text-[var(--agent-app-muted)]">
          Fixes the agent plans and applies for you. Nothing runs until an admin approves the exact plan, and a fix only counts once NetSentry sees the problem is gone.
        </p>
      )}
      <div className="mb-4 w-full sm:w-60">
        <Select
          aria-label="Show"
          value={view}
          onChange={(e) => setView(e.target.value)}
          options={[
            { value: 'open', label: 'In progress' },
            { value: 'done', label: 'Fixed' },
            { value: 'failed', label: 'Did not work' },
            { value: 'all', label: 'Everything' },
          ]}
        />
      </div>
      {fixes.loading ? (
        <div className="flex justify-center py-10"><Spinner /></div>
      ) : fixes.records.length === 0 ? (
        <Section title="Fixes">
          <EmptyState title="No fixes here" message="Open an issue and choose “Ask the agent for a plan” to start one." />
        </Section>
      ) : (
        <div className="flex flex-col gap-4">
          {GROUPS.map(([label, statuses]) => {
            const rows = fixes.records.filter((f) => statuses.includes(f.status));
            if (rows.length === 0) return null;
            return (
              <Section key={label} title={label} meta={String(rows.length)} flush>
                {rows.map((f) => (
                  <ListRow
                    key={f.id}
                    primary={fixTitle(f, detailed)}
                    secondary={`${names[f.asset] ?? ''} · ${RISK_WORDS[f.risk_class]?.label ?? f.risk_class} · updated ${relTime(f.updated)}`}
                    trailing={<Pill tone={FIX_STATUS_TONE[f.status] ?? 'neutral'}>{f.status === 'planned' && f.risk_class === 'guided' ? 'Your turn' : fixLabel(f.status)}</Pill>}
                    onClick={() => go(to.fix(f.id))}
                  />
                ))}
              </Section>
            );
          })}
        </div>
      )}
    </>
  );
}
