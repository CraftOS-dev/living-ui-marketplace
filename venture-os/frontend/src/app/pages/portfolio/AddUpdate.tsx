/**
 * Add update: drop the founder's file (PDF, deck, spreadsheet) or paste the
 * email text. It becomes an update; your AI agent reads it and stages the
 * numbers for one-click verification.
 */
import { useState } from 'react';
import { Button, Dialog, FileDrop, Textarea } from '../../components/ui.tsx';
import { opForm } from '../../lib/api.ts';
import { act } from '../../lib/live.ts';
import { setQuery } from '../../lib/router.ts';
import { UPDATE_READS } from './Updates.tsx';

/** Store files and or text as an update of a company; answers the update id (null when it failed). */
export async function addUpdate(company: string, files: File[], text: string): Promise<string | null> {
  const out = await act([], () => opForm<{ update: { id: string } }>('updates.add', text !== '' ? { company, text } : { company }, { file: files }), UPDATE_READS);
  return out === null ? null : out.update.id;
}

export function AddUpdate({ company, open, onClose }: { company: string; open: boolean; onClose: () => void }): React.JSX.Element | null {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  const close = (): void => {
    setFiles([]);
    setText('');
    onClose();
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    const id = await addUpdate(company, files, text.trim());
    setBusy(false);
    if (id !== null) {
      close();
      setQuery({ tab: 'updates', update: id });
    }
  };
  return (
    <Dialog
      open={open}
      onClose={close}
      title="Add update"
      footer={
        <>
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="primary" busy={busy} disabled={files.length === 0 && text.trim() === ''} onClick={() => void save()}>
            Add
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <FileDrop label="Drop the update" multiple onFiles={(f) => setFiles([...files, ...f])} accept=".pdf,.pptx,.ppt,.docx,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg">
          {files.length > 0 ? (
            <ul className="flex flex-col gap-1 text-[13px]">
              {files.map((f) => (
                <li key={f.name} className="vo-wrap">
                  {f.name}
                </li>
              ))}
            </ul>
          ) : undefined}
        </FileDrop>
        <Textarea value={text} minRows={4} onChange={(e) => setText(e.target.value)} placeholder="Or paste the email" aria-label="Update text" />
      </div>
    </Dialog>
  );
}
