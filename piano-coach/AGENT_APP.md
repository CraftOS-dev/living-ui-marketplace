# Piano Coach

> Per-project plan, context and index. Keep it current with every change.

## What this app does

One person learns piano, from the first keys to concert repertoire, with
their AI agent as coach. The app listens (a digital piano over MIDI, the
computer keys, the keys on screen, or an acoustic piano through the
microphone), shows the music as falling notes or engraved sheet music over
a keyboard that lights the keys to play, and judges every note for pitch
and timing. Songs are split into phrases (sections) that climb a tempo
ladder and move from learning to steady to mastered, with spaced reviews.
A daily plan says what to practise and for how long; Today shows how it is
going.

It teaches as well as it drills. **Learn** holds 62 interactive lessons in
twelve units (the keyboard, rhythm, reading, scales and keys, intervals,
chords, harmony and accompaniment, technique, musicianship, advanced
harmony, practice and performance, playing by ear and improvising), from
the first keys to augmented sixths, each a few pages of explanation with
pictures you can hear and tasks you play on the keys or answer. **Train**
has a drill for every skill: note reading in both clefs, finding keys,
intervals, chords, key signatures, Roman numerals, terms, the ear
(intervals, chord qualities, scales, cadences, melodies played back),
rhythm, technique (every scale, arpeggio and five-finger pattern in every
key, with the best clean tempo per key), progressions in accompaniment
patterns, and adaptive sight-reading (30 levels, new music every time).
**The path** is ten levels (First steps to Virtuoso); each asks for lessons,
skill mastery, scales at a tempo, a sight-reading level and pieces, and the
learner moves up by themselves when a level is complete. **Reference**
looks up any chord, scale, key, interval or term and plays it.

The coach (CraftBot, the one agent) adds the music the person asks for,
written in ABC notation at their level and checked bar by bar by the
server before it is added; reviews each session from a compact pack of the
passes played; proposes the next day's plan; and answers questions about
the bars on screen. Everything measurable is decided by the app, the same
way every time; the agent judges and explains, between sessions.

The look is a quiet instrument: cool greys from the kit tokens, hairline
panels with small mono labels, thin mono readouts, blue for the right hand,
teal for the left, red for a wrong note; the coach is black and white with
a star (no accent colour). Light and dark follow the host.

The research behind it (beginner apps, score and sight-reading tools,
practice planners and teacher platforms, AI tutors and hardware, practice
science, the technical stack) is in the repo's
`reports/Piano learning software UI UX survey.md` (not shipped).

## Requirements

See `reference/requirements.md` (binding). Feature checklist:

