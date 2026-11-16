/**
 * Edit investment (fix 5): a person corrects the terms of the firm's
 * investment in a portfolio company: the security (what was bought, the
 * amount, the date, the valuation cap) and its round (the round, its date,
 * the post-money valuation, the money raised). The round is the one the
 * security belongs to; a security without one starts on the company's round
 * of the same day, and the person may pick another round or a new one.
 * Saves through the existing securities.save and rounds.save; both are
 * audited by the server. For your AI agent these stay proposals.
 */
import { useEffect, useMemo, useState } from 'react';
import { Layers } from 'lucide-react';
import { Button, ChipPicker, DayPicker, Empty, Field, Input, LoadError, MoneyInput, Section, Sections, Segmented, Select, Sheet, SheetHeader, Skeleton } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { fmtDay, majorParam, money, today } from '../../lib/format.ts';
import { act, useLive } from '../../lib/live.ts';
import { HOLDING_READS } from './Holdings.tsx';
import type { CompanyHoldings, Holding, Round, Security } from './types.ts';

const KIND_LABEL: Record<string, string> = { safe_cap: 'SAFE with a cap', safe_discount: 'SAFE with a discount', safe_mfn: 'SAFE, most favoured nation', note: 'Convertible note', priced: 'Shares (priced round)', common: 'Common shares' };
const ROUND_LABEL: Record<string, string> = { pre_seed: 'Pre-seed', seed: 'Seed', seed_extension: 'Seed extension', series_a: 'Series A', series_b: 'Series B', series_c: 'Series C', series_d_plus: 'Series D+', bridge: 'Bridge', other: 'Other' };
const CONVERTIBLE = ['safe_cap', 'safe_discount', 'safe_mfn', 'note'];
const READS = [...HOLDING_READS, 'companies', 'marks'];

interface Form {
  /** The security the form was filled from. */
  sid: string;
  kind: string;
  cost: number | null;
  day: string;
  cap: number | null;
  shares: string;
  rType: string;
  rDay: string;
  post: number | null;
  raise: number | null;
}

function roundPart(s: Security, r: Round | null): Pick<Form, 'rType' | 'rDay' | 'post' | 'raise'> {
  return { rType: r?.type ?? '', rDay: r?.day ?? s.day, post: r?.post_money_minor ?? null, raise: r?.raised_minor ?? null };
}

function formOf(s: Security, r: Round | null): Form {
  return { sid: s.id, kind: s.kind, cost: s.cost_minor > 0 ? s.cost_minor : null, day: s.day, cap: s.cap_minor, shares: s.shares !== null ? String(s.shares) : '', ...roundPart(s, r) };
}

