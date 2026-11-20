/**
 * Claims: every claim the viewer may see as dense rows (person, title,
 * submitted, lines and flags, status, amount), filtered by status, flags,
 * how it is paid, department and a search, with totals per currency.
 * Finance selects approved claims to mark them paid with one reference;
 * HR exports claims or their lines for accounting.
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, Flag, Receipt, Wallet } from 'lucide-react';
import { Money, Button, DataTable, DayPicker, Dialog, Empty, Field, Input, LoadError, Loading, PageBody, PageHeader, Picker, SearchInput, Segmented, Tag, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { ClaimStatus, Switch } from '../../components/expenses/parts.tsx';
import { op, saveText } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtStampDay, today } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { act, changed, patch, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { useUi } from '../../lib/store.tsx';
import type { Claim, ClaimList } from './types.ts';
import { READS } from './types.ts';

const PAGE = 50;

function PayManyDialog({ ids, rows, onClose, onDone }: { ids: string[]; rows: Claim[]; onClose: () => void; onDone: () => void }): React.JSX.Element {
  const [ref, setRef] = useState('');
  const [day, setDay] = useState(() => today({ entity: rows.find((r) => ids.includes(r.id))?.entity }));
  const [busy, setBusy] = useState(false);
  const chosen = rows.filter((r) => ids.includes(r.id));
  const byCur: Record<string, number> = {};
  for (const c of chosen) byCur[c.currency] = (byCur[c.currency] ?? 0) + c.payable_minor;
  return (
    <Dialog
      open
      onClose={onClose}
      title={t('exp.paid.title_many', { n: chosen.length })}
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
              void act(
                chosen.map((c) => patch(c.id, { status: 'paid' })),
                () => op('claims.mark-paid', { claims: chosen.map((c) => c.id), reference: ref.trim(), day }),
                READS,
              ).then((r) => {
                setBusy(false);
                if (r !== null) {
                  toast.success(tn('exp.paid.done_many', chosen.length));
                  onDone();
                }
              });
            }}
          >
            {t('exp.paid.title')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-3">
          {Object.entries(byCur).map(([cur, n]) => (
            <Money key={cur} minor={n} currency={cur} className="text-[15px]" />
          ))}
        </div>
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

export function ClaimsPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity } = useUi();
  const [q, setQ] = useState(query.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const status = query.get('status') ?? 'active';
  const flagged = query.get('flagged') === 'true';
  const payVia = query.get('pay_via') ?? '';
  const department = query.get('department') ?? '';
  const [limit, setLimit] = useState(PAGE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [paying, setPaying] = useState<string[] | null>(null);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => setLimit(PAGE), [debounced, status, flagged, payVia, department, entity]);
  const admin = can(me, 'expenses', 'view');
  const params = { status, q: debounced === '' ? undefined : debounced, flagged: flagged ? true : undefined, pay_via: payVia === '' ? undefined : payVia, department: department === '' ? undefined : department, entity: entity === '' ? undefined : entity, sort: status === 'submitted' ? 'oldest' : 'recent', limit };
  const live = useOp<ClaimList>('claims.list', params, READS, { name: 'claims.list' });
  const deps = useOp<{ departments: { id: string; name: string }[] }>('departments.list', {}, ['departments'], { name: 'departments.list', skip: !admin });
  const d = live.data;
  const canPay = can(me, 'expenses', 'full');

  const columns: Column<Claim>[] = useMemo(
    () => [
      { key: 'person', label: t('exp.col.person'), width: 'minmax(150px,1.4fr)', phone: 'title', sort: (c) => c.employee_name, render: (c) => <span className="truncate">{c.employee_name}</span> },
      {
        key: 'claim',
        label: t('exp.col.claim'),
        width: 'minmax(170px,2fr)',
        sort: (c) => c.number,
        render: (c) => (
          <span className="flex min-w-0 items-center gap-2">
            <span className="hr-mono shrink-0 text-[12px] text-[var(--hr-muted)]">{c.number}</span>
            <span className="truncate">{c.title}</span>
            {c.flag_count > 0 && <Tag tone="warn" className="md:hidden">{tn('exp.n_flags', c.flag_count)}</Tag>}
          </span>
        ),
      },
      { key: 'dept', label: t('exp.col.department'), width: 'minmax(110px,1fr)', hideBelow: 'xl', phone: 'hide', sort: (c) => c.department_name ?? '', render: (c) => c.department_name ?? '' },
      { key: 'submitted', label: t('exp.col.submitted'), width: '108px', mono: true, hideBelow: 'lg', phone: 'hide', sort: (c) => c.submitted_at, render: (c) => fmtStampDay(c.submitted_at, { entity: c.entity }) },
      {
        key: 'lines',
        label: t('exp.col.lines'),
        width: '120px',
        hideBelow: 'lg',
        phone: 'hide',
        sort: (c) => c.flag_count,
        render: (c) => (
          <span className="flex items-center gap-1.5">
            <span className="hr-mono text-[12px]">{c.line_count}</span>
            {(c.receipts ?? 0) > 0 && <Receipt size={12} aria-label={tn('exp.n_receipts', c.receipts ?? 0)} className="text-[var(--hr-muted)]" />}
            {c.flag_count > 0 && <Tag tone="warn">{tn('exp.n_flags', c.flag_count)}</Tag>}
          </span>
        ),
      },
      { key: 'via', label: t('exp.col.pay_via'), width: '96px', hideBelow: 'xl', phone: 'hide', render: (c) => (c.pay_via === 'payroll' ? t('exp.pay_via.payroll_short') : t('exp.pay_via.bank_short')) },
      { key: 'status', label: t('exp.col.status'), width: '118px', sort: (c) => c.status, render: (c) => <ClaimStatus c={c} /> },
      { key: 'amount', label: t('exp.col.amount'), width: '128px', align: 'right', mono: true, phone: 'end', sort: (c) => c.total_minor, render: (c) => <Money minor={c.status === 'approved' || c.status === 'paid' ? c.payable_minor : c.total_minor} currency={c.currency} /> },
    ],
    [],
  );

  const exportCsv = async (level: 'claims' | 'lines'): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('claims.export', { ...params, level, limit: undefined });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const filtered = debounced !== '' || flagged || payVia !== '' || department !== '' || status !== 'active';
  const selectable = canPay && status === 'approved';
  return (
    <>
      <PageHeader title={t('exp.claims.title')} meta={d !== null ? tn('exp.n_claims', d.total) : ''} back="#/expenses">
        {admin && (
          <>
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv('claims')} className="hidden sm:inline-flex">
              {t('exp.claims.export')}
            </Button>
            <Button size="sm" variant="ghost" icon={Download} onClick={() => void exportCsv('lines')} className="hidden sm:inline-flex">
              {t('exp.claims.export_lines')}
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('exp.claims.search')} className="w-full sm:w-[240px]" />
            <Segmented
              value={status}
              onChange={(v) => (setSelected(new Set()), setQuery({ status: v === 'active' ? undefined : v }))}
              label={t('exp.col.status')}
              size="sm"
              options={[
                { value: 'active', label: t('exp.f.active') },
                { value: 'submitted', label: t('exp.f.waiting') },
                { value: 'approved', label: t('exp.f.to_pay') },
                { value: 'paid', label: t('exp.status.paid') },
                { value: 'rejected', label: t('exp.status.rejected') },
                { value: 'any', label: t('exp.f.all') },
              ]}
            />
            <Switch checked={flagged} onChange={(v) => setQuery({ flagged: v ? 'true' : undefined })} label={t('exp.f.flagged')} />
            <Segmented
              value={payVia === '' ? 'any' : payVia}
              onChange={(v) => setQuery({ pay_via: v === 'any' ? undefined : v })}
              label={t('exp.col.pay_via')}
              size="sm"
              options={[
                { value: 'any', label: t('exp.f.any_way') },
                { value: 'payroll', label: t('exp.pay_via.payroll_short') },
                { value: 'bank', label: t('exp.pay_via.bank_short') },
              ]}
            />
            {admin && deps.data !== null && (
              <Picker value={department} onChange={(v) => setQuery({ department: v === '' ? undefined : v })} items={(deps.data?.departments ?? []).map((x) => ({ value: x.id, label: x.name }))} label={t('exp.col.department')} placeholder={t('exp.f.any_department')} clearable className="min-w-0 flex-1 sm:w-[170px] sm:flex-none" />
            )}
          </div>
          {d === null ? (
            live.error !== null ? (
              <LoadError message={live.error} onRetry={live.reload} />
            ) : (
              <Loading />
            )
          ) : (
            <DataTable
              label={t('exp.claims.title')}
              columns={columns}
              rows={d.claims}
              rowKey={(c) => c.id}
              rowHref={(c) => `#/expenses/claims/${c.number}`}
              selectable={selectable}
              selected={selected}
              onSelect={setSelected}
              selectionBar={(ids) => (
                <Button size="sm" variant="primary" icon={Wallet} onClick={() => setPaying(ids)}>
                  {t('exp.paid.title')}
                </Button>
              )}
              hasMore={d.total > d.claims.length}
              onMore={() => setLimit((l) => l + PAGE)}
              loadingMore={live.loading}
              foot={
                d.totals.length > 0 ? (
                  <div className="flex flex-wrap items-center justify-end gap-x-6 gap-y-1 px-3 py-2">
                    {d.totals.map((x) => (
                      <span key={x.currency} className="flex items-center gap-2">
                        <span className="hr-label">{tn('exp.n_claims', x.claims)}</span>
                        <Money minor={status === 'approved' ? x.awaiting_minor : x.total_minor} currency={x.currency} className="text-[13px] font-medium" />
                      </span>
                    ))}
                  </div>
                ) : undefined
              }
              empty={
                filtered ? (
                  <Empty icon={Flag} title={t('exp.claims.none_match')} action={<Button onClick={() => (setQ(''), setQuery({ status: undefined, flagged: undefined, pay_via: undefined, department: undefined }))}>{t('ui.clear_filters')}</Button>} />
                ) : (
                  <Empty icon={Receipt} title={t('exp.claims.empty')}>
                    {t('exp.claims.empty_text')}
                  </Empty>
                )
              }
            />
          )}
        </div>
      </PageBody>
      {paying !== null && d !== null && (
        <PayManyDialog
          ids={paying}
          rows={d.claims}
          onClose={() => setPaying(null)}
          onDone={() => {
            setPaying(null);
            setSelected(new Set());
            changed(...READS);
          }}
        />
      )}
    </>
  );
}
