/// <reference path="../pb_data/types.d.ts" />
/**
 * The curriculum, from the first note to recital level: units of lessons,
 * the skills the drills train, the vocalise catalogue's skills, and the ten
 * levels of the path with what each one asks for in every track.
 *
 * Lesson CONTENT (the explanations and the interactive steps) lives in the
 * frontend (src/app/learn/); this file is the index both sides share: keys,
 * titles, levels, and what completes a level. The agent reads it through
 * learn.state and app.guide.
 *
 * Calibration: app level = RCM Voice level + 1 up to Level 9 (Level 10 is
 * RCM 10 and ARCT entry), checked against the ABRSM singing grades. The
 * names are the app's own; no exam board is implied.
 */

var TRACKS = [
  { key: 'lessons', title: 'Lessons' },
  { key: 'pitch', title: 'Pitch' },
  { key: 'ear', title: 'Ear' },
  { key: 'sight', title: 'Sight-singing' },
  { key: 'theory', title: 'Theory & rhythm' },
  { key: 'technique', title: 'Technique' },
  { key: 'voice', title: 'Voice' },
  { key: 'songs', title: 'Songs' },
];

var UNITS = [
  { key: 'voice', title: 'Your voice' },
  { key: 'breath', title: 'Breath' },
  { key: 'tone', title: 'Onset and tone' },
  { key: 'pitch', title: 'Pitch and the ear' },
  { key: 'rhythm', title: 'Rhythm' },
  { key: 'reading', title: 'Reading and sight-singing' },
  { key: 'theory', title: 'Theory for singers' },
  { key: 'registers', title: 'Registers and range' },
  { key: 'diction', title: 'Vowels, diction and languages' },
  { key: 'expression', title: 'Agility and expression' },
  { key: 'styles', title: 'Styles' },
  { key: 'performance', title: 'Songs and performance' },
  { key: 'health', title: 'Vocal health' },
];

