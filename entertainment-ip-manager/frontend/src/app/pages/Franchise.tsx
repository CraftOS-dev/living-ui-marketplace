/**
 * One franchise: what it is and who owns it, its © lines per territory,
 * its characters and titles, the agreements and trademarks that cover it,
 * its products and production committees, and its documents.
 */
import { useMemo, useState } from 'react';
import { BookOpen, Layers, Pencil, Plus, Scale, UserRound } from 'lucide-react';
import { Button, Card, CardContent, TabsContent, useRecord } from '../../kit/index.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { jurisdictionName } from '../lib/labels.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { FranchiseRec } from '../lib/records.ts';
import type { CopyrightLine } from '../lib/shapes.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { CharacterForm } from '../components/ipCharacterForm.tsx';
import { CoverageMatrix } from '../components/ipCoverage.tsx';
import { CopyrightLinesDialog, FranchiseForm } from '../components/ipFranchiseForm.tsx';
import { AgreementsSection, CommitteeLink, CommitteesSection, MattersSection, ProductsSection } from '../components/ipRelated.tsx';
import { NamesLine, RecordTabs, RowLink, Thumb, TreeTable, altName, ancestorsOf, asRows, pickTab } from '../components/ipShared.tsx';
import type { TabDef } from '../components/ipShared.tsx';
import { TitleForm } from '../components/ipTitleForm.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, JurChip, ListRow, Loading, Prose, Section, Tag } from '../components/ui.tsx';

