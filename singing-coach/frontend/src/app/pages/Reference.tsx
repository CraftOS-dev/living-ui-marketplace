/**
 * Reference: look anything up and hear it. A tuner and pitch pipe on the
 * Voice Dial with a drone, your range against the classical voice types and
 * their passaggi, every interval sung up and down, solfège with the Curwen
 * hand signs, the vowel chart sung by the guide voice, every vocalise in the
 * catalogue in your range, a tone lab for brightness and clarity (explore,
 * not a score), the singer's glossary, and how the app looks after your voice.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { BookA, CircleGauge, Ear, HeartPulse, Mic, Music, Play, Ruler, Search, Sparkles, Square, Stethoscope, Waves, Wind } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { VoiceMap } from '../components/charts.tsx';
import { VoiceDial } from '../components/practice/VoiceDial.tsx';
import type { DialHandle } from '../components/practice/VoiceDial.tsx';
import { Button, Empty, Field, Input, PageHeader, Panel, Segmented, Select, Spinner, Toggle, errMessage } from '../components/ui.tsx';
import { Figure } from '../learn/figures.tsx';
import { GLOSSARY, IPA_VOWELS } from '../learn/glossary.ts';
import type { Term } from '../learn/glossary.ts';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { ago } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { Voice } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import type { Vowel } from '../music/audio.ts';
import { noteLabel } from '../music/dial.ts';
import { specKey, startNotes } from '../music/generate.ts';
import type { VoiceRange } from '../music/generate.ts';
import { mic, micProblem } from '../music/mic.ts';
import type { MicStatus } from '../music/mic.ts';
import { heldPitch, midiToHz } from '../music/pitch.ts';
import { playSeq, stopSound } from '../music/play.ts';
import { VOWELS } from '../music/spec.ts';
import { ToneMeter, summarise } from '../music/tone.ts';
import type { ToneSample } from '../music/tone.ts';

type Tab = 'tuner' | 'voice' | 'intervals' | 'solfege' | 'vowels' | 'exercises' | 'tone' | 'terms' | 'health';
const TABS: { value: Tab; label: string; icon: LucideIcon }[] = [
  { value: 'tuner', label: 'Tuner', icon: CircleGauge },
  { value: 'voice', label: 'Voice types', icon: Mic },
  { value: 'intervals', label: 'Intervals', icon: Ruler },
  { value: 'solfege', label: 'Solfège', icon: Music },
  { value: 'vowels', label: 'Vowels', icon: Waves },
  { value: 'exercises', label: 'Vocalises', icon: Wind },
  { value: 'tone', label: 'Tone lab', icon: Sparkles },
  { value: 'terms', label: 'Glossary', icon: BookA },
  { value: 'health', label: 'Voice care', icon: HeartPulse },
];

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const BLACK = new Set([1, 3, 6, 8, 10]);

function useVoice(): Voice | null {
  return useApp().state?.voice ?? null;
}

function rangeOf(v: Voice | null): VoiceRange {
  return { comf_low: v?.comf_low ?? 55, comf_high: v?.comf_high ?? 70, passaggio: v?.passaggio ?? { primo: 62, secondo: 69, source: '' }, clef: v?.clef ?? 'treble' };
}

/** Sing one note with the guide voice (or the piano). */
function sound(midi: number, dur = 1.4, how: 'voice' | 'piano' = 'voice', vowel: Vowel = 'ah'): void {
  audio.ensure();
  const t = audio.now() + 0.03;
  if (how === 'piano') audio.play(midi, 84, t, dur);
  else audio.singNote(midi, t, dur, vowel);
}

