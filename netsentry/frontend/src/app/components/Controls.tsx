/**
 * Running things (v3 plan §8–§9): Start / Stop / Restart with a preview a
 * person confirms, an app's or a service's log, and the history of changes.
 *
 * Nothing happens on a click alone: the click prepares the change and shows
 * exactly what it does; "Restart now" is the confirmation (D13). The machine's
 * monitor applies it within seconds (it checks in fast while this page is open)
 * and the change's own record shows the result.
 */
import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Input, Pill, Spinner, getPbClient, toast } from '../../kit/index.ts';
import { useCollection, useRecord } from '../store/collections.ts';
import { useOp } from '../store/resources.ts';
import { TONE_COLOR } from './visual.tsx';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';
import type { Remediation } from '../lib/types.ts';

/** Keep a machine's monitor checking in fast while this component is on screen. */
export function useWatch(assetId: string | null | undefined): void {
  useEffect(() => {
    if (!assetId) return;
    // Only while the tab is in front: a hidden tab doesn't keep the server sampling (v4 §16).
    const ping = (): void => {
      if (document.visibilityState === 'hidden') return;
      void runOp('machines.watch', { asset_id: assetId }, { silent: true }).catch(() => undefined);
    };
    ping();
    const timer = window.setInterval(ping, 45000);
    document.addEventListener('visibilitychange', ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', ping);
    };
  }, [assetId]);
}

export interface Preview {
  remediation_id: string;
  plan_hash: string;
  preview: { title: string; what_changes: string[]; undo: string[]; disrupts: string; risk?: string; why?: string; keeps?: string[] };
  manageable: boolean;
  message: string;
}

type Target = { app_id: string } | { asset_id: string; service: string; label?: string };

const VERB: Record<'start' | 'stop' | 'restart', string> = { start: 'Start', stop: 'Stop', restart: 'Restart' };
const ENDED = ['done', 'failed', 'rolled_back', 'expired', 'cancelled', 'rejected'];

const STEPS = ['Prepared', 'Review', 'Confirm', 'Checked'] as const;

/** Prepared → Review → Confirm → Checked: where a change is, as four dots. */
function Stepper({ at, failed }: { at: number; failed?: boolean }): React.JSX.Element {
  return (
    <ol className="flex items-start" aria-label="Where this change is">
      {STEPS.map((s, i) => {
        const done = i < at;
        const now = i === at;
        const bad = failed && i === STEPS.length - 1 && at >= STEPS.length - 1;
        return (
          <li key={s} className="relative flex flex-1 flex-col items-center gap-1.5 text-center text-[12px]" aria-current={now ? 'step' : undefined}>
            {i < STEPS.length - 1 && (
              <span className="absolute left-[calc(50%+14px)] right-[calc(-50%+14px)] top-3 h-0.5" style={{ background: done ? TONE_COLOR.good : 'var(--agent-app-border)' }} aria-hidden />
            )}
            <span
              className="relative z-[1] grid h-6 w-6 place-items-center rounded-full text-[12px] font-semibold"
              style={
                bad
                  ? { background: TONE_COLOR.bad, color: 'var(--agent-app-surface)' }
                  : done
                    ? { background: TONE_COLOR.good, color: 'var(--agent-app-surface)' }
                    : now
                      ? { background: 'var(--agent-app-accent)', color: 'var(--agent-app-accent-contrast)' }
                      : { background: 'var(--agent-app-surface-2)', color: 'var(--agent-app-muted)' }
              }
            >
              {bad ? '!' : done ? '✓' : i + 1}
            </span>
            <span className={now ? 'font-medium' : 'text-[var(--agent-app-muted)]'}>{s}</span>
          </li>
        );
      })}
    </ol>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="text-[13px] font-semibold">{title}</h3>
      <div className="text-[14px]">{children}</div>
    </div>
  );
}

const LIVE_WORD: Record<string, string> = {
  approved: 'Sent — waiting for the server to pick it up…',
  executing: 'Happening on the server now…',
  verifying: 'Checking it worked…',
};

