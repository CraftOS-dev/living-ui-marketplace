/**
 * One title (series, season, episode, film, stream, book...): its facts and
 * identifiers, copyright term in Japan, the US and the EU, production
 * clearances, episodes, agreements, songs, deadlines, documents and history.
 */
import { useMemo, useState } from 'react';
import { BookOpen, CalendarPlus, Pencil, Plus, Scale } from 'lucide-react';
import { Button, Card, CardContent, TabsContent, useRecord } from '../../kit/index.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { TitleRec } from '../lib/records.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EventDialog } from '../components/events.tsx';
import { AgreementsSection, CommitteeLink, DeadlinesSection, HistorySection, NextDeadlines, SongsSection } from '../components/ipRelated.tsx';
import { NamesLine, RecordTabs, RowLink, Thumb, TreeTable, ancestorsOf, pickTab, yesNo } from '../components/ipShared.tsx';
import type { TabDef } from '../components/ipShared.tsx';
import { TitleForm, externalIdLabel, readExternalIds } from '../components/ipTitleForm.tsx';
import { ClearancesSection, CopyrightTermSection } from '../components/ipTitleTools.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, Loading, Prose, Section, Tag } from '../components/ui.tsx';

type Dlg = { kind: 'edit' } | { kind: 'event' } | { kind: 'child'; type: 'season' | 'episode' } | null;

