/**
 * Documents attached to a record: upload (drag and drop), type and date,
 * preview, and the CraftBot hand-offs: "Docket this" (an office letter or
 * platform notice), "Read the contract" and "Read the statement". Results
 * arrive in the Inbox for a person to review; nothing changes on its own.
 */
import { useRef, useState } from 'react';
import { Bot, ExternalLink, FileText, Trash2, Upload } from 'lucide-react';
import { Button, Dialog, Input, Select, cn, toast } from '../../kit/index.ts';
import { DeleteButton } from './deleteRecord.tsx';
import { useCollection } from '../lib/live.ts';
import { createRecord, fileUrl } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { fmtDate, today } from '../lib/format.ts';
import { enumLabel, enumOptions, t } from '../lib/i18n.ts';
import { href } from '../lib/router.ts';
import type { DocumentRec } from '../lib/records.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { EmptyHint, Field, Section, Tag } from './ui.tsx';

/** Relation fields on documents (see the schema). */
export type DocRelation =
  | 'matter'
  | 'family'
  | 'agreement'
  | 'work'
  | 'franchise'
  | 'character'
  | 'talent'
  | 'product'
  | 'approval'
  | 'committee'
  | 'song'
  | 'recording'
  | 'permission'
  | 'guideline'
  | 'case_ref';

/** The event subject type a relation means (for docketing). */
const SUBJECT_OF: Partial<Record<DocRelation, string>> = {
  matter: 'matter',
  agreement: 'agreement',
  work: 'work',
  character: 'character',
  talent: 'talent',
  product: 'product',
  approval: 'approval',
  committee: 'committee',
  permission: 'permission',
  case_ref: 'case',
};

