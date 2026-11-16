/**
 * New thesis (and Edit): a name, then the criteria as chips over the fact
 * keys (sector and stage at rest; geography, round size, sources, schedule
 * and keywords behind More, every default filled). Saving writes the thesis
 * (theses.save) and its radar (radars.save); a new thesis runs its radar at
 * once so the first candidates appear without waiting for the schedule.
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, ChipPicker, Field, Input, More, Segmented, Sheet, SheetHeader, Skeleton, Toggle, AgentTag } from '../ui.tsx';
import { op, OpError } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.ts';
import { exponent } from '../../lib/format.ts';
import { changed, useOp } from '../../lib/live.ts';
import { ChipSet } from './ChipSet.tsx';
import type { Criterion, Options, Radar, Schedule, SourceKey, ThesisTile } from './types.ts';
import { word } from './types.ts';

type Size = 'any' | 'small' | 'mid' | 'large' | 'huge';
const SIZES: { value: Size; label: string; min?: number; max?: number }[] = [
  { value: 'any', label: 'Any' },
  { value: 'small', label: 'Up to 2M', max: 2 },
  { value: 'mid', label: '2M to 10M', min: 2, max: 10 },
  { value: 'large', label: '10M to 50M', min: 10, max: 50 },
  { value: 'huge', label: '50M and up', min: 50 },
];
type When = 'daily' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
const WHEN: { value: When; label: string }[] = [
  { value: 'daily', label: 'Daily' },
  { value: 'mon', label: 'Mon' },
  { value: 'tue', label: 'Tue' },
  { value: 'wed', label: 'Wed' },
  { value: 'thu', label: 'Thu' },
  { value: 'fri', label: 'Fri' },
];
type Time = '07:00' | '08:00' | '09:00' | '12:00';
const TIMES: Time[] = ['07:00', '08:00', '09:00', '12:00'];

interface Draft {
  name: string;
  sectors: string[];
  stages: string[];
  countries: string[];
  size: Size;
  sources: SourceKey[];
  when: When;
  time: Time;
  query: string;
}

function valuesOf(criteria: Criterion[], key: string): string[] {
  const c = criteria.find((x) => x.key === key && x.op === 'in');
  return (c?.values ?? []).map((v) => String(v));
}

function sizeOf(criteria: Criterion[], cur: string): Size {
  const c = criteria.find((x) => x.key === 'raise_minor');
  if (c === undefined) return 'any';
  const unit = 1_000_000 * 10 ** exponent(c.currency ?? cur);
  const min = c.min !== undefined ? c.min / unit : c.op === 'gte' && typeof c.value === 'number' ? c.value / unit : undefined;
  const max = c.max !== undefined ? c.max / unit : c.op === 'lte' && typeof c.value === 'number' ? c.value / unit : undefined;
  return SIZES.find((s) => s.min === min && s.max === max)?.value ?? 'any';
}

function draftOf(t: ThesisTile | null, o: Options, cur: string): Draft {
  const r = t?.radar ?? null;
  const s: Schedule = r?.schedule ?? o.defaults.schedule;
  const when: When = s.every === 'daily' ? 'daily' : ((s.day ?? 'mon') as When);
  const time = (TIMES as string[]).includes(s.time) ? (s.time as Time) : '08:00';
  return {
    name: t?.name ?? '',
    sectors: t !== null ? valuesOf(t.criteria, 'sector') : [],
    stages: t !== null ? valuesOf(t.criteria, 'stage') : [],
    countries: t !== null ? valuesOf(t.criteria, 'hq_country') : [],
    size: t !== null ? sizeOf(t.criteria, cur) : 'any',
    sources: r?.sources ?? o.defaults.sources,
    when: WHEN.some((w) => w.value === when) ? when : 'mon',
    time,
    query: r?.query ?? '',
  };
}

/** The thesis criteria for the fit engine (theses.save --criteria). */
function criteriaOf(d: Draft, cur: string): Criterion[] {
  const out: Criterion[] = [];
  if (d.sectors.length > 0) out.push({ key: 'sector', op: 'in', values: d.sectors });
  if (d.stages.length > 0) out.push({ key: 'stage', op: 'in', values: d.stages });
  if (d.countries.length > 0) out.push({ key: 'hq_country', op: 'in', values: d.countries });
  const s = SIZES.find((x) => x.value === d.size);
  if (s !== undefined && d.size !== 'any') {
    const unit = 1_000_000 * 10 ** exponent(cur);
    if (s.min !== undefined && s.max !== undefined) out.push({ key: 'raise_minor', op: 'between', min: s.min * unit, max: s.max * unit, currency: cur, required: true });
    else if (s.max !== undefined) out.push({ key: 'raise_minor', op: 'lte', value: s.max * unit, currency: cur, required: true });
    else if (s.min !== undefined) out.push({ key: 'raise_minor', op: 'gte', value: s.min * unit, currency: cur, required: true });
  }
  return out;
}