export function TitlePage({ id }: { id: string }): React.JSX.Element {
  const { can, on, titles, nameOf } = useApp();
  const { record: w, loading, error } = useRecord<TitleRec>('titles', id !== '' ? id : null);
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<Dlg>(null);

  const children = useMemo(() => titles.filter((x) => x.parent === id), [titles, id]);
  const descendants = useMemo(() => {
    const out = new Set<string>();
    const stack = [id];
    while (stack.length > 0) {
      const cur = stack.pop();
      for (const x of titles) {
        if (x.parent === cur && !out.has(x.id) && x.id !== id) {
          out.add(x.id);
          stack.push(x.id);
        }
      }
    }
    return titles.filter((x) => out.has(x.id));
  }, [titles, id]);

  const tabs: TabDef[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'copyright', label: t('Copyright term') },
    { value: 'clearances', label: t('Clearances') },
    { value: 'episodes', label: t('Episodes'), count: children.length },
    { value: 'agreements', label: t('Agreements') },
    ...(on('music') ? [{ value: 'songs', label: t('Songs') }] : []),
    { value: 'deadlines', label: t('Deadlines') },
    { value: 'documents', label: t('Documents') },
    { value: 'history', label: t('History') },
  ];
  const tab = pickTab(tabs, tabParam);

  if (id === '') {
    return <EmptyHint icon={BookOpen} title={t('Choose a title')} action={<Button onClick={() => navigate('titles')}>{t('Open titles')}</Button>} />;
  }
  if (loading && w === null) return <Loading />;
  if (w === null) {
    return (
      <Card>
        <EmptyHint
          icon={BookOpen}
          title={t('This title was not found')}
          message={error ?? t('It may have been deleted.')}
          action={
            <Button variant="outline" onClick={() => navigate('titles')}>
              {t('Back to titles')}
            </Button>
          }
        />
      </Card>
    );
  }

  const wid = q(w.id);
  const lineage = ancestorsOf(titles, w.id).reverse();
  const ids = readExternalIds(w.external_ids);
  const nextEpisode = children.reduce((m, x) => Math.max(m, x.episode_number), 0) + 1;
  const childDefaults = (type: 'season' | 'episode'): Partial<Pick<TitleRec, 'parent' | 'franchise' | 'title_type' | 'episode_number' | 'rights_basis' | 'committee'>> => ({
    parent: w.id,
    franchise: w.franchise,
    title_type: type,
    rights_basis: w.rights_basis,
    committee: w.committee,
    ...(type === 'episode' ? { episode_number: nextEpisode } : {}),
  });

  const recordEvent = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'event' })}>
      <CalendarPlus size={13} aria-hidden /> {t('Record event')}
    </Button>
  ) : undefined;

  const addChild = can.edit ? (
    <span className="flex flex-wrap gap-1.5">
      {w.title_type === 'series' && (
        <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'child', type: 'season' })}>
          <Plus size={13} aria-hidden /> {t('Add season')}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={() => setDlg({ kind: 'child', type: 'episode' })}>
        <Plus size={13} aria-hidden /> {t('Add episode')}
      </Button>
    </span>
  ) : undefined;

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label={t('Breadcrumb')}>
        <a href={href('titles')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {t('Titles')}
        </a>
        {lineage.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <a href={href('title', a.id)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {a.title}
            </a>
          </span>
        ))}
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={w} image={w.image} name={w.title} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold tracking-tight">
              {w.title_type === 'episode' && w.episode_number > 0 && <span className="mr-2 font-mono text-base text-[var(--agent-app-muted)]">#{w.episode_number}</span>}
              {w.title}
            </h1>
            <NamesLine names={w.names} primary={w.title} className="mt-1" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {w.title_type !== '' && <Tag>{enumLabel('titles.title_type', w.title_type)}</Tag>}
              <EnumPill field="titles.status" value={w.status} />
              {w.rights_basis !== '' && <span className="text-[var(--agent-app-muted)]">{enumLabel('titles.rights_basis', w.rights_basis)}</span>}
              {on('franchises') && w.franchise !== '' && (
                <a href={href('franchise', w.franchise)} className="text-[var(--agent-app-muted)] hover:underline">
                  {nameOf('franchise', w.franchise)}
                </a>
              )}
            </div>
            {d10(w.publication_date) !== '' && <div className="mt-2 text-[13px] text-[var(--agent-app-muted)]">{t('Published {date}', { date: fmtDate(w.publication_date) })}</div>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {recordEvent}
            <Button variant="outline" size="sm" onClick={() => navigate('canwe', undefined, { asset: `work:${w.id}` })}>
              <Scale size={13} aria-hidden /> {t('Can we?')}
            </Button>
            {can.edit && (
              <Button variant="outline" size="sm" onClick={() => setDlg({ kind: 'edit' })}>
                <Pencil size={13} aria-hidden /> {t('Edit')}
              </Button>
            )}
            <DeleteButton collection="titles" id={w.id} onDeleted={() => navigate('titles')} />
          </div>
        </CardContent>
      </Card>

      <RecordTabs tabs={tabs} value={tab} onChange={setTab}>
        <TabsContent value="overview" className="flex flex-col gap-5">
          <Section title={t('Facts')}>
            <FactGrid>
              <Fact label={t('Type')} value={enumLabel('titles.title_type', w.title_type)} />
              <Fact label={t('Status')} value={enumLabel('titles.status', w.status)} />
              <Fact label={t('Rights basis')} value={enumLabel('titles.rights_basis', w.rights_basis)} />
              {on('franchises') && (
                <Fact
                  label={t('Franchise')}
                  value={
                    w.franchise !== '' ? (
                      <a href={href('franchise', w.franchise)} className="hover:underline">
                        {nameOf('franchise', w.franchise)}
                      </a>
                    ) : (
                      ''
                    )
                  }
                />
              )}
              <Fact
                label={t('Part of')}
                value={
                  w.parent !== '' ? (
                    <a href={href('title', w.parent)} className="hover:underline">
                      {nameOf('work', w.parent)}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              {on('committees') && <Fact label={t('Production committee')} value={w.committee !== '' ? <CommitteeLink id={w.committee} /> : ''} />}
              <Fact label={t('Creation date')} value={fmtDate(w.creation_date)} />
              <Fact label={t('Publication date|title')} value={fmtDate(w.publication_date)} />
              <Fact label={t('Publication country')} value={w.publication_country !== '' ? jurisdictionName(w.publication_country) : ''} />
              {w.episode_number > 0 && <Fact label={t('Episode number')} value={String(w.episode_number)} />}
              <Fact label={t('Made for hire')} value={yesNo(w.made_for_hire)} />
              <Fact label={t('Author kind')} value={enumLabel('titles.author_kind', w.author_kind)} />
              <Fact label={t('Authors')} value={w.authors} />
              <Fact label={t('Author death year')} value={w.author_death_year > 0 ? String(w.author_death_year) : ''} />
              <Fact label={t('Language')} value={w.language} />
              <Fact label={t('Announcement date')} value={fmtDate(w.announcement_date)} />
            </FactGrid>
          </Section>

          <Section title={t('External identifiers')} meta={ids.length > 0 ? String(ids.length) : undefined} flush>
            {ids.length === 0 ? (
              <EmptyHint compact title={t('No identifiers yet')} message={t('Add EIDR, ISAN, Media Arts Database, streaming service IDs or JAN codes in the edit form.')} />
            ) : (
              ids.map((x, i) => (
                <div key={`${x.type}-${i}`} className="flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-[var(--agent-app-border)]/70 px-4 py-2 last:border-0">
                  <span className="w-40 shrink-0 text-[12.5px] text-[var(--agent-app-muted)]">{externalIdLabel(x.type)}</span>
                  <span className="min-w-0 break-all font-mono text-[12.5px]">{x.value}</span>
                  {x.note !== undefined && x.note !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{x.note}</span>}
                </div>
              ))
            )}
          </Section>

          <NextDeadlines field="work" id={w.id} onShowAll={() => setTab('deadlines')} />

          {(w.description !== '' || w.notes !== '') && (
            <Section title={t('Description')}>
              {w.description !== '' && <Prose>{w.description}</Prose>}
              {w.notes !== '' && <Prose className="mt-3 text-[var(--agent-app-muted)]">{w.notes}</Prose>}
            </Section>
          )}
        </TabsContent>

        <TabsContent value="copyright">
          <CopyrightTermSection title={w} onEdit={can.edit ? () => setDlg({ kind: 'edit' }) : undefined} />
        </TabsContent>

        <TabsContent value="clearances">
          <ClearancesSection title={w} />
        </TabsContent>

        <TabsContent value="episodes">
          <Section title={t('Episodes and parts')} meta={children.length > 0 ? String(children.length) : undefined} actions={addChild} flush>
            {descendants.length === 0 ? (
              <EmptyHint
                compact
                icon={BookOpen}
                title={t('No episodes yet')}
                message={t('Seasons and episodes under this title appear here. Each episode keeps its own publication date and copyright term.')}
                action={addChild}
              />
            ) : (
              <TreeTable
                items={descendants}
                primaryLabel={t('Title|work name')}
                rowHref={(x) => href('title', x.id)}
                primary={(x) => (
                  <span className="flex min-w-0 items-baseline gap-2">
                    {x.episode_number > 0 && <span className="shrink-0 font-mono text-[11.5px] text-[var(--agent-app-muted)]">#{x.episode_number}</span>}
                    <RowLink to={href('title', x.id)}>{x.title}</RowLink>
                  </span>
                )}
                columns={[
                  { key: 'type', label: t('Type'), className: 'hidden sm:table-cell', render: (x) => <span className="text-[var(--agent-app-muted)]">{enumLabel('titles.title_type', x.title_type)}</span> },
                  { key: 'status', label: t('Status'), render: (x) => <EnumPill field="titles.status" value={x.status} /> },
                  { key: 'pub', label: t('Publication date|title'), className: 'hidden md:table-cell', render: (x) => <span className="whitespace-nowrap tabular-nums">{fmtDate(x.publication_date)}</span> },
                ]}
              />
            )}
          </Section>
        </TabsContent>

        <TabsContent value="agreements">
          <AgreementsSection filter={`work = ${wid}`} emptyMessage={t('Original work licences, production, broadcast, streaming and other agreements for this title appear here.')} />
        </TabsContent>

        {on('music') && (
          <TabsContent value="songs">
            <SongsSection songFilter={`work = ${wid}`} emptyMessage={t('Opening, ending, insert songs and BGM tied to this title appear here.')} />
          </TabsContent>
        )}

        <TabsContent value="deadlines">
          <DeadlinesSection field="work" id={w.id} emptyMessage={t('Clearance due and expiry dates, copyright and agreement dates and events recorded on this title appear here.')} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="work" relationId={w.id} extraction />
        </TabsContent>

        <TabsContent value="history">
          <HistorySection field="work" id={w.id} actions={recordEvent} />
        </TabsContent>
      </RecordTabs>

      {dlg !== null && dlg.kind === 'edit' && <TitleForm title={w} onClose={() => setDlg(null)} />}
      {dlg !== null && dlg.kind === 'event' && <EventDialog subjectType="work" subjectId={w.id} initialCode="WORK_PUBLISHED" onClose={() => setDlg(null)} onDone={() => undefined} />}
      {dlg !== null && dlg.kind === 'child' && <TitleForm title={null} defaults={childDefaults(dlg.type)} onClose={() => setDlg(null)} onSaved={(x) => navigate('title', x.id)} />}
    </div>
  );
}
