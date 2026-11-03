/// <reference path="../pb_data/types.d.ts" />
/**
 * The curriculum, from the first keys to concert level: units of lessons,
 * the skills the drills train, and the ten levels of the path with what
 * each one asks for in every track.
 *
 * Lesson CONTENT (the explanations and interactive steps) lives in the
 * frontend (src/app/learn/); this file is the index both sides share: keys,
 * titles, levels, and what completes a level. The agent reads it through
 * learn.state and app.guide.
 */

var TRACKS = [
  { key: 'lessons', title: 'Lessons' },
  { key: 'reading', title: 'Reading' },
  { key: 'rhythm', title: 'Rhythm' },
  { key: 'ear', title: 'Ear' },
  { key: 'theory', title: 'Theory & chords' },
  { key: 'technique', title: 'Technique' },
  { key: 'sight', title: 'Sight-reading' },
  { key: 'repertoire', title: 'Repertoire' },
];

var UNITS = [
  { key: 'keyboard', title: 'The keyboard' },
  { key: 'rhythm', title: 'Rhythm and pulse' },
  { key: 'reading', title: 'Reading music' },
  { key: 'scales', title: 'Scales and keys' },
  { key: 'intervals', title: 'Intervals' },
  { key: 'chords', title: 'Chords' },
  { key: 'harmony', title: 'Harmony and accompaniment' },
  { key: 'technique', title: 'Technique' },
  { key: 'musicianship', title: 'Musicianship' },
  { key: 'advanced', title: 'Advanced harmony' },
  { key: 'practice', title: 'Practice and performance' },
  { key: 'creative', title: 'Playing by ear and improvising' },
];

