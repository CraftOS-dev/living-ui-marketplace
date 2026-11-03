# Singing Coach

> Per-project plan, context and index. Keep it current with every change.

## What this app does

One person learns to sing, from matching a first note to recital
repertoire, with their AI agent as coach. The app listens through the
microphone and shows the voice on the **Voice Dial**, an abstract
instrument in place of a keyboard: a half circle whose top is the target
note, a needle and trail for the sung pitch, cents marked to ±50, jaws that
close when the note is held in tune. Beside it a pitch lane (the melody as
bars over time, the voice drawn as a line, the words underneath) or
engraved sheet music. Every note is judged for pitch (octave-folded cents,
on / close / off), onset, scoops and falls, steadiness and vibrato; every
take shows where it went sharp or flat, phrase by phrase. Songs are split
into sections that move from new to learning to steady to mastered, with
spaced reviews; modes are Listen, Echo (phrase by phrase, back to the
guide), Sing (with the guide) and Solo (unaccompanied, judged against the
singer's own key). A daily plan (warm-up first, cool-down last, capped by
the voice's load) says what to sing and for how long; Today shows how it is
going.

It teaches as well as it drills. **Learn** holds 80 interactive lessons in
13 units (the voice, breath, onset and release, resonance and vowels,
registers, pitch matching, rhythm, reading, intervals and harmony, diction,
expression, styles, voice care), each a few pages with pictures you can
hear and tasks you sing or answer. **Train** has a drill for every one of
41 skills: matching and holding pitches, singing and hearing intervals
(nine and three levels), echoing melodies (six levels), melodic memory,
theory quizzes, rhythm spoken and sung, the technique vocalises (33 in the
catalogue, each in the singer's range) and adaptive sight-singing (30
levels, new music every time). **The path** is ten levels in eight tracks;
the learner moves up by themselves when a level is complete. **Reference**
has a tuner and pitch pipe on the dial with a drone, the voice types and
passaggi against your range, intervals, solfège and Curwen hand signs, a
vowel chart sung by the guide voice, every vocalise in your range, a tone
lab (brightness and clarity against your first take: explore, not a
score), the glossary and how the app looks after your voice.

The voice is looked after by rules the coach cannot override: a range
measured once and kept in every key choice, a session cap by level
(20 / 30 / 60 minutes), voiced minutes and fold cycles counted per day,
light days after heavy ones or a poor voice check, a weekly rest day, a
Stop button that ends practice when it hurts, and the four-week rule
(hoarseness on check-ins over 28 days: see an ENT doctor or a
speech-language pathologist). It never diagnoses or suggests medicine.

The coach (CraftBot, the one agent) adds the songs the person asks for
(public-domain or traditional, written in ABC with their words, checked by
the server line by line and verse by verse before they are added), reviews
each session from a compact pack of the takes, proposes the next day's plan
(checked against the health rules) and answers questions about the bars on
screen. Everything measurable is decided by the app, the same way every
time; the agent judges and explains, between sessions.

The look is Piano Coach's quiet instrument: cool greys from the kit tokens,
hairline panels with small mono labels, thin mono readouts, one accent for
the voice; the coach is black and white with a star. Light and dark follow
the host.

The research behind it (vocal coach apps, karaoke scoring, pitch tools,
choir and ear trainers, AI coaches, voice science, pedagogy and grade
syllabi, the technical stack) is in the repo's
`reports/Singing learning software UI UX survey.md` (not shipped).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Microphone: McLeod pitch in an AudioWorklet (main-thread fallback), clarity hysteresis, median smoothing, octave guard; device picker, live meter, room noise check; how you listen (wired, Bluetooth, speakers; speakers make the guide give the start note only); timing test (sing "ta" with eight clicks); "Open in its own tab" when the frame blocks the microphone
- [x] Range test (lowest and highest held a second within ±50 cents), comfortable range, voice family and clef, passaggi (typical for the closest range until glides show where this voice turns), range history
- [x] Practice: Voice Dial (song, hold, free, breath and blind modes), pitch lane or sheet music with words, bar strip by stage, Listen / Echo / Sing / Solo, verses, key shift (best fit for the voice), tempo, loop, guide (formant voice on "oo" or "ah", piano, start note, off), accompaniment (a written piano part as written, else from the chord symbols), drone, metronome, count-in, strictness, feedback fading (full, fade, after), latency compensation, "Stop: it hurts"
- [x] Results per take: on / close / off, in tune share, cents bias and spread, onsets, steadiness, vibrato rate and extent, scoops and falls, drift, Solo offset, per phrase and per bar; a self-estimate before the score; dispute a note
- [x] Progress: section stages per key with spaced reviews; steady after three clean takes at full tempo in a day with one Solo; mastered on a clean cold Solo a later day; reviews 2 … 64 days
- [x] Today: the plan (rules or coach; two sittings when long), week dial, streak, level, KPIs (pitch, in tune, hold, range, load, voice check), 30-day voiced minutes and pitch, voice map, songs in progress, 12-week calendar, coach panel, health banner
- [x] Library: shelves by level, contour tiles over the comfortable range with a fit badge, filters (in progress, new, mastered, fits my voice, vocalises), song panel (range in this key, best key, transpose, sections, best takes, trouble bars, last takes, about the words), add by asking the coach, writing ABC with w: lines (live check with range and fit) or importing ABC / MusicXML with lyrics / UltraStar (a MusicXML piano part is kept as the accompaniment; a file with no chord symbols gets chords worked out from its piano part, or from the melody by a key- and cadence-aware harmoniser, written into the notation)
- [x] Songs from a recording: drop an mp3 (or wav, m4a, ogg, flac, webm) of a song with music or of a voice alone. A song with music is separated into its voice and its music by Demucs v4 (ONNX Runtime Web, WebGPU else WebAssembly, in `stems.worker.ts`), the melody followed in the voice alone (McLeod pitch), the beat in the instruments' onsets, the chords (sevenths, sus4, diminished, inversions) in the other instruments with the bass note of each beat from the bass alone, and the words heard by Whisper small (transformers.js, word times, language told or chosen; loops and stock lines dropped); heard words or pasted lyrics keep their timing (matched character by character, laid by dynamic programming on the nearest notes); the recording, voice (Opus) and music (Opus) are kept and in practice the voice and the music each turn on or off. The models come once through `GET /api/models/part` (pb_hooks/lib_models.js: an allow-list of pinned Hugging Face files fetched in 16 MB range parts and kept in pb/model_cache) and stay in the browser's cache. Without separation (a voice memo, or separation turned off) a worker finds the sung melody (McLeod pitch for a voice; harmonic-sum salience of the mid-minus-side spectrum, Viterbi-tracked, for a mix), the tuning, the notes, the beat (onset autocorrelation and Ellis dynamic programming), the metre and bar 1, the key (Krumhansl–Kessler) and, for a mix, the chords (beat chroma with the bass, Viterbi, cheaper changes on bar lines); the person checks the beat by ear (clicks over the recording) and corrects metre, half or double speed and bar 1; pasted words are split into syllables and laid under the notes; the recording is kept as the song's backing track and plays in Listen, Sing and Echo, with the voice or without it (left minus right, the bass kept), at its own key and full speed (else the piano accompanies)
- [x] Coach: conversation with live request status, songs added under the answer, session reviews, ask again
- [x] Song editor (`#/edit?song=..&back=..`, pages/Editor.tsx with components/editor/Roll.tsx): a piano roll of the sung notes, a chord lane, a lane per verse of words; select, drag (time and pitch), stretch, draw, split, join, copy, delete; type words note by note, drag them between notes, shift them along their line; chords on the beat; key, transpose, metre, pickup, tempo, details and sections beside; play from any bar with the recording; undo/redo; autosave through `songs.update` (held while `songs.check` finds problems); ABC still one click away. The song is `music/songdoc.ts` (ticks of 48 a quarter, syllables per verse on each note) made from the stored ABC and the parsed model and written back by `musicxml.writeSong` (header kept, triplets, ties over bar lines, chords on the melody); the round trip is exact for every starter song. Playback: `music/editplay.ts` (the recording's own beats keep notes and playhead in step)
- [x] Settings: voice and range, microphone and timing, sound, practice and feedback with the coaching rules, voice care (check-ins, session cap, rest day, s/z test, recordings), coach, data export (ABC, UltraStar, session log CSV); first-run dialog
- [x] 41 starter items: 29 public-domain and traditional songs (levels 1-10, English, German, Italian, French; each checked note by note against a named edition; glosses for every non-English song) and 12 original vocalises
- [x] Learn: 80 lessons in 13 units, levels 1-10; tasks sung (a note, a hold, a glide, an echo) or answered; score saved; resume
- [x] Path: ten levels with requirements per track; level-up is automatic
- [x] Train: 41 skills with mastery; quiz, sing, speak, exercise and sight drills
- [x] Reference: tuner, pitch pipe and drone; voice types and passaggi; intervals; solfège and hand signs; vowels; vocalise player; tone lab; glossary; voice care
- [x] Health: load, caps, light and rest days, check-ins, s/z ratio, four-week rule, Stop
- [x] Every UI action has an operation; the agent uses the same ones


### For the agent (checked by an agent trial through the CLI)

- `app.guide` starts everything; `--topic protocol|words|recordings|abc|health|levels|curriculum` returns one part.
- Params an op does not declare are refused for the agent (with the op's params and a "did you mean"), not ignored; person-only ops still refuse the agent as such.
- Words: `songs.words` (bar by bar, note and syllable, notation line), `songs.shift-words` (a note earlier or later to the end of the phrase), `songs.set-words` (a line of words on chosen bars); writing rewrites the w: lines from the syllables (`lib_words.js`, round-trip exact on the starter songs).
- Editing an existing song: add-time rules (public domain, source, span cap) bind the coach only on songs it added; songs with a recording keep their metre, pickup, tempo and bars; `songs.check --song` checks a change as `songs.update` would and counts the notes and syllables it changes.
- `coach.reply` needs `--message` (or `--new true`); `coach.unsend` takes a coach message back within 30 minutes, unread.
- Silent takes (no voice heard) are marked in `review.pack` (`heard`) and `runs.get`, never as 0 cents; `runs.get` labels its tuple columns; `app.state` lists pending messages.
- The editor notices a change made elsewhere (the coach) before saving over it and offers to load it.

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `name`, `daily_minutes`, `session_cap` (0 = the level's; never above it), `strictness`, `feedback`, `syllables`, `minor_do`, `clef`, `guide`, `vowel`, `volume`, `guide_volume`, `accomp_volume`, `click_volume`, `drone`, `metronome`, `count_in`, `view`, `output`, `latency_ms`, `noise_db`, `input_device`, `under18`, `checkins`, `keep_recordings`, `rest_day`, `coach_reviews`, `coach_plans`, `level`, `onboarded`, `seeded`, `last_song`, `coach_seen` | Person only |
| voice | One row per range test: `kind`, `speaking_hz`, `low`, `high`, `comf_low`, `comf_high`, `family`, `clef`, `passaggio`, `breaks`, `sustain_s`, `note` | The newest is the voice |
| songs | `backing` (the recording a song was made from), `backing_voice` and `backing_music` (the voice and the music separated from it), `backing_map` (bpm, beats in seconds, the downbeat of bar 1, quarter notes a beat, where bar 1 is in the song, duration, channels, mix or voice), `title`, `composer`, `kind` (song, vocalise), `level`, `abc`, `model` (parsed: bars, melody, lyrics, phrases, range, chords, engraving events), `preview` (tile contour), `language`, `licence`, `source_note`, `voicing`, `tempo`, `bars`, `seconds`, `key_name`, `meter`, `low`, `high`, `span`, `median`, `tessitura`, `phrases`, `longest_phrase_s`, `syllables`, `verses`, `first_words`, `accompanied`, `sections`, `tags`, `source` (starter, agent, you, import), `starter_key`, `note`, `note_at`, `gloss`, `fav`, `seen`, `archived`, `request` | Re-parsed whenever the notation changes |
| progress | One row per song: `key_shift`, `sections` (stage, best, tries, cleans, days, due, interval), `by_key` (the stages kept per key), `last_at`, `minutes`, `runs` | Only `runs.save` moves stages |
| runs | One per take: song, session, day, mode, bars, verse, key, tempo, guide, feedback, memory, strictness, durations, voiced time, cycles, note counts, pitch and in-tune shares, cents bias and spread, timing, onsets, hold, vibrato, scoops, falls, drift, octave, Solo offset, `clean`, `cold`, `complete`, `per_phrase`, `per_bar`, `per_note`, `map`, `self_estimate`, `disputed`, `results` | |
| tracks | The pitch trace of a take (and its audio only when the person keeps recordings) | Deleted with `runs.forget-audio` |
| sessions | `day`, `started`, `last_at`, `ended`, `minutes`, `voiced_s`, `cycles`, `runs`, `songs`, `warmup_s`, `cooldown_s`, `pain`, `status`, `review`, `review_at`, `review_asked` | |
| checkins | `day`, `session`, `when`, `hoarse`, `effort`, `discomfort`, `high_loss`, `clearing` (1-5), `pain`, `sz_ratio`, `note` | |
| messages | `role`, `kind` (chat, request, review, plan, health), `text`, `song`, `session`, `reply_to`, `context`, `status`, `request_id`, `error` | |
| plans | `day`, `source` (rules, coach), `blocks`, `note`, `status`, `done` | A rules plan is stored when it starts |
| lessons | `key`, `score`, `best`, `attempts`, `done_at` | |
| skills | `key`, `mastery`, `attempts`, `items`, `correct`, `avg_ms`, `level`, `best_level`, `data`, `history`, `last_at` | Only `drills.save` moves mastery |
| drills | `drill`, `skill`, `session`, `day`, `items`, `correct`, `accuracy`, `avg_ms`, `duration_ms`, `voiced_ms`, `cycles`, `tempo_pct`, `level`, `score`, `title`, `detail` | Counts as practice and voice load |

Every collection changes only through the operations (`hooks.pb.js`
refuses direct API writes and names the operation to use).

## Operations

53 operations in `operations.json` (`agent-app ops <project>`):
`ops.list`; `app.guide|state|context|ui`; `settings.get|update`;
`voice.get|test`; `health.get|checkin`;
`songs.list|get|check|add|update|words|shift-words|set-words|open|transpose|backing|remove|restore|reset`;
`runs.save|list|get|dispute|track|forget-audio`;
`sessions.list|get|end|review`; `review.pack`;
`coach.list|get|send|reply|unsend|read|retry`;
`plan.today|start|done|set|reset`; `stats.home|song|voice`;
`learn.state|lesson`; `drills.save|list`; `abc.parse`.

**Identity.** A caller presenting the project's agent token
(`X-A2App-Token`, sent by the agent-app CLI, never seen by pages) is the
agent. Person only: settings, the voice test and check-ins, opening,
transposing, attaching a recording to, removing, restoring and resetting songs, `fav`, everything in
`runs.*` except reads, `sessions.end`, `coach.send|read|retry`,
`plan.start|done|reset`, `app.ui`, `learn.lesson`, `drills.save` (403
`agent_not_permitted`). Coach only: `coach.reply`, `sessions.review` (403
`agent_only`). `plan.set` from the agent is refused when coach plans are
off, and checked against the health rules.

**Songs.** ABC notation in (`lib_abc.js`): Piano Coach's parser (voices,
clefs including `treble-8`, accidentals, ties, tuplets, repeats and
endings, inline fields, dynamics, chord symbols) plus singing: the melody
is the first voice (or `%%melody`), one note at a time; `w:` lines align
syllables note by note (ABC 2.1: `-`, `_`, `*`, `~`, `\-`, `|`), several
`w:` lines are verses, and every count mismatch is an error naming the
line, verse and bar; `!breath!`, `!spoken!`, `!free!`; `%%voice`,
`%%language`, `%%licence`, `%%source`, `%%vowel`. The model adds the
melody (ties merged), the lyrics per verse, phrases (split at rests and
breaths) and the range with its tessitura. `songs.check` answers without
saving, with the fit for the voice; `songs.add` refuses notation with
problems, a span over the level's cap and duplicate titles. Sections
default to phrases of about 4-8 bars and must cover every bar.

**Practice.** The browser judges the singing; `runs.save` (one call per
take) moves the sections the take fully covered, per key (a section learnt
in one key is not mastered in another), extends the session (time, voiced
time, cycles) and suggests the next tempo. Stages: learning on any sung
take; steady after three clean takes at full tempo in a day with one of
them Solo; mastered on a clean Solo at full tempo that is the section's
first Solo of a later day (the cold check); a failed cold check drops it to
steady; reviews after 2, 4, 8 … 64 days. `runs.dispute` re-judges one note
the person disputes; `runs.track` keeps the pitch trace (and the audio only
when recordings are kept).

**The plan.** `plan.today` returns the stored plan or the rules' plan:
warm-up (a straw or lip-trill siren, then the level's scale), due reviews
(one Solo each), the weakest sections of the songs in progress (Echo while
new, Sing up the tempo ladder, Solo at full tempo), the vocalise of the
level's weakest requirement, a new song when nothing is in progress, the
next lesson and a drill for the weakest skill, and a cool-down. A light day
keeps to gentle work; a rest day has no singing; a plan longer than the
session cap splits into two sittings. `plan.set` (the coach) is validated:
total within 1.25× the goal and the cap, a warm-up of 5+ minutes first, a
cool-down of 3+ last, blocks of 2-20 minutes, nothing above the
comfortable top, gentle blocks only on light days.

**Health.** `health.get` gives the load (today's voiced minutes and fold
cycles, the cap, the 4-week mean and the ratio), light and rest days, the
flags and the latest check-in; `health.checkin` records one (and an s/z
ratio). Flags: heavy yesterday, pain yesterday or today, a poor check-in,
the rest day, a ramp over 1.3× the usual week, and the four-week
hoarseness rule. The numbers are design defaults; the copy must be
reviewed by a speech-language pathologist or laryngologist before wide
release.

**Learning.** `lib_curriculum.js` is the index both sides share: 8 tracks,
13 units, the 80 lessons, the 41 skills with their drills and levels, the
33 vocalises (title, skill, level) and the ten levels with their
requirements. Lesson content lives in the frontend (`src/app/learn/`).
`learn.lesson` and `drills.save` record work and call `advance`.

**Lean reads for the agent.** `songs.list` gives one line per song;
`songs.get` leaves the model out for the agent and adds the bar list;
`review.pack` caps takes and weak phrases and carries a `units` line and
the fields the microphone cannot measure; `learn.state` names every
missing requirement by its key; `app.guide` carries the ABC rules, the
level caps and the health rules.

Routes live in `pb/pb_hooks/ops.pb.js` (generated with `operations.json`);
logic in `lib_abc.js`, `lib_model.js`, `lib_voice.js`, `lib_health.js`,
`lib_songs.js`, `lib_runs.js`, `lib_plan.js`, `lib_coach.js`,
`lib_stats.js`, `lib_app.js`, `lib_guide.js`, `lib_starter.js`,
`lib_curriculum.js`, `lib_learn.js`, `lib_rules.js`, `lib_util.js`.

## The frontend

- `App.tsx`: layout, routes (`#/today`, `#/learn`, `#/train`, `#/library?song=`, `#/reference?tab=`, `#/practice?song=&from=&to=&mode=&tempo=&key=&block=`, `#/practice?gen=<exercise>` or `?ex=<lesson.step>` with `&back=`, `#/coach`, `#/settings?section=`), the Practice button (the next plan block), first-run dialog.
- `music/`: `pitch.ts` (McLeod pitch method, worklet source), `mic.ts` (capture without echo cancellation, voicing hysteresis, smoothing, octave guard, noise floor), `audio.ts` (the formant guide voice, piano accompaniment, drone, click; one AudioContext shared with the microphone), `judge.ts` (note, phrase and take judgements), `engine.ts` (listen, echo, sing, solo on the audio clock), `dial.ts` (the Voice Dial on two canvases), `lane.ts` (the pitch lane), `sheet.ts` (VexFlow with lyrics), `generate.ts` (vocalises, sight-singing 1-30, drone, harmony and unaccompanied exercises in the singer's range), `spec.ts`, `transpose.ts`, `play.ts`, `staffmini.ts`, `tone.ts` (brightness and clarity for the tone lab), `analysis.ts` with `transcribe.worker.ts` (a recording, or its separated parts → the sung notes in seconds, the beats, metre, bar 1, key, tuning and chords), `separate.ts` (Demucs: its spectrogram in and out, segments cross-faded), `stems.worker.ts` (separate, listen, hear the words, keep the parts), `models.ts` (the model files in parts, the browser cache), `opus.ts` (Ogg Opus by WebCodecs, else WAV), `lyrics.ts` (heard words as lines, text matched back to their times, syllables of letters and of Japanese, Chinese and Korean, laid on the notes by time), `songdoc.ts` (the song as the editor holds it, keys and transposition, shifting words), `editplay.ts` (playing it), `backing.ts` (a recording decoded once, song quarter ↔ recording seconds), `recording.ts` (the grid the person corrects, words into syllables under the notes, the backing map), `musicxml.ts` (ABC, MusicXML with lyrics and a piano part, and UltraStar in, notes from a recording (`fromNotes`), on a 48-ticks-a-quarter grid with tuplets and ties; chords worked out when a file names none: harmony.ts over piano and melody, else a melody harmoniser (the key's chords scored on strong beats, common progressions, a cadence home; Krumhansl–Schmuckler key finding for UltraStar); UltraStar out), `theory.ts`, `harmony.ts`.
- `learn/`: lesson schema, 13 content units, glossary and vowel table, widgets, `useSing.ts` (sung tasks), drills, the drill runner, the lesson player, figures.
- `pages/`: `Today.tsx`, `Learn.tsx`, `Train.tsx`, `Library.tsx`, `Practice.tsx`, `Reference.tsx`, `Coach.tsx`, `Settings.tsx`.
- `components/`: `Sidebar.tsx`, `ui.tsx`, `charts.tsx` (count-up, sparkline, practice chart, week dial, calendar dots, ring, contour, range bar, voice map, ladders, bar errors), `CheckIn.tsx`, `VoiceSetup.tsx` (microphone, timing, range test), `Onboarding.tsx`, `practice/` (`VoiceDial.tsx`, `BarStrip.tsx`, `SheetView.tsx`, `ResultCard.tsx`), `library/` (`AddSong.tsx`, `SongPanel.tsx`, `NotationEditor.tsx`).
- `theme.css`: `--sc-*` tokens from the kit's `--agent-app-*`, the voice accent, motion (off under reduced motion).
- Drawing runs from one requestAnimationFrame loop on the practice page (engine frame, dial, lane or sheet, bar strip, readouts) without React renders.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `coach_message` | The person writes to the coach (a question or a song request) | `coach.get`; for a song: `songs.list` (no duplicates), write ABC with words at their level and in their range, `songs.check` until ok, `songs.add --message`; for a question: facts from `app.context`, `songs.get`, `review.pack`, `runs.list`, `voice.get`, `health.get`; a question about words or bars: `songs.words`, then `songs.shift-words` / `songs.set-words`; then `coach.reply --message` |
| `session_review` | A session of 3 minutes or more closes and reviews are on | `review.pack --session`, `sessions.review` (3-6 sentences with numbers and the one thing to fix), optionally `songs.update --note` and `plan.set` |

Each needs one approval in CraftBot before it can run.

## External data

None. Everything stays on this computer: the guide voice, piano and drone
are synthesised, the sheet music font is bundled, the microphone is
analysed in the browser, recordings are kept only when the person asks.

## Background jobs

- `sc_tick` (every minute): the starter library (all of it on a fresh install, new additions after an update); sessions quiet for 20 minutes closed; reviews asked for closed sessions of 3 minutes or more.

## Gotchas

- The microphone needs `microphone` in the host frame's `allow` list; when blocked the app offers "Open in its own tab". Nothing touches the microphone or audio on page load.
- Capture turns off echo cancellation, noise suppression and auto gain (they bend pitch); speakers therefore leak the guide into the microphone, so with speakers the guide gives the start note only.
- Browsers start audio only after a gesture; `audio.unlockOnGesture()` resumes the context on the first one.
- Hooks do not hot-reload: restart the app after a hook change.
- `lib_abc.js`, `lib_curriculum.js` and `lib_starter.js` are plain JavaScript and run in node for tests: parse every starter song and lesson example after changing them.
- Never call `.reverse()` on what `findRecordsByFilter` returns: copy with `Array.from` first.
- The system rate limit is 300 `/api/ops/` calls a minute, shared with the agent: one `runs.save` per take.
- Days are local calendar days of the machine.
- The model has a version (`model.v`, now 3: melody, lyrics, phrases, range); `songs.open` re-parses older ones.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (overwritten by kit-sync): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, `frontend/src/app.css`, `frontend/vite.config.ts`, `pb/pb_hooks/_*.js`, `pb/pb_hooks/cache_control.pb.js`.