export function ReferencePage(): React.JSX.Element {
  const { query } = useRoute();
  const tab = TABS.some((t) => t.value === query.get('tab')) ? (query.get('tab') as Tab) : 'tuner';
  return (
    <div className="sc-scroll h-full overflow-y-auto">
      <PageHeader title="Reference">
        <Segmented value={tab} onChange={(v) => navigate('reference', { tab: v === 'tuner' ? undefined : v })} options={TABS} label="Section" className="max-w-full overflow-x-auto" />
      </PageHeader>
      <div key={tab} className="sc-fade px-5 pb-10 pt-3 md:px-7">
        {tab === 'tuner' ? <Tuner /> : tab === 'voice' ? <VoiceTypes /> : tab === 'intervals' ? <Intervals /> : tab === 'solfege' ? <Solfege /> : tab === 'vowels' ? <Vowels /> : tab === 'exercises' ? <Exercises /> : tab === 'tone' ? <ToneLab /> : tab === 'terms' ? <Terms /> : <Care />}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- microphone */

function useMicOn(): { status: MicStatus; start: () => Promise<boolean> } {
  const app = useApp();
  const [status, setStatus] = useState<MicStatus>(mic.status);
  useEffect(() => mic.onStatus(setStatus), []);
  const start = async (): Promise<boolean> => {
    audio.ensure();
    const st = await mic.start(app.settings?.input_device ?? '');
    if (st !== 'on') toast.error(micProblem(st));
    return st === 'on';
  };
  return { status, start };
}

function MicButton({ status, start }: { status: MicStatus; start: () => Promise<boolean> }): React.JSX.Element {
  if (status === 'on')
    return (
      <span className="sc-label flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-[var(--sc-good)]" /> Listening
      </span>
    );
  return (
    <Button size="sm" icon={Mic} busy={status === 'starting'} onClick={() => void start()}>
      Turn on the microphone
    </Button>
  );
}

/* ------------------------------------------------------------------ tuner */

function Tuner(): React.JSX.Element {
  const v = useVoice();
  const dial = useRef<DialHandle | null>(null);
  const { status, start } = useMicOn();
  const [held, setHeld] = useState<{ midi: number; cents: number } | null>(null);
  const [how, setHow] = useState<'voice' | 'piano'>('voice');
  const [drone, setDrone] = useState<number | null>(null);
  const [droneNote, setDroneNote] = useState(0);
  const win = useRef<number[]>([]);
  const gap = useRef(0);

  useEffect(() => {
    const off = mic.onFrame((f) => {
      const t = performance.now();
      dial.current?.push({ at: t, voiced: f.voiced, midi: f.midi, db: f.db });
      if (!f.voiced) {
        // Short dropouts do not end a held note.
        if (++gap.current > 12) win.current = [];
        return;
      }
      gap.current = 0;
      win.current.push(f.midi);
      if (win.current.length > 48) win.current.shift();
      // Half a second held (vibrato averaged out): its centre is the note.
      const med = heldPitch(win.current);
      if (med !== null) setHeld({ midi: Math.round(med), cents: Math.round((med - Math.round(med)) * 100) });
    });
    let raf = 0;
    const tick = (t: number): void => {
      dial.current?.draw(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      off();
      cancelAnimationFrame(raf);
      audio.drone(null);
    };
  }, []);

  const lo = Math.floor(((v?.tested === true ? v.comf_low : 48) - 2) / 12) * 12;
  const hi = Math.ceil(((v?.tested === true ? v.comf_high : 76) + 2) / 12) * 12;
  const keys = Array.from({ length: hi - lo + 1 }, (_, i) => lo + i);
  const toggleDrone = (on: boolean): void => {
    audio.ensure();
    const tonic = 48 + droneNote;
    audio.drone(on ? tonic : null);
    setDrone(on ? tonic : null);
  };

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Tuner" className="lg:col-span-12" aside={<MicButton status={status} start={start} />} bodyClass="flex flex-col gap-3">
        <div className="rounded-[var(--sc-radius)] border border-[var(--sc-line)] bg-[var(--sc-panel)]">
          <VoiceDial ref={dial} height={250} mode="free" />
        </div>
        <div className="flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <span className="sc-label">Last held note</span>
          <span className="sc-mono sc-num text-[28px] font-light leading-none">{held === null ? '—' : noteLabel(held.midi)}</span>
          {held !== null && (
            <span className="sc-mono text-[13px] text-[var(--sc-muted)]">
              {held.cents === 0 ? 'centred' : `${held.cents > 0 ? '+' : '−'}${Math.abs(held.cents)}¢`} · {midiToHz(held.midi + held.cents / 100).toFixed(1)} Hz
            </span>
          )}
        </div>
        <p className="text-[12.5px] leading-5 text-[var(--sc-muted)]">Sing any note and hold it. The dial shows the note you are nearest and how far off its centre you are; the trail shows how steady it is.</p>
      </Panel>
      <div className="grid grid-cols-1 gap-3 lg:col-span-12 lg:grid-cols-12">
        <Panel label="Pitch pipe" className="lg:col-span-8" aside={<Segmented value={how} onChange={setHow} size="sm" label="Sound" options={[{ value: 'voice', label: 'Voice' }, { value: 'piano', label: 'Piano' }]} />}>
          <div className="flex flex-wrap gap-1">
            {keys.map((m) => {
              const inComf = v?.tested === true && m >= v.comf_low && m <= v.comf_high;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => sound(m, 1.6, how)}
                  className={cn('sc-focus h-9 min-w-[42px] rounded-[var(--sc-radius-sm)] border px-1.5 text-[12px] transition-colors', BLACK.has(m % 12) ? 'border-[var(--sc-line)] bg-[var(--sc-sunk)] text-[var(--sc-ink-2)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)] font-semibold', 'hover:border-[var(--sc-ink-2)]', held?.midi === m && 'border-[var(--sc-voice)] ring-1 ring-[var(--sc-voice)]')}
                  title={`${noteLabel(m)} · ${midiToHz(m).toFixed(1)} Hz${inComf ? ' · in your comfortable range' : ''}`}
                >
                  {noteLabel(m)}
                  {inComf && <span aria-hidden className="mx-auto mt-0.5 block h-[2px] w-3 rounded-full bg-[var(--sc-voice)] opacity-60" />}
                </button>
              );
            })}
          </div>
          {v?.tested === true && <p className="sc-label mt-2.5 normal-case tracking-normal">A dash marks your comfortable range.</p>}
        </Panel>
        <Panel label="Drone" className="lg:col-span-4" bodyClass="flex flex-wrap content-start items-center gap-3">
          <div className="w-[110px]">
            <Select
              value={String(droneNote)}
              onChange={(e) => {
                const n = Number(e.target.value);
                setDroneNote(n);
                if (drone !== null) {
                  audio.drone(48 + n);
                  setDrone(48 + n);
                }
              }}
              aria-label="Drone note"
            >
              {NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n}
                </option>
              ))}
            </Select>
          </div>
          <Toggle checked={drone !== null} onChange={toggleDrone} label="Drone on" />
          <p className="w-full text-[12.5px] leading-5 text-[var(--sc-muted)]">A tonic and fifth that keep sounding. Sing scales and intervals against it and listen for the beats to slow and stop as you tune.</p>
        </Panel>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------- voice types */

