/** Small pieces the repository's tree and preview share. */
import type { LucideIcon } from 'lucide-react';
import { File, FileArchive, FileAudio, FileCode, FileImage, FileSpreadsheet, FileText, FileVideo, Folder, FolderOpen } from 'lucide-react';
import { opUrl } from '../../lib/api.ts';
import type { RepoItem } from '../../lib/types.ts';

const CODE = new Set(['py', 'ipynb', 'r', 'rmd', 'qmd', 'jl', 'm', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'cmd', 'sql', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'java', 'kt', 'go', 'rs', 'rb', 'pl', 'php', 'swift', 'scala', 'lua', 'tex', 'bib', 'html', 'htm', 'css', 'scss', 'do', 'sps', 'sas', 'stan', 'smk', 'nf', 'wdl', 'json', 'yml', 'yaml', 'toml', 'xml']);
const SHEET = new Set(['xlsx', 'xls', 'ods', 'parquet', 'feather', 'sav', 'dta', 'rds', 'rdata', 'mat', 'h5', 'hdf5', 'nc']);
const ARCHIVE = new Set(['zip', 'gz', 'tgz', 'tar', 'bz2', 'xz', '7z', 'rar']);

export const extOf = (name: string): string => (name.includes('.') ? (name.split('.').pop() ?? '').toLowerCase() : '');

export function iconOf(item: Pick<RepoItem, 'kind' | 'name' | 'shown_as'>, open = false): LucideIcon {
  if (item.kind === 'folder') return open ? FolderOpen : Folder;
  const ext = extOf(item.name);
  if (item.shown_as === 'table' || SHEET.has(ext)) return FileSpreadsheet;
  if (item.shown_as === 'image' || item.shown_as === 'svg') return FileImage;
  if (item.shown_as === 'audio') return FileAudio;
  if (item.shown_as === 'video') return FileVideo;
  if (ARCHIVE.has(ext)) return FileArchive;
  if (CODE.has(ext)) return FileCode;
  if (item.shown_as === 'text' || item.shown_as === 'markdown' || item.shown_as === 'pdf') return FileText;
  return File;
}

export function size(n: number): string {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(n < 10 * 1024 ? 1 : 0) + ' KB';
  if (n < 1024 * 1024 * 1024) return (n / 1024 / 1024).toFixed(1) + ' MB';
  return (n / 1024 / 1024 / 1024).toFixed(2) + ' GB';
}

export const WHO: Record<RepoItem['actor'], string> = { person: 'You', agent: 'Your AI agent', system: 'The app' };

/** Where a file's bytes are: the version is in the address, so the browser may keep it. */
export const fileUrl = (item: RepoItem, version = item.version, download = false): string => opUrl('repo.file', download ? { item: item.id, version, download: true } : { item: item.id, version });

/** Save a file (the server answers with an attachment). */
export function saveFile(item: RepoItem, version = item.version): void {
  const a = document.createElement('a');
  a.href = fileUrl(item, version, true);
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export const isTextLike = (item: RepoItem): boolean => item.shown_as === 'text' || item.shown_as === 'markdown' || item.shown_as === 'table' || item.shown_as === 'svg';

/** What a text file may be edited at (the server takes up to 2 MB). */
export const EDIT_LIMIT = 2 * 1024 * 1024;

/** A CSV or TSV as rows (quotes, doubled quotes and line breaks inside quotes), at most `max` rows. */
export function parseDelimited(text: string, sep: string, max: number): { rows: string[][]; more: boolean } {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i++;
        continue;
      }
      cell += c;
      i++;
      continue;
    }
    if (c === '"' && cell === '') {
      quoted = true;
      i++;
    } else if (c === sep) {
      row.push(cell);
      cell = '';
      i++;
    } else if (c === '\n' || c === '\r') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (c === '\r' && text[i + 1] === '\n') i++;
      i++;
      if (rows.length > max) return { rows: rows.slice(0, max), more: true };
    } else {
      cell += c;
      i++;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return { rows: rows.slice(0, max), more: rows.length > max };
}
