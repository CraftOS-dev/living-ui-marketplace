/// <reference path="../pb_data/types.d.ts" />
/**
 * Trademark and design office data adapters: USPTO TSDR (US trademarks),
 * EUIPO (EU trade marks and designs) and the JPO Patent Information
 * Retrieval API (JP trademarks and designs). China, Korea and Taiwan have no
 * usable public API, so their matters are kept by hand.
 *
 * Each adapter fetches one case and returns the same normalized snapshot:
 *   { office, source, number, found, title, status_text, status_code,
 *     status (our enum or ''), filing_date, publication_no, publication_date,
 *     registration_no, registration_date, expiry_date, owner, applicants,
 *     classes: [{nice_class, spec}], next_annuity_date, events: [{code, raw_code,
 *     date, label}], raw, fetched_at, lag_note }
 *
 * Office events are mapped to our event codes ONLY through exact office code
 * tables below. Anything unmapped is kept as a raw event for a person to
 * record, never guessed from free text.
 *
 * Credentials belong to the organization (office_connections, admin-only,
 * secrets hidden from the API). Sync never writes to a matter: it files an
 * Inbox item with field-level diffs and new events for review.
 */

// TSDR mark status codes.
function tsdrStatus(code) {
  const n = parseInt(String(code || ''), 10);
  if (isNaN(n)) return '';
  if (n === 700 || n === 800) return 'registered';
  if (n >= 600 && n < 700) return 'abandoned';
  return '';
}
// JPO document codes (app_progress documentCode).
const JPO_DOCS = {
  A131: 'OA_ISSUED',
  A01: 'NOTICE_ALLOWANCE',
  A02: 'REFUSED',
  A621: 'EXAM_REQUESTED',
};
// EUIPO status enumeration.
const EUIPO_STATUS = {
  REGISTERED: 'registered',
  APPLICATION_PUBLISHED: 'published',
  PUBLISHED: 'published',
  UNDER_EXAMINATION: 'examination',
  EXAMINATION: 'examination',
  RECEIVED: 'filed',
  FILED: 'filed',
  OPPOSITION_PENDING: 'opposed',
  EXPIRED: 'expired',
  CANCELLED: 'revoked',
  CANCELLATION_PENDING: 'registered',
  WITHDRAWN: 'withdrawn',
  REFUSED: 'refused',
  SURRENDERED: 'revoked',
};

const OFFICE_LABEL = {
  uspto_tsdr: 'USPTO TSDR',
  euipo: 'EUIPO',
  jpo: 'JPO Patent Information Retrieval API',
};

function conn(app, office) {
  const u = require(`${__hooks}/lib_util.js`);
  return u.findOne(app, 'office_connections', 'office = {:o}', { o: office });
}

function markStatus(app, c, ok, message) {
  try {
    c.set('status', ok ? 'connected' : 'error');
    c.set('last_check', new Date().toISOString());
    c.set('last_error', ok ? '' : String(message || '').slice(0, 2000));
    app.save(c);
  } catch {
    /* ignore */
  }
}

