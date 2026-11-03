/// <reference path="../pb_data/types.d.ts" />
/**
 * Numbers for the dashboard and the song pages: minutes and voiced minutes
 * per day, the share of notes on pitch (or close) and exactly in tune,
 * steadiness, streaks, sections by stage, the voice map (every voiced frame
 * of the week as pitch × loudness), a song's tempo ladders and its trouble
 * bars. Everything comes from runs and drills, one SQL pass per question.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function r3(x) {
  return Math.round(x * 1000) / 1000;
}
function r1(x) {
  return Math.round(x * 10) / 10;
}

/** Per day since a day: {day: {ms, voiced, runs, exp, on, close, hold, holdN}}. */
function daily(app, since) {
  const u = U();
  const out = {};
  const get = (day) => out[day] || (out[day] = { ms: 0, voiced: 0, runs: 0, exp: 0, on: 0, close: 0, hold: 0, holdN: 0 });
  for (const r of u.rows(app, 'SELECT day, SUM(ms) AS ms, SUM(v) AS v, COUNT(*) AS n FROM (SELECT day, duration_ms AS ms, voiced_ms AS v FROM runs WHERE day >= {:d} UNION ALL SELECT day, duration_ms AS ms, voiced_ms AS v FROM drills WHERE day >= {:d}) GROUP BY day', { day: '', ms: -0, v: -0, n: 0 }, { d: since })) {
    const x = get(r.day);
    x.ms = r.ms;
    x.voiced = r.v;
    x.runs = r.n;
  }
  for (const r of u.rows(app, "SELECT day, SUM(expected) AS e, SUM(on_n) AS o, SUM(close_n) AS c FROM runs WHERE day >= {:d} AND mode IN ('sing','solo','echo') AND expected > 0 GROUP BY day", { day: '', e: 0, o: 0, c: 0 }, { d: since })) {
    const x = get(r.day);
    x.exp = r.e;
    x.on = r.o;
    x.close = r.c;
  }
  for (const r of u.rows(app, 'SELECT day, AVG(hold_sd) AS h, COUNT(*) AS n FROM runs WHERE day >= {:d} AND hold_sd > 0 GROUP BY day', { day: '', h: -0, n: 0 }, { d: since })) {
    const x = get(r.day);
    x.hold = r.h;
    x.holdN = r.n;
  }
  return out;
}

function minutesOf(d) {
  return d === undefined ? 0 : r1(d.ms / 60000);
}

/** Days in a row with at least a minute of practice, up to today (or yesterday). */
function streak(app, days) {
  const m = M();
  const today = m.dayKey();
  const d = days || daily(app, m.addDays(today, -400));
  let day = minutesOf(d[today]) >= 1 ? today : m.addDays(today, -1);
  let n = 0;
  while (minutesOf(d[day]) >= 1 && n < 400) {
    n += 1;
    day = m.addDays(day, -1);
  }
  return n;
}

/** Every voiced frame of the last days as [midi, loudness bucket 0-9, count]. */
function voiceMap(app, days) {
  const u = U();
  const m = M();
  const since = m.addDays(m.dayKey(), -(days - 1));
  const acc = {};
  for (const r of app.findRecordsByFilter('runs', "day >= {:d} && map != '[]' && map != ''", '-created', 300, 0, { d: since })) {
    for (const c of u.getJson(r, 'map') || []) {
      if (!Array.isArray(c) || c.length < 3) continue;
      const k = c[0] + ':' + c[1];
      acc[k] = (acc[k] || 0) + (Number(c[2]) || 0);
    }
  }
  return Object.keys(acc).map((k) => {
    const p = k.split(':');
    return [Number(p[0]), Number(p[1]), acc[k]];
  });
}

