/**
 * Journey: a vertical rail of stages (Duolingo path logic: done = filled,
 * current = glowing focus, future = visible but locked with a preview).
 * Inside the current stage, steps behave like Shopify's setup guide: one
 * step expanded with its "why" and a verb button, the rest collapsed rows.
 */
import { useEffect, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Compass, Lock } from 'lucide-react';
import { Button, Progress, getPbClient, toast, useCollection, cn } from '../../kit/index.ts';
import type { Company, JourneyStep, Page, Stage } from '../lib/types.ts';
import { STAGES, STAGE_LABELS } from '../lib/types.ts';
import { PageHeader } from '../components/ui.tsx';
import { callOp } from '../lib/ops.ts';
import { todayStr } from '../lib/useCompany.ts';

const STAGE_TAGLINES: Record<Stage, string> = {
  validate: 'Find out if it works before you build it',
  setup: 'Make it official and ready to sell',
  first_customers: 'Turn the idea into money in',
  grow: 'Build the team and the rhythm',
  scale: 'Systems that run without you in every room',
};

export function JourneyPage({
  company,
  onNavigate,
}: {
  company: Company;
  onNavigate: (page: Page) => void;
}): React.JSX.Element {
  const { records: steps, loading } = useCollection<JourneyStep>('journey_steps', { sort: 'order' });

  // Self-heal on open: re-run auto-detection so steps whose work already shows
  // in your records (e.g. a filled Company Profile) resolve without a reload.
  // The live journey_steps subscription reflects any newly completed steps.
  useEffect(() => {
    void callOp('/api/ops/journey-autocheck').catch(() => undefined);
  }, []);

  const currentIdx = STAGES.indexOf(company.stage);
  const [openStage, setOpenStage] = useState<Stage | null>(company.stage);
  const [openStep, setOpenStep] = useState<string | null>(null);

  const unlockedSteps = steps.filter((s) => STAGES.indexOf(s.stage) <= currentIdx);
  const done = unlockedSteps.filter((s) => s.status === 'done').length;

  // The next stage only becomes unlockable once every step of the current
  // stage is done — you can't skip ahead with unfinished work behind you.
  const currentStageSteps = steps.filter((s) => s.stage === company.stage);
  const currentStageComplete = currentStageSteps.length > 0 && currentStageSteps.every((s) => s.status === 'done');

  const [unlocking, setUnlocking] = useState<Stage | null>(null);

  const unlockStage = async (stage: Stage): Promise<void> => {
    setUnlocking(stage);
    try {
      await callOp('/api/ops/stage-advance', { stage });
      setOpenStage(stage);
      toast.success(`${STAGE_LABELS[stage]} stage unlocked.`);
    } catch {
      /* surfaced by shell */
    } finally {
      setUnlocking(null);
    }
  };

  const attest = async (step: JourneyStep): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('journey_steps').update(step.id, { status: 'done', done_at: todayStr(), auto_done: false }),
      );
      toast.success('Step done. Nice progress.');
    } catch {
      /* surfaced by shell */
    }
  };

  const reopen = async (step: JourneyStep): Promise<void> => {
    await getPbClient()
      .call((pb) => pb.collection('journey_steps').update(step.id, { status: 'open', auto_done: false }))
      .catch(() => undefined);
  };

  const stepAction = (step: JourneyStep): React.JSX.Element | null => {
    if (step.status === 'done') {
      return step.auto_done ? null : (
        <Button variant="ghost" size="sm" onClick={() => void reopen(step)}>
          Undo
        </Button>
      );
    }
    if (step.kind === 'attest') {
      return (
        <Button size="sm" onClick={() => void attest(step)}>
          Mark as done
        </Button>
      );
    }
    const target: Page = step.module_key === 'profile' ? 'profile' : (step.module_key as Page);
    return (
      <Button size="sm" onClick={() => onNavigate(target)}>
        Do it now
      </Button>
    );
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader
        icon={Compass}
        title="Journey"
        subtitle="From idea to scale, one plain step at a time. Steps complete themselves when your records show the work is done. General guidance, not legal advice."
      />

      <div className="mb-7 flex items-center gap-3">
        <Progress value={unlockedSteps.length > 0 ? (done / unlockedSteps.length) * 100 : 0} className="h-1 flex-1" />
        <span className="whitespace-nowrap text-xs tabular-nums text-[var(--lui-muted)]">
          {done} of {unlockedSteps.length} steps
        </span>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--lui-muted)]">Loading…</p>
      ) : (
        <div className="relative">
          {/* the rail */}
          <span aria-hidden className="absolute bottom-6 left-[15px] top-2 w-px bg-[var(--lui-border)]" />
          <div className="flex flex-col gap-4">
            {STAGES.map((stage, idx) => {
              const stageSteps = steps.filter((s) => s.stage === stage);
              const locked = idx > currentIdx;
              const isNextStage = idx === currentIdx + 1;
              const nextUnlockable = isNextStage && currentStageComplete;
              const isCurrent = stage === company.stage;
              const stageDone = stageSteps.filter((s) => s.status === 'done').length;
              const complete = stageSteps.length > 0 && stageDone === stageSteps.length;
              const expanded = openStage === stage && !locked;
              const openStepsList = stageSteps.filter((s) => s.status === 'open');
              const focusStep = openStep !== null ? stageSteps.find((s) => s.id === openStep && s.status === 'open') : undefined;
              const expandedStep = focusStep ?? openStepsList[0];

              return (
                <section key={stage} className="relative pl-10">
                  {/* node — the next locked stage's lock is a click-to-unlock button */}
                  {nextUnlockable ? (
                    <button
                      type="button"
                      disabled={unlocking !== null}
                      onClick={() => void unlockStage(stage)}
                      title={`Unlock the ${STAGE_LABELS[stage]} stage`}
                      aria-label={`Unlock the ${STAGE_LABELS[stage]} stage`}
                      className={cn(
                        'group/lock absolute left-0 top-1.5 flex size-8 cursor-pointer items-center justify-center border bg-[var(--lui-surface)] transition-all',
                        'border-[var(--lui-accent)] text-[var(--lui-accent)] hover:bg-[var(--lui-accent)] hover:text-white',
                        'shadow-[0_0_0_3px_var(--lui-bg),0_0_0_4px_var(--lui-accent)] hover:shadow-[0_0_0_3px_var(--lui-bg),0_0_0_5px_var(--lui-accent)]',
                        'disabled:cursor-wait disabled:opacity-60',
                      )}
                    >
                      <Lock size={13} className="transition-transform group-hover/lock:-translate-y-px group-hover/lock:scale-110" />
                    </button>
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'absolute left-0 top-1.5 flex size-8 items-center justify-center border bg-[var(--lui-surface)]',
                        complete
                          ? 'border-emerald-500/60 bg-emerald-500 text-white'
                          : isCurrent
                            ? 'border-[var(--lui-accent)] text-[var(--lui-accent)] shadow-[0_0_0_3px_var(--lui-bg),0_0_0_4px_var(--lui-accent)]'
                            : locked
                              ? 'border-[var(--lui-border)] text-[var(--lui-muted)]/60'
                              : 'border-[var(--lui-border)] text-[var(--lui-muted)]',
                      )}
                    >
                      {complete ? (
                        <Check size={15} className="cos-pop" />
                      ) : locked ? (
                        <Lock size={13} />
                      ) : (
                        <span className="text-xs font-semibold tabular-nums">{idx + 1}</span>
                      )}
                    </span>
                  )}

                  <div
                    className={cn(
                      'border border-[var(--lui-border)] bg-[var(--lui-surface)]',
                      (isCurrent || nextUnlockable) && 'border-[var(--lui-accent)]/40',
                      locked && !nextUnlockable && 'opacity-55',
                    )}
                  >
                    {/* stage header */}
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => setOpenStage(expanded ? null : stage)}
                      className={cn(
                        'flex w-full items-center justify-between gap-3 px-4 py-3 text-left',
                        !locked && 'hover:bg-[var(--lui-border)]/15',
                      )}
                      aria-expanded={expanded}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h2 className="text-sm font-semibold">{STAGE_LABELS[stage]}</h2>
                          {isCurrent && (
                            <span className="bg-[var(--lui-accent)]/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--lui-accent)]">
                              You are here
                            </span>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-[var(--lui-muted)]">{STAGE_TAGLINES[stage]}</p>
                      </div>
                      <span className="flex shrink-0 items-center gap-2 text-xs tabular-nums text-[var(--lui-muted)]">
                        {nextUnlockable ? (
                          <span className="font-medium text-[var(--lui-accent)]">
                            {unlocking === stage ? 'Unlocking…' : 'Tap the lock to unlock'}
                          </span>
                        ) : isNextStage ? (
                          `Finish ${STAGE_LABELS[company.stage]} to unlock`
                        ) : locked ? (
                          `Unlocks after ${STAGE_LABELS[STAGES[idx - 1] ?? 'validate']}`
                        ) : (
                          <>
                            {stageDone}/{stageSteps.length}
                            {expanded ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
                          </>
                        )}
                      </span>
                    </button>

                    {/* steps */}
                    {expanded && (
                      <div className="border-t border-[var(--lui-border)]">
                        {stageSteps.map((step) => {
                          const isFocus = expandedStep !== undefined && step.id === expandedStep.id;
                          if (isFocus) {
                            return (
                              <div key={step.id} className="border-b border-[var(--lui-border)]/70 bg-[var(--lui-bg)]/50 px-4 py-3.5 last:border-0">
                                <div className="flex items-start gap-3">
                                  <span aria-hidden className="mt-0.5 size-4 shrink-0 border-2 border-[var(--lui-accent)]" />
                                  <div className="min-w-0 flex-1">
                                    <p className="text-sm font-medium">{step.title}</p>
                                    <p className="mt-1 text-xs leading-relaxed text-[var(--lui-muted)]">{step.why}</p>
                                    <div className="mt-2.5">{stepAction(step)}</div>
                                  </div>
                                </div>
                              </div>
                            );
                          }
                          const doneStep = step.status === 'done';
                          return (
                            <button
                              key={step.id}
                              type="button"
                              onClick={() => {
                                if (!doneStep) setOpenStep(step.id);
                              }}
                              className={cn(
                                'group flex w-full items-center justify-between gap-3 border-b border-[var(--lui-border)]/70 px-4 py-2.5 text-left last:border-0',
                                !doneStep && 'hover:bg-[var(--lui-border)]/15',
                              )}
                            >
                              <span className="flex min-w-0 items-center gap-3">
                                <span
                                  aria-hidden
                                  className={cn(
                                    'flex size-4 shrink-0 items-center justify-center border',
                                    doneStep
                                      ? 'border-emerald-500 bg-emerald-500 text-white'
                                      : 'border-[var(--lui-border)] group-hover:border-[var(--lui-muted)]',
                                  )}
                                >
                                  {doneStep && <Check size={11} />}
                                </span>
                                <span
                                  className={cn(
                                    'truncate text-[13px]',
                                    doneStep && 'text-[var(--lui-muted)] line-through decoration-[var(--lui-border)]',
                                  )}
                                >
                                  {step.title}
                                </span>
                                {doneStep && step.auto_done && (
                                  <span className="hidden shrink-0 text-[10px] text-[var(--lui-muted)] sm:inline">
                                    from your records
                                  </span>
                                )}
                              </span>
                              {doneStep && !step.auto_done && (
                                <span
                                  className="text-xs text-[var(--lui-muted)] opacity-0 transition-opacity group-hover:opacity-100"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    void reopen(step);
                                  }}
                                >
                                  Undo
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
