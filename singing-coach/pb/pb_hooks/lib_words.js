/// <reference path="../pb_data/types.d.ts" />
/**
 * A song's words, note by note, for the coach (and anyone without the
 * editor): read them bar by bar with each note's name and syllable, shift a
 * verse's words one note earlier or later from a given note, or lay a line
 * of words on chosen bars. Writing goes through the notation: the w: lines
 * of every music line are written again from the syllables (one token a
 * note: the syllable, "_" holding the one before, "*" none, a closing "-"
 * joining the next), and the song is saved through songs.update, with its
 * checks. Songs with repeats (whose verses alternate) are not rewritten.
 */

const U = () => require(`${__hooks}/lib_util.js`);
const M = () => require(`${__hooks}/lib_model.js`);
const A = () => require(`${__hooks}/lib_abc.js`);
const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
const CJK = /[぀-ヿ㐀-鿿가-힯一-鿿]/;
const ATTACH = /[ぁぃぅぇぉゃゅょゎっァィゥェォャュョヮッー〜]/;

function noteName(m) {
  return NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
}

/** The song, parsed, with its words per verse per sung note ('' none, '_' held, a closing '-' joins). */
function load(app, songId) {
  const u = U();
  const rec = M().song(app, songId);
  const abc = rec.getString('abc');
  const parsed = A().parse(abc);
  if (!parsed.ok) throw u.fail(409, 'The song\'s notation does not parse; fix it with songs.update --abc first.');
  const model = parsed.model;
  const mel = model.melody || [];
  const verses = Math.max(1, (model.lyrics || []).length);
  const lyr = [];
  for (let v = 0; v < verses; v++) lyr.push(mel.map((_, i) => ((model.lyrics || [])[v] || [])[i] || ''));
  return { rec: rec, abc: abc, parsed: parsed, model: model, mel: mel, lyr: lyr };
}

function barOf(model, n) {
  return model.bars[n[3]] ? model.bars[n[3]].n : 0;
}

function barsParam(p, name) {
  const u = U();
  const raw = u.str(p, name, '').trim();
  if (raw === '') return null;
  const m = /^(\d+)\s*(?:-\s*(\d+))?$/.exec(raw);
  if (m === null) throw u.fail(400, name + ' must be a bar or a range of bars, e.g. --' + name + ' 4-7');
  const a = Number(m[1]);
  const b = m[2] !== undefined ? Number(m[2]) : a;
  return [Math.min(a, b), Math.max(a, b)];
}

/** One line a bar: "bar 4 · line 22 | G3 最- | A3 _ | B3 後" (verses joined with " / "). */
function viewOf(s, range, verse) {
  const byBar = {};
  s.mel.forEach((n, i) => {
    const b = barOf(s.model, n);
    (byBar[b] = byBar[b] || []).push(i);
  });
  // Every bar in the range, those with no sung notes too (said so).
  const order = s.model.bars.map((b) => b.n).filter((b, k, all) => all.indexOf(b) === k && (range === null || (b >= range[0] && b <= range[1])));
  const lines = s.parsed.layout !== null ? s.parsed.layout.melLine : null;
  return order.map((b) => {
    const idx = byBar[b];
    if (idx === undefined) return 'bar ' + b + ' | (no sung notes)';
    const at = lines !== null ? ' · line ' + lines[idx[0]] : '';
    const toks = idx.map((i) => {
      const sy = (verse === null ? s.lyr : [s.lyr[verse] || []]).map((v) => {
        const x = v[i] || '';
        return x === '' ? '·' : x;
      });
      return noteName(s.mel[i][2]) + ' ' + sy.join(' / ');
    });
    return 'bar ' + b + at + ' | ' + toks.join(' | ');
  });
}

const HOW =
  'One token a sung note, in order: the note, then its syllable in each verse ("·" none, "_" holds the syllable before over this note, a closing "-" joins the next syllable). "line" is the notation line of the notes; its w: lines follow it, a verse each. Change words with songs.shift-words or songs.set-words; or, in the app, the person drags them in the song editor.';

