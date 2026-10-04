/**
 * Renewals: the list grouped by decision (pending first) with bulk
 * decisions (renew, renew some classes, lapse with a reason, defer),
 * instructions to the provider (letter and CSV, plus an email draft by
 * CraftBot), recording payment, and the multi-year cost forecast.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CalendarCheck2, Download, FileCheck2, Mail, Receipt, Send, SearchX } from 'lucide-react';
import { Button, Dialog, Input, Select, Textarea, getPbClient, toast } from '../../kit/index.ts';
import { useCollection, useLiveAsync } from '../lib/live.ts';
import { op, q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { downloadText } from '../lib/csv.ts';
import { d10, daysUntil, fmtDate, fmtMoney, relLabel, today } from '../lib/format.ts';
import { enumLabel, enumOptions, getLang, t, tn } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import { href, useHashParam } from '../lib/router.ts';
import type { GoodsServiceRec, MatterRec, RenewalRec } from '../lib/records.ts';
import { YearForecast } from './charts.tsx';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { Checkbox, EmptyHint, EnumPill, ErrorBox, Field, GroupHeader, JurChip, Loading, Notice, Ref, Section, Segmented, TONE_TEXT } from './ui.tsx';
import { ClassPicker, CopyButton, DateField, dueTone, opts } from './protectShared.tsx';

export type RenewalX = RenewalRec;

export function matterOf(r: RenewalRec): MatterRec | undefined {
  return r.expand?.['matter'] as MatterRec | undefined;
}

type Decision = 'pending' | 'renew' | 'renew_partial' | 'lapse' | 'defer';
const DECISION_ORDER: Decision[] = ['pending', 'defer', 'renew', 'renew_partial', 'lapse'];

function feeTotal(r: RenewalRec): number {
  return (r.official_fee || 0) + (r.other_fee || 0);
}

function inGrace(r: RenewalRec): boolean {
  const due = d10(r.due_date);
  const grace = d10(r.grace_end);
  return due !== '' && grace !== '' && daysUntil(due) < 0 && daysUntil(grace) >= 0;
}

function openStatus(r: RenewalRec): boolean {
  return r.instruction_status === 'not_instructed' || r.instruction_status === 'instructed' || r.instruction_status === '';
}

/* ------------------------------------------------------------------ */
/* List                                                                */
/* ------------------------------------------------------------------ */

type Dlg = { kind: 'decide'; items: RenewalX[]; decision: Decision } | { kind: 'instruct'; items: RenewalX[] } | { kind: 'pay'; item: RenewalX } | null;

