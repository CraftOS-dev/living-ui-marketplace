/**
 * Calibration for HR and people leaders: the distribution of ratings
 * (final, else the manager's) for everyone and per department as quiet
 * bars, then the people as compact rows. Change a final rating right on the
 * row: pick the rating and give the reason; every change is kept in the
 * history and the audit trail. There is no automatic curve.
 */
import { useEffect, useMemo, useState } from 'react';
import { History, Scale as ScaleIcon } from 'lucide-react';
import { Button, DataTable, Dialog, Empty, Field, LoadError, Loading, Notice, PageBody, PageHeader, Panel, PersonChip, Picker, Tag, Textarea, toast } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { DistributionBars, RatingScaleInput } from '../../components/performance/bits.tsx';
import type { CalibrationEntry, Cycle, Participant, Scale } from '../../components/performance/types.ts';
import { READS } from '../../components/performance/types.ts';
import { op } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtStampDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';

interface Row extends Participant {
  history: CalibrationEntry[];
  can_adjust: boolean;
}
interface View {
  cycle: Cycle;
  scale: Scale;
  distribution: { department: string; name: string; counts: number[]; total: number }[];
  rows: Row[];
  pending: number;
  calibrated: number;
}

export function CalibrationPage({ query }: PageProps): React.JSX.Element {
  const cycles = useOp<{ cycles: Cycle[] }>('cycles.list', { status: 'open' }, READS.reviews, { name: 'perf.cycles.open' });
  const active = (cycles.data?.cycles ?? []).filter((c) => c.status === 'active');
  const cycle = query.get('cycle') ?? active[0]?.id ?? '';
  const dept = query.get('department') ?? '';
  const live = useOp<View>('calibration.view', { cycle, department: dept === '' ? undefined : dept }, READS.reviews, { skip: cycle === '', name: 'perf.calibration' });
  const [adjust, setAdjust] = useState<Row | null>(null);
  const v = live.data;
  const cols: Column<Row>[] = useMemo(
    () => [
      { key: 'name', label: t('perf.cycle.person'), width: 'minmax(200px,2fr)', phone: 'title', sort: (r) => r.employee?.name ?? '', render: (r) => <PersonChip name={r.employee?.name ?? ''} sub={r.title} size={24} /> },
      { key: 'dept', label: t('perf.cycle.department'), width: 'minmax(120px,1fr)', sort: (r) => r.department_name, hideBelow: 'lg', render: (r) => r.department_name },
      { key: 'manager', label: t('perf.calib.manager_rating'), width: 'minmax(120px,1fr)', phone: 'hide', sort: (r) => r.overall ?? 0, render: (r) => (v !== null && (r.overall ?? 0) > 0 ? <span className="truncate" title={String(r.overall)}>{v.scale.labels[(r.overall ?? 1) - 1] ?? ''}</span> : '') },
      { key: 'score', label: t('perf.calib.score'), width: '80px', mono: true, align: 'right', sort: (r) => r.score ?? 0, hideBelow: 'xl', phone: 'hide', render: (r) => (r.score !== null && r.score > 0 ? r.score.toFixed(2) : '') },
      {
        key: 'final',
        label: t('perf.calib.final'),
        width: 'minmax(150px,1.2fr)',
        phone: 'end',
        sort: (r) => r.rating ?? 0,
        render: (r) => (
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate font-medium">{r.rating_label}</span>
            {r.calibrated && <Tag tone="rh">{t('perf.calib.changed')}</Tag>}
          </span>
        ),
      },
      { key: 'reason', label: t('perf.calib.reason'), width: 'minmax(160px,1.6fr)', hideBelow: 'xl', phone: 'hide', render: (r) => <span className="truncate text-[12px] text-[var(--hr-muted)]" title={r.final_reason}>{r.final_reason}</span> },
      { key: 'act', label: '', width: '96px', align: 'right', phone: 'hide', render: (r) => (r.can_adjust ? <Button size="sm" onClick={() => setAdjust(r)}>{t('perf.calib.adjust')}</Button> : r.history.length > 0 ? <History size={13} aria-label={t('perf.calib.history')} className="text-[var(--hr-faint)]" /> : null) },
    ],
    [v],
  );
  const deptItems = (v?.distribution ?? []).slice(1).map((d) => ({ value: d.department, label: d.name }));
  return (
    <>
      <PageHeader title={t('perf.calib.title')} meta={v !== null ? [v.cycle.name, tn('perf.calib.in', v.rows.length), tn('perf.calib.changed_n', v.calibrated)].join(' · ') : ''}>
        {active.length > 1 && <Picker value={cycle} onChange={(c) => setQuery({ cycle: c, department: undefined })} items={active.map((c) => ({ value: c.id, label: c.name }))} label={t('perf.calib.cycle')} className="w-[150px] sm:w-[220px]" />}
      </PageHeader>
      <PageBody>
        {cycles.data !== null && cycle === '' ? (
          <Empty icon={ScaleIcon} title={t('perf.calib.none')}>
            {t('perf.calib.none_text')}
          </Empty>
        ) : v === null ? (
          live.error !== null ? (
            <LoadError message={live.error} onRetry={live.reload} />
          ) : (
            <Loading />
          )
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-12">
            {v.pending > 0 && (
              <Notice tone="warn" className="lg:col-span-12">
                {tn('perf.calib.pending', v.pending)}
              </Notice>
            )}
            <Panel index="01" label={t('perf.calib.everyone')} className="lg:col-span-5" aside={<span className="hr-label">{v.distribution[0]?.total ?? 0}</span>}>
              {(v.distribution[0]?.total ?? 0) === 0 ? <p className="py-3 text-[12px] text-[var(--hr-muted)]">{t('perf.calib.no_ratings')}</p> : <DistributionBars counts={v.distribution[0]?.counts ?? []} labels={v.scale.labels} total={v.distribution[0]?.total ?? 0} className="pt-1" />}
            </Panel>
            <Panel index="02" label={t('perf.calib.by_department')} className="lg:col-span-7">
              <div className="grid grid-cols-1 gap-4 pt-1 md:grid-cols-2">
                {v.distribution.slice(1).map((d) => (
                  <button key={d.department || d.name} type="button" onClick={() => setQuery({ department: dept === d.department ? undefined : d.department })} aria-pressed={dept === d.department} className="hr-focus rounded-[var(--hr-radius-sm)] p-1.5 text-left transition-colors hover:bg-[var(--hr-hover)] aria-pressed:bg-[var(--hr-active)]">
                    <div className="mb-1 flex items-center gap-2">
                      <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{d.name}</span>
                      <span className="hr-mono hr-num text-[12px] text-[var(--hr-muted)]">{d.total}</span>
                    </div>
                    <DistributionBars counts={d.counts} labels={v.scale.labels} total={d.total} />
                  </button>
                ))}
                {v.distribution.length <= 1 && <p className="text-[12px] text-[var(--hr-muted)]">{t('perf.calib.no_ratings')}</p>}
              </div>
            </Panel>
            <div className="hr-panel hr-in min-w-0 lg:col-span-12">
              <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
                <span className="hr-label flex-1">{t('perf.calib.people')}</span>
                {deptItems.length > 1 && <Picker value={dept} onChange={(d) => setQuery({ department: d === '' ? undefined : d })} items={deptItems} label={t('perf.cycle.department')} placeholder={t('perf.calib.all_departments')} clearable className="w-[200px]" />}
              </div>
              <DataTable label={t('perf.calib.people')} columns={cols} rows={v.rows} rowKey={(r) => r.id} onRowClick={(r) => r.can_adjust && setAdjust(r)} empty={<Empty icon={ScaleIcon} title={t('perf.calib.no_ratings')} />} />
            </div>
          </div>
        )}
      </PageBody>
      {v !== null && <AdjustDialog row={adjust} scale={v.scale} onClose={() => setAdjust(null)} />}
    </>
  );
}

