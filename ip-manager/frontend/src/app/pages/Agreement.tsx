/**
 * One agreement: header with the deal at a glance and a quick status
 * change, then tabs for the rights scope, obligation deadlines, money
 * (terms, payments, royalty reports, recoupment), product approvals,
 * documents and history.
 */
import { useMemo, useState } from 'react';
import { CalendarClock, ChevronDown, FileSignature, PackageCheck, Pencil, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react';
import { Button, Card, DropdownMenu, Tabs, TabsContent, TabsList, TabsTrigger, toast, useConfirm, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { deleteRecord, opToast, updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { AGREEMENT_TYPE_LABEL, APPROVAL_STAGE_LABEL, APPROVAL_STATUS_LABEL, APPROVAL_STATUS_TONE } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, ApprovalRec, DeadlineRec, GrantRec, PartyRec, RoyaltyReportRec } from '../lib/types.ts';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, Fact, FactGrid, ListRow, Loading, Notice, Pill, Prose, Ref, Section, Tag } from '../components/ui.tsx';
import { AgreementForm } from '../components/dealsAgreementForm.tsx';
import { ApprovalDrawer, DueLabel, NewProductDialog, Thumb } from '../components/dealsApprovals.tsx';
import { AuditTrail, auditFilter } from '../components/dealsHistory.tsx';
import { ScopePanel } from '../components/dealsGrants.tsx';
import { MoneyPanel } from '../components/dealsMoney.tsx';
import {
  AGREEMENT_STATUSES,
  AGREEMENT_STATUS_LABEL,
  AgreementStatusPill,
  DirectionPill,
  ENDING_STATUSES,
  EXCLUSIVITY_LABEL,
  newest,
  termText,
} from '../components/dealsShared.tsx';
import type { AgreementStatus } from '../components/dealsShared.tsx';

type TabKey = 'scope' | 'obligations' | 'money' | 'approvals' | 'documents' | 'history';

/** Plain text of the notes field (a rich-text field that may hold HTML). */
function plainText(html: string): string {
  if (html.trim() === '') return '';
  if (!html.includes('<')) return html;
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return (doc.body.textContent ?? '').trim();
}

export function AgreementPage({ id }: { id: string }): React.JSX.Element {
  const { can, vocab, userName, propertyName } = useApp();
  const live = useRecord<AgreementRec>('agreements', id !== '' ? id : null);
  const [saved, setSaved] = useState<AgreementRec | null>(null);
  const a = newest(live.record, saved);
  const { loading, error } = live;
  const party = useRecord<PartyRec>('parties', a !== null && a.counterparty !== '' ? a.counterparty : null);
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `agreement = "${id}"`, sort: 'due_date' });
  const approvals = useCollection<ApprovalRec>('approvals', { filter: `agreement = "${id}"`, sort: 'due_date' });
  const [tabParam, setTab] = useHashParam('tab', 'scope');
  const [edit, setEdit] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  if (loading) return <Loading label="Loading agreement" />;
  if (a === null) {
    return (
      <Card>
        <EmptyHint
          icon={FileSignature}
          title="This agreement could not be opened"
          message={error !== null && error !== '' ? `${error} It may have been deleted, or the link is incomplete.` : 'It may have been deleted, or the link is incomplete.'}
          action={
            <Button variant="outline" onClick={() => navigate('agreements')}>
              Back to Agreements
            </Button>
          }
        />
      </Card>
    );
  }

  const showApprovals = a.agreement_type === 'merchandise' || a.direction === 'out' || approvals.records.length > 0;
  const tabs: TabKey[] = ['scope', 'obligations', 'money', ...(showApprovals ? (['approvals'] as TabKey[]) : []), 'documents', ...(can.edit ? (['history'] as TabKey[]) : [])];
  const tab: TabKey = (tabs as string[]).includes(tabParam) ? (tabParam as TabKey) : 'scope';
  const openObligations = deadlines.records.filter((d) => d.status === 'open').length;

  const changeStatus = async (s: AgreementStatus): Promise<void> => {
    const label = AGREEMENT_STATUS_LABEL[s];
    if (ENDING_STATUSES.includes(s)) {
      const note =
        s === 'expired'
          ? 'Open obligation deadlines that are still ahead will be cancelled.'
          : 'Open obligation deadlines that are still ahead will be cancelled, and its grants stop counting in rights availability and conflict checks.';
      if (!(await confirm(`Mark ${a.ref || 'this agreement'} as ${label.toLowerCase()}? ${note}`, `Mark as ${label.toLowerCase()}`))) return;
    }
    try {
      setSaved(await updateRecord<AgreementRec>('agreements', a.id, { status: s }));
      deadlines.refresh();
      toast.success(`Marked as ${label.toLowerCase()}. Obligation deadlines updated.`);
    } catch {
      /* toast shown by the client */
    }
  };

  const remove = async (): Promise<void> => {
    if (
      !(await confirm(
        `Delete ${a.ref || 'this agreement'}? Its rights scope, obligation deadlines, royalty reports and product approvals are deleted with it. Documents stay. This cannot be undone.`,
        'Delete agreement',
      ))
    )
      return;
    try {
      await deleteRecord('agreements', a.id);
      toast.success(`${a.ref || 'Agreement'} deleted`);
      navigate('agreements');
    } catch {
      /* toast shown by the client */
    }
  };

  const notes = plainText(a.notes);

  return (
    <div>
      {confirmEl}
      <Card className="mb-5">
        <div className="px-5 py-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('agreements')} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  Agreements
                </a>
                <span className="text-xs text-[var(--agent-app-muted)]" aria-hidden>
                  /
                </span>
                <Ref>{a.ref}</Ref>
                <Tag>{AGREEMENT_TYPE_LABEL[a.agreement_type]}</Tag>
                <DirectionPill direction={a.direction} />
                {can.edit ? (
                  <DropdownMenu
                    align="left"
                    trigger={
                      <span className="inline-flex items-center gap-0.5" title="Change status" aria-label={`Status: ${AGREEMENT_STATUS_LABEL[a.status]}. Change status`}>
                        <AgreementStatusPill status={a.status} />
                        <ChevronDown size={12} className="text-[var(--agent-app-muted)]" aria-hidden />
                      </span>
                    }
                    items={AGREEMENT_STATUSES.filter((s) => s !== a.status).map((s) => ({
                      label: `Mark as ${AGREEMENT_STATUS_LABEL[s].toLowerCase()}`,
                      onSelect: () => void changeStatus(s),
                      danger: s === 'terminated',
                    }))}
                  />
                ) : (
                  <AgreementStatusPill status={a.status} />
                )}
                {a.ai_extracted && (
                  <Tag title="Terms were read from the contract by CraftBot and accepted by a person in the Inbox">
                    <Sparkles size={10} className="mr-1" aria-hidden />
                    AI extracted
                  </Tag>
                )}
              </div>
              <h1 className="mt-2 text-xl font-semibold tracking-tight">{a.title}</h1>
            </div>
            {(can.edit || can.manage) && (
              <div className="flex shrink-0 flex-wrap gap-2">
                {can.edit && (
                  <Button variant="outline" size="sm" onClick={() => setEdit(true)}>
                    <Pencil size={13} aria-hidden /> Edit
                  </Button>
                )}
                {can.manage && (
                  <Button variant="ghost" size="sm" className="text-red-600" onClick={() => void remove()}>
                    <Trash2 size={13} aria-hidden /> Delete
                  </Button>
                )}
              </div>
            )}
          </div>
          <div className="mt-4">
            <FactGrid cols={4}>
              <Fact
                label="Counterparty"
                value={
                  a.counterparty !== '' ? (
                    <a className="hover:underline" href={href('people', a.counterparty)}>
                      {party.record?.name ?? 'Loading...'}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              <Fact
                label={vocab.property}
                value={
                  a.property !== '' ? (
                    <a className="hover:underline" href={href('property', a.property)}>
                      {propertyName(a.property)}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              <Fact label="Term" value={termText(a)} />
              <Fact label="Exclusivity" value={EXCLUSIVITY_LABEL[a.exclusivity] ?? ''} />
            </FactGrid>
          </div>
          {a.summary !== '' && <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-[var(--agent-app-text)]/85">{a.summary}</p>}
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="scope" className="whitespace-nowrap">Scope</TabsTrigger>
            <TabsTrigger value="obligations" className="whitespace-nowrap">
              Obligations{openObligations > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openObligations}</span>}
            </TabsTrigger>
            <TabsTrigger value="money" className="whitespace-nowrap">Money</TabsTrigger>
            {showApprovals && (
              <TabsTrigger value="approvals" className="whitespace-nowrap">
                Product approvals{approvals.records.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{approvals.records.length}</span>}
              </TabsTrigger>
            )}
            <TabsTrigger value="documents" className="whitespace-nowrap">Documents</TabsTrigger>
            {can.edit && <TabsTrigger value="history" className="whitespace-nowrap">History</TabsTrigger>}
          </TabsList>
        </div>

        <TabsContent value="scope">
          <div className="flex flex-col gap-4">
            <Section title="Terms">
              <FactGrid cols={4}>
                <Fact label="Signed" value={fmtDate(a.signed_date)} />
                <Fact label="Effective" value={fmtDate(a.effective_date)} />
                <Fact
                  label="Renewal"
                  value={
                    a.auto_renew
                      ? `Renews automatically${a.renewal_notice_days ? `, ${a.renewal_notice_days} days notice to stop` : ''}`
                      : a.renewal_notice_days
                        ? `${a.renewal_notice_days} days notice to renew`
                        : ''
                  }
                />
                <Fact label="Territory in words" value={a.territory_summary} />
                <Fact label="Governing law" value={a.governing_law} />
                <Fact label="Option period ends" value={fmtDate(a.option_period_end)} />
                <Fact label="Reversion" value={fmtDate(a.reversion_date)} />
                <Fact label="Sell-off" value={a.sell_off_days ? `${a.sell_off_days} days after the term` : ''} />
                <Fact label="Our entity" value={a.our_entity} />
                <Fact label="Responsible" value={userName(a.responsible)} />
                <Fact label="Author grant" value={a.author_grant ? (a.covers_publication ? 'Yes, covers publication' : 'Yes') : 'No'} />
              </FactGrid>
              {notes !== '' && <Prose className="mt-4 border-t border-[var(--agent-app-border)] pt-3 text-[var(--agent-app-text)]/85">{notes}</Prose>}
            </Section>
            <ScopePanel agreement={a} />
          </div>
        </TabsContent>

        <TabsContent value="obligations">
          <ObligationsTab
            agreement={a}
            deadlines={deadlines.records}
            loading={deadlines.loading}
            onEdit={can.edit ? () => setEdit(true) : null}
            onChanged={deadlines.refresh}
          />
        </TabsContent>

        <TabsContent value="money">
          <MoneyPanel agreement={a} />
        </TabsContent>

        {showApprovals && (
          <TabsContent value="approvals">
            <ApprovalsTab agreement={a} approvals={approvals.records} onChanged={approvals.refresh} />
          </TabsContent>
        )}

        <TabsContent value="documents">
          <DocumentsPanel relation="agreement" relationId={a.id} defaultType="agreement" extraction />
        </TabsContent>

        {can.edit && (
          <TabsContent value="history">
            <HistoryTab agreementId={a.id} />
          </TabsContent>
        )}
      </Tabs>

      {edit && (
        <AgreementForm
          agreement={a}
          onClose={() => setEdit(false)}
          onSaved={(rec) => {
            setSaved(rec);
            deadlines.refresh();
          }}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Obligations                                                         */
/* ------------------------------------------------------------------ */

function ObligationsTab({
  agreement,
  deadlines,
  loading,
  onEdit,
  onChanged,
}: {
  agreement: AgreementRec;
  deadlines: DeadlineRec[];
  loading: boolean;
  onEdit: (() => void) | null;
  onChanged: () => void;
}): React.JSX.Element {
  const { actions, dialogs, canEdit } = useDeadlineActions(onChanged);
  const [busy, setBusy] = useState(false);
  const open = deadlines.filter((d) => d.status === 'open').length;

  const sync = async (): Promise<void> => {
    setBusy(true);
    const r = await opToast<{ created: number; updated: number; cancelled: number }>('agreements/sync', { agreement_id: agreement.id });
    setBusy(false);
    if (r === null) return;
    onChanged();
    toast.success(
      r.created + r.updated + r.cancelled === 0
        ? 'Obligations are already up to date.'
        : `Obligations synced: ${r.created} added, ${r.updated} updated, ${r.cancelled} cancelled.`,
    );
  };

  return (
    <div className="flex flex-col gap-4">
      <Notice icon={CalendarClock}>
        These dates come from the agreement terms: option period, term end and notice, payments, royalty reports, sell-off and reversion. They update
        automatically when the agreement changes. A date someone moved by hand is locked and stays where they put it.
      </Notice>
      <Section
        title="Obligations"
        meta={deadlines.length ? `${open} open of ${deadlines.length}` : undefined}
        flush
        actions={
          canEdit ? (
            <Button size="sm" variant="outline" onClick={() => void sync()} loading={busy}>
              <RefreshCw size={13} aria-hidden /> Sync obligations
            </Button>
          ) : undefined
        }
      >
        {loading ? (
          <Loading label="Loading obligations" />
        ) : (
          <DeadlineList
            deadlines={deadlines}
            actions={canEdit ? actions : null}
            bulk={canEdit}
            empty={
              <EmptyHint
                compact
                icon={CalendarClock}
                title="No obligations yet"
                message="Add dates to the agreement (term end, notice period, option period, payments or reporting) and the deadlines appear here."
                action={
                  onEdit !== null ? (
                    <Button size="sm" variant="outline" onClick={onEdit}>
                      Edit the agreement
                    </Button>
                  ) : undefined
                }
              />
            }
          />
        )}
      </Section>
      {dialogs}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Product approvals                                                   */
/* ------------------------------------------------------------------ */

function ApprovalsTab({ agreement, approvals, onChanged }: { agreement: AgreementRec; approvals: ApprovalRec[]; onChanged: () => void }): React.JSX.Element {
  const { can } = useApp();
  const [creating, setCreating] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  return (
    <Section
      title="Product approvals"
      meta={approvals.length ? String(approvals.length) : undefined}
      flush
      actions={
        <>
          <a
            href={href('approvals', undefined, { agreement: agreement.id })}
            className="hidden text-xs font-medium text-[var(--agent-app-accent)] hover:underline sm:inline"
          >
            Open the approvals board
          </a>
          {can.edit && approvals.length > 0 && (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus size={13} aria-hidden /> New product
            </Button>
          )}
        </>
      }
    >
      {approvals.length === 0 ? (
        <EmptyHint
          compact
          icon={PackageCheck}
          title="No products submitted under this licence"
          message="The licensee submits each product for approval: concept, then samples, then packaging, then the final product."
          action={
            can.edit ? (
              <Button size="sm" onClick={() => setCreating(true)}>
                New product
              </Button>
            ) : undefined
          }
        />
      ) : (
        approvals.map((p) => (
          <ListRow
            key={p.id}
            leading={<Thumb a={p} size="sm" />}
            primary={p.product_name}
            secondary={`${APPROVAL_STAGE_LABEL[p.stage]} · Rev ${p.revision || 1}${p.sku !== '' ? ` · ${p.sku}` : ''}`}
            trailing={
              <>
                <DueLabel a={p} className="hidden sm:inline" />
                <Pill tone={APPROVAL_STATUS_TONE[p.status]}>{APPROVAL_STATUS_LABEL[p.status]}</Pill>
              </>
            }
            onClick={() => setOpenId(p.id)}
          />
        ))
      )}
      <div className="border-t border-[var(--agent-app-border)] px-4 py-2 sm:hidden">
        <a href={href('approvals', undefined, { agreement: agreement.id })} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
          Open the approvals board
        </a>
      </div>
      {creating && <NewProductDialog defaultAgreement={agreement.id} onClose={() => setCreating(false)} onCreated={onChanged} />}
      {openId !== null && <ApprovalDrawer id={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function HistoryTab({ agreementId }: { agreementId: string }): React.JSX.Element {
  const grants = useCollection<GrantRec>('grants', { filter: `agreement = "${agreementId}"` });
  const reports = useCollection<RoyaltyReportRec>('royalty_reports', { filter: `agreement = "${agreementId}"` });
  const ids = useMemo(
    () => [agreementId, ...grants.records.map((g) => g.id), ...reports.records.map((r) => r.id)],
    [agreementId, grants.records, reports.records],
  );
  // Deleted grants keep a snapshot naming the agreement.
  const filter = auditFilter(ids, `collection = "grants" && action = "delete" && changes ~ "${agreementId}"`);
  if (grants.loading || reports.loading) return <Loading label="Loading history" />;
  return <AuditTrail filter={filter} />;
}
