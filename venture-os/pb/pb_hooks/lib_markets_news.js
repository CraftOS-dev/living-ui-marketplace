/// <reference path="../pb_data/types.d.ts" />
/**
 * Markets news (fix 4): what an investor reads, as a news dashboard on
 * Markets, Home and a portfolio company's page.
 *
 * Categories (stored on each item, set by the search that found it, never
 * by reading its words):
 *   portfolio    each portfolio company (an active holding): "<name>"
 *   pipeline     each deal-flow company open or on hold late in the funnel
 *   competitors  each competitor tile on an active market map
 *   policy       each thesis sector: <sector> regulation
 *   exits        venture-backed IPOs, startup acquisitions, secondaries
 *   funding      each thesis sector: "<sector> startup" funding; new venture
 *                funds; LP moves
 *   macro        VC funding volume, the IPO market, interest rates, startup
 *                valuations, public tech stocks
 *   sectors      each thesis sector: "<sector> startup"
 * Searches run in that order, so an article found by two keeps the more
 * specific one (one row per url). A demo firm (settings.mail.demo) runs the
 * macro, funding and sector searches only: its companies are fictional.
 *
 * Feeds: keyless public RSS news search. Bing News first (it carries a
 * picture per item in <News:Image>, and the publisher's own link inside its
 * click link); Google News when Bing answers nothing. Pictures are
 * downloaded server side from the declared host www.bing.com only, stored
 * on the item and served by the app (news.image); never hotlinked. Your AI
 * agent may add a lead picture it found (news.set-image --paths), stored the
 * same way. Articles older than 60 days are neither stored nor kept, except
 * Funding items that report a round (kept 400 days: the funding charts).
 *
 * The parse functions are pure (Node tests read fixtures); the fetches use
 * $http and sleep inside function bodies only.
 */

const BING_SEARCH = 'https://www.bing.com/news/search';
const GOOGLE_SEARCH = 'https://news.google.com/rss/search';
const NEWS_SEARCH = BING_SEARCH;
const IMAGE_HOST = 'www.bing.com';
const IMAGE_FETCH = 'https://www.bing.com/th';
const KEEP_DAYS = 60;
const ROUND_KEEP_DAYS = 400;
const PER_COMPANY = 5;
const PER_QUERY = 6;
const PACE_MS = 400;
const TIMEOUT = 20;
const IMAGE_TIMEOUT = 15;
const IMAGE_MAX_BYTES = 3145728;
const IMAGES_PER_PULL = 60;
const REFRESH_GAP_MS = 120000;
const LATE_STAGES = ['diligence', 'partner_meeting', 'ic', 'term_sheet'];
const KINDS = ['company', 'sector', 'thesis', 'market'];
const SCOPES = ['home', 'all', 'thesis', 'company', 'sector'];
const CATEGORIES = ['portfolio', 'pipeline', 'competitors', 'funding', 'exits', 'macro', 'policy', 'sectors'];
const CATEGORY_LABELS = { portfolio: 'Portfolio', pipeline: 'Pipeline', competitors: 'Competitors', funding: 'Funding', exits: 'Exits and M&A', macro: 'Markets and macro', policy: 'Policy', sectors: 'Sectors' };
const DEMO_CATEGORIES = ['macro', 'funding', 'sectors'];
const DIGEST_MAX = 60;
const FIRST_DAYS = 7;
const LIST_SCAN = 800;
const STORE_CHECKED = 'vo_news_checked_at';
const STORE_REFRESH = 'vo_news_refresh_at';

/** Market-wide searches: [category, topic, query]. */
const MARKET_QUERIES = [
  ['exits', 'Venture-backed IPOs', '"venture-backed" IPO'],
  ['exits', 'Startup acquisitions', 'startup "acquired by"'],
  ['exits', 'Secondaries', '"secondary sale" startup shares'],
  ['funding', 'New venture funds', '"new venture fund"'],
  ['funding', 'LP moves', '"limited partners" venture capital'],
  ['macro', 'VC funding', '"venture capital funding"'],
  ['macro', 'IPO market', '"IPO market"'],
  ['macro', 'Interest rates', '"Federal Reserve" interest rates'],
  ['macro', 'Startup valuations', '"startup valuations"'],
  ['macro', 'Public tech stocks', 'Nasdaq tech stocks'],
];

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

/* --------------------------------------------------------------- pure */

/** Words a partner uses for a sector key ('enterprise_saas' -> 'Enterprise SaaS'). */
const SECTOR_WORDS = { ai: 'AI', devtools: 'Dev tools', enterprise_saas: 'Enterprise SaaS', hr_tech: 'HR tech', legal_tech: 'Legal tech', fintech: 'Fintech', insurtech: 'Insurtech', proptech: 'Proptech', edtech: 'Edtech', agtech: 'Agtech' };
function sectorLabel(key) {
  const k = String(key || '').trim().toLowerCase();
  if (SECTOR_WORDS[k] !== undefined) return SECTOR_WORDS[k];
  const t = k.replace(/_/g, ' ');
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function bare(s) {
  return String(s || '').replace(/"/g, '').trim();
}

/** The search of a company: its exact name in quotes. */
function companyQuery(name) {
  return '"' + bare(name) + '"';
}

/** The searches of one thesis sector: [category, topic, query]. */
function sectorQueries(label) {
  const w = bare(label).toLowerCase();
  return [
    ['policy', bare(label) + ' policy', w + ' regulation'],
    ['funding', bare(label) + ' funding', '"' + w + ' startup" funding'],
    ['sectors', bare(label), '"' + w + ' startup"'],
  ];
}

/** Kept for fix 3 callers: the sector search ("fintech startup"). */
function sectorQuery(label) {
  return '"' + bare(label).toLowerCase() + ' startup"';
}

/** The Bing News RSS URL of a query (US English, the last 30 days). */
function bingUrl(q) {
  return BING_SEARCH + '?q=' + encodeURIComponent(q) + '&format=rss&mkt=en-US&cc=US&setlang=en-US&qft=' + encodeURIComponent('interval="9"');
}

/** The Google News RSS URL of a query (US English edition, last 30 days). */
function googleUrl(q) {
  return GOOGLE_SEARCH + '?q=' + encodeURIComponent(q + ' when:30d') + '&hl=en-US&gl=US&ceid=US:en';
}

/** Kept for fix 3 callers. */
function searchUrl(q) {
  return googleUrl(q);
}

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (m, n) => String.fromCharCode(parseInt(n, 16)))
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

/** The element `<tag ...>inner</tag>` of an XML fragment: { attrs, text } or null (CDATA unwrapped). */
function element(xml, tag) {
  const s = String(xml || '');
  let at = 0;
  for (;;) {
    const i = s.indexOf('<' + tag, at);
    if (i < 0) return null;
    const c = s.charAt(i + tag.length + 1);
    if (c !== '>' && c !== ' ' && c !== '/' && c !== '\t' && c !== '\n' && c !== '\r') {
      at = i + 1;
      continue;
    }
    const end = s.indexOf('>', i);
    if (end < 0) return null;
    const head = s.slice(i + tag.length + 1, end);
    if (head.charAt(head.length - 1) === '/') return { attrs: head, text: '' };
    const close = s.indexOf('</' + tag + '>', end + 1);
    if (close < 0) return null;
    let inner = s.slice(end + 1, close).trim();
    if (inner.indexOf('<![CDATA[') === 0 && inner.slice(-3) === ']]>') inner = inner.slice(9, -3);
    else inner = unescapeXml(inner);
    return { attrs: head, text: inner.trim() };
  }
}

function attrOf(head, name) {
  const s = String(head || '');
  const key = name + '="';
  const k = s.indexOf(key);
  if (k < 0) return '';
  const v = s.indexOf('"', k + key.length);
  return unescapeXml(s.slice(k + key.length, v < 0 ? s.length : v));
}

/** Every `<item>...</item>` of an RSS document. */
function items(xml) {
  const s = String(xml || '');
  const out = [];
  let at = 0;
  for (;;) {
    const i = s.indexOf('<item>', at);
    if (i < 0) break;
    const j = s.indexOf('</item>', i);
    if (j < 0) break;
    out.push(s.slice(i + 6, j));
    at = j + 7;
  }
  return out;
}

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

/** An RSS pubDate (RFC 822: "Wed, 12 Nov 2026 14:05:00 GMT") as ISO UTC, or ''. */
function rfc822(s) {
  const m = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s*(GMT|UT|UTC|Z|[+-]\d{4})?$/.exec(String(s || '').trim());
  if (m === null) return '';
  const mon = MONTHS[m[2].toLowerCase()];
  if (mon === undefined) return '';
  let ms = Date.UTC(Number(m[3]), mon, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6] || 0));
  const z = m[7] || 'GMT';
  if (z.charAt(0) === '+' || z.charAt(0) === '-') {
    const off = (Number(z.slice(1, 3)) * 60 + Number(z.slice(3, 5))) * 60000;
    ms -= z.charAt(0) === '+' ? off : -off;
  }
  return new Date(ms).toISOString();
}