export function ThesisSheet({ open, thesis, onClose, onSaved }: { open: boolean; thesis: ThesisTile | null; onClose: () => void; onSaved: (thesisId: string, created: boolean, radarId: string) => void }): React.JSX.Element | null {
  const me = useMe();
  const cur = me.firm.base_currency || 'USD';
  const opts = useOp<Options>('radars.options', {}, ['settings', 'theses', 'companies'], { name: 'radars.options', skip: !open });
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) {
      setDraft(null);
      setError('');
    } else if (draft === null && opts.data !== null) setDraft(draftOf(thesis, opts.data, cur));
  }, [open, opts.data, thesis, draft, cur]);
  const o = opts.data;
  const sectors = useMemo(() => (o?.sectors ?? []).map((s) => ({ value: s, label: word(s) })), [o]);
  const stages = useMemo(() => (o?.stages ?? []).filter((s) => s !== 'idea').map((s) => ({ value: s, label: word(s) })), [o]);
  const countries = useMemo(() => (o?.countries ?? []).map((c) => ({ value: c, label: c })), [o]);
  if (!open) return null;
  const set = (patch: Partial<Draft>): void => setDraft((d) => (d === null ? d : { ...d, ...patch }));
  const save = async (): Promise<void> => {
    if (draft === null) return;
    setBusy(true);
    setError('');
    try {
      const criteria = criteriaOf(draft, cur);
      const t = await op<{ thesis: { id: string } }>('theses.save', thesis !== null ? { thesis: thesis.id, name: draft.name.trim(), criteria } : { name: draft.name.trim(), criteria }, { quiet: true });
      const schedule = draft.when === 'daily' ? `daily ${draft.time}` : `weekly ${draft.when} ${draft.time}`;
      const radarId = thesis?.radar?.id;
      const r = await op<{ radar: Radar }>(
        'radars.save',
        radarId !== undefined ? { radar: radarId, sources: draft.sources, schedule, query: draft.query.trim() } : { thesis: t.thesis.id, sources: draft.sources, schedule, query: draft.query.trim() },
        { quiet: true },
      );
      changed('theses', 'radars');
      onSaved(t.thesis.id, thesis === null, r.radar.id);
    } catch (err) {
      setError(err instanceof OpError ? err.message : 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} label={thesis === null ? 'New thesis' : 'Edit thesis'} width={520}>
      <SheetHeader title={thesis === null ? 'New thesis' : 'Edit thesis'} onClose={onClose} />
      <div className="vo-scroll flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
        {draft === null || o === null ? (
          <Skeleton className="h-48 w-full" />
        ) : (
          <>
            <Field label="Name" error={error}>
              <Input autoFocus value={draft.name} maxLength={160} onChange={(e) => set({ name: e.target.value })} aria-label="Thesis name" onKeyDown={(e) => e.key === 'Enter' && draft.name.trim() !== '' && void save()} />
            </Field>
            <Field label="Sector" tip="Candidates are checked against these. A missing fact stays unknown, never a no.">
              <ChipSet options={sectors} value={draft.sectors} onChange={(v) => set({ sectors: v })} label="Sector" max={10} />
            </Field>
            <Field label="Stage">
              <ChipSet options={stages} value={draft.stages} onChange={(v) => set({ stages: v })} label="Stage" />
            </Field>
            <More>
              <Field label="Geography">
                <ChipSet options={countries} value={draft.countries} onChange={(v) => set({ countries: v })} label="Geography" max={10} />
              </Field>
              <Field label={`Round (${cur})`} tip="A round outside this range is set aside by rule.">
                <ChipPicker options={SIZES.map((s) => ({ value: s.value, label: s.label }))} value={draft.size} onChange={(v) => set({ size: v })} label="Round size" />
              </Field>
              <Field label="Sources" tip="Form D, Show HN and GitHub are read by Venture OS. The registries are searched by your AI agent with its own access.">
                <div className="flex flex-col divide-y divide-[var(--vo-hair)] rounded-[var(--vo-radius-sm)] border border-[var(--vo-line)]">
                  {o.sources.map((s) => (
                    <label key={s.key} className="flex h-10 cursor-pointer items-center gap-3 px-3 text-[13px] hover:bg-[var(--vo-hover)]">
                      <span className="min-w-0 flex-1 truncate">{s.label}</span>
                      {s.by === 'agent' && <AgentTag />}
                      <Toggle checked={draft.sources.includes(s.key)} onChange={(on) => set({ sources: on ? [...draft.sources, s.key] : draft.sources.filter((x) => x !== s.key) })} label={s.label} />
                    </label>
                  ))}
                </div>
              </Field>
              <Field label="Schedule" tip="Candidates arrive in Next at this time, in the firm's time zone.">
                <div className="flex flex-col gap-2">
                  <ChipPicker options={WHEN} value={draft.when} onChange={(v) => set({ when: v })} label="Day" />
                  <Segmented label="Time" value={draft.time} onChange={(v) => set({ time: v })} options={TIMES.map((t) => ({ value: t, label: <span className="vo-mono">{t}</span> }))} />
                </div>
              </Field>
              <Field label="Keywords" tip="GitHub searches these; your AI agent reads them too.">
                <Input value={draft.query} maxLength={300} onChange={(e) => set({ query: e.target.value })} aria-label="Keywords" placeholder="payments api" />
              </Field>
            </More>
          </>
        )}
      </div>
      <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--vo-line)] px-5 py-3">
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" busy={busy} disabled={draft === null || draft.name.trim() === ''} onClick={() => void save()}>
          {thesis === null ? 'Create' : 'Save'}
        </Button>
      </footer>
    </Sheet>
  );
}
