/**
 * The UI calls the same operations the AI agent calls through the agent-app
 * CLI (pb_hooks/ops*.pb.js), so a rule enforced there holds for both.
 */
import { getPbClient } from '../../kit/index.ts';
import type { Board, BoardData, BoardColor, Card, CardColor, CardDetail, HomeSummary, Kind, Link, LinkKind, Settings, UrlPreview, Viewport } from './types.ts';

type Params = Record<string, string | number | boolean | null | undefined>;

function clean(params: Params): Record<string, string | number | boolean> {
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function get<T>(path: string, params: Params = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean(params))) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'GET', query }), { silent });
}

function post<T>(path: string, body: Record<string, unknown>, silent = false): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body }), { silent });
}

function postForm<T>(path: string, form: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body: form }));
}

export interface CardInput {
  board: string;
  kind?: Kind;
  title?: string;
  body?: string;
  url?: string;
  source?: string;
  tags?: string[];
  color?: CardColor;
  starred?: boolean;
  x?: number;
  y?: number;
  w?: number;
  h?: number;
  near_x?: number;
  near_y?: number;
}

export type CardPatch = Partial<Omit<CardInput, 'board' | 'kind' | 'near_x' | 'near_y'>> & { refresh_preview?: boolean };

export const api = {
  settings: (): Promise<Settings> => get('/api/ops/settings/get'),
  updateSettings: (p: Partial<Settings>): Promise<Settings> => post('/api/ops/settings/update', p),

  home: (month: string): Promise<HomeSummary> => get('/api/ops/summary/home', { month }),

  boards: (preview = false): Promise<{ boards: Board[] }> => get('/api/ops/boards/list', { preview }),
  board: (id: string): Promise<BoardData> => get('/api/ops/boards/get', { board: id }),
  createBoard: (p: { name: string; description?: string; color?: BoardColor }): Promise<{ board: Board }> => post('/api/ops/boards/create', p),
  updateBoard: (id: string, p: { name?: string; description?: string; color?: BoardColor; viewport?: Viewport }, silent = false): Promise<{ board: Board }> =>
    post('/api/ops/boards/update', { board: id, ...p }, silent),
  deleteBoard: (id: string): Promise<unknown> => post('/api/ops/boards/delete', { board: id }),
  duplicateBoard: (id: string, name?: string): Promise<BoardData> => post('/api/ops/boards/duplicate', { board: id, name }),
  exportBoard: (id: string): Promise<{ filename: string; content: string; cards: number }> => get('/api/ops/boards/export', { board: id }),

  cards: (p: Params): Promise<{ count: number; cards: Card[] }> => get('/api/ops/cards/list', p),
  card: (id: string): Promise<CardDetail> => get('/api/ops/cards/get', { card: id }),
  preview: (url: string): Promise<UrlPreview> => get('/api/ops/cards/preview', { url }, true),
  addCard: (p: CardInput): Promise<{ card: Card }> => post('/api/ops/cards/add', { ...p }),
  addFile: (p: CardInput, file: File): Promise<{ card: Card }> => {
    const form = new FormData();
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === null) continue;
      form.append(k, Array.isArray(v) ? JSON.stringify(v) : String(v));
    }
    form.append('file', file);
    return postForm('/api/ops/cards/add', form);
  },
  updateCard: (id: string, p: CardPatch, silent = false): Promise<{ card: Card }> => post('/api/ops/cards/update', { card: id, ...p }, silent),
  moveCards: (positions: { card: string; x?: number; y?: number; w?: number; h?: number }[], front = false): Promise<{ moved: number }> =>
    post('/api/ops/cards/move', { positions, front }, true),
  deleteCards: (ids: string[]): Promise<{ trashed: number; ids: string[] }> => post('/api/ops/cards/delete', { ids }),
  restoreCards: (ids: string[]): Promise<{ restored: number }> => post('/api/ops/cards/restore', { ids }),
  duplicateCards: (ids: string[]): Promise<{ ids: string[] }> => post('/api/ops/cards/duplicate', { ids }),
  transferCards: (ids: string[], board: string, mode: 'move' | 'copy'): Promise<{ ids: string[]; links_left_behind: number }> =>
    post('/api/ops/cards/transfer', { ids, board, mode }),
  tagCards: (ids: string[], add: string[], remove: string[] = []): Promise<{ updated: number }> => post('/api/ops/cards/tag', { ids, add, remove }),

  tags: (): Promise<{ tags: { tag: string; count: number }[] }> => get('/api/ops/tags/list'),
  renameTag: (tag: string, to: string): Promise<{ updated: number }> => post('/api/ops/tags/rename', { tag, to }),
  deleteTag: (tag: string): Promise<{ updated: number }> => post('/api/ops/tags/delete', { tag }),

  addLink: (p: { source: string; target: string; kind: LinkKind; label?: string }): Promise<{ link: Link; existed: boolean }> => post('/api/ops/links/add', p),
  updateLink: (id: string, p: { kind?: LinkKind; label?: string; flip?: boolean }): Promise<{ link: Link }> => post('/api/ops/links/update', { link: id, ...p }),
  deleteLink: (id: string): Promise<unknown> => post('/api/ops/links/delete', { link: id }),
  decideLinks: (decision: 'confirm' | 'reject', p: { ids?: string[]; board?: string }): Promise<{ decided: number }> => post('/api/ops/links/decide', { decision, ...p }),

  requestDigest: (card: string): Promise<{ card: Card; asked_agent: boolean; request: string }> => post('/api/ops/digests/request', { card }),
  cancelDigest: (card: string): Promise<{ card: Card }> => post('/api/ops/digests/cancel', { card }),
  clearDigest: (card: string): Promise<{ card: Card }> => post('/api/ops/digests/clear', { card }),

  requestReview: (board: string, focus: string): Promise<{ board: Board; asked_agent: boolean; request: string }> => post('/api/ops/reviews/request', { board, focus }),
  cancelReview: (board: string): Promise<{ board: Board }> => post('/api/ops/reviews/cancel', { board }),
  dismissReview: (board: string): Promise<{ board: Board }> => post('/api/ops/reviews/dismiss', { board }),
};

/** Hand a text file to the browser as a download. */
export function download(filename: string, content: string, mime = 'text/markdown'): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** The message an op error carries (PocketBase shape { message }). */
export function errMessage(err: unknown): string {
  const e = err as { message?: string; response?: { message?: string } };
  return e.response?.message ?? e.message ?? 'Something went wrong';
}
