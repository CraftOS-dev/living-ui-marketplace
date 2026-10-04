/**
 * Works (titles, assets, creative assets): the tree of creative works,
 * series over seasons over episodes, with status, publication, rights basis
 * and clearance progress. A table view lists identifiers for export.
 */
import { useMemo, useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select, cn } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { WORK_TYPE_LABEL } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { ClearanceRec, WorkRec } from '../lib/types.ts';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { clearanceSummary } from '../components/catalogClearances.tsx';
import {
  RightsBasisPill,
  RowLink,
  TreeTable,
  WORK_STATUS_LABEL,
  WorkStatusPill,
  WorkTypeLabel,
  effectiveBasis,
  options,
  withAncestors,
} from '../components/catalogShared.tsx';
import type { TreeCol } from '../components/catalogShared.tsx';
import { WorkForm } from '../components/catalogWorkForm.tsx';
import { EmptyHint, ErrorBox, JurChip, Loading, PageHeader, Segmented, TONE_TEXT, Toolbar } from '../components/ui.tsx';

type View = 'tree' | 'table';

function identifiers(w: WorkRec): string {
  return [
    w.eidr !== '' ? `EIDR ${w.eidr}` : '',
    w.isrc !== '' ? `ISRC ${w.isrc}` : '',
    w.iswc !== '' ? `ISWC ${w.iswc}` : '',
    w.isbn !== '' ? `ISBN ${w.isbn}` : '',
    w.other_ids,
  ]
    .filter((x) => x !== '')
    .join(', ');
}

