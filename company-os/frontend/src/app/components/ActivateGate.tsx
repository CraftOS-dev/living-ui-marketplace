/**
 * Shown when navigation lands on a module that is not active yet (e.g. via a
 * Journey link). One-click, user-invoked activation, modules never turn on
 * silently. Deactivation hides pages but never deletes data (Settings).
 */
import { useState } from 'react';
import { Button, getPbClient, toast } from '../../kit/index.ts';
import type { ModuleKey, ModuleRow, Vocab } from '../lib/types.ts';
import { useCollection } from '../../kit/index.ts';
import { EmptyHint } from './ui.tsx';
import { notifyModulesChanged } from '../lib/moduleEvents.ts';
import { todayStr } from '../lib/useCompany.ts';

export const MODULE_META: Record<ModuleKey, { title: string; pitch: string }> = {
  customers: {
    title: 'Customers',
    pitch: 'Keep everyone you sell to in one place, with a simple pipeline and follow-up dates.',
  },
  money: {
    title: 'Money',
    pitch: 'Money in, money out, cash on hand, and how many months you have at the current pace.',
  },
  kanban: {
    title: 'Kanban',
    pitch: 'A board to move work across To Do, In Progress, and Done — each card with a due date, an owner, a checklist, notes, and files.',
  },
  goals: {
    title: 'Goals',
    pitch: 'This year’s goals, quarterly priorities with owners, and a weekly numbers scorecard.',
  },
  team: {
    title: 'Team',
    pitch: 'Your people, the seats they fill, and later a simple hiring pipeline.',
  },
  meetings: {
    title: 'Meetings',
    pitch: 'A weekly rhythm with a fixed agenda, notes, and a persistent issues list.',
  },
  processes: {
    title: 'Processes',
    pitch: 'How you do things, written down simply, so quality repeats and others can help.',
  },
  marketing: {
    title: 'Marketing',
    pitch: 'Campaigns with budgets and targets, a content calendar, your channel spend mix, and plain readings like cost per customer and return on spend.',
  },
};

export function ActivateGate({
  moduleKey,
  vocab,
  suggested,
}: {
  moduleKey: ModuleKey;
  vocab: Vocab;
  suggested: boolean;
}): React.JSX.Element {
  const { records } = useCollection<ModuleRow>('modules');
  const [busy, setBusy] = useState(false);
  const meta = MODULE_META[moduleKey];
  const title = moduleKey === 'customers' ? vocab.customer_many : meta.title;

  const activate = async (): Promise<void> => {
    const row = records.find((r) => r.key === moduleKey);
    if (row === undefined) return;
    setBusy(true);
    try {
      await getPbClient().call((pb) =>
        pb
          .collection('modules')
          .update(row.id, { active: true, suggested: false, activated_at: todayStr() }),
      );
      notifyModulesChanged();
      toast.success(`${title} is now on`);
    } catch {
      /* surfaced by shell */
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="py-10">
      <EmptyHint
        title={`${title} is not turned on yet`}
        message={
          meta.pitch + (suggested ? ' It is recommended for your current stage.' : '')
        }
        action={
          <Button loading={busy} onClick={() => void activate()}>
            Turn on {title}
          </Button>
        }
      />
    </div>
  );
}
