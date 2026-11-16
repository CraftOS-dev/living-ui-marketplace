/**
 * Candidates: everyone the viewer may see, by view (all, in process, the
 * pool, hired, past the retention day), with search; add one, import a
 * CSV, export. In the retention view a person reviews and deletes the ones
 * no longer needed (nothing is deleted on its own).
 */
import { useEffect, useMemo, useState } from 'react';
import { Download, FileUp, Plus, ShieldAlert, Trash2, Users } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, Notice, PageBody, PageHeader, SearchInput, Segmented, confirmAsk } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { AddCandidateDialog, ImportDialog } from '../../components/hiring/forms.tsx';
import { cx, statusLabel } from '../../components/hiring/bits.tsx';
import { op, saveText } from '../../lib/api.ts';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { changed, useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { toast } from '../../lib/toast.ts';
import type { Candidate } from './types.ts';
import { READS } from './types.ts';

type View = 'all' | 'active' | 'pool' | 'hired' | 'retention';
const PAGE = 50;

export function CandidatesPage({ query }: PageProps): React.JSX.Element {
  const view = (query.get('view') as View | null) ?? 'all';
  const [q, setQ] = useState(query.get('q') ?? '');
  const [debounced, setDebounced] = useState(q);
  const [limit, setLimit] = useState(PAGE);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  useEffect(() => {
    const h = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(h);
  }, [q]);
  useEffect(() => {
    setLimit(PAGE);
    setSel(new Set());
  }, [view, debounced]);
  const live = useOp<{ candidates: Candidate[]; total: number; today: string; can: { add: boolean; delete: boolean; export: boolean } }>('candidates.list', { view, q: debounced === '' ? undefined : debounced, limit }, READS, { name: 'hiring.candidates' });
  const due = useOp<{ total: number }>('candidates.list', { view: 'retention', limit: 1 }, READS, { name: 'hiring.candidates.due' }).data?.total ?? 0;
  const d = live.data;
  const columns: Column<Candidate>[] = useMemo(
    () => [
      { key: 'name', label: t('hiring.col.candidate'), width: 'minmax(200px,1.6fr)', sort: (r) => r.name, phone: 'title', render: (r) => (
        <span className="min-w-0">
          <span className="hr-wrap block font-medium">{r.name}</span>
          {(r.current_title !== '' || r.current_company !== '') && <span className="hr-wrap block text-[12px] text-[var(--hr-muted)]">{[r.current_title, r.current_company].filter((x) => x !== '').join(' · ')}</span>}
        </span>
      ) },
      { key: 'apps', label: t('hiring.col.applications'), width: 'minmax(200px,1.8fr)', phone: 'sub', render: (r) => (
        <span className="hr-wrap min-w-0 text-[13px]">
          {(r.applications ?? []).length === 0 ? <span className="text-[var(--hr-faint)]">{t('hiring.in_pool')}</span> : (r.applications ?? []).slice(0, 2).map((a) => `${a.opening_title}: ${a.status === 'active' ? a.stage_name : statusLabel('application', a.status)}`).join('; ')}
        </span>
      ) },
      { key: 'source', label: t('hiring.col.source'), width: '120px', sort: (r) => r.source ?? '', hideBelow: 'lg', phone: 'hide', render: (r) => (r.source ? t(`hiring.source.${r.source}`) : '') },
      view === 'retention'
        ? { key: 'retain', label: t('hiring.col.retain_until'), width: '130px', mono: true, sort: (r) => r.retain_until ?? '', phone: 'end', render: (r) => <span className="text-[var(--hr-bad)]">{fmtDay(r.retain_until ?? '')}</span> }
        : { key: 'added', label: t('hiring.col.added'), width: '110px', mono: true, sort: (r) => r.created, hideBelow: 'lg', phone: 'end', render: (r) => fmtDay(r.created) },
    ],
    [view],
  );
  const exportCsv = async (): Promise<void> => {
    try {
      const r = await op<{ csv: string; filename: string }>('candidates.export', { view });
      saveText(r.csv, r.filename);
    } catch {
      /* toast shown */
    }
  };
  const remove = async (ids: string[], clear: () => void): Promise<void> => {
    if (!(await confirmAsk(tn('hiring.delete_candidates_text', ids.length), tn('hiring.delete_candidates', ids.length)))) return;
    try {
      const r = await op<{ deleted: unknown[]; kept: { name: string; reason: string }[] }>('candidates.delete', { candidates: ids });
      changed('candidates', 'applications');
      toast.success(tn('hiring.deleted_n', r.deleted.length) + (r.kept.length > 0 ? ' ' + t('hiring.kept_list', { list: r.kept.map((k) => k.name).join(', ') }) : ''));
      clear();
    } catch {
      /* toast shown */
    }
  };
  return (
    <>
      <PageHeader title={t('hiring.candidates')} meta={d !== null ? tn('hiring.meta_candidates', d.total) : undefined}>
        {d?.can.export === true && (
          <Button variant="ghost" icon={Download} onClick={() => void exportCsv()} className="hidden sm:inline-flex">
            {t('ui.export')}
          </Button>
        )}
        {d?.can.add === true && (
          <>
            <Button icon={FileUp} onClick={() => setImporting(true)} className="hidden sm:inline-flex">
              {t('ui.import')}
            </Button>
            <Button variant="primary" icon={Plus} onClick={() => setAdding(true)} aria-label={t('hiring.add_candidate')}>
              <span className="hidden sm:inline">{t('hiring.add_candidate')}</span>
            </Button>
          </>
        )}
      </PageHeader>
      <PageBody>
        {view !== 'retention' && due > 0 && d?.can.delete === true && (
          <Notice tone="warn" className="mb-3" action={<Button size="sm" onClick={() => setQuery({ view: 'retention' })}>{t('hiring.review')}</Button>}>
            {tn('hiring.need.retention', due)}
          </Notice>
        )}
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('hiring.search_candidates')} className="w-full sm:w-[260px]" />
            <Segmented
              value={view}
              onChange={(v) => setQuery({ view: v === 'all' ? undefined : v })}
              label={t('hiring.view_label')}
              size="sm"
              options={(['all', 'active', 'pool', 'hired', 'retention'] as const).map((v) => ({ value: v, label: v === 'retention' && due > 0 ? `${t('hiring.cview.retention')} ${due}` : t(`hiring.cview.${v}`) }))}
            />
          </div>
          {view === 'retention' && (
            <div className={cx('flex items-start gap-2 border-b border-[var(--hr-line)] px-4 py-2 text-[13px] text-[var(--hr-muted)]')}>
              <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden />
              <span className="hr-wrap">{t('hiring.retention_note')}</span>
            </div>
          )}
          {d === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable
              label={t('hiring.candidates')}
              columns={columns}
              rows={d.candidates}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/hiring/candidates/${r.id}`}
              hasMore={d.total > d.candidates.length}
              onMore={() => setLimit((l) => l + PAGE)}
              loadingMore={live.loading}
              selectable={view === 'retention' && d.can.delete}
              selected={sel}
              onSelect={setSel}
              selectionBar={(ids, clear) => (
                <Button size="sm" variant="danger" icon={Trash2} onClick={() => void remove(ids, clear)}>
                  {tn('hiring.delete_n', ids.length)}
                </Button>
              )}
              empty={
                view === 'retention' ? (
                  <Empty icon={ShieldAlert} title={t('hiring.none_past_retention')} />
                ) : debounced !== '' || view !== 'all' ? (
                  <Empty icon={Users} title={t('hiring.none_match')} />
                ) : (
                  <Empty
                    icon={Users}
                    title={t('hiring.no_candidates')}
                    action={
                      d.can.add ? (
                        <>
                          <Button icon={Plus} onClick={() => setAdding(true)}>
                            {t('hiring.add_candidate')}
                          </Button>
                          <Button icon={FileUp} onClick={() => setImporting(true)}>
                            {t('hiring.import_csv')}
                          </Button>
                        </>
                      ) : undefined
                    }
                  >
                    {t('hiring.no_candidates_text')}
                  </Empty>
                )
              }
            />
          )}
        </div>
      </PageBody>
      <AddCandidateDialog open={adding} onClose={() => setAdding(false)} />
      <ImportDialog open={importing} onClose={() => setImporting(false)} />
    </>
  );
}
