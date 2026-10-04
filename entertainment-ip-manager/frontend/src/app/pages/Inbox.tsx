/**
 * Inbox: the review door. Office sync, CraftBot (documents, contracts,
 * statements, guideline checks, marketplace scans) and email proposals
 * wait here until a person accepts or rejects them. Wide screens show the
 * list and the item side by side (each scrolls on its own); below that the
 * item replaces the list, with a back link. "#/inbox/<id>" opens one item.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox as InboxIcon } from 'lucide-react';
import { Button, Select, cn } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, ago, toPb, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { subjectHref, useRoute } from '../lib/router.ts';
import type { InboxItemRec } from '../lib/records.ts';
import { EmptyHint, EnumPill, ErrorBox, Loading, PageHeader, Segmented, Tag } from '../components/ui.tsx';
import { ConfidencePill, HowItemsArrive, INBOX_LIST_EXPAND, InboxDetail, SourceTag, inboxSubject } from '../components/workInbox.tsx';
import { hashWithId, replaceHashSilently, subjectTypeLabel, useSilentParam } from '../components/workShared.tsx';

type Filter = 'waiting' | 'accepted' | 'rejected' | 'all';

function asFilter(v: string): Filter {
  return v === 'accepted' || v === 'rejected' || v === 'all' ? v : 'waiting';
}

function isWaiting(i: InboxItemRec): boolean {
  return i.status === 'new' || i.status === 'awaiting_second';
}

export function InboxPage({ id }: { id: string }): React.JSX.Element {
  const { me } = useApp();
  const myId = me?.id ?? '';
  const [filterRaw, setFilterRaw] = useSilentParam('status', 'waiting');
  const filter = asFilter(filterRaw);
  const [kind, setKind] = useSilentParam('kind', '');
  const [selectedId, setSelectedId] = useState(id);

  const since = toPb(addDays(today(), -180));
  const waiting = useCollection<InboxItemRec>('inbox_items', { filter: 'status = "new" || status = "awaiting_second"', sort: '-created', expand: INBOX_LIST_EXPAND });
  const decided = useCollection<InboxItemRec>('inbox_items', {
    filter: `status != "new" && status != "awaiting_second" && created >= "${since}"`,
    sort: '-updated',
    expand: INBOX_LIST_EXPAND,
  });

  const byKind = (list: InboxItemRec[]): InboxItemRec[] => (kind === '' ? list : list.filter((i) => i.kind === kind));
  const lists = useMemo(() => {
    const w = byKind(waiting.records);
    const d = byKind(decided.records);
    return {
      waiting: w,
      accepted: d.filter((i) => i.status === 'accepted' || i.status === 'partially_accepted'),
      rejected: d.filter((i) => i.status === 'rejected'),
      all: [...w, ...d].sort((a, b) => b.created.localeCompare(a.created)),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting.records, decided.records, kind]);
  const visible = lists[filter];
  const loading = filter === 'waiting' ? waiting.loading : waiting.loading || decided.loading;
  const loadError = waiting.error ?? decided.error;

  const select = (next: string): void => {
    setSelectedId(next);
    replaceHashSilently(hashWithId('inbox', next));
  };

  // Links to an item (notifications, Today) arriving while the page is open.
  const route = useRoute();
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (route.page === 'inbox') setSelectedId(route.id);
  }, [route]);

  // A link to an item that was already decided shows the whole list.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || id === '' || waiting.loading || decided.loading) return;
    placed.current = true;
    if (filter === 'waiting' && !waiting.records.some((i) => i.id === id)) setFilterRaw('all');
  }, [id, filter, waiting.loading, decided.loading, waiting.records, setFilterRaw]);

  // Wide screens open the first waiting item straight away.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || waiting.loading) return;
    autoPicked.current = true;
    if (selectedId !== '') return;
    if (window.matchMedia('(min-width: 1024px)').matches) {
      const first = lists.waiting[0];
      if (first !== undefined) select(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waiting.loading]);

  const onDecided = (doneId: string): void => {
    const order = visible.map((i) => i.id);
    const pos = order.indexOf(doneId);
    const actionable = lists.waiting.filter((i) => i.id !== doneId && !(i.status === 'awaiting_second' && i.first_approver === myId));
    const after = actionable.find((i) => pos >= 0 && order.indexOf(i.id) > pos);
    const next = after ?? actionable[0];
    waiting.refresh();
    decided.refresh();
    if (next !== undefined && window.matchMedia('(min-width: 1024px)').matches) select(next.id);
  };

  const kindOptions = enumOptions('inbox_items.kind').map(([value, label]) => ({ value, label }));
  const anyAtAll = waiting.records.length + decided.records.length > 0;

  const listEmpty =
    kind !== '' && anyAtAll ? (
      <EmptyHint
        compact
        icon={InboxIcon}
        title={t('Nothing of this kind')}
        message={t('Other kinds of items are hidden by the filter.')}
        action={
          <Button size="sm" variant="outline" onClick={() => setKind('')}>
            {t('Show all kinds')}
          </Button>
        }
      />
    ) : filter === 'waiting' ? (
      <EmptyHint compact icon={InboxIcon} title={t('Nothing waiting for review')} message={t('Office changes and CraftBot proposals arrive here. Nothing reaches your records until someone accepts it.')} />
    ) : (
      <EmptyHint compact icon={InboxIcon} title={t('No decided items')} message={t('Items accepted or rejected in the last six months appear here.')} />
    );

  return (
    <div>
      <PageHeader
        title={t('Inbox')}
        meta={waiting.loading ? undefined : t('{n} waiting', { n: waiting.records.length })}
        subtitle={t('Office data, CraftBot and email propose changes here. Nothing changes on your records until a person accepts it.')}
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
        <div className={cn('min-w-0', selectedId !== '' && 'hidden lg:block')}>
          <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
            <div className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] p-3">
              <div className="max-w-full overflow-x-auto">
                <Segmented<Filter>
                  size="sm"
                  ariaLabel={t('Which items')}
                  value={filter}
                  onChange={(v) => setFilterRaw(v)}
                  options={[
                    { value: 'waiting', label: <span className="whitespace-nowrap">{t('Waiting {n}', { n: lists.waiting.length })}</span> },
                    { value: 'accepted', label: <span className="whitespace-nowrap">{t('Accepted')}</span> },
                    { value: 'rejected', label: <span className="whitespace-nowrap">{t('Rejected')}</span> },
                    { value: 'all', label: <span className="whitespace-nowrap">{t('All')}</span> },
                  ]}
                />
              </div>
              <Select aria-label={t('Kind of item')} className="h-8 text-[13px]" value={kind} placeholder={t('All kinds')} options={kindOptions} onChange={(e) => setKind(e.target.value)} />
              {filter !== 'waiting' && <p className="text-[11px] text-[var(--agent-app-muted)]">{t('Decided items from the last six months.')}</p>}
            </div>
            <div className="lg:max-h-[calc(100vh-15rem)] lg:overflow-y-auto">
              {loading ? (
                <Loading />
              ) : loadError !== null ? (
                <div className="p-3">
                  <ErrorBox
                    message={loadError}
                    onRetry={() => {
                      waiting.refresh();
                      decided.refresh();
                    }}
                  />
                </div>
              ) : visible.length === 0 ? (
                listEmpty
              ) : (
                visible.map((item) => <InboxRow key={item.id} item={item} selected={item.id === selectedId} onSelect={() => select(item.id)} />)
              )}
            </div>
          </div>
        </div>

        <div className={cn('min-w-0', selectedId === '' && 'hidden lg:block')}>
          {selectedId === '' ? (
            <div className="border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
              {waiting.records.length > 0 ? (
                <EmptyHint icon={InboxIcon} title={t('Choose an item to review')} message={t('Pick an item on the left to see what it changes and which deadlines it creates.')} />
              ) : (
                <HowItemsArrive />
              )}
            </div>
          ) : (
            <InboxDetail
              key={selectedId}
              itemId={selectedId}
              onBack={() => select('')}
              onDecided={onDecided}
              onDeleted={() => {
                waiting.refresh();
                decided.refresh();
                select('');
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function InboxRow({ item, selected, onSelect }: { item: InboxItemRec; selected: boolean; onSelect: () => void }): React.JSX.Element {
  const subject = inboxSubject(item);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect();
        }
      }}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'block w-full min-w-0 cursor-pointer border-b border-l-2 border-b-[var(--agent-app-border)]/70 px-3 py-2.5 text-left transition-colors last:border-b-0',
        selected ? 'border-l-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-l-transparent hover:bg-[var(--agent-app-border)]/20',
      )}
    >
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        <Tag>{enumLabel('inbox_items.kind', item.kind)}</Tag>
        <SourceTag source={item.source} />
        {item.status !== 'new' && <EnumPill field="inbox_items.status" value={item.status} />}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--agent-app-muted)]">{ago(item.created)}</span>
      </div>
      <div className={cn('mt-1 line-clamp-2 break-words text-[13px] leading-snug', isWaiting(item) ? 'font-medium' : 'text-[var(--agent-app-text)]/80')}>{item.title}</div>
      <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--agent-app-muted)]">
        {subject !== null && (
          <a href={subjectHref(subject.type, subject.id)} onClick={(e) => e.stopPropagation()} className="min-w-0 max-w-full truncate hover:text-[var(--agent-app-text)] hover:underline">
            {subject.label !== '' ? subject.label : subjectTypeLabel(subject.type)}
          </a>
        )}
        {item.proposed_by !== '' && <span className="min-w-0 max-w-full truncate">{t('Proposed by {name}', { name: item.proposed_by })}</span>}
        <span className="ml-auto">
          <ConfidencePill confidence={item.confidence} />
        </span>
      </div>
    </div>
  );
}
