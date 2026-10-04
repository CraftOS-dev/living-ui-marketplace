/**
 * Franchises: anime series, VTuber agencies and groups, character brands,
 * as a tree (a group inside an agency, a spin-off inside a series), with
 * kind, ownership model, status and how many characters and titles each
 * holds.
 */
import { useMemo, useState } from 'react';
import { Layers, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { FranchiseRec } from '../lib/records.ts';
import { DeleteButton, canDelete } from '../components/deleteRecord.tsx';
import { FranchiseForm } from '../components/ipFranchiseForm.tsx';
import { CountCell, RowLink, Thumb, TreeTable, altName, matchesTerm, namesText, withAncestors } from '../components/ipShared.tsx';
import type { TreeCol } from '../components/ipShared.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Toolbar } from '../components/ui.tsx';

export function FranchisesPage(): React.JSX.Element {
  const { can, on, characters, titles } = useApp();
  const list = useCollection<FranchiseRec>('franchises', { sort: 'name' });
  const [term, setTerm] = useHashParam('q', '');
  const [kind, setKind] = useHashParam('kind', '');
  const [status, setStatus] = useHashParam('status', '');
  const [creating, setCreating] = useState(false);

  const charCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of characters) if (c.franchise !== '') m.set(c.franchise, (m.get(c.franchise) ?? 0) + 1);
    return m;
  }, [characters]);
  const titleCount = useMemo(() => {
    const m = new Map<string, number>();
    for (const x of titles) if (x.franchise !== '') m.set(x.franchise, (m.get(x.franchise) ?? 0) + 1);
    return m;
  }, [titles]);

  const filtering = term.trim() !== '' || kind !== '' || status !== '';
  const matches = (f: FranchiseRec): boolean =>
    (kind === '' || f.kind === kind) && (status === '' || f.status === status) && matchesTerm(term, f.name, namesText(f.names), f.description, (f.tags ?? []).join(' '));
  const matched = filtering ? list.records.filter(matches) : list.records;
  const visible = filtering ? withAncestors(list.records, matches) : null;

  const cols: TreeCol<FranchiseRec>[] = [
    { key: 'kind', label: t('Kind'), className: 'hidden md:table-cell', render: (f) => <span className="text-[var(--agent-app-muted)]">{enumLabel('franchises.kind', f.kind)}</span> },
    { key: 'own', label: t('Ownership model'), className: 'hidden lg:table-cell', render: (f) => <span className="text-[var(--agent-app-muted)]">{enumLabel('franchises.ownership_model', f.ownership_model)}</span> },
    { key: 'status', label: t('Status'), render: (f) => <EnumPill field="franchises.status" value={f.status} /> },
    { key: 'chars', label: t('Characters'), align: 'right', className: 'hidden sm:table-cell', render: (f) => <CountCell n={charCount.get(f.id) ?? 0} /> },
    ...(on('titles') ? [{ key: 'titles', label: t('Titles'), align: 'right' as const, className: 'hidden sm:table-cell', render: (f: FranchiseRec) => <CountCell n={titleCount.get(f.id) ?? 0} /> }] : []),
    ...(canDelete(can, 'franchises')
      ? [{ key: 'delete', label: '', align: 'right' as const, render: (r: FranchiseRec) => <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}><DeleteButton collection="franchises" id={r.id} iconOnly /></span> }]
      : []),
  ];

  const clear = (): void => {
    setTerm('');
    setKind('');
    setStatus('');
  };

  const create = can.edit ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> {t('New franchise')}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title={t('Franchises')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle={t('Series, agencies, groups and brands, with the characters, titles, agreements and trademarks each one holds.')}
        actions={create}
      />

      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null && list.records.length === 0 ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={Layers}
            title={t('No franchises yet')}
            message={t('Add your first series, VTuber group or character brand. Characters, titles, agreements and trademarks then hang off it.')}
            action={create}
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search franchises')} placeholder={t('Search names in any script')} value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-44">
              <Select aria-label={t('Kind')} value={kind} placeholder={t('All kinds')} options={enumOptions('franchises.kind').map(([value, label]) => ({ value, label }))} onChange={(e) => setKind(e.target.value)} />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label={t('Status')} value={status} placeholder={t('All statuses')} options={enumOptions('franchises.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
            </div>
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
              <TreeTable<FranchiseRec>
                items={list.records}
                primaryLabel={t('Franchise')}
                visible={visible}
                expandAll={filtering}
                isMatch={matches}
                rowHref={(f) => href('franchise', f.id)}
                primary={(f) => {
                  const alt = altName(f.names, f.name);
                  return (
                    <span className="flex min-w-0 items-center gap-2">
                      <Thumb record={f} image={f.image} name={f.name} size="sm" />
                      <span className="flex min-w-0 flex-col">
                        <RowLink to={href('franchise', f.id)}>{f.name}</RowLink>
                        {alt !== '' && <span className="truncate text-xs text-[var(--agent-app-muted)]">{alt}</span>}
                      </span>
                    </span>
                  );
                }}
                columns={cols}
              />
            </Card>
          )}
        </>
      )}

      {creating && <FranchiseForm franchise={null} defaults={{ kind: kind as FranchiseRec['kind'] }} onClose={() => setCreating(false)} onSaved={(f) => navigate('franchise', f.id)} />}
    </div>
  );
}
