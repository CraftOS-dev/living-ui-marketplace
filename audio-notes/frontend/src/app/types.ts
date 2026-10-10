import type { RecordModel } from 'pocketbase';

/** '' = that step never ran for this note. live = being recorded (pieces
 *  transcribed as they arrive); finishing = recording stopped, last pieces. */
export type TranscriptStatus = '' | 'queued' | 'processing' | 'done' | 'no_speech' | 'failed' | 'live' | 'finishing';
export type NotesStatus = '' | 'queued' | 'processing' | 'done' | 'failed';
export type NoteSource = '' | 'recording' | 'upload' | 'import' | 'text';

export interface Segment {
  start: number;
  end: number;
  text: string;
  /** Who speaks, told apart by voice ('Person 1', ...); '' or absent until detected. */
  speaker?: string;
}

export interface ActionItem {
  id: string;
  title: string;
  assignee: string;
  due: string;
  done: boolean;
}

/** The fields the note list loads (no transcript, segments or long text). */
export interface NoteSummary extends RecordModel {
  title: string;
  date: string;
  category: string;
  starred: boolean;
  source: NoteSource;
  duration: number;
  transcript_status: TranscriptStatus;
  notes_status: NotesStatus;
  summary: string;
  attendees: string[] | null;
}

export interface Note extends NoteSummary {
  title_auto: boolean;
  audio: string;
  /** Loudest moment in dBFS, measured at transcription (0 until then); -91 = digital silence. */
  peak_db: number;
  language: string;
  detected_language: string;
  transcript_error: string;
  notes_error: string;
  transcript: string;
  segments: Segment[] | null;
  overview: string;
  key_points: string[] | null;
  decisions: string[] | null;
  action_items: ActionItem[] | null;
  my_notes: string;
  /** The people the last speaker detection heard ('Person 1', ...). */
  people_found: string[] | null;
  /** Names the user took off the attendees; detection never re-adds them. */
  people_removed: string[] | null;
  people_status: '' | 'queued' | 'processing' | 'done' | 'failed';
  /** Why the last speaker detection failed. */
  people_error: string;
  /** How many people speak, when the user set it (0 = detect the number). */
  speaker_count: number;
  /** Names of detected voices by detection label ({"Person 2": "Aiko"}). */
  speaker_names: Record<string, string> | null;
}

export const LIST_FIELDS =
  'id,collectionId,collectionName,created,updated,title,date,category,starred,source,duration,transcript_status,notes_status,summary,attendees';

export interface EngineJob {
  note_id: string;
  stage: 'converting' | 'transcribing' | 'writing_notes';
  percent: number | null;
  audio_seconds: number;
  elapsed_seconds: number;
}

/**
 * The one-time engine download (pb_hooks/lib_setup.js). pending: starts by
 * itself within a minute; off: waits for the user to start it.
 */
export interface EngineSetup {
  state: 'ready' | 'pending' | 'off' | 'downloading' | 'installing' | 'failed';
  step: string;
  done_bytes: number;
  total_bytes: number;
  error: string;
}

export interface EngineStatus {
  installed: boolean;
  missing: string[];
  model: string;
  busy: boolean;
  job: EngineJob | null;
  queued: { transcriptions: number; notes: number };
  setup: EngineSetup;
}

export interface DigestNote {
  id: string;
  title: string;
  date: string;
  category: string;
  duration_seconds: number;
  summary: string;
  decisions: string[];
  action_items: ActionItem[];
  attendees: string[];
}

export interface Digest {
  week_start: string;
  week_end: string;
  totals: { notes: number; recorded_seconds: number; open_actions: number; done_actions: number; people: number };
  notes: DigestNote[];
  markdown: string;
}

export interface ExportFile {
  filename: string;
  mime: string;
  content: string;
}

export type View = { kind: 'note'; id: string } | { kind: 'digest' } | { kind: 'none' };
