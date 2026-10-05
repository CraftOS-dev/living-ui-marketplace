/**
 * Server → Files (v4 plan §7.1): the folders this server allows (set on the server itself), browse,
 * open and edit text (the change is shown line by line before saving), upload, download, rename,
 * delete (to NetSentry's bin for 7 days). Every change is previewed and confirmed by an admin;
 * the monitor re-checks each path itself.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Button, Dialog, DropdownMenu, EmptyState, Input, Pill, Spinner, Textarea, getPbClient, toast } from '../../kit/index.ts';
import { useMe } from '../lib/me.tsx';
import { runOp } from '../lib/ops.ts';
import { relTime } from '../lib/format.ts';
import { bytesWords, readServer, useServerRead } from '../lib/serverRead.ts';
import { useAfterChange, useChange, useWatch, Working, type Preview } from './Controls.tsx';

interface Root {
  path: string;
  mode: 'rw' | 'ro';
  why: string;
}
interface Entry {
  name: string;
  kind: 'dir' | 'file' | 'link' | 'other' | 'unknown';
  size?: number | null;
  modified?: number;
  perm?: string;
}
interface Listing {
  path: string;
  roots?: Root[];
  root?: Root;
  parent?: string;
  entries: Entry[];
  more?: number;
}
interface FileText {
  path: string;
  size: number;
  sha256: string;
  binary: boolean;
  text: string | null;
}

const sep = (p: string): string => (p.includes('\\') && !p.startsWith('/') ? '\\' : '/');
const join = (dir: string, name: string): string => (dir.endsWith(sep(dir)) ? dir + name : dir + sep(dir) + name);

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Line diff (small files): what the person is about to save, as - / + lines. */
export function lineDiff(a: string, b: string): Array<{ t: ' ' | '-' | '+'; s: string }> {
  const x = a.split('\n');
  const y = b.split('\n');
  if (x.length * y.length > 4_000_000) return [{ t: '+', s: `(${y.length} lines — too long to compare line by line)` }];
  const n = x.length;
  const m = y.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i]![j] = x[i] === y[j] ? lcs[i + 1]![j + 1]! + 1 : Math.max(lcs[i + 1]![j]!, lcs[i]![j + 1]!);
  const out: Array<{ t: ' ' | '-' | '+'; s: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) {
      out.push({ t: ' ', s: x[i]! });
      i++;
      j++;
    } else if (lcs[i + 1]![j]! >= lcs[i]![j + 1]!) out.push({ t: '-', s: x[i++]! });
    else out.push({ t: '+', s: y[j++]! });
  }
  while (i < n) out.push({ t: '-', s: x[i++]! });
  while (j < m) out.push({ t: '+', s: y[j++]! });
  return out;
}

/** Only the changed lines, with two lines around each. */
export function DiffView({ before, after }: { before: string; after: string }): React.JSX.Element {
  const d = useMemo(() => lineDiff(before, after), [before, after]);
  const keep = d.map((l, i) => l.t !== ' ' || d.slice(Math.max(0, i - 2), i + 3).some((k) => k.t !== ' '));
  const added = d.filter((l) => l.t === '+').length;
  const removed = d.filter((l) => l.t === '-').length;
  if (!added && !removed) return <p className="text-[13px] text-[var(--agent-app-muted)]">Nothing changed.</p>;
  return (
    <div className="flex flex-col gap-1">
      <p className="text-[13px] text-[var(--agent-app-muted)]">
        {added} line{added === 1 ? '' : 's'} added, {removed} removed:
      </p>
      <pre className="max-h-64 overflow-auto rounded-lg border border-[var(--agent-app-border)] bg-[var(--agent-app-surface-2)] p-2 font-mono text-[12px] leading-5">
        {d.map((l, i) =>
          keep[i] ? (
            <div key={i} className={l.t === '+' ? 'text-green-700 dark:text-green-400' : l.t === '-' ? 'text-red-700 dark:text-red-400' : 'text-[var(--agent-app-muted)]'}>
              {l.t} {l.s}
            </div>
          ) : keep[i - 1] ? (
            <div key={i} className="text-[var(--agent-app-muted)]">…</div>
          ) : null,
        )}
      </pre>
    </div>
  );
}

