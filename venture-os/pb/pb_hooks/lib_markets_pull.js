/**
 * The keyless public sources the app pulls itself (markets radars).
 *
 *   edgar_form_d  SEC EDGAR "latest filings" Atom feed of Form D, then each
 *                 new filing's primary_doc.xml (issuer, state, year of
 *                 incorporation, industry group, offering and sold amounts,
 *                 executive officers). No key; a declared User-Agent naming
 *                 the firm and a contact; under 10 requests a second (the app
 *                 waits PACE_MS between requests).
 *   hacker_news   The Hacker News API (Firebase): the newest Show HN stories,
 *                 each item fetched by id. No key, no rate limit.
 *   github        GitHub repository search (unauthenticated: 10 searches a
 *                 minute, 60 requests an hour): one search per run with the
 *                 radar's own query, newest repositories by stars.
 *
 * UK Companies House and the Japan corporate number API need a registered
 * key, so the app never calls them; a radar that lists them asks your AI
 * agent to search them with its own access (lib_markets SOURCES, by agent).
 *
 * Every filter here is structured (an industry group from the Form D
 * enumeration, a US state code, amounts, years, points, stars); free text
 * goes to a source's own search (GitHub q) and to your AI agent, never
 * matched here.
 *
 * The parse and filter functions are pure (Node tests read fixtures); the
 * fetch functions use $http and sleep, inside function bodies only.
 */

const EDGAR_FEED = 'https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=D&company=&dateb=&owner=include&count=100&output=atom';
const EDGAR_ARCHIVE = 'https://www.sec.gov/Archives/edgar/data/';
const EDGAR_INDEX = 'https://www.sec.gov/Archives/edgar/daily-index/';
const HN_SHOW = 'https://hacker-news.firebaseio.com/v0/showstories.json';
const HN_ITEM = 'https://hacker-news.firebaseio.com/v0/item/';
const HN_PAGE = 'https://news.ycombinator.com/item?id=';
const GITHUB_SEARCH = 'https://api.github.com/search/repositories';

const PACE_MS = 150;
const TIMEOUT = 20;

/** Form D industry groups (EDGAR Form D XML, industryGroupType). */
const INDUSTRIES = [
  'Agriculture',
  'Airlines and Airports',
  'Biotechnology',
  'Business Services',
  'Coal Mining',
  'Commercial',
  'Commercial Banking',
  'Computers',
  'Construction',
  'Electric Utilities',
  'Energy Conservation',
  'Environmental Services',
  'Health Insurance',
  'Hospitals and Physicians',
  'Insurance',
  'Investing',
  'Investment Banking',
  'Lodging and Conventions',
  'Manufacturing',
  'Oil and Gas',
  'Other',
  'Other Banking and Financial Services',
  'Other Energy',
  'Other Health Care',
  'Other Real Estate',
  'Other Technology',
  'Other Travel',
  'Pharmaceuticals',
  'Pooled Investment Fund',
  'REITS and Finance',
  'Residential',
  'Restaurants',
  'Retailing',
  'Telecommunications',
  'Tourism and Travel Services',
];
const DEFAULT_INDUSTRIES = ['Computers', 'Telecommunications', 'Other Technology', 'Biotechnology', 'Other Health Care', 'Other Banking and Financial Services', 'Business Services'];

/** US state and territory codes as Form D writes them (a foreign issuer has an EDGAR country code instead). */
const US_STATES = [
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'DC', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA', 'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ', 'NM', 'NY',
  'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT', 'VA', 'WA', 'WV', 'WI', 'WY', 'PR', 'GU', 'VI', 'AS', 'MP',
];