export function RenewalList({ matterId, showFilters = false }: { matterId?: string | undefined; showFilters?: boolean | undefined }): React.JSX.Element {
  const { can, homeCurrency } = useApp();
  const list = useCollection<RenewalX>('renewals', {
    filter: matterId !== undefined ? `matter = ${q(matterId)}` : '',
    sort: 'due_date',
    expand: 'matter',
  });
  const [office, setOffice] = useHashParam('office', '');
  const [windowF, setWindowF] = useHashParam('due', '');
  const [decision, setDecision] = useHashParam('decision', '');
  const [instr, setInstr] = useHashParam('instruction', showFilters ? 'open' : '');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [dlg, setDlg] = useState<Dlg>(null);

  const officeOptions = useMemo(() => {
    const codes = new Set<string>();
    for (const r of list.records) {
      const m = matterOf(r);
      if (m !== undefined) codes.add(m.jurisdiction.toUpperCase());
    }
    return [...codes].sort().map((c) => ({ value: c, label: `${c} · ${jurisdictionName(c)}` }));
  }, [list.records]);

  const shown = useMemo(() => {
    if (!showFilters) return list.records;
    return list.records.filter((r) => {
      const m = matterOf(r);
      if (office !== '' && (m?.jurisdiction.toUpperCase() ?? '') !== office) return false;
      if (decision !== '' && r.decision !== decision) return false;
      if (instr === 'open' ? !openStatus(r) : instr !== '' && r.instruction_status !== instr) return false;
      if (windowF !== '') {
        const due = d10(r.due_date);
        if (due === '') return false;
        const n = daysUntil(due);
        if (windowF === 'overdue' && !(n < 0)) return false;
        if (windowF === 'grace' && !inGrace(r)) return false;
        if (windowF === 'd30' && !(n >= 0 && n <= 30)) return false;
        if (windowF === 'd90' && !(n >= 0 && n <= 90)) return false;
        if (windowF === 'd365' && !(n >= 0 && n <= 365)) return false;
      }
      return true;
    });
  }, [list.records, showFilters, office, decision, instr, windowF]);

  const groups = useMemo(
    () =>
      DECISION_ORDER.map((d) => ({ decision: d, items: shown.filter((r) => (r.decision || 'pending') === d) })).filter((g) => g.items.length > 0),
    [shown],
  );

  const selRows = list.records.filter((r) => sel.has(r.id));
  const toggle = (ids: string[], v: boolean): void =>
    setSel((s) => {
      const n = new Set(s);
      for (const id of ids) {
        if (v) n.add(id);
        else n.delete(id);
      }
      return n;
    });
  const nReady = selRows.filter((r) => r.decision === 'renew' || r.decision === 'renew_partial').length;
  const est = selRows.reduce((a, r) => a + (r.fee_known ? r.home_amount : 0), 0);
  const noFee = selRows.filter((r) => !r.fee_known).length;
  const filtersOn = office !== '' || windowF !== '' || decision !== '' || instr !== (showFilters ? 'open' : '');

  if (list.loading && list.records.length === 0) return <Loading />;
  if (list.error !== null) return <ErrorBox message={list.error} onRetry={list.refresh} />;

  return (
    <div className="flex flex-col gap-3">
      {showFilters && list.records.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select aria-label={t('Office')} value={office} placeholder={t('All offices')} options={officeOptions} onChange={(e) => setOffice(e.target.value)} />
          <Select
            aria-label={t('Due')}
            value={windowF}
            placeholder={t('Any due date')}
            options={[
              { value: 'overdue', label: t('Past due') },
              { value: 'grace', label: t('In grace period') },
              { value: 'd30', label: t('Due in 30 days') },
              { value: 'd90', label: t('Due in 90 days') },
              { value: 'd365', label: t('Due within a year') },
            ]}
            onChange={(e) => setWindowF(e.target.value)}
          />
          <Select aria-label={t('Decision|renewal')} value={decision} placeholder={t('Any decision')} options={opts(enumOptions('renewals.decision'))} onChange={(e) => setDecision(e.target.value)} />
          <Select
            aria-label={t('Instruction')}
            value={instr}
            placeholder={t('Any instruction status')}
            options={[{ value: 'open', label: t('Not yet paid') }, ...opts(enumOptions('renewals.instruction_status'))]}
            onChange={(e) => setInstr(e.target.value)}
          />
        </div>
      )}

      <Section
        title={matterId !== undefined ? t('Renewals') : t('Renewals by decision')}
        meta={shown.length !== list.records.length ? t('{shown} of {all}', { shown: shown.length, all: list.records.length }) : String(list.records.length)}
        flush
        actions={
          filtersOn ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs"
              onClick={() => {
                setOffice('');
                setWindowF('');
                setDecision('');
                setInstr(showFilters ? 'open' : '');
              }}
            >
              {t('Clear filters')}
            </Button>
          ) : undefined
        }
      >
        {list.records.length === 0 ? (
          <EmptyHint
            compact
            icon={CalendarCheck2}
            title={t('No renewals yet')}
            message={t('Renewals appear as renewal deadlines come up: record the registration and the rules create them.')}
          />
        ) : shown.length === 0 ? (
          <EmptyHint compact icon={SearchX} title={t('Nothing matches these filters')} />
        ) : (
          groups.map((g) => {
            const ids = g.items.map((r) => r.id);
            const all = ids.every((id) => sel.has(id));
            const some = ids.some((id) => sel.has(id));
            return (
              <div key={g.decision}>
                <GroupHeader
                  label={enumLabel('renewals.decision', g.decision)}
                  count={g.items.length}
                  tone={g.decision === 'pending' ? 'warn' : undefined}
                  right={can.rights ? <Checkbox checked={all} indeterminate={!all && some} onChange={(v) => toggle(ids, v)} ariaLabel={t('Select all in {group}', { group: enumLabel('renewals.decision', g.decision) })} /> : undefined}
                />
                {g.items.map((r) => (
                  <RenewalRow
                    key={r.id}
                    r={r}
                    showMatter={matterId === undefined}
                    canAct={can.rights}
                    selected={sel.has(r.id)}
                    onSelect={(v) => toggle([r.id], v)}
                    onPay={() => setDlg({ kind: 'pay', item: r })}
                  />
                ))}
              </div>
            );
          })
        )}
      </Section>

      {can.rights && selRows.length > 0 && (
        <div className="sticky bottom-3 z-20 flex flex-col gap-2 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] px-4 py-2.5 shadow-lg lg:flex-row lg:items-center">
          <span className="min-w-0 flex-1 text-[13px] font-medium tabular-nums">
            {t('{n} selected', { n: selRows.length })}
            <span className="font-normal text-[var(--agent-app-muted)]">
              {' · '}
              {t('est. {amount}', { amount: fmtMoney(est, homeCurrency) })}
              {noFee > 0 ? ` · ${tn(noFee, '{n} without a fee on file', '{n} without a fee on file')}` : ''}
            </span>
          </span>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'decide', items: selRows, decision: 'renew' })}>
              {t('Decide|renewal')}
            </Button>
            <Button size="sm" disabled={nReady === 0} onClick={() => setDlg({ kind: 'instruct', items: selRows })} title={nReady === 0 ? t('Decide Renew on the selected renewals first') : undefined}>
              <Send size={13} aria-hidden /> {nReady > 0 ? t('Instruct {n}', { n: nReady }) : t('Instruct')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>
              {t('Clear')}
            </Button>
          </div>
        </div>
      )}

      {dlg?.kind === 'decide' && <DecideDialog items={dlg.items} initial={dlg.decision} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg?.kind === 'instruct' && <InstructDialog items={dlg.items} onClose={() => setDlg(null)} onDone={() => setSel(new Set())} />}
      {dlg?.kind === 'pay' && <PaymentDialog item={dlg.item} onClose={() => setDlg(null)} />}
    </div>
  );
}

