/// <reference path="../pb_data/types.d.ts" />
/**
 * The singer's voice: range tests, the comfortable range, a voice family
 * (never a Fach label: voices settle until the early twenties and labels
 * given too early do harm), a passaggio estimate, and the key a song fits
 * this voice best in.
 *
 *   range        lowest and highest notes held for a second, within ±50¢
 *   comfortable  the range less two semitones at each end
 *   family       high (treble clef), medium (treble, or treble with an 8
 *                below for men's voices), low (bass clef); the speaking pitch
 *                tells women's and men's voices apart when it was measured
 *   passaggio    Miller's typical primo and secondo passaggio of the closest
 *                typical range, until glides show where this voice turns
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}

var NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
function noteName(m) {
  var r = Math.round(m);
  return NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
}

// Typical ranges and Miller's passaggi (report: "Classify late, transpose always").
var TYPICAL = [
  { key: 'soprano', title: 'Soprano', lo: 60, hi: 84, primo: 63, secondo: 78, women: true },
  { key: 'mezzo', title: 'Mezzo-soprano', lo: 57, hi: 81, primo: 64, secondo: 76, women: true },
  { key: 'contralto', title: 'Contralto', lo: 53, hi: 77, primo: 68, secondo: 74, women: true },
  { key: 'tenor', title: 'Tenor', lo: 48, hi: 72, primo: 62, secondo: 67, women: false },
  { key: 'baritone', title: 'Baritone', lo: 45, hi: 69, primo: 59, secondo: 64, women: false },
  { key: 'bass', title: 'Bass', lo: 40, hi: 64, primo: 56, secondo: 61, women: false },
];

/** Defaults before any test: a middle voice around A3–D5 (an untested adult). */
var DEFAULT_VOICE = { low: 52, high: 74, comf_low: 55, comf_high: 70, family: 'medium', clef: 'treble', passaggio: { primo: 62, secondo: 69, source: 'default until your range is measured' } };

