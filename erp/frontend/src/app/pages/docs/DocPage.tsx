/**
 * One document. Left: the document as the party receives it (a draft is
 * edited right here with the same line editor as the new flow). Top: its
 * next step as the one primary button, everything else in the menu. Right:
 * where it stands (balance, payments, delivery progress), the chain it
 * belongs to, proposals from your AI agent, the journal it posted, and its
 * activity.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  BookCheck,
  Check,
  CheckCircle2,
  CircleSlash,
  Copy,
  CreditCard,
  Eye,
  FileText,
  Lock,
  PackageCheck,
  PencilLine,
  Printer,
  RefreshCw,
  ReceiptText,
  RotateCcw,
  Save,
  Send,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  Truck,
  Undo2,
  XCircle,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { RecordActivity } from '../../components/Activity.tsx';
import { useAgentRequest } from '../../components/AskAgent.tsx';
import { ConfirmPosting } from '../../components/Books.tsx';
import { Menu, Segmented } from '../../components/controls.tsx';
import type { MenuItem } from '../../components/controls.tsx';
import { PartyPicker } from '../../components/pickers.tsx';
import type { Option } from '../../components/pickers.tsx';
import { ProposalCard } from '../../components/Proposal.tsx';
import { FlowChain, JournalCard, RecordPayment, StatusCard, TextModal } from '../../components/sales/docside.tsx';
import { LineEditor, TotalsCard, filled, lineOk, lineParams, linesFromDoc, newLine, totalsOf } from '../../components/sales/editor.tsx';
import type { EditLine } from '../../components/sales/editor.tsx';
import { HeadFields, MoreOptions, headFromDoc, headParams } from '../../components/sales/form.tsx';
import type { DocHead } from '../../components/sales/form.tsx';
import { Paper } from '../../components/sales/paper.tsx';
import { AgentMark, DocStatusPill, PartyLink, SHORT_TYPE, canDoc, canPay, dueFrom, lowerType, moneyOf, roleOf, useCompanySettings, useRefData } from '../../components/sales/parts.tsx';
import { Card, CardHeader, Empty, Field, LoadError, Notice, PageHeader, PageSkeleton, PillButton, StatusPill, errMessage, softArea, useConfirm } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayPhrase } from '../../lib/dates.ts';
import { money } from '../../lib/format.ts';
import { READS, useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { PAGE_OF_TYPE, back, navigate, useSection } from '../../lib/router.ts';
import type { DocType } from '../../lib/router.ts';
import type { Proposal } from '../../lib/types.ts';
import type { DocDetail, PartyDetail } from '../../lib/types/sales.ts';
import type { PageProps } from '../../routes.tsx';

const CONVERT_LABEL: Record<DocType, string> = {
  quote: 'quote',
  sales_order: 'Convert to sales order',
  delivery: 'Create delivery',
  invoice: 'Create invoice',
  credit_note: 'Create credit note',
  purchase_order: 'purchase order',
  goods_receipt: 'Receive goods',
  bill: 'Create bill',
  supplier_credit: 'Create supplier credit',
};

const CONVERT_ICON: Partial<Record<DocType, LucideIcon>> = { sales_order: BookCheck, delivery: Truck, invoice: ReceiptText, credit_note: Undo2, goods_receipt: PackageCheck, bill: ReceiptText, supplier_credit: Undo2 };

const FIELD_LABEL: Record<string, string> = { party: 'the party', date: 'the date', due_date: 'the due date', reference: 'the reference', currency: 'the currency', fx_rate: 'the rate', terms: 'the terms' };

interface Primary {
  label: string;
  icon: LucideIcon;
  run: (e: React.MouseEvent<HTMLButtonElement>) => void;
}

function Details({ doc }: { doc: DocDetail }): React.JSX.Element {
  const rows: [string, React.ReactNode][] = [];
  rows.push(['Prepared by', doc.prepared_actor === 'agent' ? <span className="inline-flex items-center gap-1"><Sparkles size={13} aria-hidden /> Your AI agent</span> : doc.prepared_by || 'Someone']);
  if (doc.posted_by !== '') rows.push(['Posted by', `${doc.posted_by}${doc.posted_at !== '' ? `, ${dayPhrase(doc.posted_at.slice(0, 10))}` : ''}`]);
  if (doc.terms !== null) rows.push(['Payment terms', doc.terms.name]);
  if (doc.currency !== doc.base_currency) rows.push(['Currency', `${doc.currency} at ${doc.fx_rate} ${doc.base_currency}`]);
  if (doc.prices_include_tax) rows.push(['Prices', 'Include tax']);
  if (doc.warehouse !== null && doc.type !== 'quote') rows.push(['Warehouse', doc.warehouse.name]);
  if (moneyOf(doc.type)) rows.push(['Stock', doc.moves_stock ? (doc.type === 'invoice' || doc.type === 'supplier_credit' ? 'Goes out with it' : 'Comes in with it') : 'Not moved']);
  if (doc.project !== null) rows.push(['Project', <button key="p" type="button" onClick={() => navigate('project', { id: doc.project?.id ?? '' })} className="font-semibold underline-offset-4 hover:underline">{doc.project.name}</button>]);
  if (doc.department !== null) rows.push(['Department', doc.department.name]);
  return (
    <Card delay={3}>
      <CardHeader title="Details" />
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-[var(--erp-muted)]">{k}</dt>
            <dd className="min-w-0 text-right font-semibold">{v}</dd>
          </div>
        ))}
      </dl>
      {doc.internal_note !== '' && (
        <div className="mt-4 rounded-[16px] bg-[var(--erp-row)] px-4 py-3 text-[13px] leading-5">
          <p className="mb-0.5 text-[12px] font-semibold text-[var(--erp-muted)]">Internal note</p>
          {doc.internal_note}
        </div>
      )}
      {doc.agent_fields.length > 0 && (
        <div className="mt-4">
          <Notice tone="agent" icon={Sparkles}>
            Your AI agent filled {doc.agent_fields.map((f) => FIELD_LABEL[f] ?? f.replace(/_/g, ' ')).join(', ')}. Check them before you post.
          </Notice>
        </div>
      )}
    </Card>
  );
}

export function DocPage({ query }: PageProps): React.JSX.Element {
  const id = query.get('id') ?? '';
  const me = useMe();
  const live = useLive(() => op<DocDetail>('docs.get', { doc: id }, { quiet: true }), [...READS.docs, 'parties', 'proposals', 'journals', 'stock_moves'], [id]);
  const doc = live.data;
  useSection('doc', doc !== null ? PAGE_OF_TYPE[doc.type] : null);
  const company = useCompanySettings();
  const refs = useRefData();
  const proposalIds = (doc?.proposals ?? []).map((p) => p.id).join(',');
  const proposals = useLive(
    () => (proposalIds === '' ? Promise.resolve([] as Proposal[]) : Promise.all(proposalIds.split(',').map((p) => op<Proposal>('proposals.get', { proposal: p }, { quiet: true }).catch(() => null))).then((r) => r.filter((x): x is Proposal => x !== null))),
    ['proposals'],
    [proposalIds],
  );

  // The editor (drafts; open quotes and orders on request).
  const [editOpen, setEditOpen] = useState(false);
  const [view, setView] = useState<'edit' | 'preview'>('edit');
  const [head, setHead] = useState<DocHead | null>(null);
  const [initial, setInitial] = useState<DocHead | null>(null);
  const [lines, setLines] = useState<EditLine[]>([]);
  const [linesKey, setLinesKey] = useState('');
  const [partySel, setPartySel] = useState<Option | null>(null);
  const [more, setMore] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The version of the document the form holds, and whether a newer one arrived while there were edits.
  const loadedKey = useRef('');
  const [outdated, setOutdated] = useState(false);

  // Dialogs and actions.
  const [posting, setPosting] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [paying, setPaying] = useState(false);
  const [asText, setAsText] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const request = useAgentRequest(requestId);
  const [confirmEl, confirm] = useConfirm();

  const editing = doc !== null && doc.can.edit && (doc.state === 'draft' || editOpen);
  // The tax a new line starts with: the party's own, else the company's (as the server picks it).
  const partyId = editing && doc.party !== null ? doc.party.id : '';
  const partyInfo = useLive(() => (partyId === '' ? Promise.resolve(null) : op<PartyDetail>('parties.get', { party: partyId }, { quiet: true }).catch(() => null)), ['parties'], [partyId]);
  const newLineTax = doc === null || doc.type === 'delivery' || doc.type === 'goods_receipt' ? 'none' : ((doc.side === 'sales' ? partyInfo.data?.effective_sale_tax?.code : partyInfo.data?.effective_purchase_tax?.code) ?? 'none');
  const base = me.company.currency;

  // Load the form from the document (again after a save or a change elsewhere, unless there are edits).
  const docKey = doc !== null ? `${doc.id}:${doc.updated}` : '';
  const formFor = (d: DocDetail): DocHead => {
    const h = headFromDoc(d);
    // A due date that follows the terms stays "by the terms", so a new date moves it.
    if (d.terms !== null && refs !== null) {
      const t = refs.terms.find((x) => x.id === d.terms?.id) ?? null;
      if (t !== null && dueFrom(d.date, t) === d.due_date) h.due_date = '';
    }
    return h;
  };
  const dirtyParams = useMemo(() => {
    if (doc === null || head === null || initial === null) return null;
    const p: Record<string, unknown> = headParams(doc.type, head, base, initial);
    const now = JSON.stringify(lineParams(lines, doc.type));
    if (now !== linesKey) p['lines'] = lineParams(lines, doc.type);
    if (partySel !== null && doc.party !== null && partySel.id !== doc.party.id) p['party'] = partySel.id;
    return p;
  }, [doc, head, initial, lines, linesKey, partySel, base]);
  const dirty = dirtyParams !== null && Object.keys(dirtyParams).length > 0;

  useEffect(() => {
    if (doc === null) return;
    if (dirty && head !== null) {
      // Changed elsewhere (your AI agent, a teammate) while there are edits here: keep the edits, say so.
      if (loadedKey.current !== '' && loadedKey.current !== docKey) setOutdated(true);
      return;
    }
    const h = formFor(doc);
    setHead(h);
    setInitial(h);
    const ls = linesFromDoc(doc);
    setLines(ls.length > 0 ? ls : []);
    setLinesKey(JSON.stringify(lineParams(ls, doc.type)));
    setPartySel(doc.party !== null ? { id: doc.party.id, label: doc.party.name } : null);
    loadedKey.current = docKey;
    setOutdated(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docKey, refs !== null]);

  useEffect(() => {
    setEditOpen(false);
    setView('edit');
    setRequestId(null);
    setSaveError(null);
  }, [id]);

  if (doc === null) {
    if (live.error !== null) {
      return (
        <>
          <PageHeader title="Document" back={() => back('invoices')} />
          <LoadError message={live.error} onRetry={live.reload} />
        </>
      );
    }
    return <PageSkeleton rows={8} />;
  }

  const d = doc;
  const side = d.side;
  const label = lowerType(d.type);
  const canEdit = canDoc(me, d.type, 'edit');
  const totals = totalsOf(lines, d.type, refs?.taxes ?? [], head?.prices_include_tax ?? d.prices_include_tax, head?.currency !== undefined && head.currency !== '' ? head.currency : d.currency);
  const filledLines = lines.filter(filled);
  const linesValid = filledLines.length > 0 && filledLines.every(lineOk);

  const act = async (name: string, fn: () => Promise<unknown>, done: string): Promise<void> => {
    setBusy(name);
    try {
      const r = await fn();
      if (r !== null && typeof r === 'object' && 'id' in r && 'lines' in r) live.set(r as DocDetail);
      toast.success(done);
    } catch {
      /* the message was shown */
    } finally {
      setBusy(null);
    }
  };

  const save = async (): Promise<boolean> => {
    if (!dirty || dirtyParams === null) return true;
    if (!linesValid) {
      setSaveError('Check the lines: each needs an item or a description and a quantity above 0.');
      return false;
    }
    setSaving(true);
    setSaveError(null);
    try {
      const r = await op<DocDetail>('docs.update', { doc: d.id, ...(dirtyParams as Record<string, string>) }, { quiet: true });
      loadedKey.current = `${r.id}:${r.updated}`;
      setOutdated(false);
      const h = formFor(r);
      setHead(h);
      setInitial(h);
      const ls = linesFromDoc(r);
      setLines(ls);
      setLinesKey(JSON.stringify(lineParams(ls, r.type)));
      setPartySel(r.party !== null ? { id: r.party.id, label: r.party.name } : null);
      live.set(r);
      return true;
    } catch (err) {
      setSaveError(errMessage(err));
      return false;
    } finally {
      setSaving(false);
    }
  };

  const discard = (): void => {
    const h = formFor(d);
    setHead(h);
    setInitial(h);
    const ls = linesFromDoc(d);
    setLines(ls);
    setLinesKey(JSON.stringify(lineParams(ls, d.type)));
    setPartySel(d.party !== null ? { id: d.party.id, label: d.party.name } : null);
    setSaveError(null);
    loadedKey.current = docKey;
    setOutdated(false);
  };

  const convert = (to: DocType): void => {
    void act(
      `convert:${to}`,
      async () => {
        if (!(await save())) throw new Error('not saved');
        const r = await op<DocDetail>('docs.convert', { doc: d.id, to });
        navigate('doc', { id: r.id });
        return null;
      },
      `Draft ${lowerType(to)} made from ${d.number !== '' ? d.number : `this ${label}`}`,
    );
  };

  const askSend = async (): Promise<void> => {
    try {
      const r = await op<{ request: string }>('agent.request', { kind: 'doc_send_requested', doc: d.id });
      setRequestId(r.request);
      toast.success('Sent to your AI agent');
    } catch {
      /* shown */
    }
  };

  const remove = async (): Promise<void> => {
    if (!(await confirm(`${d.number !== '' ? d.number : `This draft ${label}`} and its lines are deleted. This cannot be undone.`, `Delete this ${label}?`))) return;
    try {
      await op('docs.delete', { doc: d.id });
      toast.success('Deleted');
      navigate(PAGE_OF_TYPE[d.type]);
    } catch {
      /* shown */
    }
  };

  const applyCredit = async (): Promise<void> => {
    if (!(await confirm(`${money(d.balance, d.currency)} of credit goes to the oldest open ${d.type === 'credit_note' ? 'invoices' : 'bills'} of ${d.party?.name ?? 'this party'}.`, 'Apply the credit?', 'Apply', false))) return;
    void act('apply', () => op('payments.apply', { credit: d.id }), 'Credit applied');
  };

  const cancelDoc = async (): Promise<void> => {
    if (!(await confirm(`Nothing more is expected on ${d.number}. You can reopen it later.`, `Cancel this ${label}?`, 'Cancel it'))) return;
    void act('cancel', () => op('docs.cancel', { doc: d.id }), 'Cancelled');
  };

  const print = (): void => {
    setView('preview');
    setTimeout(() => window.print(), 120);
  };

  // The one primary action: the next step.
  const payRight = d.can.pay && canPay(me, side);
  const primary: Primary | null = (() => {
    switch (d.next) {
      case 'post':
        return d.can.post ? { label: `Post ${label}`, icon: Check, run: () => void save().then((ok) => ok && setPosting(true)) } : null;
      case 'send':
        return canEdit ? { label: 'Mark as sent', icon: Send, run: () => void act('primary', async () => ((await save()) ? op('docs.mark-sent', { doc: d.id }) : null), 'Marked as sent') } : null;
      case 'confirm':
        return d.can.confirm ? { label: 'Confirm order', icon: Check, run: () => void act('primary', async () => ((await save()) ? op('docs.confirm', { doc: d.id }) : null), 'Order confirmed') } : null;
      case 'convert':
      case 'deliver':
      case 'invoice':
      case 'receive':
      case 'bill': {
        const want: DocType | undefined = d.next === 'deliver' ? 'delivery' : d.next === 'invoice' ? 'invoice' : d.next === 'receive' ? 'goods_receipt' : d.next === 'bill' ? 'bill' : d.can.convert[0];
        if (want === undefined || !d.can.convert.includes(want)) return null;
        return { label: CONVERT_LABEL[want], icon: CONVERT_ICON[want] ?? FileText, run: () => convert(want) };
      }
      case 'pay':
        return payRight ? { label: 'Record payment', icon: CreditCard, run: () => setPaying(true) } : null;
      case 'apply':
        return d.can.void ? { label: `Apply to ${d.type === 'credit_note' ? 'invoices' : 'bills'}`, icon: ReceiptText, run: () => void applyCredit() } : null;
      default:
        return null;
    }
  })();
  const primaryConvert = d.next === 'deliver' ? 'delivery' : d.next === 'invoice' ? 'invoice' : d.next === 'receive' ? 'goods_receipt' : d.next === 'bill' ? 'bill' : d.next === 'convert' ? d.can.convert[0] : undefined;

  const quoteOpen = d.type === 'quote' && (d.state === 'open' || d.state === 'draft');
  const orderLike = d.type === 'quote' || d.type === 'sales_order' || d.type === 'purchase_order';
  const menu: MenuItem[] = [
    ...d.can.convert
      .filter((t) => !(primary !== null && t === primaryConvert))
      .map((t) => ({ label: t === 'sales_order' || t === 'purchase_order' ? `Convert to ${lowerType(t)}` : t === 'goods_receipt' ? 'Receive goods' : `Create ${lowerType(t)}`, icon: CONVERT_ICON[t] ?? FileText, onClick: () => convert(t), hidden: d.state === 'draft' && d.type !== 'quote' })),
    { label: 'Accept the quote', icon: ThumbsUp, hidden: !(quoteOpen && canEdit), onClick: () => void act('accept', () => op('docs.accept', { doc: d.id }), 'Quote accepted') },
    { label: 'Declined by the customer', icon: ThumbsDown, hidden: !(quoteOpen && canEdit), onClick: () => void act('decline', () => op('docs.decline', { doc: d.id }), 'Quote declined') },
    { label: 'Edit', icon: PencilLine, hidden: !(d.can.edit && d.state === 'open' && !editOpen), onClick: () => setEditOpen(true) },
    { label: 'Mark as sent', icon: Send, hidden: !(canEdit && d.sent_at === '' && d.state !== 'void' && d.state !== 'cancelled' && d.next !== 'send' && d.state !== 'draft'), onClick: () => void act('sent', () => op('docs.mark-sent', { doc: d.id }), 'Marked as sent') },
    { label: 'Send by your AI agent', icon: Sparkles, hidden: !(canEdit && d.state !== 'draft' && d.state !== 'void' && d.state !== 'cancelled'), onClick: () => void askSend() },
    { label: 'Document as text', icon: Copy, onClick: () => setAsText(true) },
    { label: 'Print', icon: Printer, onClick: print },
    { label: 'Duplicate', icon: Copy, hidden: !canEdit, onClick: () => void act('dup', async () => navigate('doc', { id: (await op<DocDetail>('docs.duplicate', { doc: d.id })).id }), 'Copied into a new draft') },
    { label: 'Close: the rest is not expected', icon: CheckCircle2, hidden: !(canEdit && (d.type === 'sales_order' || d.type === 'purchase_order') && d.state === 'open'), onClick: () => void act('close', () => op('docs.close', { doc: d.id }), 'Closed') },
    { label: 'Reopen', icon: RotateCcw, hidden: !(canEdit && ((orderLike && (d.state === 'closed' || d.state === 'cancelled')) || (d.type === 'quote' && (d.state === 'declined' || d.state === 'accepted')))), onClick: () => void act('reopen', () => op('docs.reopen', { doc: d.id }), 'Reopened') },
    { label: `Cancel the ${label}`, icon: XCircle, hidden: !d.can.cancel, danger: true, onClick: () => void cancelDoc() },
    { label: `Void the ${label}`, icon: CircleSlash, hidden: !d.can.void, danger: true, onClick: () => { setReason(''); setVoiding(true); } },
    { label: 'Delete draft', icon: Trash2, hidden: !d.can.delete, danger: true, onClick: () => void remove() },
  ];

  const requestPill =
    request !== null && (request.status === 'pending' || request.status === 'claimed') ? (
      <StatusPill tone="info" pulse>
        {request.status === 'claimed' ? 'Your AI agent is sending it' : 'Sent to your AI agent'}
      </StatusPill>
    ) : request?.status === 'done' ? (
      <StatusPill tone="good">Your AI agent sent it</StatusPill>
    ) : request?.status === 'rejected' ? (
      <StatusPill tone="bad">{request.error !== '' ? request.error : 'Your AI agent could not send it'}</StatusPill>
    ) : null;

  const showPreview = !editing || view === 'preview';

  return (
    <div className={cn(editing && dirty && 'pb-24')}>
      <div className="relative z-30">
      <PageHeader
        back={() => back(PAGE_OF_TYPE[d.type])}
        eyebrow={
          <>
            <span>{d.type_label}</span>
            <DocStatusPill status={d.status} />
            <AgentMark actor={d.prepared_actor} />
          </>
        }
        title={d.number !== '' ? d.number : `Draft ${label}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            {d.party !== null && <PartyLink id={d.party.id} name={d.party.name} role={roleOf(d.type)} className="text-[var(--erp-ink)]" />}
            {moneyOf(d.type) || d.type === 'quote' || d.type === 'sales_order' || d.type === 'purchase_order' ? <span className="num">· {money(d.total, d.currency)}</span> : null}
            {d.date !== '' && <span>· {dayPhrase(d.date)}</span>}
          </span>
        }
        actions={
          <>
            {requestPill}
            {primary !== null && (
              <PillButton icon={primary.icon} dot loading={busy === 'primary' || (primaryConvert !== undefined && busy === `convert:${primaryConvert}`)} disabled={saving || busy !== null} onClick={primary.run}>
                {primary.label}
              </PillButton>
            )}
            <Menu items={menu} />
          </>
        }
      />
      </div>

      {d.state === 'draft' && !d.can.post && d.next === 'post' && (
        <div className="mb-5">
          <Notice tone="neutral" icon={Lock}>
            Someone with full {side === 'sales' ? 'Sales' : 'Purchasing'} rights posts this {label}.
          </Notice>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-8">
          {d.agent_note !== '' && (
            <Card tone="sand" className="flex gap-3 !py-4" delay={1}>
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--erp-accent)] text-[var(--erp-on-accent)]">
                <Sparkles size={16} aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-bold">Why your AI agent made it</p>
                <p className="text-[14px] leading-[22px]">{d.agent_note}</p>
              </div>
            </Card>
          )}

          {editing && outdated && (
            <Notice
              tone="warn"
              icon={RefreshCw}
              action={
                <PillButton size="sm" variant="soft" onClick={discard}>
                  Load the new version
                </PillButton>
              }
            >
              This {label} was changed elsewhere (by your AI agent or a teammate) while you were editing. Saving keeps your version; loading the new one drops your changes.
            </Notice>
          )}

          {editing && (
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Segmented
                ariaLabel="Show"
                onShell
                value={view}
                onChange={setView}
                options={[
                  { value: 'edit', label: 'Edit', icon: PencilLine },
                  { value: 'preview', label: 'Preview', icon: Eye },
                ]}
              />
              {editOpen && d.state !== 'draft' && (
                <PillButton variant="light" size="sm" onClick={() => { discard(); setEditOpen(false); }}>
                  Done editing
                </PillButton>
              )}
            </div>
          )}

          {showPreview ? (
            <Paper doc={d} company={company} />
          ) : head !== null ? (
            <>
              <Card delay={1} className="relative z-10">
                <CardHeader title="Lines" subtitle={`${filledLines.length === 1 ? '1 line' : `${filledLines.length} lines`}`} />
                {lines.length === 0 ? (
                  <Empty icon={FileText} title="No lines yet" compact action={<PillButton variant="soft" size="sm" onClick={() => setLines([newLine(newLineTax, true)])}>Add a line</PillButton>} />
                ) : (
                  <LineEditor
                    type={d.type}
                    side={side}
                    currency={head.currency !== '' ? head.currency : d.currency}
                    inclusive={head.prices_include_tax}
                    taxes={refs?.taxes ?? []}
                    defaultTax={newLineTax}
                    lines={lines}
                    setLines={setLines}
                    advanced={more}
                    watchStock={(d.type === 'invoice' && head.moves_stock) || d.type === 'delivery'}
                  />
                )}
                <div className="mt-5 border-t border-[var(--erp-line)] pt-4">
                  <MoreOptions type={d.type} head={head} setHead={(fn) => setHead((h) => (h === null ? h : typeof fn === 'function' ? fn(h) : fn))} refs={refs} partyCurrency="" open={more} onToggle={() => setMore((m) => !m)} />
                </div>
              </Card>
              <Card delay={2}>
                <CardHeader title="Details" />
                {d.state === 'draft' && (
                  <div className="mb-4">
                    <Field label={side === 'sales' ? 'Customer' : 'Supplier'}>
                      <PartyPicker value={partySel} onChange={(o) => o !== null && setPartySel(o)} role={roleOf(d.type)} />
                    </Field>
                  </div>
                )}
                <HeadFields
                  type={d.type}
                  head={head}
                  setHead={(fn) => setHead((h) => (h === null ? h : typeof fn === 'function' ? fn(h) : fn))}
                  refs={refs}
                  partyTerms={refs?.terms.find((t) => t.id === d.terms?.id) ?? null}
                  validityDays={company?.quote_validity_days ?? 30}
                />
              </Card>
            </>
          ) : (
            <PageSkeleton rows={4} />
          )}
        </div>

        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-4">
          {editing ? (
            <TotalsCard totals={totals} currency={head?.currency !== undefined && head.currency !== '' ? head.currency : d.currency} inclusive={head?.prices_include_tax ?? d.prices_include_tax} title={d.state === 'draft' ? 'Draft total' : 'Total'}>
              {dirty ? (
                <>
                  <PillButton icon={Save} dot loading={saving} onClick={() => void save()} className="w-full">
                    Save changes
                  </PillButton>
                  <PillButton variant="light" onClick={discard} disabled={saving} className="w-full bg-[var(--erp-card)]">
                    Discard changes
                  </PillButton>
                </>
              ) : (
                <p className="text-center text-[12px] text-[var(--erp-muted)]">All changes saved</p>
              )}
              {saveError !== null && <p className="text-[13px] font-semibold text-[var(--erp-red-text)]">{saveError}</p>}
            </TotalsCard>
          ) : (
            <StatusCard doc={d} onPay={payRight && d.next === 'pay' ? () => setPaying(true) : undefined} onApply={d.next === 'apply' && d.can.void ? () => void applyCredit() : undefined} />
          )}
          <FlowChain doc={d} />
          {(proposals.data ?? []).length > 0 && (
            <Card delay={2}>
              <CardHeader title="Waiting for you" subtitle="Your AI agent proposed this" icon={Sparkles} />
              <div className="flex flex-col gap-3">
                {(proposals.data ?? []).map((p) => (
                  <ProposalCard key={p.id} p={p} compact onDecided={live.reload} />
                ))}
              </div>
            </Card>
          )}
          <JournalCard doc={d} />
          {!editing && <Details doc={d} />}
          <RecordActivity entity="documents" refId={d.id} />
        </div>
      </div>

      {/* Unsaved edits: a bar that stays in view. */}
      {editing && dirty && (
        <div className="erp-pop erp-on-ink fixed inset-x-4 bottom-24 z-30 mx-auto flex max-w-xl items-center gap-2 rounded-[22px] bg-[var(--erp-ink)] p-2 pl-4 text-[var(--erp-shell)] shadow-[var(--erp-pop-shadow)] md:bottom-6 lg:hidden">
          <span className="min-w-0 flex-1 truncate text-[13px] font-semibold">Unsaved changes</span>
          <PillButton variant="ghost" size="sm" onClick={discard} disabled={saving} className="text-[var(--erp-shell)] hover:bg-transparent hover:text-[var(--erp-shell)]">
            Discard
          </PillButton>
          <PillButton variant="accent" size="sm" icon={Save} loading={saving} onClick={() => void save()}>
            Save
          </PillButton>
        </div>
      )}

      <ConfirmPosting
        open={posting}
        onClose={() => setPosting(false)}
        title={`Post ${d.number !== '' ? d.number : `this ${label}`}`}
        verb={`Post ${label}`}
        previewOp="docs.preview"
        runOp="docs.post"
        params={{ doc: d.id }}
        withDate
        defaultDate={d.date}
        onDone={(r) => {
          live.set(r as DocDetail);
          toast.success(`${SHORT_TYPE[d.type]} posted`);
        }}
      />
      <ConfirmPosting
        open={voiding}
        onClose={() => setVoiding(false)}
        title={`Void ${d.number}`}
        verb={`Void ${label}`}
        danger
        previewOp="docs.preview-void"
        runOp="docs.void"
        params={{ doc: d.id }}
        extraParams={{ reason: reason.trim() === '' ? undefined : reason.trim() }}
        intro={<p className="text-[14px] leading-6 text-[var(--erp-ink-2)]">Voiding reverses everything it posted{d.type === 'invoice' || d.type === 'delivery' || d.type === 'goods_receipt' || d.type === 'bill' ? ', stock included' : ''}. The document stays, marked void.</p>}
        extra={
          <Field label="Why" optional>
            <textarea value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} aria-label="Why it is voided" placeholder="For the history" className={cn(softArea, 'min-h-[64px]')} />
          </Field>
        }
        onDone={(r) => {
          live.set(r as DocDetail);
          toast.success('Voided');
        }}
      />
      <RecordPayment doc={d} open={paying} onClose={() => setPaying(false)} />
      <TextModal doc={d} open={asText} onClose={() => setAsText(false)} />
      {confirmEl}
    </div>
  );
}
