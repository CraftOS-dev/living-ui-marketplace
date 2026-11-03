/// <reference path="../pb_data/types.d.ts" />
/**
 * ABC notation in, a song the app can practise out.
 *
 * Songs are stored as ABC text (what the agent and the person write and
 * edit) plus the model parsed from it here (what the practice screen reads):
 *
 *   bars    the bars in playing order (repeats and endings unrolled), each
 *           with its start and length in quarter notes and a display number
 *           (a pickup bar is bar 0)
 *   notes   every sounding note: [t, d, midi, hand (0 right, 1 left),
 *           finger (0 none), velocity, voice, bar index, staccato]
 *   voices  one per V: line, each on the right or the left hand's staff
 *   events  per voice and bar, what the sheet engraves: chords, notes and
 *           rests with spelled pitches, ties, tuplets, fingering, dynamics
 *
 * The subset is what songs need: header fields (T C M L Q K V), voices with
 * clefs, notes with accidentals, octave marks and lengths, rests (z x Z),
 * chords, ties, broken rhythm, tuplets, bar lines, repeats with first and
 * second endings, inline fields, dynamics (!p! .. !fff!), staccato, chord
 * symbols ("Am7" before a note) and, for singing:
 *
 *   melody   the first voice (or the one named by %%melody <id>) is sung;
 *            it must be one note at a time; other voices accompany
 *   w:       lyric lines under the melody's music lines, aligned note by
 *            note as ABC 2.1 says (- between syllables, _ holds the last
 *            syllable for another note, * skips a note, ~ joins words under
 *            one note, \- is a printed hyphen, | jumps to the next bar);
 *            several w: lines after one music line are verses. The count
 *            must match the notes of that line (tied notes may be counted
 *            or not); every mismatch is an error naming the line and verse
 *   marks    !breath! (breathe before this note), !spoken! (judged on voice
 *            and onset only), !free! (drawn, not scored)
 *   %%       %%voice high|medium|low|any, %%language <code>,
 *            %%licence pd|trad|own|import, %%source <edition>,
 *            %%vowel <syllable> (what a wordless vocalise is sung on)
 *
 * The model adds `melody` (the sung notes, ties merged), `lyrics` (per verse,
 * one syllable per melody note), `phrases` (split at rests and breath marks)
 * and the melody's range and tessitura. Grace notes, slurs and text
 * annotations are read and ignored. Every error names the line, the voice
 * and the bar, so a caller can fix it in one step.
 *
 * Plain JavaScript without PocketBase APIs: it runs in the hooks and in
 * node (the scratch tests).
 */

var STEP_BASE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
var LETTER_FIFTHS = { C: 0, G: 1, D: 2, A: 3, E: 4, B: 5, F: -1 };
var SHARP_ORDER = 'FCGDAEB';
var FLAT_ORDER = 'BEADGCF';
var MODE_OFFSET = { maj: 0, ion: 0, min: -3, m: -3, aeo: -3, mix: -1, dor: -2, phr: -4, lyd: 1, loc: -5 };
var MODE_NAME = { maj: 'major', ion: 'major', min: 'minor', m: 'minor', aeo: 'minor', mix: 'mixolydian', dor: 'dorian', phr: 'phrygian', lyd: 'lydian', loc: 'locrian' };
var MAJOR_BY_FIFTHS = { '-7': 'Cb', '-6': 'Gb', '-5': 'Db', '-4': 'Ab', '-3': 'Eb', '-2': 'Bb', '-1': 'F', 0: 'C', 1: 'G', 2: 'D', 3: 'A', 4: 'E', 5: 'B', 6: 'F#', 7: 'C#' };
var DYN_VEL = { ppp: 30, pp: 42, p: 56, mp: 68, mf: 80, f: 96, ff: 110, fff: 122, sfz: 104, fp: 96 };
var NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
var EPS = 1e-4;

function noteName(midi) {
  return NOTE_NAMES[((midi % 12) + 12) % 12] + (Math.floor(midi / 12) - 1);
}

function round(x) {
  return Math.round(x * 1e6) / 1e6;
}

function beatsText(q) {
  var r = Math.round(q * 1000) / 1000;
  return String(r) + (r === 1 ? ' beat' : ' beats');
}

/* ------------------------------------------------------------- fields */

function parseFraction(s) {
  var m = /^\s*(\d+)\s*\/\s*(\d+)\s*$/.exec(s);
  if (m === null) return null;
  var a = Number(m[1]);
  var b = Number(m[2]);
  if (a <= 0 || b <= 0) return null;
  return { num: a, den: b };
}

/** M: field → {num, den, label, q (bar length in quarters, 0 = free)}. */
function parseMeter(raw) {
  var s = String(raw || '').trim();
  if (s === '' || /^none$/i.test(s)) return { num: 0, den: 0, label: 'free', q: 0 };
  if (s === 'C') return { num: 4, den: 4, label: '4/4', q: 4, common: true };
  if (s === 'C|') return { num: 2, den: 2, label: '2/2', q: 4, cut: true };
  var f = parseFraction(s);
  if (f === null) return null;
  if ([1, 2, 4, 8, 16].indexOf(f.den) < 0 || f.num > 32) return null;
  return { num: f.num, den: f.den, label: f.num + '/' + f.den, q: (f.num * 4) / f.den };
}

/** The beat a person counts in this meter, in quarter notes. */
function beatOf(meter) {
  if (meter.q === 0) return 1;
  if (meter.den === 8 && meter.num % 3 === 0 && meter.num > 3) return 1.5;
  if (meter.den === 2) return 2;
  return 4 / meter.den;
}

/** L: field → quarter notes per unit. */
function parseUnit(raw) {
  var f = parseFraction(raw);
  if (f === null) return null;
  return (f.num * 4) / f.den;
}

/** Q: field → quarter notes per minute (null when unreadable). */
function parseTempo(raw) {
  var s = String(raw || '').replace(/"[^"]*"/g, ' ').trim();
  var m = /(\d+)\s*\/\s*(\d+)\s*=\s*(\d+(?:\.\d+)?)/.exec(s);
  if (m !== null) {
    var q = (Number(m[1]) * 4) / Number(m[2]);
    return Number(m[3]) * q;
  }
  m = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (m !== null) return Number(m[1]);
  return null;
}

