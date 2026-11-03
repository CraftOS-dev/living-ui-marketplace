/**
 * Settings in seven parts: the voice and its range, the microphone and the
 * timing, the sound, practice and feedback (with the coaching rules the app
 * judges by), voice care, the coach, and your data. `?section=` scrolls to
 * one part (other pages link here).
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Drum, Mic, Music2, Trash2, Volume2, Wind } from 'lucide-react';
import { cn, toast } from '../../kit/index.ts';
import { CheckInDialog } from '../components/CheckIn.tsx';
import { LevelSelect } from '../components/library/AddSong.tsx';
import { Button, Input, PageHeader, Panel, Row, Segmented, Select, Spinner, Toggle, errMessage, useConfirm } from '../components/ui.tsx';
import { MicStep, RangeTest, TimingStep } from '../components/VoiceSetup.tsx';
import { api } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { levelName } from '../lib/format.ts';
import { useLive } from '../lib/live.ts';
import { useRoute } from '../lib/router.ts';
import type { Settings } from '../lib/types.ts';
import { audio } from '../music/audio.ts';
import { noteLabel } from '../music/dial.ts';
import { mic, micProblem } from '../music/mic.ts';
import { toUltraStar } from '../music/musicxml.ts';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function levelCap(level: number, under18: boolean): number {
  return under18 || level <= 3 ? 20 : level <= 6 ? 30 : 60;
}

function download(name: string, text: string, type = 'text/plain'): void {
  const url = URL.createObjectURL(new Blob([text], { type: `${type};charset=utf-8` }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function fileName(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 80) || 'song';
}

export function SettingsPage(): React.JSX.Element {
  const app = useApp();
  const { query } = useRoute();
  const s = app.settings;
  const [name, setName] = useState(s?.name ?? '');
  const section = query.get('section');
  const [retest, setRetest] = useState(section === 'voice');
  useEffect(() => setName(s?.name ?? ''), [s?.name]);
  useEffect(() => {
    if (section === null || s === null) return;
    const t = window.setTimeout(() => document.getElementById(`settings-${section}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
    return () => window.clearTimeout(t);
    // Scroll once the page is there.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section, s === null]);
  if (s === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--sc-muted)]">
        <Spinner size={18} />
      </div>
    );
  const v = app.state?.voice ?? null;
  const save = (p: Partial<Settings>): void => app.save(p);
  return (
    <div className="sc-scroll h-full overflow-y-auto">
      <PageHeader title="Settings" />
      <div className="grid grid-cols-1 gap-3 px-5 pb-10 pt-3 md:px-7 xl:grid-cols-2">
        <section id="settings-voice" className="scroll-mt-4 xl:col-span-2">
          <Panel index="01" label="Voice and range" bodyClass="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_1.2fr]">
            <div className="flex flex-col divide-y divide-[var(--sc-hair)]">
              <div className="pb-3">
                {v?.tested === true ? (
                  <>
                    <div className="sc-label">Comfortable range</div>
                    <div className="sc-mono sc-num mt-1 text-[26px] font-light leading-none">
                      {noteLabel(v.comf_low)}–{noteLabel(v.comf_high)}
                    </div>
                    <div className="mt-1 text-[12px] text-[var(--sc-muted)]">
                      Whole range {noteLabel(v.low)}–{noteLabel(v.high)} · passaggi {noteLabel(v.passaggio.primo)} and {noteLabel(v.passaggio.secondo)} ({v.passaggio.source})
                    </div>
                  </>
                ) : (
                  <p className="text-[13px] text-[var(--sc-ink-2)]">Your range is not measured yet. Until it is, songs and exercises sit in a middle range that suits most voices.</p>
                )}
              </div>
              <Row label="Clef" hint="How your part is written on the sheet">
                <Segmented
                  value={s.clef}
                  onChange={(c) => save({ clef: c })}
                  options={[
                    { value: 'auto', label: 'Auto' },
                    { value: 'treble', label: 'Treble' },
                    { value: 'treble8', label: 'Tenor (8vb)' },
                    { value: 'bass', label: 'Bass' },
                  ]}
                  label="Clef"
                  size="sm"
                />
              </Row>
              <Row label="Young singer (under 18)" hint="Shorter sessions, no work past the upper passaggio, gentler range growth">
                <Toggle checked={s.under18} onChange={(x) => save({ under18: x })} label="Young singer" />
              </Row>
            </div>
            <div>
              {retest ? (
                <RangeTest
                  kind="full"
                  onSaved={() => {
                    toast.success('Range saved; songs and exercises now fit it.');
                    setRetest(false);
                  }}
                />
              ) : (
                <div className="flex h-full flex-col items-start justify-center gap-2 rounded-[var(--sc-radius)] border border-dashed border-[var(--sc-line-2)] p-4">
                  <span className="text-[13px] font-medium">{v?.tested === true ? 'Measure your range again' : 'Find your range'}</span>
                  <span className="text-[12.5px] leading-5 text-[var(--sc-muted)]">Two minutes: slide down and hold your lowest clear note, then up to your highest easy one. Ranges grow; measure again every month or so.</span>
                  <Button icon={Mic} onClick={() => setRetest(true)}>
                    Start
                  </Button>
                </div>
              )}
            </div>
          </Panel>
        </section>

        <section id="settings-mic" className="scroll-mt-4 xl:col-span-2">
          <Panel index="02" label="Microphone and timing" bodyClass="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <MicStep />
            <TimingStep />
          </Panel>
        </section>

        <section id="settings-sound" className="scroll-mt-4">
          <Panel index="03" label="Sound" bodyClass="flex flex-col divide-y divide-[var(--sc-hair)]">
            <Row label="Guide" hint="What sings or plays the tune with you">
              <Segmented
                value={s.guide}
                onChange={(g) => save({ guide: g })}
                options={[
                  { value: 'voice', label: 'Voice' },
                  { value: 'piano', label: 'Piano' },
                  { value: 'start', label: 'Start note' },
                  { value: 'off', label: 'Off' },
                ]}
                label="Guide"
                size="sm"
              />
            </Row>
            <Row label="Guide voice sings on">
              <Segmented
                value={s.vowel}
                onChange={(x) => save({ vowel: x })}
                options={[
                  { value: 'oo', label: '“oo”' },
                  { value: 'ah', label: '“ah”' },
                ]}
                label="Vowel"
                size="sm"
              />
            </Row>
            <Row label="Everything">
              <Slider value={s.volume} onChange={(x) => save({ volume: x })} onTest={() => (audio.ensure(), audio.singNote(62, audio.now() + 0.03, 0.8, s.vowel))} label="Master volume" icon={<Volume2 size={14} aria-hidden />} />
            </Row>
            <Row label="Guide">
              <Slider value={s.guide_volume} onChange={(x) => save({ guide_volume: x })} onTest={() => (audio.ensure(), audio.singNote(64, audio.now() + 0.03, 0.8, s.vowel))} label="Guide volume" icon={<Mic size={14} aria-hidden />} />
            </Row>
            <Row label="Accompaniment">
              <Slider value={s.accomp_volume} onChange={(x) => save({ accomp_volume: x })} onTest={() => (audio.ensure(), [48, 55, 60, 64].forEach((m) => audio.play(m, 76, audio.now() + 0.03, 1)))} label="Accompaniment volume" icon={<Music2 size={14} aria-hidden />} />
            </Row>
            <Row label="Metronome">
              <Slider value={s.click_volume} onChange={(x) => save({ click_volume: x })} onTest={() => (audio.ensure(), audio.click(audio.now() + 0.03, true))} label="Metronome volume" icon={<Drum size={14} aria-hidden />} />
            </Row>
            <Row label="Drone under vocalises">
              <Toggle checked={s.drone} onChange={(x) => save({ drone: x })} label="Drone" />
            </Row>
            <Row label="Metronome on">
              <Toggle checked={s.metronome} onChange={(x) => save({ metronome: x })} label="Metronome" />
            </Row>
            <Row label="Count in">
              <Toggle checked={s.count_in} onChange={(x) => save({ count_in: x })} label="Count in" />
            </Row>
          </Panel>
        </section>

        <section id="settings-practice" className="scroll-mt-4">
          <Panel index="04" label="Practice and feedback" bodyClass="flex flex-col divide-y divide-[var(--sc-hair)]">
            <Row label="Minutes a day">
              <Segmented value={String(s.daily_minutes)} onChange={(x) => save({ daily_minutes: Number(x) })} options={['10', '15', '20', '30', '45', '60'].map((m) => ({ value: m, label: m }))} label="Minutes a day" size="sm" />
            </Row>
            <Row label="Strictness" hint={s.strictness === 'lenient' ? 'On pitch within ±35¢, close within ±75¢' : s.strictness === 'strict' ? 'On pitch within ±15¢, close within ±35¢' : 'On pitch within ±25¢, close within ±50¢'}>
              <Segmented
                value={s.strictness}
                onChange={(x) => save({ strictness: x })}
                options={[
                  { value: 'lenient', label: 'Easy' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'strict', label: 'Strict' },
                ]}
                label="Strictness"
                size="sm"
              />
            </Row>
            <Row label="Live feedback" hint={s.feedback === 'auto' ? 'Full while learning, fading as a section steadies, after the take once mastered' : s.feedback === 'full' ? 'Always on while you sing' : 'Only after each take'}>
              <Segmented
                value={s.feedback}
                onChange={(x) => save({ feedback: x })}
                options={[
                  { value: 'auto', label: 'Auto' },
                  { value: 'full', label: 'Always' },
                  { value: 'after', label: 'After' },
                ]}
                label="Feedback"
                size="sm"
              />
            </Row>
            <Row label="Syllables">
              <span className="w-[200px]">
                <Select value={s.syllables} onChange={(e) => save({ syllables: e.target.value as Settings['syllables'] })} aria-label="Syllables">
                  <option value="movable">Movable do</option>
                  <option value="fixed">Fixed do</option>
                  <option value="numbers">Numbers</option>
                  <option value="letters">Letter names</option>
                  <option value="neutral">Neutral (no syllables)</option>
                </Select>
              </span>
            </Row>
            {s.syllables === 'movable' && (
              <Row label="Minor keys">
                <Segmented
                  value={s.minor_do}
                  onChange={(x) => save({ minor_do: x })}
                  options={[
                    { value: 'la', label: 'La-based' },
                    { value: 'do', label: 'Do-based' },
                  ]}
                  label="Minor"
                  size="sm"
                />
              </Row>
            )}
            <Row label="Start with">
              <Segmented
                value={s.view}
                onChange={(x) => save({ view: x })}
                options={[
                  { value: 'lane', label: 'Pitch lane' },
                  { value: 'sheet', label: 'Sheet music' },
                ]}
                label="Start with"
                size="sm"
              />
            </Row>
            <Row label="My level" hint={levelName(s.level)}>
              <span className="w-[200px]">
                <LevelSelect value={s.level} onChange={(x) => save({ level: x })} />
              </span>
            </Row>
            <Rules />
          </Panel>
        </section>

        <section id="settings-health" className="scroll-mt-4">
          <Care s={s} save={save} />
        </section>

        <div className="flex flex-col gap-3">
          <section id="settings-coach" className="scroll-mt-4">
            <Panel index="06" label="Coach" bodyClass="flex flex-col divide-y divide-[var(--sc-hair)]">
              <Row label="Review each session" hint="A short note on what went well and what to do next">
                <Toggle checked={s.coach_reviews} onChange={(x) => save({ coach_reviews: x })} label="Review each session" />
              </Row>
              <Row label="Plan my next day" hint="The app's rules still check every plan">
                <Toggle checked={s.coach_plans} onChange={(x) => save({ coach_plans: x })} label="Plan my next day" />
              </Row>
              <Row label="My name">
                <Input value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name !== s.name && save({ name })} className="w-[200px]" placeholder="For the coach" />
              </Row>
              <Row label="Coach status">
                <span className={cn('sc-label flex items-center gap-1.5', app.state?.agent_active === true ? 'text-[var(--sc-ink-2)]' : '')}>
                  <span className={cn('size-1.5 rounded-full', app.state?.agent_active === true ? 'bg-[var(--sc-good)]' : 'bg-[var(--sc-line-2)]')} />
                  {app.state?.agent_active === true ? 'Connected' : 'Not connected yet'}
                  {(app.state?.pending ?? 0) > 0 ? ` · ${app.state?.pending} waiting` : ''}
                </span>
              </Row>
            </Panel>
          </section>
          <section id="settings-data" className="scroll-mt-4">
            <DataPanel />
          </section>
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
      <input type="range" min={0} max={100} value={v} onChange={(e) => setV(Number(e.target.value))} onPointerUp={() => onChange(v)} onKeyUp={() => onChange(v)} className="sc-range w-32" aria-label={label} />
      <span className="sc-mono w-8 text-right text-[12px] text-[var(--sc-muted)]">{v}</span>
      <button type="button" onClick={onTest} aria-label={`Test ${label.toLowerCase()}`} title="Test" className="sc-focus flex size-7 items-center justify-center rounded-[var(--sc-radius-sm)] text-[var(--sc-muted)] hover:bg-[var(--sc-hover)] hover:text-[var(--sc-ink)]">
        {icon}
      </button>
    </span>
  );
}

/* ------------------------------------------------------- coaching rules */

