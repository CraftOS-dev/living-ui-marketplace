/// <reference path="../pb_data/types.d.ts" />
/**
 * Comparison grids (SPEC 7.8, Hebbia's matrix): companies as rows,
 * questions as columns, each cell an answer with its citations.
 *
 * A row is a company, with its deal when it has a deal room. A column is a
 * question by key (a checklist question such as traction_arr, or a custom
 * one). The cell of a row with a room is that deal's answer to the
 * question; the cell of a company without a room is an answer stored on the
 * grid itself (dd_answers with grid, company, col_key), from public sources.
 * Filling a grid adds the missing column questions to each room and asks
 * your AI agent (trigger diligence_answers on each deal with a room, and
 * grid_answers { grid_id } once for the companies without a room).
 */

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}
function DD() {
  return L('lib_diligence');
}

const MAX_ROWS = 50;
const MAX_COLS = 20;
const DEFAULT_COLUMNS = ['traction_arr', 'traction_growth', 'traction_customers', 'fin_burn', 'fin_runway', 'fin_raise', 'fin_valuation', 'team_size'];
const ORIGINS = ['deals', 'markets', 'manual'];

function gridRef(app, id) {
  const util = u();
  const g = util.byId(app, 'compare_grids', String(id || '').trim());
  if (g === null || g.getString('deleted_at') !== '') throw util.fail(404, 'No grid ' + id + '. Run compare.list.', 'not_found');
  return g;
}

function rowsOf(g) {
  return u().jsonOf(g, 'rows', []) || [];
}

function columnsOf(g) {
  return u().jsonOf(g, 'columns', []) || [];
}

/** A checklist question by key, from the first checklist that has it. */
function templateColumn(app, key) {
  const util = u();
  for (const t of DD().arr(util.findMany(app, 'dd_templates', '1=1', 'sort,created'))) {
    const areas = util.jsonOf(t, 'areas', []) || [];
    const q = (util.jsonOf(t, 'questions', []) || []).filter((x) => x.key === key)[0];
    if (q) {
      const a = areas.filter((x) => x.key === q.area)[0];
      return { key: q.key, text: q.text, type: q.type, unit: q.unit || '', area: q.area, area_label: a ? a.label : q.area };
    }
  }
  return null;
}

function cleanColumns(app, raw) {
  const util = u();
  if (!Array.isArray(raw) || raw.length === 0) throw util.fail(400, 'columns is a JSON list of checklist keys (["traction_arr"]) or {"text","type","unit"}.', 'invalid_param', { param: 'columns' });
  if (raw.length > MAX_COLS) throw util.fail(400, 'At most ' + MAX_COLS + ' columns.', 'too_many');
  const seen = {};
  const out = [];
  raw.forEach((c, i) => {
    const where = 'Column ' + (i + 1);
    let col = null;
    if (typeof c === 'string') {
      col = templateColumn(app, c.trim());
      if (col === null) throw util.fail(400, where + ': no checklist question "' + c + '" (dd.templates --full lists the keys).', 'invalid_param', { param: 'columns' });
    } else if (c && typeof c === 'object') {
      util.keysOnly(c, ['key', 'text', 'type', 'unit'], where);
      if (c.key && !c.text) {
        col = templateColumn(app, String(c.key));
        if (col === null) throw util.fail(400, where + ': no checklist question "' + c.key + '".', 'invalid_param', { param: 'columns' });
      } else {
        const text = util.squash(c.text);
        if (text === '' || text.length > 300) throw util.fail(400, where + ' needs text (at most 300 characters).', 'invalid_param', { param: 'columns' });
        const type = String(c.type || 'text');
        if (DD().TYPES.indexOf(type) < 0) throw util.fail(400, where + ': type is one of ' + DD().TYPES.join(', ') + '.', 'invalid_param', { param: 'columns' });
        let unit = type === 'number' ? util.squash(c.unit) : '';
        if (unit !== '' && unit !== 'money' && unit !== '%' && !/^[A-Za-z][A-Za-z ]{0,19}$/.test(unit)) throw util.fail(400, where + ': unit is money, % or one word.', 'invalid_param', { param: 'columns' });
        if (unit !== 'money' && unit !== '%') unit = unit.toLowerCase();
        col = { key: c.key ? DD().slug(c.key) : 'c_' + DD().slug(text).slice(0, 36), text: text, type: type, unit: unit, area: 'other', area_label: 'Other' };
      }
    } else throw util.fail(400, where + ' is a checklist key or an object.', 'invalid_param', { param: 'columns' });
    if (seen[col.key]) return;
    seen[col.key] = true;
    out.push(col);
  });
  return out;
}

