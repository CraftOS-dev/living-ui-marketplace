/**
 * The Inbox: drop bills, receipts and statements for your AI agent to read.
 * Each file shows where it is (waiting, being read, done with what it
 * became, or not readable and why, with Retry). Files are read while your
 * AI agent is running; what it reads becomes drafts and proposals, never
 * postings on its own.
 */
import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Download, ExternalLink, FileUp, Inbox, Landmark, Receipt, RotateCw, ScrollText, Sparkles, Trash2, Upload } from 'lucide-react';
import { cn, toast } from '../../../kit/index.ts';
import { InboxThumb } from '../../components/agent/InboxThumb.tsx';
import { ageSeconds, ENTITY_WORD, openRecord, stamp } from '../../components/agent/words.ts';
import { Chips } from '../../components/controls.tsx';
import type { Tone } from '../../components/ui.tsx';
import { Card, CircleButton, Empty, LoadError, PageHeader, PillButton, Skeleton, StatusPill, TextLink, softInput, useConfirm } from '../../components/ui.tsx';
import { download, op, opForm } from '../../lib/api.ts';
import { ago } from '../../lib/dates.ts';
import { changed, useLive } from '../../lib/live.ts';
import { replaceQuery } from '../../lib/router.ts';
import type { PageProps } from '../../routes.tsx';
import type { InboxFile, InboxKind, InboxList, InboxStatus } from '../../lib/types/agent.ts';

const KINDS: { value: InboxKind; label: string; icon: typeof Receipt }[] = [
  { value: 'bill', label: 'Bills', icon: ScrollText },
  { value: 'receipt', label: 'Receipts', icon: Receipt },
  { value: 'statement', label: 'Statements', icon: Landmark },
  { value: 'other', label: 'Other', icon: FileUp },
];

const KIND_ONE: Record<string, string> = { bill: 'Bill', receipt: 'Receipt', statement: 'Statement', other: 'Other' };

const STATUS: Record<InboxStatus, { label: string; tone: Tone }> = {
  waiting: { label: 'Waiting', tone: 'warn' },
  reading: { label: 'Reading', tone: 'info' },
  done: { label: 'Done', tone: 'good' },
  failed: { label: 'Could not read', tone: 'bad' },
};

type Filter = '' | InboxStatus;

