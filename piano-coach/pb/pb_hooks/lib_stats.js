/// <reference path="../pb_data/types.d.ts" />
/**
 * Numbers for the dashboard and the song pages: minutes per day, accuracy,
 * streaks, sections by stage, a song's tempo ladders and its trouble bars.
 * Everything comes from runs, one SQL pass per question.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

/** Minutes and accuracy per day since a day: {day: {ms, runs, acc, accN}}. */
function daily(app, since) {
  const u = U();
  const out = {};
  for (const r of u.rows(app, 'SELECT day, SUM(ms) AS ms, COUNT(*) AS n FROM (SELECT day, duration_ms AS ms FROM runs WHERE day >= {:d} UNION ALL SELECT day, duration_ms AS ms FROM drills WHERE day >= {:d}) GROUP BY day', { day: '', ms: -0, n: 0 }, { d: since })) {
    out[r.day] = { ms: r.ms, runs: r.n, acc: null, accN: 0 };
  }
  for (const r of u.rows(app, "SELECT day, AVG(accuracy) AS acc, COUNT(*) AS n FROM runs WHERE day >= {:d} AND mode = 'play' AND complete = 1 AND expected > 0 GROUP BY day", { day: '', acc: -0, n: 0 }, { d: since })) {
    if (out[r.day] === undefined) out[r.day] = { ms: 0, runs: 0, acc: null, accN: 0 };
    out[r.day].acc = r.acc;
    out[r.day].accN = r.n;
  }
  return out;
}

function minutesOf(d) {
  return d === undefined ? 0 : Math.round((d.ms / 60000) * 10) / 10;
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
    series.push({ day: day, minutes: minutesOf(x), accuracy: x !== undefined && x.acc !== null ? Math.round(x.acc * 1000) / 1000 : null, runs: x === undefined ? 0 : x.runs });
  }
  const heat = [];
  for (let i = 7 * 18 - 1; i >= 0; i--) {
    const day = m.addDays(today, -i);
    heat.push({ day: day, minutes: minutesOf(d[day]) });
  }
  const sum = (from, to) => {
    let mins = 0;
    let accSum = 0;
    let accN = 0;
    for (let i = from; i <= to; i++) {
      const x = d[m.addDays(today, -i)];
      if (x === undefined) continue;
      mins += x.ms / 60000;
      if (x.acc !== null) {
        accSum += x.acc * x.accN;
        accN += x.accN;
      }
    }
    return { minutes: Math.round(mins), accuracy: accN > 0 ? Math.round((accSum / accN) * 1000) / 1000 : null };
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
  const latest = app.findRecordsByFilter('messages', "role = 'coach'", '-created', 1, 0);
  const coach = require(`${__hooks}/lib_coach.js`);
  const lastSong = st.getString('last_song') !== '' ? u.byId(app, 'songs', st.getString('last_song')) : null;
  return {
    day: today,
    goal: st.getInt('daily_minutes') || 20,
    level: st.getInt('level') || 1,
    today: { minutes: minutesOf(d[today]), runs: d[today] === undefined ? 0 : d[today].runs },
    streak: streak(app, d),
    week: series.slice(-7),
    series: series,
    heat: heat,
    totals: {
      minutes_7: w.minutes,
      minutes_prev_7: pw.minutes,
      accuracy_7: w.accuracy,
      accuracy_prev_7: pw.accuracy,
      sections: counts,
      songs_mastered: songsMastered,
      songs: songs.length,
      due: due,
    },
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
  const rec = m.song(app, u.req(p, 'song', '<song id>'));
  const secs = m.sectionsOf(rec);
  const runs = app.findRecordsByFilter('runs', 'song = {:s}', 'created', 0, 0, { s: rec.id });
  const ladders = secs.map(() => ({}));
  const days = {};
  const bars = {};
  let playRuns = 0;
  for (const r of runs) {
    const day = r.getString('day');
    const x = days[day] || (days[day] = { day: day, minutes: 0, runs: 0, best: 0, acc: 0, accN: 0 });
    x.minutes += r.getInt('duration_ms') / 60000;
    x.runs += 1;
    if (r.getBool('clean')) x.best = Math.max(x.best, r.getFloat('tempo_pct'));
    if (r.getString('mode') === 'play' && r.getBool('complete') && r.getInt('expected') > 0) {
      x.acc += r.getFloat('accuracy');
      x.accN += 1;
    }
    for (const res of u.getJson(r, 'results') || []) {
      if (res.i === undefined || res.i >= ladders.length || !res.best) continue;
      const lad = ladders[res.i];
      lad[day] = Math.max(lad[day] || 0, res.best);
    }
    if (r.getString('mode') === 'play') playRuns += 1;
  }
  // Trouble bars: wrong and missed notes per bar over the last 30 passes played.
  const recent = Array.from(runs).filter((r) => r.getString('mode') === 'play').slice(-30);
  for (const r of recent) {
    for (const b of u.getJson(r, 'per_bar') || []) {
      const n = Number(b[0]);
      const v = bars[n] || (bars[n] = { bar: n, expected: 0, errors: 0, wrong: 0, missed: 0 });
      v.expected += Number(b[1]) || 0;
      v.errors += (Number(b[3]) || 0) + (Number(b[4]) || 0);
      v.wrong += Number(b[3]) || 0;
      v.missed += Number(b[4]) || 0;
    }
  }
  return {
    song: m.songJson(app, rec, {}),
    days: Object.keys(days)
      .sort()
      .map((k) => {
        const x = days[k];
        return { day: k, minutes: Math.round(x.minutes * 10) / 10, runs: x.runs, best: x.best, accuracy: x.accN > 0 ? Math.round((x.acc / x.accN) * 1000) / 1000 : null };
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
    play_runs: playRuns,
  };
}

module.exports = { home: home, song: song, streak: streak, daily: daily };
