/** Parts as a dense table: thumbnail, name, state, size, mass, features, last change. */
import type { ReactNode } from 'react';
import { Pin, Sparkles } from 'lucide-react';
import { ago, mass, volume } from '../lib/format.ts';
import type { Unit } from '../lib/format.ts';
import { navigate } from '../lib/router.ts';
import type { Part } from '../lib/types.ts';
import { Thumb, partSize, partStatus } from './PartCard.tsx';
import { Badge } from './ui.tsx';

export function PartsTable({ parts, unit, actions, compact = false }: { parts: Part[]; unit: Unit; actions?: (p: Part) => ReactNode; compact?: boolean }): React.JSX.Element {
  return (
    <div className="overflow-x-auto">
      <table className="cw-table">
        <thead>
          <tr>
            <th className="w-[56px]">
              <span className="sr-only">Picture</span>
            </th>
            <th>Name</th>
            <th>State</th>
            <th className="hidden sm:table-cell">Size</th>
            <th className="hidden text-right md:table-cell">Mass</th>
            {!compact && <th className="hidden text-right lg:table-cell">Features</th>}
            <th className="hidden text-right sm:table-cell">Changed</th>
            {actions !== undefined && (
              <th className="w-10">
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {parts.map((p) => {
            const st = partStatus(p);
            return (
              <tr key={p.id} className="cursor-pointer" onClick={() => navigate('part', { id: p.id })}>
                <td>
                  <Thumb p={p} className="h-8 w-10" />
                </td>
                <td className="w-full min-w-[160px] max-w-0">
                  <span className="flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        navigate('part', { id: p.id });
                      }}
                      className="truncate text-left text-[13px] font-bold hover:underline"
                    >
                      {p.name}
                    </button>
                    {p.pinned && <Pin size={12} aria-label="Pinned" className="shrink-0 text-[var(--cw-muted)]" />}
                    {p.origin === 'agent' && <Sparkles size={12} aria-label="Started by your AI agent" className="shrink-0 text-[var(--cw-accent-text)]" />}
                  </span>
                  {p.description !== '' && !compact && <span className="block truncate text-[12px] text-[var(--cw-muted)]">{p.description}</span>}
                </td>
                <td>
                  <Badge tone={st.tone} pulse={st.pulse}>
                    {st.label}
                  </Badge>
                </td>
                <td className="num hidden whitespace-nowrap text-[12px] sm:table-cell">{partSize(p, unit)}</td>
                <td className="num hidden whitespace-nowrap text-right text-[12px] md:table-cell">{p.mass_g !== null ? mass(p.mass_g) : p.volume_mm3 !== null ? volume(p.volume_mm3, unit) : ''}</td>
                {!compact && <td className="num hidden text-right text-[12px] lg:table-cell">{p.features ?? 0}</td>}
                <td className="num hidden whitespace-nowrap text-right text-[12px] text-[var(--cw-muted)] sm:table-cell">{ago(p.updated)}</td>
                {actions !== undefined && (
                  <td onClick={(e) => e.stopPropagation()} className="text-right">
                    {actions(p)}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
