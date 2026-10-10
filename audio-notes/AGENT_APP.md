# Audio Notes

Record meetings, interviews, lectures and voice memos (or import audio/video
files, or paste a transcript). Audio is transcribed **on this PC** by a local
Whisper engine and its speakers are told apart by voice (Person 1, Person 2,
...); CraftBot's LLM then writes the notes: summary, key points, decisions,
action items (owner + due date). Weekly digest, search across transcripts,
Markdown / TXT / SRT export.

## Operating it (agents)

Use the ops, never raw data writes: `agent-app ops <project>` lists them.

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

## Pipeline

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

## Recording (frontend)

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

## Engine (`engine/`, downloaded on first run, not built, not backed up)

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

## Data

One collection, `notes` (open rules: `authMode` none, loopback). JSON fields:
`segments [{start,end,text,speaker}]`, `key_points [string]`, `decisions [string]`,
`attendees [string]`, `action_items [{id,title,assignee,due,done}]`. Shapes are
enforced on every save by `lib_notes.normalize`.

## Files

- `pb/pb_hooks/ops.pb.js` routes, `notes.pb.js` record hooks + worker cron,
  `lib_*.js` logic (require inside callbacks).
- `frontend/src/app/` UI; `operations.json` op declarations.