// [key, unit, level, title, minutes]
var LESSON_ROWS = [
  ['kb-keys', 'keyboard', 1, 'Black keys and white keys', 5],
  ['kb-names', 'keyboard', 1, 'Note names and middle C', 6],
  ['kb-fingers', 'keyboard', 1, 'Hand position and finger numbers', 5],
  ['kb-halfsteps', 'keyboard', 1, 'Half steps, whole steps, sharps and flats', 7],
  ['rh-beat', 'rhythm', 1, 'Beat, tempo and note values', 6],
  ['rh-meter', 'rhythm', 1, 'Bars, time signatures and rests', 7],
  ['rh-eighths', 'rhythm', 2, 'Eighth notes and counting', 6],
  ['rh-dotted', 'rhythm', 2, 'Dotted notes and ties', 6],
  ['rh-advanced', 'rhythm', 4, 'Triplets, sixteenths and syncopation', 8],
  ['rd-treble', 'reading', 1, 'The staff and the treble clef', 8],
  ['rd-bass', 'reading', 1, 'The bass clef', 7],
  ['rd-grand', 'reading', 2, 'The grand staff and ledger lines', 7],
  ['rd-steps', 'reading', 2, 'Steps, skips and leaps', 6],
  ['rd-accidentals', 'reading', 2, 'Accidentals on the staff', 6],
  ['rd-marks', 'reading', 3, 'Repeats, endings and road signs', 6],
  ['sc-major', 'scales', 2, 'The major scale', 8],
  ['sc-fingering', 'scales', 2, 'Scale fingering and the thumb crossing', 7],
  ['sc-signatures', 'scales', 3, 'Key signatures', 8],
  ['sc-circle', 'scales', 3, 'The circle of fifths', 8],
  ['sc-minor', 'scales', 3, 'Minor scales', 9],
  ['sc-other', 'scales', 4, 'Pentatonic, blues and chromatic scales', 7],
  ['iv-numbers', 'intervals', 3, 'Interval numbers', 6],
  ['iv-quality', 'intervals', 3, 'Interval qualities', 9],
  ['iv-ear', 'intervals', 3, 'Hearing intervals', 7],
  ['iv-inversion', 'intervals', 5, 'Inverting intervals', 6],
  ['ch-triads', 'chords', 3, 'Major and minor triads', 9],
  ['ch-dimaug', 'chords', 4, 'Diminished and augmented triads', 7],
  ['ch-inversions', 'chords', 4, 'Inversions and slash chords', 8],
  ['ch-diatonic', 'chords', 4, 'The chords of a key', 9],
  ['ch-sevenths', 'chords', 5, 'Seventh chords', 9],
  ['ch-symbols', 'chords', 5, 'Reading chord symbols', 8],
  ['hm-primary', 'harmony', 4, 'Primary chords and cadences', 9],
  ['hm-voiceleading', 'harmony', 5, 'Voice leading', 8],
  ['hm-progressions', 'harmony', 5, 'Common progressions', 8],
  ['hm-patterns', 'harmony', 5, 'Accompaniment patterns', 8],
  ['hm-harmonize', 'harmony', 6, 'Harmonizing a melody', 9],
  ['hm-nonchord', 'harmony', 7, 'Non-chord tones', 8],
  ['tc-posture', 'technique', 1, 'Posture, relaxation and healthy practice', 6],
  ['tc-five', 'technique', 1, 'Five-finger patterns', 6],
  ['tc-scales', 'technique', 4, 'Scales hands together and in contrary motion', 8],
  ['tc-arpeggios', 'technique', 5, 'Arpeggios', 8],
  ['tc-chromatic', 'technique', 5, 'The chromatic scale', 6],
  ['tc-advanced', 'technique', 7, 'Octaves, trills, repeated notes and independence', 9],
  ['ms-dynamics', 'musicianship', 3, 'Dynamics and articulation', 7],
  ['ms-tempo', 'musicianship', 4, 'Tempo and expression marks', 6],
  ['ms-pedal', 'musicianship', 5, 'Using the pedals', 7],
  ['ms-ornaments', 'musicianship', 6, 'Ornaments', 7],
  ['ms-form', 'musicianship', 7, 'Musical form', 9],
  ['ms-styles', 'musicianship', 8, 'Style periods and how to play them', 9],
  ['ad-modes', 'advanced', 7, 'Modes', 9],
  ['ad-secondary', 'advanced', 8, 'Secondary dominants', 9],
  ['ad-modulation', 'advanced', 8, 'Modulation', 9],
  ['ad-extended', 'advanced', 9, 'Extended chords and jazz voicings', 10],
  ['ad-chromatic', 'advanced', 10, 'Chromatic harmony: the Neapolitan and augmented sixths', 10],
  ['pr-howto', 'practice', 1, 'How to practise', 6],
  ['pr-sightreading', 'practice', 3, 'Sight-reading', 6],
  ['pr-memory', 'practice', 5, 'Memorizing music', 7],
  ['pr-performing', 'practice', 6, 'Performing', 7],
  ['cr-byear', 'creative', 3, 'Playing melodies by ear', 7],
  ['cr-pentatonic', 'creative', 4, 'Improvising with the pentatonic scale', 7],
  ['cr-blues', 'creative', 6, 'The 12-bar blues', 9],
  ['cr-leadsheets', 'creative', 6, 'Playing from a lead sheet', 8],
];

var LESSONS = LESSON_ROWS.map(function (r) {
  return { key: r[0], unit: r[1], level: r[2], title: r[3], minutes: r[4] };
});

/**
 * Skills the drills train. `drill` names the trainer in the app; `target_ms`
 * is the answer time that counts as fluent.
 */