function home(app) {
  const m = M();
  const u = U();
  m.ensureSeeded(app);
  const st = m.settings(app);
  const today = m.dayKey();
  const d = daily(app, m.addDays(today, -400));
  const series = [];
  for (let i = 29; i >= 0; i--) {
    const day = m.addDays(today, -i);
    const x = d[day];
    series.push({
      day: day,
      minutes: minutesOf(x),
      voiced: x === undefined ? 0 : r1(x.voiced / 60000),
      pitch: x !== undefined && x.exp > 0 ? r3((x.on + x.close) / x.exp) : null,
      in_tune: x !== undefined && x.exp > 0 ? r3(x.on / x.exp) : null,
      hold: x !== undefined && x.holdN > 0 ? r1(x.hold) : null,
      runs: x === undefined ? 0 : x.runs,
    });
  }
  const heat = [];
  for (let i = 7 * 12 - 1; i >= 0; i--) {
    const day = m.addDays(today, -i);
    heat.push({ day: day, minutes: minutesOf(d[day]), voiced: d[day] === undefined ? 0 : r1(d[day].voiced / 60000) });
  }
  const sum = (from, to) => {
    let mins = 0;
    let voiced = 0;
    let exp = 0;
    let on = 0;
    let close = 0;
    let hold = 0;
    let holdN = 0;
    for (let i = from; i <= to; i++) {
      const x = d[m.addDays(today, -i)];
      if (x === undefined) continue;
      mins += x.ms / 60000;
      voiced += x.voiced / 60000;
      exp += x.exp;
      on += x.on;
      close += x.close;
      hold += x.hold * x.holdN;
      holdN += x.holdN;
    }
    return { minutes: Math.round(mins), voiced: r1(voiced), pitch: exp > 0 ? r3((on + close) / exp) : null, in_tune: exp > 0 ? r3(on / exp) : null, hold: holdN > 0 ? r1(hold / holdN) : null };
  };
  const w = sum(0, 6);
  const pw = sum(7, 13);

  const progs = require(`${__hooks}/lib_songs.js`).progressMap(app);
  const songs = app.findRecordsByFilter('songs', 'archived = false', '', 0, 0);
  const counts = { new: 0, learning: 0, steady: 0, mastered: 0 };
  let songsMastered = 0;
  let due = 0;
  const current = [];
  for (const r of songs) {
    const secs = m.sectionsOf(r);
    const prog = progs[r.id] || null;
    const states = m.statesOf(prog, secs.length);
    for (const s of states) {
      counts[s.stage] = (counts[s.stage] || 0) + 1;
      if (s.stage === 'mastered' && s.due !== '' && s.due <= today) due += 1;
    }
    if (states.length > 0 && states.every((s) => s.stage === 'mastered')) songsMastered += 1;
    if (prog !== null && prog.getInt('runs') > 0) current.push({ rec: r, prog: prog, last: u.ms(prog.getString('last_at')), states: states });
  }
  current.sort((a, b) => b.last - a.last);
  const V = require(`${__hooks}/lib_voice.js`);
  const voice = V.current(app);
  const health = require(`${__hooks}/lib_health.js`).state(app);
  const latest = app.findRecordsByFilter('messages', "role = 'coach'", '-created', 1, 0);
  const coach = require(`${__hooks}/lib_coach.js`);
  const lastSong = st.getString('last_song') !== '' ? u.byId(app, 'songs', st.getString('last_song')) : null;
  const L = require(`${__hooks}/lib_learn.js`);
  const levels = L.evaluate(app);
  const lvl = st.getInt('level') || 1;
  const curLevel = levels[lvl - 1];
  return {
    day: today,
    goal: st.getInt('daily_minutes') || 20,
    level: lvl,
    level_name: curLevel ? curLevel.name : '',
    level_met: curLevel ? curLevel.met : 0,
    level_total: curLevel ? curLevel.total : 0,
    today: { minutes: minutesOf(d[today]), voiced: d[today] === undefined ? 0 : r1(d[today].voiced / 60000), runs: d[today] === undefined ? 0 : d[today].runs },
    streak: streak(app, d),
    week: series.slice(-7),
    series: series,
    heat: heat,
    totals: {
      minutes_7: w.minutes,
      minutes_prev_7: pw.minutes,
      voiced_7: w.voiced,
      pitch_7: w.pitch,
      pitch_prev_7: pw.pitch,
      in_tune_7: w.in_tune,
      in_tune_prev_7: pw.in_tune,
      hold_7: w.hold,
      hold_prev_7: pw.hold,
      sections: counts,
      songs_mastered: songsMastered,
      songs: songs.length,
      due: due,
    },
    voice: { tested: voice.tested, comf_low: voice.comf_low, comf_high: voice.comf_high, low: voice.low, high: voice.high, family: voice.family, clef: voice.clef, passaggio: voice.passaggio, created: voice.created, sustain_s: voice.sustain_s },
    health: { load: health.load, light: health.light, rest: health.rest, flags: health.flags, checkin: health.checkin, checkins_on: health.checkins_on },
    map: voiceMap(app, 7),
    current: current.slice(0, 5).map((c) => m.songJson(app, c.rec, { progress: c.prog, preview: true })),
    resume: lastSong !== null && !lastSong.getBool('archived') ? m.songJson(app, lastSong, { preview: true }) : null,
    coach: latest.length > 0 ? { id: latest[0].id, kind: latest[0].getString('kind'), text: latest[0].getString('text').slice(0, 400), created: latest[0].getString('created') } : null,
    unread: coach.unread(app),
  };
}

