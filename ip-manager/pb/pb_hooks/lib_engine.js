/// <reference path="../pb_data/types.d.ts" />
/**
 * The deadline engine. One engine for every dated obligation: patent and
 * trademark prosecution, annuities and renewals, copyright registration and
 * termination windows, and agreement obligations.
 *
 * Principles (from the product research):
 * - rules are data (collection `rules`), versioned by effective date;
 * - calendar-month arithmetic, never day counts;
 * - closure-day roll-forward by the office where the act is due;
 * - every computed date carries its explanation (calculation.steps) and
 *   citation, so the UI can answer "Why this date?";
 * - preview before creating, diff before regenerating, never duplicate
 *   (deadlines carry a stable `key`), never delete (close with a reason);
 * - a person can lock a date; locked dates are never recomputed.
 */

const EVENT_CODES = {
  FILED: { label: 'Application filed', status: 'filed', field: 'filing_date', st27: 'A10' },
  PUBLISHED: { label: 'Application published', status: 'published', field: 'publication_date' },
  SEARCH_REPORT_PUBLISHED: { label: 'Search report published', status: null },
  EXAM_REQUESTED: { label: 'Examination requested', status: 'examination' },
  OA_NONFINAL: { label: 'Non-final rejection (US)', status: 'office_action' },
  OA_FINAL: { label: 'Final rejection (US)', status: 'office_action' },
  RESTRICTION: { label: 'Restriction requirement (US)', status: 'office_action' },
  OA_ISSUED: { label: 'Office action or examination communication', status: 'office_action' },
  RESPONSE_FILED: { label: 'Response filed', status: 'examination' },
  NOTICE_ALLOWANCE: { label: 'Notice of allowance or decision to grant', status: 'allowed' },
  R71_3: { label: 'Intention to grant (EP Rule 71(3))', status: 'allowed' },
  GRANTED: { label: 'Granted', status: 'granted', field: 'registration_date', st27: 'F10' },
  EP_GRANT_MENTION: { label: 'Mention of grant published (EP)', status: 'granted', field: 'registration_date', st27: 'F10' },
  UNITARY_REGISTERED: { label: 'Unitary effect registered', status: 'granted' },
  VALIDATED: { label: 'Validated', status: 'granted' },
  REGISTERED: { label: 'Registered', status: 'registered', field: 'registration_date', st27: 'F10' },
  GAZETTE_PUBLISHED: { label: 'Registration gazette published', status: null },
  RENEWED: { label: 'Renewed', status: 'registered', st27: 'U10' },
  ANNUITY_PAID: { label: 'Annuity or maintenance fee paid', status: null, st27: 'U10' },
  DECLARATION_ACCEPTED: { label: 'Use declaration accepted', status: null },
  OPPOSITION_FILED: { label: 'Opposition filed', status: 'opposed' },
  APPEAL_FILED: { label: 'Appeal filed', status: 'examination' },
  REFUSED: { label: 'Refused (decision of refusal)', status: 'refused', st27: 'B10' },
  ABANDONED: { label: 'Abandoned', status: 'abandoned', st27: 'B10' },
  WITHDRAWN: { label: 'Withdrawn', status: 'withdrawn', st27: 'B10' },
  LAPSED: { label: 'Lapsed', status: 'lapsed', st27: 'H10' },
  EXPIRED: { label: 'Expired', status: 'expired', st27: 'H10' },
  REVOKED: { label: 'Revoked or cancelled', status: 'revoked', st27: 'H10' },
  ASSIGNED: { label: 'Assignment recorded', status: null, st27: 'S10' },
  NATIONAL_PHASE_ENTERED: { label: 'National or regional phase entered', status: null },
  AUTHOR_GRANT_EXECUTED: { label: 'Author grant executed', status: null },
  WORK_PUBLISHED: { label: 'Work first published', status: null },
  OTHER: { label: 'Other event', status: null },
};

const STATUS_GROUP = {
  to_file: 'pre_filing',
  filed: 'pending',
  published: 'pending',
  examination: 'pending',
  office_action: 'pending',
  allowed: 'pending',
  opposed: 'pending',
  granted: 'live',
  registered: 'live',
  in_grace: 'live',
  lapsed: 'dead',
  abandoned: 'dead',
  withdrawn: 'dead',
  refused: 'dead',
  expired: 'dead',
  revoked: 'dead',
  transferred_out: 'dead',
};

const STATUTORY = { hard: true, extendable: true, designated: true };
const BASE_LABEL = {
  event_date: 'Event date',
  filing_date: 'Filing date',
  priority_date: 'Earliest priority date',
  publication_date: 'Publication date',
  registration_date: 'Registration or grant date',
  expiry_date: 'Expiry date',
  signed_date: 'Agreement signature date',
  term_end: 'Agreement term end',
};

function statusGroup(status) {
  return STATUS_GROUP[status] || 'pending';
}

/* ------------------------------------------------------------------ */
/* Subjects                                                            */
/* ------------------------------------------------------------------ */

function subjectOf(app, type, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const coll = type === 'matter' ? 'matters' : type === 'agreement' ? 'agreements' : 'works';
  const rec = u.byId(app, coll, id);
  if (rec === null) return null;
  return subjectFromRecord(type, rec);
}

function subjectFromRecord(type, rec) {
  if (type === 'matter') {
    return {
      type: 'matter',
      id: rec.id,
      record: rec,
      ip_type: rec.getString('ip_type'),
      jurisdiction: rec.getString('jurisdiction').toUpperCase(),
      route: rec.getString('route'),
      label: rec.getString('ref') || rec.getString('title'),
    };
  }
  if (type === 'agreement') {
    return {
      type: 'agreement',
      id: rec.id,
      record: rec,
      ip_type: 'agreement',
      jurisdiction: '*',
      route: '',
      label: rec.getString('ref') || rec.getString('title'),
    };
  }
  return {
    type: 'work',
    id: rec.id,
    record: rec,
    ip_type: 'work',
    jurisdiction: rec.getString('publication_country').toUpperCase(),
    route: '',
    label: rec.getString('title'),
  };
}

function subjectEvents(app, subject) {
  const u = require(`${__hooks}/lib_util.js`);
  return u.findMany(app, 'events', subject.type + ' = {:id}', 'date', 0, { id: subject.id });
}

/* ------------------------------------------------------------------ */
/* Rules                                                               */
/* ------------------------------------------------------------------ */

function ruleObj(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  return {
    id: rec.id,
    code: rec.getString('code'),
    name: rec.getString('name'),
    ip_type: rec.getString('ip_type'),
    jurisdiction: rec.getString('jurisdiction').toUpperCase(),
    routes: u.j(rec, 'routes', []),
    trigger_event: rec.getString('trigger_event'),
    conditions: u.j(rec, 'conditions', {}),
    base: rec.getString('base'),
    oy: rec.getInt('offset_years'),
    om: rec.getInt('offset_months'),
    od: rec.getInt('offset_days'),
    eom: rec.getBool('due_end_of_month'),
    kind: rec.getString('kind'),
    category: rec.getString('category') || 'other',
    title: rec.getString('title'),
    extensions: u.j(rec, 'extensions', []),
    final_offset_months: rec.getInt('final_offset_months'),
    window_months: rec.getInt('window_months'),
    grace_months: rec.getInt('grace_months'),
    grace_note: rec.getString('grace_note'),
    every: rec.getInt('recurring_years'),
    until: rec.getInt('recurring_until_years'),
    first: rec.getInt('recurring_first_cycle') || 1,
    cycle_label: rec.getString('cycle_label'),
    roll_office: rec.getString('roll_office').toUpperCase(),
    citation: rec.getString('citation'),
    notes: rec.getString('notes'),
    effective_from: u.d10(rec.getString('effective_from')),
    effective_to: u.d10(rec.getString('effective_to')),
    version: rec.getInt('version') || 1,
    creates_renewal: rec.getBool('creates_renewal'),
    fee_kind: rec.getString('fee_kind'),
  };
}

function candidateRules(app, code) {
  const u = require(`${__hooks}/lib_util.js`);
  return u.findMany(app, 'rules', 'enabled = true && trigger_event = {:c}', 'code', 0, { c: code }).map(ruleObj);
}

