/** What each kind of card, link and color looks like: one line icon, a label and a color token. */
import type { LucideIcon } from 'lucide-react';
import { FileText, Frame, Globe, Image, PlaySquare, Quote, StickyNote, Video } from 'lucide-react';
import type { BoardColor, CardColor, Kind, LinkKind } from './types.ts';

export interface KindInfo {
  kind: Kind;
  label: string;
  plural: string;
  icon: LucideIcon;
  hint: string;
}

export const KIND_LIST: KindInfo[] = [
  { kind: 'note', label: 'Note', plural: 'Notes', icon: StickyNote, hint: 'An idea, a finding, a question' },
  { kind: 'link', label: 'Link', plural: 'Links', icon: Globe, hint: 'A web page or article' },
  { kind: 'youtube', label: 'YouTube', plural: 'YouTube', icon: PlaySquare, hint: 'A video on YouTube' },
  { kind: 'image', label: 'Image', plural: 'Images', icon: Image, hint: 'A photo, chart or screenshot' },
  { kind: 'video', label: 'Video', plural: 'Videos', icon: Video, hint: 'A video file or address' },
  { kind: 'doc', label: 'Document', plural: 'Documents', icon: FileText, hint: 'A PDF, slides or any file' },
  { kind: 'quote', label: 'Quote', plural: 'Quotes', icon: Quote, hint: 'A passage and its source' },
  { kind: 'section', label: 'Section', plural: 'Sections', icon: Frame, hint: 'A frame that groups cards' },
];

export const KIND: Record<Kind, KindInfo> = Object.fromEntries(KIND_LIST.map((k) => [k.kind, k])) as Record<Kind, KindInfo>;

/** Kinds that are content (sections are frames). */
export const CONTENT_KINDS: Kind[] = ['note', 'link', 'youtube', 'image', 'video', 'doc', 'quote'];

/** The order kinds sit in the board preview data (pb_hooks/lib_cards.js KINDS). */
export const PREVIEW_KINDS: Kind[] = ['note', 'link', 'image', 'video', 'youtube', 'doc', 'quote', 'section'];

export function kindColor(kind: Kind): string {
  return `var(--rb-kind-${kind})`;
}

export function kindText(kind: Kind): string {
  return `var(--rb-kind-${kind}-text)`;
}

export function kindSoft(kind: Kind): string {
  return `var(--rb-kind-${kind}-soft)`;
}

export interface LinkInfo {
  kind: LinkKind;
  label: string;
  verb: string;
  hint: string;
}

export const LINK_LIST: LinkInfo[] = [
  { kind: 'relates', label: 'Relates', verb: 'relates to', hint: 'They belong together' },
  { kind: 'supports', label: 'Supports', verb: 'supports', hint: 'Backs it up' },
  { kind: 'contradicts', label: 'Contradicts', verb: 'contradicts', hint: 'Argues against it' },
  { kind: 'leads', label: 'Leads to', verb: 'leads to', hint: 'Comes first or causes it' },
];

export const LINK: Record<LinkKind, LinkInfo> = Object.fromEntries(LINK_LIST.map((l) => [l.kind, l])) as Record<LinkKind, LinkInfo>;

export function linkColor(kind: LinkKind): string {
  return `var(--rb-link-${kind})`;
}

export function linkText(kind: LinkKind): string {
  return `var(--rb-link-${kind}-text)`;
}

export const CARD_COLORS: CardColor[] = ['plain', 'amber', 'green', 'blue', 'violet', 'red', 'teal', 'accent'];

export const COLOR_NAME: Record<CardColor, string> = {
  plain: 'Plain',
  amber: 'Amber',
  green: 'Green',
  blue: 'Blue',
  violet: 'Violet',
  red: 'Red',
  teal: 'Teal',
  accent: 'Accent',
};

export function tint(color: CardColor, part: '' | 'soft' | 'wash' = ''): string {
  return `var(--rb-tint-${color}${part === '' ? '' : '-' + part})`;
}

export const BOARD_COLORS: BoardColor[] = ['ink', 'accent', 'amber', 'green', 'blue', 'violet', 'red', 'teal'];

export function boardColor(c: BoardColor): string {
  return c === 'ink' ? 'var(--rb-ink)' : `var(--rb-tint-${c})`;
}

/** "2.4 MB" */
export function fileSize(bytes: number | undefined): string {
  if (bytes === undefined || !(bytes > 0)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** What a card is called when it has no title: the start of its text, or its kind. */
export function cardName(c: { title: string; body: string; kind: Kind }): string {
  if (c.title.trim() !== '') return c.title;
  const t = c.body.replace(/\s+/g, ' ').trim();
  if (t !== '') return t.length > 64 ? `${t.slice(0, 61).trim()}…` : t;
  return c.kind === 'note' ? 'Empty note' : KIND[c.kind].label;
}

/** The short line under a card's kind: site, file type and size, channel or source. */
export function cardCaption(c: { kind: Kind; meta: { site?: string; ext?: string; size?: number; author?: string; filename?: string }; source: string; url: string }): string {
  switch (c.kind) {
    case 'link':
      return c.meta.site ?? '';
    case 'youtube':
      return c.meta.author ?? 'YouTube';
    case 'doc':
    case 'image':
    case 'video': {
      const ext = (c.meta.ext ?? '').toUpperCase();
      const size = fileSize(c.meta.size);
      return [ext, size].filter((x) => x !== '').join(' · ') || hostOf(c.url);
    }
    case 'quote':
      return c.source;
    default:
      return '';
  }
}

export function hostOf(url: string): string {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(url);
  return m ? (m[1] ?? '').toLowerCase().replace(/^www\./, '') : '';
}

export function youtubeId(url: string): string {
  const m = /(?:youtube\.com\/(?:watch\?(?:[^#]*&)?v=|embed\/|shorts\/|live\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/.exec(url);
  return m ? (m[1] ?? '') : '';
}

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp'];
const VIDEO_EXT = ['mp4', 'webm', 'mov', 'm4v', 'ogv'];
const DOC_EXT = ['pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'txt', 'md', 'csv', 'epub', 'key', 'pages', 'numbers', 'json', 'tex'];

function extOf(name: string): string {
  const clean = name.split('?')[0]?.split('#')[0] ?? '';
  const i = clean.lastIndexOf('.');
  return i > clean.lastIndexOf('/') && i >= 0 ? clean.slice(i + 1).toLowerCase() : '';
}

/** The kind a pasted or typed address makes (mirrors pb_hooks/lib_cards.js). */
export function kindForUrl(url: string): Kind {
  if (youtubeId(url) !== '') return 'youtube';
  const ext = extOf(url);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  if (DOC_EXT.includes(ext)) return 'doc';
  return 'link';
}

export function kindForFile(name: string): Kind {
  const ext = extOf(name);
  if (IMAGE_EXT.includes(ext)) return 'image';
  if (VIDEO_EXT.includes(ext)) return 'video';
  return 'doc';
}

export function isWebUrl(s: string): boolean {
  return /^https?:\/\/[^\s/$.?#][^\s]*$/i.test(s.trim());
}

export function plural(n: number, one: string, many?: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : (many ?? `${one}s`)}`;
}
