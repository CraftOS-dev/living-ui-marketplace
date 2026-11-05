# Tasks: Audio Notes

Every task cites what it implements. These features already exist in the published app `audio-notes` 1.0.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-6, F-FRM-7): the sidebar with Record ("Recording <m:ss>" while recording), upload, "More ways to add", Weekly digest and the engine status line, plus the collapsed rail remembered in this browser (`components/Sidebar.tsx`).
- [x] T-2 (F-FRM-3, F-FRM-4, F-FRM-5): the note list from light fields with live updates, the 250 ms search across titles, summaries, transcripts, the user's notes and attendees (server-side ids), the starred and category filter, date groups, and row status icons (`data.ts` `useNoteList`, `api.ts` `searchIds`).
- [x] T-3 (F-FRM-8, F-FRM-9, F-FRM-10): the page-wide drop zone, opening the newest note, the "Record your first note" empty state, and the one-pane layout below 768 px with back arrows (`App.tsx`).
- [x] T-4 (F-REC-1, F-REC-2, F-REC-3): the New recording dialog: the three sources, every microphone with its live meter and state, the -100 dBFS no-signal judge, "Use <name>", the remembered language and category, and explained capture errors (`components/RecordDialog.tsx`, `recorder/useMicPreview.ts`, `recorder/useRecorder.ts`).
- [x] T-5 (F-REC-4, F-REC-5, F-ENG-4, N-1): live recording: the note created at Start, pieces cut at the first pause (2.5–8 s, 16 kHz WAV) and sent to `live_chunks` in order, the live lane transcribing them and appending segments, the engine warmed at start, the language pinned from the first piece, and the following live transcript (`recorder/liveCapture.ts`, `recorder/liveUpload.ts`, `pb_hooks/lib_live.js`, `components/TranscriptPanel.tsx`).
- [x] T-6 (F-REC-6, F-REC-7): the recorder panel and the slim bar on other pages, with the waveform, Pause / Resume, the no-signal (3 s) and quiet (10 s) warnings, and source notices (`components/Recorder.tsx`).
- [x] T-7 (F-REC-8, F-REC-9, F-REC-11): "Stop and save" waits for every piece, then attaches the file through `notes.finish-live` (finishing, remux, peak, done or no speech, then the AI notes). It also covers Discard with its confirmation and "Finish with the transcript so far" for a recording interrupted elsewhere (`App.tsx`, `NoteView.tsx`, `lib_live.js` `finish`).
- [x] T-8 (F-REC-10, F-REC-12): the IndexedDB backup of every second and the recovery banner ("Save as note" back into its own note, or a new one; Discard) (`recorder/takes.ts`, `components/Recovery.tsx`).
- [x] T-9 (F-ADD-1, F-ADD-2): uploads of up to 2 GB as notes queued for transcription, and "New note from text" with the paste box and "Write notes" (`App.tsx` `upload`, `newText`; `notes.create`).
- [x] T-10 (F-NOTE-1, F-NOTE-2, F-NOTE-10): the note's meta row (category, date, length, detected language, star) and the in-place title that turns `title_auto` off (`components/NoteView.tsx`, `components/ui.tsx`, `components/fields.tsx`).
- [x] T-11 (F-NOTE-3, F-NOTE-6, F-NOTE-7, F-NOTE-8, F-NOTE-9): the "More actions" menu: exports, audio download, the Transcribe dialog with the spoken language, Rewrite notes with its confirmation, Duplicate, and Delete with its confirmation (`notes.transcribe`, `notes.generate`, `notes.duplicate`, `notes.delete`).
- [x] T-12 (F-NOTE-4): the pipeline box for every transcript and notes status, the engine wait, progress with time left, and Cancel (`components/Pipeline.tsx`, `notes.cancel`, `lib_worker.js` `cancel`).
- [x] T-13 (F-NOTE-5): the audio player with ±15 s, position, volume, mute and speed, seeking from transcript sentences and turn times, and the playing sentence highlighted (`components/Player.tsx`).
- [x] T-14 (F-NTS-1, F-NTS-2, F-NTS-3): the Notes tab: Summary, Key points, Decisions, Action items and Context edited in place, the bullet lists, and the three empty states (`components/NotesPanel.tsx`, `fields.tsx` `BulletList`).
- [x] T-15 (F-ACT-1, F-ACT-2): inline action items with done, owner and due date, removal, and "Clear <n> done" (`components/ActionItems.tsx`, `actions.clear-done`).
- [x] T-16 (F-TRN-1, F-TRN-2, F-TRN-3, F-TRN-4): the transcript as speaker turns and paragraphs, Edit, Copy, Text and Subtitles, rename from a turn, and the pasted and plain-text transcript views (`components/TranscriptPanel.tsx`, `lib_notes.js` `exportNote`).
- [x] T-17 (F-MINE-1): the My notes tab, also while recording, passed to the AI as context only (`NoteView.tsx`, `lib_ai.js` `buildPrompt`).
- [x] T-18 (F-PPL-1, F-PPL-2, F-PPL-3): attendee chips with rename, remove, add and "Clear all", "Detect speakers" with the speaker count, the "Also heard:" suggestions, and the result toasts (`components/Attendees.tsx`).
- [x] T-19 (F-PPL-2): speaker detection by voice in its own lane, queued after every transcription of audio: the fragment and count rule, the second pass with that many clusters, Person N by first speech, `speaker_names` kept across detections, and the attendee rules (`lib_people.js` `countPeople`, `apply`; `lib_notes.js` `trackAttendeeEdits`).
- [x] T-20 (F-TRN-3, F-AGT-4): `notes.rename-speaker` renames lines, attendees and assigned action items, and merges two speakers given the same name (`lib_people.js` `rename`).
- [x] T-21 (F-DIG-1, F-DIG-2, F-DIG-3, F-DIG-4, F-DIG-5): the weekly digest with week switching, totals, per-note summaries, decisions and tickable action items, "Copy as Markdown", "Download .md" and the empty week (`components/DigestView.tsx`, `lib_notes.js` `digest`).
- [x] T-22 (F-ENG-1, F-ENG-2, F-ENG-3, N-7): the first-run engine download from pinned official releases with SHA-256 checks, resume, Retry, and other lanes waiting until their files are in place, plus the engine banner (`lib_setup.js`, `components/EngineSetup.tsx`).
- [x] T-23 (F-ENG-4, N-2, N-3, N-5): the batch lane: ffmpeg to 16 kHz WAV, the remux of browser recordings, whisper.cpp with Silero VAD, the peak measurement, and no speech found. It runs one job at a time on a wake flag, re-queues interrupted work at boot and kills orphaned processes (`lib_worker.js`, `lib_engine.js`, `notes.pb.js`).
- [x] T-24 (F-NOTE-4, F-AGT-10): the AI notes through the bridge in JSON mode with the exact-shape check, the title kept while set by hand, and the failure messages (`lib_ai.js`, `lib_worker.js` `writeNotes`, `_craftbot_bridge.js` `callLLM`).
- [x] T-25 (F-AGT-1, F-AGT-2, F-AGT-3, F-AGT-5, F-AGT-6, F-AGT-7, F-AGT-8): the 23 operations in `operations.json`, served to agents by `a2app_routes.pb.js` through the same handlers the View calls (`ops.pb.js`). They come with id-or-title note lookup, `actions.open`, exports, the digest and engine status, and approval for destructive operations through the adapter.
- [x] T-26 (F-AGT-9): record hooks that enforce the note shapes, real days and the derived transcript for every writer, and transactional note changes (`notes.pb.js`, `lib_notes.js` `normalize`, `mutate`).

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 23 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