/** Root domains that host many projects, so they never name a company. */
const SHARED_HOSTS = [
  'github.com', 'github.io', 'gitlab.com', 'gitlab.io', 'bitbucket.org', 'sourceforge.net', 'codeberg.org', 'huggingface.co', 'npmjs.com', 'pypi.org', 'crates.io',
  'apple.com', 'google.com', 'microsoft.com', 'medium.com', 'substack.com', 'youtube.com', 'youtu.be', 'twitter.com', 'x.com', 'linkedin.com', 'reddit.com',
  'notion.site', 'notion.so', 'vercel.app', 'netlify.app', 'herokuapp.com', 'pages.dev', 'workers.dev', 'fly.dev', 'replit.app', 'replit.com', 'glitch.me',
  'itch.io', 'wordpress.com', 'blogspot.com', 'wixsite.com', 'carrd.co', 'framer.website', 'webflow.io', 'ycombinator.com', 'producthunt.com', 'chromewebstore.google.com',
];

/* --------------------------------------------------------------- helpers */

let _norm = null;
function N() {
  if (_norm === null) _norm = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_norm.js');
  return _norm;
}

/** A company's root domain from a link, or '' when it is a shared host. */
function companyDomain(link) {
  const d = N().domain(link || '');
  if (d === '' || SHARED_HOSTS.indexOf(d) >= 0) return '';
  return d;
}

/** XML entities of text nodes. */
function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (m, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');
}

/** The inner XML of the first <tag>...</tag> (or '' when absent). */
function inner(xml, tag) {
  const open = '<' + tag + '>';
  const i = xml.indexOf(open);
  if (i < 0) return '';
  const j = xml.indexOf('</' + tag + '>', i + open.length);
  if (j < 0) return '';
  return xml.slice(i + open.length, j);
}

/** Every inner XML of <tag>...</tag>. */
function all(xml, tag) {
  const out = [];
  const open = '<' + tag + '>';
  const close = '</' + tag + '>';
  let at = 0;
  for (;;) {
    const i = xml.indexOf(open, at);
    if (i < 0) break;
    const j = xml.indexOf(close, i + open.length);
    if (j < 0) break;
    out.push(xml.slice(i + open.length, j));
    at = j + close.length;
  }
  return out;
}

function textOf(xml, tag) {
  return unescapeXml(inner(xml, tag).trim());
}

/** The value of attribute `name` in the first element `<tag ...>` (or ''). */
function attr(xml, tag, name) {
  const i = xml.indexOf('<' + tag + ' ');
  if (i < 0) return '';
  const end = xml.indexOf('>', i);
  const el = xml.slice(i, end < 0 ? xml.length : end);
  const key = name + '="';
  const k = el.indexOf(key);
  if (k < 0) return '';
  const v = el.indexOf('"', k + key.length);
  return unescapeXml(el.slice(k + key.length, v < 0 ? el.length : v));
}

/** Whole USD amount text -> cents, or null (Form D writes "Indefinite" for open-ended offerings). */
function usdMinor(s) {
  const t = String(s || '').trim();
  if (!/^\d{1,15}$/.test(t)) return null;
  return Number(t) * 100;
}

function boolText(s) {
  const t = String(s || '').trim().toLowerCase();
  if (t === 'true') return true;
  if (t === 'false') return false;
  return null;
}

/* ------------------------------------------------------------ EDGAR Form D */

/**
 * The Atom feed of latest filings -> [{ accession, cik, form, link, updated }]
 * for forms D (and D/A when amendments are wanted). The feed's type filter is
 * a prefix, so other forms (DEF 14A...) are dropped by the entry's form type.
 */
function edgarFeed(xml, amendments) {
  const out = [];
  for (const e of all(String(xml || ''), 'entry')) {
    const form = attr(e, 'category', 'term');
    if (form !== 'D' && !(amendments === true && form === 'D/A')) continue;
    const link = attr(e, 'link', 'href');
    const id = textOf(e, 'id');
    const k = id.indexOf('accession-number=');
    const accession = k >= 0 ? id.slice(k + 17).trim() : '';
    const parts = link.split('/edgar/data/');
    const cik = parts.length > 1 ? parts[1].split('/')[0] : '';
    if (!/^\d{10}-\d{2}-\d{6}$/.test(accession) || !/^\d+$/.test(cik)) continue;
    out.push({ accession: accession, cik: cik, form: form, link: link, updated: textOf(e, 'updated') });
  }
  return out;
}

