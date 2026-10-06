import { useState } from 'react';
import { Button, Dialog, EmptyState, ListRow, PageHeader, Pill, Section, Select, Spinner, Textarea, toast, useAgentRequest } from '../../kit/index.ts';
import { useCollection, useRecord } from '../store/collections.ts';
import { Breadcrumbs, DrillList, DrillRow, type Crumb } from '../components/Breadcrumbs.tsx';
import { CodeIcon } from '../components/icons.tsx';
import { go, to } from '../lib/nav.ts';
import { ActorLabel, SeverityPill, StatusPill } from '../components/pills.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { fmtDateTime, INCIDENT_NEXT, INCIDENT_STATUS_LABELS, incidentStatusTone, relTime, severityRank } from '../lib/format.ts';
import type { Asset, Finding, Incident, IncidentNote, Member } from '../lib/types.ts';
import { DetailScope, caseTitle, issueTitle, useDetailed } from '../lib/view.tsx';

/**
 * Honest agent state for this incident. The request row tells us about the last
 * ring; `needs_triage` tells us whether the work is still waiting (rings are
 * batched and rate-limited, so a waiting incident may not have its own request).
 */
function AgentStatus({ requestId, waiting }: { requestId: string; waiting: boolean }): React.JSX.Element | null {
  const { request } = useAgentRequest(requestId || null);
  const live = request !== null && (request.status === 'pending' || request.status === 'claimed');
  let text: string | null = null;
  if (live && request.status === 'claimed') text = 'The agent is looking into it now…';
  else if (live) text = 'Waiting for the agent to take a look. If no agent is connected, it waits here until one is.';
  else if (waiting) text = 'Queued for the agent — it is asked every few minutes; with no agent connected it waits here.';
  else if (request !== null && request.status === 'done') text = `Agent finished${request.result ? ': ' + request.result : '.'}`;
  else if (request !== null && request.status === 'rejected') text = `The agent could not complete it${request.error ? ': ' + request.error : '.'}`;
  if (text === null) return null;
  return (
    <p className="text-[13px] text-[var(--agent-app-muted)]" role="status">
      {text}
    </p>
  );
}

