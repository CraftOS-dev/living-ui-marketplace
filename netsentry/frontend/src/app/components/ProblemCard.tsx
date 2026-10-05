/**
 * One problem as a card: icon, one line, and big buttons — "Fix it for me"
 * (the agent plans, a person approves), "Show me how" (a checklist to tick
 * off), "It's fine". The explanation hides behind "Why?"; the way deeper is a
 * link (the issue's own page, then its technical details). `ProblemRow` is the
 * same card folded into one line that opens in place.
 */
import { useEffect, useState } from 'react';
import { Button, Input, Select, Spinner, toast } from '../../kit/index.ts';
import { useCollection, useRecord } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { useMe } from '../lib/me.tsx';
import { go, href, to } from '../lib/nav.ts';
import { runOp } from '../lib/ops.ts';
import type { AppRecord, Explained, Finding, Settings, Suggestion } from '../lib/types.ts';
import { openUrl } from '../lib/apps.ts';
import type { UpdateInfo } from './Updates.tsx';
import { FIX_STATUS, URGENCY } from '../lib/words.ts';
import { ChevronRightIcon, ListCheckIcon, SparklesIcon, SquareCheckIcon, SquareIcon, ThumbUpIcon } from './icons.tsx';
import { IssueIcon, severityTone, UrgencyChip } from './visual.tsx';
import { useChange, type Preview } from './Controls.tsx';

type Mode = 'idle' | 'steps' | 'fine' | 'noagent' | 'noexecutor';

interface Presence {
  ever: boolean;
  last_seen: string;
}

// One lookup per minute for all cards on the page.
let presenceCache: { at: number; p: Promise<Presence | null> } | null = null;
function agentPresence(): Promise<Presence | null> {
  if (!presenceCache || Date.now() - presenceCache.at > 60000) {
    presenceCache = { at: Date.now(), p: runOp<Presence>('agent.presence', {}, { silent: true }).catch(() => null) };
  }
  return presenceCache.p;
}