// [key, unit, level, title, minutes]
var LESSON_ROWS = [
  ['vo-instrument', 'voice', 1, 'Your voice is an instrument: source and filter', 6],
  ['vo-pitch', 'voice', 1, 'How the folds make pitch', 6],
  ['vo-types', 'voice', 2, 'Voice types, and why labels wait', 7],
  ['vo-resonators', 'voice', 3, 'Resonators: where colour comes from', 7],
  ['vo-formants', 'voice', 7, "Harmonics, formants and the singer's formant", 9],
  ['vo-tuning', 'voice', 9, 'Resonance tuning: how sopranos and belters use formants', 9],

  ['br-posture', 'breath', 1, 'Posture and alignment', 5],
  ['br-cycle', 'breath', 1, 'The breath cycle: inhale, suspend, sing, recover', 6],
  ['br-support', 'breath', 2, 'Support without squeezing', 7],
  ['br-planning', 'breath', 3, 'Planning breaths in a phrase', 6],
  ['br-stamina', 'breath', 4, 'Breath stamina and the sustain test', 6],
  ['br-appoggio', 'breath', 7, 'Appoggio and long lines', 8],

  ['tn-sovt', 'tone', 1, 'Straws, lip trills and hums', 6],
  ['tn-onset', 'tone', 2, 'Starting and ending a note: breathy, hard, balanced', 7],
  ['tn-ring', 'tone', 4, 'Ring and forward resonance', 7],
  ['tn-colour', 'tone', 5, 'Bright and dark: tone colour', 7],
  ['tn-carry', 'tone', 8, "Carrying power and the singer's formant", 8],

  ['pi-match', 'pitch', 1, 'Matching a note, in your own octave', 6],
  ['pi-steps', 'pitch', 1, 'Steps and skips', 6],
  ['pi-cents', 'pitch', 2, 'How in tune is in tune: cents', 6],
  ['pi-thirds', 'pitch', 2, 'Thirds and fifths', 7],
  ['pi-fourths', 'pitch', 4, 'Fourths, sixths and octaves', 7],
  ['pi-key', 'pitch', 5, 'Staying in key without accompaniment', 7],
  ['pi-harmony', 'pitch', 6, 'Holding a harmony part', 8],
  ['pi-seconds', 'pitch', 7, 'Seconds, sevenths and the tritone', 8],

  ['rh-beat', 'rhythm', 1, 'Beat, tempo, note values and ta, ti-ti', 6],
  ['rh-meter', 'rhythm', 1, 'Bars, time signatures and rests', 6],
  ['rh-dotted', 'rhythm', 3, 'Dotted rhythms and ties', 6],
  ['rh-compound', 'rhythm', 5, '6/8 and compound time', 7],
  ['rh-advanced', 'rhythm', 7, 'Triplets, syncopation and semiquavers', 8],

  ['rd-staff', 'reading', 1, 'The staff and your clef', 7],
  ['rd-solfege', 'reading', 1, 'Solfège and hand signs', 7],
  ['rd-systems', 'reading', 2, 'Movable do, fixed do and numbers', 6],
  ['rd-first', 'reading', 2, 'Your first sight-singing: stepwise tunes', 7],
  ['rd-marks', 'reading', 3, 'Dynamics, tempo and expression marks', 6],
  ['rd-minor', 'reading', 4, 'Minor keys in solfège', 7],
  ['rd-leaps', 'reading', 4, 'Sight-singing with leaps', 7],
  ['rd-chromatic', 'reading', 7, 'Accidentals and chromatic notes', 8],

  ['th-major', 'theory', 2, 'The major scale', 7],
  ['th-keys', 'theory', 3, 'Keys and key signatures', 8],
  ['th-minor', 'theory', 4, 'Minor scales', 7],
  ['th-chords', 'theory', 4, 'Chords and arpeggios', 7],
  ['th-cadences', 'theory', 6, 'Hearing the key: cadences and scale degrees', 8],

  ['rg-registers', 'registers', 3, 'Registers: chest, head and the break', 8],
  ['rg-passaggio', 'registers', 5, 'The passaggio and your bridge notes', 8],
  ['rg-mix', 'registers', 6, 'Mix: blending registers', 8],
  ['rg-range', 'registers', 6, 'Extending your range safely', 7],
  ['rg-turning', 'registers', 8, 'Turning over: vowel modification for male voices', 8],

  ['di-vowels', 'diction', 2, 'The five pure vowels', 7],
  ['di-consonants', 'diction', 3, 'Consonants that help the line', 6],
  ['di-ipa', 'diction', 4, 'IPA for singers', 8],
  ['di-modification', 'diction', 6, 'Vowel modification up high', 7],
  ['di-italian', 'diction', 6, 'Singing in Italian', 8],
  ['di-languages', 'diction', 8, 'Latin, German and French', 9],

  ['ex-legato', 'expression', 3, 'Legato', 6],
  ['ex-staccato', 'expression', 4, 'Staccato and light onsets', 6],
  ['ex-dynamics', 'expression', 4, 'Dynamics without losing pitch', 7],
  ['ex-vibrato', 'expression', 5, 'Vibrato: what it is and how it emerges', 8],
  ['ex-messa', 'expression', 7, 'Messa di voce', 7],
  ['ex-agility', 'expression', 7, 'Agility: scales, runs and roulades', 8],
  ['ex-ornaments', 'expression', 8, 'Turns, appoggiaturas and mordents', 8],
  ['ex-trill', 'expression', 9, 'The trill', 7],
  ['ex-portamento', 'expression', 9, 'Portamento and recitative', 8],

  ['st-folk', 'styles', 2, 'Folk and unaccompanied song', 6],
  ['st-ccm', 'styles', 5, 'Contemporary styles', 8],
  ['st-artsong', 'styles', 6, 'Art song and arie antiche', 8],
  ['st-methods', 'styles', 7, 'Four vocabularies: bel canto, Estill, CVT, SLS', 9],
  ['st-belting', 'styles', 8, 'Belting, and belting safely', 8],
  ['st-baroque', 'styles', 9, 'Baroque style: Handel and Bach', 8],

  ['pf-learn', 'performance', 1, 'How to learn a song', 6],
  ['pf-practise', 'performance', 1, 'How to practise: short, spaced, varied', 6],
  ['pf-recording', 'performance', 3, 'Recording yourself', 6],
  ['pf-memory', 'performance', 4, 'Memorising a song', 6],
  ['pf-nerves', 'performance', 6, 'Performing and nerves', 7],
  ['pf-recital', 'performance', 10, 'Planning a recital', 8],

  ['he-care', 'health', 1, 'Looking after your voice', 6],
  ['he-warmup', 'health', 1, 'Warm-ups and cool-downs: how long and why', 5],
  ['he-signs', 'health', 2, 'Warning signs and when to see a doctor', 6],
  ['he-load', 'health', 3, 'Vocal load: how much is too much', 6],
  ['he-season', 'health', 10, 'A voice for life: load across a season', 7],
];

