/// <reference path="../pb_data/types.d.ts" />
/**
 * Looking after the voice. These rules live in the app (the rule plan, the
 * practice screen and plan.set's checks); the coach cannot override them.
 * Every number is a design default: no study sets a safe daily dose of
 * singing, so the app shows its rules and errs on the side of rest.
 *
 *   load        voiced minutes (time dose) and thousands of fold cycles
 *               (cycle dose: the sum of pitch × voiced time) per day
 *   cap         the session cap for the level (20 / 30 / 60 minutes)
 *   light day   after a heavy day (voiced minutes over 1.5× the 4-week daily
 *               mean and over 15), after pain, or when today's check-in has
 *               an item at 4 or 5: gentle work only (straw and lip trills,
 *               lessons, theory, listening); fatigue shows 24-72 h later
 *   rest        one day a week without singing (the person's rest day, or
 *               after six days in a row)
 *   ramp        this week's voiced minutes over 1.3× the 4-week weekly mean
 *   see a doctor  hoarseness at 3 or more on check-ins spanning 28 days:
 *               an ENT doctor (laryngologist) or a speech-language
 *               pathologist; sooner for heavy voice users. Never a diagnosis,
 *               never medicine.
 */

function U() {
  return require(`${__hooks}/lib_util.js`);
}
function M() {
  return require(`${__hooks}/lib_model.js`);
}

function r1(x) {
  return Math.round(x * 10) / 10;
}

/** Voiced ms and cycles per day since `since` (runs and drills). */
function loadByDay(app, since) {
  const u = U();
  const out = {};
  const add = (day, ms, cyc) => {
    const d = out[day] || { ms: 0, cycles: 0 };
    d.ms += ms;
    d.cycles += cyc;
    out[day] = d;
  };
  for (const r of u.rows(app, 'SELECT day, SUM(voiced_ms) AS ms, SUM(cycles) AS cyc FROM runs WHERE day >= {:d} GROUP BY day', { day: '', ms: -0, cyc: -0 }, { d: since })) add(r.day, r.ms, r.cyc);
  for (const r of u.rows(app, 'SELECT day, SUM(voiced_ms) AS ms, SUM(cycles) AS cyc FROM drills WHERE day >= {:d} GROUP BY day', { day: '', ms: -0, cyc: -0 }, { d: since })) add(r.day, r.ms, r.cyc);
  return out;
}

function checkinJson(c) {
  return { id: c.id, day: c.getString('day'), when: c.getString('when'), hoarse: c.getInt('hoarse'), effort: c.getInt('effort'), discomfort: c.getInt('discomfort'), high_loss: c.getInt('high_loss'), clearing: c.getInt('clearing'), pain: c.getBool('pain'), sz_ratio: c.getFloat('sz_ratio') || null, note: c.getString('note'), created: c.getString('created') };
}

function worst(c) {
  return Math.max(c.hoarse, c.effort, c.discomfort, c.high_loss, c.clearing);
}

/** Hoarseness at 3 or more on check-ins spanning four weeks (the AAO-HNS four-week rule). */
function persistentHoarseness(app, today) {
  const m = M();
  const since = m.addDays(today, -60);
  const rows = app.findRecordsByFilter('checkins', 'day >= {:d}', 'day', 0, 0, { d: since }).map(checkinJson);
  if (rows.length < 2) return null;
  const last = rows[rows.length - 1];
  if (last.hoarse < 3) return null;
  // The run of hoarse check-ins ending today, allowing one better day in between.
  let start = last;
  let misses = 0;
  for (let i = rows.length - 2; i >= 0; i--) {
    if (rows[i].hoarse >= 3) start = rows[i];
    else if (++misses > 1) break;
  }
  const days = m.daysBetween(start.day, last.day);
  return days >= 28 ? { since: start.day, days: days } : null;
}