var SKILLS = {
  'keys.find': { title: 'Finding keys', track: 'reading', drill: 'keys', target_ms: 1500 },
  'keys.octave': { title: 'Finding keys by octave', track: 'reading', drill: 'keys', target_ms: 2000 },
  'read.treble.1': { title: 'Treble clef: C4 to G4', track: 'reading', drill: 'notes', target_ms: 1800 },
  'read.treble.2': { title: 'Treble clef: C4 to G5', track: 'reading', drill: 'notes', target_ms: 1800 },
  'read.treble.3': { title: 'Treble clef with ledger lines', track: 'reading', drill: 'notes', target_ms: 2000 },
  'read.bass.1': { title: 'Bass clef: C3 to G3', track: 'reading', drill: 'notes', target_ms: 1800 },
  'read.bass.2': { title: 'Bass clef: F2 to C4', track: 'reading', drill: 'notes', target_ms: 1800 },
  'read.bass.3': { title: 'Bass clef with ledger lines', track: 'reading', drill: 'notes', target_ms: 2000 },
  'read.grand': { title: 'Both clefs', track: 'reading', drill: 'notes', target_ms: 1800 },
  'read.acc': { title: 'Notes with sharps and flats', track: 'reading', drill: 'notes', target_ms: 2200 },
  'rhythm.1': { title: 'Rhythm: quarter, half and whole notes', track: 'rhythm', drill: 'rhythm' },
  'rhythm.2': { title: 'Rhythm: eighth notes and rests', track: 'rhythm', drill: 'rhythm' },
  'rhythm.3': { title: 'Rhythm: dotted notes and ties', track: 'rhythm', drill: 'rhythm' },
  'rhythm.4': { title: 'Rhythm: syncopation and triplets', track: 'rhythm', drill: 'rhythm' },
  'rhythm.5': { title: 'Rhythm: sixteenth notes', track: 'rhythm', drill: 'rhythm' },
  'ear.int.1': { title: 'Ear: seconds, thirds, fifths, octaves', track: 'ear', drill: 'ear', target_ms: 4000 },
  'ear.int.2': { title: 'Ear: every interval in a major scale', track: 'ear', drill: 'ear', target_ms: 4000 },
  'ear.int.3': { title: 'Ear: all intervals, melodic and harmonic', track: 'ear', drill: 'ear', target_ms: 4500 },
  'ear.chord.1': { title: 'Ear: major or minor', track: 'ear', drill: 'ear', target_ms: 3500 },
  'ear.chord.2': { title: 'Ear: triad qualities', track: 'ear', drill: 'ear', target_ms: 4000 },
  'ear.chord.3': { title: 'Ear: seventh chords', track: 'ear', drill: 'ear', target_ms: 4500 },
  'ear.scale': { title: 'Ear: scales and modes', track: 'ear', drill: 'ear', target_ms: 6000 },
  'ear.cadence': { title: 'Ear: cadences', track: 'ear', drill: 'ear', target_ms: 6000 },
  'ear.melody.1': { title: 'Ear: play back short melodies', track: 'ear', drill: 'ear', target_ms: 9000 },
  'ear.melody.2': { title: 'Ear: play back longer melodies', track: 'ear', drill: 'ear', target_ms: 14000 },
  'int.name': { title: 'Naming intervals', track: 'theory', drill: 'intervals', target_ms: 3500 },
  'int.play': { title: 'Playing intervals', track: 'theory', drill: 'intervals', target_ms: 3500 },
  'key.sig': { title: 'Key signatures', track: 'theory', drill: 'keysig', target_ms: 3500 },
  'theory.roman': { title: 'Chords of a key (Roman numerals)', track: 'theory', drill: 'roman', target_ms: 4500 },
  'terms': { title: 'Musical terms and signs', track: 'theory', drill: 'terms', target_ms: 4000 },
  'chord.play.1': { title: 'Playing major and minor triads', track: 'theory', drill: 'chords', target_ms: 3000 },
  'chord.play.2': { title: 'Playing all triads and inversions', track: 'theory', drill: 'chords', target_ms: 3500 },
  'chord.play.3': { title: 'Playing seventh chords', track: 'theory', drill: 'chords', target_ms: 4000 },
  'chord.play.4': { title: 'Playing extended and slash chords', track: 'theory', drill: 'chords', target_ms: 5000 },
  'chord.name': { title: 'Naming chords on the staff', track: 'theory', drill: 'chords', target_ms: 4000 },
  'prog.1': { title: 'Progressions: I, IV and V', track: 'theory', drill: 'prog' },
  'prog.2': { title: 'Progressions: ii–V–I, I–vi–IV–V and more', track: 'theory', drill: 'prog' },
  'tech.five': { title: 'Five-finger patterns', track: 'technique', drill: 'technique' },
  'tech.scales': { title: 'Scales in every key', track: 'technique', drill: 'technique' },
  'tech.arps': { title: 'Arpeggios', track: 'technique', drill: 'technique' },
  'sight.read': { title: 'Sight-reading', track: 'sight', drill: 'sight' },
};

