# Piano Coach: requirements

For one person learning piano, from the first keys to concert repertoire,
and the one AI agent working for them (CraftBot, through the agent-app
CLI) as their coach. No accounts; nothing leaves the computer. The app
listens, judges and keeps the score; the coach adds music, reviews
sessions, plans days and answers questions. There are no agent profiles.

Visual language: a quiet instrument. Cool light greys derived from the
host's kit tokens, hairline panels with small monospaced uppercase labels
("01 PLAN"), large thin monospaced numbers for readouts, a faint measuring
grid behind the practice stage and the dashboard. Two colours carry
meaning: blue is the right hand, teal the left; red marks a wrong or missed
note. The coach is black and white with a four-point star (its avatar,
its plan, its notes, new songs it added); no accent colour. Inter and JetBrains Mono, lucide icons, no
emoji. Light and dark follow the host. Motion is purposeful and quiet:
panels rise in, charts draw, numbers count up, notes glow and ring where
they land, keys go down, the selected segment of a switch slides. Labels
are few: the layout explains. Everything clickable shows the hand.

## Playing in

1. Four ways to play: a digital piano over MIDI (Chrome and Edge), the
   computer keys (two rows, C3 to F5, - and = shift the octave), the keys on
   the screen (mouse or touch), an acoustic piano through the microphone
   (one note at a time; any note of a chord counts).
2. Nothing asks the browser for MIDI or the microphone until the person
   chooses to connect. Inside CraftBot's frame, when MIDI is not allowed,
   the app says so and offers to open itself in its own browser tab.
3. The input's state is always visible on the practice screen (device name
   and a status dot) and can be switched there.
4. Latency can be measured (eight clicks, press with each) and is
   subtracted when timing is judged.

## Practising

5. The practice screen: the song's bars across the top (sections named and
   shaded by stage, the bars being practised bracketed, the cursor moving
   through), the music in the middle, the keys at the bottom, and between
   them a deck with bar, beat, tempo, live accuracy and run, one round
   start/stop button (Space) and the coach.
6. The music shows as falling notes onto the keys, or as engraved sheet
   music (grand staff) sliding past a fixed cursor. Played notes take the
   hand's colour, missed notes turn red.
7. Three modes. Listen: the app plays it. Learn: the cursor waits on each
   note or chord until the right keys are pressed. Play: in time, after a
   count-in, with the metronome; every note is judged for pitch and timing
   (lenient ±220 ms, normal ±160 ms, strict ±110 ms).
8. The keys show what to play next: a dot in the hand's colour with the
   finger number; right notes ring, wrong notes flash red.
9. Hands: left, right or both; the other hand can play along by itself.
10. Tempo as a percent of the song's tempo (30 to 150), with steps of 5
    (arrow keys) and presets. Loop the chosen bars.
11. Choose what to practise on the bar strip: a section's name, any
    stretch dragged across the bars, a double-click for the whole song;
    the arrow keys move between sections.
12. After each pass: accuracy (or first-try accuracy in Learn), right of
    expected, wrong notes, timing (early or late), a bar-by-bar strip, the
    sections whose stage changed, Again and the suggested next tempo.
    While looping, a small summary follows each pass.

While playing, the deck shows the time into the song and its length, the
chord sounding and the sustain pedal; chord names fall with the notes (and
sit over the sheet music), the pedal is a lane beside the falling notes and
brackets under the sheet, and playback sustains under it. Both can be
switched off. Every song in the library shows its length.

## Progress

13. Songs are split into sections (phrases of 4 to 8 bars). Each section
    moves new → learning (its best clean tempo climbs) → steady (three
    clean passes at full tempo in a day) → mastered (clean at full tempo on
    the first try of a later day; reviewed after 2, 4, 8 … 64 days; a
    failed review drops it to steady). Clean = accuracy at the person's
    strictness (90/95/98%).
14. The learner has a level (1 First steps … 10 Virtuoso) that rises when
    they master a song at a higher level.
15. Practice sittings are sessions: the first pass opens one, twenty quiet
    minutes close it.

## Today

16. Today is the dashboard: the day's plan (timed blocks with song, bars,
    mode, tempo and minutes; start it or any block), the week as a dial
    against the daily goal with today's minutes, streak and level, the
    numbers that matter (minutes and accuracy over 7 days with deltas and
    sparklines, sections mastered, reviews due), thirty days of minutes and
    accuracy, the coach's latest word with a quick ask, the songs in
    progress with their sections, and an 18-week calendar.
17. The plan is made by the app's rules every day (warm-up, due reviews,
    the weakest sections at their next tempo, a run-through, a new piece
    when nothing is in progress), scaled to the daily goal; the coach may
    propose one instead. During practice the open block counts down and
    the next follows.

## Library