/** GET songs.words */
function view(app, p) {
  const u = U();
  const s = load(app, u.req(p, 'song', '{song id}'));
  const range = barsParam(p, 'bars');
  const verse = u.has(p, 'verse') ? u.int(p, 'verse', 1, 1, s.lyr.length) - 1 : null;
  return {
    song: s.rec.id,
    title: s.rec.getString('title'),
    verses: (s.model.lyrics || []).length,
    pickup: s.model.pickup === true,
    bars_total: s.model.bars.length - (s.model.pickup ? 1 : 0),
    words: viewOf(s, range, verse),
    how: HOW,
  };
}

/** A syllable as a w: token. */
function token(x) {
  if (x === '' || x === undefined) return '*';
  if (x === '_') return '_';
  const join = x.length > 1 && x.charAt(x.length - 1) === '-';
  const base = (join ? x.slice(0, -1) : x).replace(/[-_*|\\]/g, '').replace(/\s+/g, '~');
  return base === '' ? '*' : base + (join ? '-' : '');
}

/** The notation with the w: lines written again from `lyr` (per verse per sung note). */
function rewrite(abc, layout, lyr) {
  const lines = abc.split(/\r?\n/);
  const byMusic = {};
  layout.melLine.forEach((m, i) => {
    (byMusic[m] = byMusic[m] || []).push(i);
  });
  const edits = [];
  Object.keys(byMusic)
    .map(Number)
    .sort((a, b) => a - b)
    .forEach((m) => {
      const idx = byMusic[m];
      const have = layout.wLines.filter((w) => w.music === m).sort((a, b) => a.verse - b.verse);
      const texts = lyr.map((v) => 'w: ' + idx.map((i) => token(v[i])).join(' ').replace(/- /g, '-'));
      edits.push({ music: m, have: have.map((w) => w.n), texts: texts });
    });
  // From the bottom up, so line numbers stay true.
  edits.sort((a, b) => b.music - a.music);
  for (const ed of edits) {
    // Verse lines this music line had, and any later verse with words here (with the empty ones before it,
    // so every verse keeps its place); a verse with no word on a line that had none stays out.
    let need = ed.have.length;
    ed.texts.forEach((t, k) => {
      if (/[^\s*_]/.test(t.slice(3))) need = Math.max(need, k + 1);
    });
    const keep = ed.texts.slice(0, need);
    const at = ed.have.length > 0 ? ed.have[0] - 1 : ed.music;
    lines.splice(at, ed.have.length, ...keep);
  }
  return lines.join('\n');
}

/** Words as syllables: spaces part words, hyphens part syllables, every Japanese, Chinese or Korean character is one. */
function syllables(text) {
  const out = [];
  for (const word of String(text).trim().split(/\s+/)) {
    if (word === '') continue;
    if (word === '_') {
      out.push('_');
      continue;
    }
    let cur = '';
    const flush = (join) => {
      if (cur !== '') out.push(cur + (join ? '-' : ''));
      cur = '';
    };
    const chars = Array.from(word);
    for (let i = 0; i < chars.length; i++) {
      const c = chars[i];
      if (CJK.test(c) && !ATTACH.test(c)) {
        flush(false);
        cur = c;
        // A run of these is one word sung a character a note.
        flush(false);
        continue;
      }
      if (ATTACH.test(c) && cur === '' && out.length > 0) {
        out[out.length - 1] += c;
        continue;
      }
      if (c === '-') {
        flush(true);
        continue;
      }
      cur += c;
    }
    flush(false);
  }
  return out;
}

function save(app, e, s, lyr, range) {
  const u = U();
  if (s.parsed.layout === null) throw u.fail(409, 'This song has repeats, whose verses alternate: change its words with songs.update --abc (the w: lines).');
  const abc = rewrite(s.abc, s.parsed.layout, lyr);
  const res = require(`${__hooks}/lib_songs.js`).update(app, e, { song: s.rec.id, abc: abc });
  const after = load(app, s.rec.id);
  return { song: { id: res.song.id, title: res.song.title }, changed: res.changed, words: viewOf(after, range, null) };
}

/** Index of the nth sung note of bar b (1-based). */
function noteIndex(s, bar, nth) {
  const u = U();
  const idx = [];
  s.mel.forEach((n, i) => {
    if (barOf(s.model, n) === bar) idx.push(i);
  });
  if (idx.length === 0) throw u.fail(400, 'Bar ' + bar + ' has no sung notes. songs.words shows the bars with their notes.');
  if (nth < 1 || nth > idx.length) throw u.fail(400, 'Bar ' + bar + ' has ' + idx.length + ' sung note' + (idx.length === 1 ? '' : 's') + '; --note must be 1 to ' + idx.length + '.');
  return idx[nth - 1];
}

