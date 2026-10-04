/**
 * Licensee portal (ライセンシー): the company's licences (term, royalty,
 * the copyright notice to print, approval stages), its products (propose a
 * new one under an active licence), approvals (resubmit after changes,
 * submit the next stage), royalty statements (file the sales lines) and
 * seals (order, report usage). Only the company's own records reach this
 * view: the server filters every list by the account's portal links.
 */
import { useEffect, useMemo, useState } from 'react';
import { ClipboardCheck, FileSignature, Package, Plus, ReceiptJapaneseYen, RotateCcw, Send, Stamp, Trash2 } from 'lucide-react';
import { Button, Dialog, Drawer, Input, Select, Textarea, toast } from '../../kit/index.ts';
import { errText, op, opForm } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate, fmtMoney, fmtPct, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t, tf } from '../lib/i18n.ts';
import { CURRENCIES } from '../lib/labels.ts';
import { navigate, useHashParam } from '../lib/router.ts';
import type { PortalContext, StageTemplate } from '../lib/shapes.ts';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Fact, FactGrid, Loading, Notice, Ref, Section, TONE_TEXT } from './ui.tsx';
import { DialogBody, ImagesField, num } from './orgShared.tsx';
import { ApprovalDetail, PortalList, PortalTabs, stageName, useApprovalRecord, useStageList } from './portalShared.tsx';

type Agreement = PortalContext['agreements'][number];
type Product = PortalContext['products'][number];
type Approval = PortalContext['approvals'][number];
type Statement = PortalContext['statements'][number];
type Seal = PortalContext['seals'][number];

type Tab = 'licences' | 'products' | 'approvals' | 'statements' | 'seals';

const OPEN_APPROVAL = ['submitted', 'in_review', 'changes_requested'];

/**
 * Deep links from notifications: #/approvals/<id> opens that approval,
 * #/royalties/<id> shows that statement. Switching tabs leaves the link.
 */
export function LicenseeView({ ctx, focusApproval, focusStatement }: { ctx: PortalContext; focusApproval: string; focusStatement: string }): React.JSX.Element {
  const [raw, setTab] = useHashParam('tab', 'licences');
  const deep = focusApproval !== '' || focusStatement !== '';
  const picked: Tab = (['licences', 'products', 'approvals', 'statements', 'seals'] as Tab[]).find((x) => x === raw) ?? 'licences';
  const tab: Tab = focusApproval !== '' ? 'approvals' : focusStatement !== '' ? 'statements' : picked;
  const waiting = ctx.approvals.filter((a) => a.status === 'changes_requested').length;
  const due = ctx.statements.filter((s) => s.status === 'expected').length;
  return (
    <div>
      <PortalTabs<Tab>
        label={t('Section')}
        value={tab}
        onChange={(v) => (deep ? navigate('portal', undefined, { tab: v }) : setTab(v))}
        options={[
          { value: 'licences', label: t('My licences') },
          { value: 'products', label: t('Products') },
          { value: 'approvals', label: waiting > 0 ? t('Approvals ({n} to fix)', { n: waiting }) : t('Approvals') },
          { value: 'statements', label: due > 0 ? t('Royalty statements ({n} due)', { n: due }) : t('Royalty statements') },
          { value: 'seals', label: t('Seals') },
        ]}
      />
      {tab === 'licences' && <Licences ctx={ctx} />}
      {tab === 'products' && <Products ctx={ctx} />}
      {tab === 'approvals' && <Approvals ctx={ctx} focusId={focusApproval} />}
      {tab === 'statements' && <Statements ctx={ctx} focusId={focusStatement} />}
      {tab === 'seals' && <Seals ctx={ctx} />}
    </div>
  );
}

function agreementOf(ctx: PortalContext, id: string): Agreement | undefined {
  return ctx.agreements.find((a) => a.id === id);
}

function productName(ctx: PortalContext, id: string): string {
  return ctx.products.find((p) => p.id === id)?.name ?? t('Product');
}

/* ------------------------------------------------------------------ */
/* Licences                                                            */
/* ------------------------------------------------------------------ */

function Licences({ ctx }: { ctx: PortalContext }): React.JSX.Element {
  if (ctx.agreements.length === 0) {
    return <EmptyHint icon={FileSignature} title={t('No licences to show yet')} message={t('Your licences appear here once the licensor has recorded them and linked your account to your company.')} />;
  }
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {ctx.agreements.map((a) => (
        <LicenceCard key={a.id} a={a} />
      ))}
    </div>
  );
}

