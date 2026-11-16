/**
 * lib_packcheck: checks a rule pack before it may run, and runs its golden
 * test vectors.
 *
 *   validate(pack, others?)    -> problems [{ level: 'error'|'warning', code, path, message }]
 *   runVectors(pack, others?)  -> { passed, total, failures: [{ index, name, problems, issues }] }
 *   checkSet(packs)            -> problems across a set of packs (duplicate codes, missing requires)
 *
 * `others` are the packs this one may require (other codes, any versions).
 * A pack with an error never activates; warnings are shown to the person.
 * Pure JavaScript for Node (tools/packs/test.mjs) and Goja (rule pack ops).
 */

let X = null;
let ENG = null;
function expr() {
  if (X === null) X = require('./lib_expr.js');
  return X;
}
function engine() {
  if (ENG === null) ENG = require('./lib_engine.js');
  return ENG;
}

const TOP_KEYS = ['code', 'country', 'region', 'name', 'version', 'effective_from', 'effective_to', 'currency', 'tax_year', 'date_basis', 'requires', 'order', 'ship', 'sources', 'notes', 'profile_fields', 'tags', 'seed_components', 'tables', 'steps', 'year_end_steps', 'vectors', 'min_wage', 'filings', 'documents'];
const VAR_KEYS = ['var', 'expr', 'when', 'else', 'round', 'explain'];
const LINE_KEYS = ['code', 'name', 'kind', 'stage', 'when', 'amount', 'qty', 'rate', 'base', 'round', 'tags', 'payee', 'filing', 'explain', 'keep_zero'];
const CHECK_KEYS = ['check', 'when', 'severity', 'issue', 'message', 'explain'];
const FIELD_KEYS = ['key', 'label', 'type', 'options', 'default', 'required', 'help', 'form', 'scope', 'min', 'max'];
const VECTOR_KEYS = ['name', 'source', 'reference', 'input', 'expect', 'expect_vars', 'expect_totals', 'expect_issues', 'packs', 'note'];

function has(obj, key) {
  return obj !== null && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key);
}
function isNum(v) {
  return typeof v === 'number' && v === v && v !== Infinity && v !== -Infinity;
}
function isId(s) {
  return typeof s === 'string' && /^[a-z_][a-z0-9_]*$/.test(s);
}
function plainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function makeList() {
  const list = [];
  const seen = Object.create(null);
  const add = function (level, code, path, message) {
    const key = level + '|' + path + '|' + message;
    if (seen[key] === true) return;
    seen[key] = true;
    list.push({ level: level, code: code, path: path, message: message });
  };
  list.error = function (code, path, message) { add('error', code, path, message); };
  list.warn = function (code, path, message) { add('warning', code, path, message); };
  return list;
}

function unknownKeys(obj, allowed, path, P) {
  for (const k of Object.keys(obj)) if (allowed.indexOf(k) < 0) P.warn('unknown_key', path + '.' + k, 'unknown key "' + k + '" (ignored; check the spelling)');
}

/** Packs this pack requires, found among `others`, transitively (one version per code: the newest). */
function requiredPacks(pack, others) {
  const byCode = Object.create(null);
  for (const o of others || []) {
    if (!o || typeof o.code !== 'string') continue;
    const cur = byCode[o.code];
    if (cur === undefined || String(o.effective_from) > String(cur.effective_from)) byCode[o.code] = o;
  }
  const out = [];
  const seen = Object.create(null);
  (function walk(p) {
    for (const c of Array.isArray(p.requires) ? p.requires : []) {
      if (seen[c] || c === pack.code) continue;
      seen[c] = true;
      if (byCode[c] !== undefined) {
        out.push(byCode[c]);
        walk(byCode[c]);
      }
    }
  })(pack);
  return out;
}

/**
 * The values a text formula can take, when they can be listed: literals,
 * joins, both branches of a condition, enum fields, run.kind and
 * run.frequency, and earlier vars whose own formula can be listed. Else null.
 * ctx = { fields: { profile, entity }, vars: { name: [values] } }.
 */
function possibleStrings(node, ctx) {
  const E = engine();
  const fieldsByScope = ctx.fields;
  if (!node) return null;
  if (node.t === 'str') return [node.v];
  if (node.t === 'group') return possibleStrings(node.a, ctx);
  if (node.t === 'name' && node.path.length === 1) {
    const v = ctx.vars[node.path[0]];
    return v === undefined ? null : v.slice();
  }
  if (node.t === 'bin' && node.op === '+') {
    const a = possibleStrings(node.a, ctx);
    const b = possibleStrings(node.b, ctx);
    if (a === null || b === null || a.length * b.length > 500) return null;
    const out = [];
    for (const x of a) for (const y of b) out.push(x + y);
    return out;
  }
  if (node.t === 'cond') {
    const a = possibleStrings(node.a, ctx);
    const b = possibleStrings(node.b, ctx);
    return a === null || b === null ? null : unique(a.concat(b));
  }
  if (node.t === 'call' && node.fn === 'if') {
    const a = possibleStrings(node.args[1], ctx);
    const b = possibleStrings(node.args[2], ctx);
    return a === null || b === null ? null : unique(a.concat(b));
  }
  if (node.t === 'call' && node.fn === 'coalesce') {
    let out = [];
    for (const arg of node.args) {
      if (arg.t === 'name' && arg.path.length === 2 && (arg.path[0] === 'profile' || arg.path[0] === 'entity')) {
        const f = fieldsByScope[arg.path[0]][arg.path[1]];
        if (f && f.type === 'enum') { out = out.concat((f.options || []).map((o) => String(o.value))); continue; }
      }
      const v = possibleStrings(arg, ctx);
      if (v === null) return null;
      out = out.concat(v);
    }
    return unique(out);
  }
  if (node.t === 'num') return [String(node.v)];
  if (node.t === 'name' && node.path.length === 2) {
    const root = node.path[0];
    const key = node.path[1];
    if (root === 'run' && key === 'kind') return E.constants.RUN_KINDS.slice();
    if (root === 'run' && key === 'frequency') return E.constants.FREQUENCIES.slice();
    if ((root === 'profile' || root === 'entity') && fieldsByScope[root][key] && fieldsByScope[root][key].type === 'enum') {
      return (fieldsByScope[root][key].options || []).map((o) => String(o.value));
    }
  }
  return null;
}

