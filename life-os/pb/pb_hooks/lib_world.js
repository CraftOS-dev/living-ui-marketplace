/// <reference path="../pb_data/types.d.ts" />
/**
 * The world outside: where the person lives, the weather there and the
 * news, fetched by the app itself (nobody types any of it).
 *
 * - Place: found once from this machine's internet address (ipwho.is), or
 *   chosen by city name (Open-Meteo geocoding). Kept in settings.
 * - Weather: Open-Meteo forecast (current, the next 24 hours, 7 days), in
 *   the person's units. Cached 20 minutes.
 * - News: Google News RSS headlines by topic, in the English edition of the
 *   person's country when there is one. Cached 30 minutes per topic.
 *
 * Every call has a timeout. When a source does not answer, the last good
 * answer is shown with `stale: true`; when there is none, an `error`
 * says so and the screen shows an honest empty state.
 */

let u_ = null;
function u() {
  return u_ || (u_ = require(`${__hooks}/lib_util.js`));
}
let core_ = null;
function core() {
  return core_ || (core_ = require(`${__hooks}/lib_core.js`));
}

const WEATHER_TTL = 20 * 60 * 1000;
const NEWS_TTL = 30 * 60 * 1000;
const TOPICS = ['top', 'world', 'nation', 'business', 'technology', 'science', 'health', 'sports', 'entertainment'];
const EN_EDITIONS = ['US', 'GB', 'AU', 'CA', 'IN', 'IE', 'NZ', 'SG', 'MY', 'PH', 'ZA', 'NG', 'KE', 'PK', 'GH', 'UG', 'ZW', 'TZ', 'ET', 'BW', 'NA', 'IL', 'LB', 'BD'];

function get(url) {
  const res = $http.send({ url: url, method: 'GET', timeout: 8, headers: { 'User-Agent': 'LifeOS/1.0 (personal app)', Accept: '*/*' } });
  if (res.statusCode < 200 || res.statusCode >= 300) throw new Error('HTTP ' + res.statusCode);
  return res;
}

function cached(app, key, ttl, fetch) {
  const hit = app.store().get(key);
  if (hit && Date.now() - hit.at < ttl) return Object.assign({}, hit.data, { stale: false });
  try {
    const data = fetch();
    app.store().set(key, { at: Date.now(), data: data });
    return Object.assign({}, data, { stale: false });
  } catch (err) {
    console.error('[lo] ' + key + ' failed:', err);
    if (hit) return Object.assign({}, hit.data, { stale: true });
    return { error: 'Could not reach the service right now.', stale: true };
  }
}

/* --------------------------------------------------------------- place */

function placeOut(s) {
  return { city: s.getString('city'), region: s.getString('region'), country: s.getString('country'), lat: s.getFloat('lat'), lon: s.getFloat('lon'), timezone: s.getString('timezone') };
}

/** Find the place from this machine's internet address (once, when none is set). */
function detect(app) {
  const s = core().settings(app);
  if (s.getString('city') !== '' || s.getFloat('lat') !== 0 || s.getFloat('lon') !== 0) return placeOut(s);
  const tried = app.store().get('lo_place_tried') || 0;
  if (Date.now() - tried < 10 * 60 * 1000) return null;
  app.store().set('lo_place_tried', Date.now());
  try {
    const j = get('https://ipwho.is/').json;
    if (!j || j.success === false || typeof j.latitude !== 'number') return null;
    s.set('city', String(j.city || '').slice(0, 120));
    s.set('region', String(j.region || '').slice(0, 120));
    s.set('country', String(j.country_code || '').slice(0, 2).toUpperCase());
    s.set('lat', j.latitude);
    s.set('lon', j.longitude);
    s.set('timezone', String((j.timezone && j.timezone.id) || '').slice(0, 60));
    app.save(s);
    return placeOut(s);
  } catch (err) {
    console.error('[lo] place lookup failed:', err);
    return null;
  }
}

/** world.place: where the weather and news are for (found by itself the first time). */
function place(ctx) {
  const p = detect(ctx.app);
  return { place: p !== null ? p : placeOut(core().settings(ctx.app)) };
}

