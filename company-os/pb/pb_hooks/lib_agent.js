/// <reference path="../pb_data/types.d.ts" />
/**
 * Company OS: agent operations (plain module). require() it INSIDE each route
 * handler, exactly like lib_company.js: PocketBase runs every handler in an
 * isolated VM, so nothing at file scope of a *.pb.js file is visible there.
 *
 * Every operation does only what a person can already do (or see) in the app,
 * through the same collections, fields, formats and side effects as the UI.
 * Each mirrored rule cites its screen (frontend/src/app/...). The domain
 * engines (journey autocheck, stage check, process templates) are reused from
 * lib_company.js; no existing hook is changed.
 *
 * Callers are a signed-in, approved person, or the app's operator (an agent
 * running as the superuser), which acts for the owner: "CraftBot, connected as
 * your agent, can operate everything here on your behalf" (pages/Settings.tsx).
 *
 * JSVM notes: query results are Go slices, so they are always copied with
 * Array.from() before any sort; base64 goes through Go's encoding/json (a
 * []byte field decodes from and encodes to base64 natively), because a
 * pure-JS codec takes about a minute per 10 MB in this runtime.
 */

var MB = 1024 * 1024;
var DAY_MS = 24 * 3600 * 1000;
var DOWNLOAD_LIMIT = 10 * MB; // content returned inline up to this size
var UPLOAD_LIMIT = 20 * MB; // keeps the JSON request under PocketBase's 32 MB body cap
var CARD_FILE_LIMIT = 10485760; // kanban_cards.attachments maxSize (1700000400_kanban.js)
var CARD_FILE_MAX = 10; // kanban_cards.attachments maxSelect

/** types.ts:43-48 */
var DEFAULT_VOCAB = {
  customer_one: 'Customer',
  customer_many: 'Customers',
  pipeline: ['Lead', 'Active', 'Past'],
  project_word: 'Project',
};

/** components/ActivateGate.tsx:242-275 (titles only). */
var MODULE_TITLE = {
  customers: 'Customers',
  money: 'Money',
  kanban: 'Kanban',
  goals: 'Goals',
  team: 'Team',
  meetings: 'Meetings',
  processes: 'Processes',
  marketing: 'Marketing',
};

/** pages/Journey.tsx:16-22 */
var STAGE_TAGLINES = {
  validate: 'Find out if it works before you build it',
  setup: 'Make it official and ready to sell',
  first_customers: 'Turn the idea into money in',
  grow: 'Build the team and the rhythm',
  scale: 'Systems that run without you in every room',
};

var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** pages/Marketing.tsx:70-75 */
var GOAL_META = {
  awareness: { label: 'Get known', blurb: 'Reach new people who have never heard of you.', unit: 'reached', money: false },
  leads: { label: 'Get leads', blurb: 'Turn strangers into people who show interest.', unit: 'leads', money: false },
  sales: { label: 'Get sales', blurb: 'Turn interest into money in.', unit: 'in sales', money: true },
  loyalty: { label: 'Keep customers', blurb: 'Repeat business and referrals from people you already won.', unit: 'repeat', money: false },
};
var CAMPAIGN_GOALS = ['awareness', 'leads', 'sales', 'loyalty'];
var CAMPAIGN_STATUS_ORDER = ['active', 'planned', 'paused', 'done']; // Marketing.tsx:83
var CONTENT_STATUS_ORDER = ['idea', 'draft', 'scheduled', 'published']; // Marketing.tsx:91

/** pages/Team.tsx:83-90, 395-399 */
var CANDIDATE_LABEL = { applied: 'Applied', screening: 'Screening', interview: 'Interview', offer: 'Offer', hired: 'Hired', passed: 'Passed' };
var ROLE_LABEL = { owner: 'Owner', admin: 'Admin', member: 'Member', '': 'Member' };

/** Common browser types, for uploads without an explicit mime (the browser
 *  sends file.type, Files.tsx:208). */
var MIME_BY_EXT = {
  pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', csv: 'text/csv',
  json: 'application/json', html: 'text/html', mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4',
  webm: 'video/webm', mov: 'video/quicktime', zip: 'application/zip',
  doc: 'application/msword', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ppt: 'application/vnd.ms-powerpoint', pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
};

/* ============================================================== plumbing */

function co() {
  return require(`${__hooks}/lib_company.js`);
}

function fail(status, message, code) {
  var err = new Error(message);
  err.status = status;
  if (code) err.code = code;
  return err;
}

function errText(err) {
  return String((err && err.message) || err).replace(/^GoError: /, '');
}

/** Who is calling: the operator (superuser, acts for the owner) or a person. */
function principal(e) {
  var a = e.auth;
  if (!a) return null;
  var su = false;
  try {
    su = a.isSuperuser();
  } catch (_) {
    su = false;
  }
  if (su) return { operator: true, id: String(a.id), role: 'owner', approved: true };
  return { operator: false, id: String(a.id), role: a.getString('role') || 'member', approved: a.getBool('approved') };
}

/**
 * Route wrapper: the caller must be signed in and approved (the collection
 * rules' `@request.auth.approved = true`, 1700000700_access.js), params are
 * query + JSON body, errors answer in this app's shape `{ error }` (ops.pb.js)
 * plus a machine `code`.
 */
function handle(e, fn) {
  var ctx = null;
  try {
    ctx = principal(e);
  } catch (_) {
    ctx = null;
  }
  if (!ctx) return e.json(401, { error: 'Sign in required' });
  if (!ctx.operator && !ctx.approved) {
    return e.json(403, {
      error: 'This account is not approved yet. An owner or admin grants access on the Team page.',
      code: 'not_approved',
    });
  }
  try {
    var info = e.requestInfo();
    var p = {};
    var q = info.query || {};
    Object.keys(q).forEach(function (k) {
      p[k] = q[k];
    });
    var b = info.body;
    if (b && typeof b === 'object' && !Array.isArray(b)) {
      Object.keys(b).forEach(function (k) {
        p[k] = b[k];
      });
    }
    var out = fn(p, e.app, ctx);
    return e.json(200, out === undefined ? { ok: true } : out);
  } catch (err) {
    var status = err && typeof err.status === 'number' ? err.status : 500;
    var message = errText(err);
    if (status >= 500) console.error('[company-os agent op] ' + message);
    var body = { error: message };
    if (err && err.code) body.code = err.code;
    return e.json(status, body);
  }
}

function isAdmin(ctx) {
  return ctx.operator || ctx.role === 'owner' || ctx.role === 'admin';
}

/** Money and Settings are owner/admin pages (App.tsx:130, Sidebar.tsx:57,71). */
function needAdmin(ctx, page) {
  if (!isAdmin(ctx)) {
    throw fail(403, 'Only the owner or an admin can use the ' + page + ' page.', 'owner_only');
  }
}

/** No company yet: the app shows only the onboarding wizard (App.tsx:118-120). */
function needCompany(app, L) {
  var c = L.getCompany(app);
  if (c === null) {
    throw fail(
      409,
      'The company is not set up yet. Ask the person to finish onboarding in the app (the setup wizard shown when they first sign in); agents cannot do onboarding.',
      'no_company',
    );
  }
  return c;
}

function modulesOf(app) {
  var list = rows(app, 'modules').map(function (r) {
    return { key: r.getString('key'), active: r.getBool('active'), suggested: r.getBool('suggested'), id: r.id };
  });
  var byKey = {};
  list.forEach(function (m) {
    byKey[m.key] = m;
  });
  return { list: list, byKey: byKey };
}

/** An inactive module's page shows only "Turn on <Module>" (App.tsx:129,
 *  ActivateGate.tsx). Owners/admins always reach Team (App.tsx:129). */
function needModule(app, key, ctx) {
  if (key === 'team' && isAdmin(ctx)) return;
  var m = modulesOf(app).byKey[key];
  if (m && m.active) return;
  throw fail(
    409,
    'The ' + MODULE_TITLE[key] + ' module is turned off, so its page is hidden. Turn it on first, as a person would: data update on modules (key "' +
      key + '") with {"active": true, "suggested": false, "activated_at": "' + todayStr() + '"}.',
    'module_off',
  );
}

/* --------------------------------------------------------------- params */

function has(p, k) {
  return p[k] !== undefined;
}

function text(p, k) {
  var v = p[k];
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (v === null) return '';
  throw fail(400, k + ' must be text.', 'bad_param');
}

function number(p, k, emptyIsZero) {
  var v = p[k];
  if (emptyIsZero && (v === null || v === '')) return 0;
  var n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  if (!isFinite(n)) throw fail(400, k + ' must be a number.', 'bad_param');
  return n;
}

function flag(p, k) {
  var v = p[k];
  if (v === true || v === 'true' || v === 1 || v === '1') return true;
  if (v === false || v === 'false' || v === 0 || v === '0') return false;
  throw fail(400, k + ' must be true or false.', 'bad_param');
}

/** A calendar day `YYYY-MM-DD`, or '' / null to clear (the UI's date inputs). */
function day(p, k) {
  var v = p[k];
  if (v === null || v === '') return '';
  var s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    var d = new Date(s + 'T00:00:00Z');
    if (!isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s) return s;
  }
  throw fail(400, k + ' must be a date like 2026-11-30 (or empty to clear).', 'bad_param');
}

