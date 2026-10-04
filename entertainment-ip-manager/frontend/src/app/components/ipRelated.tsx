/**
 * Lists of records related to a franchise, character, talent or title:
 * agreements, products, permissions, songs and recordings, committees,
 * trademarks, deadlines (with the shared deadline actions) and history.
 * Each one is live and links to the record's own page.
 */
import type { ReactNode } from 'react';
import { CalendarClock, FileSignature, History, Music2, Package, ShieldCheck, Stamp, Users } from 'lucide-react';
import { useRecord } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { q } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, t, tf } from '../lib/i18n.ts';
import { href, navigate } from '../lib/router.ts';
import type { AgreementRec, CommitteeRec, DeadlineRec, EventRec, MatterRec, PartyRec, PermissionRec, ProductRec, RecordingRec, SongRec } from '../lib/records.ts';
import { DeadlineList, useDeadlineActions } from './deadlines.tsx';
import { DeleteButton } from './deleteRecord.tsx';
import { useEventLabel } from './events.tsx';
import { EmptyHint, EnumPill, ErrorBox, JurChip, ListRow, Loading, Ref, Section, Tag } from './ui.tsx';
import { spanText } from './ipShared.tsx';

function Body<T>({ state, empty, children }: { state: { records: T[]; loading: boolean; error: string | null; refresh: () => void }; empty: ReactNode; children: ReactNode }): React.JSX.Element {
  if (state.loading && state.records.length === 0) return <Loading />;
  if (state.error !== null && state.records.length === 0) {
    return (
      <div className="p-4">
        <ErrorBox message={state.error} onRetry={state.refresh} />
      </div>
    );
  }
  if (state.records.length === 0) return <>{empty}</>;
  return <>{children}</>;
}

function join(parts: (string | undefined)[]): string {
  return parts.filter((x) => x !== undefined && x !== '').join(' · ');
}

/* ------------------------------------------------------------------ */

export function AgreementsSection({ filter, emptyMessage, actions }: { filter: string; emptyMessage: string; actions?: ReactNode | undefined }): React.JSX.Element {
  const list = useCollection<AgreementRec>('agreements', { filter, sort: '-term_start', expand: 'counterparty' });
  return (
    <Section title={t('Agreements')} meta={list.records.length > 0 ? String(list.records.length) : undefined} actions={actions} flush>
      <Body state={list} empty={<EmptyHint compact icon={FileSignature} title={t('No agreements yet')} message={emptyMessage} />}>
        {list.records.map((a) => {
          const cp = a.expand?.['counterparty'] as PartyRec | undefined;
          return (
            <ListRow
              key={a.id}
              primary={a.title}
              secondary={join([a.ref, enumLabel('agreements.agreement_type', a.agreement_type), cp?.name, a.perpetual ? t('Perpetual') : spanText(a.term_start, a.term_end)])}
              trailing={<EnumPill field="agreements.status" value={a.status} />}
              onClick={() => navigate('agreement', a.id)}
            />
          );
        })}
      </Body>
    </Section>
  );
}

export function ProductsSection({ filter, emptyMessage }: { filter: string; emptyMessage: string }): React.JSX.Element {
  const list = useCollection<ProductRec>('products', { filter, sort: '-sales_start', expand: 'licensee' });
  return (
    <Section title={t('Products')} meta={list.records.length > 0 ? String(list.records.length) : undefined} flush>
      <Body state={list} empty={<EmptyHint compact icon={Package} title={t('No products yet')} message={emptyMessage} />}>
        {list.records.map((p) => {
          const lic = p.expand?.['licensee'] as PartyRec | undefined;
          return (
            <ListRow
              key={p.id}
              primary={p.name}
              secondary={join([p.ref, lic?.name, d10(p.sales_start) !== '' ? t('On sale from {date}', { date: fmtDate(p.sales_start) }) : ''])}
              trailing={<EnumPill field="products.stage" value={p.stage} />}
              onClick={() => navigate('product', p.id)}
            />
          );
        })}
      </Body>
    </Section>
  );
}

