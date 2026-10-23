/**
 * Moving bytes in and out of a repository.
 *
 *   upload       one file at a time with its progress (fetch cannot report
 *                upload progress, so this is an XMLHttpRequest); a folder
 *                upload sends each file's folder path so the tree is kept
 *   dropped      the files of a drop from the computer, walking dropped
 *                folders (their paths kept)
 *   zipFolder    a folder or a selection as one zip, built in the browser
 */
import { getPbClient } from '../../../kit/index.ts';
import { opUrl } from '../../lib/api.ts';
import { zip } from '../../lib/zip.ts';
import type { RepoItem } from '../../lib/types.ts';

/** A file to upload and the folder path under the target it goes in ("" for the target itself). */
export interface Outgoing {
  file: File;
  dir: string;
}

export interface UploadError extends Error {
  status: number;
  code: string;
}

export interface Uploaded {
  uploaded: { item: RepoItem; new_version: boolean }[];
}

/**
 * Files bound for the same folder go together, up to 20 files or 64 MB a
 * request (a larger file goes alone), so a folder of many small files stays
 * well under the app's request limit.
 */
export function batches(list: Outgoing[]): Outgoing[][] {
  const out: Outgoing[][] = [];
  let cur: Outgoing[] = [];
  let size = 0;
  for (const f of list) {
    const first = cur[0];
    if (first !== undefined && (first.dir !== f.dir || cur.length >= 20 || size + f.file.size > 64 * 1024 * 1024)) {
      out.push(cur);
      cur = [];
      size = 0;
    }
    cur.push(f);
    size += f.file.size;
  }
  if (cur.length > 0) out.push(cur);
  return out;
}

/** Upload one batch; a "too many requests" answer waits and tries again. */
export async function upload(project: string, folder: string, batch: Outgoing[], onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Uploaded> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await send(project, folder, batch, onProgress, signal);
    } catch (e) {
      const err = e as UploadError;
      if (err.status !== 429 || attempt >= 4) throw err;
      await new Promise((r) => setTimeout(r, 4000 * (attempt + 1)));
      if (signal.aborted) throw err;
    }
  }
}

function send(project: string, folder: string, batch: Outgoing[], onProgress: (fraction: number) => void, signal: AbortSignal): Promise<Uploaded> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', getPbClient().pb.baseURL.replace(/\/$/, '') + '/api/ops/repo/upload');
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && e.total > 0) onProgress(e.loaded / e.total);
    };
    const fail = (message: string, status: number, code: string): void => reject(Object.assign(new Error(message), { status, code }) as UploadError);
    xhr.onload = () => {
      let body: { message?: string; code?: string } = {};
      try {
        body = JSON.parse(xhr.responseText) as typeof body;
      } catch {
        /* an empty or non-JSON answer */
      }
      if (xhr.status === 200) resolve(body as unknown as Uploaded);
      else fail(body.message ?? 'The upload failed (' + xhr.status + ').', xhr.status, body.code ?? 'error');
    };
    xhr.onerror = () => fail('The upload did not reach the app.', 0, 'network');
    xhr.onabort = () => fail('Cancelled', 0, 'aborted');
    signal.addEventListener('abort', () => xhr.abort());
    const fd = new FormData();
    fd.append('project', project);
    if (folder !== '') fd.append('folder', folder);
    const dir = batch[0]?.dir ?? '';
    if (dir !== '') fd.append('path', dir);
    for (const f of batch) fd.append('files', f.file, f.file.name);
    xhr.send(fd);
  });
}

/** A folder picker's files (each knows its path inside the picked folder). */
export function picked(list: FileList): Outgoing[] {
  return Array.from(list).map((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
    return { file, dir: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '' };
  });
}

type Entry = FileSystemEntry;

function readAll(dir: FileSystemDirectoryEntry): Promise<Entry[]> {
  const reader = dir.createReader();
  const all: Entry[] = [];
  // readEntries answers in batches until it answers with none.
  return new Promise((resolve, reject) => {
    const next = (): void =>
      reader.readEntries((batch) => {
        if (batch.length === 0) resolve(all);
        else {
          all.push(...batch);
          next();
        }
      }, reject);
    next();
  });
}

async function walk(entry: Entry, dir: string, out: Outgoing[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
    out.push({ file, dir });
  } else if (entry.isDirectory) {
    const here = dir === '' ? entry.name : dir + '/' + entry.name;
    for (const e of await readAll(entry as FileSystemDirectoryEntry)) await walk(e, here, out);
  }
}

/** The files of a drop from the computer, with dropped folders walked. */
export async function dropped(dt: DataTransfer): Promise<Outgoing[]> {
  // Take the entries now: the drop's lists are emptied once the event ends.
  const entries = Array.from(dt.items)
    .filter((it) => it.kind === 'file')
    .map((it) => (typeof it.webkitGetAsEntry === 'function' ? it.webkitGetAsEntry() : null));
  const plain = Array.from(dt.files);
  if (entries.length === 0 || entries.some((e) => e === null)) return plain.map((file) => ({ file, dir: '' }));
  const out: Outgoing[] = [];
  for (const e of entries) if (e !== null) await walk(e, '', out);
  return out;
}

/** True when a drag carries files from the computer (not items of the tree). */
export const hasFiles = (dt: DataTransfer): boolean => Array.from(dt.types).includes('Files');

export const ZIP_LIMIT = 2 * 1024 * 1024 * 1024;

/** Every file under `roots` (folders walked), named by its path from `base` ("" keeps the whole path). */
export function zipEntries(items: RepoItem[], roots: RepoItem[]): { item: RepoItem; name: string }[] {
  const out: { item: RepoItem; name: string }[] = [];
  for (const r of roots) {
    const base = r.path.includes('/') ? r.path.slice(0, r.path.lastIndexOf('/') + 1) : '';
    const under = r.kind === 'file' ? [r] : items.filter((x) => x.kind === 'file' && x.path.startsWith(r.path + '/'));
    for (const f of under) out.push({ item: f, name: f.path.slice(base.length) });
  }
  return out;
}

/** Fetch the files and build the zip in the browser; `onStep` says how far it is. */
export async function zipFiles(list: { item: RepoItem; name: string }[], onStep: (done: number, total: number) => void, signal: AbortSignal): Promise<Blob> {
  const entries: { name: string; data: Uint8Array }[] = [];
  let done = 0;
  for (const e of list) {
    const res = await fetch(opUrl('repo.file', { item: e.item.id, version: e.item.version, download: true }), { signal });
    if (!res.ok) throw new Error('Could not read ' + e.item.path + ' (' + res.status + ').');
    entries.push({ name: e.name, data: new Uint8Array(await res.arrayBuffer()) });
    onStep(++done, list.length);
  }
  return zip(entries);
}