/** The primary document of a filing in the archive. */
function edgarDocUrl(cik, accession) {
  return EDGAR_ARCHIVE + String(Number(cik)) + '/' + String(accession).replace(/-/g, '') + '/primary_doc.xml';
}

/** A page of the latest-filings feed (100 entries, newest first). */
function edgarFeedUrl(start) {
  return EDGAR_FEED + '&start=' + Math.max(0, Number(start) || 0);
}

/** The daily form index of a day (published each business evening; none on weekends and holidays). */
function edgarIndexUrl(day) {
  const y = day.slice(0, 4);
  const q = Math.floor((Number(day.slice(5, 7)) - 1) / 3) + 1;
  return EDGAR_INDEX + y + '/QTR' + q + '/form.' + day.replace(/-/g, '') + '.idx';
}

/**
 * A daily form index (fixed columns: form type, company, CIK, date filed,
 * file name) -> [{ accession, cik, form, link, updated }] for forms D (and
 * D/A when amendments are wanted).
 */
function edgarIndex(text, amendments, day) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    if (line.indexOf('edgar/data/') < 0) continue;
    const form = line.split(/\s{2,}/)[0].trim();
    if (form !== 'D' && !(amendments === true && form === 'D/A')) continue;
    const file = line.trim().split(/\s+/).pop() || '';
    const parts = file.split('/');
    if (parts.length !== 4) continue;
    const cik = parts[2];
    const accession = parts[3].replace(/\.txt$/, '');
    if (!/^\d+$/.test(cik) || !/^\d{10}-\d{2}-\d{6}$/.test(accession)) continue;
    out.push({ accession: accession, cik: cik, form: form, link: EDGAR_ARCHIVE + cik + '/' + accession.replace(/-/g, '') + '/' + accession + '-index.htm', updated: day + 'T00:00:00Z' });
  }
  return out;
}

/** The business days (Monday to Friday, UTC dates) after `fromDay` up to and including `toDay`, at most `max`, newest first. */
function daysBetween(fromDay, toDay, max) {
  const out = [];
  let t = Date.parse(toDay + 'T00:00:00Z');
  const stop = Date.parse(fromDay + 'T00:00:00Z');
  while (t > stop && out.length < max) {
    const wd = new Date(t).getUTCDay();
    if (wd !== 0 && wd !== 6) out.push(new Date(t).toISOString().slice(0, 10));
    t -= 86400000;
  }
  return out;
}