/** A JSON list of text items, given as an array or as JSON text. */
function textList(p, k) {
  var v = p[k];
  if (typeof v === 'string') {
    try {
      v = JSON.parse(v);
    } catch (_) {
      v = null;
    }
  }
  if (!Array.isArray(v) || v.some(function (x) { return typeof x !== 'string'; })) {
    throw fail(400, k + ' must be a JSON list of text items, e.g. ["Honest","Fast"].', 'bad_param');
  }
  return v;
}

function find(app, coll, id, what) {
  if (typeof id !== 'string' || id === '') throw fail(400, 'Missing the ' + what + ' id.', 'bad_param');
  try {
    return app.findRecordById(coll, id);
  } catch (_) {
    throw fail(404, 'No ' + what + ' with id "' + id + '".', 'not_found');
  }
}

/* -------------------------------------------------------------- records */

function rows(app, coll, filter, sort, params) {
  return Array.from(app.findRecordsByFilter(coll, filter || "id != ''", sort || '', 0, 0, params || {}));
}

function json(rec, field) {
  var raw = rec.getString(field);
  if (raw === '' || raw === 'null') return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function d10(rec, field) {
  return rec.getString(field).slice(0, 10);
}

function save(app, rec) {
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, 'Not saved: ' + errText(err), 'invalid');
  }
}

/** Two-record writes are atomic; the original JS error survives the Go
 *  transaction boundary (its status/code would otherwise be lost). */
function inTx(app, fn) {
  var failure = null;
  var result;
  try {
    app.runInTransaction(function (tx) {
      try {
        result = fn(tx);
      } catch (err) {
        failure = err;
        throw err;
      }
    });
  } catch (err) {
    throw failure !== null ? failure : err;
  }
  return result;
}

function vocabOf(company) {
  var v = json(company, 'vocab');
  var out = {
    customer_one: DEFAULT_VOCAB.customer_one,
    customer_many: DEFAULT_VOCAB.customer_many,
    pipeline: DEFAULT_VOCAB.pipeline.slice(),
    project_word: DEFAULT_VOCAB.project_word,
  };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    Object.keys(v).forEach(function (k) {
      out[k] = v[k];
    }); // useCompany.ts:278-281 ({...DEFAULT_VOCAB, ...company.vocab})
  }
  if (!Array.isArray(out.pipeline)) out.pipeline = DEFAULT_VOCAB.pipeline.slice();
  return out;
}

