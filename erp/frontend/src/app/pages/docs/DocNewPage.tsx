/**
 * A new document in three numbered steps on one page: 1 who (search, recent
 * tiles, quick create), 2 what (the line editor with live totals), 3 when
 * and save (dates, terms, notes; Save draft or the type's main action).
 * Later steps open as the earlier ones are filled. Nothing is saved until
 * the person presses a save button.
 */
import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, Check, FileText, Save, Send } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { ConfirmPosting } from '../../components/Books.tsx';
import { PartyPicker } from '../../components/pickers.tsx';
import { HeadFields, MoreOptions, blankHead, headParams, termsOf } from '../../components/sales/form.tsx';
import type { DocHead } from '../../components/sales/form.tsx';
import { LineEditor, TotalsBlock, TotalsCard, filled, lineOk, lineParams, newLine, totalsOf } from '../../components/sales/editor.tsx';
import type { EditLine } from '../../components/sales/editor.tsx';
import { canDoc, lowerType, postsOf, roleOf, useCompanySettings, useRefData } from '../../components/sales/parts.tsx';
import { DOC_TYPE_PLURAL, docSide } from '../../components/status.ts';
import { Avatar, Card, Empty, Notice, PageHeader, PillButton, Skeleton, ToggleRow, errMessage } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { dayPhrase, today } from '../../lib/dates.ts';
import { money, plural } from '../../lib/format.ts';
import { useLive } from '../../lib/live.ts';
import { useMe } from '../../lib/me.ts';
import { DOC_PAGES, PAGE_OF_TYPE, back, navigate, useSection } from '../../lib/router.ts';
import type { DocType } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { Aging, DocDetail, PartyDetail, PartyList, PartyRow } from '../../lib/types/sales.ts';

const TYPES = Object.values(DOC_PAGES) as DocType[];

function typeOf(q: URLSearchParams): DocType {
  const t = q.get('type') as DocType | null;
  return t !== null && TYPES.includes(t) ? t : 'invoice';
}

function overdueOf(a: Aging): number {
  return a.d30 + a.d60 + a.d90 + a.over90;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/* ------------------------------------------------------------------ steps */

function Step({ n, title, done, locked, summary, action, children, delay }: { n: number; title: string; done: boolean; locked: boolean; summary?: ReactNode | undefined; action?: ReactNode | undefined; children?: ReactNode | undefined; delay: number }): React.JSX.Element {
  return (
    <Card delay={delay} className={cn('relative', n === 1 ? 'z-30' : n === 2 ? 'z-20' : 'z-10', locked && 'bg-[var(--erp-card)]/60')}>
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full text-[14px] font-bold transition-colors',
            done ? 'erp-on-ink bg-[var(--erp-ink)] text-[var(--erp-shell)]' : locked ? 'bg-[var(--erp-row)] text-[var(--erp-muted)]' : 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]',
          )}
        >
          {done ? <Check size={16} strokeWidth={2.6} /> : n}
        </span>
        <div className="min-w-0 flex-1">
          <h2 className={cn('text-[15px] font-bold leading-[22px]', locked && 'text-[var(--erp-muted)]')}>
            <span className="sr-only">Step {n}: </span>
            {title}
          </h2>
          {summary !== undefined && <div className="truncate text-[13px] text-[var(--erp-muted)]">{summary}</div>}
        </div>
        {action}
      </div>
      {!locked && children !== undefined && <div className="mt-5">{children}</div>}
    </Card>
  );
}

/* ------------------------------------------------------------------- who */

