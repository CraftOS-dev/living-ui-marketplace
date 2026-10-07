/**
 * Calls into the app's operations (pb_hooks/ops.pb.js), the same routes the
 * CraftBot agent uses. Plain field edits go straight to the collection.
 */
import { getPbClient } from '../kit/index.ts';
import type { Digest, EngineSetup, EngineStatus, ExportFile, Note } from './types.ts';

type Params = Record<string, string | number | boolean>;

function get<T>(path: string, params: Params = {}, silent = false): Promise<T> {
  const query: Record<string, string> = {};
  for (const [k, v] of Object.entries(params)) query[k] = String(v);
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'GET', query }), { silent });
}

function post<T>(path: string, body: Record<string, unknown>): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body }));
}

function postForm<T>(path: string, form: FormData): Promise<T> {
  return getPbClient().call((pb) => pb.send<T>(path, { method: 'POST', body: form }));
}

export const api = {
  /**
   * Field edits go through the update op, which changes the note inside one
   * transaction: an edit can never write back a stale copy over lines the
   * live transcript added meanwhile.
   */
  updateNote: (id: string, fields: Partial<Note>): Promise<Note> => post('/api/ops/notes/update', { note_id: id, ...fields }),
  createNote: (data: FormData): Promise<Note> => getPbClient().call((pb) => pb.collection('notes').create<Note>(data)),
  deleteNote: (id: string): Promise<unknown> => post('/api/ops/notes/delete', { note_id: id }),
  duplicate: (id: string): Promise<{ id: string }> => post('/api/ops/notes/duplicate', { note_id: id }),
  transcribe: (id: string, language: string): Promise<unknown> => post('/api/ops/notes/transcribe', { note_id: id, language }),
  generate: (id: string): Promise<unknown> => post('/api/ops/notes/generate', { note_id: id }),
  cancel: (id: string): Promise<unknown> => post('/api/ops/notes/cancel', { note_id: id }),
  /** Tell the speakers apart by voice (speakers: how many, 0 = detect the number). */
  /** Rename a speaker or attendee everywhere in a note (lines, attendees, action items). */
  renameSpeaker: (id: string, speaker: string, name: string): Promise<unknown> =>
    post('/api/ops/notes/rename-speaker', { note_id: id, speaker, name }),
  detectPeople: (id: string, speakers?: number): Promise<unknown> =>
    post('/api/ops/notes/detect-people', speakers === undefined ? { note_id: id } : { note_id: id, speakers }),
  /**
   * The recording stopped: attach its audio file and let the remaining
   * pieces finish (without a file: finish what was transcribed).
   */
  finishLive: (id: string, audio?: { blob: Blob; name: string; seconds: number }): Promise<unknown> => {
    if (audio === undefined) return post('/api/ops/notes/finish-live', { note_id: id });
    const form = new FormData();
    form.append('note_id', id);
    form.append('duration', String(audio.seconds));
    form.append('audio', audio.blob, audio.name);
    return postForm('/api/ops/notes/finish-live', form);
  },
  /** Attach an audio file to a note and transcribe the whole file. */
  attachAudio: (id: string, audio: { blob: Blob; name: string; seconds: number }): Promise<unknown> => {
    const form = new FormData();
    form.append('note_id', id);
    form.append('duration', String(audio.seconds));
    form.append('audio', audio.blob, audio.name);
    return postForm('/api/ops/notes/attach-audio', form);
  },
  createText: (fields: Record<string, unknown>): Promise<{ id: string }> => post('/api/ops/notes/create', fields),
  exportNote: (id: string, format: 'md' | 'txt' | 'srt'): Promise<ExportFile> =>
    get('/api/ops/notes/export', { note_id: id, format }),
  digest: (week: string): Promise<Digest> => get('/api/ops/digest/week', { week }),
  engine: (): Promise<EngineStatus> => get('/api/ops/engine/status', {}, true),
  /** Start (or retry) the one-time speech engine download. */
  installEngine: (): Promise<EngineSetup> => post('/api/ops/engine/install', {}),
  clearDone: (id: string): Promise<unknown> => post('/api/ops/actions/clear-done', { note_id: id }),
  searchIds: (q: string): Promise<string[]> =>
    getPbClient()
      .call(
        (pb) =>
          pb.collection('notes').getFullList<{ id: string }>({
            fields: 'id',
            filter: pb.filter(
              'title ~ {:q} || overview ~ {:q} || summary ~ {:q} || transcript ~ {:q} || my_notes ~ {:q} || attendees ~ {:q}',
              { q },
            ),
          }),
        { silent: true },
      )
      .then((rows) => rows.map((r) => r.id)),
};

export function audioUrl(note: Note): string {
  return note.audio === '' ? '' : `/api/files/notes/${note.id}/${encodeURIComponent(note.audio)}`;
}

export function saveFile(file: ExportFile): void {
  const blob = new Blob([file.content], { type: `${file.mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