- [x] Input: MIDI (device picker, hot-plug, frame-blocked detection with "Open in its own tab"), computer keys (two rows, octave shift, hints on the keys), screen keys (mouse and touch), microphone (YIN pitch, one note at a time, chord-tolerant); latency tap test
- [x] Practice: bar strip (sections by stage, drag a range, cursor), falling notes (canvas) or sheet music (VexFlow grand staff), keys with cues and finger numbers, deck (bar, beat, tempo, live accuracy, run, start/stop, coach), Listen / Learn / Play, hands L/R, other hand plays along, tempo 30-150% with presets, loop, metronome and count-in, strictness, note names
- [x] While playing: time into the song and its length, the chord sounding (symbols written in the notation, else analysed bar by bar from the notes: one chord, two halves or every beat, whichever fits), the sustain pedal (a lane beside the falling notes, Ped. brackets under the sheet, a deck indicator that also shows the person's own MIDI pedal) and playback that sustains under the pedal; chord names and pedal can be switched off; library tiles show each song's length
- [x] Results: per pass accuracy, hits, wrong, timing bias, per-bar strip, stage changes, suggested tempo; a small summary per looped pass
- [x] Progress: section stages (new, learning, steady, mastered) with spaced reviews, best clean tempo, learner level, sessions closed after 20 quiet minutes
- [x] Today: the plan (rules or coach), week dial, streak, level, KPIs with deltas and sparklines, 30-day minutes + accuracy chart, coach panel with quick ask, songs in progress, 18-week calendar
- [x] Library: shelves by level, tiles with a mini roll, search and filters, song panel (sections, tempo ladders, trouble bars, edit, start over, remove), add by asking the coach, writing ABC (live check) or importing ABC / MusicXML / MXL
- [x] Coach: conversation with live request status, songs added under the answer, session reviews, ask again
- [x] Settings: input, latency, practice, sound, coach, level, name; first-run dialog
- [x] 32 starter songs and exercises, levels 1-8: from Ode to Joy and the Petzold minuets through Clementi, Schumann and Tchaikovsky to K. 545, Moonlight, Bach's Invention No. 1, Chopin's preludes and Nocturne Op. 9 No. 2, The Entertainer, Rondo alla Turca, Gymnopédie No. 1 and Clair de Lune (originals checked against public-domain editions; excerpts say so). An update adds new starter songs to existing installs, unseen; removed ones never come back
- [x] Learn: 62 lessons in 12 units, levels 1-10; pages of explanation, staff and keyboard pictures with sound, engraved examples that play with a moving highlight (and open in the practice screen), tasks played on the keys (a note, a set, a melody, a chord), questions, embedded drills and exercises; score saved (right first time); resume where you left off
- [x] Path: ten levels with requirements per track (lessons, reading, rhythm, ear, theory, technique, sight-reading, repertoire); level-up is automatic
- [x] Train: 41 skills with mastery and stars; quiz drills answered by tapping (1-9) or playing; technique builder (scales of 13 types, arpeggios, five-finger, chromatic; octaves, hands, contrary motion, rhythm) with best tempo per key; progressions in 6 accompaniment patterns; sight-reading levels 1-30; rhythm drills judge timing on any key
- [x] Reference: chords (22 types, inversions), scales (13 types with fingering and step pattern), circle of fifths with signatures and the chords of each key, intervals (sound, inversion, song references), glossary of terms and signs
- [x] Plan blocks can be lessons and drills as well as song sections
- [x] Every UI action has an operation; the agent uses the same ones

## Entities

| Collection | Purpose | Notes |
|------------|---------|-------|
| settings | One row: `daily_minutes`, `strictness`, `input`, `midi_device`, `latency_ms`, `other_hand`, `metronome`, `count_in`, `view`, `note_names`, `volume`, `click_volume`, `coach_reviews`, `coach_plans`, `level`, `onboarded`, `seeded`, `last_song`, `coach_seen`, `name` | Person only |
| songs | `title`, `composer`, `level` 1-10, `kind` (piece, exercise), `abc` (the notation), `model` (parsed: bars, notes, engraving events), `preview` (tile roll), `tempo`, `bars`, `seconds`, `key_name`, `meter`, `hands`, `range`, `notes_count`, `sections` ([{name, from, to}]), `tags`, `source` (starter, agent, you, import), `starter_key`, `note` (the coach's tip), `fav`, `seen`, `archived`, `request` (the message that asked for it) | The model is re-parsed whenever the notation changes |
| progress | One row per song: `sections` (per section: stage, best, tries, cleans, clean_day, steady_day, last_day, play_day, acc, due, iv), `last_at`, `minutes`, `runs` | Only `runs.save` moves stages |
| runs | One per pass: `song`, `session`, `day`, `mode`, `from_bar`, `to_bar`, `hands`, `tempo_pct`, `bpm`, `duration_ms`, `expected`, `hits`, `wrong`, `missed`, `accuracy`, `timing_mad`, `timing_bias`, `clean`, `cold`, `complete`, `per_bar` ([bar, expected, hits, wrong, missed]), `results` (per section before/after) | |
| sessions | `day`, `started`, `last_at`, `ended`, `minutes`, `runs`, `songs`, `status` (open, closed), `review`, `review_at`, `review_asked` | |
| messages | `role` (you, coach), `kind` (chat, request, review, plan), `text`, `song`, `session`, `reply_to`, `context` (what the person was looking at), `status` (pending, answered, failed), `request_id`, `error` | |
| plans | `day`, `source` (rules, coach), `blocks` ([{song, from, to, mode, tempo, minutes, hands, why}] or {kind: lesson, lesson} / {kind: drill, skill}), `note`, `status` (proposed, active, done), `done` | A rules plan is stored when it starts |
| lessons | One per lesson taken: `key`, `score`, `best`, `attempts`, `done_at` | Keys from `lib_curriculum.js` |
| skills | One per skill drilled: `key`, `mastery` 0-1 (moving average of scores), `attempts`, `items`, `correct`, `avg_ms`, `level` (sight-reading now), `best_level`, `data` (technique bests per exercise: `major:D` → best clean tempo), `history`, `last_at` | Only `drills.save` moves mastery |
| drills | One per drill run: `drill`, `skill`, `session`, `day`, `items`, `correct`, `accuracy`, `avg_ms`, `duration_ms`, `tempo_pct`, `level`, `score`, `title`, `detail` | Counts as practice time |

Every collection changes only through the operations (`hooks.pb.js`
refuses direct API writes and names the operation to use).

## Operations

42 operations in `operations.json` (`agent-app ops <project>`):
`app.guide|state|context|ui`; `settings.get|update`;
`songs.list|get|check|add|update|open|remove|restore|reset`;
`runs.save|list`; `sessions.list|get|end|review`; `review.pack`;
`coach.list|get|send|reply|read|retry`;
`plan.today|start|done|set|reset`; `stats.home|song`;
`learn.state|lesson`; `drills.save|list`; `abc.parse`.

**Identity.** A caller presenting the project's agent token
(`X-A2App-Token`, sent by the agent-app CLI, never seen by pages) is the
agent; before a token exists, the CLI's `X-A2App-Agent` header decides.
Person only: `settings.update`, `songs.open|remove|restore|reset`, the
`fav` field, `runs.save`, `sessions.end`, `coach.send|read|retry`,
`plan.start|done|reset`, `app.ui`, `learn.lesson`, `drills.save` (403
`agent_not_permitted`). Coach only:
`coach.reply`, `sessions.review` (403 `agent_only`). `plan.set` from the
agent is refused when the person turned coach plans off.

**Songs.** ABC notation in (`lib_abc.js`): header fields, voices with
clefs (a voice is the right or left hand by clef, name or register),
accidentals that last the bar, octave marks, lengths, rests (z x Z),
chords, ties, broken rhythm, tuplets, repeats and first/second endings
(unrolled), inline fields, dynamics, fingering, staccato, the sustain pedal
(`!ped!` presses or changes it, `!ped-up!` lifts it, or `%%pedal bar|half|beat`
for a whole piece) and chord symbols (`"Am7"` before a note). Every bar of
every voice must add up to the metre (a pickup and its closing bar may be
short) and all voices need the same bars; every problem names the line,
the voice and the bar. `songs.check` answers without saving; `songs.add`
refuses notation with problems (the message lists them) and a duplicate
title (409 `exists`). Sections default to phrases of 4 bars (8 in long
pieces); `--sections "A:1-8, B:9-16"` sets them and must cover every bar.
Updating the notation keeps the progress of sections whose bars did not
change.

**Practice.** The browser judges the playing; `runs.save` (one call per
pass) moves the sections the pass fully covered: Learn and Play make a new
section learning; a clean Play pass with both hands raises the best tempo,
three clean at 100% in a day make it steady, a clean first try at 100% on
a later day masters it (review due in 2 days, then 4, 8 … 64), a failed
first try drops a mastered section to steady. The answer carries the stage
changes and the suggested tempo (+10 under 70%, +5 above, -10 under 80%
accuracy).

**The plan.** `plan.today` returns the stored plan for the day or the
rules' plan (warm-up: the exercise practised least recently; due reviews;
the two weakest sections of the two songs in progress at their next tempo,
Learn while new; a run-through once half the song is steady; a new piece
when nothing is in progress), scaled to the daily goal. `plan.start`
stores it; `plan.done` ticks blocks; `plan.set` (the coach) proposes
blocks for today, or for tomorrow once today's has started; `plan.reset`
goes back to the rules.

**Learning.** `lib_curriculum.js` is the index both sides share: tracks,
units, the 62 lessons (key, unit, level, title, minutes), the 41 skills
(title, track, trainer, fluent answer time) and the ten levels with their
requirements. Lesson content lives in the frontend (`src/app/learn/`).
`learn.lesson` records a lesson with its score; `drills.save` records a
drill run: quiz drills score accuracy × speed (against the skill's fluent
time), played drills accuracy × tempo; Learn-mode passes are capped and set
no tempo best; mastery moves by a moving average weighted by the run's
size; sight-reading climbs a level after 85% and steps back under 60%;
technique keeps the best clean (90%+) Play tempo per exercise. Both call
`advance`, which moves the learner up while the current level is complete
(`runs.save` too). `learn.state` answers the agent leanly: level, lessons
done, the next lesson (the first lesson the current level still asks for,
then any missed below it, then the next level's), the unmet requirement
with the biggest gap (`weakest_requirement`), the lowest-mastery drilled
skill (`weakest_skill`), what the level still misses (each with its key)
and an example of lesson and drill plan blocks.
The rules' plan adds the next lesson and a drill for the weakest skill;
`plan.set` takes `{kind:"lesson", lesson}` and `{kind:"drill", skill}`
blocks. `abc.parse` turns notation into the practice model without saving
it: the app's generated exercises and lesson examples play through it.

**Lean reads for the agent.** `songs.list` answers the agent with one line
of sections per song (about 3,000 characters for a dozen songs);
`songs.get` leaves the parsed model out for the agent; `review.pack` caps
passes and weak bars (under 3,000 characters for a session) and carries a
`units` line; `coach.list` gives the agent songs as id, title and level
(no previews); `learn.state` for the agent is about 1,200 characters with
every missing requirement named by its key.

**Agent ergonomics (checked by an agent driving the CLI alone).** Every
answer to a write confirms what it did: `songs.add` echoes
`linked_message`, `coach.reply` echoes the question's status and the songs
shown under the reply, `sessions.review` says `replaced` (a second review of
a session corrects the first, one chat message). Text the server returns
avoids `<`, `>` and `&` (PocketBase's JSON escapes them), so placeholders
are written `{id}`. Notation with chord symbols contains double quotes:
the guide and the trigger say to pass it from a file, `--abc "$(cat song.abc)"`.

Routes live in `pb/pb_hooks/ops.pb.js`; logic in `lib_abc.js` (the ABC
parser, sections, the level estimate), `lib_model.js` (settings, days,
shapes, stages, seeding), `lib_songs.js`, `lib_runs.js` (runs, stages,
sessions, the review pack, the clock), `lib_plan.js`, `lib_coach.js`,
`lib_stats.js`, `lib_app.js`, `lib_guide.js`, `lib_starter.js` (the ten
starter songs), `lib_curriculum.js`, `lib_learn.js` (lessons, drills,
skills, the path), `lib_rules.js`, `lib_util.js`.

## The frontend

- `App.tsx`: layout, routes (`#/today`, `#/learn?lesson=&page=&block=`, `#/train?skill=&tech=&prog=&block=`, `#/library?song=`, `#/reference?tab=`, `#/practice?song=&from=&to=&mode=&tempo=&hands=&block=`, `#/practice?gen=<exercise>` or `?ex=<lesson.step>` with `&back=`, `#/coach`, `#/settings`), the Practice button (the next plan block: a song section, a lesson or a drill; else the last song), first-run dialog. The practice page remounts when its route changes (a plan's next block on the same song).
- `lib/context.tsx`: one `app.state` call feeds the sidebar, badges and settings (optimistic writes).
- `lib/live.ts`: one realtime hub; views reload debounced and at most once per `minGap`.
- `music/`: `audio.ts` (synthesised piano: periodic-wave partials, detuned pair, hammer noise, closing filter, two-stage decay, room; metronome click; the audio clock), `input.ts` (MIDI, computer keys, screen keys, microphone as one note stream on the performance.now() clock), `mic.ts` (YIN pitch), `engine.ts` (listen / learn / play: scheduling ahead on the audio clock, the cursor shifted by output latency, judging windows, passes, loop, learn targets), `keys.ts` (shared key geometry), `roll.ts` (falling notes on a canvas), `sheet.ts` (VexFlow grand staff, notes tagged with the song notes they play, time → x map; VexFlow and its Bravura font load on first use), `musicxml.ts` (MusicXML / MXL / ABC files to ABC).
- `music/theory.ts` (notes, intervals, 13 scales, 15 keys each way, 22 chord types, chord identification, the chords of a key with Roman numerals, 10 progressions with voice leading, scale and arpeggio fingering), `music/generate.ts` (exercises as ABC: scales, arpeggios, five-finger, chromatic, triads, inversions, progressions in 6 patterns and the 12-bar blues, rhythm levels 1-5, sight-reading levels 1-30; encoded in the URL), `music/staffmini.ts` (a small VexFlow staff for pictures and quizzes), `music/play.ts` (play a note, chord, sequence or model), `music/harmony.ts` (the chord track: written symbols, else template matching per bar with the bass, the key's own chords and a bass-line tiebreak; pedal lookup).
- `learn/`: `schema.ts` (the lesson step types), `content/*.ts` (the lessons, one file per unit, loaded on demand), `glossary.ts` (terms and signs), `widgets.tsx` (Markdown, playable keys answering every input, staff, engraved example with a moving highlight, sound button, answer options), `usePlay.ts` (judging a note, a set, a melody or a chord; chords tap key by key on screen), `drills.ts` (quiz items per skill), `Quiz.tsx` (a drill run and its summary), `LessonPlayer.tsx` (pages, tasks, resume, the end screen).
- `pages/`: `Today.tsx`, `Learn.tsx` (lessons by unit, the path matrix and each level's requirements), `Train.tsx` (focus, skills by track, technique builder, sight-reading, progressions), `Library.tsx`, `Reference.tsx`, `Practice.tsx` (header controls, bar strip, stage, deck, keys, result card; exercises save as drills), `Coach.tsx`, `Settings.tsx`.
- `components/`: `Sidebar.tsx`, `ui.tsx`, `charts.tsx` (count-up, sparkline, practice chart, week dial, calendar dots, ring, mini roll, tempo ladders, bar errors), `InputSetup.tsx`, `Onboarding.tsx`, `practice/` (`Keyboard.tsx`, `BarStrip.tsx`, `SheetView.tsx`), `library/` (`AddSong.tsx`, `SongPanel.tsx`, `NotationEditor.tsx`).
- `theme.css`: `--pc-*` tokens from the kit's `--agent-app-*`, the hand colours, the keys, motion (off under reduced motion).
- Drawing runs from one requestAnimationFrame loop on the practice page (engine frame, roll or sheet, keys, bar strip, readouts) without React renders.

## Agent triggers

| Trigger | Fired when | What the agent does |
|---------|------------|--------------------|
| `coach_message` | The person writes to the coach (a question or a song request) | `coach.get`; for a song: `songs.list` (no duplicates), write ABC at their level, `songs.check` until ok, `songs.add --message`; for a question: facts from `app.context`, `songs.get`, `review.pack`, `runs.list`, `stats.song`; then `coach.reply --message` |
| `session_review` | A session of 3 minutes or more closes (20 quiet minutes, or the person ends it) and reviews are on | `review.pack --session`, `sessions.review` (3-6 sentences with numbers and the one thing to fix), optionally `songs.update --note` and `plan.set` for the next day |

Each needs one approval in CraftBot before it can run. Each has its own
budget (30 fires an hour); a session review is asked at most three times.

## External data

None. Everything stays on this computer (the piano sound is synthesised,
the sheet music font is bundled).

## Background jobs

- `pc_tick` (every minute): the starter library (all of it on a fresh install, new additions after an update); sessions quiet for 20 minutes closed; reviews asked for closed sessions of 3 minutes or more (within 12 hours).

## Gotchas

- MIDI inside CraftBot: the host frame allows `microphone` but not `midi`, so `requestMIDIAccess` is refused there without a prompt. The app detects it (`permissionsPolicy.allowsFeature('midi')`, or a NotAllowedError in a frame) and offers "Open in its own tab", where Chrome and Edge ask normally. The fix on the host side is adding `midi` (and `autoplay`) to the frame's `allow` list.
- Browsers start audio only after a click or key press in the page; MIDI messages do not count. `audio.unlockOnGesture()` resumes the context on the first gesture; the start button also does.
- Nothing touches MIDI or the microphone on page load (the install check fails on console errors while loading).
- Hooks do not hot-reload: restart the app after a hook change.
- `lib_abc.js` is plain JavaScript without PocketBase APIs, so it runs in node for tests: parse every starter song after changing it.
- Never call `.reverse()` on what `findRecordsByFilter` returns (a Go slice that goja mirrors): copy with `Array.from` first.
- PocketBase filters take plain field names, never backticks.
- The system rate limit is 300 `/api/ops/` calls a minute, shared with the agent: one `runs.save` per pass, the shell on `app.state`, views on `useLive`.
- `theme.css` loads before Tailwind and declares the layer order first.
- Days are local calendar days of the machine (`lib_model.dayKey`); the browser and the server run on the same computer.
- The parsed model has a version (`model.v`, now 2: pedal spans and chord symbols). `songs.open` parses a song stored by an older parser again; a starter song still exactly as shipped (compared without pedal and chord markings) takes the shipped notation's new markings at start-up, keeping its progress.
- In ABC, an accidental lasts until the bar line for that letter and octave; the parser and the MusicXML importer follow the same rule.
- Lesson content is checked by a script that imports every unit in node: notes parse, answers are in range, drill skills exist and are quiz drills, every ABC example and exercise parses with `lib_abc.js`. Keep it passing when editing lessons.
- Quiz drills switch the computer-key piano off while only choices are on screen, so 1-9 pick answers; it comes back for items answered on the keys.

## Ownership map

- Editable: `frontend/src/app/`, `pb/pb_migrations/` (new files only), `pb/pb_hooks/*.pb.js` and `lib_*.js` (not the `_*.js` system files), `operations.json` (non-system entries), `triggers.json`, this file, `reference/`.
- System-managed (overwritten by kit-sync): `frontend/src/kit/`, `frontend/src/main.tsx`, `frontend/src/config.gen.ts`, `frontend/src/app.css`, `frontend/vite.config.ts`, `pb/pb_hooks/_*.js`, `pb/pb_hooks/cache_control.pb.js`.