export function FranchisePage({ id }: { id: string }): React.JSX.Element {
  const { can, on, franchises, characters, titles, nameOf } = useApp();
  const { record: f, loading, error } = useRecord<FranchiseRec>('franchises', id !== '' ? id : null);
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<'edit' | 'lines' | 'character' | 'title' | null>(null);

  const myCharacters = useMemo(() => characters.filter((c) => c.franchise === id), [characters, id]);
  const myTitles = useMemo(() => titles.filter((x) => x.franchise === id), [titles, id]);

  const tabs: TabDef[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'characters', label: t('Characters'), count: myCharacters.length },
    ...(on('titles') ? [{ value: 'titles', label: t('Titles'), count: myTitles.length }] : []),
    { value: 'agreements', label: t('Agreements') },
    { value: 'trademarks', label: t('Trademarks') },
    ...(on('products') ? [{ value: 'products', label: t('Products') }] : []),
    ...(on('committees') ? [{ value: 'committees', label: t('Committees') }] : []),
    { value: 'documents', label: t('Documents') },
  ];
  const tab = pickTab(tabs, tabParam);

  if (id === '') {
    return <EmptyHint icon={Layers} title={t('Choose a franchise')} action={<Button onClick={() => navigate('franchises')}>{t('Open franchises')}</Button>} />;
  }
  if (loading && f === null) return <Loading />;
  if (f === null) {
    return (
      <Card>
        <EmptyHint
          icon={Layers}
          title={t('This franchise was not found')}
          message={error ?? t('It may have been deleted.')}
          action={
            <Button variant="outline" onClick={() => navigate('franchises')}>
              {t('Back to franchises')}
            </Button>
          }
        />
      </Card>
    );
  }

  const lineage = ancestorsOf(franchises, f.id).reverse();
  const children = franchises.filter((x) => x.parent === f.id);
  const lines = asRows<CopyrightLine>(f.copyright_lines);
  const fid = q(f.id);

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label={t('Breadcrumb')}>
        <a href={href('franchises')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {t('Franchises')}
        </a>
        {lineage.map((a) => (
          <span key={a.id} className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <a href={href('franchise', a.id)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {a.name}
            </a>
          </span>
        ))}
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={f} image={f.image} name={f.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold tracking-tight">{f.name}</h1>
            <NamesLine names={f.names} primary={f.name} className="mt-1" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {f.kind !== '' && <Tag>{enumLabel('franchises.kind', f.kind)}</Tag>}
              <EnumPill field="franchises.status" value={f.status} />
              {f.ownership_model !== '' && <span className="text-[var(--agent-app-muted)]">{enumLabel('franchises.ownership_model', f.ownership_model)}</span>}
            </div>
            {f.description !== '' && <p className="mt-2 line-clamp-2 max-w-3xl break-words text-[13px] text-[var(--agent-app-text)]/85">{f.description}</p>}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => navigate('canwe', undefined, { asset: `franchise:${f.id}` })}>
              <Scale size={13} aria-hidden /> {t('Can we?')}
            </Button>
            {can.edit && (
              <Button variant="outline" size="sm" onClick={() => setDlg('edit')}>
                <Pencil size={13} aria-hidden /> {t('Edit')}
              </Button>
            )}
            <DeleteButton collection="franchises" id={f.id} onDeleted={() => navigate('franchises')} />
          </div>
        </CardContent>
      </Card>

      <RecordTabs tabs={tabs} value={tab} onChange={setTab}>
        <TabsContent value="overview" className="flex flex-col gap-5">
          <Section title={t('Facts')}>
            <FactGrid>
              <Fact label={t('Kind')} value={enumLabel('franchises.kind', f.kind)} />
              <Fact label={t('Ownership model')} value={enumLabel('franchises.ownership_model', f.ownership_model)} />
              <Fact label={t('Status')} value={enumLabel('franchises.status', f.status)} />
              <Fact
                label={t('Part of')}
                value={
                  f.parent !== '' ? (
                    <a href={href('franchise', f.parent)} className="hover:underline">
                      {nameOf('franchise', f.parent)}
                    </a>
                  ) : (
                    ''
                  )
                }
              />
              <Fact label={t('Announcement date')} value={fmtDate(f.announcement_date)} />
              <Fact label={t('Style guide version')} value={f.style_guide_version} mono />
              {on('titles') && (
                <Fact
                  label={t('Original work')}
                  value={
                    f.original_work !== '' ? (
                      <a href={href('title', f.original_work)} className="hover:underline">
                        {nameOf('work', f.original_work)}
                      </a>
                    ) : (
                      ''
                    )
                  }
                />
              )}
              {on('committees') && (
                <Fact
                  label={t('Production committee')}
                  value={
f.committee !== '' ? <CommitteeLink id={f.committee} /> : ''
                  }
                />
              )}
            </FactGrid>
          </Section>

          <Section
            title={t('Copyright lines')}
            meta={lines.length > 0 ? String(lines.length) : undefined}
            actions={
              can.edit ? (
                <Button size="sm" variant="outline" onClick={() => setDlg('lines')}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
              ) : undefined
            }
            flush
          >
            {lines.length === 0 ? (
              <EmptyHint compact title={t('No copyright lines yet')} message={t('Add the © notice licensees must print, per territory. Products and licences quote it.')} />
            ) : (
              lines.map((l, i) => (
                <div key={`${l.territory}-${i}`} className="flex min-w-0 items-start gap-3 border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
                  <span className="w-28 shrink-0 text-[12.5px] text-[var(--agent-app-muted)] sm:w-40">
                    {l.territory === '' || l.territory === 'WORLD' || l.territory === '*' ? t('Everywhere else (default)') : (
                      <span className="inline-flex items-center gap-1.5">
                        <JurChip code={l.territory} />
                        <span className="hidden truncate sm:inline">{jurisdictionName(l.territory)}</span>
                      </span>
                    )}
                  </span>
                  <span className="min-w-0 break-words font-mono text-[12.5px]">{l.text}</span>
                </div>
              ))
            )}
          </Section>

          {f.description !== '' && (
            <Section title={t('Description')}>
              <Prose>{f.description}</Prose>
            </Section>
          )}

          {children.length > 0 && (
            <Section title={t('Inside this franchise')} meta={String(children.length)} flush>
              {children.map((c) => (
                <ListRow
                  key={c.id}
                  leading={<Thumb record={c} image={c.image} name={c.name} size="sm" />}
                  primary={c.name}
                  secondary={enumLabel('franchises.kind', c.kind) || undefined}
                  trailing={<EnumPill field="franchises.status" value={c.status} />}
                  onClick={() => navigate('franchise', c.id)}
                />
              ))}
            </Section>
          )}
        </TabsContent>

        <TabsContent value="characters">
          <Section
            title={t('Characters')}
            meta={myCharacters.length > 0 ? String(myCharacters.length) : undefined}
            actions={
              can.edit ? (
                <Button size="sm" variant="outline" onClick={() => setDlg('character')}>
                  <Plus size={13} aria-hidden /> {t('New character')}
                </Button>
              ) : undefined
            }
            flush
          >
            {myCharacters.length === 0 ? (
              <EmptyHint compact icon={UserRound} title={t('No characters yet')} message={t('Characters of this franchise appear here, each with its rights stack, performers and trademarks.')} />
            ) : (
              myCharacters.map((c) => {
                const alt = altName(c.names, c.name);
                return (
                  <ListRow
                    key={c.id}
                    leading={<Thumb record={c} image={c.image} name={c.name} />}
                    primary={c.name}
                    secondary={[alt, enumLabel('characters.kind', c.kind)].filter((x) => x !== '').join(' · ') || undefined}
                    trailing={<EnumPill field="characters.status" value={c.status} />}
                    onClick={() => navigate('character', c.id)}
                  />
                );
              })
            )}
          </Section>
        </TabsContent>

        {on('titles') && (
          <TabsContent value="titles">
            <Section
              title={t('Titles')}
              meta={myTitles.length > 0 ? String(myTitles.length) : undefined}
              actions={
                can.edit ? (
                  <Button size="sm" variant="outline" onClick={() => setDlg('title')}>
                    <Plus size={13} aria-hidden /> {t('New title')}
                  </Button>
                ) : undefined
              }
              flush
            >
              {myTitles.length === 0 ? (
                <EmptyHint compact icon={BookOpen} title={t('No titles yet')} message={t('Series, seasons, episodes, films and streams of this franchise appear here.')} />
              ) : (
                <TreeTable
                  items={myTitles}
                  primaryLabel={t('Title|work name')}
                  rowHref={(x) => href('title', x.id)}
                  primary={(x) => <RowLink to={href('title', x.id)}>{x.title}</RowLink>}
                  columns={[
                    { key: 'type', label: t('Type'), className: 'hidden sm:table-cell', render: (x) => <span className="text-[var(--agent-app-muted)]">{enumLabel('titles.title_type', x.title_type)}</span> },
                    { key: 'status', label: t('Status'), render: (x) => <EnumPill field="titles.status" value={x.status} /> },
                    { key: 'pub', label: t('Publication date|title'), className: 'hidden md:table-cell', render: (x) => <span className="whitespace-nowrap tabular-nums">{fmtDate(x.publication_date)}</span> },
                  ]}
                />
              )}
            </Section>
          </TabsContent>
        )}

        <TabsContent value="agreements">
          <AgreementsSection filter={`franchise = ${fid}`} emptyMessage={t('Licences, committee agreements and commissions linked to this franchise appear here.')} />
        </TabsContent>

        <TabsContent value="trademarks" className="flex flex-col gap-5">
          <CoverageMatrix type="franchise" id={f.id} />
          <MattersSection filter={`franchise = ${fid}`} emptyMessage={t('Trademarks and designs filed for this franchise appear here. Link a mark to the franchise on its own page.')} />
        </TabsContent>

        {on('products') && (
          <TabsContent value="products">
            <ProductsSection filter={`franchise = ${fid}`} emptyMessage={t('Licensed and own products of this franchise appear here.')} />
          </TabsContent>
        )}

        {on('committees') && (
          <TabsContent value="committees">
            <CommitteesSection filter={`franchise = ${fid}`} emptyMessage={t('Production committees that hold this franchise appear here.')} />
          </TabsContent>
        )}

        <TabsContent value="documents">
          <DocumentsPanel relation="franchise" relationId={f.id} defaultType="style_guide" />
        </TabsContent>
      </RecordTabs>

      {dlg === 'edit' && <FranchiseForm franchise={f} onClose={() => setDlg(null)} />}
      {dlg === 'lines' && <CopyrightLinesDialog franchise={f} onClose={() => setDlg(null)} />}
      {dlg === 'character' && <CharacterForm character={null} defaults={{ franchise: f.id }} onClose={() => setDlg(null)} onSaved={(c) => navigate('character', c.id)} />}
      {dlg === 'title' && <TitleForm title={null} defaults={{ franchise: f.id }} onClose={() => setDlg(null)} onSaved={(x) => navigate('title', x.id)} />}
    </div>
  );
}
