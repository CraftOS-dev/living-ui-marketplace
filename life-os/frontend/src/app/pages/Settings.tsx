/**
 * Settings: you (name, where you live for the weather, units, currency, the
 * week), daily aims, the parts of life on your island, what your AI agent
 * may read and when it stays quiet, the calendar mirror, and your data.
 */
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, MapPin, RefreshCw } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { download, op } from '../lib/api.ts';
import { useStatus } from '../lib/context.tsx';
import { ago } from '../lib/format.ts';
import { act, changed, patchWhere, useLive } from '../lib/live.ts';
import type { Settings } from '../lib/types.ts';
import { AREA_BLURB, AREA_KINDS, AREA_NAMES, AreaArt, HabitArt } from '../components/art.tsx';
import { Chip, InlineText, Section, Stepper, switchArea } from '../components/bits.tsx';
import { PlaceSearch } from '../components/glance.tsx';
import { PageBanner, PageBody } from '../components/page.tsx';
import { TimeField } from '../components/pickers.tsx';
import { snack } from '../components/snack.tsx';
import { Button, Skeleton, Toggle } from '../components/ui.tsx';

function Row({ label, hint, children }: { label: string; hint?: string | undefined; children: ReactNode }): React.JSX.Element {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--lo-hair)] py-3 last:border-b-0">
      <div className="min-w-[180px] flex-1">
        <p className="text-[14px] font-bold">{label}</p>
        {hint !== undefined && <p className="text-[12px] text-[var(--lo-muted)]">{hint}</p>}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }): React.JSX.Element {
  return <div className="rounded-[var(--lo-r-xl)] border border-[var(--lo-hair)] bg-[var(--lo-card)] px-5 py-1 shadow-[var(--lo-shadow-sm)]">{children}</div>;
}

function Calendar({ s, set }: { s: Settings; set: (p: Record<string, unknown>) => Promise<void> }): React.JSX.Element {
  const st = useLive<{ enabled: boolean; state: string; error: string; synced_at: string; events: number }>((signal) => op('calendar.status', {}, { quiet: true, signal }), ['settings', 'calendar_events'], []);
  const [id, setId] = useState(s.calendar_id);
  const [busy, setBusy] = useState(false);
  useEffect(() => setId(s.calendar_id), [s.calendar_id]);
  const sync = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('calendar.sync');
      changed('calendar_events', 'settings');
      st.reload();
    } finally {
      setBusy(false);
    }
  };
  const word: Record<string, string> = { ok: 'Connected', not_connected: 'Google Calendar is not connected yet', unreachable: 'Could not reach the calendar', off: 'Off' };
  return (
    <Panel>
      <Row label="Show calendar events" hint="Your events appear on Home and the week, beside your cards. Read only.">
        <Toggle checked={s.calendar_enabled} onChange={(v) => void set({ calendar_enabled: v })} label="Show calendar events" />
      </Row>
      {s.calendar_enabled && (
        <>
          <Row label="Which calendar">
            <input value={id} onChange={(e) => setId(e.target.value)} onBlur={() => id.trim() !== s.calendar_id && void set({ calendar_id: id.trim() || 'primary' })} placeholder="primary" aria-label="Calendar id" className="h-9 w-56 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-3 text-[13px] font-semibold outline-none focus:border-[var(--lo-accent)]" />
          </Row>
          <Row label={word[st.data?.state ?? 'off'] ?? 'Calendar'} hint={st.data !== null && st.data.synced_at !== '' ? `${st.data.events} events, looked ${ago(st.data.synced_at)}` : st.data?.error || undefined}>
            <Button variant="outline" size="sm" icon={RefreshCw} loading={busy} onClick={() => void sync()}>
              Look now
            </Button>
          </Row>
        </>
      )}
    </Panel>
  );
}