/** A Form D primary_doc.xml -> its structured fields (null when it is not a Form D). */
function formD(xml) {
  const x = String(xml || '');
  if (x.indexOf('<edgarSubmission>') < 0) return null;
  const issuer = inner(x, 'primaryIssuer');
  const offering = inner(x, 'offeringData');
  const year = inner(issuer, 'yearOfInc');
  const amounts = inner(offering, 'offeringSalesAmounts');
  const types = inner(offering, 'typesOfSecuritiesOffered');
  const people = all(inner(x, 'relatedPersonsList'), 'relatedPersonInfo').map((p) => {
    const nm = inner(p, 'relatedPersonName');
    const name = [textOf(nm, 'firstName'), textOf(nm, 'middleName'), textOf(nm, 'lastName')].filter((s) => s !== '').join(' ');
    return { name: name, roles: all(inner(p, 'relatedPersonRelationshipList'), 'relationship').map((r) => unescapeXml(r.trim())) };
  });
  const yv = textOf(year, 'value');
  return {
    submission: textOf(x, 'submissionType'),
    entity: textOf(issuer, 'entityName'),
    cik: textOf(issuer, 'cik'),
    state: textOf(inner(issuer, 'issuerAddress'), 'stateOrCountry'),
    state_name: textOf(inner(issuer, 'issuerAddress'), 'stateOrCountryDescription'),
    city: textOf(inner(issuer, 'issuerAddress'), 'city'),
    jurisdiction: textOf(issuer, 'jurisdictionOfInc'),
    entity_type: textOf(issuer, 'entityType'),
    year_of_inc: /^\d{4}$/.test(yv) ? Number(yv) : null,
    over_five_years: boolText(textOf(year, 'overFiveYears')) === true,
    within_five_years: boolText(textOf(year, 'withinFiveYears')) === true,
    industry: textOf(inner(offering, 'industryGroup'), 'industryGroupType'),
    revenue_range: textOf(inner(offering, 'issuerSize'), 'revenueRange'),
    amendment: boolText(textOf(inner(offering, 'newOrAmendment'), 'isAmendment')) === true,
    first_sale_day: /^\d{4}-\d{2}-\d{2}$/.test(textOf(inner(offering, 'dateOfFirstSale'), 'value')) ? textOf(inner(offering, 'dateOfFirstSale'), 'value') : '',
    offering_minor: usdMinor(textOf(amounts, 'totalOfferingAmount')),
    sold_minor: usdMinor(textOf(amounts, 'totalAmountSold')),
    remaining_minor: usdMinor(textOf(amounts, 'totalRemaining')),
    investors: /^\d+$/.test(textOf(inner(offering, 'investors'), 'totalNumberAlreadyInvested')) ? Number(textOf(inner(offering, 'investors'), 'totalNumberAlreadyInvested')) : null,
    equity: boolText(textOf(types, 'isEquityType')) === true,
    debt: boolText(textOf(types, 'isDebtType')) === true,
    pooled_fund: boolText(textOf(types, 'isPooledInvestmentFundType')) === true || textOf(inner(offering, 'industryGroup'), 'industryGroupType') === 'Pooled Investment Fund',
    exemptions: all(inner(offering, 'federalExemptionsExclusions'), 'item').map((s) => s.trim()),
    signed_day: textOf(inner(offering, 'signature'), 'signatureDate'),
    people: people.slice(0, 12),
  };
}

/** Facts in the thesis vocabulary from a Form D (graded public; unknown stays absent). */
function formDFacts(d) {
  const f = {};
  if (d.offering_minor !== null) f.raise_minor = { value: d.offering_minor, grade: 'public' };
  else if (d.sold_minor !== null && d.sold_minor > 0) f.raise_minor = { value: d.sold_minor, grade: 'public' };
  if (f.raise_minor) f.currency = { value: 'USD', grade: 'public' };
  if (US_STATES.indexOf(d.state) >= 0) f.hq_country = { value: 'US', grade: 'public' };
  if (d.year_of_inc !== null) f.founded_year = { value: d.year_of_inc, grade: 'public' };
  return f;
}

/**
 * Does a Form D pass the radar's structured filters? -> { ok, reason }.
 * Pooled investment funds never pass (they are funds, not companies). An
 * unknown value passes (unknown is never read as a no).
 */
function formDPasses(d, filters, thisYear) {
  const o = filters || {};
  if (d.pooled_fund) return { ok: false, reason: 'pooled_fund' };
  if (d.amendment && o.amendments !== true) return { ok: false, reason: 'amendment' };
  const inds = Array.isArray(o.industries) && o.industries.length > 0 ? o.industries : DEFAULT_INDUSTRIES;
  if (d.industry !== '' && inds.indexOf(d.industry) < 0) return { ok: false, reason: 'industry' };
  const within = Number(o.incorporated_within_years || 0);
  if (within > 0) {
    if (d.year_of_inc !== null && d.year_of_inc < thisYear - within) return { ok: false, reason: 'too_old' };
    if (d.year_of_inc === null && d.over_five_years && within <= 5) return { ok: false, reason: 'too_old' };
  }
  const states = Array.isArray(o.states) ? o.states : [];
  if (states.length > 0 && d.state !== '' && states.indexOf(d.state) < 0) return { ok: false, reason: 'state' };
  const amount = d.offering_minor !== null ? d.offering_minor : d.sold_minor;
  if (amount !== null) {
    if (o.min_raise_minor && amount < Number(o.min_raise_minor)) return { ok: false, reason: 'too_small' };
    if (o.max_raise_minor && amount > Number(o.max_raise_minor)) return { ok: false, reason: 'too_large' };
  }
  return { ok: true, reason: null };
}

