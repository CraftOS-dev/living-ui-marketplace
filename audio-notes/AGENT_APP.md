# Audio Notes

Record meetings, interviews, lectures and voice memos (or import audio/video
files, or paste a transcript). Audio is transcribed **on this PC** by a local
Whisper engine and its speakers are told apart by voice (Person 1, Person 2,
...); CraftBot's LLM then writes the notes: summary, key points, decisions,
action items (owner + due date). Weekly digest, search across transcripts,
Markdown / TXT / SRT export.

## Plan

Audio Notes.

## Modules

Every operation and every collection an agent can reach belongs to one module. `a2app <app>` lists them; `a2app <app> <module>` lists a module's operations.

| Module | Operations | Collections |
| --- | --- | --- |
| `notes` | 15 | `notes` |
| `actions` | 5 | — |
| `digest` | 1 | — |
| `engine` | 2 | — |
| `records` | 0 | `live_chunks` |

## Entities

See `reference/requirements.md` § Data Requirements.

## Operations

Call an operation with `a2app <app> <module> <operation> --param value` (`<app>` is the app directory, its id or its name). A destructive one first answers `approval_required` with an approval key: ask the person, then repeat the call with `--approve <key>`. `a2app <app> --find <word>` locates an operation by name. Every operation below runs the same handler the app's own screens use.

### notes

- `notes.list` *(read-only)* — List notes, newest first, with summary, status and open action count. Filters combine. Params: `q` (string), `category` (string), `starred` (boolean), `from` (string), `to` (string), `limit` (number).
- `notes.get` *(read-only)* — One note in full: summary, key points, decisions, action items (with ids), attendees, my notes, transcript and timed segments (each with its speaker once detected: Person 1, Person 2, ...), plus pipeline status (live = recording now, finishing = transcribing its last seconds). peak_db at -91 means the audio is pure silence (nothing was recorded). Params: `note_id` (string, required), `include_transcript` (boolean).
- `notes.create` — Create a note from text (no audio), e.g. a pasted meeting transcript. With a transcript, CraftBot's AI writes the summary, key points, decisions and action items in the background. Params: `title` (string), `date` (string), `category` (string), `transcript` (string), `my_notes` (string), `attendees` (string), `generate` (boolean).
- `notes.import-audio` — Import an audio or video file from a local path as a new note. It is transcribed on this PC (Whisper), then CraftBot's AI writes the notes. Poll notes.get or engine.status for progress. Params: `path` (string, required), `title` (string), `date` (string), `category` (string), `language` (string).
- `notes.update` — Edit a note's fields. Only the params given change. Setting title stops the AI from renaming the note. Params: `note_id` (string, required), `title` (string), `date` (string), `category` (string), `starred` (boolean), `overview` (string), `summary` (string), `my_notes` (string), `attendees` (string), `key_points` (string), `decisions` (string), `language` (string), `action_items` (string), `transcript` (string).
- `notes.delete` *(destructive)* — Delete a note with its audio and transcript. Stops its transcription if running. Params: `note_id` (string, required).
- `notes.duplicate` — Copy a note, including its audio file, transcript and notes. Params: `note_id` (string, required).
- `notes.transcribe` — Transcribe (or re-transcribe) a note's audio on this PC. The current transcript stays until the new one is ready. Notes are written automatically only when the note has none yet; otherwise run notes.generate. Params: `note_id` (string, required), `language` (string).
- `notes.generate` — Have CraftBot's AI (re)write the note from its transcript: overview, summary, key points, decisions, action items, and the title while it is automatic. Replaces those fields; attendees and my_notes are kept. Params: `note_id` (string, required).
- `notes.attach-audio` — Attach an audio file to an existing note and transcribe it (multipart upload with an "audio" file; used by the app). To add a file from disk as a new note use notes.import-audio. Params: `note_id` (string, required), `duration` (number).
- `notes.finish-live` — Finish a recording whose page stopped while recording (status live): transcribe the pieces already received, then write the notes. The app's own Stop button does this and also attaches the audio file. Params: `note_id` (string, required).
- `notes.detect-people` — Tell the speakers of a recorded note apart by their voices (local speaker engine, no names guessed): each transcript segment gets its speaker (Person 1, Person 2, ... in order of first speech) and the attendees gain every speaker, including ones removed before. Runs by itself after every transcription; use this to redo it, or with speakers=N when the number of people is known and the detection got it wrong. Poll notes.get people_status (people_error says why a run failed). Params: `note_id` (string, required), `speakers` (number).
- `notes.rename-speaker` — Rename a speaker (e.g. Person 1) or attendee everywhere in a note: the transcript lines they speak, the attendees, and action items assigned to them. A detected voice keeps the name through later speaker detections. Renaming to another speaker's name merges the two (fixes one voice detected as two people). Params: `note_id` (string, required), `speaker` (string, required), `name` (string, required).
- `notes.cancel` — Cancel a note's queued or running transcription / note writing. The note keeps whatever it already had. Params: `note_id` (string, required).
- `notes.export` *(read-only)* — Export a note as text: md (full note), txt (timestamped transcript) or srt (subtitles). Returns {filename, mime, content}. Params: `note_id` (string, required), `format` (md|txt|srt).

