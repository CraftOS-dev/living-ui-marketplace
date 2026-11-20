/**
 * The deal page's Investment tab: Mark invested as three steps on a
 * StepTrack (Terms, Preview, Done). Terms: instrument chips, amount, day
 * (the rest behind More). Preview: the engine's ownership, implied price
 * and the SAFE conversion scenario. Done: the holding, created.
 */
import { useEffect, useState } from 'react';
import { ArrowRight, Briefcase, Check, Gavel } from 'lucide-react';
import { Button, ChipPicker, DayPicker, Field, FigureStrip, FileDrop, LoadError, MoneyInput, More, Panel, PctInput, Skeleton, StepTrack, Tag, Toggle, confirmAsk } from '../../components/ui.tsx';
import { opForm, op } from '../../lib/api.ts';
import { allowed, useMe } from '../../lib/auth.ts';
import { majorParam, money, multiple, num, pct, today } from '../../lib/format.ts';
import { act, useOp } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import type { RecordLike } from '../../lib/contract.ts';
import type { CompanyHoldings, Holding, SafePreview } from './types.ts';

type Instrument = 'safe_cap' | 'safe_discount' | 'safe_mfn' | 'note' | 'priced';
const INSTRUMENTS: { value: Instrument; label: string }[] = [
  { value: 'safe_cap', label: 'SAFE cap' },
  { value: 'safe_discount', label: 'SAFE discount' },
  { value: 'safe_mfn', label: 'SAFE MFN' },
  { value: 'note', label: 'Note' },
  { value: 'priced', label: 'Priced' },
];

/** holdings.invest-check: the committee's say before Mark invested. */
interface Gate {
  decision: { outcome: string; outcome_label: string; conditions_open: number; conditions_total: number } | null;
  blocked: boolean;
  code: string;
  message: string;
  may_override: boolean;
}

interface DealLike {
  id: string;
  number: string;
  status: string;
  stage: string;
  currency: string;
  check_minor: number;
  instrument: string;
  company: { id: string; name: string } | string | null;
  round: { type: string; raise_minor: number | null; pre_money_minor: number | null; post_money_minor: number | null } | null;
}

/** Show the tab when the deal is invested or at Term sheet (or IC, Closed). */
export function showInvestment({ deal }: { deal: RecordLike }): boolean {
  const d = deal as unknown as DealLike;
  return d.status === 'invested' || (d.status === 'open' && ['ic', 'term_sheet', 'closed'].includes(String(d.stage)));
}

function companyId(d: DealLike): string {
  return typeof d.company === 'string' ? d.company : (d.company?.id ?? '');
}

function Done({ d }: { d: DealLike }): React.JSX.Element {
  const live = useOp<CompanyHoldings>('holdings.company', { company: companyId(d) }, ['holdings', 'securities', 'ownership'], { name: 'holdings.company' });
  if (live.error !== null) return <LoadError message={live.error} onRetry={live.reload} />;
  if (live.data === null) return <Skeleton className="h-24 w-full" />;
  const h: Holding | undefined = live.data.holdings.find((x) => x.deal?.id === d.id) ?? live.data.holdings[0];
  return (
    <div className="flex flex-col gap-6">
      <StepTrack labels={['Terms', 'Preview', 'Done']} at={3} className="max-w-[360px]" />
      {h !== undefined && (
        <FigureStrip
          items={[
            { label: 'Invested', value: money(h.cost_minor, h.currency, { compact: true }) },
            { label: 'Ownership', value: h.ownership_ppm !== null ? pct(h.ownership_ppm, 2) : null, tip: h.ownership_ppm === null ? 'Set when it converts.' : undefined },
            { label: 'MOIC', value: h.moic_e8 !== null ? multiple(h.moic_e8) : null },
          ]}
        />
      )}
      <div>
        <Button icon={Briefcase} onClick={() => navigate('/portfolio/' + companyId(d))}>
          Open in Portfolio
        </Button>
      </div>
    </div>
  );
}

