# Singing Coach: requirements

For one person learning to sing, from matching a first note to recital
repertoire, and the one AI agent working for them (CraftBot, through the
agent-app CLI) as their coach. No accounts; nothing leaves the computer.
The app listens, judges and keeps the score; the coach adds songs, reviews
sessions, plans days and answers questions. There are no agent profiles.

Visual language: Piano Coach's quiet instrument. Cool light greys derived
from the host's kit tokens, hairline panels with small monospaced uppercase
labels ("01 PLAN"), large thin monospaced numbers for readouts, a faint
measuring grid behind the practice stage and the dashboard. In place of
the keyboard, an abstract digital instrument: the Voice Dial. One accent
carries the voice (its needle, trail, lane line and contours); amber warns
(over range, a health flag); red marks a note off. The coach is black and
white with a four-point star; no accent colour. Inter and JetBrains Mono,
lucide icons, no emoji. Light and dark follow the host. Motion is
purposeful: one subject moves, the voice; panels rise in, charts draw,
numbers count up, the selected segment of a switch slides; under reduced
motion the dial drops its trail and the lane pages by phrase. Labels are
few: the layout explains. Everything clickable shows the hand.

## Listening

1. The microphone only, captured raw (no echo cancellation, noise
   suppression or auto gain, which bend pitch). Pitch by the McLeod method
   in an AudioWorklet (a main-thread analyser where worklets are missing),
   voiced by clarity with hysteresis, smoothed by a median of five, octave
   jumps held back until they persist.
2. Nothing asks for the microphone until the person chooses to start.
   Inside CraftBot's frame, when the microphone is not allowed, the app
   says so and offers to open itself in its own browser tab.
3. Setup: device picker, live meter, the room's noise, how the person
   listens (wired headphones, Bluetooth, speakers; speakers make the guide
   give the start note only, so it does not leak into the judging), and a
   timing test (sing "ta" with eight clicks; the median offset is the
   round-trip latency, subtracted when onsets are judged).