export default function SettingsPage(): React.JSX.Element {
  const status = useStatus().data;
  const live = useLive<{ settings: Settings; currencies: string[] }>((signal) => op('settings.get', {}, { quiet: true, signal }), ['settings', 'areas'], []);
  const [busy, setBusy] = useState(false);
  const s = live.data?.settings;
  // A setting shows its new value at once; the server keeps it behind.
  const set = async (fields: Record<string, unknown>): Promise<void> => {
    await act([patchWhere((o) => typeof o.onboarded === 'boolean' && 'week_starts_on' in o, () => fields)], () => op<{ settings: Settings }>('settings.update', fields), ['settings']);
  };
  const area = async (kind: string, enabled: boolean): Promise<void> => {
    await switchArea(kind, enabled);
  };
  const exportAll = async (): Promise<void> => {
    setBusy(true);
    try {
      const data = await op<unknown>('export.json');
      download(`life-os-${status?.today ?? 'export'}.json`, JSON.stringify(data, null, 2), 'application/json');
      snack('Exported', { undo: false });
    } finally {
      setBusy(false);
    }
  };
  const on = new Set(status?.areas ?? []);
  return (
    <div>
      <PageBanner seed="settings" title="Settings" />
      <PageBody narrow className="flex flex-col gap-8">
        {s === undefined ? (
          <Skeleton className="h-64 w-full" />
        ) : (
          <>
            <Section title="You">
              <Panel>
                <Row label="Your name">
                  <InlineText value={s.owner_name} onSave={(v) => set({ owner_name: v })} placeholder="Your name" className="w-56 text-[14px] font-semibold" maxLength={60} />
                </Row>
                <Row label="Where you live" hint="For your weather and news">
                  <span className="flex items-center gap-1 text-[14px] font-bold">
                    <MapPin size={14} />
                    {s.city !== '' ? `${s.city}${s.country !== '' ? ', ' + s.country : ''}` : 'Not set'}
                  </span>
                </Row>
                <div className="pb-3">
                  <PlaceSearch compact onSet={() => live.reload()} />
                </div>
                <Row label="Units">
                  <Chip active={s.units === 'metric'} onClick={() => void set({ units: 'metric' })}>
                    Metric (kg, C)
                  </Chip>
                  <Chip active={s.units === 'imperial'} onClick={() => void set({ units: 'imperial' })}>
                    Imperial (lb, F)
                  </Chip>
                </Row>
                <Row label="Currency">
                  <select value={s.currency} onChange={(e) => void set({ currency: e.target.value })} aria-label="Currency" className="h-9 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]">
                    {(live.data?.currencies ?? [s.currency]).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </Row>
                <Row label="The week starts on">
                  <Chip active={s.week_starts_on === 'monday'} onClick={() => void set({ week_starts_on: 'monday' })}>
                    Monday
                  </Chip>
                  <Chip active={s.week_starts_on === 'sunday'} onClick={() => void set({ week_starts_on: 'sunday' })}>
                    Sunday
                  </Chip>
                </Row>
                <Row label="A new day starts at" hint="Late nights still count as the day before">
                  <select value={s.day_starts_hour} onChange={(e) => void set({ day_starts_hour: Number(e.target.value) })} aria-label="New day starts at" className="h-9 rounded-[var(--lo-r)] border border-[var(--lo-line)] bg-[var(--lo-card)] px-2 text-[13px] font-bold outline-none focus:border-[var(--lo-accent)]">
                    {[0, 1, 2, 3, 4, 5, 6].map((h) => (
                      <option key={h} value={h}>
                        {String(h).padStart(2, '0')}:00
                      </option>
                    ))}
                  </select>
                </Row>
              </Panel>
            </Section>

            <Section title="Daily aims">
              <Panel>
                <Row label="Water" hint="Glasses a day">
                  <HabitArt art="water" size={28} />
                  <Stepper label="glasses" value={s.water_goal} min={1} max={20} onChange={(v) => void set({ water_goal: v })} />
                </Row>
                <Row label="Sleep" hint="Hours a night">
                  <HabitArt art="sleep" size={28} />
                  <Stepper label="hours" value={s.sleep_goal} step={0.5} min={4} max={12} onChange={(v) => void set({ sleep_goal: v })} />
                </Row>
                <Row label="Steps">
                  <HabitArt art="walk" size={28} />
                  <Stepper label="steps" value={s.steps_goal} step={500} min={1000} max={40000} onChange={(v) => void set({ steps_goal: v })} format={(v) => v.toLocaleString()} />
                </Row>
              </Panel>
            </Section>

            <Section title="Parts of life">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {AREA_KINDS.map((k) => (
                  <label key={k} className={cn('flex cursor-pointer items-center gap-3 rounded-[var(--lo-r-lg)] border px-3 py-2', on.has(k) ? 'border-[var(--lo-hair)] bg-[var(--lo-card)]' : 'border-dashed border-[var(--lo-line)]')}>
                    <AreaArt kind={k} size={40} className={on.has(k) ? undefined : 'opacity-50 grayscale'} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold">{AREA_NAMES[k]}</span>
                      <span className="block text-[12px] text-[var(--lo-muted)]">{AREA_BLURB[k]}</span>
                    </span>
                    <Toggle checked={on.has(k)} onChange={(v) => void area(k, v)} label={AREA_NAMES[k]} />
                  </label>
                ))}
              </div>
            </Section>

            <Section title="Your AI agent">
              <Panel>
                <Row label="Journal pages" hint="Pages are only yours unless you share one">
                  <Chip active={s.reflections_to_agent === 'when_shared'} onClick={() => void set({ reflections_to_agent: 'when_shared' })}>
                    Pages I share
                  </Chip>
                  <Chip active={s.reflections_to_agent === 'never'} onClick={() => void set({ reflections_to_agent: 'never' })}>
                    Never
                  </Chip>
                </Row>
                <Row label="How it works" hint="Big changes (goals, habits, people) always come to you first">
                  <Chip active={s.agent_autonomy === 'as_designed'} onClick={() => void set({ agent_autonomy: 'as_designed' })}>
                    Small things directly
                  </Chip>
                  <Chip active={s.agent_autonomy === 'propose_all'} onClick={() => void set({ agent_autonomy: 'propose_all' })}>
                    Ask me about everything
                  </Chip>
                </Row>
                <Row label="Quiet hours" hint="No scheduled visits in this time">
                  <TimeField value={s.quiet_start} onChange={(v) => void set({ quiet_start: v })} label="From" />
                  <span className="text-[13px] text-[var(--lo-muted)]">to</span>
                  <TimeField value={s.quiet_end} onChange={(v) => void set({ quiet_end: v })} label="To" />
                </Row>
              </Panel>
            </Section>

            <Section title="Calendar">
              <Calendar s={s} set={set} />
            </Section>

            <Section title="Your data">
              <Panel>
                <Row label="Everything as a file" hint="All your cards, habits, goals, people and pages, as JSON">
                  <Button variant="outline" icon={Download} loading={busy} onClick={() => void exportAll()}>
                    Export
                  </Button>
                </Row>
              </Panel>
            </Section>
          </>
        )}
      </PageBody>
    </div>
  );
}
