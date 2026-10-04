/// <reference path="../pb_data/types.d.ts" />
/**
 * Read models: the Today summary, global search, renewal forecast,
 * standard reports (in the reader's language) and CSV import with a dry run.
 */

function normNum(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

/* ------------------------------------------------------------------ */
/* Summary                                                             */
/* ------------------------------------------------------------------ */

function summary(app, userId) {
  const u = u_();
  const today = u.today();
  const t = u.toPb(today);
  const week = u.toPb(u.addDays(today, 7));
  const d30 = u.toPb(u.addDays(today, 30));
  const d60 = u.toPb(u.addDays(today, 60));
  const d90 = u.toPb(u.addDays(today, 90));
  function count(coll, filter, params) {
    return u.findMany(app, coll, filter, '', 0, params || {}).length;
  }
  const p = { t: t, w: week, a: d30, s: d60, b: d90, u: userId || '' };
  const mine = userId ? ' && assignee = {:u}' : '';
  const deadlines = {
    overdue: count('deadlines', 'status = "open" && due_date < {:t}', p),
    week: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:w}', p),
    d30: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:a}', p),
    d90: count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:b}', p),
    mine_overdue: userId ? count('deadlines', 'status = "open" && due_date < {:t}' + mine, p) : 0,
    mine_week: userId ? count('deadlines', 'status = "open" && due_date >= {:t} && due_date <= {:w}' + mine, p) : 0,
  };
  const marks = { trademark: { pre_filing: 0, pending: 0, live: 0, dead: 0 }, design: { pre_filing: 0, pending: 0, live: 0, dead: 0 } };
  const jur = {};
  for (const m of u.findMany(app, 'matters', '', '', 0)) {
    const ty = m.getString('ip_type');
    const g = m.getString('status_group') || 'pending';
    if (marks[ty]) marks[ty][g] = (marks[ty][g] || 0) + 1;
    if (g !== 'dead') jur[m.getString('jurisdiction')] = (jur[m.getString('jurisdiction')] || 0) + 1;
  }
  // Renewal spend by month for the next 12 months (home currency).
  const home = String(u.setting(app, 'home_currency', 'JPY') || 'JPY');
  const months = [];
  for (let i = 0; i < 12; i++) {
    const first = u.addYMD(today.slice(0, 8) + '01', 0, i, 0);
    months.push({ month: first.slice(0, 7), amount: 0, count: 0, unknown: 0 });
  }
  const rs = u.findMany(app, 'renewals', 'due_date >= {:s} && due_date < {:h} && decision != "lapse" && instruction_status != "confirmed"', 'due_date', 0, {
    s: u.toPb(today.slice(0, 8) + '01'),
    h: u.toPb(u.addYMD(today.slice(0, 8) + '01', 1, 0, 0)),
  });
  for (const r of rs) {
    const mo = u.d10(r.getString('due_date')).slice(0, 7);
    let slot = null;
    for (const x of months) if (x.month === mo) slot = x;
    if (!slot) continue;
    slot.count += 1;
    if (r.getFloat('home_amount') > 0) slot.amount += r.getFloat('home_amount');
    else slot.unknown += 1;
  }
  return {
    today: today,
    deadlines: deadlines,
    marks: marks,
    jurisdictions: jur,
    inbox: { new: count('inbox_items', 'status = "new"'), awaiting_second: count('inbox_items', 'status = "awaiting_second"') },
    approvals: {
      open: count('approvals', 'status = "submitted" || status = "in_review"'),
      overdue: count('approvals', '(status = "submitted" || status = "in_review") && due_date < {:t}', p),
      changes: count('approvals', 'status = "changes_requested"'),
    },
    renewals: {
      pending: count('renewals', 'decision = "pending" && instruction_status = "not_instructed"'),
      in_grace: count('renewals', 'instruction_status != "confirmed" && instruction_status != "lapsed" && due_date < {:t} && grace_end >= {:t}', p),
    },
    agreements: {
      active: count('agreements', 'status = "active"'),
      expiring90: count('agreements', 'status = "active" && perpetual = false && term_end >= {:t} && term_end <= {:b}', p),
    },
    royalties: {
      overdue: count('royalty_reports', 'status = "expected" && due_date < {:t}', p),
      due30: count('royalty_reports', 'status = "expected" && due_date >= {:t} && due_date <= {:a}', p),
    },
    committees: { open_consents: count('consent_requests', 'status = "open"') },
    permissions: { expiring60: count('permissions', 'status = "active" && end_date != "" && end_date >= {:t} && end_date <= {:s}', p) },
    enforcement: { open: count('enforcement_cases', 'status != "closed" && status != "won" && status != "lost" && status != "settled"'), watch_new: count('watch_hits', 'status = "new"') },
    music: { claims_open: count('content_id_claims', 'status = "open" || status = "disputed" || status = "appealed"') },
    renewal_spend: { currency: home, months: months },
    counts: {
      franchises: count('franchises', ''),
      characters: count('characters', 'status != "archived"'),
      talents_active: count('talents', 'lifecycle = "active" || lifecycle = "hiatus" || lifecycle = "pre_debut" || lifecycle = "graduation_announced"'),
      titles: count('titles', ''),
      songs: count('songs', ''),
      products_on_sale: count('products', 'stage = "on_sale"'),
      committees: count('committees', 'status != "dissolved"'),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Search                                                              */
/* ------------------------------------------------------------------ */

function namesText(rec) {
  const u = u_();
  const list = u.j(rec, 'names', []);
  if (!Array.isArray(list)) return '';
  return list
    .map(function (x) {
      return x && x.value ? String(x.value) : '';
    })
    .join(' ');
}

function search(app, q, limit) {
  const u = u_();
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
    let score = 0;
    for (const n of [m.getString('ref'), m.getString('application_no'), m.getString('publication_no'), m.getString('registration_no')]) {
      const nn = normNum(n);
      if (num.length >= 4 && nn !== '' && (nn === num || nn.indexOf(num) >= 0 || num.indexOf(nn) >= 0)) score = Math.max(score, nn === num ? 100 : 80);
    }
    if (m.getString('title').toLowerCase().indexOf(needle) >= 0) score = Math.max(score, 60);
    if (score > 0) {
      hit('matter', m.id, (m.getString('ref') ? m.getString('ref') + ' ' : '') + m.getString('title'), m.getString('ip_type') + ' · ' + m.getString('jurisdiction') + (m.getString('application_no') ? ' · ' + m.getString('application_no') : ''), '#/matter/' + m.id, score);
    }
  }
  const text = [
    ['franchises', 'name', 'franchise', '#/franchise/', true],
    ['characters', 'name', 'character', '#/character/', true],
    ['talents', 'stage_name', 'talent', '#/talent/', true],
    ['titles', 'title', 'title', '#/title/', true],
    ['songs', 'title', 'song', '#/song/', true],
    ['recordings', 'title', 'recording', '#/recording/', false],
    ['agreements', 'title', 'agreement', '#/agreement/', false],
    ['products', 'name', 'product', '#/product/', false],
    ['committees', 'name', 'committee', '#/committee/', false],
    ['permissions', 'title', 'permission', '#/permissions?open=', false],
    ['enforcement_cases', 'title', 'case', '#/case/', false],
    ['parties', 'name', 'party', '#/people/', false],
    ['families', 'title', 'mark', '#/family/', false],
  ];
  for (const t of text) {
    const filter = t[4] ? '(' + t[1] + ' ~ {:q} || names ~ {:q})' : t[1] + ' ~ {:q}';
    for (const r of u.findMany(app, t[0], filter, '-updated', 20, { q: raw })) {
      const alt = t[4] ? namesText(r) : '';
      hit(t[2], r.id, (r.getString('ref') || '') + (r.getString('ref') ? ' ' : '') + r.getString(t[1]), alt ? t[2] + ' · ' + alt.slice(0, 60) : t[2], t[3] + r.id, 50);
    }
  }
  if (num.length >= 6) {
    for (const r of u.findMany(app, 'recordings', 'isrc != ""', '', 0)) {
      if (normNum(r.getString('isrc')) === num) hit('recording', r.id, r.getString('title'), 'ISRC ' + r.getString('isrc'), '#/recording/' + r.id, 95);
    }
    for (const s of u.findMany(app, 'songs', 'iswc != "" || work_codes != "[]"', '', 0)) {
      const codes = [s.getString('iswc')].concat(
        u.asArray(u.j(s, 'work_codes', [])).map(function (c) {
          return c && c.code;
        }),
      );
      for (const c of codes) if (c && normNum(c) === num) hit('song', s.id, s.getString('title'), 'Code ' + c, '#/song/' + s.id, 95);
    }
    for (const t of [['agreements', 'agreement', '#/agreement/'], ['products', 'product', '#/product/'], ['enforcement_cases', 'case', '#/case/']]) {
      for (const r of u.findMany(app, t[0], 'ref != ""', '', 0)) {
        if (normNum(r.getString('ref')) === num) hit(t[1], r.id, r.getString('ref') + ' ' + (r.getString('title') || r.getString('name')), t[1], t[2] + r.id, 90);
      }
    }
  }
  out.sort(function (a, b) {
    return b.score - a.score;
  });
  const seen = {};
  return out
    .filter(function (x) {
      if (seen[x.type + x.id]) return false;
      seen[x.type + x.id] = true;
      return true;
    })
    .slice(0, max);
}

/* ------------------------------------------------------------------ */
/* Renewal forecast                                                    */
/* ------------------------------------------------------------------ */

function shimDeadline(due, grace, cycle) {
  return {
    getString: function (f) {
      return f === 'due_date' ? due + ' 00:00:00.000Z' : f === 'grace_end' ? (grace ? grace + ' 00:00:00.000Z' : '') : '';
    },
    getInt: function (f) {
      return f === 'cycle' ? cycle : 0;
    },
  };
}

function forecast(app, years) {
  const u = u_();
  const engine = require(`${__hooks}/lib_engine.js`);
  const fx = require(`${__hooks}/lib_fx.js`);
  const home = String(u.setting(app, 'home_currency', 'JPY') || 'JPY');
  const rates = fx.rateMap(app);
  const today = u.today();
  const horizon = u.addYMD(today, years || 5, 0, 0);
  const items = [];
  const rulesCache = {};
  for (const dl of u.findMany(app, 'deadlines', 'status = "open" && matter != "" && (category = "renewal" || category = "use")', 'due_date', 0)) {
    const m = u.byId(app, 'matters', dl.getString('matter'));
    if (m === null || engine.statusGroup(m.getString('status')) === 'dead') continue;
    const renewal = u.findOne(app, 'renewals', 'deadline = {:d}', { d: dl.id });
    if (renewal !== null && renewal.getString('decision') === 'lapse') continue;
    const ruleId = dl.getString('rule');
    if (ruleId && rulesCache[ruleId] === undefined) {
      const rr = u.byId(app, 'rules', ruleId);
      rulesCache[ruleId] = rr ? engine.ruleObj(rr) : null;
    }
    const rule = ruleId ? rulesCache[ruleId] : null;
    if (renewal === null && !(rule && rule.creates_renewal)) continue;
    const due = u.d10(dl.getString('due_date'));
    let amount = renewal !== null ? renewal.getFloat('official_fee') + renewal.getFloat('other_fee') : 0;
    let currency = renewal !== null ? renewal.getString('currency') : '';
    if (!(amount > 0) && rule) {
      const est = engine.estimateFee(app, dl, rule, m);
      amount = est.official_fee;
      currency = est.currency;
    }
    const fr = m.getString('franchise') ? u.byId(app, 'franchises', m.getString('franchise')) : null;
    const push = function (d, amt, cur, label, labelJa, projected) {
      if (d > horizon) return;
      const conv = amt > 0 && cur ? fx.convert(app, amt, cur, home, rates) : null;
      items.push({
        date: d,
        year: d.slice(0, 4),
        matter_id: m.id,
        ref: m.getString('ref'),
        title: label,
        title_ja: labelJa,
        jurisdiction: m.getString('jurisdiction'),
        ip_type: m.getString('ip_type'),
        franchise: fr ? fr.getString('name') : '',
        amount: amt,
        currency: cur,
        home_amount: conv,
        projected: projected,
      });
    };
    push(due, amount, currency, dl.getString('title'), dl.getString('title_ja'), false);
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
        const n0 = String(n * rule.every);
        push(c.due, est.official_fee, est.currency, rule.title.split('{n}').join(String(n)).split('{n0}').join(n0), rule.title_ja.split('{n}').join(String(n)).split('{n0}').join(n0), true);
      }
    }
  }
  items.sort(function (a, b) {
    return a.date < b.date ? -1 : 1;
  });
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
  return {
    currency: home,
    horizon: horizon,
    years: Object.keys(byYear)
      .sort()
      .map(function (k) {
        return byYear[k];
      }),
    items: items,
  };
}

