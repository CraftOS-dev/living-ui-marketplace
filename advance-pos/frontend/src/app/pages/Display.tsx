/**
 * The customer display: a second screen facing the customer (a tablet or
 * a monitor), following one register. It shows the sale as it is rung up,
 * the total to pay, and the change and a thank-you when it is paid. It
 * needs no one signed in and shows nothing but that register's sale.
 */
import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api.ts';
import { money as moneyOf, qty as qtyText, time } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { Mark } from '../components/Shell.tsx';
import { Select } from '../components/ui.tsx';
import { replaceQuery } from '../lib/router.ts';
import type { SetupStatus } from '../lib/types.ts';

function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 15000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function ChooseRegister(): React.JSX.Element {
  const [setup, setSetup] = useState<SetupStatus | null>(null);
  useEffect(() => {
    void api
      .setupStatus()
      .then(setSetup)
      .catch(() => undefined);
  }, []);
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--ps-shell)] px-4">
      <div className="flex w-full max-w-xs flex-col items-center gap-4 text-center">
        <Mark size={40} />
        <h1 className="text-[15px] font-bold">Customer display</h1>
        <div className="w-full">
          <Select
            label="Show the sale of"
            value=""
            onChange={(id) => {
              replaceQuery('display', { register: id });
              window.location.reload();
            }}
            options={[{ value: '', label: 'Choose a register' }, ...(setup?.registers ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          />
        </div>
      </div>
    </div>
  );
}

export function DisplayPage({ register }: { register: string }): React.JSX.Element {
  const now = useNow();
  const state = useLive(() => (register === '' ? Promise.resolve(null) : api.display(register)), ['registers', 'orders', 'order_lines', 'payments'], [register], 120);
  const list = useRef<HTMLUListElement | null>(null);
  const d = state.data;
  const lineCount = d?.order?.lines.length ?? 0;
  useEffect(() => {
    // Keep the newest line in view.
    const el = list.current;
    if (el !== null) el.scrollTop = el.scrollHeight;
  }, [lineCount]);

  if (register === '') return <ChooseRegister />;
  if (d === null) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--ps-shell)]">
        {state.error !== null ? <p className="text-[13px] text-[var(--ps-muted)]">{state.error}</p> : <span aria-label="Loading" className="size-5 animate-spin rounded-full border-2 border-[var(--ps-ink)] border-t-transparent" />}
      </div>
    );
  }
  const m = moneyOf(d.currency, d.currency_digits);
  const o = d.order;
  const thanks = d.message !== null && d.message.kind === 'thanks' && (o === null || o.status === 'paid');
  const brand = (
    <div className="flex items-center gap-3">
      {d.logo !== '' ? <img src={d.logo} alt="" className="max-h-12 max-w-[160px] object-contain" /> : <Mark size={36} />}
      <span className="text-[15px] font-bold">{d.store}</span>
    </div>
  );

  if (thanks) {
    const change = d.message?.change ?? 0;
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-[var(--ps-shell)] px-6 text-center">
        {brand}
        <p className="text-[26px] font-bold">Thank you!</p>
        {change > 0 && (
          <div className="ps-on-dark rounded-[var(--ps-r-lg)] bg-[var(--ps-dark)] px-10 py-6 text-[var(--ps-on-dark)]">
            <p className="text-[13px] font-semibold text-[var(--ps-on-dark-muted)]">Your change</p>
            <p className="num text-[26px] font-bold leading-8 tracking-tight">{m.fmt(change)}</p>
          </div>
        )}
        {o !== null && o.customer !== null && <p className="text-[13px] text-[var(--ps-muted)]">{o.customer.name}, you have {o.customer.points} points</p>}
      </div>
    );
  }

  if (o === null || o.lines.length === 0) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--ps-shell)] px-6 text-center">
        {brand}
        <p className="num text-[26px] font-bold leading-8 tracking-tight">{time(now)}</p>
        <p className="text-[15px] text-[var(--ps-muted)]">Welcome</p>
      </div>
    );
  }

  return (
    <div className="grid min-h-screen bg-[var(--ps-shell)] md:grid-cols-[1fr_minmax(320px,420px)]">
      <section className="flex min-h-0 flex-col p-6">
        {brand}
        <ul ref={list} className="mt-6 min-h-0 flex-1 divide-y divide-[var(--ps-hair)] overflow-y-auto rounded-[var(--ps-r-lg)] border border-[var(--ps-line)] bg-[var(--ps-card)]">
          {o.lines.map((l, i) => (
            <li key={i} className="flex items-start gap-3 px-4 py-3">
              <span className="num w-10 shrink-0 text-[15px] font-bold text-[var(--ps-ink-2)]">{qtyText(Math.abs(l.qty))}</span>
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold">{l.qty < 0 ? 'Return: ' + l.name : l.name}</span>
                {l.options.length > 0 && <span className="block text-[13px] text-[var(--ps-muted)]">{l.options.join(', ')}</span>}
                {l.discount > 0 && <span className="block text-[13px] text-[var(--ps-green-text)]">You save {m.fmt(l.discount)}</span>}
              </span>
              <span className="num shrink-0 text-[15px] font-semibold">{m.fmt(l.total)}</span>
            </li>
          ))}
        </ul>
      </section>
      <aside className="ps-on-dark flex flex-col justify-end gap-2 bg-[var(--ps-dark)] p-8 text-[var(--ps-on-dark)]">
        {o.customer !== null && <p className="mb-auto text-[15px] font-semibold">Hello, {o.customer.name}</p>}
        <div className="flex justify-between text-[15px]">
          <span className="text-[var(--ps-on-dark-muted)]">Subtotal</span>
          <span className="num">{m.fmt(o.subtotal)}</span>
        </div>
        {o.discount_total > 0 && (
          <div className="flex justify-between text-[15px]">
            <span className="text-[var(--ps-on-dark-muted)]">You save</span>
            <span className="num">{m.fmt(-o.discount_total)}</span>
          </div>
        )}
        <div className="flex justify-between text-[15px]">
          <span className="text-[var(--ps-on-dark-muted)]">Tax</span>
          <span className="num">{m.fmt(o.tax_total)}</span>
        </div>
        {o.tip > 0 && (
          <div className="flex justify-between text-[15px]">
            <span className="text-[var(--ps-on-dark-muted)]">Tip</span>
            <span className="num">{m.fmt(o.tip)}</span>
          </div>
        )}
        {o.paid_total !== 0 && (
          <div className="flex justify-between text-[15px]">
            <span className="text-[var(--ps-on-dark-muted)]">Paid</span>
            <span className="num">{m.fmt(o.paid_total)}</span>
          </div>
        )}
        <div className="mt-3 border-t border-[var(--ps-dark-2)] pt-4">
          <p className="text-[15px] font-semibold text-[var(--ps-on-dark-muted)]">{o.balance < 0 ? 'Refund' : o.paid_total !== 0 ? 'Left to pay' : 'Total'}</p>
          <p className="num text-[26px] font-bold leading-8 tracking-tight">{m.fmt(Math.abs(o.balance))}</p>
        </div>
      </aside>
    </div>
  );
}