function sum(list, fn) {
  var s = 0;
  list.forEach(function (x) {
    s += fn(x);
  });
  return s;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function plural(n, word) {
  return n + ' ' + word + (n === 1 ? '' : 's');
}

/* ----------------------------------------------- dates (copied from the UI) */

/** useCompany.ts:336-338 (UTC calendar day, as the UI and lib_company use). */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

/** Home.tsx:74-78 */
function isoDaysAgo(days) {
  var d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** Marketing.tsx:167 */
function dstr(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * useCompany.ts weekStart(): the Monday of the week, weeks running Monday to
 * Sunday in UTC calendar days (the same days as todayStr()), so the UI and the
 * agent key every week alike whatever their time zones.
 */
function weekStart(d) {
  var copy = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  var dayIdx = (copy.getUTCDay() + 6) % 7; // Monday = 0
  copy.setUTCDate(copy.getUTCDate() - dayIdx);
  return copy.toISOString().slice(0, 10);
}

/** Goals.tsx:95-104 */
function lastWeeks(n) {
  var weeks = [];
  var now = new Date();
  for (var i = n - 1; i >= 0; i--) {
    var d = new Date(now);
    d.setUTCDate(d.getUTCDate() - i * 7);
    weeks.push(weekStart(d));
  }
  return weeks;
}

/** useCompany.ts:340-343 */
function currentQuarter() {
  var now = new Date();
  return now.getFullYear() + '-Q' + (Math.floor(now.getMonth() / 3) + 1);
}

function addDays(iso, n) {
  var d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** `new Date(d + 'T00:00:00')` of the UI: local midnight of that day. */
function localDate(iso) {
  return new Date(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
}

/** components/ui.tsx:169-182 */
function relDay(isoDate) {
  var d = String(isoDate || '').slice(0, 10);
  if (d === '') return { label: '', overdue: false, days: 0 };
  var target = localDate(d);
  var now = new Date();
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  var days = Math.round((target.getTime() - today.getTime()) / DAY_MS);
  if (days === 0) return { label: 'Today', overdue: false, days: days };
  if (days === 1) return { label: 'Tomorrow', overdue: false, days: days };
  if (days === -1) return { label: 'Yesterday', overdue: true, days: days };
  if (days < 0) return { label: -days + 'd overdue', overdue: true, days: days };
  if (days < 15) return { label: 'in ' + days + 'd', overdue: false, days: days };
  return { label: MON[target.getMonth()] + ' ' + target.getDate(), overdue: false, days: days };
}

function monthLabel(ym) {
  return MONTHS[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4);
}

/** components/ui.tsx:136 (toLocaleString, max 2 decimals), en-US grouping. */
function fmtMoney(n) {
  var v = round2(Number(n || 0));
  var neg = v < 0;
  var parts = Math.abs(v).toFixed(2).split('.');
  var whole = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  var frac = parts[1].replace(/0+$/, '');
  return (neg ? '-' : '') + whole + (frac !== '' ? '.' + frac : '');
}

/* --------------------------------------------------------------- base64 */

/** Decode a base64 param natively: Go's encoding/json fills a []byte field
 *  from base64 (SubscriptionMessage.data is []byte). */
function decodeBase64(p, k, limit, tooBig) {
  if (!has(p, k) || typeof p[k] !== 'string' || p[k] === '') {
    throw fail(400, k + ' is required: the file content, base64-encoded.', 'bad_param');
  }
  var s = p[k];
  if (s.indexOf('data:') === 0 && s.indexOf(',') > 0) s = s.slice(s.indexOf(',') + 1);
  if (s.indexOf('\n') >= 0 || s.indexOf('\r') >= 0) s = s.split('\r').join('').split('\n').join('');
  if (s.indexOf('-') >= 0 || s.indexOf('_') >= 0) s = s.split('-').join('+').split('_').join('/');
  var pad = s.charAt(s.length - 1) === '=' ? (s.charAt(s.length - 2) === '=' ? 2 : 1) : 0;
  var approx = Math.floor((s.length * 3) / 4) - pad;
  if (approx > limit) throw fail(413, tooBig(approx), 'too_large');
  var rem = s.length % 4;
  if (rem === 2) s += '==';
  else if (rem === 3) s += '=';
  var holder = new SubscriptionMessage();
  try {
    unmarshal({ data: s }, holder);
  } catch (err) {
    throw fail(400, k + ' is not valid base64 (' + errText(err) + ').', 'bad_base64');
  }
  var bytes = holder.data;
  if (!bytes || bytes.length === 0) throw fail(400, 'The file is empty.', 'empty_file');
  if (bytes.length > limit) throw fail(413, tooBig(bytes.length), 'too_large');
  return bytes;
}

function mbText(n) {
  return (Math.round((n / MB) * 10) / 10) + ' MB';
}

/* ======================================================= read operations */

/** company.overview: Home (pages/Home.tsx). */
function companyOverview(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  var today = todayStr();
  var month = today.slice(0, 7);
  if (has(p, 'month') && p.month !== '' && p.month !== null) {
    month = String(p.month);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw fail(400, 'month must look like 2026-11.', 'bad_param');
  }
  var STAGES = L.STAGES;
  var vocab = vocabOf(company);
  var mods = modulesOf(app);
  var on = function (k) {
    return mods.byKey[k] !== undefined && mods.byKey[k].active;
  };
  var stage = company.getString('stage');
  var cash = company.getFloat('cash_on_hand');

  /* Journey card, Home.tsx:113-119, 466-512 */
  var steps = rows(app, 'journey_steps', '', 'order');
  var idx = STAGES.indexOf(stage);
  var unlocked = steps.filter(function (s) {
    return STAGES.indexOf(s.getString('stage')) <= idx;
  });
  var doneN = unlocked.filter(function (s) {
    return s.getString('status') === 'done';
  }).length;
  var nextSteps = unlocked.filter(function (s) {
    return s.getString('status') === 'open';
  });
  var next = nextSteps[0];
  var journey = {
    done: doneN,
    unlocked: unlocked.length,
    complete: steps.length > 0 && nextSteps.length === 0,
    next: next === undefined ? null : {
      id: next.id,
      title: next.getString('title'),
      why: next.getString('why'),
      stage: next.getString('stage'),
      stage_label: L.STAGE_LABELS[next.getString('stage')],
      kind: next.getString('kind'),
      do: next.getString('kind') === 'attest' ? 'journey.set_step --done true' : 'page ' + (next.getString('module_key') || 'journey'),
    },
    upcoming: nextSteps.slice(1, 4).map(function (s) {
      return { id: s.id, title: s.getString('title') };
    }),
  };

  /* Suggestion cards, Home.tsx:88-91, 288-307, 364-401 */
  var suggestions = rows(app, 'suggestions', "status = 'open'", '-created').map(function (s) {
    var payload = json(s, 'payload');
    var kind = s.getString('kind');
    return {
      id: s.id,
      kind: kind,
      title: s.getString('title'),
      body: s.getString('body'),
      payload: payload,
      accept: kind === 'stage_advance' && payload && payload.stage ? 'stage.advance --stage ' + payload.stage : 'status accepted',
    };
  });
  var suggestedModules = mods.list
    .filter(function (m) {
      return !m.active && m.suggested;
    })
    .map(function (m) {
      return { key: m.key, title: MODULE_TITLE[m.key] };
    });

  /* Money hero, Home.tsx:121-183 (shown when the Money module is on, :336) */
  var moneyEntries = rows(app, 'money_entries');
  var money = null;
  if (on('money')) {
    var inMonth = 0;
    var outMonth = 0;
    moneyEntries.forEach(function (e) {
      if (d10(e, 'date').slice(0, 7) === today.slice(0, 7)) {
        if (e.getString('kind') === 'in') inMonth += e.getFloat('amount');
        else outMonth += e.getFloat('amount');
      }
    });
    var DAYS = 90;
    var start = isoDaysAgo(DAYS);
    var delta = {};
    var netWindow = 0;
    moneyEntries.forEach(function (e) {
      var d = d10(e, 'date');
      if (d >= start) {
        var signed = e.getString('kind') === 'in' ? e.getFloat('amount') : -e.getFloat('amount');
        delta[d] = (delta[d] || 0) + signed;
        netWindow += signed;
      }
    });
    var hist = [];
    var bal = cash;
    for (var i = 0; i <= DAYS; i++) {
      var dd = isoDaysAgo(i);
      hist.unshift({ date: dd, balance: round2(bal) });
      bal -= delta[dd] || 0;
    }
    var daily = netWindow / DAYS;
    var proj = [];
    var runOut = null;
    if (moneyEntries.length > 0) {
      var pv = cash;
      for (var j = 1; j <= 60; j++) {
        pv += daily;
        var fd = new Date();
        fd.setDate(fd.getDate() + j);
        var iso = fd.toISOString().slice(0, 10);
        proj.push({ date: iso, balance: round2(Math.max(pv, 0)) });
        if (runOut === null && pv <= 0) runOut = iso;
        if (pv <= 0) break;
      }
    }
    var since = isoDaysAgo(90);
    var net90 = 0;
    moneyEntries.forEach(function (e) {
      if (d10(e, 'date') >= since) net90 += e.getString('kind') === 'in' ? e.getFloat('amount') : -e.getFloat('amount');
    });
    var monthlyNet = net90 / 3;
    var sentence =
      moneyEntries.length === 0
        ? 'Record money in and out on the Money page and this becomes your cash curve.'
        : monthlyNet < 0 && cash > 0
          ? 'About ' + (cash / -monthlyNet).toFixed(1) + ' months of runway at the current pace.'
          : 'You bring in more than you spend. The dashed line is the projected path.';
    money = {
      cash_on_hand: cash,
      in_month: round2(inMonth),
      out_month: round2(outMonth),
      net_month: round2(inMonth - outMonth),
      monthly_net_90d: round2(monthlyNet),
      runway_months: monthlyNet < 0 && cash > 0 ? Number((cash / -monthlyNet).toFixed(1)) : null,
      sentence: sentence,
      cash_curve_weekly: hist.filter(function (_, k) {
        return k % 7 === 0 || k === hist.length - 1;
      }),
      projection: proj.length === 0 ? null : { days: proj.length, end: proj[proj.length - 1], run_out_date: runOut },
    };
  }

  /* Momentum wall, Home.tsx:186-196 */
  var metricEntries = rows(app, 'metric_entries', '', 'week_start');
  var momentum = null;
  if (on('goals')) {
    var series = rows(app, 'metrics', 'active = true', 'order')
      .slice(0, 4)
      .map(function (m) {
        return {
          metric: m.id,
          name: m.getString('name'),
          unit: m.getString('unit'),
          goal: m.getFloat('goal'),
          direction: m.getString('direction'),
          series: metricEntries
            .filter(function (e) {
              return e.getString('metric') === m.id;
            })
            .map(function (e) {
              return { week: d10(e, 'week_start'), value: e.getFloat('value') };
            }),
        };
      });
    if (series.some(function (s) { return s.series.length > 0; })) momentum = series;
  }

  /* Calendar, Home.tsx:199-222 (real records only; month as MonthCalendar) */
  var customers = rows(app, 'customers');
  var cards = rows(app, 'kanban_cards');
  var invoices = rows(app, 'invoices');
  var promos = rows(app, 'promos');
  var events = [];
  customers.forEach(function (c) {
    if (c.getString('follow_up') !== '') events.push({ date: d10(c, 'follow_up'), kind: 'follow_up', title: 'Follow up with ' + c.getString('name'), id: c.id, page: 'customers' });
  });
  cards.forEach(function (t) {
    if (t.getString('due') !== '' && t.getString('status') !== 'done') events.push({ date: d10(t, 'due'), kind: 'work', title: t.getString('title'), id: t.id, page: 'kanban' });
  });
  invoices.forEach(function (inv) {
    if (inv.getString('due') !== '' && inv.getString('status') !== 'paid') events.push({ date: d10(inv, 'due'), kind: 'invoice', title: 'Invoice #' + inv.getString('number') + ' due', id: inv.id, page: 'money' });
  });
  promos.forEach(function (pr) {
    if (pr.getString('date') !== '' && pr.getString('status') !== 'published') events.push({ date: d10(pr, 'date'), kind: 'promo', title: pr.getString('title'), id: pr.id, page: 'marketing' });
  });
  events = events
    .filter(function (ev) {
      return ev.date.slice(0, 7) === month;
    })
    .sort(function (a, b) {
      return a.date < b.date ? -1 : a.date > b.date ? 1 : 0;
    });

  /* "This week in your company", Home.tsx:225-242 */
  var weekAgo = isoDaysAgo(7);
  var openIssues = rows(app, 'issues', "status = 'open'");
  var countSince = function (list) {
    return list.filter(function (r) {
      return d10(r, 'created') >= weekAgo;
    }).length;
  };
  var counts = {
    customers: countSince(customers),
    money: countSince(moneyEntries),
    kanban: countSince(cards),
    goals: countSince(metricEntries),
    meetings: countSince(openIssues),
  };
  var thisWeek = mods.list
    .filter(function (m) {
      return m.active;
    })
    .map(function (m) {
      return { module: m.key, label: MODULE_TITLE[m.key], new_this_week: counts[m.key] !== undefined ? counts[m.key] : null };
    });

  /* Attention list, Home.tsx:245-264 (Home shows the first 6) */
  var priorities = rows(app, 'priorities');
  var attention = [];
  customers.forEach(function (c) {
    var f = c.getString('follow_up');
    if (f !== '' && f.slice(0, 10) < today) {
      attention.push({ kind: 'follow_up', id: c.id, text: 'Follow up with ' + c.getString('name'), sub: relDay(f).label, page: 'customers' });
    }
  });
  priorities.forEach(function (pr) {
    if (pr.getString('status') === 'at_risk') attention.push({ kind: 'priority', id: pr.id, text: pr.getString('title'), sub: 'priority at risk', page: 'goals' });
  });
  openIssues.forEach(function (is) {
    attention.push({ kind: 'issue', id: is.id, text: is.getString('title'), sub: 'open issue', page: 'meetings' });
  });

  /* Open tasks, Home.tsx:266-278, 538-580 (when Kanban is on) */
  var openTasks = null;
  if (on('kanban')) {
    var open = cards.filter(function (t) {
      return t.getString('status') !== 'done';
    });
    var top = open
      .slice()
      .sort(function (a, b) {
        var ad = a.getString('due');
        var bd = b.getString('due');
        if (ad === '' && bd === '') return 0;
        if (ad === '') return 1;
        if (bd === '') return -1;
        return ad < bd ? -1 : 1;
      })
      .slice(0, 6)
      .map(function (t) {
        return { id: t.id, title: t.getString('title'), status: t.getString('status'), due: d10(t, 'due') };
      });
    openTasks = { count: open.length, top: top };
  }

  /* This quarter, Home.tsx:583-600 (when Goals is on and priorities exist) */
  var quarter = null;
  if (on('goals') && priorities.length > 0) {
    quarter = {
      done: priorities.filter(function (pr) { return pr.getString('status') === 'done'; }).length,
      total: priorities.length,
      priorities: priorities.slice(0, 5).map(function (pr) {
        return { id: pr.id, title: pr.getString('title'), status: pr.getString('status') };
      }),
    };
  }

  return {
    company: {
      id: company.id,
      name: company.getString('name'),
      stage: stage,
      stage_label: L.STAGE_LABELS[stage],
      company_type: company.getString('company_type'),
      team_size: company.getString('team_size'),
      customer_one: vocab.customer_one,
      customer_many: vocab.customer_many,
      pipeline: vocab.pipeline,
    },
    caller: { operator: ctx.operator, role: ctx.role },
    modules: {
      active: mods.list.filter(function (m) { return m.active; }).map(function (m) { return m.key; }),
      suggested: suggestedModules,
    },
    suggestions: suggestions,
    journey: journey,
    money: money,
    this_week: thisWeek,
    momentum: momentum,
    attention: { total: attention.length, items: attention },
    open_tasks: openTasks,
    quarter: quarter,
    calendar: { month: month, events: events },
  };
}

/** journey.status: the Journey page (pages/Journey.tsx). */
function journeyStatus(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  var STAGES = L.STAGES;
  var stage = company.getString('stage');
  var currentIdx = STAGES.indexOf(stage);
  var steps = rows(app, 'journey_steps', '', 'order');
  var unlockedSteps = steps.filter(function (s) {
    return STAGES.indexOf(s.getString('stage')) <= currentIdx;
  });
  var done = unlockedSteps.filter(function (s) {
    return s.getString('status') === 'done';
  }).length;
  // Journey.tsx:47-50: the next stage unlocks only when every current step is done.
  var currentStageSteps = steps.filter(function (s) {
    return s.getString('stage') === stage;
  });
  var currentStageComplete =
    currentStageSteps.length > 0 &&
    currentStageSteps.every(function (s) {
      return s.getString('status') === 'done';
    });
  var nextStage = currentIdx >= 0 && currentIdx < STAGES.length - 1 ? STAGES[currentIdx + 1] : null;

  var stages = STAGES.map(function (st, idx) {
    var stageSteps = steps.filter(function (s) {
      return s.getString('stage') === st;
    });
    var locked = idx > currentIdx;
    var isNextStage = idx === currentIdx + 1;
    var stageDone = stageSteps.filter(function (s) {
      return s.getString('status') === 'done';
    }).length;
    var out = {
      stage: st,
      label: L.STAGE_LABELS[st],
      tagline: STAGE_TAGLINES[st],
      current: st === stage,
      complete: stageSteps.length > 0 && stageDone === stageSteps.length,
      locked: locked,
      unlockable: isNextStage && currentStageComplete,
      done: stageDone,
      total: stageSteps.length,
    };
    if (locked) {
      // Journey.tsx:215-222: locked stages show only their header line.
      out.hint = isNextStage
        ? currentStageComplete
          ? 'Tap the lock to unlock: stage.advance --stage ' + st
          : 'Finish ' + L.STAGE_LABELS[stage] + ' to unlock'
        : 'Unlocks after ' + L.STAGE_LABELS[STAGES[idx - 1]];
    } else {
      // Journey.tsx:84-105: the action each step offers.
      out.steps = stageSteps.map(function (s) {
        var status = s.getString('status');
        var auto = s.getBool('auto_done');
        var action = null;
        if (status === 'done') action = auto ? null : 'undo';
        else if (s.getString('kind') === 'attest') action = 'mark_done';
        else action = 'open:' + (s.getString('module_key') === 'profile' ? 'profile' : s.getString('module_key'));
        return {
          id: s.id,
          title: s.getString('title'),
          why: s.getString('why'),
          kind: s.getString('kind'),
          status: status,
          auto_done: auto,
          done_at: d10(s, 'done_at'),
          action: action,
        };
      });
    }
    return out;
  });

  return {
    stage: stage,
    stage_label: L.STAGE_LABELS[stage],
    done: done,
    unlocked_total: unlockedSteps.length,
    next_stage: nextStage,
    next_stage_unlockable: nextStage !== null && currentStageComplete,
    stages: stages,
  };
}

/** Position-based stage tone, Customers.tsx:62-69. */
function stageTone(stage, pipeline) {
  var idx = pipeline.indexOf(stage);
  if (idx < 0) return 'neutral';
  if (idx === pipeline.length - 1) return 'neutral';
  if (idx === pipeline.length - 2) return 'good';
  if (idx === 0) return 'info';
  return 'warn';
}

/** customers.pipeline: the Customers board (pages/Customers.tsx). */
function customersPipeline(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needModule(app, 'customers', ctx);
  var vocab = vocabOf(company);
  var firstStage = vocab.pipeline[0] !== undefined ? vocab.pipeline[0] : 'Lead';
  var all = rows(app, 'customers', '', '-created');
  var q = has(p, 'query') && p.query !== null ? String(p.query).toLowerCase() : '';
  // Customers.tsx:92-101 (search), :103 (empty stage = first stage)
  var filtered =
    q === ''
      ? all
      : all.filter(function (c) {
          return (
            c.getString('name').toLowerCase().indexOf(q) >= 0 ||
            c.getString('email').toLowerCase().indexOf(q) >= 0 ||
            c.getString('note').toLowerCase().indexOf(q) >= 0
          );
        });
  var stageOf = function (c) {
    return c.getString('pipeline_stage') !== '' ? c.getString('pipeline_stage') : firstStage;
  };
  var brief = function (c) {
    var f = c.getString('follow_up');
    var rd = relDay(f);
    return {
      id: c.id,
      name: c.getString('name'),
      is_org: c.getBool('is_org'),
      stage: stageOf(c),
      email: c.getString('email'),
      phone: c.getString('phone'),
      value: c.getFloat('value'),
      follow_up: f.slice(0, 10),
      follow_up_label: rd.label,
      overdue: rd.overdue,
      note: c.getString('note'),
    };
  };
  // Customers.tsx:266-330 (columns with count + value)
  var stages = vocab.pipeline.map(function (st) {
    var inStage = filtered.filter(function (c) {
      return stageOf(c) === st;
    });
    return {
      stage: st,
      tone: stageTone(st, vocab.pipeline),
      count: inStage.length,
      value: round2(sum(inStage, function (c) { return c.getFloat('value'); })),
      customers: inStage.map(brief),
    };
  });
  var offPipeline = filtered
    .filter(function (c) {
      return vocab.pipeline.indexOf(stageOf(c)) < 0;
    })
    .map(brief);
  return {
    customer_one: vocab.customer_one,
    customer_many: vocab.customer_many,
    query: q,
    total: filtered.length,
    total_value: round2(sum(filtered, function (c) { return c.getFloat('value'); })),
    stages: stages,
    off_pipeline: offPipeline,
  };
}

/** Stripe-style invoice badge, Money.tsx:83-88. */
function invoiceBadge(inv) {
  var st = inv.getString('status');
  if (st === 'paid') return 'Paid';
  if (st === 'draft') return 'Draft';
  if (inv.getString('due') !== '' && relDay(inv.getString('due')).overdue) return 'Past due';
  return 'Sent';
}

/** money.summary: the Money page numbers (pages/Money.tsx). */
function moneySummary(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needAdmin(ctx, 'Money');
  needModule(app, 'money', ctx);
  var cash = company.getFloat('cash_on_hand');
  var entries = rows(app, 'money_entries', '', '-date');
  var month = todayStr().slice(0, 7);
  var inMonth = 0;
  var outMonth = 0;
  entries.forEach(function (e) {
    if (d10(e, 'date').slice(0, 7) === month) {
      if (e.getString('kind') === 'in') inMonth += e.getFloat('amount');
      else outMonth += e.getFloat('amount');
    }
  });
  // Money.tsx:110-126
  var since = new Date(Date.now() - 90 * DAY_MS).toISOString().slice(0, 10);
  var net90 = 0;
  entries.forEach(function (e) {
    if (d10(e, 'date') >= since) net90 += e.getString('kind') === 'in' ? e.getFloat('amount') : -e.getFloat('amount');
  });
  var monthlyNet = net90 / 3;
  var runwayMonths = cash > 0 && monthlyNet < 0 ? cash / -monthlyNet : null;
  var runwayUntil = null;
  var sentence;
  if (entries.length === 0) {
    sentence = 'Record money in and out and the runway appears here.';
  } else if (runwayMonths !== null) {
    var until = new Date(Date.now() + runwayMonths * 30.4 * DAY_MS);
    runwayUntil = until.getFullYear() + '-' + ('0' + (until.getMonth() + 1)).slice(-2);
    sentence =
      'At the current pace (about ' + fmtMoney(Math.round(-monthlyNet)) + '/month net out), cash lasts roughly ' +
      runwayMonths.toFixed(1) + ' months, until ' + MONTHS[until.getMonth()] + ' ' + until.getFullYear() + '.';
  } else {
    sentence = 'You are bringing in more than you spend. Runway is not a worry right now.';
  }
  // Ledger by month, newest first (Money.tsx:128-138, 371-385)
  var byMonth = {};
  entries.forEach(function (e) {
    var m = d10(e, 'date').slice(0, 7);
    if (byMonth[m] === undefined) byMonth[m] = { in: 0, out: 0, entries: 0 };
    if (e.getString('kind') === 'in') byMonth[m].in += e.getFloat('amount');
    else byMonth[m].out += e.getFloat('amount');
    byMonth[m].entries += 1;
  });
  var months = Object.keys(byMonth)
    .sort(function (a, b) {
      return a > b ? -1 : 1;
    })
    .map(function (m) {
      var g = byMonth[m];
      return { month: m, label: m === '' ? '' : monthLabel(m), in: round2(g.in), out: round2(g.out), net: round2(g.in - g.out), entries: g.entries };
    });
  var totIn = sum(entries.filter(function (e) { return e.getString('kind') === 'in'; }), function (e) { return e.getFloat('amount'); });
  var totOut = sum(entries.filter(function (e) { return e.getString('kind') === 'out'; }), function (e) { return e.getFloat('amount'); });
  // Invoices with the dynamic badge and the next button the row offers (Money.tsx:470-500)
  var customers = {};
  rows(app, 'customers').forEach(function (c) {
    customers[c.id] = c.getString('name');
  });
  var invoices = rows(app, 'invoices', '', '-created').map(function (inv) {
    var st = inv.getString('status');
    var nextAction = st === 'draft' ? 'mark_sent' : st === 'sent' ? 'mark_paid' : st === 'paid' && !inv.getBool('recorded') ? 'record_income' : null;
    return {
      id: inv.id,
      number: inv.getString('number'),
      customer: inv.getString('customer'),
      customer_name: customers[inv.getString('customer')] || '',
      amount: inv.getFloat('amount'),
      status: st,
      badge: invoiceBadge(inv),
      issued: d10(inv, 'issued'),
      due: d10(inv, 'due'),
      recorded: inv.getBool('recorded'),
      next: nextAction,
    };
  });
  // Money.tsx:227-229 (financial summary)
  var unpaid = invoices.filter(function (i) { return i.status !== 'paid'; });
  return {
    cash_on_hand: cash,
    month: { month: month, in: round2(inMonth), out: round2(outMonth), net: round2(inMonth - outMonth) },
    monthly_net_90d: round2(monthlyNet),
    runway_months: runwayMonths === null ? null : Number(runwayMonths.toFixed(1)),
    runway_until: runwayUntil,
    sentence: sentence,
    months: months,
    totals: { in: round2(totIn), out: round2(totOut), net: round2(totIn - totOut), entries: entries.length },
    invoices: invoices,
    unpaid: {
      count: unpaid.length,
      total: round2(sum(unpaid, function (i) { return i.amount; })),
      past_due: unpaid.filter(function (i) { return i.badge === 'Past due'; }).length,
    },
  };
}

/** goals.scorecard: the weekly numbers grid (Goals.tsx:411-505, 541-544). */
function goalsScorecard(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'goals', ctx);
  var weeks = lastWeeks(8);
  var currentWeek = weeks[weeks.length - 1];
  var metrics = rows(app, 'metrics', 'active = true', 'order');
  var entries = rows(app, 'metric_entries');
  var members = {};
  rows(app, 'team_members').forEach(function (m) {
    members[m.id] = m.getString('name');
  });
  var list = metrics.map(function (m) {
    var goal = m.getFloat('goal');
    var dir = m.getString('direction');
    var values = weeks.map(function (w) {
      var hit = entries.find(function (e) {
        return e.getString('metric') === m.id && d10(e, 'week_start') === w;
      });
      return hit === undefined ? null : hit.getFloat('value');
    });
    var hits = values.map(function (v) {
      if (!(goal > 0) || v === null) return null;
      return dir === 'up' ? v >= goal : v <= goal;
    });
    var last4 = values.slice(-4).filter(function (v) { return v !== null; });
    var avg4 = last4.length > 0 ? Math.round((sum(last4, function (v) { return v; }) / last4.length) * 10) / 10 : null;
    return {
      id: m.id,
      name: m.getString('name'),
      unit: m.getString('unit'),
      direction: dir,
      goal: goal,
      owner: members[m.getString('owner_member')] || '',
      values: values,
      hits: hits,
      avg4: avg4,
    };
  });
  return { weeks: weeks, current_week: currentWeek, metrics: list };
}

/** marketing.dashboard: the Marketing readings (pages/Marketing.tsx). */
function marketingDashboard(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needModule(app, 'marketing', ctx);
  var custWord = String(vocabOf(company).customer_one).toLowerCase();
  var campaigns = rows(app, 'campaigns', '', '-created');
  var channels = rows(app, 'channels', '', 'name');
  var content = rows(app, 'promos', '', '-date');
  var money = rows(app, 'money_entries');
  var customers = rows(app, 'customers');
  var channelName = {};
  channels.forEach(function (c) {
    channelName[c.id] = c.getString('name');
  });

  // Marketing.tsx:210-232
  var activeChannels = channels.filter(function (c) { return c.getBool('active'); });
  var monthlyChannelCost = sum(activeChannels, function (c) { return c.getFloat('monthly_cost'); });
  var campaignSpend = sum(campaigns, function (c) { return c.getFloat('spend'); });
  var totalBudget = sum(campaigns, function (c) { return c.getFloat('budget'); });
  var since90 = dstr(Date.now() - 90 * DAY_MS);
  var newCustomers = customers.filter(function (c) { return d10(c, 'created') >= since90; }).length;
  var salesIn90 = sum(
    money.filter(function (m) { return m.getString('kind') === 'in' && d10(m, 'date') >= since90; }),
    function (m) { return m.getFloat('amount'); },
  );
  var campaignSpend90 = sum(
    campaigns.filter(function (c) { return c.getString('start') === '' || d10(c, 'start') >= since90; }),
    function (c) { return c.getFloat('spend'); },
  );
  var spendBasis90 = monthlyChannelCost * 3 + campaignSpend90;
  var cac = newCustomers > 0 && spendBasis90 > 0 ? spendBasis90 / newCustomers : null;
  var ros = spendBasis90 > 0 ? salesIn90 / spendBasis90 : null;

  // Marketing.tsx:1161-1178
  var reading;
  if (monthlyChannelCost === 0 && campaignSpend === 0) {
    reading = 'Add your channels and start a campaign, and your spend, cost per customer, and return on spend will appear here — pulled from your Money and Customers records.';
  } else if (ros !== null) {
    var verdict =
      ros >= 2
        ? 'Marketing is paying for itself well.'
        : ros >= 1
          ? 'Marketing is roughly breaking even against sales.'
          : 'Marketing is costing more than it brings so far — normal early on, but worth watching.';
    reading = 'Over the last 90 days you brought in ' + newCustomers + ' new ' + custWord + (newCustomers === 1 ? '' : 's') + ' and ' + fmtMoney(salesIn90) + ' in sales. ' + verdict;
  } else {
    reading = 'Record a few sales in Money and add customers, and the cost-per-customer and return-on-spend readings will fill in.';
  }

  // Insights, Marketing.tsx:931-996
  var insights = [];
  if (ros !== null) {
    insights.push(
      ros >= 1
        ? { tone: 'good', text: 'For every $1 on marketing in the last 90 days, about ' + fmtMoney(Number(ros.toFixed(2))) + ' came back in sales.' }
        : { tone: 'warn', text: 'Marketing is costing more than it brings right now: about ' + fmtMoney(Number(ros.toFixed(2))) + ' in sales per $1 spent. Early days can look like this — watch the trend.' },
    );
  }
  if (cac !== null) insights.push({ tone: 'info', text: 'Each new ' + custWord + ' has cost roughly ' + fmtMoney(Math.round(cac)) + ' in marketing over the last 90 days.' });
  var activeGoals = {};
  campaigns.forEach(function (c) {
    if (c.getString('status') === 'active') activeGoals[c.getString('goal')] = true;
  });
  CAMPAIGN_GOALS.forEach(function (g) {
    if (!campaigns.some(function (c) { return c.getString('goal') === g; })) {
      insights.push({ tone: 'neutral', text: 'No campaign yet for “' + GOAL_META[g].label + '”. ' + GOAL_META[g].blurb });
    }
  });
  if (Object.keys(activeGoals).length === 0 && campaigns.length > 0) {
    insights.push({ tone: 'warn', text: 'No campaign is currently active. Set one to Active to start working it.' });
  }
  var byChannel = [];
  var byChannelIdx = {};
  content.forEach(function (pc) {
    var ch = pc.getString('channel');
    if (ch === '') return;
    if (byChannelIdx[ch] === undefined) {
      byChannelIdx[ch] = byChannel.length;
      byChannel.push({ id: ch, n: 0 });
    }
    byChannel[byChannelIdx[ch]].n += 1;
  });
  var topId = '';
  var topN = 0;
  byChannel.forEach(function (x) {
    if (x.n > topN) {
      topN = x.n;
      topId = x.id;
    }
  });
  if (topId !== '' && (channelName[topId] || '') !== '') {
    insights.push({ tone: 'info', text: 'Your most-used channel is ' + channelName[topId] + ' (' + topN + ' piece' + (topN === 1 ? '' : 's') + ' of content).' });
  }
  channels.forEach(function (c) {
    if (c.getBool('active') && c.getFloat('monthly_cost') > 0) {
      var used =
        content.some(function (pc) { return pc.getString('channel') === c.id; }) ||
        campaigns.some(function (k) { return k.getString('channel') === c.id; });
      if (!used) insights.push({ tone: 'warn', text: 'You pay ' + fmtMoney(c.getFloat('monthly_cost')) + '/mo for ' + c.getString('name') + ' but have nothing running on it yet.' });
    }
  });
  var today = todayStr();
  var soon = dstr(Date.now() + 14 * DAY_MS);
  var upcoming = content.filter(function (pc) {
    var d = d10(pc, 'date');
    return d !== '' && d >= today && d <= soon && pc.getString('status') !== 'published';
  }).length;
  insights.push(
    upcoming > 0
      ? { tone: 'good', text: upcoming + ' piece' + (upcoming === 1 ? '' : 's') + ' of content scheduled in the next two weeks.' }
      : { tone: 'neutral', text: 'Nothing scheduled in the next two weeks. A steady drip keeps you top of mind.' },
  );

  // Funnel coverage, Marketing.tsx:870-929
  var coverage = CAMPAIGN_GOALS.map(function (g) {
    var list = campaigns.filter(function (c) { return c.getString('goal') === g; });
    return {
      goal: g,
      label: GOAL_META[g].label,
      campaigns: list.length,
      active: list.filter(function (c) { return c.getString('status') === 'active'; }).length,
      result: sum(list, function (c) { return c.getFloat('result'); }),
      unit: GOAL_META[g].unit,
    };
  });

  // Channel mix, Marketing.tsx:837-868
  var paid = activeChannels.filter(function (c) { return c.getFloat('monthly_cost') > 0; });
  var paidTotal = sum(paid, function (c) { return c.getFloat('monthly_cost'); });
  var mix = paidTotal > 0
    ? paid.map(function (c) {
        return { channel: c.getString('name'), monthly_cost: c.getFloat('monthly_cost'), share_pct: Math.round((c.getFloat('monthly_cost') / paidTotal) * 100) };
      })
    : [];

  // Campaign cards grouped Active, Planned, Paused, Done (Marketing.tsx:397-430, 732-835)
  var cardsOut = [];
  CAMPAIGN_STATUS_ORDER.forEach(function (st) {
    campaigns.forEach(function (c) {
      if (c.getString('status') !== st) return;
      var budget = c.getFloat('budget');
      var spend = c.getFloat('spend');
      cardsOut.push({
        id: c.id,
        name: c.getString('name'),
        goal: c.getString('goal'),
        goal_label: GOAL_META[c.getString('goal')] ? GOAL_META[c.getString('goal')].label : c.getString('goal'),
        status: st,
        channel: channelName[c.getString('channel')] || '',
        start: d10(c, 'start'),
        end: d10(c, 'end'),
        budget: budget,
        spend: spend,
        over_budget: budget > 0 && spend > budget,
        target: c.getFloat('target'),
        result: c.getFloat('result'),
        content_count: content.filter(function (pc) { return pc.getString('campaign') === c.id; }).length,
      });
    });
  });

  var byStatus = {};
  CONTENT_STATUS_ORDER.forEach(function (st) {
    byStatus[st] = content.filter(function (pc) { return pc.getString('status') === st; }).length;
  });

  return {
    kpis: {
      channel_spend_month: monthlyChannelCost,
      active_channels: activeChannels.length,
      campaign_spend: campaignSpend,
      total_budget: totalBudget,
      cost_per_customer: cac === null ? null : Math.round(cac),
      new_customers_90d: newCustomers,
      return_on_spend: ros === null ? null : Number(ros.toFixed(1)),
      sales_90d: round2(salesIn90),
    },
    reading: reading,
    insights: insights,
    coverage: coverage,
    channel_mix: mix,
    campaigns: cardsOut,
    content: { by_status: byStatus, upcoming_14d: upcoming },
  };
}

/** team.list: what the Team page shows (pages/Team.tsx). */
function teamList(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needModule(app, 'team', ctx); // owner/admin always reach Team (App.tsx:129)
  var members = rows(app, 'team_members', '', 'name');
  var seats = rows(app, 'seats', '', 'name');
  var candidates = rows(app, 'candidates', '', '-created');
  var memberName = {};
  members.forEach(function (m) {
    memberName[m.id] = m.getString('name');
  });
  // People tab, Team.tsx:200-250 (seats held, else the email)
  var people = members.map(function (m) {
    return {
      id: m.id,
      name: m.getString('name'),
      email: m.getString('email'),
      active: m.getBool('active'),
      seats: seats
        .filter(function (s) { return s.getString('accountable') === m.id; })
        .map(function (s) { return s.getString('name'); }),
      note: m.getString('note'),
    };
  });
  // Seats tab, Team.tsx:252-300 ("No owner" when unassigned)
  var seatsOut = seats.map(function (s) {
    var acc = s.getString('accountable');
    return {
      id: s.id,
      name: s.getString('name'),
      responsibilities: json(s, 'responsibilities') || [],
      accountable: acc !== '' && memberName[acc] !== undefined ? { id: acc, name: memberName[acc] } : null,
    };
  });
  // Hiring tab, Team.tsx:108 (from the Grow stage, or once candidates exist)
  var STAGES = L.STAGES;
  var showHiring = STAGES.indexOf(company.getString('stage')) >= STAGES.indexOf('grow') || candidates.length > 0;
  var hiring = showHiring
    ? candidates.map(function (c) {
        return { id: c.id, name: c.getString('name'), seat: c.getString('seat'), stage: c.getString('stage'), stage_label: CANDIDATE_LABEL[c.getString('stage')] || c.getString('stage'), note: c.getString('note') };
      })
    : null;
  // Access tab, owner/admin only (Team.tsx:113, 407-534): who has an account,
  // role and status. Access changes stay with the person on that tab.
  var accounts = null;
  if (isAdmin(ctx)) {
    var users = rows(app, 'users', '', 'created');
    var view = function (u) {
      var name = u.getString('name').trim();
      var mail = u.getString('email').trim();
      var role = u.getString('role');
      return {
        id: u.id,
        label: name !== '' ? name : mail !== '' ? mail : 'Pending account',
        email: mail,
        role: ROLE_LABEL[role] !== undefined ? ROLE_LABEL[role] : 'Member',
        status: u.getBool('approved') ? 'Active' : 'Pending',
        you: !ctx.operator && u.id === ctx.id,
      };
    };
    accounts = {
      pending: users.filter(function (u) { return !u.getBool('approved') && u.getString('role') !== 'owner'; }).map(view),
      with_access: users.filter(function (u) { return u.getBool('approved') || u.getString('role') === 'owner'; }).map(view),
      changes: 'Approving, revoking, roles and removing accounts are done by the owner or an admin on Team > Access in the app.',
    };
  }
  return {
    people: people,
    seats: seatsOut,
    hiring: hiring,
    hiring_hidden_reason: showHiring ? null : 'The Hiring tab appears from the Grow stage, or once a candidate exists.',
    accounts: accounts,
    accounts_note: accounts === null ? 'Login accounts are visible to the owner and admins only.' : null,
  };
}

/** files.download: preview/download a stored file (Files.tsx:102, 300-335;
 *  Kanban attachments, Kanban.tsx:550-575). */
function filesDownload(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  var rec;
  var coll;
  var name;
  var title;
  var mime = '';
  if (has(p, 'file') && p.file !== '' && p.file !== null) {
    coll = 'files';
    rec = find(app, 'files', String(p.file), 'file');
    name = rec.getString('file');
    title = rec.getString('title');
    mime = rec.getString('mime');
    if (name === '') throw fail(404, 'That Files entry has no stored file.', 'not_found');
  } else if (has(p, 'card') && p.card !== '' && p.card !== null) {
    coll = 'kanban_cards';
    needModule(app, 'kanban', ctx);
    rec = find(app, 'kanban_cards', String(p.card), 'Kanban card');
    name = has(p, 'filename') ? text(p, 'filename') : '';
    var list = Array.from(rec.getStringSlice('attachments'));
    if (name === '' || list.indexOf(name) < 0) {
      throw fail(404, 'Card "' + rec.getString('title') + '" has no attachment "' + name + '". Its files: ' + (list.length ? list.join(', ') : 'none') + '.', 'not_found');
    }
    title = name;
  } else {
    throw fail(400, 'Pass file (a Files entry id) or card + filename (a Kanban card attachment).', 'bad_param');
  }
  var key = rec.baseFilesPath() + '/' + name;
  var fsys = app.newFilesystem();
  try {
    var attrs = fsys.attributes(key);
    var size = Number(attrs.size);
    var out = {
      title: title,
      name: name,
      mime: mime !== '' ? mime : String(attrs.contentType || ''),
      size: size,
      url: '/api/files/' + coll + '/' + rec.id + '/' + name,
      content_base64: null,
    };
    if (size > DOWNLOAD_LIMIT) {
      out.message = 'This file is ' + mbText(size) + ', over the 10 MB an agent can fetch. Ask the person to download it in the app (' + (coll === 'files' ? 'Files page' : 'the card\'s Files list') + ').';
      return out;
    }
    var reader = fsys.getReader(key);
    var bytes;
    try {
      bytes = toBytes(reader, DOWNLOAD_LIMIT + 1);
    } finally {
      reader.close();
    }
    // Go's json.Marshal writes a []byte as base64 (no JS loop).
    var holder = new SubscriptionMessage();
    holder.data = bytes;
    out.content_base64 = holder.data;
    return out;
  } catch (err) {
    if (err && typeof err.status === 'number') throw err;
    throw fail(404, 'The stored file could not be read (' + errText(err) + ').', 'not_found');
  } finally {
    fsys.close();
  }
}

/* ====================================================== write operations */

var PLAN_FIELDS = ['mission', 'who_we_serve', 'offer', 'how_money', 'three_year_picture', 'year_goals'];

/** company.update: Settings name (Settings.tsx:60-67), Money cash on hand
 *  (Money.tsx:140-150), Company Profile plan + values (Profile.tsx:49-68). */
function companyUpdate(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  if (has(p, 'stage')) throw fail(400, 'Change the stage with stage.advance (Settings > Stage, or the Journey lock).', 'use_stage_advance');
  ['company_type', 'vocab', 'focus', 'team_size', 'what_it_does', 'owner', 'onboarding_done', 'values_list'].forEach(function (k) {
    if (has(p, k)) {
      throw fail(400, k === 'values_list' ? 'Pass the values as "values".' : 'The app has no screen to change ' + k + ' after onboarding.', 'not_editable');
    }
  });
  var updated = [];
  var planChanged = false;
  if (has(p, 'name')) {
    needAdmin(ctx, 'Settings');
    var nm = text(p, 'name').trim();
    if (nm === '') throw fail(400, 'The company name cannot be empty.', 'bad_param');
    if (nm !== company.getString('name')) {
      company.set('name', nm);
      updated.push('name');
    }
  }
  if (has(p, 'cash_on_hand')) {
    needAdmin(ctx, 'Money');
    needModule(app, 'money', ctx);
    company.set('cash_on_hand', number(p, 'cash_on_hand'));
    updated.push('cash_on_hand');
  }
  PLAN_FIELDS.forEach(function (f) {
    if (!has(p, f)) return;
    var v = text(p, f);
    if (v !== company.getString(f)) {
      company.set(f, v);
      updated.push(f);
      planChanged = true;
    }
  });
  var values = null;
  if (has(p, 'values')) {
    // TagInput (kit/components/forms.tsx:132-136): trimmed, trailing commas
    // dropped, no blanks, no duplicates; Profile keeps the first 5.
    values = [];
    textList(p, 'values').forEach(function (raw) {
      var tag = raw.trim().replace(/,+$/, '');
      if (tag !== '' && values.indexOf(tag) < 0) values.push(tag);
    });
    values = values.slice(0, 5);
    company.set('values_list', values);
    updated.push('values');
  }
  if (updated.length === 0) return { updated: [], journey_completed: [], note: 'Nothing changed.' };
  save(app, company);
  var completed = [];
  if (planChanged) {
    // Profile.tsx:55-57: plan fields feed Journey rules (plan_started, offer_filled).
    try {
      completed = L.runAutocheck(app).completed;
    } catch (err) {
      console.error('[company-os agent op] autocheck after profile save: ' + errText(err));
    }
  }
  var out = { updated: updated, journey_completed: completed };
  if (values !== null) out.values = values;
  return out;
}

/** journey.set_step: "Mark as done" / "Undo" (Journey.tsx:67-105). */
function journeySetStep(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  var step = find(app, 'journey_steps', String(p.step || ''), 'Journey step');
  if (!has(p, 'done')) throw fail(400, 'done is required: true to mark the step done, false to undo.', 'bad_param');
  var done = flag(p, 'done');
  var STAGES = L.STAGES;
  if (STAGES.indexOf(step.getString('stage')) > STAGES.indexOf(company.getString('stage'))) {
    throw fail(409, 'This step belongs to the locked ' + L.STAGE_LABELS[step.getString('stage')] + ' stage; it unlocks when the company reaches that stage.', 'locked_stage');
  }
  var status = step.getString('status');
  if (done) {
    if (status === 'done') throw fail(409, 'This step is already done.', 'already');
    if (step.getString('kind') !== 'attest') {
      var page = step.getString('module_key') || 'journey';
      throw fail(409, 'This step completes itself when your records show the work. Do it on the ' + page + ' page; journey.autocheck then marks it done.', 'not_attest');
    }
    step.set('status', 'done');
    step.set('done_at', todayStr());
    step.set('auto_done', false);
  } else {
    if (status !== 'done') throw fail(409, 'This step is not done, so there is nothing to undo.', 'already');
    if (step.getBool('auto_done')) throw fail(409, 'This step was completed from your records automatically; the app offers no undo for it.', 'auto_detected');
    step.set('status', 'open');
    step.set('auto_done', false);
  }
  save(app, step);
  return { id: step.id, title: step.getString('title'), status: step.getString('status') };
}

/** customers.save: the Add/Edit customer form (Customers.tsx:42-58,
 *  171-175, 356-361); also the board drag, which edits the stage. */
function customersSave(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needModule(app, 'customers', ctx);
  var vocab = vocabOf(company);
  var creating = !has(p, 'id') || p.id === '' || p.id === null;
  var rec = creating ? new Record(app.findCollectionByNameOrId('customers')) : find(app, 'customers', String(p.id), String(vocab.customer_one).toLowerCase());
  if (has(p, 'name')) {
    var nm = text(p, 'name');
    if (nm.trim() === '') throw fail(400, 'name cannot be empty.', 'bad_param');
    rec.set('name', nm);
  } else if (creating) {
    throw fail(400, 'name is required to add a ' + String(vocab.customer_one).toLowerCase() + '.', 'bad_param');
  }
  if (has(p, 'pipeline_stage')) {
    var st = text(p, 'pipeline_stage');
    if (vocab.pipeline.indexOf(st) < 0) throw fail(400, 'pipeline_stage must be one of: ' + vocab.pipeline.join(', ') + '.', 'bad_stage');
    rec.set('pipeline_stage', st);
  } else if (creating) {
    rec.set('pipeline_stage', vocab.pipeline[0] !== undefined ? vocab.pipeline[0] : 'Lead'); // form default, Customers.tsx:90,160
  }
  ['email', 'phone', 'note'].forEach(function (k) {
    if (has(p, k)) rec.set(k, text(p, k));
  });
  if (has(p, 'follow_up')) rec.set('follow_up', day(p, 'follow_up'));
  if (has(p, 'value')) rec.set('value', number(p, 'value', true));
  if (has(p, 'is_org')) rec.set('is_org', flag(p, 'is_org'));
  save(app, rec);
  // Customers.tsx:171-175: after every save, journey autocheck then stage
  // recompute (best-effort, as the UI ignores their failures).
  var completed = [];
  var suggested = null;
  try {
    completed = L.runAutocheck(app).completed;
  } catch (err) {
    console.error('[company-os agent op] autocheck after customer save: ' + errText(err));
  }
  try {
    suggested = L.runStageCheck(app).suggested;
  } catch (err) {
    console.error('[company-os agent op] stage check after customer save: ' + errText(err));
  }
  return { id: rec.id, created: creating, stage: rec.getString('pipeline_stage'), journey_completed: completed, stage_suggested: suggested };
}

/** money.record_invoice_income: "Record income" (Money.tsx:159-175, 484-487). */
function moneyRecordInvoiceIncome(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needAdmin(ctx, 'Money');
  needModule(app, 'money', ctx);
  var inv = find(app, 'invoices', String(p.invoice || ''), 'invoice');
  var num = inv.getString('number');
  if (inv.getString('status') !== 'paid') {
    throw fail(409, 'Invoice #' + num + ' is ' + inv.getString('status') + '. Only a paid invoice can be recorded as income; mark it paid first (data update on invoices: {"status": "paid"}).', 'not_paid');
  }
  if (inv.getBool('recorded')) throw fail(409, 'Invoice #' + num + ' is already recorded as money in.', 'already_recorded');
  return inTx(app, function (tx) {
    var entry = new Record(tx.findCollectionByNameOrId('money_entries'));
    entry.set('kind', 'in');
    entry.set('amount', inv.getFloat('amount'));
    entry.set('category', 'Sales');
    entry.set('note', 'Invoice ' + num);
    entry.set('date', todayStr());
    save(tx, entry);
    var fresh = tx.findRecordById('invoices', inv.id);
    fresh.set('recorded', true);
    save(tx, fresh);
    return { entry_id: entry.id, invoice_id: inv.id, amount: inv.getFloat('amount'), date: todayStr() };
  });
}

/** marketing.record_spend: "Record spend" (Marketing.tsx:1018-1043). */
function marketingRecordSpend(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'marketing', ctx);
  var campaign = find(app, 'campaigns', String(p.campaign || ''), 'campaign');
  var amount = number(p, 'amount');
  if (!(amount > 0)) throw fail(400, 'amount must be more than 0.', 'bad_param');
  return inTx(app, function (tx) {
    var entry = new Record(tx.findCollectionByNameOrId('money_entries'));
    entry.set('kind', 'out');
    entry.set('amount', amount);
    entry.set('category', 'Marketing');
    entry.set('note', 'Campaign: ' + campaign.getString('name'));
    entry.set('date', todayStr());
    save(tx, entry);
    var c = tx.findRecordById('campaigns', campaign.id);
    c.set('spend', (c.getFloat('spend') || 0) + amount);
    save(tx, c);
    return { entry_id: entry.id, campaign: c.id, spend: c.getFloat('spend') };
  });
}

/** goals.set_number: type or clear one scorecard cell (Goals.tsx:507-538). */
function goalsSetNumber(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'goals', ctx);
  var metric = find(app, 'metrics', String(p.metric || ''), 'metric');
  if (!metric.getBool('active')) {
    throw fail(409, 'Metric "' + metric.getString('name') + '" is turned off, so the scorecard has no row for it. Turn it on first (data update on metrics: {"active": true}).', 'metric_off');
  }
  var weeks = lastWeeks(8);
  var w = weeks[weeks.length - 1];
  if (has(p, 'week') && p.week !== '' && p.week !== null) {
    var want = day(p, 'week');
    w = null;
    weeks.forEach(function (k) {
      if (want >= k && want <= addDays(k, 6)) w = k;
    });
    if (w === null) {
      throw fail(400, 'The scorecard shows the 8 weeks keyed ' + weeks.join(', ') + ' (each covers 7 days from its key); ' + want + ' is outside them.', 'week_out_of_range');
    }
  }
  var raw = has(p, 'value') && p.value !== null ? String(p.value).trim() : '';
  var entry = rows(app, 'metric_entries', 'metric = {:m}', '', { m: metric.id }).find(function (e) {
    return d10(e, 'week_start') === w;
  });
  var base = { metric: metric.id, name: metric.getString('name'), week: w };
  if (raw === '') {
    if (entry === undefined) {
      base.action = 'unchanged';
      return base;
    }
    try {
      app.delete(entry);
    } catch (err) {
      throw fail(400, 'Not cleared: ' + errText(err), 'invalid');
    }
    base.action = 'deleted';
    return base;
  }
  var value = Number(raw);
  if (isNaN(value)) throw fail(400, 'Numbers only.', 'bad_param');
  if (entry !== undefined) {
    entry.set('value', value);
    save(app, entry);
    base.action = 'updated';
    base.entry_id = entry.id;
  } else {
    var rec = new Record(app.findCollectionByNameOrId('metric_entries'));
    rec.set('metric', metric.id);
    rec.set('week_start', w);
    rec.set('value', value);
    save(app, rec);
    base.action = 'created';
    base.entry_id = rec.id;
  }
  base.value = value;
  return base;
}

/** RoadmapCanvas.tsx:109-126 */
function createsCycle(items, parentId, childId) {
  if (parentId === childId) return true;
  var map = {};
  items.forEach(function (r) {
    map[r.id] = json(r, 'prerequisites') || [];
  });
  var visited = {};
  var stack = [parentId];
  while (stack.length) {
    var id = stack.pop();
    if (id === undefined) continue;
    if (id === childId) return true;
    if (visited[id]) continue;
    visited[id] = true;
    var pre = map[id];
    if (!pre) continue;
    pre.forEach(function (pid) {
      stack.push(pid);
    });
  }
  return false;
}

/** roadmap.link: drag a port onto a card / disconnect (RoadmapCanvas.tsx:212-235). */
function roadmapLink(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'goals', ctx);
  var parent = find(app, 'roadmap_items', String(p.prerequisite || ''), 'milestone');
  var child = find(app, 'roadmap_items', String(p.milestone || ''), 'milestone');
  var remove = has(p, 'remove') && p.remove !== '' && p.remove !== null ? flag(p, 'remove') : false;
  var prev = (json(child, 'prerequisites') || []).slice();
  var next;
  if (remove) {
    next = prev.filter(function (x) {
      return x !== parent.id;
    });
  } else {
    if (createsCycle(rows(app, 'roadmap_items'), parent.id, child.id)) {
      throw fail(409, 'That would create a cycle: "' + child.getString('title') + '" already leads to "' + parent.getString('title') + '" (or they are the same milestone).', 'cycle');
    }
    next = prev.slice();
    if (next.indexOf(parent.id) < 0) next.push(parent.id);
  }
  child.set('prerequisites', next);
  save(app, child);
  return { milestone: child.id, prerequisites: next, changed: JSON.stringify(prev) !== JSON.stringify(next) };
}

/** roadmap.auto_layout: the canvas's Auto-layout (RoadmapCanvas.tsx:342-382). */
function roadmapAutoLayout(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'goals', ctx);
  var items = rows(app, 'roadmap_items'); // the canvas's unsorted list order
  if (items.length === 0) return { moved: 0, columns: 0 };
  var pre = {};
  var idSet = {};
  items.forEach(function (n) {
    idSet[n.id] = true;
    pre[n.id] = json(n, 'prerequisites') || [];
  });
  var depth = {};
  var visit = function (id, stack) {
    if (depth[id] !== undefined) return depth[id];
    if (stack[id]) return 0;
    stack[id] = true;
    var parents = (pre[id] || []).filter(function (x) {
      return idSet[x];
    });
    var d = parents.length === 0 ? 0 : Math.max.apply(null, parents.map(function (x) { return visit(x, stack); })) + 1;
    delete stack[id];
    depth[id] = d;
    return d;
  };
  items.forEach(function (n) {
    visit(n.id, {});
  });
  var cols = {};
  items.forEach(function (n) {
    var d = depth[n.id] || 0;
    (cols[d] = cols[d] || []).push(n);
  });
  var COL_W = 280;
  var ROW_H = 120;
  var updates = [];
  Object.keys(cols)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    })
    .forEach(function (d) {
      cols[d].forEach(function (n, i) {
        updates.push({ id: n.id, x: d * COL_W + 40, y: i * ROW_H + 40 });
      });
    });
  inTx(app, function (tx) {
    updates.forEach(function (u) {
      var r = tx.findRecordById('roadmap_items', u.id);
      r.set('pos_x', u.x);
      r.set('pos_y', u.y);
      save(tx, r);
    });
  });
  return { moved: updates.length, columns: Object.keys(cols).length };
}