function AdjustDialog({ row, scale, onClose }: { row: Row | null; scale: Scale; onClose: () => void }): React.JSX.Element | null {
  const [final, setFinal] = useState(0);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (row === null) return;
    setFinal(row.rating ?? 0);
    setReason('');
    setErr(null);
  }, [row]);
  if (row === null) return null;
  const save = async (): Promise<void> => {
    if (reason.trim() === '') {
      setErr(t('perf.calib.need_reason'));
      return;
    }
    setBusy(true);
    try {
      await op('calibration.adjust', { participant: row.id, final: final === (row.overall ?? 0) ? 0 : final, reason }, { quiet: true });
      changed(...READS.reviews);
      toast.success(t('perf.calib.saved'));
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onClose={onClose}
      width={560}
      title={t('perf.calib.adjust_title', { name: row.employee?.name ?? '' })}
      meta={t('perf.calib.manager_said', { label: scale.labels[(row.overall ?? 1) - 1] ?? '' })}
      footer={
        <>
          <Button onClick={onClose}>{t('ui.cancel')}</Button>
          <Button variant="primary" busy={busy} disabled={final === 0} onClick={() => void save()}>
            {t('perf.calib.save')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label={t('perf.calib.final')}>
          <RatingScaleInput scale={scale} value={final} onChange={(n) => setFinal(n === 0 ? final : n)} label={t('perf.calib.final')} />
        </Field>
        <Field label={t('perf.calib.reason')} error={err}>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} minRows={2} maxLength={2000} placeholder={t('perf.calib.reason_ph')} />
        </Field>
        {row.history.length > 0 && (
          <div>
            <div className="hr-label mb-1">{t('perf.calib.history')}</div>
            <ul className="flex flex-col gap-1">
              {row.history.map((h, i) => (
                <li key={i} className="text-[12px] leading-4 text-[var(--hr-ink-2)]">
                  {h.from_label} {'>'} {h.to_label} · {h.by_name} · {fmtStampDay(h.at)}
                  <span className="hr-wrap block text-[var(--hr-muted)]">{h.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Dialog>
  );
}
