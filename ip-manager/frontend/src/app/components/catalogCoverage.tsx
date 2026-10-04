/**
 * Trademark coverage for one property: every mark, each Nice class under
 * it, one column per jurisdiction. Cells show the state of protection and
 * open the registration; gaps list class and country pairs covered
 * elsewhere but not here.
 */
import { Fragment, useMemo } from 'react';
import { Grid3x3, Info, TriangleAlert } from 'lucide-react';
import { Button, cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveAsync } from '../lib/live.ts';
import { STATUS_LABEL, jurisdictionName } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { MatterStatus, StatusGroup } from '../lib/types.ts';
import { EmptyHint, ErrorBox, JurChip, Loading, Notice, Ref, Section, StatTile, TONE_BG, TONE_TEXT } from './ui.tsx';

/** Short headings of the 45 Nice classes (12th edition). */
export const NICE_CLASS_SHORT: Record<number, string> = {
  1: 'Chemicals',
  2: 'Paints, coatings',
  3: 'Cosmetics, cleaning products',
  4: 'Oils, fuels, candles',
  5: 'Pharmaceuticals',
  6: 'Common metals',
  7: 'Machines, motors',
  8: 'Hand tools, cutlery',
  9: 'Software, electronics',
  10: 'Medical devices',
  11: 'Lighting, heating, appliances',
  12: 'Vehicles',
  13: 'Firearms, fireworks',
  14: 'Jewellery, watches',
  15: 'Musical instruments',
  16: 'Paper, printed matter',
  17: 'Rubber, plastics, insulation',
  18: 'Leather goods, bags',
  19: 'Building materials (non-metal)',
  20: 'Furniture',
  21: 'Housewares, glassware',
  22: 'Ropes, tents, fibres',
  23: 'Yarns and threads',
  24: 'Textiles, bed and table linen',
  25: 'Clothing',
  26: 'Lace, ribbons, haberdashery',
  27: 'Carpets, wall coverings',
  28: 'Toys and games',
  29: 'Meat, dairy, preserved foods',
  30: 'Coffee, bakery, confectionery',
  31: 'Fresh produce, animals',
  32: 'Beers, soft drinks',
  33: 'Wines, spirits',
  34: 'Tobacco, smokers’ articles',
  35: 'Advertising, business, retail',
  36: 'Insurance, finance, real estate',
  37: 'Construction, repair',
  38: 'Telecommunications',
  39: 'Transport, travel',
  40: 'Treatment of materials',
  41: 'Education and entertainment',
  42: 'Science, technology, software services',
  43: 'Restaurants, lodging',
  44: 'Medical, beauty, farming services',
  45: 'Legal, security, personal services',
};

export function niceShort(c: number): string {
  return NICE_CLASS_SHORT[c] ?? '';
}

interface CoverageCell {
  status: string;
  group: StatusGroup | '';
  matter: string;
  ref: string;
}

export interface CoverageResponse {
  jurisdictions: string[];
  classes: number[];
  marks: { family: string; title: string; cells: Record<string, CoverageCell> }[];
  counts: { patent: number; design: number; copyright: number; trademark: number };
}

const CLASS_STATUS_LABEL: Record<string, string> = {
  refused: 'Refused',
  partially_refused: 'Partly refused',
  deleted: 'Deleted',
  cancelled: 'Cancelled',
  registered: 'Registered',
  pending: 'Pending',
};

function look(cell: CoverageCell): { tone: Tone; label: string } {
  if (cell.group === 'live') {
    return cell.status === 'partially_refused' ? { tone: 'warn', label: 'Partly refused' } : { tone: 'good', label: 'Registered' };
  }
  if (cell.group === 'pending') return { tone: 'info', label: 'Pending' };
  if (cell.group === 'pre_filing') return { tone: 'neutral', label: 'To file' };
  const label = CLASS_STATUS_LABEL[cell.status] ?? STATUS_LABEL[cell.status as MatterStatus] ?? 'Lapsed';
  return { tone: 'neutral', label: label === 'Registered' || label === 'Pending' ? 'Lapsed' : label };
}

function covered(cell: CoverageCell | undefined): boolean {
  return cell !== undefined && (cell.group === 'live' || cell.group === 'pending');
}

