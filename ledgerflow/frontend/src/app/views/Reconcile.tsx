/**
 * Reconcile: prove each bank, card and loan account against its statement.
 * Enter the statement's date and closing balance, tick what the statement
 * shows (lines matched from imports are ticked already) until the
 * difference is zero, then finish: those entries are locked until the
 * reconciliation is undone.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, CircleCheck, ListChecks, Lock, Receipt, Scale, Undo2 } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { api, errMessage } from '../lib/api.ts';
import { day, money, monthEnd, toDecimal, today } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { go, setQuery } from '../lib/router.ts';
import { useApp, useReportScreen } from '../lib/store.tsx';
import type { ReconOverview, ReconState } from '../lib/types.ts';
import { Check, DateInput, Heading, MoneyInput, Stat } from '../components/controls.tsx';
import { Btn, Chip, Empty, Field, Menu, Modal, Seg, Spinner, useConfirm } from '../components/ui.tsx';

function AccountList({ list, selected }: { list: ReconOverview[]; selected: string }): React.JSX.Element {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto py-1">
      {list.map((o) => {
        const a = o.account;
        const active = a.id === selected;
        return (
          <button key={a.id} type="button" onClick={() => setQuery({ account: a.id }, false)} className={cn('relative flex w-full flex-col gap-0.5 border-b border-[var(--lf-hair)] px-3 py-2 text-left transition-colors', active ? 'bg-[var(--lf-row-hover)]' : 'hover:bg-[var(--lf-row)]')}>
            {active && <span aria-hidden className="absolute bottom-1 left-0 top-1 w-0.5 rounded-r bg-[var(--lf-accent)]" />}
            <span className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-semibold">{a.name}</span>
              {o.open !== null && <Chip tone="accent">In progress</Chip>}
            </span>
            <span className="flex items-center gap-2 text-[11.5px] text-[var(--lf-muted)]">
              <span className="min-w-0 flex-1 truncate">{o.last !== null ? 'Reconciled to ' + day(o.last.statement_date, true) : 'Never reconciled'}</span>
              {o.unreconciled > 0 && <span className="num">{o.unreconciled} open</span>}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function StartForm({ o, onStarted }: { o: ReconOverview; onStarted: () => void }): React.JSX.Element {
  const app = useApp();
  const a = o.account;
  const ccy = a.currency || app.home;
  const sign = a.type === 'liability' ? -1 : 1;
  const [date, setDate] = useState('');
  const [bal, setBal] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDate(o.hint?.date || monthEnd(today().slice(0, 8) + '01'));
    setBal(o.hint !== null ? toDecimal(sign * o.hint.balance, ccy) : '');
  }, [o.account.id, o.hint, sign, ccy]);
  const history = useLive(() => api.reconList(a.id), ['reconciliations'], [a.id]);
  const [confirmEl, confirm] = useConfirm();
  const start = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.reconStart(a.id, date, bal || '0');
      onStarted();
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const done = (history.data?.reconciliations ?? []).filter((r) => r.status !== 'open');
  const latest = done.find((r) => r.status === 'finished');
  return (
    <div className="h-full overflow-y-auto">
      {confirmEl}
      <div className="max-w-[560px] px-5 py-5">
        <p className="text-[15px] font-bold">{a.name}</p>
        <p className="mt-0.5 text-[12.5px] text-[var(--lf-muted)]">
          {o.last !== null ? 'Last reconciled to ' + day(o.last.statement_date) + '. ' : ''}
          Book balance {money(sign * o.balance_ccy, ccy)}
          {a.type === 'liability' ? ' owed' : ''}. {o.inbox > 0 ? o.inbox + ' bank line' + (o.inbox === 1 ? '' : 's') + ' still in the inbox.' : ''}
        </p>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Statement date">
            <DateInput value={date} onChange={setDate} />
          </Field>
          <Field label={a.type === 'liability' ? 'Statement balance owed' : 'Statement closing balance'} hint={o.hint !== null ? 'From ' + (o.hint.file_name || 'the imported statement') : undefined}>
            <MoneyInput value={bal} onChange={setBal} />
          </Field>
        </div>
        <div className="mt-3 flex items-center gap-2">
          <Btn variant="primary" icon={Scale} loading={busy} onClick={() => void start()} disabled={date === ''}>
            Start reconciling
          </Btn>
          {o.inbox > 0 && (
            <Btn variant="ghost" onClick={() => go('inbox', { account: a.id })}>
              Review the inbox first
            </Btn>
          )}
        </div>
        {done.length > 0 && (
          <div className="mt-8">
            <Heading>History</Heading>
            <table className="lf-table">
              <thead>
                <tr>
                  <th className="pl-0">Statement date</th>
                  <th className="r">Balance</th>
                  <th className="r">Entries</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {done.map((r) => (
                  <tr key={r.id} className={r.status === 'undone' ? 'opacity-50' : ''}>
                    <td className="num pl-0">{day(r.statement_date)}</td>
                    <td className="r num">{money(sign * r.statement_balance, ccy)}</td>
                    <td className="r num">{r.cleared_count}</td>
                    <td className="r">
                      {r.status === 'undone' ? (
                        <Chip>Undone</Chip>
                      ) : r.id === latest?.id ? (
                        <Btn
                          size="xs"
                          variant="ghost"
                          icon={Undo2}
                          onClick={() =>
                            void confirm('Its entries become editable again and the account needs reconciling to this date again.', 'Undo the reconciliation to ' + day(r.statement_date) + '?', 'Undo').then((ok) => {
                              if (ok)
                                api
                                  .reconUndo(r.id)
                                  .then(() => toast.success('Reconciliation undone'))
                                  .catch((err: unknown) => toast.error(errMessage(err)));
                            })
                          }
                        >
                          Undo
                        </Btn>
                      ) : (
                        <Lock size={12} className="ml-auto text-[var(--lf-muted)]" />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function Session({ st }: { st: ReconState }): React.JSX.Element {
  const app = useApp();
  const s = st.session;
  const ccy = st.currency;
  const sign = st.sign;
  const [show, setShow] = useState<'all' | 'open'>('all');
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(false);
  const [date, setDate] = useState(s.statement_date);
  const [bal, setBal] = useState(toDecimal(sign * s.statement_balance, ccy));
  const [adjust, setAdjust] = useState(false);
  const rows = useMemo(() => (show === 'open' ? st.rows.filter((r) => !r.cleared) : st.rows), [st.rows, show]);
  const allTicked = st.rows.length > 0 && st.rows.every((r) => r.cleared);
  const toggle = (ids: string[], on: boolean): void => {
    if (ids.length === 0) return;
    api.reconToggle(s.id, ids, on).catch((err: unknown) => toast.error(errMessage(err)));
  };
  const finish = async (withAdjust: boolean): Promise<void> => {
    setBusy(true);
    try {
      await api.reconFinish(s.id, withAdjust);
      toast.success('Reconciled to ' + day(s.statement_date));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy(false);
    }
  };
  const zero = st.difference === 0;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="grid shrink-0 grid-cols-2 border-b border-[var(--lf-line)] sm:grid-cols-5">
        <Stat icon={CalendarDays} label="Statement date">{day(s.statement_date)}</Stat>
        <Stat icon={Receipt} label={sign < 0 ? 'Statement owed' : 'Statement balance'}>{money(sign * st.statement_balance, ccy)}</Stat>
        <Stat icon={CircleCheck} label="Cleared balance">{money(sign * st.cleared_balance, ccy)}</Stat>
        <Stat icon={ListChecks} label="Ticked">
          <span className="num">{st.cleared_count}</span>
          <span className="ml-1 text-[11.5px] font-semibold text-[var(--lf-muted)]">of {st.rows.length}</span>
          <span className="mt-1 block h-[5px] w-full max-w-[160px] overflow-hidden rounded-full bg-[var(--lf-row-hover)]">
            <span className="block h-full rounded-full bg-[var(--lf-pos)] transition-[width]" style={{ width: `${st.rows.length ? (st.cleared_count / st.rows.length) * 100 : 0}%` }} />
          </span>
        </Stat>
        <Stat icon={Scale} label="Difference" tone={zero ? 'pos' : 'neg'}>
          <span className="flex items-center gap-1.5">
            {zero && <CircleCheck size={15} />}
            {money(sign * st.difference, ccy)}
          </span>
        </Stat>
      </div>
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-[var(--lf-line)] px-3">
        <Seg
          size="xs"
          value={show}
          onChange={setShow}
          options={[
            { value: 'all', label: 'All' },
            { value: 'open', label: 'Not ticked' },
          ]}
        />
        <span className="hidden text-[12px] text-[var(--lf-muted)] md:inline">Tick each entry that is on the statement. Matched bank lines are ticked already.</span>
        <span className="flex-1" />
        <Btn size="sm" variant="ghost" onClick={() => setEdit(true)}>
          Statement
        </Btn>
        <Menu
          align="right"
          trigger={(_, t) => (
            <Btn size="sm" variant="ghost" onClick={t}>
              More
            </Btn>
          )}
          items={[
            { label: 'Finish with an adjustment', disabled: zero, onClick: () => setAdjust(true) },
            { label: 'Stop reconciling', onClick: () => void api.reconCancel(s.id).catch((err: unknown) => toast.error(errMessage(err))) },
          ]}
        />
        <Btn variant="primary" size="sm" icon={Lock} loading={busy} disabled={!zero} title={zero ? undefined : 'The difference must be zero'} onClick={() => void finish(false)}>
          Finish
        </Btn>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {rows.length === 0 ? (
          <Empty icon={Scale} title={show === 'open' ? 'Everything is ticked' : 'No entries to the statement date'} />
        ) : (
          <table className="lf-table">
            <thead>
              <tr>
                <th className="w-8 pr-0">
                  <Check checked={allTicked} indeterminate={!allTicked && st.cleared_count > 0} onChange={(v) => toggle(st.rows.filter((r) => r.cleared !== v && !(r.matched && !v)).map((r) => r.posting), v)} label="Tick all" />
                </th>
                <th className="w-[92px]">Date</th>
                <th>Description</th>
                <th className="r w-[120px]">{sign < 0 ? 'Payments' : 'Money in'}</th>
                <th className="r w-[120px]">{sign < 0 ? 'Charges' : 'Money out'}</th>
                <th className="w-[80px]" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.posting} data-click="true" data-sel={r.cleared} onClick={() => (r.matched && r.cleared ? undefined : toggle([r.posting], !r.cleared))}>
                  <td className="pr-0">
                    <Check checked={r.cleared} onChange={(v) => toggle([r.posting], v)} label="Ticked" />
                  </td>
                  <td className="num text-[var(--lf-ink-2)]">{day(r.date, true)}</td>
                  <td className="max-w-0 truncate">
                    {r.narration}
                    {r.contact !== '' && <span className="ml-2 text-[12px] text-[var(--lf-muted)]">{app.contactName(r.contact)}</span>}
                  </td>
                  <td className="r num">{r.amount > 0 ? money(r.amount, ccy, { symbol: false }) : ''}</td>
                  <td className="r num">{r.amount < 0 ? money(-r.amount, ccy, { symbol: false }) : ''}</td>
                  <td>{r.matched && <Chip>Matched</Chip>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {st.later_cleared > 0 && <div className="shrink-0 border-t border-[var(--lf-line)] px-3 py-1.5 text-[11.5px] text-[var(--lf-muted)]">{st.later_cleared} cleared entries are dated after the statement and belong to the next one.</div>}
      {edit && (
        <Modal
          open
          width="sm"
          title="Statement"
          onClose={() => setEdit(false)}
          footer={
            <>
              <Btn onClick={() => setEdit(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setEdit(false);
                  api.reconStart(s.account, date, bal || '0').catch((err: unknown) => toast.error(errMessage(err)));
                }}
              >
                Save
              </Btn>
            </>
          }
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Statement date">
              <DateInput value={date} onChange={setDate} />
            </Field>
            <Field label={sign < 0 ? 'Balance owed' : 'Closing balance'}>
              <MoneyInput value={bal} onChange={setBal} />
            </Field>
          </div>
        </Modal>
      )}
      {adjust && (
        <Modal
          open
          width="sm"
          title="Finish with an adjustment?"
          description={'An entry of ' + money(Math.abs(st.difference), ccy) + ' to Suspense makes the books match the statement. Find the real cause later and move it from Suspense.'}
          onClose={() => setAdjust(false)}
          footer={
            <>
              <Btn onClick={() => setAdjust(false)}>Cancel</Btn>
              <Btn
                variant="primary"
                onClick={() => {
                  setAdjust(false);
                  void finish(true);
                }}
              >
                Adjust and finish
              </Btn>
            </>
          }
        >
          <span />
        </Modal>
      )}
    </div>
  );
}

export function ReconcileView({ q }: { q: Record<string, string> }): React.JSX.Element {
  const over = useLive(() => api.reconOverview(), ['reconciliations', 'postings', 'statement_lines', 'statement_imports'], [], 300);
  const list = useMemo(() => (over.data?.accounts ?? []).filter((o) => o.account.subtype !== 'clearing' || o.unreconciled > 0), [over.data]);
  const selected = q['account'] ?? list[0]?.account.id ?? '';
  const o = list.find((x) => x.account.id === selected);
  const state = useLive(() => (selected ? api.reconGet({ account: selected }) : Promise.resolve(null)), ['reconciliations', 'postings'], [selected], 200);
  useReportScreen('reconcile', selected ? { type: 'account', id: selected } : null);
  return (
    <div className="flex h-full min-h-0">
      <aside className="hidden w-[250px] shrink-0 flex-col border-r border-[var(--lf-line)] md:flex">
        <AccountList list={list} selected={selected} />
      </aside>
      <section className="min-w-0 flex-1">
        {over.loading && over.data === null ? (
          <div className="flex h-24 items-center justify-center">
            <Spinner />
          </div>
        ) : o === undefined ? (
          <Empty icon={Scale} title="No accounts to reconcile">
            Bank, card, cash and loan accounts show here.
          </Empty>
        ) : state.data?.state ? (
          <Session st={state.data.state} />
        ) : (
          <StartForm o={o} onStarted={() => state.reload()} />
        )}
      </section>
    </div>
  );
}
