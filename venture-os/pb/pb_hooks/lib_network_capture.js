/// <reference path="../pb_data/types.d.ts" />
/**
 * Capture (SPEC 7.5, REPORT Table 22): touches logged without anyone typing.
 *
 * Mail, every 15 minutes: message HEADERS only (get_gmail without the body)
 * from the owner's mailbox (the Google account CraftBot holds) and, when the
 * firm set one up, the firm's capture mailbox (a second Gmail account in
 * CraftBot that members BCC or copy), paged by time windows with the
 * cursor in capture_state until caught up (new mail first, then 30 days of
 * backfill), each run kept under about 20 seconds (15 s of reading; the
 * strength of the people touched follows within a minute). Calendar, every 10 minutes: the owner's Google
 * Calendar, two days back to eight days ahead, into cal_events; meetings
 * that ended become touches, external meetings within
 * 18 hours get a brief while the meeting_briefs switch is on (trigger
 * meeting_brief), and an ended external meeting emits
 * meeting.ended once.
 *
 * Consent is per member and opt-in (capture_state kind member): a touch is
 * logged only for members who turned capture on, and never with addresses
 * whose domain the firm or that member excluded. With nobody opted in the
 * mailboxes are not read at all. People found in headers are created
 * (origin capture); a free-mail address never makes a company (lib_records).
 * Bulk mail is skipped by its structure: Gmail's spam, trash, draft and
 * category labels, List-Id / List-Unsubscribe headers, Precedence bulk or
 * list, more than 25 addresses.
 *
 * Every bridge answer is checked for the HTTP 200 with { status: 'error' }
 * shape (lib_mail.answer). Outside CraftBot the bridge answers 503: the
 * source's state is `offline` and Settings, Capture says "Connect Gmail in
 * CraftBot".
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function N() {
  return L('lib_network');
}
function bridge() {
  return L('_craftbot_bridge');
}

const SOURCES = ['mail_owner', 'mail_firm', 'calendar'];
const SKIP_LABELS = ['SPAM', 'TRASH', 'DRAFT', 'CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_FORUMS', 'CATEGORY_UPDATES'];
const BULK_PRECEDENCE = ['bulk', 'list', 'junk'];
const MAX_ADDRESSES = 25;
const SEEN_KEEP = 5000;
const BACKFILL_DAYS = 30;
const PAGE = 100;
const DAY_SEC = 86400;
const MIN_WINDOW_SEC = 900;
const OVERLAP_SEC = 600;
const MAX_HEADERS_PER_RUN = 400;
const RUN_MS = 15000;
const QUERY_TAIL = ' -in:spam -in:trash -in:drafts -category:promotions -category:social -category:forums -category:updates';
const BRIEF_HOURS = 18;
const DAY_MS = 86400000;
const SYNC_GAP_MS = 30000;

/* --------------------------------------------------------------- state */

function sourceRow(app, key) {
  const util = u();
  let r = util.findOne(app, 'capture_state', "kind = 'source' && source = {:s}", { s: key });
  if (r === null) {
    r = util.newRecord(app, 'capture_state');
    r.set('kind', 'source');
    r.set('source', key);
    r.set('state', 'never');
    r.set('cursor', {});
    r.set('counts', {});
    r.set('actor', 'system');
    app.save(r);
  }
  return r;
}

function finishSource(app, r, state, error, counts, cursor) {
  const now = u().nowIso();
  r.set('state', state);
  r.set('error', u().clip(error || '', 600));
  r.set('last_try_at', now);
  if (state === 'ok' || state === 'partial') r.set('last_ok_at', now);
  if (counts) r.set('counts', counts);
  if (cursor) r.set('cursor', cursor);
  app.save(r);
}

function stateOf(reason) {
  return reason === 'offline' ? 'offline' : 'error';
}

/* ------------------------------------------------------------- headers */