/** world.places: towns matching a name (to choose one). */
function places(ctx, p) {
  const util = u();
  const q = util.text(p, 'q', 100, '');
  if (q.length < 2) return { places: [] };
  try {
    const j = get('https://geocoding-api.open-meteo.com/v1/search?count=8&language=en&format=json&name=' + encodeURIComponent(q)).json;
    const list = (j && j.results) || [];
    return {
      places: list.map((r) => ({ city: String(r.name || ''), region: String(r.admin1 || ''), country: String(r.country_code || '').toUpperCase(), country_name: String(r.country || ''), lat: r.latitude, lon: r.longitude, timezone: String(r.timezone || '') })),
    };
  } catch (err) {
    console.error('[lo] place search failed:', err);
    throw util.fail(503, 'The place search did not answer. Try again in a moment.', 'unreachable');
  }
}

/** world.set-place: use this place for the weather and the news. */
function setPlace(ctx, p) {
  const util = u();
  const s = core().settings(ctx.app);
  const city = core().name(p, 'city', 120);
  const lat = util.num(p, 'lat', NaN, -90, 90);
  const lon = util.num(p, 'lon', NaN, -180, 180);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw util.fail(400, 'lat and lon are required (world.places finds them).', 'missing_param');
  s.set('city', city);
  s.set('region', util.text(p, 'region', 120, ''));
  s.set('country', util.str(p, 'country', '').slice(0, 2).toUpperCase());
  s.set('lat', lat);
  s.set('lon', lon);
  s.set('timezone', util.text(p, 'timezone', 60, ''));
  ctx.app.save(s);
  ctx.app.store().remove('lo_weather');
  for (const t of TOPICS) ctx.app.store().remove('lo_news_' + t);
  require(`${__hooks}/lib_activity.js`).write(ctx.app, ctx, { label: 'Set the place to ' + city, target: 'settings' });
  return { place: placeOut(s) };
}

/* ------------------------------------------------------------- weather */

function fetchWeather(app) {
  const pl = detect(app);
  if (pl === null || (pl.lat === 0 && pl.lon === 0)) throw new Error('no place');
  const imperial = core().prefs(app).units === 'imperial';
  const url =
    'https://api.open-meteo.com/v1/forecast?latitude=' +
    pl.lat +
    '&longitude=' +
    pl.lon +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day,precipitation' +
    '&hourly=temperature_2m,weather_code,precipitation_probability,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunrise,sunset,uv_index_max' +
    '&timezone=auto&forecast_days=7' +
    (imperial ? '&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch' : '');
  const j = get(url).json;
  const cur = j.current || {};
  const H = j.hourly || {};
  const D = j.daily || {};
  const nowTime = String(cur.time || '');
  let start = 0;
  const times = H.time || [];
  for (let i = 0; i < times.length; i++) {
    if (String(times[i]) >= nowTime.slice(0, 13)) {
      start = i;
      break;
    }
  }
  const hours = [];
  for (let i = start; i < Math.min(times.length, start + 24); i++) {
    hours.push({ time: String(times[i]).slice(11, 16), temp: Math.round(H.temperature_2m[i]), code: H.weather_code[i], rain: H.precipitation_probability ? H.precipitation_probability[i] : null, day: H.is_day ? H.is_day[i] === 1 : true });
  }
  const days = (D.time || []).map((d, i) => ({ date: String(d), max: Math.round(D.temperature_2m_max[i]), min: Math.round(D.temperature_2m_min[i]), code: D.weather_code[i], rain: D.precipitation_probability_max ? D.precipitation_probability_max[i] : null, sunrise: String((D.sunrise || [])[i] || '').slice(11, 16), sunset: String((D.sunset || [])[i] || '').slice(11, 16), uv: D.uv_index_max ? D.uv_index_max[i] : null }));
  return {
    place: pl,
    units: imperial ? 'imperial' : 'metric',
    current: { temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature), humidity: cur.relative_humidity_2m, code: cur.weather_code, wind: Math.round(cur.wind_speed_10m), day: cur.is_day === 1, precipitation: cur.precipitation, time: nowTime },
    hours: hours,
    days: days,
    fetched_at: new Date().toISOString(),
  };
}

/** world.weather: now, the next 24 hours and 7 days where the person lives. */
function weather(ctx) {
  const w = cached(ctx.app, 'lo_weather', WEATHER_TTL, () => fetchWeather(ctx.app));
  if (w.error && !w.place) {
    const s = core().settings(ctx.app);
    if (s.getString('city') === '' && s.getFloat('lat') === 0) return { weather: null, error: 'No place yet: choose your town in Settings.' };
  }
  return { weather: w.error ? null : w, error: w.error || '' };
}