function closest(low, high, women) {
  var best = null;
  var bestD = 1e9;
  for (var i = 0; i < TYPICAL.length; i++) {
    var t = TYPICAL[i];
    if (women !== null && t.women !== women) continue;
    var d = Math.abs(t.lo - low) + Math.abs(t.hi - high);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  return best;
}

/** Family, clef and passaggio from a measured range (and the speaking pitch, when known). */
function classify(low, high, speakingHz) {
  var comfLow = low + 2;
  var comfHigh = high - 2;
  if (comfHigh - comfLow < 5) {
    comfLow = low;
    comfHigh = high;
  }
  var mid = (comfLow + comfHigh) / 2;
  var women = speakingHz > 60 ? speakingHz >= 165 : null;
  var family;
  var clef;
  if (women === true) {
    family = mid >= 66 ? 'high' : 'medium';
    clef = 'treble';
  } else if (women === false) {
    family = mid >= 55 ? 'medium' : 'low';
    clef = family === 'medium' ? 'treble8' : 'bass';
  } else {
    family = mid >= 64 ? 'high' : mid >= 55 ? 'medium' : 'low';
    clef = family === 'low' ? 'bass' : mid >= 59 ? 'treble' : 'treble8';
  }
  var t = closest(low, high, women);
  return {
    comf_low: comfLow,
    comf_high: comfHigh,
    family: family,
    clef: clef,
    passaggio: { primo: t.primo, secondo: t.secondo, source: 'typical for the closest range (' + t.title.toLowerCase() + ', Miller)', closest: t.key },
  };
}

/** The current voice: the latest test, or defaults. */
function current(app) {
  var rows = app.findRecordsByFilter('voice', '', '-created', 1, 0);
  if (rows.length === 0) return Object.assign({ id: '', tested: false, kind: '', created: '', sustain_s: 0, speaking_hz: 0, breaks: [] }, DEFAULT_VOICE);
  return voiceJson(rows[0]);
}

function voiceJson(rec) {
  var u = U();
  var pas = u.getJson(rec, 'passaggio') || DEFAULT_VOICE.passaggio;
  return {
    id: rec.id,
    tested: true,
    kind: rec.getString('kind'),
    created: rec.getString('created'),
    speaking_hz: rec.getFloat('speaking_hz'),
    low: rec.getFloat('low'),
    high: rec.getFloat('high'),
    comf_low: rec.getFloat('comf_low'),
    comf_high: rec.getFloat('comf_high'),
    family: rec.getString('family') || 'medium',
    clef: rec.getString('clef') || 'treble',
    passaggio: pas,
    breaks: u.getJson(rec, 'breaks') || [],
    sustain_s: rec.getFloat('sustain_s'),
    note: rec.getString('note'),
  };
}

/** A lean description for the agent and the guide. */
function describe(v) {
  if (!v.tested) return 'not measured yet (defaults ' + noteName(v.comf_low) + '–' + noteName(v.comf_high) + ')';
  return (
    'range ' + noteName(v.low) + '–' + noteName(v.high) + ', comfortable ' + noteName(v.comf_low) + '–' + noteName(v.comf_high) +
    ' (' + Math.round(v.comf_high - v.comf_low) + ' semitones), ' + v.family + ' voice, ' + (v.clef === 'treble8' ? 'treble clef an octave down' : v.clef + ' clef') +
    ', passaggio around ' + noteName(v.passaggio.primo) + ' and ' + noteName(v.passaggio.secondo)
  );
}

/**
 * The shift in semitones (−12..+12) that sits a melody best in this voice:
 * inside the comfortable range if it can, with its median a little below the
 * middle of it. Returns the shift, whether it fits, and by how much it is
 * over at either end.
 */
function bestShift(v, lo, hi, med) {
  var target = v.comf_low + (v.comf_high - v.comf_low) * 0.45;
  var best = 0;
  var bestP = 1e9;
  for (var s = -12; s <= 12; s++) {
    var under = Math.max(0, v.comf_low - (lo + s));
    var over = Math.max(0, hi + s - v.comf_high);
    var p = (under + over) * 4 + Math.abs(med + s - target) + Math.abs(s) * 0.05;
    if (p < bestP - 1e-9) {
      bestP = p;
      best = s;
    }
  }
  var under2 = Math.max(0, v.comf_low - (lo + best));
  var over2 = Math.max(0, hi + best - v.comf_high);
  return { shift: best, fits: under2 === 0 && over2 === 0, under: under2, over: over2 };
}

/* ------------------------------------------------------------------ ops */

function get(app) {
  var v = current(app);
  var hist = app.findRecordsByFilter('voice', '', '-created', 12, 0).map(function (r) {
    var j = voiceJson(r);
    return { id: j.id, kind: j.kind, created: j.created, low: j.low, high: j.high, comf_low: j.comf_low, comf_high: j.comf_high, sustain_s: j.sustain_s };
  });
  return { voice: v, summary: describe(v), history: hist, typical: TYPICAL };
}

/** A range test from the page: lowest and highest held notes (MIDI, may be fractional), optional speaking pitch and sustain. */
function test(app, e, p) {
  var u = U();
  u.personOnly(e, 'run a range test (the person sings it)');
  var kind = u.oneOf(p, 'kind', ['onboarding', 'quick', 'full', 'manual'], 'full');
  var low = u.number(p, 'low', { min: 24, max: 100, required: true, example: '48' });
  var high = u.number(p, 'high', { min: 30, max: 108, required: true, example: '72' });
  if (high - low < 3) throw u.fail(400, 'high must be at least 3 semitones above low (got ' + noteName(low) + ' to ' + noteName(high) + '); sing the test again.', 'bad_range');
  var prev = current(app);
  var speak = u.number(p, 'speaking_hz', { min: 0, max: 600 }) || prev.speaking_hz || 0;
  var sustain = u.number(p, 'sustain_s', { min: 0, max: 120 });
  var c = classify(low, high, speak);
  var breaks = u.has(p, 'breaks') ? u.json(p, 'breaks', '[{"at":62.4,"jump":180}]') : [];
  if (Array.isArray(breaks) && breaks.length > 0) {
    // A measured jump in a glide is better evidence than the typical table.
    var ups = breaks.filter(function (b) {
      return b && typeof b.at === 'number' && b.at > c.comf_low && b.at < c.comf_high;
    });
    if (ups.length > 0) {
      ups.sort(function (a, b) {
        return a.at - b.at;
      });
      c.passaggio = { primo: Math.round(ups[0].at), secondo: Math.round(ups.length > 1 ? ups[ups.length - 1].at : c.passaggio.secondo), source: 'measured in your glides', closest: c.passaggio.closest };
    }
  }
  var rec = new Record(app.findCollectionByNameOrId('voice'));
  rec.set('kind', kind);
  rec.set('speaking_hz', speak);
  rec.set('low', Math.round(low * 10) / 10);
  rec.set('high', Math.round(high * 10) / 10);
  rec.set('comf_low', c.comf_low);
  rec.set('comf_high', c.comf_high);
  rec.set('family', c.family);
  rec.set('clef', c.clef);
  rec.set('passaggio', c.passaggio);
  rec.set('breaks', Array.isArray(breaks) ? breaks.slice(0, 20) : []);
  rec.set('sustain_s', sustain || prev.sustain_s || 0);
  // Under-18 singers keep to the comfortable range they measured.
  app.save(rec);
  var v = voiceJson(rec);
  return { voice: v, summary: describe(v), previous: prev.tested ? { low: prev.low, high: prev.high, comf_low: prev.comf_low, comf_high: prev.comf_high } : null, level_up: require(`${__hooks}/lib_learn.js`).advance(app) };
}

/** Best sustain on one breath, kept on the voice (from breath drills). */
function noteSustain(app, seconds) {
  var rows = app.findRecordsByFilter('voice', '', '-created', 1, 0);
  if (rows.length === 0) return;
  var r = rows[0];
  if (seconds > r.getFloat('sustain_s')) {
    r.set('sustain_s', Math.round(seconds * 10) / 10);
    app.save(r);
  }
}

module.exports = { TYPICAL: TYPICAL, DEFAULT_VOICE: DEFAULT_VOICE, noteName: noteName, classify: classify, current: current, voiceJson: voiceJson, describe: describe, bestShift: bestShift, get: get, test: test, noteSustain: noteSustain };
