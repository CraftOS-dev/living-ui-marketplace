/**
 * Settings: how you play (and the latency of it), how practice runs, the
 * sound, and what the coach may do.
 */
import { useEffect, useRef, useState } from 'react';
import { Timer, Volume2 } from 'lucide-react';
import { InputCards, InputStatus } from '../components/InputSetup.tsx';
import { LevelSelect } from '../components/library/AddSong.tsx';
import { Button, Input, PageHeader, Panel, Row, Segmented, Spinner, Toggle } from '../components/ui.tsx';
import { useApp } from '../lib/context.tsx';
import { audio } from '../music/audio.ts';
import { input } from '../music/input.ts';

export function SettingsPage(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const [name, setName] = useState(s?.name ?? '');
  useEffect(() => setName(s?.name ?? ''), [s?.name]);
  if (s === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--pc-muted)]">
        <Spinner size={18} />
      </div>
    );
  const kind = s.input === '' ? 'screen' : s.input;
  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-3 px-5 pb-10 pt-3 md:px-7 xl:grid-cols-2">
        <Panel index="01" label="How you play" className="xl:col-span-2" bodyClass="flex flex-col gap-4">
          <InputCards value={kind} onChange={(v) => app.save({ input: v })} />
          <InputStatus kind={kind} device={s.midi_device} onDevice={(n) => app.save({ midi_device: n })} />
          <Latency value={s.latency_ms} onSave={(v) => app.save({ latency_ms: v })} />
        </Panel>

        <Panel index="02" label="Practice" bodyClass="flex flex-col divide-y divide-[var(--pc-hair)]">
          <Row label="Minutes a day">
            <Segmented value={String(s.daily_minutes)} onChange={(v) => app.save({ daily_minutes: Number(v) })} options={['10', '20', '30', '45', '60', '90'].map((m) => ({ value: m, label: m }))} label="Minutes a day" size="sm" />
          </Row>
          <Row label="Strictness" hint={s.strictness === 'lenient' ? 'Clean at 90%, ±220 ms' : s.strictness === 'strict' ? 'Clean at 98%, ±110 ms' : 'Clean at 95%, ±160 ms'}>
            <Segmented
              value={s.strictness}
              onChange={(v) => app.save({ strictness: v })}
              options={[
                { value: 'lenient', label: 'Easy' },
                { value: 'normal', label: 'Normal' },
                { value: 'strict', label: 'Strict' },
              ]}
              label="Strictness"
              size="sm"
            />
          </Row>
          <Row label="Count in">
            <Toggle checked={s.count_in} onChange={(v) => app.save({ count_in: v })} label="Count in" />
          </Row>
          <Row label="Metronome">
            <Toggle checked={s.metronome} onChange={(v) => app.save({ metronome: v })} label="Metronome" />
          </Row>
          <Row label="Other hand plays along">
            <Toggle checked={s.other_hand} onChange={(v) => app.save({ other_hand: v })} label="Other hand plays along" />
          </Row>
          <Row label="Note names on keys and notes">
            <Toggle checked={s.note_names} onChange={(v) => app.save({ note_names: v })} label="Note names" />
          </Row>
          <Row label="Start with">
            <Segmented
              value={s.view}
              onChange={(v) => app.save({ view: v })}
              options={[
                { value: 'roll', label: 'Falling notes' },
                { value: 'sheet', label: 'Sheet music' },
              ]}
              label="Start with"
              size="sm"
            />
          </Row>
        </Panel>

        <div className="flex flex-col gap-3">
          <Panel index="03" label="Sound" bodyClass="flex flex-col divide-y divide-[var(--pc-hair)]">
            <Row label="Piano">
              <Slider value={s.volume} onChange={(v) => app.save({ volume: v })} onTest={() => audio.play(60, 90, audio.now() + 0.02, 0.6)} label="Piano volume" icon={<Volume2 size={14} aria-hidden />} />
            </Row>
            <Row label="Metronome">
              <Slider value={s.click_volume} onChange={(v) => app.save({ click_volume: v })} onTest={() => audio.click(audio.now() + 0.02, true)} label="Metronome volume" icon={<Timer size={14} aria-hidden />} />
            </Row>
          </Panel>

          <Panel index="04" label="Coach" bodyClass="flex flex-col divide-y divide-[var(--pc-hair)]">
            <Row label="Review each session">
              <Toggle checked={s.coach_reviews} onChange={(v) => app.save({ coach_reviews: v })} label="Review each session" />
            </Row>
            <Row label="Plan my next day">
              <Toggle checked={s.coach_plans} onChange={(v) => app.save({ coach_plans: v })} label="Plan my next day" />
            </Row>
            <Row label="My level">
              <span className="w-[220px]">
                <LevelSelect value={s.level} onChange={(v) => app.save({ level: v })} />
              </span>
            </Row>
            <Row label="My name">
              <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.name && app.save({ name })} className="w-[220px]" placeholder="For the coach" />
            </Row>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Slider({ value, onChange, onTest, label, icon }: { value: number; onChange: (v: number) => void; onTest: () => void; label: string; icon: React.ReactNode }): React.JSX.Element {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return (
    <span className="flex items-center gap-3">
      <input type="range" min={0} max={100} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} className="pc-range w-36" aria-label={label} />
      <span className="pc-mono w-8 text-right text-[12px] text-[var(--pc-muted)]">{v}</span>
      <button type="button" onClick={onTest} aria-label={`Test ${label.toLowerCase()}`} title="Test" className="pc-focus flex size-7 items-center justify-center rounded-[var(--pc-radius-sm)] text-[var(--pc-muted)] hover:bg-[var(--pc-hover)] hover:text-[var(--pc-ink)]">
        {icon}
      </button>
    </span>
  );
}

