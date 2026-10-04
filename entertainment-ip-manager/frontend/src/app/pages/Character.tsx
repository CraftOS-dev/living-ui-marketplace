/**
 * One character, the centre of the catalogue: who it is in every script,
 * who plays it, its rights stack layer by layer (with what is wrong in each
 * layer), its castings, products, songs, permissions and trademarks, the
 * deadlines that come from all of these, its documents and its history.
 */
import { useMemo, useState } from 'react';
import { CalendarPlus, Lock, Pencil, Scale, UserRound } from 'lucide-react';
import { Button, Card, CardContent, TabsContent, useRecord } from '../../kit/index.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { CastingRec, CharacterRec } from '../lib/records.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { EventDialog } from '../components/events.tsx';
import { AI_KEYS, AI_TONE, CharacterForm, aiKeyHelp, aiKeyLabel, aiValueLabel, readAiPolicy } from '../components/ipCharacterForm.tsx';
import { CastingsSection } from '../components/ipCastings.tsx';
import { CoverageMatrix, CoverageSummary } from '../components/ipCoverage.tsx';
import { DeadlinesSection, HistorySection, MattersSection, NextDeadlines, PermissionsSection, ProductsSection, SongsSection } from '../components/ipRelated.tsx';
import { RightsStack } from '../components/ipRightsStack.tsx';
import { NamesLine, RecordTabs, Thumb, fmtBirthday, isCurrentCasting, pickTab, plainText } from '../components/ipShared.tsx';
import type { TabDef } from '../components/ipShared.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, Loading, Pill, Prose, Section, Tag } from '../components/ui.tsx';