/** processes.use_template: "Use template" (Processes.tsx:75-87, 110-145; the
 *  same packs as lib_company.PROCESS_PACKS). */
function processesUseTemplate(app, p, ctx) {
  var L = co();
  var company = needCompany(app, L);
  needModule(app, 'processes', ctx);
  var existing = rows(app, 'processes').length;
  if (existing > 0) {
    throw fail(409, 'Templates are offered only while the Processes page is empty (it has ' + existing + (existing === 1 ? ' process' : ' processes') + '). Write the process instead: data create on processes {"name", "category", "owner_member", "steps": [..]}.', 'has_processes');
  }
  var packs = L.PROCESS_PACKS[company.getString('company_type')] || L.PROCESS_PACKS.other;
  var want = has(p, 'template') && p.template !== null ? String(p.template).trim() : '';
  var tpl = packs.find(function (t) {
    return t[0].toLowerCase() === want.toLowerCase();
  });
  if (tpl === undefined) {
    throw fail(400, (want === '' ? 'template is required. ' : 'No template "' + want + '". ') + 'Templates for this business: ' + packs.map(function (t) { return t[0]; }).join('; ') + '.', 'unknown_template');
  }
  var rec = new Record(app.findCollectionByNameOrId('processes'));
  rec.set('name', tpl[0]);
  rec.set('category', '');
  rec.set('steps', tpl[1].slice());
  save(app, rec);
  return { id: rec.id, name: tpl[0], steps: tpl[1] };
}

