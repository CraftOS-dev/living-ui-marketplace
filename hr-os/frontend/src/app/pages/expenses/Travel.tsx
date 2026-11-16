/**
 * Trips: a travel request with its purpose, days, destinations, itinerary
 * and estimate by category, sent for approval; once approved the claims
 * made on it link to it, so the trip shows what was spent against the
 * estimate. A draft opens as the form; a sent trip as its record.
 */
import { useMemo, useState } from 'react';
import { Ban, HandCoins, Plane, Plus, Receipt, Save, Send, Trash2 } from 'lucide-react';
import { Button, DataTable, DateRange, DayPicker, Empty, FactStrip, Field, IconButton, Input, LoadError, Loading, Money, MoneyInput, Notice, PageBody, PageHeader, Panel, RowCue, Segmented, Select, Textarea, majorParam, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { ClaimStatus, TripStatus, tripName, PhoneActions, ClaimName } from '../../components/expenses/parts.tsx';
import { op } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, patch, useOp } from '../../lib/live.ts';
import { navigate, setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { AdvanceDialog } from './Advances.tsx';
import type { Category, Claim, Leg, Mine, Trip, TripDetail } from './types.ts';
import { READS } from './types.ts';

const PURPOSES = ['client_visit', 'conference', 'training', 'internal_meeting', 'sales', 'relocation', 'other'];
const MODES: Leg['mode'][] = ['flight', 'train', 'car', 'bus', 'boat', 'other'];

interface Draft {
  purpose: string;
  details: string;
  from: string;
  to: string;
  destinations: { city: string; country: string }[];
  itinerary: Leg[];
  costs: { category: string; amount: number | null; note: string }[];
}

function fromTrip(x: Trip | null): Draft {
  if (x === null) return { purpose: 'client_visit', details: '', from: '', to: '', destinations: [{ city: '', country: '' }], itinerary: [], costs: [] };
  return {
    purpose: x.purpose,
    details: x.details,
    from: x.from_day,
    to: x.to_day,
    destinations: x.destinations.length > 0 ? x.destinations : [{ city: '', country: '' }],
    itinerary: x.itinerary,
    costs: x.costs.map((c) => ({ category: c.category, amount: c.amount_minor, note: c.note })),
  };
}

function TripForm({ trip, currency, categories, employment, onSaved }: { trip: Trip | null; currency: string; categories: Category[]; employment?: string | undefined; onSaved: (x: Trip, sent: boolean) => void }): React.JSX.Element {
  const [d, setD] = useState<Draft>(() => fromTrip(trip));
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>): void => setD((x) => ({ ...x, ...p }));
  const estimate = d.costs.reduce((s, c) => s + (c.amount ?? 0), 0);
  const ready = d.from !== '' && d.destinations.some((x) => x.city.trim() !== '');
  const params = (): Record<string, unknown> => ({
    travel: trip?.id,
    employment: trip === null ? employment : undefined,
    purpose: d.purpose,
    details: d.details,
    from_day: d.from,
    to_day: d.to === '' ? d.from : d.to,
    destinations: d.destinations.filter((x) => x.city.trim() !== '').map((x) => ({ city: x.city.trim(), country: x.country.trim().toUpperCase() })),
    itinerary: d.itinerary.filter((l) => l.from.trim() !== '' || l.to.trim() !== ''),
    costs: d.costs.filter((c) => c.amount !== null && c.amount > 0).map((c) => ({ category: c.category, amount: majorParam(c.amount, currency), note: c.note })),
  });
  const save = async (send: boolean): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ trip: Trip }>('travel.save', params());
      let out = r.trip;
      if (send) out = (await op<{ trip: Trip }>('travel.submit', { travel: r.trip.id })).trip;
      changed(...READS);
      toast.success(send ? t('exp.trip.sent', { n: out.number }) : t('exp.trip.saved', { n: out.number }));
      onSaved(out, send);
    } catch {
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col gap-3">
      <Panel index="01" label={t('exp.trip.where_when')}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={t('exp.f.purpose')}>
            <Select value={d.purpose} onChange={(e) => set({ purpose: e.target.value })} aria-label={t('exp.f.purpose')}>
              {PURPOSES.map((p) => (
                <option key={p} value={p}>
                  {t(`exp.purpose.${p}`)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('exp.trip.days')}>
            <DateRange from={d.from} to={d.to} onChange={(from, to) => set({ from, to })} label={t('exp.trip.days')} />
          </Field>
        </div>
        <Field label={t('exp.trip.details')} optional className="mt-3">
          <Textarea value={d.details} onChange={(e) => set({ details: e.target.value })} minRows={2} aria-label={t('exp.trip.details')} placeholder={t('exp.trip.details_ph')} />
        </Field>
        <div className="mt-3">
          <div className="hr-label mb-1.5">{t('exp.trip.destinations')}</div>
          <ul className="flex flex-col gap-2">
            {d.destinations.map((x, i) => (
              <li key={i} className="flex items-center gap-2">
                <Input value={x.city} onChange={(e) => set({ destinations: d.destinations.map((y, j) => (j === i ? { ...y, city: e.target.value } : y)) })} aria-label={t('exp.trip.city')} placeholder={t('exp.trip.city')} className="min-w-0 flex-1" />
                <Input value={x.country} onChange={(e) => set({ destinations: d.destinations.map((y, j) => (j === i ? { ...y, country: e.target.value.slice(0, 2) } : y)) })} aria-label={t('exp.trip.country')} placeholder="JP" className="w-16 uppercase" />
                <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" disabled={d.destinations.length === 1} onClick={() => set({ destinations: d.destinations.filter((_, j) => j !== i) })} />
              </li>
            ))}
          </ul>
          <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => set({ destinations: [...d.destinations, { city: '', country: '' }] })}>
            {t('exp.trip.add_destination')}
          </Button>
        </div>
      </Panel>
      <Panel index="02" label={t('exp.trip.itinerary')}>
        {d.itinerary.length === 0 && <p className="pb-2 text-[12px] text-[var(--hr-muted)]">{t('exp.trip.no_legs')}</p>}
        <ul className="flex flex-col gap-2">
          {d.itinerary.map((l, i) => (
            <li key={i} className="grid grid-cols-2 gap-2 border-b border-[var(--hr-hair)] pb-2 last:border-b-0 md:grid-cols-[150px_1fr_1fr_110px_1fr_32px]">
              <DayPicker value={l.day} onChange={(v) => set({ itinerary: d.itinerary.map((y, j) => (j === i ? { ...y, day: v } : y)) })} label={t('exp.f.day')} />
              <Input value={l.from} onChange={(e) => set({ itinerary: d.itinerary.map((y, j) => (j === i ? { ...y, from: e.target.value } : y)) })} aria-label={t('exp.trip.from')} placeholder={t('exp.trip.from')} />
              <Input value={l.to} onChange={(e) => set({ itinerary: d.itinerary.map((y, j) => (j === i ? { ...y, to: e.target.value } : y)) })} aria-label={t('exp.trip.to')} placeholder={t('exp.trip.to')} />
              <Select value={l.mode} onChange={(e) => set({ itinerary: d.itinerary.map((y, j) => (j === i ? { ...y, mode: e.target.value as Leg['mode'] } : y)) })} aria-label={t('exp.trip.mode')}>
                {MODES.map((m) => (
                  <option key={m} value={m}>
                    {t(`exp.mode.${m}`)}
                  </option>
                ))}
              </Select>
              <Input value={l.note} onChange={(e) => set({ itinerary: d.itinerary.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })} aria-label={t('exp.trip.leg_note')} placeholder={t('exp.trip.leg_note_ph')} />
              <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => set({ itinerary: d.itinerary.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => set({ itinerary: [...d.itinerary, { day: d.itinerary.length === 0 ? d.from : (d.itinerary[d.itinerary.length - 1]?.day ?? ''), from: d.itinerary[d.itinerary.length - 1]?.to ?? '', to: '', mode: 'flight', note: '' }] })}>
          {t('exp.trip.add_leg')}
        </Button>
      </Panel>
      <Panel index="03" label={t('exp.trip.estimate')} aside={<Money minor={estimate} currency={currency} className="text-[13px] font-medium" />}>
        <ul className="flex flex-col gap-2">
          {d.costs.map((c, i) => (
            <li key={i} className="grid grid-cols-[1fr_32px] gap-2 md:grid-cols-[200px_160px_1fr_32px]">
              <Select value={c.category} onChange={(e) => set({ costs: d.costs.map((y, j) => (j === i ? { ...y, category: e.target.value } : y)) })} aria-label={t('exp.f.category')} className="col-span-2 md:col-span-1">
                {categories.map((k) => (
                  <option key={k.id} value={k.code}>
                    {k.name}
                  </option>
                ))}
              </Select>
              <MoneyInput value={c.amount} onChange={(v) => set({ costs: d.costs.map((y, j) => (j === i ? { ...y, amount: v } : y)) })} currency={currency} label={t('exp.f.amount')} />
              <Input value={c.note} onChange={(e) => set({ costs: d.costs.map((y, j) => (j === i ? { ...y, note: e.target.value } : y)) })} aria-label={t('exp.trip.cost_note')} placeholder={t('exp.trip.cost_note_ph')} className="hidden md:block" />
              <IconButton icon={Trash2} label={t('ui.remove')} tone="danger" onClick={() => set({ costs: d.costs.filter((_, j) => j !== i) })} />
            </li>
          ))}
        </ul>
        <Button size="sm" variant="ghost" icon={Plus} className="mt-2" onClick={() => set({ costs: [...d.costs, { category: categories[d.costs.length % Math.max(1, categories.length)]?.code ?? 'other', amount: null, note: '' }] })}>
          {t('exp.trip.add_cost')}
        </Button>
      </Panel>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button icon={Save} busy={busy} disabled={!ready} onClick={() => void save(false)}>
          {t('exp.trip.save')}
        </Button>
        <Button variant="primary" icon={Send} busy={busy} disabled={!ready} onClick={() => void save(true)}>
          {t('exp.trip.send')}
        </Button>
      </div>
    </div>
  );
}

export function TripNewPage({ query }: PageProps): React.JSX.Element {
  const live = useOp<Mine>('expenses.me', {}, READS, { name: 'expenses.me' });
  const emp = live.data?.employments.find((e) => e.primary) ?? live.data?.employments[0];
  return (
    <>
      <PageHeader title={t('exp.trip.plan')} meta={emp !== undefined ? `${emp.entity_name} · ${emp.currency}` : ''} back="#/expenses/mine" />
      <PageBody className="max-w-[960px]">
        {live.data === null ? (
          <Loading />
        ) : emp === undefined ? (
          <Empty icon={Plane} title={t('exp.mine.not_linked')} />
        ) : (
          <TripForm trip={null} currency={emp.currency} categories={emp.categories} employment={query.get('employment') ?? emp.id} onSaved={(x) => navigate(`/expenses/travel/${x.number}`)} />
        )}
      </PageBody>
    </>
  );
}

export function TripPage({ params }: PageProps): React.JSX.Element {
  const me = useMe();
  const live = useOp<{ trip: TripDetail }>('travel.get', { travel: params['id'] ?? '' }, READS, { name: 'travel.get' });
  const x = live.data?.trip ?? null;
  const [asking, setAsking] = useState(false);
  const byCat = useMemo(() => {
    const out: Record<string, number> = {};
    for (const c of x?.claims_list ?? []) if (c.status !== 'rejected' && c.status !== 'draft') out['_all'] = (out['_all'] ?? 0) + (c.status === 'approved' || c.status === 'paid' ? c.approved_minor : c.total_minor);
    return out;
  }, [x]);
  if (x === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />;
  const own = me.employee !== null && me.employee.id === x.employee;
  const newClaim = (): void => {
    void op<{ claim: Claim }>('claims.create', { employment: x.employment, travel: x.id, title: tripName(x) }).then((r) => (changed(...READS), navigate(`/expenses/claims/${r.claim.number}`)));
  };
  const spent = x.spent_minor ?? byCat['_all'] ?? 0;
  const claimCols: Column<Claim>[] = [
    { key: 'n', label: t('exp.col.claim'), width: 'minmax(160px,2fr)', phone: 'title', render: (c) => <ClaimName c={c} /> },
    { key: 's', label: t('exp.col.status'), width: '120px', render: (c) => <ClaimStatus c={c} /> },
    { key: 'a', label: t('exp.col.amount'), width: '130px', align: 'right', mono: true, phone: 'end', render: (c) => <Money minor={c.status === 'approved' || c.status === 'paid' ? c.approved_minor : c.total_minor} currency={c.currency} /> },
  ];
  const tripActions = (
    <>
          {x.can.claim && (
            <Button variant="primary" icon={Receipt} onClick={newClaim}>
              {t('exp.trip.claim')}
            </Button>
          )}
          {x.can.advance && (
            <Button icon={HandCoins} onClick={() => setAsking(true)}>
              {t('exp.adv.ask')}
            </Button>
          )}
          {x.can.cancel && x.status !== 'draft' && (
            <Button variant="danger" icon={Ban} onClick={() => void act([patch(x.id, { status: 'cancelled' })], () => op('travel.cancel', { travel: x.id }), READS)}>
              {t('exp.trip.cancel')}
            </Button>
          )}
    </>
  );
  return (
    <>
      <PageHeader title={tripName(x)} meta={[x.number, own ? '' : x.employee_name, t(`exp.purpose.${x.purpose}`)].filter((v) => v !== '').join(' · ')} back={own ? '#/expenses/mine' : '#/expenses/travel'}>
        <span className="hidden md:contents">{tripActions}</span>
      </PageHeader>
      <PageBody className={x.can.edit ? 'max-w-[960px]' : undefined}>
        <PhoneActions>{tripActions}</PhoneActions>
        {x.can.edit ? (
          <TripForm trip={x} currency={x.currency} categories={x.categories} onSaved={() => live.reload()} />
        ) : (
          <div className="flex flex-col gap-3">
            {x.status === 'rejected' && <Notice tone="bad">{t('exp.trip.was_rejected', { why: x.decided_note })}</Notice>}
            <div className="hr-panel hr-in px-3.5 py-3">
              <FactStrip
                items={[
                  { label: t('exp.col.status'), value: <TripStatus trip={x} /> },
                  { label: t('exp.trip.days'), value: `${fmtRange(x.from_day, x.to_day)} · ${tn('exp.n_days', x.days)}` },
                  { label: t('exp.trip.estimate'), value: <Money minor={x.estimate_minor} currency={x.currency} className="text-[14px]" /> },
                  { label: t('exp.trip.spent'), value: <Money minor={spent} currency={x.currency} className="text-[14px]" /> },
                ]}
              />
              {x.estimate_minor > 0 && (
                <div className="mt-3" aria-hidden>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--hr-sunk)]">
                    <div className={`h-full ${spent > x.estimate_minor ? 'bg-[var(--hr-warn)]' : 'bg-[var(--hr-rh)]'}`} style={{ width: `${Math.min(100, Math.round((spent / x.estimate_minor) * 100))}%` }} />
                  </div>
                </div>
              )}
            </div>
            <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2">
              <Panel index="01" label={t('exp.trip.itinerary')}>
                {x.itinerary.length === 0 ? (
                  <p className="py-2 text-[12px] text-[var(--hr-muted)]">{x.destinations.map((d) => d.city).join(', ')}</p>
                ) : (
                  <ol className="flex flex-col">
                    {x.itinerary.map((l, i) => (
                      <li key={i} className="grid grid-cols-[80px_minmax(0,1fr)_88px] items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0 sm:grid-cols-[80px_minmax(0,1fr)_88px_minmax(0,140px)]">
                        <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{fmtDay(l.day)}</span>
                        <span className="hr-wrap min-w-0">
                          {l.from} {t('exp.trip.arrow')} {l.to}
                        </span>
                        <span className="text-[12px] text-[var(--hr-muted)]">{t(`exp.mode.${l.mode}`)}</span>
                        <span className="hr-mono hidden truncate text-[12px] text-[var(--hr-muted)] sm:block">{l.note}</span>
                      </li>
                    ))}
                  </ol>
                )}
                {x.details !== '' && <p className="hr-wrap mt-2 border-t border-[var(--hr-hair)] pt-2 text-[12px] text-[var(--hr-ink-2)]">{x.details}</p>}
              </Panel>
              <Panel index="02" label={t('exp.trip.estimate')}>
                <ul>
                  {x.costs.map((c, i) => (
                    <li key={i} className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_120px]">
                      <span className="min-w-0 truncate">{c.category_name !== '' ? c.category_name : t('exp.trip.cost')}</span>
                      <span className="hr-wrap hidden text-[12px] text-[var(--hr-muted)] sm:block">{c.note}</span>
                      <Money minor={c.amount_minor} currency={x.currency} className="text-right" />
                    </li>
                  ))}
                </ul>
                {x.costs.length === 0 && <p className="py-2 text-[12px] text-[var(--hr-muted)]">{t('exp.trip.no_estimate')}</p>}
              </Panel>
            </div>
            <Panel index="03" label={t('exp.trip.claims')} flush aside={x.can.claim ? <Button size="sm" variant="ghost" icon={Plus} onClick={newClaim}>{t('exp.trip.claim')}</Button> : undefined}>
              <DataTable label={t('exp.trip.claims')} columns={claimCols} rows={x.claims_list} rowKey={(c) => c.id} rowHref={(c) => `#/expenses/claims/${c.number}`} empty={<div className="px-3.5 py-4 text-[12px] text-[var(--hr-muted)]">{t('exp.trip.no_claims')}</div>} />
            </Panel>
            {x.advances.length > 0 && (
              <Panel index="04" label={t('exp.adv.title')}>
                <ul>
                  {x.advances.map((a) => (
                    <li key={a.id}>
                      <a href={`#/expenses/advances/${a.number}`} className="group hr-focus flex items-center gap-3 border-b border-[var(--hr-hair)] py-2 text-[13px] last:border-b-0 hover:bg-[var(--hr-hover)]">
                        <span className="hr-mono text-[12px]">{a.number}</span>
                        <span className="min-w-0 flex-1 truncate">{a.purpose}</span>
                        <Money minor={a.amount_minor} currency={a.currency} />
                        <RowCue />
                      </a>
                    </li>
                  ))}
                </ul>
              </Panel>
            )}
          </div>
        )}
      </PageBody>
      {asking && <AdvanceDialog currency={x.currency} employment={x.employment} trips={[x]} travel={x.number} onClose={() => setAsking(false)} />}
    </>
  );
}

const PAGE = 50;

export function TripsPage({ query }: PageProps): React.JSX.Element {
  const { entity } = useUi();
  const status = query.get('status') ?? 'open';
  const [limit, setLimit] = useState(PAGE);
  const live = useOp<{ trips: Trip[]; total: number; view: string }>('travel.list', { status, entity: entity === '' ? undefined : entity, limit }, READS, { name: 'travel.list' });
  const d = live.data;
  const cols: Column<Trip>[] = [
    { key: 'number', label: t('exp.col.number'), width: '96px', mono: true, render: (x) => x.number },
    { key: 'person', label: t('exp.col.person'), width: 'minmax(140px,1.3fr)', phone: 'title', sort: (x) => x.employee_name, render: (x) => x.employee_name },
    { key: 'trip', label: t('exp.col.trip'), width: 'minmax(180px,2fr)', render: (x) => <span className="truncate">{tripName(x)}</span> },
    { key: 'days', label: t('exp.col.days'), width: '150px', mono: true, hideBelow: 'lg', sort: (x) => x.from_day, render: (x) => fmtRange(x.from_day, x.to_day) },
    { key: 'status', label: t('exp.col.status'), width: '110px', render: (x) => <TripStatus trip={x} /> },
    { key: 'spent', label: t('exp.trip.spent'), width: '120px', align: 'right', mono: true, hideBelow: 'lg', render: (x) => <Money minor={x.spent_minor ?? 0} currency={x.currency} /> },
    { key: 'estimate', label: t('exp.trip.estimate'), width: '120px', align: 'right', mono: true, phone: 'end', render: (x) => <Money minor={x.estimate_minor} currency={x.currency} /> },
  ];
  const listActions = (
    <>
          <Segmented
            value={status}
            onChange={(v) => setQuery({ status: v === 'open' ? undefined : v })}
            label={t('exp.col.status')}
            size="sm"
            options={[
              { value: 'open', label: t('exp.adv.f.open') },
              { value: 'upcoming', label: t('exp.trip.f.upcoming') },
              { value: 'requested', label: t('exp.trip.status.requested') },
              { value: 'any', label: t('exp.f.all') },
            ]}
          />
          <Button variant="primary" icon={Plane} onClick={() => navigate('/expenses/travel/new')}>
            {t('exp.trip.plan')}
          </Button>
    </>
  );
  return (
    <>
      <PageHeader title={t('exp.trip.title')} meta={d !== null ? tn('exp.n_trips', d.total) : ''} back="#/expenses">
        <span className="hidden md:contents">{listActions}</span>
      </PageHeader>
      <PageBody>
        <PhoneActions>{listActions}</PhoneActions>
        <div className="hr-panel hr-in min-w-0">
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <Loading />
            )
          ) : (
            <DataTable label={t('exp.trip.title')} columns={cols} rows={d.trips} rowKey={(x) => x.id} rowHref={(x) => `#/expenses/travel/${x.number}`} hasMore={d.total > d.trips.length} onMore={() => setLimit((l) => l + PAGE)} loadingMore={live.loading} empty={<Empty icon={Plane} title={t('exp.trip.none')} action={<Button icon={Plane} onClick={() => navigate('/expenses/travel/new')}>{t('exp.trip.plan')}</Button>} />} />
          )}
        </div>
      </PageBody>
    </>
  );
}