/** Today's weather in a few words (for the journal and the agent): null when unknown. */
function brief(app) {
  const hit = app.store().get('lo_weather');
  if (!hit || !hit.data || !hit.data.current) return null;
  const d = hit.data;
  const today = (d.days || [])[0] || {};
  return { code: d.current.code, temp: d.current.temp, max: today.max, min: today.min, units: d.units, city: d.place ? d.place.city : '' };
}

/** The forecast by date (for the board's week): { 'YYYY-MM-DD': { code, max, min, rain } }. */
function byDate(app) {
  const hit = app.store().get('lo_weather');
  const out = {};
  if (!hit || !hit.data || !hit.data.days) return out;
  for (const d of hit.data.days) out[d.date] = { code: d.code, max: d.max, min: d.min, rain: d.rain };
  return out;
}

/* ---------------------------------------------------------------- news */

function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&')
    .trim();
}

/** The text inside the first <tag ...>...</tag> of an RSS item (XML elements, read in order). */
function element(xml, tag) {
  const open = xml.indexOf('<' + tag);
  if (open < 0) return { attrs: '', text: '' };
  const gt = xml.indexOf('>', open);
  const close = xml.indexOf('</' + tag + '>', gt);
  if (gt < 0 || close < 0) return { attrs: '', text: '' };
  return { attrs: xml.slice(open + tag.length + 1, gt), text: xml.slice(gt + 1, close) };
}

function feedUrl(topic, country) {
  const cc = EN_EDITIONS.indexOf(country) >= 0 ? country : 'US';
  const q = '?hl=en-' + cc + '&gl=' + cc + '&ceid=' + cc + ':en';
  if (topic === 'top') return 'https://news.google.com/rss' + q;
  return 'https://news.google.com/rss/headlines/section/topic/' + topic.toUpperCase() + q;
}

function fetchNews(app, topic) {
  const s = core().settings(app);
  const xml = toString(get(feedUrl(topic, s.getString('country'))).body);
  const items = [];
  let pos = 0;
  while (items.length < 20) {
    const a = xml.indexOf('<item>', pos);
    if (a < 0) break;
    const b = xml.indexOf('</item>', a);
    if (b < 0) break;
    const it = xml.slice(a + 6, b);
    pos = b + 7;
    const src = element(it, 'source');
    const source = decode(src.text);
    let title = decode(element(it, 'title').text);
    // Google appends " - <source>" to each title; the source is shown on its own.
    const tail = ' - ' + source;
    if (source !== '' && title.length > tail.length && title.slice(-tail.length) === tail) title = title.slice(0, -tail.length);
    const link = decode(element(it, 'link').text);
    const pub = Date.parse(decode(element(it, 'pubDate').text));
    if (title === '' || link.indexOf('https://') !== 0) continue;
    items.push({ title: title, source: source, link: link, published: Number.isFinite(pub) ? new Date(pub).toISOString() : '' });
  }
  return { topic: topic, items: items, fetched_at: new Date().toISOString() };
}

/** world.news: headlines for a topic. */
function news(ctx, p) {
  const util = u();
  const topic = util.oneOf(p, 'topic', TOPICS, 'top');
  const n = cached(ctx.app, 'lo_news_' + topic, NEWS_TTL, () => fetchNews(ctx.app, topic));
  const limit = util.int(p, 'limit', 8, 1, 20);
  return { topic: topic, items: (n.items || []).slice(0, limit), stale: n.stale === true, error: n.error || '', topics: TOPICS };
}

/** The tick keeps the weather warm so pages open with it. */
function warm(app) {
  const hit = app.store().get('lo_weather');
  if (hit && Date.now() - hit.at < WEATHER_TTL) return;
  const s = core().settings(app);
  if (!s.getBool('onboarded')) return;
  cached(app, 'lo_weather', WEATHER_TTL, () => fetchWeather(app));
}

module.exports = { TOPICS: TOPICS, place: place, places: places, setPlace: setPlace, weather: weather, brief: brief, byDate: byDate, news: news, warm: warm, detect: detect };
