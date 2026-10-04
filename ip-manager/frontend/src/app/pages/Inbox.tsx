/**
 * Inbox: the one door for automated data. Office changes, documents read
 * by CraftBot, agreement drafts and emails wait here until a person
 * accepts or rejects them. Two panes on wide screens (list and detail);
 * on a phone the detail replaces the list.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Inbox as InboxIcon, Upload } from 'lucide-react';
import { Button, Card, Dialog, Select, cn, toast, useAuth } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { addDays, ago, toPb, today } from '../lib/format.ts';
import { href, useRoute } from '../lib/router.ts';
import type { DocumentRec, InboxRec, MatterRec } from '../lib/types.ts';
import { handToCraftBot } from '../components/craftbot.tsx';
import { RecordPicker } from '../components/pickers.tsx';
import { EmptyHint, ErrorBox, Loading, PageHeader, Pill, Segmented, Tag } from '../components/ui.tsx';
import {
  ConfidencePill,
  DocketStatus,
  INBOX_KIND_LABEL,
  INBOX_STATUS_LABEL,
  INBOX_STATUS_TONE,
  InboxDetail,
  sourceLine,
} from '../components/workInbox.tsx';
import { replaceHashSilently } from '../components/workShared.tsx';

type Filter = 'review' | 'decided' | 'all';

const KIND_OPTIONS = Object.entries(INBOX_KIND_LABEL).map(([value, label]) => ({ value, label }));

const MATTER_SEARCH = ['ref', 'title', 'application_no', 'registration_no', 'publication_no'];

function isReview(i: InboxRec): boolean {
  return i.status === 'new' || i.status === 'awaiting_second';
}

export function InboxPage({ id }: { id: string }): React.JSX.Element {
  const { can, me } = useApp();
  const { userId } = useAuth();
  const myId = me?.id ?? userId ?? '';
  const [filter, setFilter] = useState<Filter>('review');
  const [kind, setKind] = useState('');
  const [selectedId, setSelectedId] = useState(id);
  const [upload, setUpload] = useState(false);

  const since = toPb(addDays(today(), -180));
  const review = useCollection<InboxRec>('inbox_items', { filter: 'status = "new" || status = "awaiting_second"', sort: '-created' });
  const decided = useCollection<InboxRec>('inbox_items', {
    filter: `status != "new" && status != "awaiting_second" && created >= "${since}"`,
    sort: '-decided_at,-created',
  });

  const byKind = (list: InboxRec[]): InboxRec[] => (kind === '' ? list : list.filter((i) => i.kind === kind));
  const reviewList = useMemo(() => byKind(review.records), [review.records, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const decidedList = useMemo(() => byKind(decided.records), [decided.records, kind]); // eslint-disable-line react-hooks/exhaustive-deps
  const allList = useMemo(() => [...reviewList, ...decidedList].sort((a, b) => b.created.localeCompare(a.created)), [reviewList, decidedList]);
  const visible = filter === 'review' ? reviewList : filter === 'decided' ? decidedList : allList;
  const loading = filter === 'review' ? review.loading : review.loading || decided.loading;
  const loadError = review.error ?? decided.error;

  const select = (next: string): void => {
    setSelectedId(next);
    replaceHashSilently(next !== '' ? href('inbox', next) : href('inbox'));
  };

  // Deep links (notifications, "Open the Inbox") arriving while this page is open.
  const route = useRoute();
  const firstRoute = useRef(true);
  useEffect(() => {
    if (firstRoute.current) {
      firstRoute.current = false;
      return;
    }
    if (route.page === 'inbox') setSelectedId(route.id);
  }, [route]);

  // A link to an item that was already decided opens the Decided list.
  const placed = useRef(false);
  useEffect(() => {
    if (placed.current || id === '' || review.loading || decided.loading) return;
    placed.current = true;
    if (!review.records.some((i) => i.id === id) && decided.records.some((i) => i.id === id)) setFilter('decided');
  }, [id, review.loading, decided.loading, review.records, decided.records]);

  // Wide screens open the first item to review straight away.
  const autoPicked = useRef(false);
  useEffect(() => {
    if (autoPicked.current || review.loading) return;
    autoPicked.current = true;
    if (selectedId !== '') return;
    if (typeof window !== 'undefined' && window.matchMedia('(min-width: 1024px)').matches) {
      const first = reviewList[0];
      if (first !== undefined) select(first.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [review.loading]);

  const onDecided = (doneId: string): void => {
    const order = visible.map((i) => i.id);
    const pos = order.indexOf(doneId);
    const actionable = reviewList.filter((i) => i.id !== doneId && !(i.status === 'awaiting_second' && i.first_approver === myId));
    const after = actionable.find((i) => {
      const p = order.indexOf(i.id);
      return pos >= 0 && p > pos;
    });
    const next = after ?? actionable[0];
    review.refresh();
    decided.refresh();
    if (next !== undefined) select(next.id);
  };

  const counts = {
    review: reviewList.length,
    decided: decidedList.length,
    all: reviewList.length + decidedList.length,
  };

  const listEmpty =
    kind !== '' && (filter === 'review' ? review.records.length : filter === 'decided' ? decided.records.length : review.records.length + decided.records.length) > 0 ? (
      <EmptyHint
        compact
        icon={InboxIcon}
        title={`No ${INBOX_KIND_LABEL[kind as InboxRec['kind']].toLowerCase()} items`}
        message="Other kinds of items are hidden by the filter."
        action={
          <Button size="sm" variant="outline" onClick={() => setKind('')}>
            Show all kinds
          </Button>
        }
      />
    ) : filter === 'decided' ? (
      <EmptyHint compact icon={InboxIcon} title="No decisions yet" message="Items accepted or rejected in the last six months appear here." />
    ) : (
      <EmptyHint
        compact
        icon={InboxIcon}
        title="Nothing waiting for review"
        message="Office changes and CraftBot proposals arrive here. Nothing reaches the register until someone accepts it."
        action={
          can.contribute ? (
            <Button size="sm" variant="outline" onClick={() => setUpload(true)}>
              Upload for CraftBot
            </Button>
          ) : undefined
        }
      />
    );

  return (
    <div>
      <PageHeader
        title="Inbox"
        meta={review.loading ? undefined : `${review.records.length} to review`}
        subtitle="Changes from the patent and trademark offices and proposals from CraftBot arrive here. Nothing reaches the register until someone reviews and accepts it."
        actions={
          can.contribute ? (
            <Button onClick={() => setUpload(true)}>
              <Upload size={14} aria-hidden /> Upload for CraftBot
            </Button>
          ) : undefined
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
        <div className={cn('min-w-0 lg:sticky lg:top-4', selectedId !== '' && 'hidden lg:block')}>
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-[var(--agent-app-border)] p-3">
              <Segmented<Filter>
                size="sm"
                ariaLabel="Which items"
                value={filter}
                onChange={setFilter}
                options={[
                  { value: 'review', label: `To review ${counts.review}` },
                  { value: 'decided', label: `Decided ${counts.decided}` },
                  { value: 'all', label: `All ${counts.all}` },
                ]}
              />
              <Select aria-label="Kind of item" className="h-8 text-[13px]" value={kind} placeholder="All kinds" options={KIND_OPTIONS} onChange={(e) => setKind(e.target.value)} />
              {filter !== 'review' && <p className="text-[11px] text-[var(--agent-app-muted)]">Decided items from the last six months.</p>}
            </div>
            <div className="lg:max-h-[calc(100vh-17rem)] lg:overflow-y-auto">
              {loading ? (
                <Loading />
              ) : loadError !== null ? (
                <div className="p-3">
                  <ErrorBox
                    message={loadError}
                    onRetry={() => {
                      review.refresh();
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
          </Card>
        </div>

        <div className={cn('min-w-0', selectedId === '' && 'hidden lg:block')}>
          {selectedId === '' ? (
            <Card>
              {review.records.length > 0 ? (
                <EmptyHint icon={InboxIcon} title="Choose an item to review" message="Pick an item on the left to see what changes and which deadlines it creates." />
              ) : (
                <HowItemsArrive />
              )}
            </Card>
          ) : (
            <InboxDetail key={selectedId} itemId={selectedId} onBack={() => select('')} onDecided={onDecided} />
          )}
        </div>
      </div>

      {upload && <UploadForCraftBotDialog onClose={() => setUpload(false)} />}
    </div>
  );
}

function HowItemsArrive(): React.JSX.Element {
  const rows: { title: string; text: string }[] = [
    {
      title: 'Office changes',
      text: 'A connected office (USPTO, EPO, EUIPO or JPO) reports a new status, date or event on one of your records.',
    },
    {
      title: 'Documents read by CraftBot',
      text: 'Someone uploads an office letter and CraftBot proposes the event, the deadlines and where it read each value.',
    },
    {
      title: 'Agreement drafts',
      text: 'CraftBot reads a contract and proposes the agreement terms and the rights it grants.',
    },
  ];
  return (
    <div className="p-5">
      <h2 className="text-[13px] font-semibold">How items arrive here</h2>
      <p className="mt-1 text-[13px] text-[var(--agent-app-muted)]">Each one waits for a person. Accepting applies it to the register; rejecting leaves the register as it is.</p>
      <div className="mt-4 flex flex-col border border-[var(--agent-app-border)]">
        {rows.map((r) => (
          <div key={r.title} className="border-b border-[var(--agent-app-border)]/70 px-3 py-2.5 last:border-0">
            <div className="text-[13px] font-medium">{r.title}</div>
            <div className="mt-0.5 text-xs leading-relaxed text-[var(--agent-app-muted)]">{r.text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function InboxRow({ item, selected, onSelect }: { item: InboxRec; selected: boolean; onSelect: () => void }): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'block w-full border-b border-l-2 border-b-[var(--agent-app-border)]/70 px-3 py-2.5 text-left transition-colors last:border-b-0',
        selected ? 'border-l-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-l-transparent hover:bg-[var(--agent-app-border)]/20',
      )}
    >
      <div className="flex items-center gap-2">
        <Tag>{INBOX_KIND_LABEL[item.kind]}</Tag>
        {item.status === 'awaiting_second' && <Pill tone="warn">Needs second reviewer</Pill>}
        {!isReview(item) && <Pill tone={INBOX_STATUS_TONE[item.status]}>{INBOX_STATUS_LABEL[item.status]}</Pill>}
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[var(--agent-app-muted)]">{ago(item.created)}</span>
      </div>
      <div className={cn('mt-1 line-clamp-2 text-[13px] leading-snug', selected || isReview(item) ? 'font-medium' : 'text-[var(--agent-app-text)]/80')}>{item.title}</div>
      <div className="mt-1 flex items-center gap-2 text-xs text-[var(--agent-app-muted)]">
        <span className="min-w-0 flex-1 truncate">{sourceLine(item)}</span>
        <ConfidencePill confidence={item.confidence} />
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Upload a document for CraftBot to docket                            */
/* ------------------------------------------------------------------ */

function UploadForCraftBotDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { me } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [matterId, setMatterId] = useState('');
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [sent, setSent] = useState<{ requestId: string | null } | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const pick = (f: File | null | undefined): void => {
    if (f) setFile(f);
  };

  const submit = async (): Promise<void> => {
    if (file === null) {
      toast.error('Choose a file first.');
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', file.name.replace(/\.[^.]+$/, '') || file.name);
      fd.append('doc_type', 'office_action');
      fd.append('source', 'upload');
      if (me !== null) fd.append('uploaded_by', me.id);
      if (matterId !== '') fd.append('matter', matterId);
      const doc = await createRecord<DocumentRec>('documents', fd);
      const requestId = await handToCraftBot('document_docketing_requested', { document_id: doc.id, ...(matterId !== '' ? { matter_id: matterId } : {}) });
      setSent({ requestId });
    } catch {
      /* the client already showed the error */
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Upload for CraftBot"
      description="CraftBot reads the document, finds the record and the date, and files a proposal here for review. Nothing is docketed until someone accepts it."
      className="w-[min(94vw,32rem)]"
      footer={
        sent !== null ? (
          <Button onClick={onClose}>Done</Button>
        ) : (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={file === null}>
              Upload and send
            </Button>
          </>
        )
      }
    >
      {sent !== null ? (
        sent.requestId !== null ? (
          <DocketStatus requestId={sent.requestId} />
        ) : (
          <p className="text-[13px] leading-relaxed">
            The document was saved{matterId !== '' ? ' on the record' : ''}, but CraftBot could not take the request right now.
            {matterId !== '' ? ' You can ask again from the record, under Documents, with Docket this.' : ' Try again once CraftBot is running and connected.'}
          </p>
        )
      ) : (
        <div className="flex flex-col gap-4">
          <div
            role="button"
            tabIndex={0}
            aria-label="Choose a file"
            onClick={() => input.current?.click()}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') input.current?.click();
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              pick(e.dataTransfer.files[0]);
            }}
            className={cn(
              'flex flex-col items-center gap-1.5 border border-dashed px-4 py-6 text-center text-[13px]',
              drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]',
            )}
          >
            <Upload size={18} className="text-[var(--agent-app-muted)]" aria-hidden />
            {file !== null ? (
              <span className="font-medium">{file.name}</span>
            ) : (
              <span>Drop an office action, letter or certificate here, or click to choose (PDF or image, up to 50 MB)</span>
            )}
            <input ref={input} type="file" accept=".pdf,image/*,.doc,.docx,.txt,.eml,.msg" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <div>
            <RecordPicker<MatterRec>
              collection="matters"
              label="Record (optional)"
              value={matterId}
              onChange={(nextId) => setMatterId(nextId)}
              labelOf={(m) => `${m.ref} ${m.title}`.trim()}
              searchFields={MATTER_SEARCH}
              placeholder="Search by reference, title or office number"
            />
            <p className="mt-1.5 text-xs text-[var(--agent-app-muted)]">Leave empty and CraftBot matches the number printed on the document.</p>
          </div>
        </div>
      )}
    </Dialog>
  );
}