function extMime(name) {
  var dot = name.lastIndexOf('.');
  var ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
  return MIME_BY_EXT[ext] || '';
}

function fileName(p) {
  var name = has(p, 'name') && p.name !== null ? text(p, 'name').trim() : '';
  if (name === '') throw fail(400, 'name is required: the file name with its extension, e.g. "price-list.pdf".', 'bad_param');
  if (name.length > 300) throw fail(400, 'name is too long (300 characters at most).', 'bad_param');
  return name;
}

/** files.upload: "Upload" into the root or a folder (Files.tsx:198-219). */
function filesUpload(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  var name = fileName(p);
  var folder = '';
  if (has(p, 'folder') && p.folder !== '' && p.folder !== null) folder = find(app, 'folders', String(p.folder), 'folder').id;
  var bytes = decodeBase64(p, 'content_base64', UPLOAD_LIMIT, function (n) {
    return 'This file is ' + mbText(n) + '; agents can upload files up to 20 MB. Ask the person to upload it on the Files page (up to 50 MB there).';
  });
  var mime = has(p, 'mime') && p.mime !== null && String(p.mime).trim() !== '' ? String(p.mime).trim() : extMime(name);
  var rec = new Record(app.findCollectionByNameOrId('files'));
  rec.set('title', name);
  rec.set('file', $filesystem.fileFromBytes(bytes, name));
  rec.set('size', bytes.length);
  rec.set('mime', mime);
  if (folder !== '') rec.set('folder', folder);
  save(app, rec);
  return { id: rec.id, title: name, size: bytes.length, mime: mime, folder: folder, stored_as: rec.getString('file') };
}

