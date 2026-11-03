/**
 * Train: short drills for every skill a pianist needs. Reading, the ear,
 * theory and chords are quick quizzes answered by tapping or playing;
 * rhythm, sight-reading, technique and progressions are generated exercises
 * played in the practice screen. Each skill keeps a mastery with stars.
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, Ear, Eye, Hand, Music2, Piano, Play, Waves } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Button, IconButton, MenuButton, PageHeader, Panel, Segmented, Select, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { LearnState, SkillInfo } from '../lib/types.ts';
import { encodeSpec } from '../music/generate.ts';
import type { Hands as GenHands, Pattern, Spec } from '../music/generate.ts';
import { PROGRESSIONS, SCALES, TWELVE_MAJOR, TWELVE_MINOR } from '../music/theory.ts';
import { QUIZ_DRILLS } from '../learn/drills.ts';
import { Quiz } from '../learn/Quiz.tsx';
import { useLearn } from './Learn.tsx';

/** Open a skill's drill: a quiz here, or an exercise in the practice screen. */
export function openSkill(sk: Pick<SkillInfo, 'key' | 'drill' | 'level'>, block?: number): void {
  if (QUIZ_DRILLS.includes(sk.drill)) {
    navigate('train', { skill: sk.key, block, back: block !== undefined ? 'today' : undefined });
    return;
  }
  const seed = Math.floor(Math.random() * 100000);
  if (sk.drill === 'rhythm') navigate('practice', { gen: encodeSpec({ k: 'rhythm', level: Number(sk.key.split('.')[1] ?? 1), seed }), block });
  else if (sk.drill === 'sight') navigate('practice', { gen: encodeSpec({ k: 'sight', level: Math.max(1, sk.level || 1), seed }), block });
  else if (sk.drill === 'prog') navigate('practice', { gen: encodeSpec({ k: 'prog', tonic: 'C', prog: sk.key === 'prog.2' ? 'I-V-vi-IV' : 'I-IV-V-I', pattern: 'block' }), block });
  else if (block !== undefined) navigate('practice', { gen: encodeSpec(sk.key === 'tech.arps' ? { k: 'arpeggio', tonic: 'C', quality: 'maj', oct: 1, hands: 'R', inversion: 0 } : sk.key === 'tech.five' ? { k: 'five', tonic: 'C', minor: false, hands: 'both' } : { k: 'scale', tonic: 'C', type: 'major', oct: 1, hands: 'R', rhythm: 4 }), block });
  else navigate('train', { tech: sk.key === 'tech.arps' ? 'arpeggio' : sk.key === 'tech.five' ? 'five' : 'scale' });
}

/** The trainer behind a skill key (as lib_curriculum.js names them). */
export function drillOf(key: string): string {
  if (key.startsWith('keys.')) return 'keys';
  if (key.startsWith('read.')) return 'notes';
  if (key.startsWith('ear.')) return 'ear';
  if (key.startsWith('int.')) return 'intervals';
  if (key === 'key.sig') return 'keysig';
  if (key === 'theory.roman') return 'roman';
  if (key === 'terms') return 'terms';
  if (key.startsWith('chord.')) return 'chords';
  if (key.startsWith('rhythm.')) return 'rhythm';
  if (key.startsWith('prog.')) return 'prog';
  if (key === 'sight.read') return 'sight';
  return 'technique';
}

/** Open a drill by its skill key (plan blocks). */
export function openSkillKey(key: string, block?: number): void {
  openSkill({ key, drill: drillOf(key), level: 0 }, block);
}

const GROUPS: { key: string; title: string; icon: LucideIcon; skills: (k: string) => boolean }[] = [
  { key: 'reading', title: 'Reading', icon: Eye, skills: (k) => k.startsWith('read.') || k.startsWith('keys.') },
  { key: 'ear', title: 'Ear', icon: Ear, skills: (k) => k.startsWith('ear.') },
  { key: 'theory', title: 'Theory & chords', icon: Piano, skills: (k) => k.startsWith('int.') || k === 'key.sig' || k === 'theory.roman' || k === 'terms' || k.startsWith('chord.') },
  { key: 'rhythm', title: 'Rhythm', icon: Music2, skills: (k) => k.startsWith('rhythm.') },
];

