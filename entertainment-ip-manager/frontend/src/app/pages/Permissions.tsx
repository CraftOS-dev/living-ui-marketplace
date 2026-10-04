/**
 * Third-party permissions (inbound): what game publishers, music rights
 * holders and platforms allow our talents to stream, with the platforms,
 * monetization, archive rule, limits and credit line. Public guidelines
 * change without notice, so each permission carries a re-check interval;
 * the list shows what is due, and CraftBot can re-read a guideline and
 * propose the changes in the Inbox.
 */
import { useMemo, useState } from 'react';
import { BadgeCheck, Bot, CheckCheck, ExternalLink, Plus } from 'lucide-react';
import { Button, Input, Select } from '../../kit/index.ts';
import { useApp } from '../lib/context.tsx';
import { useCollection } from '../lib/live.ts';
import { d10, fmtDate } from '../lib/format.ts';
import { enumLabel, enumOptions, joinList, t, tn } from '../lib/i18n.ts';
import { useHashParam, useRoute } from '../lib/router.ts';
import type { PermissionRec } from '../lib/records.ts';
import { AgentStatus, handToCraftBot } from '../components/craftbot.tsx';
import { DataTable } from '../components/DataTable.tsx';
import type { Col } from '../components/DataTable.tsx';
import { Checkbox, EmptyHint, EnumPill, ListRow, Loading, PageHeader, Pill, Section, Toolbar } from '../components/ui.tsx';
import {
  PermissionDrawer,
  PermissionForm,
  RecheckDialog,
  counterpartyName,
  endsSoon,
  monetizationLabel,
  needsRecheck,
  talentsText,
  usePlatformLabel,
} from '../components/rightsPermissions.tsx';