4. Range test: the lowest and highest notes held for a second within ±50
   cents; from them the comfortable range, the voice family and clef, and
   the passaggi (typical for the closest classical range until the
   person's own glides show where the voice turns). Ranges are kept with
   their date.

## The Voice Dial

5. A half circle whose top is the target note; the needle and its fading
   trail are the sung pitch, ticks mark ±10, ±25 and ±50 cents; jaws close
   on the needle when a note is held in tune. Modes: song (target from the
   melody), hold (a held note with a strobe ring), free (no target, note
   names around the pitch: tuner and range test), breath (inhale, suspend,
   exhale cues), blind (no needle, judged after). Beside it the target
   (note, syllable, frequency, bar) and the voice (steadiness, vibrato,
   loudness, breath time).

## Practising

6. Modes: Listen (the guide sings it), Echo (phrase by phrase: hear it,
   sing it back), Sing (with the guide), Solo (no guide or accompaniment;
   judged against the singer's own key). Verses, key shift (the best fit
   for the voice by default), tempo, loop a range of bars, metronome and
   count-in, drone, strictness, the pitch lane or sheet music with words.
7. The guide is a formant voice on "oo" or "ah" (Csound formant table per
   register, gentle vibrato on longer notes, legato glides), or the piano,
   or the start note only, or off. Accompaniment: a written piano part as
   written, else from the chord symbols.
8. Judging, per note: octave-folded cents on the stable part (first 120 ms
   and last 50 ms left out); on / close / off at ±25 / ±50 cents (Easy
   ±35 / 75, Strict ±15 / 35); onset in a window of ±100 ms (±150, ±50);
   scoops and falls; hold (spread after a 5 Hz low-pass); vibrato rate and
   extent; spoken notes judged on voice and onset only; free notes drawn,
   not scored. Per take: shares on and close, in tune, bias and spread in
   cents, onsets, hold, vibrato, scoops, falls, drift, octave, Solo offset;
   per phrase and per bar; a voice map (pitch by loudness).
9. Feedback fades as a section matures: full while learning, faded when
   steady, after the take once mastered (Settings can fix it on or after).
   Before a score the person may say how they think it went. A note can be
   disputed and is re-judged.
10. "Stop: it hurts" is always on the practice screen: it ends practice,
    marks the session and makes tomorrow gentle.

## Progress

11. Sections climb new → learning → steady → mastered per key: learning on
    any sung take; steady after three clean takes at full tempo in a day,
    one of them Solo; mastered on a clean Solo at full tempo on a later day
    (cold); a failed cold check drops to steady; reviews after 2, 4, 8 … 64
    days. A clean take: Normal 90% of notes on or close, 65% on, 75% of
    onsets in time, the whole section, in Sing or Solo.
12. Sessions open with the first take, drill or lesson and close after 20
    quiet minutes or "End session"; a closed session of 3 minutes or more
    asks the coach for a review when reviews are on.

## Voice care

13. Load per day: voiced minutes and fold cycles. Session cap by level
    (20 minutes to level 3 and for young singers, 30 to level 6, 60
    after); the person may choose shorter, never longer.
14. Light day after a heavy day (over 1.5× the 4-week daily mean and over
    15 voiced minutes), after pain, or when today's check-in has a 4 or 5:
    gentle work only. A weekly rest day (chosen, or after six days in a
    row). A ramp warning over 1.3× the usual week.
15. Check-ins (hoarse, effort, discomfort, high notes lost, throat
    clearing, 1-5, and pain) before the day's first singing when on, and
    any time. An s/z test. Hoarseness at 3 or more on check-ins spanning
    four weeks asks the person to see an ENT doctor or a speech-language
    pathologist; sooner with risk factors. Never a diagnosis, never
    medicine; the copy is reviewed by a professional before wide release.
16. Recordings of takes are kept only when the person turns that on, and
    can all be deleted at once; pitch traces and scores stay.

## Today

17. The plan (rules or coach): warm-up first, cool-down last, reviews,
    focus sections, technique, a new song, a lesson and a drill; split into
    two sittings when longer than the cap; light and rest days honoured.
    Start it or any block of it.
18. Week dial, streak, level; KPIs (pitch, in tune, hold, range, load,
    voice check) with deltas and sparklines; 30 days of voiced minutes and
    pitch; the voice map of the week; songs in progress with contours and
    section stages; a 12-week calendar; the coach panel; a health banner.

## Library

19. Shelves by level; tiles show the tune as a contour over the
    comfortable range (amber past it), a fit badge, stages, progress and
    length. Filters: in progress, new, mastered, fits my voice, vocalises.
20. Song panel: range in the current key against the voice, the best key
    and a transpose stepper, first words, language, sections with their
    stage and best take, best takes over time, notes off by bar, the last
    takes, about the words (gloss), source and licence; edit, start over,
    remove.
21. Add a song by asking the coach, writing ABC with its words (checked
    live: bars, key, range, tessitura, syllables, verses, phrases, the
    longest phrase, the fit for the voice) or importing ABC, MusicXML with
    lyrics (the sung part, and a piano part kept as the accompaniment that
    plays as written) or UltraStar. Chord symbols in a file are kept; a
    MusicXML or UltraStar file with none gets chords worked out (from the
    piano part and the melody, else from the melody in its key, ending on
    the tonic), written into the notation as chord symbols to check and
    correct, and the person is told where they came from.
22. A song from a recording: an mp3 (or wav, m4a, ogg, flac, webm) of a
    song with music or of a voice alone, analysed on this computer. A song
    with music is first separated into its voice and its music by a neural
    model (Demucs v4, on the graphics card through WebGPU where the browser
    allows, else on the processor); the melody is then followed in the
    voice alone, the key from the sung notes alone, and the beat, metre
    and bar 1 and the chords (sevenths, sus4, diminished and inversions)
    in the instruments alone, the bass note of each beat from the bass by
    itself. The words are
    heard in the voice (Whisper small, the language told or chosen) with
    the time of each piece. The models are downloaded once, through the
    app's server (pinned revisions, kept on disk) and kept in the browser.
    The person hears the beat clicked over the recording, hears the voice
    and the music apart, and corrects the metre, half or double speed and
    bar 1; the heard words can be corrected or replaced by the published
    lyrics, which keep the timing (matched character by character) and
    are laid under the notes nearest in time; the notation opens to be
    checked and corrected before it is added. The recording, its voice and
    its music stay with the song: in Listen, Sing and Echo the voice and
    the music each turn on or off (both off: the piano), at the
    recording's own key and full speed; in another key, at another speed
    or in Solo the piano accompanies, and a "Back to the recording" chip
    returns to its key and speed. Turning the voice or the music on or off
    during a take changes what is heard from that moment (the guide and
    the piano come in or stop with it); the take carries on. So do the
    guide, the piano, the drone, the metronome, the loop, the count-in, the
    vowel and the strictness; only the mode, the bars, the tempo, the key
    and the verse start a take over. A take can be paused and resumed
    (button or P): the sound, the clock, the microphone and the take's
    recording stand still together, and the pause does not count. Heard
    words go on the note being sung when they were heard (the start of the
    sung stretch), not on the next note. A song made from a recording opens in
    the recording's key (not the key that suits the singer's range), and
    no guide voice doubles the recording's singer while they are heard;
    Echo's phrase to hear is always the whole recording. A voice memo, or
    a song not separated, is analysed directly as before, and plays with
    or without the voice (the middle of a stereo mix taken out, the bass
    kept).
