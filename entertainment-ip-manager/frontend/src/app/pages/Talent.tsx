/**
 * One talent: stage name, type and lifecycle, managers, revenue share and
 * channels; the characters they play; the permissions and products that
 * depend on them; the identity vault (admins and their managers only); the
 * playbook, birthday and anniversary deadlines; documents and history.
 * Lifecycle steps run their playbook (talents/lifecycle) and the pre-stream
 * check answers whether a stream is allowed.
 */
import { useState } from 'react';
import { ExternalLink, Mic, Pencil, Radio, Route } from 'lucide-react';
import { Button, Card, CardContent, TabsContent, useRecord } from '../../kit/index.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate, fmtPct } from '../lib/format.ts';
import { enumLabel, t } from '../lib/i18n.ts';
import { href, navigate, useHashParam } from '../lib/router.ts';
import type { PartyRec, TalentRec } from '../lib/records.ts';
import type { TalentChannel } from '../lib/shapes.ts';
import { DeleteButton } from '../components/deleteRecord.tsx';
import { DocumentsPanel } from '../components/documents.tsx';
import { CastingsSection } from '../components/ipCastings.tsx';
import { DeadlinesSection, HistorySection, NextDeadlines, PermissionsSection, ProductsSection } from '../components/ipRelated.tsx';
import { NamesLine, PeopleChips, RecordTabs, SimpleTable, Thumb, asRows, fmtBirthday, pickTab, plainText } from '../components/ipShared.tsx';
import type { TabDef } from '../components/ipShared.tsx';
import { TalentForm, readRevenueShare } from '../components/ipTalentForm.tsx';
import { IdentitySection, LifecycleDialog, PreStreamDialog } from '../components/ipTalentTools.tsx';
import { EmptyHint, EnumPill, Fact, FactGrid, Loading, Prose, Section, Tag } from '../components/ui.tsx';

function PartyName({ id }: { id: string }): React.JSX.Element | null {
  const { record } = useRecord<PartyRec>('parties', id !== '' ? id : null);
  if (id === '') return null;
  return (
    <a href={href('people', id)} className="hover:underline">
      {record?.name ?? t('Open|action')}
    </a>
  );
}

