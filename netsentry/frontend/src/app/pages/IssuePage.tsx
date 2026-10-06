/**
 * An issue's page (#/issue/<id>) — always in the same order: what we found,
 * why it matters, how to fix it (yourself, with the agent, or "not a
 * problem"). One level deeper, #/issue/<id>/technical, is the same issue in
 * technical terms: the detection rule, the raw evidence, references.
 * Breadcrumbs: Home › <item> › <issue> › Technical details.
 */
import { useCallback, useEffect, useState } from 'react';
import { Button, DateInput, Dialog, Pill, Spinner, Textarea, toast } from '../../kit/index.ts';
import { useRecord } from '../store/collections.ts';
import { useMe } from '../lib/me.tsx';
import { opError, runOp } from '../lib/ops.ts';
import { fmtDate, fmtDateTime, relTime } from '../lib/format.ts';
import type { Explained, Finding, Incident, Suggestion } from '../lib/types.ts';
import { FIX_STATUS, ISSUE_STATUS, RISK_WORDS } from '../lib/words.ts';
import { go, to } from '../lib/nav.ts';
import { DetailScope } from '../lib/view.tsx';
import { Breadcrumbs, DrillList, DrillRow, type Crumb } from '../components/Breadcrumbs.tsx';
import { EvidenceView } from '../components/EvidenceView.tsx';
import { CodeIcon, AlertIcon, LaptopIcon } from '../components/icons.tsx';
import { ProblemCard } from '../components/ProblemCard.tsx';
import { SeverityPill, StatusPill } from '../components/pills.tsx';

type Action = 'resolve' | 'suppress' | null;

/** The facts a person judges by, in the order they read them; empty ones left out. */
const FIRST = ['program', 'publisher', 'signed', 'file', 'connected_to', 'user', 'path', 'command'];
function readableFirst(evidence: unknown): unknown {
  if (evidence === null || typeof evidence !== 'object' || Array.isArray(evidence)) return evidence;
  const e = evidence as Record<string, unknown>;
  const empty = (v: unknown): boolean => v === null || v === '' || (Array.isArray(v) && v.length === 0);
  const keys = [...FIRST.filter((k) => k in e), ...Object.keys(e).filter((k) => !FIRST.includes(k))];
  return Object.fromEntries(keys.filter((k) => !empty(e[k])).map((k) => [k, e[k]]));
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section>
      <h3 className="mb-1.5 text-[13px] font-semibold">{title}</h3>
      {children}
    </section>
  );
}