/** The company's deal room for a grid row: its most recent visible deal (open, held or invested first). */
function companyDeal(ctx, companyId) {
  const util = u();
  const list = DD().arr(util.findMany(ctx.app, 'deals', "company = {:c} && deleted_at = ''", '-created', 20, { c: companyId }));
  const rank = { open: 0, hold: 0, invested: 0, passed: 1, lost: 1 };
  const vis = list.filter((d) => L('lib_deals').visible(ctx, d));
  vis.sort((a, b) => (rank[a.getString('status')] || 0) - (rank[b.getString('status')] || 0));
  return vis.length > 0 ? vis[0] : null;
}

function rowsFrom(ctx, p, prev) {
  const util = u();
  const app = ctx.app;
  const deals = util.list(p, 'deals');
  const companies = util.list(p, 'companies');
  if (deals === undefined && companies === undefined) return prev;
  const out = [];
  const seen = {};
  (deals || []).forEach((ref) => {
    const d = L('lib_deals').ref(app, String(ref));
    L('lib_deals').guard(ctx, d);
    const c = d.getString('company');
    if (seen[c]) return;
    seen[c] = true;
    out.push({ company: c, deal: d.id });
  });
  (companies || []).forEach((ref) => {
    const c = L('lib_records').resolve(app, 'companies', String(ref));
    if (seen[c.id]) return;
    seen[c.id] = true;
    const d = companyDeal(ctx, c.id);
    out.push({ company: c.id, deal: d !== null ? d.id : '' });
  });
  if (out.length === 0) throw util.fail(400, 'A grid needs at least one company (--deals or --companies).', 'missing_param', { param: 'deals' });
  if (out.length > MAX_ROWS) throw util.fail(400, 'At most ' + MAX_ROWS + ' companies in a grid.', 'too_many');
  return out;
}

function cellOut(ctx, a, rights) {
  if (!a) return null;
  const v = DD().answerOut(ctx, a, rights, '');
  return { id: v.id, status: v.status, value: v.value, unit: v.unit, grade: v.grade, high: v.high, num_kind: v.num_kind, formula: v.formula, raw: v.raw, type: v.type, cites: v.cites, sources: v.sources, note: v.note };
}

