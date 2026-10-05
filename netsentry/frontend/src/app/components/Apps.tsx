/**
 * App visuals (plan §9): an app's icon by category, its tile with four outcome
 * dots (reach · updates · backups · up), and the "who should reach it" chooser.
 */
import { useState } from 'react';
import { Button, toast } from '../../kit/index.ts';
import { useCollection } from '../store/collections.ts';
import { OUTCOMES, reachChoices, outcomeState, stateTone, stateWord, appName } from '../lib/apps.ts';
import { runOp } from '../lib/ops.ts';
import type { AppRecord, EvaluationRecord, Reach, Settings } from '../lib/types.ts';
import { BoxIcon, BriefcaseIcon, DownloadIcon, FilmIcon, FolderIcon, HouseIcon } from './icons.tsx';
import { TONE_COLOR } from './visual.tsx';

const CATEGORY_ICON: Record<string, (p: { size?: number }) => React.JSX.Element> = {
  media: FilmIcon,
  download: DownloadIcon,
  home: HouseIcon,
  files: FolderIcon,
  business: BriefcaseIcon,
};

export function AppIcon({ category, size = 26 }: { category: string; size?: number }): React.JSX.Element {
  const I = CATEGORY_ICON[category] ?? BoxIcon;
  return <I size={size} />;
}

/** reach · updates · backups · up, as four coloured dots with words for screen readers. */
export function OutcomeDots({ evals }: { evals: EvaluationRecord[] }): React.JSX.Element {
  const shown = OUTCOMES.filter((o) => o.key !== 'security');
  return (
    <span className="inline-flex items-center gap-1" aria-label={shown.map((o) => `${o.label}: ${stateWord(outcomeState(evals, o.key).state)}`).join(', ')}>
      {shown.map((o) => {
        const s = outcomeState(evals, o.key).state;
        return <span key={o.key} title={`${o.label}: ${stateWord(s)}`} className="h-2 w-2 rounded-full" style={{ background: s === 'none' ? 'var(--agent-app-border)' : TONE_COLOR[stateTone(s)] }} />;
      })}
    </span>
  );
}

export function AppTile({ app, category, machine, evals, onClick }: { app: AppRecord; category: string; machine: string; evals: EvaluationRecord[]; onClick: () => void }): React.JSX.Element {
  const failing = evals.filter((e) => e.state === 'fail').length;
  const tone = failing ? (evals.some((e) => e.state === 'fail' && (e.severity === 'critical' || e.severity === 'high')) ? 'bad' : 'warn') : 'good';
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[112px] flex-col justify-between rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)] p-3 text-left transition-colors hover:bg-[var(--agent-app-surface-2)]"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="text-[var(--agent-app-muted)]">
          <AppIcon category={category} />
        </span>
        <span className="h-2.5 w-2.5 rounded-full" style={{ background: TONE_COLOR[tone] }} aria-hidden />
      </span>
      <span>
        <span className="block truncate text-[14px] font-medium">{appName(app)}</span>
        <span className="block truncate text-[12px] text-[var(--agent-app-muted)]">
          {failing ? `${failing} to look at` : 'All good'} · {machine}
        </span>
        <span className="mt-1 block">
          <OutcomeDots evals={evals} />
        </span>
      </span>
    </button>
  );
}

/** "Who should be able to open this?" — the person decides; NetSentry judges reachability against it. */
export function ReachChooser({ app, current, source, onSaved, canEdit, cloud }: { app: AppRecord; current: Reach; source: string; onSaved?: () => void; canEdit: boolean; cloud?: boolean }): React.JSX.Element {
  const [value, setValue] = useState<Reach>(current);
  const choices = reachChoices(cloud ? 'vpc' : 'local');
  const [busy, setBusy] = useState(false);
  const dirty = value !== current || source === 'default';
  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const r = await runOp<{ message: string }>('apps.set-intent', { app_id: app.id, reach: value });
      toast.success(r.message);
      onSaved?.();
    } catch {
      /* toast shown */
    } finally {
      setBusy(false);
    }
  };
  return (
    <fieldset className="flex flex-col gap-2" disabled={!canEdit}>
      <legend className="mb-1 text-[14px] font-medium">Who should be able to open {appName(app)}?</legend>
      {choices.map((c) => (
        <label key={c.key} className={`flex cursor-pointer items-start gap-3 rounded-lg border p-3 ${value === c.key ? 'border-[var(--agent-app-accent)]' : 'border-[var(--agent-app-border)]'}`}>
          <input type="radio" name={`reach-${app.id}`} className="mt-1" checked={value === c.key} onChange={() => setValue(c.key)} />
          <span>
            <span className="block text-[14px]">{c.label}</span>
            <span className="block text-[12px] text-[var(--agent-app-muted)]">{c.hint}</span>
          </span>
        </label>
      ))}
      {source === 'default' && <p className="text-[12px] text-[var(--agent-app-muted)]">This is our suggestion for this kind of app — confirm it or pick another.</p>}
      {canEdit && dirty && (
        <div>
          <Button loading={busy} onClick={() => void save()}>
            {source === 'default' && value === current ? 'Confirm' : 'Save'}
          </Button>
        </div>
      )}
    </fieldset>
  );
}