/** The value of one query parameter of a URL ('' when absent), decoded. */
function queryParam(url, name) {
  const s = String(url || '');
  const q = s.indexOf('?');
  if (q < 0) return '';
  for (const part of s.slice(q + 1).split('#')[0].split('&')) {
    const eq = part.indexOf('=');
    const k = eq < 0 ? part : part.slice(0, eq);
    if (k !== name) continue;
    try {
      return decodeURIComponent((eq < 0 ? '' : part.slice(eq + 1)).replace(/\+/g, ' '));
    } catch {
      return '';
    }
  }
  return '';
}

/** The host of an http(s) URL in lower case ('' when it is not one). */
function hostOf(url) {
  const m = /^https?:\/\/([^/?#:]+)/i.exec(String(url || '').trim());
  return m === null ? '' : m[1].toLowerCase();
}

/**
 * One row per article: the publisher's own link. Bing's click link
 * (www.bing.com/news/apiclick.aspx?...&url=<link>) carries it in its url
 * parameter; Google's article link loses its tracking parameter.
 */
function cleanLink(link) {
  const l = String(link || '').trim();
  if (hostOf(l) === 'www.bing.com' && /\/news\/apiclick\.aspx/i.test(l)) {
    const inner = queryParam(l, 'url');
    if (/^https?:\/\//i.test(inner)) return inner;
  }
  if (l.indexOf('https://news.google.com/') === 0) {
    const q = l.indexOf('?');
    return q < 0 ? l : l.slice(0, q);
  }
  return l;
}

/** The headline without the " - Publisher" Google appends when the publisher is that item's source. */
function cleanTitle(title, source) {
  const t = String(title || '').trim();
  const s = String(source || '').trim();
  if (s !== '' && t.length > s.length + 3 && t.slice(-(s.length + 3)) === ' - ' + s) return t.slice(0, -(s.length + 3)).trim();
  return t;
}

/** Publisher text without long dashes: a spaced one becomes a comma, a joining one a hyphen. */
function undash(s) {
  return String(s || '')
    .replace(/\s+[\u2013\u2014]\s+/g, ', ')
    .replace(/[\u2013\u2014]/g, '-');
}

/** HTML or markup in a description as plain text. */
function plain(s) {
  return unescapeXml(String(s || '').replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The picture an item carries, as the id of a Bing thumbnail ('' when none or
 * from any other host): <News:Image>, <media:content>, <media:thumbnail> or an
 * image <enclosure>. Only www.bing.com/th is ever downloaded.
 */
function imageOf(it) {
  const cands = [];
  const ni = element(it, 'News:Image');
  if (ni !== null) cands.push(ni.text);
  for (const tag of ['media:content', 'media:thumbnail']) {
    const m = element(it, tag);
    if (m !== null) cands.push(attrOf(m.attrs, 'url'));
  }
  const enc = element(it, 'enclosure');
  if (enc !== null && /^image\//i.test(attrOf(enc.attrs, 'type'))) cands.push(attrOf(enc.attrs, 'url'));
  for (const c of cands) {
    const url = String(c || '').trim();
    if (hostOf(url) !== IMAGE_HOST || !/^https?:\/\/[^/]+\/th\b/i.test(url)) continue;
    const id = queryParam(url, 'id');
    if (/^[A-Za-z0-9._-]{4,200}$/.test(id)) return id;
  }
  return '';
}

/** The download URL of a Bing thumbnail id (640 x 360, cropped to fit). */
function imageUrl(id) {
  return IMAGE_FETCH + '?id=' + encodeURIComponent(id) + '&pid=News&w=640&h=360&c=14';
}

/**
 * An RSS document (Bing News or Google News) -> [{ title, url, source,
 * source_url, published_at, snippet, image_id }], newest first.
 */
function parseRss(xml) {
  const out = [];
  const seen = {};
  for (const it of items(xml)) {
    const t = element(it, 'title');
    const l = element(it, 'link');
    const p = element(it, 'pubDate');
    const src = element(it, 'source');
    const bsrc = element(it, 'News:Source');
    const raw = src !== null ? src.text : bsrc !== null ? bsrc.text : '';
    // The publisher without stray separators the feed leaves around it ("- Disrupt Africa").
    const source = raw.replace(/^[\s\-|:]+|[\s\-|:]+$/g, '');
    const url = cleanLink(l !== null ? l.text : '');
    const title = cleanTitle(t !== null ? t.text : '', raw).replace(/[\s\-|:]+$/, '');
    if (!/^https?:\/\//i.test(url) || title === '' || seen[url] === true) continue;
    seen[url] = true;
    // Google's description repeats the headline as a link: only Bing's is the article's own lines.
    const d = bsrc !== null ? element(it, 'description') : null;
    out.push({
      title: title.slice(0, 500),
      url: url.slice(0, 2000),
      source: source.slice(0, 200),
      source_url: src !== null ? attrOf(src.attrs, 'url').slice(0, 500) : '',
      published_at: rfc822(p !== null ? p.text : ''),
      snippet: d !== null ? plain(d.text).slice(0, 600) : '',
      image_id: imageOf(it),
    });
  }
  out.sort((a, b) => (a.published_at < b.published_at ? 1 : a.published_at > b.published_at ? -1 : 0));
  return out;
}

/* ------------------------------------------------------------ queries */

/** The thesis sectors: [{ key, label, thesis, thesis_name }] (first thesis that names a sector keeps it). */
function sectorsOf(app) {
  const util = u();
  const out = [];
  const seen = {};
  for (const t of app.findRecordsByFilter('theses', "status = 'active'", 'sort,name', 0, 0)) {
    for (const c of util.jsonOf(t, 'criteria', []) || []) {
      if (c.key !== 'sector' || !Array.isArray(c.values)) continue;
      for (const v of c.values) {
        const key = String(v || '').trim().toLowerCase();
        if (key === '' || seen[key] === true) continue;
        seen[key] = true;
        out.push({ key: key, label: sectorLabel(key), thesis: t.id, thesis_name: t.getString('name') });
      }
    }
  }
  return out;
}

/** Portfolio companies (an active holding) and late-stage pipeline companies: [{ id, name, sector, why }]. */
function companiesOf(app) {
  const util = u();
  const out = [];
  const seen = {};
  const add = (r, why) => {
    if (r.id === '' || r.name === '' || seen[r.id] === true) return;
    seen[r.id] = true;
    out.push({ id: r.id, name: r.name, sector: String(r.sector || '').trim().toLowerCase(), why: why });
  };
  const shape = { id: '', name: '', sector: '' };
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, c.sector AS sector FROM holdings h JOIN companies c ON c.id = h.company WHERE h.deleted_at = '' AND h.status = 'active' AND c.deleted_at = '' AND c.merged_into = '' ORDER BY c.name", shape)) add(r, 'portfolio');
  const marks = LATE_STAGES.map((s) => "'" + s + "'").join(', ');
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, c.sector AS sector FROM deals d JOIN pipelines p ON p.id = d.pipeline JOIN companies c ON c.id = d.company WHERE p.kind = 'deal_flow' AND d.deleted_at = '' AND d.status IN ('open', 'hold') AND d.stage IN (" + marks + ") AND c.deleted_at = '' AND c.merged_into = '' ORDER BY c.name", shape)) add(r, 'pipeline');
  for (const r of util.rows(app, "SELECT DISTINCT c.id AS id, c.name AS name, c.sector AS sector FROM map_entries e JOIN maps m ON m.id = e.map JOIN companies c ON c.id = e.company WHERE m.status = 'active' AND e.status = 'active' AND e.role = 'competitor' AND c.deleted_at = '' AND c.merged_into = '' ORDER BY c.name", shape)) add(r, 'competitors');
  return out;
}

/**
 * What one pull searches, most specific first: [{ category, kind, id, key,
 * name, topic, sector, q, per }]. Demo firms: macro, funding and sectors.
 */
function queriesOf(app) {
  const out = [];
  const demo = L('lib_mail').demo(app);
  const sectors = sectorsOf(app);
  if (!demo) for (const c of companiesOf(app)) out.push({ category: c.why, kind: 'company', id: c.id, key: '', name: c.name, topic: c.name, sector: c.sector, q: companyQuery(c.name), per: PER_COMPANY });
  const bySector = sectors.map((s) => ({ s: s, qs: sectorQueries(s.label) }));
  const order = ['policy', 'exits', 'funding', 'macro', 'sectors'];
  for (const cat of order) {
    if (demo && DEMO_CATEGORIES.indexOf(cat) < 0) continue;
    for (const x of bySector)
      for (const q of x.qs) if (q[0] === cat) out.push({ category: cat, kind: 'sector', id: x.s.thesis, key: x.s.key, name: x.s.label, topic: q[1], sector: x.s.key, q: q[2], per: PER_QUERY });
    for (const m of MARKET_QUERIES) if (m[0] === cat) out.push({ category: cat, kind: 'market', id: '', key: '', name: m[1], topic: m[1], sector: '', q: m[2], per: PER_QUERY });
  }
  return out;
}

/* -------------------------------------------------------------- store */

function cutoffIso(days) {
  return new Date(Date.now() - (days || KEEP_DAYS) * 86400000).toISOString();
}

/** Store one article unless its url is known or it is older than 60 days: the record or null. */
function storeOne(app, it, q, origin, ctx) {
  const util = u();
  if (it.published_at !== '' && it.published_at < cutoffIso(it.round ? ROUND_KEEP_DAYS : KEEP_DAYS)) return null;
  if (util.findOne(app, 'news', 'url = {:u}', { u: it.url }) !== null) return null;
  const rec = util.newRecord(app, 'news');
  rec.set('title', util.clip(util.squash(undash(it.title)), 500));
  rec.set('url', it.url);
  rec.set('source', util.clip(util.squash(undash(it.source || '')), 200));
  rec.set('source_url', util.clip(it.source_url || '', 500));
  rec.set('published_at', it.published_at || util.nowIso());
  rec.set('summary', util.clip(util.squash(it.summary || ''), 400));
  if (it.summary) rec.set('summarized_at', util.nowIso());
  rec.set('snippet', util.clip(util.squash(undash(it.snippet || '')), 600));
  rec.set('category', q.category);
  rec.set('sector', util.clip(q.sector || '', 60));
  rec.set('topic', util.clip(q.topic || q.name || '', 120));
  rec.set('about_kind', q.kind);
  rec.set('about_id', q.id || '');
  rec.set('about_key', q.key || '');
  rec.set('about_name', util.clip(q.name || '', 200));
  rec.set('query', util.clip(q.q || '', 300));
  rec.set('origin', origin);
  rec.set('feed', it.feed || (origin === 'person' ? 'person' : ''));
  rec.set('fetched_at', util.nowIso());
  rec.set('licence', 'public');
  rec.set('hidden', false);
  if (it.round) {
    rec.set('round_company', util.clip(it.round.company || '', 200));
    if (it.round.amount_usd !== null && it.round.amount_usd !== undefined) rec.set('round_amount_usd', it.round.amount_usd);
    rec.set('round_stage', util.clip(it.round.stage || '', 40));
  }
  L('lib_records').stampWritten(ctx, rec);
  try {
    app.save(rec);
  } catch (err) {
    // Another pull stored the same article first.
    if (String((err && err.message) || err).toLowerCase().indexOf('unique') >= 0) return null;
    throw err;
  }
  return rec;
}

/** GET a feed: { status, text } ({ status: 0 } when the host did not answer). */
function fetchFeed(url) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: TIMEOUT, headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0 (compatible; VentureOS news reader)' } });
    return { status: res.statusCode, text: res.statusCode === 200 ? toString(res.body) : '' };
  } catch (err) {
    console.log('[vo] news search failed: ' + url + ' ' + err);
    return { status: 0, text: '' };
  }
}

/** One query: Bing News, else Google News. { ok, items } with each item's feed. */
function search(q) {
  const b = fetchFeed(bingUrl(q.q));
  if (b.status === 200) {
    const list = parseRss(b.text);
    if (list.length > 0) return { ok: true, items: list.map((x) => Object.assign(x, { feed: 'bing' })) };
  }
  sleep(PACE_MS);
  const g = fetchFeed(googleUrl(q.q));
  if (g.status !== 200) return { ok: b.status === 200, items: [] };
  return { ok: true, items: parseRss(g.text).map((x) => Object.assign(x, { feed: 'google' })) };
}

/** The extension of an image content type ('' when it is not one we keep). */
function imageExt(type) {
  const t = String(type || '').toLowerCase();
  if (t.indexOf('image/jpeg') === 0 || t.indexOf('image/jpg') === 0) return 'jpg';
  if (t.indexOf('image/png') === 0) return 'png';
  if (t.indexOf('image/webp') === 0) return 'webp';
  if (t.indexOf('image/gif') === 0) return 'gif';
  return '';
}

/** Download a Bing thumbnail and store it on the item: true when stored. */
function fetchImage(app, rec, imageId) {
  const url = imageUrl(imageId);
  if (hostOf(url) !== IMAGE_HOST) return false;
  let res;
  try {
    res = $http.send({ url: url, method: 'GET', timeout: IMAGE_TIMEOUT, headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0 (compatible; VentureOS news reader)' } });
  } catch (err) {
    console.log('[vo] news image failed: ' + url + ' ' + err);
    return false;
  }
  if (res.statusCode !== 200) return false;
  const ext = imageExt(((res.headers || {})['Content-Type'] || [])[0]);
  const size = res.body ? res.body.length : 0;
  if (ext === '' || size < 800 || size > IMAGE_MAX_BYTES) return false;
  rec.set('image', $filesystem.fileFromBytes(res.body, 'news-' + rec.id + '.' + ext));
  rec.set('image_source', url);
  rec.set('image_by', 'feed');
  app.save(rec);
  return true;
}

/** Pull every query once: { queries, added, images, errors } (articles stored as they come; one search at a time, paced). */
function pullAll(app) {
  const ctx = L('lib_auth').systemCtx(app);
  const qs = queriesOf(app);
  let added = 0;
  let images = 0;
  let errors = 0;
  qs.forEach((q, i) => {
    if (i > 0) sleep(PACE_MS);
    const res = search(q);
    if (!res.ok) {
      errors++;
      return;
    }
    for (const it of res.items.slice(0, q.per)) {
      const rec = storeOne(app, it, q, 'pull', ctx);
      if (rec === null) continue;
      added++;
      if (it.image_id !== '' && images < IMAGES_PER_PULL) {
        try {
          if (fetchImage(app, rec, it.image_id)) images++;
        } catch (err) {
          console.log('[vo] news image not stored: ' + err);
        }
      }
    }
  });
  app.store().set(STORE_CHECKED, u().nowIso());
  if (added > 0) L('lib_bus').touch('news');
  return { queries: qs.length, added: added, images: images, errors: errors };
}

/* --------------------------------------------------------------- views */

/** The app's own URL of an item's picture (no sign-in header needed), or null. */
function imageUrlOf(r) {
  const f = r.getString('image');
  if (f === '') return null;
  return '/api/ops/news/image?id=' + r.id + '&v=' + encodeURIComponent(f.slice(-14, -4).replace(/[^A-Za-z0-9]/g, '') || '1');
}

function rowOut(r, extra) {
  const x = extra || {};
  const amount = r.getInt('round_amount_usd');
  return {
    id: r.id,
    title: undash(r.getString('title')),
    url: r.getString('url'),
    source: undash(r.getString('source')),
    published_at: r.getString('published_at'),
    image_url: imageUrlOf(r),
    category: r.getString('category'),
    category_label: CATEGORY_LABELS[r.getString('category')] || '',
    about: { kind: r.getString('about_kind'), id: r.getString('about_id'), name: r.getString('about_name') },
    summary: r.getString('summary'),
    snippet: undash(r.getString('snippet')),
    topic: r.getString('topic'),
    sector: r.getString('sector'),
    insight_ids: x.insights ? x.insights[r.id] || [] : [],
    saved: x.saved ? x.saved[r.id] === true : false,
    round: r.getString('round_company') !== '' ? { company: r.getString('round_company'), amount_usd: amount > 0 ? amount : null, stage: r.getString('round_stage') } : null,
  };
}

/** When the news was last checked (this run of the app, else the newest pull). */
function checkedAt(app) {
  const s = app.store().get(STORE_CHECKED);
  if (typeof s === 'string' && s !== '') return s;
  const r = u().one(app, "SELECT COALESCE(MAX(fetched_at), '') AS at FROM news WHERE origin = 'pull'", { at: '' });
  return r !== null ? r.at || '' : '';
}

/** May ctx see news about this company? (a scout sees none; a pipeline company only through a deal ctx may see). */
function companyVisible(ctx, companyId, cache) {
  if (cache[companyId] !== undefined) return cache[companyId];
  const util = u();
  const app = ctx.app;
  let ok = true;
  if (ctx.ownOnly) ok = false;
  else if (ctx.actor !== 'system') {
    const deals = util.rows(app, "SELECT id FROM deals WHERE company = {:c} AND deleted_at = ''", { id: '' }, { c: companyId });
    if (deals.length > 0) {
      const A = L('lib_auth');
      ok = deals.some((d) => A.dealVisible(ctx, d.id));
      if (!ok) ok = (L('lib_portfolio').holdingsFor(ctx, { company: companyId }) || []).length > 0;
    }
  }
  cache[companyId] = ok;
  return ok;
}

/** A sector key a param names ('Fintech' or 'fintech' -> 'fintech'). */
function sectorKey(ref) {
  return String(ref || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_');
}

/** The SQL condition of a scope: { sql, bind }. */
function scopeWhere(ctx, scope, ref) {
  const util = u();
  const app = ctx.app;
  if (scope === 'home' || scope === 'all') return { sql: 'hidden = FALSE', bind: {} };
  if (ref === '') throw util.fail(400, 'ref is required for scope ' + scope + ' (' + (scope === 'thesis' ? 'a thesis id or name' : scope === 'sector' ? 'a sector key, e.g. fintech' : 'a company id, domain or exact name') + ').', 'missing_param', { param: 'ref' });
  if (scope === 'company') {
    const c = L('lib_records').resolve(app, 'companies', ref);
    return { sql: "hidden = FALSE AND about_kind = 'company' AND about_id = {:c}", bind: { c: c.id } };
  }
  if (scope === 'sector') return { sql: 'hidden = FALSE AND sector = {:sk}', bind: { sk: sectorKey(ref) } };
  const t = L('lib_theses').thesisRef(app, ref);
  const keys = [];
  for (const c of util.jsonOf(t, 'criteria', []) || []) if (c.key === 'sector' && Array.isArray(c.values)) for (const v of c.values) keys.push(String(v || '').trim().toLowerCase());
  const bind = { t: t.id };
  const keyMarks = keys.map((k, i) => {
    bind['k' + i] = k;
    return '{:k' + i + '}';
  });
  // Companies of the thesis: on its maps, found by its radar, or in one of its sectors.
  const companies = {};
  for (const r of util.rows(app, "SELECT DISTINCT e.company AS id FROM map_entries e JOIN maps m ON m.id = e.map WHERE m.thesis = {:t} AND m.status = 'active' AND e.status = 'active'", { id: '' }, { t: t.id })) companies[r.id] = true;
  for (const r of util.rows(app, "SELECT DISTINCT company AS id FROM signals WHERE thesis = {:t} AND company != '' AND status IN ('candidate', 'added', 'known')", { id: '' }, { t: t.id })) companies[r.id] = true;
  const ids = Object.keys(companies).slice(0, 400);
  const idMarks = ids.map((id, i) => {
    bind['c' + i] = id;
    return '{:c' + i + '}';
  });
  const ors = ["(about_kind = 'thesis' AND about_id = {:t})"];
  if (keyMarks.length > 0) ors.push('sector IN (' + keyMarks.join(', ') + ')');
  if (idMarks.length > 0) ors.push("(about_kind = 'company' AND about_id IN (" + idMarks.join(', ') + '))');
  return { sql: 'hidden = FALSE AND (' + ors.join(' OR ') + ')', bind: bind };
}

/** A day param (YYYY-MM-DD) or ''. */
function dayParam(p, name) {
  const util = u();
  const v = util.str(p, name, '');
  if (v === '') return '';
  if (!util.isDay(v)) throw util.fail(400, name + ' is a day, YYYY-MM-DD.', 'invalid_param', { param: name });
  return v;
}

/**
 * The filters every news read takes (scope, ref, category, sector, company,
 * from, to, q, saved): { sql, bind }. `skip` leaves one filter out (the
 * counts of the category tabs ignore the category).
 */
function filterWhere(ctx, p, skip) {
  const util = u();
  const app = ctx.app;
  const scope = util.oneOf(p, 'scope', SCOPES, 'home');
  const w = scopeWhere(ctx, scope, util.str(p, 'ref', ''));
  const parts = [w.sql];
  const bind = Object.assign({}, w.bind);
  const cat = util.oneOf(p, 'category', CATEGORIES.concat(['all']), 'all');
  if (cat !== 'all' && skip !== 'category') {
    parts.push('category = {:cat}');
    bind.cat = cat;
  }
  const sector = sectorKey(util.str(p, 'sector', ''));
  if (sector !== '' && skip !== 'sector') {
    parts.push('sector = {:fsec}');
    bind.fsec = sector;
  }
  const company = util.str(p, 'company', '');
  if (company !== '' && skip !== 'company') {
    const c = L('lib_records').resolve(app, 'companies', company);
    parts.push("about_kind = 'company' AND about_id = {:fco}");
    bind.fco = c.id;
  }
  const from = dayParam(p, 'from');
  if (from !== '') {
    parts.push('published_at >= {:from}');
    bind.from = from + 'T00:00:00.000Z';
  }
  const to = dayParam(p, 'to');
  if (to !== '') {
    parts.push('published_at < {:to}');
    bind.to = new Date(Date.parse(to + 'T00:00:00Z') + 86400000).toISOString();
  }
  const q = util.squash(util.text(p, 'q', 200, ''));
  if (q !== '') {
    q.split(' ')
      .slice(0, 6)
      .forEach((word, i) => {
        parts.push('(title LIKE {:q' + i + '} OR source LIKE {:q' + i + '} OR summary LIKE {:q' + i + '} OR topic LIKE {:q' + i + '})');
        bind['q' + i] = '%' + word.replace(/[%_]/g, '') + '%';
      });
  }
  if (util.bool(p, 'saved', false)) {
    parts.push('id IN (SELECT news FROM news_saves WHERE member = {:me})');
    bind.me = ctx.memberId || '-';
  }
  if (util.bool(p, 'unsummarized', false)) {
    // What a digest picks from: found in the last 3 days, without a summary yet.
    parts.push("summary = '' AND fetched_at > {:dig}");
    bind.dig = new Date(Date.now() - 3 * 86400000).toISOString();
  }
  return { sql: parts.join(' AND '), bind: bind, scope: scope };
}

/** The ids of active insights that cite each item: { newsId: [insightId] }. */
function insightsByNews(app) {
  const util = u();
  const out = {};
  for (const r of util.rows(app, "SELECT id, news_ids FROM news_insights WHERE status = 'active' ORDER BY created DESC LIMIT 400", { id: '', news_ids: '' })) {
    let ids = [];
    try {
      ids = JSON.parse(r.news_ids || '[]') || [];
    } catch {
      ids = [];
    }
    for (const n of ids) {
      if (out[n] === undefined) out[n] = [];
      out[n].push(r.id);
    }
  }
  return out;
}

/** The items the caller saved among ids: { newsId: true }. */
function savedOf(ctx, ids) {
  const out = {};
  if (!ctx.memberId || ids.length === 0) return out;
  const bind = { me: ctx.memberId };
  const marks = ids.map((id, i) => {
    bind['n' + i] = id;
    return '{:n' + i + '}';
  });
  for (const r of u().rows(ctx.app, 'SELECT news FROM news_saves WHERE member = {:me} AND news IN (' + marks.join(', ') + ')', { news: '' }, bind)) out[r.news] = true;
  return out;
}

/** Rows of a filter the caller may see, ordered: [{ id, about_kind, about_id }]. */
function visibleIds(ctx, w, order) {
  const util = u();
  const bind = Object.assign({ recent: new Date(Date.now() - FIRST_DAYS * 86400000).toISOString() }, w.bind);
  const ids = util.rows(ctx.app, 'SELECT id, about_kind, about_id FROM news WHERE ' + w.sql + ' ORDER BY ' + order + ' LIMIT ' + LIST_SCAN, { id: '', about_kind: '', about_id: '' }, bind);
  const cache = {};
  return ids.filter((r) => r.about_kind !== 'company' || companyVisible(ctx, r.about_id, cache));
}

/* ----------------------------------------------------------------- ops */

/**
 * news.list: the news of a scope with the dashboard's filters; never pulls.
 * Home puts what matters most first (items of the last 7 days about the
 * firm's companies or summarized by your AI agent), then newest first;
 * every other scope is newest first. Paged by cursor.
 */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const limit = util.int(p, 'limit', 12, 1, 60);
  const cursor = util.str(p, 'cursor', '');
  if (cursor !== '' && !/^\d{1,5}$/.test(cursor)) throw util.fail(400, 'cursor is the next_cursor of the previous answer.', 'invalid_param', { param: 'cursor' });
  const offset = cursor === '' ? 0 : Number(cursor);
  const w = filterWhere(ctx, p, '');
  const order = w.scope === 'home' ? "CASE WHEN (about_kind = 'company' OR summary != '') AND published_at >= {:recent} THEN 0 ELSE 1 END, published_at DESC, id" : 'published_at DESC, id';
  const shown = visibleIds(ctx, w, order);
  const page = shown.slice(offset, offset + limit).map((r) => app.findRecordById('news', r.id));
  const extra = { insights: insightsByNews(app), saved: savedOf(ctx, page.map((r) => r.id)) };
  const next = offset + limit < shown.length ? String(offset + limit) : null;
  return { items: page.map((r) => rowOut(r, extra)), total: shown.length, next_cursor: next, checked_at: checkedAt(app) };
}

/** Count rows of visible ids by a column: [{ key, n }] (most first). */
function tally(app, ids, column, limit) {
  const util = u();
  if (ids.length === 0) return [];
  const out = [];
  for (let i = 0; i < ids.length; i += 300) {
    const bind = {};
    const marks = ids.slice(i, i + 300).map((id, j) => {
      bind['i' + j] = id;
      return '{:i' + j + '}';
    });
    for (const r of util.rows(app, 'SELECT ' + column + ' AS k, COUNT(*) AS n FROM news WHERE id IN (' + marks.join(', ') + ') GROUP BY ' + column, { k: '', n: 0 }, bind)) out.push(r);
  }
  const merged = {};
  for (const r of out) merged[r.k] = (merged[r.k] || 0) + r.n;
  return Object.keys(merged)
    .filter((k) => k !== '')
    .map((k) => ({ key: k, n: merged[k] }))
    .sort((a, b) => b.n - a.n || (a.key < b.key ? -1 : 1))
    .slice(0, limit || 50);
}

/**
 * news.stats: what the dashboard shows beside the stories, for the same
 * filters as news.list: items per category (the tabs), trending topics
 * (items per topic published in the last 7 days), sources, sectors and
 * companies with news (the filters).
 */
function opStats(ctx, p) {
  const app = ctx.app;
  const all = visibleIds(ctx, filterWhere(ctx, p, 'category'), 'published_at DESC, id').map((r) => r.id);
  const scoped = visibleIds(ctx, filterWhere(ctx, p, ''), 'published_at DESC, id').map((r) => r.id);
  const cats = {};
  for (const r of tally(app, all, 'category', 20)) cats[r.key] = r.n;
  const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString();
  const util = u();
  const week = [];
  for (let i = 0; i < scoped.length; i += 300) {
    const bind = { w: weekAgo };
    const marks = scoped.slice(i, i + 300).map((id, j) => {
      bind['i' + j] = id;
      return '{:i' + j + '}';
    });
    for (const r of util.rows(app, 'SELECT id FROM news WHERE published_at >= {:w} AND id IN (' + marks.join(', ') + ')', { id: '' }, bind)) week.push(r.id);
  }
  const sectorNames = {};
  for (const s of sectorsOf(app)) sectorNames[s.key] = s.label;
  const companies = [];
  const co = tally(app, scoped, "CASE WHEN about_kind = 'company' THEN about_id ELSE '' END", 30);
  for (const r of co) {
    const c = util.byId(app, 'companies', r.key);
    if (c !== null) companies.push({ id: c.id, name: c.getString('name'), count: r.n });
  }
  const feeds = tally(app, scoped, 'feed', 5).map((r) => ({ key: r.key, label: r.key === 'bing' ? 'Bing News' : r.key === 'google' ? 'Google News' : 'Added by your team', count: r.n }));
  return {
    total: scoped.length,
    categories: CATEGORIES.map((k) => ({ key: k, label: CATEGORY_LABELS[k], count: cats[k] || 0 })),
    topics: tally(app, week, 'topic', 8).map((r) => ({ topic: r.key, count: r.n })),
    week_total: week.length,
    sources: tally(app, scoped, 'source', 8).map((r) => ({ source: r.key, count: r.n })),
    feeds: feeds,
    sectors: tally(app, scoped, 'sector', 20).map((r) => ({ key: r.key, label: sectorNames[r.key] || sectorLabel(r.key), count: r.n })),
    companies: companies,
    checked_at: checkedAt(app),
  };
}

/** news.refresh: pull now (refused within 2 minutes of the last refresh). */
function opRefresh(ctx) {
  const util = u();
  const app = ctx.app;
  const last = Number(app.store().get(STORE_REFRESH) || 0);
  if (Date.now() - last < REFRESH_GAP_MS) throw util.fail(409, 'The news was refreshed less than 2 minutes ago; news.list has it.', 'too_soon');
  app.store().set(STORE_REFRESH, Date.now());
  const res = pullAll(app);
  L('lib_audit').note(ctx, { collection: 'news', record: '', summary: 'Refreshed the news (' + res.added + ' new)' });
  return { queries: res.queries, added: res.added, images: res.images, errors: res.errors, checked_at: checkedAt(app) };
}

function newsRef(app, id) {
  const r = u().byId(app, 'news', String(id || ''));
  if (r === null) throw u().fail(404, 'No news item ' + id + '. Run news.list.', 'not_found', { ref: id });
  return r;
}

/** A funding round as given ({ company, amount_usd, stage }): checked, or null when absent. */
function roundOf(raw, where) {
  const util = u();
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw util.fail(400, where + ': round is {"company","amount_usd","stage"}.', 'invalid_param', { param: 'round' });
  util.keysOnly(raw, ['company', 'amount_usd', 'stage'], where + ' round');
  const company = util.squash(String(raw.company || ''));
  if (company === '' || company.length > 200) throw util.fail(400, where + ': round.company is the company that raised (1 to 200 characters).', 'invalid_param', { param: 'round' });
  let amount = null;
  if (raw.amount_usd !== undefined && raw.amount_usd !== null && raw.amount_usd !== '') {
    amount = Number(raw.amount_usd);
    if (!Number.isFinite(amount) || amount < 0 || amount > 1e12 || Math.round(amount) !== amount) throw util.fail(400, where + ': round.amount_usd is whole US dollars as the article states them.', 'invalid_param', { param: 'round' });
  }
  const stage = util.squash(String(raw.stage || ''));
  if (stage.length > 40) throw util.fail(400, where + ': round.stage is a short word (Seed, Series A).', 'invalid_param', { param: 'round' });
  return { company: company, amount_usd: amount, stage: stage };
}

/** news.summarize: your AI agent's one sentence for each item that matters, with the round a funding item reports (it never adds news). */
function opSummarize(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent writes these summaries.', 'agent_only');
  const raw = util.list(p, 'items');
  if (raw === undefined || raw.length === 0) throw util.fail(400, 'items is a JSON list [{"id":"...","summary":"one sentence"}].', 'missing_param', { param: 'items' });
  if (raw.length > DIGEST_MAX) throw util.fail(400, 'At most ' + DIGEST_MAX + ' at once.', 'too_many');
  const done = [];
  raw.forEach((x, i) => {
    const where = 'Item ' + (i + 1);
    if (x === null || typeof x !== 'object' || Array.isArray(x)) throw util.fail(400, where + ' must be an object.', 'invalid_param', { param: 'items' });
    util.keysOnly(x, ['id', 'summary', 'round'], where);
    const r = newsRef(app, x.id);
    const s = util.squash(String(x.summary || ''));
    if (s === '' || s.length > 240) throw util.fail(400, where + ': summary is one sentence of 1 to 240 characters.', 'invalid_param', { param: 'items' });
    const round = roundOf(x.round, where);
    if (round !== null && r.getString('category') !== 'funding') throw util.fail(400, where + ': a round goes only on a Funding item.', 'invalid_param', { param: 'items' });
    r.set('summary', s);
    r.set('summarized_at', util.nowIso());
    if (round !== null) {
      r.set('round_company', round.company);
      r.set('round_amount_usd', round.amount_usd === null ? 0 : round.amount_usd);
      r.set('round_stage', round.stage);
    }
    app.save(r);
    done.push(r.id);
  });
  if (ctx.isAgent) L('lib_agent').landed(app, 'news_digest', L('lib_settings').row(app));
  L('lib_audit').note(ctx, { collection: 'news', record: done.length === 1 ? done[0] : '', summary: 'Summarized ' + done.length + ' news ' + (done.length === 1 ? 'item' : 'items') });
  return { summarized: done.length, items: done };
}

/** news.hide: a person takes an item out of every news list (--hidden false brings it back). */
function opHide(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = newsRef(app, util.req(p, 'id'));
  const hide = util.bool(p, 'hidden', true);
  r.set('hidden', hide);
  r.set('hidden_at', hide ? util.nowIso() : '');
  r.set('hidden_by', hide ? ctx.memberId || '' : '');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'news', record: r.id, summary: (hide ? 'Hid the news item ' : 'Showed the news item ') + r.getString('title') });
  return { item: rowOut(r), hidden: hide };
}

/** news.save: a person keeps an item in their Saved view (--saved false takes it out). */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = newsRef(app, util.req(p, 'id'));
  const keep = util.bool(p, 'saved', true);
  if (!ctx.memberId) throw util.fail(403, 'Only people save news.', 'not_permitted');
  const had = util.findOne(app, 'news_saves', 'news = {:n} && member = {:m}', { n: r.id, m: ctx.memberId });
  if (keep && had === null) {
    const s = util.newRecord(app, 'news_saves');
    s.set('news', r.id);
    s.set('member', ctx.memberId);
    app.save(s);
  } else if (!keep && had !== null) app.delete(had);
  L('lib_audit').note(ctx, { collection: 'news', record: r.id, summary: (keep ? 'Saved the news item ' : 'Took out of Saved: ') + r.getString('title') });
  return { id: r.id, saved: keep };
}

/** news.image: an item's picture, served by the app (public: an <img> sends no sign-in header; the id is unguessable). */
function opImage(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = util.byId(app, 'news', util.str(p, 'id', ''));
  if (r === null || r.getString('image') === '') throw util.fail(404, 'No picture.', 'not_found');
  const stored = r.getString('image');
  const ext = (/\.([a-z0-9]+)$/i.exec(stored) || ['', 'jpg'])[1].toLowerCase();
  const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : 'image/jpeg';
  if (ctx.isAgent || ctx.e === null || ctx.e === undefined) return { path: $filepath.join(app.dataDir(), 'storage', r.baseFilesPath(), stored), mime: mime };
  const fsys = app.newFilesystem();
  try {
    const reader = fsys.getReader(r.baseFilesPath() + '/' + stored);
    try {
      ctx.e.response.header().set('Cache-Control', 'public, max-age=2592000, immutable');
      ctx.e.response.header().set('X-Content-Type-Options', 'nosniff');
      ctx.e.response.header().set('Content-Security-Policy', "default-src 'none'; sandbox");
      ctx.e.stream(200, mime, reader);
    } finally {
      reader.close();
    }
  } finally {
    fsys.close();
  }
  return { __streamed: true };
}

/** news.set-image: your AI agent adds the lead picture it found for an item (--paths with one local file, --source_url where it was found). */
function opSetImage(ctx, p) {
  const util = u();
  const app = ctx.app;
  if (!ctx.isAgent) throw util.fail(403, 'Your AI agent adds pictures it found; people see the ones the news carries.', 'agent_only');
  const r = newsRef(app, util.req(p, 'id'));
  const src = util.text(p, 'source_url', 1000, '');
  if (!/^https?:\/\//i.test(src)) throw util.fail(400, 'source_url is required: the page where the picture appears (the article).', 'missing_param', { param: 'source_url' });
  const paths = util.list(p, 'paths');
  if (paths === undefined || paths.length !== 1) throw util.fail(400, 'paths is a JSON list with one absolute path of the picture, e.g. ["C:/tmp/lead.jpg"].', 'missing_param', { param: 'paths' });
  const path = String(paths[0] || '');
  const ext = (/\.([a-z0-9]+)$/i.exec(path) || ['', ''])[1].toLowerCase();
  if (['jpg', 'jpeg', 'png', 'webp', 'gif'].indexOf(ext) < 0) throw util.fail(400, 'The picture is a .jpg, .png, .webp or .gif file.', 'invalid_param', { param: 'paths' });
  // Checked as every path your AI agent gives (absolute, a file, never inside the app's own folder).
  L('lib_files').localFile(ctx, path, 'paths');
  const bytes = $os.readFile($filepath.clean(path));
  if (bytes.length > IMAGE_MAX_BYTES) throw util.fail(400, 'The picture is larger than 3 MB.', 'invalid_param', { param: 'paths' });
  if (bytes.length < 200) throw util.fail(400, 'The file is too small to be a picture.', 'invalid_param', { param: 'paths' });
  r.set('image', $filesystem.fileFromBytes(bytes, 'news-' + r.id + '.' + (ext === 'jpeg' ? 'jpg' : ext)));
  r.set('image_source', src);
  r.set('image_by', 'agent');
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'news', record: r.id, summary: 'Added a picture to the news item ' + r.getString('title') });
  return { item: rowOut(app.findRecordById('news', r.id)) };
}

/** The category of an item about a company, from the firm's records (structure): holding, competitor tile, deal or map tile. */
function companyCategory(app, companyId) {
  const util = u();
  if (util.count(app, "SELECT COUNT(*) AS n FROM holdings WHERE company = {:c} AND deleted_at = '' AND status = 'active'", { c: companyId }) > 0) return 'portfolio';
  if (util.count(app, "SELECT COUNT(*) AS n FROM map_entries e JOIN maps m ON m.id = e.map WHERE e.company = {:c} AND e.status = 'active' AND e.role = 'competitor' AND m.status = 'active'", { c: companyId }) > 0) return 'competitors';
  if (util.count(app, "SELECT COUNT(*) AS n FROM deals WHERE company = {:c} AND deleted_at = ''", { c: companyId }) > 0) return 'pipeline';
  if (util.count(app, "SELECT COUNT(*) AS n FROM map_entries WHERE company = {:c} AND status = 'active'", { c: companyId }) > 0) return 'pipeline';
  return '';
}

/** What an added item is about: a company, a thesis, a sector or the market. */
function aboutOf(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'about_kind', KINDS, '');
  const ref = util.str(p, 'about', '');
  if (kind === '' || ref === '') throw util.fail(400, 'Give --about_kind (company, sector, thesis or market) and --about (a company id, domain or name; a sector key; a thesis id or name; a market topic such as "IPO market").', 'missing_param', { param: kind === '' ? 'about_kind' : 'about' });
  if (kind === 'company') {
    const c = L('lib_records').resolve(app, 'companies', ref);
    return { kind: kind, id: c.id, key: '', name: c.getString('name'), sector: String(c.getString('sector') || '').trim().toLowerCase(), category: companyCategory(app, c.id) };
  }
  if (kind === 'thesis') {
    const t = L('lib_theses').thesisRef(app, ref);
    return { kind: kind, id: t.id, key: '', name: t.getString('name'), sector: '', category: 'sectors' };
  }
  if (kind === 'market') return { kind: kind, id: '', key: '', name: util.clip(util.squash(ref), 120), sector: '', category: '' };
  const key = sectorKey(ref);
  const s = sectorsOf(app).filter((x) => x.key === key)[0];
  return { kind: kind, id: s ? s.thesis : '', key: key, name: sectorLabel(key), sector: key, category: 'sectors' };
}

/** news.add: a person (or the demo seed) adds an article by hand. */
function opAdd(ctx, p) {
  const util = u();
  const app = ctx.app;
  const title = util.squash(util.text(p, 'title', 500, ''));
  if (title === '') throw util.fail(400, 'title is required: the headline.', 'missing_param', { param: 'title' });
  const url = util.text(p, 'url', 2000, '');
  if (!/^https?:\/\//i.test(url)) throw util.fail(400, 'url is required: the link to the article.', 'missing_param', { param: 'url' });
  let published = util.str(p, 'published_at', '');
  if (published === '') published = util.nowIso();
  else if (util.isDay(published)) published = published + 'T12:00:00.000Z';
  else {
    const ms = Date.parse(published);
    if (!Number.isFinite(ms)) throw util.fail(400, 'published_at is ISO time or a day YYYY-MM-DD.', 'invalid_param', { param: 'published_at' });
    published = new Date(ms).toISOString();
  }
  const about = aboutOf(ctx, p);
  const category = util.oneOf(p, 'category', CATEGORIES, about.category);
  if (category === '') throw util.fail(400, 'Give --category (' + CATEGORIES.join(', ') + '): ' + (about.kind === 'market' ? 'a market item has no company to place it by.' : about.name + ' is not in the portfolio, the pipeline or a market map.'), 'missing_param', { param: 'category' });
  const sector = sectorKey(util.str(p, 'sector', '')) || about.sector;
  let round = null;
  const rc = util.squash(util.text(p, 'round_company', 200, ''));
  if (rc !== '') {
    if (category !== 'funding') throw util.fail(400, 'A round goes only on a Funding item (--category funding).', 'invalid_param', { param: 'round_company' });
    round = { company: rc, amount_usd: util.num(p, 'round_amount_usd', { whole: true, min: 0, max: 1e12 }), stage: util.text(p, 'round_stage', 40, '') };
  }
  const it = { title: title, url: cleanLink(url), source: util.text(p, 'source', 200, ''), source_url: '', published_at: published, summary: util.text(p, 'summary', 240, ''), snippet: util.text(p, 'snippet', 600, ''), feed: 'person', round: round };
  const dup = util.findOne(app, 'news', 'url = {:u}', { u: it.url });
  if (dup !== null) return { item: rowOut(dup), duplicate: true, message: 'This article is already in the news.' };
  if (published < cutoffIso(round !== null ? ROUND_KEEP_DAYS : KEEP_DAYS)) throw util.fail(400, round !== null ? 'The article is older than ' + ROUND_KEEP_DAYS + ' days.' : 'The article is older than ' + KEEP_DAYS + ' days; the news keeps 60 days (a Funding item with a round, 400 days).', 'invalid_param', { param: 'published_at' });
  const q = { category: category, kind: about.kind, id: about.id, key: about.key, name: about.name, topic: util.text(p, 'topic', 120, '') || about.name, sector: sector, q: '' };
  const rec = storeOne(app, it, q, 'person', ctx);
  if (rec === null) throw util.fail(409, 'The article could not be added.', 'conflict');
  L('lib_audit').note(ctx, { collection: 'news', record: rec.id, summary: 'Added the news item ' + title });
  return { item: rowOut(rec) };
}

/* ------------------------------------------------------------- asks, cron */

/** News items waiting for a digest: found in the last 3 days, not hidden, without a summary yet. */
function digestCount(app) {
  return u().count(app, "SELECT COUNT(*) AS n FROM news WHERE hidden = FALSE AND summary = '' AND fetched_at > {:s}", { s: new Date(Date.now() - 3 * 86400000).toISOString() });
}

/** Daily, while the firm's news_digest switch is on: ask your AI agent to pick and summarize the items found since (trigger news_digest). */
function cronDigest(app) {
  if (digestCount(app) === 0) return;
  L('lib_agent').ask(app, 'news_digest', L('lib_settings').row(app), {}, { policy: true });
}

/** agent.ask --trigger news_digest: there are new items to pick from. */
function digestCheck(ctx) {
  L('lib_auth').need(ctx, 'markets', 'view', 'ask your AI agent for the news digest');
  if (digestCount(ctx.app) === 0) throw u().fail(409, 'No news found in the last 3 days waits for a summary.', 'nothing_to_do');
  return {};
}

/** Every 2 hours: pull the news. */
function cronNews(app) {
  try {
    pullAll(app);
  } catch (err) {
    console.error('[vo] news pull failed:', err);
  }
  L('lib_bus').flush(app);
}

/** Nightly: news older than 60 days is deleted with its picture and saves (a Funding item with a round after 400 days). */
function cronCleanup(app) {
  let n = 0;
  for (const r of app.findRecordsByFilter('news', "(published_at < {:b} && round_company = '') || published_at < {:r}", '', 500, 0, { b: cutoffIso(), r: cutoffIso(ROUND_KEEP_DAYS) })) {
    app.delete(r);
    n++;
  }
  if (n > 0) L('lib_bus').touch('news');
  return n;
}

module.exports = {
  NEWS_SEARCH: NEWS_SEARCH,
  BING_SEARCH: BING_SEARCH,
  GOOGLE_SEARCH: GOOGLE_SEARCH,
  IMAGE_HOST: IMAGE_HOST,
  LATE_STAGES: LATE_STAGES,
  KEEP_DAYS: KEEP_DAYS,
  CATEGORIES: CATEGORIES,
  CATEGORY_LABELS: CATEGORY_LABELS,
  MARKET_QUERIES: MARKET_QUERIES,
  sectorLabel: sectorLabel,
  sectorKey: sectorKey,
  companyQuery: companyQuery,
  sectorQuery: sectorQuery,
  sectorQueries: sectorQueries,
  bingUrl: bingUrl,
  googleUrl: googleUrl,
  searchUrl: searchUrl,
  element: element,
  rfc822: rfc822,
  queryParam: queryParam,
  hostOf: hostOf,
  cleanLink: cleanLink,
  cleanTitle: cleanTitle,
  undash: undash,
  imageOf: imageOf,
  imageUrl: imageUrl,
  parseRss: parseRss,
  sectorsOf: sectorsOf,
  companiesOf: companiesOf,
  queriesOf: queriesOf,
  pullAll: pullAll,
  rowOut: rowOut,
  companyVisible: companyVisible,
  opList: opList,
  opStats: opStats,
  opRefresh: opRefresh,
  opSummarize: opSummarize,
  opHide: opHide,
  opSave: opSave,
  opImage: opImage,
  opSetImage: opSetImage,
  opAdd: opAdd,
  cronDigest: cronDigest,
  digestCheck: digestCheck,
  cronNews: cronNews,
  cronCleanup: cronCleanup,
};