/** The grid with its cells for ctx (rows of deals ctx may not see are left out and counted in hidden). */
function gridOut(ctx, g) {
  const util = u();
  const app = ctx.app;
  const cols = columnsOf(g);
  const rights = {};
  let hidden = 0;
  let missing = 0;
  const asks = [];
  const rows = [];
  rowsOf(g).forEach((r) => {
    const company = L('lib_records').mini(app, 'companies', r.company);
    if (company === null) return;
    let d = r.deal ? util.byId(app, 'deals', r.deal) : null;
    if (d !== null && (d.getString('deleted_at') !== '' || !L('lib_deals').visible(ctx, d))) {
      if (d.getString('deleted_at') === '') {
        hidden++;
        return;
      }
      d = null;
    }
    const cells = [];
    if (d !== null) {
      const byKey = {};
      DD()
        .questionsOf(app, d.id, false)
        .forEach((q) => {
          if (q.getString('key') !== '') byKey[q.getString('key')] = q;
        });
      cols.forEach((c) => {
        const q = byKey[c.key];
        const a = q && q.getString('answer') !== '' ? util.byId(app, 'dd_answers', q.getString('answer')) : null;
        if (a === null) missing++;
        cells.push(a !== null ? Object.assign(cellOut(ctx, a, rights), { question: q.id }) : q ? { question: q.id, empty: true } : null);
      });
      const js = DD().askState(app, d, 'diligence_answers', DD().STEPS);
      if (js !== null && js.open) asks.push(js);
      rows.push({ company: company, deal: DD().dealMini(app, d), cells: cells });
    } else {
      const live = DD().arr(util.findMany(app, 'dd_answers', "grid = {:g} && company = {:c} && (status = 'agent_proposed' || status = 'confirmed')", '-created', 0, { g: g.id, c: r.company }));
      cols.forEach((c) => {
        const mine = live.filter((a) => a.getString('col_key') === c.key);
        const a = mine.filter((x) => x.getString('status') === 'confirmed')[0] || mine[0] || null;
        if (a === null) missing++;
        cells.push(cellOut(ctx, a, rights));
      });
      rows.push({ company: company, deal: null, cells: cells });
    }
  });
  const gj = DD().askState(app, g, 'grid_answers', DD().STEPS);
  if (gj !== null && gj.open) asks.push(gj);
  return {
    id: g.id,
    name: g.getString('name'),
    origin: g.getString('origin'),
    market_ref: g.getString('market_ref'),
    columns: cols,
    rows: rows,
    hidden: hidden,
    missing: missing,
    asks: asks,
    working: asks.length > 0,
    step: asks.length > 0 ? asks.reduce((a, b) => (a.at <= b.at ? a : b)) : gj,
    member: L('lib_records').mini(app, 'members', g.getString('member')),
    updated: g.getString('updated'),
    empty_cells: ctx.isAgent ? emptyCells(app, g) : undefined,
  };
}

/**
 * Add missing column questions to each room and ask your AI agent for every
 * empty cell (a person's Save or Fill asks): diligence_answers for each deal
 * with a room, grid_answers for the companies without one. Answers the
 * request ids.
 */
function fill(ctx, g) {
  const util = u();
  const app = ctx.app;
  const A = L('lib_agent');
  const cols = columnsOf(g);
  const asks = [];
  let added = 0;
  const cells = [];
  rowsOf(g).forEach((r) => {
    const d = r.deal ? util.byId(app, 'deals', r.deal) : null;
    if (d !== null && d.getString('deleted_at') === '') {
      if (!L('lib_deals').visible(ctx, d)) return;
      const have = {};
      DD()
        .questionsOf(app, d.id, true)
        .forEach((q) => {
          if (q.getString('key') !== '') have[q.getString('key')] = q;
        });
      cols.forEach((c) => {
        const q = have[c.key];
        if (q && q.getString('deleted_at') === '') return;
        if (q) {
          q.set('deleted_at', '');
          app.save(q);
          added++;
          return;
        }
        const area = c.area || 'other';
        const n = util.newRecord(app, 'dd_questions');
        n.set('deal', d.id);
        n.set('key', c.key);
        n.set('template', '');
        n.set('area', area);
        n.set('area_label', c.area_label || 'Other');
        n.set('text', c.text);
        n.set('type', c.type);
        n.set('unit', c.unit || '');
        n.set('sort', DD().nextSort(app, d.id, area));
        n.set('source', 'grid');
        n.set('state', 'open');
        n.set('run', ctx.run || '');
        DD().stamp(ctx, n);
        app.save(n);
        added++;
      });
      if (ctx.dryRun || ctx.isAgent || d.getBool('restricted') && !d.getBool('agent_allowed')) return;
      const id = A.ask(app, 'diligence_answers', app.findRecordById('deals', d.id), {}, { by: ctx.memberId || '' });
      if (id !== '') asks.push(id);
      return;
    }
    const live = DD().arr(util.findMany(app, 'dd_answers', "grid = {:g} && company = {:c} && (status = 'agent_proposed' || status = 'confirmed')", '', 0, { g: g.id, c: r.company }));
    const company = util.byId(app, 'companies', r.company);
    if (company === null) return;
    cols.forEach((c) => {
      if (live.some((a) => a.getString('col_key') === c.key)) return;
      cells.push({ company: r.company, company_name: company.getString('name'), domain: company.getString('domain'), column: c.key, text: c.text, type: c.type, unit: c.unit || '' });
    });
  });
  if (cells.length > 0 && !ctx.dryRun && !ctx.isAgent) {
    const id = A.ask(app, 'grid_answers', app.findRecordById('compare_grids', g.id), {}, { by: ctx.memberId || '' });
    if (id !== '') asks.push(id);
  }
  return { requests: asks, added_questions: added, cells: cells.length };
}

