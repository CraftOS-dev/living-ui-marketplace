/**
 * The comparison grid (Hebbia's matrix): companies as rows (sticky first
 * column), questions as columns, each cell an answer with its grade and
 * citation. Proposed cells carry your AI agent's mark and confirm or reject
 * on hover. Markets shows the same component for a map selection:
 *
 *   import { CompareGrid } from '../../components/diligence/CompareGrid.tsx';
 *   <CompareGrid gridId={id} />
 *
 * and makes a grid with compareCompanies() (components/diligence/compare.ts).
 */
import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { op } from '../../lib/api.ts';
import { can, useMe } from '../../lib/auth.ts';
import { act, useOp } from '../../lib/live.ts';
import type { Live } from '../../lib/live.ts';
import { Avatar, Empty, IconButton, LoadError, Menu, MenuItem, MenuLabel, Skeleton } from '../ui.tsx';
import { ReaderSheet } from './Reader.tsx';
import { AnswerValue, DecideButtons, shown } from './parts.tsx';
import type { Cite, Grid, GridCell, ReadTarget, Template } from './types.ts';
import { GRID_READS } from './types.ts';

export function useGrid(gridId: string, skip = false): Live<{ grid: Grid }> {
  return useOp<{ grid: Grid }>('compare.get', { grid: gridId }, GRID_READS, { name: 'compare.get', skip });
}