/** kanban.attach: "Attach file" on a card (Kanban.tsx:423-433). */
function kanbanAttach(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'kanban', ctx);
  var card = find(app, 'kanban_cards', String(p.card || ''), 'Kanban card');
  var name = fileName(p);
  var before = Array.from(card.getStringSlice('attachments'));
  if (before.length >= CARD_FILE_MAX) {
    throw fail(409, 'This card already holds ' + CARD_FILE_MAX + ' files, the most a card can hold. Remove one first (kanban.detach).', 'card_full');
  }
  var bytes = decodeBase64(p, 'content_base64', CARD_FILE_LIMIT, function (n) {
    return 'This file is ' + mbText(n) + '; a card attachment can be at most 10 MB.';
  });
  card.set('attachments+', $filesystem.fileFromBytes(bytes, name));
  save(app, card);
  var after = Array.from(card.getStringSlice('attachments'));
  return {
    card: card.id,
    added: after.filter(function (f) { return before.indexOf(f) < 0; })[0] || null,
    attachments: after,
  };
}

/** kanban.detach: the remove button on an attachment (Kanban.tsx:434-436). */
function kanbanDetach(app, p, ctx) {
  var L = co();
  needCompany(app, L);
  needModule(app, 'kanban', ctx);
  var card = find(app, 'kanban_cards', String(p.card || ''), 'Kanban card');
  var fn = has(p, 'filename') ? text(p, 'filename') : '';
  var list = Array.from(card.getStringSlice('attachments'));
  if (fn === '' || list.indexOf(fn) < 0) {
    throw fail(404, 'Card "' + card.getString('title') + '" has no file "' + fn + '". Its files: ' + (list.length ? list.join(', ') : 'none') + '.', 'not_found');
  }
  card.set('attachments-', fn);
  save(app, card);
  return { card: card.id, removed: fn, attachments: Array.from(card.getStringSlice('attachments')) };
}

module.exports = {
  handle: handle,
  companyOverview: companyOverview,
  journeyStatus: journeyStatus,
  customersPipeline: customersPipeline,
  moneySummary: moneySummary,
  goalsScorecard: goalsScorecard,
  marketingDashboard: marketingDashboard,
  teamList: teamList,
  filesDownload: filesDownload,
  companyUpdate: companyUpdate,
  journeySetStep: journeySetStep,
  customersSave: customersSave,
  moneyRecordInvoiceIncome: moneyRecordInvoiceIncome,
  marketingRecordSpend: marketingRecordSpend,
  goalsSetNumber: goalsSetNumber,
  roadmapLink: roadmapLink,
  roadmapAutoLayout: roadmapAutoLayout,
  processesUseTemplate: processesUseTemplate,
  filesUpload: filesUpload,
  kanbanAttach: kanbanAttach,
  kanbanDetach: kanbanDetach,
  // exposed for tests / reuse
  weekStart: weekStart,
  lastWeeks: lastWeeks,
  currentQuarter: currentQuarter,
};
