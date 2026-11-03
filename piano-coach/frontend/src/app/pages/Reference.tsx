/**
 * Reference: look anything up and hear it. Every chord in every key and
 * inversion, every scale with its fingering, the circle of fifths with each
 * key's signature and chords, the intervals, and the glossary of terms and
 * signs.
 */
import { useMemo, useState } from 'react';
import { BookA, CircleDot, Music, Ruler, Search, Waves } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Input, PageHeader, Panel, Segmented, Select } from '../components/ui.tsx';
import { navigate, useRoute } from '../lib/router.ts';
import * as T from '../music/theory.ts';
import type { Note } from '../music/theory.ts';
import { str } from '../learn/drills.ts';
import { GLOSSARY } from '../learn/glossary.ts';
import type { Term } from '../learn/glossary.ts';
import { MiniKeys, SoundButton, Staff } from '../learn/widgets.tsx';
import type { StaffItem } from '../learn/schema.ts';
import { playSeq } from '../music/play.ts';
import type { KeyMark } from '../learn/widgets.tsx';

type Tab = 'chords' | 'scales' | 'keys' | 'intervals' | 'terms';
const TABS: Tab[] = ['chords', 'scales', 'keys', 'intervals', 'terms'];
const ROOTS = ['C', 'C#', 'Db', 'D', 'Eb', 'E', 'F', 'F#', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
const pretty = (s: string): string => s.replace('#', '♯').replace(/([A-G])b/, '$1♭');

export function ReferencePage(): React.JSX.Element {
  const { query } = useRoute();
  const tab = (TABS as string[]).includes(query.get('tab') ?? '') ? (query.get('tab') as Tab) : 'chords';
  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Reference">
        <Segmented
          value={tab}
          onChange={(v) => navigate('reference', { tab: v === 'chords' ? undefined : v })}
          options={[
            { value: 'chords', label: 'Chords', icon: Music },
            { value: 'scales', label: 'Scales', icon: Waves },
            { value: 'keys', label: 'Keys', icon: CircleDot },
            { value: 'intervals', label: 'Intervals', icon: Ruler },
            { value: 'terms', label: 'Terms', icon: BookA },
          ]}
          label="Section"
          className="max-w-full overflow-x-auto"
        />
      </PageHeader>
      <div key={tab} className="pc-fade px-5 pb-10 pt-3 md:px-7">
        {tab === 'chords' ? <Chords /> : tab === 'scales' ? <Scales /> : tab === 'keys' ? <Keys /> : tab === 'intervals' ? <Intervals /> : <Terms />}
      </div>
    </div>
  );
}

