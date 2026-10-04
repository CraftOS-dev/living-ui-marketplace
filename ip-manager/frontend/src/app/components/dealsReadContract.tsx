/**
 * "Read a contract with CraftBot": upload the signed contract, hand it to
 * CraftBot, and follow the request. CraftBot files the proposed agreement
 * (terms, rights scope, obligations) in the Inbox; nothing is created until
 * a person accepts it there.
 */
import { useRef, useState } from 'react';
import { Bot, FileText, Upload } from 'lucide-react';
import { Button, Dialog, cn, toast } from '../../kit/index.ts';
import { createRecord } from '../lib/api.ts';
import { useApp } from '../lib/context.tsx';
import { toPb, today } from '../lib/format.ts';
import { href } from '../lib/router.ts';
import type { DocumentRec } from '../lib/types.ts';
import { AgentStatus, handToCraftBot } from './craftbot.tsx';
import { Notice } from './ui.tsx';

export function ReadContractDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { me } = useApp();
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [docTitle, setDocTitle] = useState('');
  const input = useRef<HTMLInputElement | null>(null);

  const pick = (f: File | null | undefined): void => {
    if (f) setFile(f);
  };

  const submit = async (): Promise<void> => {
    if (file === null) {
      toast.error('Choose the contract file first.');
      return;
    }
    setBusy(true);
    try {
      const title = file.name.replace(/\.[^.]+$/, '') || file.name;
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title);
      fd.append('doc_type', 'agreement');
      fd.append('doc_date', toPb(today()));
      fd.append('source', 'upload');
      if (me !== null) fd.append('uploaded_by', me.id);
      const doc = await createRecord<DocumentRec>('documents', fd);
      setDocTitle(doc.title);
      const id = await handToCraftBot('agreement_extraction_requested', { document_id: doc.id });
      if (id !== null) setRequestId(id);
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
      title="Read a contract with CraftBot"
      description="Upload the contract. CraftBot reads it and proposes the agreement terms, rights scope and obligations for you to review."
      className="w-[min(94vw,34rem)]"
      footer={
        requestId === null ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} loading={busy} disabled={file === null}>
              <Bot size={14} aria-hidden /> Upload and read
            </Button>
          </>
        ) : (
          <Button onClick={onClose}>Close</Button>
        )
      }
    >
      {requestId === null ? (
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
              'flex flex-col items-center gap-1.5 border border-dashed px-4 py-8 text-center text-[13px]',
              drag ? 'border-[var(--agent-app-accent)] bg-[var(--agent-app-accent)]/5' : 'border-[var(--agent-app-border)]',
            )}
          >
            {file !== null ? (
              <>
                <FileText size={18} className="text-[var(--agent-app-muted)]" aria-hidden />
                <span className="font-medium">{file.name}</span>
                <span className="text-xs text-[var(--agent-app-muted)]">Click to choose a different file</span>
              </>
            ) : (
              <>
                <Upload size={18} className="text-[var(--agent-app-muted)]" aria-hidden />
                <span>Drop the contract here or click to choose (PDF or Word, up to 50 MB)</span>
              </>
            )}
            <input
              ref={input}
              type="file"
              className="hidden"
              accept=".pdf,.doc,.docx,.txt,.rtf,image/*"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          <p className="text-xs leading-relaxed text-[var(--agent-app-muted)]">
            The file is saved as an agreement document. CraftBot never creates the agreement itself: it files a proposal in the Inbox, citing the page and wording behind each term.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex items-center gap-2 text-[13px]">
            <FileText size={15} className="shrink-0 text-[var(--agent-app-muted)]" aria-hidden />
            <span className="truncate font-medium">{docTitle}</span>
            <span className="text-xs text-[var(--agent-app-muted)]">uploaded</span>
          </div>
          <AgentStatus requestId={requestId} workingText="CraftBot is reading the contract..." doneText="CraftBot filed the proposed agreement in the Inbox." />
          <Notice>
            The proposed agreement will appear in the Inbox for review.{' '}
            <a href={href('inbox')} className="font-medium text-[var(--agent-app-accent)] hover:underline" onClick={onClose}>
              Open the Inbox
            </a>
          </Notice>
        </div>
      )}
    </Dialog>
  );
}