export function ProblemCard({
  finding,
  counter,
  onDone,
  more = { to: to.issue(finding.id), label: 'More about this' },
  bare,
  explained,
  startWith,
}: {
  finding: Finding;
  counter?: string | undefined;
  /** Called after the person acted (the card's problem is handled or handed over). */
  onDone?: (() => void) | undefined;
  /** The link one level deeper (null = none). */
  more?: { to: string; label: string } | null;
  /** Inside a ProblemRow: no frame, no heading (the row shows them). */
  bare?: boolean | undefined;
  /** Open on the steps ("Show me how" from Home lands here with them showing). */
  startWith?: 'steps' | undefined;
  /** Start with "why it matters" showing (on the issue's own page). */
  explained?: boolean | undefined;
}): React.JSX.Element {
  const { can } = useMe();
  const [info, setInfo] = useState<Explained | null>(null);
  const [fix, setFix] = useState<Suggestion | null>(null);
  const [why, setWhy] = useState(!!explained);
  const [mode, setMode] = useState<Mode>(startWith ?? 'idle');
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  // Accepting a risk (plan §12.2, P5): why, and until when.
  const [reason, setReason] = useState('');
  const [months, setMonths] = useState('3');

  useEffect(() => {
    setInfo(null);
    setFix(null);
    setWhy(!!explained);
    setMode(startWith ?? 'idle');
    setTicked(new Set());
  }, [finding.id]);
  const explainR = useOp<Explained>('findings.explain', { finding_id: finding.id }, { freshMs: 30000 });
  const suggestR = useOp<Suggestion>('remediations.suggest', { finding_id: finding.id }, { freshMs: 30000 });
  useEffect(() => setInfo(explainR.data), [explainR.data]);
  useEffect(() => setFix(suggestR.data), [suggestR.data]);

  const act = async (op: string, params: Record<string, string>, done: string): Promise<void> => {
    setBusy(true);
    try {
      await runOp(op, { finding_id: finding.id, ...params });
      toast.success(done);
      onDone?.();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  // v2 checks close only when NetSentry sees they pass: "done" means "check again now".
  const checkAgain = async (): Promise<void> => {
    setBusy(true);
    try {
      await runOp('assets.rescan', { asset_id: finding.asset });
      toast.success('Checking again now — this closes by itself as soon as the check passes (usually within a few minutes).');
      setMode('idle');
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  const flow = useChange();
  const agentFix = fix?.playbooks.find((p) => p.risk !== 'guided');
  // The same one-button fixes Home offers (v4 §5.1): an update that closes the holes; opening an app to finish its setup.
  const appId = ((finding.evidence ?? {}) as { app_id?: string }).app_id ?? null;
  const { record: appRec } = useRecord<AppRecord>('apps', appId && (finding.rule_id === 'UPD-APP-SECURITY' || finding.rule_id === 'APP-SETUP-OPEN') ? appId : null);
  const upd = (appRec as (AppRecord & { update?: UpdateInfo | null }) | null)?.update ?? null;
  const updTo = upd ? (upd.state === 'available' && upd.to ? upd.to : upd.major?.to ?? '') : '';
  const updHigh = !!updTo && !(upd?.state === 'available' && upd.to === updTo && upd.risk !== 'high');
  const opensAt = appRec ? openUrl((appRec.endpoints ?? []).find((e) => e.proto !== 'udp') ?? null) : '';
  // "It's fine" on a reach check means "who should reach it is different": change the choice, don't mute a true fact.
  const ev = (finding.evidence ?? {}) as { app_id?: string };
  const reachAppId = finding.rule_id === 'REACH-BEYOND-INTENT' && ev.app_id ? ev.app_id : '';
  const askFix = async (anyway = false): Promise<void> => {
    if (!agentFix) return;
    // Be honest about who would make the change:
    //  - NetSentry's own fixes: the monitor on the machine, only if fixing is switched on THERE;
    //  - other fixes: a connected AI agent writes the plan.
    if (agentFix.builtin) {
      if (!anyway && !fix?.executor_ready) {
        setMode('noexecutor');
        return;
      }
      // NetSentry's own fix: the same preview-and-confirm as every change (v4 §4); nothing happens until a person confirms.
      await flow.ask(() => runOp<Preview>('changes.prepare-fix', { finding_id: finding.id }), 'Fix it');
      return;
    } else {
      const presence = await agentPresence();
      if (!anyway && presence !== null && !presence.ever) {
        setMode('noagent');
        return;
      }
    }
    setBusy(true);
    try {
      const r = await runOp<{ remediation_id: string; message: string }>('remediations.request-plan', { finding_id: finding.id, playbook_id: agentFix.id });
      toast.success(r.message);
      // Follow the fix: its page shows each step as it happens.
      go(to.fix(r.remediation_id));
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };

  const plain = info?.rule?.plain;
  const steps = plain?.steps ?? [];
  const askExpected = !!info?.rule?.ask_expected;
  const analyst = can('analyst');
  const title = finding.plain_title || finding.title;
  const allTicked = steps.length > 0 && ticked.size === steps.length;

  return (
    <div className={bare ? '' : 'rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-4 sm:p-5'}>
      {!bare && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <UrgencyChip label={URGENCY[finding.severity]} tone={severityTone(finding.severity)} />
          {counter && <span className="text-[12px] text-[var(--agent-app-muted)]">{counter}</span>}
        </div>
      )}

      {bare ? (
        <p className="text-[14px] leading-relaxed text-[var(--agent-app-muted)]">{plain?.means ?? info?.rule?.rationale ?? '…'}</p>
      ) : (
        <div className="flex items-start gap-3">
          <span className="mt-0.5 shrink-0 text-[var(--agent-app-muted)]">
            <IssueIcon finding={finding} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[16px] font-medium leading-snug">{title}</p>
            <button type="button" className="mt-1 min-h-[36px] text-[13px] text-[var(--agent-app-accent)] hover:underline" onClick={() => setWhy((w) => !w)} aria-expanded={why}>
              {why ? 'Hide' : 'Why does this matter?'}
            </button>
            {why && <p className="mt-1 text-[14px] leading-relaxed text-[var(--agent-app-muted)]">{plain?.means ?? info?.rule?.rationale ?? '…'}</p>}
          </div>
        </div>
      )}

      {plain?.saw && plain.saw.length > 0 && (bare || why) && (
        <div className="mt-3 rounded-lg bg-[var(--agent-app-surface-2)] px-3 py-2.5">
          <p className="mb-1 text-[12px] font-semibold uppercase tracking-wide text-[var(--agent-app-muted)]">What we saw</p>
          <ul className="flex flex-col gap-1 text-[14px] leading-snug">
            {plain.saw.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
          {plain.factors && plain.factors.length > 0 && <p className="mt-2 text-[12px] text-[var(--agent-app-muted)]">Why this urgency: {plain.factors.join(' · ')}</p>}
        </div>
      )}

      {info === null ? (
        <div className="mt-4 flex justify-center">
          <Spinner />
        </div>
      ) : fix?.active_remediation && !(fix.active_remediation.status === 'planned' && agentFix?.builtin) ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[14px]">
          <span>A fix is under way — {(FIX_STATUS[fix.active_remediation.status] ?? fix.active_remediation.status).toLowerCase()}.</span>
          <a href={href(to.fix(fix.active_remediation.id))} className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--agent-app-border)] px-3 text-[13px] hover:bg-[var(--agent-app-surface-2)]">
            See the fix <ChevronRightIcon size={14} />
          </a>
        </div>
      ) : mode === 'steps' ? (
        <div className="mt-4 border-t border-[var(--agent-app-border)] pt-3">
          <ul className="flex flex-col gap-1">
            {steps.map((s, k) => {
              const on = ticked.has(k);
              return (
                <li key={s}>
                  <button
                    type="button"
                    className="flex w-full items-start gap-3 rounded-lg p-2 text-left text-[14px] hover:bg-[var(--agent-app-surface-2)]"
                    aria-pressed={on}
                    onClick={() =>
                      setTicked((prev) => {
                        const n = new Set(prev);
                        if (n.has(k)) n.delete(k);
                        else n.add(k);
                        return n;
                      })
                    }
                  >
                    <span className={on ? 'text-emerald-600' : 'text-[var(--agent-app-muted)]'}>{on ? <SquareCheckIcon size={20} /> : <SquareIcon size={20} />}</span>
                    <span className={on ? 'text-[var(--agent-app-muted)] line-through' : ''}>{s}</span>
                  </button>
                </li>
              );
            })}
          </ul>
          {plain?.verify && <p className="mt-2 px-2 text-[13px] text-[var(--agent-app-muted)]">How we'll know: {plain.verify}</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            {analyst && (
              <Button
                loading={busy}
                disabled={!allTicked}
                onClick={() =>
                  void (info?.rule?.v2
                    ? checkAgain()
                    : act('findings.resolve', { note: 'Done by hand, following the steps.' }, 'Marked as done — NetSentry double-checks on its next scan.'))
                }
              >
                {info?.rule?.v2 ? "I've done it — check now" : "I've done it"}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Back
            </Button>
          </div>
        </div>
      ) : mode === 'noexecutor' ? (
        <div className="mt-4 rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[14px]">
          <p className="font-medium">Changes are switched off on this server</p>
          <p className="mt-1 text-[var(--agent-app-muted)]">
            NetSentry can make this change itself: {agentFix?.steps.join('; ').toLowerCase()}. Only the server itself can allow changes — Settings → Monitor
            shows the command. You confirm every change first, and NetSentry undoes it if it doesn't work.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setMode('steps')}>Show me how instead</Button>
            <Button variant="secondary" loading={busy} onClick={() => void askFix(true)}>
              Prepare the fix anyway
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Back
            </Button>
          </div>
        </div>
      ) : mode === 'noagent' ? (
        <div className="mt-4 rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[14px]">
          <p className="font-medium">No agent is connected yet</p>
          <p className="mt-1 text-[var(--agent-app-muted)]">
            NetSentry has no built-in fix for this one, so your CraftBot agent would write the plan — and you'd approve it before anything changes. Until an agent is
            connected, follow "Show me how".
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button onClick={() => setMode('steps')}>Show me how instead</Button>
            <Button variant="secondary" loading={busy} onClick={() => void askFix(true)}>
              Ask anyway — it waits for the agent
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Back
            </Button>
          </div>
        </div>
      ) : mode === 'fine' ? (
        <div className="mt-4 rounded-lg bg-[var(--agent-app-surface-2)] p-3 text-[14px]">
          <p>
            {askExpected
              ? 'Close it as expected? If it happens again, NetSentry tells you again.'
              : 'Accept this risk? It stops counting against you until the date you choose, then NetSentry asks again. It is listed under Accepted risks with your reason.'}
          </p>
          {!askExpected && (
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_180px]">
              <Input label="Why is it fine? (optional)" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. the share links are meant to be public" />
              <Select
                label="For how long"
                value={months}
                onChange={(e) => setMonths(e.target.value)}
                options={[
                  { value: '1', label: '1 month' },
                  { value: '3', label: '3 months' },
                  { value: '6', label: '6 months' },
                  { value: '12', label: '1 year' },
                ].concat([{ value: 'never', label: 'Until I change my mind' }])}
              />
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              loading={busy}
              onClick={() =>
                void (askExpected
                  ? act('findings.resolve', { note: 'Confirmed as expected.' }, 'Closed as expected.')
                  : act(
                      'findings.suppress',
                      Object.assign(
                        { reason: reason.trim() || 'Accepted as fine.' },
                        months === 'never' ? {} : { until: new Date(Date.now() + Number(months) * 30 * 86400000).toISOString().slice(0, 10) },
                      ),
                      months === 'never' ? 'Accepted — find it under Accepted risks.' : `Accepted for ${months} month${months === '1' ? '' : 's'} — it counts again after that.`,
                    ))
              }
            >
              {askExpected ? 'Yes, close it' : 'Accept the risk'}
            </Button>
            <Button variant="ghost" onClick={() => setMode('idle')}>
              Cancel
            </Button>
          </div>
        </div>
      ) : analyst ? (
        <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {askExpected ? (
            <>
              <BigButton primary icon={<ThumbUpIcon size={18} />} label="I know this — it's fine" onClick={() => setMode('fine')} />
              <BigButton icon={<ListCheckIcon size={18} />} label="I don't recognise it" onClick={() => setMode('steps')} />
              {agentFix && <BigButton icon={<SparklesIcon size={18} />} label="Ask the agent" onClick={() => void askFix()} busy={busy} />}
            </>
          ) : (
            <>
              {finding.rule_id === 'UPD-APP-SECURITY' && updTo && can('admin') && (
                <BigButton
                  primary
                  icon={<SparklesIcon size={18} />}
                  label={`Update to ${updTo.split('.').slice(0, 2).join('.')}`}
                  onClick={() => void flow.ask(() => runOp<Preview>('updates.request', { app_id: appId ?? '', to: updTo }), `Update to ${updTo.split('.').slice(0, 2).join('.')}`, updHigh)}
                  busy={flow.working}
                />
              )}
              {finding.rule_id === 'APP-SETUP-OPEN' && opensAt && <BigButton primary icon={<SparklesIcon size={18} />} label={`Open ${appRec?.label || appRec?.display_name || 'it'} to finish setup`} onClick={() => window.open(opensAt, '_blank', 'noopener,noreferrer')} />}
              {finding.rule_id === 'APP-SETUP-OPEN' && appRec?.container && (
                <BigButton icon={<ListCheckIcon size={18} />} label="Stop it for now" onClick={() => void flow.ask(() => runOp<Preview>('changes.request', { action: 'stop', app_id: appId ?? '' }), 'Stop now', true)} busy={flow.working} />
              )}
              {agentFix?.builtin && can('admin') && <BigButton primary icon={<SparklesIcon size={18} />} label="Fix it" onClick={() => void askFix()} busy={busy || flow.working} />}
              <BigButton primary={!agentFix?.builtin} icon={<ListCheckIcon size={18} />} label="Show me how" onClick={() => setMode('steps')} />
              {agentFix && !agentFix.builtin && <BigButton icon={<SparklesIcon size={18} />} label="Ask the agent to fix it" onClick={() => void askFix()} busy={busy} />}
              {reachAppId ? (
                <BigButton icon={<ThumbUpIcon size={18} />} label="That's intended" onClick={() => go(to.app(reachAppId, 'reach'))} />
              ) : (
                <BigButton icon={<ThumbUpIcon size={18} />} label="It's fine" onClick={() => setMode('fine')} />
              )}
            </>
          )}
        </div>
      ) : null}

      {flow.element}
      {more && (
        <a href={href(more.to)} className="mt-2 inline-flex min-h-[40px] items-center gap-1 text-[13px] text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
          {more.label} <ChevronRightIcon size={14} />
        </a>
      )}
    </div>
  );
}

function BigButton({ icon, label, onClick, primary, busy }: { icon: React.ReactNode; label: string; onClick: () => void; primary?: boolean; busy?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className={`flex min-h-[48px] items-center justify-center gap-2 rounded-lg px-3 text-[15px] font-medium transition-colors disabled:opacity-60 ${
        primary
          ? 'bg-[var(--agent-app-accent)] text-[var(--agent-app-accent-contrast)] hover:opacity-90'
          : 'border border-[var(--agent-app-border)] hover:bg-[var(--agent-app-surface-2)]'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

/** A problem folded into one line; tap to open it in place (the card's buttons appear under it). */
export function ProblemRow({ finding, on, open, onToggle }: { finding: Finding; on?: string | undefined; open: boolean; onToggle: () => void }): React.JSX.Element {
  const tone = severityTone(finding.severity);
  return (
    <div className={`border-b border-[var(--agent-app-border)] last:border-b-0 ${open ? 'bg-[var(--agent-app-surface-2)]/40' : ''}`}>
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex min-h-[56px] w-full items-center gap-3 px-4 py-2.5 text-left hover:bg-[var(--agent-app-surface-2)]">
        <span className="shrink-0 text-[var(--agent-app-muted)]">
          <IssueIcon finding={finding} size={20} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-medium leading-snug">{finding.plain_title || finding.title}</span>
          {on && <span className="block truncate text-[12px] text-[var(--agent-app-muted)]">on {on}</span>}
        </span>
        <UrgencyChip label={URGENCY[finding.severity]} tone={tone} />
        <span className={`shrink-0 text-[var(--agent-app-muted)] transition-transform ${open ? 'rotate-90' : ''}`}>
          <ChevronRightIcon size={16} />
        </span>
      </button>
      {open && (
        <div className="px-4 pb-4 pl-[3.25rem]">
          <ProblemCard finding={finding} bare />
        </div>
      )}
    </div>
  );
}

/** Problems listed before "Show N more" — the most urgent come first. */
const FIRST_FEW = 5;

/** "Needs you": problem rows, the first one open, the rest a tap away. `names` adds "on <item>". */
export function ProblemList({ problems, names, title = 'Needs you' }: { problems: Finding[]; names?: Record<string, string> | undefined; title?: string }): React.JSX.Element {
  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [showAll, setShowAll] = useState(false);
  const shownOpen = openId === undefined ? (problems[0]?.id ?? null) : openId;
  return (
    <section>
      <h2 className="mb-2 px-1 text-[13px] font-semibold">{title}</h2>
      <div className="overflow-hidden rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
        {(showAll ? problems : problems.slice(0, FIRST_FEW)).map((f) => (
          <ProblemRow key={f.id} finding={f} on={names?.[f.asset]} open={shownOpen === f.id} onToggle={() => setOpenId(shownOpen === f.id ? null : f.id)} />
        ))}
        {problems.length > FIRST_FEW && (
          <button
            type="button"
            onClick={() => setShowAll((v) => !v)}
            className="min-h-[44px] w-full text-[13px] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-surface-2)] hover:text-[var(--agent-app-text)]"
          >
            {showAll ? 'Show fewer' : `Show ${problems.length - FIRST_FEW} more`}
          </button>
        )}
      </div>
    </section>
  );
}