export function PermissionsSection({ filter, emptyMessage }: { filter: string; emptyMessage: string }): React.JSX.Element {
  const list = useCollection<PermissionRec>('permissions', { filter, sort: 'title', expand: 'counterparty' });
  return (
    <Section title={t('Third-party permissions')} meta={list.records.length > 0 ? String(list.records.length) : undefined} flush>
      <Body state={list} empty={<EmptyHint compact icon={ShieldCheck} title={t('No permissions yet|related')} message={emptyMessage} />}>
        {list.records.map((p) => {
          const cp = p.expand?.['counterparty'] as PartyRec | undefined;
          return (
            <ListRow
              key={p.id}
              primary={p.title}
              secondary={join([
                enumLabel('permissions.permission_type', p.permission_type),
                cp?.name,
                p.all_talents ? t('All talents') : '',
                d10(p.end_date) !== '' ? t('Until {date}', { date: fmtDate(p.end_date) }) : '',
              ])}
              trailing={<EnumPill field="permissions.status" value={p.status} />}
              onClick={() => {
                window.location.hash = href('permissions', undefined, { open: p.id });
              }}
            />
          );
        })}
      </Body>
    </Section>
  );
}

export function SongsSection({ songFilter, recordingFilter, emptyMessage }: { songFilter: string; recordingFilter?: string | undefined; emptyMessage: string }): React.JSX.Element {
  const songs = useCollection<SongRec>('songs', { filter: songFilter, sort: 'title' });
  const recs = useCollection<RecordingRec>('recordings', { filter: recordingFilter ?? 'id = ""', sort: 'title' });
  const showRecs = recordingFilter !== undefined;
  const total = songs.records.length + (showRecs ? recs.records.length : 0);
  return (
    <Section title={showRecs ? t('Songs and recordings') : t('Songs')} meta={total > 0 ? String(total) : undefined} flush>
      <Body state={{ ...songs, records: [...songs.records, ...(showRecs ? recs.records : [])] }} empty={<EmptyHint compact icon={Music2} title={t('No songs yet')} message={emptyMessage} />}>
        {songs.records.map((s) => (
          <ListRow
            key={s.id}
            leading={<Tag>{t('Song')}</Tag>}
            primary={s.title}
            secondary={join([s.tie_up_use !== '' && s.tie_up_use !== 'none' ? enumLabel('songs.tie_up_use', s.tie_up_use) : '', s.iswc, d10(s.first_publication) !== '' ? fmtDate(s.first_publication) : ''])}
            trailing={<EnumPill field="songs.status" value={s.status} />}
            onClick={() => navigate('song', s.id)}
          />
        ))}
        {showRecs &&
          recs.records.map((r) => (
            <ListRow
              key={r.id}
              leading={<Tag>{t('Recording')}</Tag>}
              primary={r.title}
              secondary={join([enumLabel('recordings.version_type', r.version_type), r.isrc])}
              trailing={<EnumPill field="recordings.status" value={r.status} />}
              onClick={() => navigate('recording', r.id)}
            />
          ))}
      </Body>
    </Section>
  );
}

export function CommitteesSection({ filter, emptyMessage }: { filter: string; emptyMessage: string }): React.JSX.Element {
  const list = useCollection<CommitteeRec>('committees', { filter, sort: 'name' });
  return (
    <Section title={t('Committees')} meta={list.records.length > 0 ? String(list.records.length) : undefined} flush>
      <Body state={list} empty={<EmptyHint compact icon={Users} title={t('No committees yet')} message={emptyMessage} />}>
        {list.records.map((c) => (
          <ListRow
            key={c.id}
            primary={c.name}
            secondary={join([enumLabel('committees.form', c.form), d10(c.term_end) !== '' ? t('Term ends {date}', { date: fmtDate(c.term_end) }) : ''])}
            trailing={<EnumPill field="committees.status" value={c.status} />}
            onClick={() => navigate('committee', c.id)}
          />
        ))}
      </Body>
    </Section>
  );
}

/** A committee's name as a link (committee names are not in app context). */
export function CommitteeLink({ id }: { id: string }): React.JSX.Element {
  const { record } = useRecord<CommitteeRec>('committees', id !== '' ? id : null);
  return (
    <a href={href('committee', id)} className="hover:underline">
      {record?.name ?? t('Open|action')}
    </a>
  );
}