/* ------------------------------------------------------------------ */
/* Standard reports                                                    */
/* ------------------------------------------------------------------ */

const LABELS = {
  kind: { hard: ['Statutory', '法定'], extendable: ['Extendable', '延長可'], designated: ['Set by office', '官庁指定'], internal: ['Internal', '社内'], reminder: ['Reminder', 'リマインダー'] },
  ip_type: { design: ['Design', '意匠'], trademark: ['Trademark', '商標'] },
  direction: { in: ['Rights in', '権利取得'], out: ['Rights out', '権利許諾'], mutual: ['Mutual', '相互'], none: ['No rights', '権利なし'] },
  decision: { pending: ['Not decided', '未判断'], renew: ['Renew', '更新'], renew_partial: ['Renew, drop classes', '一部区分を更新'], lapse: ['Let lapse', '放棄'], defer: ['Decide later', '保留'] },
  instruction: { not_instructed: ['Not instructed', '未指示'], instructed: ['Instructed', '指示済み'], paid: ['Paid', '納付済み'], confirmed: ['Confirmed', '確認済み'], lapsed: ['Lapsed', '消滅'] },
};

function lab(group, v, lang) {
  const g = LABELS[group] || {};
  const pair = g[v];
  if (!pair) return String(v || '').replace(/_/g, ' ');
  return lang === 'ja' ? pair[1] : pair[0];
}