function VoiceTypes(): React.JSX.Element {
  const data = useLive(() => api.voice(), ['voice'], [], 200, 2000);
  const stats = useLive(() => api.voiceStats(), ['voice', 'runs', 'drills'], [], 300, 3000);
  if (data.data === null)
    return (
      <div className="flex h-60 items-center justify-center text-[var(--sc-muted)]">
        <Spinner />
      </div>
    );
  const { voice: v, typical, history, summary } = data.data;
  const lo = 36;
  const hi = 89;
  const x = (m: number): string => `${((m - lo) / (hi - lo)) * 100}%`;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Your voice" className="lg:col-span-4" bodyClass="flex flex-col gap-3">
        {v.tested ? (
          <>
            <div>
              <div className="sc-label">Comfortable range</div>
              <div className="sc-mono sc-num mt-1 text-[28px] font-light leading-none">
                {noteLabel(v.comf_low)}–{noteLabel(v.comf_high)}
              </div>
              <div className="sc-mono mt-1 text-[12px] text-[var(--sc-muted)]">
                Whole range {noteLabel(v.low)}–{noteLabel(v.high)} · {Math.round(v.high - v.low)} semitones
              </div>
            </div>
            <div>
              <div className="sc-label">Passaggi</div>
              <div className="mt-1 text-[13px]">
                <span className="sc-mono">{noteLabel(v.passaggio.primo)}</span> and <span className="sc-mono">{noteLabel(v.passaggio.secondo)}</span>
              </div>
              <div className="text-[12px] text-[var(--sc-muted)]">{v.passaggio.source}</div>
            </div>
            <p className="text-[12.5px] leading-5 text-[var(--sc-ink-2)]">{summary}</p>
            <p className="text-[12px] leading-5 text-[var(--sc-muted)]">Range alone does not make a voice type: weight, colour and where the voice turns over matter more, and they settle over years. The app uses your range to choose keys, never to label you.</p>
            <div className="sc-label normal-case tracking-normal">Measured {ago(v.created)}</div>
          </>
        ) : (
          <Empty icon={Mic} title="Range not measured yet" className="py-4">
            Two minutes of humming low and high.
          </Empty>
        )}
        <Button icon={Mic} onClick={() => navigate('settings', { section: 'voice' })}>
          {v.tested ? 'Measure again' : 'Find my range'}
        </Button>
      </Panel>
      <Panel label="Voice types" className="lg:col-span-8" aside={<span className="sc-label">Typical ranges · Miller's passaggi</span>}>
        <div className="flex flex-col gap-1">
          {typical.map((t) => {
            const mine = v.passaggio.closest === t.key;
            return (
              <div key={t.key} className={cn('grid grid-cols-[112px_1fr] items-center gap-3 rounded-[var(--sc-radius-sm)] px-1.5 py-2', mine && 'bg-[var(--sc-sunk)]')}>
                <span className="min-w-0">
                  <span className={cn('block truncate text-[13px]', mine && 'font-semibold')}>{t.title}</span>
                  <span className="sc-mono block text-[11px] text-[var(--sc-muted)]">
                    {noteLabel(t.lo)}–{noteLabel(t.hi)}
                  </span>
                </span>
                <span className="relative h-5">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--sc-line)]" />
                  {v.tested && <span className="absolute top-0 h-5 rounded-[3px] bg-[var(--sc-voice)] opacity-[0.12]" style={{ left: x(v.comf_low), width: `calc(${x(v.comf_high)} - ${x(v.comf_low)})` }} />}
                  <span className={cn('absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full', mine ? 'bg-[var(--sc-ink)]' : 'bg-[var(--sc-ink-2)] opacity-60')} style={{ left: x(t.lo), width: `calc(${x(t.hi)} - ${x(t.lo)})` }} />
                  {[t.primo, t.secondo].map((p) => (
                    <span key={p} className="absolute top-[3px] h-[14px] w-px bg-[var(--sc-ink)]" style={{ left: x(p) }} title={`Passaggio ${noteLabel(p)}`} />
                  ))}
                </span>
              </div>
            );
          })}
          <div className="grid grid-cols-[112px_1fr] gap-3 px-1.5">
            <span />
            <span className="relative h-4">
              {[36, 48, 60, 72, 84].map((m) => (
                <span key={m} className="sc-mono absolute -translate-x-1/2 text-[10px] text-[var(--sc-muted)]" style={{ left: x(m) }}>
                  {noteLabel(m)}
                </span>
              ))}
            </span>
          </div>
        </div>
        <p className="mt-2 text-[12px] leading-5 text-[var(--sc-muted)]">The shaded band is your comfortable range; the ticks on each line are that type's typical passaggi, where the voice changes gear.</p>
      </Panel>
      <Panel label="Range over time" className="lg:col-span-5">
        {history.length === 0 ? (
          <p className="text-[12.5px] text-[var(--sc-muted)]">Each range test lands here, so you can see the range grow.</p>
        ) : (
          <ul className="flex flex-col">
            {history.slice(0, 8).map((h) => (
              <li key={h.id} className="grid grid-cols-[84px_1fr_92px] items-center gap-3 border-b border-[var(--sc-hair)] py-2 last:border-b-0">
                <span className="sc-mono text-[11px] text-[var(--sc-muted)]">{h.created.slice(0, 10)}</span>
                <span className="relative h-3">
                  <span className="absolute inset-x-0 top-1/2 h-px bg-[var(--sc-line)]" />
                  <span className="absolute top-1/2 h-[2px] -translate-y-1/2 bg-[var(--sc-ink-2)]" style={{ left: x(h.low), width: `calc(${x(h.high)} - ${x(h.low)})` }} />
                  <span className="absolute top-1/2 h-[6px] -translate-y-1/2 rounded-full bg-[var(--sc-voice)] opacity-50" style={{ left: x(h.comf_low), width: `calc(${x(h.comf_high)} - ${x(h.comf_low)})` }} />
                </span>
                <span className="sc-mono text-right text-[11.5px]">
                  {noteLabel(h.low)}–{noteLabel(h.high)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
      <Panel label="Voice map · 30 days" className="lg:col-span-7" aside={<span className="sc-label">pitch × loudness</span>}>
        {stats.data === null ? (
          <div className="sc-skel h-[150px]" />
        ) : stats.data.map_30.length === 0 ? (
          <p className="text-[12.5px] text-[var(--sc-muted)]">Every note you sing lands here as a dot: across is pitch, up is loudness.</p>
        ) : (
          <VoiceMap cells={stats.data.map_30} comf={v.tested ? [v.comf_low, v.comf_high] : null} passaggio={v.tested ? [v.passaggio.primo, v.passaggio.secondo] : null} height={170} />
        )}
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------- intervals */

const IVS: { s: number; name: string; up: string; down: string }[] = [
  { s: 1, name: 'Minor second', up: 'Jaws theme', down: 'Für Elise (opening)' },
  { s: 2, name: 'Major second', up: 'Happy Birthday', down: 'Mary Had a Little Lamb' },
  { s: 3, name: 'Minor third', up: 'Greensleeves', down: 'Hey Jude' },
  { s: 4, name: 'Major third', up: 'When the Saints Go Marching In', down: 'Swing Low, Sweet Chariot' },
  { s: 5, name: 'Perfect fourth', up: 'Here Comes the Bride', down: "O Come, All Ye Faithful (“Come and behold Him”)" },
  { s: 6, name: 'Tritone', up: 'Maria (West Side Story)', down: 'Black Sabbath' },
  { s: 7, name: 'Perfect fifth', up: 'Twinkle, Twinkle, Little Star', down: 'The Flintstones' },
  { s: 8, name: 'Minor sixth', up: 'The Entertainer (the leap)', down: 'Love Story theme' },
  { s: 9, name: 'Major sixth', up: 'My Bonnie Lies over the Ocean', down: 'Nobody Knows the Trouble I’ve Seen' },
  { s: 10, name: 'Minor seventh', up: 'Somewhere (West Side Story)', down: 'An American in Paris' },
  { s: 11, name: 'Major seventh', up: 'Take On Me (chorus)', down: 'I Love You (Cole Porter)' },
  { s: 12, name: 'Octave', up: 'Somewhere over the Rainbow', down: 'Willow Weep for Me' },
];

function Intervals(): React.JSX.Element {
  const v = useVoice();
  const mid = v?.tested === true ? Math.round((v.comf_low + v.comf_high) / 2) - 6 : 57;
  const [base, setBase] = useState(mid);
  const choices = Array.from({ length: 19 }, (_, i) => mid - 9 + i);
  const play = (a: number, b: number, together = false): void => {
    void playSeq(together ? [[a, b]] : [a, b], { bpm: together ? 40 : 76, hold: together ? 2 : 1, voice: !together, vowel: 'ah' });
  };
  return (
    <Panel
      label="Intervals"
      aside={
        <div className="flex items-center gap-2">
          <span className="sc-label">From</span>
          <div className="w-[92px]">
            <Select value={String(base)} onChange={(e) => setBase(Number(e.target.value))} aria-label="From note">
              {choices.map((m) => (
                <option key={m} value={m}>
                  {noteLabel(m)}
                </option>
              ))}
            </Select>
          </div>
        </div>
      }
      bodyClass="px-0 pb-1"
    >
      <div className="sc-scroll overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead>
            <tr className="sc-label text-left">
              <th className="px-3.5 pb-2 font-medium">Interval</th>
              <th className="px-2 pb-2 font-medium">Semitones</th>
              <th className="px-2 pb-2 font-medium">Up</th>
              <th className="px-2 pb-2 font-medium">Sounds like, up</th>
              <th className="px-2 pb-2 font-medium">Sounds like, down</th>
              <th className="w-36 px-3.5 pb-2" />
            </tr>
          </thead>
          <tbody>
            {IVS.map((r) => (
              <tr key={r.s} className="border-t border-[var(--sc-hair)]">
                <td className="px-3.5 py-2 font-medium">{r.name}</td>
                <td className="sc-mono sc-num px-2 py-2 text-[var(--sc-ink-2)]">{r.s}</td>
                <td className="sc-mono px-2 py-2 text-[12px]">
                  {noteLabel(base)} – {noteLabel(base + r.s)}
                </td>
                <td className="px-2 py-2 text-[var(--sc-muted)]">{r.up}</td>
                <td className="px-2 py-2 text-[var(--sc-muted)]">{r.down}</td>
                <td className="px-3.5 py-1.5">
                  <span className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => play(base, base + r.s)} aria-label={`${r.name} up`}>
                      Up
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => play(base + r.s, base)} aria-label={`${r.name} down`}>
                      Down
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => play(base, base + r.s, true)} aria-label={`${r.name} together`}>
                      Both
                    </Button>
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-3 border-t border-[var(--sc-hair)] px-3.5 py-2.5">
        <span className="flex-1 text-[12.5px] text-[var(--sc-muted)]">Hearing them is half; singing them is the other half.</span>
        <Button size="sm" icon={Ear} onClick={() => navigate('train', { skill: 'int.sing' })}>
          Practise singing intervals
        </Button>
      </div>
    </Panel>
  );
}

/* ---------------------------------------------------------------- solfège */

const MAJOR = [0, 2, 4, 5, 7, 9, 11, 12];
const MOVABLE = ['do', 're', 'mi', 'fa', 'so', 'la', 'ti', 'do'];
const FIXED: Record<number, string> = { 0: 'do', 2: 're', 4: 'mi', 5: 'fa', 7: 'sol', 9: 'la', 11: 'si' };
const CHROMA_UP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'so', 'si', 'la', 'li', 'ti'];
const CHROMA_DOWN = ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'so', 'le', 'la', 'te', 'ti'];
const KEY_NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function Solfege(): React.JSX.Element {
  const app = useApp();
  const v = useVoice();
  const sys = app.settings?.syllables ?? 'movable';
  const [key, setKey] = useState(0);
  const low = v?.tested === true ? v.comf_low : 55;
  // The tonic in the comfortable range, low enough for the octave above.
  let tonic = 48 + key;
  while (tonic + 12 > (v?.tested === true ? v.comf_high : 72)) tonic -= 12;
  while (tonic < low) tonic += 12;
  const notes = MAJOR.map((s) => tonic + s);
  const label = (i: number, m: number): string => (sys === 'fixed' ? (FIXED[((m % 12) + 12) % 12] ?? '') : sys === 'numbers' ? String(i === 7 ? 1 : i + 1) : sys === 'letters' ? noteLabel(m, false) : MOVABLE[i]!);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel
        label="The major scale"
        className="lg:col-span-7"
        aside={
          <div className="w-[90px]">
            <Select value={String(key)} onChange={(e) => setKey(Number(e.target.value))} aria-label="Key">
              {KEY_NAMES.map((n, i) => (
                <option key={n} value={i}>
                  {n} major
                </option>
              ))}
            </Select>
          </div>
        }
        bodyClass="flex flex-col gap-3"
      >
        <div className="grid h-[104px] grid-cols-8 items-end gap-1.5">
          {notes.map((m, i) => (
            <button key={i} type="button" onClick={() => sound(m, 0.9)} className="sc-focus flex h-[62px] flex-col items-center justify-center gap-1 rounded-[var(--sc-radius-sm)] border border-[var(--sc-line)] bg-[var(--sc-raised)] transition-colors hover:bg-[var(--sc-hover)]" style={{ marginBottom: `${i * 6}px` }}>
              <span className="text-[15px] font-semibold">{label(i, m)}</span>
              <span className="sc-mono text-[10.5px] text-[var(--sc-muted)]">{noteLabel(m)}</span>
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" icon={Play} onClick={() => void playSeq([...notes, ...notes.slice(0, -1).reverse()], { bpm: 100, voice: true, vowel: 'ah' })}>
            Up and down
          </Button>
          <Button size="sm" variant="ghost" icon={Square} onClick={stopSound}>
            Stop
          </Button>
          <span className="sc-label ml-auto">
            {sys === 'fixed' ? 'Fixed do: do is always C' : sys === 'numbers' ? 'Scale numbers' : sys === 'letters' ? 'Letter names' : 'Movable do: do is the key note'} · change in Settings
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[520px] border-collapse text-[12.5px]">
            <tbody>
              <tr>
                <th className="sc-label py-1.5 pr-3 text-left font-medium">Raised</th>
                {CHROMA_UP.map((s, i) => (
                  <td key={i} className={cn('sc-mono px-1 py-1.5 text-center', BLACK.has(i) ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-muted)]')}>
                    {s}
                  </td>
                ))}
              </tr>
              <tr className="border-t border-[var(--sc-hair)]">
                <th className="sc-label py-1.5 pr-3 text-left font-medium">Lowered</th>
                {CHROMA_DOWN.map((s, i) => (
                  <td key={i} className={cn('sc-mono px-1 py-1.5 text-center', BLACK.has(i) ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-muted)]')}>
                    {s}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
        <p className="text-[12.5px] leading-5 text-[var(--sc-muted)]">
          Notes outside the scale change their vowel: raised to “i” going up (fi, si), lowered to “e” or “a” coming down (te, le, me, ra). In minor, {app.settings?.minor_do === 'do' ? 'do stays the key note (do-based minor), so the third is me' : 'la is the key note (la-based minor), so the scale runs la ti do re mi fa so la'}.
        </p>
      </Panel>
      <Panel label="Curwen hand signs" className="lg:col-span-5" bodyClass="flex flex-col gap-2">
        <Figure fig="hand-signs" className="w-full" />
        <p className="text-[12.5px] leading-5 text-[var(--sc-muted)]">Each sign is held a little higher than the one before, so the hand draws the pitch. Do is a fist, re a flat hand sloping up, mi a flat hand, fa a thumb pointing down, so the palm facing you, la a drooping hand, ti a finger pointing up.</p>
      </Panel>
    </div>
  );
}

/* ----------------------------------------------------------------- vowels */

function Vowels(): React.JSX.Element {
  const v = useVoice();
  const [on, setOn] = useState<string | null>(null);
  const note = v?.tested === true ? Math.round((v.comf_low * 2 + v.comf_high) / 3) : 57;
  const sing = (x: (typeof IPA_VOWELS)[number]): void => {
    audio.ensure();
    audio.singLine([{ midi: note, t: audio.now() + 0.03, d: 1.5 }], { formants: { f1: x.f1, f2: x.f2 }, vibrato: true });
    setOn(x.sym);
    window.setTimeout(() => setOn((s) => (s === x.sym ? null : s)), 1600);
  };
  const W = 460;
  const H = 320;
  const T = 48;
  const pos = (x: { front: number; close: number }): { cx: number; cy: number } => {
    const k = 0.4 * x.close;
    return { cx: 40 + (W - 80) * (k + x.front * (1 - k)), cy: T + (H - T - 30) * x.close };
  };
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Vowel chart" className="lg:col-span-6" aside={<span className="sc-label">Click a vowel to hear it on {noteLabel(note)}</span>}>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="The vowel chart">
          <polygon points={`40,${T} ${W - 40},${T} ${W - 40},${H - 30} ${40 + (W - 80) * 0.4},${H - 30}`} fill="none" stroke="var(--sc-line-2)" />
          {[1 / 3, 2 / 3].map((c) => {
            const k = 0.4 * c;
            const y = T + (H - T - 30) * c;
            return <line key={c} x1={40 + (W - 80) * k} x2={W - 40} y1={y} y2={y} stroke="var(--sc-hair)" strokeDasharray="3 4" />;
          })}
          <line x1={(40 + W - 40) / 2} x2={(40 + (W - 80) * 0.4 + W - 40) / 2} y1={T} y2={H - 30} stroke="var(--sc-hair)" strokeDasharray="3 4" />
          <text x={40} y={14} fontSize={10} fill="var(--sc-muted)" className="sc-mono">
            FRONT
          </text>
          <text x={W - 40} y={14} fontSize={10} fill="var(--sc-muted)" textAnchor="end" className="sc-mono">
            BACK
          </text>
          <text x={12} y={T} fontSize={10} fill="var(--sc-muted)" className="sc-mono" transform={`rotate(-90 12 ${T})`} textAnchor="end">
            CLOSE
          </text>
          <text x={12} y={H - 30} fontSize={10} fill="var(--sc-muted)" className="sc-mono" transform={`rotate(-90 12 ${H - 30})`} textAnchor="start">
            OPEN
          </text>
          {IPA_VOWELS.map((x) => {
            const p = pos(x);
            const active = on === x.sym;
            return (
              <g key={x.sym} role="button" tabIndex={0} aria-label={`${x.sym}, ${x.name}`} onClick={() => sing(x)} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && sing(x)} className="cursor-pointer">
                <circle cx={p.cx} cy={p.cy} r={active ? 15 : 13} fill={active ? 'var(--sc-voice)' : 'var(--sc-raised)'} stroke={active ? 'var(--sc-voice)' : 'var(--sc-line-2)'} style={{ transition: 'r 160ms, fill 160ms' }} />
                <text x={p.cx} y={p.cy + 5} textAnchor="middle" fontSize={15} fill={active ? 'var(--sc-page)' : 'var(--sc-ink)'} style={{ fontFamily: 'Georgia, serif' }}>
                  {x.sym}
                </text>
              </g>
            );
          })}
        </svg>
        <p className="mt-1 text-[12px] leading-5 text-[var(--sc-muted)]">Left to right is where the tongue is highest (front to back); top to bottom is how open the mouth is. Singers keep vowels pure and change them gently on high notes.</p>
      </Panel>
      <Panel label="The vowels" className="lg:col-span-6" bodyClass="px-0 pb-1">
        <ul>
          {IPA_VOWELS.map((x) => (
            <li key={x.sym}>
              <button type="button" onClick={() => sing(x)} className="sc-focus grid w-full grid-cols-[36px_1fr_auto] items-center gap-3 border-b border-[var(--sc-hair)] px-3.5 py-2 text-left transition-colors last:border-b-0 hover:bg-[var(--sc-hover)]">
                <span className="text-center text-[19px]" style={{ fontFamily: 'Georgia, serif' }}>
                  {x.sym}
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[13px]">{x.example}</span>
                  <span className="sc-label block truncate normal-case tracking-normal">{x.name}</span>
                </span>
                <span className="sc-mono text-[11px] text-[var(--sc-muted)]">
                  F1 {x.f1} · F2 {x.f2}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------- vocalises */

const VOWEL_LABEL: Record<string, string> = { a: '[a] ah', i: '[i] ee', u: '[u] oo', e: '[e] eh', o: '[o] oh', oo: 'oo', ah: 'ah', ee: 'ee', eh: 'eh', oh: 'oh', mm: 'hum (mm)', ng: 'ng', brr: 'lip trill', straw: 'straw', la: 'la', ma: 'ma', nay: 'nay', ya: 'ya', ha: 'ha', solfege: 'solfège' };

function Exercises(): React.JSX.Element {
  const app = useApp();
  const v = useVoice();
  const learn = useLive(() => api.learn(), ['lessons', 'skills'], [], 300, 5000);
  const [q, setQ] = useState('');
  const [pick, setPick] = useState('');
  const [vowel, setVowel] = useState('a');
  const [tempo, setTempo] = useState(0);
  const level = app.settings?.level ?? 1;
  const list = useMemo(() => {
    const ex = learn.data?.exercises ?? {};
    const needle = q.trim().toLowerCase();
    return Object.entries(ex)
      .filter(([k, e]) => needle === '' || e.title.toLowerCase().includes(needle) || k.includes(needle))
      .sort((a, b) => a[1].level - b[1].level || a[1].title.localeCompare(b[1].title));
  }, [learn.data, q]);
  const cur = list.find(([k]) => k === pick) ?? list[0];
  const range = rangeOf(v);
  const starts = cur !== undefined ? startNotes(cur[0], range, Math.max(level, cur[1].level), app.settings?.under18 === true) : [];
  const go = (mode?: string): void => {
    if (cur === undefined) return;
    navigate('practice', { gen: specKey({ k: 'vocalise', ex: cur[0], vowel, tempo: tempo > 0 ? tempo : undefined }), mode, back: 'reference?tab=exercises' });
  };
  if (learn.data === null)
    return (
      <div className="flex h-60 items-center justify-center text-[var(--sc-muted)]">
        <Spinner />
      </div>
    );
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label={`Catalogue · ${list.length}`} className="lg:col-span-5" bodyClass="flex flex-col gap-2">
        <div className="relative">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sc-muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-8" aria-label="Search vocalises" />
        </div>
        <ul className="sc-scroll max-h-[460px] overflow-y-auto">
          {list.map(([k, e]) => (
            <li key={k}>
              <button type="button" onClick={() => setPick(k)} className={cn('sc-focus flex w-full items-center gap-2.5 rounded-[var(--sc-radius-sm)] px-2 py-2 text-left text-[13px] transition-colors', cur?.[0] === k ? 'bg-[var(--sc-active)] font-medium' : 'hover:bg-[var(--sc-hover)]')}>
                <span className="sc-mono w-6 shrink-0 text-[11px] text-[var(--sc-muted)]">L{e.level}</span>
                <span className="min-w-0 flex-1 truncate">{e.title}</span>
                {e.level > level && <span className="sc-label">later</span>}
              </button>
            </li>
          ))}
        </ul>
      </Panel>
      <Panel label={cur?.[1].title ?? 'Vocalise'} className="lg:col-span-7" bodyClass="flex flex-col gap-4">
        {cur !== undefined && (
          <>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Sung on">
                <Select value={vowel} onChange={(e) => setVowel(e.target.value)}>
                  {VOWELS.map((x) => (
                    <option key={x} value={x}>
                      {VOWEL_LABEL[x] ?? x}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Tempo">
                <Select value={String(tempo)} onChange={(e) => setTempo(Number(e.target.value))}>
                  <option value="0">As written</option>
                  {[56, 63, 72, 80, 88, 96, 108, 120].map((t) => (
                    <option key={t} value={t}>
                      ♩ = {t}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <div>
              <div className="sc-label mb-1.5">Starting notes in your range</div>
              {starts.length === 0 ? (
                <p className="text-[12.5px] text-[var(--sc-muted)]">This pattern is wider than your comfortable range for now; it opens up as your range grows.</p>
              ) : (
                <div className="flex flex-wrap gap-1">
                  {starts.map((m, i) => (
                    <button key={i} type="button" onClick={() => sound(m, 0.8)} className="sc-focus sc-mono h-7 rounded-full border border-[var(--sc-line)] bg-[var(--sc-raised)] px-2.5 text-[11.5px] transition-colors hover:bg-[var(--sc-hover)]">
                      {noteLabel(m)}
                    </button>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[12px] leading-5 text-[var(--sc-muted)]">Up a semitone each time to just below your comfortable top{level <= 3 ? ' (and not past your upper passaggio yet)' : ''}, then back down.</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" icon={Mic} onClick={() => go()} disabled={starts.length === 0}>
                Sing it
              </Button>
              <Button icon={Ear} onClick={() => go('listen')} disabled={starts.length === 0}>
                Listen first
              </Button>
            </div>
          </>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- tone lab */

interface Take {
  n: number;
  vowel: string;
  s: ToneSample;
}

function Thermo({ label, low, high, value, base, span }: { label: string; low: string; high: string; value: number | null; base: number | null; span: number }): React.JSX.Element {
  const pc = (x: number): number => Math.max(0, Math.min(100, 50 + ((x - (base ?? x)) / span) * 50));
  return (
    <div>
      <div className="flex items-baseline justify-between">
        <span className="text-[13px] font-medium">{label}</span>
        <span className="sc-mono text-[12px] text-[var(--sc-muted)]">{value === null || base === null ? '—' : `${value - base >= 0 ? '+' : '−'}${Math.abs(Math.round((value - base) * 10) / 10)} dB`}</span>
      </div>
      <div className="relative mt-1.5 h-3 rounded-full bg-[var(--sc-sunk)]">
        <span className="absolute top-[-3px] h-[18px] w-px bg-[var(--sc-ink-2)]" style={{ left: '50%' }} title="Your first take" />
        {value !== null && <span className="absolute top-1/2 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--sc-voice)] transition-[left] duration-150" style={{ left: `${pc(value)}%` }} />}
      </div>
      <div className="sc-label mt-1 flex justify-between normal-case tracking-normal">
        <span>{low}</span>
        <span>{high}</span>
      </div>
    </div>
  );
}

function ToneLab(): React.JSX.Element {
  const { status, start } = useMicOn();
  const meter = useRef<ToneMeter | null>(null);
  const [live, setLive] = useState<ToneSample | null>(null);
  const [rec, setRec] = useState(false);
  const [left, setLeft] = useState(0);
  const [takes, setTakes] = useState<Take[]>([]);
  const [vowel, setVowel] = useState('ah');
  const frames = useRef<ToneSample[]>([]);
  const recRef = useRef(false);
  const t0 = useRef(0);

  useEffect(() => {
    meter.current = new ToneMeter();
    let last = 0;
    const off = mic.onFrame((f) => {
      const m = meter.current;
      if (m === null || !f.voiced) return;
      if (!m.open()) return;
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const s = m.read(f.hz);
      if (s === null) return;
      setLive(s);
      if (recRef.current) {
        if (t0.current === 0) t0.current = now;
        frames.current.push(s);
        const remain = Math.max(0, 3000 - (now - t0.current));
        setLeft(remain);
        if (remain === 0) {
          recRef.current = false;
          setRec(false);
          const sum = summarise(frames.current);
          if (sum === null) toast.info('Not enough steady voice; hold the vowel for three seconds.');
          else setTakes((ts) => [...ts, { n: ts.length + 1, vowel, s: sum }]);
        }
      }
    });
    return () => {
      off();
      meter.current?.close();
      meter.current = null;
    };
  }, [vowel]);

  const take = async (): Promise<void> => {
    if (status !== 'on' && !(await start())) return;
    frames.current = [];
    t0.current = 0;
    setLeft(3000);
    recRef.current = true;
    setRec(true);
  };
  const base = takes[0]?.s ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Tone lab" className="lg:col-span-7" aside={<span className="sc-label">Explore, not a score</span>} bodyClass="flex flex-col gap-4">
        <p className="text-[13px] leading-5 text-[var(--sc-ink-2)]">Hold a vowel for three seconds. The first take is your reference; each later take shows how its tone moved from it. Try a brighter “ee”, a darker “oh”, more or less air, a nasal “ng” before the vowel, and listen to what changes.</p>
        <Thermo label="Brightness" low="darker" high="brighter, more ring" value={live?.spr ?? null} base={base?.spr ?? live?.spr ?? null} span={12} />
        <Thermo label="Clarity" low="breathier" high="clearer" value={live?.cpp ?? null} base={base?.cpp ?? live?.cpp ?? null} span={8} />
        <div className="flex flex-wrap items-center gap-2">
          <div className="w-[120px]">
            <Select value={vowel} onChange={(e) => setVowel(e.target.value)} aria-label="Vowel" disabled={rec}>
              {['ah', 'ee', 'oo', 'eh', 'oh', 'ng-ah', 'other'].map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </Select>
          </div>
          <Button variant="primary" icon={Mic} busy={status === 'starting'} disabled={rec} onClick={() => void take()}>
            {rec ? `Hold it… ${Math.ceil(left / 1000)}` : takes.length === 0 ? 'Record the reference' : 'Record a take'}
          </Button>
          {takes.length > 0 && (
            <Button variant="ghost" onClick={() => setTakes([])} disabled={rec}>
              Start again
            </Button>
          )}
        </div>
        <p className="text-[12px] leading-5 text-[var(--sc-muted)]">Both measures change with the microphone, the room and how far away you are, so they only compare takes of this sitting. They are never saved and never graded: a darker or breathier sound is often exactly what a song wants.</p>
      </Panel>
      <Panel label="Takes" className="lg:col-span-5">
        {takes.length === 0 ? (
          <Empty icon={Sparkles} title="No takes yet" className="py-6">
            Record a reference, then try changes against it.
          </Empty>
        ) : (
          <table className="w-full border-collapse text-[12.5px]">
            <thead>
              <tr className="sc-label text-left">
                <th className="pb-1.5 font-medium">#</th>
                <th className="pb-1.5 font-medium">Vowel</th>
                <th className="pb-1.5 text-right font-medium">Brightness</th>
                <th className="pb-1.5 text-right font-medium">Clarity</th>
              </tr>
            </thead>
            <tbody>
              {takes.map((t) => (
                <tr key={t.n} className="border-t border-[var(--sc-hair)]">
                  <td className="sc-mono py-1.5">{t.n}</td>
                  <td className="py-1.5">{t.n === 1 ? `${t.vowel} · reference` : t.vowel}</td>
                  <td className="sc-mono py-1.5 text-right">{base === null || t.n === 1 ? '0' : `${t.s.spr - base.spr >= 0 ? '+' : '−'}${Math.abs(Math.round((t.s.spr - base.spr) * 10) / 10)}`} dB</td>
                  <td className="sc-mono py-1.5 text-right">{base === null || t.n === 1 ? '0' : `${t.s.cpp - base.cpp >= 0 ? '+' : '−'}${Math.abs(Math.round((t.s.cpp - base.cpp) * 10) / 10)}`} dB</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* --------------------------------------------------------------- glossary */

const CATS: { value: Term['cat'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'voice', label: 'Voice' },
  { value: 'breath', label: 'Breath' },
  { value: 'tone', label: 'Tone' },
  { value: 'pitch', label: 'Pitch' },
  { value: 'rhythm', label: 'Rhythm' },
  { value: 'reading', label: 'Reading' },
  { value: 'theory', label: 'Theory' },
  { value: 'expression', label: 'Expression' },
  { value: 'italian', label: 'On the page' },
  { value: 'style', label: 'Styles' },
  { value: 'diction', label: 'Diction' },
  { value: 'health', label: 'Voice care' },
];

function Terms(): React.JSX.Element {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Term['cat'] | 'all'>('all');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GLOSSARY.filter((t) => (cat === 'all' || t.cat === cat) && (needle === '' || t.term.toLowerCase().includes(needle) || t.def.toLowerCase().includes(needle) || (t.alt ?? '').toLowerCase().includes(needle))).sort((a, b) => a.term.localeCompare(b.term));
  }, [q, cat]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--sc-muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-8" aria-label="Search terms" />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button key={c.value} type="button" onClick={() => setCat(c.value)} className={cn('sc-focus h-7 rounded-full border px-3 text-[12px] transition-colors', cat === c.value ? 'border-[var(--sc-ink)] bg-[var(--sc-ink)] font-semibold text-[var(--sc-page)]' : 'border-[var(--sc-line)] bg-[var(--sc-raised)] hover:bg-[var(--sc-hover)]')}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="sc-mono sc-num ml-auto text-[11px] text-[var(--sc-muted)]">{list.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <div key={t.term} className="flex items-baseline gap-3 border-b border-[var(--sc-hair)] px-1 py-2.5">
            <span className="w-[38%] shrink-0">
              <span className="text-[13.5px] font-semibold">{t.term}</span>
              {t.alt !== undefined && <span className="mt-0.5 block text-[11.5px] text-[var(--sc-muted)]">{t.alt}</span>}
            </span>
            <span className="text-[13px] leading-5 text-[var(--sc-ink-2)]">{t.def}</span>
          </div>
        ))}
      </div>
      {list.length === 0 && <Empty icon={BookA} title="Nothing matches" className="py-10" />}
    </div>
  );
}

/* ------------------------------------------------------------- voice care */

const SIGNS = ['A hoarse, raspy or breathy voice that lasts', 'Losing your high notes, or a voice that suddenly sits lower', 'A raw, achy or strained throat after singing or talking', 'Speaking or singing takes more effort than it used to', 'Clearing your throat often, or a feeling of something stuck', 'Pain when you sing or swallow'];

const RULES: { title: string; text: string }[] = [
  { title: 'Warm up first, cool down last', text: 'Every plan starts with at least five minutes of gentle semi-occluded work (straw, lip trills, hums) and ends with a few minutes of easy descending slides.' },
  { title: 'A session cap that grows with you', text: 'Twenty minutes of practice a sitting at the start, thirty from level 4, an hour from level 7. Longer plans split into two sittings an hour apart.' },
  { title: 'Voice load, counted', text: 'The app counts the minutes you actually make sound and the vibrations of your folds, day by day, and compares each day with your usual.' },
  { title: 'A light day after a heavy one', text: 'After a day well over your usual load, after you stopped because it hurt, or when your voice check is poor, the plan is gentle work only: straws, lip trills, listening and theory. Tiredness can show a day or two later.' },
  { title: 'A rest day each week', text: 'Your chosen rest day, or after six days of singing in a row. Lessons and theory are fine; the voice rests.' },
  { title: 'Build up slowly', text: 'If this week is more than 1.3 times your usual load, the app says so and keeps the plan modest.' },
  { title: 'Stop when it hurts', text: 'The Stop button on the practice screen ends the session, marks it, and makes tomorrow gentle.' },
  { title: 'Hoarse for four weeks: see someone', text: 'If your check-ins show hoarseness for four weeks, the app asks you to see an ENT doctor (laryngologist) or a speech-language pathologist, and sooner if you use your voice for work, smoke, notice a lump in the neck or trouble breathing, or had recent surgery or a breathing tube.' },
];

const HABITS = ['Drink water through the day; the folds are kept moist from the inside, slowly.', 'Breathe steam (a hot shower or a bowl of hot water) when the air is dry.', 'Sleep: a tired body makes a tired voice.', 'Rest the voice after a heavy day, and do not whisper to save it: whispering can strain it more than soft speech.', 'Talk at a comfortable pitch and loudness; get closer rather than shouting over noise.', 'Warm up before you sing and cool down after.', 'When you are ill, sing less or not at all, and come back gently.'];

function Care(): React.JSX.Element {
  const app = useApp();
  const h = app.state?.health ?? null;
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="How the app looks after your voice" className="lg:col-span-7">
        <ol className="flex flex-col">
          {RULES.map((r, i) => (
            <li key={r.title} className="flex gap-3 border-b border-[var(--sc-hair)] py-2.5 last:border-b-0">
              <span className="sc-mono w-5 shrink-0 pt-0.5 text-[11px] text-[var(--sc-faint)]">{String(i + 1).padStart(2, '0')}</span>
              <span>
                <span className="block text-[13.5px] font-medium">{r.title}</span>
                <span className="block text-[12.5px] leading-5 text-[var(--sc-ink-2)]">{r.text}</span>
              </span>
            </li>
          ))}
        </ol>
        <p className="mt-2 text-[12px] leading-5 text-[var(--sc-muted)]">No study sets a safe daily amount of singing; these numbers are cautious defaults, and the coach cannot override them.</p>
      </Panel>
      <div className="flex flex-col gap-3 lg:col-span-5">
        <Panel label="Warning signs" aside={<Stethoscope size={14} aria-hidden className="text-[var(--sc-muted)]" />}>
          <ul className="flex flex-col gap-1.5">
            {SIGNS.map((s) => (
              <li key={s} className="flex gap-2 text-[13px] leading-5">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--sc-ink-2)]" />
                {s}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-[12.5px] leading-5 text-[var(--sc-ink-2)]">If any of these lasts more than a couple of weeks, or comes with pain, rest your voice and see an ENT doctor or a speech-language pathologist. The app can track and remind; it cannot diagnose, and nothing here is medical advice.</p>
        </Panel>
        <Panel label="Everyday habits">
          <ul className="flex flex-col gap-1.5">
            {HABITS.map((s) => (
              <li key={s} className="flex gap-2 text-[13px] leading-5">
                <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[var(--sc-ink-2)]" />
                {s}
              </li>
            ))}
          </ul>
        </Panel>
        <Panel label="Today" bodyClass="flex flex-col gap-2">
          {h === null ? (
            <Spinner />
          ) : (
            <>
              <div className="sc-mono text-[13px]">
                {Math.round(h.load.today_min)} of {h.load.cap_min} voiced minutes · {h.rest ? 'rest day' : h.light ? 'light day' : 'normal day'}
              </div>
              {h.flags.length > 0 ? h.flags.map((f) => <p key={f.key} className="text-[12.5px] leading-5 text-[var(--sc-ink-2)]">{f.text}</p>) : <p className="text-[12.5px] text-[var(--sc-muted)]">Nothing to watch today.</p>}
              <Button size="sm" icon={HeartPulse} onClick={() => navigate('settings', { section: 'health' })} className="self-start">
                Voice care settings
              </Button>
            </>
          )}
        </Panel>
      </div>
    </div>
  );
}

void errMessage;