/** Trademark and design matters linked to a record. */
export function MattersSection({ filter, emptyMessage }: { filter: string; emptyMessage: string }): React.JSX.Element {
  const list = useCollection<MatterRec>('matters', { filter, sort: 'jurisdiction,ref' });
  return (
    <Section title={t('Trademarks and designs')} meta={list.records.length > 0 ? String(list.records.length) : undefined} flush>
      <Body state={list} empty={<EmptyHint compact icon={Stamp} title={t('No trademarks or designs linked')} message={emptyMessage} />}>
        {list.records.map((m) => (
          <ListRow
            key={m.id}
            leading={<JurChip code={m.jurisdiction} />}
            primary={m.title}
            secondary={
              <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2">
                {m.ref !== '' && <Ref dead={m.status_group === 'dead'}>{m.ref}</Ref>}
                <span>{enumLabel('matters.ip_type', m.ip_type)}</span>
                {m.registration_no !== '' && <span>{t('Reg. {no}', { no: m.registration_no })}</span>}
                {d10(m.expiry_date) !== '' && <span>{t('Expires {date}', { date: fmtDate(m.expiry_date) })}</span>}
              </span>
            }
            trailing={<EnumPill field="matters.status" value={m.status} />}
            onClick={() => navigate('matter', m.id)}
          />
        ))}
      </Body>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* Deadlines                                                           */
/* ------------------------------------------------------------------ */

export type DeadlineField = 'work' | 'character' | 'talent';

/** Every deadline of a record, grouped by window, with the shared actions. */
export function DeadlinesSection({ field, id, emptyMessage }: { field: DeadlineField; id: string; emptyMessage: string }): React.JSX.Element {
  const list = useCollection<DeadlineRec>('deadlines', { filter: `${field} = ${q(id)}`, sort: 'due_date' });
  const dl = useDeadlineActions();
  const open = list.records.filter((d) => d.status === 'open').length;
  return (
    <Section title={t('Deadlines')} meta={open > 0 ? t('{n} open', { n: open }) : undefined} flush>
      {dl.dialogs}
      <Body state={list} empty={<EmptyHint compact icon={CalendarClock} title={t('No deadlines yet')} message={emptyMessage} />}>
        <DeadlineList deadlines={list.records} actions={dl.actions} canEdit={dl.canEdit} showSubject={false} />
      </Body>
    </Section>
  );
}

/** The next few open deadlines of a record (Overview). */
export function NextDeadlines({ field, id, limit = 5, onShowAll }: { field: DeadlineField; id: string; limit?: number | undefined; onShowAll?: (() => void) | undefined }): React.JSX.Element {
  const list = useCollection<DeadlineRec>('deadlines', { filter: `${field} = ${q(id)} && status = "open"`, sort: 'due_date' });
  const dl = useDeadlineActions();
  const shown = list.records.slice(0, limit);
  return (
    <Section
      title={t('Next deadlines')}
      meta={list.records.length > 0 ? t('{n} open', { n: list.records.length }) : undefined}
      flush
      actions={
        onShowAll !== undefined && list.records.length > limit ? (
          <button type="button" className="text-xs text-[var(--agent-app-accent)] hover:underline" onClick={onShowAll}>
            {t('Show all')}
          </button>
        ) : undefined
      }
    >
      {dl.dialogs}
      <Body state={list} empty={<EmptyHint compact icon={CalendarClock} title={t('Nothing open')} message={t('Dates worked out from this record, its agreements and its events appear here.')} />}>
        <DeadlineList deadlines={shown} actions={dl.actions} canEdit={dl.canEdit} grouped={false} bulk={false} showSubject={false} />
      </Body>
    </Section>
  );
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export function HistorySection({ field, id, actions }: { field: DeadlineField; id: string; actions?: ReactNode | undefined }): React.JSX.Element {
  const { userName } = useApp();
  const eventLabel = useEventLabel();
  const list = useCollection<EventRec>('events', { filter: `${field} = ${q(id)}`, sort: '-date,-created' });
  return (
    <Section title={t('History')} meta={list.records.length > 0 ? String(list.records.length) : undefined} actions={actions} flush>
      <Body state={list} empty={<EmptyHint compact icon={History} title={t('No events yet')} message={t('Debuts, releases, announcements and other events recorded here drive the deadlines.')} />}>
        {list.records.map((ev) => (
          <ListRow
            key={ev.id}
            primary={tf(ev, 'label') || eventLabel(ev.code)}
            secondary={join([tf(ev, 'label') !== '' ? eventLabel(ev.code) : '', enumLabel('events.source', ev.source), ev.created_by !== '' ? t('by {name}', { name: userName(ev.created_by) }) : ''])}
            trailing={
              <span className="flex items-center gap-1">
                <span className="whitespace-nowrap text-xs tabular-nums text-[var(--agent-app-muted)]">{fmtDate(ev.date)}</span>
                <DeleteButton collection="events" id={ev.id} iconOnly label={t('Delete this event')} />
              </span>
            }
          />
        ))}
      </Body>
    </Section>
  );
}