export function CompareGrid({ gridId, grid: given }: { gridId: string; grid?: Grid | null | undefined }): React.JSX.Element {
  const me = useMe();
  const edit = can(me, 'diligence', 'edit');
  const live = useGrid(gridId, given !== undefined);
  const g = given ?? live.data?.grid ?? null;
  const [reading, setReading] = useState<ReadTarget | null>(null);
  if (g === null) return live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Skeleton className="h-64 w-full" />;
  const open = (c: Cite, cell: GridCell, question: string): void => setReading({ cite: c, question, answer: cell.id !== undefined && cell.status !== undefined ? { id: cell.id, value: shown({ type: cell.type, raw: cell.raw, unit: cell.unit, value: cell.value ?? '' }), status: cell.status, grade: cell.grade ?? 'unknown' } : undefined });
  const removeColumn = (key: string): void => void act([], () => op('compare.save', { grid: g.id, columns: g.columns.filter((c) => c.key !== key).map((c) => (c.key.startsWith('c_') ? { key: c.key, text: c.text, type: c.type, unit: c.unit } : c.key)), fill: false }), GRID_READS);
  if (g.rows.length === 0) return <Empty icon={Plus} title="No companies" />;
  return (
    <div className="vo-panel vo-in vo-scroll relative min-w-0 overflow-auto">
      <table className="w-max min-w-full border-separate border-spacing-0 text-[13px]">
        <thead>
          <tr>
            <th scope="col" className="sticky left-0 top-0 z-[3] h-10 min-w-[180px] border-b border-r border-[var(--vo-line)] bg-[var(--vo-raised)] px-4 text-left align-middle">
              <span className="vo-label">Company</span>
            </th>
            {g.columns.map((c) => (
              <th key={c.key} scope="col" className="group sticky top-0 z-[2] h-10 min-w-[140px] max-w-[220px] border-b border-[var(--vo-line)] bg-[var(--vo-raised)] px-3 text-left align-middle font-medium">
                <span className="flex items-center gap-1">
                  <span className="vo-wrap min-w-0 flex-1 text-[12px] leading-4 text-[var(--vo-ink-2)]">{c.text}</span>
                  {edit && g.columns.length > 1 && (
                    <span className="opacity-0 transition-opacity duration-150 focus-within:opacity-100 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
                      <IconButton icon={X} label="Remove column" size={24} onClick={() => removeColumn(c.key)} />
                    </span>
                  )}
                </span>
              </th>
            ))}
            {edit && (
              <th scope="col" className="sticky top-0 z-[2] h-10 w-12 border-b border-[var(--vo-line)] bg-[var(--vo-raised)] px-2 align-middle">
                <AddColumn grid={g} />
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {g.rows.map((r) => (
            <tr key={r.company.id} className="group/row">
              <th scope="row" className="sticky left-0 z-[1] min-w-[180px] border-b border-r border-[var(--vo-hair)] bg-[var(--vo-raised)] px-4 py-2 text-left align-middle font-normal transition-colors duration-150 group-hover/row:bg-[var(--vo-hover)]">
                {r.deal !== null ? (
                  <a href={`#/deals/${r.deal.number}?tab=diligence`} className="vo-focus vo-tap flex min-w-0 items-center gap-2 rounded-[3px] hover:underline">
                    <Avatar name={r.company.name} size={22} square />
                    <span className="vo-wrap min-w-0 font-medium">{r.company.name}</span>
                  </a>
                ) : (
                  <span className="flex min-w-0 items-center gap-2">
                    <Avatar name={r.company.name} size={22} square />
                    <span className="vo-wrap min-w-0 font-medium">{r.company.name}</span>
                  </span>
                )}
              </th>
              {r.cells.map((cell, i) => {
                const col = g.columns[i];
                return (
                  <td key={col?.key ?? i} className="group min-w-[140px] border-b border-[var(--vo-hair)] px-3 py-2 align-middle transition-colors duration-150 group-hover/row:bg-[var(--vo-hover)]">
                    <Cell cell={cell} edit={edit} onOpen={(c) => cell !== null && open(c, cell, `${r.company.name}: ${col?.text ?? ''}`)} />
                  </td>
                );
              })}
              {edit && <td className="border-b border-[var(--vo-hair)] group-hover/row:bg-[var(--vo-hover)]" />}
            </tr>
          ))}
        </tbody>
      </table>
      <ReaderSheet target={reading} onClose={() => setReading(null)} />
    </div>
  );
}

function Cell({ cell, edit, onOpen }: { cell: GridCell | null; edit: boolean; onOpen: (c: Cite) => void }): React.JSX.Element {
  if (cell === null || cell.id === undefined || cell.status === undefined) return <span aria-label="Empty" title="Empty" className="inline-block size-2 rounded-full border-[1.5px] border-dashed border-[var(--vo-line-2)]" />;
  const a = { type: cell.type, raw: cell.raw, unit: cell.unit, value: cell.value ?? '', grade: cell.grade ?? 'unknown', status: cell.status, cites: cell.cites ?? [], sources: cell.sources ?? [], formula: cell.formula };
  return (
    <span className="flex min-w-0 items-center justify-between gap-2">
      <AnswerValue a={a} onOpen={onOpen} className="justify-start" />
      {edit && cell.status === 'agent_proposed' && <DecideButtons id={cell.id} reads={GRID_READS} />}
    </span>
  );
}

/** Add a checklist question as a column. */
function AddColumn({ grid }: { grid: Grid }): React.JSX.Element {
  const tpls = useOp<{ templates: Template[] }>('dd.templates', { full: true }, ['dd_templates'], { name: 'dd.templates.full' });
  const have = new Set(grid.columns.map((c) => c.key));
  const add = (key: string): void => void act([], () => op('compare.save', { grid: grid.id, columns: [...grid.columns.map((c) => (c.key.startsWith('c_') ? { key: c.key, text: c.text, type: c.type, unit: c.unit } : c.key)), key] }), GRID_READS);
  const seen = new Set<string>();
  const t = tpls.data?.templates ?? [];
  return (
    <Menu label="Add column" icon={Plus} width={280}>
      {(close) => (
        <div className={cn('vo-scroll max-h-[360px] overflow-y-auto')}>
          {t.map((tpl) => {
            const qs = (tpl.questions ?? []).filter((q) => !have.has(q.key) && !seen.has(q.key));
            qs.forEach((q) => seen.add(q.key));
            if (qs.length === 0) return null;
            return (
              <div key={tpl.key}>
                <MenuLabel>{tpl.name}</MenuLabel>
                {qs.map((q) => (
                  <MenuItem key={q.key} onClick={() => (close(), add(q.key))}>
                    {q.text}
                  </MenuItem>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </Menu>
  );
}
