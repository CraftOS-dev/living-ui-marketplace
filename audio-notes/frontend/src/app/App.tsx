import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines, Mic, Upload } from 'lucide-react';
import { Button, EmptyState, Spinner, cn, getPbClient, toast, useDebounce } from '../kit/index.ts';
import { api } from './api.ts';
import { DigestView } from './components/DigestView.tsx';
import { EngineSetup } from './components/EngineSetup.tsx';
import { NoteView } from './components/NoteView.tsx';
import { RecordDialog } from './components/RecordDialog.tsx';
import { RecorderBar } from './components/Recorder.tsx';
import { Recovery } from './components/Recovery.tsx';
import { Sidebar } from './components/Sidebar.tsx';
import { useEngine, useNoteList } from './data.ts';
import { localDay, recall, remember } from './format.ts';
import type { Piece } from './recorder/liveCapture.ts';
import { LiveUploader } from './recorder/liveUpload.ts';
import { deleteTake, type Take } from './recorder/takes.ts';
import { useRecorder, type RecOptions, type RecResult } from './recorder/useRecorder.ts';
import type { View } from './types.ts';
import './styles.css';

const MAX_UPLOAD_BYTES = 2 * 1024 * 1024 * 1024;
const EXT: Record<string, string> = { 'audio/webm': 'webm', 'audio/ogg': 'ogg', 'audio/mp4': 'm4a' };

