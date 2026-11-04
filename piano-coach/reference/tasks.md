# Tasks: Piano Coach

Every task cites what it implements. These features already exist in the published app `piano-coach` 1.1.0, so the build tasks are recorded as done.

## Build
- [x] T-1 (F-FRM-1, F-FRM-2, F-FRM-3): sidebar with Practice, the views, badges, today's minutes and the coach status. It collapses to a rail (forced while practising or in a lesson or drill) and becomes a drawer on phones (`components/Sidebar.tsx`, `App.tsx`).
- [x] T-2 (F-FRM-4): "Practice" opens the next undone plan block (starting the plan), else the last song, else the Library.
- [x] T-3 (F-FRM-5): the quiet-instrument look: `--pc-*` tokens mixed from the kit's, hairline panels with mono labels, mono readouts, the measuring grid, hand colors, the black-and-white coach star, Inter and JetBrains Mono, light and dark (`theme.css`).
- [x] T-4 (F-FRM-6): first-open dialog "Welcome to Piano Coach" (how you play, where you start, minutes a day) (`components/Onboarding.tsx`).
- [x] T-5 (F-FRM-7): reload onto a new build after a reconnect or a tab show, waiting while a dialog is open (`lib/live.ts`).
- [x] T-6 (F-INP-1, F-INP-2, F-INP-3, F-INP-4): the four inputs (`music/input.ts`, `music/mic.ts`, `components/Keyboard.tsx`): Web MIDI asked for only on connect, the blocked-frame notice with "Open in its own tab", the computer-key rows with octave shift, the YIN pitch microphone, and the input chip with its status on the practice screen.
- [x] T-7 (F-INP-5): latency measurement (eight clicks, median difference) subtracted when judging.
- [x] T-8 (F-PRC-1, F-PRC-7): the practice screen layout: a bar strip with sections shaded by stage and the bracketed selection (section name, drag, double-click, arrow keys), the stage, the deck and the keys (`pages/Practice.tsx`).
- [x] T-9 (F-PRC-2, F-PRC-10): falling notes on a canvas and engraved grand-staff sheet music (VexFlow, Bravura, lazily loaded), with hand colors and red misses, and the fallback when the sheet cannot be drawn.
- [x] T-10 (F-PRC-3, F-PRC-4): Listen, Learn and Play modes, with judging by pitch and timing at the strictness window (`music/engine.ts`), and key hints with finger numbers, rings and red flashes.
- [x] T-11 (F-PRC-5, F-PRC-6): hands (left, right, both, the other hand playing along), tempo 30–150 in steps of 5 with presets and arrow keys, and loop.
- [x] T-12 (F-PRC-8): the result card after each pass (accuracy or first try, right of expected, wrong, timing, a bar strip, stage changes, Again, the suggested tempo) and the loop summary (`lib_runs.js` `runs.save`).
- [x] T-13 (F-PRC-9): time and length, chord and pedal readouts, falling chord names and the pedal lane, sheet chord symbols and pedal brackets, sustained playback, and switches for each.
- [x] T-14 (F-PRG-1, F-PRG-3): section stages with spaced review, and sessions opened by the first pass and closed after 20 quiet minutes (`lib_runs.js`, job `pc_tick`).
- [x] T-15 (F-PRG-2): the learner level rises by mastering a higher-level song or completing the level's requirements (`advance()`).
- [x] T-16 (F-TOD-1, F-TOD-2, F-TOD-3, F-TOD-4): Today: the plan panel, the week dial, KPIs with deltas and sparklines, 30-day charts, the coach panel with quick ask, songs in progress, and the 18-week calendar (`pages/Today.tsx`, `stats.home`).
- [x] T-17 (F-TOD-5, F-TOD-6, F-TOD-7): the rules plan (warm-up, reviews, weakest sections, run-through, a new piece, the next lesson, a drill), the coach's plan with "Use the app's plan", and block countdown and follow-on during practice (`lib_plan.js`).
- [x] T-18 (F-LIB-1, F-LIB-2): Library shelves by level, tiles with roll, stages, progress and marks, plus search and filters (`pages/Library.tsx`).
- [x] T-19 (F-LIB-3, F-LIB-4): the song panel (details, Practise, Listen, coach note, sections, tempo ladder, trouble bars) with Edit, "Start this song over?" and "Remove this song?" (`SongPanel.tsx`).
- [x] T-20 (F-LIB-5): Add song: ask the coach, write ABC checked as you type with problems by line and bar, or import ABC, MusicXML or MXL into the notation tab (`lib_abc.js`, `music/musicxml.ts`).
- [x] T-21 (F-LIB-6): 32 starter songs on a fresh install, with only new starter keys added on an update (`lib_starter.js`, `ensureSeeded`).
- [x] T-22 (F-CCH-1, F-CCH-2, F-CCH-3, F-CCH-4): the Coach conversation with per-message pickup state and "Ask again", songs under answers with Play, and asking from Today, Practice (with the bars) and Add song (`pages/Coach.tsx`, `lib_coach.js`).
- [x] T-23 (F-LRN-1, F-LRN-2, F-LRN-3): 62 lessons in 12 units, the lesson player with a task on every page, resume, and the end screen (`learn/LessonPlayer.tsx`, `learn/content/`).
- [x] T-24 (F-LRN-4): the ten-level path matrix by track, level requirements linked to their lessons and drills, and automatic level-up (`lib_curriculum.js`, `pages/Learn.tsx`).
- [x] T-25 (F-TRN-1, F-TRN-2, F-TRN-3): Train: mastery and stars per skill, the reading, ear, theory and chord quizzes (tap, 1–9 or play), auto-advance on right answers, and the shown answer on wrong ones (`learn/Quiz.tsx`, `lib_learn.js`).
- [x] T-26 (F-TRN-4, F-TRN-5): generated played drills: scales, arpeggios, five-finger, chromatic, progressions, rhythm, and the 30-level sight-reading. The best clean tempo is kept per key (`pages/Train.tsx`, `drills.save`).
- [x] T-27 (F-REF-1, F-REF-2, F-REF-3): Reference: chords, scales with fingering, the circle of fifths with playable chords, intervals with sound, and the searchable glossary (`pages/Reference.tsx`).
- [x] T-28 (F-SET-1, F-SET-2): Settings panels (How you play, Practice, Sound, Coach) with immediate optimistic saves (`pages/Settings.tsx`, `lib/context.tsx`).
- [x] T-29 (F-AGT-1, F-AGT-6, F-AGT-7): 24 lean agent operations served by `a2app_routes.pb.js` through the View's own handlers, person-only and agent-only checks, and record hooks refusing direct writes (`hooks.pb.js`, `lib_rules.js`).
- [x] T-30 (F-AGT-2, F-AGT-5): the `coach_message` trigger from `coach.send` / `coach.retry` and its playbook. Songs added by the agent are checked on the server (`songs.check`, `songs.add --message`), and replies come through `coach.reply`.
- [x] T-31 (F-AGT-3, F-AGT-4, F-AGT-8): the `session_review` trigger fired for closed sessions (at least 3 minutes, coach reviews on, up to three tries) and its playbook. `review.pack`, `sessions.review` and the coach's `plan.set` come with it.

## Verification
- [x] Framework-files check (`validateFrameworkFiles` of the Agent App CLI) reports no problems for manifest.json, operations.json, AGENT_APP.md, reference/requirements.md and reference/tasks.md.
- [x] ## Operations Design in reference/requirements.md lists exactly the 24 operations of operations.json, each under its declared module.
- [ ] Agent App Framework gate (`agent-app <dir> validate`) passes, including the describe budget on a dev instance.
- [ ] Every declared operation answers through `a2app` on a live instance.
- [ ] The View renders identically to the published build (screenshot comparison).