export function Investment({ deal }: { deal: RecordLike }): React.JSX.Element {
  const d = deal as unknown as DealLike;
  const me = useMe();
  const edit = allowed(me, 'portfolio:edit') && allowed(me, 'pipeline:edit');
  const cur = d.currency || me.firm.base_currency || 'USD';
  const [step, setStep] = useState<0 | 1 | 2>(d.status === 'invested' ? 2 : 0);
  const [instrument, setInstrument] = useState<Instrument>((INSTRUMENTS.find((i) => i.value === d.instrument)?.value ?? 'safe_cap') as Instrument);
  const [amount, setAmount] = useState<number | null>(d.check_minor > 0 ? d.check_minor : null);
  const [day, setDay] = useState(today());
  const [cap, setCap] = useState<number | null>(d.round?.post_money_minor ?? null);
  const [discount, setDiscount] = useState<number | null>(null);
  const [rate, setRate] = useState<number | null>(null);
  const [post, setPost] = useState<number | null>(d.round?.post_money_minor ?? null);
  const [proRata, setProRata] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<SafePreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const gate = useOp<Gate>('holdings.invest-check', { deal: d.number }, ['decisions', 'conditions', 'deals'], { name: 'invest-check', skip: d.status === 'invested' });
  const g = gate.data;
  useEffect(() => {
    if (d.status === 'invested') setStep(2);
  }, [d.status]);
  if (step === 2) return <Done d={d} />;

  const params = (): Record<string, unknown> => {
    const p: Record<string, unknown> = { deal: d.number, instrument, amount: majorParam(amount, cur), day, currency: cur };
    if ((instrument === 'safe_cap' || instrument === 'note') && cap !== null) p['cap'] = majorParam(cap, cur);
    if ((instrument === 'safe_discount' || instrument === 'note') && discount !== null) p['discount'] = String(discount / 10000);
    if (instrument === 'note' && rate !== null) p['rate'] = String(rate / 10000);
    if (instrument === 'priced' && post !== null) p['post_money'] = majorParam(post, cur);
    return p;
  };
  const runPreview = async (): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      setPreview(await op<SafePreview>('safe.preview', params(), { quiet: true }));
      setStep(1);
    } catch (e) {
      setError((e as Error).message);
    }
    setBusy(false);
  };
  const invest = async (): Promise<void> => {
    let over = false;
    if (g !== null && g.blocked) {
      if (!g.may_override) return;
      if (!(await confirmAsk('Mark invested over the committee?', 'Confirm', 'danger', g.message))) return;
      over = true;
    }
    setBusy(true);
    const p = { ...params(), pro_rata: proRata, ...(over ? { override: true } : {}) };
    const out = await act([], () => (files.length > 0 ? opForm('holdings.create-from-deal', p, { file: files }) : op('holdings.create-from-deal', p)), ['deals', 'holdings', 'securities', 'ownership', 'rounds']);
    setBusy(false);
    if (out !== null) setStep(2);
  };

  const ready = amount !== null && amount > 0 && (instrument !== 'safe_cap' || cap !== null) && (instrument !== 'safe_discount' || discount !== null) && (instrument !== 'note' || rate !== null) && (instrument !== 'priced' || post !== null);
  return (
    <div className="flex max-w-[720px] flex-col gap-6">
      <div className="flex flex-wrap items-center gap-4">
        <StepTrack labels={['Terms', 'Preview', 'Done']} at={step} className="w-full max-w-[360px]" />
        {g !== null && g.decision !== null && (
          <a href={'#/deals/' + d.number + '?tab=decision'} className="vo-focus inline-flex cursor-pointer rounded-[6px] transition-opacity duration-150 hover:opacity-80" title={g.message || undefined}>
            <Tag tone={g.blocked ? 'warn' : 'good'} icon={Gavel}>
              {g.code === 'conditions_open' ? `${g.decision.conditions_open} open condition${g.decision.conditions_open === 1 ? '' : 's'}` : 'IC: ' + g.decision.outcome_label}
            </Tag>
          </a>
        )}
      </div>
      {step === 0 ? (
        <Panel>
          <div className="flex flex-col gap-4">
            <Field label="Instrument">
              <ChipPicker label="Instrument" options={INSTRUMENTS} value={instrument} onChange={setInstrument} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Amount">
                <MoneyInput value={amount} onChange={setAmount} currency={cur} label="Amount" />
              </Field>
              {instrument === 'safe_cap' && (
                <Field label="Cap" tip="Post-money valuation cap.">
                  <MoneyInput value={cap} onChange={setCap} currency={cur} label="Cap" />
                </Field>
              )}
              {instrument === 'safe_discount' && (
                <Field label="Discount">
                  <PctInput value={discount} onChange={setDiscount} label="Discount" />
                </Field>
              )}
              {instrument === 'priced' && (
                <Field label="Post-money">
                  <MoneyInput value={post} onChange={setPost} currency={cur} label="Post-money" />
                </Field>
              )}
              {instrument === 'note' && (
                <Field label="Interest">
                  <PctInput value={rate} onChange={setRate} label="Interest" />
                </Field>
              )}
            </div>
            <More>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Day">
                  <DayPicker value={day} onChange={setDay} label="Closing day" />
                </Field>
                {instrument === 'note' && (
                  <>
                    <Field label="Cap" tip="Pre-money valuation cap.">
                      <MoneyInput value={cap} onChange={setCap} currency={cur} label="Cap" />
                    </Field>
                    <Field label="Discount">
                      <PctInput value={discount} onChange={setDiscount} label="Discount" />
                    </Field>
                  </>
                )}
                <div className="flex items-end">
                  <Toggle checked={proRata} onChange={setProRata} label="Pro rata right" />
                </div>
              </div>
              <FileDrop label="Closing documents" multiple onFiles={(f) => setFiles([...files, ...f])} className="mt-4" accept=".pdf,.docx,.xlsx,.csv">
                {files.length > 0 ? <span className="vo-wrap text-[13px]">{files.map((f) => f.name).join(', ')}</span> : undefined}
              </FileDrop>
            </More>
            {error !== '' && <p className="text-[13px] text-[var(--vo-bad)]">{error}</p>}
            {edit && (
              <div className="flex justify-end">
                <Button iconRight={ArrowRight} busy={busy} disabled={!ready} onClick={() => void runPreview()}>
                  Preview
                </Button>
              </div>
            )}
          </div>
        </Panel>
      ) : (
        preview !== null && (
          <Panel>
            <div className="flex flex-col gap-5">
              <FigureStrip
                items={[
                  { label: 'Check', value: money(preview.amount_minor, preview.currency, { compact: true }) },
                  { label: 'Ownership', value: preview.ownership_ppm !== null ? pct(preview.ownership_ppm, 2) : 'At conversion', tip: preview.ownership_ppm === null ? 'A discount or MFN SAFE and a note own shares only once they convert.' : 'Fully diluted, from the engine.' },
                  { label: 'Implied price', value: preview.implied_price_e8 !== null ? num(preview.implied_price_e8 / 1e8, 4) : null, tip: 'Needs the fully diluted share count (More).' },
                  ...(preview.converted !== null
                    ? [{ label: 'After next round', value: pct(preview.converted.ownership_ppm, 2), tip: preview.scenario !== null ? `If the next round prices at ${money(preview.scenario.pre_money_minor, preview.currency, { compact: true })} pre-money and raises ${money(preview.scenario.raise_minor, preview.currency, { compact: true })}; converts at the ${preview.converted.basis === 'cap' ? 'cap' : preview.converted.basis === 'discount' ? 'discount' : 'round price'}.` : undefined }]
                    : []),
                ]}
              />
              <div className="flex flex-wrap items-center justify-end gap-2">
                <Button variant="ghost" onClick={() => setStep(0)}>
                  Back
                </Button>
                {edit && (
                  <Button icon={Check} busy={busy} disabled={g !== null && g.blocked && !g.may_override} onClick={() => void invest()}>
                    Confirm
                  </Button>
                )}
              </div>
            </div>
          </Panel>
        )
      )}
    </div>
  );
}
