/**
 * Outside reviewer portal (外部監修者): the approvals assigned to the
 * reviewer, those waiting for their decision first. Opening one shows the
 * product, the submitted images and earlier comments, and records the
 * reviewer's own decision (approved, changes, not approved) with a comment.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, Send } from 'lucide-react';
import { Button, Drawer, Textarea, toast } from '../../kit/index.ts';
import { errText, opForm } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate, fmtMoney, today } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import { t } from '../lib/i18n.ts';
import type { PortalContext, PortalProductInfo } from '../lib/shapes.ts';
import { EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Loading, Notice, Pill, Segmented, TONE_TEXT } from './ui.tsx';
import { ImagesField } from './orgShared.tsx';
import { ApprovalDetail, PortalList, stageName, useApprovalRecord } from './portalShared.tsx';

type Approval = PortalContext['approvals'][number];
type Decision = 'approved' | 'changes' | 'rejected';
const OPEN = ['submitted', 'in_review', 'changes_requested'];

/** Product details the reviewer may see: the summary portal/context sends with each approval. */
function useProducts(ctx: PortalContext): Map<string, { name: string; record: PortalProductInfo | null }> {
  return useMemo(() => {
    const m = new Map<string, { name: string; record: PortalProductInfo | null }>();
    for (const a of ctx.approvals) {
      const own = ctx.products.find((p) => p.id === a.product)?.name ?? '';
      m.set(a.product, { name: a.product_name || own, record: a.product_info });
    }
    return m;
  }, [ctx.approvals, ctx.products]);
}