function short(title: string): string {
  const t = title.replace(/^(Ear|Rhythm|Progressions): /, '');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

export function TrainPage(): React.JSX.Element {
  const { query } = useRoute();
  const learn = useLearn();
  const s = learn.data;
  const skillKey = query.get('skill');
  if (s === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--pc-muted)]">
        <Spinner size={18} />
      </div>
    );
  if (skillKey !== null) {
    const sk = s.skills.find((x) => x.key === skillKey);
    const block = query.get('block');
    if (sk !== undefined) return <QuizPage key={sk.key} sk={sk} level={s.level} back={query.get('back')} block={block !== null && block !== '' ? Number(block) : null} />;
  }
  return <Overview s={s} tech={query.get('tech')} prog={query.get('prog')} />;
}

function QuizPage({ sk, level, back, block }: { sk: SkillInfo; level: number; back: string | null; block: number | null }): React.JSX.Element {
  const exit = (): void => {
    if (back !== null && back !== '') window.location.hash = '#/' + back;
    else navigate('train');
  };
  const finish = (): void => {
    if (block !== null) void api.planDone(block).catch(() => undefined);
    exit();
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--pc-line)] px-3 md:px-5">
        <MenuButton />
        <IconButton icon={ArrowLeft} label="Back" onClick={exit} />
        <div className="min-w-0 leading-tight">
          <div className="pc-label">{GROUPS.find((g) => g.skills(sk.key))?.title ?? 'Train'}</div>
          <div className="truncate text-[14px] font-semibold">{short(sk.title)}</div>
        </div>
      </header>
      <div className="pc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col items-center px-5 pb-10 pt-[6vh]">
          <Quiz skill={sk} count={sk.drill === 'ear' && sk.key.startsWith('ear.melody') ? 6 : 10} level={level} onExit={exit} onFinish={finish} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ s, tech, prog }: { s: LearnState; tech: string | null; prog: string | null }): React.JSX.Element {
  const byKey = useMemo(() => new Map(s.skills.map((k) => [k.key, k])), [s.skills]);
  // Focus: what the current level still asks for, weakest first.
  const focus = useMemo(() => {
    const cur = s.path[s.level - 1];
    const keys: string[] = [];
    for (const it of cur?.items ?? []) {
      if (it.ok) continue;
      if (it.kind === 'skill' || it.kind === 'sight') keys.push(it.key);
      if (it.kind === 'scales') keys.push('tech.scales');
    }
    return [...new Set(keys)]
      .map((k) => byKey.get(k))
      .filter((x): x is SkillInfo => x !== undefined)
      .sort((a, b) => a.mastery - b.mastery)
      .slice(0, 3);
  }, [s, byKey]);
  const sight = byKey.get('sight.read');
  return (
    <div className="pc-scroll h-full overflow-y-auto">
      <PageHeader title="Train" meta={`Level ${s.level}`} />
      <div className="flex flex-col gap-3 px-5 pb-10 pt-3 md:px-7">
        {focus.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {focus.map((sk, i) => (
              <button key={sk.key} type="button" onClick={() => openSkill(sk)} className="pc-panel pc-focus pc-rise group flex items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-[var(--pc-hover)]" style={{ animationDelay: `${i * 60}ms` }}>
                <MasteryRing sk={sk} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="pc-label block">Level {s.level}</span>
                  <span className="mt-0.5 block truncate text-[14.5px] font-semibold">{short(sk.title)}</span>
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--pc-ink)] text-[var(--pc-page)] transition-transform group-hover:scale-105">
                  <Play size={13} fill="currentColor" className="ml-0.5" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-4">
          {GROUPS.map((g, gi) => {
            const list = s.skills.filter((k) => g.skills(k.key));
            return (
              <Panel key={g.key} index={String(gi + 1).padStart(2, '0')} label={g.title} aside={<g.icon size={14} className="text-[var(--pc-muted)]" aria-hidden />} bodyClass="px-1.5 pb-1.5">
                <div className="flex flex-col">
                  {list.map((sk) => (
                    <SkillRow key={sk.key} sk={sk} />
                  ))}
                </div>
              </Panel>
            );
          })}
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
          <TechniquePanel s={s} initial={tech} className="lg:col-span-7" />
          <div className="flex flex-col gap-3 lg:col-span-5">
            {sight !== undefined && <SightPanel sk={sight} />}
            <ProgPanel s={s} initial={prog} />
          </div>
        </div>
      </div>
    </div>
  );
}

function MasteryRing({ sk, size = 30 }: { sk: SkillInfo; size?: number }): React.JSX.Element {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--pc-line)" strokeWidth={2.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={sk.stars >= 3 ? 'var(--pc-good)' : 'var(--pc-ink)'} strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${c * sk.mastery} ${c}`} opacity={sk.mastery > 0 ? 1 : 0} style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.2,0.7,0.2,1)' }} />
      </svg>
      <span className="pc-mono pc-num absolute inset-0 flex items-center justify-center text-[9.5px] font-semibold text-[var(--pc-ink-2)]">{sk.attempts > 0 ? Math.round(sk.mastery * 100) : ''}</span>
    </span>
  );
}

