/**
 * Advances: money paid before it is spent. The list (what is asked, what to
 * pay, what is still to settle), one advance with its settlements, and the
 * dialog to ask for one. Finance pays it with a reference and records a
 * repayment; claims settle the rest by themselves.
 */
import { useState } from 'react';
import { Ban, HandCoins, Undo2, Wallet } from 'lucide-react';
import { Money, Button, DataTable, DayPicker, Dialog, Empty, FactStrip, Field, Input, LoadError, Loading, MoneyInput, Notice, PageBody, PageHeader, Panel, Segmented, Select, StatTile, majorParam, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { AdvanceStatus, tripName, PhoneActions } from '../../components/expenses/parts.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { ago, fmtDay, fmtRange, today } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, patch, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { Steps } from './Claim.tsx';
import type { Advance, AdvanceDetail, Trip } from './types.ts';
import { READS } from './types.ts';

/** Ask for an advance (for yourself, or as HR for --employment). */
export function AdvanceDialog({ currency, employment, trips, travel, onClose }: { currency: string; employment: string; trips: Trip[]; travel?: string | undefined; onClose: () => void }): React.JSX.Element {
  const [amount, setAmount] = useState<number | null>(null);
  const [purpose, setPurpose] = useState('');
  const [trip, setTrip] = useState(travel ?? '');
  const [neededBy, setNeededBy] = useState('');
  const [busy, setBusy] = useState(false);
  const ready = amount !== null && amount > 0 && purpose.trim() !== '';
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.adv.ask')}
      width={480}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={HandCoins}
            busy={busy}
            disabled={!ready}
            onClick={() => {
              setBusy(true);
              void op<{ advance: Advance }>('advances.request', { employment, amount: majorParam(amount, currency), purpose: purpose.trim(), travel: trip === '' ? undefined : trip, needed_by: neededBy === '' ? undefined : neededBy })
                .then((r) => {
                  changed(...READS);
                  toast.success(t('exp.adv.asked', { n: r.advance.number }), { label: t('exp.open'), run: () => navigate(`/expenses/advances/${r.advance.number}`) });
                  onClose();
                })
                .catch(() => setBusy(false));
            }}
          >
            {t('exp.adv.send')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('exp.f.amount')}>
          <MoneyInput value={amount} onChange={setAmount} currency={currency} label={t('exp.f.amount')} autoFocus />
        </Field>
        <Field label={t('exp.f.purpose')}>
          <Input value={purpose} onChange={(e) => setPurpose(e.target.value)} aria-label={t('exp.f.purpose')} placeholder={t('exp.adv.purpose_ph')} />
        </Field>
        {trips.length > 0 && (
          <Field label={t('exp.f.trip')} optional>
            <Select value={trip} onChange={(e) => setTrip(e.target.value)} aria-label={t('exp.f.trip')}>
              <option value="">{t('exp.f.no_trip')}</option>
              {trips.map((x) => (
                <option key={x.id} value={x.number}>
                  {`${tripName(x)} · ${fmtRange(x.from_day, x.to_day)}`}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={t('exp.f.needed_by')} optional>
          <DayPicker value={neededBy} onChange={setNeededBy} label={t('exp.f.needed_by')} clearable />
        </Field>
      </div>
    </Dialog>
  );
}

const PAGE = 50;

export function AdvancesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const status = query.get('status') ?? 'open';
  const [limit, setLimit] = useState(PAGE);
  const [asking, setAsking] = useState(false);
  const live = useOp<{ advances: Advance[]; total: number; totals: { currency: string; outstanding_minor: number; to_pay_minor: number }[]; view: string }>('advances.list', { status, entity: entity === '' ? undefined : entity, limit }, READS, { name: 'advances.list' });
  const d = live.data;
  const cols: Column<Advance>[] = [
    { key: 'number', label: t('exp.col.number'), width: '100px', mono: true, sort: (a) => a.number, render: (a) => a.number },
    { key: 'person', label: t('exp.col.person'), width: 'minmax(150px,1.4fr)', phone: 'title', sort: (a) => a.employee_name, render: (a) => a.employee_name },
    { key: 'purpose', label: t('exp.col.purpose'), width: 'minmax(160px,2fr)', render: (a) => <span className="truncate">{a.purpose}</span> },
    { key: 'pay', label: t('exp.col.pay_via'), width: '110px', hideBelow: 'lg', phone: 'hide', render: (a) => (a.pay_via === 'payroll' ? t('exp.pay_via.payroll') : t('exp.pay_via.bank')) },
    { key: 'status', label: t('exp.col.status'), width: '120px', sort: (a) => a.status, render: (a) => <AdvanceStatus a={a} /> },
    { key: 'amount', label: t('exp.col.amount'), width: '120px', align: 'right', mono: true, hideBelow: 'lg', phone: 'hide', sort: (a) => a.amount_minor, render: (a) => <Money minor={a.amount_minor} currency={a.currency} /> },
    { key: 'balance', label: t('exp.col.balance'), width: '120px', align: 'right', mono: true, phone: 'end', sort: (a) => a.balance_minor, render: (a) => (a.status === 'paid' ? <Money minor={a.balance_minor} currency={a.currency} /> : <span className="md:hidden"><Money minor={a.amount_minor} currency={a.currency} /></span>) },
  ];
  const tot = d?.totals[0];
  // The viewer's own employment (to ask for an advance from the empty list).
  const ownEmp = me.employee?.employments.find((x) => x.status !== 'ended') ?? me.employee?.employments[0];
  const ownEnt = ownEmp !== undefined ? me.entities.find((e) => e.id === ownEmp.entity) : undefined;
  const own = ownEmp !== undefined && ownEnt !== undefined ? { employment: ownEmp.id, currency: ownEnt.currency } : null;
  const listActions = (
    <>
          <Segmented
            value={status}
            onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
            label={t('exp.col.status')}
            size="sm"
            options={[
              { value: 'open', label: t('exp.adv.f.open') },
              { value: 'requested', label: t('exp.adv.status.requested') },
              { value: 'approved', label: t('exp.adv.f.to_pay') },
              { value: 'paid', label: t('exp.adv.f.to_settle') },
              { value: 'any', label: t('exp.f.all') },
            ]}
          />
    </>
  );
  return (
    <>
      <PageHeader title={t('exp.adv.title')} meta={d !== null ? tn('exp.n_advances', d.total) : ''} back="#/expenses">
        <span className="hidden md:contents">{listActions}</span>
      </PageHeader>
      <PageBody>
        <PhoneActions>{listActions}</PhoneActions>
        {tot !== undefined && (tot.outstanding_minor > 0 || tot.to_pay_minor > 0) && (
          <div className="mb-3 grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile index="01" label={t('exp.adv.outstanding')} value={<Money minor={tot.outstanding_minor} currency={tot.currency} />} tone="lh" onClick={() => setQuery({ status: 'paid' })} />
            <StatTile index="02" label={t('exp.adv.to_pay')} value={<Money minor={tot.to_pay_minor} currency={tot.currency} />} onClick={() => setQuery({ status: 'approved' })} />
          </div>
        )}
        <div className="hr-panel hr-in min-w-0">
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <Loading />
            )
          ) : (
            <DataTable
              label={t('exp.adv.title')}
              columns={cols}
              rows={d.advances}
              rowKey={(a) => a.id}
              rowHref={(a) => `#/expenses/advances/${a.number}`}
              hasMore={d.total > d.advances.length}
              onMore={() => setLimit((l) => l + PAGE)}
              loadingMore={live.loading}
              empty={<Empty icon={HandCoins} title={status === 'open' ? t('exp.adv.none_open') : t('exp.adv.none')} action={own !== null ? <Button icon={HandCoins} onClick={() => setAsking(true)}>{t('exp.adv.ask')}</Button> : undefined} />}
            />
          )}
        </div>
      </PageBody>
      {asking && own !== null && <AdvanceDialog currency={own.currency} employment={own.employment} trips={[]} onClose={() => setAsking(false)} />}
    </>
  );
}

function SettleDialog({ a, onClose }: { a: AdvanceDetail; onClose: () => void }): React.JSX.Element {
  const [amount, setAmount] = useState<number | null>(a.balance_minor);
  const [ref, setRef] = useState('');
  const [day, setDay] = useState(() => today({ entity: a.entity }));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.adv.repayment')}
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          {a.number} <span aria-hidden>·</span> <Money minor={a.balance_minor} currency={a.currency} /> {t('exp.adv.left_short')}
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="primary"
            busy={busy}
            disabled={ref.trim() === '' || amount === null || amount <= 0}
            onClick={() => {
              setBusy(true);
              void op('advances.settle', { advance: a.id, kind: 'repayment', amount: majorParam(amount, a.currency), reference: ref.trim(), day })
                .then(() => (changed(...READS), onClose()))
                .catch(() => setBusy(false));
            }}
          >
            {t('exp.adv.record')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('exp.f.amount')}>
          <MoneyInput value={amount} onChange={setAmount} currency={a.currency} label={t('exp.f.amount')} />
        </Field>
        <Field label={t('exp.paid.reference')}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} aria-label={t('exp.paid.reference')} autoFocus />
        </Field>
        <Field label={t('exp.paid.day')}>
          <DayPicker value={day} onChange={setDay} label={t('exp.paid.day')} />
        </Field>
      </div>
    </Dialog>
  );
}