/** Root buttons in one row. */
function RootPicker({ value, onChange, list = ROOTS }: { value: string; onChange: (v: string) => void; list?: string[] }): React.JSX.Element {
  return (
    <div className="flex flex-wrap gap-1">
      {list.map((r) => (
        <button key={r} type="button" onClick={() => onChange(r)} className={cn('pc-focus h-8 min-w-[38px] rounded-[var(--pc-radius-sm)] border px-2 text-[13px] font-semibold transition-colors', value === r ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] text-[var(--pc-page)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}>
          {pretty(r)}
        </button>
      ))}
    </div>
  );
}

function marksFor(notes: Note[], labels: (n: Note, i: number) => string, tone: KeyMark['tone'] = 'rh'): Map<number, KeyMark> {
  const m = new Map<number, KeyMark>();
  notes.forEach((n, i) => m.set(T.midiOf(n), { label: labels(n, i), tone }));
  return m;
}

/* ------------------------------------------------------------------ chords */

function Chords(): React.JSX.Element {
  const [root, setRoot] = useState('C');
  const [type, setType] = useState('maj');
  const [inv, setInv] = useState(0);
  const t = T.chordType(type);
  const rootNote = T.note(root + '4');
  const maxInv = t.ivs.length - 1;
  const i = Math.min(inv, maxInv);
  const notes = T.chord(rootNote, type, i);
  if (T.midiOf(notes[notes.length - 1]!) > 84) notes.forEach((n) => (n.o -= 1));
  const sym = T.chordSymbol(rootNote, type, i > 0 ? notes[0] : undefined);
  const lo = Math.floor(T.midiOf(notes[0]!) / 12) * 12;
  const hi = Math.max(lo + 23, Math.ceil((T.midiOf(notes[notes.length - 1]!) + 1) / 12) * 12 - 1);
  const families: { label: string; ids: string[] }[] = [
    { label: 'Triads', ids: ['maj', 'min', 'dim', 'aug', 'sus2', 'sus4'] },
    { label: 'Sixths & sevenths', ids: ['6', 'm6', '7', 'maj7', 'm7', 'mmaj7', 'm7b5', 'dim7', 'aug7', '7sus4'] },
    { label: 'Extended', ids: ['add9', '9', 'maj9', 'm9', '11', '13'] },
  ];
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Chord" className="lg:col-span-5">
        <div className="flex flex-col gap-4">
          <RootPicker value={root} onChange={setRoot} />
          {families.map((f) => (
            <div key={f.label}>
              <div className="pc-label mb-1.5">{f.label}</div>
              <div className="flex flex-wrap gap-1">
                {f.ids.map((id) => (
                  <button key={id} type="button" onClick={() => setType(id)} className={cn('pc-focus h-8 rounded-[var(--pc-radius-sm)] border px-2.5 text-[12.5px] transition-colors', type === id ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] font-semibold text-[var(--pc-page)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}>
                    {pretty(root)}
                    {T.chordType(id).symbol}
                  </button>
                ))}
              </div>
            </div>
          ))}
          <div>
            <div className="pc-label mb-1.5">Inversion</div>
            <Segmented value={String(i)} onChange={(v) => setInv(Number(v))} options={Array.from({ length: maxInv + 1 }, (_, k) => ({ value: String(k), label: k === 0 ? 'Root' : k === 1 ? '1st' : k === 2 ? '2nd' : '3rd' }))} label="Inversion" size="sm" />
          </div>
        </div>
      </Panel>
      <Panel label={t.name} className="lg:col-span-7" aside={<SoundButton sound={{ seq: [notes.map(str), ...notes.map(str), notes.map(str)], bpm: 120 }} size="sm" />}>
        <div className="flex flex-col items-center gap-4 pt-2">
          <div className="text-[40px] font-semibold tracking-[-0.02em]">{sym}</div>
          <Staff pic={{ clef: 'treble', items: [{ notes: notes.map(str) }] }} scale={1.5} />
          <MiniKeys from={lo} to={hi} marks={marksFor(notes, (n) => T.name(n, false))} height={120} />
          <div className="grid w-full grid-cols-2 gap-2 sm:grid-cols-4">
            {t.ivs.map((x, k) => {
              const n = T.transpose(rootNote, T.iv(x));
              return (
                <div key={x} className="rounded-[var(--pc-radius-sm)] bg-[var(--pc-sunk)] px-2.5 py-1.5">
                  <div className="pc-label text-[9.5px]">{k === 0 ? 'Root' : T.ivName(T.iv(x))}</div>
                  <div className="text-[15px] font-semibold">{T.name(n, false)}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ scales */

const SCALE_ORDER = ['major', 'nminor', 'hminor', 'mminor', 'pentmajor', 'pentminor', 'blues', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'wholetone'];

function Scales(): React.JSX.Element {
  const [tonic, setTonic] = useState('C');
  const [type, setType] = useState('major');
  const [hand, setHand] = useState<'R' | 'L'>('R');
  const t0 = T.note(tonic + '4');
  const notes = T.scale(t0, type);
  const fingers = T.scaleFingers(hand === 'R' ? t0 : { ...t0, o: 3 }, type, hand, notes.length);
  const steps = notes.slice(1).map((n, i) => T.midiOf(n) - T.midiOf(notes[i]!));
  const stepText = (s: number): string => (s === 1 ? 'H' : s === 2 ? 'W' : s === 3 ? 'W+H' : String(s));
  const shown = hand === 'R' ? notes : notes.map((n) => ({ ...n, o: n.o - 1 }));
  const lo = Math.floor(T.midiOf(shown[0]!) / 12) * 12;
  const hi = Math.max(lo + 23, Math.ceil((T.midiOf(shown[shown.length - 1]!) + 1) / 12) * 12 - 1);
  const k = type === 'major' || type === 'nminor' || type === 'hminor' || type === 'mminor' ? T.key(tonic, type === 'major' ? 'major' : 'minor') : null;
  const items: StaffItem[] = shown.map((n, i) => {
    const it: StaffItem = { notes: [str(n)], dur: 'q' };
    const f = fingers?.[i];
    if (f !== undefined) it.label = String(f);
    return it;
  });
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Scale" className="lg:col-span-5">
        <div className="flex flex-col gap-4">
          <RootPicker value={tonic} onChange={setTonic} />
          <div className="flex flex-wrap gap-1">
            {SCALE_ORDER.map((id) => (
              <button key={id} type="button" onClick={() => setType(id)} className={cn('pc-focus h-8 rounded-[var(--pc-radius-sm)] border px-2.5 text-[12.5px] transition-colors', type === id ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] font-semibold text-[var(--pc-page)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}>
                {T.SCALES[id]?.name}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <span className="pc-label">Fingering</span>
            <Segmented
              value={hand}
              onChange={setHand}
              options={[
                { value: 'R', label: 'Right' },
                { value: 'L', label: 'Left' },
              ]}
              label="Hand"
              size="sm"
            />
          </div>
        </div>
      </Panel>
      <Panel label={`${pretty(tonic)} ${T.SCALES[type]?.name.toLowerCase() ?? ''}`} className="lg:col-span-7" aside={<SoundButton sound={{ seq: [...shown.map(str), ...shown.slice(0, -1).reverse().map(str)], bpm: 200 }} size="sm" />}>
        <div className="flex flex-col items-center gap-4 pt-2">
          <Staff pic={{ clef: hand === 'R' ? 'treble' : 'bass', ...(k !== null ? { fifths: k.fifths } : {}), items }} scale={1.3} />
          <MiniKeys from={lo} to={hi} marks={marksFor(shown, (_n, i) => (fingers !== null ? String(fingers[i]) : ''), hand === 'R' ? 'rh' : 'lh')} height={120} />
          <div className="flex flex-wrap justify-center gap-1">
            {steps.map((s, i) => (
              <span key={i} className={cn('pc-mono rounded-[4px] px-1.5 py-0.5 text-[11px] font-semibold', s === 1 ? 'bg-[var(--pc-warn-soft)] text-[var(--pc-warn)]' : 'bg-[var(--pc-sunk)] text-[var(--pc-ink-2)]')}>
                {stepText(s)}
              </span>
            ))}
          </div>
          <div className="text-[13px] text-[var(--pc-ink-2)]">{notes.map((n) => T.name(n, false)).join('  ')}</div>
        </div>
      </Panel>
    </div>
  );
}

/* -------------------------------------------------------------------- keys */

const CIRCLE_MAJ = ['C', 'G', 'D', 'A', 'E', 'B', 'F#', 'Db', 'Ab', 'Eb', 'Bb', 'F'];
const CIRCLE_MIN = ['A', 'E', 'B', 'F#', 'C#', 'G#', 'D#', 'Bb', 'F', 'C', 'G', 'D'];
const CIRCLE_FIFTHS = [0, 1, 2, 3, 4, 5, 6, -5, -4, -3, -2, -1];

export function Circle({ value, onChange, size = 320 }: { value: number; onChange: (i: number) => void; size?: number }): React.JSX.Element {
  const c = size / 2;
  const R = c - 4;
  const r1 = R * 0.66;
  const r2 = R * 0.38;
  const wedge = (i: number, ro: number, ri: number): string => {
    const a0 = ((i - 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 0.5) / 12) * Math.PI * 2 - Math.PI / 2;
    const p = (a: number, rr: number): string => `${(c + Math.cos(a) * rr).toFixed(2)} ${(c + Math.sin(a) * rr).toFixed(2)}`;
    return `M ${p(a0, ro)} A ${ro} ${ro} 0 0 1 ${p(a1, ro)} L ${p(a1, ri)} A ${ri} ${ri} 0 0 0 ${p(a0, ri)} Z`;
  };
  const at = (i: number, rr: number): { x: number; y: number } => {
    const a = (i / 12) * Math.PI * 2 - Math.PI / 2;
    return { x: c + Math.cos(a) * rr, y: c + Math.sin(a) * rr };
  };
  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="w-full max-w-[360px]" role="listbox" aria-label="Circle of fifths">
      {CIRCLE_MAJ.map((k, i) => {
        const sel = value === i;
        const d = (i - value + 12) % 12;
        const near = d === 1 || d === 11;
        const outer = at(i, (R + r1) / 2);
        const inner = at(i, (r1 + r2) / 2);
        const f = CIRCLE_FIFTHS[i] ?? 0;
        return (
          <g key={k} role="option" aria-selected={sel} onClick={() => onChange(i)} className="cursor-pointer">
            <path d={wedge(i, R, r1)} fill={sel ? 'var(--pc-ink)' : near ? 'var(--pc-active)' : 'var(--pc-raised)'} stroke="var(--pc-line)" strokeWidth={1} className="transition-[fill] duration-200 hover:brightness-95" />
            <path d={wedge(i, r1, r2)} fill={sel ? 'var(--pc-ink-2)' : near ? 'var(--pc-hover)' : 'var(--pc-sunk)'} stroke="var(--pc-line)" strokeWidth={1} className="transition-[fill] duration-200" />
            <text x={outer.x} y={outer.y - 4} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.052} fontWeight={600} fill={sel ? 'var(--pc-page)' : 'var(--pc-ink)'} style={{ fontFamily: 'var(--pc-font)' }}>
              {pretty(k)}
            </text>
            <text x={outer.x} y={outer.y + size * 0.04} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.032} fill={sel ? 'var(--pc-page)' : 'var(--pc-muted)'} style={{ fontFamily: 'var(--pc-font)' }}>
              {f === 0 ? '' : f > 0 ? `${f}♯` : `${-f}♭`}
            </text>
            <text x={inner.x} y={inner.y} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.038} fontWeight={500} fill={sel ? 'var(--pc-page)' : 'var(--pc-ink-2)'} style={{ fontFamily: 'var(--pc-font)' }}>
              {pretty(CIRCLE_MIN[i] ?? '')}m
            </text>
          </g>
        );
      })}
      <circle cx={c} cy={c} r={r2 - 1} fill="var(--pc-panel)" stroke="var(--pc-line)" />
      <text x={c} y={c} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.045} fontWeight={600} fill="var(--pc-ink)" style={{ fontFamily: 'var(--pc-font)' }}>
        {pretty(CIRCLE_MAJ[value] ?? 'C')}
      </text>
    </svg>
  );
}

function Keys(): React.JSX.Element {
  const [i, setI] = useState(0);
  const [mode, setMode] = useState<'major' | 'minor'>('major');
  const f = CIRCLE_FIFTHS[i] ?? 0;
  const k = T.keyFromFifths(f, mode);
  const rel = T.relative(k);
  const chords = T.diatonic(k);
  const sevenths = T.diatonic(k, true);
  const sig = T.signature(f);
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
      <Panel label="Circle of fifths" className="lg:col-span-5">
        <div className="flex flex-col items-center gap-3 py-2">
          <Circle value={i} onChange={setI} />
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'major', label: 'Major' },
              { value: 'minor', label: 'Minor' },
            ]}
            label="Mode"
            size="sm"
          />
        </div>
      </Panel>
      <div className="flex flex-col gap-3 lg:col-span-7">
        <Panel label={T.keyName(k)} aside={<SoundButton sound={{ seq: T.scale(k.tonic, mode === 'major' ? 'major' : 'nminor').map(str), bpm: 180 }} size="sm" />}>
          <div className="flex flex-wrap items-center gap-6 pt-1">
            <Staff pic={{ clef: 'treble', fifths: f, items: [] }} scale={1.35} />
            <div className="flex flex-col gap-1.5 text-[13px]">
              <div>
                <span className="pc-label mr-2">Signature</span>
                {sig.length === 0 ? 'None' : sig.map((s) => s.letter + (s.a > 0 ? '♯' : '♭')).join(' ')}
              </div>
              <div>
                <span className="pc-label mr-2">Relative</span>
                {T.keyName(rel)}
              </div>
              <div>
                <span className="pc-label mr-2">Neighbours</span>
                {T.keyName(T.keyFromFifths(Math.max(-7, f - 1), mode))} · {T.keyName(T.keyFromFifths(Math.min(7, f + 1), mode))}
              </div>
            </div>
          </div>
        </Panel>
        <Panel label="Chords of the key">
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {chords.map((c, d) => {
              const s7 = sevenths[d]!;
              return (
                <div key={d} className="flex flex-col items-stretch gap-1">
                  <ChordChip roman={c.roman} sym={T.chordSymbol(c.root, c.type)} notes={c.notes} />
                  <ChordChip roman={s7.roman} sym={T.chordSymbol(s7.root, s7.type)} notes={s7.notes} quiet />
                </div>
              );
            })}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function ChordChip({ roman, sym, notes, quiet }: { roman: string; sym: string; notes: Note[]; quiet?: boolean }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={() => void playSeq([notes.map(str)], { bpm: 45 })}
      className={cn('pc-focus flex flex-col items-center rounded-[var(--pc-radius-sm)] border px-1 py-1.5 transition-colors hover:bg-[var(--pc-hover)] active:scale-[0.98]', quiet === true ? 'border-[var(--pc-hair)] bg-transparent' : 'border-[var(--pc-line)] bg-[var(--pc-raised)]')}
    >
      <span className={cn('pc-mono text-[10.5px]', quiet === true ? 'text-[var(--pc-faint)]' : 'text-[var(--pc-muted)]')}>{roman}</span>
      <span className={cn('font-semibold', quiet === true ? 'text-[12px] text-[var(--pc-ink-2)]' : 'text-[14px]')}>{sym}</span>
    </button>
  );
}

/* --------------------------------------------------------------- intervals */

const IV_SONGS: Record<string, string> = {
  m2: 'Jaws',
  M2: 'Happy Birthday',
  m3: 'Greensleeves',
  M3: 'Oh When the Saints',
  P4: 'Here Comes the Bride',
  A4: 'Maria (West Side Story)',
  P5: 'Twinkle Twinkle',
  m6: 'The Entertainer (opening leap)',
  M6: 'My Bonnie',
  m7: 'Somewhere (West Side Story)',
  M7: 'Take On Me (chorus)',
  P8: 'Somewhere Over the Rainbow',
};

function Intervals(): React.JSX.Element {
  const [lowName, setLow] = useState('C');
  const low = T.note(lowName + '4');
  const rows = ['m2', 'M2', 'm3', 'M3', 'P4', 'A4', 'P5', 'm6', 'M6', 'm7', 'M7', 'P8'];
  const inv: Record<string, string> = { m2: 'M7', M2: 'm7', m3: 'M6', M3: 'm6', P4: 'P5', A4: 'd5', P5: 'P4', m6: 'M3', M6: 'm3', m7: 'M2', M7: 'm2', P8: 'P1' };
  return (
    <Panel label="Intervals" aside={<div className="w-[86px]"><Select value={lowName} onChange={(e) => setLow(e.target.value)} aria-label="From">{['C', 'D', 'E', 'F', 'G', 'A', 'B', 'Bb', 'Eb', 'F#'].map((r) => <option key={r} value={r}>{pretty(r)}</option>)}</Select></div>} bodyClass="px-0 pb-1">
      <div className="pc-scroll overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[13px]">
          <thead>
            <tr className="pc-label text-left">
              <th className="px-3.5 pb-2 font-medium">Interval</th>
              <th className="px-2 pb-2 font-medium">Half steps</th>
              <th className="px-2 pb-2 font-medium">From {pretty(lowName)}</th>
              <th className="px-2 pb-2 font-medium">Inverts to</th>
              <th className="px-2 pb-2 font-medium">Sounds like</th>
              <th className="w-24 px-3.5 pb-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((code) => {
              const iv = T.iv(code);
              const hi = T.transpose(low, iv);
              return (
                <tr key={code} className="border-t border-[var(--pc-hair)]">
                  <td className="px-3.5 py-2 font-medium">{code === 'A4' ? 'Tritone (aug. 4th)' : T.ivName(iv).replace(/^./, (x) => x.toUpperCase())}</td>
                  <td className="pc-mono pc-num px-2 py-2 text-[var(--pc-ink-2)]">{T.semis(iv)}</td>
                  <td className="px-2 py-2">
                    {T.name(low, false)} – {T.name(hi, false)}
                  </td>
                  <td className="px-2 py-2 text-[var(--pc-ink-2)]">{inv[code] === 'P1' ? 'Unison' : T.ivName(T.iv(inv[code] ?? 'P1')).replace(/^./, (x) => x.toUpperCase())}</td>
                  <td className="px-2 py-2 text-[var(--pc-muted)]">{IV_SONGS[code]}</td>
                  <td className="px-3.5 py-1.5">
                    <span className="flex justify-end gap-1.5">
                      <SoundButton sound={{ seq: [str(low), str(hi)], bpm: 80 }} size="sm" label="Melodic" />
                      <SoundButton sound={{ seq: [[str(low), str(hi)]], bpm: 40 }} size="sm" label="Harmonic" />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------- terms */

const CATS: { value: Term['cat'] | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'tempo', label: 'Tempo' },
  { value: 'dynamics', label: 'Dynamics' },
  { value: 'articulation', label: 'Articulation' },
  { value: 'expression', label: 'Expression' },
  { value: 'pedal', label: 'Pedal' },
  { value: 'ornaments', label: 'Ornaments' },
  { value: 'signs', label: 'Signs' },
  { value: 'form', label: 'Form' },
  { value: 'theory', label: 'Theory' },
];

function Terms(): React.JSX.Element {
  const [q, setQ] = useState('');
  const [cat, setCat] = useState<Term['cat'] | 'all'>('all');
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return GLOSSARY.filter((t) => (cat === 'all' || t.cat === cat) && (needle === '' || t.term.toLowerCase().includes(needle) || t.meaning.toLowerCase().includes(needle))).sort((a, b) => a.term.localeCompare(b.term));
  }, [q, cat]);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-[280px]">
          <Search size={14} aria-hidden className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--pc-muted)]" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-8" aria-label="Search terms" />
        </div>
        <div className="flex flex-wrap gap-1">
          {CATS.map((c) => (
            <button key={c.value} type="button" onClick={() => setCat(c.value)} className={cn('pc-focus h-7 rounded-full border px-3 text-[12px] transition-colors', cat === c.value ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] font-semibold text-[var(--pc-page)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}>
              {c.label}
            </button>
          ))}
        </div>
        <span className="pc-mono pc-num ml-auto text-[11px] text-[var(--pc-muted)]">{list.length}</span>
      </div>
      <div className="grid grid-cols-1 gap-x-3 md:grid-cols-2 xl:grid-cols-3">
        {list.map((t) => (
          <div key={t.term} className="flex items-baseline gap-3 border-b border-[var(--pc-hair)] px-1 py-2.5">
            <span className="w-[42%] shrink-0">
              <span className="text-[13.5px] font-semibold">{t.term}</span>
              {t.sign !== undefined && t.sign !== t.term && <span className="pc-mono ml-2 text-[12px] text-[var(--pc-muted)]">{t.sign}</span>}
            </span>
            <span className="text-[13px] leading-5 text-[var(--pc-ink-2)]">{t.meaning}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
