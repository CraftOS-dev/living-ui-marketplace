/**
 * Crash safety for recordings. Every second of audio is written to this
 * browser's IndexedDB while recording; a take is deleted only after its note
 * is saved on the server. If the page dies mid-meeting (tab closed, CraftBot
 * restarted, browser crash), the take is still here and the app offers to
 * save it on the next load.
 *
 * Storage that is unavailable (private window, blocked site data) only costs
 * the recovery: recording itself never depends on it.
 */

export interface Take {
  id: string;
  /** The note created when this take started (its page shows the recording). */
  noteId: string;
  startedAt: number;
  mimeType: string;
  elapsedMs: number;
  language: string;
  category: string;
  sourceLabel: string;
}

const DB_NAME = 'audio-notes-recorder';
const TAKES = 'takes';
const CHUNKS = 'chunks';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise === null) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = (): void => {
        const db = req.result;
        db.createObjectStore(TAKES, { keyPath: 'id' });
        db.createObjectStore(CHUNKS, { autoIncrement: true }).createIndex('take', 'take');
      };
      req.onsuccess = (): void => resolve(req.result);
      req.onerror = (): void => reject(req.error ?? new Error('IndexedDB unavailable'));
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = (): void => resolve();
    tx.onerror = (): void => reject(tx.error ?? new Error('IndexedDB write failed'));
    tx.onabort = (): void => reject(tx.error ?? new Error('IndexedDB write aborted'));
  });
}

function warn(what: string, err: unknown): void {
  console.warn(`Recording backup: ${what} failed (recovery after a crash will not include it):`, err);
}

export async function putTake(take: Take): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(TAKES, 'readwrite');
    tx.objectStore(TAKES).put(take);
    await done(tx);
  } catch (err) {
    warn('saving the take', err);
  }
}

export async function addChunk(takeId: string, seq: number, blob: Blob): Promise<void> {
  try {
    const db = await open();
    const tx = db.transaction(CHUNKS, 'readwrite');
    tx.objectStore(CHUNKS).add({ take: takeId, seq, blob });
    await done(tx);
  } catch (err) {
    warn('saving a chunk', err);
  }
}

export interface StoredTake {
  take: Take;
  bytes: number;
}

/** Takes left behind by a page that died before saving. */
export async function listTakes(): Promise<StoredTake[]> {
  try {
    const db = await open();
    const tx = db.transaction([TAKES, CHUNKS], 'readonly');
    const takes = await new Promise<Take[]>((resolve, reject) => {
      const r = tx.objectStore(TAKES).getAll();
      r.onsuccess = (): void => resolve(r.result as Take[]);
      r.onerror = (): void => reject(r.error ?? new Error('read failed'));
    });
    const out: StoredTake[] = [];
    for (const take of takes) {
      const chunks = await new Promise<Array<{ blob: Blob }>>((resolve, reject) => {
        const r = tx.objectStore(CHUNKS).index('take').getAll(take.id);
        r.onsuccess = (): void => resolve(r.result as Array<{ blob: Blob }>);
        r.onerror = (): void => reject(r.error ?? new Error('read failed'));
      });
      out.push({ take, bytes: chunks.reduce((n, c) => n + c.blob.size, 0) });
    }
    return out;
  } catch (err) {
    warn('listing unsaved takes', err);
    return [];
  }
}

export async function loadTake(id: string): Promise<Blob | null> {
  const db = await open();
  const tx = db.transaction([TAKES, CHUNKS], 'readonly');
  const take = await new Promise<Take | undefined>((resolve, reject) => {
    const r = tx.objectStore(TAKES).get(id);
    r.onsuccess = (): void => resolve(r.result as Take | undefined);
    r.onerror = (): void => reject(r.error ?? new Error('read failed'));
  });
  if (take === undefined) return null;
  const chunks = await new Promise<Array<{ seq: number; blob: Blob }>>((resolve, reject) => {
    const r = tx.objectStore(CHUNKS).index('take').getAll(id);
    r.onsuccess = (): void => resolve(r.result as Array<{ seq: number; blob: Blob }>);
    r.onerror = (): void => reject(r.error ?? new Error('read failed'));
  });
  chunks.sort((a, b) => a.seq - b.seq);
  return new Blob(
    chunks.map((c) => c.blob),
    { type: take.mimeType },
  );
}

export async function deleteTake(id: string): Promise<void> {
  try {
    const db = await open();
    const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
      const r = db.transaction(CHUNKS, 'readonly').objectStore(CHUNKS).index('take').getAllKeys(id);
      r.onsuccess = (): void => resolve(r.result);
      r.onerror = (): void => reject(r.error ?? new Error('read failed'));
    });
    const tx = db.transaction([TAKES, CHUNKS], 'readwrite');
    tx.objectStore(TAKES).delete(id);
    for (const k of keys) tx.objectStore(CHUNKS).delete(k);
    await done(tx);
  } catch (err) {
    warn('removing a saved take', err);
  }
}
