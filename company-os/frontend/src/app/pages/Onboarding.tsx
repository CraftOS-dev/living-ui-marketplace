/**
 * Onboarding wizard, one decision per screen, progress dots, always
 * skippable, no technical setup. Answers configure the whole app (vocab
 * pack, module stack, Journey), QuickBooks-interview style. Completing it
 * IS the first Journey step (endowed progress).
 */
import { useState } from 'react';
import { Button, Card, CardContent, Input, Spinner, Textarea, cn, toast } from '../../kit/index.ts';
import { callOp } from '../lib/ops.ts';
import type { CompanyType, Stage, TeamSize } from '../lib/types.ts';

interface Answers {
  name: string;
  what_it_does: string;
  company_type: CompanyType;
  stage: Stage;
  team_size: TeamSize;
  focus: string[];
}

const TYPE_OPTIONS: ReadonlyArray<{ value: CompanyType; label: string; hint: string }> = [
  { value: 'services', label: 'Services', hint: 'Consulting, trades, agencies, freelancing' },
  { value: 'retail_ecommerce', label: 'Retail or online shop', hint: 'Physical or e-commerce products' },
  { value: 'food_hospitality', label: 'Food and hospitality', hint: 'Restaurants, cafes, catering, venues' },
  { value: 'software_digital', label: 'Software or digital', hint: 'Apps, SaaS, digital products' },
  { value: 'other', label: 'Something else', hint: 'Every kind of business fits here' },
];

const STAGE_OPTIONS: ReadonlyArray<{ value: Stage; label: string; hint: string }> = [
  { value: 'validate', label: 'Just an idea', hint: 'Still figuring out if it works' },
  { value: 'setup', label: 'Getting set up', hint: 'Making it official and ready to sell' },
  { value: 'first_customers', label: 'Making some sales', hint: 'First customers, first money in' },
  { value: 'grow', label: 'Growing', hint: 'Regular sales, maybe first teammates' },
  { value: 'scale', label: 'Established', hint: 'A real team, ready to scale up' },
];

const SIZE_OPTIONS: ReadonlyArray<{ value: TeamSize; label: string }> = [
  { value: 'solo', label: 'Just me' },
  { value: 'two_five', label: '2 to 5' },
  { value: 'six_fifteen', label: '6 to 15' },
  { value: 'sixteen_fifty', label: '16 to 50' },
  { value: 'fifty_plus', label: 'More than 50' },
];

const FOCUS_OPTIONS: readonly string[] = [
  'Getting customers',
  'Getting organized',
  'Tracking money',
  'Setting up properly',
  'Planning ahead',
];

function ChoiceCard({
  label,
  hint,
  selected,
  onClick,
}: {
  label: string;
  hint?: string | undefined;
  selected: boolean;
  onClick: () => void;
}): React.JSX.Element {
  return (
    <Button
      variant="secondary"
      className={cn(
        'h-auto w-full flex-col items-start gap-0.5 px-4 py-3 text-left',
        selected && 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/10',
      )}
      onClick={onClick}
      aria-pressed={selected}
    >
      <span className="text-sm font-medium">{label}</span>
      {hint !== undefined && (
        <span className="text-xs font-normal text-[var(--lui-muted)]">{hint}</span>
      )}
    </Button>
  );
}

const TOTAL_STEPS = 6;