function col(key, en, ja, type, lang) {
  return { key: key, label: lang === 'ja' ? ja : en, type: type || 'text' };
}

function T(lang, en, ja) {
  return lang === 'ja' ? ja : en;
}

function partyName(app, id) {
  const u = u_();
  const p = id ? u.byId(app, 'parties', id) : null;
  return p ? p.getString('name') : '';
}

const REPORTS = [
  'deadlines',
  'portfolio',
  'agreements_expiring',
  'chain_of_title',
  'renewal_decisions',
  'forecast',
  'approvals',
  'royalties',
  'seals',
  'distributions',
  'permissions',
  'music_unregistered',
  'trademark_gaps',
  'enforcement',
  'audit',
];

function runReport(app, name, params, lang) {
  const u = u_();
  const p = params || {};
  const L = lang === 'ja' ? 'ja' : 'en';
  const today = u.today();
  const D = function (d) {
    return u.d10(d);
  };
  if (name === 'deadlines') {
    const days = Number(p.days || 90);
    const rows = u.findMany(app, 'deadlines', 'status = "open" && due_date <= {:h}', 'due_date', 0, { h: u.toPb(u.addDays(today, days)) });
    return {
      title: T(L, 'Open deadlines, next ' + days + ' days (including overdue)', '今後' + days + '日の未完了期限（期限超過を含む）'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('title', 'Deadline', '期限', 'text', L), col('kind', 'Kind', '種類', 'text', L), col('category', 'Area', '領域', 'text', L), col('due', 'Due', '期限日', 'date', L), col('final', 'Final', '最終期限', 'date', L), col('assignee', 'Assignee', '担当', 'text', L), col('citation', 'Basis', '根拠', 'text', L)],
      rows: rows.map(function (d) {
        return {
          ref: d.getString('ref') || d.getString('subject_label'),
          title: L === 'ja' ? d.getString('title_ja') || d.getString('title') : d.getString('title'),
          kind: lab('kind', d.getString('kind'), L),
          category: d.getString('category'),
          due: D(d.getString('due_date')),
          final: D(d.getString('final_date')),
          assignee: d.getString('assignee') ? u.userLabel(app, d.getString('assignee')) : '',
          citation: d.getString('citation'),
        };
      }),
    };
  }
  if (name === 'portfolio') {
    const rows = u.findMany(app, 'matters', p.include_dead ? '' : 'status_group != "dead"', 'ref', 0);
    return {
      title: T(L, 'Trademark and design register', '商標・意匠一覧'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('title', 'Mark or design', '商標・意匠', 'text', L), col('type', 'Type', '種類', 'text', L), col('jurisdiction', 'Office', '官庁', 'text', L), col('status', 'Status', '状態', 'text', L), col('classes', 'Classes', '区分', 'text', L), col('application_no', 'Application no.', '出願番号', 'text', L), col('registration_no', 'Registration no.', '登録番号', 'text', L), col('registration', 'Registered', '登録日', 'date', L), col('expiry', 'Expiry', '満了日', 'date', L), col('owner', 'Belongs to', '対象', 'text', L), col('next', 'Next deadline', '次の期限', 'date', L)],
      rows: rows.map(function (m) {
        const classes = u.findMany(app, 'goods_services', 'matter = {:m}', 'nice_class', 0, { m: m.id }).map(function (g) {
          return g.getInt('nice_class');
        });
        let owner = '';
        if (m.getString('character')) owner = (u.byId(app, 'characters', m.getString('character')) || { getString: function () { return ''; } }).getString('name');
        else if (m.getString('talent')) owner = (u.byId(app, 'talents', m.getString('talent')) || { getString: function () { return ''; } }).getString('stage_name');
        else if (m.getString('franchise')) owner = (u.byId(app, 'franchises', m.getString('franchise')) || { getString: function () { return ''; } }).getString('name');
        return {
          ref: m.getString('ref'),
          title: m.getString('title'),
          type: lab('ip_type', m.getString('ip_type'), L),
          jurisdiction: m.getString('jurisdiction'),
          status: m.getString('status').replace(/_/g, ' '),
          classes: classes.join(', '),
          application_no: m.getString('application_no'),
          registration_no: m.getString('registration_no'),
          registration: D(m.getString('registration_date')),
          expiry: D(m.getString('expiry_date')),
          owner: owner,
          next: D(m.getString('next_deadline')),
        };
      }),
    };
  }
  if (name === 'agreements_expiring') {
    const days = Number(p.days || 180);
    const rows = u.findMany(app, 'agreements', 'status = "active" && perpetual = false && term_end != "" && term_end <= {:h}', 'term_end', 0, { h: u.toPb(u.addDays(today, days)) });
    return {
      title: T(L, 'Active agreements ending in the next ' + days + ' days', '今後' + days + '日以内に満了する有効な契約'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('title', 'Agreement', '契約', 'text', L), col('type', 'Type', '種類', 'text', L), col('direction', 'Direction', '方向', 'text', L), col('counterparty', 'Counterparty', '相手方', 'text', L), col('term_end', 'Term ends', '満了日', 'date', L), col('auto_renew', 'Auto-renews', '自動更新', 'text', L)],
      rows: rows.map(function (a) {
        return {
          ref: a.getString('ref'),
          title: a.getString('title'),
          type: a.getString('agreement_type').replace(/_/g, ' '),
          direction: lab('direction', a.getString('direction'), L),
          counterparty: partyName(app, a.getString('counterparty')),
          term_end: D(a.getString('term_end')),
          auto_renew: a.getBool('auto_renew') ? T(L, 'Yes', 'あり') : T(L, 'No', 'なし'),
        };
      }),
    };
  }
  if (name === 'chain_of_title') {
    const rows = [];
    for (const ch of u.findMany(app, 'characters', 'status != "archived"', 'name', 0)) {
      const assets = u.findMany(app, 'character_assets', 'character = {:c}', '', 0, { c: ch.id });
      const n = function (fn) {
        return assets.filter(fn).length;
      };
      rows.push({
        name: ch.getString('name'),
        kind: T(L, 'Character', 'キャラクター'),
        layers: assets.length,
        cleared: n(function (a) {
          return a.getString('status') === 'cleared';
        }),
        no_27_28: n(function (a) {
          return a.getString('acquisition') === 'assignment' && !a.getBool('art27_28');
        }),
        no_waiver: n(function (a) {
          return !a.getBool('moral_rights_waiver') && a.getString('acquisition') !== 'owned_original' && a.getString('acquisition') !== 'work_for_hire';
        }),
        unknown: n(function (a) {
          return a.getString('acquisition') === 'unknown' || a.getString('acquisition') === '';
        }),
        open: 0,
      });
    }
    for (const w of u.findMany(app, 'titles', 'parent = ""', 'title', 0)) {
      const cl = u.findMany(app, 'clearances', 'work = {:w}', '', 0, { w: w.id });
      rows.push({
        name: w.getString('title'),
        kind: T(L, 'Title', '作品'),
        layers: cl.length,
        cleared: cl.filter(function (c) {
          return c.getString('status') === 'cleared';
        }).length,
        no_27_28: 0,
        no_waiver: 0,
        unknown: 0,
        open: cl.filter(function (c) {
          return ['not_started', 'requested', 'in_progress', 'not_cleared'].indexOf(c.getString('status')) >= 0;
        }).length,
      });
    }
    return {
      title: T(L, 'Chain of title by character and title', 'キャラクター・作品ごとの権利関係'),
      columns: [col('name', 'Character or title', 'キャラクター・作品', 'text', L), col('kind', 'Kind', '種類', 'text', L), col('layers', 'Layers or items', '要素・項目数', 'number', L), col('cleared', 'Cleared', '確認済み', 'number', L), col('no_27_28', 'Assignments missing Art. 27/28', '27条・28条の記載なし', 'number', L), col('no_waiver', 'No moral-rights waiver', '人格権不行使なし', 'number', L), col('unknown', 'Acquisition unknown', '取得方法不明', 'number', L), col('open', 'Open clearance items', '未完了の確認項目', 'number', L)],
      rows: rows,
    };
  }
  if (name === 'renewal_decisions') {
    const rows = u.findMany(app, 'renewals', 'instruction_status != "confirmed" && instruction_status != "lapsed"', 'due_date', 0);
    return {
      title: T(L, 'Renewal decisions and instructions', '更新の判断と指示'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('renewal', 'Renewal', '更新', 'text', L), col('jurisdiction', 'Office', '官庁', 'text', L), col('due', 'Due', '期限', 'date', L), col('grace', 'Grace ends', '猶予期限', 'date', L), col('fee', 'Official fee', '官庁手数料', 'text', L), col('home', 'Home currency', '自国通貨', 'number', L), col('decision', 'Decision', '判断', 'text', L), col('instruction', 'Instruction', '指示', 'text', L), col('provider', 'Provider', '代理人', 'text', L)],
      rows: rows.map(function (r) {
        const m = u.byId(app, 'matters', r.getString('matter'));
        return {
          ref: m ? m.getString('ref') : '',
          renewal: r.getString('cycle_label'),
          jurisdiction: m ? m.getString('jurisdiction') : '',
          due: D(r.getString('due_date')),
          grace: D(r.getString('grace_end')),
          fee: r.getFloat('official_fee') > 0 ? u.money(r.getFloat('official_fee'), r.getString('currency')) : T(L, 'Unknown', '不明'),
          home: r.getFloat('home_amount'),
          decision: lab('decision', r.getString('decision'), L),
          instruction: lab('instruction', r.getString('instruction_status'), L),
          provider: r.getString('provider'),
        };
      }),
    };
  }
  if (name === 'forecast') {
    const f = forecast(app, Number(p.years || 5));
    return {
      title: T(L, 'Renewal cost forecast (' + f.currency + ')', '更新費用の見通し（' + f.currency + '）'),
      columns: [col('date', 'Due', '期限', 'date', L), col('ref', 'Reference', '参照', 'text', L), col('title', 'Renewal', '更新', 'text', L), col('jurisdiction', 'Office', '官庁', 'text', L), col('franchise', 'Franchise', 'フランチャイズ', 'text', L), col('fee', 'Official fee', '官庁手数料', 'text', L), col('home', f.currency, f.currency, 'number', L), col('projected', 'Projected', '予測', 'text', L)],
      rows: f.items.map(function (it) {
        return {
          date: it.date,
          ref: it.ref,
          title: L === 'ja' ? it.title_ja || it.title : it.title,
          jurisdiction: it.jurisdiction,
          franchise: it.franchise,
          fee: it.amount > 0 ? u.money(it.amount, it.currency) : T(L, 'Unknown', '不明'),
          home: it.home_amount === null ? '' : it.home_amount,
          projected: it.projected ? T(L, 'Projected', '予測') : T(L, 'Scheduled', '確定'),
        };
      }),
    };
  }
  if (name === 'approvals') {
    const rows = u.findMany(app, 'approvals', p.include_closed ? '' : 'status = "submitted" || status = "in_review" || status = "changes_requested"', 'due_date', 0);
    return {
      title: T(L, 'Product approvals and their age', '監修の状況と経過日数'),
      columns: [col('product', 'Product', '商品', 'text', L), col('licensee', 'Licensee', 'ライセンシー', 'text', L), col('stage', 'Stage', '段階', 'text', L), col('round', 'Round', '回数', 'number', L), col('status', 'Status', '状態', 'text', L), col('submitted', 'Submitted', '提出日', 'date', L), col('due', 'Reply due', '回答期限', 'date', L), col('age', 'Days open', '経過日数', 'number', L), col('waiting', 'Waiting on', '確認待ち', 'text', L)],
      rows: rows.map(function (a) {
        const pr = u.byId(app, 'products', a.getString('product'));
        const waiting = u
          .j(a, 'reviewers', [])
          .filter(function (r) {
            return r.decision === 'pending' || !r.decision;
          })
          .map(function (r) {
            return L === 'ja' ? r.label_ja || r.label : r.label;
          });
        return {
          product: pr ? pr.getString('name') : '',
          licensee: pr ? partyName(app, pr.getString('licensee')) || T(L, 'In-house', '自社') : '',
          stage: a.getString('stage').replace(/_/g, ' '),
          round: a.getInt('round'),
          status: a.getString('status').replace(/_/g, ' '),
          submitted: D(a.getString('submitted_at')),
          due: D(a.getString('due_date')),
          age: u.diffDays(D(a.getString('submitted_at')) || today, today),
          waiting: waiting.join(', '),
        };
      }),
    };
  }
  if (name === 'royalties') {
    const lic = require(`${__hooks}/lib_licensing.js`);
    const rows = [];
    for (const a of u.findMany(app, 'agreements', 'royalty_basis != "" && royalty_basis != "none" && status != "draft"', 'title', 0)) {
      const mg = lic.mgStatus(app, a);
      const reps = u.findMany(app, 'royalty_reports', 'agreement = {:a}', '', 0, { a: a.id });
      rows.push({
        ref: a.getString('ref'),
        agreement: a.getString('title'),
        counterparty: partyName(app, a.getString('counterparty')),
        basis: a.getString('royalty_basis').replace(/_/g, ' '),
        currency: a.getString('currency'),
        earned: mg.earned,
        paid: mg.paid,
        mg: mg.minimum_guarantee,
        mg_remaining: mg.remaining,
        overdue: reps.filter(function (r) {
          return r.getString('status') === 'expected' && D(r.getString('due_date')) !== '' && D(r.getString('due_date')) < today;
        }).length,
      });
    }
    return {
      title: T(L, 'Royalties and minimum guarantees by agreement', '契約別のロイヤルティとミニマムギャランティ'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('agreement', 'Agreement', '契約', 'text', L), col('counterparty', 'Counterparty', '相手方', 'text', L), col('basis', 'Basis', '算定基準', 'text', L), col('currency', 'Currency', '通貨', 'text', L), col('earned', 'Earned', '発生額', 'number', L), col('paid', 'Paid', '支払済み', 'number', L), col('mg', 'Minimum guarantee', 'MG', 'number', L), col('mg_remaining', 'MG not yet earned', 'MG未消化', 'number', L), col('overdue', 'Statements overdue', '報告遅延', 'number', L)],
      rows: rows,
    };
  }
  if (name === 'seals') {
    const lic = require(`${__hooks}/lib_licensing.js`);
    const rows = [];
    for (const a of u.findMany(app, 'agreements', 'agreement_type = "merchandise" || agreement_type = "overseas" || agreement_type = "fan_permit"', 'title', 0)) {
      for (const v of lic.sealVariance(app, { agreement: a.id })) {
        if (!v.issued) continue;
        rows.push({
          product: v.name,
          agreement: a.getString('ref') || a.getString('title'),
          issued: v.issued,
          used: v.used,
          void: v.void,
          returned: v.returned,
          unaccounted: v.unaccounted,
          manufactured: v.manufactured_reported,
          variance: v.variance,
        });
      }
    }
    return {
      title: T(L, 'Seals issued against reported production', '証紙の発行数と報告された製造数'),
      columns: [col('product', 'Product', '商品', 'text', L), col('agreement', 'Agreement', '契約', 'text', L), col('issued', 'Issued', '発行', 'number', L), col('used', 'Used', '使用', 'number', L), col('void', 'Void', '無効', 'number', L), col('returned', 'Returned', '返却', 'number', L), col('unaccounted', 'Unaccounted', '未報告', 'number', L), col('manufactured', 'Manufactured (statements)', '製造数（報告）', 'number', L), col('variance', 'Used minus manufactured', '使用数と製造数の差', 'number', L)],
      rows: rows,
    };
  }
  if (name === 'distributions') {
    const rows = u.findMany(app, 'distributions', '', '-period_end', 0);
    return {
      title: T(L, 'Committee distributions', '委員会の分配'),
      columns: [col('committee', 'Committee', '委員会', 'text', L), col('period', 'Period ending', '期間末', 'date', L), col('gross', 'Gross receipts', '総収入', 'number', L), col('fees', 'Window fees', '窓口手数料', 'number', L), col('lead', 'Lead fee', '幹事手数料', 'number', L), col('pool', 'Paid to members', '分配額', 'number', L), col('status', 'Status', '状態', 'text', L), col('due', 'Due', '支払期限', 'date', L)],
      rows: rows.map(function (d) {
        const c = u.byId(app, 'committees', d.getString('committee'));
        return {
          committee: c ? c.getString('name') : '',
          period: D(d.getString('period_end')),
          gross: d.getFloat('gross_total'),
          fees: d.getFloat('window_fees'),
          lead: d.getFloat('lead_fee'),
          pool: d.getFloat('pool'),
          status: d.getString('status'),
          due: D(d.getString('due_date')),
        };
      }),
    };
  }
  if (name === 'permissions') {
    const days = Number(p.days || 90);
    const rows = u.findMany(app, 'permissions', 'status = "active" || status = "pending_application"', 'end_date', 0);
    return {
      title: T(L, 'Permissions and their limits', '許諾とその条件'),
      columns: [col('title', 'Permission', '許諾', 'text', L), col('type', 'Type', '種類', 'text', L), col('counterparty', 'From', '許諾元', 'text', L), col('talents', 'Talents', 'タレント', 'text', L), col('platforms', 'Platforms', 'プラットフォーム', 'text', L), col('monetization', 'Monetization', '収益化', 'text', L), col('archive', 'Archive', 'アーカイブ', 'text', L), col('end', 'Ends', '終了日', 'date', L), col('soon', 'Ends within ' + days + ' days', days + '日以内に終了', 'text', L)],
      rows: rows.map(function (x) {
        const talents = x.getBool('all_talents')
          ? T(L, 'All talents', '全タレント')
          : u
              .ids(x, 'talents')
              .map(function (id) {
                const t = u.byId(app, 'talents', id);
                return t ? t.getString('stage_name') : '';
              })
              .join(', ');
        const end = D(x.getString('end_date'));
        return {
          title: x.getString('title'),
          type: x.getString('permission_type').replace(/_/g, ' '),
          counterparty: partyName(app, x.getString('counterparty')),
          talents: talents,
          platforms: u.asArray(u.j(x, 'platforms', [])).join(', '),
          monetization: u.asArray(u.j(x, 'monetization', [])).join(', '),
          archive: x.getString('archive'),
          end: end,
          soon: end !== '' && end <= u.addDays(today, days) ? T(L, 'Yes', 'はい') : '',
        };
      }),
    };
  }
  if (name === 'music_unregistered') {
    const music = require(`${__hooks}/lib_music.js`);
    return {
      title: T(L, 'Songs in use but not registered with a society', '使用中だが管理団体に未登録の楽曲'),
      columns: [col('title', 'Song', '楽曲', 'text', L), col('first', 'First published', '初公表', 'date', L), col('registrations', 'Registrations', '届出状況', 'text', L)],
      rows: music.usedButUnregistered(app).map(function (s) {
        return {
          title: s.title,
          first: s.first_publication,
          registrations: s.registrations
            .map(function (r) {
              return r.society.toUpperCase() + ' ' + r.status;
            })
            .join(', '),
        };
      }),
    };
  }
  if (name === 'trademark_gaps') {
    const rights = require(`${__hooks}/lib_rights.js`);
    const rows = [];
    for (const type of ['character', 'talent', 'franchise']) {
      const coll = type === 'character' ? 'characters' : type === 'talent' ? 'talents' : 'franchises';
      const nameField = type === 'talent' ? 'stage_name' : 'name';
      for (const r of u.findMany(app, coll, '', nameField, 0)) {
        const m = rights.coverageMatrix(app, { type: type, id: r.id });
        for (const g of m.gaps) rows.push({ subject: r.getString(nameField), kind: type, class: g.class, territory: g.territory, agreement: g.ref });
      }
    }
    return {
      title: T(L, 'Licensed categories and territories with no trademark behind them', '商標登録がない許諾カテゴリ・地域'),
      columns: [col('subject', 'Character, talent or franchise', '対象', 'text', L), col('kind', 'Kind', '種類', 'text', L), col('class', 'Nice class', '区分', 'number', L), col('territory', 'Territory', '地域', 'text', L), col('agreement', 'Licence', '契約', 'text', L)],
      rows: rows,
    };
  }
  if (name === 'enforcement') {
    const rows = u.findMany(app, 'enforcement_cases', p.include_closed ? '' : 'status != "closed" && status != "won" && status != "lost"', '-created', 0);
    return {
      title: T(L, 'Enforcement cases', '権利行使案件'),
      columns: [col('ref', 'Reference', '参照', 'text', L), col('title', 'Case', '案件', 'text', L), col('type', 'Type', '種類', 'text', L), col('forum', 'Forum', '手続', 'text', L), col('platform', 'Platform', 'プラットフォーム', 'text', L), col('status', 'Status', '状態', 'text', L), col('opened', 'Opened', '開始日', 'date', L), col('evidence', 'Evidence items', '証拠数', 'number', L)],
      rows: rows.map(function (c) {
        return {
          ref: c.getString('ref'),
          title: c.getString('title'),
          type: c.getString('case_type').replace(/_/g, ' '),
          forum: c.getString('forum').replace(/_/g, ' '),
          platform: c.getString('platform'),
          status: c.getString('status').replace(/_/g, ' '),
          opened: D(c.getString('opened_date')) || D(c.getString('created')),
          evidence: u.findMany(app, 'evidence', 'case_ref = {:c}', '', 0, { c: c.id }).length,
        };
      }),
    };
  }
  if (name === 'audit') {
    const from = u.d10(p.from) || u.addDays(today, -30);
    const to = u.d10(p.to) || today;
    const rows = u.findMany(app, 'audit_log', 'created >= {:a} && created <= {:b}', '-created', 5000, { a: from + ' 00:00:00.000Z', b: to + ' 23:59:59.999Z' });
    return {
      title: T(L, 'Audit log ' + u.human(from) + ' to ' + u.human(to), '監査ログ ' + u.humanJa(from) + 'から' + u.humanJa(to)),
      columns: [col('when', 'When', '日時', 'text', L), col('who', 'Who', '操作者', 'text', L), col('action', 'Action', '操作', 'text', L), col('collection', 'Record type', '記録の種類', 'text', L), col('label', 'Record', '記録', 'text', L), col('reason', 'Reason', '理由', 'text', L), col('changes', 'Changes', '変更内容', 'text', L)],
      rows: rows.map(function (r) {
        return {
          when: r.getString('created').slice(0, 16),
          who: r.getString('actor_name'),
          action: r.getString('action'),
          collection: r.getString('collection').replace(/_/g, ' '),
          label: r.getString('record_label'),
          reason: r.getString('reason'),
          changes: JSON.stringify(u.j(r, 'changes', {})).slice(0, 500),
        };
      }),
    };
  }
  throw u.err('Unknown report: ' + name, '不明なレポート：' + name);
}

