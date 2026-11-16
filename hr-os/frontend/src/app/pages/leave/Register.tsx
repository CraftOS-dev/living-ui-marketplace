/**
 * Japan: the five-day rule (everyone granted 10 or more days of 年次有給休暇
 * takes at least 5 within a year of the grant) and the 年次有給休暇管理簿
 * (annual paid leave register): per person and grant year the base date,
 * days carried and granted, each leave taken, what remains, kept for the
 * grant period and three years after. Export as CSV, or print.
 */
import { useMemo, useState } from 'react';
import { CalendarCheck, Download, Printer } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, PageBody, PageHeader, Segmented, StatTile, StatusDot, Tabs } from '../../components/ui.tsx';
import type { Column, Tone } from '../../components/ui.tsx';
import { op, saveText } from '../../lib/api.ts';
import { useMe } from '../../lib/auth.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay, fmtRange } from '../../lib/format.ts';
import { useUi } from '../../lib/store.tsx';
import { t } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { READS, figure } from './data.ts';
import type { Obligation, RegisterRow } from './types.ts';

const OB_TONE: Record<string, Tone> = { done: 'good', on_track: 'neutral', at_risk: 'warn', missed: 'bad', not_applicable: 'faint' };

type OBRow = Obligation & { employment: string; number: string; name: string };

function Meter({ done, planned }: { done: number; planned: number }): React.JSX.Element {
  const a = Math.min(5, done);
  const b = Math.min(5 - a, planned);
  return (
    <span className="flex h-2 w-24 overflow-hidden rounded-full bg-[var(--hr-active)]" aria-hidden>
      <span style={{ width: `${(a / 5) * 100}%`, background: 'var(--hr-good)' }} />
      <span style={{ width: `${(b / 5) * 100}%`, background: 'var(--hr-good-soft)' }} />
    </span>
  );
}