18. A shelf per level; each tile shows the song's notes as a small roll,
    its sections' stages, how far along it is, and marks for exercises,
    reviews due and songs the coach just added. Search and filters (in
    progress, new, mastered, exercises).
19. A song's panel: its notes, key, metre, tempo, bars, length and range;
    Practise and Listen; the coach's note; each section with its stage and
    best tempo (click to practise it); the tempo ladders over time; the
    bars that go wrong most; edit (details, sections, notation), start
    over, remove.
20. Add a song three ways: ask the coach, write ABC notation (checked as
    you type, with every problem named by line and bar, and what was read),
    or import a file (ABC, MusicXML, compressed MXL), which opens in the
    notation tab to check before adding.
21. A fresh install has 32 starter pieces and exercises (levels 1 to 8),
    classical originals checked against public-domain editions and a few
    arrangements; an update adds new starter pieces to an existing library.

## Coach

22. A conversation with the coach: questions, song requests, replies and
    session reviews. Each message shows whether CraftBot has picked it up
    (waiting, working, could not), with Ask again when it was not asked.
    Songs the coach added sit under its answer with Play.
23. Asking is possible from Today, from the practice screen (about the bars
    on screen, which travel with the question) and from Add song.
24. The coach can: add and update songs (notation checked by the server),
    write the note shown with a song, review sessions, propose a day's
    plan, answer. It cannot record practice, open or remove songs, change
    settings or tick plan blocks.

## Learning (theory, skills and the path)

L1. Learn: every lesson a pianist needs from the first keys to concert
    level, in twelve units (the keyboard; rhythm and pulse; reading music;
    scales and keys; intervals; chords; harmony and accompaniment;
    technique; musicianship; advanced harmony; practice and performance;
    playing by ear and improvising), 62 lessons at levels 1 to 10.
L2. A lesson is a few pages: short explanations, staff and keyboard
    pictures that can be heard, engraved examples that play with the
    sounding notes lit (and open in the practice screen), and on every page
    something to do: play it on the keys (a note, every note of a set, a
    melody in order, a chord held or tapped key by key), pick the answer,
    a short drill, an exercise. Continue unlocks when the task is done. A
    lesson resumes where it was left; the end shows the score (right first
    time) and the next lesson.
L3. Train: a drill for every skill, each with a mastery (0-100) and up to
    three stars. Quizzes (answer by tapping, 1-9, or playing): finding
    keys; note reading in the treble, bass and both clefs, with ledger
    lines and accidentals; naming and playing intervals; key signatures;
    the chords of a key (Roman numerals); terms and signs; playing triads,
    inversions, seventh, extended and slash chords from symbols; naming
    chords on the staff; ear training for intervals (melodic and
    harmonic), chord qualities, scales and modes, cadences, and melodies
    played back. Right answers move on by themselves; a wrong one shows the
    answer and waits.
L4. Played drills in the practice screen, generated fresh: every scale (13
    types) in every key, one to four octaves, either hand, both or contrary
    motion, three rhythms; arpeggios (major, minor, dominant and diminished
    sevenths); five-finger patterns; chromatic scales; progressions (ten,
    plus the 12-bar blues) in six accompaniment patterns; rhythm (five
    levels, any key counts, timing is judged); sight-reading at 30 levels
    that climb after a strong pass and step back after a weak one. A clean
    Play pass records the best tempo per key.
L5. The path: ten levels (First steps, Beginner, Elementary, Late
    elementary, Intermediate, Upper intermediate, Early advanced, Advanced,
    Concert, Virtuoso). Each asks for lessons, skill mastery, scales clean
    at a tempo, a sight-reading level and pieces at a stage (and from
    level 9 a recital programme). A matrix shows every level by track; a
    level opens its requirements, each one a click from its lesson or
    drill. The level rises by itself when a level is complete.
L6. Reference: any chord (22 types, any root, inversions) on the staff and
    keys with its intervals; any scale with fingering and its whole/half
    steps; the circle of fifths with each key's signature, relative and
    neighbouring keys and its chords (triads and sevenths, playable);
    intervals with sound, inversion and a song to remember them by; the
    glossary of terms and signs, searchable by category.
L7. The day's plan mixes song sections with the next lesson and a drill for
    the weakest skill; the coach can plan lessons and drills too.

## Settings

25. How you play (with each input's status), latency; minutes a day,
    strictness, count-in, metronome, other hand, note names, falling notes
    or sheet music; piano and metronome volume with a test; whether the
    coach reviews sessions and plans days; level; name.
26. First open: one dialog for how you play, where you start (never played,
    a little, well) and minutes a day.

## Platform

27. Every UI action is an operation the agent can call too; reads for the
    agent are lean. Direct record writes are refused.
28. Phones: the sidebar is a drawer, headers wrap, the deck drops the
    secondary readouts.