var LESSONS = LESSON_ROWS.map(function (r) {
  return { key: r[0], unit: r[1], level: r[2], title: r[3], minutes: r[4] };
});

/**
 * Skills the drills train. `drill` names the trainer in the app:
 *   quiz      answered by tapping (1-9)
 *   sing      sung items in Train (the voice dial judges each one)
 *   speak     a rhythm spoken on "ta", judged on onsets
 *   exercise  a vocalise from the catalogue, sung in the practice screen
 *   sight     generated sight-singing, sung from the sheet
 * `levels` marks an adaptive skill (it keeps a level and a best level);
 * `target_ms` is the answer time that counts as fluent.
 */
var SKILLS = {
  'pitch.match.1': { title: 'Matching a note', track: 'pitch', drill: 'sing', target_ms: 1500 },
  'pitch.match.2': { title: 'Matching notes across your range', track: 'pitch', drill: 'sing', target_ms: 1200 },
  'pitch.hold': { title: 'Holding a note steady', track: 'pitch', drill: 'sing' },
  'pitch.slide': { title: 'Sliding onto a note', track: 'pitch', drill: 'sing', target_ms: 2000 },
  'pitch.drone': { title: 'Scales against a drone', track: 'pitch', drill: 'exercise' },
  'pitch.unacc': { title: 'Unaccompanied without drifting', track: 'pitch', drill: 'exercise' },
  'pitch.harmony': { title: 'Holding a harmony line', track: 'pitch', drill: 'exercise' },

  'int.sing': { title: 'Singing intervals', track: 'ear', drill: 'sing', levels: 9, target_ms: 1800 },
  'int.hear': { title: 'Naming intervals by ear', track: 'ear', drill: 'quiz', levels: 3, target_ms: 4000 },
  'ear.echo': { title: 'Echoing short phrases', track: 'ear', drill: 'sing', levels: 6 },
  'ear.memory': { title: 'Singing back a melody', track: 'ear', drill: 'sing', levels: 3 },
  'ear.degree': { title: 'Scale degrees after a cadence', track: 'ear', drill: 'sing', target_ms: 2500 },
  'ear.majmin': { title: 'Major or minor', track: 'ear', drill: 'quiz', target_ms: 3500 },
  'ear.cadence': { title: 'Hearing cadences', track: 'ear', drill: 'quiz', target_ms: 6000 },
  'ear.harmony.1': { title: 'Singing the upper part', track: 'ear', drill: 'exercise' },
  'ear.harmony.2': { title: 'Singing the lower part', track: 'ear', drill: 'exercise' },

  'sight.sing': { title: 'Sight-singing', track: 'sight', drill: 'sight', levels: 30 },
  'sight.solfege': { title: 'Solfège on the staff', track: 'sight', drill: 'quiz', target_ms: 2200 },
  'read.staff': { title: 'Note names in your clef', track: 'sight', drill: 'quiz', target_ms: 2000 },

  'rhythm.1': { title: 'Rhythm: quarters, halves and wholes', track: 'theory', drill: 'speak' },
  'rhythm.2': { title: 'Rhythm: eighths and rests', track: 'theory', drill: 'speak' },
  'rhythm.3': { title: 'Rhythm: dotted notes and ties', track: 'theory', drill: 'speak' },
  'rhythm.4': { title: 'Rhythm: compound time', track: 'theory', drill: 'speak' },
  'rhythm.5': { title: 'Rhythm: triplets, syncopation, semiquavers', track: 'theory', drill: 'speak' },
  'key.sig': { title: 'Key signatures', track: 'theory', drill: 'quiz', target_ms: 3500 },
  'int.name': { title: 'Naming intervals on the staff', track: 'theory', drill: 'quiz', target_ms: 3500 },
  'chord.name': { title: 'Naming chords', track: 'theory', drill: 'quiz', target_ms: 4000 },
  terms: { title: 'Terms and signs', track: 'theory', drill: 'quiz', target_ms: 4000 },
  ipa: { title: 'Vowels and IPA', track: 'theory', drill: 'quiz', target_ms: 3500 },

  'tech.sovt': { title: 'Straw and lip-trill glides', track: 'technique', drill: 'exercise' },
  'tech.fivetone': { title: 'Five-tone scales', track: 'technique', drill: 'exercise' },
  'tech.arps': { title: 'Arpeggios', track: 'technique', drill: 'exercise' },
  'tech.scales': { title: 'Scales: major, minor, chromatic', track: 'technique', drill: 'exercise' },
  'tech.leaps': { title: 'Octaves and nine-tone scales', track: 'technique', drill: 'exercise' },
  'tech.vowels': { title: 'Steady pitch through vowel changes', track: 'technique', drill: 'exercise' },
  'tech.bridge': { title: 'Through the passaggio', track: 'technique', drill: 'exercise' },
  'tech.messa': { title: 'Messa di voce', track: 'technique', drill: 'exercise' },
  'tech.agility': { title: 'Agility', track: 'technique', drill: 'exercise' },
  'tech.ornaments': { title: 'Turns, triplets and trills', track: 'technique', drill: 'exercise' },

  'breath.sustain': { title: 'Sustain on one breath', track: 'voice', drill: 'sing' },
  'breath.phrase': { title: 'Phrases on one breath', track: 'voice', drill: 'sing' },
};