/** A Form D as a signal item. */
function formDItem(entry, d) {
  return {
    ext_id: entry.accession,
    kind: 'raise_filed',
    name: d.entity,
    domain: '',
    website: '',
    title: d.entity + (d.amendment ? ' (amended Form D)' : ' (Form D)'),
    source_url: entry.link,
    facts: formDFacts(d),
    payload: Object.assign({ form: entry.form, accession: entry.accession, filed_at: entry.updated, currency: 'USD' }, d),
  };
}

/* ------------------------------------------------------------ Hacker News */

/** Does a Show HN item pass? -> { ok, reason }. */
function hnPasses(item, filters) {
  const o = filters || {};
  if (!item || item.type !== 'story') return { ok: false, reason: 'not_a_story' };
  if (item.dead === true || item.deleted === true) return { ok: false, reason: 'removed' };
  const min = Number(o.min_points === undefined ? 10 : o.min_points);
  if (Number(item.score || 0) < min) return { ok: false, reason: 'few_points' };
  return { ok: true, reason: null };
}

function hnItem(item) {
  const site = typeof item.url === 'string' ? item.url : '';
  const domain = companyDomain(site);
  return {
    ext_id: String(item.id),
    kind: 'launch',
    name: '',
    domain: domain,
    website: domain !== '' ? site : '',
    title: String(item.title || ''),
    source_url: HN_PAGE + String(item.id),
    facts: {},
    payload: { score: Number(item.score || 0), comments: Number(item.descendants || 0), by: String(item.by || ''), posted_at: item.time ? new Date(Number(item.time) * 1000).toISOString() : '', url: site },
  };
}

/* ----------------------------------------------------------------- GitHub */

/** The search q: the radar's query (as typed, GitHub searches it), created since a day, a minimum of stars. */
function githubQuery(query, filters, today) {
  const o = filters || {};
  const days = Number(o.created_within_days === undefined ? 90 : o.created_within_days);
  const stars = Number(o.min_stars === undefined ? 50 : o.min_stars);
  const parts = [String(query || '').trim()];
  if (days > 0) {
    const t = Date.parse(today + 'T00:00:00Z') - days * 86400000;
    parts.push('created:>=' + new Date(t).toISOString().slice(0, 10));
  }
  if (stars > 0) parts.push('stars:>=' + stars);
  return parts.filter((s) => s !== '').join(' ');
}

function githubUrl(q, perPage) {
  return GITHUB_SEARCH + '?q=' + encodeURIComponent(q) + '&sort=stars&order=desc&per_page=' + Math.max(1, Math.min(50, perPage));
}

function githubItem(r) {
  const home = typeof r.homepage === 'string' ? r.homepage : '';
  const domain = companyDomain(home);
  const owner = r.owner || {};
  return {
    ext_id: String(r.id),
    kind: 'repo',
    name: owner.type === 'Organization' ? String(owner.login || '') : '',
    domain: domain,
    website: domain !== '' ? home : '',
    title: String(r.full_name || ''),
    source_url: String(r.html_url || ''),
    facts: {},
    payload: {
      repo: String(r.full_name || ''),
      description: String(r.description || '').slice(0, 300),
      stars: Number(r.stargazers_count || 0),
      forks: Number(r.forks_count || 0),
      language: String(r.language || ''),
      topics: Array.isArray(r.topics) ? r.topics.slice(0, 10) : [],
      created_at: String(r.created_at || ''),
      pushed_at: String(r.pushed_at || ''),
      owner: String(owner.login || ''),
      owner_type: String(owner.type || ''),
      homepage: home,
    },
  };
}

