/**
 * Balances: the HR table (a row per person, a column per leave type) and
 * one balance explained in a sheet: how today's number was reached (each
 * grant, accrual, carry-over, expiry, leave taken and adjustment with the
 * running balance), what expires when, and the balance on a future day.
 * HR adjusts a balance from the sheet with a reason.
 */
import { useEffect, useMemo, useState } from 'react';
import { CalendarClock, Plus, Scale, Wallet } from 'lucide-react';
import { Button, DataTable, DayPicker, Dialog, Empty, Field, Input, LoadError, Loading, Notice, PageBody, PageHeader, Panel, Picker, RowCue, SearchInput, Sheet, SheetHeader, StatTile, Tag, Textarea, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { TypeLabel, TypeMark } from '../../components/leave/LeaveIcon.tsx';
import { errMessage, op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { addMonths, fmtDay, fmtRange } from '../../lib/format.ts';
import { t } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import { amount, figure, READS, unitWord } from './data.ts';
import type { Balance, BalanceTable } from './types.ts';

/* ------------------------------------------------------------------ sheet */

function lineLabel(kind: string, note: string | undefined): string {
  const key = `leave.explain.${kind}`;
  const label = t(key);
  return label === key ? (note ?? kind) : label;
}

export function BalanceSheet({ employment, type, onClose, canAdjust }: { employment: string; type: string; onClose: () => void; canAdjust?: boolean | undefined }): React.JSX.Element {
  const me = useMe();
  const [on, setOn] = useState('');
  const [adjusting, setAdjusting] = useState(false);
  const live = useOp<Balance>('leave.balance', { employment, type, project_to: on === '' ? undefined : on }, READS, { name: 'leave.balance.sheet' });
  const b = live.data;
  return (
    <Sheet open onClose={onClose} label={t('leave.balance.title')} width={560}>
      <SheetHeader
        title={b !== null ? <TypeLabel name={b.name} icon={b.icon} /> : t('leave.balance.title')}
        meta={b?.person !== undefined ? `${b.person.name} · ${b.person.number}` : undefined}
        onClose={onClose}
        actions={canAdjust === true && b !== null && b.tracked ? <Button size="sm" icon={Scale} onClick={() => setAdjusting(true)}>{t('leave.adjust.title')}</Button> : undefined}
      />
      <div className="hr-scroll flex-1 overflow-y-auto px-4 py-4">
        {live.error !== null ? (
          <LoadError message={live.error} onRetry={live.reload} />
        ) : b === null ? (
          <Loading />
        ) : !b.tracked ? (
          <Empty icon={CalendarClock} title={t('leave.balance.untracked')}>
            {t('leave.balance.untracked_body', { n: amount(b.taken, b.unit) })}
          </Empty>
        ) : (
          <div className="flex flex-col gap-3">
            <div className="grid grid-cols-3 gap-2">
              <StatTile label={t('leave.available')} value={figure(b.available)} sub={unitWord(b.unit, b.available)} tone={b.available !== null && b.available < 0 ? 'bad' : undefined} />
              <StatTile label={t('leave.taken')} value={figure(b.taken)} sub={t('leave.balance.since', { day: fmtDay(b.period.start) })} />
              <StatTile label={t('leave.booked')} value={figure(b.booked + b.pending)} sub={b.pending > 0 ? t('leave.balance.waiting_n', { n: figure(b.pending) }) : t('leave.balance.ahead')} />
            </div>
            {b.expiring.length > 0 && (
              <Notice tone="warn">
                {b.expiring.map((x) => t('leave.balance.expires', { n: amount(x.amount, b.unit), day: fmtDay(x.day, { year: 'always' }) })).join(' ')}
              </Notice>
            )}
            <Panel index="01" label={t('leave.balance.how')} flush>
              <ul className="flex flex-col">
                {(b.explain ?? []).map((l, i) => (
                  <li key={i} className="grid grid-cols-[78px_1fr_auto_56px] items-baseline gap-2 border-t border-[var(--hr-hair)] px-3.5 py-2 text-[13px] first:border-t-0">
                    <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{fmtDay(l.day)}</span>
                    <span className="hr-wrap min-w-0">
                      {l.kind === 'take' && l.ref !== undefined && l.ref !== '' && l.key === undefined ? (
                        <a href={`#/leave/requests/${l.ref}`} className="hr-link hr-focus hit rounded-[3px]">
                          {t('leave.explain.leave_on', { when: fmtRange(l.day, l.to ?? l.day) })}
                        </a>
                      ) : (
                        lineLabel(l.kind, l.note)
                      )}
                      {l.note !== undefined && l.note !== '' && l.kind !== 'take' && l.kind !== 'opening' && <span className="block text-[12px] text-[var(--hr-muted)]">{l.note}</span>}
                    </span>
                    <span className={`hr-mono hr-num text-right ${l.amount < 0 ? 'text-[var(--hr-ink-2)]' : 'text-[var(--hr-good)]'}`}>{l.kind === 'opening' ? '' : (l.amount > 0 ? '+' : '') + figure(l.amount)}</span>
                    <span className="hr-mono hr-num text-right font-medium">{figure(l.balance)}</span>
                  </li>
                ))}
                {(b.explain ?? []).length === 0 && <li className="px-3.5 py-3 text-[13px] text-[var(--hr-muted)]">{t('leave.balance.nothing_yet')}</li>}
              </ul>
            </Panel>
            <Panel index="02" label={t('leave.balance.on_a_day')}>
              <div className="flex flex-wrap items-end gap-3">
                <Field label={t('leave.balance.day')} className="w-48">
                  <DayPicker value={on} onChange={setOn} min={me.today} label={t('leave.balance.day')} clearable />
                </Field>
                {b.projection !== undefined ? (
                  <div className="pb-1">
                    <span className="hr-mono hr-num text-[26px] font-light">{figure(b.projection.available)}</span> <span className="hr-mono text-[12px] text-[var(--hr-muted)]">{unitWord(b.unit, b.projection.available)}</span>
                    {b.projection.estimate && <span className="ml-2 text-[12px] text-[var(--hr-muted)]">{t('leave.balance.estimate')}</span>}
                  </div>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pb-1">
                    {[3, 6, 12].map((m) => (
                      <Button key={m} size="sm" onClick={() => setOn(addMonths(me.today, m))}>
                        {t('leave.balance.in_months', { n: m })}
                      </Button>
                    ))}
                  </div>
                )}
              </div>
            </Panel>
            {b.policy !== null && b.policy !== undefined && (
              <p className="text-[12px] text-[var(--hr-muted)]">
                {t('leave.balance.policy', { name: b.policy.name, from: fmtDay(b.policy.from, { year: 'always' }) })}
              </p>
            )}
          </div>
        )}
      </div>
      {adjusting && b !== null && <AdjustDialog employment={employment} type={b.type} unit={b.unit} name={b.name} onClose={() => setAdjusting(false)} />}
    </Sheet>
  );
}

export function AdjustDialog({ employment, type, unit, name, onClose }: { employment: string; type: string; unit: string; name: string; onClose: () => void }): React.JSX.Element {
  const me = useMe();
  const [n, setN] = useState('');
  const [reason, setReason] = useState('');
  const [day, setDay] = useState(me.today);
  const [expires, setExpires] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const v = Number(n.replace(',', '.'));
  const save = async (): Promise<void> => {
    setBusy(true);
    setErr('');
    try {
      await op('leave.adjust', { employment, type, amount: v, reason: reason.trim(), day, expires: expires === '' ? undefined : expires }, { quiet: true });
      changed(...READS);
      toast.success(t('leave.adjust.done', { n: amount(v, unit), name }));
      onClose();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('leave.adjust.title')}
      meta={name}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={!Number.isFinite(v) || v === 0 || reason.trim() === ''} onClick={() => void save()}>
            {t('leave.adjust.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('leave.adjust.amount')} hint={t('leave.adjust.amount_hint')}>
          <Input value={n} onChange={(e) => setN(e.target.value)} inputMode="decimal" placeholder="2" aria-label={t('leave.adjust.amount')} autoFocus className="w-32" />
        </Field>
        <Field label={t('leave.adjust.reason')}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} placeholder={t('leave.adjust.reason_ph')} aria-label={t('leave.adjust.reason')} />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label={t('leave.adjust.day')}>
            <DayPicker value={day} onChange={setDay} label={t('leave.adjust.day')} />
          </Field>
          {v > 0 && (
            <Field label={t('leave.adjust.expires')} optional>
              <DayPicker value={expires} onChange={setExpires} min={day} label={t('leave.adjust.expires')} clearable />
            </Field>
          )}
        </div>
        {err !== '' && <Notice tone="bad">{err}</Notice>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ table */

type Row = BalanceTable['rows'][number];

/** One entity's table: a row per person, a column per leave type of that entity. */
function EntityBalances({ entity, q, index, title, onOpen }: { entity: string; q: string; index?: string | undefined; title?: string | undefined; onOpen: (employment: string, type: string) => void }): React.JSX.Element {
  const me = useMe();
  const [limit, setLimit] = useState(60);
  const live = useOp<BalanceTable>('leave.balances', { entity, q: q === '' ? undefined : q, limit }, READS, { name: 'leave.balances' });
  const d = live.data;
  const columns: Column<Row>[] = useMemo(() => {
    const cols: Column<Row>[] = [{ key: 'name', label: t('leave.col.person'), width: 'minmax(180px,1.6fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="hr-wrap min-w-0"><span className="block font-medium">{r.name}</span><span className="text-[12px] text-[var(--hr-muted)]"><span className="hr-mono">{r.number}</span>{r.department_name !== '' ? ` · ${r.department_name}` : ''}</span></span> }];
    for (const ty2 of d?.types ?? []) {
      cols.push({
        key: ty2.code,
        label: <TypeLabel name={ty2.name} icon={ty2.icon} />,
        width: 'minmax(96px,1fr)',
        align: 'right',
        mono: true,
        sort: (r) => r.balances[ty2.code]?.available ?? -1e9,
        phone: 'sub',
        render: (r) => {
          const b = r.balances[ty2.code];
          if (b === undefined) return <span className="text-[var(--hr-faint)]">{t('ui.none')}</span>;
          return (
            <button type="button" onClick={(e) => { e.stopPropagation(); onOpen(r.employment, ty2.code); }} className={`hr-focus hit rounded-[3px] px-1 hover:bg-[var(--hr-active)] ${b.available !== null && b.available < 0 ? 'text-[var(--hr-bad)]' : ''}`} title={b.expiring !== null ? t('leave.balance.expires', { n: amount(b.expiring.amount, b.unit), day: fmtDay(b.expiring.day) }) : undefined}>
              {figure(b.available)}
              {b.unit === 'hour' ? 'h' : ''}
              {/* Every figure keeps the dot's place, so the right-aligned figures line up whether or not days expire. */}
              <span aria-hidden className={`ml-1 inline-block size-1.5 rounded-full align-middle ${b.expiring !== null ? 'bg-[var(--hr-warn)]' : ''}`} />            </button>
          );
        },
      });
    }
    return cols;
  }, [d?.types, onOpen]);
  const body =
    live.error !== null ? (
      <LoadError message={live.error} onRetry={live.reload} />
    ) : d === null ? (
      <Loading />
    ) : d.type_count === 0 ? (
      <Empty icon={Wallet} title={t('leave.balances_empty')} action={can(me, 'leave', 'full') ? <Button icon={Plus} onClick={() => (window.location.hash = '#/leave/settings')}>{t('leave.settings.title')}</Button> : undefined}>
        {t('leave.balances_empty_body')}
      </Empty>
    ) : (
      <DataTable label={title ?? t('leave.balances')} columns={columns} rows={d.rows} rowKey={(r) => r.employment} onRowClick={(r) => { const first = d.types.find((x) => r.balances[x.code] !== undefined); if (first !== undefined) onOpen(r.employment, first.code); }} hasMore={d.rows.length < d.total} onMore={() => setLimit((n) => n + 60)} empty={<Empty icon={Wallet} title={q !== '' ? t('leave.no_match') : t('leave.no_people')} action={q === '' && can(me, 'people', 'full') ? <Button icon={Plus} onClick={() => (window.location.hash = '#/people/new')}>{t('leave.hire_first')}</Button> : undefined} />} />
    );
  return title !== undefined ? (
    <Panel index={index} label={title} aside={d !== null ? <span className="hr-label">{t('leave.people_n', { n: d.total })}</span> : undefined} flush>
      {body}
    </Panel>
  ) : (
    <div className="hr-panel hr-in min-w-0">{body}</div>
  );
}

export function BalancesPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  const open = query.get('open') ?? '';
  const [emp, ty] = open.split(':');
  // The sidebar's entity; with all entities, one table per entity (each has its own leave types).
  const ents = entity !== '' ? me.entities.filter((e) => e.id === entity) : me.entities;
  const many = ents.length > 1;
  const onOpen = useMemo(() => (employment: string, type: string) => setQuery({ open: `${employment}:${type}` }), []);
  return (
    <>
      <PageHeader title={t('leave.balances')} meta={entity !== '' ? (ents[0]?.name ?? '') : t('leave.all_entities')}>
        <SearchInput value={q} onChange={setQ} placeholder={t('leave.search_people')} className="w-full sm:w-[220px]" />
      </PageHeader>
      <PageBody>
        <div className="flex flex-col gap-3">
          {ents.map((e, i) => (
            <EntityBalances key={e.id} entity={e.id} q={debounced} index={many ? String(i + 1).padStart(2, '0') : undefined} title={many ? e.name : undefined} onOpen={onOpen} />
          ))}
        </div>
        {/* The key sits on the panels' 14px content edge, and wraps (never cuts the tag) when the line runs out. */}
        <p className="mt-3 flex flex-wrap items-center gap-x-1.5 gap-y-1 px-3.5 text-[12px] text-[var(--hr-muted)]">
          <span aria-hidden className="inline-block size-1.5 shrink-0 rounded-full bg-[var(--hr-warn)]" />
          {t('leave.balances_legend')}
          <Tag tone="faint" className="ml-2">{t('leave.available')}</Tag>
        </p>
      </PageBody>
      {open !== '' && emp !== undefined && ty !== undefined && <BalanceSheet employment={emp} type={ty} canAdjust={can(me, 'leave', 'edit')} onClose={() => setQuery({ open: undefined })} />}
    </>
  );
}

/** The balances of one person (the employee view and the profile tab): one panel, a hairline row per type with its big readout. */
export function BalanceTiles({ balances, onOpen, index }: { balances: Balance[]; onOpen: (b: Balance) => void; index?: string | undefined }): React.JSX.Element | null {
  const tracked = balances.filter((b) => b.tracked && (b.granted > 0 || (b.carried ?? 0) > 0 || (b.balance ?? 0) !== 0 || b.taken > 0 || b.method !== 'manual'));
  if (tracked.length === 0) return null;
  return (
    <Panel index={index} label={t('leave.balances_mine')} flush>
      <ul className="grid grid-cols-1 md:grid-cols-2">
        {tracked.map((b) => (
          <li key={b.type} className="border-t border-[var(--hr-hair)] first:border-t-0 md:[&:nth-child(2)]:border-t-0 md:odd:border-r md:odd:border-r-[var(--hr-hair)]">
            <button type="button" onClick={() => onOpen(b)} className="group hr-focus flex min-h-14 w-full min-w-0 items-center gap-3 px-3.5 py-2.5 text-left transition-colors hover:bg-[var(--hr-hover)]">
              <TypeMark icon={b.icon} size={26} />
              <span className="min-w-0 flex-1">
                <span className="hr-wrap block text-[13px] font-medium leading-5">{b.name}</span>
                <span className="hr-num hr-wrap block text-[12px] leading-4 text-[var(--hr-muted)]">
                  {b.expiring.length > 0 ? <span className="text-[var(--hr-warn)]">{t('leave.tile.expires', { n: figure(b.expiring[0]?.amount ?? 0), day: fmtDay(b.expiring[0]?.day ?? '') })}</span> : b.booked + b.pending > 0 ? t('leave.tile.booked', { n: figure(b.booked + b.pending) }) : t('leave.tile.taken', { n: figure(b.taken) })}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-1.5">
                <span className={`hr-mono hr-num text-[26px] font-light leading-none tracking-tight ${b.available !== null && b.available < 0 ? 'text-[var(--hr-bad)]' : ''}`}>{figure(b.available)}</span>
                <span className="text-[12px] text-[var(--hr-muted)]">{unitWord(b.unit, b.available)}</span>
              </span>
              <RowCue />
            </button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

export function usePickPerson(entity: string): { items: { value: string; label: string; sub?: string }[] } {
  const live = useOp<{ people: { employment: string; name: string; number: string; title: string }[] }>('people.directory', { entity: entity === '' ? undefined : entity, limit: 500 }, ['employees', 'employments'], { name: 'leave.people.pick' });
  return { items: (live.data?.people ?? []).map((p) => ({ value: p.employment, label: p.name, sub: `${p.number}${p.title !== '' ? ` · ${p.title}` : ''}` })) };
}

export { Picker };