function LicenceCard({ a }: { a: Agreement }): React.JSX.Element {
  const stages = useStageList(a.approval_stages);
  return (
    <Section
      title={a.title}
      meta={a.ref}
      actions={<EnumPill field="agreements.status" value={a.status} />}
    >
      <div className="flex flex-col gap-4">
        <FactGrid cols={2}>
          <Fact label={t('Type')} value={enumLabel('agreements.agreement_type', a.agreement_type)} />
          <Fact label={t('Term')} value={[fmtDate(a.term_start), fmtDate(a.term_end)].filter((x) => x !== '').join(' - ')} />
          <Fact label={t('Royalty rate')} value={a.royalty_rate > 0 ? fmtPct(a.royalty_rate) : ''} />
          <Fact label={t('Royalty basis')} value={enumLabel('agreements.royalty_basis', a.royalty_basis)} />
          <Fact label={t('Currency')} value={a.currency} />
        </FactGrid>
        <div>
          <div className="text-[11px] text-[var(--agent-app-muted)]">{t('Copyright notice to print on products and packaging')}</div>
          {a.copyright_notice !== '' ? (
            <div className="mt-1 break-words border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 py-1.5 font-mono text-[12.5px]">{a.copyright_notice}</div>
          ) : (
            <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">{t('Not given yet. Ask the licensor before printing.')}</p>
          )}
        </div>
        <div>
          <div className="mb-1 text-[11px] text-[var(--agent-app-muted)]">{t('Approval stages for each product')}</div>
          <ol className="flex flex-wrap gap-1.5">
            {stages.map((s, i) => (
              <li key={s.key} className="border border-[var(--agent-app-border)] px-2 py-0.5 text-xs">
                <span className="tabular-nums text-[var(--agent-app-muted)]">{i + 1}.</span> {tf(s, 'label') || enumLabel('approvals.stage', s.key)}
                {s.sla_days !== undefined && s.sla_days > 0 && <span className="text-[var(--agent-app-muted)]"> · {t('{n} business days', { n: s.sla_days })}</span>}
              </li>
            ))}
          </ol>
        </div>
      </div>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

function Products({ ctx }: { ctx: PortalContext }): React.JSX.Element {
  const [proposing, setProposing] = useState(false);
  const [nextFor, setNextFor] = useState<Product | null>(null);
  const active = ctx.agreements.filter((a) => a.status === 'active' || a.status === 'renewed');
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] text-[var(--agent-app-muted)]">{t('Every product goes through the licensor\'s approval stages before it is made and sold.')}</p>
        <Button disabled={active.length === 0} title={active.length === 0 ? t('You need an active licence to propose a product.') : undefined} onClick={() => setProposing(true)}>
          <Plus size={14} aria-hidden /> {t('Propose a product')}
        </Button>
      </div>
      {ctx.products.length === 0 ? (
        <EmptyHint
          icon={Package}
          title={t('No products yet')}
          message={active.length > 0 ? t('Propose your first product under an active licence. The proposal goes to the licensor for approval.') : t('Products can be proposed once you have an active licence.')}
          action={active.length > 0 ? <Button size="sm" onClick={() => setProposing(true)}>{t('Propose a product')}</Button> : undefined}
        />
      ) : (
        <PortalList>
          {ctx.products.map((p) => {
            const a = agreementOf(ctx, p.agreement);
            const openOne = ctx.approvals.find((x) => x.product === p.id && OPEN_APPROVAL.includes(x.status));
            return (
              <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="flex min-w-0 items-center gap-2">
                    <Ref>{p.ref}</Ref>
                    <span className="min-w-0 truncate text-[13px] font-medium">{p.name}</span>
                  </div>
                  <div className="truncate text-xs text-[var(--agent-app-muted)]">
                    {a !== undefined ? a.title : ''}
                    {p.sales_start !== '' ? ` · ${t('on sale {date}', { date: fmtDate(p.sales_start) })}` : ''}
                    {p.retail_price > 0 ? ` · ${fmtMoney(p.retail_price, p.currency)}` : ''}
                  </div>
                </div>
                <EnumPill field="products.stage" value={p.stage} />
                {openOne === undefined && !['on_sale', 'sell_off', 'ended', 'cancelled'].includes(p.stage) && (
                  <Button size="sm" variant="outline" onClick={() => setNextFor(p)}>
                    <Send size={12} aria-hidden /> {t('Submit next stage')}
                  </Button>
                )}
              </li>
            );
          })}
        </PortalList>
      )}
      {proposing && <ProposeDialog ctx={ctx} agreements={active} onClose={() => setProposing(false)} />}
      {nextFor !== null && <NextStageDialog ctx={ctx} product={nextFor} onClose={() => setNextFor(null)} />}
    </div>
  );
}

