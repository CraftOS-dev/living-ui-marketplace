/**
 * Trademark coverage of a character, talent or franchise: Nice classes by
 * office (registered, pending, missing), with licensing gaps highlighted
 * (a licence grants a product category in a territory with no mark there).
 */
import { useMemo } from 'react';
import { Grid3X3, ShieldAlert } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { useLiveAsync } from '../lib/live.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { t, tn } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import { EmptyHint, ErrorBox, JurChip, Loading, Section, Segmented, TONE_BG, TONE_TEXT } from './ui.tsx';
import { CatalogSelect } from './pickers.tsx';
import { classLabel, niceHeading } from './protectShared.tsx';

export type CoverageSubject = 'character' | 'talent' | 'franchise';

interface Cell {
  state: 'registered' | 'pending' | 'missing';
  matter: string;
  ref: string;
  last_use: string;
}

export interface CoverageResult {
  jurisdictions: string[];
  classes: number[];
  cells: Record<string, Cell>;
  gaps: { class: number; territory: string; agreement_id: string; ref: string }[];
}

export function useCoverage(type: CoverageSubject, id: string): { data: CoverageResult | null; loading: boolean; error: string | null; reload: () => void } {
  return useLiveAsync(
    () => (id === '' ? Promise.resolve(null) : op<CoverageResult>('coverage/matrix', { subject_type: type, subject_id: id })),
    [type, id],
    ['matters', 'goods_services', 'grants', 'agreements'],
  );
}