/** A case (#/case/<id>): related problems together. #/case/<id>/technical is the analyst's version. */
export function IncidentDetail({ incidentId, technical }: { incidentId: string; technical: boolean }): React.JSX.Element {
  const detailed = technical;
  const onBack = (): void => go('issues/cases');
  const onOpenFinding = (id: string): void => go(to.issue(id));
  const onOpenAsset = (id: string): void => go(to.item(id));
  const { can, member } = useMe();
  const { record: inc, loading } = useRecord<Incident>('incidents', incidentId);
  const findings = useCollection<Finding>('findings', { filter: `incident = "${incidentId}"`, sort: '-last_seen' });
  const notes = useCollection<IncidentNote>('incident_notes', { filter: `incident = "${incidentId}"`, sort: '-created' });
  const members = useCollection<Member>('users', { sort: 'email' });
  const root = useRecord<Asset>('assets', inc?.root_asset ? inc.root_asset : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [statusDialog, setStatusDialog] = useState<string | null>(null);
  const [statusNote, setStatusNote] = useState('');
  const [triageOpen, setTriageOpen] = useState(false);
  const [triage, setTriage] = useState({ summary: '', confidence: 'medium' });

  if (loading) {
    return (
      <div className="flex justify-center py-20">
        <Spinner />
      </div>
    );
  }
  if (inc === null) {
    return <EmptyState title="Case not found" action={<Button variant="secondary" onClick={onBack}>Back to cases</Button>} />;
  }

  const act = async (key: string, name: string, params: Record<string, string>, ok: string): Promise<boolean> => {
    setBusy(key);
    try {
      const r = await runOp<{ message?: string }>(name, { incident_id: inc.id, ...params });
      toast.success(r.message ?? ok);
      return true;
    } catch {
      return false;
    } finally {
      setBusy(null);
    }
  };

  const next = INCIDENT_NEXT[inc.status] ?? [];
  const needsNote = statusDialog === 'closed' || statusDialog === 'false_positive';
  const sortedFindings = [...findings.records].sort((a, b) => severityRank(b.severity) - severityRank(a.severity));

  const plainName = caseTitle(inc, root.record ? root.record.label || root.record.identifier : '', false);
  const trail: Crumb[] = [
    { label: 'Home', to: 'home' },
    { label: 'Issues', to: 'issues/cases' },
    ...(detailed ? [{ label: plainName, to: to.case(inc.id) }, { label: 'Technical details' }] : [{ label: plainName }]),
  ];

  return (
    <DetailScope on={detailed}>
    <div className="mx-auto max-w-4xl">
      <Breadcrumbs trail={trail} />
      <PageHeader
        title={caseTitle(inc, root.record ? root.record.label || root.record.identifier : '', detailed)}
        subtitle={`Opened ${fmtDateTime(inc.opened_at)} · last activity ${relTime(inc.last_activity)}`}
        actions={
          can('analyst') ? (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" loading={busy === 'agent'} onClick={() => void act('agent', 'incidents.request-triage', {}, 'Agent asked.')}>
                Ask the agent to look
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setTriageOpen(true)}>
                {detailed ? 'Write an assessment…' : 'Write a summary…'}
              </Button>
            </div>
          ) : undefined
        }
      />
      <div className="mb-6 flex flex-wrap items-center gap-2">
        <SeverityPill severity={inc.severity} />
        {inc.needs_triage && (inc.status === 'new' || inc.status === 'investigating') ? (
          <Pill tone="warn">Waiting for a look</Pill>
        ) : (
          <Pill tone={incidentStatusTone(inc.status)}>{INCIDENT_STATUS_LABELS[inc.status] ?? inc.status}</Pill>
        )}
        {root.record !== null && (
          <button type="button" className="text-[13px] text-[var(--agent-app-accent)] hover:underline" onClick={() => onOpenAsset(root.record!.id)}>
            {root.record.label || root.record.identifier}
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <Section title={detailed ? 'Assessment' : 'Summary'}>
            <div className="flex flex-col gap-2 p-4">
              {inc.summary ? (
                <>
                  <p className="whitespace-pre-line text-[13px] leading-relaxed">{inc.summary}</p>
                  <p className="text-[12px] text-[var(--agent-app-muted)]">
                    Assessed by {inc.triaged_by === 'agent' ? 'the agent' : inc.triaged_by} {relTime(inc.triaged_at)} · confidence {inc.confidence || '—'}
                    {inc.needs_triage ? ' · a new look was requested' : ''}
                  </p>
                </>
              ) : (
                <p className="text-[13px] text-[var(--agent-app-muted)]">
                  Nobody has looked at this yet. Ask the agent, or write a summary yourself.
                </p>
              )}
              <AgentStatus requestId={inc.agent_request} waiting={inc.needs_triage && (inc.status === 'new' || inc.status === 'investigating')} />
            </div>
          </Section>

          <Section title="Issues in this case" meta={String(findings.records.length)} flush>
            {findings.loading ? (
              <div className="flex justify-center py-8">
                <Spinner />
              </div>
            ) : (
              sortedFindings.map((f) => (
                <ListRow
                  key={f.id}
                  leading={<SeverityPill severity={f.severity} />}
                  primary={issueTitle(f, detailed)}
                  secondary={`found ${relTime(f.first_seen)} · last confirmed ${relTime(f.last_seen)}`}
                  trailing={<StatusPill status={f.status} />}
                  onClick={() => onOpenFinding(f.id)}
                />
              ))
            )}
          </Section>

          <Section title="Timeline" meta={String(notes.records.length)} flush>
            {can('analyst') && (
              <form
                className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (!note.trim()) return;
                  if (await act('note', 'incidents.add-note', { body: note.trim() }, 'Note added.')) setNote('');
                }}
              >
                <Textarea aria-label="Add a note" placeholder="Add a note for the team…" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
                <div>
                  <Button size="sm" type="submit" loading={busy === 'note'} disabled={!note.trim()}>
                    Add note
                  </Button>
                </div>
              </form>
            )}
            {notes.records.length === 0 ? (
              <EmptyState title="No activity yet" />
            ) : (
              notes.records.map((n) => (
                <ListRow
                  key={n.id}
                  leading={<ActorLabel label={n.actor_type === 'user' ? n.actor_label : n.actor_type} />}
                  primary={<span className={n.kind === 'event' ? 'text-[var(--agent-app-muted)]' : ''}>{n.body}</span>}
                  secondary={fmtDateTime(n.created)}
                />
              ))
            )}
          </Section>
        </div>

        <Section title="Manage">
          <div className="flex flex-col gap-4 p-4 text-[13px]">
            <div>
              <p className="mb-1 font-medium">Status</p>
              {can('analyst') && next.length > 0 ? (
                <Select
                  aria-label="Change status"
                  value=""
                  placeholder={`${INCIDENT_STATUS_LABELS[inc.status]} — change to…`}
                  onChange={(e) => {
                    if (e.target.value) {
                      setStatusNote('');
                      setStatusDialog(e.target.value);
                    }
                  }}
                  options={next.map((s) => ({ value: s, label: INCIDENT_STATUS_LABELS[s] ?? s }))}
                />
              ) : (
                <Pill tone={incidentStatusTone(inc.status)}>{INCIDENT_STATUS_LABELS[inc.status]}</Pill>
              )}
            </div>
            <div>
              <p className="mb-1 font-medium">Assignee</p>
              {can('analyst') ? (
                <Select
                  aria-label="Assignee"
                  value={inc.assignee}
                  onChange={(e) => void act('assign', 'incidents.assign', { user_id: e.target.value }, 'Assignment updated.')}
                  options={[{ value: '', label: 'Unassigned' }, ...members.records.map((m) => ({ value: m.id, label: m.id === member?.id ? `${m.email} (you)` : m.email }))]}
                />
              ) : (
                <span>{members.records.find((m) => m.id === inc.assignee)?.email ?? 'Unassigned'}</span>
              )}
            </div>
            <div className="text-[12px] text-[var(--agent-app-muted)]">
              {inc.finding_count} linked issue(s). The case is marked contained automatically when all of them are fixed or muted.
            </div>
          </div>
        </Section>
      </div>

      {!detailed && (
        <div className="mb-6">
          <DrillList>
            <DrillRow to={to.case(inc.id, true)} icon={<CodeIcon size={18} />} label="Technical details" hint="Detection rules, the analyst's assessment, full timeline" />
          </DrillList>
        </div>
      )}

      <Dialog
        open={statusDialog !== null}
        onOpenChange={(o) => !o && setStatusDialog(null)}
        title={`Mark as ${INCIDENT_STATUS_LABELS[statusDialog ?? ''] ?? ''}`}
        footer={
          <>
            <Button variant="secondary" onClick={() => setStatusDialog(null)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'status'}
              disabled={needsNote && !statusNote.trim()}
              onClick={async () => {
                if (statusDialog && (await act('status', 'incidents.set-status', { status: statusDialog, note: statusNote.trim() }, 'Status updated.'))) setStatusDialog(null);
              }}
            >
              Confirm
            </Button>
          </>
        }
      >
        <Textarea
          label={needsNote ? 'Why? (required)' : 'Note (optional)'}
          value={statusNote}
          onChange={(e) => setStatusNote(e.target.value)}
          rows={3}
        />
      </Dialog>

      <Dialog
        open={triageOpen}
        onOpenChange={setTriageOpen}
        title="Write the assessment"
        description="What happened, the likely cause, the impact, and the next steps."
        footer={
          <>
            <Button variant="secondary" onClick={() => setTriageOpen(false)}>
              Cancel
            </Button>
            <Button
              loading={busy === 'triage'}
              disabled={triage.summary.trim().length < 20}
              onClick={async () => {
                if (await act('triage', 'incidents.triage', { summary: triage.summary.trim(), confidence: triage.confidence }, 'Assessment saved.')) setTriageOpen(false);
              }}
            >
              Save
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Textarea
            label="Assessment"
            value={triage.summary}
            onChange={(e) => setTriage({ ...triage, summary: e.target.value })}
            rows={6}
            error={triage.summary.length > 0 && triage.summary.trim().length < 20 ? 'At least 20 characters.' : undefined}
          />
          <Select
            label="Confidence"
            value={triage.confidence}
            onChange={(e) => setTriage({ ...triage, confidence: e.target.value })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
        </div>
      </Dialog>
    </div>
    </DetailScope>
  );
}