/** compare.list: the firm's grids, newest first; --market_ref (one id or a JSON list) keeps the grids made from those maps or theses, --origin one origin. */
function opList(ctx, p) {
  const util = u();
  const pg = util.page(p, 50, 200);
  const where = ["deleted_at = ''"];
  const bind = {};
  const raw = util.str(p, 'market_ref', '');
  if (raw !== '') {
    const refs = (raw.charAt(0) === '[' ? util.list(p, 'market_ref') : [raw]).map((x) => String(x || '').trim()).filter((x) => x !== '');
    if (refs.length > 100) throw util.fail(400, 'At most 100 market_ref values.', 'too_many', { param: 'market_ref' });
    if (refs.length === 0) return { grids: [] };
    where.push('(' + refs.map((x, i) => ((bind['m' + i] = x), 'market_ref = {:m' + i + '}')).join(' || ') + ')');
  }
  const origin = util.oneOf(p, 'origin', ORIGINS, '');
  if (origin !== '') {
    where.push('origin = {:o}');
    bind.o = origin;
  }
  const rows = ctx.app.findRecordsByFilter('compare_grids', where.join(' && '), '-updated', pg.limit, pg.offset, bind);
  return { grids: DD().arr(rows).map((g) => ({ id: g.id, name: g.getString('name'), origin: g.getString('origin'), market_ref: g.getString('market_ref'), rows: rowsOf(g).length, columns: columnsOf(g).length, member: L('lib_records').mini(ctx.app, 'members', g.getString('member')), updated: g.getString('updated') })) };
}

/** compare.get: a grid with its cells. */
function opGet(ctx, p) {
  const util = u();
  return { grid: gridOut(ctx, gridRef(ctx.app, util.req(p, 'grid'))) };
}

/** compare.save: create or change a grid; empty cells are asked of your AI agent (unless --fill false). */
function opSave(ctx, p) {
  const util = u();
  const app = ctx.app;
  const id = util.str(p, 'grid', '');
  const g = id !== '' ? gridRef(app, id) : util.newRecord(app, 'compare_grids');
  const prevRows = id !== '' ? rowsOf(g) : null;
  const rows = rowsFrom(ctx, p, prevRows);
  if (rows === null) throw util.fail(400, 'A new grid needs companies: --deals \'["D-0001","D-0002"]\' or --companies \'[...]\'.', 'missing_param', { param: 'deals' });
  const rawCols = util.list(p, 'columns');
  const cols = rawCols !== undefined ? cleanColumns(app, rawCols) : id !== '' ? columnsOf(g) : cleanColumns(app, DEFAULT_COLUMNS);
  let name = util.text(p, 'name', 120, '');
  if (name === '' && id === '') {
    const names = rows.slice(0, 3).map((r) => {
      const c = util.byId(app, 'companies', r.company);
      return c !== null ? c.getString('name') : '';
    });
    name = names.join(', ') + (rows.length > 3 ? ' and ' + (rows.length - 3) + ' more' : '');
  }
  if (name !== '') g.set('name', name);
  g.set('rows', rows);
  g.set('columns', cols);
  if (id === '') {
    g.set('origin', util.oneOf(p, 'origin', ORIGINS, 'deals'));
    g.set('market_ref', util.text(p, 'market_ref', 40, ''));
    g.set('deleted_at', '');
    DD().stamp(ctx, g);
  } else {
    if (util.str(p, 'origin', '') !== '') g.set('origin', util.oneOf(p, 'origin', ORIGINS, 'deals'));
    if (util.has(p, 'market_ref')) g.set('market_ref', util.text(p, 'market_ref', 40, ''));
  }
  g.set('run', ctx.run || '');
  app.save(g);
  const f = util.bool(p, 'fill', true) ? fill(ctx, g) : { requests: [], added_questions: 0, cells: 0 };
  L('lib_audit').note(ctx, { collection: 'compare_grids', record: g.id, summary: (id === '' ? 'Made the grid ' : 'Changed the grid ') + g.getString('name') + ' (' + rows.length + ' companies, ' + cols.length + ' questions)' });
  return { grid: gridOut(ctx, g), filled: f };
}