function PayDialog({ a, onClose }: { a: AdvanceDetail; onClose: () => void }): React.JSX.Element {
  const [ref, setRef] = useState('');
  const [day, setDay] = useState(() => today({ entity: a.entity }));
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.paid.title')}
      meta={
        <span className="inline-flex items-baseline gap-1.5">
          {a.number} <span aria-hidden>·</span> <Money minor={a.amount_minor} currency={a.currency} />
        </span>
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t('ui.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={Wallet}
            busy={busy}
            disabled={ref.trim() === ''}
            onClick={() => {
              setBusy(true);
              void op('advances.mark-paid', { advance: a.id, reference: ref.trim(), day })
                .then(() => (changed(...READS), onClose()))
                .catch(() => setBusy(false));
            }}
          >
            {t('exp.paid.title')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('exp.paid.reference')} hint={t('exp.paid.reference_hint')}>
          <Input value={ref} onChange={(e) => setRef(e.target.value)} aria-label={t('exp.paid.reference')} autoFocus />
        </Field>
        <Field label={t('exp.paid.day')}>
          <DayPicker value={day} onChange={setDay} label={t('exp.paid.day')} />
        </Field>
      </div>
    </Dialog>
  );
}

export function AdvancePage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ advance: AdvanceDetail }>('advances.get', { advance: params['id'] ?? '' }, READS, { name: 'advances.get' });
  const a = live.data?.advance ?? null;
  const [paying, setPaying] = useState(false);
  const [settling, setSettling] = useState(false);
  if (a === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const own = me.employee !== null && me.employee.id === a.employee;
  const advanceActions = (
    <>
          {a.can.mark_paid && a.pay_via === 'bank' && (
            <Button variant="primary" icon={Wallet} onClick={() => setPaying(true)}>
              {t('exp.paid.title')}
            </Button>
          )}
          {a.can.settle && (
            <Button icon={Undo2} onClick={() => setSettling(true)}>
              {t('exp.adv.repayment')}
            </Button>
          )}
          {a.can.cancel && (
            <Button variant="danger" icon={Ban} onClick={() => void act([patch(a.id, { status: 'cancelled' })], () => op('advances.cancel', { advance: a.id }), READS)}>
              {t('exp.adv.cancel')}
            </Button>
          )}
    </>
  );
  return (
    <>
      <PageHeader title={a.purpose} meta={[a.number, own ? '' : a.employee_name, a.entity_name].filter((x) => x !== '').join(' · ')} back={own ? '#/expenses/mine' : '#/expenses/advances'}>
        <span className="hidden md:contents">{advanceActions}</span>
      </PageHeader>
      <PageBody>
        <PhoneActions>{advanceActions}</PhoneActions>
        <div className="flex flex-col gap-3">
          {a.status === 'approved' && a.pay_via === 'payroll' && <Notice>{t('exp.adv.with_payroll')}</Notice>}
          {a.status === 'paid' && <Notice tone="neutral">{a.recover_via === 'claim' ? t('exp.adv.settles_claims', { day: fmtDay(a.recover_from) }) : t('exp.adv.recovered_pay', { day: fmtDay(a.recover_from) })}</Notice>}
          <div className="hr-panel hr-in px-3.5 py-3">
            <FactStrip
              items={[
                { label: t('exp.col.status'), value: <AdvanceStatus a={a} /> },
                { label: t('exp.f.amount'), value: <Money minor={a.amount_minor} currency={a.currency} className="text-[14px]" /> },
                ...(a.status === 'paid' || a.status === 'settled' ? [{ label: t('exp.col.balance'), value: <Money minor={a.balance_minor} currency={a.currency} className="text-[14px]" /> }] : []),
                { label: t('exp.col.pay_via'), value: a.pay_via === 'payroll' ? t('exp.pay_via.payroll') : t('exp.pay_via.bank') },
                { label: t('exp.adv.settled_by'), value: a.recover_via === 'claim' ? t('exp.adv.by_claims') : t('exp.adv.by_pay') },
                ...(a.needed_by !== '' ? [{ label: t('exp.f.needed_by'), value: fmtDay(a.needed_by), mono: true }] : []),
                ...(a.paid_day !== '' ? [{ label: t('exp.adv.paid_on'), value: `${fmtDay(a.paid_day)}${a.paid_reference !== '' ? ' · ' + a.paid_reference : ''}` }] : []),
                ...(a.travel !== '' ? [{ label: t('exp.claim.trip'), value: <a className="hr-link hr-focus" href={`#/expenses/travel/${a.travel_number}`}>{a.travel_label}</a> }] : []),
              ]}
            />
          </div>
          <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
            <Panel index="01" label={t('exp.adv.settlements')}>
              {a.settlements.length === 0 ? (
                <p className="py-2 text-[12px] text-[var(--hr-muted)]">{a.status === 'paid' ? t('exp.adv.no_settlements') : t('exp.adv.not_paid_yet')}</p>
              ) : (
                <ul>
                  {a.settlements.map((s) => (
                    <li key={s.id} className="flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 last:border-b-0">
                      <span className="hr-mono w-20 shrink-0 text-[12px] text-[var(--hr-muted)]">{fmtDay(s.day)}</span>
                      <span className="hr-wrap min-w-0 flex-1 text-[13px]">
                        {s.kind === 'claim' ? (
                          <a className="hr-link hr-focus" href={`#/expenses/claims/${s.claim_number}`}>
                            {t('exp.adv.s.claim', { n: s.claim_number })}
                          </a>
                        ) : s.kind === 'payroll' ? (
                          t('exp.adv.s.payroll')
                        ) : (
                          t('exp.adv.s.repayment', { ref: s.reference })
                        )}
                      </span>
                      <Money minor={s.amount_minor} currency={a.currency} />
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
            <Panel index="02" label={t('exp.claim.approval')}>
              {a.approvals.length === 0 ? (
                <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('ui.none')}</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {a.approvals.map((x) => (
                    <li key={x.id} className="flex flex-col gap-1">
                      <Steps a={x} />
                      {x.status !== 'pending' && x.decided_by_name !== '' && <span className="text-[12px] text-[var(--hr-muted)]">{t(`exp.decided.${x.status}`, { who: x.decided_by_name })}</span>}
                    </li>
                  ))}
                </ul>
              )}
              {a.history.length > 0 && (
                <ul className="mt-3 flex flex-col gap-1 border-t border-[var(--hr-hair)] pt-2">
                  {a.history.slice(0, 8).map((h, i) => (
                    <li key={i} className="flex gap-2 text-[12px]">
                      <span className="hr-wrap min-w-0 flex-1 text-[var(--hr-ink-2)]">{h.summary}</span>
                      <span className="hr-label shrink-0">{ago(h.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </PageBody>
      {paying && <PayDialog a={a} onClose={() => setPaying(false)} />}
      {settling && <SettleDialog a={a} onClose={() => setSettling(false)} />}
    </>
  );
}