export function EditInvestment({ company, name, open, onClose }: { company: string; name: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  if (!open) return null;
  return <Body company={company} name={name} onClose={onClose} />;
}

function Body({ company, name, onClose }: { company: string; name: string; onClose: () => void }): React.JSX.Element {
  // Never a remembered answer: the form starts from the terms as they are now.
  const live = useLive<CompanyHoldings>((signal) => op('holdings.company', { company }, { quiet: true, signal }), HOLDING_READS, ['edit-investment', company]);
  const d = live.data;
  const [holdingId, setHoldingId] = useState('');
  const [securityId, setSecurityId] = useState('');
  const h: Holding | undefined = d?.holdings.find((x) => x.id === holdingId) ?? d?.holdings[0];
  const secs = useMemo(() => (h?.securities ?? []).slice().sort((a, b) => (a.day < b.day ? -1 : 1)), [h]);
  const s: Security | undefined = secs.find((x) => x.id === securityId) ?? secs[0];
  const rounds = useMemo(() => (d?.rounds ?? []).slice().sort((a, b) => (a.day < b.day ? 1 : -1)), [d]);
  // The round shown: the person's pick, else the security's own, else the company's round of the same day, else a new one.
  const [roundPick, setRoundPick] = useState<string | null>(null);
  const ownRound = s !== undefined && s.round !== '' && rounds.some((r) => r.id === s.round) ? s.round : '';
  const defaultRound = s === undefined ? 'new' : ownRound !== '' ? ownRound : (rounds.find((r) => r.day === s.day)?.id ?? 'new');
  const picked = roundPick ?? defaultRound;
  const round = picked !== 'new' ? (rounds.find((r) => r.id === picked) ?? null) : null;
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const key = (s?.id ?? '') + '|' + picked;
  useEffect(() => {
    if (s === undefined) return;
    // A new security fills the whole form; another round only its round fields (the security's edits stay).
    setForm((f) => (f === null || f.sid !== s.id ? formOf(s, round) : { ...f, ...roundPart(s, round) }));
    // Only when the security or the round shown changes (not on every reload while typing).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const pickSecurity = (id: string): void => {
    setSecurityId(id);
    setRoundPick(null);
  };

  const cur = h?.currency ?? 'USD';
  const base = s !== undefined ? formOf(s, round) : null;
  const diff = (k: keyof Form): boolean => form !== null && base !== null && form[k] !== base[k];
  const secChanged = form !== null && (['kind', 'cost', 'day', 'cap', 'shares'] as const).some(diff);
  const roundFields = form !== null && (['rType', 'rDay', 'post', 'raise'] as const).some(diff) && (round !== null || form.rType !== '' || form.post !== null || form.raise !== null);
  const linkChanged = s !== undefined && round !== null && round.id !== s.round;
  const roundChanged = roundFields || linkChanged;
  const sharesBad = form !== null && form.shares.trim() !== '' && !/^\d+$/.test(form.shares.trim());
  const capBad = form !== null && form.kind === 'safe_cap' && (form.cap === null || form.cap <= 0);

  const save = async (): Promise<void> => {
    if (form === null || s === undefined || h === undefined) return;
    setBusy(true);
    const out = await act(
      [],
      async () => {
        let roundId = round?.id ?? '';
        if (roundFields) {
          const p: Record<string, unknown> = round !== null ? { round: round.id } : { company };
          if (round === null || diff('rType')) p['type'] = form.rType !== '' ? form.rType : undefined;
          if (round === null || diff('rDay')) p['day'] = form.rDay !== '' ? form.rDay : undefined;
          if (round === null || diff('post')) p['post_money'] = majorParam(form.post, cur);
          if (round === null || diff('raise')) p['raise'] = majorParam(form.raise, cur);
          if (round === null) p['currency'] = cur;
          const r = await op<{ round: { id: string } }>('rounds.save', p);
          roundId = r.round.id;
        }
        const sp: Record<string, unknown> = { security: s.id };
        if (diff('kind')) sp['kind'] = form.kind;
        if (diff('cost')) sp['cost'] = majorParam(form.cost ?? 0, cur);
        if (diff('day') && form.day !== '') sp['day'] = form.day;
        if (diff('cap') && form.cap !== null) sp['cap'] = majorParam(form.cap, cur);
        if (diff('shares') && form.shares.trim() !== '') sp['shares'] = Number(form.shares.trim());
        if (roundId !== '' && roundId !== s.round) sp['round'] = roundId;
        if (Object.keys(sp).length > 1) await op('securities.save', sp);
        return true;
      },
      READS,
    );
    setBusy(false);
    if (out !== null) onClose();
  };

  const multiFund = (d?.holdings.length ?? 0) > 1;
  return (
    <Sheet open onClose={onClose} label="Edit investment" width={560}>
      <SheetHeader title={'Edit investment: ' + name} onClose={onClose} />
      {live.error !== null && d === null ? (
        <div className="p-5">
          <LoadError message={live.error} onRetry={live.reload} />
        </div>
      ) : d === null ? (
        <div className="flex flex-col gap-3 p-5">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-56 w-full" />
        </div>
      ) : h === undefined || s === undefined || form === null ? (
        <Empty icon={Layers} title="No investment recorded" />
      ) : (
        <div className="vo-scroll min-h-0 flex-1 overflow-y-auto">
          <Sections pad="card">
            {(multiFund || secs.length > 1) && (
              <Section title={multiFund ? 'Fund and security' : 'Security'}>
                <div className="flex min-w-0 flex-col gap-3">
                  {multiFund && (
                    <Segmented
                      label="Fund"
                      value={h.id}
                      onChange={(v) => {
                        setHoldingId(v);
                        setSecurityId('');
                        setRoundPick(null);
                      }}
                      options={d.holdings.map((x) => ({ value: x.id, label: x.fund?.name ?? 'Fund' }))}
                    />
                  )}
                  {secs.length > 1 && <ChipPicker label="Security" value={s.id} onChange={pickSecurity} options={secs.map((x) => ({ value: x.id, label: (KIND_LABEL[x.kind] ?? x.kind) + ', ' + money(x.cost_minor, cur, { compact: true }) + ', ' + fmtDay(x.day) }))} />}
                </div>
              </Section>
            )}
            <Section title="What the fund bought" tip={'Amounts in ' + cur + ', the currency of the holding.'}>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Security" className="sm:col-span-2">
                  <Select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} aria-label="Security">
                    {Object.entries(KIND_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Amount invested">
                  <MoneyInput value={form.cost} onChange={(v) => setForm({ ...form, cost: v })} currency={cur} label="Amount invested" />
                </Field>
                <Field label="Date">
                  <DayPicker value={form.day} onChange={(v) => setForm({ ...form, day: v })} label="Date of the investment" max={today()} />
                </Field>
                {CONVERTIBLE.includes(form.kind) && (
                  <Field label="Valuation cap" error={capBad ? 'A SAFE with a cap needs the cap.' : null}>
                    <MoneyInput value={form.cap} onChange={(v) => setForm({ ...form, cap: v })} currency={cur} label="Valuation cap" />
                  </Field>
                )}
                {!CONVERTIBLE.includes(form.kind) && (
                  <Field label="Shares" error={sharesBad ? 'A whole number of shares.' : null}>
                    <Input className="vo-mono" value={form.shares} inputMode="numeric" onChange={(e) => setForm({ ...form, shares: e.target.value.replace(/[^\d]/g, '') })} aria-label="Shares" />
                  </Field>
                )}
              </div>
            </Section>
            <Section title="The round" tip="The company's round this security belongs to. Pick another round, or a new one.">
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                {rounds.length > 0 && (
                  <Field label="Which round" className="sm:col-span-2">
                    <Select value={picked} onChange={(e) => setRoundPick(e.target.value)} aria-label="Which round">
                      {rounds.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.label + ', ' + fmtDay(r.day)}
                        </option>
                      ))}
                      <option value="new">A new round</option>
                    </Select>
                  </Field>
                )}
                <Field label="Round">
                  <Select value={form.rType} onChange={(e) => setForm({ ...form, rType: e.target.value })} aria-label="Round">
                    <option value="">Not set</option>
                    {Object.entries(ROUND_LABEL).map(([k, l]) => (
                      <option key={k} value={k}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Round date">
                  <DayPicker value={form.rDay} onChange={(v) => setForm({ ...form, rDay: v })} label="Round date" />
                </Field>
                <Field label="Post-money valuation" tip="What the company was worth right after the round.">
                  <MoneyInput value={form.post} onChange={(v) => setForm({ ...form, post: v })} currency={cur} label="Post-money valuation" />
                </Field>
                <Field label="Money raised" tip="New money in the round, every investor together.">
                  <MoneyInput value={form.raise} onChange={(v) => setForm({ ...form, raise: v })} currency={cur} label="Money raised in the round" />
                </Field>
              </div>
            </Section>
          </Sections>
        </div>
      )}
      <div className="flex shrink-0 justify-end gap-2 border-t border-[var(--vo-line)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={!(secChanged || roundChanged) || sharesBad || capBad} onClick={() => void save()}>
          Save
        </Button>
      </div>
    </Sheet>
  );
}