export function CharacterPage({ id }: { id: string }): React.JSX.Element {
  const { can, on, nameOf } = useApp();
  const { record: c, loading, error } = useRecord<CharacterRec>('characters', id !== '' ? id : null);
  const castings = useCollection<CastingRec>('castings', { filter: `character = ${q(id)}`, sort: '-start_date' });
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<'edit' | 'event' | null>(null);

  const current = useMemo(() => castings.records.filter((x) => isCurrentCasting(x)), [castings.records]);

  const tabs: TabDef[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'rights', label: t('Rights stack') },
    { value: 'castings', label: t('Castings'), count: castings.records.length },
    ...(on('products') ? [{ value: 'products', label: t('Products') }] : []),
    ...(on('music') ? [{ value: 'songs', label: t('Songs') }] : []),
    ...(on('permissions') ? [{ value: 'permissions', label: t('Permissions|tab') }] : []),
    { value: 'trademarks', label: t('Trademarks') },
    { value: 'deadlines', label: t('Deadlines') },
    { value: 'documents', label: t('Documents') },
    { value: 'history', label: t('History') },
  ];
  const tab = pickTab(tabs, tabParam);

  if (id === '') {
    return <EmptyHint icon={UserRound} title={t('Choose a character')} action={<Button onClick={() => navigate('characters')}>{t('Open characters')}</Button>} />;
  }
  if (loading && c === null) return <Loading />;
  if (c === null) {
    return (
      <Card>
        <EmptyHint
          icon={UserRound}
          title={t('This character was not found')}
          message={error ?? t('It may have been deleted.')}
          action={
            <Button variant="outline" onClick={() => navigate('characters')}>
              {t('Back to characters')}
            </Button>
          }
        />
      </Card>
    );
  }

  const cid = q(c.id);
  const ai = readAiPolicy(c.ai_policy);
  const recordEvent = can.edit ? (
    <Button size="sm" variant="outline" onClick={() => setDlg('event')}>
      <CalendarPlus size={13} aria-hidden /> {t('Record event')}
    </Button>
  ) : undefined;

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label={t('Breadcrumb')}>
        <a href={href('characters')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {t('Characters')}
        </a>
        {on('franchises') && c.franchise !== '' && (
          <span className="flex items-center gap-1.5">
            <span aria-hidden>/</span>
            <a href={href('franchise', c.franchise)} className="hover:text-[var(--agent-app-text)] hover:underline">
              {nameOf('franchise', c.franchise)}
            </a>
          </span>
        )}
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={c} image={c.image} name={c.name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold tracking-tight">{c.name}</h1>
            <NamesLine names={c.names} primary={c.name} className="mt-1" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {c.kind !== '' && <Tag>{enumLabel('characters.kind', c.kind)}</Tag>}
              <EnumPill field="characters.status" value={c.status} />
              {on('franchises') && c.franchise !== '' && (
                <a href={href('franchise', c.franchise)} className="text-[var(--agent-app-muted)] hover:underline">
                  {nameOf('franchise', c.franchise)}
                </a>
              )}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--agent-app-muted)]">
              {d10(c.debut_date) !== '' && <span>{t('Debut {date}', { date: fmtDate(c.debut_date) })}</span>}
              {c.birthday !== '' && <span>{t('Birthday {date}', { date: fmtBirthday(c.birthday) })}</span>}
            </div>
            {current.length > 0 && (
              <div className="mt-2 flex flex-col gap-1 text-[13px]">
                {current.map((x) => (
                  <div key={x.id} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="text-[var(--agent-app-muted)]">{enumLabel('castings.role', x.role)}</span>
                    {on('talents') ? (
                      <a href={href('talent', x.talent)} className="font-medium hover:underline">
                        {nameOf('talent', x.talent)}
                      </a>
                    ) : (
                      <span className="font-medium">{nameOf('talent', x.talent)}</span>
                    )}
                    {d10(x.start_date) !== '' && <span className="text-xs text-[var(--agent-app-muted)]">{t('Since {date}', { date: fmtDate(x.start_date) })}</span>}
                  </div>
                ))}
                <span className="inline-flex items-center gap-1 text-xs text-[var(--agent-app-muted)]">
                  <Lock size={11} aria-hidden /> {t('Legal identity restricted')}
                </span>
              </div>
            )}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {recordEvent}
            <Button variant="outline" size="sm" onClick={() => navigate('canwe', undefined, { asset: `character:${c.id}` })}>
              <Scale size={13} aria-hidden /> {t('Can we?')}
            </Button>
            {can.edit && (
              <Button variant="outline" size="sm" onClick={() => setDlg('edit')}>
                <Pencil size={13} aria-hidden /> {t('Edit')}
              </Button>
            )}
            <DeleteButton collection="characters" id={c.id} onDeleted={() => navigate('characters')} />
          </div>
        </CardContent>
      </Card>

      <RecordTabs tabs={tabs} value={tab} onChange={setTab}>
        <TabsContent value="overview" className="flex flex-col gap-5">
          <Section title={t('Facts')}>
            <FactGrid>
              <Fact label={t('Kind')} value={enumLabel('characters.kind', c.kind)} />
              <Fact label={t('Ownership model')} value={enumLabel('characters.ownership_model', c.ownership_model)} />
              <Fact label={t('Status')} value={enumLabel('characters.status', c.status)} />
              {on('franchises') && (
                <Fact
                  label={t('Franchise')}
                  value={
                    c.franchise !== '' ? (
                      <a href={href('franchise', c.franchise)} className="hover:underline">
                        {nameOf('franchise', c.franchise)}
                      </a>
                    ) : (
                      ''
                    )
                  }
                />
              )}
              <Fact label={t('Debut date')} value={fmtDate(c.debut_date)} />
              <Fact label={t('Birthday')} value={c.birthday !== '' ? fmtBirthday(c.birthday) : ''} />
              <Fact label={t('Announcement date')} value={fmtDate(c.announcement_date)} />
              <Fact label={t('Copyright line')} value={c.copyright_line} mono />
              {on('titles') && (
                <Fact
                  label={t('Appears in')}
                  value={
                    c.appears_in.length > 0 ? (
                      <span className="flex flex-wrap gap-x-2">
                        {c.appears_in.map((w) => (
                          <a key={w} href={href('title', w)} className="hover:underline">
                            {nameOf('work', w)}
                          </a>
                        ))}
                      </span>
                    ) : (
                      ''
                    )
                  }
                />
              )}
            </FactGrid>
          </Section>

          <Section
            title={t('AI policy')}
            actions={
              can.edit ? (
                <Button size="sm" variant="outline" onClick={() => setDlg('edit')}>
                  <Pencil size={13} aria-hidden /> {t('Edit')}
                </Button>
              ) : undefined
            }
          >
            <div className="grid gap-4 sm:grid-cols-3">
              {AI_KEYS.map((k) => {
                const v = ai[k];
                return (
                  <div key={k} className="min-w-0">
                    <div className="text-[11px] text-[var(--agent-app-muted)]">{aiKeyLabel(k)}</div>
                    <div className="mt-1">{v !== undefined ? <Pill tone={AI_TONE[v] ?? 'neutral'}>{aiValueLabel(v)}</Pill> : <span className="text-[13px] text-[var(--agent-app-muted)]">{aiValueLabel('')}</span>}</div>
                    <p className="mt-1 text-xs leading-relaxed text-[var(--agent-app-muted)]">{aiKeyHelp(k)}</p>
                  </div>
                );
              })}
            </div>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <NextDeadlines field="character" id={c.id} onShowAll={() => setTab('deadlines')} />
            <CoverageSummary type="character" id={c.id} onOpen={() => setTab('trademarks')} />
          </div>

          {c.profile.trim() !== '' && (
            <Section title={t('Profile')}>
              <Prose>{plainText(c.profile)}</Prose>
            </Section>
          )}
        </TabsContent>

        <TabsContent value="rights">
          <RightsStack character={c} />
        </TabsContent>

        <TabsContent value="castings">
          <CastingsSection mode={{ character: c.id }} />
        </TabsContent>

        {on('products') && (
          <TabsContent value="products">
            <ProductsSection filter={`characters ?= ${cid}`} emptyMessage={t('Products that use this character appear here, from proposal to sell-off.')} />
          </TabsContent>
        )}

        {on('music') && (
          <TabsContent value="songs">
            <SongsSection songFilter={`characters ?= ${cid}`} recordingFilter={`characters ?= ${cid}`} emptyMessage={t('Character songs and recordings sung as this character appear here.')} />
          </TabsContent>
        )}

        {on('permissions') && (
          <TabsContent value="permissions">
            <PermissionsSection filter={`characters ?= ${cid}`} emptyMessage={t('Third-party permissions that name this character appear here.')} />
          </TabsContent>
        )}

        <TabsContent value="trademarks" className="flex flex-col gap-5">
          <CoverageMatrix type="character" id={c.id} />
          <MattersSection filter={`character = ${cid}`} emptyMessage={t('Trademarks and designs for this character (its name, logo or figure) appear here.')} />
        </TabsContent>

        <TabsContent value="deadlines">
          <DeadlinesSection field="character" id={c.id} emptyMessage={t('Payment and licence end dates of the rights stack, birthdays and events recorded on this character appear here.')} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="character" relationId={c.id} defaultType="model_sheet" />
        </TabsContent>

        <TabsContent value="history">
          <HistorySection field="character" id={c.id} actions={recordEvent} />
        </TabsContent>
      </RecordTabs>

      {dlg === 'edit' && <CharacterForm character={c} onClose={() => setDlg(null)} />}
      {dlg === 'event' && <EventDialog subjectType="character" subjectId={c.id} onClose={() => setDlg(null)} onDone={() => undefined} />}
    </div>
  );
}
