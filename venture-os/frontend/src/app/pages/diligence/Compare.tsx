/**
 * #/compare/:id: one comparison grid. The black action asks your AI agent
 * for every empty cell; its progress shows as a StepTrack above the grid.
 */
import { useState } from 'react';
import { Sparkle, Trash2 } from 'lucide-react';
import { CompareGrid, useGrid } from '../../components/diligence/CompareGrid.tsx';
import { GRID_READS } from '../../components/diligence/types.ts';
import { Button, Menu, MenuItem, PageBody, PageHeader, StepTrack, Tip, confirmAsk } from '../../components/ui.tsx';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import type { PageProps } from '../../lib/contract.ts';
import { act } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import { AgentSteps } from '../../components/agent.tsx';

export function ComparePage({ params }: PageProps): React.JSX.Element {
  const id = params['id'] ?? '';
  const me = useMe();
  const edit = can(me, 'diligence', 'edit');
  const live = useGrid(id);
  const g = live.data?.grid ?? null;
  const [busy, setBusy] = useState(false);
  const fill = async (): Promise<void> => {
    setBusy(true);
    await act([], () => op('compare.fill', { grid: id }), GRID_READS);
    setBusy(false);
  };
  const remove = async (): Promise<void> => {
    if (g === null || !(await confirmAsk(`Delete ${g.name}?`, 'Delete'))) return;
    const out = await act([], () => op<{ _activity?: string }>('compare.delete', { grid: id }), GRID_READS);
    if (out === null) return;
    const entry = out._activity ?? '';
    navigate('/');
    if (entry !== '') toast.undo('Grid deleted', () => void act([], () => op('activity.undo', { entry }), GRID_READS).then(() => navigate('/compare/' + id)));
  };
  return (
    <>
      <PageHeader title={g?.name ?? 'Grid'}>
        {edit && g !== null && (
          <div className="flex items-center gap-2">
            <Menu label="More">
              {(close) => (
                <MenuItem icon={Trash2} danger onClick={() => (close(), void remove())}>
                  Delete grid
                </MenuItem>
              )}
            </Menu>
            <Tip text="Fills every empty cell from the rooms and public sources">
              <Button variant="primary" icon={Sparkle} aria-label="Ask your AI agent" busy={busy} disabled={g.missing === 0 || g.working} onClick={() => void fill()}>
                <span className="max-md:hidden">Ask your AI agent</span>
              </Button>
            </Tip>
          </div>
        )}
      </PageHeader>
      <PageBody wide>
        {g !== null && g.working && g.step !== null && <AgentSteps track={g.step} className="w-[320px] max-w-full" />}
        <CompareGrid gridId={id} grid={g} />
      </PageBody>
    </>
  );
}