export function InboxPage({ query }: PageProps): React.JSX.Element {
  const [filter, setFilter] = useState<Filter>('');
  const [kind, setKind] = useState<InboxKind>('bill');
  const [note, setNote] = useState('');
  const [drag, setDrag] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const zone = useRef<HTMLButtonElement | null>(null);
  const list = useLive(() => op<InboxList>('inbox.list', { status: filter === '' ? undefined : filter, limit: 200 }, { quiet: true }), ['inbox'], [filter]);
  const wantNew = query.get('new') !== null;

  useEffect(() => {
    if (!wantNew) return;
    zone.current?.focus();
    zone.current?.scrollIntoView({ block: 'center' });
    setFlash(true);
    input.current?.click();
    replaceQuery('inbox', {});
    const t = setTimeout(() => setFlash(false), 1600);
    return () => clearTimeout(t);
  }, [wantNew]);

  const upload = async (files: FileList | File[]): Promise<void> => {
    const picked = Array.from(files);
    if (picked.length === 0) return;
    setUploading(true);
    try {
      await opForm('inbox.add', { kind, note: note.trim() === '' ? undefined : note.trim() }, { file: picked });
      toast.success(picked.length === 1 ? 'Sent to your AI agent' : `${picked.length} files sent to your AI agent`);
      setNote('');
      changed('inbox');
    } catch {
      /* shown */
    } finally {
      setUploading(false);
    }
  };

  const counts = list.data?.counts;
  const total = counts === undefined ? 0 : counts.waiting + counts.reading + counts.done + counts.failed;

  return (
    <div>
      <PageHeader
        title="Inbox"
        subtitle="Bills, receipts and statements for your AI agent to read into drafts."
        actions={
          <PillButton icon={Upload} dot loading={uploading} onClick={() => input.current?.click()}>
            Choose files
          </PillButton>
        }
      />
      <input
        ref={input}
        type="file"
        multiple
        accept="image/*,application/pdf,.csv,.txt,.ofx,.qif,.xls,.xlsx"
        className="hidden"
        aria-hidden
        tabIndex={-1}
        onChange={(e) => {
          if (e.target.files !== null) void upload(e.target.files);
          e.target.value = '';
        }}
      />

      <div className="mb-5 grid grid-cols-1 gap-5 @min-[900px]:grid-cols-12">
        <Card className="@min-[900px]:col-span-8" delay={1}>
          <button
            ref={zone}
            type="button"
            onClick={() => input.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              setDrag(true);
            }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDrag(false);
              void upload(e.dataTransfer.files);
            }}
            className={cn(
              'flex w-full flex-col items-center justify-center gap-3 rounded-[22px] border-2 border-dashed px-6 py-10 text-center outline-none transition-[background,border-color] focus-visible:ring-2 focus-visible:ring-[var(--erp-ink)] @min-[640px]:py-14',
              drag || flash ? 'border-[var(--erp-ink)] bg-[var(--erp-row)]' : 'border-[var(--erp-line)] hover:bg-[var(--erp-row)]',
            )}
          >
            <span className={cn('flex size-16 items-center justify-center rounded-full', drag ? 'bg-[var(--erp-accent)] text-[var(--erp-on-accent)]' : 'bg-[var(--erp-row)] text-[var(--erp-ink)]')}>
              {uploading ? <span className="size-6 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Upload size={26} strokeWidth={1.8} aria-hidden />}
            </span>
            <span className="text-[15px] font-bold">{drag ? 'Let go to send them' : 'Drop files here, or choose them'}</span>
            <span className="max-w-md text-[13px] leading-5 text-[var(--erp-muted)]">PDFs, photos of receipts, and bank statements as CSV, up to 20 MB each</span>
          </button>
          <div className="mt-5 grid grid-cols-1 gap-4 @min-[640px]:grid-cols-[auto_minmax(0,1fr)] @min-[640px]:items-end">
            <div className="flex min-w-0 flex-col gap-2">
              <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">What they are</span>
              <Chips ariaLabel="What the files are" value={kind} onChange={setKind} onCard options={KINDS.map((k) => ({ value: k.value, label: k.label, icon: k.icon }))} />
            </div>
            <label className="flex min-w-0 flex-col gap-2">
              <span className="px-1 text-[13px] font-semibold text-[var(--erp-ink-2)]">
                Note for your AI agent <span className="font-medium text-[var(--erp-muted)]">(optional)</span>
              </span>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Taxi to the trade fair, paid with the company card" className={softInput} maxLength={500} />
            </label>
          </div>
        </Card>

        <HowItWorks className="hidden @min-[900px]:col-span-4 @min-[900px]:block" counts={counts} total={total} onPick={setFilter} />
      </div>

      <div className="erp-rise erp-d2 mb-4">
        <Chips<Filter>
          ariaLabel="Show"
          value={filter}
          onChange={setFilter}
          options={[
            { value: '', label: 'All', count: total },
            { value: 'waiting', label: 'Waiting', count: counts?.waiting },
            { value: 'reading', label: 'Reading', count: counts?.reading },
            { value: 'done', label: 'Done', count: counts?.done },
            { value: 'failed', label: 'Could not read', count: counts?.failed, alert: true },
          ]}
        />
      </div>

      <Card delay={3} className="p-3 @min-[640px]:p-4">
        {list.data === null && list.error !== null ? (
          <LoadError message={list.error} onRetry={list.reload} />
        ) : list.data === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </div>
        ) : list.data.files.length === 0 ? (
          <Empty icon={Inbox} title={filter === '' ? 'The Inbox is empty' : 'Nothing here'} action={filter === '' ? <PillButton variant="soft" icon={Upload} onClick={() => input.current?.click()}>Choose files</PillButton> : undefined}>
            {filter === '' ? 'Drop a supplier bill or a receipt and your AI agent turns it into a draft for you.' : undefined}
          </Empty>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {list.data.files.map((f) => (
              <FileRow key={f.id} f={f} onChanged={list.reload} />
            ))}
          </ul>
        )}
      </Card>
      <HowItWorks className="mt-5 @min-[900px]:hidden" counts={counts} total={total} onPick={setFilter} />
    </div>
  );
}

