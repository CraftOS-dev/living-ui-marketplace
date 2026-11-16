/**
 * New call (or distribution): three screens and one PIN.
 *   Amount   one amount and its purpose as chips (Investment picks a holding, Fees are computed)
 *   Preview  every LP's line from the engine, totals that match exactly, your AI agent's review
 *   Issue    the figures and the wire account, then Issue with the PIN
 */
import { useState } from 'react';
import { ArrowRight, Check, Landmark, Sparkle } from 'lucide-react';
import { AgentMark, AgentTag, Button, ChipPicker, DataTable, DayPicker, Fact, Field, FigureStrip, Input, MoneyInput, More, Notice, Picker, Sheet, SheetHeader, Skeleton, StepTrack, Tip, Toggle } from '../ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, majorParam, money, today } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { CapitalEvent, FundView, Holding, PreviewLine } from './types.ts';
import { TYPE_LABEL } from './types.ts';
import { AskAgent, AskStatus, askWith } from '../agent.tsx';

type Purpose = 'investment' | 'fees' | 'expenses' | 'recall' | 'subline';

function initial(e: CapitalEvent | undefined): { purpose: Purpose; amount: number | null; holding: string; fees: boolean } {
  const ps = e?.purposes ?? [];
  const main = ps.find((p) => p.type === 'investment' || p.type === 'expenses');
  return { purpose: main !== undefined ? (main.type as Purpose) : ps.some((p) => p.type === 'fees') ? 'fees' : 'investment', amount: main?.amount_minor ?? (e?.kind === 'distribution' ? (ps[0]?.amount_minor ?? null) : null), holding: main?.holding ?? ps[0]?.holding ?? '', fees: main !== undefined && ps.some((p) => p.type === 'fees') };
}

/** The review note of your AI agent (or a person's), or that it is still coming. */
export function ReviewNote({ e }: { e: CapitalEvent }): React.JSX.Element | null {
  if (e.note !== '') {
    return (
      <div className="vo-panel flex min-w-0 items-start gap-2.5 px-4 py-3">
        {e.note_by === 'agent' ? <AgentTag /> : <Check size={14} className="mt-0.5 shrink-0 text-[var(--vo-good)]" aria-hidden />}
        <p className="vo-wrap min-w-0 whitespace-pre-line text-[13px] leading-5 text-[var(--vo-ink-2)]">{e.note}</p>
      </div>
    );
  }
  // Ask your AI agent to review a previewed notice before it is issued (one click, one request: trigger notice_review).
  if (e.status === 'previewed' || e.agent?.notice_review)
    return (
      <div className="flex items-center">
        {e.status === 'previewed' ? (
          <AskAgent label="Ask your AI agent to review" title="Checks the lines, the fees and the notice period, and what changed from the last notice." state={e.agent?.notice_review} onAsk={askWith('notice_review', e.id)} reads={['capital_events', 'agent_requests']} />
        ) : (
          <AskStatus state={e.agent?.notice_review} />
        )}
      </div>
    );
  return null;
}

/** Every LP's line with the totals row; the lines sum to the total exactly. */
export function LinesTable({ lines, totals, currency, kind }: { lines: PreviewLine[]; totals: Record<string, number>; currency: string; kind: 'call' | 'distribution' }): React.JSX.Element {
  const types = (kind === 'call' ? ['call_investment', 'call_fees', 'call_expenses', 'call_other', 'call_recall', 'call_subline'] : ['dist_capital', 'dist_gain']).filter((t) => (totals[t] ?? 0) !== 0);
  const m = (v: number): string => money(v, currency, { bare: true });
  const sum = lines.reduce((s, l) => s + l.total_minor, 0);
  const exact = sum === totals['total_minor'];
  return (
    <DataTable<PreviewLine>
      label="Lines"
      rows={lines}
      rowKey={(r) => r.lp}
      stickyTop={0}
      columns={[
        { key: 'lp', label: 'LP', width: 'minmax(150px,2fr)', fixed: true, phone: 'title', render: (r) => <span className="vo-wrap">{r.lp_name}</span> },
        ...types.map((t) => ({ key: t, label: TYPE_LABEL[t] ?? t, align: 'right' as const, mono: true, phone: 'hide' as const, render: (r: PreviewLine) => m(r.amounts[t] ?? 0) })),
        { key: 'total', label: 'Total', align: 'right', mono: true, phone: 'end', render: (r) => <span className="font-medium">{m(r.total_minor)}</span> },
      ]}
      foot={
        <div className="flex items-center gap-2 px-3 py-2 text-[13px]">
          <span className="font-medium">Total</span>
          {exact && (
            <Tip text="The lines add up to the total to the cent.">
              <Check size={14} className="text-[var(--vo-good)]" aria-label="Exact" />
            </Tip>
          )}
          <span className="vo-mono vo-num ml-auto font-medium">{money(totals['total_minor'] ?? 0, currency)}</span>
        </div>
      }
    />
  );
}