/** K: field → key {fifths, mode, name, vex, clef?} or {error}. */
function parseKey(raw) {
  var s = String(raw || '').trim();
  var out = { fifths: 0, mode: 'major', name: 'C major', vex: 'C', clef: null };
  var clefM = /\bclef\s*=\s*(\w+)/i.exec(s);
  if (clefM !== null) out.clef = clefM[1].toLowerCase();
  s = s.replace(/\b\w+\s*=\s*("[^"]*"|\S+)/g, ' ').trim();
  if (/^(treble|bass|alto|tenor)$/i.test(s)) {
    out.clef = s.toLowerCase();
    return out;
  }
  if (s === '' || /^none$/i.test(s)) return out;
  var m = /^([A-Ga-g])([#b]?)\s*([A-Za-z]*)/.exec(s);
  if (m === null) return { error: 'K:' + raw + ' is not a key. Use e.g. K:C, K:G, K:Am, K:Bb, K:F#m or K:D dor.' };
  var letter = m[1].toUpperCase();
  var acc = m[2];
  var modeRaw = m[3].toLowerCase();
  var modeKey = modeRaw === '' ? 'maj' : modeRaw === 'm' ? 'm' : modeRaw.slice(0, 3);
  if (MODE_OFFSET[modeKey] === undefined) return { error: 'K:' + raw + ': unknown mode "' + m[3] + '". Use maj, m (minor), dor, phr, lyd, mix, aeo or loc.' };
  var fifths = LETTER_FIFTHS[letter] + (acc === '#' ? 7 : acc === 'b' ? -7 : 0) + MODE_OFFSET[modeKey];
  if (fifths > 7 || fifths < -7) return { error: 'K:' + raw + ' needs more than seven sharps or flats; write it in the enharmonic key.' };
  out.fifths = fifths;
  out.mode = MODE_NAME[modeKey];
  out.name = letter + (acc === '#' ? '♯' : acc === 'b' ? '♭' : '') + ' ' + out.mode;
  out.vex = MAJOR_BY_FIFTHS[String(fifths)];
  out.tonic = letter + acc;
  if (/\S/.test(s.slice(m[0].length))) out.extra = s.slice(m[0].length).trim();
  return out;
}

/** The alteration the key signature gives each letter. */
function keyAlters(fifths) {
  var map = { C: 0, D: 0, E: 0, F: 0, G: 0, A: 0, B: 0 };
  var i;
  if (fifths > 0) for (i = 0; i < fifths; i++) map[SHARP_ORDER.charAt(i)] = 1;
  if (fifths < 0) for (i = 0; i < -fifths; i++) map[FLAT_ORDER.charAt(i)] = -1;
  return map;
}

/** V: line → {id, clef, name}. */
function parseVoiceLine(raw) {
  var s = String(raw || '').trim();
  var m = /^(\S+)(.*)$/.exec(s);
  if (m === null) return null;
  var rest = m[2];
  var clef = null;
  var cm = /\bclef\s*=\s*([\w-]+)/i.exec(rest);
  if (cm !== null) clef = cm[1].toLowerCase().replace(/^treble-?8$/, 'treble8');
  else if (/(^|\s)(bass|treble)(\s|$)/i.test(rest)) clef = /(^|\s)bass(\s|$)/i.test(rest) ? 'bass' : 'treble';
  var nm = /\b(?:name|nm)\s*=\s*"([^"]*)"/i.exec(rest);
  var hand = null;
  var hm = /\bhand\s*=\s*(\w+)/i.exec(rest);
  if (hm !== null) hand = /^(l|left|lh)$/i.test(hm[1]) ? 'L' : /^(r|right|rh)$/i.test(hm[1]) ? 'R' : null;
  return { id: m[1], clef: clef, name: nm !== null ? nm[1] : '', hand: hand };
}

/* ------------------------------------------------------------ the parse */

function parse(text, opts) {
  var o = opts || {};
  var errors = [];
  var warnings = [];
  var src = String(text || '').replace(/\r\n?/g, '\n');
  if (src.trim() === '') return { ok: false, errors: [{ line: 0, message: 'The notation is empty. Start with a header such as X:1, T:Title, M:4/4, L:1/8, Q:1/4=90, K:C, then the music.' }], warnings: [] };
  if (src.length > 400000) return { ok: false, errors: [{ line: 0, message: 'The notation is longer than 400,000 characters; split the piece into several songs.' }], warnings: [] };

  function err(line, message, voice, bar) {
    if (errors.length >= 40) return;
    var e = { line: line, message: message };
    if (voice !== undefined && voice !== null) e.voice = voice;
    if (bar !== undefined && bar !== null) e.bar = bar;
    errors.push(e);
  }
  function warn(line, message) {
    if (warnings.length < 20) warnings.push({ line: line, message: message });
  }

  /* lines, comments and continuations */
  var rawLines = src.split('\n');
  var lines = [];
  var carry = null;
  // %%pedal bar|half|beat: the sustain pedal changes at every bar, half bar or beat.
  var pedalEvery = '';
  // Singing directives: %%voice, %%language, %%licence, %%source, %%melody, %%vowel.
  var meta = { voice: '', language: '', licence: '', source: '', melody: '', vowel: '' };
  for (var li = 0; li < rawLines.length; li++) {
    var rawT = rawLines[li].trim();
    var directive = /^%%pedal\s+(bar|half|beat)\b/i.exec(rawT);
    if (directive !== null) pedalEvery = directive[1].toLowerCase();
    var md = /^%%(voice|language|licence|license|source|melody|vowel)\s+(.+)$/i.exec(rawT);
    if (md !== null) {
      var mk = md[1].toLowerCase() === 'license' ? 'licence' : md[1].toLowerCase();
      var mv = md[2].trim();
      if (mk === 'voice' && !/^(high|medium|low|any)$/i.test(mv)) warn(li + 1, '%%voice ' + mv + ' is not one of high, medium, low, any; it is read as any.');
      else if (mk === 'licence' && !/^(pd|trad|own|import)$/i.test(mv)) err(li + 1, '%%licence ' + mv + ' must be pd, trad, own or import.');
      else meta[mk] = mk === 'voice' || mk === 'licence' || mk === 'language' ? mv.toLowerCase().slice(0, 12) : mv.slice(0, 200);
    }
    if (/^%%/.test(rawT)) continue;
    var line = stripComment(rawLines[li]);
    var cont = /\\\s*$/.test(line);
    if (cont) line = line.replace(/\\\s*$/, '');
    if (carry !== null) {
      carry.text += ' ' + line;
      if (!cont) {
        lines.push(carry);
        carry = null;
      }
      continue;
    }
    if (cont) carry = { n: li + 1, text: line };
    else lines.push({ n: li + 1, text: line });
  }
  if (carry !== null) lines.push(carry);

  var head = { T: '', C: '', M: null, L: null, Q: null, K: null };
  var meter = { num: 4, den: 4, label: '4/4', q: 4 };
  var meterSet = false;
  var unitQ = null;
  var tempo = null;
  var key = parseKey('C');
  var voiceDefs = {};
  var voiceOrder = [];
  var inBody = false;
  var bodyLines = [];

  function defineVoice(def) {
    if (voiceDefs[def.id] === undefined) {
      voiceDefs[def.id] = def;
      voiceOrder.push(def.id);
    } else {
      if (def.clef !== null) voiceDefs[def.id].clef = def.clef;
      if (def.name !== '') voiceDefs[def.id].name = def.name;
      if (def.hand !== null) voiceDefs[def.id].hand = def.hand;
    }
  }

  for (var hi = 0; hi < lines.length; hi++) {
    var L0 = lines[hi];
    var t = L0.text;
    var fm = /^\s*([A-Za-z]):(.*)$/.exec(t);
    if (!inBody) {
      if (t.trim() === '') continue;
      if (fm === null) {
        err(L0.n, 'Music before the K: line. The header ends with K: (e.g. K:C); put the notes after it.');
        inBody = true;
        bodyLines.push(L0);
        continue;
      }
      var f = fm[1];
      var v = fm[2].trim();
      if (f === 'T') head.T = head.T === '' ? v : head.T;
      else if (f === 'C') head.C = head.C === '' ? v : head.C + ', ' + v;
      else if (f === 'M') {
        var mt = parseMeter(v);
        if (mt === null) err(L0.n, 'M:' + v + ' is not a meter. Use e.g. M:4/4, M:3/4, M:6/8, M:C or M:C|.');
        else {
          meter = mt;
          meterSet = true;
        }
      } else if (f === 'L') {
        var u = parseUnit(v);
        if (u === null) err(L0.n, 'L:' + v + ' is not a note length. Use e.g. L:1/8 or L:1/16.');
        else unitQ = u;
      } else if (f === 'Q') {
        var tq = parseTempo(v);
        if (tq === null) warn(L0.n, 'Q:' + v + ' was not understood; use e.g. Q:1/4=90. The tempo is set to 90.');
        else tempo = tq;
      } else if (f === 'V') {
        var vd = parseVoiceLine(v);
        if (vd === null) err(L0.n, 'V: needs a voice name, e.g. V:RH clef=treble');
        else defineVoice(vd);
      } else if (f === 'K') {
        var k = parseKey(v);
        if (k.error) err(L0.n, k.error);
        else key = k;
        inBody = true;
      }
      continue;
    }
    bodyLines.push(L0);
  }
  if (!inBody) {
    err(lines.length > 0 ? lines[lines.length - 1].n : 0, 'There is no K: line. The header must end with K: (e.g. K:C), followed by the music.');
    return { ok: false, errors: errors, warnings: warnings };
  }
  if (unitQ === null) unitQ = meter.q === 0 || (meter.num * 1.0) / meter.den >= 0.75 ? 0.5 : 0.25;
  if (tempo === null) tempo = 90;
  if (tempo < 20 || tempo > 400) {
    warn(0, 'Tempo ' + Math.round(tempo) + ' is out of range; it is set to ' + (tempo < 20 ? 20 : 400) + '.');
    tempo = tempo < 20 ? 20 : 400;
  }

  /* voices */
  var voices = {};
  var vlist = [];
  var current = null;
  function voiceState(id) {
    if (voices[id] !== undefined) return voices[id];
    if (voiceDefs[id] === undefined) defineVoice({ id: id, clef: null, name: '', hand: null });
    var st = {
      id: id,
      def: voiceDefs[id],
      bars: [],
      cur: null,
      key: key,
      keyAlt: keyAlters(key.fifths),
      meter: meter,
      unitQ: unitQ,
      vel: 80,
      acc: {},
      last: null,
      pendingFingers: [],
      pendingDyn: null,
      pendingStacc: false,
      pendingPed: 0,
      pendingChord: '',
      pendingFlags: 0,
      tuplet: null,
      tupletSeq: 0,
      broken: null,
      nextStartRepeat: false,
      nextEnding: 0,
      line: 0,
      used: false,
    };
    st.cur = newBar(st);
    voices[id] = st;
    vlist.push(st);
    return st;
  }
  function newBar(st) {
    var b = { events: [], pos: 0, startRepeat: st.nextStartRepeat, endRepeat: false, ending: st.nextEnding, final: false, meter: st.meter, line: st.line };
    st.nextStartRepeat = false;
    st.nextEnding = 0;
    return b;
  }
  function closeBar(st, tok) {
    var b = st.cur;
    var empty = b.events.length === 0;
    if (tok !== null) {
      b.endRepeat = tok.endRepeat;
      b.final = tok.final;
    }
    if (!empty || b.endRepeat) {
      if (empty) err(st.line, 'A repeat sign closes an empty bar.', st.id, st.bars.length + 1);
      st.bars.push(b);
    } else if (b.startRepeat || b.ending) {
      // `| |:` style: carry the marks onto the next bar
      st.nextStartRepeat = st.nextStartRepeat || b.startRepeat;
      if (b.ending && !st.nextEnding) st.nextEnding = b.ending;
    }
    st.acc = {};
    if (tok !== null) {
      if (tok.startRepeat) st.nextStartRepeat = true;
      if (tok.ending) st.nextEnding = tok.ending;
    }
    st.cur = newBar(st);
  }

  if (voiceOrder.length > 0 && voiceDefs[voiceOrder[0]] !== undefined) current = null;

  // Lyric lines: each belongs to the music line before it in its voice; several in a row are verses.
  var lyricLines = [];
  var lastMusic = null;
  var verseNo = 0;
  var lastField = '';
  for (var bi = 0; bi < bodyLines.length; bi++) {
    var BL = bodyLines[bi];
    var text2 = BL.text;
    if (text2.trim() === '') continue;
    var plus = /^\s*\+:(.*)$/.exec(text2);
    if (plus !== null) {
      if (lastField === 'w' && lyricLines.length > 0) lyricLines[lyricLines.length - 1].text += ' ' + plus[1];
      continue;
    }
    var fm2 = /^\s*([A-Za-z]):(.*)$/.exec(text2);
    if (fm2 !== null) {
      var f2 = fm2[1];
      var v2 = fm2[2].trim();
      lastField = f2;
      if (f2 === 'w') {
        if (lastMusic === null) warn(BL.n, 'A w: line before any music is ignored; put the words under the line of notes they belong to.');
        else lyricLines.push({ n: BL.n, text: fm2[2], voice: lastMusic.voice, music: lastMusic.n, verse: verseNo++ });
        continue;
      }
      if (f2 === 'V') {
        var vd2 = parseVoiceLine(v2);
        if (vd2 === null) {
          err(BL.n, 'V: needs a voice name, e.g. V:LH clef=bass');
          continue;
        }
        defineVoice(vd2);
        current = voiceState(vd2.id);
        current.line = BL.n;
        // Some V: lines carry music after the definition: not supported.
        continue;
      }
      if (f2 === 'w' || f2 === 'W' || f2 === 'N' || f2 === 'P' || f2 === 'T' || f2 === 'R' || f2 === 'S' || f2 === 'Z' || f2 === 'O' || f2 === 'H' || f2 === 'B' || f2 === 'D' || f2 === 'F' || f2 === 'G' || f2 === 'I' || f2 === 'X' || f2 === 'C') continue;
      if (f2 === 'K' || f2 === 'M' || f2 === 'L' || f2 === 'Q') {
        if (current === null) current = voiceState(voiceOrder.length > 0 ? voiceOrder[0] : '1');
        applyField(current, f2, v2, BL.n);
        continue;
      }
      warn(BL.n, 'Field ' + f2 + ': is ignored.');
      continue;
    }
    if (current === null) current = voiceState(voiceOrder.length > 0 ? voiceOrder[0] : '1');
    current.line = BL.n;
    current.used = true;
    lastMusic = { n: BL.n, voice: current.id };
    verseNo = 0;
    lastField = '';
    current = tokenize(current, text2, BL.n);
  }

  function applyField(st, f, v, n) {
    if (f === 'K') {
      var k = parseKey(v);
      if (k.error) return err(n, k.error, st.id);
      if (/^\s*(clef\s*=\s*\w+|treble|bass)\s*$/i.test(v)) {
        if (k.clef) st.def.clef = k.clef;
        return;
      }
      st.key = k;
      st.keyAlt = keyAlters(k.fifths);
      if (k.clef) st.def.clef = k.clef;
    } else if (f === 'M') {
      var mt = parseMeter(v);
      if (mt === null) return err(n, 'M:' + v + ' is not a meter.', st.id);
      st.meter = mt;
      if (st.cur.events.length === 0) st.cur.meter = mt;
    } else if (f === 'L') {
      var u = parseUnit(v);
      if (u === null) return err(n, 'L:' + v + ' is not a note length.', st.id);
      st.unitQ = u;
    } else if (f === 'Q') {
      // One tempo per song: a later Q: is read as a marking only.
    }
  }

  /* --------------------------------------------------- music tokenizer */
  function tokenize(st, s, n) {
    var i = 0;
    var len = s.length;
    function barNo() {
      return st.bars.length + 1;
    }
    while (i < len) {
      var c = s.charAt(i);
      if (c === ' ' || c === '\t' || c === '`' || c === 'y') {
        i++;
        continue;
      }
      if (c === '"') {
        var j = s.indexOf('"', i + 1);
        var text = j < 0 ? '' : s.slice(i + 1, j).trim();
        // A chord symbol ("Am7", "F#m7b5", "C/G"); text annotations start with ^ _ < > @.
        if (/^[A-G][#b\u266f\u266d]?[^\s"]{0,12}$/.test(text)) st.pendingChord = text;
        i = j < 0 ? len : j + 1;
        continue;
      }
      if (c === '!' || c === '+') {
        var j2 = s.indexOf(c, i + 1);
        if (j2 < 0) {
          err(n, 'Decoration ' + c + '... is not closed with ' + c + '.', st.id, barNo());
          return st;
        }
        decoration(st, s.slice(i + 1, j2));
        i = j2 + 1;
        continue;
      }
      if (c === '{') {
        var j3 = s.indexOf('}', i + 1);
        i = j3 < 0 ? len : j3 + 1;
        continue;
      }
      if (c === '.') {
        st.pendingStacc = true;
        i++;
        continue;
      }
      if (c === '~' || (c >= 'H' && c <= 'W') || c === 'u' || c === 'v') {
        i++;
        continue;
      }
      if (c === '&') {
        err(n, 'Voice overlay (&) is not supported: put the second part in its own voice (another V: line).', st.id, barNo());
        i++;
        continue;
      }
      if (c === ')') {
        i++;
        continue;
      }
      if (c === '(') {
        var tm = /^\((\d)(?::(\d)?)?(?::(\d)?)?/.exec(s.slice(i));
        if (tm !== null) {
          var p = Number(tm[1]);
          var q = tm[2] ? Number(tm[2]) : defaultTupletQ(p, st.meter);
          var r = tm[3] ? Number(tm[3]) : p;
          if (p < 2 || q < 1) {
            err(n, 'Tuplet ' + tm[0] + ' is not valid.', st.id, barNo());
          } else {
            st.tupletSeq += 1;
            st.tuplet = { p: p, q: q, left: r, factor: q / p, id: st.tupletSeq };
          }
          i += tm[0].length;
        } else i++;
        continue;
      }
      if (c === '-') {
        if (st.last !== null) for (var tn = 0; tn < st.last.k.length; tn++) st.last.k[tn].tie = true;
        i++;
        continue;
      }
      if (c === '>' || c === '<') {
        var cnt = 0;
        while (s.charAt(i) === c) {
          cnt++;
          i++;
        }
        if (st.last === null) {
          err(n, 'Broken rhythm ' + c + ' needs a note before it.', st.id, barNo());
          continue;
        }
        var lng = 2 - Math.pow(2, -cnt);
        var sht = Math.pow(2, -cnt);
        var f1 = c === '>' ? lng : sht;
        var nd = st.last.d * f1;
        st.cur.pos += nd - st.last.d;
        st.last.d = round(nd);
        st.broken = c === '>' ? sht : lng;
        continue;
      }
      if (c === '[' && /^\[[A-Za-z]:/.test(s.slice(i))) {
        var j4 = s.indexOf(']', i);
        if (j4 < 0) {
          err(n, 'Inline field ' + s.slice(i, i + 6) + '... is not closed with ].', st.id, barNo());
          return st;
        }
        var inner = s.slice(i + 1, j4);
        var fk = inner.charAt(0);
        var fv = inner.slice(2).trim();
        if (fk === 'V') {
          var vd3 = parseVoiceLine(fv);
          if (vd3 !== null) {
            defineVoice(vd3);
            st = voiceState(vd3.id);
            st.line = n;
            st.used = true;
          }
        } else if (fk === 'K' || fk === 'M' || fk === 'L' || fk === 'Q') applyField(st, fk, fv, n);
        i = j4 + 1;
        continue;
      }
      if (c === '[' && /^\[\d/.test(s.slice(i))) {
        var em = /^\[(\d+)/.exec(s.slice(i));
        st.cur.ending = Number(em[1]);
        if (st.cur.events.length > 0) err(n, 'An ending [' + em[1] + ' must start a bar.', st.id, barNo());
        i += em[0].length;
        continue;
      }
      if (c === '|' || c === ':' || (c === '[' && s.charAt(i + 1) === '|')) {
        var bm = /^(\[\||[|:\]]+)/.exec(s.slice(i));
        var run = bm[1];
        i += run.length;
        var ending = 0;
        var em2 = /^\[?(\d+)(?:[,-]\d+)*/.exec(s.slice(i));
        if (em2 !== null) {
          ending = Number(em2[1]);
          i += em2[0].length;
        }
        var tok = {
          endRepeat: run.charAt(0) === ':',
          startRepeat: run.charAt(run.length - 1) === ':',
          final: run.indexOf('||') >= 0 || run.indexOf('|]') >= 0 || run.indexOf('[|') >= 0,
          ending: ending,
        };
        if (run === '::') {
          tok.endRepeat = true;
          tok.startRepeat = true;
        }
        if (run.indexOf('|') < 0 && run !== '::') {
          err(n, 'Unexpected "' + run + '": a repeat sign needs a bar line (|: or :|).', st.id, barNo());
          continue;
        }
        // A bar line at the very start of a bar only carries marks to it.
        if (st.cur.events.length === 0 && !tok.endRepeat) {
          if (tok.startRepeat) st.cur.startRepeat = true;
          if (tok.ending) st.cur.ending = tok.ending;
          if (tok.final && st.bars.length > 0) st.bars[st.bars.length - 1].final = true;
          continue;
        }
        closeBar(st, tok);
        continue;
      }
      if (c === '[') {
        var close = s.indexOf(']', i);
        if (close < 0) {
          err(n, 'Chord [' + s.slice(i + 1, i + 8) + '... is not closed with ].', st.id, barNo());
          return st;
        }
        var body = s.slice(i + 1, close);
        i = close + 1;
        var lm = /^(\d*\/*\d*)/.exec(s.slice(i));
        var outer = lengthOf(lm[1]);
        i += lm[1].length;
        var tieAfter = false;
        if (s.charAt(i) === '-') {
          tieAfter = true;
          i++;
        }
        chord(st, body, outer, n, tieAfter);
        continue;
      }
      if (c === 'z' || c === 'x') {
        var rm = /^(\d*\/*\d*)/.exec(s.slice(i + 1));
        var rl = lengthOf(rm[1]);
        i += 1 + rm[1].length;
        if (rl === null) {
          err(n, 'Rest length "' + rm[1] + '" is not valid.', st.id, barNo());
          continue;
        }
        push(st, { rest: true, invisible: c === 'x', k: [], len: rl }, n);
        continue;
      }
      if (c === 'Z' || c === 'X') {
        var zm = /^(\d*)/.exec(s.slice(i + 1));
        var count = zm[1] === '' ? 1 : Number(zm[1]);
        i += 1 + zm[1].length;
        if (st.cur.events.length > 0) {
          err(n, 'A whole-bar rest Z must stand alone in its bar.', st.id, barNo());
          continue;
        }
        if (st.meter.q === 0) {
          err(n, 'A whole-bar rest Z needs a meter (M:).', st.id, barNo());
          continue;
        }
        for (var zi = 0; zi < count; zi++) {
          st.cur.events.push({ t: 0, d: st.meter.q, rest: true, whole: true, k: [] });
          st.cur.pos = st.meter.q;
          if (zi < count - 1) closeBar(st, null);
        }
        st.last = null;
        continue;
      }
      if (/[\^_=A-Ga-g]/.test(c)) {
        var nm = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)(\d*\/*\d*)/.exec(s.slice(i));
        if (nm === null) {
          err(n, 'Unexpected "' + s.slice(i, i + 3) + '".', st.id, barNo());
          i++;
          continue;
        }
        i += nm[0].length;
        var nl = lengthOf(nm[4]);
        if (nl === null) {
          err(n, 'Note length "' + nm[4] + '" after ' + nm[2] + ' is not valid.', st.id, barNo());
          continue;
        }
        var pitch = spell(st, nm[1] || '', nm[2], nm[3]);
        var fingers = st.pendingFingers;
        st.pendingFingers = [];
        if (fingers.length > 0) pitch.finger = fingers[0];
        var tie = false;
        if (s.charAt(i) === '-') {
          tie = true;
          i++;
        }
        pitch.tie = tie;
        push(st, { rest: false, k: [pitch], len: nl }, n);
        continue;
      }
      if (c === '\\') {
        i++;
        continue;
      }
      warn(n, 'Ignored "' + c + '" in voice ' + st.id + '.');
      i++;
    }
    return st;
  }

  function defaultTupletQ(p, m) {
    if (p === 2 || p === 4 || p === 8) return 3;
    if (p === 3 || p === 6) return 2;
    var compound = m.q !== 0 && m.den === 8 && m.num % 3 === 0;
    return compound ? 3 : 2;
  }

  function lengthOf(t) {
    if (t === '') return 1;
    var m = /^(\d*)(\/*)(\d*)$/.exec(t);
    if (m === null) return null;
    var num = m[1] === '' ? 1 : Number(m[1]);
    var den = 1;
    if (m[2].length > 0) den = m[3] !== '' ? Number(m[3]) : Math.pow(2, m[2].length);
    else if (m[3] !== '') return null;
    if (m[2].length > 1 && m[3] !== '') return null;
    if (num <= 0 || den <= 0) return null;
    return num / den;
  }

  function decoration(st, name) {
    var d = String(name).trim();
    if (/^[0-5]$/.test(d)) {
      st.pendingFingers.push(Number(d));
      return;
    }
    if (DYN_VEL[d] !== undefined) {
      st.pendingDyn = d;
      return;
    }
    if (d === 'staccato' || d === '.') st.pendingStacc = true;
    // Singing: a spoken note, an unscored note, a breath before the note.
    if (d === 'spoken') st.pendingFlags |= 1;
    if (d === 'free') st.pendingFlags |= 2;
    if (d === 'breath') st.pendingFlags |= 4;
    // The sustain pedal: !ped! presses it (or changes it, when it is down), !ped-up! lifts it.
    if (d === 'ped') st.pendingPed = st.pendingPed === 2 || st.pendingPed === 3 ? 3 : 1;
    if (d === 'ped-up') st.pendingPed = st.pendingPed === 1 || st.pendingPed === 3 ? 3 : 2;
  }

  function spell(st, accText, letterRaw, octMarks) {
    var letter = letterRaw.toUpperCase();
    var oct = letterRaw === letter ? 4 : 5;
    for (var oi = 0; oi < octMarks.length; oi++) oct += octMarks.charAt(oi) === "'" ? 1 : -1;
    var keyId = letter + oct;
    var alter;
    if (accText !== '') {
      alter = accText === '^' ? 1 : accText === '^^' ? 2 : accText === '_' ? -1 : accText === '__' ? -2 : 0;
      st.acc[keyId] = alter;
    } else if (st.acc[keyId] !== undefined) alter = st.acc[keyId];
    else alter = st.keyAlt[letter];
    var midi = 12 * (oct + 1) + STEP_BASE[letter] + alter;
    return { m: midi, s: letter, a: alter, o: oct, tie: false, finger: 0 };
  }

  function chord(st, body, outer, n, tieAfter) {
    if (outer === null) {
      err(n, 'Chord length is not valid.', st.id, st.bars.length + 1);
      return;
    }
    var k = [];
    var firstLen = null;
    var i = 0;
    var fingers = st.pendingFingers;
    st.pendingFingers = [];
    while (i < body.length) {
      var c = body.charAt(i);
      if (c === ' ') {
        i++;
        continue;
      }
      if (c === '!' || c === '+') {
        var j = body.indexOf(c, i + 1);
        if (j < 0) break;
        var dn = body.slice(i + 1, j).trim();
        if (/^[0-5]$/.test(dn)) fingers.push(Number(dn));
        else decoration(st, dn);
        i = j + 1;
        continue;
      }
      if (c === '"') {
        var j2 = body.indexOf('"', i + 1);
        i = j2 < 0 ? body.length : j2 + 1;
        continue;
      }
      if (c === '.' || c === '~' || c === ')' || c === '(') {
        if (c === '.') st.pendingStacc = true;
        i++;
        continue;
      }
      var nm = /^(\^{1,2}|_{1,2}|=)?([A-Ga-g])([',]*)(\d*\/*\d*)(-?)/.exec(body.slice(i));
      if (nm === null) {
        err(n, 'Chord [' + body + '] has "' + c + '", which is not a note.', st.id, st.bars.length + 1);
        return;
      }
      i += nm[0].length;
      var l = lengthOf(nm[4]);
      if (l === null) {
        err(n, 'Note length "' + nm[4] + '" in chord [' + body + '] is not valid.', st.id, st.bars.length + 1);
        return;
      }
      if (firstLen === null) firstLen = l;
      var p = spell(st, nm[1] || '', nm[2], nm[3]);
      p.tie = nm[5] === '-' || tieAfter;
      p.len = l;
      k.push(p);
    }
    if (k.length === 0) {
      err(n, 'Empty chord [].', st.id, st.bars.length + 1);
      return;
    }
    for (var fi = 0; fi < fingers.length && fi < k.length; fi++) k[fi].finger = fingers[fi];
    push(st, { rest: false, k: k, len: firstLen * outer, chordLens: k.map(function (x) { return x.len * outer; }) }, n);
  }

  function push(st, ev, n) {
    var d = ev.len * st.unitQ;
    if (st.broken !== null) {
      d *= st.broken;
      st.broken = null;
    }
    var tp = null;
    if (st.tuplet !== null) {
      d *= st.tuplet.factor;
      tp = [st.tuplet.p, st.tuplet.q, st.tuplet.id];
      st.tuplet.left -= 1;
      if (st.tuplet.left <= 0) st.tuplet = null;
    }
    d = round(d);
    if (d <= EPS) {
      err(n, 'A note or rest has no length.', st.id, st.bars.length + 1);
      return;
    }
    if (st.cur.events.length === 0) st.cur.line = n;
    var e = { t: round(st.cur.pos), d: d, rest: ev.rest, k: ev.k, src: n, sb: st.bars.length };
    if (st.pendingFlags) {
      // A breath mark before a rest carries to the next note.
      if (!ev.rest) {
        e.fl = st.pendingFlags;
        st.pendingFlags = 0;
      } else st.pendingFlags &= 4;
    }
    if (ev.invisible) e.invisible = true;
    if (tp !== null) e.tp = tp;
    if (st.pendingDyn !== null) {
      e.dyn = st.pendingDyn;
      st.vel = DYN_VEL[st.pendingDyn];
      st.pendingDyn = null;
    }
    if (st.pendingStacc && !ev.rest) e.stacc = true;
    st.pendingStacc = false;
    if (st.pendingPed) {
      e.ped = st.pendingPed;
      st.pendingPed = 0;
    }
    if (st.pendingChord) {
      e.cs = st.pendingChord;
      st.pendingChord = '';
    }
    if (!ev.rest) {
      e.vel = st.vel;
      // Ties: a note continues the same pitch tied from the event before it.
      if (st.last !== null) {
        for (var a = 0; a < e.k.length; a++) {
          for (var b = 0; b < st.last.k.length; b++) {
            if (st.last.k[b].tie && st.last.k[b].m === e.k[a].m) e.k[a].from = true;
          }
        }
      }
      if (ev.chordLens) {
        for (var ci = 0; ci < e.k.length; ci++) {
          var own = round(ev.chordLens[ci] * st.unitQ * (tp !== null ? tp[1] / tp[0] : 1));
          if (Math.abs(own - d) > EPS) e.k[ci].hold = own;
        }
      }
    }
    st.cur.events.push(e);
    st.cur.pos = round(st.cur.pos + d);
    st.last = ev.rest ? null : e;
  }

  /* -------------------------------------------- close voices, validate */
  if (vlist.length === 0) {
    err(0, 'There is no music after the K: line.');
    return { ok: false, errors: errors, warnings: warnings };
  }
  for (var vi = 0; vi < vlist.length; vi++) {
    var vs = vlist[vi];
    if (vs.cur.events.length > 0) closeBar(vs, null);
    if (vs.tuplet !== null) err(vs.line, 'A tuplet ends before all its notes.', vs.id);
  }
  var used = vlist.filter(function (x) {
    return x.bars.length > 0;
  });
  if (used.length === 0) {
    err(0, 'There is no music after the K: line.');
    return { ok: false, errors: errors, warnings: warnings };
  }
  if (used.length > 6) err(0, 'At most 6 voices are supported (this has ' + used.length + ').');

  // Bar lengths against the meter: pickups and their closing bars may be short.
  for (var ui = 0; ui < used.length; ui++) {
    var uv = used[ui];
    for (var bj = 0; bj < uv.bars.length; bj++) {
      var bar = uv.bars[bj];
      var want = bar.meter.q;
      if (want === 0) continue;
      var have = round(bar.pos);
      if (have > want + EPS) err(bar.line, 'Bar ' + (bj + 1) + ' of voice ' + uv.id + ' has ' + beatsText(have) + ', but ' + bar.meter.label + ' allows ' + beatsText(want) + '.', uv.id, bj + 1);
      else if (have < want - EPS) {
        var shortOk = bj === 0 || bj === uv.bars.length - 1 || bar.endRepeat || bar.final || (bj + 1 < uv.bars.length && (uv.bars[bj + 1].ending || uv.bars[bj + 1].startRepeat)) || bar.ending;
        if (!shortOk) err(bar.line, 'Bar ' + (bj + 1) + ' of voice ' + uv.id + ' has ' + beatsText(have) + ', but ' + bar.meter.label + ' needs ' + beatsText(want) + '. Add a rest or fix a note length.', uv.id, bj + 1);
      }
    }
  }
  var ref = used[0];
  for (var uj = 1; uj < used.length; uj++) {
    if (used[uj].bars.length !== ref.bars.length) {
      err(used[uj].line, 'Voice ' + used[uj].id + ' has ' + used[uj].bars.length + ' bars but voice ' + ref.id + ' has ' + ref.bars.length + '. Every voice needs the same bars (fill with z rests).', used[uj].id);
      continue;
    }
    for (var bk = 0; bk < ref.bars.length; bk++) {
      var a1 = ref.bars[bk];
      var b1 = used[uj].bars[bk];
      if (a1.meter.q === 0 && Math.abs(a1.pos - b1.pos) > EPS) err(b1.line, 'Bar ' + (bk + 1) + ': voice ' + used[uj].id + ' has ' + beatsText(b1.pos) + ' but voice ' + ref.id + ' has ' + beatsText(a1.pos) + '.', used[uj].id, bk + 1);
      else if (a1.meter.q !== 0 && Math.abs(a1.pos - b1.pos) > EPS && (bk === 0 || bk === ref.bars.length - 1)) err(b1.line, 'Bar ' + (bk + 1) + ': voice ' + used[uj].id + ' has ' + beatsText(b1.pos) + ' but voice ' + ref.id + ' has ' + beatsText(a1.pos) + '. A pickup must be the same length in every voice.', used[uj].id, bk + 1);
      if ((a1.endRepeat !== b1.endRepeat || a1.startRepeat !== b1.startRepeat || a1.ending !== b1.ending) && errors.length < 40) err(b1.line, 'Bar ' + (bk + 1) + ': voice ' + used[uj].id + ' repeats differently from voice ' + ref.id + '. Give every voice the same repeat signs and endings.', used[uj].id, bk + 1);
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors, warnings: warnings };

  /* -------------------------------------------- the sung melody and its words */
  var mel = used[0];
  if (meta.melody !== '') {
    var named = used.filter(function (x) {
      return x.id === meta.melody;
    });
    if (named.length === 0)
      err(0, '%%melody ' + meta.melody + ' names no voice; the voices are ' + used.map(function (x) {
        return x.id;
      }).join(', ') + '.');
    else mel = named[0];
  }
  var melSlots = [];
  for (var mb = 0; mb < mel.bars.length; mb++) {
    for (var me = 0; me < mel.bars[mb].events.length; me++) {
      var mev = mel.bars[mb].events[me];
      if (mev.rest) continue;
      if (mev.k.length > 1) err(mev.src, 'Bar ' + (mb + 1) + ' of the sung melody (voice ' + mel.id + ') has a chord; a voice sings one note at a time. Put the other notes in an accompaniment voice (another V: line).', mel.id, mb + 1);
      melSlots.push(mev);
    }
  }
  var verses = 0;
  for (var ll = 0; ll < lyricLines.length; ll++) {
    var LL = lyricLines[ll];
    var lineSlots = melSlots.filter(function (x) {
      return x.src === LL.music;
    });
    if (lineSlots.length === 0) {
      warn(LL.n, 'The words on line ' + LL.n + ' sit under a line that is not the sung melody (voice ' + mel.id + '); they are ignored.');
      continue;
    }
    var toks = lyricTokens(LL.text);
    var al = alignLyrics(lineSlots, toks);
    if (!al.ok) {
      // Tied notes may also go without a syllable of their own.
      var untied = lineSlots.filter(function (x) {
        return !x.k[0].from;
      });
      if (untied.length !== lineSlots.length) {
        var al2 = alignLyrics(untied, toks);
        if (al2.ok) al = al2;
      }
    }
    if (!al.ok) {
      var tail = al.said.slice(-4).join(' ').replace(/- /g, '');
      var barAt = (lineSlots[Math.min(al.at, lineSlots.length - 1)].sb || 0) + 1;
      var msg = al.over
        ? 'The words on line ' + LL.n + ' (verse ' + (LL.verse + 1) + ') have more syllables than the ' + lineSlots.length + ' notes of music line ' + LL.music + '; the notes run out after "' + tail + '". Join syllables under one note with ~ or remove some.'
        : 'The words on line ' + LL.n + ' (verse ' + (LL.verse + 1) + ') cover ' + al.at + ' of the ' + lineSlots.length + ' notes of music line ' + LL.music + (tail !== '' ? '; they end with "' + tail + '"' : '') + '. Give every note a syllable: hold one over several notes with _, or skip a note with *.';
      err(LL.n, msg, mel.id, barAt);
      continue;
    }
    verses = Math.max(verses, LL.verse + 1);
    for (var as = 0; as < al.assign.length; as++) {
      var slotEv = al.assign[as][0];
      if (!slotEv.lyr) slotEv.lyr = [];
      slotEv.lyr[LL.verse] = al.assign[as][1];
    }
  }
  if (errors.length > 0) return { ok: false, errors: errors, warnings: warnings };

  /* ------------------------------------------- unroll repeats and endings */
  var order = expand(ref.bars);
  if (order.length > 2000) return { ok: false, errors: [{ line: 0, message: 'The piece has more than 2,000 bars once repeats are played.' }], warnings: warnings };

  /* hands and clefs */
  assignHands(used);

  var barsOut = [];
  var pickup = ref.bars.length > 1 && ref.bars[0].meter.q > 0 && ref.bars[0].pos < ref.bars[0].meter.q - EPS;
  var tq = 0;
  for (var oi2 = 0; oi2 < order.length; oi2++) {
    var srcIdx = order[oi2];
    var lenQ = 0;
    for (var uk = 0; uk < used.length; uk++) lenQ = Math.max(lenQ, used[uk].bars[srcIdx].pos);
    barsOut.push({ n: pickup ? oi2 : oi2 + 1, t: round(tq), len: round(lenQ), src: srcIdx, meter: ref.bars[srcIdx].meter.label });
    tq += lenQ;
  }
  // A pickup played again after a repeat is not bar 0: number by position.
  if (pickup) for (var pi = 1; pi < barsOut.length; pi++) barsOut[pi].n = pi;

  var notes = [];
  var events = [];
  var pedMarks = [];
  var chordMarks = [];
  for (var vk = 0; vk < used.length; vk++) {
    var vo = used[vk];
    var hand = vo.hand === 'L' ? 1 : 0;
    var perBar = [];
    var open = {};
    for (var ob = 0; ob < order.length; ob++) {
      var sb = vo.bars[order[ob]];
      var startQ = barsOut[ob].t;
      var evs = [];
      for (var ei = 0; ei < sb.events.length; ei++) {
        var ev = sb.events[ei];
        evs.push(compactEvent(ev));
        if (ev.ped) pedMarks.push([round(startQ + ev.t), ev.ped]);
        if (ev.cs) chordMarks.push([round(startQ + ev.t), ev.cs]);
        if (ev.rest) {
          open = {};
          continue;
        }
        var nextOpen = {};
        for (var ki = 0; ki < ev.k.length; ki++) {
          var kk = ev.k[ki];
          var dur = kk.hold !== undefined ? kk.hold : ev.d;
          var at = round(startQ + ev.t);
          if (kk.from && open[kk.m] !== undefined) {
            var prev = open[kk.m];
            prev[1] = round(at + dur - prev[0]);
            if (kk.tie) nextOpen[kk.m] = prev;
            continue;
          }
          var soundD = ev.stacc ? round(dur * 0.5) : dur;
          var rec = [at, soundD, kk.m, hand, kk.finger || 0, ev.vel || 80, vk, ob, ev.stacc ? 1 : 0];
          notes.push(rec);
          if (kk.tie) nextOpen[kk.m] = rec;
        }
        open = nextOpen;
      }
      perBar.push(evs);
    }
    events.push(perBar);
  }
  notes.sort(function (a, b) {
    return a[0] - b[0] || a[2] - b[2];
  });
  if (notes.length === 0) return { ok: false, errors: [{ line: 0, message: 'The piece has no notes, only rests.' }], warnings: warnings };

  /* the melody in playing order: ties merged, a syllable per note, phrases */
  // [t, d, midi, bar index, flags (1 spoken, 2 free, 4 breath before, 8 staccato), phrase]
  var melody = [];
  // The notation line each sung note is written on (for rewriting the words).
  var melLine = [];
  var repeats = order.length !== ref.bars.length;
  var outVerses = repeats ? 1 : Math.max(1, verses);
  var lyr = [];
  for (var v0 = 0; v0 < outVerses; v0++) lyr.push([]);
  var occ = {};
  var openMel = null;
  var phraseNo = 0;
  var gap = true;
  for (var ob2 = 0; ob2 < order.length; ob2++) {
    var sIdx = order[ob2];
    var k0 = occ[sIdx] || 0;
    occ[sIdx] = k0 + 1;
    var sbar = mel.bars[sIdx];
    var at0 = barsOut[ob2].t;
    for (var e2 = 0; e2 < sbar.events.length; e2++) {
      var ev2 = sbar.events[e2];
      if (ev2.rest) {
        if (!ev2.invisible) gap = true;
        openMel = null;
        continue;
      }
      var p2 = ev2.k[0];
      var start2 = round(at0 + ev2.t);
      if (p2.from && openMel !== null && openMel[2] === p2.m) {
        openMel[1] = round(start2 + ev2.d - openMel[0]);
        if (!p2.tie) openMel = null;
        continue;
      }
      var fl = ev2.fl || 0;
      if (fl & 4) gap = true;
      if (gap && melody.length > 0) phraseNo += 1;
      gap = false;
      var rec2 = [start2, ev2.d, p2.m, ob2, (fl & 7) | (ev2.stacc ? 8 : 0), phraseNo];
      melody.push(rec2);
      melLine.push(ev2.src);
      var syls = ev2.lyr || [];
      if (repeats) {
        var sy = syls[k0] !== undefined ? syls[k0] : syls[0];
        lyr[0].push(sy === undefined ? '' : sy);
      } else for (var v1 = 0; v1 < outVerses; v1++) lyr[v1].push(syls[v1] === undefined ? '' : syls[v1]);
      openMel = p2.tie ? rec2 : null;
    }
  }
  if (melody.length === 0) return { ok: false, errors: [{ line: 0, message: 'The sung melody (voice ' + mel.id + ') has no notes.' }], warnings: warnings };
  var phrases = [];
  for (var mi = 0; mi < melody.length; mi++) {
    var ph = melody[mi][5];
    if (phrases[ph] === undefined) phrases[ph] = [mi, mi, melody[mi][0], round(melody[mi][0] + melody[mi][1])];
    phrases[ph][1] = mi;
    phrases[ph][3] = round(melody[mi][0] + melody[mi][1]);
  }
  // Range and tessitura (time-weighted quartiles) of the sung notes, spoken ones aside.
  var sung = melody.filter(function (x) {
    return !(x[4] & 1);
  });
  if (sung.length === 0) sung = melody;
  var mlo = 127;
  var mhi = 0;
  for (var si2 = 0; si2 < sung.length; si2++) {
    mlo = Math.min(mlo, sung[si2][2]);
    mhi = Math.max(mhi, sung[si2][2]);
  }
  var byPitch = sung.slice().sort(function (a, b) {
    return a[2] - b[2];
  });
  var totalD = 0;
  for (var bp = 0; bp < byPitch.length; bp++) totalD += byPitch[bp][1];
  function quant(q) {
    var acc = 0;
    for (var qi = 0; qi < byPitch.length; qi++) {
      acc += byPitch[qi][1];
      if (acc >= totalD * q - EPS) return byPitch[qi][2];
    }
    return byPitch[byPitch.length - 1][2];
  }
  var mrange = { lo: mlo, hi: mhi, span: mhi - mlo, q1: quant(0.25), med: quant(0.5), q3: quant(0.75) };
  var longest = 0;
  for (var pq = 0; pq < phrases.length; pq++) if (phrases[pq] !== undefined) longest = Math.max(longest, ((phrases[pq][3] - phrases[pq][2]) * 60) / tempo);
  var sylCount = 0;
  var hasWords = false;
  for (var ly = 0; ly < lyr[0].length; ly++) {
    var sx = lyr[0][ly];
    if (sx !== '' && sx !== '_') {
      sylCount += 1;
      hasWords = true;
    }
  }
  // Very short notes each carrying a new syllable are hard to sing: probably a run.
  if (hasWords) {
    for (var sn = 0; sn < melody.length; sn++) {
      var sxx = lyr[0][sn];
      if ((melody[sn][1] * 60) / tempo < 0.12 && sxx !== '' && sxx !== '_' && !(melody[sn][4] & 1)) {
        warn(0, 'Bar ' + barsOut[melody[sn][3]].n + ': a note shorter than 0.12 s carries its own syllable ("' + sxx + '"); if it is a run, hold the syllable with _.');
        break;
      }
    }
  }

  // Pedal by directive: a change at the start of every bar, half bar (even metres) or beat.
  if (pedalEvery !== '') {
    for (var pb = 0; pb < barsOut.length; pb++) {
      var bar0 = barsOut[pb];
      if (pickup && pb === 0) continue;
      var mq = ref.bars[bar0.src].meter;
      var step = pedalEvery === 'beat' ? beatOf(mq) : pedalEvery === 'half' && mq.num % 2 === 0 ? bar0.len / 2 : bar0.len;
      if (!(step > EPS)) step = bar0.len;
      for (var at3 = 0; at3 < bar0.len - EPS; at3 += step) pedMarks.push([round(bar0.t + at3), 1]);
    }
  }
  // Pedal spans [down, up] in quarter notes; a change lifts and presses again at once.
  pedMarks.sort(function (a, b) {
    return a[0] - b[0] || b[1] - a[1];
  });
  var pedal = [];
  var downAt = -1;
  for (var pm = 0; pm < pedMarks.length; pm++) {
    var at2 = pedMarks[pm][0];
    var kind = pedMarks[pm][1];
    if (downAt >= 0 && (kind === 2 || kind === 3 || kind === 1) && at2 > downAt + EPS) pedal.push([downAt, at2]);
    if (kind === 2) downAt = -1;
    else if (downAt < 0 || at2 > downAt + EPS) downAt = at2;
  }
  if (downAt >= 0 && round(tq) > downAt + EPS) pedal.push([downAt, round(tq)]);
  // Chord symbols in time order, one per moment.
  chordMarks.sort(function (a, b) {
    return a[0] - b[0];
  });
  var chordsOut = [];
  for (var cm = 0; cm < chordMarks.length; cm++) {
    var lastC = chordsOut[chordsOut.length - 1];
    if (lastC !== undefined && Math.abs(lastC[0] - chordMarks[cm][0]) < EPS) continue;
    chordsOut.push(chordMarks[cm]);
  }

  var lo = 127;
  var hiN = 0;
  var hands = {};
  var chordsN = 0;
  for (var ni = 0; ni < notes.length; ni++) {
    lo = Math.min(lo, notes[ni][2]);
    hiN = Math.max(hiN, notes[ni][2]);
    hands[notes[ni][3]] = true;
  }
  for (var cx = 1; cx < notes.length; cx++) if (Math.abs(notes[cx][0] - notes[cx - 1][0]) < EPS && notes[cx][3] === notes[cx - 1][3]) chordsN += 1;
  var totalQ = round(tq);
  var seconds = (totalQ * 60) / tempo;
  var model = {
    v: 3,
    meter: { num: meter.num, den: meter.den, label: meter.label, q: meter.q },
    beat: beatOf(meter),
    key: { fifths: key.fifths, mode: key.mode, name: key.name, vex: key.vex },
    tempo: Math.round(tempo * 100) / 100,
    pickup: pickup,
    bars: barsOut,
    voices: used.map(function (x) {
      return { id: x.id, name: x.def.name || x.id, hand: x.hand, clef: x.def.clef || (x.hand === 'L' ? 'bass' : 'treble') };
    }),
    events: events,
    notes: notes,
    total: totalQ,
    pedal: pedal,
    chords: chordsOut,
    melodyVoice: used.indexOf(mel),
    melody: melody,
    lyrics: hasWords ? lyr : [],
    phrases: phrases.filter(function (x) {
      return x !== undefined;
    }),
    mrange: mrange,
    meta: { voice: meta.voice || 'any', language: meta.language, licence: meta.licence, source: meta.source, vowel: meta.vowel },
  };
  var displayBars = barsOut.length - (pickup ? 1 : 0);
  var summary = {
    title: head.T,
    composer: head.C,
    bars: displayBars,
    key: key.name,
    meter: meter.label,
    tempo: Math.round(tempo),
    seconds: Math.round(seconds),
    notes: notes.length,
    chords: chordsN,
    chord_symbols: chordsOut.length,
    pedal_changes: pedal.length,
    hands: hands[0] && hands[1] ? 'both' : hands[1] ? 'left' : 'right',
    range: noteName(lo) + '–' + noteName(hiN),
    low: lo,
    high: hiN,
    voices: used.map(function (x) {
      return x.id + ' (' + (x.hand === 'L' ? 'left hand' : 'right hand') + ')';
    }),
    pickup: pickup,
    repeats: order.length !== ref.bars.length,
    level: vocalLevel(melody, mrange, seconds, key, tempo),
    melody_voice: mel.id,
    accompaniment: used.length > 1 || chordsOut.length > 0,
    sung_range: noteName(mrange.lo) + '–' + noteName(mrange.hi),
    low: mrange.lo,
    high: mrange.hi,
    span: mrange.span,
    tessitura: noteName(mrange.q1) + '–' + noteName(mrange.q3),
    median: mrange.med,
    syllables: sylCount,
    verses: hasWords ? lyr.length : 0,
    words: hasWords,
    phrases: model.phrases.length,
    longest_phrase_s: Math.round(longest * 10) / 10,
    language: meta.language,
    licence: meta.licence,
    source: meta.source,
    voicing: meta.voice || 'any',
    vowel: meta.vowel,
    first_words: hasWords ? firstWords(lyr[0]) : '',
  };
  // Where the words are written: each sung note's music line and each w: line (not with repeats, whose words alternate).
  var layout = repeats ? null : { melLine: melLine, wLines: lyricLines.map(function (l) {
    return { n: l.n, music: l.music, verse: l.verse };
  }) };
  return { ok: true, errors: [], warnings: warnings, model: model, summary: summary, head: head, layout: layout };
}

/** ABC 2.1 lyric tokens: syllables (with a hyphen after or not), holds (_), skips (*) and bar jumps (|). */
function lyricTokens(text) {
  var out = [];
  var cur = '';
  var has = false;
  function flush(hy) {
    if (!has) return false;
    out.push({ s: cur, hy: !!hy });
    cur = '';
    has = false;
    return true;
  }
  var s = String(text || '');
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === '\\' && s.charAt(i + 1) === '-') {
      cur += '-';
      has = true;
      i++;
      continue;
    }
    if (c === ' ' || c === '\t') {
      flush(false);
      continue;
    }
    if (c === '-') {
      // A second hyphen in a row is a note that continues the word without a new syllable.
      if (!flush(true) && out.length > 0 && out[out.length - 1].hy) out.push({ s: '', hy: true });
      continue;
    }
    if (c === '_') {
      flush(false);
      out.push({ ext: true });
      continue;
    }
    if (c === '*') {
      flush(false);
      out.push({ skip: true });
      continue;
    }
    if (c === '~') {
      cur += ' ';
      has = true;
      continue;
    }
    if (c === '|') {
      flush(false);
      out.push({ bar: true });
      continue;
    }
    cur += c;
    has = true;
  }
  flush(false);
  return out;
}

/** Put lyric tokens on notes in order; | jumps to the next bar. */
function alignLyrics(slots, toks) {
  var i = 0;
  var assign = [];
  var said = [];
  for (var t = 0; t < toks.length; t++) {
    var tk = toks[t];
    if (tk.bar) {
      if (i > 0 && i < slots.length) {
        var b0 = slots[i - 1].sb;
        while (i < slots.length && slots[i].sb === b0) i++;
      }
      continue;
    }
    if (i >= slots.length) return { ok: false, over: true, at: slots.length - 1, said: said };
    if (tk.ext) assign.push([slots[i], '_']);
    else if (tk.skip) assign.push([slots[i], '']);
    else {
      assign.push([slots[i], tk.s + (tk.hy ? '-' : '')]);
      if (tk.s !== '') said.push(tk.s + (tk.hy ? '-' : ''));
    }
    i++;
  }
  if (i < slots.length) return { ok: false, over: false, at: i, said: said };
  return { ok: true, assign: assign };
}

/** The opening words of a lyric line, joined back into text. */
function firstWords(syls) {
  var out = '';
  var n = 0;
  for (var i = 0; i < syls.length && n < 8; i++) {
    var s = syls[i];
    if (s === '' || s === '_') continue;
    var hy = s.charAt(s.length - 1) === '-';
    out += hy ? s.slice(0, -1) : s + ' ';
    if (!hy) n += 1;
  }
  return out.trim();
}

/**
 * A rough singing level from 1 (first notes) to 10 (recital): the span the
 * melody covers, how fast the notes go, leaps, notes outside the key, the
 * key itself and the length.
 */
function vocalLevel(melody, mr, seconds, key, tempo) {
  var nps = seconds > 0 ? melody.length / seconds : 0;
  var leap = 0;
  for (var i = 1; i < melody.length; i++) leap = Math.max(leap, Math.abs(melody[i][2] - melody[i - 1][2]));
  var diatonic = {};
  for (var f = key.fifths - 1; f <= key.fifths + 5; f++) diatonic[(((f * 7) % 12) + 12) % 12] = true;
  var outside = 0;
  for (var j = 0; j < melody.length; j++) if (!diatonic[((melody[j][2] % 12) + 12) % 12]) outside++;
  var score = 1;
  score += Math.max(0, mr.span - 8) * 0.38;
  score += Math.max(0, nps - 1.6) * 0.8;
  score += Math.min(1.5, (outside / Math.max(1, melody.length)) * 6);
  score += Math.max(0, leap - 7) * 0.22;
  score += Math.min(0.8, Math.abs(key.fifths) * 0.12);
  if (seconds > 150) score += 0.5;
  if (tempo > 160) score += 0.3;
  return Math.max(1, Math.min(10, Math.round(score)));
}

function stripComment(line) {
  var out = '';
  var inQuote = false;
  for (var i = 0; i < line.length; i++) {
    var c = line.charAt(i);
    if (c === '"') inQuote = !inQuote;
    if (c === '%' && !inQuote && (i === 0 || line.charAt(i - 1) !== '\\')) break;
    out += c;
  }
  return out;
}

/** Playing order of source bars, with repeats and first/second endings unrolled. */
function expand(bars) {
  var out = [];
  var i = 0;
  var start = 0;
  var done = {};
  var second = false;
  var guard = 0;
  while (i < bars.length && guard < 20000) {
    guard++;
    var b = bars[i];
    if (b.startRepeat && !second) start = i;
    if (b.ending === 1 && second) {
      // Skip the first ending: to the bar after the repeat sign that closes it.
      var j = i;
      while (j < bars.length && !bars[j].endRepeat) j++;
      i = j + 1;
      second = false;
      start = i;
      continue;
    }
    out.push(i);
    if (b.endRepeat) {
      if (!done[i]) {
        done[i] = true;
        second = true;
        i = start;
        continue;
      }
      second = false;
      start = i + 1;
    }
    if (b.ending >= 2) second = false;
    i++;
  }
  return out;
}

function assignHands(vs) {
  var withClef = vs.filter(function (v) {
    return v.def.clef !== null;
  });
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i];
    if (v.def.hand) {
      v.hand = v.def.hand;
      continue;
    }
    if (v.def.clef === 'bass') {
      v.hand = 'L';
      continue;
    }
    if (v.def.clef !== null) {
      v.hand = 'R';
      continue;
    }
    if (/^(l|lh|left|bass|b)$/i.test(v.id)) {
      v.hand = 'L';
      continue;
    }
    if (/^(r|rh|right|treble|t)$/i.test(v.id)) {
      v.hand = 'R';
      continue;
    }
    if (withClef.length === 0 && vs.length === 2) {
      v.hand = i === 0 ? 'R' : 'L';
      continue;
    }
    // By register: the average pitch of the voice.
    var sum = 0;
    var n = 0;
    for (var b = 0; b < v.bars.length; b++) {
      for (var e = 0; e < v.bars[b].events.length; e++) {
        var ev = v.bars[b].events[e];
        for (var k = 0; k < ev.k.length; k++) {
          sum += ev.k[k].m;
          n++;
        }
      }
    }
    v.hand = n > 0 && sum / n < 60 ? 'L' : 'R';
  }
  for (var j = 0; j < vs.length; j++) if (vs[j].def.clef === null) vs[j].def.clef = vs[j].hand === 'L' ? 'bass' : 'treble';
}

/** What the sheet needs from one event, in a compact shape. */
function compactEvent(ev) {
  var o = { t: ev.t, d: ev.d };
  if (ev.rest) {
    o.r = 1;
    if (ev.invisible) o.x = 1;
    if (ev.whole) o.w = 1;
  } else {
    o.k = ev.k.map(function (p) {
      var x = [p.m, p.s, p.a, p.o];
      x.push(p.tie ? 1 : 0);
      x.push(p.finger || 0);
      x.push(p.hold !== undefined ? p.hold : 0);
      return x;
    });
  }
  if (ev.tp) o.tp = ev.tp;
  if (ev.dyn) o.dyn = ev.dyn;
  if (ev.stacc) o.st = 1;
  return o;
}

/** Sections: "1-8, 9-16" or "A:1-8, B:9-16" or a JSON list; null = the default split. */
function parseSections(input, model) {
  var bars = model.bars;
  var first = bars.length > 0 ? bars[0].n : 1;
  var last = bars.length > 0 ? bars[bars.length - 1].n : 1;
  var list = null;
  if (input === undefined || input === null || input === '') return { sections: defaultSections(model) };
  if (Array.isArray(input)) list = input;
  else {
    var s = String(input).trim();
    if (s.charAt(0) === '[') {
      try {
        list = JSON.parse(s);
      } catch (e) {
        return { error: 'sections must be like "1-8, 9-16" or "A:1-8, B:9-16" or a JSON list [{"name":"A","from":1,"to":8}]' };
      }
    } else {
      list = [];
      var parts = s.split(/[,;]/);
      for (var i = 0; i < parts.length; i++) {
        var p = parts[i].trim();
        if (p === '') continue;
        var m = /^(?:([^:]+):)?\s*(\d+)\s*[-–]\s*(\d+)$/.exec(p);
        if (m === null) return { error: 'Section "' + p + '" must look like 1-8 or A:1-8.' };
        list.push({ name: m[1] ? m[1].trim() : '', from: Number(m[2]), to: Number(m[3]) });
      }
    }
  }
  if (!Array.isArray(list) || list.length === 0) return { error: 'sections is empty.' };
  if (list.length > 60) return { error: 'At most 60 sections.' };
  var out = [];
  var expect = first;
  for (var j = 0; j < list.length; j++) {
    var it = list[j];
    var from = Number(it.from);
    var to = Number(it.to);
    if (!isFinite(from) || !isFinite(to) || from > to) return { error: 'Section ' + (j + 1) + ' (' + it.from + '-' + it.to + ') runs backwards.' };
    if (j === 0 && from === 1 && first === 0) from = 0;
    if (from !== expect) return { error: 'Sections must cover every bar in order: section ' + (j + 1) + ' starts at bar ' + it.from + ' but bar ' + expect + ' comes next. The piece has bars ' + first + '–' + last + '.' };
    if (to > last) return { error: 'Section ' + (j + 1) + ' ends at bar ' + to + ', but the piece ends at bar ' + last + '.' };
    out.push({ name: String(it.name || '').slice(0, 24) || letter(j), from: from, to: to });
    expect = to + 1;
  }
  if (expect !== last + 1) return { error: 'Sections stop at bar ' + (expect - 1) + ', but the piece runs to bar ' + last + '. Cover every bar.' };
  return { sections: out };
}

function letter(i) {
  return i < 26 ? String.fromCharCode(65 + i) : 'S' + (i + 1);
}

/** Phrases of four bars (eight in long pieces); a short tail joins the section before it. */
function defaultSections(model) {
  var bars = model.bars;
  if (bars.length === 0) return [];
  var first = bars[0].n;
  var last = bars[bars.length - 1].n;
  var count = last - Math.max(1, first) + 1;
  if (count <= 6) return [{ name: 'A', from: first, to: last }];
  var size = count <= 48 ? 4 : 8;
  var out = [];
  var start = first;
  var b = Math.max(1, first);
  while (b <= last) {
    var end = Math.min(last, b + size - 1);
    out.push({ name: letter(out.length), from: start, to: end });
    start = end + 1;
    b = end + 1;
  }
  var tail = out[out.length - 1];
  if (out.length > 1 && tail.to - tail.from + 1 < size / 2) {
    out[out.length - 2].to = tail.to;
    out.pop();
  }
  return out;
}

module.exports = {
  parse: parse,
  parseSections: parseSections,
  defaultSections: defaultSections,
  noteName: noteName,
  parseKey: parseKey,
  parseMeter: parseMeter,
  lyricTokens: lyricTokens,
};