/**
 * The vocalise catalogue: each exercise, the skill its clean passes count
 * toward, and the level it opens at. The patterns themselves are generated
 * in the frontend (src/app/music/generate.ts); this list is what the path
 * and the plan may ask for.
 */
var EXERCISES = {
  'sovt.siren': { title: 'Sirens on a straw or lip trill', skill: 'tech.sovt', level: 1 },
  'sovt.hills': { title: 'Little hills (1-2-1)', skill: 'tech.sovt', level: 1 },
  desc5: { title: 'Gentle descents (5-4-3-2-1)', skill: 'tech.fivetone', level: 1 },
  three: { title: 'Three-note scale (1-2-3-2-1)', skill: 'tech.fivetone', level: 1 },
  'five.maj': { title: 'Five-tone scale, major', skill: 'tech.fivetone', level: 1 },
  'triad.maj': { title: 'Triad (1-3-5-3-1)', skill: 'tech.arps', level: 1 },
  'five.min': { title: 'Five-tone scale, minor', skill: 'tech.fivetone', level: 2 },
  'vowels.one': { title: 'Five vowels on one pitch', skill: 'tech.vowels', level: 2 },
  thirds: { title: 'Thirds (1-3-2-4-3-5-4-2-1)', skill: 'tech.scales', level: 3 },
  'arp.maj': { title: 'Arpeggio, major (1-3-5-8)', skill: 'tech.arps', level: 3 },
  'arp.min': { title: 'Arpeggio, minor (1-♭3-5-8)', skill: 'tech.arps', level: 3 },
  'scale.maj': { title: 'Major scale, one octave', skill: 'tech.scales', level: 4 },
  'scale.nmin': { title: 'Natural minor scale', skill: 'tech.scales', level: 4 },
  'scale.hmin': { title: 'Harmonic minor scale', skill: 'tech.scales', level: 5 },
  'scale.mmin': { title: 'Melodic minor scale', skill: 'tech.scales', level: 5 },
  chromatic: { title: 'Chromatic scale', skill: 'tech.scales', level: 4 },
  'arp.stacc': { title: 'Staccato arpeggio', skill: 'tech.arps', level: 4 },
  'octave.rep': { title: 'Octave and descending scale (1-8-7…1)', skill: 'tech.leaps', level: 5 },
  nine: { title: 'Nine-tone scale', skill: 'tech.leaps', level: 5 },
  bridge: { title: 'Five-tone through the passaggio', skill: 'tech.bridge', level: 5 },
  dom7: { title: 'Dominant seventh arpeggio', skill: 'tech.arps', level: 6 },
  intervals: { title: 'Intervals from the tonic', skill: 'tech.leaps', level: 6 },
  'scale.thirds': { title: 'Scale in thirds', skill: 'tech.scales', level: 7 },
  messa: { title: 'Messa di voce', skill: 'tech.messa', level: 7 },
  agility: { title: 'Agility runs', skill: 'tech.agility', level: 7 },
  turns: { title: 'Scale with turns', skill: 'tech.ornaments', level: 8 },
  triplets: { title: 'Triplet figures', skill: 'tech.ornaments', level: 8 },
  'arp.10': { title: 'Arpeggio to the tenth', skill: 'tech.arps', level: 8 },
  'arp.12': { title: 'Arpeggio to the twelfth', skill: 'tech.arps', level: 9 },
  'trill.m': { title: 'Measured trill', skill: 'tech.ornaments', level: 9 },
  'two.oct': { title: 'Two-octave scale', skill: 'tech.scales', level: 10 },
  martellato: { title: 'Martellato with turns', skill: 'tech.ornaments', level: 10 },
  'trill.u': { title: 'Unmeasured trill', skill: 'tech.ornaments', level: 10 },
};