function Stars({ n }: { n: number }): React.JSX.Element {
  return (
    <span className="inline-flex gap-px" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('text-[10.5px] leading-none', i <= n ? 'text-[var(--pc-warn)]' : 'text-[var(--pc-line-2)]')}>
          ★
        </span>
      ))}
    </span>
  );
}

function SkillRow({ sk }: { sk: SkillInfo }): React.JSX.Element {
  return (
    <button type="button" onClick={() => openSkill(sk)} className="pc-focus group flex h-11 items-center gap-2.5 rounded-[var(--pc-radius-sm)] px-2 text-left transition-colors hover:bg-[var(--pc-hover)]">
      <MasteryRing sk={sk} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{short(sk.title)}</span>
      <Stars n={sk.stars} />
      <ArrowRight size={13} aria-hidden className="shrink-0 text-[var(--pc-faint)] transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:text-[var(--pc-ink)]" />
    </button>
  );
}

/* ---------------------------------------------------------------- technique */

type TechKind = 'scale' | 'arpeggio' | 'five' | 'chromatic';
const SCALE_TYPES = ['major', 'nminor', 'hminor', 'mminor', 'pentmajor', 'pentminor', 'blues', 'dorian', 'phrygian', 'lydian', 'mixolydian', 'locrian', 'wholetone'];
const MINORISH = new Set(['nminor', 'hminor', 'mminor', 'pentminor', 'blues', 'dorian', 'phrygian', 'locrian']);

