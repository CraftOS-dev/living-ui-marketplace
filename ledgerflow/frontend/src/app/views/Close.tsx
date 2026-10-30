/**
 * Close: month by month, the checks an accountant runs before calling a
 * month done (inbox empty, nothing uncategorized, accounts reconciled,
 * drafts and receipts dealt with, duplicates, overdue invoices), the
 * person's own checklist, and the AI agent's preparation note. Closing a
 * month can lock the books through its last day.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, CircleAlert, CircleCheck, Info, Lock, LockOpen, Sparkles, TriangleAlert } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { ago, day, monthName } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import type { View } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { Check as CheckRow, Period } from '../lib/types.ts';
import { Check, DateInput, Heading } from '../components/controls.tsx';
import { Btn, Chip, Empty, Field, Modal, Spinner, Toggle, area } from '../components/ui.tsx';

const ICON = { ok: CircleCheck, warn: TriangleAlert, fail: CircleAlert, info: Info };
const TONE = { ok: 'text-[var(--lf-pos)]', warn: 'text-[var(--lf-warn)]', fail: 'text-[var(--lf-neg)]', info: 'text-[var(--lf-muted)]' };

function goTo(c: CheckRow): void {
  if (c.go === null) return;
  const g = c.go as Record<string, string | boolean>;
  const view = String(g['view'] ?? 'inbox') as View;
  const q: Record<string, string> = {};
  for (const [k, v] of Object.entries(g)) if (k !== 'view' && v !== undefined && v !== false) q[k] = String(v);
  if (view === 'ledger' && q['dupes'] !== undefined) {
    go('ledger');
    return;
  }
  go(view, q);
}

function Locks(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const [edit, setEdit] = useState(false);
  const [lock, setLock] = useState(s?.lock_date ?? '');
  const [agent, setAgent] = useState(s?.agent_lock_date ?? '');
  useEffect(() => {
    setLock(s?.lock_date ?? '');
    setAgent(s?.agent_lock_date ?? '');
  }, [s?.lock_date, s?.agent_lock_date]);
  return (
    <div className="border-t border-[var(--lf-line)] px-3 py-3">
      <Heading
        action={
          <Btn size="xs" variant="ghost" onClick={() => setEdit(true)}>
            Change
          </Btn>
        }
      >
        Lock dates
      </Heading>
      <p className="flex items-center gap-1.5 text-[12px]">
        <Lock size={12} className="text-[var(--lf-muted)]" /> Books {s?.lock_date ? 'locked to ' + day(s.lock_date) : 'not locked'}
      </p>
      <p className="mt-1 flex items-center gap-1.5 text-[12px]">
        <Sparkles size={12} className="text-[var(--lf-accent-text)]" /> AI agent {s?.agent_lock_date ? 'locked to ' + day(s.agent_lock_date) : 'not locked'}
      </p>
      {edit && (
        <Modal
          open
          width="sm"
          title="Lock dates"
          description="Nobody changes entries dated on or before the books lock date. The AI agent cannot change anything on or before its own lock date; it proposes instead."
          onClose={() => setEdit(false)}
          footer={
            <>
              <Btn onClick={() => setEdit(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setEdit(false);
                  api
                    .setLocks({ lock_date: lock, agent_lock_date: agent })
                    .then(() => toast.success('Lock dates saved'))
                    .catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Save
              </Btn>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Books locked through" hint="Empty for none">
              <DateInput value={lock} onChange={setLock} />
            </Field>
            <Field label="AI agent locked through" hint="Empty for none">
              <DateInput value={agent} onChange={setAgent} />
            </Field>
          </div>
        </Modal>
      )}
    </div>
  );
}

function PeriodPane({ p }: { p: Period }): React.JSX.Element {
  const [notes, setNotes] = useState(p.notes);
  const [sign, setSign] = useState(false);
  const [lock, setLock] = useState(true);
  const [busy, setBusy] = useState(false);
  useEffect(() => setNotes(p.notes), [p.id, p.notes]);
  const checks = p.checks ?? [];
  const failing = checks.filter((c) => c.status === 'fail');
  const warnings = checks.filter((c) => c.status === 'warn');
  const manualDone = p.manual.filter((m) => p.checklist[m.key]).length;
  const closed = p.status === 'closed';
  const agentBusy = p.agent_state === 'waiting' || p.agent_state === 'working';
  const askAgent = (): void => {
    api
      .requestReview(p.period)
      .then((r) => toast.success(r.asked ? 'Your AI agent is preparing ' + monthName(p.period) : 'Queued for your AI agent' + (r.reason ? ' (' + r.reason + ')' : '')))
      .catch((err: unknown) => toast.error(errMessage(err)));
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-11 shrink-0 flex-wrap items-center gap-2 border-b border-[var(--lf-line)] px-4 py-1.5">
        <p className="text-[14px] font-bold">{monthName(p.period)}</p>
        {closed ? <Chip tone="pos">Closed {p.signed_off_at ? ago(p.signed_off_at) : ''}</Chip> : failing.length > 0 ? <Chip tone="neg">{failing.length} to fix</Chip> : warnings.length > 0 ? <Chip tone="warn">{warnings.length} to check</Chip> : <Chip tone="pos">Ready</Chip>}
        {p.locked && (
          <Chip>
            <Lock size={10} /> Locked
          </Chip>
        )}
        <span className="flex-1" />
        {!closed && (
          <Btn size="sm" icon={Sparkles} onClick={askAgent} disabled={agentBusy}>
            {agentBusy ? 'AI is preparing' : 'Ask AI to prepare'}
          </Btn>
        )}
        {closed ? (
          <Btn
            size="sm"
            icon={LockOpen}
            loading={busy}
            onClick={() => {
              setBusy(true);
              api
                .reopen(p.period)
                .then(() => toast.success(monthName(p.period) + ' reopened'))
                .catch((err: unknown) => toast.error(errMessage(err)))
                .finally(() => setBusy(false));
            }}
          >
            Reopen
          </Btn>
        ) : (
          <Btn size="sm" variant="primary" icon={Lock} onClick={() => setSign(true)}>
            Close month
          </Btn>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto">
        {(p.agent_state !== '' || p.agent_note !== '') && (
          <div className={cn('mx-4 mt-3 rounded-[6px] border px-3 py-2.5', p.agent_state === 'failed' ? 'border-[var(--lf-line)]' : 'border-[var(--lf-accent)] bg-[var(--lf-accent-soft)]')}>
            <div className="flex items-center gap-2 text-[12px] font-bold text-[var(--lf-accent-text)]">
              <Sparkles size={12} className={agentBusy ? 'lf-pulse' : ''} />
              {agentBusy ? (p.agent_state === 'working' ? 'Your AI agent is working through the checks' : 'Waiting for your AI agent') : p.agent_state === 'failed' ? 'The AI review stopped' : 'Prepared by your AI agent ' + ago(p.agent_at)}
            </div>
            {p.agent_note !== '' && <p className="lf-prose mt-1.5 text-[12.5px] leading-[18px] text-[var(--lf-ink)]">{p.agent_note}</p>}
          </div>
        )}
        <div className="flex items-center gap-3 px-4 pt-3">
          <Heading>Checks</Heading>
          <span className="lf-grow-x flex h-[6px] w-[160px] shrink-0 gap-[2px] overflow-hidden rounded-full">
            {checks.map((c) => (
              <span key={c.key} title={c.label} className="h-full flex-1" style={{ background: c.status === 'ok' ? 'var(--lf-pos)' : c.status === 'fail' ? 'var(--lf-neg)' : c.status === 'warn' ? 'var(--lf-warn)' : 'var(--lf-line)' }} />
            ))}
          </span>
          <span className="num text-[11.5px] text-[var(--lf-muted)]">
            <b className="text-[var(--lf-ink)]">{checks.filter((c) => c.status === 'ok').length}</b> of {checks.length} pass
          </span>
        </div>
        <div>
          {checks.map((c) => {
            const Icon = ICON[c.status];
            return (
              <div key={c.key} className="flex items-start gap-3 border-b border-[var(--lf-hair)] px-4 py-2">
                <Icon size={15} className={cn('mt-0.5 shrink-0', TONE[c.status])} />
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-semibold">{c.label}</p>
                  <p className="text-[12px] text-[var(--lf-muted)]">{c.detail}</p>
                </div>
                {c.status !== 'ok' && c.go !== null && (
                  <Btn size="xs" variant="ghost" onClick={() => goTo(c)}>
                    Open <ArrowRight size={12} />
                  </Btn>
                )}
              </div>
            );
          })}
        </div>
        <div className="px-4 pt-4">
          <Heading>
            Your checklist · {manualDone}/{p.manual.length}
          </Heading>
          {p.manual.map((m) => (
            <label key={m.key} className="flex min-h-8 items-center gap-2.5 border-b border-[var(--lf-hair)] text-[12.5px]">
              <Check checked={Boolean(p.checklist[m.key])} onChange={(v) => void api.tick(p.period, { item: m.key, done: v }).catch((err: unknown) => toast.error(errMessage(err)))} label={m.label} />
              <span className={cn(p.checklist[m.key] && 'text-[var(--lf-muted)] line-through')}>{m.label}</span>
            </label>
          ))}
          <div className="mt-3">
            <Field label="Notes for this month">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                onBlur={() => {
                  if (notes !== p.notes) api.tick(p.period, { notes }).catch((err: unknown) => toast.error(errMessage(err)));
                }}
                rows={3}
                className={area}
                placeholder="Anything to remember, e.g. waiting for a supplier credit note"
              />
            </Field>
          </div>
        </div>
        <div className="h-6" />
      </div>
      {sign && (
        <Modal
          open
          width="sm"
          title={'Close ' + monthName(p.period) + '?'}
          description={failing.length > 0 ? failing.length + ' check' + (failing.length === 1 ? ' is' : 's are') + ' failing: ' + failing.map((f) => f.label.toLowerCase()).join('; ') + '. You can still close it.' : 'Every check passes.'}
          onClose={() => setSign(false)}
          footer={
            <>
              <Btn onClick={() => setSign(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                loading={busy}
                onClick={() => {
                  setBusy(true);
                  api
                    .signOff(p.period, lock, failing.length > 0)
                    .then(() => {
                      toast.success(monthName(p.period) + ' closed');
                      setSign(false);
                    })
                    .catch((err: unknown) => toast.error(errMessage(err)))
                    .finally(() => setBusy(false));
                }}
              >
                {failing.length > 0 ? 'Close anyway' : 'Close'}
              </Btn>
            </>
          }
        >
          <label className="flex items-center gap-2 text-[12.5px]">
            <Toggle checked={lock} onChange={setLock} label="Lock the books" />
            Lock the books through {day(p.to)}
          </label>
        </Modal>
      )}
    </div>
  );
}

export function CloseView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const list = useLive(() => api.periods(), ['periods', 'settings', 'statement_lines'], [], 400);
  const periods = list.data?.periods ?? [];
  const last = periods.find((p) => p.status !== 'closed' && p.to < new Date().toISOString().slice(0, 10)) ?? periods[0];
  const sel = q['period'] ?? last?.period ?? '';
  const live = useLive(() => (sel ? api.period(sel) : Promise.resolve(null)), ['periods', 'statement_lines', 'transactions', 'postings', 'reconciliations', 'documents', 'files', 'settings'], [sel], 500);
  useReportScreen('close', sel ? { type: 'period', id: sel } : null);
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[230px] shrink-0 flex-col border-r border-[var(--lf-line)] md:flex">
        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {periods.map((p) => (
            <button key={p.period} type="button" onClick={() => setQuery({ period: p.period }, false)} className={cn('relative flex w-full items-center gap-2 px-3 py-2 text-left transition-colors', p.period === sel ? 'bg-[var(--lf-row-hover)]' : 'hover:bg-[var(--lf-row)]')}>
              {p.period === sel && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
              <span className="min-w-0 flex-1">
                <span className="block text-[12.5px] font-semibold">{monthName(p.period)}</span>
                <span className="block text-[11.5px] text-[var(--lf-muted)]">{p.status === 'closed' ? 'Closed' : p.inbox > 0 ? p.inbox + ' in the inbox' : 'Open'}</span>
              </span>
              {p.agent_state === 'waiting' || p.agent_state === 'working' ? <Sparkles size={12} className="lf-pulse text-[var(--lf-accent-text)]" /> : null}
              {p.locked ? <Lock size={12} className="text-[var(--lf-muted)]" /> : p.status === 'closed' ? <CircleCheck size={13} className="text-[var(--lf-pos)]" /> : null}
            </button>
          ))}
        </div>
        <Locks />
      </aside>
      <section className="min-w-0 flex-1">
        {live.data?.period ? (
          <PeriodPane p={live.data.period} />
        ) : sel === '' ? (
          <Empty icon={CircleCheck} title="No months yet">
            Months appear once the books have entries.
          </Empty>
        ) : (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        )}
      </section>
    </div>
  );
}