function send(req) {
  const res = $http.send(req);
  let text = '';
  try {
    text = toString(res.body);
  } catch {
    text = '';
  }
  let json = null;
  try {
    json = res.json !== undefined && res.json !== null ? res.json : text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { status: res.statusCode, json: json, text: text, headers: res.headers };
}

function blank(office, number) {
  return {
    office: office,
    source: OFFICE_LABEL[office] || office,
    number: number,
    found: false,
    title: '',
    status_text: '',
    status_code: '',
    status: '',
    filing_date: '',
    publication_no: '',
    publication_date: '',
    registration_no: '',
    registration_date: '',
    expiry_date: '',
    owner: '',
    applicants: '',
    classes: [],
    next_annuity_date: '',
    events: [],
    family: [],
    raw: null,
    fetched_at: new Date().toISOString(),
    lag_note: '',
  };
}

/* ------------------------------------------------------------------ */
/* USPTO TSDR (trademarks)                                             */
/* ------------------------------------------------------------------ */

function xmlTag(xml, tag) {
  const re = new RegExp('<(?:[A-Za-z0-9]+:)?' + tag + '(?:\\s[^>]*)?>([^<]*)<', 'i');
  const m = re.exec(xml);
  return m ? m[1].trim() : '';
}

function fetchTsdr(app, number) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = conn(app, 'uspto_tsdr');
  if (c === null || !c.getBool('enabled') || !c.getString('api_key')) throw new Error('USPTO TSDR is not connected.');
  const serial = String(number || '').replace(/[^0-9]/g, '');
  if (serial.length < 7) throw new Error('Enter a US trademark serial number such as 90123456.');
  const res = send({
    url: 'https://tsdrapi.uspto.gov/ts/cd/casestatus/sn' + serial + '/info',
    method: 'GET',
    headers: { 'USPTO-API-KEY': c.getString('api_key'), accept: 'application/json, application/xml' },
    timeout: 30,
  });
  if (res.status === 404) return blank('uspto_tsdr', serial);
  if (res.status === 401 || res.status === 403) {
    markStatus(app, c, false, 'Key rejected (HTTP ' + res.status + ')');
    throw new Error('The USPTO rejected the TSDR key (HTTP ' + res.status + '). Check it in Settings, Office connections.');
  }
  if (res.status === 429) throw quotaError('TSDR rate limit reached. Try again in a minute.');
  if (res.status !== 200) throw new Error('TSDR returned HTTP ' + res.status + '.');
  markStatus(app, c, true, '');
  const s = blank('uspto_tsdr', serial);
  s.found = true;
  if (res.json) {
    const j = res.json;
    s.raw = j;
    s.title = String(u.findKey(j, ['markElement', 'markVerbalElementText', 'MarkVerbalElementText']) || '');
    s.status_text = String(u.findKey(j, ['extStatusDesc', 'markCurrentStatusExternalDescriptionText', 'statusDescription']) || '');
    s.status_code = String(u.findKey(j, ['status', 'markCurrentStatusCode', 'statusCode']) || '');
    s.filing_date = u.officeDate(u.findKey(j, ['filingDate', 'applicationDate']));
    s.registration_no = String(u.findKey(j, ['usRegistrationNumber', 'registrationNumber']) || '');
    s.registration_date = u.officeDate(u.findKey(j, ['usRegistrationDate', 'registrationDate']));
    s.publication_date = u.officeDate(u.findKey(j, ['publishedForOppositionDate', 'publicationDate']));
    s.owner = String(u.findKey(j, ['ownerName', 'partyName']) || '');
  } else {
    const x = res.text || '';
    s.raw = { xml_excerpt: x.slice(0, 4000) };
    s.title = xmlTag(x, 'MarkVerbalElementText');
    s.status_text = xmlTag(x, 'MarkCurrentStatusExternalDescriptionText');
    s.status_code = xmlTag(x, 'MarkCurrentStatusCode');
    s.filing_date = u.officeDate(xmlTag(x, 'ApplicationDate'));
    s.registration_no = xmlTag(x, 'RegistrationNumber');
    s.registration_date = u.officeDate(xmlTag(x, 'RegistrationDate'));
    s.publication_date = u.officeDate(xmlTag(x, 'PublicationDate'));
    s.owner = xmlTag(x, 'EntityName') || xmlTag(x, 'OrganizationStandardName');
    const classRe = /<(?:[A-Za-z0-9]+:)?ClassNumber>(\d+)</g;
    let m;
    const seen = {};
    while ((m = classRe.exec(x)) !== null) {
      const n = parseInt(m[1], 10);
      if (n >= 1 && n <= 45 && !seen[n]) {
        seen[n] = true;
        s.classes.push({ nice_class: n, spec: '' });
      }
    }
  }
  s.status = tsdrStatus(s.status_code);
  if (s.filing_date) s.events.push({ code: 'FILED', raw_code: 'filing', date: s.filing_date, label: 'Application filed' });
  if (s.publication_date) s.events.push({ code: 'PUBLISHED', raw_code: 'publication', date: s.publication_date, label: 'Published for opposition' });
  if (s.registration_date) s.events.push({ code: 'REGISTERED', raw_code: 'registration', date: s.registration_date, label: 'Registered' });
  return s;
}

