/**
 * Trademark coverage of a character, talent or franchise: Nice classes
 * against the trademark offices, each cell registered, pending or missing
 * (coverage/matrix), plus the licensed categories and territories that have
 * no mark behind them.
 */
import { Grid3x3, TriangleAlert } from 'lucide-react';
import { cn } from '../../kit/index.ts';
import { op } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useLiveAsync } from '../lib/live.ts';
import { fmtDate } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { OFFICES, jurisdictionName } from '../lib/labels.ts';
import type { Tone } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import { EmptyHint, ErrorBox, JurChip, Loading, Notice, Ref, Section, StatTile, TONE_BG, TONE_TEXT } from './ui.tsx';

export type CoverageSubject = 'character' | 'talent' | 'franchise';

interface CoverageCell {
  state: 'registered' | 'pending' | 'missing';
  matter: string;
  ref: string;
  last_use: string;
}
interface CoverageGap {
  class: number;
  territory: string;
  agreement_id: string;
  ref: string;
}
export interface CoverageResponse {
  jurisdictions: string[];
  classes: number[];
  cells: Record<string, CoverageCell>;
  gaps: CoverageGap[];
}

export function useCoverage(type: CoverageSubject, id: string): { data: CoverageResponse | null; loading: boolean; error: string | null; reload: () => void } {
  return useLiveAsync(() => op<CoverageResponse>('coverage/matrix', { subject_type: type, subject_id: id }), [type, id], ['matters', 'goods_services', 'grants', 'agreements']);
}

const STATE_TONE: Record<CoverageCell['state'], Tone> = { registered: 'good', pending: 'info', missing: 'neutral' };

function stateLabel(s: CoverageCell['state']): string {
  return s === 'registered' ? t('Registered') : s === 'pending' ? t('Pending') : t('Missing|trademark');
}

function columnsOf(data: CoverageResponse, orgJurs: string[]): string[] {
  const set = new Set<string>([...OFFICES.filter((o) => orgJurs.includes(o)), ...data.jurisdictions]);
  const order = (c: string): number => {
    const i = (OFFICES as readonly string[]).indexOf(c);
    return i < 0 ? 100 : i;
  };
  return [...set].sort((a, b) => order(a) - order(b) || a.localeCompare(b));
}

function counts(data: CoverageResponse): { registered: number; pending: number } {
  let registered = 0;
  let pending = 0;
  for (const c of Object.values(data.cells)) {
    if (c.state === 'registered') registered += 1;
    else if (c.state === 'pending') pending += 1;
  }
  return { registered, pending };
}

function Cell({ cell }: { cell: CoverageCell | undefined }): React.JSX.Element {
  if (cell === undefined || cell.state === 'missing') {
    return (
      <span className="flex h-7 items-center justify-center border border-dashed border-[var(--agent-app-border)] text-[10.5px] text-[var(--agent-app-muted)]" title={t('Missing|trademark')}>
        {t('Missing|trademark')}
      </span>
    );
  }
  const tone = STATE_TONE[cell.state];
  return (
    <a
      href={href('matter', cell.matter)}
      title={[stateLabel(cell.state), cell.ref, cell.last_use !== '' ? t('Last use evidence {date}', { date: fmtDate(cell.last_use) }) : ''].filter((x) => x !== '').join(' · ')}
      className={cn('flex h-7 items-center justify-center text-[11px] font-medium hover:underline', TONE_BG[tone], TONE_TEXT[tone])}
    >
      {stateLabel(cell.state)}
    </a>
  );
}

