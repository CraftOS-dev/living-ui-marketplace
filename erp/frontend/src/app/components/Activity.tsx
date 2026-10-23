/**
 * The story of one record, on its page: what happened (created, sent,
 * posted, paid, voided, by whom: a person or your AI agent), notes people
 * left, and files attached (receipts, contracts, the supplier's PDF).
 * Fields your AI agent read from a document carry a mark until checked.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, FileText, MessageSquarePlus, Paperclip, Sparkles, Trash2, Upload } from 'lucide-react';
import { cn, getPbClient, toast } from '../../kit/index.ts';
import { download, op, opForm } from '../lib/api.ts';
import { ago } from '../lib/dates.ts';
import { useLive } from '../lib/live.ts';
import type { Activity, Attachment } from '../lib/types.ts';
import { Segmented } from './controls.tsx';
import { Avatar, Card, CircleButton, Empty, PillButton, Skeleton, TextLink, softArea, useConfirm } from './ui.tsx';

export type ActivityEntity =
  | 'documents'
  | 'payments'
  | 'parties'
  | 'items'
  | 'stock_changes'
  | 'journals'
  | 'accounts'
  | 'banks'
  | 'employees'
  | 'expense_claims'
  | 'leave_requests'
  | 'payroll_runs'
  | 'projects'
  | 'project_tasks'
  | 'builds'
  | 'boms'
  | 'assets'
  | 'warehouses';

/** An attachment's image, fetched with the session (an <img> cannot send it). */
export function useAttachmentUrl(id: string | null): string | null {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (id === null) return;
    let gone = false;
    let made: string | null = null;
    const pb = getPbClient().pb;
    const u = new URL(pb.buildURL('/api/ops/attachments/get'));
    u.searchParams.set('attachment', id);
    fetch(u.toString(), { headers: pb.authStore.token !== '' ? { Authorization: pb.authStore.token } : {}, credentials: 'include' })
      .then(async (res) => {
        if (!res.ok || gone) return;
        made = URL.createObjectURL(await res.blob());
        setUrl(made);
      })
      .catch(() => undefined);
    return () => {
      gone = true;
      if (made !== null) URL.revokeObjectURL(made);
    };
  }, [id]);
  return url;
}

function Thumb({ a }: { a: Attachment }): React.JSX.Element {
  const url = useAttachmentUrl(a.image ? a.id : null);
  if (url !== null) return <img src={url} alt="" className="size-11 shrink-0 rounded-[12px] object-cover" />;
  return (
    <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[var(--erp-card)]">
      <FileText size={18} aria-hidden />
    </span>
  );
}

