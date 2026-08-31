/**
 * Settings (owner-only): label-left / control-right rows (Linear's settings
 * anatomy), module toggles that hide but never delete, and workflow rows
 * with last-run status dots. Stage changes always confirm.
 */
import { useState } from 'react';
import { Play, Settings as SettingsIcon } from 'lucide-react';
import {
  Button,
  Dialog,
  Input,
  Select,
  Switch,
  getPbClient,
  toast,
  useCollection,
} from '../../kit/index.ts';
import { callOp } from '../lib/ops.ts';
import type { Company, ModuleRow, Stage, WorkflowRun } from '../lib/types.ts';
import { STAGES, STAGE_LABELS } from '../lib/types.ts';
import { MODULE_META } from '../components/ActivateGate.tsx';
import { notifyModulesChanged } from '../lib/moduleEvents.ts';
import { Dot, PageHeader, Section } from '../components/ui.tsx';
import { todayStr } from '../lib/useCompany.ts';

const WORKFLOWS: ReadonlyArray<{ key: WorkflowRun['workflow']; name: string; blurb: string }> = [
  { key: 'weekly_digest', name: 'Weekly review digest', blurb: 'Compiles this week into a Note: money, numbers, priorities, issues.' },
  { key: 'journey_autocheck', name: 'Journey auto-check', blurb: 'Marks Journey steps done when your records show the work happened.' },
  { key: 'stage_check', name: 'Stage check', blurb: 'Suggests advancing the stage when your data has outgrown it.' },
  { key: 'attention_sweep', name: 'Attention sweep', blurb: 'Opens suggestion cards for overdue follow-ups and low runway.' },
];

