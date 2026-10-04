/**
 * Titles: series over seasons over episodes, films, OVAs, streams, books
 * and the rest, as one tree, with type, franchise, status, publication date
 * and rights basis.
 */
import { useMemo, useState } from 'react';
import { BookOpen, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { TitleRec } from '../lib/records.ts';
import { DeleteButton, canDelete } from '../components/deleteRecord.tsx';
import { RowLink, TreeTable, altName, matchesTerm, namesText, withAncestors } from '../components/ipShared.tsx';
import type { TreeCol } from '../components/ipShared.tsx';
import { TitleForm, readExternalIds } from '../components/ipTitleForm.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Toolbar } from '../components/ui.tsx';

export function TitlesPage(): React.JSX.Element {
  const { can, on, franchises, nameOf } = useApp();
  const list = useCollection<TitleRec>('titles', { sort: 'episode_number,title' });
  const [term, setTerm] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [franchise, setFranchise] = useHashParam('franchise', '');
  const [status, setStatus] = useHashParam('status', '');
  const [creating, setCreating] = useState(false);

  const useFranchise = on('franchises');
  const filtering = term.trim() !== '' || type !== '' || status !== '' || (useFranchise && franchise !== '');
  const matches = (x: TitleRec): boolean =>
    (type === '' || x.title_type === type) &&
    (status === '' || x.status === status) &&
    (!useFranchise || franchise === '' || x.franchise === franchise) &&
    matchesTerm(term, x.title, namesText(x.names), x.authors, readExternalIds(x.external_ids).map((e) => e.value).join(' '), (x.tags ?? []).join(' '));
  const matched = filtering ? list.records.filter(matches) : list.records;
  const visible = filtering ? withAncestors(list.records, matches) : null;

  const usedFranchises = useMemo(() => {
    const ids = new Set(list.records.map((x) => x.franchise).filter((x) => x !== ''));
    return franchises.filter((f) => ids.has(f.id)).map((f) => ({ value: f.id, label: f.name }));
  }, [list.records, franchises]);

  const cols: TreeCol<TitleRec>[] = [
    { key: 'type', label: t('Type'), className: 'hidden md:table-cell', render: (x) => <span className="whitespace-nowrap text-[var(--agent-app-muted)]">{enumLabel('titles.title_type', x.title_type)}</span> },
    ...(useFranchise
      ? [{ key: 'franchise', label: t('Franchise'), className: 'hidden lg:table-cell', render: (x: TitleRec) => <span className="text-[var(--agent-app-muted)]">{nameOf('franchise', x.franchise)}</span> }]
      : []),
    { key: 'status', label: t('Status'), render: (x) => <EnumPill field="titles.status" value={x.status} /> },
    { key: 'pub', label: t('Publication date|title'), className: 'hidden sm:table-cell', render: (x) => <span className="whitespace-nowrap tabular-nums">{fmtDate(x.publication_date)}</span> },
    { key: 'basis', label: t('Rights basis'), className: 'hidden xl:table-cell', render: (x) => <span className="text-[var(--agent-app-muted)]">{enumLabel('titles.rights_basis', x.rights_basis)}</span> },
    ...(canDelete(can, 'titles')
      ? [{ key: 'delete', label: '', align: 'right' as const, render: (r: TitleRec) => <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}><DeleteButton collection="titles" id={r.id} iconOnly /></span> }]
      : []),
  ];

  const clear = (): void => {
    setTerm('');
    setType('');
    setFranchise('');
    setStatus('');
  };

  const create = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> {t('New title')}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title={t('Titles')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle={t('Series, seasons, episodes, films, streams and books, with the clearances, agreements and copyright term of each.')}
        actions={create}
      />

      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null && list.records.length === 0 ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={BookOpen}
            title={t('No titles yet')}
            message={t('Add a series, film or stream to track its clearances, chain of title, copyright term and the agreements that cover it.')}
            action={create}
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search titles')} placeholder={t('Search titles, authors or IDs')} value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label={t('Type')} value={type} placeholder={t('All types')} options={enumOptions('titles.title_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label={t('Status')} value={status} placeholder={t('All statuses')} options={enumOptions('titles.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
            </div>
            {useFranchise && usedFranchises.length > 0 && (
              <div className="w-full sm:w-48">
                <Select aria-label={t('Franchise')} value={franchise} placeholder={t('All franchises')} options={usedFranchises} onChange={(e) => setFranchise(e.target.value)} />
              </div>
            )}
            {filtering && (
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('Clear filters')}
              </Button>
            )}
          </Toolbar>

          {filtering && matched.length === 0 ? (
            <Card>
              <EmptyHint
                compact
                icon={Search}
                title={t('Nothing matches these filters')}
                message={t('Try another search term, or clear the filters.')}
                action={
                  <Button size="sm" variant="outline" onClick={clear}>
                    {t('Clear filters')}
                  </Button>
                }
              />
            </Card>
          ) : (
            <Card className="overflow-hidden">
              {filtering && (
                <div className="border-b border-[var(--agent-app-border)] px-4 py-2 text-xs text-[var(--agent-app-muted)]">
                  {t('{n} of {total} match. Parents are shown for context.', { n: matched.length, total: list.records.length })}
                </div>
              )}
              <TreeTable<TitleRec>
                items={list.records}
                primaryLabel={t('Title|work name')}
                visible={visible}
                expandAll={filtering}
                isMatch={matches}
                rowHref={(x) => href('title', x.id)}
                primary={(x) => {
                  const alt = altName(x.names, x.title);
                  return (
                    <span className="flex min-w-0 flex-col">
                      <span className="flex min-w-0 items-baseline gap-2">
                        {x.title_type === 'episode' && x.episode_number > 0 && <span className="shrink-0 font-mono text-[11.5px] text-[var(--agent-app-muted)]">#{x.episode_number}</span>}
                        <RowLink to={href('title', x.id)}>{x.title}</RowLink>
                      </span>
                      {alt !== '' && <span className="truncate text-xs text-[var(--agent-app-muted)]">{alt}</span>}
                    </span>
                  );
                }}
                columns={cols}
              />
            </Card>
          )}
        </>
      )}

      {creating && <TitleForm title={null} defaults={{ franchise: useFranchise ? franchise : '' }} onClose={() => setCreating(false)} onSaved={(x) => navigate('title', x.id)} />}
    </div>
  );
}