/** POST songs.shift-words */
function shift(app, e, p) {
  const u = U();
  const s = load(app, u.req(p, 'song', '{song id}'));
  const v = u.int(p, 'verse', 1, 1, s.lyr.length) - 1;
  const bar = u.int(p, 'bar', 0, 0, 2000);
  if (!u.has(p, 'bar')) throw u.fail(400, 'bar is required: the bar of the first syllable to move, e.g. --bar 4 --note 2');
  const start = noteIndex(s, bar, u.int(p, 'note', 1, 1, 200));
  const by = u.int(p, 'by', 0, -1, 1);
  if (by === 0) throw u.fail(400, 'by must be -1 (one note earlier) or 1 (one note later).');
  const through = u.oneOf(p, 'through', ['phrase', 'song'], 'phrase');
  const phrase = s.mel[start][5];
  let end = start;
  while (end + 1 < s.mel.length && (through === 'song' || s.mel[end + 1][5] === phrase)) end++;
  const L = s.lyr[v].slice();
  const filled = (x) => x !== '' && x !== undefined;
  const at = (i) => 'bar ' + barOf(s.model, s.mel[i]) + ', note ' + (s.mel.filter((n, k) => k <= i && barOf(s.model, n) === barOf(s.model, s.mel[i])).length);
  if (by === -1) {
    if (start === 0) throw u.fail(400, 'There is no note before the first one.');
    if (filled(L[start - 1]) && L[start - 1] !== '_') throw u.fail(400, 'The note before (' + at(start - 1) + ') has its own syllable "' + L[start - 1] + '": move from there, or lay the words again with songs.set-words.');
    for (let k = start - 1; k < end; k++) L[k] = L[k + 1];
    L[end] = filled(L[end - 1]) ? '_' : '';
  } else {
    const lastSyl = L[end];
    for (let k = end; k > start; k--) L[k] = L[k - 1];
    L[start] = start > 0 && s.mel[start - 1][5] === phrase && filled(L[start - 1]) ? '_' : '';
    // What would fall off the end of the phrase goes with its last note.
    if (filled(lastSyl) && lastSyl !== '_') L[end] = L[end] !== '_' && filled(L[end]) ? L[end].replace(/-$/, '') + (CJK.test(lastSyl) ? '' : ' ') + lastSyl : lastSyl;
  }
  const lyr = s.lyr.slice();
  lyr[v] = L;
  const b0 = barOf(s.model, s.mel[Math.max(0, start - 1)]);
  const b1 = barOf(s.model, s.mel[end]);
  return save(app, e, s, lyr, [b0, b1]);
}

/** POST songs.set-words */
function set(app, e, p) {
  const u = U();
  const s = load(app, u.req(p, 'song', '{song id}'));
  const range = barsParam(p, 'bars');
  if (range === null) throw u.fail(400, 'bars is required: the bars the words go on, e.g. --bars 4-7');
  const text = u.req(p, 'text', '"sa-i go no ki-su wa" (spaces part words, - parts syllables, _ holds one over the next note)');
  const v = u.int(p, 'verse', 1, 1, s.lyr.length + 1) - 1;
  const idx = [];
  s.mel.forEach((n, i) => {
    const b = barOf(s.model, n);
    if (b >= range[0] && b <= range[1]) idx.push(i);
  });
  if (idx.length === 0) throw u.fail(400, 'Bars ' + range[0] + '-' + range[1] + ' have no sung notes.');
  const syls = syllables(text);
  if (syls.length > idx.length) throw u.fail(400, 'There are ' + syls.length + ' syllables for the ' + idx.length + ' sung notes of ' + (range[0] === range[1] ? 'bar ' + range[0] : 'bars ' + range[0] + '-' + range[1]) + ': widen --bars, or put two under one note with ~ (e.g. "and~the").');
  const lyr = s.lyr.map((x) => x.slice());
  while (lyr.length <= v) lyr.push(s.mel.map(() => ''));
  idx.forEach((i, k) => {
    // Notes left over hold the last syllable.
    lyr[v][i] = k < syls.length ? syls[k] : '_';
  });
  return save(app, e, s, lyr, range);
}

module.exports = { view: view, shift: shift, set: set, syllables: syllables, rewrite: rewrite };