function size(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function RecordActivity({ entity, refId, title = 'Activity', className }: { entity: ActivityEntity; refId: string; title?: string | undefined; className?: string | undefined }): React.JSX.Element {
  const data = useLive(() => op<Activity>('activity.list', { entity, ref: refId, limit: 100 }, { quiet: true }), ['audit', 'notes', 'attachments', 'field_marks'], [entity, refId]);
  const [tab, setTab] = useState<'story' | 'files'>('story');
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [confirmEl, confirm] = useConfirm();
  const a = data.data;

  const addNote = async (): Promise<void> => {
    if (note.trim() === '') return;
    setSaving(true);
    try {
      await op('notes.add', { entity, ref: refId, body: note.trim() });
      setNote('');
      data.reload();
    } catch {
      /* shown */
    } finally {
      setSaving(false);
    }
  };

  const upload = async (files: FileList | File[]): Promise<void> => {
    const list = Array.from(files);
    if (list.length === 0) return;
    setUploading(true);
    try {
      await opForm('attachments.add', { entity, ref: refId }, { file: list });
      toast.success(list.length === 1 ? 'File attached' : `${list.length} files attached`);
      setTab('files');
      data.reload();
    } catch {
      /* shown */
    } finally {
      setUploading(false);
    }
  };

  const files = a?.attachments ?? [];
  return (
    <Card className={className} delay={3}>
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2 className="text-[15px] font-bold">{title}</h2>
        <Segmented
          ariaLabel="Show"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'story', label: 'History' },
            { value: 'files', label: files.length > 0 ? `Files ${files.length}` : 'Files' },
          ]}
        />
      </div>
      {tab === 'story' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Write a note for the team"
              aria-label="Note"
              className={cn(softArea, 'min-h-[64px]')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void addNote();
              }}
            />
            {note.trim() !== '' && (
              <div className="flex justify-end">
                <PillButton size="sm" icon={MessageSquarePlus} loading={saving} onClick={() => void addNote()}>
                  Add note
                </PillButton>
              </div>
            )}
          </div>
          {a === null ? (
            data.error !== null ? (
              <p className="text-[13px] text-[var(--erp-muted)]">
                The activity did not load.{' '}
                <TextLink onClick={data.reload}>Try again</TextLink>
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <Skeleton className="h-10" />
                <Skeleton className="h-10" />
              </div>
            )
          ) : a.items.length === 0 ? (
            <p className="text-[13px] text-[var(--erp-muted)]">Nothing has happened here yet.</p>
          ) : (
            <ol className="relative flex flex-col gap-4 pl-1">
              {a.items.map((it) => (
                <li key={it.id} className="flex items-start gap-3">
                  <Avatar name={it.who} agent={it.actor === 'agent'} size={30} tone={it.actor === 'agent' ? 'accent' : it.kind === 'note' ? 'ink' : 'row'} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-[13px] leading-5', it.kind === 'note' ? 'rounded-[14px] bg-[var(--erp-row)] px-3 py-2 text-[var(--erp-ink)]' : 'text-[var(--erp-ink-2)]')}>{it.body}</p>
                    <p className="mt-0.5 text-[12px] text-[var(--erp-muted)]">
                      {it.actor === 'agent' ? 'Your AI agent' : it.who} · {ago(it.at)}
                    </p>
                  </div>
                  {it.kind === 'note' && (
                    <CircleButton
                      icon={Trash2}
                      label="Delete note"
                      variant="ghost"
                      size={30}
                      onClick={() => {
                        void (async () => {
                          if (!(await confirm('The note is removed for everyone.', 'Delete this note?'))) return;
                          await op('notes.delete', { note: it.id }).catch(() => undefined);
                          data.reload();
                        })();
                      }}
                    />
                  )}
                </li>
              ))}
            </ol>
          )}
          {a !== null && a.marks.length > 0 && (
            <div className="rounded-[18px] bg-[var(--erp-accent-soft)] px-4 py-3 text-[13px]">
              <p className="mb-1 flex items-center gap-1.5 font-bold">
                <Sparkles size={14} aria-hidden /> Read by your AI agent
              </p>
              <ul className="flex flex-col gap-0.5 text-[var(--erp-ink-2)]">
                {a.marks.map((m) => (
                  <li key={m.field}>
                    {m.field.replace(/_/g, ' ')}: {m.confidence === 'check' ? 'please check' : 'read clearly'}
                    {m.reason !== '' ? ` (${m.reason})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
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
            className={cn('flex flex-col items-center gap-2 rounded-[18px] border-2 border-dashed px-4 py-6 text-center transition-colors', drag ? 'border-[var(--erp-ink)] bg-[var(--erp-row)]' : 'border-[var(--erp-line)] hover:bg-[var(--erp-row)]')}
          >
            {uploading ? <span className="size-5 animate-spin rounded-full border-2 border-[var(--erp-ink)] border-t-transparent" /> : <Upload size={20} aria-hidden />}
            <span className="text-[13px] font-semibold">Drop files or choose them</span>
            <span className="text-[12px] text-[var(--erp-muted)]">PDF, images, spreadsheets, up to 20 MB each</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => {
              if (e.target.files !== null) void upload(e.target.files);
              e.target.value = '';
            }}
          />
          {files.length === 0 ? (
            <Empty icon={Paperclip} title="No files yet" compact />
          ) : (
            <ul className="flex flex-col gap-1.5">
              {files.map((f) => (
                <li key={f.id} className="flex items-center gap-3 rounded-[18px] bg-[var(--erp-row)] p-2 pr-3">
                  <Thumb a={f} />
                  <button type="button" onClick={() => void download('attachments.get', { attachment: f.id }, 'open', f.name)} className="min-w-0 flex-1 text-left">
                    <span className="block truncate text-[13px] font-bold">{f.name}</span>
                    <span className="block truncate text-[12px] text-[var(--erp-muted)]">
                      {size(f.size)} · {f.actor === 'agent' ? 'Your AI agent' : f.who} · {ago(f.at)}
                    </span>
                  </button>
                  <CircleButton icon={Download} label={`Download ${f.name}`} variant="light" size={32} onClick={() => void download('attachments.get', { attachment: f.id, download: true }, 'save', f.name)} />
                  <CircleButton
                    icon={Trash2}
                    label={`Remove ${f.name}`}
                    variant="light"
                    size={32}
                    onClick={() => {
                      void (async () => {
                        if (!(await confirm(`${f.name} is removed from this record.`, 'Remove this file?', 'Remove'))) return;
                        await op('attachments.delete', { attachment: f.id }).catch(() => undefined);
                        data.reload();
                      })();
                    }}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {confirmEl}
    </Card>
  );
}