/* ------------------------------------------------------------------ */
/* EUIPO                                                               */
/* ------------------------------------------------------------------ */

function euipoToken(app, c) {
  const u = require(`${__hooks}/lib_util.js`);
  const exp = c.getString('token_expires');
  if (c.getString('token') && exp && new Date(exp.replace(' ', 'T')).getTime() - 60000 > Date.now()) return c.getString('token');
  if (!c.getString('client_id') || !c.getString('client_secret')) throw new Error('EUIPO needs a client ID and secret.');
  const url = c.getBool('sandbox') ? 'https://auth-sandbox.euipo.europa.eu/oidc/accessToken' : 'https://auth.euipo.europa.eu/oidc/accessToken';
  const res = send({
    url: url,
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: u.formEncode({ grant_type: 'client_credentials', client_id: c.getString('client_id'), client_secret: c.getString('client_secret'), scope: 'uid' }),
    timeout: 30,
  });
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    markStatus(app, c, false, 'Token request failed (HTTP ' + res.status + ')');
    throw new Error('EUIPO refused the credentials (HTTP ' + res.status + ').');
  }
  c.set('token', res.json.access_token);
  c.set('token_expires', new Date(Date.now() + Number(res.json.expires_in || 7200) * 1000).toISOString());
  app.save(c);
  return res.json.access_token;
}

function fetchEuipo(app, number, kind) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = conn(app, 'euipo');
  if (c === null || !c.getBool('enabled')) throw new Error('EUIPO is not connected.');
  const num = String(number || '').replace(/[^0-9A-Za-z-]/g, '');
  if (num.length < 5) throw new Error('Enter an EUIPO application or design number.');
  const token = euipoToken(app, c);
  const host = c.getBool('sandbox') ? 'https://api-sandbox.euipo.europa.eu' : 'https://api.euipo.europa.eu';
  const path = kind === 'design' ? '/design-search/designs/' : '/trademark-search/trademarks/';
  const res = send({
    url: host + path + num,
    method: 'GET',
    headers: { authorization: 'Bearer ' + token, 'X-IBM-Client-Id': c.getString('client_id'), accept: 'application/json' },
    timeout: 30,
  });
  const s = blank('euipo', num);
  if (res.status === 404) return s;
  if (res.status === 401 || res.status === 403) {
    markStatus(app, c, false, 'Rejected (HTTP ' + res.status + ')');
    throw new Error('EUIPO rejected the request (HTTP ' + res.status + '). Production access needs approved identity documents.');
  }
  if (res.status !== 200 || !res.json) throw new Error('EUIPO returned HTTP ' + res.status + '.');
  markStatus(app, c, true, '');
  const j = res.json;
  s.found = true;
  s.raw = j;
  s.title = String(u.findKey(j, ['verbalElement', 'markVerbalElement', 'designTitle', 'productIndication']) || '');
  const st = String(u.findKey(j, ['status', 'markStatus', 'designStatus']) || '');
  s.status_text = st;
  s.status_code = st;
  s.status = EUIPO_STATUS[st.toUpperCase()] || '';
  s.filing_date = u.officeDate(u.findKey(j, ['applicationDate', 'filingDate']));
  s.registration_date = u.officeDate(u.findKey(j, ['registrationDate']));
  s.registration_no = s.registration_date ? num : '';
  s.expiry_date = u.officeDate(u.findKey(j, ['expiryDate']));
  s.publication_date = u.officeDate(u.findKey(j, ['publicationDate', 'applicationPublicationDate']));
  s.owner = String(u.findKey(j, ['applicantName', 'name', 'ownerName']) || '');
  const classes = u.findKey(j, ['niceClasses', 'goodsAndServices']);
  if (Array.isArray(classes)) {
    for (const x of classes) {
      const n = typeof x === 'number' ? x : parseInt(String((x && (x.classNumber || x.niceClass || x.class)) || ''), 10);
      if (n >= 1 && n <= 45 && !s.classes.some((y) => y.nice_class === n)) {
        const desc = x && typeof x === 'object' ? String(x.description || x.goodsAndServicesDescription || '') : '';
        s.classes.push({ nice_class: n, spec: desc });
      }
    }
  }
  if (s.filing_date) s.events.push({ code: 'FILED', raw_code: 'filing', date: s.filing_date, label: 'Application filed' });
  if (s.publication_date) s.events.push({ code: 'PUBLISHED', raw_code: 'publication', date: s.publication_date, label: 'Application published' });
  if (s.registration_date) s.events.push({ code: 'REGISTERED', raw_code: 'registration', date: s.registration_date, label: 'Registered' });
  return s;
}

