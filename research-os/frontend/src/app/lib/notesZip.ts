/** Exported notes as one zip: the Markdown files, and each note's pictures next to it (fetched one by one). */
import { opUrl } from './api.ts';
import { zip, type ZipEntry } from './zip.ts';

export interface NotesExport {
  files: { path: string; content: string }[];
  /** Pictures the notes show: where each goes in the zip, and the picture's id. */
  attachments?: { path: string; file: string }[];
}

export async function notesZip(r: NotesExport): Promise<Blob> {
  const entries: ZipEntry[] = r.files.map((f) => ({ name: f.path, data: f.content }));
  const seen = new Set<string>();
  for (const a of r.attachments ?? []) {
    if (seen.has(a.path)) continue;
    seen.add(a.path);
    const res = await fetch(opUrl('notes.image', { file: a.file }));
    if (res.ok) entries.push({ name: a.path, data: new Uint8Array(await res.arrayBuffer()) });
  }
  return zip(entries);
}