/** An address list header ("Maya Chen <maya@x.com>, b@y.com") as [{ name, email }]. */
function addresses(raw) {
  const s = String(raw || '');
  const parts = [];
  let cur = '';
  let quote = false;
  let angle = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i);
    if (ch === '"') quote = !quote;
    else if (ch === '<' && !quote) angle = true;
    else if (ch === '>' && !quote) angle = false;
    if ((ch === ',' || ch === ';') && !quote && !angle) {
      parts.push(cur);
      cur = '';
    } else cur += ch;
  }
  parts.push(cur);
  const out = [];
  for (const p0 of parts) {
    const p = p0.trim();
    if (p === '') continue;
    const lt = p.lastIndexOf('<');
    const gt = p.lastIndexOf('>');
    let email;
    let name = '';
    if (lt >= 0 && gt > lt) {
      email = p.slice(lt + 1, gt).trim();
      name = p.slice(0, lt).trim().replace(/^"+|"+$/g, '').trim();
    } else email = p.replace(/^"+|"+$/g, '').trim();
    email = email.toLowerCase();
    if (!/^[^\s@<>,;"]+@[^\s@<>,;"]+\.[^\s@<>,;"]+$/.test(email)) continue;
    if (out.some((x) => x.email === email)) continue;
    out.push({ name: name, email: email });
  }
  return out;
}

function header(h, name) {
  if (!h) return '';
  if (Array.isArray(h)) {
    for (const x of h) if (x && String(x.name || '').toLowerCase() === name.toLowerCase()) return String(x.value || '');
    return '';
  }
  for (const k of Object.keys(h)) if (k.toLowerCase() === name.toLowerCase()) return String(h[k] || '');
  return '';
}

/** Is this message bulk mail by its structure (labels, list headers, precedence, size of the audience)? */
function bulk(labels, h, count) {
  for (const l of labels) if (SKIP_LABELS.indexOf(String(l)) >= 0) return true;
  if (header(h, 'List-Id') !== '' || header(h, 'List-Unsubscribe') !== '') return true;
  if (BULK_PRECEDENCE.indexOf(header(h, 'Precedence').trim().toLowerCase()) >= 0) return true;
  return count > MAX_ADDRESSES;
}

/* ------------------------------------------------------------- logging */

/**
 * Log one touch (deduped by ext_id). o: { who, kind, direction, at, people,
 * company, deal, cal_event, subject, source, ext_id }. Answers the record
 * or null when ext_id was already logged.
 */
function logTouch(ctx, o) {
  const util = u();
  const app = ctx.app;
  if (o.ext_id && util.findOne(app, 'interactions', 'ext_id = {:x}', { x: o.ext_id }) !== null) return null;
  const r = util.newRecord(app, 'interactions');
  r.set('kind', o.kind);
  r.set('direction', o.kind === 'email' || o.kind === 'message' ? o.direction || 'out' : o.direction || '');
  r.set('at', o.at);
  r.set('who', o.who);
  r.set('people', o.people);
  r.set('company', o.company || '');
  r.set('deal', o.deal || '');
  r.set('cal_event', o.cal_event || '');
  r.set('subject', util.clip(util.squash(o.subject || ''), 300));
  r.set('source', o.source);
  r.set('ext_id', util.clip(o.ext_id || '', 300));
  r.set('body_kept', false);
  r.set('actor', ctx.isAgent ? 'agent' : ctx.actor === 'person' ? 'person' : 'system');
  r.set('member', ctx.actor === 'person' ? ctx.memberId : '');
  r.set('run', ctx.isAgent ? ctx.run || '' : '');
  app.save(r);
  return r;
}

/** The company and deal of a touch: the first external person's company and its open deal. */
function companyAndDeal(app, people) {
  for (const pid of people) {
    const c = N().companyOfPerson(app, pid);
    if (c !== '') return { company: c, deal: N().dealOfCompany(app, c) };
  }
  return { company: '', deal: '' };
}

/* ---------------------------------------------------------------- mail */

function gmailSearch(account, query, max) {
  const params = { query: query, max_results: max };
  if (account) params.account = account;
  const a = L('lib_mail').answer(bridge().callAction('search_gmail', params));
  if (!a.ok) return a;
  const d = a.data || {};
  const list = Array.isArray(d.messages) ? d.messages : Array.isArray(d) ? d : [];
  return { ok: true, ids: list.map((m) => String(m.id || '')).filter((x) => x !== '') };
}

/** Headers of one message (get_gmail without the body). */
function gmailHeaders(account, id) {
  const params = { message_id: id, full_body: false };
  if (account) params.account = account;
  const a = L('lib_mail').answer(bridge().callAction('get_gmail', params));
  if (!a.ok) return a;
  const d = a.data || {};
  return { ok: true, id: String(d.id || id), labels: Array.isArray(d.labelIds) ? d.labelIds.map(String) : [], internal: Number(d.internalDate || 0), headers: d.headers || {} };
}

/**
 * Turn one message's headers into touches for the consenting members on it.
 * Answers the people touched.
 */
function mailTouches(ctx, fv, key, msg) {
  const app = ctx.app;
  const h = msg.headers;
  const from = addresses(header(h, 'From'));
  const to = addresses(header(h, 'To')).concat(addresses(header(h, 'Cc')));
  const all = from.concat(to);
  if (from.length === 0 || bulk(msg.labels, h, all.length)) return [];
  const capture = String(fv.config.capture_address || '').toLowerCase();
  const isMember = (e) => fv.byEmail[e] !== undefined;
  const sender = from[0];
  const sent = key === 'mail_owner' && msg.labels.indexOf('SENT') >= 0;
  // Who in the firm is on it, and in which direction.
  const sides = [];
  if (isMember(sender.email) || sent) {
    const m = isMember(sender.email) ? fv.byEmail[sender.email] : fv.owner;
    if (m) sides.push({ member: m.id, direction: 'out', others: to });
  } else {
    const recipients = to.filter((a) => isMember(a.email)).map((a) => fv.byEmail[a.email]);
    if (recipients.length === 0 && key === 'mail_owner' && fv.owner) recipients.push(fv.owner);
    for (const m of recipients) sides.push({ member: m.id, direction: 'in', others: [sender].concat(to) });
  }
  const at = msg.internal > 0 ? new Date(msg.internal).toISOString() : u().nowIso();
  const msgKey = u().clip(header(h, 'Message-ID').replace(/[<>\s]/g, '') || msg.id, 240);
  const touched = [];
  for (const s of sides) {
    if (!N().consented(fv, s.member)) continue;
    const ext = s.others.filter((a) => a.email !== capture && N().external(fv, a.email) && !N().excluded(fv, s.member, a.email));
    if (ext.length === 0) continue;
    const people = [];
    for (const a of ext) {
      const pid = N().personFor(ctx, a.email, a.name, true);
      if (pid !== '' && people.indexOf(pid) < 0) people.push(pid);
    }
    if (people.length === 0) continue;
    const cd = companyAndDeal(app, people);
    const r = logTouch(ctx, { who: s.member, kind: 'email', direction: s.direction, at: at, people: people, company: cd.company, deal: cd.deal, subject: header(h, 'Subject'), source: key === 'mail_owner' ? 'gmail' : 'capture_mailbox', ext_id: 'mail:' + msgKey + ':' + s.member });
    if (r !== null) for (const p of people) if (touched.indexOf(p) < 0) touched.push(p);
  }
  return touched;
}

/**
 * One mail source, paged by time windows until caught up. Gmail's search
 * answers at most 100 ids and has no page token, so the cursor in
 * capture_state walks windows of at most a day (`after:` and `before:` in
 * epoch seconds): forward from `hw` to now (new mail first), then back from
 * `back` to 30 days ago (the backfill). A window answering 100 ids is split
 * in halves until each holds fewer (down to 15 minutes). A window counts as
 * done only when every id in it was read; ids already read are kept
 * (`seen`) so a window the run had to leave is resumed, not read again.
 * The run stops at `deadline` (ms) or after MAX_HEADERS_PER_RUN headers.
 */
function captureMail(app, key, deadline) {
  const util = u();
  const fv = N().firmView(app);
  const r = sourceRow(app, key);
  const account = key === 'mail_firm' ? fv.config.capture_account : '';
  if (key === 'mail_firm' && account === '') {
    finishSource(app, r, 'never', '', { skipped: 'no capture mailbox' }, null);
    return { source: key, state: 'never', logged: 0 };
  }
  const anyone = Object.keys(fv.consent).some((id) => fv.consent[id].consent === true);
  if (!anyone) {
    finishSource(app, r, r.getString('state') === 'never' ? 'never' : r.getString('state'), '', { skipped: 'nobody opted in' }, null);
    return { source: key, state: 'skipped', logged: 0 };
  }
  const until = typeof deadline === 'number' ? deadline : Date.now() + RUN_MS;
  const nowSec = Math.floor(Date.now() / 1000);
  const limit = nowSec - BACKFILL_DAYS * DAY_SEC;
  const cursor = util.jsonOf(r, 'cursor', {}) || {};
  if (!(Number(cursor.hw) > 0) || !(Number(cursor.back) > 0)) {
    cursor.hw = nowSec - 2 * DAY_SEC;
    cursor.back = nowSec - 2 * DAY_SEC;
  }
  const seenList = Array.isArray(cursor.seen) ? cursor.seen : [];
  const seen = {};
  for (const id of seenList) seen[id] = true;
  const ctx = L('lib_auth').systemCtx(app);
  const st = { headers: 0, read: 0, logged: 0, errors: 0, searches: 0, lastError: '', touched: [], stop: '' };
  const left = () => Date.now() < until && st.headers < MAX_HEADERS_PER_RUN;

  /** Every id of a window, splitting it while it answers a full page: { ok, ids } or a failed answer. */
  const windowIds = (from, to, depth) => {
    st.searches++;
    const s = gmailSearch(account, 'after:' + from + ' before:' + to + QUERY_TAIL, PAGE);
    if (!s.ok) return s;
    if (s.ids.length < PAGE || to - from <= MIN_WINDOW_SEC || depth >= 10) return s;
    const mid = Math.floor((from + to) / 2);
    const a = windowIds(from, mid, depth + 1);
    if (!a.ok) return a;
    const b = windowIds(mid, to, depth + 1);
    if (!b.ok) return b;
    const ids = a.ids.slice();
    for (const id of b.ids) if (ids.indexOf(id) < 0) ids.push(id);
    return { ok: true, ids: ids };
  };

  /** Read the unseen ids of one window: true when the whole window is done. */
  const drain = (from, to) => {
    const w = windowIds(from, to, 0);
    if (!w.ok) {
      st.stop = stateOf(w.reason);
      st.lastError = w.error;
      return false;
    }
    for (const id of w.ids) {
      if (seen[id]) continue;
      if (!left()) return false;
      st.headers++;
      const msg = gmailHeaders(account, id);
      if (!msg.ok) {
        st.errors++;
        st.lastError = msg.error;
        if (msg.reason === 'offline') {
          st.stop = 'offline';
          return false;
        }
        continue;
      }
      st.read++;
      try {
        app.runInTransaction((tx) => {
          const got = mailTouches(L('lib_auth').withApp(ctx, tx), fv, key, msg);
          for (const p of got) if (st.touched.indexOf(p) < 0) st.touched.push(p);
          if (got.length > 0) st.logged++;
        });
      } catch (err) {
        st.errors++;
        st.lastError = String((err && err.message) || err);
        console.error('[vo] capture ' + key + ' message ' + id + ' failed:', err);
      }
      seen[id] = true;
      seenList.push(id);
    }
    return true;
  };

  // New mail first: forward from the high-water mark to now (a 10 minute overlap catches late arrivals).
  while (left() && st.stop === '' && cursor.hw < nowSec) {
    const to = Math.min(cursor.hw + DAY_SEC, nowSec);
    if (!drain(cursor.hw, to)) break;
    cursor.hw = to >= nowSec ? nowSec - OVERLAP_SEC : to;
    if (to >= nowSec) break;
  }
  // Then the backfill, one window at a time toward 30 days ago.
  while (left() && st.stop === '' && cursor.back > limit) {
    const from = Math.max(cursor.back - DAY_SEC, limit);
    if (!drain(from, cursor.back)) break;
    cursor.back = from;
  }
  cursor.seen = seenList.slice(-SEEN_KEEP);
  // Strength for the people touched is the minute job's (outside this run's time budget).
  if (st.touched.length > 0) N().markDirty(app, st.touched);
  const caughtUp = cursor.hw >= nowSec - OVERLAP_SEC && cursor.back <= limit;
  const counts = { read: st.read, logged: st.logged, errors: st.errors, searches: st.searches, caught_up: caughtUp, backfill_days: Math.max(0, Math.round((nowSec - cursor.back) / DAY_SEC)) };
  if (st.stop !== '') {
    finishSource(app, r, st.stop, st.lastError, counts, cursor);
    return Object.assign({ source: key, state: st.stop, error: st.lastError }, counts);
  }
  const state = st.errors > 0 ? (st.read > 0 ? 'partial' : 'error') : 'ok';
  finishSource(app, r, state, st.lastError, counts, cursor);
  return Object.assign({ source: key, state: state }, counts);
}

/* ------------------------------------------------------------ calendar */

function eventTimes(ev) {
  if (!ev || !ev.start || !ev.start.dateTime) return null;
  const s = Date.parse(ev.start.dateTime);
  const e = Date.parse(ev.end && ev.end.dateTime ? ev.end.dateTime : ev.start.dateTime);
  if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
  return { start: new Date(s).toISOString(), end: new Date(Math.max(e, s)).toISOString() };
}

function meetOf(ev) {
  if (ev.hangoutLink) return String(ev.hangoutLink);
  const eps = (ev.conferenceData && ev.conferenceData.entryPoints) || [];
  for (const x of eps) if (x && x.entryPointType === 'video' && x.uri) return String(x.uri);
  return '';
}

/** Store one Google event (insert or update); answers the record. */
function saveEvent(ctx, fv, ev, times) {
  const util = u();
  const app = ctx.app;
  const owner = fv.owner;
  const raw = Array.isArray(ev.attendees) ? ev.attendees : [];
  const list = raw.length > 0 ? raw : ev.organizer && ev.organizer.email ? [Object.assign({ organizer: true, responseStatus: 'accepted' }, ev.organizer)] : [];
  const attendees = [];
  for (const a of list) {
    const email = String((a && a.email) || '').toLowerCase();
    if (email === '' || a.resource === true) continue;
    const member = a.self === true && owner ? owner : fv.byEmail[email];
    const ext = member === undefined && N().external(fv, email) && !N().domainIn(N().domainOf(email), fv.exclude);
    attendees.push({ email: email, name: util.clip(String(a.displayName || ''), 160), response: String(a.responseStatus || ''), organizer: a.organizer === true, member: member ? member.id : '', person: '', external: ext });
  }
  const consentingHere = attendees.some((a) => a.member !== '' && N().consented(fv, a.member) && a.response !== 'declined');
  for (const a of attendees) if (a.external) a.person = N().personFor(ctx, a.email, a.name, consentingHere);
  const external = attendees.some((a) => a.external);
  let company = '';
  let deal = '';
  if (external) {
    const cd = companyAndDeal(
      app,
      attendees.filter((a) => a.external && a.person !== '').map((a) => a.person),
    );
    company = cd.company;
    deal = cd.deal;
  }
  let r = util.findOne(app, 'cal_events', 'ext_id = {:x}', { x: String(ev.id) });
  if (r === null) {
    r = util.newRecord(app, 'cal_events');
    r.set('ext_id', String(ev.id));
    r.set('note_state', 'none');
    r.set('ended_at', '');
  }
  r.set('calendar', 'primary');
  r.set('owner', owner ? owner.id : '');
  r.set('title', util.clip(String(ev.summary || 'Meeting'), 300));
  r.set('location', util.clip(String(ev.location || ''), 300));
  r.set('meet', util.clip(meetOf(ev), 500));
  r.set('link', util.clip(String(ev.htmlLink || ''), 1000));
  r.set('start_at', times.start);
  r.set('end_at', times.end);
  r.set('all_day', false);
  r.set('attendees', attendees);
  r.set('external', external);
  r.set('company', company);
  if (r.getString('deal') === '' || deal !== '') r.set('deal', deal);
  r.set('status', ev.status === 'cancelled' ? 'cancelled' : ev.status === 'tentative' ? 'tentative' : 'confirmed');
  r.set('synced_at', util.nowIso());
  app.save(r);
  // A brief follows its meeting's company and deal (a deal opened after the brief was queued).
  const b = util.findOne(app, 'briefs', 'cal_event = {:e}', { e: r.id });
  if (b !== null && (b.getString('deal') !== r.getString('deal') || b.getString('company') !== r.getString('company'))) {
    b.set('deal', r.getString('deal'));
    b.set('company', r.getString('company'));
    app.save(b);
  }
  return r;
}

/** A past external meeting becomes a touch for each consenting member who did not decline. */
function meetingTouches(ctx, fv, r) {
  const people = [];
  const atts = u().jsonOf(r, 'attendees', []) || [];
  const touched = [];
  for (const a of atts) if (a.external && a.person && a.response !== 'declined' && people.indexOf(a.person) < 0) people.push(a.person);
  if (people.length === 0) return touched;
  for (const a of atts) {
    if (!a.member || a.response === 'declined' || !N().consented(fv, a.member)) continue;
    const mine = people.filter((pid) => {
      const p = atts.filter((x) => x.person === pid)[0];
      return p && !N().excluded(fv, a.member, p.email);
    });
    if (mine.length === 0) continue;
    const t = logTouch(ctx, { who: a.member, kind: 'meeting', at: r.getString('start_at'), people: mine, company: r.getString('company'), deal: r.getString('deal'), cal_event: r.id, subject: r.getString('title'), source: 'calendar', ext_id: 'cal:' + r.getString('ext_id') + ':' + a.member });
    if (t !== null) for (const p of mine) if (touched.indexOf(p) < 0) touched.push(p);
  }
  return touched;
}

/** The calendar source: read the window, store events, log past meetings, queue briefs, emit meeting.ended. */
function captureCalendar(app) {
  const util = u();
  const fv = N().firmView(app);
  const r = sourceRow(app, 'calendar');
  const now = Date.now();
  const tmin = new Date(now - 2 * DAY_MS).toISOString();
  const tmax = new Date(now + 8 * DAY_MS).toISOString();
  if (L('lib_mail').demo(app)) return { source: 'calendar', state: 'demo', error: '' };
  const a = L('lib_mail').answer(bridge().callAction('list_google_calendar_events', { calendar_id: 'primary', time_min: tmin, time_max: tmax, max_results: 250 }));
  if (!a.ok) {
    finishSource(app, r, stateOf(a.reason), a.error, null, null);
    return { source: 'calendar', state: stateOf(a.reason), error: a.error };
  }
  const items = Array.isArray(a.data) ? a.data : (a.data && a.data.items) || [];
  const ctx = L('lib_auth').systemCtx(app);
  const seen = {};
  const touched = [];
  let stored = 0;
  let errors = 0;
  let lastError = '';
  for (const ev of items) {
    const times = eventTimes(ev);
    if (!ev || !ev.id || times === null) continue;
    seen[String(ev.id)] = true;
    try {
      app.runInTransaction((tx) => {
        const c = L('lib_auth').withApp(ctx, tx);
        const rec = saveEvent(c, fv, ev, times);
        stored++;
        if (rec.getBool('external') && rec.getString('status') !== 'cancelled' && Date.parse(rec.getString('end_at')) <= now) {
          for (const p of meetingTouches(c, fv, rec)) if (touched.indexOf(p) < 0) touched.push(p);
        }
      });
    } catch (err) {
      errors++;
      lastError = String((err && err.message) || err);
      console.error('[vo] calendar event ' + ev.id + ' failed:', err);
    }
  }
  // Events in the window Google no longer returns are gone.
  for (const e of util.findMany(app, 'cal_events', "start_at >= {:a} && start_at <= {:b} && status != 'gone'", '', 0, { a: tmin, b: tmax })) {
    if (seen[e.getString('ext_id')]) continue;
    e.set('status', 'gone');
    app.save(e);
  }
  if (touched.length > 0) N().recompute(app, touched);
  const briefs = queueBriefs(app, now);
  const ended = endMeetings(app, now);
  const state = errors > 0 ? (stored > 0 ? 'partial' : 'error') : 'ok';
  finishSource(app, r, state, lastError, { events: stored, briefs: briefs, ended: ended, errors: errors }, null);
  return { source: 'calendar', state: state, events: stored, briefs: briefs, ended: ended };
}

/** External meetings starting within 18 hours get a brief (once), only while the firm's meeting_briefs switch is on. */
function queueBriefs(app, now) {
  const util = u();
  let n = 0;
  if (L('lib_mail').demo(app) || !L('lib_agent').policyOn(app, 'meeting_briefs')) return 0;
  const W = L('lib_network_work');
  for (const e of util.findMany(app, 'cal_events', "external = true && (status = 'confirmed' || status = 'tentative') && start_at > {:a} && start_at <= {:b}", 'start_at', 100, { a: new Date(now).toISOString(), b: new Date(now + BRIEF_HOURS * 3600000).toISOString() })) {
    if (util.findOne(app, 'briefs', 'cal_event = {:e}', { e: e.id }) !== null) continue;
    try {
      if (W.autoBrief(app, e) !== '') n++;
    } catch (err) {
      console.error('[vo] brief for ' + e.id + ' failed:', err);
    }
  }
  return n;
}

/** Ended external meetings: meeting.ended once (within two days; older ones end quietly). */
function endMeetings(app, now) {
  const util = u();
  let n = 0;
  const nowIso = new Date(now).toISOString();
  const recent = new Date(now - 2 * DAY_MS).toISOString();
  for (const e of util.findMany(app, 'cal_events', "external = true && ended_at = '' && end_at <= {:n} && (status = 'confirmed' || status = 'tentative')", 'end_at', 200, { n: nowIso })) {
    const fresh = e.getString('end_at') >= recent;
    e.set('ended_at', nowIso);
    if (!fresh) e.set('note_state', 'skipped');
    app.save(e);
    if (!fresh) continue;
    L('lib_events').emit(L('lib_auth').systemCtx(app), 'meeting.ended', { cal_event: e.id, deal: e.getString('deal'), company: e.getString('company') });
    n++;
  }
  return n;
}

/* ---------------------------------------------------------------- cron */

/**
 * One run at a time per kind (the cron and capture.sync could meet): a lock
 * in the app store, taken for at most two minutes; a run that finds it
 * held answers `busy` and reads nothing.
 */
function locked(app, key, run) {
  const name = 'vo_capture_lock_' + key;
  const held = Number(app.store().get(name) || 0);
  if (held > Date.now() - 120000) return null;
  app.store().set(name, String(Date.now()));
  try {
    return run();
  } finally {
    app.store().remove(name);
  }
}

/** The mail cron (and capture.sync): both mailboxes within 15 seconds of reading (the owner's gets two thirds when a capture mailbox is set up). */
function cronMail(app) {
  const out = locked(app, 'mail', () => {
    const start = Date.now();
    const firm = N().firmConfig(app).capture_account !== '';
    return [captureMail(app, 'mail_owner', start + (firm ? Math.round(RUN_MS * 0.66) : RUN_MS)), captureMail(app, 'mail_firm', start + RUN_MS)];
  });
  L('lib_bus').flush(app);
  return out === null ? [{ source: 'mail_owner', state: 'busy' }, { source: 'mail_firm', state: 'busy' }] : out;
}

function cronCalendar(app) {
  const out = locked(app, 'calendar', () => captureCalendar(app));
  L('lib_bus').flush(app);
  return out === null ? { source: 'calendar', state: 'busy' } : out;
}

/* ----------------------------------------------------------------- ops */

function memberRow(app, memberId) {
  return u().findOne(app, 'capture_state', "kind = 'member' && who = {:m}", { m: memberId });
}

function domainList(p, name) {
  const util = u();
  const n = L('lib_norm');
  const raw = util.list(p, name);
  if (raw === undefined) return undefined;
  const out = [];
  for (const x of raw) {
    const d = n.domain(String(x || ''));
    if (d === '') throw util.fail(400, name + ': "' + util.clip(String(x), 80) + '" is not a domain such as example.com.', 'invalid_param', { param: name });
    if (out.indexOf(d) < 0) out.push(d);
  }
  if (out.length > 200) throw util.fail(400, name + ' takes at most 200 domains.', 'invalid_param', { param: name });
  return out;
}

/** capture.status: each source's state, the firm's capture settings, each member's consent. */
function opStatus(ctx) {
  const util = u();
  const app = ctx.app;
  const sources = {};
  for (const key of SOURCES) {
    const r = util.findOne(app, 'capture_state', "kind = 'source' && source = {:s}", { s: key });
    sources[key] = r === null ? { state: 'never', error: '', last_ok_at: '', last_try_at: '', counts: {} } : { state: r.getString('state') || 'never', error: r.getString('error'), last_ok_at: r.getString('last_ok_at'), last_try_at: r.getString('last_try_at'), counts: util.jsonOf(r, 'counts', {}) || {} };
  }
  const fv = N().firmView(app);
  const cons = fv.consent;
  const people = N()
    .members(app)
    .filter((m) => m.status === 'active')
    .map((m) => ({ id: m.id, name: m.name, email: m.email, me: m.id === ctx.memberId, consent: cons[m.id] ? cons[m.id].consent : false, exclude_domains: cons[m.id] && m.id === ctx.memberId ? cons[m.id].exclude : [], excluded: cons[m.id] ? cons[m.id].exclude.length : 0 }));
  const mail = L('lib_mail').labels(app);
  const bridgeUp = L('lib_mail').bridgeUp();
  const offline = !bridgeUp || sources.mail_owner.state === 'offline' || sources.calendar.state === 'offline';
  return {
    gmail: offline ? 'offline' : sources.mail_owner.state === 'error' || sources.calendar.state === 'error' ? 'error' : sources.mail_owner.state === 'never' && sources.calendar.state === 'never' ? 'waiting' : 'connected',
    bridge: bridgeUp,
    sources: sources,
    firm: { capture_address: fv.config.capture_address, capture_account: fv.config.capture_account, firm_domains: fv.config.firm_domains, derived_domains: fv.firmDomains.filter((d) => fv.config.firm_domains.indexOf(d) < 0), exclude_domains: fv.config.exclude_domains },
    labels: [mail.deals_label, mail.updates_label],
    members: people,
    me: people.filter((m) => m.me)[0] || null,
    interactions: util.count(app, 'SELECT COUNT(*) AS n FROM interactions'),
  };
}

/** capture.consent: a person turns capture of their own mail and meetings on or off, and names domains to leave out. */
function opConsent(ctx, p) {
  const util = u();
  if (!ctx.memberId) throw util.fail(403, 'Only a signed-in person sets their own capture consent.', 'not_permitted');
  const consent = util.bool(p, 'consent', undefined);
  const exclude = domainList(p, 'exclude_domains');
  if (consent === undefined && exclude === undefined) throw util.fail(400, 'Give --consent true|false or --exclude_domains \'["example.com"]\'.', 'missing_param', { param: 'consent' });
  let r = memberRow(ctx.app, ctx.memberId);
  const before = r === null ? { consent: false, exclude_domains: [] } : { consent: r.getBool('consent'), exclude_domains: util.jsonOf(r, 'exclude_domains', []) || [] };
  if (r === null) {
    r = util.newRecord(ctx.app, 'capture_state');
    r.set('kind', 'member');
    r.set('who', ctx.memberId);
    r.set('source', '');
    r.set('exclude_domains', []);
  }
  if (consent !== undefined) {
    r.set('consent', consent);
    r.set('consent_at', util.nowIso());
  }
  if (exclude !== undefined) r.set('exclude_domains', exclude);
  r.set('actor', 'person');
  r.set('member', ctx.memberId);
  ctx.app.save(r);
  const after = { consent: r.getBool('consent'), exclude_domains: util.jsonOf(r, 'exclude_domains', []) || [] };
  L('lib_audit').note(ctx, { collection: 'capture_state', record: r.id, summary: (after.consent ? 'Capture on' : 'Capture off') + ' for ' + ctx.name + (after.exclude_domains.length > 0 ? ' (' + after.exclude_domains.length + ' domains left out)' : ''), before: before, after: after });
  return after;
}

/** capture.configure: the firm's capture mailbox, its own domains and domains never captured. */
function opConfigure(ctx, p) {
  const util = u();
  const app = ctx.app;
  let r = N().firmRow(app);
  const cur = N().firmConfig(app);
  const next = Object.assign({}, cur);
  if (util.has(p, 'capture_address')) {
    const a = util.str(p, 'capture_address', '').toLowerCase();
    if (a !== '' && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(a)) throw util.fail(400, 'capture_address must be an email address.', 'invalid_param', { param: 'capture_address' });
    next.capture_address = a;
  }
  if (util.has(p, 'capture_account')) next.capture_account = util.text(p, 'capture_account', 200, '');
  const fd = domainList(p, 'firm_domains');
  if (fd !== undefined) next.firm_domains = fd;
  const ex = domainList(p, 'exclude_domains');
  if (ex !== undefined) next.exclude_domains = ex;
  if (r === null) {
    r = util.newRecord(app, 'capture_state');
    r.set('kind', 'firm');
    r.set('who', '');
    r.set('source', '');
  }
  r.set('config', next);
  r.set('actor', 'person');
  r.set('member', ctx.memberId);
  app.save(r);
  L('lib_audit').note(ctx, { collection: 'capture_state', record: r.id, summary: 'Changed the firm capture settings', before: cur, after: next });
  return next;
}

/** capture.sync: read mail and the calendar now (at most once in 30 seconds). */
function opSync(ctx, p) {
  const util = u();
  const app = ctx.app;
  const what = util.oneOf(p, 'what', ['all', 'mail', 'calendar'], 'all');
  const key = 'vo_capture_sync_at_' + what;
  const last = Number(app.store().get(key) || 0);
  if (Date.now() - last < SYNC_GAP_MS) throw util.fail(409, 'Capture ran a moment ago; it runs again in ' + Math.ceil((SYNC_GAP_MS - (Date.now() - last)) / 1000) + ' seconds.', 'too_soon');
  app.store().set(key, String(Date.now()));
  const out = {};
  if (what !== 'calendar') out.mail = cronMail(app);
  if (what !== 'mail') out.calendar = cronCalendar(app);
  ctx.audited = true;
  return out;
}

/** interactions.list: touches of a person, company, deal or member, newest first. */
function opList(ctx, p) {
  const util = u();
  const app = ctx.app;
  const pg = util.page(p, 50, 300);
  const where = [];
  const bind = {};
  const recs = L('lib_records');
  const person = util.str(p, 'person', '');
  if (person !== '') {
    where.push('EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value = {:p})');
    bind.p = recs.resolve(app, 'people', person).id;
  }
  const company = util.str(p, 'company', '');
  if (company !== '') {
    const cid = recs.resolve(app, 'companies', company).id;
    const ids = N().peopleOfCompany(app, cid).slice(0, 300);
    const ph = ids.map((id, i) => ((bind['cp' + i] = id), '{:cp' + i + '}'));
    where.push('(i.company = {:c}' + (ph.length > 0 ? ' OR EXISTS (SELECT 1 FROM json_each(i.people) j WHERE j.value IN (' + ph.join(',') + '))' : '') + ')');
    bind.c = cid;
  }
  const deal = util.str(p, 'deal', '');
  if (deal !== '') {
    const d = L('lib_deals').ref(app, deal);
    L('lib_deals').guard(ctx, d);
    where.push('i.deal = {:d}');
    bind.d = d.id;
  }
  const member = util.str(p, 'member', '');
  if (member !== '') {
    where.push('i.who = {:m}');
    bind.m = L('lib_auth').memberRef(app, member).id;
  }
  const kind = util.oneOf(p, 'kind', ['meeting', 'call', 'email', 'message'], '');
  if (kind !== '') {
    where.push('i.kind = {:k}');
    bind.k = kind;
  }
  const w = where.length > 0 ? ' WHERE ' + where.join(' AND ') : '';
  const total = util.count(app, 'SELECT COUNT(*) AS n FROM interactions i' + w, bind);
  const rows = util.rows(app, 'SELECT i.id AS id FROM interactions i' + w + ' ORDER BY i.at DESC LIMIT ' + (pg.limit + 200) + ' OFFSET ' + pg.offset, { id: '' }, bind);
  const mm = N().memberNames(app);
  const cache = {};
  const out = [];
  let hidden = 0;
  for (const x of rows) {
    if (out.length >= pg.limit) break;
    const r = app.findRecordById('interactions', x.id);
    if (r.getString('deal') !== '' && !L('lib_auth').dealVisible(ctx, r.getString('deal'))) {
      hidden++;
      continue;
    }
    const mine = ctx.isAgent || ctx.owner || r.getString('who') === ctx.memberId;
    out.push({
      id: r.id,
      kind: r.getString('kind'),
      direction: r.getString('direction'),
      at: r.getString('at'),
      member: mm[r.getString('who')] || { id: r.getString('who'), name: 'Member' },
      people: r.getStringSlice('people').map((id) => N().personMini(app, id, cache)),
      company: r.getString('company') !== '' ? recs.mini(app, 'companies', r.getString('company')) : null,
      deal: r.getString('deal') !== '' ? N().dealMini(ctx, r.getString('deal')).deal : null,
      subject: mine ? r.getString('subject') : '',
      subject_hidden: !mine && r.getString('subject') !== '',
      source: r.getString('source'),
      actor: r.getString('actor'),
    });
  }
  return { interactions: out, total: total, hidden: hidden };
}

/** interactions.log: one touch (a call, a meeting, an email, a message) by hand or by your AI agent, deduped by ext_id. */
function opLog(ctx, p) {
  const util = u();
  const app = ctx.app;
  const kind = util.oneOf(p, 'kind', ['meeting', 'call', 'email', 'message'], '');
  if (kind === '') throw util.fail(400, 'kind is required: meeting, call, email or message.', 'missing_param', { param: 'kind' });
  const direction = util.oneOf(p, 'direction', ['in', 'out'], kind === 'email' || kind === 'message' ? 'out' : '');
  let whoId = ctx.memberId;
  const member = util.str(p, 'member', '');
  if (member !== '') whoId = L('lib_auth').memberRef(app, member).id;
  if (!whoId) throw util.fail(400, 'Say whose touch it is: --member <member email or id>.', 'missing_param', { param: 'member' });
  const fv = N().firmView(app);
  if (ctx.isAgent && !N().consented(fv, whoId)) throw util.fail(403, 'That member has not turned capture on; touches are logged for them only with their consent.', 'no_consent');
  let at = util.str(p, 'at', '');
  if (at === '') at = util.nowIso();
  else if (util.isDay(at)) at = util.atOf(app, at, '12:00');
  else {
    const ms = Date.parse(at);
    if (!Number.isFinite(ms)) throw util.fail(400, 'at is an ISO time such as 2026-11-12T14:30:00Z or a day YYYY-MM-DD.', 'invalid_param', { param: 'at' });
    at = new Date(ms).toISOString();
  }
  if (Date.parse(at) > Date.now() + 60000) throw util.fail(400, 'at is in the future; log a touch after it happened.', 'invalid_param', { param: 'at' });
  const refs = util.list(p, 'people') || [];
  if (refs.length === 0) throw util.fail(400, 'people is required: a JSON list of person ids or email addresses.', 'missing_param', { param: 'people' });
  const people = [];
  for (const ref of refs) {
    const s = String(ref || '').trim();
    if (s === '') continue;
    let id = '';
    if (s.indexOf('@') > 0) {
      if (!N().external(fv, s)) throw util.fail(400, s + ' is in the firm; touches are with people outside it.', 'invalid_param', { param: 'people' });
      id = N().personFor(ctx, s, '', true);
    } else id = L('lib_records').resolve(app, 'people', s).id;
    if (id !== '' && people.indexOf(id) < 0) people.push(id);
  }
  if (people.length === 0) throw util.fail(400, 'people names nobody.', 'invalid_param', { param: 'people' });
  let deal = '';
  if (util.str(p, 'deal', '') !== '') {
    const d = L('lib_deals').ref(app, util.str(p, 'deal', ''));
    L('lib_deals').guard(ctx, d);
    deal = d.id;
  }
  const cd = companyAndDeal(app, people);
  const extId = util.text(p, 'ext_id', 240, '');
  const r = logTouch(ctx, { who: whoId, kind: kind, direction: direction, at: at, people: people, company: cd.company, deal: deal || cd.deal, subject: util.text(p, 'subject', 300, ''), source: ctx.isAgent ? 'agent' : 'manual', ext_id: extId !== '' ? 'log:' + extId : '' });
  if (r === null) return { logged: false, duplicate: true, ext_id: extId };
  // Strength rows are derived: written after this op commits (the minute job), never inside its undo unit.
  N().markDirty(app, people);
  L('lib_audit').note(ctx, { collection: 'interactions', record: r.id, summary: 'Logged a ' + kind + ' with ' + people.length + (people.length === 1 ? ' person' : ' people') });
  const now = N().scoresFor(app, people);
  return { logged: true, interaction: r.id, people: people, strength: people.map((id) => Object.assign({ person: id }, now[id])) };
}

module.exports = {
  SOURCES: SOURCES,
  addresses: addresses,
  bulk: bulk,
  logTouch: logTouch,
  captureMail: captureMail,
  captureCalendar: captureCalendar,
  cronMail: cronMail,
  cronCalendar: cronCalendar,
  opStatus: opStatus,
  opConsent: opConsent,
  opConfigure: opConfigure,
  opSync: opSync,
  opList: opList,
  opLog: opLog,
};