/** One song over time: tempo ladders per section, practice per day, trouble bars. */
function song(app, p) {
  const u = U();
  const m = M();
  const rec = m.song(app, u.req(p, 'song', '{song id}'));
  const secs = m.sectionsOf(rec);
  const runs = app.findRecordsByFilter('runs', 'song = {:s}', 'created', 0, 0, { s: rec.id });
  const ladders = secs.map(() => ({}));
  const days = {};
  const bars = {};
  let sung = 0;
  for (const r of runs) {
    const day = r.getString('day');
    const x = days[day] || (days[day] = { day: day, minutes: 0, runs: 0, best: 0, exp: 0, hit: 0 });
    x.minutes += r.getInt('duration_ms') / 60000;
    x.runs += 1;
    if (r.getBool('clean')) x.best = Math.max(x.best, r.getFloat('tempo_pct'));
    const mode = r.getString('mode');
    if ((mode === 'sing' || mode === 'solo') && r.getInt('expected') > 0) {
      x.exp += r.getInt('expected');
      x.hit += r.getInt('on_n') + r.getInt('close_n');
      sung += 1;
    }
    for (const res of u.getJson(r, 'results') || []) {
      if (res.i === undefined || res.i >= ladders.length || !res.best) continue;
      const lad = ladders[res.i];
      lad[day] = Math.max(lad[day] || 0, res.best);
    }
  }
  // Trouble bars: notes off or missed per bar over the last 30 sung takes.
  const recent = Array.from(runs)
    .filter((r) => r.getString('mode') === 'sing' || r.getString('mode') === 'solo')
    .slice(-30);
  for (const r of recent) {
    for (const b of u.getJson(r, 'per_bar') || []) {
      const n = Number(b[0]);
      const v = bars[n] || (bars[n] = { bar: n, expected: 0, errors: 0, off: 0, missed: 0 });
      v.expected += Number(b[1]) || 0;
      v.off += Number(b[4]) || 0;
      v.missed += Number(b[5]) || 0;
      v.errors += (Number(b[4]) || 0) + (Number(b[5]) || 0);
    }
  }
  return {
    song: m.songJson(app, rec, {}),
    days: Object.keys(days)
      .sort()
      .map((k) => {
        const x = days[k];
        return { day: k, minutes: r1(x.minutes), runs: x.runs, best: x.best, pitch: x.exp > 0 ? r3(x.hit / x.exp) : null };
      }),
    ladders: ladders.map((lad, i) => ({
      section: secs[i].name,
      points: Object.keys(lad)
        .sort()
        .map((k) => ({ day: k, best: lad[k] })),
    })),
    bars: Object.keys(bars)
      .map((k) => bars[k])
      .sort((a, b) => a.bar - b.bar),
    sung_takes: sung,
  };
}

/** The voice over time: range tests, steadiness, sustain, load and the voice map. */
function voice(app) {
  const m = M();
  const V = require(`${__hooks}/lib_voice.js`);
  const H = require(`${__hooks}/lib_health.js`);
  const today = m.dayKey();
  const d = daily(app, m.addDays(today, -89));
  const hold = [];
  for (let i = 89; i >= 0; i--) {
    const day = m.addDays(today, -i);
    const x = d[day];
    if (x !== undefined && x.holdN > 0) hold.push({ day: day, hold: r1(x.hold) });
  }
  const sk = app.findRecordsByFilter('skills', "key = 'breath.sustain'", '', 1, 0);
  const sus = sk.length > 0 ? (U().getJson(sk[0], 'history') || []).slice(-30) : [];
  return { voice: V.get(app), hold: hold, sustain_history: sus, health: H.get(app), map: voiceMap(app, 7), map_30: voiceMap(app, 30) };
}

module.exports = { home: home, song: song, voice: voice, streak: streak, daily: daily, voiceMap: voiceMap };
