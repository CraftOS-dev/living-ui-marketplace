/**
 * Compare: the comparison grids made from this thesis's maps, shown with
 * diligence's own grid (companies as rows, questions as columns, cited
 * cells; components/diligence/CompareGrid.tsx). compare.list keeps the
 * grids whose market_ref is one of the thesis's maps (or the thesis);
 * chips switch between them, the newest opens first. A new grid starts from
 * a selection on the map (compareCompanies stores the map as market_ref).
 */
import { ExternalLink, LayoutGrid, Table2 } from 'lucide-react';
import { CompareGrid } from '../diligence/CompareGrid.tsx';
import { Button, ChipPicker, Empty, IconButton, LoadError, Skeleton } from '../ui.tsx';
import { useOp } from '../../lib/live.ts';
import { go, setQuery } from '../../lib/router.ts';
import type { MapSummary, ThesisTile } from './types.ts';

interface GridRow {
  id: string;
  name: string;
  origin: string;
  market_ref: string;
  rows: number;
  columns: number;
  updated: string;
}

export function GridTab({ thesis, chosen, onGoMap }: { thesis: ThesisTile; chosen: string; onGoMap: () => void }): React.JSX.Element {
  const maps = useOp<{ maps: MapSummary[] }>('maps.list', { thesis: thesis.id }, ['maps'], { name: 'markets.maps' });
  const refs = [thesis.id, ...(maps.data?.maps ?? []).map((m) => m.id)];
  const grids = useOp<{ grids: GridRow[] }>('compare.list', { market_ref: refs, origin: 'markets', limit: 200 }, ['compare_grids'], { name: 'markets.grids', skip: maps.data === null });
  if (maps.data === null || grids.data === null) {
    const err = maps.error ?? grids.error;
    return err !== null ? <LoadError message={err} onRetry={maps.data === null ? maps.reload : grids.reload} /> : <Skeleton className="h-40 w-full" />;
  }
  const rows = grids.data.grids;
  const cur = rows.find((g) => g.id === chosen) ?? rows[0];
  if (cur === undefined)
    return (
      <Empty
        icon={Table2}
        title="Pick companies on the market map to compare them side by side here"
        action={
          <Button icon={LayoutGrid} onClick={onGoMap}>
            Open the market map
          </Button>
        }
      />
    );
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <ChipPicker label="Comparisons" value={cur.id} onChange={(id) => setQuery({ grid: id })} options={rows.slice(0, 6).map((g) => ({ value: g.id, label: g.name }))} className="min-w-0 flex-1" />
        <IconButton icon={ExternalLink} label="Open this comparison on its own page" onClick={() => go(`#/compare/${cur.id}`)} />
      </div>
      <CompareGrid key={cur.id} gridId={cur.id} />
    </div>
  );
}