export function IssuePage({ findingId, technical, steps = false }: { findingId: string; technical: boolean; steps?: boolean }): React.JSX.Element {
  const { can } = useMe();
  const detailed = technical;
  const onOpenAsset = (id: string): void => go(to.item(id));
  const onOpenIncident = (id: string): void => go(to.case(id));
  const setFixOpen = (id: string): void => go(to.fix(id));
  // Realtime: status changes (by anyone, or a scan) re-trigger the explain fetch.
  const { record } = useRecord<Finding>('findings', findingId);
  const { record: linkedCase } = useRecord<Incident>('incidents', record?.incident ? record.incident : null);
  const [data, setData] = useState<Explained | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<Action>(null);
  const [note, setNote] = useState('');
  const [until, setUntil] = useState<string | null>(null);
  const [noteError, setNoteError] = useState<string | undefined>(undefined);
  const [fix, setFix] = useState<Suggestion | null>(null);
  // "Something new appeared" issues start with one question; the fix options appear if the answer is no.
  const [unsure, setUnsure] = useState(false);
  useEffect(() => setUnsure(false), [findingId]);

  const load = useCallback(async () => {
    if (findingId === null) return;
    try {
      setData(await runOp<Explained>('findings.explain', { finding_id: findingId }, { silent: true }));
      setLoadError(null);
    } catch (err) {
      setLoadError(opError(err));
    }
  }, [findingId]);

  // A new problem: start blank. The same problem re-checked (last_seen moves every report): refresh in
  // place, so whatever the person has open on the card (a preview to confirm) stays open.
  useEffect(() => setData(null), [findingId]);
  useEffect(() => {
    void load();
  }, [load, record?.status, record?.last_seen]);

  useEffect(() => {
    setFix(null);
    if (findingId === null) return;
    void runOp<Suggestion>('remediations.suggest', { finding_id: findingId }, { silent: true }).then(setFix, () => setFix(null));
  }, [findingId, record?.status]);

  const requestFix = async (playbookId: string): Promise<void> => {
    if (findingId === null) return;
    setBusy(true);
    try {
      // Guided: the steps to follow. Anything else: the agent is asked and prepares changes to confirm (N-B43).
      const r = await runOp<{ remediation_id?: string; message: string }>('remediations.request-plan', { finding_id: findingId, playbook_id: playbookId });
      toast.success(r.message);
      if (r.remediation_id) setFixOpen(r.remediation_id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  const act = async (name: string, params: Record<string, string | undefined>, done: string): Promise<boolean> => {
    if (findingId === null) return false;
    setBusy(true);
    try {
      await runOp<{ status: string }>(name, { finding_id: findingId, ...params });
      toast.success(done);
      await load();
      return true;
    } catch {
      return false; // toast already shown by the client
    } finally {
      setBusy(false);
    }
  };

  const submitDialog = async (): Promise<void> => {
    if (note.trim() === '') {
      setNoteError(dialog === 'resolve' ? 'Say what you did.' : 'Say why it is not a problem.');
      return;
    }
    const ok =
      dialog === 'resolve'
        ? await act('findings.resolve', { note }, 'Marked as fixed. If the next check still sees it, it comes back.')
        : await act('findings.suppress', { reason: note, until: until ?? undefined }, 'Muted.');
    if (ok) {
      setDialog(null);
      setNote('');
      setUntil(null);
    }
  };

  const f = data?.finding;
  const status = f?.status;
  const live = status === 'open' || status === 'acknowledged';
  const plainTitle = record ? record.plain_title || record.title : 'Issue';
  const trail: Crumb[] = [{ label: 'Home', to: 'home' }];
  if (data?.asset) trail.push({ label: data.asset.label || data.asset.identifier, to: to.item(data.asset.id) });
  else trail.push({ label: 'Issues', to: 'issues' });
  if (technical) trail.push({ label: plainTitle, to: to.issue(findingId) }, { label: 'Technical details' });
  else trail.push({ label: plainTitle });
  const deeper = (
    <DrillList>
      {data?.asset && <DrillRow to={to.item(data.asset.id)} icon={<LaptopIcon size={18} />} label={`Everything on ${data.asset.label || data.asset.identifier}`} hint="Its other problems, what it runs, its history" />}
      {record?.incident && linkedCase !== null && linkedCase.finding_count > 1 && (
        <DrillRow to={to.case(record.incident)} icon={<AlertIcon size={18} />} label="Related problems" hint={`${linkedCase.finding_count} problems that belong together`} />
      )}
      <DrillRow to={to.issue(findingId, true)} icon={<CodeIcon size={18} />} label="Technical details" hint="Detection rule, raw evidence, references" />
    </DrillList>
  );
  return (
    <div className="mx-auto max-w-3xl">
      <Breadcrumbs trail={trail} />
      <DetailScope on={detailed}>
      {loadError !== null ? (
        <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
      ) : data === null || f === undefined ? (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      ) : !detailed && record !== null && record.status === 'open' ? (
        <div className="flex flex-col gap-4 text-[13px]">
          <ProblemCard finding={record} more={null} explained startWith={steps ? 'steps' : undefined} />
          <p className="px-1 text-[12px] text-[var(--agent-app-muted)]">
            Found {relTime(f.first_seen)} · still there at the last check {relTime(f.last_seen)}
          </p>
          {deeper}
        </div>
      ) : (
        <div className="flex flex-col gap-5 text-[13px]">
          {/* What we found */}
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <SeverityPill severity={f.severity} action={live} />
              <StatusPill status={f.status} />
            </div>
            <h2 className="text-base font-semibold">{detailed ? f.title : f.plain_title || f.title}</h2>
            {detailed && f.plain_title && f.plain_title !== f.title && <p className="mt-0.5 text-[13px] text-[var(--agent-app-muted)]">In plain words: {f.plain_title}</p>}
            <p className="mt-1 text-[12px] text-[var(--agent-app-muted)]">
              {data.asset !== null && (
                <>
                  On{' '}
                  <button type="button" className="text-[var(--agent-app-accent)] hover:underline" onClick={() => onOpenAsset(data.asset!.id)}>
                    {data.asset.label || data.asset.identifier}
                  </button>
                  {' · '}
                </>
              )}
              found {relTime(f.first_seen)} · last confirmed {relTime(f.last_seen)}
            </p>
            {record?.incident && linkedCase !== null && linkedCase.finding_count > 1 ? (
              <button type="button" className="mt-1 block text-[13px] text-[var(--agent-app-accent)] hover:underline" onClick={() => onOpenIncident(record.incident)}>
                Part of a case with related issues on the server — open it
              </button>
            ) : null}
            {f.status_note && <p className="mt-2 italic">“{f.status_note}”</p>}
            {f.status === 'suppressed' && data.suppression !== null && (
              <p className="mt-2">
                Muted by {data.suppression.created_by || 'someone'}
                {data.suppression.until ? ` until ${fmtDate(data.suppression.until)} — it comes back after that if still present.` : '.'}
              </p>
            )}
            {f.status === 'resolved' && (
              <p className="mt-2 text-emerald-700 dark:text-emerald-400">
                {f.status_note.startsWith('Resolved automatically')
                  ? 'Fixed — the latest check no longer sees this.'
                  : `Closed by ${record?.status_by || 'a person'}. If it happens again, NetSentry raises it again.`}
              </p>
            )}
          </div>

          {data.rule !== null && (
            <Block title={detailed ? 'Why it matters' : 'What this means'}>
              <p className="leading-relaxed">{!detailed && data.rule.plain ? data.rule.plain.means : data.rule.rationale}</p>
            </Block>
          )}

          {live && data.rule?.ask_expected && !unsure && (
            <Block title="Is this expected?">
              <div className="flex flex-col gap-3 rounded-[var(--agent-app-radius)] border border-[var(--agent-app-accent)] p-3">
                <p>Most of the time this is something you installed or an update. Check the details:</p>
                <EvidenceView evidence={readableFirst(f.evidence)} />
                {can('analyst') ? (
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm" loading={busy} onClick={() => void act('findings.resolve', { note: 'Confirmed as expected.' }, 'Marked as expected — the issue is closed.')}>
                      Yes, this is expected
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => setUnsure(true)}>
                      I don’t recognise it
                    </Button>
                  </div>
                ) : (
                  <p className="text-[12px] text-[var(--agent-app-muted)]">An analyst or admin can confirm it.</p>
                )}
              </div>
            </Block>
          )}

          {live && (!data.rule?.ask_expected || unsure || !can('analyst')) && (
            <Block title="How to fix it">
              <div className="flex flex-col gap-3">
                {data.rule !== null && (
                  <div className="rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] p-3">
                    <p className="mb-1 font-medium">Do it yourself</p>
                    {!detailed && data.rule.plain ? (
                      <ol className="list-decimal space-y-1 pl-5 leading-relaxed">
                        {data.rule.plain.steps.map((st) => (
                          <li key={st}>{st}</li>
                        ))}
                      </ol>
                    ) : (
                      <p className="whitespace-pre-line leading-relaxed">{data.rule.remediation}</p>
                    )}
                    <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">When something changes, NetSentry notices on its next check and closes the issue by itself.</p>
                  </div>
                )}

                {fix !== null && fix.playbooks.length > 0 && (
                  <div className="rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] p-3">
                    <p className="mb-1 font-medium">{fix.playbooks.every((pb) => pb.builtin) ? 'NetSentry can fix this itself' : 'Let the agent do it'}</p>
                    {fix.active_remediation ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span>A fix is under way: {FIX_STATUS[fix.active_remediation.status] ?? fix.active_remediation.status}.</span>
                        <Button size="sm" variant="secondary" onClick={() => setFixOpen(fix.active_remediation!.id)}>
                          Open the fix
                        </Button>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-2">
                        <p className="text-[12px] text-[var(--agent-app-muted)]">
                          {fix.playbooks.every((pb) => pb.builtin)
                            ? 'NetSentry shows exactly what will change → an admin confirms it → the monitor on this server applies it → NetSentry checks it worked.'
                            : 'The agent writes an exact plan → an admin approves it → the agent applies it → NetSentry checks it worked.'}
                        </p>
                        {fix.playbooks.map((pb) => {
                          const risk = RISK_WORDS[pb.risk];
                          return (
                            <div key={pb.id} className="flex flex-col gap-1 border-t border-[var(--agent-app-border)] pt-2 first:border-t-0 first:pt-0">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="font-medium">{detailed ? pb.title : pb.plain_title || pb.title}</span>
                                {risk && <Pill tone={risk.tone}>{risk.label}</Pill>}
                              </div>
                              <p className="text-[12px] text-[var(--agent-app-muted)]">
                                {risk?.help}
                                {pb.downtime && pb.downtime !== 'none expected' ? ` Downtime: ${pb.downtime}.` : ''}
                                {pb.cost && pb.cost !== 'none' ? ` Cost: ${pb.cost}.` : ''}
                                {pb.lockout_risk ? ' Could lock you out if done carelessly — the plan must keep a second way in.' : ''}
                              </p>
                              {can('analyst') && (
                                <div>
                                  <Button size="sm" loading={busy} onClick={() => void requestFix(pb.id)}>
                                    {pb.risk === 'guided' ? 'Guide me through it' : 'Ask the agent to fix it'}
                                  </Button>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}

                {can('analyst') && (
                  <div className="rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] p-3">
                    <p className="mb-2 font-medium">Other options</p>
                    <div className="flex flex-wrap gap-2">
                      {status === 'open' && (
                        <Button size="sm" variant="secondary" loading={busy} onClick={() => void act('findings.acknowledge', {}, 'Marked as being handled.')}>
                          I’m on it
                        </Button>
                      )}
                      <Button size="sm" variant="secondary" disabled={busy} onClick={() => setDialog('resolve')}>
                        I fixed it…
                      </Button>
                      <Button size="sm" variant="ghost" disabled={busy} onClick={() => setDialog('suppress')}>
                        Not a problem — mute…
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </Block>
          )}

          {status === 'suppressed' && can('analyst') && (
            <div>
              <Button size="sm" variant="secondary" loading={busy} onClick={() => void act('findings.unsuppress', {}, 'Unmuted.')}>
                Unmute
              </Button>
            </div>
          )}

          {detailed ? (
            <div className="flex flex-col gap-4 rounded-[var(--agent-app-radius)] border border-[var(--agent-app-border)] p-3">
              <p className="text-[12px] text-[var(--agent-app-muted)]">
                Detection rule <span className="font-mono">{f.rule_id}</span>
                {data.rule ? ` — ${data.rule.title}` : ''} · status {ISSUE_STATUS[f.status]} · first seen {fmtDateTime(f.first_seen)}
              </p>
              <div>
                <h4 className="mb-2 text-[12px] font-semibold">Evidence</h4>
                <EvidenceView evidence={f.evidence} />
              </div>
              {data.rule !== null && data.rule.references.length > 0 && (
                <div>
                  <h4 className="mb-1 text-[12px] font-semibold">References</h4>
                  <ul className="list-disc pl-5">
                    {data.rule.references.map((r) => (
                      <li key={r}>
                        <a className="break-all text-[var(--agent-app-accent)] hover:underline" href={r} target="_blank" rel="noopener noreferrer">
                          {r}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : (
            deeper
          )}
        </div>
      )}

      <Dialog
        open={dialog !== null}
        onOpenChange={(open) => {
          if (!open) {
            setDialog(null);
            setNoteError(undefined);
          }
        }}
        title={dialog === 'resolve' ? 'I fixed it' : 'Mute this issue'}
        description={
          dialog === 'resolve'
            ? 'NetSentry re-checks on its own; if the problem is still there, the issue comes back.'
            : 'Muted issues do not count against your score. Set an end date to be reminded later.'
        }
        footer={
          <>
            <Button variant="secondary" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void submitDialog()}>
              {dialog === 'resolve' ? 'Mark as fixed' : 'Mute'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          <Textarea
            label={dialog === 'resolve' ? 'What did you do?' : 'Why is it not a problem?'}
            value={note}
            onChange={(e) => {
              setNote(e.target.value);
              setNoteError(undefined);
            }}
            error={noteError}
            rows={3}
          />
          {dialog === 'suppress' && <DateInput label="Mute until (optional)" value={until} onValue={setUntil} dateOnly />}
        </div>
      </Dialog>
      </DetailScope>
    </div>
  );
}