export function CallSheet({ fund, kind, event, onClose }: { fund: FundView; kind: 'call' | 'distribution'; event?: CapitalEvent | undefined; onClose: () => void }): React.JSX.Element {
  const init = initial(event);
  const [step, setStep] = useState(event?.status === 'previewed' ? 1 : 0);
  const [id, setId] = useState(event?.id ?? '');
  const [purpose, setPurpose] = useState<Purpose>(init.purpose);
  const [amount, setAmount] = useState<number | null>(init.amount);
  const [holding, setHolding] = useState(init.holding);
  const [fees, setFees] = useState(init.fees);
  const [notice, setNotice] = useState(event?.notice_day ?? today());
  const [due, setDue] = useState(event?.due_day ?? '');
  const [label, setLabel] = useState('');
  const [proceeds, setProceeds] = useState<number | null>(event?.purposes[0]?.proceeds_minor ?? null);
  const [recallable, setRecallable] = useState<number | null>(event?.purposes[0]?.recallable_minor ?? null);
  const [busy, setBusy] = useState(false);
  const cur = fund.currency;
  const call = kind === 'call';
  const hl = useOp<{ holdings: Holding[] }>('funds.holdings', { fund: fund.id }, ['ledger'], { name: 'funds.holdings' });
  const ev = useOp<{ event: CapitalEvent }>('calls.get', { event: id }, ['capital_events', 'capital_lines', 'agent_requests'], { name: 'calls.get', skip: id === '' });
  const bank = useOp<{ blocks: { status: string; last4: string; bank_name: string }[] }>('bank.list', { entity: fund.id }, ['bank_blocks'], { name: 'bank.list', skip: !call });
  const e = ev.data?.event;
  const wire = (bank.data?.blocks ?? []).find((b) => b.status === 'active');
  const items = (hl.data?.holdings ?? []).filter((h) => h.status !== 'exited' && h.status !== 'written_off').map((h) => ({ value: h.id, label: h.name, avatar: 'company' as const, sub: h.cost_minor > 0 ? money(h.cost_minor, cur, { compact: true }) : undefined }));
  const needAmount = !call || purpose !== 'fees';
  const ready = needAmount ? amount !== null && amount > 0 && (!call || purpose !== 'investment' || holding !== '') : true;

  const draft = async (): Promise<void> => {
    setBusy(true);
    const out = await act(
      [],
      async () => {
        const days = { notice_day: notice || undefined, due_day: due || undefined };
        const d = call
          ? await op<{ event: CapitalEvent }>('calls.draft', { event: id || undefined, fund: fund.id, purpose, amount: needAmount ? majorParam(amount, cur) : undefined, holding: purpose === 'investment' || purpose === 'recall' ? holding || undefined : undefined, fees: purpose !== 'fees' ? fees : undefined, label: label || undefined, ...days })
          : await op<{ event: CapitalEvent }>('distributions.draft', { event: id || undefined, fund: fund.id, amount: majorParam(amount, cur), holding, proceeds: majorParam(proceeds, cur) ?? '', recallable: majorParam(recallable, cur) ?? '', ...days });
        return op<{ event: CapitalEvent }>(call ? 'calls.preview' : 'distributions.preview', { event: d.event.id });
      },
      ['capital_events', 'agent_requests'],
    );
    setBusy(false);
    if (out !== null) {
      setId(out.event.id);
      setStep(1);
    }
  };

  const issue = async (): Promise<void> => {
    setBusy(true);
    const out = await act([], () => op<{ event: CapitalEvent }>(call ? 'calls.issue' : 'distributions.issue', { event: id }), ['capital_events', 'ledger', 'capital_lines', 'outbound']);
    setBusy(false);
    if (out !== null) {
      onClose();
      navigate(`/funds/${fund.id}/events/${id}`);
    }
  };

  const pv = e?.preview;
  const title = e !== undefined ? e.number : call ? 'New call' : 'New distribution';
  return (
    <Sheet open onClose={onClose} label={title} width={640}>
      <SheetHeader title={title} onClose={onClose} />
      <div className="border-b border-[var(--vo-hair)] px-5 py-3">
        <StepTrack labels={['Amount', 'Preview', 'Issue']} at={step} />
      </div>
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-5">
        {step === 0 && (
          <>
            {call && <ChipPicker label="Purpose" value={purpose} onChange={setPurpose} options={[{ value: 'investment', label: 'Investment' }, { value: 'fees', label: 'Fees' }, { value: 'expenses', label: 'Expenses' }, { value: 'recall', label: 'Recall' }, { value: 'subline', label: 'Line repayment' }]} />}
            {needAmount && (
              <Field label={call ? 'Amount' : 'Gross amount'}>
                <MoneyInput value={amount} onChange={setAmount} currency={cur} label="Amount" autoFocus />
              </Field>
            )}
            {(!call || purpose === 'investment' || purpose === 'recall') && (
              <Field label={call ? 'Holding' : 'Source'}>
                <Picker label="Holding" value={holding} onChange={setHolding} items={items} placeholder="Pick a company" clearable={!call || purpose === 'recall'} />
              </Field>
            )}
            {call && purpose !== 'fees' && (
              <div className="flex items-center justify-between gap-3">
                <span className="text-[13px]">Add fees</span>
                <Toggle checked={fees} onChange={setFees} label="Add fees" />
              </div>
            )}
            <More>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Notice day">
                  <DayPicker value={notice} onChange={setNotice} label="Notice day" />
                </Field>
                <Field label={call ? 'Due day' : 'Payment day'} tip="Ten business days after the notice when empty.">
                  <DayPicker value={due} onChange={setDue} label="Due day" clearable />
                </Field>
              </div>
              {call ? (
                <Field label="Note">
                  <Input value={label} onChange={(x) => setLabel(x.target.value)} aria-label="Note" placeholder="Series A extension" />
                </Field>
              ) : (
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Proceeds" tip="What the fund received from the holding; recorded on issue.">
                    <MoneyInput value={proceeds} onChange={setProceeds} currency={cur} label="Proceeds" />
                  </Field>
                  <Field label="Recallable">
                    <MoneyInput value={recallable} onChange={setRecallable} currency={cur} label="Recallable" />
                  </Field>
                </div>
              )}
            </More>
          </>
        )}
        {step >= 1 && e === undefined && <Skeleton className="h-60" />}
        {step === 1 && e !== undefined && pv !== undefined && (
          <>
            {!call && pv.waterfall && (
              <FigureStrip
                items={[
                  { label: 'Gross', value: money(pv.waterfall.gross_minor, cur, { compact: true }) },
                  { label: 'Carry', value: money(pv.waterfall.carry_minor, cur, { compact: true }), tip: 'An estimate from the waterfall until the administrator confirms it.' },
                  { label: 'To LPs', value: money(pv.waterfall.lp_minor, cur, { compact: true }) },
                ]}
              />
            )}
            {call && pv.fee && <Fact label="Fees">{`${pv.fee.from_day} to ${pv.fee.to_day}`}</Fact>}
            <div className="vo-panel min-w-0 overflow-hidden">
              <LinesTable lines={pv.lines} totals={pv.totals} currency={cur} kind={kind} />
            </div>
            {(pv.warnings ?? []).length > 0 && <Notice tone="warn">{(pv.warnings ?? []).map((w) => w.lp_name).join(', ') + ': beyond commitment'}</Notice>}
            <ReviewNote e={e} />
          </>
        )}
        {step === 2 && e !== undefined && (
          <>
            <FigureStrip
              items={[
                { label: 'Total', value: money(pv?.totals['total_minor'] ?? e.total_minor, cur) },
                { label: 'LPs', value: String(e.lps) },
                { label: call ? 'Due' : 'Paid on', value: fmtDay(e.due_day, { year: 'auto' }) },
              ]}
            />
            {call && wire !== undefined && (
              <Fact label="Wire">
                <span className="vo-mono">{wire.bank_name + ' ' + wire.last4}</span>
              </Fact>
            )}
            {call && bank.data !== null && wire === undefined && (
              <Notice tone="warn" action={<Button size="sm" icon={Landmark} onClick={() => (onClose(), navigate('/settings/fund_terms'))}>Wire details</Button>}>
                No approved wire details
              </Notice>
            )}
            <ReviewNote e={e} />
          </>
        )}
      </div>
      <div className="flex justify-end gap-2 border-t border-[var(--vo-hair)] px-5 py-3">
        {step > 0 ? <Button onClick={() => setStep(step - 1)}>Back</Button> : <Button onClick={onClose}>Cancel</Button>}
        {step === 0 && (
          <Button variant="primary" iconRight={ArrowRight} busy={busy} disabled={!ready} onClick={() => void draft()}>
            Preview
          </Button>
        )}
        {step === 1 && (
          <Button variant="primary" iconRight={ArrowRight} disabled={e === undefined} onClick={() => setStep(2)}>
            Next
          </Button>
        )}
        {step === 2 && (
          <Button variant="primary" busy={busy} disabled={e === undefined || (call && wire === undefined)} onClick={() => void issue()}>
            {call ? 'Issue call' : 'Issue'}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