### actions

- `actions.add` — Add an action item to a note. Params: `note_id` (string, required), `title` (string, required), `assignee` (string), `due` (string).
- `actions.update` — Edit or complete an action item (ids come from notes.get or actions.open). Params: `note_id` (string, required), `action_id` (string, required), `title` (string), `assignee` (string), `due` (string), `done` (boolean).
- `actions.delete` *(destructive)* — Remove an action item from a note. Params: `note_id` (string, required), `action_id` (string, required).
- `actions.clear-done` *(destructive)* — Remove a note's completed action items. Params: `note_id` (string, required).
- `actions.open` *(read-only)* — Every open action item across all notes, soonest due first. Params: `assignee` (string).

### digest

- `digest.week` *(read-only)* — Weekly digest (Monday to Sunday): totals, each note's summary, decisions and action items, plus a ready-to-share markdown version. Params: `week` (string).

### engine

- `engine.status` *(read-only)* — Speech engine: installed or missing files, the first-run download (setup: state ready|pending|off|downloading|installing|failed, bytes done/total, error), the running job with progress percent, and queue sizes.
- `engine.install` — Download the speech engine (~410 MB, once) from its official sources into the app's engine folder, checking every file's SHA-256; starts by itself on a fresh install, so use this to retry after a failed download. Returns the setup status; follow engine.status.

## Conventions

### Operating it (agents)

Use the ops, never raw data writes: `a2app <app>` lists them.

- Find notes: `notes.list` (q searches titles, summaries and transcripts), `notes.get`.
- Add audio: `notes.import-audio --path <absolute file path>` (any audio/video ffmpeg reads).
  Transcription and notes then run in the background; follow `engine.status` or
  `notes.get` (`transcript_status`, `notes_status`).
- Add text: `notes.create --transcript "<pasted transcript>"` writes notes from it.
- Redo: `notes.transcribe` (optionally `--language ja`), `notes.generate` (rewrites the
  AI sections; `my_notes` is never touched), `notes.cancel`.
- Speakers: `notes.detect-people` (`--speakers 2` when the number of people is
  known and detection got it wrong; `--speakers 0` = detect the number).
  Name them: `notes.rename-speaker --speaker "Person 1" --name "Aiko"` (lines,
  attendees and action items follow; naming one like another merges them).
- Tasks: `actions.open` (all open action items, soonest due first), `actions.add`,
  `actions.update --done true`, `actions.clear-done`.
- Share: `notes.export --format md|txt|srt`, `digest.week`.
- Every `note_id` accepts the record id or the note's exact title.

### Pipeline