export function FilesPanel({ assetId }: { assetId: string }): React.JSX.Element {
  const { can } = useMe();
  const admin = can('admin');
  useWatch(assetId); // the monitor answers within seconds while Files is open
  const [path, setPath] = useState('');
  const list = useServerRead<Listing>('files.list', { path });
  const flow = useChange();
  useAfterChange(flow.status, list.reload);
  // The editor closes once the save is sent — cancelling the preview keeps your edit.
  useEffect(() => {
    if (flow.status) setEditing(null);
  }, [flow.status]);
  const [editing, setEditing] = useState<FileText | null>(null);
  const [draft, setDraft] = useState('');
  const [naming, setNaming] = useState<{ mode: 'folder' | 'rename'; entry?: Entry } | null>(null);
  const [name, setName] = useState('');
  const [opening, setOpening] = useState('');
  const [uploading, setUploading] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  const writable = list.data?.root?.mode === 'rw';

  const open = async (e: Entry): Promise<void> => {
    const full = join(list.data!.path, e.name);
    setOpening(full);
    try {
      const f = await readServer<FileText>('files.read', { path: full });
      if (f.binary || f.text === null) {
        toast.error(`${e.name} isn't text — download it instead.`);
        return;
      }
      setEditing(f);
      setDraft(f.text);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not open it.');
    } finally {
      setOpening('');
    }
  };

  const download = async (e: Entry): Promise<void> => {
    const full = join(list.data!.path, e.name);
    setOpening(full);
    try {
      const r = await readServer<{ transfer_id: string; name: string }>('files.download', { path: full });
      const pb = getPbClient().pb;
      const rec = await pb.collection('file_transfers').getOne<{ id: string; file: string }>(r.transfer_id);
      const token = await pb.files.getToken();
      const url = pb.files.getURL(rec, rec.file, { token, download: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = r.name;
      a.click();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not download it.');
    } finally {
      setOpening('');
    }
  };

  const upload = async (file: File): Promise<void> => {
    if (file.size > 20_000_000) {
      toast.error('Files up to 20 MB go through NetSentry — use the terminal (scp) for bigger ones.');
      return;
    }
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const form = new FormData();
      form.append('name', file.name);
      form.append('sha256', await sha256Hex(buf));
      form.append('file', new Blob([buf]), file.name);
      const staged = await getPbClient().pb.send<{ transfer_id: string }>('/api/ops/files-stage-upload', { method: 'POST', body: form });
      await flow.ask(() => runOp<Preview>('files.upload', { transfer_id: staged.transfer_id, folder: list.data!.path }), 'Upload now');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not upload it.');
    } finally {
      setUploading(false);
    }
  };

  const crumbs = useMemo(() => {
    const d = list.data;
    if (!d?.root) return [] as Array<{ label: string; path: string }>;
    const root = d.root.path;
    const rest = d.path.slice(root.length).split(/[\\/]/).filter(Boolean);
    const out = [{ label: root, path: root }];
    let acc = root;
    for (const r of rest) {
      acc = join(acc, r);
      out.push({ label: r, path: acc });
    }
    return out;
  }, [list.data]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <button type="button" className="text-[var(--agent-app-accent)] hover:underline" onClick={() => setPath('')}>
          Allowed folders
        </button>
        {crumbs.map((c, i) => (
          <span key={c.path} className="flex items-center gap-2">
            <span className="text-[var(--agent-app-muted)]">›</span>
            {i === crumbs.length - 1 ? (
              <span className="font-mono">{c.label}</span>
            ) : (
              <button type="button" className="font-mono text-[var(--agent-app-accent)] hover:underline" onClick={() => setPath(c.path)}>
                {c.label}
              </button>
            )}
          </span>
        ))}
        {list.data?.root && <Pill tone={writable ? 'neutral' : 'warn'}>{writable ? 'you can change files here' : 'read-only'}</Pill>}
        <div className="ml-auto flex flex-wrap gap-2">
          {flow.status && <Working status={flow.status} />}
          {admin && writable && (
            <>
              <Button size="sm" variant="secondary" onClick={() => (setNaming({ mode: 'folder' }), setName(''))}>
                New folder
              </Button>
              <Button size="sm" variant="secondary" loading={uploading} onClick={() => picker.current?.click()}>
                Upload
              </Button>
              <input ref={picker} type="file" className="hidden" aria-label="File to upload" onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])} />
            </>
          )}
          <Button size="sm" variant="ghost" loading={list.loading} onClick={list.reload}>
            Refresh
          </Button>
        </div>
      </div>

      {list.error && <p className="text-[13px] text-red-700 dark:text-red-400">{list.error}</p>}
      {!list.data && list.loading && (
        <p className="flex items-center gap-2 text-[13px] text-[var(--agent-app-muted)]">
          <Spinner /> Asking the server…
        </p>
      )}

      {list.data && path === '' && (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          {(list.data.roots ?? []).length === 0 ? (
            <div className="p-4">
              <EmptyState title="No folders allowed yet" message="This server allows no folders for NetSentry to show. Its owner sets them on the server (NETSENTRY_FILE_ROOTS for the monitor)." />
            </div>
          ) : (
            (list.data.roots ?? []).map((r) => (
              <button key={r.path} type="button" onClick={() => setPath(r.path)} className="flex w-full items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-3 text-left last:border-b-0 hover:bg-[var(--agent-app-surface-2)]">
                <span aria-hidden>📁</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-mono text-[14px]">{r.path}</span>
                  <span className="block text-[12px] text-[var(--agent-app-muted)]">{r.why}</span>
                </span>
                <Pill tone={r.mode === 'rw' ? 'neutral' : 'warn'}>{r.mode === 'rw' ? 'read and change' : 'read-only'}</Pill>
              </button>
            ))
          )}
          <p className="border-t border-[var(--agent-app-border)] px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">
            Which folders show here is set on the server itself, never from NetSentry: each app's own folder, /srv and folders its owner listed can be changed; /etc and logs only read.
          </p>
        </div>
      )}

      {list.data && path !== '' && (
        <div className="rounded-xl border border-[var(--agent-app-border)] bg-[var(--agent-app-surface)]">
          {list.data.parent && (
            <button type="button" onClick={() => setPath(list.data!.parent!)} className="flex w-full items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-2 text-left text-[14px] hover:bg-[var(--agent-app-surface-2)]">
              <span aria-hidden>↩</span> Up one folder
            </button>
          )}
          {list.data.entries.length === 0 && <p className="px-4 py-3 text-[14px] text-[var(--agent-app-muted)]">This folder is empty.</p>}
          {list.data.entries.map((e) => {
            const full = join(list.data!.path, e.name);
            const items = [
              ...(e.kind === 'file' && admin ? [{ label: 'Open', onSelect: () => void open(e) }, { label: 'Download', onSelect: () => void download(e) }] : []),
              ...(admin && writable
                ? [
                    { label: 'Rename', onSelect: () => (setNaming({ mode: 'rename', entry: e }), setName(e.name)) },
                    { label: 'Delete', danger: true, onSelect: () => void flow.ask(() => runOp<Preview>('files.delete', { path: full }), 'Delete now', true) },
                  ]
                : []),
            ];
            return (
              <div key={e.name} className="flex items-center gap-3 border-b border-[var(--agent-app-border)] px-4 py-2 last:border-b-0">
                <span aria-hidden>{e.kind === 'dir' ? '📁' : e.kind === 'link' ? '🔗' : '📄'}</span>
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left font-mono text-[14px] hover:underline disabled:no-underline"
                  disabled={e.kind !== 'dir' && !(e.kind === 'file' && admin)}
                  onClick={() => (e.kind === 'dir' || e.kind === 'link' ? setPath(full) : void open(e))}
                >
                  {e.name}
                </button>
                {opening === full && <Spinner />}
                <span className="hidden w-20 text-right text-[12px] text-[var(--agent-app-muted)] sm:block">{e.kind === 'file' ? bytesWords(e.size) : ''}</span>
                <span className="hidden w-24 text-right text-[12px] text-[var(--agent-app-muted)] sm:block">{e.modified ? relTime(new Date(e.modified * 1000).toISOString()) : ''}</span>
                {items.length > 0 && <DropdownMenu trigger={<Button size="sm" variant="ghost" aria-label={`More for ${e.name}`}>⋯</Button>} items={items} />}
              </div>
            );
          })}
          {(list.data.more ?? 0) > 0 && <p className="px-4 py-2 text-[12px] text-[var(--agent-app-muted)]">…and {list.data.more} more not shown.</p>}
        </div>
      )}

      <Dialog
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        title={editing?.path ?? ''}
        description={admin && writable ? 'Edit, then Save — you see exactly what changes before anything is saved.' : 'Read-only here.'}
        className="max-w-4xl"
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)}>
              Close
            </Button>
            {admin && writable && editing && (
              <Button
                disabled={draft === editing.text}
                onClick={() => void flow.ask(() => runOp<Preview>('files.save', { path: editing.path, content: draft, expected_sha256: editing.sha256 }), 'Save now')}
              >
                Save…
              </Button>
            )}
          </div>
        }
      >
        {editing && (
          <div className="flex flex-col gap-3">
            <Textarea
              aria-label="File contents"
              rows={18}
              className="font-mono text-[12px]"
              value={draft}
              readOnly={!(admin && writable)}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
            {draft !== editing.text && <DiffView before={editing.text ?? ''} after={draft} />}
          </div>
        )}
      </Dialog>

      <Dialog
        open={naming !== null}
        onOpenChange={(o) => !o && setNaming(null)}
        title={naming?.mode === 'folder' ? 'New folder' : `Rename ${naming?.entry?.name ?? ''}`}
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setNaming(null)}>
              Cancel
            </Button>
            <Button
              id="ns-name-next"
              disabled={!name.trim() || /[\\/]/.test(name)}
              onClick={() => {
                const target = join(list.data!.path, name.trim());
                const n = naming;
                setNaming(null);
                void flow.ask(
                  () => (n?.mode === 'folder' ? runOp<Preview>('files.new-folder', { path: target }) : runOp<Preview>('files.rename', { path: join(list.data!.path, n!.entry!.name), to: target })),
                  n?.mode === 'folder' ? 'Make it' : 'Rename now',
                );
              }}
            >
              Next…
            </Button>
          </div>
        }
      >
        <form onSubmit={(e) => (e.preventDefault(), (document.getElementById('ns-name-next') as HTMLButtonElement | null)?.click())}>
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </form>
      </Dialog>
      {flow.element}
    </div>
  );
}