/** The whole picture for today: load, the light/rest decision, flags and what to say. */
function state(app) {
  const m = M();
  const st = m.settings(app);
  const today = m.dayKey();
  const since = m.addDays(today, -35);
  const load = loadByDay(app, since);
  const minOf = (d) => ((load[d] || { ms: 0 }).ms || 0) / 60000;
  const yesterday = m.addDays(today, -1);
  let sum28 = 0;
  for (let i = 1; i <= 28; i++) sum28 += minOf(m.addDays(today, -i));
  const mean28 = sum28 / 28;
  let week = 0;
  for (let i = 0; i < 7; i++) week += minOf(m.addDays(today, -i));
  let prev4w = 0;
  for (let i = 7; i < 35; i++) prev4w += minOf(m.addDays(today, -i));
  const weekMean = prev4w / 4;
  let streak = 0;
  for (let i = 1; i <= 14; i++) {
    if (minOf(m.addDays(today, -i)) > 0.5) streak++;
    else break;
  }
  const cap = m.sessionCap(app);
  const flags = [];
  const heavy = minOf(yesterday) > Math.max(15, mean28 * 1.5) && mean28 > 0;
  if (heavy) flags.push({ key: 'heavy_yesterday', text: 'Yesterday was a heavy day (' + Math.round(minOf(yesterday)) + ' voiced minutes). Fatigue can show 24-72 hours later, so today is light.' });
  const ys = app.findRecordsByFilter('sessions', 'day = {:d} && pain = true', '', 1, 0, { d: yesterday });
  if (ys.length > 0) flags.push({ key: 'pain_yesterday', text: 'You stopped yesterday because it hurt. Today is gentle work only; if it still hurts, rest your voice.' });
  const todays = app.findRecordsByFilter('checkins', 'day = {:d}', '-created', 1, 0, { d: today }).map(checkinJson);
  const lastCheck = todays.length > 0 ? todays[0] : null;
  if (lastCheck !== null && (lastCheck.pain || worst(lastCheck) >= 4)) flags.push({ key: 'checkin', text: lastCheck.pain ? 'You reported pain today. Rest your voice; gentle straw work only if it feels fine.' : 'Your voice check is not good today. A short, gentle session, then rest.' });
  const todayPain = app.findRecordsByFilter('sessions', 'day = {:d} && pain = true', '', 1, 0, { d: today }).length > 0;
  if (todayPain) flags.push({ key: 'pain_today', text: 'You stopped today because it hurt. Rest your voice for the rest of the day.' });
  const restDay = st.getInt('rest_day');
  const isRestDay = (restDay >= 0 && m.weekday(today) === restDay) || streak >= 6;
  if (isRestDay) flags.push({ key: 'rest', text: streak >= 6 ? 'Six days of singing in a row: today is a rest day for the voice (lessons and theory are fine).' : 'Today is your weekly rest day for the voice.' });
  const ramp = weekMean > 10 && week > weekMean * 1.3;
  if (ramp) flags.push({ key: 'ramp', text: 'This week is ' + Math.round((week / weekMean) * 10) / 10 + '× your usual voice load. Build up gently.' });
  const ent = persistentHoarseness(app, today);
  if (ent !== null) flags.push({ key: 'see_doctor', text: 'Your voice has felt hoarse since ' + ent.since + ' (' + ent.days + ' days). Please see an ENT doctor (laryngologist) or a speech-language pathologist. Sooner if you use your voice heavily for work, smoke, have a lump in the neck, trouble breathing, or had surgery or a breathing tube recently. This is not medical advice.' });
  const todayMin = minOf(today);
  const light = flags.some((f) => f.key === 'heavy_yesterday' || f.key === 'pain_yesterday' || f.key === 'checkin');
  return {
    today: today,
    load: {
      today_min: r1(todayMin),
      today_cycles_k: Math.round(((load[today] || { cycles: 0 }).cycles || 0) / 1000),
      cap_min: cap,
      week_min: r1(week),
      mean_day_min: r1(mean28),
      ratio: weekMean > 0 ? Math.round((week / weekMean) * 100) / 100 : null,
      yesterday_min: r1(minOf(yesterday)),
      streak_days: streak,
    },
    light: light,
    rest: isRestDay || todayPain,
    flags: flags,
    checkin: lastCheck,
    checkins_on: st.getBool('checkins'),
    under18: st.getBool('under18'),
  };
}