/** A change after Confirm, followed live from its own record: each step, the check, the result. */
function Progress({ r }: { r: Remediation | null }): React.JSX.Element {
  if (!r) {
    return (
      <p className="flex items-center gap-2 text-[14px] text-[var(--agent-app-muted)]">
        <Spinner /> Sending…
      </p>
    );
  }
  const steps = r.plan?.steps ?? [];
  const log = r.steps_log ?? [];
  const latest = (i: number): { outcome: string; output: string } | undefined => [...log].reverse().find((e) => e.step === i);
  const ended = ENDED.includes(r.status) || r.status === 'undone';
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-2.5">
        {steps.map((s, i) => {
          const e = latest(i);
          const running = !e && !ended && (r.status === 'executing' ? i === log.filter((x) => x.step >= 0).length : false);
          const tone = e?.outcome === 'ok' ? TONE_COLOR.good : e?.outcome === 'failed' ? TONE_COLOR.bad : 'var(--agent-app-border)';
          return (
            <li key={i} className="flex items-start gap-2.5 text-[14px]">
              <span className="mt-0.5 grid h-[18px] w-[18px] shrink-0 place-items-center rounded-full text-[11px] font-bold" style={e ? { background: tone, color: 'var(--agent-app-surface)' } : { border: `2px solid ${tone}` }} aria-hidden>
                {e?.outcome === 'ok' ? '✓' : e?.outcome === 'failed' ? '!' : e?.outcome === 'skipped' ? '–' : running ? <Spinner /> : ''}
              </span>
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">
                {s.description}
                {e?.outcome === 'failed' && e.output && <span className="mt-1 block text-[12px] text-[var(--agent-app-muted)]">{e.output.slice(0, 300)}</span>}
              </span>
            </li>
          );
        })}
      </ul>
      {!ended && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> {LIVE_WORD[r.status] ?? 'Working…'}
        </p>
      )}
      {r.status === 'done' && (
        <div className="flex flex-col gap-1 rounded-lg px-3 py-2.5" style={{ background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.good} 12%)` }}>
          <p className="text-[14px] font-medium">Done{r.verify_result?.checked ? ' — and checked' : ''}</p>
          {r.verify_result?.note && <p className="text-[13px] text-[var(--agent-app-muted)]">{r.verify_result.note}</p>}
        </div>
      )}
      {(r.status === 'failed' || r.status === 'rolled_back' || r.status === 'expired') && (
        <div className="flex flex-col gap-1 rounded-lg px-3 py-2.5" style={{ background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.bad} 12%)` }}>
          <p className="text-[14px] font-medium">{r.status === 'rolled_back' ? 'It didn’t work — everything is back as it was' : r.status === 'expired' ? 'The server didn’t pick it up in time' : 'It didn’t work'}</p>
          {r.failure_reason && <p className="text-[13px] text-[var(--agent-app-muted)] [overflow-wrap:anywhere]">{r.failure_reason.slice(0, 600)}</p>}
        </div>
      )}
    </div>
  );
}

/** What an undo shows while the server puts things back, and when it has. */
function UndoProgress({ r, words }: { r: Remediation | null; words: string[] }): React.JSX.Element {
  const done = r?.status === 'undone';
  const note = [...(r?.steps_log ?? [])].reverse().find((e) => e.step === -2)?.output;
  return (
    <div className="flex flex-col gap-4">
      {words.length > 0 && (
        <Block title="Putting back">
          <ul className="flex list-disc flex-col gap-1 pl-5 text-[14px] [overflow-wrap:anywhere]">
            {words.map((u) => (
              <li key={u}>{u}</li>
            ))}
          </ul>
        </Block>
      )}
      {done ? (
        <div className="flex flex-col gap-1 rounded-lg px-3 py-2.5" style={{ background: `color-mix(in srgb, var(--agent-app-surface), ${TONE_COLOR.good} 12%)` }}>
          <p className="text-[14px] font-medium">Put back as it was</p>
          {note && <p className="text-[13px] text-[var(--agent-app-muted)] [overflow-wrap:anywhere]">{note.slice(0, 400)}</p>}
        </div>
      ) : (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> Sent — the server is putting it back…
        </p>
      )}
    </div>
  );
}

