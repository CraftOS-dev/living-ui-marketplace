/**
 * The first open: four steps in one dialog. The microphone (and how you
 * listen), your timing, your voice (the range test, which gives a voice
 * family and a comfortable range, never a voice-type label), and where to
 * start with how long a day. Everything can be changed later in Settings.
 */
import { useState } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { mic } from '../music/mic.ts';
import { Mark } from './Sidebar.tsx';
import { MicStep, RangeTest, TimingStep } from './VoiceSetup.tsx';
import { Button, Dialog, Segmented } from './ui.tsx';

const STEPS = ['Microphone', 'Timing', 'Your voice', 'Where to start'];

const START: { value: string; label: string; hint: string }[] = [
  { value: '1', label: 'I am new', hint: 'Start at level 1: first notes, steps, a song by ear' },
  { value: '3', label: 'I sing a little', hint: 'Level 3: you match notes and read a little' },
  { value: '5', label: 'I sing well', hint: 'Level 5: art songs, an octave and more' },
];

export function Onboarding(): React.JSX.Element {
  const app = useApp();
  const s = app.settings;
  const [step, setStep] = useState(0);
  const [level, setLevel] = useState(String(s?.level ?? 1));
  const [minutes, setMinutes] = useState(String(s?.daily_minutes ?? 20));
  const [under18, setUnder18] = useState(s?.under18 ?? false);

  const done = (): void => {
    app.save({ level: Number(level), daily_minutes: Number(minutes), under18, onboarded: true });
    mic.stop();
  };

  return (
    <Dialog
      open
      onClose={done}
      width={580}
      title={
        <span className="flex items-center gap-2">
          <Mark /> Welcome to Singing Coach
        </span>
      }
      footer={
        <>
          {step > 0 && (
            <Button icon={ArrowLeft} onClick={() => setStep((x) => x - 1)}>
              Back
            </Button>
          )}
          <span className="flex-1" />
          {step < STEPS.length - 1 ? (
            <>
              <Button variant="ghost" onClick={() => setStep((x) => x + 1)}>
                {step === 0 ? 'Later' : 'Skip'}
              </Button>
              <Button variant="primary" iconRight={ArrowRight} onClick={() => setStep((x) => x + 1)}>
                Next
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={done}>
              Start singing
            </Button>
          )}
        </>
      }
    >
      <div className="mb-4 flex items-center gap-2">
        {STEPS.map((t, i) => (
          <button key={t} type="button" onClick={() => setStep(i)} className={cn('sc-focus flex min-w-0 flex-1 flex-col gap-1.5 text-left', i === step ? 'text-[var(--sc-ink)]' : 'text-[var(--sc-muted)]')}>
            <span className={cn('h-[3px] w-full rounded-full transition-colors', i <= step ? 'bg-[var(--sc-ink)]' : 'bg-[var(--sc-line)]')} />
            <span className="truncate text-[11.5px] font-medium">{t}</span>
          </button>
        ))}
      </div>
      {step === 0 && <MicStep />}
      {step === 1 && <TimingStep />}
      {step === 2 && (
        <div className="flex flex-col gap-3">
          <p className="text-[13px] leading-5 text-[var(--sc-ink-2)]">The app moves every song and exercise into the part of your voice that is comfortable. It never gives you a voice-type label: voices keep settling into the early twenties.</p>
          <RangeTest kind="onboarding" onSaved={() => setStep(3)} />
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={under18} onChange={(e) => setUnder18(e.target.checked)} className="size-4 accent-[var(--sc-ink)]" />
            I am under 18 <span className="text-[var(--sc-muted)]">(sessions stay short and songs stay inside your comfortable range)</span>
          </label>
        </div>
      )}
      {step === 3 && (
        <div className="flex flex-col gap-5">
          <section className="flex flex-col gap-2">
            <h3 className="sc-label">Where you start</h3>
            <div className="grid gap-2 sm:grid-cols-3">
              {START.map((o) => (
                <button key={o.value} type="button" onClick={() => setLevel(o.value)} className={cn('sc-focus flex flex-col gap-1 rounded-[var(--sc-radius)] border p-3 text-left transition-colors', level === o.value ? 'border-[var(--sc-ink)] bg-[var(--sc-raised)]' : 'border-[var(--sc-line)] hover:bg-[var(--sc-hover)]')}>
                  <span className="text-[13px] font-semibold">{o.label}</span>
                  <span className="text-[11.5px] leading-4 text-[var(--sc-muted)]">{o.hint}</span>
                </button>
              ))}
            </div>
            <p className="text-[12px] text-[var(--sc-muted)]">The path moves you up by itself when a level is complete.</p>
          </section>
          <section className="flex flex-col gap-2">
            <h3 className="sc-label">Minutes a day</h3>
            <Segmented value={minutes} onChange={setMinutes} options={['10', '15', '20', '30', '45'].map((m) => ({ value: m, label: m }))} label="Minutes a day" />
            <p className="text-[12px] leading-4 text-[var(--sc-muted)]">Short and often beats long and rare. Every day starts with a warm-up and ends with a cool-down; a longer goal is split into two sittings.</p>
          </section>
        </div>
      )}
    </Dialog>
  );
}