/**
 * Check a pack: its shape (SPEC 7.3), every formula (syntax, names, tables,
 * columns, var order, line references), dates, sources and ship status.
 */
function validate(pack, others) {
  const E = engine();
  const XP = expr();
  const P = makeList();
  if (!plainObject(pack)) {
    P.error('not_object', '', 'the pack is not an object');
    return P.slice();
  }
  unknownKeys(pack, TOP_KEYS, 'pack', P);
  jsonProblems(pack, 'pack', P, 0);

  // ---- identity and dates
  if (typeof pack.code !== 'string' || !/^[a-z][a-z0-9-]*$/.test(pack.code)) P.error('code', 'code', 'code must be lower case letters, digits and dashes, such as "us-federal"');
  if (typeof pack.country !== 'string' || !(pack.country === '' || /^[A-Z][A-Z]$/.test(pack.country))) P.error('country', 'country', 'country must be a two letter code such as "JP" ("" only for a template pack)');
  if (typeof pack.region !== 'string') P.error('region', 'region', 'region must be text ("" for the whole country)');
  if (typeof pack.name !== 'string' || pack.name.trim() === '') P.error('name', 'name', 'name is needed');
  if (typeof pack.version !== 'string' || pack.version.trim() === '') P.error('version', 'version', 'version is needed as text, such as "2026.1"');
  if (!XP.isDay(pack.effective_from)) P.error('effective_from', 'effective_from', 'effective_from must be a day YYYY-MM-DD');
  if (pack.effective_to !== undefined && pack.effective_to !== '' && pack.effective_to !== null && !XP.isDay(pack.effective_to)) P.error('effective_to', 'effective_to', 'effective_to must be a day YYYY-MM-DD or ""');
  if (XP.isDay(pack.effective_from) && XP.isDay(pack.effective_to) && pack.effective_to < pack.effective_from) P.error('effective_order', 'effective_to', 'effective_to is before effective_from');
  if (typeof pack.currency !== 'string' || !(pack.currency === '' || /^[A-Z]{3}$/.test(pack.currency))) P.error('currency', 'currency', 'currency must be a three letter code such as "JPY" ("" for any currency)');
  const ty = pack.tax_year;
  if (!plainObject(ty) || typeof ty.start !== 'string' || !/^\d\d-\d\d$/.test(ty.start) || !XP.isDay('2001-' + ty.start) || +ty.start.slice(3) > 28) P.error('tax_year', 'tax_year.start', 'tax_year.start must be MM-DD with a day from 01 to 28, such as "04-06"');
  if (pack.date_basis !== undefined && E.constants.DATE_BASES.indexOf(pack.date_basis) < 0) P.error('date_basis', 'date_basis', 'date_basis must be pay_date, period_end or period_start');
  if (!isNum(pack.order)) P.error('order', 'order', 'order must be a number (packs run from low to high)');
  const requires = pack.requires === undefined ? [] : pack.requires;
  if (!Array.isArray(requires) || !requires.every((c) => typeof c === 'string')) P.error('requires', 'requires', 'requires must be a list of pack codes');
  else {
    if (requires.indexOf(pack.code) >= 0) P.error('requires_self', 'requires', 'a pack cannot require itself');
    for (const c of requires) {
      const o = (others || []).find((p) => p && p.code === c);
      if (others && o === undefined) P.error('requires_missing', 'requires', 'required pack ' + c + ' is not available');
      if (o && isNum(o.order) && isNum(pack.order) && !(o.order < pack.order)) P.error('requires_order', 'requires', 'required pack ' + c + ' must have a lower order (it runs first)');
    }
  }
  if (pack.ship !== 'active' && pack.ship !== 'draft') P.error('ship', 'ship', 'ship must be "active" (verified with passing vectors) or "draft"');
  if (typeof pack.notes !== 'string' || pack.notes.trim() === '') P.error('notes', 'notes', 'notes must say plainly what the pack covers and does not');

  // ---- sources
  if (!Array.isArray(pack.sources) || pack.sources.length === 0) P.error('sources', 'sources', 'sources must list where the rules come from');
  else {
    let withUrl = 0;
    pack.sources.forEach((s, i) => {
      const at = 'sources[' + i + ']';
      if (!plainObject(s)) { P.error('source', at, 'a source must be an object'); return; }
      if (typeof s.title !== 'string' || s.title.trim() === '') P.error('source_title', at, 'a source needs a title');
      if (s.url !== undefined && typeof s.url !== 'string') P.error('source_url', at, 'url must be text');
      if (typeof s.url === 'string' && s.url !== '') {
        withUrl++;
        if (!/^https?:\/\//.test(s.url)) P.error('source_url', at, 'url must start with http:// or https://');
        if (!XP.isDay(s.retrieved)) P.error('source_retrieved', at, 'a source with a url needs retrieved: YYYY-MM-DD');
      }
    });
    if (pack.ship === 'active' && withUrl === 0 && pack.country !== '') P.error('source_official', 'sources', 'an active country pack needs at least one source with a url');
  }

  // ---- fields
  const fieldsByScope = { profile: Object.create(null), entity: Object.create(null) };
  const reqPacks = requiredPacks(pack, others);
  function addFields(list, owner, mine) {
    if (!Array.isArray(list)) return;
    list.forEach((f, i) => {
      const at = 'profile_fields[' + i + ']';
      if (!plainObject(f)) { if (mine) P.error('field', at, 'a field must be an object'); return; }
      const scope = f.scope === 'entity' ? 'entity' : 'profile';
      if (mine) {
        unknownKeys(f, FIELD_KEYS, at, P);
        if (!isId(f.key)) P.error('field_key', at, 'key must be lower_snake_case');
        if (f.scope !== undefined && f.scope !== 'employee' && f.scope !== 'entity') P.error('field_scope', at, 'scope must be employee (default) or entity');
        if (typeof f.label !== 'string' || f.label.trim() === '') P.error('field_label', at, 'a field needs a label people understand');
        if (E.constants.FIELD_TYPES.indexOf(f.type) < 0) P.error('field_type', at, 'type must be enum, number, money, boolean, text or date');
        if (f.type === 'enum') {
          if (!Array.isArray(f.options) || f.options.length === 0) P.error('field_options', at, 'an enum field needs options [{ value, label }]');
          else {
            const vals = f.options.map((o) => (o && o.value !== undefined ? String(o.value) : ''));
            if (vals.some((v) => v === '')) P.error('field_options', at, 'every option needs a value');
            if (new Set(vals).size !== vals.length) P.error('field_options', at, 'option values must be unique');
            if (f.options.some((o) => !o || typeof o.label !== 'string' || o.label === '')) P.warn('field_options', at, 'give every option a label');
          }
        }
        if (f.default !== undefined && f.default !== null && E.constants.FIELD_TYPES.indexOf(f.type) >= 0) {
          const ok = defaultFits(f);
          if (!ok) P.error('field_default', at, 'default ' + JSON.stringify(f.default) + ' does not fit type ' + f.type);
        }
        if (fieldsByScope[scope][f.key] !== undefined && fieldsByScope[scope][f.key].mine) P.error('field_duplicate', at, 'field ' + f.key + ' is declared twice');
      }
      if (fieldsByScope[scope][f.key] === undefined || mine) fieldsByScope[scope][f.key] = { type: f.type, options: f.options, owner: owner, mine: mine };
    });
  }
  for (const rp of reqPacks) addFields(rp.profile_fields, rp.code, false);
  if (pack.profile_fields !== undefined && !Array.isArray(pack.profile_fields)) P.error('profile_fields', 'profile_fields', 'profile_fields must be a list');
  addFields(pack.profile_fields, pack.code, true);

  // ---- tags and seed components
  const declaredTags = Object.create(null);
  if (pack.tags !== undefined && !Array.isArray(pack.tags)) P.error('tags', 'tags', 'tags must be a list of { tag, label }');
  (Array.isArray(pack.tags) ? pack.tags : []).forEach((t, i) => {
    if (!plainObject(t) || typeof t.tag !== 'string' || t.tag === '') { P.error('tag', 'tags[' + i + ']', 'a tag needs { tag, label }'); return; }
    if (declaredTags[t.tag]) P.warn('tag_duplicate', 'tags[' + i + ']', 'tag ' + t.tag + ' is listed twice');
    declaredTags[t.tag] = true;
    if (typeof t.label !== 'string' || t.label === '') P.warn('tag_label', 'tags[' + i + ']', 'give tag ' + t.tag + ' a label');
  });
  const seedCodes = Object.create(null);
  if (pack.seed_components !== undefined && !Array.isArray(pack.seed_components)) P.error('seed_components', 'seed_components', 'seed_components must be a list');
  (Array.isArray(pack.seed_components) ? pack.seed_components : []).forEach((c, i) => {
    const at = 'seed_components[' + i + ']';
    if (!plainObject(c)) { P.error('seed', at, 'a component must be an object'); return; }
    if (typeof c.code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(c.code)) P.error('seed_code', at, 'component code must be UPPER_SNAKE_CASE');
    if (seedCodes[c.code]) P.error('seed_duplicate', at, 'component ' + c.code + ' is listed twice');
    seedCodes[c.code] = true;
    if (E.constants.KINDS.indexOf(c.kind) < 0) P.error('seed_kind', at, 'kind must be earning, deduction, employer, reimbursement or info');
    if (c.kind === 'deduction' && E.constants.DEDUCTION_STAGES.indexOf(c.stage) < 0) P.error('seed_stage', at, 'a deduction needs stage pre, statutory or post');
    if (c.tags !== undefined && !(Array.isArray(c.tags) && c.tags.every((t) => typeof t === 'string'))) P.error('seed_tags', at, 'tags must be a list of text');
    for (const t of Array.isArray(c.tags) ? c.tags : []) declaredTags[t] = true;
  });

  // ---- tables
  const tables = Object.create(null);
  if (pack.tables !== undefined && !plainObject(pack.tables)) P.error('tables', 'tables', 'tables must be an object of named tables');
  for (const name of plainObject(pack.tables) ? Object.keys(pack.tables) : []) {
    try {
      tables[name] = XP.prepareTable(name, pack.tables[name]);
    } catch (err) {
      P.error('table', 'tables.' + name, err.message);
    }
  }

  // ---- steps
  const codesOfOthers = Object.create(null);
  const tagsOfOthers = Object.create(null);
  for (const rp of reqPacks) {
    for (const s of (rp.steps || []).concat(rp.year_end_steps || [])) {
      if (s && typeof s.code === 'string') codesOfOthers[s.code] = rp.code;
      if (s && Array.isArray(s.tags)) for (const t of s.tags) tagsOfOthers[t] = true;
    }
    for (const t of Array.isArray(rp.tags) ? rp.tags : []) if (t && t.tag) tagsOfOthers[t.tag] = true;
  }
  if (!Array.isArray(pack.steps) || pack.steps.length === 0) P.error('steps', 'steps', 'steps must be a non-empty list');
  if (pack.year_end_steps !== undefined && !Array.isArray(pack.year_end_steps)) P.error('year_end_steps', 'year_end_steps', 'year_end_steps must be a list');
  const seq = [];
  (Array.isArray(pack.steps) ? pack.steps : []).forEach((s, i) => seq.push({ s: s, at: 'steps[' + i + ']' }));
  (Array.isArray(pack.year_end_steps) ? pack.year_end_steps : []).forEach((s, i) => seq.push({ s: s, at: 'year_end_steps[' + i + ']' }));

  // Every var and code in order, so a formula may only read what an earlier step set.
  const varAt = Object.create(null);
  const codeAt = Object.create(null);
  const emittedTags = Object.create(null);
  seq.forEach((it, i) => {
    const s = it.s;
    if (!plainObject(s)) return;
    if (typeof s.var === 'string') { if (varAt[s.var] === undefined) varAt[s.var] = i; }
    if (typeof s.code === 'string') { if (codeAt[s.code] === undefined) codeAt[s.code] = i; }
    if (Array.isArray(s.tags)) for (const t of s.tags) if (typeof t === 'string') emittedTags[t] = true;
  });
  const unit = pack.currency ? 1 / Math.pow(10, E.exponentOf(pack.currency)) : 0;
  const seenVars = Object.create(null);
  const ctx = { fields: fieldsByScope, vars: Object.create(null) };
  const seenCodes = Object.create(null);

  seq.forEach((it, i) => {
    const s = it.s;
    const at = it.at;
    if (!plainObject(s)) { P.error('step', at, 'a step must be an object'); return; }
    const kinds = (s.var !== undefined ? 1 : 0) + (s.code !== undefined ? 1 : 0) + (s.check !== undefined ? 1 : 0);
    if (kinds !== 1) { P.error('step_kind', at, 'a step has exactly one of "var", "code" or "check"'); return; }
    const formulas = [];
    if (s.var !== undefined) {
      unknownKeys(s, VAR_KEYS, at, P);
      if (typeof s.var !== 'string' || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(s.var)) P.error('var_name', at, 'var name must be letters, digits and _ (starting with a letter or _)');
      else if (has(XP.ROOTS, s.var) || has(XP.FUNCTIONS, s.var) || s.var === 'true' || s.var === 'false') P.error('var_name', at, 'var name ' + s.var + ' is reserved');
      if (seenVars[s.var]) P.error('var_duplicate', at, 'var ' + s.var + ' is set twice (give the second one another name)');
      seenVars[s.var] = true;
      if (typeof s.expr !== 'string') P.error('var_expr', at, 'a var step needs "expr"');
      formulas.push(['expr', s.expr], ['when', s.when], ['else', s.else]);
      if (s.else !== undefined && s.when === undefined) P.warn('var_else', at, '"else" is only used with "when"');
    } else if (s.code !== undefined) {
      unknownKeys(s, LINE_KEYS, at, P);
      if (typeof s.code !== 'string' || !/^[A-Z][A-Z0-9_]*$/.test(s.code)) P.error('line_code', at, 'code must be UPPER_SNAKE_CASE, such as "US_FIT"');
      if (seenCodes[s.code]) P.error('code_duplicate', at, 'code ' + s.code + ' is emitted twice');
      seenCodes[s.code] = true;
      if (codesOfOthers[s.code]) P.error('code_duplicate', at, 'code ' + s.code + ' is also emitted by pack ' + codesOfOthers[s.code]);
      if (seedCodes[s.code]) P.error('code_duplicate', at, 'code ' + s.code + ' is also a seed component (input line)');
      if (typeof s.name !== 'string' || s.name.trim() === '') P.error('line_name', at, 'a line step needs a name people read on the payslip');
      if (E.constants.KINDS.indexOf(s.kind) < 0) P.error('line_kind', at, 'kind must be earning, deduction, employer, reimbursement or info');
      if (s.kind === 'deduction' && E.constants.DEDUCTION_STAGES.indexOf(s.stage) < 0) P.error('line_stage', at, 'a deduction needs stage pre, statutory or post');
      if (s.kind !== 'deduction' && s.stage !== undefined && s.stage !== '') P.warn('line_stage', at, 'stage only applies to deductions');
      if (typeof s.amount !== 'string') P.error('line_amount', at, 'a line step needs "amount"');
      if (s.tags !== undefined && !(Array.isArray(s.tags) && s.tags.every((t) => typeof t === 'string' && t !== ''))) P.error('line_tags', at, 'tags must be a list of text');
      if (s.keep_zero !== undefined && typeof s.keep_zero !== 'boolean') P.error('keep_zero', at, 'keep_zero must be true or false');
      for (const k of ['payee', 'filing', 'explain']) if (s[k] !== undefined && typeof s[k] !== 'string') P.error('line_text', at, k + ' must be text');
      formulas.push(['amount', s.amount], ['when', s.when], ['qty', s.qty], ['rate', s.rate], ['base', s.base]);
    } else {
      unknownKeys(s, CHECK_KEYS, at, P);
      if (typeof s.check !== 'string') P.error('check_expr', at, 'a check step needs "check" (a formula that must be true)');
      if (s.severity !== 'blocker' && s.severity !== 'warning') P.error('check_severity', at, 'severity must be blocker or warning');
      if (typeof s.issue !== 'string' || !/^[a-z][a-z0-9_]*$/.test(s.issue)) P.error('check_issue', at, 'issue must be a snake_case code, such as "w4_status_invalid"');
      if (typeof s.message !== 'string' || s.message.trim() === '') P.error('check_message', at, 'a check needs a message people read');
      formulas.push(['check', s.check], ['when', s.when]);
    }
    if (s.round !== undefined) {
      if (!plainObject(s.round) || !has(XP.MODES, s.round.mode) || !(isNum(s.round.step) && s.round.step > 0)) P.error('round', at + '.round', 'round needs { mode: half_up|half_even|half_down|up|down, step: a positive number }');
      else if (s.code !== undefined && unit > 0 && s.round.step < unit && Math.abs(s.round.step / unit - Math.round(s.round.step / unit)) > 1e-9) P.warn('round_fine', at + '.round', 'step ' + s.round.step + ' is finer than the ' + pack.currency + ' minor unit; the line is rounded again to ' + unit);
      if (s.check !== undefined) P.warn('round', at + '.round', 'round is ignored on a check step');
    }
    const trees = {};
    for (const f of formulas) {
      const src = f[1];
      if (src === undefined) continue;
      if (typeof src !== 'string') { P.error('formula', at + '.' + f[0], f[0] + ' must be a formula (text)'); continue; }
      let tree;
      try {
        tree = XP.parse(src);
      } catch (err) {
        P.error('syntax', at + '.' + f[0], err.message);
        continue;
      }
      checkTree(tree, at + '.' + f[0], i, s);
      if (s.var !== undefined && (f[0] === 'expr' || f[0] === 'else')) trees[f[0]] = tree;
    }
    if (s.var !== undefined && typeof s.var === 'string' && trees.expr) {
      let vals = possibleStrings(trees.expr, ctx);
      if (vals !== null && s.when !== undefined) vals = trees.else ? (possibleStrings(trees.else, ctx) === null ? null : unique(vals.concat(possibleStrings(trees.else, ctx)))) : vals;
      if (vals !== null && vals.length <= 500) ctx.vars[s.var] = vals;
    }
  });

  function checkTree(tree, path, i, step) {
    const refs = XP.refsOf(tree);
    for (const n of refs.names) {
      if (n.path.length === 1) {
        const v = n.path[0];
        if (varAt[v] === undefined) P.error('unknown_name', path, 'unknown name ' + v + ' (no step sets var ' + v + ')');
        else if (varAt[v] >= i) P.error('var_order', path, 'var ' + v + ' is used before it is set (step ' + (varAt[v] === i ? 'reads itself' : 'sets it later') + '); vars must come first');
        continue;
      }
      const root = n.path[0];
      const key = n.path[1];
      const C = E.constants;
      if (root === 'context') {
        if (C.CONTEXT_KEYS.indexOf(key) < 0) P.warn('context_key', path, 'context.' + key + ' is free data payroll may not fill; read it with coalesce(' + n.text + ', ...)');
        continue;
      }
      if (n.path.length !== 2) { P.error('unknown_name', path, 'unknown name ' + n.text); continue; }
      if (root === 'run' && C.RUN_INPUT_KEYS.indexOf(key) < 0 && C.RUN_DERIVED_KEYS.indexOf(key) < 0) P.error('unknown_name', path, 'unknown name ' + n.text + ' (run has ' + C.RUN_INPUT_KEYS.concat(C.RUN_DERIVED_KEYS).join(', ') + ')');
      if (root === 'employee' && C.EMPLOYEE_KEYS.indexOf(key) < 0) P.error('unknown_name', path, 'unknown name ' + n.text + ' (employee has ' + C.EMPLOYEE_KEYS.join(', ') + ')');
      if (root === 'employment' && C.EMPLOYMENT_KEYS.indexOf(key) < 0) P.error('unknown_name', path, 'unknown name ' + n.text + ' (employment has ' + C.EMPLOYMENT_KEYS.join(', ') + ')');
      if (root === 'currency' && C.CURRENCY_KEYS.indexOf(key) < 0) P.error('unknown_name', path, 'unknown name ' + n.text + ' (currency has code, exponent)');
      if (root === 'profile' || root === 'entity') {
        const other = root === 'profile' ? 'entity' : 'profile';
        if (fieldsByScope[root][key] === undefined) {
          if (fieldsByScope[other][key] !== undefined) P.error('field_scope', path, key + ' is ' + (other === 'entity' ? 'an entity' : 'an employee') + ' field; read it as ' + other + '.' + key);
          else P.error('unknown_name', path, 'unknown name ' + n.text + ' (declare it in profile_fields' + (root === 'entity' ? ' with scope: "entity"' : '') + ')');
        }
      }
    }
    for (const c of refs.calls) {
      const a0 = c.args[0];
      if (c.fn === 'table' || c.fn === 'band' || c.fn === 'map') {
        const want = c.fn === 'table' ? 'brackets' : c.fn === 'band' ? 'bands' : 'map';
        const names = possibleStrings(a0, ctx);
        if (names === null) { P.warn('table_dynamic', path, c.fn + '() table name cannot be listed ahead; every value it can take must be a table'); continue; }
        // A literal name, column or key that does not exist is an error. A value
        // listed from enum options, run.frequency or a var may be guarded by a
        // condition the checker cannot see, so it is a warning that says what
        // happens if that value arrives.
        const literal = (n) => n && n.t === 'str';
        const report = (isExact, code, msg) => {
          if (isExact) P.error(code, path, msg);
          else P.warn(code, path, msg + ' (a payslip where it takes this value stops with an error; add it, or guard it with a check step)');
        };
        for (const nm of names) {
          const t = tables[nm];
          if (t === undefined) { report(literal(a0), 'unknown_table', c.fn + '() reads table "' + nm + '", which the pack does not define'); continue; }
          if (t.type !== want) { report(literal(a0), 'table_type', c.fn + '() needs a ' + want + ' table; "' + nm + '" is ' + t.type); continue; }
          if (c.fn !== 'table' && c.args[2] !== undefined) {
            const cols = possibleStrings(c.args[2], ctx);
            if (cols !== null) for (const col of cols) if (!tableHasColumn(t, col)) report(literal(c.args[2]) && literal(a0), 'unknown_column', c.fn + '() reads column "' + col + '" that table "' + nm + '" does not have');
          }
          if (c.fn === 'map' && c.args[2] === undefined && mapHasColumns(t)) P.error('map_column', path, 'map table "' + nm + '" holds columns; give map() a column');
          if (c.fn === 'band' && c.args[2] === undefined && t.rows.some((r) => r.value === undefined)) P.error('band_column', path, 'band table "' + nm + '" holds columns; give band() a column');
          if (c.fn === 'map') {
            const keys = possibleStrings(c.args[1], ctx);
            if (keys !== null && !t.hasDefault) for (const k of keys) if (!has(t.rows, k)) report(literal(c.args[1]) && literal(a0), 'unknown_key', 'map() looks up key "' + k + '" that table "' + nm + '" does not have');
          }
        }
      } else if (c.fn === 'line' && a0 && a0.t === 'str') {
        const code = a0.v;
        if (codeAt[code] !== undefined) {
          if (codeAt[code] >= i) P.error('line_order', path, 'line("' + code + '") is computed later in this pack; move the step that emits it earlier');
        } else if (codesOfOthers[code] === undefined) {
          if (requires.length > 0 && !others) P.warn('line_other', path, 'line("' + code + '") is not in this pack; it is checked when the required packs are given');
          else P.error('line_unknown', path, 'line("' + code + '"): no step of this pack or its required packs emits ' + code + (seedCodes[code] ? ' (it is an input component: use sum_code)' : ''));
        }
      } else if ((c.fn === 'sum' || c.fn === 'ytd' || c.fn === 'ytd_since' || c.fn === 'prev_regular') && a0 && a0.t === 'str') {
        const tag = a0.v;
        if (!declaredTags[tag] && !emittedTags[tag] && !tagsOfOthers[tag]) P.warn('tag_unknown', path, c.fn + '("' + tag + '"): no step emits the tag and the pack does not list it in tags or seed_components');
      } else if (c.fn === 'total' && a0 && a0.t === 'str') {
        if (E.constants.TOTAL_GROUPS.indexOf(a0.v) < 0) P.error('total_group', path, 'total("' + a0.v + '"): use ' + E.constants.TOTAL_GROUPS.join(', '));
      }
    }
  }

  // ---- vectors
  if (pack.vectors !== undefined && !Array.isArray(pack.vectors)) P.error('vectors', 'vectors', 'vectors must be a list');
  const vectors = Array.isArray(pack.vectors) ? pack.vectors : [];
  if (pack.ship === 'active' && vectors.length === 0) P.error('vectors_none', 'vectors', 'an active pack needs at least one test vector');
  if (pack.ship === 'active' && pack.country !== '' && vectors.length > 0 && !vectors.some((v) => v && v.source === 'official')) P.warn('vectors_official', 'vectors', 'no vector comes from an official worked example');
  const vnames = Object.create(null);
  vectors.forEach((v, i) => {
    const at = 'vectors[' + i + ']';
    if (!plainObject(v)) { P.error('vector', at, 'a vector must be an object'); return; }
    unknownKeys(v, VECTOR_KEYS, at, P);
    if (typeof v.name !== 'string' || v.name === '') P.error('vector_name', at, 'a vector needs a name');
    else if (vnames[v.name]) P.error('vector_name', at, 'vector name "' + v.name + '" is used twice');
    vnames[v.name] = true;
    if (v.source !== 'official' && v.source !== 'derived') P.error('vector_source', at, 'source must be official (a published worked example) or derived (worked out by hand from the rules)');
    if (typeof v.reference !== 'string' || v.reference.trim() === '') P.error('vector_reference', at, 'reference must say where the expected figures come from');
    if (v.input !== undefined && !plainObject(v.input)) P.error('vector_input', at, 'input must be an object (a partial engine input)');
    const ex = v.expect;
    if (ex !== undefined && !plainObject(ex)) P.error('vector_expect', at, 'expect must be an object of { CODE: amount }');
    const any = (plainObject(ex) && Object.keys(ex).length > 0) || plainObject(v.expect_vars) || plainObject(v.expect_totals) || Array.isArray(v.expect_issues);
    if (!any) P.error('vector_expect', at, 'a vector needs expect, expect_vars, expect_totals or expect_issues');
    if (plainObject(ex)) {
      for (const k of Object.keys(ex)) {
        if (!isNum(ex[k])) P.error('vector_expect', at + '.expect.' + k, 'expected amount must be a number');
        if (codeAt[k] === undefined && codesOfOthers[k] === undefined && !inputCode(v, k)) P.warn('vector_code', at + '.expect.' + k, 'no step emits ' + k);
      }
    }
    if (v.expect_issues !== undefined && !(Array.isArray(v.expect_issues) && v.expect_issues.every((c) => typeof c === 'string'))) P.error('vector_issues', at, 'expect_issues must be a list of issue codes');
    if (v.packs !== undefined && !(Array.isArray(v.packs) && v.packs.every((c) => typeof c === 'string'))) P.error('vector_packs', at, 'packs must be a list of pack codes');
  });

  // ---- other declarations
  if (pack.min_wage !== undefined) {
    if (!plainObject(pack.min_wage)) P.error('min_wage', 'min_wage', 'min_wage must be { hourly, monthly, note }');
    else for (const k of ['hourly', 'monthly']) if (pack.min_wage[k] !== undefined && pack.min_wage[k] !== null && !isNum(pack.min_wage[k])) P.error('min_wage', 'min_wage.' + k, k + ' must be a number');
  }
  if (pack.filings !== undefined) {
    if (!Array.isArray(pack.filings)) P.error('filings', 'filings', 'filings must be a list');
    else pack.filings.forEach((f, i) => { if (!plainObject(f) || typeof f.code !== 'string' || typeof f.name !== 'string') P.error('filing', 'filings[' + i + ']', 'a filing needs { code, name, frequency, due_rule, form }'); });
  }
  if (pack.documents !== undefined) {
    if (!Array.isArray(pack.documents)) P.error('documents', 'documents', 'documents must be a list');
    else pack.documents.forEach((d, i) => { if (!plainObject(d) || typeof d.code !== 'string' || typeof d.name !== 'string') P.error('document', 'documents[' + i + ']', 'a document needs { code, name, year_end }'); });
  }
  return P.slice();
}

/** A pack is stored as JSON (rule_packs.body): functions, undefined in lists, NaN and Infinity would not survive. */
function jsonProblems(v, path, P, depth) {
  if (depth > 40) { P.error('not_json', path, 'nested deeper than 40 levels'); return; }
  if (typeof v === 'function') { P.error('not_json', path, 'a function cannot be stored; write a formula instead'); return; }
  if (typeof v === 'number' && !isNum(v)) { P.error('not_json', path, 'NaN and Infinity cannot be stored'); return; }
  if (v === null || typeof v !== 'object') return;
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) {
      if (v[i] === undefined) P.error('not_json', path + '[' + i + ']', 'undefined in a list cannot be stored');
      else jsonProblems(v[i], path + '[' + i + ']', P, depth + 1);
    }
    return;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) { P.error('not_json', path, 'only plain objects, lists, text, numbers, true/false and null can be stored'); return; }
  for (const k of Object.keys(v)) jsonProblems(v[k], path + '.' + k, P, depth + 1);
}

