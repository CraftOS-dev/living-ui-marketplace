/**
 * One agreement: the deal at a glance with its status, then tabs for the
 * terms, the grants (rights scope, holdbacks, committee windows), the
 * obligations the terms generate, products and royalty statements under
 * it, documents (CraftBot reads contracts and licensee reports) and the
 * history of events.
 */
import { useState } from 'react';
import { ChevronDown, FileSignature, Mail, Pencil, Sparkles } from 'lucide-react';
import { Button, Card, DropdownMenu, Tabs, TabsContent, TabsList, TabsTrigger, toast, useRecord } from '../../kit/index.ts';
import { useConfirm } from '../components/confirm.tsx';
import { updateRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, CommitteeRec, DeadlineRec, PartyRec } from '../lib/records.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, Loading, Ref, Tag } from '../components/ui.tsx';
import { AgreementForm } from '../components/rightsAgreementForm.tsx';
import type { FormGroup } from '../components/rightsAgreementForm.tsx';
import { GrantsPanel } from '../components/rightsGrants.tsx';
import { HistoryTab, ObligationsTab, ProductsTab, StatementsTab, TermsTab, royaltySummary } from '../components/rightsAgreementTabs.tsx';
import { EmailDraftDialog, termText } from '../components/rightsShared.tsx';

type TabKey = 'terms' | 'grants' | 'obligations' | 'products' | 'statements' | 'documents' | 'history';

const ENDING = ['expired', 'terminated', 'superseded'];

function newest(a: AgreementRec | null, b: AgreementRec | null): AgreementRec | null {
  if (a === null) return b;
  if (b === null || b.id !== a.id) return a;
  return b.updated > a.updated ? b : a;
}

