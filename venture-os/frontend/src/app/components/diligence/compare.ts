/**
 * Making a comparison grid from another module's screen, then opening it:
 *
 *   deals table selection bar:  <Button onClick={() => void compareDeals(selectedIds)}>Compare</Button>
 *   markets map selection:      void compareCompanies(companyIds, 'markets', mapId)   (market_ref = mapId)
 *
 * compare.list --market_ref <id> (or a JSON list of ids) lists the grids made from a map or thesis.
 *
 * Empty cells are asked of your AI agent at once (compare.save fills them).
 */
import { op } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { navigate } from '../../lib/router.ts';
import { GRID_READS } from './types.ts';

export async function compareDeals(dealIds: string[], columns?: string[]): Promise<void> {
  const out = await act([], () => op<{ grid: { id: string } }>('compare.save', columns !== undefined ? { deals: dealIds, columns } : { deals: dealIds }), GRID_READS);
  if (out !== null) navigate('/compare/' + out.grid.id);
}

/** marketRef: the map (or thesis) id the grid is made from; stored as the grid's market_ref. */
export async function compareCompanies(companyIds: string[], origin: 'markets' | 'manual' = 'markets', marketRef = ''): Promise<void> {
  const out = await act([], () => op<{ grid: { id: string } }>('compare.save', marketRef !== '' ? { companies: companyIds, origin, market_ref: marketRef } : { companies: companyIds, origin }), GRID_READS);
  if (out !== null) navigate('/compare/' + out.grid.id);
}