function unique(list) {
  const seen = Object.create(null);
  const out = [];
  for (const v of list) if (!seen[v]) { seen[v] = true; out.push(v); }
  return out;
}

function inputCode(vector, code) {
  const lines = vector && vector.input && Array.isArray(vector.input.lines) ? vector.input.lines : [];
  return lines.some((l) => l && l.code === code);
}

function tableHasColumn(t, col) {
  if (t.type === 'bands') return t.rows.some((r) => r.values && has(r.values, col));
  if (t.type === 'map') {
    const vals = Object.keys(t.rows).map((k) => t.rows[k]);
    if (t.hasDefault) vals.push(t.def);
    return vals.some((v) => plainObject(v) && has(v, col));
  }
  return false;
}

function mapHasColumns(t) {
  const keys = Object.keys(t.rows);
  return keys.length > 0 && keys.every((k) => plainObject(t.rows[k]));
}

function defaultFits(f) {
  const d = f.default;
  if (f.type === 'number' || f.type === 'money') return isNum(d);
  if (f.type === 'boolean') return typeof d === 'boolean';
  if (f.type === 'date') return expr().isDay(d);
  if (f.type === 'enum') return Array.isArray(f.options) && f.options.some((o) => o && String(o.value) === String(d));
  return typeof d === 'string';
}