/** A short version for the coach's review pack. */
function summary(app) {
  const s = state(app);
  return { light_day: s.light, rest_day: s.rest, load: s.load, flags: s.flags.map((f) => f.key) };
}

/** After a take: say so when today's voiced time passes the cap (once per level of excess). */
function nudge(app) {
  const s = state(app);
  if (s.flags.some((f) => f.key === 'pain_today')) return { key: 'pain_today', text: 'You stopped today because it hurt. Rest your voice now.' };
  if (s.load.today_min >= s.load.cap_min) return { key: 'cap', text: 'You have sung ' + Math.round(s.load.today_min) + ' voiced minutes today, your cap is ' + s.load.cap_min + '. Time to rest the voice: a cool-down, then water and quiet.' };
  if (s.light && s.load.today_min >= Math.min(10, s.load.cap_min / 2)) return { key: 'light', text: 'Today is a light day; that is enough singing. Lessons and theory are fine.' };
  return null;
}

/* ------------------------------------------------------------------ ops */

function get(app) {
  const s = state(app);
  const m = M();
  const since = m.addDays(s.today, -60);
  const hist = app.findRecordsByFilter('checkins', 'day >= {:d}', '-created', 60, 0, { d: since }).map(checkinJson);
  const load = loadByDay(app, m.addDays(s.today, -27));
  const days = [];
  for (let i = 27; i >= 0; i--) {
    const d = m.addDays(s.today, -i);
    days.push({ day: d, voiced_min: r1(((load[d] || { ms: 0 }).ms || 0) / 60000), cycles_k: Math.round(((load[d] || { cycles: 0 }).cycles || 0) / 1000) });
  }
  return Object.assign(s, { history: hist, days: days });
}

/** How the voice feels (1 = fine … 5 = bad), before or after singing. */
function checkin(app, e, p) {
  const u = U();
  const m = M();
  u.personOnly(e, 'answer a voice check (the person does)');
  const rec = new Record(app.findCollectionByNameOrId('checkins'));
  const day = m.dayKey();
  rec.set('day', day);
  rec.set('when', u.oneOf(p, 'when', ['before', 'after', 'other'], 'before'));
  for (const k of ['hoarse', 'effort', 'discomfort', 'high_loss', 'clearing']) rec.set(k, u.int(p, k, 1, 1, 5));
  rec.set('pain', u.bool(p, 'pain', false));
  const sz = u.number(p, 'sz_ratio', { min: 0, max: 10 });
  if (sz !== null) rec.set('sz_ratio', Math.round(sz * 100) / 100);
  rec.set('note', u.str(p, 'note', '').slice(0, 600));
  const open = app.findRecordsByFilter('sessions', "status = 'open'", '-last_at', 1, 0);
  if (open.length > 0) rec.set('session', open[0].id);
  app.save(rec);
  const j = checkinJson(rec);
  const s = state(app);
  let advice = 'Thanks. Sing well.';
  if (j.pain) advice = 'Pain is a reason to stop. Rest your voice today. If it hurts again, or hoarseness lasts, see an ENT doctor or a speech-language pathologist.';
  else if (worst(j) >= 4) advice = 'Not a good voice day: keep it to 10 gentle minutes (straw or lip trills, a lesson), then rest.';
  else if (sz !== null && sz > 1.4) advice = 'Your s/z ratio is above 1.4. One reading means little; if it stays high, consider a check with a speech-language pathologist.';
  return { checkin: j, advice: advice, health: s };
}

module.exports = { state: state, summary: summary, nudge: nudge, get: get, checkin: checkin, loadByDay: loadByDay, persistentHoarseness: persistentHoarseness };