Recordings are transcribed LIVE: pressing Start creates the note (`live`) and
opens its page, which is the recorder (live transcript + My notes tabs; a slim
bar shows the recording only while another page is open). The browser cuts the
audio at pauses into 5-12 s 16 kHz WAV pieces (`recorder/liveCapture.ts`) and
uploads them to `live_chunks`; the live lane (`pb_hooks/lib_live.js`, its own
cron + wake flag, separate from the batch lane) transcribes them in order and
appends segments. Pieces are 2.5-8 s, cut at the first pause, and whisper's
encoder window is sized to the piece (`-ac`), so a sentence appears ~2.5 s
after it is spoken (measured median); the engine is warmed when a recording
starts. Stop uploads the audio
file and calls `notes.finish-live` (`finishing`); when every piece is done the
note is finalized (remux, peak, done/no_speech) and the AI notes are queued.
A page that died mid-recording leaves a `live` note: its page offers "Finish
with the transcript so far", and a browser backup of the audio is reattached.

Speakers are told apart by their VOICES, never by names read in the text
(`pb_hooks/lib_people.js`, its own lane, after a recording or file is
transcribed and on Detect speakers / `notes.detect-people`). The diarizer
splits the whole recording into voices. One real voice can split into
several (a person talking vs pitching), so `countPeople` drops fragments
(under max(3 s, 1% of speech)) and counts a voice as one of K people only
when it, plus the smaller voices, says at least 1/2K of the speech; when
that merges voices the diarizer runs again with that many clusters. People
are Person 1, Person 2, ... in order of first speech. Every segment gets the
person speaking most during it (`segment.speaker`), `people_found` holds the
people heard, and `attendees` gains each one the user has not removed
(`people_removed`, kept by the update op on the user's attendee edits). A
re-detection takes off the list people an earlier detection added and no
longer hears; typed names are never touched. `speaker_count` (set by the
user) fixes the number of people instead of detecting it. `speaker_names` maps
each detection label to its name, so a renamed person keeps the name when the
speakers are detected again.

Uploads and imports take the batch path:

1. A note is created with `transcript_status = queued` (upload, import).
2. The worker (`pb_hooks/lib_worker.js`, cron + in-memory wake flag, one job at a
   time) converts the audio with ffmpeg to 16 kHz WAV, remuxes browser recordings
   (adds the seek index MediaRecorder leaves out), runs whisper.cpp with Silero VAD,
   and stores timed `segments`; `transcript` is derived from them. No speech found =
   `no_speech` (VAD means silence never becomes invented text).
3. The first transcript queues `notes_status = queued`; the worker asks CraftBot's
   LLM through the bridge in JSON mode and validates the reply's exact shape
   (`pb_hooks/lib_ai.js`). A mismatched reply fails the run (retry), it is never
   patched up. The title is replaced only while `title_auto` is true.

Status fields are worker-owned; empty means that step never ran. Both lanes
idle on their wake flag until 2 s before the next cron tick, so new work never
waits more than a couple of seconds. A note that was
processing when the app stopped is re-queued at boot, and an orphaned engine
process is killed (matched by pid and image name).

### Recording (frontend)

`frontend/src/app/recorder/`: microphone, tab/screen audio, or both mixed. Never
records a substitute stream: a refused or missing source is an explained error.
The record dialog opens every microphone and shows a live level per device;
an input that never rises above -100 dBFS (virtual devices such as Steam's
microphone, muted endpoints) is marked "no signal" and cannot be started.
While recording: a red alert after 3 s of no signal, an amber one after 10 s
without sound above room noise. The dialog always opens on Microphone ("tab
audio only" does not record the microphone; remembering it caused a silent
recording). The worker stores each file's peak (`peak_db`, ffmpeg
volumedetect); at -91 dB the note is reported as completely silent.
Every second is backed up to IndexedDB; an unsaved take (closed tab, crash)
is offered for saving on the next load.