export function WorksPage(): React.JSX.Element {
  const { vocab, can, properties, propertyName } = useApp();
  const works = useCollection<WorkRec>('works', { sort: 'title' });
  const clearances = useCollection<ClearanceRec>('clearances');
  const [term, setTerm] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [prop, setProp] = useHashParam('property', '');
  const [status, setStatus] = useHashParam('status', '');
  const [viewParam, setView] = useHashParam('view', 'tree');
  const view: View = viewParam === 'table' ? 'table' : 'tree';
  const [creating, setCreating] = useState(false);

  const clearanceByWork = useMemo(() => {
    const m = new Map<string, ClearanceRec[]>();
    for (const c of clearances.records) {
      const arr = m.get(c.work);
      if (arr === undefined) m.set(c.work, [c]);
      else arr.push(c);
    }
    return m;
  }, [clearances.records]);

  const byId = useMemo(() => new Map(works.records.map((w) => [w.id, w])), [works.records]);

  const filtering = term.trim() !== '' || type !== '' || prop !== '' || status !== '';
  const matches = (w: WorkRec): boolean => {
    if (type !== '' && w.work_type !== type) return false;
    if (prop !== '' && w.property !== prop) return false;
    if (status !== '' && w.status !== status) return false;
    const t = term.trim().toLowerCase();
    if (t === '') return true;
    return (
      w.title.toLowerCase().includes(t) ||
      w.authors.toLowerCase().includes(t) ||
      identifiers(w).toLowerCase().includes(t) ||
      (w.tags ?? []).some((x) => x.toLowerCase().includes(t))
    );
  };
  const matched = filtering ? works.records.filter(matches) : works.records;
  const visible = filtering ? withAncestors(works.records, matches) : null;

  const usedProperties = useMemo(() => {
    const ids = new Set(works.records.map((w) => w.property).filter((x) => x !== ''));
    return properties.filter((p) => ids.has(p.id)).map((p) => ({ value: p.id, label: p.name }));
  }, [works.records, properties]);

  const typeOptions = useMemo(() => {
    const used = new Set(works.records.map((w) => w.work_type));
    return options(WORK_TYPE_LABEL).filter((o) => used.has(o.value) || o.value === type);
  }, [works.records, type]);

  const clearanceText = (w: WorkRec): React.JSX.Element | null => {
    const s = clearanceSummary(clearanceByWork.get(w.id) ?? []);
    if (s.total === 0) return null;
    const done = s.cleared === s.total;
    return (
      <span
        className={cn('whitespace-nowrap text-xs tabular-nums', done ? 'text-[var(--agent-app-text)]/80' : 'text-[var(--agent-app-muted)]', s.blocked > 0 && TONE_TEXT.bad)}
        title={`${s.cleared} of ${s.total} clearance items cleared${s.risk > 0 ? `, ${s.risk} with risk` : ''}${s.blocked > 0 ? `, ${s.blocked} not cleared` : ''}`}
      >
        {s.cleared}/{s.total} cleared
      </span>
    );
  };

  const treeCols: TreeCol<WorkRec>[] = [
    { key: 'type', label: 'Type', className: 'hidden md:table-cell', render: (w) => <WorkTypeLabel type={w.work_type} /> },
    { key: 'property', label: vocab.property, className: 'hidden lg:table-cell', render: (w) => <span className="text-[var(--agent-app-muted)]">{propertyName(w.property)}</span> },
    { key: 'status', label: 'Status', render: (w) => <WorkStatusPill status={w.status} /> },
    { key: 'pub', label: 'Published', className: 'hidden sm:table-cell', render: (w) => <span className="whitespace-nowrap tabular-nums">{fmtDate(w.publication_date)}</span> },
    {
      key: 'basis',
      label: 'Rights basis',
      className: 'hidden lg:table-cell',
      render: (w) => {
        const b = effectiveBasis(w, works.records, properties);
        return <RightsBasisPill basis={b.basis} inherited={b.from} />;
      },
    },
    { key: 'clear', label: 'Clearance', align: 'right', className: 'hidden sm:table-cell', render: (w) => clearanceText(w) },
  ];

  const tableCols: Col<WorkRec>[] = [
    { key: 'title', label: 'Title', render: (w) => <span className="block max-w-[22rem] truncate font-medium">{w.title}</span> },
    { key: 'work_type', label: 'Type', value: (w) => WORK_TYPE_LABEL[w.work_type], render: (w) => <WorkTypeLabel type={w.work_type} /> },
    { key: 'property', label: vocab.property, value: (w) => propertyName(w.property), render: (w) => propertyName(w.property) },
    { key: 'parent', label: 'Part of', value: (w) => byId.get(w.parent)?.title ?? '', render: (w) => <span className="text-[var(--agent-app-muted)]">{byId.get(w.parent)?.title ?? ''}</span> },
    { key: 'status', label: 'Status', value: (w) => (w.status !== '' ? WORK_STATUS_LABEL[w.status] : ''), render: (w) => <WorkStatusPill status={w.status} /> },
    { key: 'publication_date', label: 'Published', value: (w) => d10(w.publication_date), render: (w) => <span className="whitespace-nowrap tabular-nums">{fmtDate(w.publication_date)}</span> },
    {
      key: 'publication_country',
      label: 'Country',
      value: (w) => w.publication_country,
      render: (w) => (w.publication_country !== '' ? <JurChip code={w.publication_country} /> : null),
    },
    { key: 'made_for_hire', label: 'Made for hire', value: (w) => (w.made_for_hire ? 'Yes' : 'No'), render: (w) => (w.made_for_hire ? 'Yes' : <span className="text-[var(--agent-app-muted)]">No</span>) },
    { key: 'identifiers', label: 'Identifiers', value: (w) => identifiers(w), render: (w) => <span className="block max-w-[18rem] truncate font-mono text-[12px]">{identifiers(w)}</span> },
    { key: 'language', label: 'Language', optional: true },
    { key: 'authors', label: 'Authors', optional: true },
    { key: 'clearance', label: 'Clearance', optional: true, value: (w) => { const s = clearanceSummary(clearanceByWork.get(w.id) ?? []); return s.total > 0 ? `${s.cleared}/${s.total}` : ''; }, render: (w) => clearanceText(w) },
  ];

  const clear = (): void => {
    setTerm('');
    setType('');
    setProp('');
    setStatus('');
  };

  const create = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> New {vocab.work.toLowerCase()}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader title={vocab.works} meta={works.records.length > 0 ? String(works.records.length) : undefined} subtitle={vocab.workHint} actions={create} />

      {works.loading && works.records.length === 0 ? (
        <Loading />
      ) : works.error !== null && works.records.length === 0 ? (
        <ErrorBox message={works.error} onRetry={works.refresh} />
      ) : works.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={BookOpen}
            title={`No ${vocab.works.toLowerCase()} yet`}
            message={`Add a ${vocab.work.toLowerCase()} to track its copyright, clearances, chain of title and the rights you hold in it.`}
            action={
              can.edit ? (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={15} aria-hidden /> New {vocab.work.toLowerCase()}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={`Search ${vocab.works.toLowerCase()}`} placeholder={`Search ${vocab.works.toLowerCase()}`} value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label="Type" value={type} placeholder="All types" options={typeOptions} onChange={(e) => setType(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-44">
              <Select aria-label={vocab.property} value={prop} placeholder={`All ${vocab.properties.toLowerCase()}`} options={usedProperties} onChange={(e) => setProp(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label="Status" value={status} placeholder="All statuses" options={options(WORK_STATUS_LABEL)} onChange={(e) => setStatus(e.target.value)} />
            </div>
            {filtering && (
              <Button size="sm" variant="ghost" onClick={clear}>
                Clear filters
              </Button>
            )}
            <div className="ml-auto">
              <Segmented<View>
                ariaLabel="View"
                value={view}
                onChange={(v) => setView(v)}
                options={[
                  { value: 'tree', label: 'Tree' },
                  { value: 'table', label: 'Table' },
                ]}
              />
            </div>
          </Toolbar>

          {filtering && matched.length === 0 ? (
            <Card>
              <EmptyHint
                compact
                icon={Search}
                title="Nothing matches these filters"
                message={`Try another search term, or clear the filters to see every ${vocab.work.toLowerCase()}.`}
                action={
                  <Button size="sm" variant="outline" onClick={clear}>
                    Clear filters
                  </Button>
                }
              />
            </Card>
          ) : view === 'tree' ? (
            <Card className="overflow-hidden">
              {filtering && (
                <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
                  {matched.length} of {works.records.length} match. Parents are shown for context.
                </div>
              )}
              <TreeTable<WorkRec>
                items={works.records}
                primaryLabel={vocab.work}
                visible={visible}
                expandAll={filtering}
                isMatch={matches}
                rowHref={(w) => href('work', w.id)}
                primary={(w) => (
                  <span className="flex min-w-0 items-center gap-2">
                    <WorkTypeLabel type={w.work_type} iconOnly />
                    <RowLink to={href('work', w.id)}>{w.title}</RowLink>
                  </span>
                )}
                columns={treeCols}
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              <DataTable<WorkRec>
                tableId="works"
                rows={matched}
                columns={tableCols}
                onRowClick={(w) => navigate('work', w.id)}
                exportName={vocab.works.toLowerCase()}
                initialSort={{ key: 'title', dir: 'asc' }}
              />
            </Card>
          )}
        </>
      )}

      {creating && (
        <WorkForm
          work={null}
          defaults={{ property: prop }}
          onClose={() => setCreating(false)}
          onSaved={(w) => navigate('work', w.id)}
        />
      )}
    </div>
  );
}