/* ------------------------------------------------------------------ */
/* CSV import                                                          */
/* ------------------------------------------------------------------ */

const IMPORT_TYPES = ['design', 'trademark'];
const IMPORT_STATUS = [
  'to_file', 'filed', 'published', 'examination', 'office_action', 'allowed', 'opposed', 'registered',
  'in_grace', 'lapsed', 'abandoned', 'withdrawn', 'refused', 'expired', 'revoked', 'cancelled', 'transferred_out',
];

function findOrCreate(app, coll, field, value, extra, cache) {
  const u = u_();
  const k = coll + '|' + value.toLowerCase();
  if (cache[k]) return cache[k];
  let r = u.findOne(app, coll, field + ' = {:n}', { n: value });
  if (r === null) {
    const data = {};
    data[field] = value;
    r = u.newRecord(app, coll, Object.assign(data, extra || {}));
    app.save(r);
  }
  cache[k] = r.id;
  return r.id;
}

/**
 * Import trademarks and designs. Columns: ip_type, title, jurisdiction, application_no, filing_date,
 * publication_no, publication_date, registration_no, registration_date, status, classes,
 * family, franchise, character, talent, owner_of_record, counsel, client_ref, route, notes, ref.
 */
function importMatters(app, rows, dryRun, generate, actorId) {
  const u = u_();
  const engine = require(`${__hooks}/lib_engine.js`);
  const results = [];
  let created = 0;
  let updated = 0;
  let errors = 0;
  let deadlines = 0;
  const cache = {};
  rows.forEach(function (row, idx) {
    const r = row || {};
    const line = idx + 1;
    const ipType = String(r.ip_type || 'trademark').trim().toLowerCase();
    const jur = String(r.jurisdiction || '').trim().toUpperCase();
    const title = String(r.title || '').trim();
    // Each problem is [English, Japanese]; results carry message and message_ja.
    const problems = [];
    if (IMPORT_TYPES.indexOf(ipType) < 0) problems.push(['Type must be trademark or design', '種類は trademark か design にしてください']);
    if (!/^[A-Z]{2}$/.test(jur)) problems.push(['Office must be a 2-letter code (JP, US, CN, KR, TW, EM, WO...)', '官庁は2文字のコードにしてください（JP、US、CN、KR、TW、EM、WOなど）']);
    if (!title) problems.push(['Title is required', '名称は必須です']);
    const status = String(r.status || '').trim().toLowerCase().replace(/\s+/g, '_');
    if (status && IMPORT_STATUS.indexOf(status) < 0) problems.push(['Unknown status "' + r.status + '"', '不明なステータス「' + r.status + '」']);
    const dates = {};
    for (const f of ['filing_date', 'publication_date', 'registration_date']) {
      const v = String(r[f] || '').trim();
      if (!v) continue;
      const d = u.officeDate(v);
      if (!d) problems.push([f.replace('_', ' ') + ' "' + v + '" is not a date (use YYYY-MM-DD)', f + '「' + v + '」は日付ではありません（YYYY-MM-DD形式）']);
      else dates[f] = d;
    }
    if (problems.length) {
      errors += 1;
      results.push({ line: line, action: 'error', message: problems.map((x) => x[0]).join('; '), message_ja: problems.map((x) => x[1]).join('。'), title: title });
      return;
    }
    const appNo = String(r.application_no || '').trim();
    let existing = null;
    if (r.ref) existing = u.findOne(app, 'matters', 'ref = {:r}', { r: String(r.ref).trim() });
    if (existing === null && appNo) {
      for (const c of u.findMany(app, 'matters', 'jurisdiction = {:j}', '', 0, { j: jur })) if (normNum(c.getString('application_no')) === normNum(appNo)) existing = c;
    }
    const action = existing ? 'update' : 'create';
    if (dryRun) {
      results.push({
        line: line,
        action: action,
        message: action === 'update' ? 'Updates ' + existing.getString('ref') : 'Creates a new ' + ipType,
        message_ja: action === 'update' ? existing.getString('ref') + 'を更新' : (ipType === 'design' ? '意匠' : '商標') + 'を新規作成',
        title: title,
      });
      if (action === 'create') created += 1;
      else updated += 1;
      return;
    }
    try {
      const famTitle = String(r.family || '').trim();
      const familyId = famTitle ? findOrCreate(app, 'families', 'title', famTitle, { kind: ipType, strategy: 'maintain' }, cache) : '';
      const franchiseId = String(r.franchise || '').trim() ? findOrCreate(app, 'franchises', 'name', String(r.franchise).trim(), { status: 'active', ownership_model: 'sole_owner' }, cache) : '';
      const characterId = String(r.character || '').trim() ? findOrCreate(app, 'characters', 'name', String(r.character).trim(), { status: 'active', franchise: franchiseId }, cache) : '';
      const talentId = String(r.talent || '').trim() ? findOrCreate(app, 'talents', 'stage_name', String(r.talent).trim(), { lifecycle: 'active', affiliation: 'ours' }, cache) : '';
      const m = existing || u.newRecord(app, 'matters', { ip_type: ipType, jurisdiction: jur, status: status || 'filed', route: 'national', relation: 'none' });
      m.set('title', title);
      if (appNo) m.set('application_no', appNo);
      if (r.publication_no) m.set('publication_no', String(r.publication_no).trim());
      if (r.registration_no) m.set('registration_no', String(r.registration_no).trim());
      for (const f of Object.keys(dates)) m.set(f, u.toPb(dates[f]));
      if (status) m.set('status', status);
      if (familyId) m.set('family', familyId);
      if (franchiseId) m.set('franchise', franchiseId);
      if (characterId) m.set('character', characterId);
      if (talentId) m.set('talent', talentId);
      if (r.owner_of_record) m.set('owner_of_record', String(r.owner_of_record));
      if (r.counsel) m.set('counsel', String(r.counsel));
      if (r.client_ref) m.set('client_ref', String(r.client_ref));
      if (r.route) m.set('route', String(r.route).trim().toLowerCase());
      if (r.notes) m.set('notes', String(r.notes));
      app.save(m);
      if (ipType === 'trademark' && r.classes) {
        const have = {};
        for (const g of u.findMany(app, 'goods_services', 'matter = {:m}', '', 0, { m: m.id })) have[g.getInt('nice_class')] = true;
        for (const c of String(r.classes).split(/[^0-9]+/)) {
          const n = parseInt(c, 10);
          if (n >= 1 && n <= 45 && !have[n]) {
            app.save(u.newRecord(app, 'goods_services', { matter: m.id, nice_class: n, class_status: m.getString('status_group') === 'live' ? 'registered' : 'pending' }));
            have[n] = true;
          }
        }
      }
      if (!existing) {
        const subject = engine.subjectFromRecord('matter', u.byId(app, 'matters', m.id));
        const evs = [];
        if (dates.filing_date) evs.push(['FILED', dates.filing_date]);
        if (dates.publication_date) evs.push(['PUBLISHED', dates.publication_date]);
        if (dates.registration_date) evs.push(['REGISTERED', dates.registration_date]);
        for (const e of evs) {
          const res = engine.recordEvent(app, subject, e[0], e[1], {
            source: 'system',
            actorId: actorId,
            commit: generate !== false,
            label: engine.EVENT_CODES[e[0]].label + ' (imported)',
            label_ja: engine.EVENT_CODES[e[0]].label_ja + '（取込）',
          });
          deadlines += res.created.length;
          subject.record = u.byId(app, 'matters', m.id);
        }
        created += 1;
      } else updated += 1;
      const ref = u.byId(app, 'matters', m.id).getString('ref') || '';
      results.push({ line: line, action: action, message: (action === 'create' ? 'Created ' : 'Updated ') + ref, message_ja: ref + (action === 'create' ? 'を作成' : 'を更新'), title: title, id: m.id });
    } catch (error) {
      errors += 1;
      results.push({ line: line, action: 'error', message: String(error.message || error), message_ja: String(error.ja || error.message || error), title: title });
    }
  });
  if (!dryRun) u.audit(app, actorId, 'import', 'matters', '', 'CSV import', { created: created, updated: updated, errors: errors, deadlines: deadlines }, '');
  return { dry_run: dryRun, created: created, updated: updated, errors: errors, deadlines: deadlines, results: results };
}