/**
 * The delay between a sound and the key pressed with it, measured: eight
 * clicks, press any key with each from the third on; the median difference
 * is subtracted when playing is judged.
 */
function Latency({ value, onSave }: { value: number; onSave: (v: number) => void }): React.JSX.Element {
  const [state, setState] = useState<'idle' | 'running' | 'done'>('idle');
  const [beat, setBeat] = useState(-1);
  const [found, setFound] = useState<number | null>(null);
  const clicks = useRef<number[]>([]);
  const taps = useRef<number[]>([]);

  useEffect(() => {
    if (state !== 'running') return;
    const tap = (t: number): void => {
      taps.current.push(t);
    };
    const off = input.on((e) => e.on && tap(e.t));
    const key = (e: KeyboardEvent): void => {
      if (e.code === 'Space') {
        e.preventDefault();
        tap(e.timeStamp || performance.now());
      }
    };
    window.addEventListener('keydown', key);
    return () => {
      off();
      window.removeEventListener('keydown', key);
    };
  }, [state]);

  const start = (): void => {
    audio.ensure();
    const out = audio.outputLatency() * 1000;
    const now = performance.now();
    const ctx0 = audio.now();
    const gap = 600;
    clicks.current = [];
    taps.current = [];
    for (let i = 0; i < 8; i++) {
      const t = now + 700 + i * gap;
      clicks.current.push(t + out);
      audio.click(ctx0 + (t - now) / 1000, i % 4 === 0);
      window.setTimeout(() => setBeat(i), t + out - now);
    }
    setState('running');
    setFound(null);
    window.setTimeout(() => {
      const devs: number[] = [];
      for (const c of clicks.current.slice(2)) {
        let best: number | null = null;
        for (const t of taps.current) if (best === null || Math.abs(t - c) < Math.abs(best - c)) best = t;
        if (best !== null && Math.abs(best - c) < 300) devs.push(best - c);
      }
      devs.sort((a, b) => a - b);
      setFound(devs.length >= 3 ? Math.round(devs[Math.floor(devs.length / 2)] ?? 0) : null);
      setState('done');
      setBeat(-1);
    }, 700 + 8 * gap + 500);
  };

  return (
    <div className="flex flex-wrap items-center gap-3 border-t border-[var(--pc-hair)] pt-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px]">Latency</div>
        <div className="text-[12px] text-[var(--pc-muted)]">{state === 'running' ? 'Press any key with each click' : state === 'done' && found === null ? 'Not enough presses were heard; try again.' : `${Math.round(value)} ms`}</div>
      </div>
      {state === 'running' && (
        <span className="flex items-center gap-1">
          {Array.from({ length: 8 }, (_, i) => (
            <span key={i} className={i <= beat ? 'size-2 rounded-full bg-[var(--pc-ink)] transition-colors' : 'size-2 rounded-full bg-[var(--pc-line-2)] transition-colors'} />
          ))}
        </span>
      )}
      {state === 'done' && found !== null && (
        <>
          <span className="pc-mono text-[13px]">{found} ms</span>
          <Button size="sm" variant="primary" onClick={() => (onSave(found), setState('idle'))}>
            Use it
          </Button>
        </>
      )}
      <Button size="sm" onClick={start} disabled={state === 'running'}>
        {state === 'idle' ? 'Measure' : 'Again'}
      </Button>
    </div>
  );
}
