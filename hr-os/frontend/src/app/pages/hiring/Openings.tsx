/**
 * Openings: every job opening the viewer may see as dense rows (title,
 * entity, hiring manager, candidates in process, hired of positions,
 * status), filtered by status. New openings start here or from Home.
 */
import { useMemo, useState } from 'react';
import { Briefcase, Plus } from 'lucide-react';
import { Button, DataTable, Empty, LoadError, Loading, PageBody, PageHeader, SearchInput, Segmented } from '../../components/ui.tsx';
import type { Column } from '../../components/ui.tsx';
import { OpeningDialog } from '../../components/hiring/forms.tsx';
import { Status } from '../../components/hiring/bits.tsx';
import type { PageProps } from '../../lib/contract.ts';
import { fmtDay } from '../../lib/format.ts';
import { t, tn } from '../../lib/i18n.ts';
import { useOp } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import type { Opening } from './types.ts';
import { READS } from './types.ts';

type View = 'active' | 'open' | 'draft' | 'closed' | 'all';
const PAGE = 50;

export function OpeningsPage({ query }: PageProps): React.JSX.Element {
  const view = (query.get('status') as View | null) ?? 'active';
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [creating, setCreating] = useState(false);
  const live = useOp<{ openings: Opening[]; total: number; can_add: boolean }>('openings.list', { status: view, q: q.trim() === '' ? undefined : q.trim(), limit }, READS, { name: 'hiring.openings' });
  const columns: Column<Opening>[] = useMemo(
    () => [
      { key: 'title', label: t('hiring.col.title'), width: 'minmax(220px,2fr)', sort: (r) => r.title, phone: 'title', render: (r) => (
        <span className="min-w-0">
          <span className="hr-wrap block font-medium">{r.title}</span>
          <span className="hr-mono block text-[12px] text-[var(--hr-muted)]">{r.number}</span>
        </span>
      ) },
      { key: 'entity', label: t('hiring.col.entity'), width: 'minmax(120px,1fr)', sort: (r) => r.entity_name, hideBelow: 'lg', render: (r) => r.entity_name },
      { key: 'manager', label: t('hiring.col.hiring_manager'), width: 'minmax(120px,1fr)', sort: (r) => r.hiring_manager_name, hideBelow: 'xl', phone: 'hide', render: (r) => r.hiring_manager_name },
      { key: 'active', label: t('hiring.col.in_process'), width: '100px', align: 'right', mono: true, sort: (r) => r.active, phone: 'sub', render: (r) => tn('hiring.n_in_process', r.active) },
      { key: 'hired', label: t('hiring.col.hired'), width: '84px', align: 'right', mono: true, sort: (r) => r.hired, hideBelow: 'lg', phone: 'hide', render: (r) => `${r.hired}/${r.positions}` },
      { key: 'opened', label: t('hiring.col.opened'), width: '110px', mono: true, sort: (r) => r.opened_at, hideBelow: 'xl', phone: 'hide', render: (r) => fmtDay(r.opened_at) },
      { key: 'status', label: t('hiring.col.status'), width: '110px', sort: (r) => r.status, phone: 'end', render: (r) => <Status kind="opening" status={r.status} /> },
    ],
    [],
  );
  const d = live.data;
  return (
    <>
      <PageHeader title={t('hiring.openings')} meta={d !== null ? tn('hiring.meta_openings', d.total) : undefined}>
        {d?.can_add === true && (
          <Button variant="primary" icon={Plus} onClick={() => setCreating(true)} aria-label={t('hiring.new_opening')}>
            <span className="hidden sm:inline">{t('hiring.new_opening')}</span>
          </Button>
        )}
      </PageHeader>
      <PageBody>
        <div className="hr-panel hr-in min-w-0">
          <div className="flex flex-wrap items-center gap-2 border-b border-[var(--hr-line)] px-4 py-2.5">
            <SearchInput value={q} onChange={setQ} placeholder={t('hiring.search_openings')} className="w-full sm:w-[240px]" />
            <Segmented
              value={view}
              onChange={(v) => setQuery({ status: v === 'active' ? undefined : v })}
              label={t('hiring.col.status')}
              size="sm"
              options={(['active', 'open', 'draft', 'closed', 'all'] as const).map((v) => ({ value: v, label: t(`hiring.view.${v}`) }))}
            />
          </div>
          {d === null ? (
            live.error !== null ? <LoadError message={live.error} onRetry={live.reload} /> : <Loading />
          ) : (
            <DataTable
              label={t('hiring.openings')}
              columns={columns}
              rows={d.openings}
              rowKey={(r) => r.id}
              rowHref={(r) => `#/hiring/openings/${r.id}`}
              hasMore={d.total > d.openings.length}
              onMore={() => setLimit((l) => l + PAGE)}
              loadingMore={live.loading}
              empty={
                <Empty icon={Briefcase} title={view === 'active' ? t('hiring.no_openings') : t('hiring.none_match')} action={d.can_add ? <Button icon={Plus} onClick={() => setCreating(true)}>{t('hiring.new_opening')}</Button> : undefined} />
              }
            />
          )}
        </div>
      </PageBody>
      <OpeningDialog open={creating} onClose={() => setCreating(false)} />
    </>
  );
}