function Cell({ cell }: { cell: CoverageCell | undefined }): React.JSX.Element {
  if (cell === undefined) {
    return (
      <span className="flex h-7 items-center justify-center whitespace-nowrap border border-dashed border-[var(--agent-app-border)] px-1.5 text-[11px] text-[var(--agent-app-muted)]">
        Not filed
      </span>
    );
  }
  const { tone, label } = look(cell);
  return (
    <a
      href={href('matter', cell.matter)}
      title={`${cell.ref || 'Registration'}: ${label}. Open the registration.`}
      className={cn(
        'flex h-7 items-center justify-center whitespace-nowrap px-1.5 text-[11px] font-medium outline-offset-1 hover:outline hover:outline-1 hover:outline-[var(--agent-app-accent)]',
        TONE_BG[tone],
        TONE_TEXT[tone],
        cell.group === 'dead' && 'line-through decoration-1',
      )}
    >
      {label}
    </a>
  );
}

interface Gap {
  mark: string;
  family: string;
  cls: number;
  missing: string[];
  have: string[];
}

export interface RightCount {
  label: string;
  value: number;
  sub: string;
}

/**
 * `counts` are the property's rights by type as the page counts them (its
 * own and through their family), so the numbers match the Overview tab.
 */
export function CoverageMatrix({ propertyId, refreshKey, counts: rightCounts }: { propertyId: string; refreshKey: string; counts: RightCount[] }): React.JSX.Element {
  const { vocab, can } = useApp();
  const cov = useLiveAsync(() => op<CoverageResponse>('properties/coverage', { property_id: propertyId }), [propertyId, refreshKey], ['matters', 'families', 'goods_services']);
  const data = cov.data;

  const analysis = useMemo(() => {
    if (data === null) return { gaps: [] as Gap[], unknown: [] as { mark: string; jur: string; cell: CoverageCell }[] };
    const gaps: Gap[] = [];
    const unknown: { mark: string; jur: string; cell: CoverageCell }[] = [];
    for (const m of data.marks) {
      const classes = classesOf(m.cells);
      const unknownJ = new Set<string>();
      for (const j of data.jurisdictions) {
        const star = m.cells[`*|${j}`];
        if (star !== undefined && covered(star)) {
          unknownJ.add(j);
          unknown.push({ mark: m.title, jur: j, cell: star });
        }
      }
      for (const c of classes) {
        const have = data.jurisdictions.filter((j) => covered(m.cells[`${c}|${j}`]));
        if (have.length === 0) continue;
        const missing = data.jurisdictions.filter((j) => !covered(m.cells[`${c}|${j}`]) && !unknownJ.has(j));
        if (missing.length > 0) gaps.push({ mark: m.title, family: m.family, cls: c, missing, have });
      }
    }
    return { gaps, unknown };
  }, [data]);

  if (cov.loading && data === null) return <Loading label="Working out coverage" />;
  if (cov.error !== null && data === null) return <ErrorBox message={cov.error} onRetry={cov.reload} />;
  if (data === null) return <Loading />;

  const counts = (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {rightCounts.map((c) => (
        <StatTile key={c.label} label={c.label} value={c.value} sub={c.sub} />
      ))}
    </div>
  );

  if (data.marks.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {counts}
        <Section title="Trademark coverage">
          <EmptyHint
            compact
            icon={Grid3x3}
            title={`No trademarks linked to this ${vocab.property.toLowerCase()}`}
            message={`Coverage appears once a trademark (a mark with registrations in one or more countries) is linked to this ${vocab.property.toLowerCase()}.`}
            action={
              can.edit ? (
                <Button size="sm" onClick={() => (window.location.hash = href('trademarks', undefined, { new: '1' }))}>
                  New trademark
                </Button>
              ) : undefined
            }
          />
        </Section>
      </div>
    );
  }

  const cols = data.jurisdictions;
  return (
    <div className="flex flex-col gap-4">
      {counts}
      <Section title="Trademark coverage" meta={`${data.marks.length} mark${data.marks.length === 1 ? '' : 's'}, ${data.classes.length} class${data.classes.length === 1 ? '' : 'es'}, ${cols.length} jurisdiction${cols.length === 1 ? '' : 's'}`} flush>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                <th className="min-w-[220px] px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">Mark and class</th>
                {cols.map((j) => (
                  <th key={j} className="min-w-[96px] px-1.5 py-2 text-center" title={jurisdictionName(j)}>
                    <JurChip code={j} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.marks.map((m) => {
                const classes = classesOf(m.cells);
                const hasStar = cols.some((j) => m.cells[`*|${j}`] !== undefined);
                return (
                  <Fragment key={m.family}>
                    <tr className="border-b border-[var(--agent-app-border)]/70 bg-[var(--agent-app-border)]/10">
                      <td colSpan={cols.length + 1} className="px-3 py-1.5">
                        <a href={href('family', m.family)} className="text-[13px] font-semibold hover:underline">
                          {m.title}
                        </a>
                      </td>
                    </tr>
                    {classes.map((c) => (
                      <tr key={`${m.family}-${c}`} className="border-b border-[var(--agent-app-border)]/50">
                        <td className="px-3 py-1.5">
                          <span className="inline-flex items-baseline gap-2 pl-3">
                            <span className="w-6 font-mono text-[12px] font-semibold tabular-nums">{c}</span>
                            <span className="text-[12.5px] text-[var(--agent-app-text)]/80">{niceShort(c)}</span>
                          </span>
                        </td>
                        {cols.map((j) => (
                          <td key={j} className="px-1.5 py-1">
                            <Cell cell={m.cells[`${c}|${j}`]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                    {hasStar && (
                      <tr className="border-b border-[var(--agent-app-border)]/50">
                        <td className="px-3 py-1.5">
                          <span className="pl-3 text-[12.5px] italic text-[var(--agent-app-muted)]">Classes not on file</span>
                        </td>
                        {cols.map((j) => (
                          <td key={j} className="px-1.5 py-1">
                            {m.cells[`*|${j}`] !== undefined ? <Cell cell={m.cells[`*|${j}`]} /> : <span className="block h-7" />}
                          </td>
                        ))}
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--agent-app-border)] px-4 py-2 text-[11.5px] text-[var(--agent-app-muted)]">
          <Legend tone="good" label="Registered" />
          <Legend tone="info" label="Pending" />
          <Legend tone="neutral" label="Lapsed or refused" strike />
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-3 w-5 border border-dashed border-[var(--agent-app-border)]" aria-hidden />
            Not filed
          </span>
          <span>Click a cell to open the registration.</span>
        </div>
      </Section>

      <Section title="Coverage gaps" meta={analysis.gaps.length > 0 ? String(analysis.gaps.length) : undefined}>
        <div className="flex flex-col gap-3">
          {analysis.gaps.length === 0 ? (
            <p className="text-[13px] text-[var(--agent-app-muted)]">
              {analysis.unknown.length > 0
                ? 'No gaps found where classes are on file.'
                : `No gaps: every class that is protected somewhere is also protected in each of the ${cols.length} jurisdiction${cols.length === 1 ? '' : 's'} shown.`}
            </p>
          ) : (
            <Notice tone="warn" icon={TriangleAlert}>
              <p className="mb-1.5">These classes are protected in at least one jurisdiction but not in the others listed.</p>
              <ul className="flex flex-col gap-1">
                {analysis.gaps.map((g) => (
                  <li key={`${g.family}-${g.cls}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                    <b>{g.mark}</b>
                    <span>
                      class <span className="font-mono">{g.cls}</span> ({niceShort(g.cls)}):
                    </span>
                    <span>not in</span>
                    {g.missing.map((j) => (
                      <JurChip key={j} code={j} />
                    ))}
                    <span className="text-[var(--agent-app-muted)]">(protected in {g.have.join(', ')})</span>
                  </li>
                ))}
              </ul>
            </Notice>
          )}
          {analysis.unknown.length > 0 && (
            <Notice tone="info" icon={Info}>
              {analysis.unknown.map((u) => (
                <p key={`${u.mark}-${u.jur}`}>
                  <b>{u.mark}</b> in {jurisdictionName(u.jur)}: registration{' '}
                  <a href={href('matter', u.cell.matter)} className="hover:underline">
                    <Ref>{u.cell.ref}</Ref>
                  </a>{' '}
                  has no classes on file, so gaps there are not checked. Add its goods and services to compare.
                </p>
              ))}
            </Notice>
          )}
        </div>
      </Section>
    </div>
  );
}

function classesOf(cells: Record<string, CoverageCell>): number[] {
  const set = new Set<number>();
  for (const k of Object.keys(cells)) {
    const c = k.split('|')[0] ?? '';
    if (c !== '*' && c !== '' && !Number.isNaN(Number(c))) set.add(Number(c));
  }
  return [...set].sort((a, b) => a - b);
}

function Legend({ tone, label, strike = false }: { tone: Tone; label: string; strike?: boolean | undefined }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block h-3 w-5', TONE_BG[tone])} aria-hidden />
      <span className={cn(strike && 'line-through')}>{label}</span>
    </span>
  );
}