export function PermissionsPage(): React.JSX.Element {
  const { can, nameOf } = useApp();
  const route = useRoute();
  const platformLabel = usePlatformLabel();
  const list = useCollection<PermissionRec>('permissions', { sort: 'title', expand: 'counterparty,agreement' });
  const [search, setSearch] = useHashParam('q', '');
  const [type, setType] = useHashParam('type', '');
  const [status, setStatus] = useHashParam('status', '');
  const [recheck, setRecheck] = useHashParam('recheck', '');
  const [ending, setEnding] = useHashParam('ending', '');
  const [openParam, setOpen] = useHashParam('open', '');
  const [editing, setEditing] = useState<PermissionRec | 'new' | null>(null);
  const [rechecking, setRechecking] = useState<PermissionRec | null>(null);
  const [requests, setRequests] = useState<Record<string, string>>({});

  // "#/permissions/<id>" (notifications) and "?open=<id>" both open the drawer.
  const openId = openParam !== '' ? openParam : route.id;
  const opened = openId !== '' ? (list.records.find((p) => p.id === openId) ?? null) : null;
  const closeDrawer = (): void => {
    setOpen('');
    if (route.id !== '') window.location.hash = '#/permissions';
  };

  const ask = async (p: PermissionRec): Promise<void> => {
    const id = await handToCraftBot('guideline_check_requested', { permission_id: p.id });
    if (id !== null) setRequests((r) => ({ ...r, [p.id]: id }));
  };

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.records.filter((p) => {
      if (type !== '' && p.permission_type !== type) return false;
      if (status !== '' && p.status !== status) return false;
      if (recheck === '1' && !needsRecheck(p)) return false;
      if (ending === '1' && !endsSoon(p, 60)) return false;
      if (q !== '') {
        const hay = `${p.title} ${p.subject_name} ${counterpartyName(p)}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [list.records, search, type, status, recheck, ending]);

  const dueCount = list.records.filter(needsRecheck).length;
  const filtered = search !== '' || type !== '' || status !== '' || recheck !== '' || ending !== '';
  const clear = (): void => {
    setSearch('');
    setType('');
    setStatus('');
    setRecheck('');
    setEnding('');
  };

  const actions = (p: PermissionRec): React.JSX.Element => (
    <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
      {can.edit && (
        <button type="button" title={t('Re-checked today')} aria-label={t('Re-checked today')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" onClick={() => setRechecking(p)}>
          <CheckCheck size={14} />
        </button>
      )}
      {can.contribute && p.guideline_url !== '' && (
        <button
          type="button"
          title={t('Ask CraftBot to re-read the guideline')}
          aria-label={t('Ask CraftBot to re-read the guideline')}
          disabled={requests[p.id] !== undefined}
          className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)] disabled:opacity-40"
          onClick={() => void ask(p)}
        >
          <Bot size={14} />
        </button>
      )}
      {p.guideline_url !== '' && (
        <a href={p.guideline_url} target="_blank" rel="noreferrer" title={t('Open the guideline')} aria-label={t('Open the guideline')} className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]">
          <ExternalLink size={14} />
        </a>
      )}
    </div>
  );

  const cols: Col<PermissionRec>[] = [
    {
      key: 'title',
      label: t('Title|field'),
      render: (p) => (
        <span className="flex max-w-[18rem] items-center gap-2">
          <span className="truncate font-medium">{p.title}</span>
          {needsRecheck(p) && <Pill tone="warn">{t('Re-check')}</Pill>}
        </span>
      ),
      value: (p) => p.title,
    },
    { key: 'type', label: t('Type'), value: (p) => enumLabel('permissions.permission_type', p.permission_type) },
    {
      key: 'from',
      label: t('From|rights holder'),
      render: (p) => (
        <span className="block max-w-[14rem] truncate">
          {counterpartyName(p)}
          {p.subject_name !== '' && <span className="text-[var(--agent-app-muted)]">{counterpartyName(p) !== '' ? ` · ${p.subject_name}` : p.subject_name}</span>}
        </span>
      ),
      value: (p) => `${counterpartyName(p)} ${p.subject_name}`.trim(),
    },
    { key: 'platforms', label: t('Platforms'), render: (p) => <span className="block max-w-[12rem] truncate">{(p.platforms ?? []).length > 0 ? joinList((p.platforms ?? []).map(platformLabel)) : t('Every platform')}</span>, value: (p) => (p.platforms ?? []).join(' ') },
    { key: 'monetization', label: t('Monetization'), render: (p) => <span className="block max-w-[12rem] truncate">{(p.monetization ?? []).length > 0 ? joinList((p.monetization ?? []).map(monetizationLabel)) : t('None')}</span>, value: (p) => (p.monetization ?? []).join(' ') },
    { key: 'archive', label: t('Archive'), value: (p) => enumLabel('permissions.archive', p.archive) },
    { key: 'talents', label: t('Talents'), render: (p) => <span className="block max-w-[12rem] truncate">{talentsText(p, nameOf)}</span>, value: (p) => talentsText(p, nameOf) },
    { key: 'status', label: t('Status'), render: (p) => <EnumPill field="permissions.status" value={p.status} />, value: (p) => enumLabel('permissions.status', p.status) },
    { key: 'checked', label: t('Last checked'), render: (p) => <span className="whitespace-nowrap tabular-nums">{fmtDate(p.last_checked)}</span>, value: (p) => d10(p.last_checked) },
    { key: 'end', label: t('Until|date'), render: (p) => <span className="whitespace-nowrap tabular-nums">{fmtDate(p.end_date)}</span>, value: (p) => d10(p.end_date), optional: true },
    { key: 'actions', label: t('Actions|column'), sortable: false, render: actions, value: () => '' },
  ];

  const pending = Object.entries(requests);

  return (
    <div className="min-w-0">
      <PageHeader
        title={t('Third-party permissions')}
        meta={list.loading ? undefined : String(list.records.length)}
        subtitle={t('What game publishers, music rights holders and platforms allow our talents to stream, and when each guideline was last checked.')}
        actions={
          can.edit ? (
            <Button onClick={() => setEditing('new')}>
              <Plus size={14} aria-hidden /> {t('Add a permission')}
            </Button>
          ) : undefined
        }
      />

      <Toolbar>
        <div className="w-full sm:w-64">
          <Input aria-label={t('Search')} placeholder={t('Search title, game or rights holder')} value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-48">
          <Select aria-label={t('Type')} value={type} placeholder={t('All types')} options={enumOptions('permissions.permission_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
        </div>
        <div className="w-[calc(50%-0.25rem)] sm:w-44">
          <Select aria-label={t('Status')} value={status} placeholder={t('Any status')} options={enumOptions('permissions.status').map(([value, label]) => ({ value, label }))} onChange={(e) => setStatus(e.target.value)} />
        </div>
        <Checkbox checked={recheck === '1'} onChange={(v) => setRecheck(v ? '1' : '')} label={dueCount > 0 ? t('Needs re-check ({n})', { n: dueCount }) : t('Needs re-check')} />
        <Checkbox checked={ending === '1'} onChange={(v) => setEnding(v ? '1' : '')} label={t('Ends within 60 days')} />
        {filtered && (
          <Button size="sm" variant="ghost" onClick={clear}>
            {t('Clear filters')}
          </Button>
        )}
      </Toolbar>

      {pending.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {pending.map(([pid, rid]) => (
            <div key={pid} className="flex flex-col gap-1 border border-[var(--agent-app-border)] px-3 py-2">
              <span className="truncate text-xs font-medium">{list.records.find((x) => x.id === pid)?.title ?? ''}</span>
              <AgentStatus compact requestId={rid} workingText={t('CraftBot is reading the guideline...')} doneText={t('CraftBot filed a proposal in the Inbox.')} />
            </div>
          ))}
        </div>
      )}

      <Section title={t('Permissions')} meta={filtered ? tn(rows.length, '{n} match', '{n} matches') : undefined} flush>
        {list.loading ? (
          <Loading />
        ) : list.records.length === 0 ? (
          <EmptyHint
            icon={BadgeCheck}
            title={t('No permissions yet')}
            message={t('Record each game, music or platform guideline your talents rely on: the platforms, monetization, archive rule, limits and credit line, and how often to re-check it.')}
            action={can.edit ? <Button onClick={() => setEditing('new')}>{t('Add a permission')}</Button> : undefined}
          />
        ) : rows.length === 0 ? (
          <EmptyHint compact title={t('Nothing matches these filters')} action={<Button size="sm" variant="outline" onClick={clear}>{t('Clear filters')}</Button>} />
        ) : (
          <>
            <div className="hidden md:block">
              <DataTable<PermissionRec> tableId="permissions" rows={rows} columns={cols} onRowClick={(p) => setOpen(p.id)} exportName="permissions" />
            </div>
            <div className="md:hidden">
              {rows.map((p) => (
                <ListRow
                  key={p.id}
                  onClick={() => setOpen(p.id)}
                  primary={p.title}
                  secondary={[enumLabel('permissions.permission_type', p.permission_type), counterpartyName(p), talentsText(p, nameOf), d10(p.last_checked) !== '' ? t('Checked {date}', { date: fmtDate(p.last_checked) }) : ''].filter((x) => x !== '').join(' · ')}
                  trailing={
                    <>
                      {needsRecheck(p) && <Pill tone="warn">{t('Re-check')}</Pill>}
                      <EnumPill field="permissions.status" value={p.status} />
                    </>
                  }
                />
              ))}
            </div>
          </>
        )}
      </Section>

      {opened !== null && (
        <PermissionDrawer
          permission={opened}
          requestId={requests[opened.id] ?? null}
          onAsk={() => void ask(opened)}
          onRecheck={() => setRechecking(opened)}
          onEdit={() => setEditing(opened)}
          onClose={closeDrawer}
        />
      )}
      {editing !== null && <PermissionForm permission={editing === 'new' ? null : editing} onClose={() => setEditing(null)} onSaved={(p) => setOpen(p.id)} />}
      {rechecking !== null && <RecheckDialog permission={rechecking} onClose={() => setRechecking(null)} />}
    </div>
  );
}
