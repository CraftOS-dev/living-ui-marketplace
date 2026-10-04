/**
 * One licensed product: header with the licence and licensee, a stage
 * stepper from proposal to sell-off ("Move to" goes through the server,
 * which wants an approved final sample before mass production), then tabs
 * for details, approvals (監修) per stage, seals (証紙), royalty lines,
 * documents and deadlines.
 */
import { useMemo, useState } from 'react';
import { ArrowRight, CalendarClock, Package, Pencil, Send, ShieldCheck } from 'lucide-react';
import { Button, Card, Dialog, Select, Tabs, TabsContent, TabsList, TabsTrigger, Textarea, cn, toast, useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { errText, getRecord, op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtMoney } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { AgreementRec, ApprovalRec, DeadlineRec, PartyRec, ProductRec } from '../lib/records.ts';
import { DeadlineList, useDeadlineActions } from '../components/deadlines.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { Checkbox, EmptyHint, EnumPill, Fact, FactGrid, Loading, Notice, Pill, Prose, Ref, Section, Tag, TONE_TEXT } from '../components/ui.tsx';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { ApprovalDrawer } from '../components/licApprovalDrawer.tsx';
import { ProductFormDialog } from '../components/licProductForm.tsx';
import { ProductRoyaltyLines } from '../components/licRoyalties.tsx';
import { ProductSealsPanel } from '../components/licSeals.tsx';
import { SubmitStageDialog } from '../components/licSubmitStage.tsx';
import {
  APPROVAL_STAGES,
  NEEDS_FINAL_SAMPLE,
  PRODUCT_STAGES,
  ReplyDue,
  ReviewerChips,
  isOpenApproval,
  newest,
  stageName,
  stageTemplates,
} from '../components/licShared.tsx';
import type { ProductStage } from '../components/licShared.tsx';

type TabKey = 'details' | 'approvals' | 'seals' | 'royalties' | 'documents' | 'deadlines';

const FLOW: readonly ProductStage[] = PRODUCT_STAGES.filter((s) => s !== 'cancelled');

/* ------------------------------------------------------------------ */
/* Stage stepper and move dialog                                       */
/* ------------------------------------------------------------------ */

function StageStepper({ stage, canMove, onPick }: { stage: string; canMove: boolean; onPick: (s: ProductStage) => void }): React.JSX.Element {
  const idx = FLOW.indexOf(stage as ProductStage);
  const cancelled = stage === 'cancelled';
  return (
    <div className="overflow-x-auto pb-1">
      <ol className="flex min-w-max gap-1" aria-label={t('Product stages')}>
        {FLOW.map((s, i) => {
          const current = s === stage;
          const done = !cancelled && idx >= 0 && i < idx;
          return (
            <li key={s} className="w-[5.75rem] shrink-0">
              <button
                type="button"
                disabled={!canMove || current}
                onClick={() => onPick(s)}
                aria-current={current ? 'step' : undefined}
                title={canMove && !current ? t('Move to {stage}', { stage: enumLabel('products.stage', s) }) : enumLabel('products.stage', s)}
                className={cn('flex w-full flex-col items-stretch gap-1 text-left', canMove && !current && 'group')}
              >
                <span
                  className={cn(
                    'h-1.5',
                    current ? 'bg-[var(--agent-app-accent)]' : done ? 'bg-emerald-500' : 'bg-[var(--agent-app-border)]',
                    canMove && !current && 'group-hover:opacity-70',
                  )}
                />
                <span
                  className={cn(
                    'truncate text-[11px]',
                    current ? 'font-semibold text-[var(--agent-app-text)]' : done ? 'text-[var(--agent-app-text)]/80' : 'text-[var(--agent-app-muted)]',
                    canMove && !current && 'group-hover:underline',
                  )}
                >
                  <span className="mr-1 tabular-nums text-[var(--agent-app-muted)]">{i + 1}</span>
                  {enumLabel('products.stage', s)}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function MoveStageDialog({
  product,
  initial,
  finalApproved,
  onClose,
  onMoved,
}: {
  product: ProductRec;
  initial: ProductStage | null;
  finalApproved: boolean;
  onClose: () => void;
  onMoved: () => void;
}): React.JSX.Element {
  const options = PRODUCT_STAGES.filter((s) => s !== product.stage);
  const nextInFlow = FLOW[FLOW.indexOf(product.stage as ProductStage) + 1];
  const [target, setTarget] = useState<ProductStage>(initial ?? nextInFlow ?? options[0] ?? 'proposal');
  const [force, setForce] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const needsFinal = NEEDS_FINAL_SAMPLE.includes(target) && !finalApproved;
  const needsReason = target === 'cancelled' || (needsFinal && force);

  const submit = async (): Promise<void> => {
    if (needsFinal && !force) {
      setError(t('Tick "Move anyway" and give a reason, or approve the final sample first.'));
      return;
    }
    if (needsReason && reason.trim() === '') {
      setError(t('Give a reason; it is kept in the history.'));
      return;
    }
    setError('');
    setBusy(true);
    try {
      await op<{ id: string; stage: string }>('products/advance', { product_id: product.id, stage: target, force: needsFinal && force, reason: reason.trim() });
      toast.success(t('Moved to {stage}', { stage: enumLabel('products.stage', target) }));
      onMoved();
      onClose();
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Move the product')}
      description={t('Now at {stage}.', { stage: enumLabel('products.stage', product.stage) })}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy}>
            {t('Move')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Select
          label={t('Move to')}
          value={target}
          options={options.map((s) => ({ value: s, label: enumLabel('products.stage', s) }))}
          onChange={(e) => {
            setTarget(e.target.value as ProductStage);
            setError('');
          }}
        />
        {needsFinal && (
          <div className="flex flex-col gap-2">
            <Notice tone="warn">{t('The final sample is not approved yet. Mass production and sales normally wait for it.')}</Notice>
            <Checkbox checked={force} onChange={setForce} label={t('Move anyway')} />
          </div>
        )}
        {target === 'sell_off' && <p className="text-xs text-[var(--agent-app-muted)]">{t('The sell-off end date is set from the licence when it is empty.')}</p>}
        {(needsReason || target === 'ended') && (
          <Textarea label={needsReason ? t('Reason (required)') : t('Reason')} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
        )}
        {error !== '' && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Approvals tab                                                       */
/* ------------------------------------------------------------------ */

function ApprovalsTab({
  product,
  agreement,
  approvals,
  loading,
  onOpen,
  onSubmit,
}: {
  product: ProductRec;
  agreement: AgreementRec | null;
  approvals: ApprovalRec[];
  loading: boolean;
  onOpen: (id: string) => void;
  onSubmit: (stage?: string) => void;
}): React.JSX.Element {
  const { settings, can } = useApp();
  const templates = useMemo(() => stageTemplates(agreement, settings), [agreement, settings]);
  const keys = useMemo(() => {
    const own = templates.map((s) => s.key);
    const extra = APPROVAL_STAGES.filter((s) => !own.includes(s) && approvals.some((a) => a.stage === s));
    return [...own, ...extra];
  }, [templates, approvals]);
  if (loading) return <Loading />;
  return (
    <Section
      title={t('Approvals by stage')}
      meta={approvals.length > 0 ? String(approvals.length) : undefined}
      flush
      actions={
        can.licensing ? (
          <Button size="sm" variant="outline" onClick={() => onSubmit()}>
            <Send size={13} aria-hidden /> {t('Submit stage')}
          </Button>
        ) : undefined
      }
    >
      {keys.map((key) => {
        const tpl = templates.find((s) => s.key === key);
        const name = tpl !== undefined ? stageName(tpl) : enumLabel('approvals.stage', key);
        const list = approvals.filter((a) => a.stage === key);
        const latest = list[0];
        const earlier = list.slice(1);
        const canSubmit = can.licensing && (latest === undefined || !isOpenApproval(latest.status));
        return (
          <div key={key} className="border-b border-[var(--agent-app-border)]/70 px-4 py-3 last:border-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 text-[13px] font-semibold">{name}</span>
              {latest !== undefined ? (
                <>
                  <EnumPill field="approvals.status" value={latest.status} />
                  <span className="text-xs tabular-nums text-[var(--agent-app-muted)]">{t('Round {n}', { n: latest.round || 1 })}</span>
                  <ReplyDue a={latest} />
                </>
              ) : (
                <span className="text-xs text-[var(--agent-app-muted)]">{t('Not submitted')}</span>
              )}
              <div className="ml-auto flex shrink-0 gap-1.5">
                {latest !== undefined && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onOpen(latest.id)}>
                    {t('Open|action')} <ArrowRight size={12} aria-hidden />
                  </Button>
                )}
                {canSubmit && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onSubmit(key)}>
                    {latest === undefined ? t('Submit') : t('Submit again')}
                  </Button>
                )}
              </div>
            </div>
            {latest !== undefined && <ReviewerChips reviewers={latest.reviewers} className="mt-2" />}
            {earlier.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--agent-app-muted)]">
                <span>{t('Earlier:')}</span>
                {earlier.map((a) => (
                  <button key={a.id} type="button" className="hover:underline" onClick={() => onOpen(a.id)}>
                    {enumLabel('approvals.status', a.status)} · {fmtDate(a.submitted_at)}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {keys.length === 0 && <EmptyHint compact icon={ShieldCheck} title={t('No approval stages')} message={t('The licence lists no approval stages.')} />}
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export function ProductPage({ id }: { id: string }): React.JSX.Element {
  const { can, on, nameOf, dimLabel } = useApp();
  const live = useRecord<ProductRec>('products', id !== '' ? id : null);
  const [saved, setSaved] = useState<ProductRec | null>(null);
  const p = newest(live.record, saved);
  const agreement = useRecord<AgreementRec>('agreements', p !== null && p.agreement !== '' ? p.agreement : null);
  const licensee = useRecord<PartyRec>('parties', p !== null && p.licensee !== '' ? p.licensee : null);
  const approvals = useCollection<ApprovalRec>('approvals', { filter: `product = ${q(id)}`, sort: '-created' });
  const deadlines = useCollection<DeadlineRec>('deadlines', { filter: `product = ${q(id)}`, sort: 'due_date' });
  const dl = useDeadlineActions(deadlines.refresh);
  const [tabParam, setTab] = useHashParam('tab', 'details');
  const [openApproval, setOpenApproval] = useHashParam('approval', '');
  const [edit, setEdit] = useState(false);
  const [move, setMove] = useState<{ target: ProductStage | null } | null>(null);
  const [submitStage, setSubmitStage] = useState<{ stage?: string | undefined } | null>(null);

  if (live.loading && p === null) return <Loading />;
  if (p === null) {
    return (
      <Card>
        <EmptyHint
          icon={Package}
          title={t('This product could not be opened')}
          message={t('It may have been deleted, or the link is incomplete.')}
          action={
            <Button variant="outline" onClick={() => navigate('products')}>
              {t('Back to products')}
            </Button>
          }
        />
      </Card>
    );
  }

  const showApprovals = on('approvals');
  const showRoyalties = on('royalties');
  const tabs: TabKey[] = ['details', ...(showApprovals ? (['approvals'] as TabKey[]) : []), ...(showRoyalties ? (['seals', 'royalties'] as TabKey[]) : []), 'documents', 'deadlines'];
  const tab: TabKey = (tabs as string[]).includes(tabParam) ? (tabParam as TabKey) : 'details';
  const finalApproved = approvals.records.some((a) => (a.stage === 'final_sample' || a.stage === 'mass_production_check') && a.status === 'approved');
  const openApprovals = approvals.records.filter((a) => isOpenApproval(a.status)).length;
  const openDeadlines = deadlines.records.filter((d) => d.status === 'open');
  const firstCharacter = p.characters[0];
  const reload = (): void => {
    getRecord<ProductRec>('products', p.id)
      .then(setSaved)
      .catch(() => undefined);
    approvals.refresh();
  };

  const characterLinks =
    p.characters.length === 0
      ? ''
      : (
          <span className="flex flex-wrap gap-x-2">
            {p.characters.map((c) => (
              <a key={c} className="hover:underline" href={href('character', c)}>
                {nameOf('character', c) || c}
              </a>
            ))}
          </span>
        );
  const talentLinks =
    p.talents.length === 0
      ? ''
      : (
          <span className="flex flex-wrap gap-x-2">
            {p.talents.map((x) => (
              <a key={x} className="hover:underline" href={href('talent', x)}>
                {nameOf('talent', x) || x}
              </a>
            ))}
          </span>
        );
  const salesWindow =
    d10(p.sales_start) !== '' || d10(p.sales_end) !== ''
      ? t('{from} to {to}', { from: fmtDate(p.sales_start) || t('open'), to: fmtDate(p.sales_end) || t('open') })
      : '';

  return (
    <div>
      <Card className="mb-5">
        <div className="px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <a href={href('products')} className="text-xs text-[var(--agent-app-muted)] hover:underline">
                  {t('Products')}
                </a>
                <span className="text-xs text-[var(--agent-app-muted)]" aria-hidden>
                  /
                </span>
                <Ref>{p.ref}</Ref>
                <EnumPill field="products.stage" value={p.stage} />
                {p.occasion !== '' && p.occasion !== 'regular' && <Tag>{enumLabel('products.occasion', p.occasion)}</Tag>}
                {p.digital && <Tag>{t('Digital')}</Tag>}
              </div>
              <h1 className="mt-2 break-words text-xl font-semibold tracking-tight">{p.name}</h1>
            </div>
            <div className="flex min-w-0 max-w-full flex-wrap gap-2">
              {firstCharacter !== undefined && (
                <a
                  href={href('canwe', undefined, { asset: `character:${firstCharacter}` })}
                  className="inline-flex h-8 items-center gap-1.5 border border-[var(--agent-app-border)] px-3 text-sm hover:bg-[var(--agent-app-hover)]"
                >
                  <ShieldCheck size={13} aria-hidden /> {t('Can we?')}
                </a>
              )}
              {can.licensing && showApprovals && (
                <Button size="sm" variant="outline" onClick={() => setSubmitStage({})}>
                  <Send size={13} aria-hidden /> {t('Submit stage')}
                </Button>
              )}
              {can.edit && (
                <Button size="sm" variant="outline" onClick={() => setEdit(true)}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
              )}
              <DeleteButton collection="products" id={p.id} onDeleted={() => navigate('products')} />
            </div>
          </div>
          <div className="mt-4">
            <FactGrid cols={4}>
              <Fact label={t('Licensee')} value={licensee.record?.name ?? ''} />
              <Fact
                label={t('Licence')}
                value={
                  agreement.record !== null ? (
                    <a className="hover:underline" href={href('agreement', agreement.record.id)}>
                      <Ref>{agreement.record.ref}</Ref> {agreement.record.title}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              <Fact label={t('Category')} value={p.category !== '' ? dimLabel('category', p.category) : ''} />
              <Fact label={t('Retail price')} value={p.retail_price ? fmtMoney(p.retail_price, p.currency) : ''} />
            </FactGrid>
          </div>
          <div className="mt-5 border-t border-[var(--agent-app-border)] pt-3">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Stage|product')}</span>
              <div className="flex flex-wrap items-center gap-2">
                {p.stage === 'cancelled' && <Pill tone="neutral">{enumLabel('products.stage', 'cancelled')}</Pill>}
                {d10(p.sell_off_end) !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{t('Sell-off until {date}', { date: fmtDate(p.sell_off_end) })}</span>}
                {can.licensing && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setMove({ target: null })}>
                    {t('Move to...')}
                  </Button>
                )}
              </div>
            </div>
            <StageStepper stage={p.stage} canMove={can.licensing} onPick={(s) => setMove({ target: s })} />
            {!finalApproved && (p.stage === 'mass_production' || p.stage === 'on_sale') && (
              <p className={cn('mt-2 text-xs', TONE_TEXT.warn)}>{t('This product is past the final sample without an approved final sample on file.')}</p>
            )}
          </div>
        </div>
      </Card>

      <Tabs value={tab} onValueChange={setTab}>
        <div className="overflow-x-auto">
          <TabsList>
            <TabsTrigger value="details" className="whitespace-nowrap">
              {t('Details')}
            </TabsTrigger>
            {showApprovals && (
              <TabsTrigger value="approvals" className="whitespace-nowrap">
                {t('Approvals')}
                {openApprovals > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openApprovals}</span>}
              </TabsTrigger>
            )}
            {showRoyalties && (
              <TabsTrigger value="seals" className="whitespace-nowrap">
                {t('Seals')}
              </TabsTrigger>
            )}
            {showRoyalties && (
              <TabsTrigger value="royalties" className="whitespace-nowrap">
                {t('Royalties')}
              </TabsTrigger>
            )}
            <TabsTrigger value="documents" className="whitespace-nowrap">
              {t('Documents')}
            </TabsTrigger>
            <TabsTrigger value="deadlines" className="whitespace-nowrap">
              {t('Deadlines')}
              {openDeadlines.length > 0 && <span className="ml-1.5 tabular-nums text-[var(--agent-app-muted)]">{openDeadlines.length}</span>}
            </TabsTrigger>
          </TabsList>
        </div>

        <TabsContent value="details">
          <div className="flex flex-col gap-4">
            <Section
              title={t('Product details')}
              actions={
                can.edit ? (
                  <Button size="sm" variant="ghost" onClick={() => setEdit(true)}>
                    <Pencil size={13} aria-hidden /> {t('Edit')}
                  </Button>
                ) : undefined
              }
            >
              <FactGrid cols={3}>
                <Fact label={t('Reference')} value={p.ref} mono />
                <Fact label={t('Licensee')} value={licensee.record?.name ?? ''} />
                <Fact label={t('Licence')} value={agreement.record !== null ? <a className="hover:underline" href={href('agreement', agreement.record.id)}>{agreement.record.ref}</a> : ''} />
                {on('franchises') && <Fact label={t('Franchise')} value={p.franchise !== '' ? <a className="hover:underline" href={href('franchise', p.franchise)}>{nameOf('franchise', p.franchise)}</a> : ''} />}
                {on('titles') && <Fact label={t('Title')} value={p.work !== '' ? <a className="hover:underline" href={href('title', p.work)}>{nameOf('work', p.work)}</a> : ''} />}
                {on('franchises') && <Fact label={t('Characters')} value={characterLinks} />}
                {on('talents') && <Fact label={t('Talents')} value={talentLinks} />}
                <Fact label={t('Category')} value={p.category !== '' ? dimLabel('category', p.category) : ''} />
                <Fact label={t('Sales channel')} value={p.channel !== '' ? dimLabel('channel', p.channel) : ''} />
                <Fact label={t('Occasion')} value={enumLabel('products.occasion', p.occasion)} />
                <Fact label={t('Sales window')} value={salesWindow} />
                <Fact label={t('Time zone')} value={p.timezone} mono />
                <Fact label={t('Sales model')} value={enumLabel('products.sales_model', p.sales_model)} />
                <Fact label={t('Ship by')} value={fmtDate(p.ship_by)} />
                <Fact label={t('Retail price')} value={p.retail_price ? fmtMoney(p.retail_price, p.currency) : ''} />
                <Fact label={t('JAN code')} value={p.jan} mono />
                <Fact label={t('SKU')} value={p.sku} mono />
                <Fact label={t('Digital')} value={p.digital ? (d10(p.digital_end) !== '' ? t('Yes, until {date}', { date: fmtDate(p.digital_end) }) : t('Yes')) : t('No')} />
                <Fact label={t('Includes voice')} value={p.includes_voice ? t('Yes') : t('No')} />
                <Fact label={t('Sales regions')} value={p.regions} />
                <Fact label={t('Sell-off ends')} value={fmtDate(p.sell_off_end)} />
              </FactGrid>
              {p.notes !== '' && <Prose className="mt-4 border-t border-[var(--agent-app-border)] pt-3 text-[var(--agent-app-text)]/85">{p.notes}</Prose>}
            </Section>
            <Section
              title={t('Next deadlines')}
              meta={openDeadlines.length > 0 ? String(openDeadlines.length) : undefined}
              flush
              actions={
                openDeadlines.length > 3 ? (
                  <Button size="sm" variant="ghost" onClick={() => setTab('deadlines')}>
                    {t('Show all')}
                  </Button>
                ) : undefined
              }
            >
              {openDeadlines.length === 0 ? (
                <p className="px-4 py-3 text-[13px] text-[var(--agent-app-muted)]">{t('No open deadlines. Approval replies, sales windows and sell-off dates appear here.')}</p>
              ) : (
                <DeadlineList deadlines={openDeadlines.slice(0, 3)} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} grouped={false} bulk={false} />
              )}
            </Section>
          </div>
        </TabsContent>

        {showApprovals && (
          <TabsContent value="approvals">
            <ApprovalsTab
              product={p}
              agreement={agreement.record}
              approvals={approvals.records}
              loading={approvals.loading}
              onOpen={setOpenApproval}
              onSubmit={(stage) => setSubmitStage({ stage })}
            />
          </TabsContent>
        )}

        {showRoyalties && (
          <TabsContent value="seals">
            <ProductSealsPanel productId={p.id} />
          </TabsContent>
        )}

        {showRoyalties && (
          <TabsContent value="royalties">
            <ProductRoyaltyLines productId={p.id} />
          </TabsContent>
        )}

        <TabsContent value="documents">
          <DocumentsPanel relation="product" relationId={p.id} defaultType="sample_photo" />
        </TabsContent>

        <TabsContent value="deadlines">
          <Section title={t('Deadlines')} meta={deadlines.records.length > 0 ? String(deadlines.records.length) : undefined} flush>
            {deadlines.loading ? (
              <Loading />
            ) : (
              <DeadlineList
                deadlines={deadlines.records}
                actions={dl.actions}
                canEdit={dl.canEdit}
                showSubject={false}
                empty={<EmptyHint compact icon={CalendarClock} title={t('No deadlines for this product')} message={t('Approval replies, sales windows and sell-off dates appear here as they are set.')} />}
              />
            )}
          </Section>
        </TabsContent>
      </Tabs>

      {dl.dialogs}
      {edit && (
        <ProductFormDialog
          product={p}
          onClose={() => setEdit(false)}
          onSaved={(rec) => {
            setSaved(rec);
            deadlines.refresh();
          }}
        />
      )}
      {move !== null && <MoveStageDialog product={p} initial={move.target} finalApproved={finalApproved} onClose={() => setMove(null)} onMoved={reload} />}
      {submitStage !== null && (
        <SubmitStageDialog
          product={p}
          approvals={approvals.records}
          defaultStage={submitStage.stage}
          onClose={() => setSubmitStage(null)}
          onSubmitted={(aid) => {
            approvals.refresh();
            setTab('approvals');
            setOpenApproval(aid);
          }}
        />
      )}
      {openApproval !== '' && <ApprovalDrawer key={openApproval} id={openApproval} onClose={() => setOpenApproval('')} />}
    </div>
  );
}