function ProposeDialog({ ctx, agreements, onClose }: { ctx: PortalContext; agreements: Agreement[]; onClose: () => void }): React.JSX.Element {
  const { dimValues } = useApp();
  const [agreementId, setAgreementId] = useState(agreements[0]?.id ?? '');
  const agreement = agreementOf(ctx, agreementId);
  // The characters this licence covers (from portal/context); outside accounts cannot read the catalogue.
  const knownCharacters = agreement?.characters ?? [];
  const [name, setName] = useState('');
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [characterText, setCharacterText] = useState('');
  const [category, setCategory] = useState('');
  const [channel, setChannel] = useState('');
  const [occasion, setOccasion] = useState('regular');
  const [salesStart, setSalesStart] = useState('');
  const [salesModel, setSalesModel] = useState('stock');
  const [price, setPrice] = useState('');
  const [currency, setCurrency] = useState(agreement?.currency || 'JPY');
  const [jan, setJan] = useState('');
  const [voice, setVoice] = useState(false);
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const ok = agreementId !== '' && name.trim() !== '';
  const categories = dimValues.filter((d) => d.dimension === 'category');
  const channels = dimValues.filter((d) => d.dimension === 'channel');

  const submit = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    const noteText = [characterText.trim() !== '' ? `${t('Characters')}: ${characterText.trim()}` : '', notes.trim()].filter((x) => x !== '').join('\n');
    try {
      const r = await opForm<{ ref: string; due_date: string }>(
        'portal/submit-product',
        {
          agreement_id: agreementId,
          name: name.trim(),
          characters: characterIds,
          category,
          channel,
          occasion,
          sales_start: salesStart,
          sales_model: salesModel,
          retail_price: price.trim() === '' ? 0 : num(price),
          currency,
          jan: jan.trim(),
          includes_voice: voice,
          notes: noteText,
        },
        { images },
      );
      toast.success(r.due_date !== '' ? t('Proposal {ref} sent. The licensor replies by {date}.', { ref: r.ref, date: fmtDate(r.due_date) }) : t('Proposal {ref} sent to the licensor.', { ref: r.ref }));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Propose a product')}
      description={t('The proposal is the first approval stage. The licensor reviews it and replies here.')}
      className="w-[min(94vw,40rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void submit()}>
            <Send size={13} aria-hidden /> {t('Send proposal')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Select
          label={t('Under licence')}
          value={agreementId}
          options={agreements.map((a) => ({ value: a.id, label: `${a.ref} · ${a.title}` }))}
          onChange={(e) => {
            setAgreementId(e.target.value);
            setCharacterIds([]);
            const next = agreementOf(ctx, e.target.value);
            if (next !== undefined && next.currency !== '') setCurrency(next.currency);
          }}
        />
        <Input label={t('Product name')} value={name} onChange={(e) => setName(e.target.value)} />
        {knownCharacters.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <span className="text-[13px] font-medium">{t('Characters')}</span>
            <div className="flex flex-wrap gap-1.5">
              {knownCharacters.map((c) => {
                const on = characterIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setCharacterIds((cur) => (on ? cur.filter((x) => x !== c.id) : [...cur, c.id]))}
                    className={on ? 'border border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/10 px-2 py-0.5 text-xs text-[var(--agent-app-accent)]' : 'border border-[var(--agent-app-border)] px-2 py-0.5 text-xs'}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          </div>
        ) : (
          <Input label={t('Characters used')} placeholder={t('Names of the characters on the product')} value={characterText} onChange={(e) => setCharacterText(e.target.value)} />
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          {categories.length > 0 ? (
            <Select label={t('Category')} value={category} placeholder={t('Choose')} options={categories.map((d) => ({ value: d.code, label: tf(d, 'label') }))} onChange={(e) => setCategory(e.target.value)} />
          ) : (
            <Input label={t('Category')} value={category} onChange={(e) => setCategory(e.target.value)} />
          )}
          {channels.length > 0 ? (
            <Select label={t('Sales channel')} value={channel} placeholder={t('Choose')} options={channels.map((d) => ({ value: d.code, label: tf(d, 'label') }))} onChange={(e) => setChannel(e.target.value)} />
          ) : (
            <Input label={t('Sales channel')} value={channel} onChange={(e) => setChannel(e.target.value)} />
          )}
          <Select label={t('Occasion')} value={occasion} options={enumOptions('products.occasion').map(([value, label]) => ({ value, label }))} onChange={(e) => setOccasion(e.target.value)} />
          <Select label={t('How it is sold')} value={salesModel} options={enumOptions('products.sales_model').map(([value, label]) => ({ value, label }))} onChange={(e) => setSalesModel(e.target.value)} />
          <Input label={t('Planned sales start')} type="date" value={salesStart} onChange={(e) => setSalesStart(e.target.value)} />
          <Input label={t('JAN code')} className="font-mono" inputMode="numeric" value={jan} onChange={(e) => setJan(e.target.value.replace(/[^0-9]/g, ''))} />
          <Input label={t('Retail price')} type="number" min={0} step="any" value={price} onChange={(e) => setPrice(e.target.value)} />
          <Select label={t('Currency')} value={currency} options={(CURRENCIES.includes(currency) ? CURRENCIES : [...CURRENCIES, currency]).map((c) => ({ value: c, label: c }))} onChange={(e) => setCurrency(e.target.value)} />
        </div>
        <Checkbox checked={voice} onChange={setVoice} label={t('Includes recorded voice')} />
        <Textarea label={t('Notes for the licensor')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ImagesField files={images} onChange={setImages} label={t('Images (sketches, mock-ups)')} help={t('Images or PDFs, up to 10 files.')} />
      </DialogBody>
    </Dialog>
  );
}

function NextStageDialog({ ctx, product, onClose }: { ctx: PortalContext; product: Product; onClose: () => void }): React.JSX.Element {
  const agreement = agreementOf(ctx, product.agreement);
  const stages = useStageList(agreement?.approval_stages);
  const mine = ctx.approvals.filter((a) => a.product === product.id);
  const approvedIdx = Math.max(-1, ...mine.filter((a) => a.status === 'approved').map((a) => stages.findIndex((s) => s.key === a.stage)));
  const blocked = new Set(mine.filter((a) => OPEN_APPROVAL.includes(a.status) || a.status === 'approved').map((a) => a.stage));
  const choices = stages.filter((s) => !blocked.has(s.key));
  const suggested = stages.slice(approvedIdx + 1).find((s) => !blocked.has(s.key)) ?? choices[0];
  const [stage, setStage] = useState(suggested?.key ?? '');
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);

  const submit = async (): Promise<void> => {
    if (stage === '') return;
    setBusy(true);
    try {
      const r = await opForm<{ due_date: string }>('portal/submit-stage', { product_id: product.id, stage, notes: notes.trim() }, { images });
      toast.success(r.due_date !== '' ? t('Submitted. The licensor replies by {date}.', { date: fmtDate(r.due_date) }) : t('Submitted to the licensor.'));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Submit next stage')}
      description={product.name}
      className="w-[min(94vw,36rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={stage === ''} onClick={() => void submit()}>
            <Send size={13} aria-hidden /> {t('Submit')}
          </Button>
        </>
      }
    >
      <DialogBody>
        {choices.length === 0 ? (
          <Notice tone="info">{t('Every stage has been submitted. Wait for the open approval, or contact the licensor.')}</Notice>
        ) : (
          <Select label={t('Stage')} value={stage} options={choices.map((s) => ({ value: s.key, label: stageName(s.key, stages) }))} onChange={(e) => setStage(e.target.value)} />
        )}
        <Textarea label={t('Notes for the reviewers')} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ImagesField files={images} onChange={setImages} help={t('Images or PDFs of this stage (design, sample photos, packaging), up to 10 files.')} />
      </DialogBody>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Approvals                                                           */
/* ------------------------------------------------------------------ */

function Approvals({ ctx, focusId }: { ctx: PortalContext; focusId: string }): React.JSX.Element {
  const [picked, setOpen] = useState<Approval | null>(null);
  const focused = focusId !== '' ? (ctx.approvals.find((a) => a.id === focusId) ?? null) : null;
  const open = picked ?? focused;
  const close = (): void => {
    setOpen(null);
    if (focused !== null) navigate('portal', undefined, { tab: 'approvals' });
  };
  const sorted = useMemo(() => {
    const rank = (s: string): number => (s === 'changes_requested' ? 0 : s === 'submitted' || s === 'in_review' ? 1 : 2);
    return ctx.approvals.slice().sort((a, b) => rank(a.status) - rank(b.status) || b.due_date.localeCompare(a.due_date));
  }, [ctx.approvals]);
  if (sorted.length === 0) {
    return <EmptyHint icon={ClipboardCheck} title={t('No approvals yet')} message={t('Each product stage you submit appears here with the licensor\'s decision and comments.')} />;
  }
  return (
    <>
      <PortalList>
        {sorted.map((a) => {
          const stages = agreementOf(ctx, ctx.products.find((p) => p.id === a.product)?.agreement ?? '')?.approval_stages;
          return (
            <li key={a.id} className="border-b border-[var(--agent-app-border)]/70 last:border-0">
              <button type="button" onClick={() => setOpen(a)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-left hover:bg-[var(--agent-app-border)]/20">
                <div className="min-w-0 flex-1 basis-56">
                  <div className="truncate text-[13px] font-medium">{productName(ctx, a.product)}</div>
                  <div className="truncate text-xs text-[var(--agent-app-muted)]">
                    {stageName(a.stage, stages)} · {t('Round {n}', { n: a.round || 1 })}
                    {a.due_date !== '' && OPEN_APPROVAL.includes(a.status) && a.status !== 'changes_requested' ? ` · ${t('Reply due {date}', { date: fmtDate(a.due_date) })}` : ''}
                  </div>
                </div>
                <EnumPill field="approvals.status" value={a.status} />
              </button>
            </li>
          );
        })}
      </PortalList>
      {open !== null && <LicenseeApprovalDrawer ctx={ctx} item={open} onClose={close} />}
    </>
  );
}

function LicenseeApprovalDrawer({ ctx, item, onClose }: { ctx: PortalContext; item: Approval; onClose: () => void }): React.JSX.Element {
  const { approval, loading, error } = useApprovalRecord(item.id);
  const [resubmitting, setResubmitting] = useState(false);
  const product = ctx.products.find((p) => p.id === item.product);
  const stages: StageTemplate[] | undefined = agreementOf(ctx, product?.agreement ?? '')?.approval_stages;
  const status = approval?.status ?? item.status;
  return (
    <Drawer
      open
      onClose={onClose}
      title={product?.name ?? t('Approval')}
      width={680}
      footer={
        status === 'changes_requested' ? (
          <Button size="sm" onClick={() => setResubmitting(true)}>
            <RotateCcw size={13} aria-hidden /> {t('Resubmit')}
          </Button>
        ) : undefined
      }
    >
      {loading && approval === null ? (
        <Loading />
      ) : error !== null && approval === null ? (
        <ErrorBox message={error} />
      ) : approval !== null ? (
        <div className="flex flex-col gap-4">
          {status === 'changes_requested' && <Notice tone="warn">{t('The reviewers asked for changes. Read their comments, update the design, then resubmit with new images.')}</Notice>}
          <ApprovalDetail approval={approval} stages={stages} />
        </div>
      ) : null}
      {resubmitting && <ResubmitDialog approvalId={item.id} onClose={() => setResubmitting(false)} />}
    </Drawer>
  );
}

function ResubmitDialog({ approvalId, onClose }: { approvalId: string; onClose: () => void }): React.JSX.Element {
  const [notes, setNotes] = useState('');
  const [images, setImages] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await opForm<{ round: number; due_date: string }>('approvals/resubmit', { approval_id: approvalId, notes: notes.trim() }, { images });
      toast.success(t('Round {n} sent. The licensor replies by {date}.', { n: r.round, date: fmtDate(r.due_date) }));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Resubmit with changes')}
      className="w-[min(94vw,34rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            <Send size={13} aria-hidden /> {t('Resubmit')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Textarea label={t('What you changed')} rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <ImagesField files={images} onChange={setImages} help={t('The new images replace the previous ones for this stage.')} />
      </DialogBody>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Statements                                                          */
/* ------------------------------------------------------------------ */

function Statements({ ctx, focusId }: { ctx: PortalContext; focusId: string }): React.JSX.Element {
  const [filing, setFiling] = useState<Statement | null>(null);
  const found = focusId !== '' && ctx.statements.some((s) => s.id === focusId);
  useEffect(() => {
    if (!found) return;
    document.getElementById(`portal-statement-${focusId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [found, focusId]);
  if (ctx.statements.length === 0) {
    return <EmptyHint icon={ReceiptJapaneseYen} title={t('No statements expected yet')} message={t('When a reporting period of one of your licences ends, the statement to file appears here with its due date.')} />;
  }
  return (
    <div className="flex flex-col gap-3">
      {ctx.statements.map((s) => {
        const a = agreementOf(ctx, s.agreement);
        const editable = s.status === 'expected' || s.status === 'received';
        const late = s.status === 'expected' && s.due_date !== '' && s.due_date < today();
        return (
          <Section
            key={s.id}
            id={`portal-statement-${s.id}`}
            className={s.id === focusId ? 'border-[var(--agent-app-accent)] ring-1 ring-[var(--agent-app-accent)]' : undefined}
            title={`${fmtDate(s.period_start)} - ${fmtDate(s.period_end)}`}
            meta={a !== undefined ? `${a.ref} · ${a.title}` : undefined}
            actions={<EnumPill field="royalty_reports.status" value={s.status} />}
          >
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap gap-x-6 gap-y-2">
                  <Fact label={t('Due')} value={<span className={late ? TONE_TEXT.bad : ''}>{fmtDate(s.due_date)}</span>} />
                  {s.status !== 'expected' && <Fact label={t('Royalty due')} value={fmtMoney(s.royalty_due, s.currency)} />}
                </div>
                {editable && (
                  <Button size="sm" variant={s.status === 'expected' ? 'primary' : 'outline'} onClick={() => setFiling(s)}>
                    {s.status === 'expected' ? t('File statement') : t('Correct the statement')}
                  </Button>
                )}
              </div>
              {s.lines.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[30rem] border-collapse text-[13px]">
                    <thead>
                      <tr className="border-b border-[var(--agent-app-border)] text-left text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                        <th className="py-1.5 pr-3 font-semibold">{t('Product')}</th>
                        <th className="px-2 py-1.5 text-right font-semibold">{t('Manufactured')}</th>
                        <th className="px-2 py-1.5 text-right font-semibold">{t('Sold')}</th>
                        <th className="px-2 py-1.5 text-right font-semibold">{t('Retail price')}</th>
                        <th className="py-1.5 pl-2 text-right font-semibold">{t('Royalty')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.lines.map((l, i) => (
                        <tr key={i} className="border-b border-[var(--agent-app-border)]/70 last:border-0">
                          <td className="py-1.5 pr-3">{l.product !== '' ? productName(ctx, l.product) : l.description}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{l.manufactured_qty.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{l.sold_qty.toLocaleString()}</td>
                          <td className="px-2 py-1.5 text-right tabular-nums">{fmtMoney(l.retail_price, s.currency)}</td>
                          <td className="py-1.5 pl-2 text-right tabular-nums">{fmtMoney(l.royalty, s.currency)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </Section>
        );
      })}
      {filing !== null && <StatementDialog ctx={ctx} statement={filing} onClose={() => setFiling(null)} />}
    </div>
  );
}

interface LineDraft {
  product: string;
  description: string;
  manufactured: string;
  sold: string;
  price: string;
}

function StatementDialog({ ctx, statement, onClose }: { ctx: PortalContext; statement: Statement; onClose: () => void }): React.JSX.Element {
  const agreement = agreementOf(ctx, statement.agreement);
  const products = ctx.products.filter((p) => p.agreement === statement.agreement);
  const [lines, setLines] = useState<LineDraft[]>(() => {
    if (statement.lines.length > 0) {
      return statement.lines.map((l) => ({ product: l.product, description: l.description, manufactured: String(l.manufactured_qty), sold: String(l.sold_qty), price: String(l.retail_price) }));
    }
    return products.map((p) => ({ product: p.id, description: '', manufactured: '', sold: '', price: p.retail_price > 0 ? String(p.retail_price) : '' }));
  });
  const [busy, setBusy] = useState(false);
  const patch = (i: number, p: Partial<LineDraft>): void => setLines((cur) => cur.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const filled = lines.filter((l) => num(l.manufactured) > 0 || num(l.sold) > 0);
  const basisNote = agreement !== undefined ? `${enumLabel('agreements.royalty_basis', agreement.royalty_basis)}${agreement.royalty_rate > 0 ? ` · ${fmtPct(agreement.royalty_rate)}` : ''}` : '';

  const submit = async (): Promise<void> => {
    if (filled.length === 0) {
      toast.error(t('Enter the quantities for at least one product.'));
      return;
    }
    setBusy(true);
    try {
      const r = await op<{ royalty_due: number }>('portal/submit-statement', {
        report_id: statement.id,
        lines: filled.map((l) => ({ product_id: l.product, description: l.description.trim(), manufactured_qty: num(l.manufactured), sold_qty: num(l.sold), retail_price: num(l.price) })),
      });
      toast.success(t('Statement filed. Royalty due: {amount}.', { amount: fmtMoney(r.royalty_due, statement.currency) }));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Royalty statement for {from} - {to}', { from: fmtDate(statement.period_start), to: fmtDate(statement.period_end) })}
      description={basisNote !== '' ? t('Royalty basis: {basis}. The royalty is calculated by the licensor from your quantities and prices.', { basis: basisNote }) : undefined}
      className="w-[min(94vw,46rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={filled.length === 0} onClick={() => void submit()}>
            <Send size={13} aria-hidden /> {t('File statement')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('One line per product. Enter the units manufactured and sold in this period and the retail price. Lines left at zero are not sent.')}</p>
        {lines.map((l, i) => (
          <div key={i} className="flex min-w-0 flex-col gap-2 border border-[var(--agent-app-border)] p-3">
            <div className="flex items-center gap-2">
              {l.product !== '' ? (
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{productName(ctx, l.product)}</span>
              ) : (
                <Input aria-label={t('Description')} className="min-w-0 flex-1" placeholder={t('Description')} value={l.description} onChange={(e) => patch(i, { description: e.target.value })} />
              )}
              <Button size="sm" variant="ghost" className="h-7 shrink-0 px-2" aria-label={t('Remove')} onClick={() => setLines((cur) => cur.filter((_, j) => j !== i))}>
                <Trash2 size={13} aria-hidden />
              </Button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <Input label={t('Manufactured')} type="number" min={0} value={l.manufactured} onChange={(e) => patch(i, { manufactured: e.target.value })} />
              <Input label={t('Sold')} type="number" min={0} value={l.sold} onChange={(e) => patch(i, { sold: e.target.value })} />
              <Input label={t('Retail price')} type="number" min={0} step="any" value={l.price} onChange={(e) => patch(i, { price: e.target.value })} />
            </div>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          {products
            .filter((p) => !lines.some((l) => l.product === p.id))
            .map((p) => (
              <Button key={p.id} size="sm" variant="outline" onClick={() => setLines((cur) => [...cur, { product: p.id, description: '', manufactured: '', sold: '', price: p.retail_price > 0 ? String(p.retail_price) : '' }])}>
                <Plus size={12} aria-hidden /> {p.name}
              </Button>
            ))}
          <Button size="sm" variant="ghost" onClick={() => setLines((cur) => [...cur, { product: '', description: '', manufactured: '', sold: '', price: '' }])}>
            <Plus size={12} aria-hidden /> {t('Other line')}
          </Button>
        </div>
      </DialogBody>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Seals                                                               */
/* ------------------------------------------------------------------ */

function Seals({ ctx }: { ctx: PortalContext }): React.JSX.Element {
  const [ordering, setOrdering] = useState(false);
  const [reporting, setReporting] = useState<Seal | null>(null);
  const products = ctx.products.filter((p) => !['cancelled', 'ended'].includes(p.stage));
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="min-w-0 text-[13px] text-[var(--agent-app-muted)]">{t('Seals (証紙) show that a product is licensed. Order them per product, then report how many were used, voided or returned.')}</p>
        <Button disabled={products.length === 0} onClick={() => setOrdering(true)}>
          <Stamp size={14} aria-hidden /> {t('Order seals')}
        </Button>
      </div>
      {ctx.seals.length === 0 ? (
        <EmptyHint icon={Stamp} title={t('No seal orders yet')} message={t('Order seals for a product once its final sample is approved.')} />
      ) : (
        <PortalList>
          {ctx.seals.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
              <div className="min-w-0 flex-1 basis-56">
                <div className="truncate text-[13px] font-medium">{productName(ctx, s.product)}</div>
                <div className="truncate text-xs text-[var(--agent-app-muted)]">
                  {t('{n} seals', { n: s.quantity.toLocaleString() })}
                  {s.serial_from !== '' ? ` · ${s.serial_from} - ${s.serial_to}` : ''}
                  {s.status === 'reconciled' || s.used + s.void + s.returned > 0 ? ` · ${t('used {used}, voided {void}, returned {returned}', { used: s.used, void: s.void, returned: s.returned })}` : ''}
                </div>
              </div>
              <EnumPill field="seal_orders.status" value={s.status} />
              {s.status === 'issued' && (
                <Button size="sm" variant="outline" onClick={() => setReporting(s)}>
                  {t('Report usage')}
                </Button>
              )}
            </li>
          ))}
        </PortalList>
      )}
      {ordering && <OrderSealsDialog products={products} onClose={() => setOrdering(false)} />}
      {reporting !== null && <ReportUsageDialog seal={reporting} productName={productName(ctx, reporting.product)} onClose={() => setReporting(null)} />}
    </div>
  );
}

function OrderSealsDialog({ products, onClose }: { products: Product[]; onClose: () => void }): React.JSX.Element {
  const [product, setProduct] = useState(products[0]?.id ?? '');
  const [qty, setQty] = useState('');
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const ok = product !== '' && Math.floor(num(qty)) > 0;
  const submit = async (): Promise<void> => {
    if (!ok) return;
    setBusy(true);
    try {
      await op('portal/order-seals', { product_id: product, quantity: Math.floor(num(qty)), notes: notes.trim() });
      toast.success(t('Seal order sent. The licensor issues the seals and their serial numbers.'));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Order seals')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} disabled={!ok} onClick={() => void submit()}>
            {t('Send order')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <Select label={t('Product')} value={product} options={products.map((p) => ({ value: p.id, label: p.ref !== '' ? `${p.ref} · ${p.name}` : p.name }))} onChange={(e) => setProduct(e.target.value)} />
        <Input label={t('Number of seals')} type="number" min={1} value={qty} onChange={(e) => setQty(e.target.value)} />
        <Textarea label={t('Notes for the licensor')} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </DialogBody>
    </Dialog>
  );
}

function ReportUsageDialog({ seal, productName, onClose }: { seal: Seal; productName: string; onClose: () => void }): React.JSX.Element {
  const [used, setUsed] = useState(String(seal.used || ''));
  const [voided, setVoided] = useState(String(seal.void || ''));
  const [returned, setReturned] = useState(String(seal.returned || ''));
  const [busy, setBusy] = useState(false);
  const total = num(used) + num(voided) + num(returned);
  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('seals/reconcile', { order_id: seal.id, used: num(used), void: num(voided), returned: num(returned) });
      toast.success(t('Seal usage reported'));
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
      onOpenChange={(v) => {
        if (!v) onClose();
      }}
      title={t('Report seal usage')}
      description={`${productName} · ${t('{n} seals', { n: seal.quantity.toLocaleString() })}`}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button loading={busy} onClick={() => void submit()}>
            {t('Send report')}
          </Button>
        </>
      }
    >
      <DialogBody>
        <div className="grid grid-cols-3 gap-2">
          <Input label={t('Used')} type="number" min={0} value={used} onChange={(e) => setUsed(e.target.value)} />
          <Input label={t('Voided')} type="number" min={0} value={voided} onChange={(e) => setVoided(e.target.value)} />
          <Input label={t('Returned')} type="number" min={0} value={returned} onChange={(e) => setReturned(e.target.value)} />
        </div>
        <p className={total !== seal.quantity ? `text-xs ${TONE_TEXT.warn}` : 'text-xs text-[var(--agent-app-muted)]'}>
          {t('{total} of {n} seals accounted for.', { total: total.toLocaleString(), n: seal.quantity.toLocaleString() })}
        </p>
        <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">{t('Voided seals are damaged or misprinted ones. Return unused seals to the licensor.')}</p>
      </DialogBody>
    </Dialog>
  );
}