/** Import watch hits (trademark watch reports or marketplace listings). */
function importWatch(app, rows, actorId) {
  const u = u_();
  let created = 0;
  const errors = [];
  rows.forEach(function (r, i) {
    if (!r || !String(r.their_mark || r.title || '').trim()) {
      errors.push({ en: 'Line ' + (i + 1) + ': their_mark is required', ja: (i + 1) + '行目：their_mark は必須です' });
      return;
    }
    let familyId = '';
    if (r.our_mark) {
      const f = u.findOne(app, 'families', 'kind = "trademark" && title = {:t}', { t: String(r.our_mark).trim() });
      if (f) familyId = f.id;
    }
    let characterId = '';
    if (r.character) {
      const c = u.findOne(app, 'characters', 'name = {:n}', { n: String(r.character).trim() });
      if (c) characterId = c.id;
    }
    const kind = String(r.kind || (r.url ? 'marketplace' : 'trademark')).toLowerCase();
    app.save(
      u.newRecord(app, 'watch_hits', {
        kind: ['trademark', 'marketplace', 'impersonation', 'web'].indexOf(kind) >= 0 ? kind : 'trademark',
        family: familyId,
        character: characterId,
        their_mark: String(r.their_mark || r.title).trim(),
        their_owner: String(r.their_owner || r.seller || ''),
        url: String(r.url || ''),
        jurisdiction: String(r.jurisdiction || '').toUpperCase().slice(0, 3),
        application_no: String(r.application_no || ''),
        classes: String(r.classes || ''),
        goods: String(r.goods || ''),
        publication_date: u.toPb(u.officeDate(r.publication_date)),
        opposition_deadline: u.toPb(u.officeDate(r.opposition_deadline)),
        score: Number(r.score || 0) || 0,
        status: 'new',
        source: String(r.source || 'Import'),
      }),
    );
    created += 1;
  });
  u.audit(app, actorId, 'import', 'watch_hits', '', 'Watch import', { created: created, errors: errors.length }, '');
  return { created: created, errors: errors };
}

module.exports = {
  REPORTS: REPORTS,
  summary: summary,
  search: search,
  forecast: forecast,
  runReport: runReport,
  importMatters: importMatters,
  importWatch: importWatch,
  normNum: normNum,
};