/* ---------------------------------------------------------------- fetching */

/** GET a URL: { status, text, json } ({ status: 0 } when the host did not answer). */
function get(url, headers, wantJson) {
  try {
    const res = $http.send({ url: url, method: 'GET', timeout: TIMEOUT, headers: headers || {} });
    const out = { status: res.statusCode, text: '', json: null };
    if (wantJson) out.json = res.json;
    else out.text = toString(res.body);
    return out;
  } catch (err) {
    console.log('[vo] markets pull failed: ' + url + ' ' + err);
    return { status: 0, text: '', json: null };
  }
}

function httpError(status) {
  if (status === 0) return 'unreachable';
  if (status === 403 || status === 429) return 'rate_limited';
  return 'http_' + status;
}

/**
 * Pull new Form D filings since the radar's cursor: the latest-filings feed
 * (`pages` of 100), and when the feed does not reach back to the cursor,
 * the daily form indexes of the business days in between (at most 7; a
 * first pull reads the previous business day). Then the primary document of
 * each filing not seen yet, newest first, at most `limit`, paced under 10
 * requests a second; a document another radar already read is reused
 * (cached(accession) -> its parsed fields, or null).
 * o: { filters, limit, pages, user_agent, seen(ext_id), cached(accession), since_at, today, year }
 * -> { items: [{ item, pass }], counts: { pulled, kept, out, left, error }, cursor }
 * The cursor moves to now only when nothing was left unread.
 */