function SettingRow({
  label,
  description,
  control,
}: {
  label: string;
  description?: string | undefined;
  control: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-[var(--lui-border)]/70 px-4 py-2.5 last:border-0">
      <div className="min-w-0 max-w-md">
        <p className="text-[13px] font-medium">{label}</p>
        {description !== undefined && <p className="mt-0.5 text-xs text-[var(--lui-muted)]">{description}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">{control}</div>
    </div>
  );
}

export function SettingsPage({ company }: { company: Company }): React.JSX.Element {
  const { records: modules } = useCollection<ModuleRow>('modules', { sort: 'key' });
  const { records: runs } = useCollection<WorkflowRun>('workflow_runs', { sort: '-created' });
  const [nameDraft, setNameDraft] = useState(company.name);
  const [pendingStage, setPendingStage] = useState<Stage | null>(null);
  const [runningKey, setRunningKey] = useState<string | null>(null);

  const saveName = async (): Promise<void> => {
    const trimmed = nameDraft.trim();
    if (trimmed === '' || trimmed === company.name) return;
    await getPbClient()
      .call((pb) => pb.collection('company').update(company.id, { name: trimmed }))
      .then(() => toast.success('Name updated'))
      .catch(() => undefined);
  };

  const toggleModule = async (row: ModuleRow, active: boolean): Promise<void> => {
    try {
      await getPbClient().call((pb) =>
        pb.collection('modules').update(row.id, {
          active,
          suggested: false,
          ...(active ? { activated_at: todayStr() } : {}),
        }),
      );
      notifyModulesChanged();
      toast.success(
        active
          ? `${MODULE_META[row.key].title} is now on`
          : `${MODULE_META[row.key].title} hidden. Its data is kept, not deleted.`,
      );
    } catch {
      /* surfaced by shell */
    }
  };

  const confirmStage = async (): Promise<void> => {
    if (pendingStage === null) return;
    try {
      await callOp('/api/ops/stage-advance', { stage: pendingStage });
      toast.success(`Stage set to ${STAGE_LABELS[pendingStage]}`);
      setPendingStage(null);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not change stage');
    }
  };

  const runWorkflow = async (key: WorkflowRun['workflow']): Promise<void> => {
    setRunningKey(key);
    try {
      await callOp('/api/ops/workflows-run', { workflow: key });
      toast.success('Workflow finished. See the result below.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Workflow failed');
    } finally {
      setRunningKey(null);
    }
  };

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Company basics, modules, and the built-in workflows." />

      <div className="flex flex-col gap-5">
        <Section title="Company" flush>
          <SettingRow
            label="Company name"
            control={
              <span className="flex items-center gap-1.5">
                <Input value={nameDraft} onChange={(e) => setNameDraft(e.target.value)} className="w-52" aria-label="Company name" />
                <Button size="sm" variant="secondary" disabled={nameDraft.trim() === company.name} onClick={() => void saveName()}>
                  Save
                </Button>
              </span>
            }
          />
          <SettingRow
            label="Stage"
            description="Unlocks or relocks Journey steps and adjusts suggested modules. Never deletes anything."
            control={
              <Select
                aria-label="Stage"
                options={STAGES.map((s) => ({ value: s, label: STAGE_LABELS[s] }))}
                value={company.stage}
                onChange={(e) => {
                  const next = e.target.value as Stage;
                  if (next !== company.stage) setPendingStage(next);
                }}
                className="w-44"
              />
            }
          />
          <SettingRow
            label="Owner"
            description="The first person who completed onboarding. Money and Settings are visible to the owner only."
            control={<span className="text-xs text-[var(--lui-muted)]">{company.owner !== '' ? 'recorded' : 'not recorded yet'}</span>}
          />
        </Section>

        <Section title="Modules" flush>
          <p className="border-b border-[var(--lui-border)]/70 px-4 py-2.5 text-xs text-[var(--lui-muted)]">
            Turning a module off hides its page. Every record is kept and returns when you turn it back on.
          </p>
          {modules.map((m) => (
            <SettingRow
              key={m.id}
              label={MODULE_META[m.key].title}
              description={MODULE_META[m.key].pitch}
              control={
                <Switch
                  checked={m.active}
                  onCheckedChange={(c) => void toggleModule(m, c)}
                  aria-label={`Toggle ${MODULE_META[m.key].title}`}
                />
              }
            />
          ))}
        </Section>

        <Section title="Workflows" flush>
          <p className="border-b border-[var(--lui-border)]/70 px-4 py-2.5 text-xs text-[var(--lui-muted)]">
            Deterministic routines that run daily in the background, or right now on demand. Everything they produce stays inside the app.
          </p>
          {WORKFLOWS.map((w) => {
            const last = runs.find((r) => r.workflow === w.key);
            return (
              <SettingRow
                key={w.key}
                label={w.name}
                description={
                  last !== undefined
                    ? `${w.blurb} Last run ${last.finished !== '' ? last.finished.slice(0, 16) : ''}: ${last.status === 'ok' ? last.summary : `failed, ${last.summary}`}`
                    : w.blurb
                }
                control={
                  <span className="flex items-center gap-2">
                    {last !== undefined && <Dot tone={last.status === 'ok' ? 'good' : 'bad'} />}
                    <Button size="sm" variant="secondary" loading={runningKey === w.key} onClick={() => void runWorkflow(w.key)}>
                      <Play size={13} aria-hidden />
                      Run
                    </Button>
                  </span>
                }
              />
            );
          })}
        </Section>

        <Section title="About">
          <p className="text-xs leading-relaxed text-[var(--lui-muted)]">
            Company OS keeps your records and guides your next step. It never sends, posts, or pays anything on its
            own, and its formation guidance is general information, not legal or tax advice. CraftBot, connected as
            your agent, can operate everything here on your behalf.
          </p>
        </Section>
      </div>

      <Dialog
        open={pendingStage !== null}
        onOpenChange={(open) => {
          if (!open) setPendingStage(null);
        }}
        title={pendingStage !== null ? `Change stage to ${STAGE_LABELS[pendingStage]}?` : 'Change stage'}
        description="Journey steps and module suggestions follow the stage. Nothing is deleted."
        footer={
          <>
            <Button variant="secondary" onClick={() => setPendingStage(null)}>
              Cancel
            </Button>
            <Button onClick={() => void confirmStage()}>Change stage</Button>
          </>
        }
      >
        <span />
      </Dialog>
    </div>
  );
}
