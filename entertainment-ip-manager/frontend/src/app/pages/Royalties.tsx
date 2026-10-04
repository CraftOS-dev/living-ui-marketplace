/**
 * Royalties and seals: royalty statements from licensees (expected ones
 * come from each licence's reporting terms), the seal orders (証紙) with
 * the used-against-manufactured control per licence, and the minimum
 * guarantee position of every active licence.
 */
import { useMemo, useState } from 'react';
import { Plus, Receipt, Search, Stamp } from 'lucide-react';
import { Button, Select, Tabs, TabsContent, TabsList, TabsTrigger, cn } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney, relLabel } from '../lib/format.ts';
import { enumOptions, t } from '../lib/i18n.ts';
import { navigate, useHashParam, useRoute } from '../lib/router.ts';
import type { AgreementRec, PartyRec, RoyaltyReportRec, SealOrderRec } from '../lib/records.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, ListRow, Loading, PageHeader, Ref, Section, StatTile, TONE_TEXT, Toolbar } from '../components/ui.tsx';
import { expandOne } from '../components/licShared.tsx';
import { MgTable, NewStatementDialog, StatementDrawer, payable, periodText, statementLate } from '../components/licRoyalties.tsx';
import { OrderSealsDialog, SealOrderTable, VarianceTable } from '../components/licSeals.tsx';
import type { VarianceRow } from '../components/licSeals.tsx';

type TabKey = 'statements' | 'seals' | 'mg';

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