/** #/approvals/<id> (from a notification) opens that approval with the decision form. */
export function ReviewerView({ ctx, focusApproval }: { ctx: PortalContext; focusApproval: string }): React.JSX.Element {
  const [picked, setOpen] = useState<Approval | null>(null);
  const focused = focusApproval !== '' ? (ctx.approvals.find((a) => a.id === focusApproval) ?? null) : null;
  const open = picked ?? focused;
  const close = (): void => {
    setOpen(null);
    if (focused !== null) navigate('portal');
  };
  const products = useProducts(ctx);
  const sorted = useMemo(() => {
    const rank = (a: Approval): number => (a.mine.length > 0 && OPEN.includes(a.status) ? 0 : OPEN.includes(a.status) ? 1 : 2);
    return ctx.approvals.slice().sort((a, b) => rank(a) - rank(b) || (a.due_date || '9999').localeCompare(b.due_date || '9999'));
  }, [ctx.approvals]);
  const waiting = sorted.filter((a) => a.mine.length > 0 && OPEN.includes(a.status)).length;

  if (sorted.length === 0) {
    return <EmptyHint icon={ClipboardCheck} title={t('Nothing to review yet')} message={t('Approvals the licensor assigns to you appear here. You get a notification when one arrives.')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      <p className="text-[13px] text-[var(--agent-app-muted)]">{waiting > 0 ? t('{n} waiting for your decision.', { n: waiting }) : t('Nothing is waiting for your decision right now.')}</p>
      <PortalList>
        {sorted.map((a) => {
          const name = products.get(a.product)?.name || t('Product');
          const late = OPEN.includes(a.status) && a.due_date !== '' && a.due_date < today();
          return (
            <li key={a.id} className="border-b border-[var(--agent-app-border)]/70 last:border-0">
              <button type="button" onClick={() => setOpen(a)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-[var(--agent-app-border)]/20">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate text-[13px] font-medium">{name}</div>
                  <div className="truncate text-xs text-[var(--agent-app-muted)]">
                    {stageName(a.stage)} · {t('Round {n}', { n: a.round || 1 })}
                    {a.due_date !== '' && OPEN.includes(a.status) && <span className={late ? TONE_TEXT.bad : ''}> · {t('Reply due {date}', { date: fmtDate(a.due_date) })}</span>}
                  </div>
                </div>
                {a.mine.length > 0 && OPEN.includes(a.status) && <Pill tone="accent">{t('Your turn')}</Pill>}
                <EnumPill field="approvals.status" value={a.status} />
              </button>
            </li>
          );
        })}
      </PortalList>
      {open !== null && <ReviewDrawer item={ctx.approvals.find((a) => a.id === open.id) ?? open} product={products.get(open.product) ?? { name: '', record: null }} onClose={close} />}
    </div>
  );
}

function ReviewDrawer({ item, product, onClose }: { item: Approval; product: { name: string; record: PortalProductInfo | null }; onClose: () => void }): React.JSX.Element {
  const { dimLabel } = useApp();
  const { approval, loading, error } = useApprovalRecord(item.id);
  const [key, setKey] = useState(item.mine[0] ?? '');
  const [decision, setDecision] = useState<Decision>('approved');
  const [comment, setComment] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const canDecide = item.mine.length > 0 && OPEN.includes(approval?.status ?? item.status);
  const needsComment = decision !== 'approved';
  const p = product.record;

  const submit = async (): Promise<void> => {
    if (needsComment && comment.trim() === '') {
      toast.error(t('Say what needs to change.'));
      return;
    }
    setBusy(true);
    try {
      await opForm('approvals/decide', { approval_id: item.id, reviewer_key: key, decision, comment: comment.trim() }, { images });
      toast.success(t('Your decision was recorded'));
      setComment('');
      setImages([]);
    } catch (err) {
      toast.error(errText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer open onClose={onClose} title={product.name || t('Approval')} width={720}>
      {loading && approval === null ? (
        <Loading />
      ) : error !== null && approval === null ? (
        <ErrorBox message={error} />
      ) : approval !== null ? (
        <div className="flex flex-col gap-6">
          {p !== null && (
            <FactGrid cols={2}>
              <Fact label={t('Product')} value={p.name} />
              <Fact label={t('Reference')} value={p.ref} mono />
              <Fact label={t('Category')} value={p.category !== '' ? dimLabel('category', p.category) : ''} />
              <Fact label={t('Planned sales start')} value={fmtDate(p.sales_start)} />
              <Fact label={t('Retail price')} value={p.retail_price > 0 ? fmtMoney(p.retail_price, p.currency) : ''} />
              <Fact label={t('Includes recorded voice')} value={p.includes_voice ? t('Yes') : t('No')} />
            </FactGrid>
          )}
          <ApprovalDetail approval={approval} />
          {canDecide ? (
            <div className="flex flex-col gap-3 border border-[var(--agent-app-accent)]/40 p-3">
              <h4 className="text-[13px] font-semibold">{t('Your decision')}</h4>
              {item.mine.length > 1 && (
                <Segmented<string>
                  size="sm"
                  ariaLabel={t('Reviewing as')}
                  value={key}
                  onChange={setKey}
                  options={item.mine.map((k) => {
                    const r = (approval.reviewers ?? []).find((x) => x.key === k);
                    return { value: k, label: r !== undefined ? r.label : k };
                  })}
                />
              )}
              <div className="overflow-x-auto">
                <Segmented<Decision>
                  ariaLabel={t('Decision')}
                  value={decision}
                  onChange={setDecision}
                  options={[
                    { value: 'approved', label: t('Approve'), tone: 'good' },
                    { value: 'changes', label: t('Request changes'), tone: 'warn' },
                    { value: 'rejected', label: t('Do not approve'), tone: 'bad' },
                  ]}
                />
              </div>
              <Textarea
                label={needsComment ? t('What needs to change (required)') : t('Comment (optional)')}
                rows={4}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
              />
              <ImagesField files={images} onChange={setImages} label={t('Marked-up images (optional)')} />
              <div className="flex justify-end">
                <Button loading={busy} disabled={key === '' || (needsComment && comment.trim() === '')} onClick={() => void submit()}>
                  <Send size={13} aria-hidden /> {t('Send decision')}
                </Button>
              </div>
            </div>
          ) : item.mine.length === 0 && OPEN.includes(approval.status) ? (
            <Notice tone="neutral">{t('Your part of this approval is done. The other reviewers are still deciding.')}</Notice>
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