function FileRow({ f, onChanged }: { f: InboxFile; onChanged: () => void }): React.JSX.Element {
  const [confirmEl, confirm] = useConfirm();
  const [busy, setBusy] = useState(false);
  const st = STATUS[f.status];
  const go = f.result !== null ? openRecord(f.result.entity, f.result.id) : null;
  const stale = f.status === 'waiting' && ageSeconds(f.created) > 120;

  const retry = async (): Promise<void> => {
    setBusy(true);
    try {
      await op('inbox.retry', { file: f.id });
      toast.success('Sent to your AI agent again');
      onChanged();
    } catch {
      /* shown */
    } finally {
      setBusy(false);
    }
  };
  const remove = async (): Promise<void> => {
    if (!(await confirm(`${f.filename} is removed from the Inbox.${f.result !== null ? ' What it became stays, with the file attached.' : ''}`, 'Remove this file?', 'Remove'))) return;
    try {
      await op('inbox.delete', { file: f.id });
      toast.success('Removed');
      onChanged();
    } catch {
      /* shown */
    }
  };

  return (
    <li className={cn('flex flex-col gap-3 rounded-[20px] p-3 @min-[480px]:flex-row @min-[480px]:items-start', f.status === 'failed' ? 'bg-[var(--erp-red)]/8' : 'bg-[var(--erp-row)]')}>
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <button type="button" onClick={() => void download('inbox.get', { file: f.id }, 'open', f.filename)} aria-label={`Open ${f.filename}`} className="shrink-0 rounded-[14px] transition-transform active:scale-95">
          <InboxThumb id={f.id} name={f.filename} isPdf={f.is_pdf} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button type="button" onClick={() => void download('inbox.get', { file: f.id }, 'open', f.filename)} className="min-w-0 truncate text-left text-[14px] font-bold hover:underline">
              {f.filename}
            </button>
            <span className="rounded-full bg-[var(--erp-card)] px-2 py-0.5 text-[12px] font-semibold text-[var(--erp-ink-2)]">{KIND_ONE[f.kind] ?? f.kind}</span>
          </div>
          <p className="mt-0.5 text-[12px] text-[var(--erp-muted)]">
            {f.added_by !== '' ? f.added_by : 'Someone'} · {ago(f.created)}
          </p>
          {f.note !== '' && <p className="mt-1.5 text-[13px] leading-5 text-[var(--erp-ink-2)]">"{f.note}"</p>}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <StatusPill tone={st.tone} size="sm" pulse={f.status === 'reading'}>
              {st.label}
            </StatusPill>
            {f.status === 'waiting' && <span className="text-[12px] text-[var(--erp-muted)]">{stale ? 'It is read when your AI agent next runs' : 'Your AI agent picks it up while it is running'}</span>}
            {f.status === 'reading' && <span className="text-[12px] text-[var(--erp-muted)]">Your AI agent is reading it, since {stamp(f.updated)}</span>}
          </div>
          {f.status === 'done' && (f.summary !== '' || go !== null) && (
            <div className="mt-2 rounded-[14px] bg-[var(--erp-card)] px-3 py-2 text-[13px] leading-5">
              {f.summary !== '' && <p>{f.summary}</p>}
              {go !== null && f.result !== null && (
                <TextLink className={f.summary !== '' ? 'mt-1' : ''} onClick={go}>
                  {f.result.label !== '' ? f.result.label : `Open the ${ENTITY_WORD[f.result.entity] ?? 'record'}`} <ArrowUpRight size={13} aria-hidden />
                </TextLink>
              )}
            </div>
          )}
          {f.status === 'failed' && <p className="mt-2 text-[13px] font-semibold leading-5 text-[var(--erp-red-text)]">{f.error !== '' ? f.error : 'It could not be read.'}</p>}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5 self-end @min-[480px]:self-start">
        {f.status === 'failed' && (
          <PillButton size="sm" variant="light" icon={RotateCw} loading={busy} onClick={() => void retry()}>
            Retry
          </PillButton>
        )}
        <CircleButton icon={ExternalLink} label={`Open ${f.filename}`} variant="light" size={36} onClick={() => void download('inbox.get', { file: f.id }, 'open', f.filename)} />
        <CircleButton icon={Download} label={`Download ${f.filename}`} variant="light" size={36} onClick={() => void download('inbox.get', { file: f.id, download: true }, 'save', f.filename)} />
        <CircleButton icon={Trash2} label={`Remove ${f.filename}`} variant="light" size={36} onClick={() => void remove()} />
      </div>
      {confirmEl}
    </li>
  );
}

function HowItWorks({ className, counts, total, onPick }: { className: string; counts: InboxList['counts'] | undefined; total: number; onPick: (s: InboxStatus) => void }): React.JSX.Element {
  return (
          <Card tone="dark" className={className} delay={2}>
            <div className="flex items-center gap-3">
              <span className="flex size-10 items-center justify-center rounded-full bg-[var(--erp-dark-2)] text-[var(--erp-accent)]">
                <Sparkles size={18} aria-hidden />
              </span>
              <p className="text-[15px] font-bold">How it works</p>
            </div>
            <ol className="mt-5 flex flex-col gap-4 text-[13px] leading-5">
              {[
                ['Drop the files', 'Each one waits here with what you said it is.'],
                ['Your AI agent reads them', 'Files are read while your AI agent is running. Until then they wait.'],
                ['You approve', 'Bills and receipts become drafts and proposals. Nothing is posted without you.'],
              ].map(([t, s], i) => (
                <li key={t} className="flex gap-3">
                  <span className="num flex size-6 shrink-0 items-center justify-center rounded-full bg-[var(--erp-accent)] text-[12px] font-bold text-[var(--erp-on-accent)]">{i + 1}</span>
                  <span>
                    <span className="block font-bold">{t}</span>
                    <span className="block text-[var(--erp-on-dark-muted)]">{s}</span>
                  </span>
                </li>
              ))}
            </ol>
            {counts !== undefined && total > 0 && (
              <div className="mt-5 grid grid-cols-2 gap-2">
                {(['waiting', 'reading', 'done', 'failed'] as InboxStatus[]).map((s) => (
                  <button key={s} type="button" onClick={() => onPick(s)} className="rounded-[16px] bg-[var(--erp-dark-2)] px-3 py-2.5 text-left transition-transform active:scale-[0.98]">
                    <span className="block text-[12px] text-[var(--erp-on-dark-muted)]">{STATUS[s].label}</span>
                    <span className={cn('num block text-[15px] font-bold', s === 'failed' && counts[s] > 0 && 'text-[var(--erp-red-text)]')}>{counts[s]}</span>
                  </button>
                ))}
              </div>
            )}
          </Card>
  );
}
