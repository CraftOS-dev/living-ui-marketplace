/**
 * The deal room: the deal's files in folders (kernel files.* ops), a drop
 * zone that stores into the chosen folder (NDA toggle beside it), versions
 * by name (a same-named file becomes the next version), and per file:
 * open, download, new version, versions, delete (Undo).
 */
import { useMemo, useRef, useState } from 'react';
import { Download, ExternalLink, FileText, FolderClosed, History, Lock, Trash2, Upload } from 'lucide-react';
import { cn } from '../../../kit/index.ts';
import { Button, Empty, FileDrop, LoadError, Menu, MenuItem, MenuSep, Segmented, Sheet, SheetHeader, Skeleton, StatusDot, Tag, Toggle, confirmAsk } from '../ui.tsx';
import { download, op, opForm } from '../../lib/api.ts';
import { ago, fmtDateTime } from '../../lib/format.ts';
import { act, drop, useOp } from '../../lib/live.ts';
import { toast } from '../../lib/toast.ts';
import type { FileRow } from './types.ts';

const READS = ['files', 'file_texts', 'pages'];

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

interface Version {
  id: string;
  version: number;
  bytes: number;
  current: boolean;
  created: string;
  uploaded_as: string;
}

function VersionsSheet({ file, onClose }: { file: FileRow; onClose: () => void }): React.JSX.Element {
  const live = useOp<{ file: FileRow; versions: Version[] }>('files.get', { file: file.id }, READS, { name: 'files.get' });
  return (
    <Sheet open onClose={onClose} label={file.name} width={460}>
      <SheetHeader title={file.name} onClose={onClose} />
      <div className="vo-scroll flex-1 overflow-y-auto p-5">
        {live.data === null ? (
          <Skeleton className="h-32 w-full" />
        ) : (
          <ul className="vo-panel flex flex-col">
            {live.data.versions.map((v) => (
              <li key={v.id} className="flex h-10 items-center gap-3 border-b border-[var(--vo-hair)] px-3 last:border-b-0">
                <span className="vo-mono vo-num w-8 text-[12px]">v{v.version}</span>
                <span className="vo-mono vo-num min-w-0 flex-1 truncate text-[12px] text-[var(--vo-ink-2)]">{fmtDateTime(v.created)}</span>
                <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">{size(v.bytes)}</span>
                <Button size="sm" variant="ghost" icon={ExternalLink} onClick={() => void download('files.download', { file: v.id }, 'open', file.name)}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

function FileLine({ f, onVersions }: { f: FileRow; onVersions: (f: FileRow) => void }): React.JSX.Element {
  const input = useRef<HTMLInputElement | null>(null);
  const reading = f.text_state === 'waiting' || f.text_state === 'extracting';
  const remove = async (): Promise<void> => {
    if (!(await confirmAsk(`Delete ${f.name}?`, 'Delete'))) return;
    const out = await act([drop(f.id)], () => op<{ _activity?: string | undefined }>('files.delete', { file: f.id }), READS);
    const entry = out?._activity ?? '';
    if (entry !== '') toast.undo('Deleted', () => void act([], () => op('activity.undo', { entry }), READS));
  };
  const version = async (files: FileList | null): Promise<void> => {
    const file = files?.[0];
    if (file === undefined) return;
    await act([], () => opForm('files.version', { file: f.id }, { file }), READS);
  };
  return (
    <li className="group flex h-9 min-w-0 items-center gap-3 border-b border-[var(--vo-hair)] px-3 transition-colors duration-150 last:border-b-0 hover:bg-[var(--vo-hover)]">
      <FileText size={15} aria-hidden className="shrink-0 text-[var(--vo-muted)]" />
      <button type="button" onClick={() => void download('files.download', { file: f.id }, 'open', f.name)} className="vo-focus min-w-0 flex-1 truncate text-left text-[13px] hover:underline">
        {f.name}
      </button>
      {f.version > 1 && <span className="vo-mono vo-num text-[12px] text-[var(--vo-muted)]">v{f.version}</span>}
      {f.nda && (
        <Tag icon={Lock} tone="warn" title="Under NDA: the deal team only">
          NDA
        </Tag>
      )}
      {reading && <StatusDot tone="faint" pulse label="Reading" />}
      {f.text_state === 'needs_ocr' && <StatusDot tone="warn" label="Scan" />}
      <span className="vo-mono vo-num w-16 shrink-0 text-right text-[12px] text-[var(--vo-muted)] max-sm:hidden">{size(f.bytes)}</span>
      <span className="vo-mono vo-num w-20 shrink-0 text-right text-[12px] text-[var(--vo-muted)] max-sm:hidden">{ago(f.created)}</span>
      <Menu label="File actions" onRow width={200}>
        {(close) => (
          <>
            <MenuItem
              icon={Download}
              onClick={() => {
                close();
                void download('files.download', { file: f.id, download: true }, 'save', f.name);
              }}
            >
              Download
            </MenuItem>
            <MenuItem
              icon={Upload}
              onClick={() => {
                close();
                input.current?.click();
              }}
            >
              New version
            </MenuItem>
            <MenuItem
              icon={History}
              onClick={() => {
                close();
                onVersions(f);
              }}
            >
              Versions
            </MenuItem>
            <MenuSep />
            <MenuItem
              icon={Trash2}
              danger
              onClick={() => {
                close();
                void remove();
              }}
            >
              Delete
            </MenuItem>
          </>
        )}
      </Menu>
      <input ref={input} type="file" className="hidden" onChange={(e) => void version(e.target.files)} />
    </li>
  );
}

export function FilesTab({ dealId, canWrite }: { dealId: string; canWrite: boolean }): React.JSX.Element {
  const live = useOp<{ files: FileRow[]; folders: { folder: string; files: number }[]; total: number; hidden: number }>('files.list', { deal: dealId, limit: 500 }, READS, { name: 'files.list' });
  const [folder, setFolder] = useState('');
  const [nda, setNda] = useState(false);
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<FileRow | null>(null);
  const files = live.data?.files ?? [];
  const folders = useMemo(() => (live.data?.folders ?? []).map((f) => f.folder).filter((f) => f !== ''), [live.data]);
  const shown = folder === '' ? files : files.filter((f) => f.folder === folder);
  const groups = useMemo(() => {
    const m = new Map<string, FileRow[]>();
    for (const f of shown) m.set(f.folder, [...(m.get(f.folder) ?? []), f]);
    return [...m.entries()].sort((a, b) => (a[0] === '' ? -1 : b[0] === '' ? 1 : a[0] < b[0] ? -1 : 1));
  }, [shown]);
  const upload = async (list: File[]): Promise<void> => {
    if (list.length === 0) return;
    setBusy(true);
    await act([], () => opForm('files.upload', { deal: dealId, folder: folder || undefined, nda: nda || undefined }, { file: list }), READS);
    setBusy(false);
  };
  return (
    <div className="flex min-w-0 flex-col gap-4">
      {live.error !== null && live.data === null ? (
        <LoadError message={live.error} onRetry={live.reload} />
      ) : live.data === null ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <>
          {canWrite && (
            <FileDrop label={busy ? 'Adding' : 'Add files'} multiple onFiles={(l) => void upload(l)} className={files.length === 0 ? 'py-10' : 'py-4'}>
              {files.length === 0 && <FolderClosed size={20} aria-hidden className="text-[var(--vo-muted)]" />}
              <span className="inline-flex items-center gap-2 text-[12px] text-[var(--vo-ink-2)]">
                <Lock size={12} aria-hidden />
                NDA
                <Toggle label="Under NDA" checked={nda} onChange={setNda} />
              </span>
            </FileDrop>
          )}
          {folders.length > 0 && (
            <Segmented label="Folder" size="sm" value={folder} onChange={setFolder} options={[{ value: '', label: 'All' }, ...folders.map((f) => ({ value: f, label: f, icon: FolderClosed }))]} />
          )}
          {files.length === 0 ? (
            canWrite ? null : <Empty icon={FolderClosed} title="No files yet" />
          ) : (
            <div className="flex min-w-0 flex-col gap-4">
              {groups.map(([name, rows]) => (
                <section key={name} className="min-w-0">
                  {folder === '' && name !== '' && <h3 className="vo-label mb-1.5 flex items-center gap-1.5">{name}</h3>}
                  <ul className={cn('vo-panel vo-in flex flex-col overflow-hidden')}>
                    {rows.map((f) => (
                      <FileLine key={f.id} f={f} onVersions={setVersions} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
          {live.data.hidden > 0 && (
            <Tag icon={Lock} tone="faint" title="Files under NDA or on a restricted deal">
              {live.data.hidden}
            </Tag>
          )}
        </>
      )}
      {versions !== null && <VersionsSheet file={versions} onClose={() => setVersions(null)} />}
    </div>
  );
}