function stampOf(d: Date): string {
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function audioName(take: Take): string {
  const started = new Date(take.startedAt);
  const ext = EXT[take.mimeType.split(';')[0] ?? ''] ?? 'webm';
  return `recording-${localDay(started)}-${started.getHours()}${String(started.getMinutes()).padStart(2, '0')}.${ext}`;
}

/** The note a take belongs to, or null when it no longer exists. */
async function findNote(id: string): Promise<{ id: string; transcript_status: string; audio: string } | null> {
  if (id === '') return null;
  try {
    return await getPbClient().call(
      (pb) => pb.collection('notes').getOne<{ id: string; transcript_status: string; audio: string }>(id, { fields: 'id,transcript_status,audio' }),
      { silent: true },
    );
  } catch {
    return null;
  }
}

export function App(): React.JSX.Element {
  const { notes, loading, error, version } = useNoteList();
  const [view, setView] = useState<View>({ kind: 'none' });
  const [listOpen, setListOpen] = useState(true);
  const [recordOpen, setRecordOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('all');
  const [matchIds, setMatchIds] = useState<Set<string> | null>(null);
  const [recoveryKey, setRecoveryKey] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [collapsed, setCollapsed] = useState(() => recall('sidebar', 'open') === 'collapsed');
  const fileInput = useRef<HTMLInputElement | null>(null);
  const uploaders = useRef(new Map<string, LiveUploader>());
  const debounced = useDebounce(query, 250);

  const open = useCallback((id: string) => {
    setView({ kind: 'note', id });
    setListOpen(false);
  }, []);

  const onPiece = useCallback((noteId: string, piece: Piece) => {
    let up = uploaders.current.get(noteId);
    if (up === undefined) {
      up = new LiveUploader(noteId);
      uploaders.current.set(noteId, up);
    }
    up.push(piece);
  }, []);

  /**
   * A finished take: wait for its live pieces to arrive, attach the audio
   * file to its note, then let the note finish (or, without live pieces,
   * queue a full transcription).
   */
  const finishTake = useCallback(async (blob: Blob, take: Take, live: boolean): Promise<void> => {
    // Every piece is on the server before the note is told to finish.
    await uploaders.current.get(take.noteId)?.drain();
    const audio = { blob, name: audioName(take), seconds: Math.round(take.elapsedMs / 1000) };
    if (live) await api.finishLive(take.noteId, audio);
    else await api.attachAudio(take.noteId, audio);
    uploaders.current.delete(take.noteId);
    await deleteTake(take.id);
  }, []);

  const onFinished = useCallback(
    (result: RecResult) => {
      void finishTake(result.blob, result.take, result.live)
        .then(() => toast.success(result.live ? 'Recording saved. Finishing the transcript...' : 'Recording saved. Transcribing on this PC...'))
        .catch(() => {
          toast.error('The recording could not be saved to the app. It is kept in this browser; save it from the banner.');
          setRecoveryKey((k) => k + 1);
        });
    },
    [finishTake],
  );
  const rec = useRecorder(onFinished, onPiece);
  const recordingNoteId = rec.phase === 'recording' || rec.phase === 'paused' ? rec.noteId : null;

  const busy = notes.some((n) =>
    ['queued', 'processing', 'finishing'].includes(n.transcript_status) || n.notes_status === 'queued' || n.notes_status === 'processing',
  );
  const { engine, refresh: refreshEngine } = useEngine(busy);

  // Open the newest note when nothing is selected.
  useEffect(() => {
    if (view.kind === 'none' && notes[0] !== undefined) setView({ kind: 'note', id: notes[0].id });
  }, [notes, view]);

  // Search covers transcripts too, so it asks the server for matching ids.
  useEffect(() => {
    const q = debounced.trim();
    if (q === '') {
      setMatchIds(null);
      return;
    }
    let live = true;
    void api
      .searchIds(q)
      .then((ids) => {
        if (live) setMatchIds(new Set(ids));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [debounced, version]);

  /** Start: the note is created once the sources are open, and its page opens. */
  const startRecording = (opts: RecOptions): Promise<void> =>
    rec.start(opts, async () => {
      const now = new Date();
      const fd = new FormData();
      fd.append('title', `Recording, ${stampOf(now)}`);
      fd.append('title_auto', 'true');
      fd.append('date', localDay(now));
      fd.append('category', opts.category);
      fd.append('source', 'recording');
      fd.append('language', opts.language);
      fd.append('transcript_status', 'live');
      const note = await api.createNote(fd);
      open(note.id);
      return note.id;
    });

  const discardRecording = (): void => {
    const id = rec.noteId;
    rec.discard();
    if (id === null) return;
    uploaders.current.delete(id);
    void api
      .deleteNote(id)
      .then(() => toast.success('Recording discarded'))
      .catch(() => undefined);
    setView({ kind: 'none' });
  };

  /** A take recovered from this browser: back into its own note when it still exists. */
  const recoverTake = async (blob: Blob, take: Take): Promise<void> => {
    const note = await findNote(take.noteId);
    const audio = { blob, name: audioName(take), seconds: Math.round(take.elapsedMs / 1000) };
    if (note !== null) {
      if (note.transcript_status === 'live') await api.finishLive(note.id, audio);
      else await api.attachAudio(note.id, audio);
      await deleteTake(take.id);
      open(note.id);
      return;
    }
    const fd = new FormData();
    fd.append('audio', blob, audioName(take));
    fd.append('duration', String(Math.round(take.elapsedMs / 1000)));
    fd.append('title', `Recording, ${stampOf(new Date(take.startedAt))}`);
    fd.append('title_auto', 'true');
    fd.append('date', localDay(new Date(take.startedAt)));
    fd.append('category', take.category);
    fd.append('source', 'recording');
    fd.append('language', take.language);
    fd.append('transcript_status', 'queued');
    const created = await api.createNote(fd);
    await deleteTake(take.id);
    open(created.id);
  };

  const upload = async (file: File): Promise<void> => {
    if (file.size > MAX_UPLOAD_BYTES) {
      toast.error(`${file.name} is larger than 2 GB.`);
      return;
    }
    const fd = new FormData();
    const dot = file.name.lastIndexOf('.');
    fd.append('title', (dot > 0 ? file.name.slice(0, dot) : file.name).slice(0, 200));
    fd.append('title_auto', 'true');
    fd.append('date', localDay());
    fd.append('category', recall('category', 'Meeting'));
    fd.append('source', 'upload');
    fd.append('language', recall('language', 'auto'));
    fd.append('transcript_status', 'queued');
    fd.append('audio', file, file.name);
    toast.info(`Uploading ${file.name}...`);
    try {
      const note = await api.createNote(fd);
      toast.success('Uploaded. Transcribing on this PC...');
      open(note.id);
    } catch {
      /* the client already reported the error */
    }
  };

  const newText = (): void => {
    void api
      .createText({ date: localDay(), category: recall('category', 'Meeting') })
      .then((n) => open(n.id))
      .catch(() => undefined);
  };

  const onRecord = (): void => {
    if (recordingNoteId !== null) open(recordingNoteId);
    else setRecordOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <Spinner />
      </div>
    );
  }
  if (error !== null && notes.length === 0) {
    return <p className="p-8 text-center text-sm text-red-600">Could not load notes: {error}</p>;
  }

  const viewingRecording = view.kind === 'note' && view.id === recordingNoteId;

  return (
    <div
      className="relative flex h-screen overflow-hidden"
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        for (const f of Array.from(e.dataTransfer.files)) void upload(f);
      }}
    >
      <Sidebar
        className={cn(listOpen ? 'flex' : 'hidden', 'md:flex')}
        notes={notes}
        matchIds={matchIds}
        query={query}
        onQuery={setQuery}
        filter={filter}
        onFilter={setFilter}
        view={view}
        onSelect={open}
        onDigest={() => {
          setView({ kind: 'digest' });
          setListOpen(false);
        }}
        onRecord={onRecord}
        onUpload={() => fileInput.current?.click()}
        onNewText={newText}
        recordingNoteId={recordingNoteId}
        recordingMs={rec.elapsedMs}
        engine={engine}
        collapsed={collapsed}
        onToggleCollapse={() => {
          remember('sidebar', collapsed ? 'open' : 'collapsed');
          setCollapsed(!collapsed);
        }}
      />
      <main className={cn('min-w-0 flex-1 flex-col overflow-y-auto', listOpen ? 'hidden' : 'flex', 'md:flex')}>
        {!viewingRecording && recordingNoteId !== null && <RecorderBar rec={rec} onOpen={() => open(recordingNoteId)} onDiscard={discardRecording} />}
        <Recovery
          key={recoveryKey}
          skip={rec.takeId}
          onSave={async (blob, take) => {
            await recoverTake(blob, take);
            toast.success('Recovered recording saved.');
          }}
        />
        <EngineSetup engine={engine} onChange={refreshEngine} />
        {view.kind === 'digest' ? (
          <DigestView version={version} onOpen={open} onBack={() => setListOpen(true)} />
        ) : view.kind === 'note' ? (
          <NoteView
            key={view.id}
            noteId={view.id}
            engine={engine}
            rec={rec}
            onBack={() => setListOpen(true)}
            onDeleted={() => setView({ kind: 'none' })}
            onOpen={open}
            onDiscardRecording={discardRecording}
          />
        ) : (
          <EmptyState
            className="my-auto"
            icon={<AudioLines size={18} />}
            title="Record your first note"
            message="Record a meeting or drop in an audio or video file. It is transcribed on this PC as you go, then CraftBot writes the summary, decisions and action items."
            action={
              <div className="flex gap-2">
                <Button onClick={onRecord}>
                  <Mic size={15} />
                  Record
                </Button>
                <Button variant="secondary" onClick={() => fileInput.current?.click()}>
                  <Upload size={15} />
                  Upload
                </Button>
              </div>
            }
          />
        )}
      </main>

      <input
        ref={fileInput}
        type="file"
        multiple
        accept="audio/*,video/*,.m4a,.opus,.flac,.webm,.mkv"
        className="hidden"
        onChange={(e) => {
          for (const f of Array.from(e.target.files ?? [])) void upload(f);
          e.target.value = '';
        }}
      />
      {recordOpen && <RecordDialog open={recordOpen} onOpenChange={setRecordOpen} onStart={startRecording} />}
      {dragging && (
        <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center bg-[var(--agent-app-bg)]/80 backdrop-blur-sm">
          <div className="rounded-2xl border-2 border-dashed border-[var(--agent-app-accent)] px-10 py-8 text-center">
            <Upload size={22} className="mx-auto mb-2 text-[var(--agent-app-accent)]" />
            <p className="text-sm font-semibold">Drop audio or video to transcribe</p>
          </div>
        </div>
      )}
    </div>
  );
}