export function RegisterPage({ query }: PageProps): React.JSX.Element {
  const me = useMe();
  const { entity: sidebar } = useUi();
  const jpEntities = me.entities.filter((e) => e.country === 'JP');
  // The sidebar's entity when it is a Japanese one; with all entities, a choice among the Japanese ones.
  const fixed = jpEntities.some((e) => e.id === sidebar);
  const [picked, setEntity] = useState(jpEntities[0]?.id ?? '');
  const entity = fixed ? sidebar : picked;
  const tab = (query.get('tab') as 'five' | 'register' | null) ?? 'five';
  const ob = useOp<{ rows: OBRow[]; counts: Record<string, number>; rule: string }>('leave.obligation', { entity: entity === '' ? undefined : entity }, READS, { name: 'leave.obligation', skip: entity === '' });
  const reg = useOp<{ rows: RegisterRow[]; from: string; to: string; note: string }>('leave.register', { entity: entity === '' ? undefined : entity }, READS, { name: 'leave.register', skip: entity === '' || tab !== 'register' });
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('leave.register-export', { entity });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const obCols: Column<OBRow>[] = useMemo(
    () => [
      { key: 'name', label: t('leave.col.person'), width: 'minmax(170px,1.6fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="hr-wrap min-w-0"><span className="block font-medium">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.number}</span></span> },
      { key: 'base', label: t('leave.five.base'), width: '124px', mono: true, sort: (r) => r.base, render: (r) => fmtDay(r.base, { year: 'always' }) },
      { key: 'deadline', label: t('leave.five.deadline'), width: '124px', mono: true, sort: (r) => r.deadline, render: (r) => fmtDay(r.deadline, { year: 'always' }) },
      { key: 'granted', label: t('leave.five.granted'), width: '80px', align: 'right', mono: true, hideBelow: 'lg', render: (r) => figure(r.granted) },
      { key: 'taken', label: t('leave.five.taken'), width: '150px', phone: 'sub', render: (r) => <span className="flex items-center gap-2"><Meter done={r.taken} planned={r.planned} /><span className="hr-mono text-[12px]">{figure(r.taken + r.planned)}/5</span></span> },
      { key: 'short', label: t('leave.five.short_col'), width: '80px', align: 'right', mono: true, sort: (r) => r.short, render: (r) => (r.short > 0 ? figure(r.short) : '') },
      { key: 'status', label: t('leave.col.status'), width: '120px', phone: 'end', sort: (r) => r.status, render: (r) => <StatusDot tone={OB_TONE[r.status] ?? 'neutral'} label={t(`leave.five.status.${r.status}`)} /> },
    ],
    [],
  );
  const regCols: Column<RegisterRow>[] = useMemo(
    () => [
      { key: 'name', label: t('leave.reg.name'), width: 'minmax(170px,1.5fr)', sort: (r) => r.name, phone: 'title', render: (r) => <span className="hr-wrap min-w-0"><span className="block font-medium">{r.name}</span><span className="hr-mono text-[12px] text-[var(--hr-muted)]">{r.number}{r.department_name !== '' ? ` · ${r.department_name}` : ''}</span></span> },
      { key: 'base', label: t('leave.reg.base'), width: '124px', mono: true, sort: (r) => r.base, render: (r) => fmtDay(r.base, { year: 'always' }) },
      { key: 'carried', label: t('leave.reg.carried'), width: '84px', align: 'right', mono: true, hideBelow: 'lg', render: (r) => figure(r.carried) },
      { key: 'granted', label: t('leave.reg.granted'), width: '84px', align: 'right', mono: true, render: (r) => figure(r.granted) },
      { key: 'taken', label: t('leave.reg.taken'), width: '84px', align: 'right', mono: true, phone: 'sub', render: (r) => figure(r.taken_days) + (r.taken_hours > 0 ? ` +${figure(r.taken_hours)}h` : '') },
      { key: 'dates', label: t('leave.reg.dates'), width: 'minmax(180px,2fr)', hideBelow: 'xl', render: (r) => <span className="hr-wrap text-[12px] text-[var(--hr-ink-2)]">{r.taken.map((x) => fmtRange(x.start, x.end)).join(', ')}</span> },
      { key: 'remaining', label: t('leave.reg.remaining'), width: '84px', align: 'right', mono: true, phone: 'end', render: (r) => figure(r.remaining) },
      { key: 'keep', label: t('leave.reg.keep'), width: '124px', mono: true, hideBelow: 'lg', render: (r) => fmtDay(r.keep_until, { year: 'always' }) },
    ],
    [],
  );
  const c0 = ob.data?.counts ?? {};
  const counts = { missed: c0['missed'] ?? 0, at_risk: c0['at_risk'] ?? 0, on_track: c0['on_track'] ?? 0, done: c0['done'] ?? 0 };
  return (
    <>
      <PageHeader title={t('leave.reg.title')} meta={t('leave.reg.meta')}>
        {!fixed && jpEntities.length > 1 && <Segmented value={entity} onChange={setEntity} label={t('leave.reg.entity')} options={jpEntities.map((e) => ({ value: e.id, label: e.name }))} />}
        {tab === 'register' && entity !== '' && (
          <>
            <Button variant="ghost" icon={Printer} onClick={() => window.print()}>
              {t('leave.reg.print')}
            </Button>
            <Button variant="primary" icon={Download} onClick={() => void exportCsv()}>
              {t('leave.reg.export')}
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody>
        {entity === '' ? (
          <Empty icon={CalendarCheck} title={t('leave.reg.no_japan')}>{t('leave.reg.no_japan_body')}</Empty>
        ) : (
          <>
            <Tabs value={tab} onChange={(v) => setQuery({ tab: v === 'five' ? undefined : v })} label={t('leave.reg.title')} className="hr-no-print mb-3" tabs={[{ value: 'five', label: t('leave.five.title'), count: counts.missed + counts.at_risk }, { value: 'register', label: t('leave.reg.register') }]} />
            {tab === 'five' ? (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-4">
                  <StatTile index="01" label={t('leave.five.status.missed')} value={counts.missed ?? 0} tone={(counts.missed ?? 0) > 0 ? 'bad' : undefined} />
                  <StatTile index="02" label={t('leave.five.status.at_risk')} value={counts.at_risk ?? 0} tone={(counts.at_risk ?? 0) > 0 ? 'warn' : undefined} />
                  <StatTile index="03" label={t('leave.five.status.on_track')} value={counts.on_track ?? 0} />
                  <StatTile index="04" label={t('leave.five.status.done')} value={counts.done ?? 0} tone={(counts.done ?? 0) > 0 ? 'good' : undefined} />
                </div>
                {ob.error !== null ? <LoadError message={ob.error} onRetry={ob.reload} /> : ob.data === null ? <Loading /> : (
                  <div className="hr-panel hr-in min-w-0">
                    <DataTable label={t('leave.five.title')} columns={obCols} rows={ob.data.rows} rowKey={(r) => r.employment + r.base} rowHref={(r) => `#/people/${r.number}?tab=leave`} empty={<Empty icon={CalendarCheck} title={t('leave.five.nobody')}>{t('leave.five.nobody_body')}</Empty>} />
                  </div>
                )}
                {ob.data !== null && <p className="hr-wrap mt-2 text-[12px] text-[var(--hr-muted)]">{ob.data.rule}</p>}
              </>
            ) : reg.error !== null ? (
              <LoadError message={reg.error} onRetry={reg.reload} />
            ) : reg.data === null ? (
              <Loading />
            ) : (
              <>
                <div className="hr-panel hr-in min-w-0">
                  <DataTable label={t('leave.reg.register')} columns={regCols} rows={reg.data.rows} rowKey={(r) => r.employment + r.base} rowHref={(r) => `#/people/${r.number}?tab=leave`} empty={<Empty icon={CalendarCheck} title={t('leave.reg.empty')} />} />
                </div>
                <p className="hr-wrap mt-2 text-[12px] text-[var(--hr-muted)]">{reg.data.note}</p>
              </>
            )}
          </>
        )}
      </PageBody>
    </>
  );
}