/** The full classes by offices grid with gaps. */
export function CoverageMatrix({ type, id }: { type: CoverageSubject; id: string }): React.JSX.Element {
  const { jurisdictions } = useApp();
  const cov = useCoverage(type, id);
  const data = cov.data;
  if (cov.loading && data === null) return <Loading label={t('Working out coverage')} />;
  if (cov.error !== null && data === null) return <ErrorBox message={cov.error} onRetry={cov.reload} />;
  if (data === null) return <Loading />;

  const cols = columnsOf(data, jurisdictions.map((j) => j.toUpperCase()));
  const c = counts(data);
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile label={t('Registered')} value={c.registered} tone={c.registered > 0 ? 'good' : undefined} />
        <StatTile label={t('Pending')} value={c.pending} tone={c.pending > 0 ? 'info' : undefined} />
        <StatTile label={t('Classes|nice')} value={data.classes.length} />
        <StatTile label={t('Licensing gaps')} value={data.gaps.length} tone={data.gaps.length > 0 ? 'warn' : undefined} />
      </div>
      <Section title={t('Trademark coverage')} meta={t('{classes} classes, {offices} offices', { classes: data.classes.length, offices: cols.length })} flush>
        {data.classes.length === 0 ? (
          <EmptyHint
            compact
            icon={Grid3x3}
            title={t('No classes on file')}
            message={t('Coverage appears once a trademark linked here has its goods and services (Nice classes) on file.')}
          />
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[13px]">
                <thead>
                  <tr className="border-b border-[var(--agent-app-border)] bg-[var(--agent-app-border)]/20">
                    <th className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-[var(--agent-app-muted)]">{t('Class|nice')}</th>
                    {cols.map((j) => (
                      <th key={j} className="min-w-[84px] px-1.5 py-2 text-center" title={jurisdictionName(j)}>
                        <JurChip code={j} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.classes.map((k) => (
                    <tr key={k} className="border-b border-[var(--agent-app-border)]/50 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-[12px] font-semibold tabular-nums">{k}</td>
                      {cols.map((j) => (
                        <td key={j} className="px-1.5 py-1">
                          <Cell cell={data.cells[`${k}:${j}`]} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-[var(--agent-app-border)] px-4 py-2 text-[11.5px] text-[var(--agent-app-muted)]">
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('inline-block h-3 w-5', TONE_BG.good)} aria-hidden /> {t('Registered')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className={cn('inline-block h-3 w-5', TONE_BG.info)} aria-hidden /> {t('Pending')}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="inline-block h-3 w-5 border border-dashed border-[var(--agent-app-border)]" aria-hidden /> {t('Missing|trademark')}
              </span>
              <span>{t('Click a cell to open the trademark.')}</span>
            </div>
          </>
        )}
      </Section>
      {data.gaps.length > 0 && (
        <Notice tone="warn" icon={TriangleAlert}>
          <p className="mb-1.5">{t('Licensed out where no trademark covers the class:')}</p>
          <ul className="flex flex-col gap-1">
            {data.gaps.map((g, i) => (
              <li key={`${g.class}-${g.territory}-${g.agreement_id}-${i}`} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span>{t('Class {n}', { n: g.class })}</span>
                <JurChip code={g.territory} />
                <span className="text-[var(--agent-app-muted)]">{jurisdictionName(g.territory)}</span>
                {g.agreement_id !== '' && (
                  <a href={href('agreement', g.agreement_id)} className="hover:underline">
                    <Ref>{g.ref || t('Agreement')}</Ref>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </Notice>
      )}
    </div>
  );
}

/** Coverage at a glance (Overview), with a link to the full grid. */
export function CoverageSummary({ type, id, onOpen }: { type: CoverageSubject; id: string; onOpen: () => void }): React.JSX.Element {
  const cov = useCoverage(type, id);
  const data = cov.data;
  const action = (
    <button type="button" className="text-xs text-[var(--agent-app-accent)] hover:underline" onClick={onOpen}>
      {t('Open coverage')}
    </button>
  );
  if (data === null) {
    return (
      <Section title={t('Trademark coverage')} actions={action}>
        {cov.error !== null ? <ErrorBox message={cov.error} onRetry={cov.reload} /> : <p className="text-[13px] text-[var(--agent-app-muted)]">{t('Loading')}</p>}
      </Section>
    );
  }
  const c = counts(data);
  return (
    <Section title={t('Trademark coverage')} actions={action}>
      {data.classes.length === 0 && data.gaps.length === 0 ? (
        <p className="text-[13px] text-[var(--agent-app-muted)]">{t('No trademark classes on file yet.')}</p>
      ) : (
        <div className="flex flex-col gap-2 text-[13px]">
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            <span className={TONE_TEXT.good}>{t('{n} registered', { n: c.registered })}</span>
            <span className={TONE_TEXT.info}>{t('{n} pending', { n: c.pending })}</span>
            <span className="text-[var(--agent-app-muted)]">{t('{n} classes', { n: data.classes.length })}</span>
          </div>
          {data.jurisdictions.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {data.jurisdictions.map((j) => (
                <JurChip key={j} code={j} />
              ))}
            </div>
          )}
          {data.gaps.length > 0 && <p className={TONE_TEXT.warn}>{t('{n} licensed class and territory pairs have no mark.', { n: data.gaps.length })}</p>}
        </div>
      )}
    </Section>
  );
}