/**
 * The path. Each level asks for lessons, skill mastery, technique (scales
 * played clean at a tempo), sight-reading level and repertoire. Tempo
 * floors follow the exam boards' scale speeds (notes per second) as a
 * percent of each exercise's set tempo.
 */
var PATH = [
  {
    level: 1,
    name: 'First steps',
    reqs: [
      { kind: 'lessons', keys: ['kb-keys', 'kb-names', 'kb-fingers', 'kb-halfsteps', 'rh-beat', 'rh-meter', 'rd-treble', 'rd-bass', 'tc-posture', 'tc-five', 'pr-howto'] },
      { kind: 'skill', key: 'keys.find', mastery: 0.8 },
      { kind: 'skill', key: 'read.treble.1', mastery: 0.75 },
      { kind: 'skill', key: 'read.bass.1', mastery: 0.7 },
      { kind: 'skill', key: 'rhythm.1', mastery: 0.75 },
      { kind: 'skill', key: 'tech.five', mastery: 0.6 },
      { kind: 'songs', level: 1, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 2,
    name: 'Beginner',
    reqs: [
      { kind: 'lessons', keys: ['rh-eighths', 'rh-dotted', 'rd-grand', 'rd-steps', 'rd-accidentals', 'sc-major', 'sc-fingering'] },
      { kind: 'skill', key: 'keys.octave', mastery: 0.75 },
      { kind: 'skill', key: 'read.treble.2', mastery: 0.75 },
      { kind: 'skill', key: 'read.bass.2', mastery: 0.7 },
      { kind: 'skill', key: 'rhythm.2', mastery: 0.75 },
      { kind: 'skill', key: 'ear.int.1', mastery: 0.65 },
      { kind: 'scales', types: ['major'], count: 3, tempo: 70 },
      { kind: 'sight', level: 3 },
      { kind: 'songs', level: 2, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 3,
    name: 'Elementary',
    reqs: [
      { kind: 'lessons', keys: ['rd-marks', 'sc-signatures', 'sc-circle', 'sc-minor', 'iv-numbers', 'iv-quality', 'iv-ear', 'ch-triads', 'ms-dynamics', 'pr-sightreading', 'cr-byear'] },
      { kind: 'skill', key: 'read.grand', mastery: 0.75 },
      { kind: 'skill', key: 'key.sig', mastery: 0.75 },
      { kind: 'skill', key: 'int.name', mastery: 0.75 },
      { kind: 'skill', key: 'chord.play.1', mastery: 0.75 },
      { kind: 'skill', key: 'ear.chord.1', mastery: 0.7 },
      { kind: 'skill', key: 'rhythm.3', mastery: 0.7 },
      { kind: 'scales', types: ['major'], count: 6, tempo: 80 },
      { kind: 'sight', level: 6 },
      { kind: 'songs', level: 3, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 4,
    name: 'Late elementary',
    reqs: [
      { kind: 'lessons', keys: ['rh-advanced', 'sc-other', 'ch-dimaug', 'ch-inversions', 'ch-diatonic', 'hm-primary', 'tc-scales', 'ms-tempo', 'cr-pentatonic'] },
      { kind: 'skill', key: 'read.treble.3', mastery: 0.75 },
      { kind: 'skill', key: 'read.bass.3', mastery: 0.7 },
      { kind: 'skill', key: 'int.play', mastery: 0.75 },
      { kind: 'skill', key: 'chord.play.2', mastery: 0.75 },
      { kind: 'skill', key: 'theory.roman', mastery: 0.7 },
      { kind: 'skill', key: 'ear.int.2', mastery: 0.7 },
      { kind: 'skill', key: 'prog.1', mastery: 0.7 },
      { kind: 'scales', types: ['major'], count: 12, tempo: 80 },
      { kind: 'sight', level: 9 },
      { kind: 'songs', level: 4, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 5,
    name: 'Intermediate',
    reqs: [
      { kind: 'lessons', keys: ['iv-inversion', 'ch-sevenths', 'ch-symbols', 'hm-voiceleading', 'hm-progressions', 'hm-patterns', 'tc-arpeggios', 'tc-chromatic', 'ms-pedal', 'pr-memory'] },
      { kind: 'skill', key: 'read.acc', mastery: 0.75 },
      { kind: 'skill', key: 'chord.play.3', mastery: 0.7 },
      { kind: 'skill', key: 'chord.name', mastery: 0.75 },
      { kind: 'skill', key: 'ear.chord.2', mastery: 0.7 },
      { kind: 'skill', key: 'ear.scale', mastery: 0.65 },
      { kind: 'skill', key: 'rhythm.4', mastery: 0.7 },
      { kind: 'skill', key: 'tech.arps', mastery: 0.65 },
      { kind: 'scales', types: ['major', 'hminor'], count: 18, tempo: 90 },
      { kind: 'sight', level: 13 },
      { kind: 'songs', level: 5, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 6,
    name: 'Upper intermediate',
    reqs: [
      { kind: 'lessons', keys: ['hm-harmonize', 'ms-ornaments', 'pr-performing', 'cr-blues', 'cr-leadsheets'] },
      { kind: 'skill', key: 'ear.int.3', mastery: 0.7 },
      { kind: 'skill', key: 'ear.cadence', mastery: 0.7 },
      { kind: 'skill', key: 'ear.melody.1', mastery: 0.7 },
      { kind: 'skill', key: 'prog.2', mastery: 0.7 },
      { kind: 'skill', key: 'rhythm.5', mastery: 0.7 },
      { kind: 'scales', types: ['major', 'hminor'], count: 24, tempo: 100 },
      { kind: 'sight', level: 17 },
      { kind: 'songs', level: 6, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 7,
    name: 'Early advanced',
    reqs: [
      { kind: 'lessons', keys: ['hm-nonchord', 'tc-advanced', 'ms-form', 'ad-modes'] },
      { kind: 'skill', key: 'ear.melody.2', mastery: 0.7 },
      { kind: 'skill', key: 'chord.play.4', mastery: 0.7 },
      { kind: 'skill', key: 'terms', mastery: 0.8 },
      { kind: 'scales', types: ['mminor'], count: 12, tempo: 100 },
      { kind: 'sight', level: 21 },
      { kind: 'songs', level: 7, count: 2, stage: 'steady' },
    ],
  },
  {
    level: 8,
    name: 'Advanced',
    reqs: [
      { kind: 'lessons', keys: ['ms-styles', 'ad-secondary', 'ad-modulation'] },
      { kind: 'skill', key: 'ear.chord.3', mastery: 0.7 },
      { kind: 'sight', level: 24 },
      { kind: 'songs', level: 8, count: 2, stage: 'mastered' },
    ],
  },
  {
    level: 9,
    name: 'Concert',
    reqs: [
      { kind: 'lessons', keys: ['ad-extended'] },
      { kind: 'sight', level: 27 },
      { kind: 'songs', level: 9, count: 3, stage: 'mastered' },
      { kind: 'program', minutes: 30 },
    ],
  },
  {
    level: 10,
    name: 'Virtuoso',
    reqs: [
      { kind: 'lessons', keys: ['ad-chromatic'] },
      { kind: 'sight', level: 30 },
      { kind: 'songs', level: 10, count: 3, stage: 'mastered' },
      { kind: 'program', minutes: 50 },
    ],
  },
];

/** The track each requirement counts toward on the path grid. */
function trackOf(req) {
  if (req.kind === 'lessons') return 'lessons';
  if (req.kind === 'skill') return (SKILLS[req.key] || {}).track || 'theory';
  if (req.kind === 'scales') return 'technique';
  if (req.kind === 'sight') return 'sight';
  return 'repertoire';
}

function lesson(key) {
  for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].key === key) return LESSONS[i];
  return null;
}

module.exports = { TRACKS: TRACKS, UNITS: UNITS, LESSONS: LESSONS, SKILLS: SKILLS, PATH: PATH, trackOf: trackOf, lesson: lesson };