/**
 * Run every vector of a pack. Each vector's input is completed with the
 * engine's defaults (completeInput), run with the pack plus the packs it
 * requires (picked by version for the vector's run) and any vector.packs,
 * and compared: expect (line codes, exact to the currency unit),
 * expect_vars (this pack's vars), expect_totals, expect_issues (codes that
 * must appear). A blocker nobody expected fails the vector.
 */
function runVectors(pack, others) {
  const E = engine();
  const vectors = pack && Array.isArray(pack.vectors) ? pack.vectors : [];
  const failures = [];
  let passed = 0;
  for (let i = 0; i < vectors.length; i++) {
    const v = vectors[i] || {};
    const problems = [];
    let out = null;
    try {
      const input = E.completeInput(v.input || {}, pack);
      const wanted = requiredCodes(pack, others, v);
      const candidates = (others || []).filter((o) => o && wanted.indexOf(o.code) >= 0 && o !== pack);
      const chosen = E.pickVersions(candidates, input.run);
      for (const c of wanted) if (!chosen.some((p) => p.code === c)) problems.push({ what: 'pack', code: c, message: 'pack ' + c + ' is not available for ' + input.run.pay_date });
      const packs = [pack].concat(chosen);
      out = E.calculate(input, packs);
      const unit = 1 / Math.pow(10, input.currency.exponent);
      const tol = unit / 1000;
      const expectIssues = Array.isArray(v.expect_issues) ? v.expect_issues : [];
      for (const iss of out.issues) {
        if (iss.severity === 'blocker' && expectIssues.indexOf(iss.code) < 0) problems.push({ what: 'blocker', code: iss.code, message: iss.message });
      }
      for (const c of expectIssues) if (!out.issues.some((iss) => iss.code === c)) problems.push({ what: 'issue', code: c, message: 'expected issue ' + c + ' did not appear' });
      if (v.expect && typeof v.expect === 'object') {
        for (const code of Object.keys(v.expect)) {
          const want = v.expect[code];
          let got = 0;
          for (const l of out.lines) if (l.code === code) got += l.amount;
          got = expr().snap(got);
          if (!(Math.abs(got - want) <= tol)) problems.push({ what: 'line', code: code, expected: want, actual: got });
        }
      }
      if (v.expect_vars && typeof v.expect_vars === 'object') {
        const vars = out.vars[pack.code] || {};
        for (const name of Object.keys(v.expect_vars)) {
          const want = v.expect_vars[name];
          const got = vars[name] === undefined ? null : vars[name];
          const same = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) <= 1e-9 * Math.max(1, Math.abs(want)) : got === want;
          if (!same) problems.push({ what: 'var', code: name, expected: want, actual: got });
        }
      }
      if (v.expect_totals && typeof v.expect_totals === 'object') {
        for (const k of Object.keys(v.expect_totals)) {
          const want = v.expect_totals[k];
          const got = out.totals[k];
          if (!(typeof got === 'number' && Math.abs(got - want) <= tol)) problems.push({ what: 'total', code: k, expected: want, actual: got === undefined ? null : got });
        }
      }
    } catch (err) {
      problems.push({ what: 'crash', message: err && err.message ? err.message : String(err) });
    }
    if (problems.length === 0) passed++;
    else failures.push({ index: i, name: v.name || '(unnamed)', problems: problems, issues: out ? out.issues : [], lines: out ? out.lines.map((l) => ({ code: l.code, amount: l.amount })) : [] });
  }
  return { passed: passed, total: vectors.length, failures: failures };
}

