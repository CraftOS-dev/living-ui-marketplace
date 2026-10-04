/**
 * Talents: VTubers, voice actors, singers and other performers by stage
 * name, with type, affiliation, where they are in their lifecycle, debut,
 * managers and the characters they play. Legal identities never appear in
 * this list.
 */
import { useMemo, useState } from 'react';
import { Mic, Plus, Search } from 'lucide-react';
import { Button, Card, Input, Select } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, joinList, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { CastingRec, TalentRec } from '../lib/records.ts';
import { DeleteButton, canDelete } from '../components/deleteRecord.tsx';
import { TalentForm } from '../components/ipTalentForm.tsx';
import { PeopleChips, RowLink, SimpleTable, Thumb, altName, isCurrentCasting, matchesTerm, namesText } from '../components/ipShared.tsx';
import type { SimpleCol } from '../components/ipShared.tsx';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Toolbar } from '../components/ui.tsx';

export function TalentsPage(): React.JSX.Element {
  const { can, nameOf } = useApp();
  const list = useCollection<TalentRec>('talents', { sort: 'stage_name' });
  const castings = useCollection<CastingRec>('castings', { sort: '-start_date' });
  const [term, setTerm] = useHashParam('q', '');
  const [lifecycle, setLifecycle] = useHashParam('lifecycle', '');
  const [type, setType] = useHashParam('type', '');
  const [creating, setCreating] = useState(false);

  const plays = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const c of castings.records) {
      if (!isCurrentCasting(c)) continue;
      const name = nameOf('character', c.character);
      if (name === '') continue;
      const arr = m.get(c.talent) ?? [];
      if (!arr.includes(name)) arr.push(name);
      m.set(c.talent, arr);
    }
    return m;
  }, [castings.records, nameOf]);

  const filtering = term.trim() !== '' || lifecycle !== '' || type !== '';
  const rows = list.records.filter(
    (x) => (lifecycle === '' || x.lifecycle === lifecycle) && (type === '' || x.talent_type === type) && matchesTerm(term, x.stage_name, namesText(x.names), (plays.get(x.id) ?? []).join(' ')),
  );

  const clear = (): void => {
    setTerm('');
    setLifecycle('');
    setType('');
  };

  const cols: SimpleCol<TalentRec>[] = [
    {
      key: 'name',
      label: t('Stage name|talent'),
      render: (x) => {
        const alt = altName(x.names, x.stage_name);
        return (
          <span className="flex min-w-0 items-center gap-2">
            <Thumb record={x} image={x.image} name={x.stage_name} />
            <span className="flex min-w-0 flex-col">
              <RowLink to={href('talent', x.id)}>{x.stage_name}</RowLink>
              {alt !== '' && <span className="truncate text-xs text-[var(--agent-app-muted)]">{alt}</span>}
            </span>
          </span>
        );
      },
    },
    { key: 'type', label: t('Type'), className: 'hidden md:table-cell', render: (x) => <span className="text-[var(--agent-app-muted)]">{enumLabel('talents.talent_type', x.talent_type)}</span> },
    { key: 'aff', label: t('Affiliation'), className: 'hidden lg:table-cell', render: (x) => <span className="text-[var(--agent-app-muted)]">{enumLabel('talents.affiliation', x.affiliation)}</span> },
    { key: 'life', label: t('Lifecycle'), render: (x) => <EnumPill field="talents.lifecycle" value={x.lifecycle} /> },
    { key: 'debut', label: t('Debut date'), className: 'hidden sm:table-cell', render: (x) => <span className="whitespace-nowrap tabular-nums">{fmtDate(x.debut_date)}</span> },
    { key: 'managers', label: t('Managers|talent'), className: 'hidden xl:table-cell', render: (x) => <PeopleChips ids={x.managers} /> },
    {
      key: 'plays',
      label: t('Characters'),
      className: 'hidden lg:table-cell',
      render: (x) => {
        const p = plays.get(x.id) ?? [];
        return <span className="block max-w-[16rem] truncate">{p.length > 2 ? t('{names} and {n} more', { names: joinList(p.slice(0, 2)), n: p.length - 2 }) : joinList(p)}</span>;
      },
    },
    ...(canDelete(can, 'talents')
      ? [{ key: 'delete', label: '', align: 'right' as const, render: (r: TalentRec) => <span className="inline-flex justify-end" onClick={(e) => e.stopPropagation()}><DeleteButton collection="talents" id={r.id} iconOnly /></span> }]
      : []),
  ];

  const create = can.talent ? (
    <Button onClick={() => setCreating(true)}>
      <Plus size={15} aria-hidden /> {t('New talent')}
    </Button>
  ) : undefined;

  return (
    <div>
      <PageHeader
        title={t('Talents')}
        meta={list.records.length > 0 ? String(list.records.length) : undefined}
        subtitle={t('Performers by stage name, where each one is in their lifecycle, and the characters they play. Legal identities stay private.')}
        actions={create}
      />

      {list.loading && list.records.length === 0 ? (
        <Loading />
      ) : list.error !== null && list.records.length === 0 ? (
        <ErrorBox message={list.error} onRetry={list.refresh} />
      ) : list.records.length === 0 ? (
        <Card>
          <EmptyHint
            icon={Mic}
            title={t('No talents yet')}
            message={t('Add a talent by stage name. Debuts, hiatuses and graduations then lay out their playbooks, and birthdays and anniversaries become reminders.')}
            action={create}
          />
        </Card>
      ) : (
        <>
          <Toolbar>
            <div className="relative w-full sm:w-64">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 z-10 -translate-y-1/2 text-[var(--agent-app-muted)]" aria-hidden />
              <Input aria-label={t('Search talents')} placeholder={t('Search names in any script')} value={term} onChange={(e) => setTerm(e.target.value)} className="pl-8" />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-48">
              <Select
                aria-label={t('Lifecycle')}
                value={lifecycle}
                placeholder={t('Every lifecycle stage')}
                options={enumOptions('talents.lifecycle').map(([value, label]) => ({ value, label }))}
                onChange={(e) => setLifecycle(e.target.value)}
              />
            </div>
            <div className="w-[calc(50%-0.25rem)] sm:w-40">
              <Select aria-label={t('Type')} value={type} placeholder={t('All types')} options={enumOptions('talents.talent_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
            </div>
            {filtering && (
              <Button size="sm" variant="ghost" onClick={clear}>
                {t('Clear filters')}
              </Button>
            )}
          </Toolbar>

          <Card className="overflow-hidden">
            {rows.length === 0 ? (
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
            ) : (
              <SimpleTable rows={rows} cols={cols} onRowClick={(x) => navigate('talent', x.id)} />
            )}
          </Card>
        </>
      )}

      {creating && <TalentForm talent={null} onClose={() => setCreating(false)} onSaved={(x) => navigate('talent', x.id)} />}
    </div>
  );
}