export function Onboarding(): React.JSX.Element {
  const [step, setStep] = useState(0);
  const [building, setBuilding] = useState(false);
  const [answers, setAnswers] = useState<Answers>({
    name: '',
    what_it_does: '',
    company_type: 'other',
    stage: 'validate',
    team_size: 'solo',
    focus: [],
  });

  const set = <K extends keyof Answers>(key: K, value: Answers[K]): void =>
    setAnswers((prev) => ({ ...prev, [key]: value }));

  const finish = async (): Promise<void> => {
    setBuilding(true);
    try {
      await callOp('/api/ops/onboarding-complete', {
        name: answers.name.trim() !== '' ? answers.name.trim() : 'My company',
        what_it_does: answers.what_it_does.trim(),
        company_type: answers.company_type,
        stage: answers.stage,
        team_size: answers.team_size,
        focus: answers.focus,
      });
      // The company record arrives via realtime; App switches to Home.
      toast.success('Your Company OS is ready');
    } catch (err) {
      setBuilding(false);
      toast.error(err instanceof Error ? err.message : 'Setup failed, try again');
    }
  };

  if (building) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
        <Spinner />
        <p className="text-sm text-[var(--lui-muted)]">
          Setting up your Company OS: your plan draft, your Journey, and the right modules…
        </p>
      </div>
    );
  }

  const screens: React.JSX.Element[] = [
    // 0, welcome
    <div key="welcome" className="flex flex-col items-center gap-4 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">Let’s set up your company OS</h1>
      <p className="max-w-md text-sm text-[var(--lui-muted)]">
        A few quick questions shape everything: your vocabulary, your journey, and which parts of
        the app you see. Under a minute, no technical setup, and you can skip anything.
      </p>
      <Button size="lg" onClick={() => setStep(1)}>
        Start
      </Button>
    </div>,
    // 1, name
    <div key="name" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">What is your company called?</h2>
      <Input
        label="Company name"
        placeholder="You can change this any time, or skip it"
        value={answers.name}
        onChange={(e) => set('name', e.target.value)}
        autoFocus
      />
    </div>,
    // 2, what it does
    <div key="what" className="flex flex-col gap-4">
      <h2 className="text-lg font-semibold">What does it do?</h2>
      <Textarea
        label="In your own words, one or two sentences"
        placeholder="e.g. We fix and maintain bicycles for commuters in our neighborhood"
        rows={3}
        value={answers.what_it_does}
        onChange={(e) => set('what_it_does', e.target.value)}
      />
    </div>,
    // 3, type
    <div key="type" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">What kind of business is it?</h2>
      <p className="text-sm text-[var(--lui-muted)]">
        This sets the words the app uses and the templates you get.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {TYPE_OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            label={o.label}
            hint={o.hint}
            selected={answers.company_type === o.value}
            onClick={() => set('company_type', o.value)}
          />
        ))}
      </div>
    </div>,
    // 4, stage
    <div key="stage" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">Where are you right now?</h2>
      <p className="text-sm text-[var(--lui-muted)]">
        Honest is better than ambitious, the app grows with you either way.
      </p>
      <div className="grid gap-2 sm:grid-cols-2">
        {STAGE_OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            label={o.label}
            hint={o.hint}
            selected={answers.stage === o.value}
            onClick={() => set('stage', o.value)}
          />
        ))}
      </div>
    </div>,
    // 5, team size
    <div key="size" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">How many people work in the company?</h2>
      <div className="grid gap-2 sm:grid-cols-2">
        {SIZE_OPTIONS.map((o) => (
          <ChoiceCard
            key={o.value}
            label={o.label}
            selected={answers.team_size === o.value}
            onClick={() => set('team_size', o.value)}
          />
        ))}
      </div>
    </div>,
    // 6, focus
    <div key="focus" className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">What do you want help with first?</h2>
      <p className="text-sm text-[var(--lui-muted)]">Pick as many as you like.</p>
      <div className="grid gap-2 sm:grid-cols-2">
        {FOCUS_OPTIONS.map((f) => (
          <ChoiceCard
            key={f}
            label={f}
            selected={answers.focus.includes(f)}
            onClick={() =>
              set(
                'focus',
                answers.focus.includes(f)
                  ? answers.focus.filter((x) => x !== f)
                  : [...answers.focus, f],
              )
            }
          />
        ))}
      </div>
    </div>,
  ];

  const screen = screens[step] ?? screens[0];
  const last = step === TOTAL_STEPS;

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-xl">
        <CardContent className="flex min-h-[320px] flex-col justify-between gap-6 p-6 md:p-8">
          <div>{screen}</div>
          {step > 0 && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-1.5" aria-label={`Step ${step} of ${TOTAL_STEPS}`}>
                {Array.from({ length: TOTAL_STEPS }, (_, i) => (
                  <span
                    key={i}
                    className={cn(
                      'h-1.5 w-4',
                      i < step ? 'bg-[var(--lui-accent)]' : 'bg-[var(--lui-border)]',
                    )}
                    aria-hidden
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={() => void finish()}>
                  Skip for now
                </Button>
                {step > 1 && (
                  <Button variant="secondary" size="sm" onClick={() => setStep(step - 1)}>
                    Back
                  </Button>
                )}
                {last ? (
                  <Button onClick={() => void finish()}>Finish setup</Button>
                ) : (
                  <Button onClick={() => setStep(step + 1)}>Next</Button>
                )}
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
