/** Shapes returned by the app's operations (pb_hooks/lib_*.js serialize()). */

export type Kind = 'note' | 'link' | 'image' | 'video' | 'youtube' | 'doc' | 'quote' | 'section';
export type CardColor = 'plain' | 'amber' | 'green' | 'blue' | 'violet' | 'red' | 'teal' | 'accent';
export type BoardColor = 'ink' | 'accent' | 'amber' | 'green' | 'blue' | 'violet' | 'red' | 'teal';
export type LinkKind = 'relates' | 'supports' | 'contradicts' | 'leads';
export type DigestState = '' | 'waiting' | 'reading' | 'done' | 'failed';
export type ReviewState = '' | 'waiting' | 'working' | 'done' | 'failed';

export interface Settings {
  title: string;
  link_previews: boolean;
}

export interface Viewport {
  x: number;
  y: number;
  zoom: number;
}

export interface CardMeta {
  filename?: string;
  size?: number;
  ext?: string;
  site?: string;
  description?: string;
  author?: string;
  video_id?: string;
}

export interface Card {
  id: string;
  board: string;
  kind: Kind;
  title: string;
  body: string;
  url: string;
  file: string;
  file_url: string;
  /** The file when there is one, else the url. */
  src: string;
  source: string;
  thumb: string;
  meta: CardMeta;
  tags: string[];
  color: CardColor;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  starred: boolean;
  added_by: 'app' | 'agent';
  digest: string;
  digest_state: DigestState;
  digest_error: string;
  digest_at: string;
  created: string;
  updated: string;
  board_name?: string;
  file_path?: string;
}

export interface Link {
  id: string;
  board: string;
  source: string;
  target: string;
  kind: LinkKind;
  label: string;
  status: 'confirmed' | 'proposed';
  added_by: 'app' | 'agent';
  reason: string;
  created: string;
  updated: string;
}

export interface CardLink extends Link {
  direction: 'in' | 'out';
  other: { id: string; title: string; kind: Kind };
}

export interface CardDetail extends Card {
  board_name: string;
  links: CardLink[];
}

/** A board's thumbnail: [x, y, w, h, kind index, color] per card and [from, to, proposed] per link. */
export interface BoardPreview {
  boxes: [number, number, number, number, number, string][];
  lines: [number, number, number][];
}

export interface Board {
  id: string;
  name: string;
  description: string;
  color: BoardColor;
  viewport: Viewport | null;
  sort: number;
  cards: number;
  links: number;
  proposed: number;
  kinds: Partial<Record<Kind, number>>;
  review_state: ReviewState;
  review_request: string;
  review_note: string;
  review_focus: string;
  review_at: string;
  created: string;
  updated: string;
  last_added: string;
  preview: BoardPreview | null;
}

export interface BoardData {
  board: Board;
  cards: Card[];
  links: Link[];
}

export interface HomeSummary {
  title: string;
  month: string;
  totals: { boards: number; cards: number; links: number; proposed: number; starred: number; tags: number };
  kinds: Partial<Record<Kind, number>>;
  days: { date: string; count: number }[];
  month_total: number;
  previous_month: string;
  previous_total: number;
  recent: Card[];
  tags: { tag: string; count: number }[];
  boards: Board[];
  agent: { digests_busy: number; digests_failed: number; reviews_busy: number; proposed: number };
}

export interface UrlPreview {
  kind: Kind;
  title: string;
  description: string;
  site: string;
  image: string;
  author: string;
  previews_off?: boolean;
}