/** A change that worked, to undo: what `askUndo` needs. */
export interface UndoTarget {
  id: string;
  title: string;
  words: string[];
}

/**
 * Prepare → show exactly what happens → a person confirms → watch it finish (v4 §16, N-B23).
 * `ask(prepare, label)` runs `prepare()` (which returns a change preview) and opens the side drawer;
 * its confirm button reads `label` ("Restart now", "Update now"). After Confirm the drawer stays
 * open and follows the change live; closing it never cancels a confirmed change (a toast then says
 * how it ended). `askUndo(change)` opens the same drawer to undo a change that worked, and follows
 * the undo the same way — one place for every change and every undo.
 */
export function useChange(): {
  ask: (prepare: () => Promise<Preview>, label: string, danger?: boolean) => Promise<void>;
  askUndo: (t: UndoTarget) => void;
  working: boolean;
  status: string | null;
  element: React.JSX.Element;
} {
  const { can } = useMe();
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ p: Preview; label: string; danger: boolean; undoOf?: string } | null>(null);
  const [open, setOpen] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [undoMode, setUndoMode] = useState(false);
  const [undo, setUndo] = useState<{ ok: boolean; words: string[] } | null>(null);
  const [undoAsk, setUndoAsk] = useState(false);
  const change = useRecord<Remediation>('remediations', sent);
  const announced = useRef<string>('');
  const r = change.record;
  const ended = !!r && (undoMode ? r.status === 'undone' : ENDED.includes(r.status) || r.status === 'undone');

  // Closed while it was still going: say once how it ended.
  useEffect(() => {
    if (!r || open || announced.current === `${r.id}:${r.status}`) return;
    if (undoMode && r.status === 'undone') {
      announced.current = `${r.id}:${r.status}`;
      toast.success(`${r.plain_title || r.title} — undone.`);
      setSent(null);
    } else if (!undoMode && r.status === 'done') {
      announced.current = `${r.id}:${r.status}`;
      toast.success(`${r.plain_title || r.title} — done.`);
      setSent(null);
    } else if (!undoMode && (r.status === 'failed' || r.status === 'rolled_back' || r.status === 'expired')) {
      announced.current = `${r.id}:${r.status}`;
      toast.error(`${r.plain_title || r.title} — didn't work: ${r.failure_reason || r.status}`);
      setSent(null);
    }
  }, [r, open, undoMode]);

  // Done: can it be undone (and how)? The change list knows each kind's window.
  useEffect(() => {
    if (!r || undoMode || r.status !== 'done' || undo) return;
    void runOp<{ changes: Array<{ id: string; undoable?: boolean; undo?: string[] }> }>('changes.list', { asset_id: r.asset }, { silent: true }).then(
      (x) => {
        const row = x.changes.find((c) => c.id === r.id);
        setUndo({ ok: !!row?.undoable, words: row?.undo ?? [] });
      },
      () => setUndo({ ok: false, words: [] }),
    );
  }, [r, undo, undoMode]);

  const reset = (): void => {
    setSent(null);
    setUndo(null);
    setUndoAsk(false);
    setUndoMode(false);
    announced.current = '';
  };
  const ask = async (prepare: () => Promise<Preview>, label: string, danger = false): Promise<void> => {
    setBusy(true);
    try {
      const p = await prepare();
      reset();
      setPending({ p, label, danger });
      setOpen(true);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const askUndo = (t: UndoTarget): void => {
    reset();
    setPending({
      p: { remediation_id: t.id, plan_hash: '', manageable: true, message: '', preview: { title: `Undo: ${t.title}`, what_changes: [], undo: [], disrupts: '' } },
      label: 'Undo it',
      danger: false,
      undoOf: t.id,
    });
    setUndo({ ok: true, words: t.words });
    setOpen(true);
  };
  /** Ask the server to put a change back, then follow it in this drawer. */
  const sendUndo = async (id: string): Promise<void> => {
    setBusy(true);
    try {
      await runOp<{ message: string }>('changes.undo', { remediation_id: id });
      announced.current = '';
      setUndoAsk(false);
      setUndoMode(true);
      setSent(id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  const confirm = async (): Promise<void> => {
    if (!pending) return;
    if (pending.undoOf) return sendUndo(pending.undoOf);
    setBusy(true);
    try {
      await runOp('changes.confirm', { remediation_id: pending.p.remediation_id, plan_hash: pending.p.plan_hash });
      announced.current = '';
      setSent(pending.p.remediation_id);
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  /** Closed before confirming: the prepared change is withdrawn, so nothing waits for nobody. */
  const close = (): void => {
    if (pending && !sent && !pending.undoOf) void runOp('remediations.cancel', { remediation_id: pending.p.remediation_id, note: 'Closed without confirming.' }, { silent: true }).catch(() => undefined);
    if (ended) {
      announced.current = `${r!.id}:${r!.status}`;
      setSent(null);
    }
    setOpen(false);
    setPending(null);
  };

  const pv = pending?.p.preview;
  // Prepared ✓ → Review (now) → Confirm ✓ once sent → Checked (now) while it runs → all done.
  const at = !sent ? 1 : !ended ? 3 : 4;
  const failed = !!r && !undoMode && (r.status === 'failed' || r.status === 'rolled_back' || r.status === 'expired');
  const footer = !sent ? (
    <>
      <Button variant="ghost" onClick={close}>
        Not now
      </Button>
      {pending?.p.manageable && (
        <Button variant={pending.danger ? 'danger' : 'primary'} loading={busy} onClick={() => void confirm()}>
          {pending.label}
        </Button>
      )}
    </>
  ) : undoAsk ? (
    <>
      <span className="mr-auto self-center text-[13px]">Put it back as it was?</span>
      <Button variant="ghost" onClick={() => setUndoAsk(false)}>
        Keep it
      </Button>
      <Button loading={busy} onClick={() => void sendUndo(r!.id)}>
        Undo it
      </Button>
    </>
  ) : (
    <>
      {!ended && <span className="mr-auto self-center text-[12px] text-[var(--agent-app-muted)]">You can close this — it carries on.</span>}
      {ended && !undoMode && r?.status === 'done' && undo?.ok && can('admin') && (
        <Button variant="secondary" onClick={() => setUndoAsk(true)}>
          Undo
        </Button>
      )}
      <Button variant={ended ? 'primary' : 'ghost'} onClick={close}>
        {ended ? 'Done' : 'Close'}
      </Button>
    </>
  );
  const element = (
    <Drawer open={open && pending !== null} onClose={close} title={undoMode && r ? `Undo: ${r.plain_title || r.title}` : pv ? pv.title : ''} width={480} footer={footer}>
      {pv && pending && (
        <div className="flex flex-col gap-5">
          <Stepper at={at} failed={failed} />
          {!sent && pending.undoOf ? (
            <>
              <Block title="What will change">
                {undo?.words.length ? (
                  <ul className="flex list-disc flex-col gap-1 pl-5 [overflow-wrap:anywhere]">
                    {undo.words.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                ) : (
                  <p>The server puts things back the way they were, from what it recorded when it made this change.</p>
                )}
              </Block>
              <p className="text-[12px] text-[var(--agent-app-muted)]">Nothing happens until you confirm.</p>
            </>
          ) : !sent ? (
            <>
              {pv.risk && (
                <p className="text-[14px]">
                  <Pill tone={pv.risk === 'high' ? 'bad' : pv.risk === 'medium' ? 'warn' : 'good'}>{pv.risk.charAt(0).toUpperCase() + pv.risk.slice(1)} risk</Pill> {pv.why}
                </p>
              )}
              {pv.what_changes.length > 0 && !(pv.what_changes.length === 1 && pv.what_changes[0] === pv.title) && (
                <Block title="What will change">
                  <ul className="flex list-disc flex-col gap-1 pl-5 [overflow-wrap:anywhere]">
                    {pv.what_changes.map((w) => (
                      <li key={w}>{w}</li>
                    ))}
                  </ul>
                </Block>
              )}
              {pv.disrupts && <Block title="What it does to you">{pv.disrupts}</Block>}
              {(pv.keeps ?? []).length > 0 && (
                <Block title="Good to know">
                  {(pv.keeps ?? []).map((k) => (
                    <p key={k} className="text-[13px] text-[var(--agent-app-muted)]">
                      {k}
                    </p>
                  ))}
                </Block>
              )}
              {pv.undo.filter(Boolean).length > 0 && (
                <Block title="If you change your mind">
                  <p className="text-[13px] text-[var(--agent-app-muted)]">{pv.undo.filter(Boolean).join('; ')}.</p>
                </Block>
              )}
              {!pending.p.manageable && <p className="rounded-md bg-[var(--agent-app-surface-2)] p-3 text-[13px]">{pending.p.message}</p>}
              <p className="text-[12px] text-[var(--agent-app-muted)]">Nothing happens until you confirm.</p>
            </>
          ) : undoMode ? (
            <UndoProgress r={r} words={undo?.words ?? []} />
          ) : (
            <>
              <Progress r={r} />
              {undoAsk && undo?.words.length ? (
                <Block title="Undo puts back">
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-[13px]">
                    {undo.words.map((u) => (
                      <li key={u}>{u}</li>
                    ))}
                  </ul>
                </Block>
              ) : null}
            </>
          )}
        </div>
      )}
    </Drawer>
  );
  const working = sent !== null && r !== null && !ended;
  return { ask, askUndo, working: working || busy, status: working ? r?.status ?? null : null, element };
}

/** Run `then` once a change this screen sent has finished (to read the server again). */
export function useAfterChange(status: string | null, then: () => void): void {
  const was = useRef<string | null>(null);
  useEffect(() => {
    if (was.current && !status) window.setTimeout(then, 1500);
    was.current = status;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);
}

export function Working({ status }: { status: string | null }): React.JSX.Element {
  return (
    <span className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
      <Spinner /> {status === 'approved' ? 'Waiting for the server…' : 'Working…'}
    </span>
  );
}

/** A change already prepared (by the agent, or anyone), shown exactly as it will run. */
export function previewOf(r: Remediation): Preview {
  const steps = r.plan?.steps ?? [];
  return {
    remediation_id: r.id,
    plan_hash: r.plan_hash,
    manageable: true,
    message: '',
    preview: {
      title: r.plain_title || r.title,
      what_changes: steps.map((s) => s.description),
      undo: steps.map((s) => s.rollback ?? '').filter(Boolean),
      disrupts: r.downtime,
      keeps: r.preconditions ?? [],
    },
  };
}

/** Start / Stop / Restart buttons for an app (container) or a service. */
export function RunControls({ target, running, compact = false }: { target: Target; running: boolean | null; compact?: boolean }): React.JSX.Element | null {
  const { can } = useMe();
  const flow = useChange();
  if (!can('analyst')) return null;
  const actionsFor: Array<'start' | 'stop' | 'restart'> = running === false ? ['start'] : running === true ? ['restart', 'stop'] : ['restart', 'start', 'stop'];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {flow.status && <Working status={flow.status} />}
      {!flow.status &&
        actionsFor.map((a) => (
          <Button
            key={a}
            size="sm"
            variant={a === 'stop' ? 'secondary' : compact ? 'ghost' : 'secondary'}
            disabled={flow.working}
            onClick={() => void flow.ask(() => runOp<Preview>('changes.request', { action: a, ...target }), `${VERB[a]} now`, a === 'stop')}
          >
            {VERB[a]}
          </Button>
        ))}
      {flow.element}
    </div>
  );
}

interface LogAnswer {
  ready: boolean;
  lines?: string[];
  error?: string;
  hints?: string[];
  at?: string;
}

/** The last lines of an app's (or a service's) log, read from the machine when asked. */
export function LogsView({ target, assetId }: { target: Target; assetId: string }): React.JSX.Element {
  useWatch(assetId);
  const [answer, setAnswer] = useState<LogAnswer | null>(null);
  const [loading, setLoading] = useState(false);
  const [follow, setFollow] = useState(false);
  const [filter, setFilter] = useState('');
  const box = useRef<HTMLPreElement>(null);
  const key = JSON.stringify(target);

  const load = async (): Promise<void> => {
    setLoading(true);
    try {
      const r = await runOp<{ request_id: string }>('logs.request', { ...target, lines: 300 }, { silent: true });
      for (let i = 0; i < 25; i++) {
        await new Promise((res) => window.setTimeout(res, 1200));
        const a = await runOp<LogAnswer>('logs.result', { request_id: r.request_id }, { silent: true });
        if (a.ready) {
          setAnswer(a);
          return;
        }
      }
      setAnswer({ ready: true, lines: [], error: "The server didn't answer in 30 seconds — is its monitor running?" });
    } catch (e) {
      setAnswer({ ready: true, lines: [], error: e instanceof Error ? e.message : 'Could not ask the server.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  // Following: ask again as soon as the last answer is in (≈ every 2–3 s while the server is watched).
  useEffect(() => {
    if (!follow || loading) return;
    const t = window.setTimeout(() => void load(), 1000);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [follow, key, loading, answer]);
  useEffect(() => {
    if (box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [answer]);

  const shown = (answer?.lines ?? []).filter((l) => !filter || l.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" loading={loading} onClick={() => void load()}>
          Refresh
        </Button>
        <label className="flex items-center gap-1.5 text-[13px]">
          <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow new lines
        </label>
        <div className="ml-auto w-full sm:w-56">
          <Input placeholder="Only lines with…" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter lines" />
        </div>
      </div>
      {answer?.hints && answer.hints.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-lg border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 text-[13px]">
          {answer.hints.map((h) => (
            <li key={h} className="flex gap-2">
              <Pill tone="warn">likely</Pill> {h}
            </li>
          ))}
        </ul>
      )}
      {answer?.error && <p className="text-[13px] text-red-700 dark:text-red-400">{answer.error}</p>}
      {!answer && loading && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> Asking the server…
        </p>
      )}
      {answer && !answer.error && (
        <pre ref={box} className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] p-3 font-mono text-[12px] leading-5">
          {shown.length ? shown.join('\n') : filter ? 'No line matches.' : 'The log is empty.'}
        </pre>
      )}
      <p className="text-[12px] text-[var(--agent-app-muted)]">
        {answer && !answer.error ? `Read from the server ${answer.at ? relTime(answer.at) : 'just now'}. ` : ''}Passwords, tokens and keys are hidden on the server before anything is sent; NetSentry doesn't keep logs.
      </p>
    </div>
  );
}

interface ChangeRow {
  id: string;
  purpose: string;
  title: string;
  status: string;
  requested_by: string;
  approved_by: string;
  created: string;
  result: string;
  undoable?: boolean;
  undo?: string[];
}

const STATUS_WORD: Record<string, { word: string; tone: 'good' | 'warn' | 'bad' | 'neutral' | 'info' }> = {
  done: { word: 'done', tone: 'good' },
  planned: { word: 'waiting for a person', tone: 'warn' },
  approved: { word: 'sent', tone: 'info' },
  executing: { word: 'running', tone: 'info' },
  verifying: { word: 'checking', tone: 'info' },
  failed: { word: "didn't work", tone: 'bad' },
  rolled_back: { word: "didn't work · put back", tone: 'bad' },
  cancelled: { word: 'cancelled', tone: 'neutral' },
  expired: { word: 'expired', tone: 'neutral' },
  rejected: { word: 'rejected', tone: 'neutral' },
  undone: { word: 'undone', tone: 'neutral' },
};

/** Every change made to an app or on a machine: who asked, who confirmed, what happened. */
/** What a change reported, in words: a monitor's structured note ({"backup": …, "size": …}) is summarised, never dumped. */
function resultWords(r: string): string {
  const t = r.trim();
  if (!t.startsWith('{')) return t;
  try {
    const o = JSON.parse(t) as Record<string, unknown>;
    if (typeof o['backup'] === 'string') {
      const size = typeof o['size'] === 'number' ? ` (${(o['size'] / 1e6).toFixed(o['size'] < 1e6 ? 2 : 0)} MB)` : '';
      return `copy saved: ${String(o['backup']).split('/').pop()}${size}`;
    }
    if (typeof o['note'] === 'string') return o['note'];
    return 'done';
  } catch {
    return t;
  }
}

export function ChangeHistory({ appId, assetId }: { appId?: string; assetId?: string }): React.JSX.Element {
  const { can } = useMe();
  const [all, setAll] = useState(false);
  const review = useChange();
  // v4 §16: the list follows the changes themselves (realtime), not a timer.
  const changes = useCollection<Remediation>('remediations', { filter: appId ? `app = "${appId}"` : assetId ? `asset = "${assetId}"` : 'id = ""', sort: '-updated' });
  const signature = changes.records.slice(0, 60).map((c) => c.id + c.status).join(',');
  const list = useOp<{ changes: ChangeRow[] }>('changes.list', appId ? { app_id: appId } : { asset_id: assetId ?? '' }, { deps: [signature, review.status] });
  const rows = list.data ? list.data.changes : list.error ? [] : null;
  if (rows === null) return <Spinner />;
  if (!rows.length) return <p className="text-[14px] text-[var(--agent-app-muted)]">No changes made through NetSentry yet.</p>;
  const shown = all ? rows : rows.slice(0, 10);
  return (
    <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
      {shown.map((r) => {
        const s = STATUS_WORD[r.status] ?? { word: r.status, tone: 'neutral' as const };
        return (
          <div key={r.id} className="flex flex-col gap-1 border-b border-[var(--agent-app-border)] px-4 py-3 last:border-b-0 sm:flex-row sm:items-center">
            <div className="min-w-0 flex-1 [overflow-wrap:anywhere]">
              <div className="text-[14px]">{r.title}</div>
              <div className="text-[12px] text-[var(--agent-app-muted)]">
                {relTime(r.created)} · asked by {r.requested_by || 'someone'}
                {r.approved_by && r.approved_by !== r.requested_by ? ` · confirmed by ${r.approved_by}` : r.approved_by ? ' · confirmed' : ''}
                {r.result && !/^(done|ok)\.?$/i.test(r.result.trim()) ? ` · ${resultWords(r.result)}` : ''}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {r.status === 'planned' && can('analyst') && (
                <Button
                  size="sm"
                  onClick={() => void review.ask(async () => previewOf(await getPbClient().pb.collection('remediations').getOne<Remediation>(r.id)), 'Confirm')}
                >
                  Review
                </Button>
              )}
              {r.undoable && can('admin') && (
                <Button size="sm" variant="ghost" onClick={() => review.askUndo({ id: r.id, title: r.title, words: r.undo ?? [] })}>
                  Undo
                </Button>
              )}
              <Pill tone={s.tone}>{s.word}</Pill>
            </div>
          </div>
        );
      })}
      {rows.length > 10 && (
        <button type="button" onClick={() => setAll((v) => !v)} className="min-h-[44px] w-full text-[13px] text-[var(--agent-app-muted)] hover:bg-[var(--agent-app-surface-2)]">
          {all ? 'Show fewer' : rows.length >= 50 ? 'Show the last 50' : `Show all ${rows.length}`}
        </button>
      )}
      {review.element}
    </div>
  );
}