function hasRegistration(app, workId, jurisdiction) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = u.findMany(app, 'matters', 'work = {:w} && ip_type = "copyright"', '', 0, { w: workId });
  for (const r of rows) {
    if (!jurisdiction || r.getString('jurisdiction').toUpperCase() === jurisdiction) return true;
  }
  return false;
}

function ruleMatches(app, rule, subject, eventDate, eventsCache) {
  if (rule.ip_type !== subject.ip_type && rule.ip_type !== 'any') return false;
  if (subject.type !== 'agreement' && rule.jurisdiction !== '*' && rule.jurisdiction !== subject.jurisdiction) return false;
  if (rule.routes.length > 0 && rule.routes.indexOf(subject.route || 'national') < 0) return false;
  if (rule.effective_from && eventDate && eventDate < rule.effective_from) return false;
  if (rule.effective_to && eventDate && eventDate > rule.effective_to) return false;
  const c = rule.conditions || {};
  const rec = subject.record;
  if (c.first_filing === true && subject.type === 'matter') {
    const u = require(`${__hooks}/lib_util.js`);
    const prios = u.j(rec, 'priority_claims', []);
    const rel = rec.getString('relation');
    if ((Array.isArray(prios) && prios.length > 0) || (rel !== '' && rel !== 'none') || rec.getString('parent') !== '') return false;
    if (rec.getString('route') === 'pct' && rule.code.indexOf('PARIS') === 0 && prios.length > 0) return false;
  }
  if (Array.isArray(c.not_routes) && c.not_routes.indexOf(subject.route) >= 0) return false;
  if (c.tm_register && subject.type === 'matter' && rec.getString('tm_register') !== '' && rec.getString('tm_register') !== c.tm_register) {
    return false;
  }
  if (c.option && subject.type === 'matter') {
    const u = require(`${__hooks}/lib_util.js`);
    const opts = u.j(rec, 'options', {});
    if (!opts || opts[c.option] !== true) return false;
  }
  if (c.no_copyright_registration === true && subject.type === 'work') {
    if (hasRegistration(app, subject.id, rule.jurisdiction === '*' ? '' : rule.jurisdiction)) return false;
  }
  if (c.stop_on_event && eventsCache) {
    for (const ev of eventsCache) if (ev.getString('code') === c.stop_on_event) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Date computation                                                    */
/* ------------------------------------------------------------------ */

function earliestPriority(rec) {
  const u = require(`${__hooks}/lib_util.js`);
  const list = [u.d10(rec.getString('filing_date'))];
  const prios = u.j(rec, 'priority_claims', []);
  if (Array.isArray(prios)) for (const p of prios) list.push(u.d10(p && p.date));
  return u.minDay(list);
}

function resolveBase(rule, subject, eventDate) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = subject.record;
  let base = '';
  let label = BASE_LABEL[rule.base] || 'Base date';
  switch (rule.base) {
    case 'filing_date':
      base = subject.type === 'matter' ? u.d10(rec.getString('filing_date')) : '';
      break;
    case 'priority_date':
      base = subject.type === 'matter' ? earliestPriority(rec) : '';
      break;
    case 'publication_date':
      base = subject.type === 'matter' ? u.d10(rec.getString('publication_date')) : '';
      break;
    case 'registration_date':
      base = subject.type === 'matter' ? u.d10(rec.getString('registration_date')) : '';
      break;
    case 'expiry_date':
      base = subject.type === 'matter' ? u.d10(rec.getString('expiry_date')) : '';
      break;
    case 'signed_date':
      base = subject.type === 'agreement' ? u.d10(rec.getString('signed_date')) : '';
      break;
    case 'term_end':
      base = subject.type === 'agreement' ? u.d10(rec.getString('term_end')) : '';
      break;
    default:
      base = '';
  }
  if (base === '') {
    base = u.d10(eventDate);
    if (rule.base !== 'event_date') label = BASE_LABEL[rule.base] + ' (not recorded yet, event date used)';
    else label = 'Event date';
  }
  return { date: base, label: label };
}

function offsetText(y, m, d) {
  const partsT = [];
  if (y) partsT.push(y + (Math.abs(y) === 1 ? ' year' : ' years'));
  if (m) partsT.push(m + (Math.abs(m) === 1 ? ' month' : ' months'));
  if (d) partsT.push(d + (Math.abs(d) === 1 ? ' day' : ' days'));
  return partsT.length ? partsT.join(', ') : 'no offset';
}

function cycleTitle(rule, cycle) {
  let t = rule.title;
  const n0 = rule.every ? cycle * rule.every : cycle;
  t = t.split('{n}').join(String(cycle)).split('{n0}').join(String(n0));
  return t;
}

function cycleLabel(rule, cycle) {
  if (!rule.cycle_label) return '';
  const n0 = rule.every ? cycle * rule.every : cycle;
  return rule.cycle_label.split('{n}').join(String(cycle)).split('{n0}').join(String(n0));
}

function rollOfficeFor(rule, subject) {
  if (rule.roll_office) return rule.roll_office;
  if (subject.type !== 'matter') return '';
  return subject.jurisdiction;
}

/**
 * Compute every date for one rule application.
 * overrides: { period_months, due_date } for examiner-set periods.
 */
function computeRule(app, rule, subject, eventDate, cycle, overrides, bufferDays) {
  const u = require(`${__hooks}/lib_util.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  const ov = overrides || {};
  const baseInfo = resolveBase(rule, subject, eventDate);
  const base = baseInfo.date;
  if (base === '') return null;
  const steps = [];
  steps.push(baseInfo.label + ': ' + u.human(base) + '.');

  const recurring = rule.every > 0;
  const extraYears = recurring ? (cycle - rule.first) * rule.every : 0;
  let nominal = '';
  if (rule.kind === 'designated' && u.d10(ov.due_date) !== '') {
    nominal = u.d10(ov.due_date);
    steps.push('The office set the due date in the communication: ' + u.human(nominal) + '.');
  } else if (rule.kind === 'designated' && Number(ov.period_months) > 0) {
    nominal = u.addYMD(base, 0, Number(ov.period_months), 0);
    steps.push('Period set by the office: ' + ov.period_months + ' months from the base date gives ' + u.human(nominal) + '.');
  } else if (rule.kind === 'designated' && Number(ov.period_days) > 0) {
    nominal = u.addDays(base, Number(ov.period_days));
    steps.push('Period set by the office: ' + ov.period_days + ' days from the base date gives ' + u.human(nominal) + '.');
  } else {
    nominal = u.addYMD(base, rule.oy + extraYears, rule.om, rule.od);
    const off = offsetText(rule.oy + extraYears, rule.om, rule.od);
    steps.push(
      'Rule ' + rule.code + ' (v' + rule.version + '): ' + off + ' after the base date gives ' + u.human(nominal) + '.' +
        (rule.kind === 'designated' ? ' This is the usual period; confirm it against the communication.' : ''),
    );
  }
  if (rule.eom) {
    const eom = u.endOfMonth(nominal);
    if (eom !== nominal) steps.push('Due on the last day of that month: ' + u.human(eom) + '.');
    nominal = eom;
  }

  let due = nominal;
  const office = rollOfficeFor(rule, subject);
  if (STATUTORY[rule.kind] && office !== '' && office !== '*') {
    const rolled = cal.rollForward(app, office, nominal);
    if (rolled.date !== nominal) {
      for (const s of rolled.steps) steps.push(s);
      steps.push('Moves to the next day the ' + cal.officeName(office) + ' is open: ' + u.human(rolled.date) + '.');
      due = rolled.date;
    } else {
      steps.push(u.human(nominal) + ' is a ' + u.weekdayName(nominal) + ' and the ' + cal.officeName(office) + ' is open, so the date stands.');
    }
  }

  let finalDate = '';
  if (rule.kind === 'extendable' || rule.kind === 'designated') {
    let finalNominal = '';
    if (rule.final_offset_months > 0) finalNominal = u.addYMD(base, extraYears, rule.final_offset_months, 0);
    else if (rule.extensions.length > 0) {
      const last = rule.extensions[rule.extensions.length - 1];
      finalNominal = u.addYMD(nominal, 0, Number(last.months) || 0, 0);
    }
    if (finalNominal !== '') {
      finalDate = office !== '' ? cal.rollForward(app, office, finalNominal).date : finalNominal;
      const labels = rule.extensions.map(function (x) {
        return x.label;
      });
      steps.push('Extendable to ' + u.human(finalDate) + (labels.length ? ' (' + labels.join('; ') + ').' : '.'));
    }
  }

  // Window and grace run from the statutory (nominal) date, not the rolled one:
  // rolling first would push the grace end past the real last day.
  const windowOpens = rule.window_months > 0 ? u.addYMD(nominal, 0, -rule.window_months, 0) : '';
  if (windowOpens !== '') steps.push('Can be filed or paid from ' + u.human(windowOpens) + '.');

  let graceEnd = '';
  if (rule.grace_months > 0) {
    const g = u.addYMD(nominal, 0, rule.grace_months, 0);
    graceEnd = office !== '' ? cal.rollForward(app, office, g).date : g;
    steps.push('Grace period ends ' + u.human(graceEnd) + '.' + (rule.grace_note ? ' ' + rule.grace_note : ''));
  }

  let target = due;
  const buffer = Number(bufferDays) > 0 ? Number(bufferDays) : 0;
  if (STATUTORY[rule.kind] && buffer > 0) {
    target = u.addDays(due, -buffer);
    if (windowOpens !== '' && target < windowOpens) target = windowOpens;
    steps.push('Target date set ' + buffer + ' days before the due date (organization setting).');
  }

  return {
    base_date: base,
    base_label: baseInfo.label,
    nominal: nominal,
    due: due,
    target: target,
    final: finalDate,
    window_opens: windowOpens,
    grace_end: graceEnd,
    steps: steps,
    office: office,
  };
}

/* ------------------------------------------------------------------ */
/* Proposals (preview) and commit                                      */
/* ------------------------------------------------------------------ */

function deadlineKey(rule, subject, cycle, baseDate) {
  return 'rule:' + rule.code + ':' + subject.type + ':' + subject.id + ':' + (rule.every > 0 ? 'c' + cycle : baseDate);
}

function existingKeys(app, subject) {
  const u = require(`${__hooks}/lib_util.js`);
  const map = {};
  const rows = u.findMany(app, 'deadlines', subject.type + ' = {:id}', '', 0, { id: subject.id });
  for (const r of rows) {
    const k = r.getString('key');
    if (k) map[k] = r.getString('status');
  }
  return map;
}

function expiryOf(app, subject) {
  const u = require(`${__hooks}/lib_util.js`);
  if (subject.type !== 'matter') return '';
  return u.d10(subject.record.getString('expiry_date'));
}

/**
 * Deadlines a new event would create. Nothing is written.
 * event: { code, date, data, id? }
 */
function proposalsFor(app, subject, event, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = opts || {};
  const eventDate = u.d10(event.date);
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  const todayD = u.today();
  const rules = candidateRules(app, event.code);
  const events = subjectEvents(app, subject);
  const keys = existingKeys(app, subject);
  const expiry = expiryOf(app, subject);
  const out = [];
  for (const rule of rules) {
    if (!ruleMatches(app, rule, subject, eventDate, events)) continue;
    if (Array.isArray(o.onlyCodes) && o.onlyCodes.length && o.onlyCodes.indexOf(rule.code) < 0) continue;
    const overrides = (event.data && event.data.overrides && event.data.overrides[rule.code]) || (event.data || {});
    let cycle = rule.every > 0 ? rule.first : Number((rule.conditions && rule.conditions.cycle) || 0);
    let calc = null;
    if (rule.every > 0) {
      // First cycle due on/after the event whose grace end (or due) is not already past.
      let found = false;
      const baseStart = resolveBase(rule, subject, eventDate).date;
      const limit = rule.until > 0 && baseStart !== '' ? u.addYMD(baseStart, rule.until, 0, 0) : '';
      for (let n = rule.first; n < rule.first + 200; n++) {
        const c = computeRule(app, rule, subject, eventDate, n, overrides, buffer);
        if (c === null) break;
        if (limit !== '' && c.due > limit) break;
        if (rule.conditions && rule.conditions.stop_at_expiry && expiry !== '' && c.due > expiry) break;
        const stillOpen = (c.grace_end || c.due) >= todayD;
        if (c.due >= eventDate && stillOpen) {
          cycle = n;
          calc = c;
          found = true;
          break;
        }
      }
      if (!found) continue;
    } else {
      calc = computeRule(app, rule, subject, eventDate, cycle, overrides, buffer);
      if (calc === null) continue;
    }
    const key = deadlineKey(rule, subject, cycle, calc.base_date);
    const past = (calc.final || calc.grace_end || calc.due) < todayD;
    const exists = Object.prototype.hasOwnProperty.call(keys, key);
    out.push({
      rule_id: rule.id,
      rule_code: rule.code,
      rule_name: rule.name,
      title: cycleTitle(rule, cycle),
      cycle_label: cycleLabel(rule, cycle),
      kind: rule.kind,
      category: rule.category,
      cycle: cycle,
      base_date: calc.base_date,
      nominal_date: calc.nominal,
      due_date: calc.due,
      target_date: calc.target,
      final_date: calc.final,
      window_opens: calc.window_opens,
      grace_end: calc.grace_end,
      citation: rule.citation,
      notes: rule.notes,
      steps: calc.steps,
      key: key,
      past: past,
      exists: exists,
      selected: !past && !exists,
      creates_renewal: rule.creates_renewal,
      fee_kind: rule.fee_kind,
      extensions: rule.extensions,
      overrides: overrides,
    });
  }
  out.sort(function (a, b) {
    return a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : 0;
  });
  return out;
}

function defaultAssignee(subject) {
  if (!subject || !subject.record) return '';
  try {
    return subject.record.getString('responsible') || subject.record.getString('docketer') || '';
  } catch {
    return '';
  }
}

function denorm(subject) {
  if (subject.type === 'matter') {
    return {
      jurisdiction: subject.jurisdiction,
      ip_type: subject.ip_type,
      ref: subject.record.getString('ref'),
      family: subject.record.getString('family'),
    };
  }
  if (subject.type === 'agreement') return { jurisdiction: '', ip_type: 'agreement', ref: subject.record.getString('ref'), family: '' };
  return { jurisdiction: subject.jurisdiction, ip_type: 'work', ref: '', family: '' };
}

/** Create deadline records for selected proposals. Returns created records. */
function commit(app, subject, eventRec, proposals, actorId, source) {
  const u = require(`${__hooks}/lib_util.js`);
  const created = [];
  const keys = existingKeys(app, subject);
  const dn = denorm(subject);
  for (const p of proposals) {
    if (p.selected === false) continue;
    if (Object.prototype.hasOwnProperty.call(keys, p.key)) continue;
    const data = {
      title: p.title,
      kind: p.kind,
      category: p.category,
      status: 'open',
      target_date: u.toPb(p.target_date),
      due_date: u.toPb(p.due_date),
      final_date: u.toPb(p.final_date),
      window_opens: u.toPb(p.window_opens),
      grace_end: u.toPb(p.grace_end),
      nominal_date: u.toPb(p.nominal_date),
      base_date: u.toPb(p.base_date),
      source: source || 'rule',
      rule: p.rule_id || '',
      rule_code: p.rule_code || '',
      base_event: eventRec ? eventRec.id : '',
      calculation: {
        steps: p.steps,
        rule_code: p.rule_code,
        base_date: p.base_date,
        nominal: p.nominal_date,
        overrides: p.overrides || {},
        computed_at: u.nowIso(),
      },
      locked: false,
      extension_level: 0,
      cycle: p.cycle || 0,
      key: p.key,
      citation: p.citation || '',
      notes: p.notes || '',
      assignee: p.assignee || defaultAssignee(subject),
      jurisdiction: dn.jurisdiction,
      ip_type: dn.ip_type,
      ref: dn.ref,
      family: dn.family,
      reminders_sent: [],
    };
    data[subject.type] = subject.id;
    const rec = u.newRecord(app, 'deadlines', data);
    app.save(rec);
    keys[p.key] = 'open';
    created.push(rec);
    if (p.creates_renewal) ensureRenewal(app, rec);
  }
  if (created.length) {
    u.audit(
      app,
      actorId,
      'generate',
      'deadlines',
      subject.id,
      subject.label,
      { created: created.map(function (r) {
        return { id: r.id, title: r.getString('title'), due: r.getString('due_date').slice(0, 10) };
      }) },
      eventRec ? 'From event ' + eventRec.getString('code') + ' on ' + eventRec.getString('date').slice(0, 10) : '',
    );
  }
  return created;
}

/** Apply an event's status/date effect to a matter. */
function applyEventToMatter(app, matter, code, date) {
  const u = require(`${__hooks}/lib_util.js`);
  const def = EVENT_CODES[code];
  if (!def) return false;
  let changed = false;
  if (def.field && u.d10(matter.getString(def.field)) === '' && u.d10(date) !== '') {
    matter.set(def.field, u.toPb(date));
    changed = true;
  }
  if (def.status) {
    const cur = matter.getString('status');
    // Never resurrect a dead matter from a stale event, never regress a live one.
    const curGroup = statusGroup(cur);
    const nextGroup = statusGroup(def.status);
    const regress = curGroup === 'live' && nextGroup === 'pending';
    if (cur !== def.status && !(curGroup === 'dead' && nextGroup !== 'dead') && !regress) {
      matter.set('status', def.status);
      matter.set('status_date', u.toPb(date));
      changed = true;
    }
  }
  if (changed) app.save(matter);
  return changed;
}

/**
 * Record an event and (optionally) create its deadlines.
 * opts: { data, label, source, actorId, documentId, commit: bool, select: [keys], skip: [keys] }
 */
function recordEvent(app, subject, code, date, opts) {
  const u = require(`${__hooks}/lib_util.js`);
  const o = opts || {};
  const eventData = {
    code: code,
    label: o.label || (EVENT_CODES[code] ? EVENT_CODES[code].label : code),
    date: u.toPb(date),
    st27: EVENT_CODES[code] && EVENT_CODES[code].st27 ? EVENT_CODES[code].st27 : '',
    source: o.source || 'manual',
    document: o.documentId || '',
    data: o.data || {},
    created_by: o.actorId || '',
  };
  eventData[subject.type] = subject.id;
  const ev = u.newRecord(app, 'events', eventData);
  app.save(ev);
  if (subject.type === 'matter') {
    applyEventToMatter(app, subject.record, code, date);
    subject.record = u.byId(app, 'matters', subject.id) || subject.record;
  }
  let proposals = proposalsFor(app, subject, { code: code, date: date, data: o.data || {} });
  if (Array.isArray(o.select)) {
    for (const p of proposals) p.selected = o.select.indexOf(p.key) >= 0 || o.select.indexOf(p.rule_code) >= 0;
  }
  if (Array.isArray(o.skip)) {
    for (const p of proposals) if (o.skip.indexOf(p.key) >= 0 || o.skip.indexOf(p.rule_code) >= 0) p.selected = false;
  }
  if (Array.isArray(o.assignees)) {
    for (const p of proposals) {
      for (const a of o.assignees) if (a && (a.key === p.key || a.rule_code === p.rule_code)) p.assignee = a.assignee || '';
    }
  }
  let created = [];
  if (o.commit !== false) created = commit(app, subject, ev, proposals, o.actorId, o.deadlineSource || 'rule');
  u.audit(app, o.actorId, 'event', 'events', ev.id, subject.label + ': ' + eventData.label, { code: code, date: u.d10(date) }, '');
  if (subject.type === 'matter') refreshMatterSummary(app, subject.id);
  return { event: ev, proposals: proposals, created: created };
}

/* ------------------------------------------------------------------ */
/* Regeneration (diff before apply)                                    */
/* ------------------------------------------------------------------ */

function regenerate(app, subject, apply, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  const rows = u.findMany(app, 'deadlines', subject.type + ' = {:id} && status = "open" && source != "manual"', 'due_date', 0, {
    id: subject.id,
  });
  const diffs = [];
  for (const dl of rows) {
    if (dl.getBool('locked')) continue;
    const ruleId = dl.getString('rule');
    if (!ruleId) continue;
    const rr = u.byId(app, 'rules', ruleId);
    if (rr === null) continue;
    const rule = ruleObj(rr);
    const calcPrev = u.j(dl, 'calculation', {});
    const ev = dl.getString('base_event') ? u.byId(app, 'events', dl.getString('base_event')) : null;
    const eventDate = ev ? u.d10(ev.getString('date')) : u.d10(dl.getString('base_date'));
    const c = computeRule(app, rule, subject, eventDate, dl.getInt('cycle') || rule.first, calcPrev.overrides || {}, buffer);
    if (c === null) continue;
    let due = c.due;
    let finalD = c.final;
    const level = dl.getInt('extension_level');
    if (level > 0 && rule.extensions[level - 1]) {
      const ext = rule.extensions[level - 1];
      const cal = require(`${__hooks}/lib_calendar.js`);
      const nominal = u.addYMD(c.nominal, 0, Number(ext.months) || 0, 0);
      due = c.office ? cal.rollForward(app, c.office, nominal).date : nominal;
    }
    const oldDue = u.d10(dl.getString('due_date'));
    if (due !== oldDue || finalD !== u.d10(dl.getString('final_date'))) {
      diffs.push({ id: dl.id, title: dl.getString('title'), from: oldDue, to: due, final_from: u.d10(dl.getString('final_date')), final_to: finalD });
      if (apply) {
        dl.set('due_date', u.toPb(due));
        dl.set('target_date', u.toPb(level > 0 ? u.addDays(due, -buffer) : c.target));
        dl.set('final_date', u.toPb(finalD));
        dl.set('window_opens', u.toPb(c.window_opens));
        dl.set('grace_end', u.toPb(c.grace_end));
        dl.set('nominal_date', u.toPb(c.nominal));
        dl.set('base_date', u.toPb(c.base_date));
        const steps = c.steps.slice();
        steps.push('Recalculated on ' + u.human(u.today()) + ' after the base data changed (was ' + u.human(oldDue) + ').');
        dl.set('calculation', { steps: steps, rule_code: rule.code, base_date: c.base_date, nominal: c.nominal, overrides: calcPrev.overrides || {}, computed_at: u.nowIso() });
        app.save(dl);
      }
    }
  }
  if (apply && diffs.length) {
    u.audit(app, actorId, 'regenerate', 'deadlines', subject.id, subject.label, { moved: diffs }, 'Base data changed');
    if (subject.type === 'matter') refreshMatterSummary(app, subject.id);
  }
  return { moved: diffs, unchanged: rows.length - diffs.length };
}

/* ------------------------------------------------------------------ */
/* Close, extend, next cycle                                           */
/* ------------------------------------------------------------------ */

const NEEDS_REASON = { not_needed: true, cancelled: true, transferred: true, missed: true };

function closeDeadline(app, dl, status, reason, actorId, closedOn) {
  const u = require(`${__hooks}/lib_util.js`);
  if (dl.getString('status') !== 'open') throw new Error('"' + dl.getString('title') + '" is already closed.');
  if (!EVENT_CLOSE_STATUSES[status]) throw new Error('Unknown close status: ' + status);
  if (NEEDS_REASON[status] && String(reason || '').trim() === '') throw new Error('A reason is required to close as "' + status.replace('_', ' ') + '".');
  dl.set('status', status);
  dl.set('close_reason', String(reason || '').slice(0, 2000));
  dl.set('closed_at', u.toPb(closedOn || u.today()));
  dl.set('closed_by', actorId || '');
  app.save(dl);
  u.audit(app, actorId, 'close', 'deadlines', dl.id, (dl.getString('ref') ? dl.getString('ref') + ': ' : '') + dl.getString('title'), { status: status }, reason || '');
  let next = null;
  if (status === 'done') next = nextCycle(app, dl, actorId);
  const r = u.findOne(app, 'renewals', 'deadline = {:d}', { d: dl.id });
  if (r !== null) {
    if (status === 'done' && r.getString('instruction_status') !== 'confirmed') {
      r.set('instruction_status', 'confirmed');
      if (r.getString('decision') === 'pending') r.set('decision', 'renew');
      app.save(r);
    }
    if ((status === 'not_needed' || status === 'missed') && r.getString('decision') === 'pending') {
      r.set('decision', 'lapse');
      r.set('rationale', reason || '');
      app.save(r);
    }
  }
  const mid = dl.getString('matter');
  if (mid) refreshMatterSummary(app, mid);
  return { deadline: dl, next: next };
}

const EVENT_CLOSE_STATUSES = { done: true, not_needed: true, missed: true, transferred: true, cancelled: true, extended: true };

function nextCycle(app, dl, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  const ruleId = dl.getString('rule');
  if (!ruleId) return null;
  const rr = u.byId(app, 'rules', ruleId);
  if (rr === null) return null;
  const rule = ruleObj(rr);
  if (!(rule.every > 0)) return null;
  const type = dl.getString('matter') ? 'matter' : dl.getString('agreement') ? 'agreement' : dl.getString('work') ? 'work' : '';
  if (type === '') return null;
  const subject = subjectOf(app, type, dl.getString(type));
  if (subject === null) return null;
  if (subject.type === 'matter' && statusGroup(subject.record.getString('status')) === 'dead') return null;
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  const ev = dl.getString('base_event') ? u.byId(app, 'events', dl.getString('base_event')) : null;
  const eventDate = ev ? u.d10(ev.getString('date')) : u.d10(dl.getString('base_date'));
  const n = (dl.getInt('cycle') || rule.first) + 1;
  const c = computeRule(app, rule, subject, eventDate, n, {}, buffer);
  if (c === null) return null;
  if (rule.until > 0 && c.due > u.addYMD(c.base_date, rule.until, 0, 0)) return null;
  if (rule.conditions && rule.conditions.stop_at_expiry) {
    // Trademark renewals extend the term; patents and designs stop at expiry.
    refreshMatterSummary(app, subject.id);
    const fresh = u.byId(app, 'matters', subject.id);
    const exp = fresh ? u.d10(fresh.getString('expiry_date')) : '';
    if (exp !== '' && c.due > exp) return null;
  }
  if (rule.conditions && rule.conditions.stop_on_event) {
    const evs = subjectEvents(app, subject);
    for (const x of evs) if (x.getString('code') === rule.conditions.stop_on_event) return null;
  }
  const proposal = {
    rule_id: rule.id,
    rule_code: rule.code,
    title: cycleTitle(rule, n),
    kind: rule.kind,
    category: rule.category,
    cycle: n,
    base_date: c.base_date,
    nominal_date: c.nominal,
    due_date: c.due,
    target_date: c.target,
    final_date: c.final,
    window_opens: c.window_opens,
    grace_end: c.grace_end,
    citation: rule.citation,
    notes: rule.notes,
    steps: c.steps,
    key: deadlineKey(rule, subject, n, c.base_date),
    selected: true,
    creates_renewal: rule.creates_renewal,
    assignee: dl.getString('assignee'),
  };
  const created = commit(app, subject, ev, [proposal], actorId, 'rule');
  return created.length ? created[0] : null;
}

/** Extend to a tier. preview=true returns the new dates without saving. */
function extendDeadline(app, dl, level, actorId, preview) {
  const u = require(`${__hooks}/lib_util.js`);
  const cal = require(`${__hooks}/lib_calendar.js`);
  const ruleId = dl.getString('rule');
  const rr = ruleId ? u.byId(app, 'rules', ruleId) : null;
  const rule = rr ? ruleObj(rr) : null;
  const exts = rule ? rule.extensions : u.j(dl, 'calculation', {}).extensions || [];
  if (!exts || !exts.length) throw new Error('This deadline has no extension options.');
  const lvl = Number(level);
  if (!(lvl >= 1 && lvl <= exts.length)) throw new Error('Choose an extension between 1 and ' + exts.length + '.');
  if (lvl <= dl.getInt('extension_level')) throw new Error('This deadline is already extended to that tier.');
  const ext = exts[lvl - 1];
  const calc = u.j(dl, 'calculation', {});
  const nominalBase = u.d10(calc.nominal) || u.d10(dl.getString('nominal_date')) || u.d10(dl.getString('due_date'));
  const nominal = u.addYMD(nominalBase, 0, Number(ext.months) || 0, 0);
  const office = dl.getString('jurisdiction') || '';
  const rolled = office ? cal.rollForward(app, office, nominal) : { date: nominal, steps: [] };
  const newDue = rolled.date;
  const finalD = u.d10(dl.getString('final_date'));
  if (finalD !== '' && newDue > finalD) throw new Error('That extension goes past the final date (' + u.human(finalD) + ').');
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  const result = {
    id: dl.id,
    title: dl.getString('title'),
    from: u.d10(dl.getString('due_date')),
    to: newDue,
    label: ext.label || ext.months + '-month extension',
    steps: rolled.steps,
  };
  if (preview) return result;
  const steps = (calc.steps || []).slice();
  steps.push(
    'Extended on ' + u.human(u.today()) + ' by ' + u.userLabel(app, actorId) + ': ' + result.label + '. New due date ' + u.human(newDue) + '.',
  );
  for (const s of rolled.steps) steps.push(s);
  calc.steps = steps;
  dl.set('calculation', calc);
  dl.set('due_date', u.toPb(newDue));
  dl.set('target_date', u.toPb(u.addDays(newDue, -buffer)));
  dl.set('extension_level', lvl);
  app.save(dl);
  u.audit(app, actorId, 'extend', 'deadlines', dl.id, dl.getString('title'), { from: result.from, to: newDue, tier: lvl }, result.label);
  const mid = dl.getString('matter');
  if (mid) refreshMatterSummary(app, mid);
  return result;
}

/* ------------------------------------------------------------------ */
/* Matter summary, expiry                                              */
/* ------------------------------------------------------------------ */

function chainFilingDate(app, matter, depth) {
  const u = require(`${__hooks}/lib_util.js`);
  const rel = matter.getString('relation');
  const parentId = matter.getString('parent');
  if ((depth || 0) < 8 && parentId && ['continuation', 'divisional', 'continuation_in_part', 'national_phase', 'validation', 'conversion'].indexOf(rel) >= 0) {
    const parent = u.byId(app, 'matters', parentId);
    if (parent !== null) {
      const pd = chainFilingDate(app, parent, (depth || 0) + 1);
      if (pd !== '') return pd;
    }
  }
  return u.d10(matter.getString('filing_date'));
}

function renewalCount(app, matterId) {
  const u = require(`${__hooks}/lib_util.js`);
  const evs = u.findMany(app, 'events', 'matter = {:m} && code = "RENEWED"', '', 0, { m: matterId });
  return evs.length;
}

/** Statutory expiry for a matter: { date, text }. */
function computeExpiry(app, matter) {
  const u = require(`${__hooks}/lib_util.js`);
  const t = matter.getString('ip_type');
  const cc = matter.getString('jurisdiction').toUpperCase();
  const route = matter.getString('route');
  const filing = chainFilingDate(app, matter, 0);
  const reg = u.d10(matter.getString('registration_date'));
  if (t === 'patent') {
    if (route === 'provisional' || route === 'pct') return { date: '', text: 'Provisional and PCT applications do not become patents themselves.' };
    if (filing === '') return { date: '', text: 'Needs a filing date.' };
    let d = u.addYMD(filing, 20, 0, 0);
    let text = '20 years from the earliest non-provisional filing date (' + u.human(filing) + ').';
    const pta = matter.getInt('pta_days');
    if (cc === 'US' && pta > 0) {
      d = u.addDays(d, pta);
      text += ' Plus ' + pta + ' days of patent term adjustment.';
    }
    return { date: d, text: text };
  }
  if (t === 'utility_model') {
    if (filing === '') return { date: '', text: 'Needs a filing date.' };
    return { date: u.addYMD(filing, 10, 0, 0), text: '10 years from filing (typical utility model term; check the national law).' };
  }
  if (t === 'design') {
    if (cc === 'US') {
      if (reg === '') return { date: '', text: 'US design term runs 15 years from grant.' };
      return { date: u.addYMD(reg, 15, 0, 0), text: '15 years from grant (35 U.S.C. 173).' };
    }
    if (filing === '') return { date: '', text: 'Needs a filing date.' };
    if (cc === 'EM' || cc === 'JP') return { date: u.addYMD(filing, 25, 0, 0), text: 'Maximum 25 years from filing, subject to renewals or annual fees.' };
    return { date: u.addYMD(filing, 25, 0, 0), text: 'Up to 25 years from filing in most offices; check the national law.' };
  }
  if (t === 'trademark') {
    const k = renewalCount(app, matter.id) + 1;
    if (cc === 'EM') {
      if (filing === '') return { date: '', text: 'EU trade marks run 10 years from filing.' };
      return { date: u.addYMD(filing, 10 * k, 0, 0), text: '10 years from filing, renewable every 10 years' + (k > 1 ? ' (' + (k - 1) + ' renewal(s) recorded).' : '.') };
    }
    if (reg === '') return { date: '', text: 'The term starts at registration.' };
    return { date: u.addYMD(reg, 10 * k, 0, 0), text: '10 years from registration, renewable every 10 years' + (k > 1 ? ' (' + (k - 1) + ' renewal(s) recorded).' : '.') };
  }
  if (t === 'copyright') {
    const wid = matter.getString('work');
    const work = wid ? u.byId(app, 'works', wid) : null;
    if (work === null) return { date: '', text: 'Link the registration to a work to compute the term.' };
    const terms = copyrightTerms(work);
    const key = cc === 'US' ? 'US' : cc === 'JP' ? 'JP' : 'EU';
    const tm = terms[key];
    return { date: tm.date, text: tm.text };
  }
  return { date: '', text: '' };
}

/** Copyright term under US, Japanese and EU law for a work. */
function copyrightTerms(work) {
  const u = require(`${__hooks}/lib_util.js`);
  const pub = u.d10(work.getString('publication_date'));
  const created = u.d10(work.getString('creation_date'));
  const death = work.getInt('author_death_year');
  const kind = work.getString('author_kind') || (work.getBool('made_for_hire') ? 'corporate' : 'individual');
  const wt = work.getString('work_type');
  const film = ['feature_film', 'series', 'season', 'episode', 'short'].indexOf(wt) >= 0;
  const out = {};
  function endOfYear(y) {
    return y + '-12-31';
  }
  // United States (17 U.S.C. 302, 305: terms run to the end of the calendar year).
  if (work.getBool('made_for_hire') || kind === 'corporate' || kind === 'anonymous') {
    const a = pub ? Number(pub.slice(0, 4)) + 95 : 0;
    const b = created ? Number(created.slice(0, 4)) + 120 : 0;
    const y = a && b ? Math.min(a, b) : a || b;
    out.US = y
      ? { date: endOfYear(y), text: '95 years from publication or 120 years from creation, whichever ends first (17 U.S.C. 302(c)).' }
      : { date: '', text: 'Needs a publication or creation date (work made for hire).' };
  } else if (death > 0) {
    out.US = { date: endOfYear(death + 70), text: 'Life of the ' + (kind === 'joint' ? 'last surviving author' : 'author') + ' plus 70 years (17 U.S.C. 302(a), (b)).' };
  } else {
    out.US = { date: '', text: 'Life of the author plus 70 years. Enter the author death year when known.' };
  }
  // Japan (Copyright Act Art. 51-54, 57: counted from 1 January of the following year).
  if (film) {
    out.JP = pub
      ? { date: endOfYear(Number(pub.slice(0, 4)) + 70), text: 'Cinematographic works: 70 years from publication (Art. 54).' }
      : { date: '', text: 'Cinematographic works: 70 years from publication (Art. 54).' };
  } else if (kind === 'corporate' || work.getBool('made_for_hire') || kind === 'anonymous') {
    const y = pub ? Number(pub.slice(0, 4)) : created ? Number(created.slice(0, 4)) : 0;
    out.JP = y
      ? { date: endOfYear(y + 70), text: 'Works under a corporate or anonymous name: 70 years from publication (Art. 52, 53).' }
      : { date: '', text: 'Needs a publication date.' };
  } else if (death > 0) {
    out.JP = { date: endOfYear(death + 70), text: 'Life of the author plus 70 years (Art. 51, 57).' };
  } else {
    out.JP = { date: '', text: 'Life of the author plus 70 years. Enter the author death year when known.' };
  }
  // European Union (Directive 2006/116/EC).
  if (death > 0 && kind !== 'anonymous') {
    out.EU = {
      date: endOfYear(death + 70),
      text: film
        ? '70 years after the death of the last of the director, screenwriter, dialogue author and composer (Art. 2(2)). Enter the latest death year.'
        : 'Life of the author plus 70 years (Art. 1).',
    };
  } else if (pub && (kind === 'anonymous' || kind === 'corporate' || work.getBool('made_for_hire'))) {
    out.EU = { date: endOfYear(Number(pub.slice(0, 4)) + 70), text: 'Anonymous or pseudonymous works: 70 years from lawful publication (Art. 1(3)).' };
  } else {
    out.EU = { date: '', text: 'Life of the author plus 70 years. Enter the author death year when known.' };
  }
  return out;
}

function refreshMatterSummary(app, matterId) {
  const u = require(`${__hooks}/lib_util.js`);
  const m = u.byId(app, 'matters', matterId);
  if (m === null) return;
  const open = u.findMany(app, 'deadlines', 'matter = {:m} && status = "open"', 'due_date', 1, { m: matterId });
  const next = open.length ? u.d10(open[0].getString('due_date')) : '';
  const nextTitle = open.length ? open[0].getString('title') : '';
  let changed = false;
  if (u.d10(m.getString('next_deadline')) !== next) {
    m.set('next_deadline', u.toPb(next));
    changed = true;
  }
  if (m.getString('next_deadline_title') !== nextTitle) {
    m.set('next_deadline_title', nextTitle);
    changed = true;
  }
  if (!m.getBool('expiry_override')) {
    const exp = computeExpiry(app, m).date;
    if (u.d10(m.getString('expiry_date')) !== exp) {
      m.set('expiry_date', u.toPb(exp));
      changed = true;
    }
  }
  if (changed) app.save(m);
}

/* ------------------------------------------------------------------ */
/* Renewals and cost estimates                                         */
/* ------------------------------------------------------------------ */

function classCount(app, matterId) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = u.findMany(app, 'goods_services', 'matter = {:m} && class_status != "deleted" && class_status != "cancelled"', '', 0, { m: matterId });
  return rows.length;
}

/** Look up the official fee for a renewal deadline. */
function estimateFee(app, dl, rule, matter) {
  const u = require(`${__hooks}/lib_util.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const home = String(u.setting(app, 'home_currency', 'USD') || 'USD').toUpperCase();
  const result = { official_fee: 0, currency: '', home_amount: 0, home_currency: home, fee_known: false, fee_note: '' };
  if (matter === null || rule === null || !rule.fee_kind) {
    result.fee_note = 'No fee type on the rule.';
    return result;
  }
  const office = matter.getString('jurisdiction').toUpperCase();
  const ipType = matter.getString('ip_type');
  const cycle = Number((rule.conditions && rule.conditions.cycle) || dl.getInt('cycle') || 0);
  const entity = matter.getString('entity_size') || 'large';
  const rows = u.findMany(
    app,
    'fee_schedule',
    'office = {:o} && ip_type = {:t} && fee_kind = {:k}',
    '-effective_from',
    0,
    { o: office, t: ipType, k: rule.fee_kind },
  );
  let best = null;
  let bestScore = -1;
  for (const r of rows) {
    const rc = r.getInt('cycle');
    const rt = r.getInt('cycle_to');
    const re = r.getString('entity') || 'any';
    const inRange = rc === 0 || (rt > 0 ? cycle >= rc && cycle <= rt : cycle === rc);
    if (!inRange) continue;
    // A schedule that only starts after this deadline does not price it.
    const from = u.d10(r.getString('effective_from'));
    const dueDay = u.d10(dl.getString('due_date'));
    if (from !== '' && dueDay !== '' && from > dueDay) continue;
    if (re !== 'any' && re !== entity) continue;
    const score = (rc !== 0 ? 2 : 0) + (re === entity ? 1 : 0);
    if (score > bestScore) {
      best = r;
      bestScore = score;
    }
  }
  if (best === null) {
    result.fee_note = 'No ' + office + ' ' + rule.fee_kind.replace('_', ' ') + ' fee on file. Add one in Settings, Fees.';
    return result;
  }
  let amount = best.getFloat('amount');
  const tiers = u.asArray(u.j(best, 'class_tiers', []))
    .map((t) => ({ from: Number(t && t.from) || 0, amount: Number(t && t.amount) || 0 }))
    .filter((t) => t.from > 1)
    .sort((a, b) => a.from - b.from);
  const tiered = tiers.length > 0;
  const classes = best.getBool('per_class') || tiered ? Math.max(1, classCount(app, matter.id)) : 1;
  if (tiered) {
    // Base covers the first classes; each further class costs its tier's amount.
    for (let c = 2; c <= classes; c++) {
      let rate = 0;
      for (const t of tiers) if (c >= t.from) rate = t.amount;
      amount += rate;
    }
  } else {
    amount = amount * classes;
  }
  const perClaim = best.getFloat('per_claim_amount');
  const claims = matter.getInt('claims_count');
  let claimNote = '';
  if (perClaim > 0) {
    if (claims > 0) {
      amount += perClaim * claims;
      claimNote = claims + ' claim' + (claims === 1 ? '' : 's') + '. ';
    } else {
      claimNote = 'Claims count not on file, so the per-claim part is not included. ';
    }
  }
  const graceEnd = u.d10(dl.getString('grace_end'));
  const due = u.d10(dl.getString('due_date'));
  if (graceEnd !== '' && u.today() > due && u.today() <= graceEnd) {
    const s = best.getFloat('grace_surcharge');
    if (s > 0) amount += best.getBool('surcharge_percent') ? amount * (s / 100) : s * (tiered ? 1 : classes);
    claimNote += 'Includes the late payment surcharge. ';
  }
  result.official_fee = Math.round(amount * 100) / 100;
  result.currency = best.getString('currency').toUpperCase();
  const conv = fx.convert(app, result.official_fee, result.currency, home);
  result.home_amount = conv === null ? 0 : conv;
  result.fee_known = true;
  result.fee_note =
    (best.getBool('per_class') || tiered ? classes + ' class' + (classes === 1 ? '' : 'es') + '. ' : '') +
    claimNote +
    (best.getString('source') || '') +
    (conv === null && result.currency !== home ? ' No exchange rate for ' + result.currency + ' to ' + home + '.' : '');
  return result;
}

/** Re-price every renewal not yet instructed (new rates, fees or home currency). */
function refreshAllRenewalCosts(app) {
  const u = require(`${__hooks}/lib_util.js`);
  let n = 0;
  for (const r of u.findMany(app, 'renewals', 'instruction_status = "not_instructed"', '', 0)) {
    refreshRenewalCost(app, r);
    n += 1;
  }
  return n;
}

/** After a fee or a manual exchange rate changes. */
function repriceAfterEdit(app, record) {
  const name = record.collection().name;
  if (name === 'fx_rates' && record.getString('source') !== 'manual') return;
  try {
    refreshAllRenewalCosts(app);
  } catch (err) {
    console.error('renewal re-pricing failed:', err);
  }
}

function ensureRenewal(app, dl) {
  const u = require(`${__hooks}/lib_util.js`);
  const existing = u.findOne(app, 'renewals', 'deadline = {:d}', { d: dl.id });
  if (existing !== null) return existing;
  const mid = dl.getString('matter');
  if (!mid) return null;
  const matter = u.byId(app, 'matters', mid);
  const rr = dl.getString('rule') ? u.byId(app, 'rules', dl.getString('rule')) : null;
  const rule = rr ? ruleObj(rr) : null;
  const est = estimateFee(app, dl, rule, matter);
  const def = String(u.setting(app, 'renewal_default', 'decide'));
  const rec = u.newRecord(app, 'renewals', {
    deadline: dl.id,
    matter: mid,
    cycle_label: rule ? cycleLabel(rule, dl.getInt('cycle')) || dl.getString('title') : dl.getString('title'),
    cycle: dl.getInt('cycle'),
    due_date: dl.getString('due_date'),
    grace_end: dl.getString('grace_end'),
    window_opens: dl.getString('window_opens'),
    official_fee: est.official_fee,
    other_fee: 0,
    currency: est.currency,
    home_amount: est.home_amount,
    home_currency: est.home_currency,
    fee_known: est.fee_known,
    fee_note: est.fee_note,
    decision: def === 'renew' ? 'renew' : def === 'lapse' ? 'lapse' : 'pending',
    instruction_status: 'not_instructed',
    classes_keep: [],
  });
  app.save(rec);
  return rec;
}

function refreshRenewalCost(app, renewal) {
  const u = require(`${__hooks}/lib_util.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const dl = u.byId(app, 'deadlines', renewal.getString('deadline'));
  if (dl === null) return renewal;
  const matter = u.byId(app, 'matters', renewal.getString('matter'));
  const rr = dl.getString('rule') ? u.byId(app, 'rules', dl.getString('rule')) : null;
  const est = estimateFee(app, dl, rr ? ruleObj(rr) : null, matter);
  renewal.set('due_date', dl.getString('due_date'));
  renewal.set('grace_end', dl.getString('grace_end'));
  renewal.set('window_opens', dl.getString('window_opens'));
  if (est.fee_known) {
    renewal.set('official_fee', est.official_fee);
    renewal.set('currency', est.currency);
  }
  const cur = renewal.getString('currency');
  const total = renewal.getFloat('official_fee') + renewal.getFloat('other_fee');
  const conv = cur ? fx.convert(app, total, cur, est.home_currency) : null;
  renewal.set('home_amount', conv === null ? 0 : conv);
  renewal.set('home_currency', est.home_currency);
  renewal.set('fee_known', est.fee_known || renewal.getFloat('official_fee') > 0);
  renewal.set('fee_note', est.fee_note);
  app.save(renewal);
  return renewal;
}

/* ------------------------------------------------------------------ */
/* Agreement and work obligations                                      */
/* ------------------------------------------------------------------ */

function periodEnds(freq, from, to) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = [];
  if (!freq || freq === 'none' || from === '' || to === '') return out;
  const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
  const p = u.parts(from);
  // Calendar-aligned periods: month ends, quarter ends, half-year ends, year ends.
  let m = p.m;
  let y = p.y;
  while ((m % months) !== 0) {
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  for (let guard = 0; guard < 120; guard++) {
    const end = y + '-' + u.pad2(m) + '-' + u.pad2(u.daysInMonth(y, m));
    if (end > to) break;
    if (end >= from) out.push(end);
    m += months;
    while (m > 12) {
      m -= 12;
      y += 1;
    }
  }
  return out;
}

/** Desired agreement deadlines, keyed. */
function agreementObligations(app, agr) {
  const u = require(`${__hooks}/lib_util.js`);
  const id = agr.id;
  const ref = agr.getString('ref') || agr.getString('title');
  const cp = agr.getString('counterparty') ? u.byId(app, 'parties', agr.getString('counterparty')) : null;
  const cpName = cp ? cp.getString('name') : 'the counterparty';
  const cur = agr.getString('currency');
  const out = [];
  function push(key, title, due, kind, detail) {
    if (u.d10(due) === '') return;
    out.push({ key: 'agr:' + id + ':' + key, title: title, due: u.d10(due), kind: kind, steps: [detail] });
  }
  const optEnd = u.d10(agr.getString('option_period_end'));
  if (optEnd) {
    const fee = agr.getFloat('option_extension_fee');
    push('option_end', 'Option period ends: exercise or extend' + (fee > 0 ? ' (extension fee ' + u.money(fee, cur) + ')' : ''), optEnd, 'hard',
      'Option period end date in ' + ref + ': ' + u.human(optEnd) + '. If the option is not exercised or extended, rights revert.');
  }
  const termEnd = u.d10(agr.getString('term_end'));
  if (termEnd && !agr.getBool('perpetual')) {
    push('term_end', 'Agreement term ends', termEnd, 'reminder', 'Term end date in ' + ref + ': ' + u.human(termEnd) + '.');
    const notice = agr.getInt('renewal_notice_days');
    if (notice > 0) {
      const nd = u.addDays(termEnd, -notice);
      push(
        'notice',
        agr.getBool('auto_renew') ? 'Last day to give notice of non-renewal' : 'Last day to give notice to renew',
        nd,
        'hard',
        'Term ends ' + u.human(termEnd) + '; the agreement requires ' + notice + ' days notice, so notice must be given by ' + u.human(nd) + '.',
      );
    }
    const selloff = agr.getInt('sell_off_days');
    if (selloff > 0) {
      const sd = u.addDays(termEnd, selloff);
      push('selloff', 'Sell-off period ends', sd, 'reminder', 'Sell-off of ' + selloff + ' days after the term ends on ' + u.human(termEnd) + '.');
    }
  }
  const rev = u.d10(agr.getString('reversion_date'));
  if (rev) push('reversion', 'Rights revert', rev, 'reminder', 'Reversion date in ' + ref + ': ' + u.human(rev) + '.');
  const sched = u.j(agr, 'payment_schedule', []);
  if (Array.isArray(sched)) {
    sched.forEach(function (p, i) {
      if (!p || !p.date) return;
      const label = p.label || (agr.getString('direction') === 'out' ? 'Payment due from ' + cpName : 'Payment due to ' + cpName);
      push('pay:' + u.d10(p.date) + ':' + i, label + (p.amount ? ' (' + u.money(Number(p.amount), p.currency || cur) + ')' : ''), p.date, 'hard',
        'Payment schedule entry ' + (i + 1) + ' in ' + ref + '.');
    });
  }
  const freq = agr.getString('reporting_frequency');
  if (freq && freq !== 'none') {
    const start = u.d10(agr.getString('term_start')) || u.d10(agr.getString('effective_date')) || u.d10(agr.getString('signed_date'));
    const end = termEnd && !agr.getBool('perpetual') ? termEnd : u.addYMD(u.today(), 2, 0, 0);
    const from = start && start > u.addYMD(u.today(), -1, 0, 0) ? start : u.addYMD(u.today(), -1, 0, 0);
    const to = end < u.addYMD(u.today(), 2, 0, 0) ? end : u.addYMD(u.today(), 2, 0, 0);
    const dueDays = agr.getInt('report_due_days') || 30;
    for (const pe of periodEnds(freq, from, to)) {
      const due = u.addDays(pe, dueDays);
      const title = agr.getString('direction') === 'in' ? 'Send royalty report to ' + cpName : 'Royalty report due from ' + cpName;
      push('report:' + pe, title + ' (period ending ' + u.human(pe) + ')', due, agr.getString('direction') === 'in' ? 'hard' : 'internal',
        'Reports are due ' + dueDays + ' days after each ' + freq + ' period; this period ends ' + u.human(pe) + '.');
    }
  }
  return out;
}

function syncAgreement(app, agr, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  const status = agr.getString('status');
  const inactive = status === 'terminated' || status === 'superseded' || status === 'expired';
  const desired = inactive ? [] : agreementObligations(app, agr);
  const byKey = {};
  for (const d of desired) byKey[d.key] = d;
  const existing = u.findMany(app, 'deadlines', 'agreement = {:a} && source = "agreement"', '', 0, { a: agr.id });
  const seen = {};
  let created = 0;
  let updated = 0;
  let cancelled = 0;
  const ref = agr.getString('ref');
  for (const dl of existing) {
    const k = dl.getString('key');
    seen[k] = true;
    const want = byKey[k];
    if (dl.getString('status') !== 'open') continue;
    if (!want) {
      if (!inactive || u.d10(dl.getString('due_date')) >= u.today()) {
        dl.set('status', 'cancelled');
        dl.set('close_reason', inactive ? 'Agreement is ' + status + '.' : 'No longer in the agreement terms.');
        dl.set('closed_at', u.toPb(u.today()));
        app.save(dl);
        cancelled += 1;
      }
      continue;
    }
    if (dl.getBool('locked')) continue;
    if (u.d10(dl.getString('due_date')) !== want.due || dl.getString('title') !== want.title) {
      dl.set('due_date', u.toPb(want.due));
      dl.set('target_date', u.toPb(want.kind === 'hard' ? u.addDays(want.due, -(Number(u.setting(app, 'target_buffer_days', 14)) || 0)) : want.due));
      dl.set('title', want.title);
      dl.set('calculation', { steps: want.steps, computed_at: u.nowIso() });
      app.save(dl);
      updated += 1;
    }
  }
  const buffer = Number(u.setting(app, 'target_buffer_days', 14)) || 0;
  for (const d of desired) {
    if (seen[d.key]) continue;
    const rec = u.newRecord(app, 'deadlines', {
      title: d.title,
      agreement: agr.id,
      kind: d.kind,
      category: 'agreement',
      status: 'open',
      due_date: u.toPb(d.due),
      target_date: u.toPb(d.kind === 'hard' ? u.addDays(d.due, -buffer) : d.due),
      nominal_date: u.toPb(d.due),
      source: 'agreement',
      key: d.key,
      calculation: { steps: d.steps, computed_at: u.nowIso() },
      citation: 'Agreement terms' + (ref ? ' (' + ref + ')' : ''),
      assignee: agr.getString('responsible'),
      ip_type: 'agreement',
      ref: ref,
      reminders_sent: [],
    });
    app.save(rec);
    created += 1;
  }
  // Expected royalty reports mirror the report deadlines.
  const freq = agr.getString('reporting_frequency');
  if (!inactive && freq && freq !== 'none') {
    for (const d of desired) {
      if (d.key.indexOf(':report:') < 0) continue;
      const pe = d.key.split(':report:')[1];
      const exists = u.findOne(app, 'royalty_reports', 'agreement = {:a} && period_end = {:p}', { a: agr.id, p: u.toPb(pe) });
      if (exists !== null) continue;
      const months = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'semiannual' ? 6 : 12;
      // Periods are calendar aligned: the first day of the month (months - 1) before the end month.
      const pp = u.parts(pe);
      let sm = pp.m - months + 1;
      let sy = pp.y;
      while (sm < 1) {
        sm += 12;
        sy -= 1;
      }
      const ps = sy + '-' + u.pad2(sm) + '-01';
      const rr = u.newRecord(app, 'royalty_reports', {
        agreement: agr.id,
        period_start: u.toPb(ps),
        period_end: u.toPb(pe),
        due_date: u.toPb(d.due),
        currency: agr.getString('currency'),
        status: 'expected',
      });
      app.save(rr);
    }
  }
  // Author grants: Section 203 termination windows run from the grant date.
  if (agr.getBool('author_grant') && u.d10(agr.getString('signed_date')) !== '') {
    const subject = subjectFromRecord('agreement', agr);
    const signed = u.d10(agr.getString('signed_date'));
    const evs = u.findMany(app, 'events', 'agreement = {:a} && code = "AUTHOR_GRANT_EXECUTED"', '', 0, { a: agr.id });
    if (evs.length === 0) {
      recordEvent(app, subject, 'AUTHOR_GRANT_EXECUTED', signed, { source: 'system', actorId: actorId });
    } else if (u.d10(evs[0].getString('date')) !== signed) {
      evs[0].set('date', u.toPb(signed));
      app.save(evs[0]);
      regenerate(app, subject, true, actorId);
    }
  }
  if (created || updated || cancelled) {
    u.audit(app, actorId, 'sync', 'agreements', agr.id, agr.getString('title'), { created: created, updated: updated, cancelled: cancelled }, 'Agreement obligations');
  }
  return { created: created, updated: updated, cancelled: cancelled };
}

function syncWork(app, work, actorId) {
  const u = require(`${__hooks}/lib_util.js`);
  const pub = u.d10(work.getString('publication_date'));
  if (pub === '') return { created: 0 };
  const subject = subjectFromRecord('work', work);
  const evs = u.findMany(app, 'events', 'work = {:w} && code = "WORK_PUBLISHED"', '', 0, { w: work.id });
  if (evs.length === 0) {
    const r = recordEvent(app, subject, 'WORK_PUBLISHED', pub, { source: 'system', actorId: actorId });
    return { created: r.created.length };
  }
  if (u.d10(evs[0].getString('date')) !== pub) {
    evs[0].set('date', u.toPb(pub));
    app.save(evs[0]);
    regenerate(app, subject, true, actorId);
  }
  return { created: 0 };
}

module.exports = {
  EVENT_CODES: EVENT_CODES,
  refreshAllRenewalCosts: refreshAllRenewalCosts,
  repriceAfterEdit: repriceAfterEdit,
  STATUS_GROUP: STATUS_GROUP,
  statusGroup: statusGroup,
  subjectOf: subjectOf,
  subjectFromRecord: subjectFromRecord,
  ruleObj: ruleObj,
  computeRule: computeRule,
  proposalsFor: proposalsFor,
  commit: commit,
  recordEvent: recordEvent,
  applyEventToMatter: applyEventToMatter,
  regenerate: regenerate,
  closeDeadline: closeDeadline,
  extendDeadline: extendDeadline,
  nextCycle: nextCycle,
  computeExpiry: computeExpiry,
  copyrightTerms: copyrightTerms,
  refreshMatterSummary: refreshMatterSummary,
  estimateFee: estimateFee,
  ensureRenewal: ensureRenewal,
  refreshRenewalCost: refreshRenewalCost,
  agreementObligations: agreementObligations,
  syncAgreement: syncAgreement,
  syncWork: syncWork,
  earliestPriority: earliestPriority,
};