/**
 * The path. Requirement kinds:
 *   lessons  these lessons done
 *   skill    a skill's mastery (0-1) at least `mastery`
 *   level    an adaptive skill's level at least `level`
 *   tech     each of these vocalises clean (Normal strictness or stricter)
 *            starting on at least `count` different notes, at `bpm` or faster
 *   voice    a measured fact: `span` semitones of comfortable range, `sustain`
 *            seconds on one breath, `hold` (steadiness at most `sd` cents over
 *            `secs` seconds), `swell` (dB through a messa di voce), `retest`
 *            (a range test within `days` days)
 *   songs    `count` songs or vocalises at `level` or above at `stage`
 *            (steady or mastered); `type` (song, vocalise), `tag`, `lang`
 *            (language code), `langs` (distinct languages among them), `solo`
 *            (that many with a clean Solo pass), `memory` (a clean Solo with
 *            the words and notes hidden)
 *   program  mastered songs adding up to `minutes` of music
 */
var PATH = [
  {
    level: 1,
    name: 'First notes',
    reqs: [
      { kind: 'skill', key: 'pitch.match.1', mastery: 0.75 },
      { kind: 'level', key: 'ear.echo', level: 1 },
      { kind: 'level', key: 'sight.sing', level: 1 },
      { kind: 'skill', key: 'rhythm.1', mastery: 0.7 },
      { kind: 'tech', keys: ['five.maj', 'triad.maj'], count: 3 },
      { kind: 'voice', metric: 'span', min: 6 },
      { kind: 'voice', metric: 'sustain', min: 10 },
      { kind: 'songs', level: 1, count: 2, stage: 'steady', solo: 1 },
    ],
  },
  {
    level: 2,
    name: 'Beginner',
    reqs: [
      { kind: 'skill', key: 'pitch.match.2', mastery: 0.75 },
      { kind: 'skill', key: 'pitch.hold', mastery: 0.7 },
      { kind: 'level', key: 'int.sing', level: 1 },
      { kind: 'level', key: 'ear.echo', level: 2 },
      { kind: 'level', key: 'sight.sing', level: 3 },
      { kind: 'skill', key: 'read.staff', mastery: 0.75 },
      { kind: 'skill', key: 'rhythm.2', mastery: 0.7 },
      { kind: 'tech', keys: ['five.min'], count: 5, bpm: 90 },
      { kind: 'voice', metric: 'span', min: 10 },
      { kind: 'voice', metric: 'sustain', min: 12 },
      { kind: 'voice', metric: 'hold', sd: 20, secs: 3 },
      { kind: 'songs', level: 2, count: 3, stage: 'steady' },
      { kind: 'songs', level: 1, count: 1, stage: 'steady', tag: 'trad', memory: 1 },
    ],
  },
  {
    level: 3,
    name: 'Elementary',
    reqs: [
      { kind: 'skill', key: 'pitch.drone', mastery: 0.7 },
      { kind: 'level', key: 'int.sing', level: 2 },
      { kind: 'level', key: 'ear.echo', level: 3 },
      { kind: 'level', key: 'sight.sing', level: 6 },
      { kind: 'skill', key: 'key.sig', mastery: 0.7 },
      { kind: 'skill', key: 'rhythm.3', mastery: 0.7 },
      { kind: 'tech', keys: ['thirds', 'arp.maj'], count: 5, bpm: 80 },
      { kind: 'voice', metric: 'sustain', min: 15 },
      { kind: 'songs', level: 3, count: 3, stage: 'steady' },
      { kind: 'songs', level: 3, count: 1, stage: 'steady', type: 'vocalise' },
    ],
  },
  {
    level: 4,
    name: 'Late elementary',
    reqs: [
      { kind: 'skill', key: 'pitch.slide', mastery: 0.7 },
      { kind: 'level', key: 'int.sing', level: 3 },
      { kind: 'level', key: 'ear.memory', level: 1 },
      { kind: 'level', key: 'sight.sing', level: 9 },
      { kind: 'skill', key: 'int.name', mastery: 0.75 },
      { kind: 'skill', key: 'sight.solfege', mastery: 0.75 },
      { kind: 'tech', keys: ['scale.maj', 'scale.nmin', 'chromatic', 'arp.stacc'], count: 5 },
      { kind: 'voice', metric: 'span', min: 12 },
      { kind: 'voice', metric: 'hold', sd: 15, secs: 4 },
      { kind: 'songs', level: 4, count: 3, stage: 'steady' },
      { kind: 'songs', level: 1, count: 2, stage: 'steady', tag: 'trad', memory: 2 },
    ],
  },
  {
    level: 5,
    name: 'Intermediate',
    reqs: [
      { kind: 'skill', key: 'pitch.unacc', mastery: 0.7 },
      { kind: 'level', key: 'int.sing', level: 4 },
      { kind: 'level', key: 'ear.memory', level: 2 },
      { kind: 'level', key: 'sight.sing', level: 13 },
      { kind: 'skill', key: 'rhythm.4', mastery: 0.7 },
      { kind: 'tech', keys: ['scale.hmin', 'scale.mmin', 'octave.rep', 'nine', 'bridge'], count: 5 },
      { kind: 'voice', metric: 'sustain', min: 18 },
      { kind: 'voice', metric: 'retest', days: 30 },
      { kind: 'songs', level: 5, count: 3, stage: 'steady' },
      { kind: 'songs', level: 4, count: 1, stage: 'steady', tag: 'art' },
    ],
  },
  {
    level: 6,
    name: 'Upper intermediate',
    reqs: [
      { kind: 'level', key: 'int.sing', level: 5 },
      { kind: 'skill', key: 'ear.degree', mastery: 0.7 },
      { kind: 'skill', key: 'ear.majmin', mastery: 0.8 },
      { kind: 'level', key: 'sight.sing', level: 17 },
      { kind: 'skill', key: 'chord.name', mastery: 0.7 },
      { kind: 'tech', keys: ['intervals', 'dom7', 'arp.maj', 'vowels.one'], count: 5 },
      { kind: 'voice', metric: 'span', min: 15 },
      { kind: 'voice', metric: 'hold', sd: 12, secs: 6 },
      { kind: 'songs', level: 6, count: 3, stage: 'steady' },
      { kind: 'songs', level: 5, count: 1, stage: 'steady', lang: 'it' },
    ],
  },
  {
    level: 7,
    name: 'Early advanced',
    reqs: [
      { kind: 'level', key: 'int.sing', level: 6 },
      { kind: 'skill', key: 'ear.harmony.1', mastery: 0.7 },
      { kind: 'skill', key: 'pitch.harmony', mastery: 0.7 },
      { kind: 'level', key: 'sight.sing', level: 21 },
      { kind: 'skill', key: 'rhythm.5', mastery: 0.7 },
      { kind: 'tech', keys: ['scale.thirds', 'agility'], count: 5, bpm: 112 },
      { kind: 'voice', metric: 'swell', db: 8 },
      { kind: 'voice', metric: 'sustain', min: 20 },
      { kind: 'songs', level: 7, count: 2, stage: 'mastered' },
      { kind: 'songs', level: 7, count: 1, stage: 'steady', lang: 'it' },
    ],
  },
  {
    level: 8,
    name: 'Advanced',
    reqs: [
      { kind: 'level', key: 'int.sing', level: 7 },
      { kind: 'skill', key: 'ear.harmony.2', mastery: 0.7 },
      { kind: 'level', key: 'sight.sing', level: 24 },
      { kind: 'skill', key: 'terms', mastery: 0.8 },
      { kind: 'tech', keys: ['messa', 'turns', 'triplets', 'arp.10'], count: 3 },
      { kind: 'voice', metric: 'span', min: 17 },
      { kind: 'voice', metric: 'hold', sd: 10, secs: 8 },
      { kind: 'songs', level: 8, count: 4, stage: 'mastered', langs: 2 },
    ],
  },
  {
    level: 9,
    name: 'Concert',
    reqs: [
      { kind: 'level', key: 'int.sing', level: 8 },
      { kind: 'level', key: 'sight.sing', level: 27 },
      { kind: 'tech', keys: ['trill.m', 'arp.12'], count: 3 },
      { kind: 'tech', keys: ['agility'], count: 3, bpm: 144 },
      { kind: 'voice', metric: 'span', min: 19 },
      { kind: 'songs', level: 9, count: 3, stage: 'mastered' },
      { kind: 'program', minutes: 20 },
    ],
  },
  {
    level: 10,
    name: 'Artist',
    reqs: [
      { kind: 'level', key: 'int.sing', level: 9 },
      { kind: 'level', key: 'sight.sing', level: 30 },
      { kind: 'tech', keys: ['two.oct', 'martellato', 'trill.u'], count: 3 },
      { kind: 'voice', metric: 'span', min: 24 },
      { kind: 'songs', level: 9, count: 5, stage: 'mastered', langs: 3 },
      { kind: 'program', minutes: 30 },
    ],
  },
];

// Every level's Lessons track asks for that level's lessons.
for (var pl = 0; pl < PATH.length; pl++) {
  var keys = LESSONS.filter(function (l) {
    return l.level === PATH[pl].level;
  }).map(function (l) {
    return l.key;
  });
  PATH[pl].reqs.unshift({ kind: 'lessons', keys: keys });
}

/** The track each requirement counts toward on the path grid. */
function trackOf(req) {
  if (req.kind === 'lessons') return 'lessons';
  if (req.kind === 'skill' || req.kind === 'level') return (SKILLS[req.key] || {}).track || 'theory';
  if (req.kind === 'tech') return 'technique';
  if (req.kind === 'voice') return 'voice';
  return 'songs';
}

function lesson(key) {
  for (var i = 0; i < LESSONS.length; i++) if (LESSONS[i].key === key) return LESSONS[i];
  return null;
}

module.exports = { TRACKS: TRACKS, UNITS: UNITS, LESSONS: LESSONS, SKILLS: SKILLS, EXERCISES: EXERCISES, PATH: PATH, trackOf: trackOf, lesson: lesson };
