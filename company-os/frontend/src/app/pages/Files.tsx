/**
 * Files: a local, Google-Drive-style repository. Folders nest (breadcrumb
 * navigation), files upload into the current folder, and the whole thing can be
 * shown four ways — card, small card, list, and tree. Files can be DRAGGED onto
 * a folder (or a breadcrumb ancestor) to move them. A one-line summary above the
 * search reports the file count and storage used. Opening a file PREVIEWS it in
 * a full page (not a modal): back button + metadata across the top, file inline.
 */
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  FileText,
  Film,
  Folder as FolderIcon,
  FolderArchive,
  FolderPlus,
  Grid3x3,
  Home,
  Image as ImageIcon,
  LayoutGrid,
  List as ListIcon,
  ListTree,
  Music,
  Upload,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import {
  Button,
  Dialog,
  Input,
  SearchInput,
  Spinner,
  getPbClient,
  toast,
  useCollection,
  useConfirm,
  cn,
} from '../../kit/index.ts';
import type { FileDoc, Folder } from '../lib/types.ts';
import { AgoDate, DeleteButton, GhostState, PageHeader } from '../components/ui.tsx';

/* ------------------------------------------------------------------ */
/* File-kind detection + formatting                                    */
/* ------------------------------------------------------------------ */

type Kind = 'image' | 'pdf' | 'video' | 'audio' | 'text' | 'other';

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'ico'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'ogv', 'm4v'];
const AUDIO_EXT = ['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac'];
const TEXT_EXT = [
  'txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'js', 'jsx', 'ts', 'tsx', 'html', 'htm',
  'css', 'scss', 'xml', 'yml', 'yaml', 'log', 'sh', 'bash', 'py', 'rb', 'go', 'rs', 'java', 'sql', 'ini', 'toml', 'env',
];

const extOf = (f: FileDoc): string => (f.file.split('.').pop() ?? '').toLowerCase();

function kindOf(f: FileDoc): Kind {
  const mime = f.mime ?? '';
  const ext = extOf(f);
  if (mime.startsWith('image/') || IMAGE_EXT.includes(ext)) return 'image';
  if (mime === 'application/pdf' || ext === 'pdf') return 'pdf';
  if (mime.startsWith('video/') || VIDEO_EXT.includes(ext)) return 'video';
  if (mime.startsWith('audio/') || AUDIO_EXT.includes(ext)) return 'audio';
  if (mime.startsWith('text/') || mime === 'application/json' || TEXT_EXT.includes(ext)) return 'text';
  return 'other';
}

const KIND_ICON: Record<Kind, LucideIcon> = {
  image: ImageIcon,
  pdf: FileText,
  video: Film,
  audio: Music,
  text: FileText,
  other: FileIcon,
};
const KIND_LABEL: Record<Kind, string> = {
  image: 'Image',
  pdf: 'PDF',
  video: 'Video',
  audio: 'Audio',
  text: 'Text',
  other: 'File',
};

function fmtSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(i > 0 && n < 10 ? 1 : 0)} ${units[i]}`;
}

const fileUrl = (f: FileDoc): string => getPbClient().pb.files.getURL(f, f.file);

/* ------------------------------------------------------------------ */
/* View modes + drag-and-drop plumbing                                 */
/* ------------------------------------------------------------------ */

type View = 'card' | 'small' | 'list' | 'tree';
const VIEWS: Array<{ key: View; label: string; icon: LucideIcon }> = [
  { key: 'card', label: 'Card view', icon: LayoutGrid },
  { key: 'small', label: 'Small card view', icon: Grid3x3 },
  { key: 'list', label: 'List view', icon: ListIcon },
  { key: 'tree', label: 'Tree view', icon: ListTree },
];
const VIEW_KEY = 'cos-files-view';

/** Shared drag-and-drop handlers: a file is dragged, a folder id ('' = root) is a target. */
interface Dnd {
  dragFileId: string | null;
  dropTarget: string | null;
  start: (e: React.DragEvent, fileId: string) => void;
  end: () => void;
  over: (e: React.DragEvent, folderId: string) => void;
  leave: (folderId: string) => void;
  drop: (e: React.DragEvent, folderId: string) => void;
}

/* ================================================================== */
/* Page                                                                */
/* ================================================================== */

export function FilesPage(): React.JSX.Element {
  const { records: files, loading } = useCollection<FileDoc>('files', { sort: '-created' });
  const { records: folders } = useCollection<Folder>('folders', { sort: 'name' });
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [currentFolder, setCurrentFolder] = useState<string | null>(null);
  const [view, setView] = useState<View>(() => {
    const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(VIEW_KEY) : null;
    return saved === 'card' || saved === 'small' || saved === 'list' || saved === 'tree' ? saved : 'card';
  });
  const [query, setQuery] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [dragFileId, setDragFileId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [confirmEl, confirm] = useConfirm();

  const pb = getPbClient();
  const previewing = previewId !== null ? (files.find((f) => f.id === previewId) ?? null) : null;

  const setViewMode = (v: View): void => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };

  /* ---------- Hierarchy helpers ---------- */
  const parentOf = (f: Folder): string => f.parent ?? '';
  const folderOf = (f: FileDoc): string => f.folder ?? '';
  const childFolders = (parentId: string): Folder[] => folders.filter((f) => parentOf(f) === parentId);
  const childFiles = (parentId: string): FileDoc[] => files.filter((f) => folderOf(f) === parentId);
  const itemsIn = (folderId: string): number => childFolders(folderId).length + childFiles(folderId).length;

  const breadcrumb: Folder[] = [];
  {
    let cur = currentFolder;
    const guard = new Set<string>();
    while (cur !== null && cur !== '' && !guard.has(cur)) {
      guard.add(cur);
      const f = folders.find((x) => x.id === cur);
      if (f === undefined) break;
      breadcrumb.unshift(f);
      cur = parentOf(f) === '' ? null : parentOf(f);
    }
  }

  const descendantFolderIds = (rootId: string): string[] => {
    const out: string[] = [];
    const walk = (pid: string): void => {
      for (const f of folders) {
        if (parentOf(f) === pid) {
          out.push(f.id);
          walk(f.id);
        }
      }
    };
    walk(rootId);
    return out;
  };

  /* ---------- Mutations ---------- */
  const uploadMany = async (list: FileList | File[] | null | undefined): Promise<void> => {
    const arr = list ? Array.from(list) : [];
    if (arr.length === 0) return;
    setUploading(true);
    let ok = 0;
    for (const file of arr) {
      const form = new FormData();
      form.append('file', file);
      form.append('title', file.name);
      form.append('size', String(file.size));
      form.append('mime', file.type || '');
      if (currentFolder !== null) form.append('folder', currentFolder);
      try {
        await pb.call((p) => p.collection('files').create(form));
        ok += 1;
      } catch {
        toast.error(`Could not upload ${file.name}`);
      }
    }
    setUploading(false);
    if (ok > 0) toast.success(`${ok} file${ok === 1 ? '' : 's'} uploaded`);
  };

  const createFolder = async (): Promise<void> => {
    const name = newFolderName.trim();
    if (name === '') return;
    const data: Record<string, unknown> = { name };
    if (currentFolder !== null) data.parent = currentFolder;
    try {
      await pb.call((p) => p.collection('folders').create(data));
      toast.success(`Folder "${name}" created`);
    } catch {
      toast.error('Could not create folder');
    }
    setNewFolderName('');
    setNewFolderOpen(false);
  };

  const moveFile = async (fileId: string, folderId: string): Promise<void> => {
    const f = files.find((x) => x.id === fileId);
    if (f === undefined || folderOf(f) === folderId) return;
    try {
      await pb.call((p) => p.collection('files').update(fileId, { folder: folderId }));
      const dest = folderId === '' ? 'Files' : (folders.find((x) => x.id === folderId)?.name ?? 'folder');
      toast.success(`Moved to ${dest}`);
    } catch {
      toast.error('Could not move the file');
    }
  };

  const removeFile = async (f: FileDoc): Promise<void> => {
    if (!(await confirm(`Delete "${f.title}"? This removes the file for good.`))) return;
    if (previewId === f.id) setPreviewId(null);
    await pb.call((p) => p.collection('files').delete(f.id)).catch(() => undefined);
  };

  const removeFolder = async (folder: Folder): Promise<void> => {
    const subtree = descendantFolderIds(folder.id);
    const all = [folder.id, ...subtree];
    const fileIds = files.filter((f) => all.includes(folderOf(f))).map((f) => f.id);
    const n = fileIds.length;
    const extra = n > 0 ? ` and its ${n} file${n === 1 ? '' : 's'}` : '';
    if (!(await confirm(`Delete folder "${folder.name}"${extra}? This can’t be undone.`))) return;
    if (currentFolder !== null && all.includes(currentFolder)) setCurrentFolder(parentOf(folder) === '' ? null : parentOf(folder));
    for (const id of fileIds) await pb.call((p) => p.collection('files').delete(id)).catch(() => undefined);
    for (const id of [...subtree].reverse()) await pb.call((p) => p.collection('folders').delete(id)).catch(() => undefined);
    await pb.call((p) => p.collection('folders').delete(folder.id)).catch(() => undefined);
  };

  const openFolder = (id: string): void => {
    setQuery('');
    setCurrentFolder(id);
  };

  /* ---------- Drag-and-drop bundle (move files between folders) ---------- */
  const dnd: Dnd = {
    dragFileId,
    dropTarget,
    start: (e, fileId) => {
      setDragFileId(fileId);
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', fileId);
    },
    end: () => {
      setDragFileId(null);
      setDropTarget(null);
    },
    over: (e, folderId) => {
      if (dragFileId === null) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      if (dropTarget !== folderId) setDropTarget(folderId);
    },
    leave: (folderId) => {
      if (dropTarget === folderId) setDropTarget(null);
    },
    drop: (e, folderId) => {
      e.preventDefault();
      e.stopPropagation();
      const id = e.dataTransfer.getData('text/plain') || dragFileId;
      setDragFileId(null);
      setDropTarget(null);
      if (id !== null && id !== '') void moveFile(id, folderId);
    },
  };

  /* -------------------- Preview (full page, not a modal) -------------------- */
  if (previewing !== null) {
    return (
      <div>
        <div className="mb-4 flex items-center justify-between gap-3">
          <Button variant="ghost" size="sm" onClick={() => setPreviewId(null)}>
            <ArrowLeft size={15} aria-hidden />
            Back to files
          </Button>
          <div className="flex items-center gap-1.5">
            <a href={fileUrl(previewing)} download={previewing.title}>
              <Button size="sm" variant="secondary">
                <Download size={14} aria-hidden />
                Download
              </Button>
            </a>
            <DeleteButton onClick={() => void removeFile(previewing)} />
          </div>
        </div>
        <FileMeta f={previewing} />
        <div className="mt-3 border border-[var(--lui-border)] bg-[var(--lui-surface)]">
          <FilePreview f={previewing} />
        </div>
        {confirmEl}
      </div>
    );
  }

  /* -------------------------------- Repository ---------------------------------- */
  const q = query.trim().toLowerCase();
  const searching = q !== '';
  const totalSize = files.reduce((s, f) => s + (f.size || 0), 0);

  const shownFolders = searching
    ? folders.filter((f) => f.name.toLowerCase().includes(q))
    : childFolders(currentFolder ?? '');
  const shownFiles = searching
    ? files.filter((f) => f.title.toLowerCase().includes(q))
    : childFiles(currentFolder ?? '');
  const isEmptyHere = shownFolders.length === 0 && shownFiles.length === 0;

  const uploadButton = (
    <Button size="sm" onClick={() => inputRef.current?.click()} loading={uploading}>
      <Upload size={14} aria-hidden />
      Upload
    </Button>
  );
  const newFolderButton = (
    <Button size="sm" variant="secondary" onClick={() => setNewFolderOpen(true)}>
      <FolderPlus size={14} aria-hidden />
      New folder
    </Button>
  );

  return (
    <div
      onDragOver={(e) => {
        if (dragFileId !== null) return; // internal move, not an upload
        e.preventDefault();
        if (!dragOver) setDragOver(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragOver(false);
      }}
      onDrop={(e) => {
        if (dragFileId !== null) return;
        e.preventDefault();
        setDragOver(false);
        void uploadMany(e.dataTransfer.files);
      }}
    >
      <PageHeader
        icon={FolderArchive}
        title="Files"
        subtitle="Your local file repository. Make folders, drag files to move them, switch how they’re shown, and open a file to preview it."
        actions={
          <>
            {newFolderButton}
            {uploadButton}
          </>
        }
      />

      {/* Metadata line — above the search */}
      <p className="mb-3 text-[13px] text-[var(--lui-muted)]">
        <span className="font-medium tabular-nums text-[var(--lui-text)]">{files.length}</span> file
        {files.length === 1 ? '' : 's'}
        {' · '}
        <span className="font-medium tabular-nums text-[var(--lui-text)]">{totalSize > 0 ? fmtSize(totalSize) : '0 B'}</span>{' '}
        used
      </p>

      <div className="mb-3">
        <SearchInput onSearch={setQuery} placeholder="Search all files and folders…" />
      </div>

      {/* Toolbar: breadcrumb (left) + view switcher (right) */}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        {searching ? (
          <p className="text-[13px] text-[var(--lui-muted)]">Search results for “{query.trim()}”</p>
        ) : (
          <Breadcrumb path={breadcrumb} dnd={dnd} onRoot={() => setCurrentFolder(null)} onCrumb={(id) => setCurrentFolder(id)} />
        )}
        <ViewSwitcher view={view} onChange={setViewMode} />
      </div>

      {/* Content */}
      {loading ? (
        <p className="py-10 text-center text-sm text-[var(--lui-muted)]">
          <Spinner size={16} />
        </p>
      ) : view === 'tree' && !searching ? (
        <TreeView
          folders={folders}
          files={files}
          dnd={dnd}
          childFolders={childFolders}
          childFiles={childFiles}
          onOpenFile={(id) => setPreviewId(id)}
          onDeleteFolder={(f) => void removeFolder(f)}
          onDeleteFile={(f) => void removeFile(f)}
        />
      ) : isEmptyHere ? (
        searching ? (
          <p className="border border-dashed border-[var(--lui-border)] px-4 py-10 text-center text-[13px] text-[var(--lui-muted)]">
            Nothing matches “{query.trim()}”.
          </p>
        ) : files.length === 0 && folders.length === 0 ? (
          <GhostState
            icon={FolderArchive}
            title="No files yet"
            message="Drop files here or use Upload. Make folders to keep things tidy. Everything stays local and private to your company."
            action={uploadButton}
          >
            <div
              className={cn(
                'flex min-h-40 flex-col items-center justify-center gap-2 border border-dashed px-6 py-10 text-center transition-colors',
                dragOver ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/[0.05]' : 'border-[var(--lui-border)]',
              )}
            >
              <Upload size={20} aria-hidden className="text-[var(--lui-muted)]" />
              <p className="text-[13px] text-[var(--lui-muted)]">Drop files anywhere on this page to upload</p>
            </div>
          </GhostState>
        ) : (
          <div className="flex flex-col items-center gap-3 border border-dashed border-[var(--lui-border)] px-6 py-14 text-center">
            <FolderIcon size={22} aria-hidden className="text-[var(--lui-muted)]" />
            <p className="text-[13px] text-[var(--lui-muted)]">This folder is empty. Upload files or make a subfolder.</p>
            <div className="flex gap-2">
              {newFolderButton}
              {uploadButton}
            </div>
          </div>
        )
      ) : view === 'list' ? (
        <ListLayout
          folders={shownFolders}
          filesList={shownFiles}
          itemsIn={itemsIn}
          dnd={dnd}
          onOpenFolder={openFolder}
          onOpenFile={(id) => setPreviewId(id)}
          onDeleteFolder={(f) => void removeFolder(f)}
          onDeleteFile={(f) => void removeFile(f)}
        />
      ) : (
        <CardLayout
          small={view === 'small'}
          folders={shownFolders}
          filesList={shownFiles}
          itemsIn={itemsIn}
          dragOver={dragOver}
          dnd={dnd}
          onOpenFolder={openFolder}
          onOpenFile={(id) => setPreviewId(id)}
          onDeleteFolder={(f) => void removeFolder(f)}
          onDeleteFile={(f) => void removeFile(f)}
        />
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          void uploadMany(e.target.files);
          e.target.value = '';
        }}
      />

      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen} title="New folder">
        <div className="flex flex-col gap-3">
          <Input
            autoFocus
            label="Folder name"
            placeholder="e.g. Contracts, Brand assets"
            value={newFolderName}
            onChange={(e) => setNewFolderName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void createFolder();
            }}
          />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNewFolderOpen(false)}>
              Cancel
            </Button>
            <Button disabled={newFolderName.trim() === ''} onClick={() => void createFolder()}>
              Create folder
            </Button>
          </div>
        </div>
      </Dialog>

      {confirmEl}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Breadcrumb (also a drop target for moving files up)                 */
/* ------------------------------------------------------------------ */

function Breadcrumb({
  path,
  dnd,
  onRoot,
  onCrumb,
}: {
  path: Folder[];
  dnd: Dnd;
  onRoot: () => void;
  onCrumb: (id: string) => void;
}): React.JSX.Element {
  const dropClass = (id: string): string =>
    dnd.dragFileId !== null && dnd.dropTarget === id
      ? 'bg-[var(--lui-accent)]/15 text-[var(--lui-text)] ring-1 ring-[var(--lui-accent)]'
      : '';
  return (
    <nav className="flex flex-wrap items-center gap-1 text-[13px]" aria-label="Breadcrumb">
      <button
        type="button"
        onClick={onRoot}
        onDragOver={(e) => dnd.over(e, '')}
        onDragLeave={() => dnd.leave('')}
        onDrop={(e) => dnd.drop(e, '')}
        className={cn(
          'inline-flex items-center gap-1.5 rounded-[2px] px-1.5 py-0.5 transition-colors hover:text-[var(--lui-text)]',
          path.length === 0 ? 'font-medium text-[var(--lui-text)]' : 'text-[var(--lui-muted)]',
          dropClass(''),
        )}
      >
        <Home size={13} aria-hidden />
        Files
      </button>
      {path.map((f, i) => (
        <span key={f.id} className="flex items-center gap-1">
          <ChevronRight size={13} aria-hidden className="text-[var(--lui-muted)]/60" />
          <button
            type="button"
            onClick={() => onCrumb(f.id)}
            onDragOver={(e) => dnd.over(e, f.id)}
            onDragLeave={() => dnd.leave(f.id)}
            onDrop={(e) => dnd.drop(e, f.id)}
            className={cn(
              'max-w-[12rem] truncate rounded-[2px] px-1 py-0.5 transition-colors hover:text-[var(--lui-text)]',
              i === path.length - 1 ? 'font-medium text-[var(--lui-text)]' : 'text-[var(--lui-muted)]',
              dropClass(f.id),
            )}
          >
            {f.name}
          </button>
        </span>
      ))}
    </nav>
  );
}

function ViewSwitcher({ view, onChange }: { view: View; onChange: (v: View) => void }): React.JSX.Element {
  return (
    <div className="inline-flex items-center border border-[var(--lui-border)]" role="group" aria-label="Change layout">
      {VIEWS.map((v) => {
        const Icon = v.icon;
        const active = view === v.key;
        return (
          <button
            key={v.key}
            type="button"
            aria-label={v.label}
            aria-pressed={active}
            title={v.label}
            onClick={() => onChange(v.key)}
            className={cn(
              'flex size-8 items-center justify-center border-l border-[var(--lui-border)] transition-colors first:border-l-0',
              active
                ? 'bg-[var(--lui-accent)]/10 text-[var(--lui-accent)]'
                : 'text-[var(--lui-muted)] hover:bg-[var(--lui-border)]/30 hover:text-[var(--lui-text)]',
            )}
          >
            <Icon size={15} aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Card + small-card layout                                            */
/* ------------------------------------------------------------------ */

function CardLayout({
  small,
  folders,
  filesList,
  itemsIn,
  dragOver,
  dnd,
  onOpenFolder,
  onOpenFile,
  onDeleteFolder,
  onDeleteFile,
}: {
  small: boolean;
  folders: Folder[];
  filesList: FileDoc[];
  itemsIn: (id: string) => number;
  dragOver: boolean;
  dnd: Dnd;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDeleteFolder: (f: Folder) => void;
  onDeleteFile: (f: FileDoc) => void;
}): React.JSX.Element {
  const cols = small ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4' : 'sm:grid-cols-2 lg:grid-cols-3';
  return (
    <div
      className={cn(
        'grid gap-3 rounded-[2px] transition-colors',
        cols,
        dragOver && dnd.dragFileId === null && 'outline outline-2 outline-offset-4 outline-[var(--lui-accent)]/40',
      )}
    >
      {folders.map((folder) => (
        <FolderCard
          key={folder.id}
          folder={folder}
          count={itemsIn(folder.id)}
          small={small}
          dnd={dnd}
          onOpen={() => onOpenFolder(folder.id)}
          onDelete={() => onDeleteFolder(folder)}
        />
      ))}
      {filesList.map((f) => (
        <FileCard key={f.id} f={f} small={small} dnd={dnd} onOpen={() => onOpenFile(f.id)} onDelete={() => onDeleteFile(f)} />
      ))}
    </div>
  );
}

function FolderCard({
  folder,
  count,
  small,
  dnd,
  onOpen,
  onDelete,
}: {
  folder: Folder;
  count: number;
  small: boolean;
  dnd: Dnd;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const isTarget = dnd.dragFileId !== null && dnd.dropTarget === folder.id;
  return (
    <button
      type="button"
      onClick={onOpen}
      onDragOver={(e) => dnd.over(e, folder.id)}
      onDragLeave={() => dnd.leave(folder.id)}
      onDrop={(e) => dnd.drop(e, folder.id)}
      className={cn(
        'group flex items-center gap-2.5 border bg-[var(--lui-surface)] p-3 text-left transition-colors',
        isTarget ? 'border-[var(--lui-accent)] bg-[var(--lui-accent)]/[0.06]' : 'border-[var(--lui-border)] hover:border-[var(--lui-muted)]/50',
      )}
    >
      <FolderIcon size={small ? 16 : 18} aria-hidden className="shrink-0 text-[var(--lui-accent)]" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-medium">{folder.name}</p>
        {!small && (
          <p className="mt-0.5 text-[11px] text-[var(--lui-muted)]">
            {count} item{count === 1 ? '' : 's'}
          </p>
        )}
      </div>
      <span className="opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <DeleteButton onClick={onDelete} />
      </span>
    </button>
  );
}

function FileCard({
  f,
  small,
  dnd,
  onOpen,
  onDelete,
}: {
  f: FileDoc;
  small: boolean;
  dnd: Dnd;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const kind = kindOf(f);
  const Icon = KIND_ICON[kind];
  const dragging = dnd.dragFileId === f.id;
  const dragProps = {
    draggable: true,
    onDragStart: (e: React.DragEvent) => dnd.start(e, f.id),
    onDragEnd: dnd.end,
  };
  if (small) {
    return (
      <button
        type="button"
        onClick={onOpen}
        {...dragProps}
        className={cn(
          'group flex cursor-grab items-center gap-2.5 border border-[var(--lui-border)] bg-[var(--lui-surface)] p-3 text-left transition-colors hover:border-[var(--lui-muted)]/50 active:cursor-grabbing',
          dragging && 'opacity-40',
        )}
      >
        <Icon size={16} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{f.title}</span>
        <span className="opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <DeleteButton onClick={onDelete} />
        </span>
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      {...dragProps}
      className={cn(
        'group flex cursor-grab flex-col overflow-hidden border border-[var(--lui-border)] bg-[var(--lui-surface)] text-left transition-colors hover:border-[var(--lui-muted)]/50 active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
    >
      <Thumb f={f} kind={kind} />
      <div className="flex items-start gap-2.5 p-3">
        <Icon size={16} aria-hidden className="mt-0.5 shrink-0 text-[var(--lui-muted)]" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium">{f.title}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--lui-muted)]">
            <span className="uppercase tracking-wide">{KIND_LABEL[kind]}</span>
            {f.size > 0 && <span>· {fmtSize(f.size)}</span>}
            <span>
              · <AgoDate iso={f.created} />
            </span>
          </p>
        </div>
        <span className="opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
          <DeleteButton onClick={onDelete} />
        </span>
      </div>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* List layout                                                         */
/* ------------------------------------------------------------------ */

function ListLayout({
  folders,
  filesList,
  itemsIn,
  dnd,
  onOpenFolder,
  onOpenFile,
  onDeleteFolder,
  onDeleteFile,
}: {
  folders: Folder[];
  filesList: FileDoc[];
  itemsIn: (id: string) => number;
  dnd: Dnd;
  onOpenFolder: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDeleteFolder: (f: Folder) => void;
  onDeleteFile: (f: FileDoc) => void;
}): React.JSX.Element {
  return (
    <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)]">
      <div className="flex items-center gap-3 border-b border-[var(--lui-border)] bg-[var(--lui-border)]/25 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-[var(--lui-muted)]">
        <span className="flex-1">Name</span>
        <span className="hidden w-24 sm:block">Type</span>
        <span className="hidden w-20 text-right sm:block">Size</span>
        <span className="w-20 text-right">Modified</span>
        <span className="w-8" aria-hidden />
      </div>
      {folders.map((folder) => {
        const isTarget = dnd.dragFileId !== null && dnd.dropTarget === folder.id;
        return (
          <Row
            key={folder.id}
            onOpen={() => onOpenFolder(folder.id)}
            onDelete={() => onDeleteFolder(folder)}
            dropActive={isTarget}
            onDragOver={(e) => dnd.over(e, folder.id)}
            onDragLeave={() => dnd.leave(folder.id)}
            onDrop={(e) => dnd.drop(e, folder.id)}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <FolderIcon size={16} aria-hidden className="shrink-0 text-[var(--lui-accent)]" />
              <span className="truncate text-[13px] font-medium">{folder.name}</span>
            </span>
            <span className="hidden w-24 text-xs text-[var(--lui-muted)] sm:block">Folder</span>
            <span className="hidden w-20 text-right text-xs tabular-nums text-[var(--lui-muted)] sm:block">
              {itemsIn(folder.id)} item{itemsIn(folder.id) === 1 ? '' : 's'}
            </span>
            <span className="w-20 text-right text-xs text-[var(--lui-muted)]">
              <AgoDate iso={folder.created} />
            </span>
          </Row>
        );
      })}
      {filesList.map((f) => {
        const kind = kindOf(f);
        const Icon = KIND_ICON[kind];
        return (
          <Row
            key={f.id}
            onOpen={() => onOpenFile(f.id)}
            onDelete={() => onDeleteFile(f)}
            draggable
            dragging={dnd.dragFileId === f.id}
            onDragStart={(e) => dnd.start(e, f.id)}
            onDragEnd={dnd.end}
          >
            <span className="flex min-w-0 flex-1 items-center gap-2.5">
              <Icon size={16} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />
              <span className="truncate text-[13px] font-medium">{f.title}</span>
            </span>
            <span className="hidden w-24 text-xs uppercase tracking-wide text-[var(--lui-muted)] sm:block">
              {KIND_LABEL[kind]}
            </span>
            <span className="hidden w-20 text-right text-xs tabular-nums text-[var(--lui-muted)] sm:block">
              {f.size > 0 ? fmtSize(f.size) : '—'}
            </span>
            <span className="w-20 text-right text-xs text-[var(--lui-muted)]">
              <AgoDate iso={f.created} />
            </span>
          </Row>
        );
      })}
    </div>
  );
}

function Row({
  onOpen,
  onDelete,
  children,
  draggable,
  dragging,
  dropActive,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDragLeave,
  onDrop,
}: {
  onOpen: () => void;
  onDelete: () => void;
  children: React.ReactNode;
  draggable?: boolean | undefined;
  dragging?: boolean | undefined;
  dropActive?: boolean | undefined;
  onDragStart?: ((e: React.DragEvent) => void) | undefined;
  onDragEnd?: (() => void) | undefined;
  onDragOver?: ((e: React.DragEvent) => void) | undefined;
  onDragLeave?: (() => void) | undefined;
  onDrop?: ((e: React.DragEvent) => void) | undefined;
}): React.JSX.Element {
  return (
    <div
      role="button"
      tabIndex={0}
      draggable={draggable}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen();
      }}
      className={cn(
        'group flex items-center gap-3 border-b border-[var(--lui-border)]/70 px-4 py-2 transition-colors last:border-0',
        draggable === true ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
        dropActive === true ? 'bg-[var(--lui-accent)]/[0.08] ring-1 ring-inset ring-[var(--lui-accent)]' : 'hover:bg-[var(--lui-border)]/20',
        dragging === true && 'opacity-40',
      )}
    >
      {children}
      <span className="w-8 opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
        <DeleteButton onClick={onDelete} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Tree layout                                                         */
/* ------------------------------------------------------------------ */

function TreeView({
  folders,
  files,
  dnd,
  childFolders,
  childFiles,
  onOpenFile,
  onDeleteFolder,
  onDeleteFile,
}: {
  folders: Folder[];
  files: FileDoc[];
  dnd: Dnd;
  childFolders: (id: string) => Folder[];
  childFiles: (id: string) => FileDoc[];
  onOpenFile: (id: string) => void;
  onDeleteFolder: (f: Folder) => void;
  onDeleteFile: (f: FileDoc) => void;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const toggle = (id: string): void =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const rootFolders = childFolders('');
  const rootFiles = childFiles('');
  if (folders.length === 0 && files.length === 0) {
    return (
      <p className="border border-dashed border-[var(--lui-border)] px-4 py-10 text-center text-[13px] text-[var(--lui-muted)]">
        Nothing here yet.
      </p>
    );
  }

  return (
    <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)] py-1.5">
      {rootFolders.map((f) => (
        <TreeFolder
          key={f.id}
          folder={f}
          depth={0}
          expanded={expanded}
          toggle={toggle}
          dnd={dnd}
          childFolders={childFolders}
          childFiles={childFiles}
          onOpenFile={onOpenFile}
          onDeleteFolder={onDeleteFolder}
          onDeleteFile={onDeleteFile}
        />
      ))}
      {rootFiles.map((f) => (
        <TreeFile key={f.id} f={f} depth={0} dnd={dnd} onOpen={() => onOpenFile(f.id)} onDelete={() => onDeleteFile(f)} />
      ))}
    </div>
  );
}

function TreeFolder({
  folder,
  depth,
  expanded,
  toggle,
  dnd,
  childFolders,
  childFiles,
  onOpenFile,
  onDeleteFolder,
  onDeleteFile,
}: {
  folder: Folder;
  depth: number;
  expanded: Set<string>;
  toggle: (id: string) => void;
  dnd: Dnd;
  childFolders: (id: string) => Folder[];
  childFiles: (id: string) => FileDoc[];
  onOpenFile: (id: string) => void;
  onDeleteFolder: (f: Folder) => void;
  onDeleteFile: (f: FileDoc) => void;
}): React.JSX.Element {
  const isOpen = expanded.has(folder.id);
  const subFolders = childFolders(folder.id);
  const subFiles = childFiles(folder.id);
  const Chevron = isOpen ? ChevronDown : ChevronRight;
  const isTarget = dnd.dragFileId !== null && dnd.dropTarget === folder.id;
  return (
    <div>
      <div
        onDragOver={(e) => dnd.over(e, folder.id)}
        onDragLeave={() => dnd.leave(folder.id)}
        onDrop={(e) => dnd.drop(e, folder.id)}
        className={cn(
          'group flex items-center gap-1.5 px-2 py-1.5 transition-colors',
          isTarget ? 'bg-[var(--lui-accent)]/[0.08] ring-1 ring-inset ring-[var(--lui-accent)]' : 'hover:bg-[var(--lui-border)]/20',
        )}
        style={{ paddingLeft: 8 + depth * 18 }}
      >
        <button
          type="button"
          onClick={() => toggle(folder.id)}
          aria-label={isOpen ? 'Collapse' : 'Expand'}
          aria-expanded={isOpen}
          className="flex items-center gap-1.5 text-left"
        >
          <Chevron size={14} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />
          <FolderIcon size={15} aria-hidden className="shrink-0 text-[var(--lui-accent)]" />
          <span className="truncate text-[13px] font-medium">{folder.name}</span>
          <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">{subFolders.length + subFiles.length}</span>
        </button>
        <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100">
          <DeleteButton onClick={() => onDeleteFolder(folder)} />
        </span>
      </div>
      {isOpen && (
        <div>
          {subFolders.map((f) => (
            <TreeFolder
              key={f.id}
              folder={f}
              depth={depth + 1}
              expanded={expanded}
              toggle={toggle}
              dnd={dnd}
              childFolders={childFolders}
              childFiles={childFiles}
              onOpenFile={onOpenFile}
              onDeleteFolder={onDeleteFolder}
              onDeleteFile={onDeleteFile}
            />
          ))}
          {subFiles.map((f) => (
            <TreeFile key={f.id} f={f} depth={depth + 1} dnd={dnd} onOpen={() => onOpenFile(f.id)} onDelete={() => onDeleteFile(f)} />
          ))}
          {subFolders.length === 0 && subFiles.length === 0 && (
            <p className="text-[12px] text-[var(--lui-muted)]/70" style={{ paddingLeft: 8 + (depth + 1) * 18 + 20 }}>
              empty
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function TreeFile({
  f,
  depth,
  dnd,
  onOpen,
  onDelete,
}: {
  f: FileDoc;
  depth: number;
  dnd: Dnd;
  onOpen: () => void;
  onDelete: () => void;
}): React.JSX.Element {
  const Icon = KIND_ICON[kindOf(f)];
  const dragging = dnd.dragFileId === f.id;
  return (
    <div
      draggable
      onDragStart={(e) => dnd.start(e, f.id)}
      onDragEnd={dnd.end}
      className={cn(
        'group flex cursor-grab items-center gap-1.5 px-2 py-1.5 transition-colors hover:bg-[var(--lui-border)]/20 active:cursor-grabbing',
        dragging && 'opacity-40',
      )}
      style={{ paddingLeft: 8 + depth * 18 + 20 }}
    >
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
        <Icon size={15} aria-hidden className="shrink-0 text-[var(--lui-muted)]" />
        <span className="truncate text-[13px]">{f.title}</span>
        {f.size > 0 && <span className="text-[11px] tabular-nums text-[var(--lui-muted)]">{fmtSize(f.size)}</span>}
      </button>
      <span className="opacity-0 transition-opacity group-hover:opacity-100">
        <DeleteButton onClick={onDelete} />
      </span>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Preview: metadata strip + inline render                             */
/* ------------------------------------------------------------------ */

function FileMeta({ f }: { f: FileDoc }): React.JSX.Element {
  const kind = kindOf(f);
  const Icon = KIND_ICON[kind];
  return (
    <div className="border border-[var(--lui-border)] bg-[var(--lui-surface)] px-5 py-4">
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center border border-[var(--lui-border)] bg-[var(--lui-bg)]/50 text-[var(--lui-muted)]">
          <Icon size={18} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-lg font-semibold leading-tight">{f.title}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-[var(--lui-muted)]">
            <span className="uppercase tracking-wide">{KIND_LABEL[kind]}</span>
            {f.mime !== '' && <span>· {f.mime}</span>}
            {f.size > 0 && <span>· {fmtSize(f.size)}</span>}
            <span>
              · uploaded <AgoDate iso={f.created} />
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Thumb({ f, kind }: { f: FileDoc; kind: Kind }): React.JSX.Element {
  if (kind === 'image') {
    return (
      <div className="flex h-32 items-center justify-center overflow-hidden border-b border-[var(--lui-border)] bg-[var(--lui-bg)]/40">
        <img src={fileUrl(f)} alt={f.title} loading="lazy" className="h-full w-full object-cover" />
      </div>
    );
  }
  const Icon = KIND_ICON[kind];
  return (
    <div className="flex h-32 items-center justify-center border-b border-[var(--lui-border)] bg-[var(--lui-bg)]/30">
      <Icon size={30} aria-hidden className="text-[var(--lui-muted)]/60" />
    </div>
  );
}

function FilePreview({ f }: { f: FileDoc }): React.JSX.Element {
  const kind = kindOf(f);
  const url = fileUrl(f);
  if (kind === 'image') {
    return (
      <div className="flex justify-center bg-[var(--lui-bg)]/40 p-4">
        <img src={url} alt={f.title} className="max-h-[70vh] max-w-full object-contain" />
      </div>
    );
  }
  if (kind === 'pdf') {
    return <iframe src={url} title={f.title} className="h-[75vh] w-full" />;
  }
  if (kind === 'video') {
    return (
      <div className="flex justify-center bg-black p-2">
        <video src={url} controls className="max-h-[70vh] w-full" />
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div className="p-6">
        <audio src={url} controls className="w-full" />
      </div>
    );
  }
  if (kind === 'text') {
    return <TextPreview url={url} />;
  }
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
      <FileIcon size={28} aria-hidden className="text-[var(--lui-muted)]" />
      <p className="text-[13px] text-[var(--lui-muted)]">
        This file type can’t be previewed here. Download it to open in the right app.
      </p>
      <a href={url} download={f.title}>
        <Button size="sm" variant="secondary">
          <Download size={14} aria-hidden />
          Download
        </Button>
      </a>
    </div>
  );
}

function TextPreview({ url }: { url: string }): React.JSX.Element {
  const [text, setText] = useState<string | null>(null);
  const [error, setError] = useState(false);
  const MAX = 200_000;
  useEffect(() => {
    let cancelled = false;
    setText(null);
    setError(false);
    fetch(url)
      .then((r) => r.text())
      .then((t) => {
        if (!cancelled) setText(t.length > MAX ? t.slice(0, MAX) + '\n\n… (truncated)' : t);
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);
  if (error) {
    return <p className="px-4 py-10 text-center text-[13px] text-[var(--lui-muted)]">Could not load this file.</p>;
  }
  if (text === null) {
    return (
      <p className="px-4 py-10 text-center text-sm text-[var(--lui-muted)]">
        <Spinner size={16} />
      </p>
    );
  }
  return (
    <pre className="max-h-[70vh] overflow-auto whitespace-pre-wrap break-words p-4 text-[12.5px] leading-relaxed [font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace]">
      {text}
    </pre>
  );
}