function StatementsTab({ onOpen }: { onOpen: (id: string) => void }): React.JSX.Element {
  const { can } = useApp();
  const reports = useCollection<RoyaltyReportRec>('royalty_reports', { sort: '-period_end', expand: 'agreement,agreement.counterparty' });
  const [status, setStatus] = useHashParam('status', '');
  const [agreement, setAgreement] = useHashParam('agreement', '');
  const [late, setLate] = useHashParam('late', '');
  const [creating, setCreating] = useState(false);

  const agreementOf = (r: RoyaltyReportRec): AgreementRec | null => expandOne<AgreementRec>(r, 'agreement');
  const licenseeOf = (r: RoyaltyReportRec): string => {
    const a = agreementOf(r);
    return a !== null ? (expandOne<PartyRec>(a, 'counterparty')?.name ?? '') : '';
  };
  const agreementOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of reports.records) {
      const a = expandOne<AgreementRec>(r, 'agreement');
      if (a !== null) m.set(a.id, `${a.ref} ${a.title}`.trim());
    }
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label }));
  }, [reports.records]);

  const rows = reports.records.filter((r) => {
    if (status !== '' && r.status !== status) return false;
    if (agreement !== '' && r.agreement !== agreement) return false;
    if (late === '1' && !statementLate(r)) return false;
    return true;
  });
  const lateCount = reports.records.filter(statementLate).length;
  const unpaid = reports.records.filter((r) => r.status === 'received');
  const disputed = reports.records.filter((r) => r.status === 'disputed').length;
  const filtered = status !== '' || agreement !== '' || late === '1';
  const clear = (): void => {
    setStatus('');
    setAgreement('');
    setLate('');
  };

  const columns: Col<RoyaltyReportRec>[] = [
    { key: 'agreement', label: t('Licence'), value: (r) => agreementOf(r)?.ref ?? '', render: (r) => <Ref className="whitespace-nowrap">{agreementOf(r)?.ref ?? ''}</Ref> },
    { key: 'licensee', label: t('Licensee'), value: licenseeOf, render: (r) => <span className="block max-w-[12rem] truncate">{licenseeOf(r)}</span> },
    { key: 'period', label: t('Period'), value: (r) => d10(r.period_end), render: (r) => <span className="whitespace-nowrap">{periodText(r)}</span> },
    {
      key: 'due_date',
      label: t('Due date'),
      value: (r) => d10(r.due_date),
      render: (r) => (
        <span className={cn('whitespace-nowrap', statementLate(r) && TONE_TEXT.bad)} title={statementLate(r) ? relLabel(r.due_date) : undefined}>
          {fmtDate(r.due_date)}
          {statementLate(r) && <span className="ml-1 text-xs">{relLabel(r.due_date)}</span>}
        </span>
      ),
    },
    { key: 'status', label: t('Status'), render: (r) => <EnumPill field="royalty_reports.status" value={r.status} /> },
    { key: 'royalty_due', label: t('Royalty due'), align: 'right', value: (r) => r.royalty_due, render: (r) => <span className="whitespace-nowrap">{r.royalty_due ? fmtMoney(r.royalty_due, r.currency) : ''}</span> },
    { key: 'mg_credit', label: t('MG credit'), align: 'right', value: (r) => r.mg_credit, render: (r) => <span className="whitespace-nowrap">{r.mg_credit ? fmtMoney(r.mg_credit, r.currency) : ''}</span> },
    {
      key: 'late_interest',
      label: t('Late interest'),
      align: 'right',
      value: (r) => r.late_interest,
      render: (r) => <span className={cn('whitespace-nowrap', r.late_interest > 0 && TONE_TEXT.bad)}>{r.late_interest ? fmtMoney(r.late_interest, r.currency) : ''}</span>,
    },
    { key: 'payable', label: t('Payable'), align: 'right', value: (r) => payable(r), render: (r) => <span className="whitespace-nowrap">{payable(r) ? fmtMoney(payable(r), r.currency) : ''}</span>, optional: true },
    { key: 'paid_amount', label: t('Paid'), align: 'right', value: (r) => r.paid_amount, render: (r) => <span className="whitespace-nowrap">{r.paid_amount ? fmtMoney(r.paid_amount, r.currency) : ''}</span> },
    { key: 'gross_sales', label: t('Gross sales'), align: 'right', value: (r) => r.gross_sales, render: (r) => <span className="whitespace-nowrap">{r.gross_sales ? fmtMoney(r.gross_sales, r.currency) : ''}</span>, optional: true },
  ];

  const noMatch = (
    <EmptyHint
      compact
      icon={Search}
      title={t('Nothing matches these filters')}
      message={t('Try another status or licence.')}
      action={
        <Button size="sm" variant="outline" onClick={clear}>
          {t('Clear filters')}
        </Button>
      }
    />
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label={t('Late statements')} value={String(lateCount)} tone={lateCount > 0 ? 'bad' : undefined} sub={t('Expected and past the due date')} onClick={() => setLate(late === '1' ? '' : '1')} />
        <StatTile label={t('Received, not paid')} value={String(unpaid.length)} tone={unpaid.length > 0 ? 'warn' : undefined} sub={t('Check the lines, then record the payment')} onClick={() => setStatus(status === 'received' ? '' : 'received')} />
        <StatTile label={t('Disputed')} value={String(disputed)} tone={disputed > 0 ? 'bad' : undefined} sub={t('Short payments under discussion')} onClick={() => setStatus(status === 'disputed' ? '' : 'disputed')} />
      </div>

      <Toolbar className="mb-0">
        <div className="w-full sm:w-44">
          <Select aria-label={t('Status')} value={status} placeholder={t('All statuses')} options={enumOptions('royalty_reports.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <div className="w-full sm:w-56">
          <Select aria-label={t('Licence')} value={agreement} placeholder={t('All licences')} options={agreementOptions} onChange={(e) => setAgreement(e.target.value)} />
        </div>
        <Checkbox checked={late === '1'} onChange={(v) => setLate(v ? '1' : '')} label={t('Late only')} />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      {reports.error !== null && reports.records.length === 0 ? (
        <ErrorBox message={reports.error} onRetry={reports.refresh} />
      ) : reports.loading ? (
        <Loading />
      ) : (
        <Section
          title={t('Royalty statements')}
          meta={filtered ? t('{n} shown', { n: rows.length }) : String(reports.records.length)}
          flush
          actions={
            can.edit ? (
              <Button size="sm" variant="outline" onClick={() => setCreating(true)}>
                <Plus size={13} aria-hidden /> {t('Expect a statement')}
              </Button>
            ) : undefined
          }
        >
          {reports.records.length === 0 ? (
            <EmptyHint
              icon={Receipt}
              title={t('No royalty statements yet')}
              message={t('Statements are expected from each licence\'s reporting terms (monthly, quarterly and so on). Set the reporting frequency on a licence, or add a statement by hand.')}
              action={
                can.edit ? (
                  <Button size="sm" onClick={() => setCreating(true)}>
                    {t('Expect a statement')}
                  </Button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="hidden md:block">
                <DataTable<RoyaltyReportRec> tableId="royalty-statements" exportName="royalty-statements" rows={rows} columns={columns} dense onRowClick={(r) => onOpen(r.id)} empty={noMatch} />
              </div>
              <div className="md:hidden">
                {rows.length === 0
                  ? noMatch
                  : rows.map((r) => (
                      <ListRow
                        key={r.id}
                        onClick={() => onOpen(r.id)}
                        primary={`${agreementOf(r)?.ref ?? ''} ${licenseeOf(r)}`.trim()}
                        secondary={
                          <span className={cn(statementLate(r) && TONE_TEXT.bad)}>
                            {periodText(r)}
                            {d10(r.due_date) !== '' ? ` · ${t('Due {date}', { date: fmtDate(r.due_date) })}` : ''}
                          </span>
                        }
                        trailing={
                          <div className="flex flex-col items-end gap-1">
                            <EnumPill field="royalty_reports.status" value={r.status} />
                            {r.royalty_due ? <span className="text-xs tabular-nums">{fmtMoney(r.royalty_due, r.currency)}</span> : null}
                          </div>
                        }
                      />
                    ))}
              </div>
            </>
          )}
        </Section>
      )}
      {creating && <NewStatementDialog onClose={() => setCreating(false)} onCreated={onOpen} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Seals                                                               */
/* ------------------------------------------------------------------ */

function SealsTab(): React.JSX.Element {
  const { can } = useApp();
  const orders = useCollection<SealOrderRec>('seal_orders', { sort: '-created', expand: 'product,licensee,agreement' });
  const [status, setStatus] = useHashParam('sstatus', '');
  const [varAgreement, setVarAgreement] = useHashParam('va', '');
  const [ordering, setOrdering] = useState(false);

  const agreementOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const o of orders.records) {
      const a = expandOne<AgreementRec>(o, 'agreement');
      if (a !== null) m.set(a.id, `${a.ref} ${a.title}`.trim());
    }
    return [...m.entries()].sort((x, y) => x[1].localeCompare(y[1])).map(([value, label]) => ({ value, label }));
  }, [orders.records]);
  const chosen = varAgreement !== '' ? varAgreement : (agreementOptions[0]?.value ?? '');
  const variance = useLiveAsync(
    () => (chosen !== '' ? op<{ rows: VarianceRow[] }>('seals/variance', { agreement_id: chosen }) : Promise.resolve({ rows: [] as VarianceRow[] })),
    [chosen],
    ['seal_orders', 'royalty_lines'],
  );
  const rows = orders.records.filter((o) => status === '' || o.status === status);
  const vrows = variance.data?.rows ?? [];
  const flagged = vrows.filter((r) => r.flag).length;

  return (
    <div className="flex flex-col gap-4">
      <Toolbar className="mb-0">
        <div className="w-full sm:w-44">
          <Select aria-label={t('Status')} value={status} placeholder={t('All statuses')} options={enumOptions('seal_orders.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
      </Toolbar>
      {orders.error !== null && orders.records.length === 0 ? (
        <ErrorBox message={orders.error} onRetry={orders.refresh} />
      ) : orders.loading ? (
        <Loading />
      ) : (
        <Section
          title={t('Seal orders')}
          meta={String(rows.length)}
          flush
          actions={
            can.licensing ? (
              <Button size="sm" variant="outline" onClick={() => setOrdering(true)}>
                <Plus size={13} aria-hidden /> {t('Order seals')}
              </Button>
            ) : undefined
          }
        >
          <SealOrderTable orders={rows} showProduct tableId="seal-orders" />
        </Section>
      )}

      <Section title={t('Seals used against manufactured quantity')} meta={flagged > 0 ? t('{n} flagged', { n: flagged }) : undefined}>
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <p className="max-w-xl text-xs leading-relaxed text-[var(--agent-app-muted)]">
            {t('For each product of a licence: seals the licensee reports as used, against the manufactured quantity on its royalty statements. More seals used than manufactured is flagged.')}
          </p>
          {agreementOptions.length > 0 && (
            <div className="w-full sm:w-64">
              <Select aria-label={t('Licence')} value={chosen} options={agreementOptions} onChange={(e) => setVarAgreement(e.target.value)} />
            </div>
          )}
        </div>
        {chosen === '' ? (
          <EmptyHint compact icon={Stamp} title={t('No seals issued yet')} message={t('Once seals are issued for a licence, the comparison shows here.')} />
        ) : variance.loading ? (
          <Loading />
        ) : variance.error !== null ? (
          <ErrorBox message={variance.error} onRetry={variance.reload} />
        ) : vrows.length === 0 ? (
          <p className="text-[13px] text-[var(--agent-app-muted)]">{t('This licence has no products yet.')}</p>
        ) : (
          <VarianceTable rows={vrows} />
        )}
      </Section>
      {ordering && <OrderSealsDialog onClose={() => setOrdering(false)} />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function RoyaltiesPage(): React.JSX.Element {
  const route = useRoute();
  const [tabParam, setTab] = useHashParam('tab', 'statements');
  const [openParam, setOpen] = useHashParam('open', '');
  const tab: TabKey = tabParam === 'seals' || tabParam === 'mg' ? tabParam : 'statements';
  const openId = openParam !== '' ? openParam : route.id;
  // A deep link (#/royalties/<id>) carries the id in the path: drop it, keep the filters.
  const close = (): void => {
    if (route.id === '') {
      setOpen('');
      return;
    }
    const params: Record<string, string> = {};
    route.params.forEach((v, k) => {
      if (k !== 'open') params[k] = v;
    });
    navigate('royalties', undefined, params);
  };

  return (
    <div>
      <PageHeader
        title={t('Royalties and seals')}
        subtitle={t('Statements from licensees priced from each licence, minimum guarantees, and authenticity seals (証紙) checked against what was manufactured.')}
      />
      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="statements" className="whitespace-nowrap">
              {t('Statements')}
            </TabsTrigger>
            <TabsTrigger value="seals" className="whitespace-nowrap">
              {t('Seals')}
            </TabsTrigger>
            <TabsTrigger value="mg" className="whitespace-nowrap">
              {t('Minimum guarantees')}
            </TabsTrigger>
          </TabsList>
        </div>
        <TabsContent value="statements">
          <StatementsTab onOpen={setOpen} />
        </TabsContent>
        <TabsContent value="seals">
          <SealsTab />
        </TabsContent>
        <TabsContent value="mg">
          <MgTable />
        </TabsContent>
      </Tabs>
      {openId !== '' && <StatementDrawer key={openId} id={openId} onClose={close} />}
    </div>
  );
}