/** Grid of classes by office for one subject. */
export function CoverageGrid({ type, id, title }: { type: CoverageSubject; id: string; title?: string | undefined }): React.JSX.Element {
  const res = useCoverage(type, id);
  const data = res.data;

  const offices = useMemo(() => {
    const extra = (data?.jurisdictions ?? []).filter((j) => !(OFFICES as readonly string[]).includes(j));
    return [...OFFICES, ...extra.sort()];
  }, [data]);
  const classes = useMemo(() => {
    const set = new Set<number>(data?.classes ?? []);
    for (const g of data?.gaps ?? []) set.add(g.class);
    return [...set].sort((a, b) => a - b);
  }, [data]);
  const gapKeys = useMemo(() => new Set((data?.gaps ?? []).map((g) => `${g.class}:${g.territory}`)), [data]);
  const counts = useMemo(() => {
    let reg = 0;
    let pend = 0;
    for (const c of Object.values(data?.cells ?? {})) {
      if (c.state === 'registered') reg += 1;
      else if (c.state === 'pending') pend += 1;
    }
    return { reg, pend, gaps: data?.gaps.length ?? 0 };
  }, [data]);

  const reportLink = (
    <a href={href('reports', undefined, { report: 'trademark_gaps' })} className="text-xs font-medium text-[var(--agent-app-accent)] hover:underline">
      {t('Trademark gaps report')}
    </a>
  );

  return (
    <Section title={title ?? t('Coverage')} meta={data !== null ? t('{reg} registered, {pend} pending, {gaps} gaps', counts) : undefined} actions={reportLink} flush>
      {res.loading && data === null ? (
        <Loading />
      ) : res.error !== null ? (
        <div className="p-4">
          <ErrorBox message={res.error} onRetry={res.reload} />
        </div>
      ) : data === null || classes.length === 0 ? (
        <EmptyHint
          compact
          icon={Grid3X3}
          title={t('No trademark coverage yet')}
          message={t('Trademarks linked to this record show here by class and office, with the classes a licence needs but no mark covers.')}
        />
      ) : (
        <div className="flex flex-col gap-3 p-3">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-[12.5px]">
              <thead>
                <tr>
                  <th className="sticky left-0 z-10 min-w-[9rem] bg-[var(--agent-app-surface)] px-2 py-1.5 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">
                    {t('Class')}
                  </th>
                  {offices.map((o) => (
                    <th key={o} className="px-1 py-1.5 text-center" title={jurisdictionName(o)}>
                      <JurChip code={o} />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {classes.map((k) => (
                  <tr key={k} className="border-t border-[var(--agent-app-border)]/60">
                    <td className="sticky left-0 z-10 bg-[var(--agent-app-surface)] px-2 py-1.5">
                      <div className="font-mono font-semibold tabular-nums">{k}</div>
                      <div className="max-w-[10rem] truncate text-[10.5px] text-[var(--agent-app-muted)]" title={niceHeading(k)}>
                        {niceHeading(k)}
                      </div>
                    </td>
                    {offices.map((o) => {
                      const c = data.cells[`${k}:${o}`];
                      const gap = gapKeys.has(`${k}:${o}`);
                      return (
                        <td key={o} className="px-1 py-1 text-center">
                          <CoverageCell cell={c} gap={gap} label={`${classLabel(k)}, ${jurisdictionName(o)}`} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--agent-app-muted)]">
            <Legend className={cn(TONE_BG.good, TONE_TEXT.good, 'border border-current/40')} label={t('Registered')} />
            <Legend className={cn(TONE_BG.info, TONE_TEXT.info, 'border border-current/40')} label={t('Pending')} />
            <Legend className="border border-[var(--agent-app-border)]" label={t('Missing|coverage')} />
            <Legend className={cn(TONE_BG.bad, TONE_TEXT.bad, 'border-2 border-current/70')} label={t('Licensed without a mark')} />
          </div>
          {data.gaps.length > 0 && (
            <div className="border border-[var(--agent-app-border)]">
              <div className={cn('flex items-center gap-2 px-3 py-2 text-[13px] font-medium', TONE_BG.bad, TONE_TEXT.bad)}>
                <ShieldAlert size={14} aria-hidden /> {tn(data.gaps.length, '{n} licensed class has no mark', '{n} licensed classes have no mark')}
              </div>
              {data.gaps.map((g, i) => (
                <div key={`${g.class}-${g.territory}-${g.agreement_id}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-[var(--agent-app-border)]/60 px-3 py-1.5 text-[13px]">
                  <span className="font-mono font-semibold">{classLabel(g.class)}</span>
                  <span className="text-[var(--agent-app-muted)]">{niceHeading(g.class)}</span>
                  <JurChip code={g.territory} />
                  <span className="text-[var(--agent-app-muted)]">{jurisdictionName(g.territory)}</span>
                  {g.agreement_id !== '' && (
                    <a href={href('agreement', g.agreement_id)} className="ml-auto font-mono text-xs text-[var(--agent-app-accent)] hover:underline">
                      {g.ref || t('Open the agreement')}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}

function CoverageCell({ cell, gap, label }: { cell: Cell | undefined; gap: boolean; label: string }): React.JSX.Element {
  const state = cell?.state ?? 'missing';
  const text = state === 'registered' ? t('Registered') : state === 'pending' ? t('Pending') : gap ? t('Gap|coverage') : '';
  const cls = cn(
    'flex h-8 min-w-[4.25rem] items-center justify-center px-1 text-[11px] font-medium',
    state === 'registered' && cn(TONE_BG.good, TONE_TEXT.good, 'border border-current/40'),
    state === 'pending' && cn(TONE_BG.info, TONE_TEXT.info, 'border border-current/40'),
    state === 'missing' && !gap && 'border border-dashed border-[var(--agent-app-border)] text-[var(--agent-app-muted)]',
    gap && 'border-2 border-current/70',
    gap && state === 'missing' && cn(TONE_BG.bad, TONE_TEXT.bad),
  );
  const title = `${label}: ${state === 'registered' ? t('Registered') : state === 'pending' ? t('Pending') : t('Missing|coverage')}${gap ? `, ${t('Licensed without a mark')}` : ''}${cell !== undefined && cell.ref !== '' ? ` (${cell.ref})` : ''}`;
  if (cell !== undefined && cell.matter !== '') {
    return (
      <a href={href('matter', cell.matter)} className={cn(cls, 'hover:opacity-80')} title={title}>
        {text || '-'}
      </a>
    );
  }
  return (
    <span className={cls} title={title}>
      {text || '-'}
    </span>
  );
}

function Legend({ className, label }: { className: string; label: string }): React.JSX.Element {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('inline-block size-3', className)} aria-hidden />
      {label}
    </span>
  );
}

/** Pick a character, talent or franchise, then show its coverage. */
export function CoveragePicker({ type, id, onChange }: { type: CoverageSubject; id: string; onChange: (type: CoverageSubject, id: string) => void }): React.JSX.Element {
  const { on } = useApp();
  const options: { value: CoverageSubject; label: string }[] = [
    ...(on('franchises') ? [{ value: 'character' as const, label: t('Character') }] : []),
    ...(on('talents') ? [{ value: 'talent' as const, label: t('Talent') }] : []),
    ...(on('franchises') ? [{ value: 'franchise' as const, label: t('Franchise') }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-3">
        {options.length > 1 && <Segmented<CoverageSubject> value={type} options={options} onChange={(v) => onChange(v, '')} ariaLabel={t('Coverage of')} />}
        <div className="w-full sm:w-72">
          <CatalogSelect kind={type} value={id} onChange={(v) => onChange(type, v)} placeholder={t('Choose')} />
        </div>
      </div>
      {options.length === 0 ? (
        <EmptyHint compact icon={Grid3X3} title={t('Coverage needs characters, talents or franchises')} message={t('Switch on the franchises or talents module in Settings to see coverage by character or talent.')} />
      ) : id === '' ? (
        <Section title={t('Coverage')}>
          <EmptyHint
            compact
            icon={Grid3X3}
            title={t('Choose what to check')}
            message={t('Pick a character, talent or franchise to see its trademarks by class and office, and the classes its licences need.')}
          />
        </Section>
      ) : (
        <CoverageGrid type={type} id={id} />
      )}
    </div>
  );
}