22a. Editing a song is visual, on a page of its own (Library > Edit, the
    practice screen's Edit, and straight after a song is made from a
    recording): the notes on a piano roll (bars across, pitches up, the
    key's notes lighter), the chords in a lane above, the words of every
    verse in lanes below. Notes are selected (click, Shift-click, a drag
    around them), moved in time and pitch by dragging or with the arrow
    keys, made longer by their right edge, drawn with the pen or a
    double-click, split, joined, copied and deleted; breath, staccato,
    spoken and not-scored marks are switches. Words are typed under the
    notes (Tab on to the next, a closing hyphen joins the next syllable),
    dragged from one note to another, shifted a note earlier or later for
    the rest of their line, or typed as a line onto chosen notes; verses
    are added and deleted (undo brings one back). Chords are
    added on the beat (the key's chords offered), changed and dragged. The
    key signature, a move of the whole song by semitones, the metre, the
    pickup and the tempo are set beside (a song made from a recording
    keeps the recording's tempo, metre and pitch), with the level, kind,
    composer, sections and the words' gloss. The song plays from any bar
    with the guide voice or the piano, the chords, and the recording (or
    its voice or music alone), the playhead following. Every change can be
    undone and redone and is saved by itself a moment later. Moving around:
    a strip of the whole song (click or drag it), the wheel (along the song
    over the bars, chords and words, or with Shift; Ctrl zooms where the
    pointer is), a hand tool and the middle mouse button to drag the view,
    the arrow keys when no note is chosen. What the
    server would refuse is held, with its problems shown by bar. The
    notation can still be read and edited as text. Everything a song's
    notation holds comes back unchanged from the editor (checked on every
    starter song), except that repeats are written out and a change of
    metre becomes one metre.
23. 41 starter items: public-domain and traditional songs in four
    languages, levels 1-10, each checked note by note against a named
    edition, with glosses for every non-English song; and original
    vocalises.

## Coach

24. A conversation: questions and song requests with their live status
    (pending, answered, failed, ask again), replies, session reviews and
    plans; songs the coach added sit under its answer.
25. The coach writes only public-domain or traditional songs it knows
    accurately; the server checks notation, words and range before adding.
    It never claims to hear tone, breathiness or tension, and never
    diagnoses.

## Learning (lessons, skills and the path)

26. 80 lessons in 13 units, levels 1-10, with pictures that sound and
    tasks that are sung (a note, a hold, a glide, an echo) or answered.
27. 41 skills, each with a drill (quiz, sing, speak, exercise or sight)
    and mastery; 33 vocalises in the singer's range, up a semitone each
    repetition to below the comfortable top (and not past the upper
    passaggio before level 4 or for young singers), then back down;
    sight-singing levels 1-30.
28. The path: ten levels in eight tracks; level-up is automatic.

## Reference

29. Tuner and pitch pipe (the dial in free mode, every note in the range,
    voice or piano) and a drone; voice types with their ranges and
    passaggi against the person's; intervals up, down and together with
    song references; solfège (movable or fixed do, numbers, letters) and
    the Curwen hand signs; the vowel chart sung by the guide voice; every
    vocalise in the singer's range; a tone lab (brightness and clarity
    against the first take of the sitting: explore, not a score, never
    stored); the glossary; voice care.

## Settings

30. Voice and range (measure again, clef, young singer); microphone and
    timing; sound (guide, vowel, volumes, drone, metronome, count-in);
    practice and feedback (daily minutes, strictness, feedback, syllables,
    minor, view, level, the coaching rules with their reasons); voice care
    (check-ins, longest sitting, rest day, s/z test, recordings); coach
    (reviews, plans, name, status); data (the library as ABC, a song as
    UltraStar, the session log as CSV). A first-run dialog sets the
    microphone, the timing and the range.

## Platform

31. Every UI action is an operation the agent can call with the same
    rules; person-only and coach-only operations are enforced on the
    server; collections change only through operations. The agent's
    surface is checked by an agent working through the CLI alone: a
    param an operation does not have is refused with its params (not
    ignored); words can be read bar by bar and shifted or laid on bars
    without rewriting the notation; the coach may correct the person's own
    and imported songs (keeping a recording's timing); replies name the
    message they answer and can be taken back within 30 minutes unread;
    takes with no voice heard are never reported as numbers; the guide
    comes whole or by topic.
32. Production quality: no placeholder copy, responsive to phone width,
    keyboard reachable, light and dark, reduced motion honoured.