export function TalentPage({ id }: { id: string }): React.JSX.Element {
  const { can, on, dimLabel } = useApp();
  const { record: x, loading, error } = useRecord<TalentRec>('talents', id !== '' ? id : null);
  const [tabParam, setTab] = useHashParam('tab', 'overview');
  const [dlg, setDlg] = useState<'edit' | 'lifecycle' | 'stream' | null>(null);

  const tabs: TabDef[] = [
    { value: 'overview', label: t('Overview') },
    { value: 'characters', label: t('Characters') },
    ...(on('permissions') ? [{ value: 'permissions', label: t('Permissions|tab') }] : []),
    ...(on('products') ? [{ value: 'products', label: t('Products') }] : []),
    { value: 'identity', label: t('Identity|talent') },
    { value: 'deadlines', label: t('Deadlines') },
    { value: 'documents', label: t('Documents') },
    { value: 'history', label: t('History') },
  ];
  const tab = pickTab(tabs, tabParam);

  if (id === '') {
    return <EmptyHint icon={Mic} title={t('Choose a talent')} action={<Button onClick={() => navigate('talents')}>{t('Open talents')}</Button>} />;
  }
  if (loading && x === null) return <Loading />;
  if (x === null) {
    return (
      <Card>
        <EmptyHint
          icon={Mic}
          title={t('This talent was not found')}
          message={error ?? t('It may have been deleted.')}
          action={
            <Button variant="outline" onClick={() => navigate('talents')}>
              {t('Back to talents')}
            </Button>
          }
        />
      </Card>
    );
  }

  const tid = q(x.id);
  const share = readRevenueShare(x.revenue_share);
  const channels = asRows<TalentChannel>(x.channels).filter((c) => typeof c === 'object' && c !== null);

  return (
    <div>
      <nav className="mb-3 flex flex-wrap items-center gap-1.5 text-[12px] text-[var(--agent-app-muted)]" aria-label={t('Breadcrumb')}>
        <a href={href('talents')} className="hover:text-[var(--agent-app-text)] hover:underline">
          {t('Talents')}
        </a>
      </nav>

      <Card className="mb-5">
        <CardContent className="flex flex-col gap-4 p-4 sm:flex-row sm:items-start">
          <Thumb record={x} image={x.image} name={x.stage_name} size="xl" />
          <div className="min-w-0 flex-1">
            <h1 className="break-words text-xl font-semibold tracking-tight">{x.stage_name}</h1>
            <NamesLine names={x.names} primary={x.stage_name} className="mt-1" />
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[13px]">
              {x.talent_type !== '' && <Tag>{enumLabel('talents.talent_type', x.talent_type)}</Tag>}
              <EnumPill field="talents.lifecycle" value={x.lifecycle} />
              {x.affiliation !== '' && <span className="text-[var(--agent-app-muted)]">{enumLabel('talents.affiliation', x.affiliation)}</span>}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-[var(--agent-app-muted)]">
              {d10(x.debut_date) !== '' && <span>{t('Debut {date}', { date: fmtDate(x.debut_date) })}</span>}
              {d10(x.graduation_date) !== '' && <span>{t('Graduation {date}', { date: fmtDate(x.graduation_date) })}</span>}
            </div>
            {x.managers.length > 0 && (
              <div className="mt-2 flex min-w-0 flex-wrap items-center gap-2 text-[13px]">
                <span className="text-[var(--agent-app-muted)]">{t('Managers|talent')}</span>
                <PeopleChips ids={x.managers} />
              </div>
            )}
          </div>
          <div className="flex min-w-0 max-w-full flex-wrap gap-2">
            {can.talent && (
              <Button size="sm" onClick={() => setDlg('lifecycle')}>
                <Route size={13} aria-hidden /> {t('Lifecycle step')}
              </Button>
            )}
            {can.read && (
              <Button size="sm" variant="outline" onClick={() => setDlg('stream')}>
                <Radio size={13} aria-hidden /> {t('Pre-stream check')}
              </Button>
            )}
            {can.talent && (
              <Button size="sm" variant="outline" onClick={() => setDlg('edit')}>
                <Pencil size={13} aria-hidden /> {t('Edit')}
              </Button>
            )}
            <DeleteButton collection="talents" id={x.id} onDeleted={() => navigate('talents')} />
          </div>
        </CardContent>
      </Card>

      <RecordTabs tabs={tabs} value={tab} onChange={setTab}>
        <TabsContent value="overview" className="flex flex-col gap-5">
          <Section title={t('Facts')}>
            <FactGrid>
              <Fact label={t('Type')} value={enumLabel('talents.talent_type', x.talent_type)} />
              <Fact label={t('Affiliation')} value={enumLabel('talents.affiliation', x.affiliation)} />
              <Fact label={t('Lifecycle')} value={enumLabel('talents.lifecycle', x.lifecycle)} />
              <Fact label={t('Agency|talent')} value={x.agency !== '' ? <PartyName id={x.agency} /> : ''} />
              <Fact label={t('Contract party')} value={x.party !== '' ? <PartyName id={x.party} /> : ''} />
              <Fact label={t('Privacy|talent')} value={enumLabel('talents.privacy_class', x.privacy_class)} />
              <Fact label={t('Debut date')} value={fmtDate(x.debut_date)} />
              <Fact label={t('Graduation date')} value={fmtDate(x.graduation_date)} />
              <Fact label={t('Birthday')} value={x.birthday !== '' ? fmtBirthday(x.birthday) : ''} />
            </FactGrid>
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title={t('Revenue share|talent')} meta={share.length > 0 ? String(share.length) : undefined} flush>
              {share.length === 0 ? (
                <EmptyHint compact title={t('No revenue share recorded')} message={t('Add the talent and agency percentages per category from the talent agreement.')} />
              ) : (
                <SimpleTable
                  rows={share.map((r, i) => ({ ...r, id: String(i) }))}
                  cols={[
                    { key: 'cat', label: t('Category'), render: (r) => r.category },
                    { key: 'talent', label: t('Talent'), align: 'right', render: (r) => fmtPct(r.talent_pct) },
                    { key: 'agency', label: t('Agency|talent'), align: 'right', render: (r) => fmtPct(r.agency_pct) },
                  ]}
                />
              )}
            </Section>
            <Section title={t('Channels')} meta={channels.length > 0 ? String(channels.length) : undefined} flush>
              {channels.length === 0 ? (
                <EmptyHint compact title={t('No channels recorded')} message={t('Add the official channels, so takedowns and clip guidelines can point to them.')} />
              ) : (
                <SimpleTable
                  rows={channels.map((c, i) => ({ ...c, id: String(i) }))}
                  cols={[
                    { key: 'platform', label: t('Platform'), render: (c) => (c.platform ? dimLabel('platform', c.platform) : '') },
                    { key: 'handle', label: t('Handle|channel'), render: (c) => <span className="break-all font-mono text-[12px]">{c.handle ?? ''}</span> },
                    {
                      key: 'url',
                      label: t('URL'),
                      className: 'hidden sm:table-cell',
                      render: (c) =>
                        c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex max-w-[14rem] items-center gap-1 truncate text-[var(--agent-app-accent)] hover:underline">
                            <ExternalLink size={11} aria-hidden className="shrink-0" />
                            <span className="truncate">{c.url}</span>
                          </a>
                        ) : null,
                    },
                  ]}
                />
              )}
            </Section>
          </div>

          <NextDeadlines field="talent" id={x.id} onShowAll={() => setTab('deadlines')} />

          {(x.profile.trim() !== '' || x.notes.trim() !== '') && (
            <Section title={t('Profile and notes')}>
              {x.profile.trim() !== '' && <Prose>{plainText(x.profile)}</Prose>}
              {x.notes.trim() !== '' && <Prose className="mt-3 text-[var(--agent-app-muted)]">{x.notes}</Prose>}
            </Section>
          )}
        </TabsContent>

        <TabsContent value="characters">
          <CastingsSection mode={{ talent: x.id }} />
        </TabsContent>

        {on('permissions') && (
          <TabsContent value="permissions">
            <PermissionsSection filter={`all_talents = true || talents ?= ${tid}`} emptyMessage={t('Game, music and platform permissions that cover this talent appear here, including those for all talents.')} />
          </TabsContent>
        )}

        {on('products') && (
          <TabsContent value="products">
            <ProductsSection filter={`talents ?= ${tid}`} emptyMessage={t('Goods and voice products featuring this talent appear here.')} />
          </TabsContent>
        )}

        <TabsContent value="identity">
          <IdentitySection talent={x} />
        </TabsContent>

        <TabsContent value="deadlines">
          <DeadlinesSection field="talent" id={x.id} emptyMessage={t('Playbook tasks from lifecycle steps, birthday and debut anniversary reminders appear here.')} />
        </TabsContent>

        <TabsContent value="documents">
          <DocumentsPanel relation="talent" relationId={x.id} extraction />
        </TabsContent>

        <TabsContent value="history">
          <HistorySection field="talent" id={x.id} />
        </TabsContent>
      </RecordTabs>

      {dlg === 'edit' && <TalentForm talent={x} onClose={() => setDlg(null)} />}
      {dlg === 'lifecycle' && <LifecycleDialog talent={x} onClose={() => setDlg(null)} />}
      {dlg === 'stream' && <PreStreamDialog talent={x} onClose={() => setDlg(null)} />}
    </div>
  );
}