/** compare.fill: ask your AI agent for every empty cell now. */
function opFill(ctx, p) {
  const util = u();
  const g = gridRef(ctx.app, util.req(p, 'grid'));
  const f = fill(ctx, g);
  L('lib_audit').note(ctx, { collection: 'compare_grids', record: g.id, summary: 'Asked your AI agent to fill the grid ' + g.getString('name') });
  return { grid: gridOut(ctx, g), filled: f };
}

/** compare.delete: move a grid to the trash (Undo brings it back). */
function opDelete(ctx, p) {
  const util = u();
  const g = gridRef(ctx.app, util.req(p, 'grid'));
  g.set('deleted_at', util.nowIso());
  ctx.app.save(g);
  L('lib_audit').note(ctx, { collection: 'compare_grids', record: g.id, summary: 'Deleted the grid ' + g.getString('name') });
  return { deleted: g.id };
}

/** Ctrl-K: grids by name (for people who may see grids). */
function search(ctx, q, limit) {
  const util = u();
  const auth = L('lib_auth');
  if (!auth.can(ctx, 'diligence', 'view') && !auth.can(ctx, 'markets', 'view')) return [];
  const t = util.squash(q);
  if (t.length < 2) return [];
  return util
    .rows(ctx.app, "SELECT id, name FROM compare_grids WHERE deleted_at = '' AND name LIKE {:q} ESCAPE '\\' ORDER BY updated DESC LIMIT {:n}", { id: '', name: '' }, { q: util.like(t), n: Math.max(1, Math.min(20, Number(limit) || 5)) })
    .map((r) => ({ kind: 'grid', id: r.id, title: r.name, subtitle: 'Grid', href: '#/compare/' + r.id, icon: 'Grid3x3' }));
}

/** The cells of a grid's companies without a room, for your AI agent: [{ company, company_name, domain, column, text, type, unit }]. */
function emptyCells(app, g) {
  const util = u();
  const cols = columnsOf(g);
  const cells = [];
  rowsOf(g).forEach((r) => {
    const d = r.deal ? util.byId(app, 'deals', r.deal) : null;
    if (d !== null && d.getString('deleted_at') === '') return;
    const company = util.byId(app, 'companies', r.company);
    if (company === null) return;
    const live = DD().arr(util.findMany(app, 'dd_answers', "grid = {:g} && company = {:c} && (status = 'agent_proposed' || status = 'confirmed')", '', 0, { g: g.id, c: r.company }));
    cols.forEach((c) => {
      if (live.some((a) => a.getString('col_key') === c.key)) return;
      cells.push({ company: r.company, company_name: company.getString('name'), domain: company.getString('domain'), column: c.key, text: c.text, type: c.type, unit: c.unit || '' });
    });
  });
  return cells;
}

/** agent.ask --trigger grid_answers --record <grid>: a grid with empty cells of companies without a room. */
function askCheck(ctx, g) {
  if (g.getString('deleted_at') !== '') throw u().fail(404, 'No grid ' + g.id + '.', 'not_found');
  if (emptyCells(ctx.app, g).length === 0) throw u().fail(409, 'Every cell of the companies without a room has an answer.', 'nothing_open');
  return {};
}

module.exports = { emptyCells: emptyCells, askCheck: askCheck, search: search, DEFAULT_COLUMNS: DEFAULT_COLUMNS, gridRef: gridRef, rowsOf: rowsOf, columnsOf: columnsOf, templateColumn: templateColumn, cleanColumns: cleanColumns, gridOut: gridOut, fill: fill, opList: opList, opGet: opGet, opSave: opSave, opFill: opFill, opDelete: opDelete };