Inside CraftBot the app is a cross-origin frame: the host must delegate
`microphone` / `display-capture` (CraftBot's iframePool sets `allow`).

### Engine (`engine/`, downloaded on first run, not built, not backed up)

The engine (~420 MB) is not part of the app package. `pb_hooks/lib_setup.js`
(its own cron lane) downloads it once into `engine/` on the first launch,
from each project's official release pinned to the build below, using only
Windows' own `curl.exe`, `tar.exe` and `certutil.exe`. Every download and
every file taken out of one is checked against its SHA-256 before it is moved
into place; a mismatch stops the setup and nothing unchecked is run. A partial
download resumes; a failed one waits for `engine.install` (the Retry button
in the banner). Shadow boots (`CRAFTBOT_APP_ENV=shadow`) never start it by
themselves. While it runs, queued transcriptions, live pieces and speaker
detections stay queued (`lib_setup.waiting`) and start as soon as their files
are in place; `engine.status` reports it under `setup`.

| File | Source |
|------|--------|
| `bin/whisper-cli.exe` + DLLs | whisper.cpp release b5130 (GitHub), `whisper-blas-bin-x64.zip` |
| `bin/ffmpeg.exe` | ffmpeg 9.0.2 essentials (GitHub GyanD/codexffmpeg) |
| `models/ggml-small-q5_1.bin` | huggingface.co/ggerganov/whisper.cpp (pinned commit) |
| `models/ggml-silero-v6.2.0.bin` | huggingface.co/ggml-org/whisper-vad (pinned commit) |
| `bin/sherpa-onnx-offline-speaker-diarization.exe` | sherpa-onnx 1.13.8, PyPI `sherpa-onnx-bin` wheel (the release build apart from its link timestamp; the GitHub `.tar.bz2` cannot be opened by Windows' tar) |
| `bin/onnxruntime.dll` | sherpa-onnx 1.13.8, PyPI `sherpa-onnx-core` wheel (identical to the release's) |
| `models/pyannote-segmentation-3-0.onnx` | huggingface.co/csukuangfj/sherpa-onnx-pyannote-segmentation-3-0 `model.onnx` (MIT) |
| `models/nemo_en_titanet_small.onnx` | sherpa-onnx release `speaker-recongition-models` |

Settings (measured on an i7-6700): small model, greedy decoding (`-bs 1 -bo 1`),
half the logical CPUs as threads: about 0.24x real time, so a 26-minute meeting
transcribes in about 6 minutes. 99 languages, auto-detected unless set.
Speaker detection: window shift 0.5, threshold 0.8; the real 35-minute call
took 284 s (two passes, as its voices merged), a fixed count 113 s. Model choice and the count
rule were measured on the user's real 2-person call and clean 2- and
4-speaker recordings (see `lib_engine.diarizeArgs`, `lib_people.countPeople`).

### Data

One collection, `notes` (open rules: `authMode` none, loopback). JSON fields:
`segments [{start,end,text,speaker}]`, `key_points [string]`, `decisions [string]`,
`attendees [string]`, `action_items [{id,title,assignee,due,done}]`. Shapes are
enforced on every save by `lib_notes.normalize`.

### Files

- `pb/pb_hooks/ops.pb.js` routes, `notes.pb.js` record hooks + worker cron,
  `lib_*.js` logic (require inside callbacks).
- `frontend/src/app/` UI; `operations.json` op declarations.

### Ownership map

- **System-owned (hash-locked, from the `blueprint-pocketbase-kit` toolkit — never edit):** `manifest.json`, `pb-serve.mjs`, `pb-fetch.mjs`, `pb-check.mjs`, `pb-build.mjs`, `pb/pb_hooks/_a2app.pb.js`, `pb/pb_hooks/_a2app_impl.js`, `pb/pb_hooks/_a2app_rules.js`, `pb/pb_hooks/_compat_lib.js`, `pb/pb_hooks/_compat_rules.js`, `pb/pb_hooks/_compat_system.js`, `pb/pb_hooks/_system.pb.js`, `pb/pb_hooks/_triggers.pb.js`, `pb/pb_hooks/_triggers_lib.js`, `pb/pb_hooks/_craftbot_bridge.js`.
- **Agent-owned:** `operations.json`, `events.json`, `AGENT_APP.md`, `reference/`, `pb/pb_hooks/a2app_routes.pb.js` (regenerate with `tools/agent-app-migrate` rather than hand-edit), every other file under `pb/pb_hooks/` and `pb/pb_migrations/`, and `frontend/`.

## Checklist

Build and verification tasks live in `reference/tasks.md`.