function RenewalRow({
  r,
  showMatter,
  canAct,
  selected,
  onSelect,
  onPay,
}: {
  r: RenewalX;
  showMatter: boolean;
  canAct: boolean;
  selected: boolean;
  onSelect: (v: boolean) => void;
  onPay: () => void;
}): React.JSX.Element {
  const m = matterOf(r);
  const due = d10(r.due_date);
  const grace = d10(r.grace_end);
  const tone = dueTone(due);
  const graceNow = inGrace(r);
  const total = feeTotal(r);
  const payable = canAct && openStatus(r) && r.decision !== 'lapse';
  return (
    <div className={`grid gap-2 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0 md:grid-cols-[minmax(0,1.5fr)_10rem_10rem_minmax(0,1fr)] md:items-center md:gap-4 ${selected ? 'bg-[var(--agent-app-accent)]/5' : ''}`}>
      <div className="flex min-w-0 items-start gap-3">
        {canAct && (
          <div className="pt-0.5">
            <Checkbox checked={selected} onChange={onSelect} ariaLabel={t('Select {name}', { name: m?.ref ?? r.cycle_label })} />
          </div>
        )}
        <div className="min-w-0">
          {showMatter && m !== undefined && (
            <div className="flex min-w-0 flex-wrap items-center gap-1.5">
              <JurChip code={m.jurisdiction} />
              <a href={href('matter', m.id)} className="hover:underline">
                <Ref>{m.ref}</Ref>
              </a>
              <span className="min-w-0 truncate text-[13px]" title={m.title}>
                {m.title}
              </span>
            </div>
          )}
          <div className="mt-0.5 text-[13px] font-medium">{r.cycle_label || t('Renewal')}</div>
          {r.decision === 'renew_partial' && (r.classes_keep ?? []).length > 0 && <div className="text-xs text-[var(--agent-app-muted)]">{t('Keeping classes {list}', { list: (r.classes_keep ?? []).join(', ') })}</div>}
          {r.decision === 'lapse' && r.rationale !== '' && <div className="break-words text-xs text-[var(--agent-app-muted)]">{r.rationale}</div>}
          {r.provider !== '' && <div className="truncate text-xs text-[var(--agent-app-muted)]">{t('Provider: {name}', { name: r.provider })}{r.po_number !== '' ? ` · ${t('PO {number}', { number: r.po_number })}` : ''}</div>}
        </div>
      </div>
      <div className="tabular-nums">
        <div className="text-[13px]">{fmtDate(due) || t('No due date')}</div>
        {due !== '' && openStatus(r) && <div className={`text-xs ${tone !== 'neutral' ? TONE_TEXT[tone] : 'text-[var(--agent-app-muted)]'}`}>{relLabel(due)}</div>}
        {grace !== '' && (
          <div className={`text-xs ${graceNow ? TONE_TEXT.warn : 'text-[var(--agent-app-muted)]'}`}>
            {graceNow ? t('In grace to {date}', { date: fmtDate(grace) }) : t('Grace to {date}', { date: fmtDate(grace) })}
          </div>
        )}
      </div>
      <div className="tabular-nums">
        {r.fee_known || total > 0 ? (
          <>
            <div className="text-[13px]">{fmtMoney(r.official_fee, r.currency)}</div>
            {r.other_fee > 0 && <div className="text-xs text-[var(--agent-app-muted)]">{t('+ {amount} other', { amount: fmtMoney(r.other_fee, r.currency) })}</div>}
            {r.home_amount > 0 && r.home_currency !== r.currency && <div className="text-xs text-[var(--agent-app-muted)]">{t('about {amount}', { amount: fmtMoney(r.home_amount, r.home_currency) })}</div>}
          </>
        ) : (
          <div className="text-xs text-[var(--agent-app-muted)]" title={r.fee_note || undefined}>
            {t('Fee not on file')}
          </div>
        )}
        {r.paid_date !== '' && d10(r.paid_date) !== '' && <div className={`text-xs ${TONE_TEXT.good}`}>{t('Paid {date}|renewal', { date: fmtDate(r.paid_date) })}{r.paid_amount > 0 ? `, ${fmtMoney(r.paid_amount, r.currency)}` : ''}</div>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5 md:justify-end">
        <EnumPill field="renewals.decision" value={r.decision || 'pending'} />
        <EnumPill field="renewals.instruction_status" value={r.instruction_status} />
        {payable && (r.decision === 'renew' || r.decision === 'renew_partial' || r.instruction_status === 'instructed') && (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onPay}>
            <Receipt size={12} aria-hidden /> {t('Record payment|renewal')}
          </Button>
        )}
        <DeleteButton collection="renewals" id={r.id} iconOnly label={t('Delete this renewal')} />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Decide                                                              */
/* ------------------------------------------------------------------ */

export function DecideDialog({ items, initial, onClose, onDone }: { items: RenewalX[]; initial: Decision; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const [decision, setDecision] = useState<Decision>(initial === 'pending' ? 'renew' : initial);
  const [rationale, setRationale] = useState('');
  const [keep, setKeep] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const matterIds = useMemo(() => [...new Set(items.map((r) => r.matter))], [items]);
  const goods = useCollection<GoodsServiceRec>('goods_services', {
    filter: matterIds.length > 0 ? matterIds.map((id) => `matter = ${q(id)}`).join(' || ') : 'id = "__none__"',
    sort: 'nice_class',
  });
  const classes = useMemo(
    () => [...new Set(goods.records.filter((g) => g.class_status !== 'deleted' && g.class_status !== 'cancelled' && g.class_status !== 'refused').map((g) => g.nice_class))].sort((a, b) => a - b),
    [goods.records],
  );
  const seeded = useRef(false);
  useEffect(() => {
    if (!seeded.current && classes.length > 0) {
      seeded.current = true;
      setKeep(classes);
    }
  }, [classes]);

  const allTm = items.every((r) => matterOf(r)?.ip_type !== 'design');
  const locked = items.filter((r) => r.instruction_status === 'confirmed' || r.instruction_status === 'paid').length;
  const valid = decision !== 'lapse' ? (decision === 'renew_partial' ? keep.length > 0 : true) : rationale.trim() !== '';

  const submit = async (): Promise<void> => {
    if (!valid) return;
    setBusy(true);
    try {
      const body: Record<string, unknown> = { ids: items.map((r) => r.id), decision };
      if (rationale.trim() !== '') body['rationale'] = rationale.trim();
      if (decision === 'renew_partial') body['classes_keep'] = keep;
      const r = await op<{ updated: number; lapsing: string[] }>('renewals/decide', body);
      toast.success(tn(r.updated, '{n} renewal decided', '{n} renewals decided'));
      onDone?.();
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const options: { value: Decision; label: string; tone?: 'good' | 'bad' | 'neutral' }[] = [
    { value: 'renew', label: enumLabel('renewals.decision', 'renew'), tone: 'good' },
    ...(allTm ? [{ value: 'renew_partial' as const, label: enumLabel('renewals.decision', 'renew_partial'), tone: 'good' as const }] : []),
    { value: 'lapse', label: enumLabel('renewals.decision', 'lapse'), tone: 'bad' },
    { value: 'defer', label: enumLabel('renewals.decision', 'defer') },
  ];

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tn(items.length, 'Decide {n} renewal', 'Decide {n} renewals')}
      description={t('The decision is logged with your name. Letting a right lapse closes its renewal deadline.')}
      className="w-[min(94vw,38rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={!valid} variant={decision === 'lapse' ? 'danger' : 'primary'}>
            {t('Save decision')}
          </Button>
        </>
      }
    >
      <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
        <div className="max-w-full overflow-x-auto">
          <Segmented<Decision> value={decision} onChange={setDecision} options={options} ariaLabel={t('Decision|renewal')} />
        </div>
        {locked > 0 && <Notice tone="warn">{tn(locked, '{n} selected renewal is already paid and stays as it is.', '{n} selected renewals are already paid and stay as they are.')}</Notice>}
        {decision === 'renew_partial' && (
          <Field label={t('Classes to keep')} help={t('Classes left out are not renewed and drop from the registration.')}>
            {classes.length > 0 ? <ClassPicker value={keep} onChange={setKeep} options={classes} /> : <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No classes are recorded on these marks.')}</p>}
          </Field>
        )}
        <Textarea
          label={decision === 'lapse' ? t('Why let it lapse? (required)') : t('Reason (optional)')}
          rows={3}
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder={decision === 'lapse' ? t('For example: the title ended and the goods are no longer sold') : ''}
        />
        <div className="border border-[var(--agent-app-border)] text-[13px]">
          {items.map((r) => {
            const m = matterOf(r);
            return (
              <div key={r.id} className="flex items-center justify-between gap-3 border-b border-[var(--agent-app-border)]/60 px-3 py-1.5 last:border-0">
                <span className="min-w-0 truncate">
                  <span className="font-mono">{m?.ref ?? ''}</span> {r.cycle_label}
                </span>
                <span className="shrink-0 tabular-nums text-[var(--agent-app-muted)]">{fmtDate(r.due_date)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Instruct                                                            */
/* ------------------------------------------------------------------ */

interface InstructResult {
  instructed: number;
  csv: string;
  letter: string;
}

export function InstructDialog({ items, onClose, onDone }: { items: RenewalX[]; onClose: () => void; onDone?: (() => void) | undefined }): React.JSX.Element {
  const { homeCurrency } = useApp();
  const ready = items.filter((r) => r.decision === 'renew' || r.decision === 'renew_partial');
  const [provider, setProvider] = useState('');
  const [po, setPo] = useState('');
  const [lang, setLang] = useState<string>(getLang());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<InstructResult | null>(null);
  const [to, setTo] = useState('');
  const [requestId, setRequestId] = useState<string | null>(null);
  const [firing, setFiring] = useState(false);
  const touched = useRef(false);

  // Suggest the provider used last time.
  useEffect(() => {
    let cancelled = false;
    getPbClient()
      .call((p) => p.collection('renewals').getList<RenewalRec>(1, 1, { filter: 'provider != ""', sort: '-instructed_at' }), { silent: true })
      .then((res) => {
        const last = res.items[0]?.provider ?? '';
        if (!cancelled && !touched.current && last !== '') setProvider(last);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const total = ready.reduce((a, r) => a + (r.fee_known ? r.home_amount : 0), 0);
  const unknown = ready.filter((r) => !r.fee_known).length;

  const submit = async (): Promise<void> => {
    if (provider.trim() === '' || ready.length === 0) return;
    setBusy(true);
    try {
      const r = await op<InstructResult>('renewals/instruct', { ids: ready.map((x) => x.id), provider: provider.trim(), po_number: po.trim(), lang });
      setResult(r);
      toast.success(tn(r.instructed, '{n} renewal instructed', '{n} renewals instructed'));
      onDone?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const draftEmail = async (): Promise<void> => {
    const first = ready[0];
    if (first === undefined) return;
    setFiring(true);
    const refs = ready.map((r) => `${matterOf(r)?.ref ?? ''} ${r.cycle_label}`.trim()).join('; ');
    const params: Record<string, unknown> = {
      subject_type: 'renewal',
      subject_id: first.id,
      purpose: `Instruct the renewal provider ${provider.trim()} to renew and pay the official fees for: ${refs}.${po.trim() !== '' ? ` Purchase order ${po.trim()}.` : ''} Ask them to confirm receipt and send the official receipts once paid.`,
      lang,
    };
    if (to.trim() !== '') params['to'] = to.trim();
    const id = await handToCraftBot('email_draft_requested', params);
    setFiring(false);
    if (id !== null) setRequestId(id);
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={result === null ? tn(ready.length, 'Instruct {n} renewal', 'Instruct {n} renewals') : t('Instructions ready')}
      description={result === null ? t('Marks the renewals as instructed and prepares a letter and a spreadsheet for your provider.') : t('Send the letter and the spreadsheet to your provider. Record each payment when they confirm it.')}
      className="w-[min(94vw,42rem)]"
      footer={
        result === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              {t('Cancel')}
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={ready.length === 0 || provider.trim() === ''}>
              <Send size={14} aria-hidden /> {t('Instruct {n}', { n: ready.length })}
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>{t('Done')}</Button>
        )
      }
    >
      {result === null ? (
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          {ready.length < items.length && <Notice tone="warn">{tn(items.length - ready.length, '{n} selected renewal is not decided as Renew and is left out.', '{n} selected renewals are not decided as Renew and are left out.')}</Notice>}
          {ready.length === 0 ? (
            <Notice>{t('Decide Renew on the renewals first, then instruct them.')}</Notice>
          ) : (
            <div className="border border-[var(--agent-app-border)]">
              {ready.map((r) => (
                <div key={r.id} className="flex items-start justify-between gap-3 border-b border-[var(--agent-app-border)]/70 px-3 py-2 last:border-0">
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5 text-[13px]">
                      <JurChip code={matterOf(r)?.jurisdiction ?? ''} />
                      <span className="font-mono">{matterOf(r)?.ref ?? ''}</span>
                    </div>
                    <div className="mt-0.5 truncate text-xs text-[var(--agent-app-muted)]">
                      {r.cycle_label}, {t('Due {date}', { date: fmtDate(r.due_date) })}
                      {r.decision === 'renew_partial' && (r.classes_keep ?? []).length > 0 ? `, ${t('Keeping classes {list}', { list: (r.classes_keep ?? []).join(', ') })}` : ''}
                    </div>
                  </div>
                  <span className="shrink-0 text-[13px] tabular-nums">{r.fee_known ? fmtMoney(r.home_amount, r.home_currency || homeCurrency) : t('Fee not on file')}</span>
                </div>
              ))}
              <div className="flex flex-wrap justify-between gap-3 bg-[var(--agent-app-border)]/20 px-3 py-2 text-[13px]">
                <span className="font-medium">{t('Estimated total')}</span>
                <span className="tabular-nums">
                  {fmtMoney(total, homeCurrency)}
                  {unknown > 0 && <span className="text-[var(--agent-app-muted)]">, {tn(unknown, '{n} without a fee on file', '{n} without a fee on file')}</span>}
                </span>
              </div>
            </div>
          )}
          <div className="grid gap-3 sm:grid-cols-3">
            <Input
              label={t('Provider')}
              value={provider}
              placeholder={t('Renewal service or local agent')}
              onChange={(e) => {
                touched.current = true;
                setProvider(e.target.value);
              }}
            />
            <Input label={t('PO number (optional)')} value={po} onChange={(e) => setPo(e.target.value)} />
            <Select
              label={t('Letter language')}
              value={lang}
              options={[
                { value: 'ja', label: t('Japanese') },
                { value: 'en', label: t('English') },
              ]}
              onChange={(e) => setLang(e.target.value)}
            />
          </div>
        </div>
      ) : (
        <div className="flex max-h-[65vh] flex-col gap-4 overflow-y-auto pr-1">
          <Notice tone="good" icon={FileCheck2}>
            {tn(result.instructed, '{n} renewal marked as instructed with {provider}.', '{n} renewals marked as instructed with {provider}.', { provider: provider.trim() })}
          </Notice>
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-medium">{t('Letter')}</span>
              <CopyButton text={result.letter} />
            </div>
            <Textarea readOnly rows={9} value={result.letter} aria-label={t('Letter')} className="font-mono text-[12px]" />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2 border border-[var(--agent-app-border)] px-3 py-2">
            <span className="text-[13px]">
              <span className="font-medium">{t('Spreadsheet (CSV)')}</span>
              <span className="text-[var(--agent-app-muted)]"> {t('for the provider\'s system')}</span>
            </span>
            <span className="flex gap-1.5">
              <Button size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={() => downloadText(`renewal-instructions-${today()}.csv`, result.csv)}>
                <Download size={12} aria-hidden /> {t('Download')}
              </Button>
              <CopyButton text={result.csv} />
            </span>
          </div>
          <div className="flex flex-col gap-2 border-t border-[var(--agent-app-border)] pt-4">
            <span className="text-[13px] font-medium">{t('Draft the instruction email with CraftBot')}</span>
            <p className="text-xs text-[var(--agent-app-muted)]">{t('CraftBot drafts it, you send it. The draft goes to your connected mailbox; nothing is sent.')}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
              <Input type="email" label={t('Provider email (optional)')} value={to} onChange={(e) => setTo(e.target.value)} />
              <Button className="shrink-0" onClick={() => void draftEmail()} loading={firing} disabled={requestId !== null}>
                <Mail size={14} aria-hidden /> {t('Draft the email')}
              </Button>
            </div>
            <AgentStatus requestId={requestId} workingText={t('CraftBot is writing the email...')} doneText={t('CraftBot finished the draft.')} />
          </div>
        </div>
      )}
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Payment                                                             */
/* ------------------------------------------------------------------ */

export function PaymentDialog({ item, onClose }: { item: RenewalX; onClose: () => void }): React.JSX.Element {
  const total = feeTotal(item);
  const [paid, setPaid] = useState(today());
  const [amount, setAmount] = useState(total > 0 ? String(total) : '');
  const [busy, setBusy] = useState(false);
  const m = matterOf(item);

  const submit = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await op<{ ok: boolean; next: { id: string; title: string; due_date: string } | null }>('renewals/record-payment', { id: item.id, paid_date: d10(paid), amount: amount.trim() === '' ? '' : Number(amount) });
      toast.success(r.next !== null ? t('Payment recorded. Next: {title}, due {date}', { title: r.next.title, date: fmtDate(r.next.due_date) }) : t('Payment recorded'));
      onClose();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={t('Record payment|renewal')}
      description={t('Closes the renewal deadline, records the renewal on the mark and creates the next cycle.')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={d10(paid) === ''}>
            <Receipt size={14} aria-hidden /> {t('Record payment|renewal')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div className="border border-[var(--agent-app-border)] px-3 py-2 text-[13px]">
          <div className="font-mono">{m?.ref ?? ''}</div>
          <div className="text-[var(--agent-app-muted)]">
            {item.cycle_label}, {t('Due {date}', { date: fmtDate(item.due_date) })}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <DateField label={t('Paid on')} value={paid} onChange={setPaid} max={today()} />
          <Input label={t('Amount paid ({currency})', { currency: item.currency || item.home_currency || '' })} type="number" min={0} value={amount} onChange={(e) => setAmount(e.target.value)} />
        </div>
      </div>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Forecast                                                            */
/* ------------------------------------------------------------------ */

interface Forecast {
  currency: string;
  horizon: string;
  years: { year: string; total: number; count: number; unknown: number; by_jurisdiction: Record<string, number> }[];
  items: { date: string; ref: string; jurisdiction: string; amount: number; currency: string; home_amount: number | null; projected: boolean }[];
}

export function ForecastPanel(): React.JSX.Element {
  const res = useLiveAsync(() => op<Forecast>('renewals/forecast', { years: 5 }), [], ['renewals', 'deadlines', 'matters', 'fee_schedule', 'fx_rates']);
  const data = res.data;
  const offices = useMemo(() => {
    const extra = new Set<string>();
    for (const y of data?.years ?? []) for (const j of Object.keys(y.by_jurisdiction)) if (!(OFFICES as readonly string[]).includes(j)) extra.add(j);
    const used = new Set<string>();
    for (const y of data?.years ?? []) for (const j of Object.keys(y.by_jurisdiction)) used.add(j);
    return [...OFFICES.filter((o) => used.has(o)), ...[...extra].sort()];
  }, [data]);

  if (res.loading && data === null) return <Loading />;
  if (res.error !== null) return <ErrorBox message={res.error} onRetry={res.reload} />;
  if (data === null || data.years.length === 0) {
    return (
      <Section title={t('Forecast')}>
        <EmptyHint compact icon={CalendarCheck2} title={t('Nothing to forecast yet')} message={t('Once marks are registered, their renewals for the next five years show here by year and office.')} />
      </Section>
    );
  }
  const totalAll = data.years.reduce((a, y) => a + y.total, 0);
  const unknownAll = data.years.reduce((a, y) => a + y.unknown, 0);
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('Renewal costs, next five years')} meta={fmtMoney(totalAll, data.currency)}>
        <YearForecast years={data.years} currency={data.currency} />
        {unknownAll > 0 && <p className="mt-2 text-xs text-[var(--agent-app-muted)]">{tn(unknownAll, '{n} renewal has no fee on file and is not in the totals.', '{n} renewals have no fee on file and are not in the totals.')}</p>}
      </Section>
      <Section title={t('Yearly totals by office')} meta={data.currency} flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20 text-[11px] uppercase tracking-wider text-[var(--agent-app-muted)]">
                <th className="px-3 py-2 text-left">{t('Year')}</th>
                {offices.map((o) => (
                  <th key={o} className="px-3 py-2 text-right" title={jurisdictionName(o)}>
                    {o}
                  </th>
                ))}
                <th className="px-3 py-2 text-right">{t('Total')}</th>
                <th className="px-3 py-2 text-right">{t('Renewals')}</th>
              </tr>
            </thead>
            <tbody>
              {data.years.map((y) => (
                <tr key={y.year} className="border-b border-[var(--agent-app-border)]/60 last:border-0">
                  <td className="px-3 py-2 font-mono">{y.year}</td>
                  {offices.map((o) => (
                    <td key={o} className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                      {y.by_jurisdiction[o] !== undefined ? fmtMoney(y.by_jurisdiction[o], data.currency) : <span className="text-[var(--agent-app-muted)]">-</span>}
                    </td>
                  ))}
                  <td className="whitespace-nowrap px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(y.total, data.currency)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {y.count}
                    {y.unknown > 0 && <span className="text-xs text-[var(--agent-app-muted)]"> ({t('{n} without fee', { n: y.unknown })})</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
    </div>
  );
}