function requiredCodes(pack, others, vector) {
  const codes = [];
  const byCode = Object.create(null);
  for (const o of others || []) if (o && typeof o.code === 'string') (byCode[o.code] = byCode[o.code] || []).push(o);
  (function walk(list) {
    for (const c of list) {
      if (codes.indexOf(c) >= 0 || c === pack.code) continue;
      codes.push(c);
      const vs = byCode[c] || [];
      for (const p of vs) walk(Array.isArray(p.requires) ? p.requires : []);
    }
  })((Array.isArray(pack.requires) ? pack.requires : []).concat(vector && Array.isArray(vector.packs) ? vector.packs : []));
  return codes;
}

/** Checks across a set of packs: duplicate code and version, overlapping versions, missing requires. */
function checkSet(packs) {
  const P = makeList();
  const byCode = Object.create(null);
  for (const p of packs) {
    if (!p || typeof p.code !== 'string') continue;
    (byCode[p.code] = byCode[p.code] || []).push(p);
  }
  for (const code of Object.keys(byCode)) {
    const list = byCode[code].slice().sort((a, b) => (String(a.effective_from) < String(b.effective_from) ? -1 : 1));
    const versions = Object.create(null);
    for (const p of list) {
      if (versions[p.version]) P.error('version_duplicate', code, 'pack ' + code + ' version ' + p.version + ' appears twice');
      versions[p.version] = true;
    }
    for (let i = 1; i < list.length; i++) {
      const a = list[i - 1];
      const b = list[i];
      if (!a.effective_to || a.effective_to >= b.effective_from) P.error('version_overlap', code, 'pack ' + code + ' versions ' + a.version + ' and ' + b.version + ' overlap (' + a.version + ' must end before ' + b.effective_from + ')');
    }
  }
  for (const p of packs) {
    for (const c of Array.isArray(p.requires) ? p.requires : []) if (!byCode[c]) P.error('requires_missing', p.code, 'pack ' + p.code + ' requires ' + c + ', which is not in the set');
  }
  return P.slice();
}

module.exports = { validate: validate, runVectors: runVectors, checkSet: checkSet, requiredPacks: requiredPacks };