function TechniquePanel({ s, initial, className }: { s: LearnState; initial: string | null; className?: string }): React.JSX.Element {
  const [kind, setKind] = useState<TechKind>(initial === 'arpeggio' || initial === 'five' || initial === 'chromatic' ? initial : 'scale');
  const [type, setType] = useState('major');
  const [quality, setQuality] = useState<'maj' | 'min' | 'dim7' | '7'>('maj');
  const [tonic, setTonic] = useState('C');
  const [oct, setOct] = useState(1);
  const [hands, setHands] = useState<GenHands>('R');
  const [rhythm, setRhythm] = useState<4 | 2 | 1>(4);
  const [minor, setMinor] = useState(false);
  const minorKeys = (kind === 'scale' && MINORISH.has(type)) || (kind === 'arpeggio' && quality === 'min') || (kind === 'five' && minor);
  const keys = minorKeys ? TWELVE_MINOR : TWELVE_MAJOR;
  const tonicNow = keys.includes(tonic) ? tonic : keys[TWELVE_MAJOR.indexOf(tonic)] ?? keys[0]!;
  const skillKey = kind === 'arpeggio' ? 'tech.arps' : kind === 'five' ? 'tech.five' : 'tech.scales';
  const sk = s.skills.find((x) => x.key === skillKey);
  const prefix = kind === 'scale' ? type : kind === 'arpeggio' ? `arp-${quality}` : kind === 'five' ? (minor ? 'five-min' : 'five') : 'chromatic';
  const best = (t: string): number => sk?.data[`${prefix}:${t}`]?.best ?? 0;
  const spec = (): Spec => {
    if (kind === 'scale') return { k: 'scale', tonic: tonicNow, type, oct, hands, rhythm };
    if (kind === 'arpeggio') return { k: 'arpeggio', tonic: tonicNow, quality, oct, hands, inversion: 0 };
    if (kind === 'five') return { k: 'five', tonic: tonicNow, minor, hands: hands === 'contrary' ? 'both' : hands };
    return { k: 'chromatic', tonic: tonicNow, oct, hands };
  };
  return (
    <Panel index="05" label="Technique" className={className} aside={sk !== undefined ? <Stars n={sk.stars} /> : undefined}>
      <div className="flex flex-col gap-3.5">
        <Segmented
          value={kind}
          onChange={setKind}
          options={[
            { value: 'scale', label: 'Scales', icon: Waves },
            { value: 'arpeggio', label: 'Arpeggios' },
            { value: 'five', label: 'Five-finger', icon: Hand },
            { value: 'chromatic', label: 'Chromatic' },
          ]}
          label="Exercise"
          className="self-start"
        />
        <div className="flex flex-wrap items-center gap-2">
          {kind === 'scale' && (
            <Select value={type} onChange={(e) => setType(e.target.value)} className="!w-[190px]" aria-label="Scale">
              {SCALE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {SCALES[t]?.name}
                </option>
              ))}
            </Select>
          )}
          {kind === 'arpeggio' && (
            <Segmented
              value={quality}
              onChange={setQuality}
              options={[
                { value: 'maj', label: 'Major' },
                { value: 'min', label: 'Minor' },
                { value: '7', label: 'Dom 7' },
                { value: 'dim7', label: 'Dim 7' },
              ]}
              label="Quality"
              size="sm"
            />
          )}
          {kind === 'five' && (
            <Segmented
              value={minor ? 'min' : 'maj'}
              onChange={(v) => setMinor(v === 'min')}
              options={[
                { value: 'maj', label: 'Major' },
                { value: 'min', label: 'Minor' },
              ]}
              label="Mode"
              size="sm"
            />
          )}
          {kind !== 'five' && (
            <Segmented
              value={String(oct)}
              onChange={(v) => setOct(Number(v))}
              options={[
                { value: '1', label: '1 oct' },
                { value: '2', label: '2' },
                { value: '4', label: '4' },
              ]}
              label="Octaves"
              size="sm"
            />
          )}
          <Segmented
            value={hands}
            onChange={setHands}
            options={[
              { value: 'R', label: 'R' },
              { value: 'L', label: 'L' },
              { value: 'both', label: 'Both' },
              ...(kind === 'scale' || kind === 'chromatic' ? [{ value: 'contrary' as GenHands, label: 'Contrary' }] : []),
            ]}
            label="Hands"
            size="sm"
          />
          {kind === 'scale' && (
            <Segmented
              value={String(rhythm)}
              onChange={(v) => setRhythm(Number(v) as 4 | 2 | 1)}
              options={[
                { value: '4', label: '♩', title: 'Quarter notes' },
                { value: '2', label: '♫', title: 'Eighth notes' },
                { value: '1', label: '♬', title: 'Sixteenth notes' },
              ]}
              label="Rhythm"
              size="sm"
            />
          )}
        </div>
        <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
          {keys.map((t) => {
            const b = best(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTonic(t)}
                className={cn('pc-focus relative flex h-12 flex-col items-center justify-center rounded-[var(--pc-radius-sm)] border text-[13px] font-semibold transition-colors', tonicNow === t ? 'border-[var(--pc-ink)] bg-[var(--pc-ink)] text-[var(--pc-page)]' : 'border-[var(--pc-line)] bg-[var(--pc-raised)] hover:bg-[var(--pc-hover)]')}
                title={b > 0 ? `Best clean tempo ${b}%` : undefined}
              >
                <span>{t.replace('#', '♯').replace('b', '♭')}{minorKeys ? 'm' : ''}</span>
                <span className={cn('pc-mono pc-num text-[9px] font-medium', tonicNow === t ? 'opacity-70' : b >= 100 ? 'text-[var(--pc-good)]' : 'text-[var(--pc-faint)]')}>{b > 0 ? `${b}%` : '·'}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" size="lg" icon={Play} onClick={() => navigate('practice', { gen: encodeSpec(spec()) })}>
            Practise
          </Button>
          <span className="text-[12px] text-[var(--pc-muted)]">Clean in Play mode records the tempo</span>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------ sight-reading */

function SightPanel({ sk }: { sk: SkillInfo }): React.JSX.Element {
  const level = Math.max(1, sk.level || 1);
  const [pick, setPick] = useState(level);
  return (
    <Panel index="06" label="Sight-reading" aside={<span className="pc-mono pc-num text-[11px] text-[var(--pc-muted)]">best {sk.best_level || 0}/30</span>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((l) => (
            <button key={l} type="button" tabIndex={-1} onClick={() => setPick(l)} className={cn('flex-1 rounded-[2px] transition-colors', l === pick ? 'bg-[var(--pc-rh)]' : l <= (sk.best_level || 0) ? 'bg-[var(--pc-ink)]' : 'bg-[var(--pc-line)] hover:bg-[var(--pc-line-2)]')} style={{ height: 8 + l * 0.9 }} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" icon={Play} onClick={() => navigate('practice', { gen: encodeSpec({ k: 'sight', level: pick, seed: Math.floor(Math.random() * 100000) }) })}>
            Level {pick}
          </Button>
          <span className="text-[12px] text-[var(--pc-muted)]">New music every time; one pass, in time</span>
        </div>
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------- progressions */

const PATTERNS: { value: Pattern; label: string }[] = [
  { value: 'block', label: 'Block' },
  { value: 'broken', label: 'Broken' },
  { value: 'alberti', label: 'Alberti' },
  { value: 'waltz', label: 'Waltz' },
  { value: 'arpeggio', label: 'Arpeggio' },
  { value: 'stride', label: 'Stride' },
];

function ProgPanel({ s, initial }: { s: LearnState; initial: string | null }): React.JSX.Element {
  const list = [...PROGRESSIONS.map((p) => ({ id: p.id, name: p.name, minor: p.mode === 'minor', level: p.level })), { id: '12-bar', name: '12-bar blues', minor: false, level: 2 as const }];
  const [prog, setProg] = useState(initial === 'prog.2' ? 'I-V-vi-IV' : 'I-IV-V-I');
  const [tonic, setTonic] = useState('C');
  const [pattern, setPattern] = useState<Pattern>('block');
  const cur = list.find((p) => p.id === prog) ?? list[0]!;
  const keys = cur.minor ? TWELVE_MINOR : TWELVE_MAJOR;
  const t = keys.includes(tonic) ? tonic : keys[0]!;
  const sk = s.skills.find((x) => x.key === (cur.level === 2 ? 'prog.2' : 'prog.1'));
  return (
    <Panel index="07" label="Progressions" aside={sk !== undefined ? <Stars n={sk.stars} /> : undefined}>
      <div className="flex flex-col gap-3">
        <Select value={prog} onChange={(e) => setProg(e.target.value)} aria-label="Progression">
          {list.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <div className="flex gap-2">
          <Select value={t} onChange={(e) => setTonic(e.target.value)} className="!w-[96px]" aria-label="Key">
            {keys.map((k) => (
              <option key={k} value={k}>
                {k.replace('#', '♯').replace('b', '♭')}
                {cur.minor ? 'm' : ''}
              </option>
            ))}
          </Select>
          <Select value={pattern} onChange={(e) => setPattern(e.target.value as Pattern)} aria-label="Pattern">
            {PATTERNS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
        </div>
        <Button variant="primary" icon={Play} className="self-start" onClick={() => navigate('practice', { gen: encodeSpec({ k: 'prog', tonic: t, prog, pattern }) })}>
          Practise
        </Button>
      </div>
    </Panel>
  );
}