const RULES: [string, string, string][] = [
  ['A note’s pitch', 'The middle of the note: its first 120 ms (the attack) and last 50 ms are left out, and vibrato counts at its centre', 'Vibrato is heard at its mean pitch'],
  ['On, close, off', 'Normal: within ±25¢ on, ±50¢ close. Easy ±35/75¢, Strict ±15/35¢', '±50¢ is the usual line for “correct” in singing research; trained singers hold 15–20¢'],
  ['Octaves', 'Singing an octave away from the guide still counts (except in range and exact-note drills)', 'Voices differ by an octave; karaoke scoring folds octaves too'],
  ['A clean take', 'Normal: 90% of notes on or close, 65% on, 75% of starts in time, the whole section, in Sing or Solo', 'Design defaults, kept modest so practice stays encouraging'],
  ['Steady', 'Three clean takes in a day at full tempo, one of them in Solo', 'Spaced, varied practice holds better than one long go'],
  ['Mastered', 'A clean Solo take on a later day, cold; reviews follow after 2, 4, 8 … 64 days', 'Spaced retrieval'],
  ['Hold', 'How much a long note wanders, with vibrato filtered out', 'Separates drift from vibrato'],
  ['Solo', 'Without accompaniment, notes are judged against your own key, and the drift from where you started is reported', 'Pitch without a reference drifts for most singers'],
  ['Feedback fading', 'Full while learning, fading on steady sections, after the take once mastered', 'Constant feedback helps early and hinders retention later'],
];