/* ------------------------------------------------------------------ */
/* JPO Patent Information Retrieval API                                */
/* ------------------------------------------------------------------ */

function jpoToken(app, c) {
  const u = require(`${__hooks}/lib_util.js`);
  const exp = c.getString('token_expires');
  if (c.getString('token') && exp && new Date(exp.replace(' ', 'T')).getTime() - 60000 > Date.now()) return c.getString('token');
  if (!c.getString('username') || !c.getString('password')) throw new Error('The JPO API needs the ID and password the JPO issued.');
  const res = send({
    url: 'https://ip-data.jpo.go.jp/auth/token',
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: u.formEncode({ grant_type: 'password', username: c.getString('username'), password: c.getString('password') }),
    timeout: 30,
  });
  if (res.status !== 200 || !res.json || !res.json.access_token) {
    markStatus(app, c, false, 'Token request failed (HTTP ' + res.status + ')');
    throw new Error('The JPO refused the ID or password (HTTP ' + res.status + ').');
  }
  c.set('token', res.json.access_token);
  c.set('token_expires', new Date(Date.now() + Number(res.json.expires_in || 3600) * 1000).toISOString());
  app.save(c);
  return res.json.access_token;
}

function quotaError(message) {
  const err = new Error(message);
  err.quota = true;
  return err;
}

function jpoBudget(app, c) {
  const today = new Date().toISOString().slice(0, 10);
  if (c.getString('calls_date') !== today) {
    c.set('calls_date', today);
    c.set('calls_today', 0);
  }
  if (c.getInt('remaining_calls') === 0 && c.getString('calls_date') === today && c.getInt('calls_today') > 0) {
    throw quotaError('The JPO daily call limit is used up. Sync resumes after midnight (Japan time).');
  }
}

function jpoGet(app, c, path) {
  jpoBudget(app, c);
  const token = jpoToken(app, c);
  const res = send({
    url: 'https://ip-data.jpo.go.jp/api/' + path,
    method: 'GET',
    headers: { authorization: 'Bearer ' + token, accept: 'application/json' },
    timeout: 40,
  });
  c.set('calls_today', c.getInt('calls_today') + 1);
  const result = res.json && res.json.result ? res.json.result : null;
  if (result && typeof result.remainAccessCount !== 'undefined') c.set('remaining_calls', Number(result.remainAccessCount) || 0);
  app.save(c);
  if (res.status !== 200 || result === null) throw new Error('The JPO API returned HTTP ' + res.status + '.');
  const code = String(result.statusCode || '');
  if (code === '203') throw quotaError('The JPO daily call limit is used up.');
  if (code === '208') throw new Error('The JPO rejected the number format.');
  if (code === '107') return { none: true, data: null };
  if (code !== '100') throw new Error('The JPO API reported an error (' + code + '): ' + String(result.errorMessage || ''));
  return { none: false, data: result.data };
}

/** JP application number to "YYYYNNNNNN" (e.g. 特願2020-008423 -> 2020008423). */
function normJpAppNo(number) {
  const s = String(number || '').replace(/[^0-9]/g, '');
  if (s.length === 10) return s;
  if (s.length > 4 && s.length < 10) return s.slice(0, 4) + ('000000' + s.slice(4)).slice(-6);
  return s;
}