export function UploadDialog({
  relation,
  relationId,
  defaultType = 'other',
  onClose,
  onUploaded,
}: {
  relation: DocRelation;
  relationId: string;
  defaultType?: string | undefined;
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
      toast.error(t('Choose a file first.'));
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
      toast.success(t('Uploaded'));
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
      title={t('Upload a document')}
      className="w-[min(94vw,32rem)]"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t('Cancel')}
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={file === null}>
            {t('Upload')}
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
          className={cn('flex flex-col items-center gap-1.5 border border-dashed px-4 py-6 text-center text-[13px]', drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]')}
        >
          <Upload size={18} className="text-[var(--agent-app-muted)]" aria-hidden />
          {file !== null ? <span className="break-all font-medium">{file.name}</span> : <span>{t('Drop a file here or click to choose (PDF, image, Word, spreadsheet)')}</span>}
          <input ref={input} type="file" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
        </div>
        <Input label={t('Title')} value={title} onChange={(e) => setTitle(e.target.value)} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label={t('Type')} value={type} options={enumOptions('documents.doc_type').map(([value, label]) => ({ value, label }))} onChange={(e) => setType(e.target.value)} />
          <Field label={t('Document date')}>
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
  title,
  defaultType,
  docketing = false,
  extraction = false,
  statementFor,
}: {
  relation: DocRelation;
  relationId: string;
  title?: string | undefined;
  defaultType?: string | undefined;
  /** Offer "Docket this": CraftBot proposes the event and deadlines. */
  docketing?: boolean | undefined;
  /** Offer "Read the contract": CraftBot proposes the agreement and grants. */
  extraction?: boolean | undefined;
  /** Agreement id: offer "Read the statement" for a licensee's sales report. */
  statementFor?: string | undefined;
}): React.JSX.Element {
  const { can, userName } = useApp();
  const docs = useCollection<DocumentRec>('documents', { filter: `${relation} = "${relationId}"`, sort: '-doc_date,-created' });
  const [upload, setUpload] = useState(false);
  const [requests, setRequests] = useState<Record<string, string>>({});

  const hand = async (d: DocumentRec, trigger: string, params: Record<string, unknown>): Promise<void> => {
    const id = await handToCraftBot(trigger, { document_id: d.id, ...params });
    if (id !== null) setRequests((r) => ({ ...r, [d.id]: id }));
  };
  const subjectType = SUBJECT_OF[relation];

  return (
    <Section
      title={title ?? t('Documents')}
      meta={docs.records.length ? String(docs.records.length) : undefined}
      flush
      actions={
        can.contribute ? (
          <Button size="sm" variant="outline" onClick={() => setUpload(true)}>
            <Upload size={13} aria-hidden /> {t('Upload')}
          </Button>
        ) : undefined
      }
    >
      {docs.records.length === 0 ? (
        <EmptyHint
          compact
          icon={FileText}
          title={t('No documents yet')}
          message={
            docketing
              ? t('Upload an office letter or platform notice and CraftBot can read it and propose the dates for review.')
              : extraction
                ? t('Upload the signed contract and CraftBot can read it and propose the terms for review.')
                : t('Upload contracts, certificates, style guides and evidence to keep them with the record.')
          }
          action={
            can.contribute ? (
              <Button size="sm" onClick={() => setUpload(true)}>
                {t('Upload a document')}
              </Button>
            ) : undefined
          }
        />
      ) : (
        docs.records.map((d) => (
          <div key={d.id} className="border-b border-[var(--agent-app-border)]/70 px-4 py-2.5 last:border-0">
            <div className="flex flex-wrap items-center gap-3 sm:flex-nowrap">
              <FileText size={16} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
              <div className="min-w-0 flex-1">
                <a className="block truncate text-sm font-medium hover:underline" href={fileUrl(d, d.file)} target="_blank" rel="noreferrer">
                  {d.title}
                </a>
                <div className="flex flex-wrap items-center gap-2 text-xs text-[var(--agent-app-muted)]">
                  {d.doc_type !== '' && <Tag>{enumLabel('documents.doc_type', d.doc_type)}</Tag>}
                  {d.doc_date && <span>{fmtDate(d.doc_date)}</span>}
                  {d.uploaded_by && <span>{t('by {name}', { name: userName(d.uploaded_by) })}</span>}
                  {d.source === 'agent' && <Tag>{t('From CraftBot')}</Tag>}
                  {d.source === 'portal' && <Tag>{t('From the portal')}</Tag>}
                </div>
                {d.summary !== '' && <p className="mt-1 line-clamp-2 text-xs text-[var(--agent-app-text)]/80">{d.summary}</p>}
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1">
                {docketing && can.contribute && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => void hand(d, 'document_docketing_requested', subjectType ? { subject_type: subjectType, subject_id: relationId } : {})}
                    title={t('CraftBot reads the document and proposes the event and deadlines for review')}
                  >
                    <Bot size={13} aria-hidden /> {t('Docket this')}
                  </Button>
                )}
                {extraction && can.contribute && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void hand(d, 'agreement_extraction_requested', {})} title={t('CraftBot reads the contract and proposes the terms for review')}>
                    <Bot size={13} aria-hidden /> {t('Read the contract')}
                  </Button>
                )}
                {statementFor !== undefined && can.contribute && (
                  <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => void hand(d, 'royalty_statement_requested', { agreement_id: statementFor })} title={t('CraftBot reads the sales report and proposes the statement lines for review')}>
                    <Bot size={13} aria-hidden /> {t('Read the statement')}
                  </Button>
                )}
                <a className="flex size-7 items-center justify-center text-[var(--agent-app-muted)] hover:text-[var(--agent-app-text)]" href={fileUrl(d, d.file)} target="_blank" rel="noreferrer" aria-label={t('Open|action')}>
                  <ExternalLink size={14} />
                </a>
                <DeleteButton collection="documents" id={d.id} iconOnly />
              </div>
            </div>
            {requests[d.id] !== undefined && (
              <div className="mt-2">
                <AgentStatus requestId={requests[d.id] ?? null} workingText={t('CraftBot is reading the document...')} doneText={t('CraftBot filed a proposal in the Inbox.')} />
                <a href={href('inbox')} className="mt-1 inline-block text-xs text-[var(--agent-app-accent)] hover:underline">
                  {t('Open the Inbox')}
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