function Rules(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <div className="py-2.5">
      <button type="button" onClick={() => setOpen((o) => !o)} className="sc-focus sc-label rounded-[var(--sc-radius-sm)] hover:text-[var(--sc-ink)]">
        {open ? 'Hide' : 'Show'} the coaching rules
      </button>
      {open && (
        <dl className="sc-fade mt-2 flex flex-col">
          {RULES.map(([k, rule, why]) => (
            <div key={k} className="border-b border-[var(--sc-hair)] py-2 last:border-b-0">
              <dt className="text-[12.5px] font-medium">{k}</dt>
              <dd className="text-[12.5px] leading-5 text-[var(--sc-ink-2)]">{rule}</dd>
              <dd className="text-[11.5px] leading-4 text-[var(--sc-muted)]">{why}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ voice care */

function Care({ s, save }: { s: Settings; save: (p: Partial<Settings>) => void }): React.JSX.Element {
  const cap = levelCap(s.level, s.under18);
  const [confirmEl, confirm] = useConfirm();
  const [deleting, setDeleting] = useState(false);
  const [sz, setSz] = useState<number | null>(null);
  const [checkin, setCheckin] = useState(false);
  const caps = [10, 15, 20, 30, 45, 60].filter((m) => m < cap);
  const forget = async (): Promise<void> => {
    if (!(await confirm('Every saved recording of your takes is deleted. Scores and pitch traces stay.', 'Delete all recordings?', 'Delete'))) return;
    setDeleting(true);
    api
      .forgetAudio()
      .then((r) => toast.success(r.deleted === 0 ? 'There were no recordings.' : `Deleted ${r.deleted} recording${r.deleted === 1 ? '' : 's'}.`))
      .catch((err: unknown) => toast.error(errMessage(err)))
      .finally(() => setDeleting(false));
  };
  return (
    <Panel index="05" label="Voice care" bodyClass="flex flex-col divide-y divide-[var(--sc-hair)]">
      <Row label="Voice check before singing" hint="Five quick questions; a poor day keeps the plan gentle">
        <Toggle checked={s.checkins} onChange={(x) => save({ checkins: x })} label="Voice check" />
      </Row>
      <Row label="Longest sitting" hint={`Your level allows up to ${cap} minutes; choose shorter if you like`}>
        <span className="w-[170px]">
          <Select value={String(s.session_cap > 0 && s.session_cap < cap ? s.session_cap : 0)} onChange={(e) => save({ session_cap: Number(e.target.value) })} aria-label="Longest sitting">
            <option value="0">{cap} minutes (level)</option>
            {caps.map((m) => (
              <option key={m} value={m}>
                {m} minutes
              </option>
            ))}
          </Select>
        </span>
      </Row>
      <Row label="Weekly rest day" hint="Lessons and theory only that day">
        <span className="w-[170px]">
          <Select value={String(s.rest_day)} onChange={(e) => save({ rest_day: Number(e.target.value) })} aria-label="Rest day">
            <option value="-1">After six days in a row</option>
            {DAYS.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Select>
        </span>
      </Row>
      <div className="py-3">
        <SzTest
          onResult={(r) => {
            setSz(r);
            setCheckin(true);
          }}
        />
      </div>
      <Row label="Keep recordings of takes" hint="Off: only scores and pitch traces are kept. Recordings stay on this computer's app.">
        <Toggle checked={s.keep_recordings} onChange={(x) => save({ keep_recordings: x })} label="Keep recordings" />
      </Row>
      <Row label="Recordings">
        <Button size="sm" variant="danger" icon={Trash2} busy={deleting} onClick={() => void forget()}>
          Delete all
        </Button>
      </Row>
      <CheckInDialog
        open={checkin}
        when="other"
        sz={sz}
        onClose={() => setCheckin(false)}
        onDone={(_c, advice) => {
          setCheckin(false);
          toast.info(advice);
        }}
      />
      {confirmEl}
    </Panel>
  );
}

/**
 * The s/z ratio: hold "sss" as long as you can, then "zzz". Breath alone
 * makes the s; the z needs the folds too. Around 1 is typical for adults;
 * well above 1.4, again and again, is worth showing a professional.
 */
function SzTest({ onResult }: { onResult: (ratio: number) => void }): React.JSX.Element {
  const [phase, setPhase] = useState<'idle' | 's' | 'z' | 'done'>('idle');
  const [secs, setSecs] = useState<{ s: number | null; z: number | null }>({ s: null, z: null });
  const [now, setNow] = useState(0);
  const run = useRef<{ start: number; last: number; quietSince: number } | null>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const app = useApp();

  useEffect(() => {
    if (phase !== 's' && phase !== 'z') return;
    const floor = Math.max(mic.noise, -75) + 12;
    const off = mic.onFrame((f) => {
      const t = performance.now();
      const loud = f.db > floor;
      const r = run.current;
      if (r === null) {
        if (loud) run.current = { start: t, last: t, quietSince: 0 };
        return;
      }
      if (loud) {
        r.last = t;
        r.quietSince = 0;
        setNow((t - r.start) / 1000);
      } else if (r.quietSince === 0) r.quietSince = t;
      else if (t - r.quietSince > 500) {
        const len = Math.round(((r.last - r.start) / 1000) * 10) / 10;
        run.current = null;
        setNow(0);
        if (len < 2) {
          toast.info('That was very short; take a full breath and hold it as long as is comfortable.');
          return;
        }
        if (phaseRef.current === 's') {
          setSecs((x) => ({ ...x, s: len }));
          setPhase('z');
        } else {
          setSecs((x) => ({ ...x, z: len }));
          setPhase('done');
        }
      }
    });
    return off;
  }, [phase]);

  const start = async (): Promise<void> => {
    if (mic.status !== 'on') {
      const st = await mic.start(app.settings?.input_device ?? '');
      if (st !== 'on') {
        toast.error(micProblem(st));
        return;
      }
    }
    run.current = null;
    setSecs({ s: null, z: null });
    setPhase('s');
  };
  const ratio = secs.s !== null && secs.z !== null && secs.z > 0 ? Math.round((secs.s / secs.z) * 100) / 100 : null;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <span className="min-w-0 flex-1">
          <span className="block text-[13px]">s/z test</span>
          <span className="block text-[12px] leading-4 text-[var(--sc-muted)]">Breathe in fully, hold “sss” as long as is comfortable; then the same on “zzz”.</span>
        </span>
        <Button size="sm" icon={Wind} onClick={() => void start()} disabled={phase === 's' || phase === 'z'}>
          {phase === 'idle' ? 'Start' : phase === 'done' ? 'Again' : 'Listening…'}
        </Button>
      </div>
      {phase !== 'idle' && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-[var(--sc-radius-sm)] bg-[var(--sc-sunk)] px-3 py-2 text-[12.5px]">
          <span className={cn(phase === 's' && 'font-semibold')}>
            s <span className="sc-mono">{phase === 's' && now > 0 ? `${now.toFixed(1)}s` : secs.s !== null ? `${secs.s}s` : '—'}</span>
          </span>
          <span className={cn(phase === 'z' && 'font-semibold')}>
            z <span className="sc-mono">{phase === 'z' && now > 0 ? `${now.toFixed(1)}s` : secs.z !== null ? `${secs.z}s` : '—'}</span>
          </span>
          {ratio !== null && (
            <>
              <span>
                ratio <span className="sc-mono font-semibold">{ratio}</span>
              </span>
              <span className="text-[var(--sc-muted)]">{ratio <= 1.4 ? 'In the usual range.' : 'Higher than usual. One reading means little; if it stays high with other signs, see a professional.'}</span>
              <Button size="sm" variant="ghost" onClick={() => onResult(ratio)}>
                Save with a voice check
              </Button>
            </>
          )}
          {(phase === 's' || phase === 'z') && <span className="text-[var(--sc-muted)]">{phase === 's' ? 'Now “sss”…' : 'Now “zzz”…'}</span>}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ data */

function DataPanel(): React.JSX.Element {
  const songs = useLive(() => api.songs({ preview: false }), ['songs'], [], 300, 5000);
  const [busy, setBusy] = useState<'' | 'abc' | 'us' | 'log'>('');
  const [pick, setPick] = useState('');
  const list = songs.data?.songs ?? [];
  const exportAbc = async (): Promise<void> => {
    setBusy('abc');
    try {
      const parts: string[] = [];
      let n = 1;
      for (const x of list) {
        const r = await api.song(x.id);
        const abc = (r.song.abc ?? '').trim();
        if (abc === '') continue;
        parts.push(abc.replace(/^X:\s*\d*/m, `X:${n}`));
        n += 1;
      }
      download('singing-coach-library.abc', parts.join('\n\n') + '\n');
      toast.success(`Exported ${parts.length} songs.`);
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const exportUltraStar = async (): Promise<void> => {
    const id = pick || list[0]?.id;
    if (id === undefined) return;
    setBusy('us');
    try {
      const r = await api.song(id);
      const parsed = await api.parse(r.song.abc ?? '');
      download(`${fileName(`${r.song.composer} - ${r.song.title}`)}.txt`, toUltraStar(parsed.model, r.song.title, r.song.composer));
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  const exportLog = async (): Promise<void> => {
    setBusy('log');
    try {
      const r = await api.sessions(500);
      const head = ['day', 'started', 'ended', 'minutes', 'voiced_minutes', 'takes', 'warm_up_minutes', 'cool_down_minutes', 'songs', 'stopped_for_pain', 'coach_review'];
      const cell = (v: string | number | boolean): string => {
        const t = String(v);
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
      };
      const rows = r.sessions.map((x) => [x.day, x.started, x.ended, x.minutes, x.voiced_min, x.runs, x.warmup_min, x.cooldown_min, x.songs.map((y) => y.title).join(' / '), x.pain, x.review].map(cell));
      download('singing-coach-sessions.csv', [head.join(','), ...rows.map((x) => x.join(','))].join('\n') + '\n', 'text/csv');
    } catch (err) {
      toast.error(errMessage(err));
    } finally {
      setBusy('');
    }
  };
  return (
    <Panel index="07" label="Your data" bodyClass="flex flex-col divide-y divide-[var(--sc-hair)]">
      <Row label="The whole library" hint="Every song as ABC notation with its words">
        <Button size="sm" icon={Download} busy={busy === 'abc'} disabled={list.length === 0} onClick={() => void exportAbc()}>
          ABC
        </Button>
      </Row>
      <Row label="One song for karaoke apps" hint="UltraStar format">
        <span className="flex items-center gap-2">
          <span className="w-[150px]">
            <Select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Song">
              {list.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </Select>
          </span>
          <Button size="sm" icon={Download} busy={busy === 'us'} disabled={list.length === 0} onClick={() => void exportUltraStar()}>
            .txt
          </Button>
        </span>
      </Row>
      <Row label="Practice log" hint="Every session: day, minutes, voiced minutes, takes">
        <Button size="sm" icon={Download} busy={busy === 'log'} onClick={() => void exportLog()}>
          CSV
        </Button>
      </Row>
    </Panel>
  );
}