function pullEdgar(app, o) {
  const ua = String(o.user_agent || '');
  const headers = { 'User-Agent': ua, Accept: 'application/atom+xml, application/xml, text/xml, text/plain' };
  const counts = { pulled: 0, kept: 0, out: 0, left: 0, error: '' };
  const amend = o.filters && o.filters.amendments === true;
  const started = new Date().toISOString();
  const byAcc = {};
  const entries = [];
  const add = (list) => {
    for (const e of list) {
      if (byAcc[e.accession]) continue;
      byAcc[e.accession] = true;
      entries.push(e);
    }
  };
  let oldest = '';
  for (let page = 0; page < Math.max(1, o.pages || 1); page++) {
    if (page > 0) sleep(PACE_MS);
    const feed = get(edgarFeedUrl(page * 100), headers, false);
    if (feed.status !== 200) {
      counts.error = httpError(feed.status);
      return { items: [], counts: counts, cursor: o.since_at || '' };
    }
    const all = edgarFeed(feed.text, true);
    for (const e of all) if (oldest === '' || Date.parse(e.updated) < Date.parse(oldest)) oldest = e.updated;
    add(all.filter((e) => e.form === 'D' || (amend && e.form === 'D/A')));
    if (o.since_at && oldest !== '' && Date.parse(oldest) <= Date.parse(o.since_at)) break;
  }
  const since = o.since_at ? o.since_at.slice(0, 10) : '';
  if (oldest === '' || since === '' || Date.parse(oldest) > Date.parse(o.since_at)) {
    const yesterday = new Date(Date.parse(o.today + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10);
    const days = since === '' ? daysBetween(new Date(Date.parse(yesterday + 'T00:00:00Z') - 4 * 86400000).toISOString().slice(0, 10), yesterday, 1) : daysBetween(new Date(Date.parse(since + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10), yesterday, 7);
    for (const day of days) {
      sleep(PACE_MS);
      const idx = get(edgarIndexUrl(day), headers, false);
      if (idx.status === 429) {
        counts.error = 'rate_limited';
        break;
      }
      if (idx.status === 200) add(edgarIndex(idx.text, amend, day));
    }
  }
  entries.sort((a, b) => (Date.parse(b.updated) || 0) - (Date.parse(a.updated) || 0));
  const fresh = entries.filter((e) => !o.seen(e.accession));
  const out = [];
  let read = 0;
  for (const e of fresh) {
    if (read >= o.limit || counts.error === 'rate_limited') break;
    read++;
    let d = o.cached ? o.cached(e.accession) : null;
    if (d === null) {
      sleep(PACE_MS);
      const doc = get(edgarDocUrl(e.cik, e.accession), headers, false);
      if (doc.status === 429) {
        counts.error = 'rate_limited';
        read--;
        break;
      }
      if (doc.status !== 200) continue;
      d = formD(doc.text);
      if (d === null) continue;
    }
    counts.pulled++;
    const pass = formDPasses(d, o.filters, o.year);
    if (pass.ok) counts.kept++;
    else counts.out++;
    out.push({ item: formDItem(e, d), pass: pass });
  }
  counts.left = Math.max(0, fresh.length - read);
  return { items: out, counts: counts, cursor: counts.left === 0 && counts.error === '' ? started : o.since_at || '' };
}

/** Pull the newest Show HN stories not seen yet (at most `limit`). */
function pullHackerNews(app, o) {
  const counts = { pulled: 0, kept: 0, out: 0, error: '' };
  const ids = get(HN_SHOW, { Accept: 'application/json' }, true);
  if (ids.status !== 200 || !Array.isArray(ids.json)) {
    counts.error = httpError(ids.status);
    return { items: [], counts: counts };
  }
  const out = [];
  const fresh = ids.json.map((x) => String(x)).filter((id) => !o.seen(id));
  for (const id of fresh.slice(0, o.limit)) {
    sleep(40);
    const r = get(HN_ITEM + id + '.json', { Accept: 'application/json' }, true);
    if (r.status !== 200 || r.json === null || typeof r.json !== 'object') continue;
    counts.pulled++;
    const pass = hnPasses(r.json, o.filters);
    if (pass.ok) counts.kept++;
    else counts.out++;
    out.push({ item: hnItem(r.json), pass: pass });
  }
  return { items: out, counts: counts };
}

/** One GitHub repository search with the radar's query (none without a query). */
function pullGithub(app, o) {
  const counts = { pulled: 0, kept: 0, out: 0, error: '' };
  if (String(o.query || '').trim() === '') {
    counts.error = 'needs_query';
    return { items: [], counts: counts };
  }
  const r = get(githubUrl(githubQuery(o.query, o.filters, o.today), o.limit), { 'User-Agent': String(o.user_agent || 'Venture OS'), Accept: 'application/vnd.github+json' }, true);
  if (r.status !== 200 || r.json === null || !Array.isArray(r.json.items)) {
    counts.error = httpError(r.status);
    return { items: [], counts: counts };
  }
  const out = [];
  for (const repo of r.json.items) {
    const it = githubItem(repo);
    if (o.seen(it.ext_id)) continue;
    counts.pulled++;
    counts.kept++;
    out.push({ item: it, pass: { ok: true, reason: null } });
  }
  return { items: out, counts: counts };
}

module.exports = {
  INDUSTRIES: INDUSTRIES,
  DEFAULT_INDUSTRIES: DEFAULT_INDUSTRIES,
  US_STATES: US_STATES,
  SHARED_HOSTS: SHARED_HOSTS,
  companyDomain: companyDomain,
  edgarFeed: edgarFeed,
  edgarFeedUrl: edgarFeedUrl,
  edgarIndex: edgarIndex,
  edgarIndexUrl: edgarIndexUrl,
  daysBetween: daysBetween,
  edgarDocUrl: edgarDocUrl,
  formD: formD,
  formDFacts: formDFacts,
  formDPasses: formDPasses,
  formDItem: formDItem,
  hnPasses: hnPasses,
  hnItem: hnItem,
  githubQuery: githubQuery,
  githubUrl: githubUrl,
  githubItem: githubItem,
  pullEdgar: pullEdgar,
  pullHackerNews: pullHackerNews,
  pullGithub: pullGithub,
};
