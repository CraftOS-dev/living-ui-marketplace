/**
 * Documents attached to a record: upload (drag and drop), type and date,
 * preview, and the two CraftBot hand-offs: "Docket this document" and
 * "Extract agreement terms". Results arrive in the Inbox for review.
 */
import { useRef, useState } from 'react';
import { Bot, ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import { Button, Dialog, Input, Select, cn, toast, useConfirm } from '../../kit/index.ts';
import { useCollection } from '../lib/live.ts';
import { createRecord, deleteRecord, fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate, today } from '../lib/format.ts';
import { DOC_TYPE_LABEL } from '../lib/labels.ts';
import { href } from '../lib/router.ts';
import type { DocType, DocumentRec } from '../lib/types.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { EmptyHint, Field, Section, Tag } from './ui.tsx';

export type DocRelation = 'matter' | 'agreement' | 'work' | 'disclosure' | 'family' | 'property' | 'dispute';

const DOC_TYPES = Object.entries(DOC_TYPE_LABEL).map(([value, label]) => ({ value, label }));

export function UploadDialog({
  relation,
  relationId,
  defaultType = 'other',
  onClose,
  onUploaded,
}: {
  relation: DocRelation;
  relationId: string;
  defaultType?: DocType | undefined;
  onClose: () => void;
  onUploaded?: ((doc: DocumentRec) => void) | undefined;
}): React.JSX.Element {
  const { me } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [type, setType] = useState<string>(defaultType);
  const [date, setDate] = useState(today());
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const input = useRef<HTMLInputElement | null>(null);
  const pick = (f: File | null | undefined): void => {
    if (!f) return;
    setFile(f);
    if (title === '') setTitle(f.name.replace(/\.[^.]+$/, ''));
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
      fd.append('title', title.trim() || file.name);
      fd.append('doc_type', type);
      fd.append('doc_date', `${date} 00:00:00.000Z`);
      fd.append(relation, relationId);
      fd.append('source', 'upload');
      if (me !== null) fd.append('uploaded_by', me.id);
      const doc = await createRecord<DocumentRec>('documents', fd);
      toast.success('Uploaded');
      onUploaded?.(doc);
      onClose();
    } catch {
      /* toast shown by the client */
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Upload a document"
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={file === null}>
            Upload
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <div
          role="button"
          tabIndex={0}
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
          {file !== null ? <span className="font-medium">{file.name}</span> : <span>Drop a file here or click to choose (PDF, image, Word, up to 50 MB)</span>}
          <input ref={input} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Type" value={type} options={DOC_TYPES} onChange={(e) => setType(e.target.value)} />
          <Field label="Document date">
            <input type="date" className="h-9 border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] px-2 text-sm" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

export function DocumentsPanel({
  relation,
  relationId,
  title = 'Documents',
  defaultType,
  docketing = false,
  extraction = false,
  matterId,
}: {
  relation: DocRelation;
  relationId: string;
  title?: string | undefined;
  defaultType?: DocType | undefined;
  docketing?: boolean | undefined;
  extraction?: boolean | undefined;
  matterId?: string | undefined;
}): React.JSX.Element {
  const { can, userName } = useApp();
  const docs = useCollection<DocumentRec>('documents', { filter: `${relation} = "${relationId}"`, sort: '-doc_date,-created' });
  const [upload, setUpload] = useState(false);
  const [requests, setRequests] = useState<Record<string, string>>({});
  const [confirmEl, confirm] = useConfirm();

  const docket = async (d: DocumentRec): Promise<void> => {
    const id = await handToCraftBot('document_docketing_requested', { document_id: d.id, ...(matterId ? { matter_id: matterId } : {}) });
    if (id !== null) setRequests((r) => ({ ...r, [d.id]: id }));
  };
  const extract = async (d: DocumentRec): Promise<void> => {
    const id = await handToCraftBot('agreement_extraction_requested', { document_id: d.id });
    if (id !== null) setRequests((r) => ({ ...r, [d.id]: id }));
  };
  const remove = async (d: DocumentRec): Promise<void> => {
    if (!(await confirm(`Delete "${d.title}"? The file is removed permanently.`, 'Delete document'))) return;
    try {
      await deleteRecord('documents', d.id);
      toast.success('Deleted');
    } catch {
      /* toast shown by the client */
    }
  };

  return (
    <Section
      title={title}
      meta={docs.records.length ? String(docs.records.length) : undefined}
      flush
      actions={
        can.contribute ? (
          <Button size="sm" variant="outline" onClick={() => setUpload(true)}>
            <Upload size={13} aria-hidden /> Upload
          </Button>
        ) : undefined
      }
    >
      {confirmEl}
      {docs.records.length === 0 ? (
        <EmptyHint
          compact
          icon={FileText}
          title="No documents yet"
          message={docketing ? 'Upload an office action or letter and CraftBot can read it and propose the docket entries.' : 'Upload certificates, correspondence and evidence to keep them with the record.'}
          action={
            can.contribute ? (
              <Button size="sm" onClick={() => setUpload(true)}>
                Upload a document
              </Button>
            ) : undefined
          }
        />
      ) : (
        docs.records.map((d) => (
          <div key={d.id} className="border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
            <div className="flex items-center gap-3">
              <FileText size={16} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <a className="block truncate text-sm font-medium hover:underline" href={fileUrl(d, d.file)} target="_blank" rel="noreferrer">
                  {d.title}
                </a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                  {d.doc_type !== '' && <Tag>{DOC_TYPE_LABEL[d.doc_type]}</Tag>}
                  {d.doc_date && <span>{fmtDate(d.doc_date)}</span>}
                  {d.uploaded_by && <span>by {userName(d.uploaded_by)}</span>}
                  {d.source === 'agent' && <Tag>From CraftBot</Tag>}
                </div>
                {d.summary !== '' && <p className="mt-1 line-clamp-2 text-xs text-[var(--agent-app-text)]/80">{d.summary}</p>}
              </div>
              <div className="flex shrink-0 items-center gap-1">
                {docketing && can.contribute && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void docket(d)} title="CraftBot reads the document and proposes docket entries for review">
                    <Bot size={13} aria-hidden /> Docket this
                  </Button>
                )}
                {extraction && can.contribute && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void extract(d)} title="CraftBot reads the contract and proposes the agreement terms for review">
                    <Bot size={13} aria-hidden /> Extract terms
                  </Button>
                )}
                <a className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" href={fileUrl(d, d.file)} target="_blank" rel="noreferrer" aria-label="Open">
                  <ExternalLink size={14} />
                </a>
                {can.manage && (
                  <button type="button" className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-red-600" aria-label="Delete" onClick={() => void remove(d)}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
            {requests[d.id] !== undefined && (
              <div className="mt-2">
                <AgentStatus
                  requestId={requests[d.id] ?? null}
                  workingText="CraftBot is reading the document..."
                  doneText="CraftBot filed a proposal in the Inbox."
                />
                <a href={href('inbox')} className="mt-1 inline-block text-xs text-[var(--agent-app-accent)] hover:underline">
                  Open the Inbox →
                </a>
              </div>
            )}
          </div>
        ))
      )}
      {upload && <UploadDialog relation={relation} relationId={relationId} defaultType={defaultType} onClose={() => setUpload(false)} />}
    </Section>
  );
}