export function AgreementPage({ id }: { id: string }): React.JSX.Element {
  const { can, on, userName, nameOf } = useApp();
  const live = useRecord<AgreementRec>('agreements', id !== '' ? id : null);
  const [saved, setSaved] = useState<AgreementRec | null>(null);
  const a = newest(live.record, saved);
  const party = useRecord<PartyRec>('parties', a !== null && a.counterparty !== '' ? a.counterparty : null);
  const committee = useRecord<CommitteeRec>('committees', a !== null && a.committee !== '' ? a.committee : null);
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `agreement = "${id}" && status = "open"` });
  const [tabParam, setTab] = useHashParam('tab', 'terms');
  const [edit, setEdit] = useState<FormGroup | null>(null);
  const [email, setEmail] = useState(false);
  const [confirmEl, confirm] = useConfirm();

  if (live.loading && a === null) return <Loading />;
  if (a === null) {
    return (
      <Card>
        <EmptyHint
          icon={FileSignature}
          title={t('This agreement could not be opened')}
          message={t('It may have been deleted, or the link is incomplete.')}
          action={
            <Button variant="outline" onClick={() => navigate('agreements')}>
              {t('Back to Agreements')}
            </Button>
          }
        />
      </Card>
    );
  }

  const tabs: TabKey[] = ['terms', 'grants', 'obligations', ...(on('products') ? (['products'] as TabKey[]) : []), ...(on('royalties') ? (['statements'] as TabKey[]) : []), 'documents', 'history'];
  const tab: TabKey = (tabs as string[]).includes(tabParam) ? (tabParam as TabKey) : 'terms';
  const openObligations = deadlines.records.length;

  const changeStatus = async (s: string): Promise<void> => {
    const label = enumLabel('agreements.status', s);
    if (ENDING.includes(s)) {
      const ok = await confirm(
        t('Mark {ref} as {status}? Open obligation deadlines still ahead are cancelled, and its grants stop counting in Can we? and conflict checks.', { ref: a.ref || a.title, status: label }),
        t('Change status'),
      );
      if (!ok) return;
    }
    try {
      setSaved(await updateRecord<AgreementRec>('agreements', a.id, { status: s }));
      toast.success(t('Status changed to {status}.', { status: label }));
    } catch {
      /* toast shown by the client */
    }
  };

  const money = royaltySummary(a);

  return (
    <div className="min-w-0">
      {confirmEl}
      <Card className="mb-5">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('agreements')} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  {t('Agreements')}
                </a>
                <span className="text-xs text-[var(--agent-app-muted)]" aria-hidden>
                  /
                </span>
                <Ref>{a.ref}</Ref>
                <Tag>{enumLabel('agreements.agreement_type', a.agreement_type)}</Tag>
                <Tag>{enumLabel('agreements.direction', a.direction)}</Tag>
                {can.edit ? (
                  <DropdownMenu
                    align="left"
                    trigger={
                      <span className="inline-flex items-center gap-0.5" title={t('Change status')}>
                        <EnumPill field="agreements.status" value={a.status} />
                        <ChevronDown size={12} className="text-[var(--agent-app-muted)]" aria-hidden />
                      </span>
                    }
                    items={enumOptions('agreements.status')
                      .filter(([v]) => v !== a.status)
                      .map(([v, label]) => ({ label: t('Mark as {status}', { status: label }), onSelect: () => void changeStatus(v), danger: v === 'terminated' }))}
                  />
                ) : (
                  <EnumPill field="agreements.status" value={a.status} />
                )}
                {a.ai_extracted && (
                  <Tag title={t('Read from the contract by CraftBot and accepted by a person in the Inbox')}>
                    <Sparkles size={10} className="mr-1" aria-hidden />
                    {t('Read by CraftBot')}
                  </Tag>
                )}
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{a.title}</h1>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap gap-2">
              {can.contribute && (
                <Button variant="outline" size="sm" onClick={() => setEmail(true)}>
                  <Mail size={13} aria-hidden /> {t('Email draft')}
                </Button>
              )}
              {can.edit && (
                <Button variant="outline" size="sm" onClick={() => setEdit('basics')}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
              )}
              <DeleteButton collection="agreements" id={a.id} onDeleted={() => navigate('agreements')} />
            </div>
          </div>
          <div className="mt-4">
            <FactGrid cols={4}>
              <Fact
                label={t('Counterparty')}
                value={
                  a.counterparty !== '' ? (
                    <a className="hover:underline" href={href('people', a.counterparty)}>
                      {party.record?.name ?? t('Loading')}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              <Fact label={t('Term|agreement')} value={termText(a)} />
              <Fact label={t('Responsible')} value={userName(a.responsible)} />
              <Fact label={t('Exclusivity')} value={enumLabel('agreements.exclusivity', a.exclusivity)} />
              {a.franchise !== '' && (
                <Fact
                  label={t('Franchise')}
                  value={
                    on('franchises') ? (
                      <a className="hover:underline" href={href('franchise', a.franchise)}>
                        {nameOf('franchise', a.franchise)}
                      </a>
                    ) : (
                      nameOf('franchise', a.franchise)
                    )
                  }
                />
              )}
              {a.work !== '' && (
                <Fact
                  label={t('Title')}
                  value={
                    on('titles') ? (
                      <a className="hover:underline" href={href('title', a.work)}>
                        {nameOf('work', a.work)}
                      </a>
                    ) : (
                      nameOf('work', a.work)
                    )
                  }
                />
              )}
              {a.committee !== '' && (
                <Fact
                  label={t('Committee')}
                  value={
                    on('committees') ? (
                      <a className="hover:underline" href={href('committee', a.committee)}>
                        {committee.record?.name ?? t('Loading')}
                      </a>
                    ) : (
                      (committee.record?.name ?? '')
                    )
                  }
                />
              )}
              {money !== '' && <Fact label={t('Royalty')} value={money} />}
            </FactGrid>
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="terms" className="whitespace-nowrap">
              {t('Terms|agreement tab')}
            </TabsTrigger>
            <TabsTrigger value="grants" className="whitespace-nowrap">
              {t('Grants|tab')}
            </TabsTrigger>
            <TabsTrigger value="obligations" className="whitespace-nowrap">
              {t('Obligations')}
              {openObligations > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openObligations}</span>}
            </TabsTrigger>
            {on('products') && (
              <TabsTrigger value="products" className="whitespace-nowrap">
                {t('Products')}
              </TabsTrigger>
            )}
            {on('royalties') && (
              <TabsTrigger value="statements" className="whitespace-nowrap">
                {t('Statements')}
              </TabsTrigger>
            )}
            <TabsTrigger value="documents" className="whitespace-nowrap">
              {t('Documents')}
            </TabsTrigger>
            <TabsTrigger value="history" className="whitespace-nowrap">
              {t('History')}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="terms">
          <TermsTab agreement={a} onEdit={can.edit ? (g) => setEdit(g) : null} />
        </TabsContent>
        <TabsContent value="grants">
          <GrantsPanel agreement={a} />
        </TabsContent>
        <TabsContent value="obligations">
          <ObligationsTab agreement={a} />
        </TabsContent>
        {on('products') && (
          <TabsContent value="products">
            <ProductsTab agreement={a} />
          </TabsContent>
        )}
        {on('royalties') && (
          <TabsContent value="statements">
            <StatementsTab agreement={a} />
          </TabsContent>
        )}
        <TabsContent value="documents">
          <DocumentsPanel relation="agreement" relationId={a.id} defaultType="contract" extraction statementFor={a.direction === 'out' && on('royalties') ? a.id : undefined} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab agreement={a} />
        </TabsContent>
      </Tabs>

      {edit !== null && <AgreementForm agreement={a} initialGroup={edit} onClose={() => setEdit(null)} onSaved={setSaved} />}
      {email && (
        <EmailDraftDialog
          subjectType="agreement"
          subjectId={a.id}
          defaultTo={party.record?.email ?? ''}
          suggestions={[
            t('Remind the licensee that the royalty report is due'),
            t('Chase the overdue royalty payment'),
            t('Ask for the samples owed under the agreement'),
            t('Remind them that the renewal notice date is coming'),
          ]}
          onClose={() => setEmail(false)}
        />
      )}
    </div>
  );
}