function PartyTiles({ role, onPick }: { role: 'customer' | 'supplier'; onPick: (id: string) => void }): React.JSX.Element {
  const recent = useLive(() => op<PartyList>('parties.list', { role, sort: 'recent', limit: 6 }, { quiet: true }), ['parties'], [role]);
  if (recent.data === null) {
    // A shortcut only: when it cannot load, the picker above still finds everyone.
    if (recent.error !== null) return <></>;
    return (
      <div className="grid grid-cols-2 gap-2 @min-[480px]:grid-cols-3">
        {Array.from({ length: 6 }, (_, i) => (
          <Skeleton key={i} className="h-[68px]" />
        ))}
      </div>
    );
  }
  const rows: PartyRow[] = recent.data.parties;
  if (rows.length === 0) return <></>;
  const cur = recent.data.currency;
  return (
    <div>
      <p className="mb-2 px-1 text-[12px] font-semibold text-[var(--erp-muted)]">Recent</p>
      <div className="grid grid-cols-2 gap-2 @min-[480px]:grid-cols-3">
        {rows.map((p) => {
          const owed = role === 'customer' ? p.receivable : p.payable;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => onPick(p.id)}
              className="flex min-w-0 items-center gap-3 rounded-[18px] bg-[var(--erp-row)] p-3 text-left transition-[background,transform] hover:bg-[var(--erp-row-hover)] active:scale-[0.98]"
            >
              <Avatar name={p.name} size={36} tone="card" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{p.name}</span>
                <span className={cn('block truncate text-[12px]', (role === 'customer' ? p.overdue_receivable : p.overdue_payable) > 0 ? 'font-semibold text-[var(--erp-red-text)]' : 'text-[var(--erp-muted)]')}>
                  {owed > 0 ? `${role === 'customer' ? 'Owes' : 'You owe'} ${money(owed, cur, 'short')}` : p.last_activity !== '' ? `Active ${dayPhrase(p.last_activity)}` : 'No documents yet'}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------- page */

export function DocNewPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const type = typeOf(query);
  const side = docSide(type);
  const role = roleOf(type);
  const label = lowerType(type);
  useSection('doc-new', PAGE_OF_TYPE[type]);
  const refs = useRefData();
  const settings = useCompanySettings();
  const base = me.company.currency;

  const [party, setParty] = useState<PartyDetail | null>(null);
  const [partyBusy, setPartyBusy] = useState(false);
  const [changing, setChanging] = useState(false);
  const [head, setHead] = useState<DocHead>(() => blankHead(today(), me.company.prices_include_tax));
  const [lines, setLines] = useState<EditLine[]>(() => [newLine('none')]);
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'main' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [posting, setPosting] = useState<DocDetail | null>(null);
  const [override, setOverride] = useState(false);

  // A fresh form when the type changes (the sidebar's "+" on another module).
  useEffect(() => {
    setParty(null);
    setLines([newLine('none')]);
    setHead(blankHead(today(), me.company.prices_include_tax));
    setError(null);
  }, [type, me.company.prices_include_tax]);

  const settingsInclusive = settings?.prices_include_tax;
  useEffect(() => {
    if (settingsInclusive !== undefined) setHead((h) => ({ ...h, prices_include_tax: settingsInclusive }));
  }, [settingsInclusive]);

  const partyTax = party === null ? 'none' : (side === 'sales' ? party.effective_sale_tax?.code : party.effective_purchase_tax?.code) ?? 'none';
  const taxOn = type !== 'delivery' && type !== 'goods_receipt';
  const defaultTax = taxOn ? partyTax : 'none';

  const choose = async (id: string): Promise<void> => {
    setPartyBusy(true);
    try {
      const p = await op<PartyDetail>('parties.get', { party: id }, { quiet: true });
      const nextTax = taxOn ? ((side === 'sales' ? p.effective_sale_tax?.code : p.effective_purchase_tax?.code) ?? 'none') : 'none';
      setLines((ls) => ls.map((l) => (!filled(l) || l.tax === defaultTax ? { ...l, tax: nextTax } : l)).map((l, i, all) => (i === all.length - 1 && !filled(l) ? { ...l, focus: true } : l)));
      setHead((h) => ({ ...h, terms: '', due_date: '', currency: '' }));
      setParty(p);
      setChanging(false);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setPartyBusy(false);
    }
  };

  const quickCreate = async (name: string): Promise<void> => {
    setPartyBusy(true);
    try {
      const p = await op<PartyDetail>('parties.add', { name, is_customer: role === 'customer', is_supplier: role === 'supplier' });
      toast.success(`Added ${p.name}`);
      await choose(p.id);
    } catch {
      setPartyBusy(false);
    }
  };

  // ?party= starts with that party chosen.
  const preset = query.get('party') ?? '';
  useEffect(() => {
    if (preset !== '') void choose(preset);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preset, type]);

  const currency = head.currency !== '' ? head.currency : party !== null && party.currency !== '' ? party.currency : base;
  const totals = useMemo(() => totalsOf(lines, type, refs?.taxes ?? [], head.prices_include_tax, currency), [lines, type, refs, head.prices_include_tax, currency]);
  const filledLines = lines.filter(filled);
  const linesOk = filledLines.length > 0 && filledLines.every(lineOk);
  const partyTerms = party?.effective_terms ?? null;
  const terms = termsOf(head, refs, partyTerms);

  if (!canDoc(me, type, 'edit')) {
    return (
      <>
        <PageHeader title={`New ${label}`} back={() => back(PAGE_OF_TYPE[type])} />
        <Card>
          <Empty icon={FileText} title={`Your role cannot create ${DOC_TYPE_PLURAL[type]?.toLowerCase() ?? label}`}>
            Ask an administrator for edit access to {side === 'sales' ? 'Sales' : 'Purchasing'}.
          </Empty>
        </Card>
      </>
    );
  }

  const canPost = postsOf(type) && canDoc(me, type, 'full');
  const mainLabel = postsOf(type) ? (canPost ? `Post ${label}` : '') : type === 'quote' ? 'Save as sent' : 'Confirm order';
  const mainIcon = type === 'quote' ? Send : Check;

  const create = async (): Promise<DocDetail> =>
    op<DocDetail>('docs.create', { type, party: party?.id, ...headParams(type, { ...head, due_date: head.due_date }, base, null), lines: lineParams(lines, type) }, { quiet: true });

  const save = async (main: boolean): Promise<void> => {
    if (party === null || !linesOk) return;
    setBusy(main ? 'main' : 'draft');
    setError(null);
    try {
      const d = await create();
      if (!main) {
        toast.success('Draft saved');
        navigate('doc', { id: d.id });
        return;
      }
      if (postsOf(type)) {
        setOverride(false);
        setPosting(d);
        return;
      }
      try {
        await op(type === 'quote' ? 'docs.mark-sent' : 'docs.confirm', { doc: d.id });
        toast.success(type === 'quote' ? 'Quote saved as sent' : 'Order confirmed');
      } catch {
        /* the draft is saved; its page says what is left */
      }
      navigate('doc', { id: d.id });
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const overLimit = posting !== null && party !== null && type === 'invoice' && party.credit_limit > 0 && party.receivable + posting.total_base > party.credit_limit;
  const ready = party !== null && linesOk;
  const step1Done = party !== null && !changing;

  const buttons = (
    <>
      {mainLabel !== '' && (
        <PillButton icon={mainIcon} dot loading={busy === 'main'} disabled={!ready || busy !== null} onClick={() => void save(true)} className="w-full">
          {mainLabel}
        </PillButton>
      )}
      <PillButton variant={mainLabel !== '' ? 'light' : 'dark'} dot={mainLabel === ''} icon={Save} loading={busy === 'draft'} disabled={!ready || busy !== null} onClick={() => void save(false)} className={cn('w-full', mainLabel !== '' && 'bg-[var(--erp-card)]')}>
        Save draft
      </PillButton>
      {!canPost && postsOf(type) && <p className="px-1 text-center text-[12px] text-[var(--erp-muted)]">Someone with full {side === 'sales' ? 'Sales' : 'Purchasing'} rights posts it</p>}
    </>
  );

  return (
    <div className="pb-24 md:pb-0">
      <PageHeader title={`New ${label}`} eyebrow={DOC_TYPE_PLURAL[type]} back={() => back(PAGE_OF_TYPE[type])} />
      <div className="grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12 @min-[900px]:items-start">
        <div className="flex min-w-0 flex-col gap-5 @min-[900px]:col-span-8">
          <Step
            n={1}
            delay={1}
            title={role === 'customer' ? 'Who is it for' : 'Who is it from'}
            done={step1Done}
            locked={false}
            summary={
              step1Done && party !== null
                ? [party.code, terms !== null ? terms.name : '', currency !== base ? currency : ''].filter((x) => x !== '').join(' · ')
                : undefined
            }
            action={
              step1Done ? (
                <PillButton variant="soft" size="sm" onClick={() => setChanging(true)}>
                  Change
                </PillButton>
              ) : undefined
            }
          >
            {step1Done && party !== null ? (
              <div className="flex flex-wrap items-center gap-3 rounded-[18px] bg-[var(--erp-row)] p-3">
                <Avatar name={party.name} size={44} tone="ink" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] font-bold">{party.name}</span>
                  <span className="block truncate text-[12px] text-[var(--erp-muted)]">{[party.email, party.phone].filter((x) => x !== '').join(' · ') || 'No contact details yet'}</span>
                </span>
                {(role === 'customer' ? party.receivable : party.payable) > 0 && (
                  <span className="text-right">
                    <span className="block text-[12px] text-[var(--erp-muted)]">{role === 'customer' ? 'Owes you' : 'You owe'}</span>
                    <span className={cn('num block text-[14px] font-bold', overdueOf(role === 'customer' ? party.aging_receivable : party.aging_payable) > 0 && 'text-[var(--erp-red-text)]')}>
                      {money(role === 'customer' ? party.receivable : party.payable, party.base_currency)}
                    </span>
                  </span>
                )}
                {type === 'invoice' && party.credit_limit > 0 && party.receivable + totals.total > party.credit_limit && (
                  <div className="w-full">
                    <Notice tone="warn" icon={AlertTriangle}>
                      This takes {party.name} over their credit limit of {money(party.credit_limit, party.base_currency)}.
                    </Notice>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                <PartyPicker
                  value={party !== null ? { id: party.id, label: party.name } : null}
                  onChange={(o) => {
                    if (o !== null) void choose(o.id);
                  }}
                  role={role}
                  onCreate={(name) => void quickCreate(name)}
                  disabled={partyBusy}
                />
                <PartyTiles role={role} onPick={(id) => void choose(id)} />
                {partyBusy && <Skeleton className="h-4 w-40" rounded="rounded-full" />}
                {changing && (
                  <div>
                    <PillButton variant="ghost" size="sm" onClick={() => setChanging(false)}>
                      Keep {party?.name}
                    </PillButton>
                  </div>
                )}
              </div>
            )}
          </Step>

          <Step
            n={2}
            delay={2}
            title={type === 'delivery' ? 'What goes out' : type === 'goods_receipt' ? 'What came in' : 'What'}
            done={step1Done && linesOk}
            locked={party === null}
            summary={party !== null && filledLines.length > 0 ? `${plural(filledLines.length, 'line')}${type !== 'delivery' ? ` · ${money(totals.total, currency)}` : ''}` : undefined}
          >
            <LineEditor
              type={type}
              side={side}
              currency={currency}
              inclusive={head.prices_include_tax}
              taxes={refs?.taxes ?? []}
              defaultTax={defaultTax}
              lines={lines}
              setLines={setLines}
              advanced={more}
              watchStock={(type === 'invoice' && head.moves_stock) || type === 'delivery'}
            />
            <div className="mt-5 border-t border-[var(--erp-line)] pt-4">
              <MoreOptions type={type} head={head} setHead={setHead} refs={refs} partyCurrency={party?.currency ?? ''} open={more} onToggle={() => setMore((m) => !m)} />
            </div>
          </Step>

          <Step n={3} delay={3} title="When and save" done={false} locked={!ready}>
            <HeadFields type={type} head={head} setHead={setHead} refs={refs} partyTerms={partyTerms} validityDays={settings?.quote_validity_days ?? 30} />
          </Step>
        </div>

        <div className="flex flex-col gap-5 @min-[900px]:col-span-4">
          {type === 'delivery' ? (
            <Card tone="sand" className="@min-[900px]:sticky @min-[900px]:top-6">
              <h2 className="text-[15px] font-bold">Delivery</h2>
              <p className="mt-1 text-[13px] text-[var(--erp-muted)]">{plural(filledLines.length, 'line')} going out</p>
              <div className="mt-5 hidden flex-col gap-2 md:flex">{buttons}</div>
              {error !== null && <p className="mt-3 text-[13px] font-semibold text-[var(--erp-red-text)]">{error}</p>}
            </Card>
          ) : (
            <TotalsCard sticky totals={totals} currency={currency} inclusive={head.prices_include_tax}>
              <div className="hidden flex-col gap-2 md:flex">{buttons}</div>
              {error !== null && (
                <Notice tone="bad" icon={AlertTriangle}>
                  {error}
                </Notice>
              )}
            </TotalsCard>
          )}
        </div>
      </div>

      {/* Phones: the total and the main action stay in reach. */}
      {party !== null && (
      <div className="erp-on-ink fixed inset-x-4 bottom-24 z-30 flex items-center gap-3 rounded-[22px] bg-[var(--erp-ink)] p-2 pl-4 text-[var(--erp-shell)] shadow-[var(--erp-pop-shadow)] md:hidden">
        <span className="min-w-0 flex-1">
          <span className="block text-[12px] font-medium">{type === 'delivery' ? plural(filledLines.length, 'line') : 'Total'}</span>
          {type !== 'delivery' && <span className="num block truncate text-[15px] font-extrabold">{money(totals.total, currency)}</span>}
        </span>
        <PillButton variant="ghost" size="sm" icon={Save} loading={busy === 'draft'} disabled={!ready || busy !== null} onClick={() => void save(false)} className="text-[var(--erp-shell)] hover:bg-transparent hover:text-[var(--erp-shell)]">
          Draft
        </PillButton>
        {mainLabel !== '' && (
          <PillButton variant="accent" size="sm" icon={mainIcon} loading={busy === 'main'} disabled={!ready || busy !== null} onClick={() => void save(true)}>
            {postsOf(type) ? 'Post' : type === 'quote' ? 'Sent' : 'Confirm'}
          </PillButton>
        )}
      </div>
      )}

      {posting !== null && (
        <ConfirmPosting
          open
          onClose={() => navigate('doc', { id: posting.id })}
          title={`Post ${label}`}
          verb={`Post ${label}`}
          previewOp="docs.preview"
          runOp="docs.post"
          params={{ doc: posting.id }}
          withDate
          defaultDate={posting.date}
          extraParams={overLimit && override ? { override_credit: true } : {}}
          canRun={!overLimit || override}
          onDone={() => toast.success(`${cap(label)} posted`)}
          intro={
            <div className="rounded-[18px] bg-[var(--erp-row)] p-4">
              <TotalsBlock totals={totals} currency={currency} inclusive={head.prices_include_tax} />
            </div>
          }
          extra={overLimit ? <ToggleRow title="Post over the credit limit" text={`${party?.name ?? ''} would owe more than ${money(party?.credit_limit ?? 0, base)}`} checked={override} onChange={setOverride} /> : undefined}
        />
      )}
    </div>
  );
}
