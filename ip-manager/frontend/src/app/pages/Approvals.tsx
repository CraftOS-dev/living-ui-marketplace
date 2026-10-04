/**
 * Licensed product approvals: every product a licensee submits moves
 * through concept, pre-production, production sample, packaging and final
 * product. A board by stage (or a list), filters by licence, licensee and
 * status, and a drawer to review images and decide.
 */
import { useMemo, useState } from 'react';
import { PackageCheck, Plus, Search } from 'lucide-react';
import { Button, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10 } from '../lib/format.ts';
import { APPROVAL_STAGE_LABEL, APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from '../lib/labels.ts';
import { useHashParam } from '../lib/router.ts';
import type { AgreementRec, ApprovalRec, ApprovalStatus, PartyRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { EmptyHint, ErrorBox, GroupHeader, Loading, PageHeader, Pill, Ref, Section, Segmented, Toolbar } from '../components/ui.tsx';
import {
  AGREEMENT_SEARCH,
  APPROVAL_AGREEMENT_FILTER,
  ApprovalCard,
  ApprovalDrawer,
  DueLabel,
  NewProductDialog,
  PARTY_SEARCH,
  STAGES,
  Thumb,
  agreementLabel,
  awaitingDecision,
  partyLabel,
} from '../components/dealsApprovals.tsx';
import { RecordFilter, expandOne } from '../components/dealsShared.tsx';

const STATUS_OPTIONS = [
  { value: 'open', label: 'Waiting on us' },
  ...(Object.keys(APPROVAL_STATUS_LABEL) as ApprovalStatus[]).map((s) => ({ value: s, label: APPROVAL_STATUS_LABEL[s] })),
];

type View = 'board' | 'list';

export function ApprovalsPage(): React.JSX.Element {
  const { can, vocab, propertyName } = useApp();
  const [agreement, setAgreement] = useHashParam('agreement', '');
  const [licensee, setLicensee] = useHashParam('licensee', '');
  const [status, setStatus] = useHashParam('status', '');
  const [viewParam, setView] = useHashParam('view', 'board');
  const [openId, setOpenId] = useHashParam('open', '');
  const [creating, setCreating] = useState(false);
  const view: View = viewParam === 'list' ? 'list' : 'board';

  const serverFilter = [agreement !== '' ? `agreement = "${agreement}"` : '', licensee !== '' ? `licensee = "${licensee}"` : ''].filter((x) => x !== '').join(' && ');
  const all = useCollection<ApprovalRec>('approvals', {
    ...(serverFilter !== '' ? { filter: serverFilter } : {}),
    sort: '-updated',
    expand: 'licensee,agreement',
  });

  const rows = useMemo(() => {
    const list = all.records.filter((a) => {
      if (status === '') return true;
      if (status === 'open') return awaitingDecision(a.status);
      return a.status === status;
    });
    return list.slice().sort((x, y) => {
      const dx = d10(x.due_date);
      const dy = d10(y.due_date);
      if (dx === '' && dy !== '') return 1;
      if (dy === '' && dx !== '') return -1;
      return dx.localeCompare(dy);
    });
  }, [all.records, status]);

  const licenseeName = (a: ApprovalRec): string => expandOne<PartyRec>(a, 'licensee')?.name ?? '';
  const agreementOf = (a: ApprovalRec): AgreementRec | null => expandOne<AgreementRec>(a, 'agreement');
  const filtered = agreement !== '' || licensee !== '' || status !== '';
  const clear = (): void => {
    setAgreement('');
    setLicensee('');
    setStatus('');
  };
  const waiting = all.records.filter((a) => awaitingDecision(a.status)).length;

  const columns: Col<ApprovalRec>[] = [
    { key: 'thumb', label: 'Image', sortable: false, value: (a) => (a.images.length ? 'Yes' : ''), render: (a) => <Thumb a={a} size="sm" /> },
    { key: 'product_name', label: 'Product', render: (a) => <span className="font-medium">{a.product_name}</span> },
    { key: 'licensee', label: 'Licensee', value: licenseeName, render: licenseeName },
    {
      key: 'agreement',
      label: 'Licence',
      value: (a) => agreementOf(a)?.ref ?? '',
      render: (a) => <Ref>{agreementOf(a)?.ref ?? ''}</Ref>,
    },
    { key: 'property', label: vocab.property, value: (a) => propertyName(a.property), render: (a) => propertyName(a.property), optional: true },
    { key: 'sku', label: 'SKU', render: (a) => <Ref>{a.sku}</Ref> },
    { key: 'category', label: 'Category' },
    { key: 'stage', label: 'Stage', value: (a) => STAGES.indexOf(a.stage), render: (a) => APPROVAL_STAGE_LABEL[a.stage] },
    { key: 'status', label: 'Status', value: (a) => APPROVAL_STATUS_LABEL[a.status], render: (a) => <Pill tone={APPROVAL_STATUS_TONE[a.status]}>{APPROVAL_STATUS_LABEL[a.status]}</Pill> },
    { key: 'revision', label: 'Rev', align: 'right', value: (a) => a.revision || 1 },
    { key: 'due_date', label: 'Due', value: (a) => d10(a.due_date), render: (a) => <DueLabel a={a} /> },
  ];

  const newButton = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={14} aria-hidden /> New product
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title="Product approvals"
        meta={all.loading ? undefined : waiting > 0 ? `${waiting} waiting on us` : String(all.records.length)}
        subtitle="Products your licensees make under merchandise and other licences. Review each stage, from the first concept to the final product, and keep every round on file."
        actions={newButton}
      />

      <Toolbar>
        <div className="w-full sm:w-64">
          <RecordFilter<AgreementRec>
            collection="agreements"
            value={agreement}
            onChange={setAgreement}
            labelOf={agreementLabel}
            searchFields={AGREEMENT_SEARCH}
            filter={APPROVAL_AGREEMENT_FILTER}
            allLabel="All licences"
            ariaLabel="Licence"
          />
        </div>
        <div className="w-full sm:w-56">
          <RecordFilter<PartyRec>
            collection="parties"
            value={licensee}
            onChange={setLicensee}
            labelOf={partyLabel}
            searchFields={PARTY_SEARCH}
            allLabel="All licensees"
            ariaLabel="Licensee"
          />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label="Status" value={status} placeholder="All statuses" options={STATUS_OPTIONS} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Segmented<View>
          value={view}
          onChange={(v) => setView(v)}
          ariaLabel="View"
          options={[
            { value: 'board', label: 'Board' },
            { value: 'list', label: 'List' },
          ]}
        />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            Clear filters
          </Button>
        )}
      </Toolbar>

      {all.error !== null && all.records.length === 0 ? (
        <ErrorBox message={all.error} onRetry={all.refresh} />
      ) : all.loading ? (
        <Loading label="Loading products" />
      ) : all.records.length === 0 && !filtered ? (
        <Section title="Product approvals">
          <EmptyHint
            icon={PackageCheck}
            title="No products in approval yet"
            message="A licensee submits a concept first, then pre-production and production samples, then packaging, then the final product. Log a product when its first submission arrives."
            action={newButton}
          />
        </Section>
      ) : view === 'board' ? (
        rows.length === 0 ? (
          <Section title="Product approvals">
            <EmptyHint
              compact
              icon={Search}
              title="Nothing matches these filters"
              message="Try another licence, licensee or status."
              action={
                <Button size="sm" variant="outline" onClick={clear}>
                  Clear filters
                </Button>
              }
            />
          </Section>
        ) : (
          <div className="overflow-x-auto pb-2">
            <div className="grid min-w-[1100px] grid-cols-5 gap-3">
              {STAGES.map((stage) => {
                const items = rows.filter((a) => a.stage === stage);
                return (
                  <div key={stage} className="flex min-w-0 flex-col border border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/10">
                    <GroupHeader label={APPROVAL_STAGE_LABEL[stage]} count={items.length} />
                    <div className="flex flex-col gap-2 p-2">
                      {items.length === 0 ? (
                        <p className="px-1 py-3 text-center text-xs text-[var(--agent-app-muted)]">Nothing at this stage</p>
                      ) : (
                        items.map((a) => <ApprovalCard key={a.id} a={a} licensee={licenseeName(a)} onOpen={() => setOpenId(a.id)} />)
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )
      ) : (
        <Section title="Products" flush>
          <DataTable<ApprovalRec>
            tableId="approvals"
            exportName="product-approvals"
            rows={rows}
            columns={columns}
            dense
            onRowClick={(a) => setOpenId(a.id)}
            empty={
              <EmptyHint
                compact
                icon={Search}
                title="Nothing matches these filters"
                message="Try another licence, licensee or status."
                action={
                  <Button size="sm" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            }
          />
        </Section>
      )}

      {creating && (
        <NewProductDialog
          defaultAgreement={agreement}
          onClose={() => setCreating(false)}
          onCreated={(a) => {
            all.refresh();
            setOpenId(a.id);
          }}
        />
      )}
      {openId !== '' && <ApprovalDrawer id={openId} onClose={() => setOpenId('')} onChanged={all.refresh} />}
    </div>
  );
}
