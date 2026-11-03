/**
 * Train: short drills for every skill a singer needs. Quizzes (the ear,
 * reading, theory, terms, IPA) are answered by tapping; sung drills
 * (matching, holding and sliding onto notes, intervals, echoes, melodies
 * from memory, scale degrees, sustain and phrase length) are judged on the
 * voice dial; rhythms are spoken on "ta". Vocalises, sight-singing, scales
 * against a drone, harmony parts and unaccompanied tunes are sung in the
 * practice screen. Each skill keeps a mastery with stars; adaptive skills a
 * level.
 */
import { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import { ArrowLeft, ArrowRight, AudioLines, Ear, Eye, Gauge, Lock, Mic, Music2, Play, Waves, Wind } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { Button, IconButton, MenuButton, PageHeader, Panel, Segmented, Spinner } from '../components/ui.tsx';
import { api } from '../lib/api.ts';
import { navigate, useRoute } from '../lib/router.ts';
import type { LearnState, SkillInfo } from '../lib/types.ts';
import { Drill } from '../learn/Drill.tsx';
import { specKey } from '../music/generate.ts';
import type { Spec } from '../music/spec.ts';
import { useLearn } from './Learn.tsx';

const RUN_HERE = ['quiz', 'sing', 'speak'];

/** The vocalise a technique skill starts with. */
const FIRST_EX: Record<string, string> = {
  'tech.sovt': 'sovt.siren',
  'tech.fivetone': 'five.maj',
  'tech.arps': 'triad.maj',
  'tech.scales': 'scale.maj',
  'tech.leaps': 'octave.rep',
  'tech.vowels': 'vowels.one',
  'tech.bridge': 'bridge',
  'tech.messa': 'messa',
  'tech.agility': 'agility',
  'tech.ornaments': 'turns',
};

/** A skill's exercise as a practice spec (exercise and sight skills). */
function specFor(key: string, level: number): Spec {
  const seed = Math.floor(Math.random() * 1e6);
  if (key === 'sight.sing') return { k: 'sight', level: Math.max(1, level), seed };
  if (key === 'pitch.drone') return { k: 'drone', minor: Math.random() < 0.3, seed };
  if (key === 'pitch.unacc') return { k: 'unacc', seed };
  if (key === 'pitch.harmony') return { k: 'harmony', part: 'lower', seed };
  if (key === 'ear.harmony.1') return { k: 'harmony', part: 'upper', seed };
  if (key === 'ear.harmony.2') return { k: 'harmony', part: 'lower', seed };
  return { k: 'vocalise', ex: FIRST_EX[key] ?? 'five.maj' };
}

/** Open a skill's drill: here (quiz, sung, spoken) or in the practice screen. */
export function openSkill(sk: Pick<SkillInfo, 'key' | 'drill' | 'level'>, block?: number): void {
  if (RUN_HERE.includes(sk.drill)) {
    navigate('train', { skill: sk.key, block, back: block !== undefined ? 'today' : undefined });
    return;
  }
  navigate('practice', { gen: specKey(specFor(sk.key, sk.level || 1)), block, skill: sk.key, back: block !== undefined ? 'today' : 'train' });
}

/** Sing one vocalise of the catalogue. */
export function openExercise(ex: string, skill?: string, block?: number, vowel?: string): void {
  navigate('practice', { gen: specKey({ k: 'vocalise', ex, vowel }), block, skill, back: block !== undefined ? 'today' : 'train' });
}

/** The trainer behind a skill key (as lib_curriculum.js names them). */
export function drillOf(key: string): string {
  if (['int.hear', 'ear.majmin', 'ear.cadence', 'sight.solfege', 'read.staff', 'key.sig', 'int.name', 'chord.name', 'terms', 'ipa'].includes(key)) return 'quiz';
  if (key.startsWith('rhythm.')) return 'speak';
  if (key === 'sight.sing') return 'sight';
  if (key.startsWith('tech.') || key === 'pitch.drone' || key === 'pitch.unacc' || key === 'pitch.harmony' || key.startsWith('ear.harmony')) return 'exercise';
  return 'sing';
}

/** Open a drill by its skill key (plan blocks). */
export function openSkillKey(key: string, block?: number): void {
  openSkill({ key, drill: drillOf(key) as SkillInfo['drill'], level: 0 }, block);
}

const GROUPS: { key: string; title: string; icon: LucideIcon }[] = [
  { key: 'pitch', title: 'Pitch', icon: AudioLines },
  { key: 'ear', title: 'Ear', icon: Ear },
  { key: 'sight', title: 'Sight-singing', icon: Eye },
  { key: 'theory', title: 'Theory & rhythm', icon: Music2 },
  { key: 'technique', title: 'Technique', icon: Wind },
  { key: 'voice', title: 'Voice & breath', icon: Gauge },
];

export function TrainPage(): React.JSX.Element {
  const { query } = useRoute();
  const learn = useLearn();
  const s = learn.data;
  const skillKey = query.get('skill');
  if (s === null)
    return (
      <div className="flex h-full items-center justify-center text-[var(--sc-muted)]">
        <Spinner size={18} />
      </div>
    );
  if (skillKey !== null) {
    const sk = s.skills.find((x) => x.key === skillKey);
    const block = query.get('block');
    if (sk !== undefined && RUN_HERE.includes(sk.drill)) return <DrillPage key={sk.key} sk={sk} back={query.get('back')} block={block !== null && block !== '' ? Number(block) : null} />;
  }
  return <Overview s={s} />;
}

function DrillPage({ sk, back, block }: { sk: SkillInfo; back: string | null; block: number | null }): React.JSX.Element {
  const exit = (): void => {
    if (back !== null && back !== '') window.location.hash = '#/' + back;
    else navigate('train');
  };
  const finish = (): void => {
    if (block !== null) void api.planDone(block).catch(() => undefined);
  };
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[var(--sc-line)] px-3 md:px-5">
        <MenuButton />
        <IconButton icon={ArrowLeft} label="Back" onClick={exit} />
        <div className="min-w-0 leading-tight">
          <div className="sc-label">{GROUPS.find((g) => g.key === sk.track)?.title ?? 'Train'}</div>
          <div className="truncate text-[14px] font-semibold">{sk.title}</div>
        </div>
      </header>
      <div className="sc-scroll min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-[720px] flex-col items-stretch px-5 pb-10 pt-[4vh]">
          <Drill skill={sk} count={sk.drill === 'quiz' ? 10 : sk.drill === 'speak' ? 4 : 6} onExit={exit} onFinish={finish} />
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- overview */

function Overview({ s }: { s: LearnState }): React.JSX.Element {
  const byKey = useMemo(() => new Map(s.skills.map((k) => [k.key, k])), [s.skills]);
  // Focus: what the current level still asks for, weakest first.
  const focus = useMemo(() => {
    const cur = s.path[s.level - 1];
    const out: { key: string; title: string; frac: number; run: () => void }[] = [];
    for (const it of cur?.items ?? []) {
      if (it.ok) continue;
      if (it.kind === 'skill' || it.kind === 'level') {
        const sk = byKey.get(it.key);
        if (sk !== undefined) out.push({ key: it.key, title: it.title, frac: it.kind === 'skill' ? sk.mastery / Math.max(0.01, it.need ?? 1) : (sk.best_level || 0) / Math.max(1, it.need ?? 1), run: () => openSkill(sk) });
      } else if (it.kind === 'tech') out.push({ key: it.key, title: it.title, frac: (it.have ?? 0) / Math.max(1, it.need ?? 1), run: () => openExercise(it.key, it.skill) });
    }
    return out.sort((a, b) => a.frac - b.frac).slice(0, 3);
  }, [s, byKey]);
  const sight = byKey.get('sight.sing');
  return (
    <div className="sc-scroll h-full overflow-y-auto">
      <PageHeader title="Train" meta={`Level ${s.level}`} />
      <div className="flex flex-col gap-3 px-5 pb-10 pt-3 md:px-7">
        {focus.length > 0 && (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {focus.map((f, i) => (
              <button key={f.key} type="button" onClick={f.run} className="sc-panel sc-focus sc-rise group flex items-center gap-3.5 px-4 py-4 text-left transition-colors hover:bg-[var(--sc-hover)]" style={{ animationDelay: `${i * 60}ms` }}>
                <FracRing value={Math.min(1, f.frac)} size={44} />
                <span className="min-w-0 flex-1">
                  <span className="sc-label block">Level {s.level} asks for</span>
                  <span className="mt-0.5 block truncate text-[14px] font-semibold">{f.title}</span>
                </span>
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--sc-ink)] text-[var(--sc-page)] transition-transform group-hover:scale-105">
                  <Play size={13} fill="currentColor" className="ml-0.5" aria-hidden />
                </span>
              </button>
            ))}
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {GROUPS.map((g, gi) => {
            const list = s.skills.filter((k) => k.track === g.key);
            return (
              <Panel key={g.key} index={String(gi + 1).padStart(2, '0')} label={g.title} aside={<g.icon size={14} className="text-[var(--sc-muted)]" aria-hidden />} bodyClass="px-1.5 pb-1.5">
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
          <Catalogue s={s} className="lg:col-span-7" />
          <div className="flex flex-col gap-3 lg:col-span-5">
            {sight !== undefined && <SightPanel sk={sight} />}
            <MorePanel />
          </div>
        </div>
      </div>
    </div>
  );
}

function FracRing({ value, size = 30 }: { value: number; size?: number }): React.JSX.Element {
  const r = size / 2 - 2.5;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sc-line)" strokeWidth={2.5} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--sc-ink)" strokeWidth={2.5} strokeLinecap="round" strokeDasharray={`${c * value} ${c}`} opacity={value > 0 ? 1 : 0} style={{ transition: 'stroke-dasharray 700ms cubic-bezier(0.2,0.7,0.2,1)' }} />
      </svg>
      <span className="sc-mono sc-num absolute inset-0 flex items-center justify-center text-[9.5px] font-semibold text-[var(--sc-ink-2)]">{value > 0 ? Math.round(value * 100) : ''}</span>
    </span>
  );
}

function Stars({ n }: { n: number }): React.JSX.Element {
  return (
    <span className="inline-flex gap-px" aria-label={`${n} of 3 stars`}>
      {[1, 2, 3].map((i) => (
        <span key={i} className={cn('text-[10.5px] leading-none', i <= n ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-line-2)]')}>
          ★
        </span>
      ))}
    </span>
  );
}

const DRILL_ICON: Record<string, LucideIcon> = { quiz: Ear, sing: Mic, speak: Music2, exercise: Wind, sight: Eye };

function SkillRow({ sk }: { sk: SkillInfo }): React.JSX.Element {
  const Icon = DRILL_ICON[sk.drill] ?? Mic;
  return (
    <button type="button" onClick={() => openSkill(sk)} className="sc-focus group flex h-11 items-center gap-2.5 rounded-[var(--sc-radius-sm)] px-2 text-left transition-colors hover:bg-[var(--sc-hover)]">
      <FracRing value={sk.mastery} />
      <span className="min-w-0 flex-1 truncate text-[13px]">{sk.title}</span>
      {sk.levels > 0 && <span className="sc-mono sc-num rounded-[4px] bg-[var(--sc-sunk)] px-1.5 py-0.5 text-[10px] text-[var(--sc-muted)]">L{Math.max(1, sk.level || 1)}</span>}
      <Stars n={sk.stars} />
      <Icon size={13} aria-hidden className="shrink-0 text-[var(--sc-faint)] transition-colors group-hover:text-[var(--sc-ink)]" />
    </button>
  );
}

/* ---------------------------------------------------------- the catalogue */

const VOWEL_CHOICES = ['a', 'i', 'u', 'e', 'o', 'la', 'nay', 'solfege'];

function Catalogue({ s, className }: { s: LearnState; className?: string }): React.JSX.Element {
  const [vowel, setVowel] = useState('a');
  const skills = useMemo(() => new Map(s.skills.map((k) => [k.key, k])), [s.skills]);
  const groups = useMemo(() => {
    const out = new Map<string, { ex: string; title: string; level: number }[]>();
    for (const [ex, d] of Object.entries(s.exercises)) {
      const l = out.get(d.skill) ?? [];
      l.push({ ex, title: d.title, level: d.level });
      out.set(d.skill, l);
    }
    for (const l of out.values()) l.sort((a, b) => a.level - b.level);
    return [...out.entries()];
  }, [s.exercises]);
  return (
    <Panel index="07" label="Vocalises" aside={<span className="sc-label">{Object.keys(s.exercises).length} patterns · moved into your range</span>} className={className}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className="sc-label">Sing on</span>
        <Segmented value={vowel} onChange={setVowel} options={VOWEL_CHOICES.map((v) => ({ value: v, label: v === 'solfege' ? 'do re mi' : v }))} label="Vowel" size="sm" />
      </div>
      <div className="grid grid-cols-1 gap-x-5 gap-y-3 md:grid-cols-2">
        {groups.map(([skill, list]) => {
          const sk = skills.get(skill);
          return (
            <div key={skill} className="flex flex-col">
              <div className="sc-label mb-1 flex items-center justify-between">
                <span>{sk?.title ?? skill}</span>
                {sk !== undefined && <Stars n={sk.stars} />}
              </div>
              {list.map((it) => {
                const locked = it.level > s.level + 1;
                const data = sk?.data ?? {};
                const clean = Object.entries(data).filter(([k, v]) => k.startsWith(it.ex + '@') && typeof v === 'object' && v.clean === true).length;
                return (
                  <button key={it.ex} type="button" onClick={() => openExercise(it.ex, skill, undefined, it.ex.startsWith('sovt') ? undefined : vowel)} title={locked ? `Opens at level ${it.level}; you can still try it` : undefined} className="sc-focus group flex h-9 items-center gap-2 rounded-[var(--sc-radius-sm)] px-1.5 text-left transition-colors hover:bg-[var(--sc-hover)]">
                    <span className={cn('min-w-0 flex-1 truncate text-[12.5px]', locked && 'text-[var(--sc-muted)]')}>{it.title}</span>
                    {clean > 0 && <span className="sc-mono sc-num text-[10.5px] text-[var(--sc-muted)]" title="Clean from this many starting notes">{clean}✓</span>}
                    {locked ? <Lock size={11} aria-hidden className="text-[var(--sc-faint)]" /> : <span className="sc-mono rounded-[4px] bg-[var(--sc-sunk)] px-1.5 py-0.5 text-[10px] text-[var(--sc-muted)]">L{it.level}</span>}
                    <ArrowRight size={12} aria-hidden className="text-[var(--sc-faint)] group-hover:text-[var(--sc-ink)]" />
                  </button>
                );
              })}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}

function SightPanel({ sk }: { sk: SkillInfo }): React.JSX.Element {
  const level = Math.max(1, sk.level || 1);
  const [pick, setPick] = useState(level);
  return (
    <Panel index="08" label="Sight-singing" aside={<span className="sc-mono sc-num text-[11px] text-[var(--sc-muted)]">best {sk.best_level || 0}/30</span>}>
      <div className="flex flex-col gap-3">
        <div className="flex items-end gap-[3px]" aria-hidden>
          {Array.from({ length: 30 }, (_, i) => i + 1).map((l) => (
            <button key={l} type="button" tabIndex={-1} onClick={() => setPick(l)} className={cn('flex-1 rounded-[2px] transition-colors', l === pick ? 'bg-[var(--sc-voice)]' : l <= (sk.best_level || 0) ? 'bg-[var(--sc-ink)]' : 'bg-[var(--sc-line)] hover:bg-[var(--sc-line-2)]')} style={{ height: 8 + l * 0.9 }} />
          ))}
        </div>
        <div className="flex items-center gap-3">
          <Button variant="primary" icon={Play} onClick={() => navigate('practice', { gen: specKey({ k: 'sight', level: pick, seed: Math.floor(Math.random() * 1e6) }), skill: 'sight.sing', back: 'train' })}>
            Level {pick}
          </Button>
          <span className="text-[12px] text-[var(--sc-muted)]">The key chord and first note, then sing it from the sheet</span>
        </div>
      </div>
    </Panel>
  );
}

function MorePanel(): React.JSX.Element {
  const go = (spec: Spec, skill: string): void => navigate('practice', { gen: specKey(spec), skill, back: 'train' });
  const seed = (): number => Math.floor(Math.random() * 1e6);
  const rows: { title: string; hint: string; icon: LucideIcon; run: () => void }[] = [
    { title: 'Scale against a drone', hint: 'Tune each note to the held tonic', icon: Waves, run: () => go({ k: 'drone', seed: seed() }, 'pitch.drone') },
    { title: 'Minor scale against a drone', hint: 'The same in minor', icon: Waves, run: () => go({ k: 'drone', minor: true, seed: seed() }, 'pitch.drone') },
    { title: 'Hold a harmony line', hint: 'You sing the lower part; the piano the upper', icon: Music2, run: () => go({ k: 'harmony', part: 'lower', seed: seed() }, 'pitch.harmony') },
    { title: 'Upper part from memory', hint: 'Hear both parts, then sing the upper', icon: Ear, run: () => go({ k: 'harmony', part: 'upper', seed: seed() }, 'ear.harmony.1') },
    { title: 'Lower part from memory', hint: 'Hear both parts, then sing the lower', icon: Ear, run: () => go({ k: 'harmony', part: 'lower', seed: seed() }, 'ear.harmony.2') },
    { title: 'Unaccompanied tune', hint: 'Sixteen bars alone: does the key drift?', icon: Mic, run: () => go({ k: 'unacc', seed: seed() }, 'pitch.unacc') },
  ];
  return (
    <Panel index="09" label="Tuning and harmony">
      <div className="flex flex-col">
        {rows.map((r) => (
          <button key={r.title} type="button" onClick={r.run} className="sc-focus group flex min-h-11 items-center gap-3 rounded-[var(--sc-radius-sm)] px-1.5 py-1.5 text-left transition-colors hover:bg-[var(--sc-hover)]">
            <r.icon size={15} aria-hidden className="shrink-0 text-[var(--sc-muted)]" />
            <span className="min-w-0 flex-1">
              <span className="block text-[13px]">{r.title}</span>
              <span className="block truncate text-[11.5px] text-[var(--sc-muted)]">{r.hint}</span>
            </span>
            <ArrowRight size={13} aria-hidden className="text-[var(--sc-faint)] group-hover:text-[var(--sc-ink)]" />
          </button>
        ))}
      </div>
    </Panel>
  );
}
