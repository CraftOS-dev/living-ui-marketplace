/// <reference path="../pb_data/types.d.ts" />
/**
 * Read models: home summary, global search, renewal forecast, standard
 * reports, trademark coverage, and CSV import (with a dry run).
 */

function normNum(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function summary(app, userId) {
  const u = require(`${__hooks}/lib_util.js`);
  const today = u.today();
  const t = u.toPb(today);
  const week = u.toPb(u.addDays(today, 7));
  const d30 = u.toPb(u.addDays(today, 30));
  const d90 = u.toPb(u.addDays(today, 90));
  const count = (coll, filter, params) => u.findMany(app, coll, filter, '', 0, params || {}).length;
  const types = ['patent', 'utility_model', 'design', 'trademark', 'copyright', 'domain'];
  const groups = ['pre_filing', 'pending', 'live', 'dead'];
  const portfolio = {};
  const matters = u.findMany(app, 'matters', '', '', 0);
  const jur = {};
  for (const ty of types) {
    portfolio[ty] = {};
    for (const g of groups) portfolio[ty][g] = 0;
  }
  for (const m of matters) {
    const ty = m.getString('ip_type');
    const g = m.getString('status_group') || 'pending';
    if (portfolio[ty]) portfolio[ty][g] = (portfolio[ty][g] || 0) + 1;
    if (g !== 'dead') {
      const j = m.getString('jurisdiction');
      jur[j] = (jur[j] || 0) + 1;
    }
  }
  const mineFilter = userId ? ' && assignee = {:u}' : '';
  const p = { t: t, w: week, a: d30, b: d90, u: userId || '' };
  const deadlines = {
    overdue: count('deadlines', 'status = "open" && due_date < {:t}', p),
    week: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:w}', p),
    d30: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:a}', p),
    d90: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:b}', p),
    mine_overdue: userId ? count('deadlines', 'status = "open" && due_date < {:t}' + mineFilter, p) : 0,
    mine_week: userId ? count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:w}' + mineFilter, p) : 0,
  };
  const inbox = {
    new: count('inbox_items', 'status = "new"'),
    awaiting_second: count('inbox_items', 'status = "awaiting_second"'),
  };
  const renewals = {
    pending: count('renewals', 'decision = "pending" && instruction_status = "not_instructed"'),
    in_grace: count('renewals', 'instruction_status != "confirmed" && instruction_status != "lapsed" && due_date < {:t} && grace_end >= {:t}', p),
  };
  const agreements = {
    active: count('agreements', 'status = "active"'),
    expiring90: count('agreements', 'status = "active" && perpetual = false && term_end >= {:t} && term_end <= {:b}', p),
  };
  // Renewal spend by month for the next 12 months (home currency).
  const home = String(u.setting(app, 'home_currency', 'USD') || 'USD');
  const months = [];
  for (let i = 0; i < 12; i++) {
    const first = u.addYMD(today.slice(0, 8) + '01', 0, i, 0);
    months.push({ month: first.slice(0, 7), amount: 0, count: 0, unknown: 0 });
  }
  const horizon = u.toPb(u.addYMD(today.slice(0, 8) + '01', 1, 0, 0));
  const rs = u.findMany(app, 'renewals', 'due_date >= {:s} && due_date < {:h} && decision != "lapse" && instruction_status != "confirmed"', 'due_date', 0, {
    s: u.toPb(today.slice(0, 8) + '01'),
    h: horizon,
  });
  for (const r of rs) {
    const mo = u.d10(r.getString('due_date')).slice(0, 7);
    const slot = months.find((x) => x.month === mo);
    if (!slot) continue;
    slot.count += 1;
    if (r.getFloat('home_amount') > 0) slot.amount += r.getFloat('home_amount');
    else slot.unknown += 1;
  }
  return {
    today: today,
    portfolio: portfolio,
    jurisdictions: jur,
    deadlines: deadlines,
    inbox: inbox,
    renewals: renewals,
    agreements: agreements,
    renewal_spend: { currency: home, months: months },
    counts: {
      properties: count('properties', ''),
      works: count('works', ''),
      families: count('families', ''),
      disclosures_open: count('disclosures', 'stage != "filed" && stage != "rejected" && stage != "archived" && stage != "merged"'),
      watch_new: count('watch_hits', 'status = "new"'),
      approvals_open: count('approvals', 'status = "submitted" || status = "in_review"'),
      disputes_active: count('disputes', 'status = "pending" || status = "active"'),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function search(app, q, limit) {
  const u = require(`${__hooks}/lib_util.js`);
  const raw = String(q || '').trim();
  if (raw.length < 2) return [];
  const needle = raw.toLowerCase();
  const num = normNum(raw);
  const out = [];
  const max = limit || 25;
  function hit(type, id, title, subtitle, link, score) {
    out.push({ type: type, id: id, title: title, subtitle: subtitle, link: link, score: score });
  }
  for (const m of u.findMany(app, 'matters', '', '-updated', 0)) {
    const nums = [m.getString('ref'), m.getString('application_no'), m.getString('publication_no'), m.getString('registration_no')];
    let score = 0;
    for (const n of nums) {
      const nn = normNum(n);
      if (num.length >= 4 && nn !== '' && (nn === num || nn.indexOf(num) >= 0 || num.indexOf(nn) >= 0)) score = Math.max(score, nn === num ? 100 : 80);
    }
    if (m.getString('title').toLowerCase().indexOf(needle) >= 0) score = Math.max(score, 60);
    if (score > 0) {
      hit(
        'matter',
        m.id,
        (m.getString('ref') ? m.getString('ref') + ' ' : '') + m.getString('title'),
        m.getString('ip_type').replace('_', ' ') + ' · ' + m.getString('jurisdiction') + (m.getString('application_no') ? ' · ' + m.getString('application_no') : ''),
        '#/matter/' + m.id,
        score,
      );
    }
  }
  const text = [
    ['families', 'title', 'family', '#/family/'],
    ['properties', 'name', 'property', '#/property/'],
    ['works', 'title', 'work', '#/work/'],
    ['agreements', 'title', 'agreement', '#/agreement/'],
    ['parties', 'name', 'party', '#/people/'],
    ['disclosures', 'title', 'invention', '#/invention/'],
  ];
  for (const t of text) {
    for (const r of u.findMany(app, t[0], t[1] + ' ~ {:q}', '-updated', 20, { q: raw })) {
      hit(t[2], r.id, (r.getString('ref') ? r.getString('ref') + ' ' : '') + r.getString(t[1]), t[2], t[3] + r.id, 50);
    }
    if (t[0] === 'agreements' || t[0] === 'disclosures') {
      for (const r of u.findMany(app, t[0], 'ref != ""', '', 0)) {
        if (num.length >= 3 && normNum(r.getString('ref')) === num) hit(t[2], r.id, r.getString('ref') + ' ' + r.getString(t[1]), t[2], t[3] + r.id, 90);
      }
    }
  }
  out.sort((a, b) => b.score - a.score);
  const seen = {};
  return out.filter((x) => (seen[x.type + x.id] ? false : (seen[x.type + x.id] = true))).slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Renewal forecast                                                    */
/* ------------------------------------------------------------------ */

function shimDeadline(due, grace, cycle) {
  return {
    getString: (f) => (f === 'due_date' ? due + ' 00:00:00.000Z' : f === 'grace_end' ? (grace ? grace + ' 00:00:00.000Z' : '') : ''),
    getInt: (f) => (f === 'cycle' ? cycle : 0),
  };
}

function forecast(app, years) {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const home = String(u.setting(app, 'home_currency', 'USD') || 'USD');
  const rates = fx.rateMap(app);
  const today = u.today();
  const horizon = u.addYMD(today, years || 5, 0, 0);
  const items = [];
  const rows = u.findMany(app, 'deadlines', 'status = "open" && (category = "renewal" || category = "maintenance")', 'due_date', 0);
  const rulesCache = {};
  for (const dl of rows) {
    const mid = dl.getString('matter');
    if (!mid) continue;
    const m = u.byId(app, 'matters', mid);
    if (m === null || engine.statusGroup(m.getString('status')) === 'dead') continue;
    const renewal = u.findOne(app, 'renewals', 'deadline = {:d}', { d: dl.id });
    if (renewal !== null && renewal.getString('decision') === 'lapse') continue;
    const ruleId = dl.getString('rule');
    if (ruleId && !rulesCache[ruleId]) {
      const rr = u.byId(app, 'rules', ruleId);
      rulesCache[ruleId] = rr ? engine.ruleObj(rr) : null;
    }
    const rule = ruleId ? rulesCache[ruleId] : null;
    const due = u.d10(dl.getString('due_date'));
    let amount = renewal !== null ? renewal.getFloat('official_fee') + renewal.getFloat('other_fee') : 0;
    let currency = renewal !== null ? renewal.getString('currency') : '';
    if (!(amount > 0) && rule) {
      const est = engine.estimateFee(app, dl, rule, m);
      amount = est.official_fee;
      currency = est.currency;
    }
    const push = (d, amt, cur, label, projected) => {
      if (d > horizon) return;
      const conv = amt > 0 && cur ? fx.convert(app, amt, cur, home, rates) : null;
      const prop = m.getString('property') ? u.byId(app, 'properties', m.getString('property')) : null;
      items.push({
        date: d,
        year: d.slice(0, 4),
        matter_id: m.id,
        ref: m.getString('ref'),
        title: label,
        jurisdiction: m.getString('jurisdiction'),
        ip_type: m.getString('ip_type'),
        property: prop ? prop.getString('name') : 'Unassigned',
        amount: amt,
        currency: cur,
        home_amount: conv,
        projected: projected,
      });
    };
    push(due, amount, currency, dl.getString('title'), false);
    // Project future cycles of recurring rules.
    if (rule && rule.every > 0) {
      const subject = engine.subjectFromRecord('matter', m);
      const ev = dl.getString('base_event') ? u.byId(app, 'events', dl.getString('base_event')) : null;
      const evDate = ev ? u.d10(ev.getString('date')) : u.d10(dl.getString('base_date'));
      const expiry = u.d10(m.getString('expiry_date'));
      for (let n = (dl.getInt('cycle') || rule.first) + 1; n < (dl.getInt('cycle') || rule.first) + 40; n++) {
        const c = engine.computeRule(app, rule, subject, evDate, n, {}, 0);
        if (c === null || c.due > horizon) break;
        if (rule.until > 0 && c.due > u.addYMD(c.base_date, rule.until, 0, 0)) break;
        if (rule.conditions && rule.conditions.stop_at_expiry && expiry && c.due > expiry) break;
        const est = engine.estimateFee(app, shimDeadline(c.due, c.grace_end, n), rule, m);
        const title = rule.title.split('{n}').join(String(n)).split('{n0}').join(String(n * rule.every));
        push(c.due, est.official_fee, est.currency, title, true);
      }
    }
  }
  items.sort((a, b) => (a.date < b.date ? -1 : 1));
  const byYear = {};
  for (const it of items) {
    if (!byYear[it.year]) byYear[it.year] = { year: it.year, total: 0, count: 0, unknown: 0, by_jurisdiction: {} };
    const y = byYear[it.year];
    y.count += 1;
    if (it.home_amount !== null && it.home_amount > 0) {
      y.total += it.home_amount;
      y.by_jurisdiction[it.jurisdiction] = (y.by_jurisdiction[it.jurisdiction] || 0) + it.home_amount;
    } else y.unknown += 1;
  }
  return { currency: home, horizon: horizon, years: Object.keys(byYear).sort().map((k) => byYear[k]), items: items };
}

/* ------------------------------------------------------------------ */
/* Coverage                                                            */
/* ------------------------------------------------------------------ */

function coverage(app, propertyId) {
  const u = require(`${__hooks}/lib_util.js`);
  const fams = u.findMany(app, 'families', 'property = {:p} && kind = "trademark"', 'title', 0, { p: propertyId });
  const marks = [];
  const jurSet = {};
  const classSet = {};
  for (const f of fams) {
    const matters = u.findMany(app, 'matters', 'family = {:f}', 'jurisdiction', 0, { f: f.id });
    const cells = {};
    for (const m of matters) {
      const j = m.getString('jurisdiction');
      jurSet[j] = true;
      const gs = u.findMany(app, 'goods_services', 'matter = {:m}', 'nice_class', 0, { m: m.id });
      if (!gs.length) {
        cells['*|' + j] = { status: m.getString('status'), group: m.getString('status_group'), matter: m.id, ref: m.getString('ref') };
      }
      for (const g of gs) {
        const c = g.getInt('nice_class');
        classSet[c] = true;
        const cs = g.getString('class_status') || '';
        cells[c + '|' + j] = {
          status: cs || m.getString('status'),
          group: cs === 'deleted' || cs === 'cancelled' || cs === 'refused' ? 'dead' : m.getString('status_group'),
          matter: m.id,
          ref: m.getString('ref'),
        };
      }
    }
    marks.push({ family: f.id, title: f.getString('title'), cells: cells });
  }
  const counts = {};
  for (const ty of ['patent', 'design', 'copyright', 'trademark']) {
    // A matter belongs to the property directly or through its family.
    counts[ty] = u.findMany(app, 'matters', '(property = {:p} || family.property = {:p}) && ip_type = {:t} && status_group != "dead"', '', 0, { p: propertyId, t: ty }).length;
  }
  return {
    jurisdictions: Object.keys(jurSet).sort(),
    classes: Object.keys(classSet).map(Number).sort((a, b) => a - b),
    marks: marks,
    counts: counts,
  };
}

/* ------------------------------------------------------------------ */
/* Standard reports                                                    */
/* ------------------------------------------------------------------ */

/** Plain words for stored codes, so exported reports read without a legend. */
const LABELS = {
  kind: { hard: 'Statutory', extendable: 'Extendable', designated: 'Set by office', internal: 'Internal', reminder: 'Reminder' },
  ip_type: { patent: 'Patent', utility_model: 'Utility model', design: 'Design', trademark: 'Trademark', copyright: 'Copyright', domain: 'Domain name' },
  status: {
    to_file: 'To file', filed: 'Filed', published: 'Published', examination: 'In examination', office_action: 'Office action', allowed: 'Allowed',
    opposed: 'Opposed', granted: 'Granted', registered: 'Registered', in_grace: 'In grace period', lapsed: 'Lapsed', abandoned: 'Abandoned',
    withdrawn: 'Withdrawn', refused: 'Refused', expired: 'Expired', revoked: 'Revoked', transferred_out: 'Transferred out',
  },
  agreement_type: {
    option: 'Option', acquisition: 'Acquisition', assignment: 'Assignment', license_in: 'Licence in', license_out: 'Licence out', talent: 'Talent',
    services: 'Services', distribution: 'Distribution', merchandise: 'Merchandise licence', sync: 'Sync licence', master_use: 'Master use licence',
    co_production: 'Co-production', coexistence: 'Coexistence or consent', settlement: 'Settlement', nda: 'NDA', rnd: 'R&D or collaboration',
    employment_ip: 'Employee IP assignment', other: 'Other',
  },
  direction: { in: 'Rights in', out: 'Rights out', mutual: 'Mutual', none: 'No rights' },
  decision: { pending: 'Not decided', renew: 'Renew', renew_partial: 'Renew, drop classes', lapse: 'Let lapse', defer: 'Decide later' },
  instruction: { not_instructed: 'Not instructed', instructed: 'Instructed', paid: 'Paid', confirmed: 'Confirmed', lapsed: 'Lapsed' },
  stage: {
    draft: 'Draft', submitted: 'Submitted', search: 'Patentability search', review: 'Committee review', approved: 'Approved', drafting: 'Drafting',
    filed: 'Filed', rejected: 'Not pursued', on_hold: 'On hold', merged: 'Merged', archived: 'Archived',
  },
  action: { create: 'Created', update: 'Changed', delete: 'Deleted', decide: 'Decided', accept: 'Accepted', reject: 'Rejected', instruct: 'Instructed', move: 'Moved', import: 'Imported', close: 'Closed', extend: 'Extended', reassign: 'Reassigned', sync: 'Synced', event: 'Recorded event', regenerate: 'Recalculated' },
};

function lab(group, v) {
  const m = LABELS[group];
  return m && m[v] ? m[v] : v;
}

function col(key, label, type) {
  return { key: key, label: label, type: type || 'text' };
}

function runReport(app, name, params) {
  const u = require(`${__hooks}/lib_util.js`);
  const p = params || {};
  const today = u.today();
  if (name === 'deadlines') {
    const days = Number(p.days || 90);
    const rows = u.findMany(app, 'deadlines', 'status = "open" && due_date <= {:h}', 'due_date', 0, { h: u.toPb(u.addDays(today, days)) });
    return {
      title: 'Open deadlines, next ' + days + ' days (including overdue)',
      columns: [col('ref', 'Reference'), col('title', 'Deadline'), col('kind', 'Kind'), col('jurisdiction', 'Jurisdiction'), col('due', 'Due', 'date'), col('final', 'Final', 'date'), col('assignee', 'Assignee'), col('citation', 'Basis')],
      rows: rows.map((d) => ({
        ref: d.getString('ref'),
        title: d.getString('title'),
        kind: lab('kind', d.getString('kind')),
        jurisdiction: d.getString('jurisdiction'),
        due: u.d10(d.getString('due_date')),
        final: u.d10(d.getString('final_date')),
        assignee: d.getString('assignee') ? u.userLabel(app, d.getString('assignee')) : '',
        citation: d.getString('citation'),
      })),
    };
  }
  if (name === 'portfolio') {
    const rows = u.findMany(app, 'matters', p.include_dead ? '' : 'status_group != "dead"', 'ref', 0);
    const props = {};
    return {
      title: 'Portfolio register',
      columns: [col('ref', 'Reference'), col('title', 'Title'), col('type', 'Type'), col('jurisdiction', 'Jurisdiction'), col('status', 'Status'), col('application_no', 'Application no.'), col('filing', 'Filed', 'date'), col('registration_no', 'Registration no.'), col('registration', 'Registered', 'date'), col('expiry', 'Expiry', 'date'), col('property', 'Property'), col('next', 'Next deadline', 'date')],
      rows: rows.map((m) => {
        const pid = m.getString('property');
        if (pid && props[pid] === undefined) {
          const pr = u.byId(app, 'properties', pid);
          props[pid] = pr ? pr.getString('name') : '';
        }
        return {
          ref: m.getString('ref'),
          title: m.getString('title'),
          type: lab('ip_type', m.getString('ip_type')),
          jurisdiction: m.getString('jurisdiction'),
          status: lab('status', m.getString('status')),
          application_no: m.getString('application_no'),
          filing: u.d10(m.getString('filing_date')),
          registration_no: m.getString('registration_no'),
          registration: u.d10(m.getString('registration_date')),
          expiry: u.d10(m.getString('expiry_date')),
          property: pid ? props[pid] : '',
          next: u.d10(m.getString('next_deadline')),
        };
      }),
    };
  }
  if (name === 'agreements_expiring') {
    const days = Number(p.days || 180);
    const rows = u.findMany(app, 'agreements', 'status = "active" && perpetual = false && term_end != "" && term_end <= {:h}', 'term_end', 0, { h: u.toPb(u.addDays(today, days)) });
    return {
      title: 'Active agreements ending in the next ' + days + ' days',
      columns: [col('ref', 'Reference'), col('title', 'Agreement'), col('type', 'Type'), col('direction', 'Direction'), col('counterparty', 'Counterparty'), col('term_end', 'Term ends', 'date'), col('auto_renew', 'Auto-renews')],
      rows: rows.map((a) => {
        const cp = a.getString('counterparty') ? u.byId(app, 'parties', a.getString('counterparty')) : null;
        return {
          ref: a.getString('ref'),
          title: a.getString('title'),
          type: lab('agreement_type', a.getString('agreement_type')),
          direction: lab('direction', a.getString('direction')),
          counterparty: cp ? cp.getString('name') : '',
          term_end: u.d10(a.getString('term_end')),
          auto_renew: a.getBool('auto_renew') ? 'Yes' : 'No',
        };
      }),
    };
  }
  if (name === 'chain_of_title') {
    const works = u.findMany(app, 'works', '', 'title', 0);
    return {
      title: 'Chain of title and clearance by work',
      columns: [col('title', 'Work'), col('type', 'Type'), col('cleared', 'Cleared', 'number'), col('open', 'Open', 'number'), col('risk', 'Cleared with risk', 'number'), col('blocked', 'Not cleared', 'number'), col('documents', 'Chain-of-title documents', 'number'), col('registrations', 'Copyright registrations', 'number')],
      rows: works.map((w) => {
        const cl = u.findMany(app, 'clearances', 'work = {:w}', '', 0, { w: w.id });
        const n = (s) => cl.filter((c) => c.getString('status') === s).length;
        return {
          title: w.getString('title'),
          type: w.getString('work_type'),
          cleared: n('cleared'),
          open: cl.filter((c) => ['not_started', 'requested', 'in_progress'].indexOf(c.getString('status')) >= 0).length,
          risk: n('cleared_with_risk'),
          blocked: n('not_cleared'),
          documents: u.findMany(app, 'documents', 'work = {:w} && doc_type = "chain_of_title"', '', 0, { w: w.id }).length,
          registrations: u.findMany(app, 'matters', 'work = {:w} && ip_type = "copyright"', '', 0, { w: w.id }).length,
        };
      }),
    };
  }
  if (name === 'renewal_decisions') {
    const rows = u.findMany(app, 'renewals', 'instruction_status != "confirmed" && instruction_status != "lapsed"', 'due_date', 0);
    return {
      title: 'Renewal decisions and instructions',
      columns: [col('ref', 'Reference'), col('renewal', 'Renewal'), col('jurisdiction', 'Jurisdiction'), col('due', 'Due', 'date'), col('grace', 'Grace ends', 'date'), col('fee', 'Official fee'), col('home', 'Home currency', 'number'), col('decision', 'Decision'), col('instruction', 'Instruction'), col('provider', 'Provider'), col('po', 'PO number')],
      rows: rows.map((r) => {
        const m = u.byId(app, 'matters', r.getString('matter'));
        return {
          ref: m ? m.getString('ref') : '',
          renewal: r.getString('cycle_label'),
          jurisdiction: m ? m.getString('jurisdiction') : '',
          due: u.d10(r.getString('due_date')),
          grace: u.d10(r.getString('grace_end')),
          fee: r.getFloat('official_fee') > 0 ? u.money(r.getFloat('official_fee'), r.getString('currency')) : 'Unknown',
          home: r.getFloat('home_amount'),
          decision: lab('decision', r.getString('decision')),
          instruction: lab('instruction', r.getString('instruction_status')),
          provider: r.getString('provider'),
          po: r.getString('po_number'),
        };
      }),
    };
  }
  if (name === 'forecast') {
    const f = forecast(app, Number(p.years || 5));
    return {
      title: 'Renewal cost forecast (' + f.currency + ')',
      columns: [col('date', 'Due', 'date'), col('ref', 'Reference'), col('title', 'Renewal'), col('jurisdiction', 'Jurisdiction'), col('property', 'Property'), col('fee', 'Official fee'), col('home', f.currency, 'number'), col('projected', 'Projected')],
      rows: f.items.map((it) => ({
        date: it.date,
        ref: it.ref,
        title: it.title,
        jurisdiction: it.jurisdiction,
        property: it.property,
        fee: it.amount > 0 ? u.money(it.amount, it.currency) : 'Unknown',
        home: it.home_amount === null ? '' : it.home_amount,
        projected: it.projected ? 'Projected' : 'Scheduled',
      })),
    };
  }
  if (name === 'inventions') {
    const rows = u.findMany(app, 'disclosures', '', '-created', 0);
    return {
      title: 'Invention pipeline',
      columns: [col('ref', 'Reference'), col('title', 'Title'), col('stage', 'Stage'), col('submitted', 'Submitted', 'date'), col('score', 'Score', 'number'), col('reviews', 'Reviews', 'number'), col('inventors', 'Inventors'), col('bar', 'Earliest bar date', 'date')],
      rows: rows.map((d) => ({
        ref: d.getString('ref'),
        title: d.getString('title'),
        stage: lab('stage', d.getString('stage')),
        submitted: u.d10(d.getString('submitted_at')),
        score: Math.round(d.getFloat('score')),
        reviews: d.getInt('review_count'),
        inventors: d.getString('inventor_names'),
        bar: u.minDay([d.getString('public_disclosure_date'), d.getString('on_sale_date')]),
      })),
    };
  }
  if (name === 'audit') {
    const from = u.d10(p.from) || u.addDays(today, -30);
    const to = u.d10(p.to) || today;
    const rows = u.findMany(app, 'audit_log', 'created >= {:a} && created <= {:b}', '-created', 5000, { a: from + ' 00:00:00.000Z', b: to + ' 23:59:59.999Z' });
    return {
      title: 'Audit log ' + u.human(from) + ' to ' + u.human(to),
      columns: [col('when', 'When'), col('who', 'Who'), col('action', 'Action'), col('collection', 'Record type'), col('label', 'Record'), col('reason', 'Reason'), col('changes', 'Changes')],
      rows: rows.map((r) => ({
        when: r.getString('created').slice(0, 16),
        who: r.getString('actor_name'),
        action: lab('action', r.getString('action')),
        collection: r.getString('collection').replace(/_/g, ' '),
        label: r.getString('record_label'),
        reason: r.getString('reason'),
        changes: JSON.stringify(u.j(r, 'changes', {})).slice(0, 500),
      })),
    };
  }
  throw new Error('Unknown report: ' + name);
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

const IMPORT_TYPES = ['patent', 'utility_model', 'design', 'trademark', 'copyright', 'domain'];
const IMPORT_STATUS = [
  'to_file', 'filed', 'published', 'examination', 'office_action', 'allowed', 'opposed', 'granted', 'registered',
  'in_grace', 'lapsed', 'abandoned', 'withdrawn', 'refused', 'expired', 'revoked', 'transferred_out',
];

function importMatters(app, rows, dryRun, generate, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  const results = [];
  let created = 0;
  let updated = 0;
  let errors = 0;
  let deadlines = 0;
  const familyCache = {};
  const propertyCache = {};
  rows.forEach(function (row, idx) {
    const r = row || {};
    const line = idx + 1;
    const ipType = String(r.ip_type || '').trim().toLowerCase().replace(/\s+/g, '_');
    const jur = String(r.jurisdiction || '').trim().toUpperCase();
    const title = String(r.title || '').trim();
    const problems = [];
    if (IMPORT_TYPES.indexOf(ipType) < 0) problems.push('IP type must be one of ' + IMPORT_TYPES.join(', '));
    if (!/^[A-Z]{2}$/.test(jur)) problems.push('Jurisdiction must be a 2-letter office code (US, EP, EM, JP, WO, GB...)');
    if (!title) problems.push('Title is required');
    const status = String(r.status || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (status && IMPORT_STATUS.indexOf(status) < 0) problems.push('Unknown status "' + r.status + '"');
    const dates = {};
    for (const f of ['filing_date', 'publication_date', 'registration_date']) {
      const v = String(r[f] || '').trim();
      if (!v) continue;
      const d = u.officeDate(v);
      if (!d) problems.push(f.replace('_', ' ') + ' "' + v + '" is not a date (use YYYY-MM-DD)');
      else dates[f] = d;
    }
    if (problems.length) {
      errors += 1;
      results.push({ line: line, action: 'error', message: problems.join('; '), title: title });
      return;
    }
    const appNo = String(r.application_no || '').trim();
    let existing = null;
    if (r.ref) existing = u.findOne(app, 'matters', 'ref = {:r}', { r: String(r.ref).trim() });
    if (existing === null && appNo) {
      const cands = u.findMany(app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur });
      for (const c of cands) if (normNum(c.getString('application_no')) === normNum(appNo)) existing = c;
    }
    const action = existing ? 'update' : 'create';
    if (dryRun) {
      results.push({ line: line, action: action, message: action === 'update' ? 'Updates ' + existing.getString('ref') : 'Creates a new ' + ipType.replace('_', ' '), title: title });
      if (action === 'create') created += 1;
      else updated += 1;
      return;
    }
    try {
      let familyId = '';
      const famTitle = String(r.family || '').trim();
      const famKind = ipType === 'trademark' ? 'trademark' : ipType === 'design' ? 'design' : ipType === 'patent' || ipType === 'utility_model' ? 'patent' : '';
      if (famTitle && famKind) {
        const k = famKind + '|' + famTitle.toLowerCase();
        if (!familyCache[k]) {
          let f = u.findOne(app, 'families', 'kind = {:k} && title = {:t}', { k: famKind, t: famTitle });
          if (f === null) {
            f = u.newRecord(app, 'families', { kind: famKind, title: famTitle, strategy: 'maintain' });
            app.save(f);
          }
          familyCache[k] = f.id;
        }
        familyId = familyCache[k];
      }
      let propertyId = '';
      const propName = String(r.property || '').trim();
      if (propName) {
        const k = propName.toLowerCase();
        if (!propertyCache[k]) {
          let pr = u.findOne(app, 'properties', 'name = {:n}', { n: propName });
          if (pr === null) {
            pr = u.newRecord(app, 'properties', { name: propName, kind: 'franchise', status: 'active', rights_basis: 'owned' });
            app.save(pr);
          }
          propertyCache[k] = pr.id;
        }
        propertyId = propertyCache[k];
      }
      const m = existing || u.newRecord(app, 'matters', { ip_type: ipType, jurisdiction: jur, status: status || 'filed', route: 'national', relation: 'none' });
      m.set('title', title);
      if (appNo) m.set('application_no', appNo);
      if (r.publication_no) m.set('publication_no', String(r.publication_no).trim());
      if (r.registration_no) m.set('registration_no', String(r.registration_no).trim());
      for (const f of Object.keys(dates)) m.set(f, u.toPb(dates[f]));
      if (status) m.set('status', status);
      if (familyId) m.set('family', familyId);
      if (propertyId) m.set('property', propertyId);
      if (r.owner_of_record) m.set('owner_of_record', String(r.owner_of_record));
      if (r.counsel) m.set('counsel', String(r.counsel));
      if (r.client_ref) m.set('client_ref', String(r.client_ref));
      if (r.route) m.set('route', String(r.route).trim().toLowerCase());
      if (r.entity_size) m.set('entity_size', String(r.entity_size).trim().toLowerCase());
      if (r.notes) m.set('notes', String(r.notes));
      app.save(m);
      if (ipType === 'trademark' && r.classes) {
        const have = {};
        for (const g of u.findMany(app, 'goods_services', 'matter = {:m}', '', 0, { m: m.id })) have[g.getInt('nice_class')] = true;
        for (const c of String(r.classes).split(/[^0-9]+/)) {
          const n = parseInt(c, 10);
          if (n >= 1 && n <= 45 && !have[n]) {
            const g = u.newRecord(app, 'goods_services', { matter: m.id, nice_class: n, class_status: m.getString('status_group') === 'live' ? 'registered' : 'pending' });
            app.save(g);
            have[n] = true;
          }
        }
      }
      if (!existing) {
        const subject = engine.subjectFromRecord('matter', u.byId(app, 'matters', m.id));
        const evs = [];
        if (dates.filing_date) evs.push(['FILED', dates.filing_date]);
        if (dates.publication_date) evs.push(['PUBLISHED', dates.publication_date]);
        if (dates.registration_date) evs.push([ipType === 'patent' || ipType === 'utility_model' ? 'GRANTED' : 'REGISTERED', dates.registration_date]);
        for (const e of evs) {
          const res = engine.recordEvent(app, subject, e[0], e[1], { source: 'system', actorId: actorId, commit: generate !== false, label: engine.EVENT_CODES[e[0]].label + ' (imported)' });
          deadlines += res.created.length;
          subject.record = u.byId(app, 'matters', m.id);
        }
        created += 1;
      } else updated += 1;
      results.push({ line: line, action: action, message: (action === 'create' ? 'Created ' : 'Updated ') + (u.byId(app, 'matters', m.id).getString('ref') || ''), title: title, id: m.id });
    } catch (err) {
      errors += 1;
      results.push({ line: line, action: 'error', message: String(err.message || err), title: title });
    }
  });
  if (!dryRun) u.audit(app, actorId, 'import', 'matters', '', 'CSV import', { created: created, updated: updated, errors: errors, deadlines: deadlines }, '');
  return { dry_run: dryRun, created: created, updated: updated, errors: errors, deadlines: deadlines, results: results };
}

function importWatch(app, rows, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  let created = 0;
  const errors = [];
  rows.forEach(function (r, i) {
    if (!r || !String(r.their_mark || '').trim()) {
      errors.push('Line ' + (i + 1) + ': their_mark is required');
      return;
    }
    let familyId = '';
    if (r.our_mark) {
      const f = u.findOne(app, 'families', 'kind = "trademark" && title = {:t}', { t: String(r.our_mark).trim() });
      if (f) familyId = f.id;
    }
    const rec = u.newRecord(app, 'watch_hits', {
      family: familyId,
      their_mark: String(r.their_mark).trim(),
      their_owner: String(r.their_owner || ''),
      jurisdiction: String(r.jurisdiction || '').toUpperCase().slice(0, 3),
      application_no: String(r.application_no || ''),
      classes: String(r.classes || ''),
      goods: String(r.goods || ''),
      publication_date: u.toPb(u.officeDate(r.publication_date)),
      opposition_deadline: u.toPb(u.officeDate(r.opposition_deadline)),
      score: Number(r.score || 0) || 0,
      status: 'new',
      source: String(r.source || 'Import'),
    });
    app.save(rec);
    created += 1;
  });
  u.audit(app, actorId, 'import', 'watch_hits', '', 'Watch import', { created: created, errors: errors.length }, '');
  return { created: created, errors: errors };
}

module.exports = {
  summary: summary,
  search: search,
  forecast: forecast,
  coverage: coverage,
  runReport: runReport,
  importMatters: importMatters,
  importWatch: importWatch,
  normNum: normNum,
};