function fetchJpo(app, number, ipType) {
  const u = require(`${__hooks}/lib_util.js`);
  const c = conn(app, 'jpo');
  if (c === null || !c.getBool('enabled')) throw new Error('The JPO API is not connected.');
  const appNo = normJpAppNo(number);
  if (appNo.length !== 10) throw new Error('Enter a JP application number such as 2020-008423.');
  const kind = ipType === 'design' ? 'design' : 'trademark';
  const s = blank('jpo', appNo);
  const prog = jpoGet(app, c, kind + '/v1/app_progress/' + appNo);
  markStatus(app, c, true, '');
  if (prog.none) return s;
  s.found = true;
  const d = prog.data || {};
  s.raw = { app_progress: d };
  s.title = String(u.findKey(d, ['designArticle', 'trademarkName', 'title']) || '');
  s.filing_date = u.officeDate(u.findKey(d, ['filingDate', 'applicationDate']));
  s.publication_no = String(u.findKey(d, ['publicationNumber']) || '');
  s.publication_date = u.officeDate(u.findKey(d, ['publicationDate']));
  s.registration_no = String(u.findKey(d, ['registrationNumber']) || '');
  s.registration_date = u.officeDate(u.findKey(d, ['registrationDate']));
  s.owner = String(u.findKey(d, ['applicantName', 'name']) || '');
  const docs = u.findAll(d, 'documentCode');
  const bag = u.findKey(d, ['bibliographyInformation', 'documentList', 'progressInformation']);
  const list = [];
  (function walk(o, depth) {
    if (!o || depth > 10) return;
    if (Array.isArray(o)) {
      for (const x of o) walk(x, depth + 1);
      return;
    }
    if (typeof o === 'object') {
      if (o.documentCode) list.push(o);
      for (const k of Object.keys(o)) if (typeof o[k] === 'object') walk(o[k], depth + 1);
    }
  })(bag || d, 0);
  for (const doc of list) {
    const raw = String(doc.documentCode || '');
    s.events.push({
      code: JPO_DOCS[raw] || '',
      raw_code: raw,
      date: u.officeDate(doc.legalDate || doc.date),
      label: String(doc.documentDescription || raw),
    });
  }
  if (docs.length === 0 && list.length === 0) s.lag_note = 'No documents listed yet.';
  if (s.filing_date) s.events.push({ code: 'FILED', raw_code: 'filing', date: s.filing_date, label: 'Application filed' });
  try {
    const reg = jpoGet(app, c, kind + '/v1/registration_info/' + appNo);
    if (!reg.none && reg.data) {
      const r = reg.data;
      s.raw.registration_info = r;
      s.registration_no = String(u.findKey(r, ['registrationNumber']) || s.registration_no);
      s.registration_date = u.officeDate(u.findKey(r, ['registrationDate'])) || s.registration_date;
      s.next_annuity_date = u.officeDate(u.findKey(r, ['nextPensionPaymentDate']));
      s.expiry_date = u.officeDate(u.findKey(r, ['expireDate']));
      const gone = u.officeDate(u.findKey(r, ['disappearanceDate']));
      if (gone) {
        s.status = 'lapsed';
        s.events.push({ code: 'LAPSED', raw_code: 'disappearanceDate', date: gone, label: 'Right extinguished' });
      } else if (s.registration_date) s.status = 'registered';
      if (s.registration_date) {
        s.events.push({
          code: 'REGISTERED',
          raw_code: 'registrationDate',
          date: s.registration_date,
          label: 'Registered',
        });
      }
    }
  } catch (err) {
    s.lag_note = 'Registration data unavailable: ' + String(err.message || err);
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Routing, diffs, sync                                                */
/* ------------------------------------------------------------------ */

function sourceFor(ipType, jurisdiction) {
  const j = String(jurisdiction || '').toUpperCase();
  if (j === 'US') return ipType === 'trademark' ? 'uspto_tsdr' : '';
  if (j === 'EM') return ipType === 'trademark' || ipType === 'design' ? 'euipo' : '';
  if (j === 'JP') return ipType === 'design' || ipType === 'trademark' ? 'jpo' : '';
  return '';
}

function fetchSnapshot(app, source, number, ipType) {
  if (source === 'uspto_tsdr') return fetchTsdr(app, number);
  if (source === 'euipo') return fetchEuipo(app, number, ipType);
  if (source === 'jpo') return fetchJpo(app, number, ipType);
  throw new Error('No office connection covers this jurisdiction and right type. Enter the data by hand.');
}

function connectionState(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = u.findMany(app, 'office_connections', '', 'office', 0);
  const out = {};
  for (const r of rows) {
    out[r.getString('office')] = {
      enabled: r.getBool('enabled'),
      status: r.getString('status'),
      has_secret: r.getBool('has_secret'),
      last_sync: r.getString('last_sync'),
      last_error: r.getString('last_error'),
      remaining_calls: r.getInt('remaining_calls'),
    };
  }
  return out;
}

const DIFF_FIELDS = [
  ['title', 'Title', 'text'],
  ['filing_date', 'Filing date', 'date'],
  ['publication_no', 'Publication number', 'text'],
  ['publication_date', 'Publication date', 'date'],
  ['registration_no', 'Registration number', 'text'],
  ['registration_date', 'Registration date', 'date'],
  ['owner_of_record', 'Owner of record', 'text'],
  ['office_status', 'Office status', 'text'],
  ['status', 'Status', 'text'],
];

function snapshotValue(s, field) {
  if (field === 'owner_of_record') return s.owner || '';
  if (field === 'office_status') return s.status_text || '';
  if (field === 'status') return s.status || '';
  return s[field] || '';
}

function diffMatter(matter, s) {
  const u = require(`${__hooks}/lib_util.js`);
  const diffs = [];
  for (const f of DIFF_FIELDS) {
    const incoming = snapshotValue(s, f[0]);
    if (incoming === '') continue;
    const current = f[2] === 'date' ? u.d10(matter.getString(f[0])) : matter.getString(f[0]);
    const inc = f[2] === 'date' ? u.d10(incoming) : String(incoming).trim();
    if (f[0] === 'title' && current !== '') continue; // titles are ours to keep once set
    if (current.trim() !== inc) diffs.push({ field: f[0], label: f[1], current: current, incoming: inc, kind: f[2] });
  }
  return diffs;
}

/** Office events not yet recorded on the matter (by code+date, raw by raw_code+date). */
function newEvents(app, matter, s) {
  const u = require(`${__hooks}/lib_util.js`);
  const have = {};
  const evs = u.findMany(app, 'events', 'matter = {:m}', '', 0, { m: matter.id });
  for (const e of evs) {
    have[e.getString('code') + '|' + u.d10(e.getString('date'))] = true;
    const d = u.j(e, 'data', {});
    if (d && d.raw_code) have['raw:' + d.raw_code + '|' + u.d10(e.getString('date'))] = true;
  }
  const out = [];
  for (const ev of s.events) {
    if (!ev.date) continue;
    const k = ev.code ? ev.code + '|' + ev.date : 'raw:' + ev.raw_code + '|' + ev.date;
    if (have[k]) continue;
    have[k] = true;
    out.push(ev);
  }
  return out;
}

/** Inbox title in the organization's default language. */
function inboxTitle(app, matter, nDiffs, nEvents, nAnnuity) {
  const u = require(`${__hooks}/lib_util.js`);
  const ja = String(u.setting(app, 'default_language', 'en')) === 'ja';
  const ref = matter.getString('ref') || matter.getString('title');
  const bits = [];
  if (ja) {
    if (nDiffs) bits.push('項目の変更' + nDiffs + '件');
    if (nEvents) bits.push('新しい官庁イベント' + nEvents + '件');
    if (nAnnuity) bits.push('公式の納付期限');
    return ref + '：' + bits.join('、');
  }
  if (nDiffs) bits.push(nDiffs + ' field change' + (nDiffs === 1 ? '' : 's'));
  if (nEvents) bits.push(nEvents + ' new office event' + (nEvents === 1 ? '' : 's'));
  if (nAnnuity) bits.push('official payment date');
  return ref + ': ' + bits.join(', ');
}

/** Sync one matter: files an Inbox item when anything changed. */
function syncMatter(app, matter, trigger) {
  const u = require(`${__hooks}/lib_util.js`);
  const source = matter.getString('sync_source') || sourceFor(matter.getString('ip_type'), matter.getString('jurisdiction'));
  const number = matter.getString('application_no') || matter.getString('registration_no');
  if (!source || source === 'none' || !number) return { skipped: true, reason: 'No office source or number.', reason_ja: '官庁連携先または番号がありません。' };
  let s;
  try {
    s = fetchSnapshot(app, source, number, matter.getString('ip_type'));
  } catch (err) {
    matter.set('sync_state', 'error');
    matter.set('sync_error', String(err.message || err).slice(0, 1000));
    matter.set('last_synced', new Date().toISOString());
    app.save(matter);
    return { error: String(err.message || err), quota: err && err.quota === true };
  }
  matter.set('last_synced', new Date().toISOString());
  if (!s.found) {
    matter.set('sync_state', 'not_found');
    matter.set('sync_error', 'The office has no record for ' + number + '.');
    app.save(matter);
    return { not_found: true };
  }
  matter.set('sync_state', 'connected');
  matter.set('sync_error', '');
  matter.set('sync_source', source);
  const snapshot = {
    source: s.source,
    fetched_at: s.fetched_at,
    status_text: s.status_text,
    status_code: s.status_code,
    next_annuity_date: s.next_annuity_date,
    expiry_date: s.expiry_date,
    classes: s.classes,
    lag_note: s.lag_note,
  };
  matter.set('official_data', snapshot);
  app.save(matter);
  const diffs = diffMatter(matter, s);
  const events = newEvents(app, matter, s);
  // JPO official next payment date (designs): propose it when it differs from the computed open annual fee.
  const annuityUpdates = [];
  if (s.next_annuity_date) {
    const open = u.findMany(app, 'deadlines', 'matter = {:m} && status = "open" && category = "renewal"', 'due_date', 1, { m: matter.id });
    if (open.length && u.d10(open[0].getString('due_date')) !== s.next_annuity_date) {
      annuityUpdates.push({ deadline_id: open[0].id, title: open[0].getString('title'), current: u.d10(open[0].getString('due_date')), incoming: s.next_annuity_date });
    }
  }
  if (!diffs.length && !events.length && !annuityUpdates.length) return { unchanged: true };
  const ja = String(u.setting(app, 'default_language', 'en')) === 'ja';
  const fp = source + ':' + matter.id + ':' + JSON.stringify(diffs.map((d) => d.field + '=' + d.incoming)) + ':' + events.map((e) => (e.code || e.raw_code) + e.date).join(',') + ':' + annuityUpdates.map((a) => a.incoming).join(',');
  const dup = u.findOne(app, 'inbox_items', 'fingerprint = {:f} && (status = "new" || status = "awaiting_second")', { f: fp.slice(0, 200) });
  if (dup !== null) return { duplicate: true };
  const rec = u.newRecord(app, 'inbox_items', {
    kind: 'office_change',
    title: inboxTitle(app, matter, diffs.length, events.length, annuityUpdates.length),
    summary: (ja ? s.source + '（' + u.humanJa(u.today()) + '取得）。' : 'From ' + s.source + ' on ' + u.human(u.today()) + '.') + (s.lag_note ? ' ' + s.lag_note : ''),
    status: 'new',
    subject_type: matter.getString('ip_type'),
    matter: matter.id,
    office: source,
    proposal: { events: events, annuity_updates: annuityUpdates, snapshot: snapshot },
    diffs: diffs,
    confidence: 'high',
    source: 'office_sync',
    proposed_by: s.source,
    fingerprint: fp.slice(0, 200),
  });
  app.save(rec);
  return { inbox_item: rec.id, diffs: diffs.length, events: events.length, trigger: trigger };
}

function syncAll(app, trigger) {
  const u = require(`${__hooks}/lib_util.js`);
  const state = connectionState(app);
  const results = {};
  const offices = ['uspto_tsdr', 'euipo', 'jpo'];
  for (const office of offices) {
    if (!state[office] || !state[office].enabled) continue;
    const run = u.newRecord(app, 'sync_runs', { office: office, trigger: trigger, status: 'running', checked: 0, changes: 0, errors: 0 });
    app.save(run);
    const matters = u.findMany(app, 'matters', 'sync_enabled = true && status_group != "dead"', 'last_synced', 0);
    let checked = 0;
    let changes = 0;
    let errors = 0;
    const messages = [];
    // JPO budget: prefer matters with a deadline in the next 90 days, rotate the rest.
    const soon = u.addDays(u.today(), 90);
    const ordered = matters.slice().sort(function (a, b) {
      const as = u.d10(a.getString('next_deadline'));
      const bs = u.d10(b.getString('next_deadline'));
      const ap = as !== '' && as <= soon ? 0 : 1;
      const bp = bs !== '' && bs <= soon ? 0 : 1;
      return ap - bp;
    });
    for (const m of ordered) {
      const src = m.getString('sync_source') || sourceFor(m.getString('ip_type'), m.getString('jurisdiction'));
      if (src !== office) continue;
      const res = syncMatter(app, m, trigger);
      if (res.skipped) continue;
      checked += 1;
      if (res.error) {
        errors += 1;
        if (messages.length < 5) messages.push((m.getString('ref') || m.id) + ': ' + res.error);
        if (res.quota) break;
      }
      if (res.inbox_item) changes += 1;
    }
    run.set('checked', checked);
    run.set('changes', changes);
    run.set('errors', errors);
    run.set('status', errors === 0 ? 'ok' : checked > errors ? 'partial' : 'error');
    run.set('message', messages.join('\n'));
    run.set('finished', new Date().toISOString());
    app.save(run);
    const c = conn(app, office);
    if (c !== null) {
      c.set('last_sync', new Date().toISOString());
      app.save(c);
    }
    results[office] = { checked: checked, changes: changes, errors: errors };
  }
  return results;
}

/** Light connection test (token or a tiny request). */
function testConnection(app, office) {
  const c = conn(app, office);
  if (c === null) throw new Error('Unknown office.');
  if (!c.getBool('enabled')) throw new Error('Turn the connection on first.');
  if (office === 'euipo') {
    c.set('token', '');
    app.save(c);
    euipoToken(app, c);
  } else if (office === 'jpo') {
    c.set('token', '');
    app.save(c);
    jpoToken(app, c);
  } else if (office === 'uspto_tsdr') {
    const res = send({
      url: 'https://tsdrapi.uspto.gov/ts/cd/casestatus/sn97000000/info',
      method: 'GET',
      headers: { 'USPTO-API-KEY': c.getString('api_key') },
      timeout: 30,
    });
    if (res.status === 401 || res.status === 403) throw new Error('The USPTO rejected the TSDR key (HTTP ' + res.status + ').');
  }
  markStatus(app, c, true, '');
  return { ok: true };
}

/** Monthly keep-alive: the JPO cancels IDs unused for a year. */
function jpoHeartbeat(app) {
  const c = conn(app, 'jpo');
  if (c === null || !c.getBool('enabled')) return false;
  jpoToken(app, c);
  return true;
}

module.exports = {
  OFFICE_LABEL: OFFICE_LABEL,
  sourceFor: sourceFor,
  fetchSnapshot: fetchSnapshot,
  connectionState: connectionState,
  diffMatter: diffMatter,
  newEvents: newEvents,
  syncMatter: syncMatter,
  syncAll: syncAll,
  testConnection: testConnection,
  jpoHeartbeat: jpoHeartbeat,
  normJpAppNo: normJpAppNo,
};
