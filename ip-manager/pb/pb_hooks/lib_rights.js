/// <reference path="../pb_data/types.d.ts" />
/**
 * Rights availability and conflict checks.
 *
 * A grant is a slice of rights on some assets (properties, works, matters),
 * for dimension values (territory, media, language, channel, category,
 * field of use), over a term. Direction "in" = rights we acquired,
 * "out" = rights we granted to someone else. Kind "holdback" and
 * "restriction" block us; "reservation" on an in-agreement carves rights
 * the licensor kept.
 *
 * Availability for (asset, cell, window):
 *   rights in  = owned outright (rights_basis=owned on the asset or an
 *                ancestor) or covered by in-grants
 *   blocked    = out-grants that conflict (exclusive, or any out-grant when
 *                an exclusive licence is being considered), holdbacks,
 *                restrictions, reservations
 *   available  = rights in minus blocked covers the whole window
 *   partial    = some of the window is free
 *   unavailable / no_rights otherwise
 * Every non-available cell carries reasons that name the agreement.
 * Dimension values are hierarchical: a grant for "Europe" covers France;
 * excluding France from "Worldwide" leaves France uncovered.
 */

const FAR_PAST = '1900-01-01';
const FAR_FUTURE = '9999-12-31';

function dimTree(app) {
  const u = require(`${__hooks}/lib_util.js`);
  const trees = {};
  const rows = u.findMany(app, 'dimension_values', '', 'order', 0);
  for (const r of rows) {
    const d = r.getString('dimension');
    if (!trees[d]) trees[d] = {};
    trees[d][r.getString('code')] = { parent: r.getString('parent_code'), label: r.getString('label') };
  }
  return trees;
}

function ancestors(tree, code) {
  const out = [];
  let c = code;
  const seen = {};
  while (c && tree && tree[c] && !seen[c]) {
    seen[c] = true;
    out.push(c);
    c = tree[c].parent;
  }
  if (out.length === 0 && code) out.push(code);
  return out;
}

function isDescendant(tree, code, ancestor) {
  return ancestors(tree, code).indexOf(ancestor) >= 0;
}

/**
 * How a grant's dimension spec covers one value: 'full' | 'partial' | 'none'.
 * spec: { include: [codes], exclude: [codes] } or undefined (= everything).
 */
function coverage(tree, spec, code) {
  if (!code) return 'full';
  const include = spec && Array.isArray(spec.include) ? spec.include : [];
  const exclude = spec && Array.isArray(spec.exclude) ? spec.exclude : [];
  const anc = ancestors(tree, code);
  let included = include.length === 0;
  if (!included) for (const i of include) if (anc.indexOf(i) >= 0) included = true;
  if (!included) {
    // The grant may cover part of a broader value (grant France, ask Europe).
    for (const i of include) if (isDescendant(tree, i, code)) return 'partial';
    return 'none';
  }
  for (const x of exclude) if (anc.indexOf(x) >= 0) return 'none';
  for (const x of exclude) if (isDescendant(tree, x, code)) return 'partial';
  return 'full';
}

function labelOf(trees, dim, code) {
  return trees[dim] && trees[dim][code] ? trees[dim][code].label : code;
}

function specLabel(trees, dim, spec) {
  if (!spec || !Array.isArray(spec.include) || spec.include.length === 0) {
    const ex = spec && Array.isArray(spec.exclude) ? spec.exclude : [];
    return ex.length ? 'All excl. ' + ex.map((c) => labelOf(trees, dim, c)).join(', ') : 'All';
  }
  let s = spec.include.map((c) => labelOf(trees, dim, c)).join(', ');
  if (Array.isArray(spec.exclude) && spec.exclude.length) s += ' excl. ' + spec.exclude.map((c) => labelOf(trees, dim, c)).join(', ');
  return s;
}

/* ------------------------------------------------------------------ */
/* Assets and lineage                                                  */
/* ------------------------------------------------------------------ */

/** Keys for an asset and everything above it: work -> parent works -> property -> parent properties. */
function lineage(app, type, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const keys = [];
  let owned = false;
  let ownedBy = '';
  const seen = {};
  function addProperty(pid) {
    let cur = pid;
    while (cur && !seen['property:' + cur]) {
      seen['property:' + cur] = true;
      keys.push('property:' + cur);
      const p = u.byId(app, 'properties', cur);
      if (p === null) break;
      if (!owned && p.getString('rights_basis') === 'owned') {
        owned = true;
        ownedBy = p.getString('name');
      }
      cur = p.getString('parent');
    }
  }
  if (type === 'work') {
    let cur = id;
    let lastProperty = '';
    while (cur && !seen['work:' + cur]) {
      seen['work:' + cur] = true;
      keys.push('work:' + cur);
      const w = u.byId(app, 'works', cur);
      if (w === null) break;
      if (!owned && w.getString('rights_basis') === 'owned') {
        owned = true;
        ownedBy = w.getString('title');
      }
      if (w.getString('rights_basis') === 'acquired' && !owned) {
        // An explicitly acquired work does not inherit ownership from its property.
        lastProperty = '';
        const pid = w.getString('property');
        if (pid) keys.push('property:' + pid);
        cur = w.getString('parent');
        continue;
      }
      if (w.getString('property')) lastProperty = w.getString('property');
      cur = w.getString('parent');
    }
    if (lastProperty) addProperty(lastProperty);
  } else if (type === 'property') {
    addProperty(id);
  } else if (type === 'matter') {
    keys.push('matter:' + id);
    const m = u.byId(app, 'matters', id);
    if (m !== null) {
      owned = true;
      ownedBy = m.getString('ref') || m.getString('title');
      if (m.getString('work')) keys.push('work:' + m.getString('work'));
      if (m.getString('property')) addProperty(m.getString('property'));
    }
  }
  return { keys: keys, owned: owned, ownedBy: ownedBy };
}

function assetLabel(app, type, id) {
  const u = require(`${__hooks}/lib_util.js`);
  const coll = type === 'work' ? 'works' : type === 'property' ? 'properties' : 'matters';
  const r = u.byId(app, coll, id);
  if (r === null) return 'Unknown';
  return type === 'work' ? r.getString('title') : type === 'property' ? r.getString('name') : r.getString('ref') + ' ' + r.getString('title');
}

function grantAssets(g) {
  const keys = [];
  for (const id of g.getStringSlice('properties')) keys.push('property:' + id);
  for (const id of g.getStringSlice('works')) keys.push('work:' + id);
  for (const id of g.getStringSlice('matters')) keys.push('matter:' + id);
  return keys;
}

/** All grants with their agreement context, active agreements only. */
function loadGrants(app, excludeAgreementId) {
  const u = require(`${__hooks}/lib_util.js`);
  const rows = u.findMany(app, 'grants', '', '', 0);
  const agreements = {};
  const out = [];
  for (const g of rows) {
    const aid = g.getString('agreement');
    if (excludeAgreementId && aid === excludeAgreementId) continue;
    if (!agreements[aid]) agreements[aid] = u.byId(app, 'agreements', aid);
    const a = agreements[aid];
    if (a === null) continue;
    const st = a.getString('status');
    if (st === 'terminated' || st === 'superseded' || st === 'draft') continue;
    out.push(grantObj(app, g, a));
  }
  return out;
}

function grantObj(app, g, a) {
  const u = require(`${__hooks}/lib_util.js`);
  const cp = a && a.getString('counterparty') ? u.byId(app, 'parties', a.getString('counterparty')) : null;
  const start = u.d10(g.getString('term_start')) || (a ? u.d10(a.getString('term_start')) || u.d10(a.getString('effective_date')) : '') || FAR_PAST;
  let end = u.d10(g.getString('term_end')) || (a && !a.getBool('perpetual') ? u.d10(a.getString('term_end')) : '') || FAR_FUTURE;
  if (a && a.getString('status') === 'expired' && end === FAR_FUTURE) end = u.d10(a.getString('term_end')) || FAR_PAST;
  return {
    id: g.id || '',
    agreement_id: a ? a.id : '',
    agreement_ref: a ? a.getString('ref') : '',
    agreement_title: a ? a.getString('title') : '',
    counterparty: cp ? cp.getString('name') : '',
    direction: g.getString('direction'),
    kind: g.getString('kind'),
    exclusive: g.getBool('exclusive'),
    assets: grantAssets(g),
    dims: u.j(g, 'dims', {}),
    start: start,
    end: end,
  };
}

/* ------------------------------------------------------------------ */
/* Intervals                                                           */
/* ------------------------------------------------------------------ */

function clip(iv, a, b) {
  const s = iv[0] > a ? iv[0] : a;
  const e = iv[1] < b ? iv[1] : b;
  return s <= e ? [s, e] : null;
}

function union(list) {
  const sorted = list.slice().sort((x, y) => (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const out = [];
  const u = require(`${__hooks}/lib_util.js`);
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && u.addDays(last[1], 1) >= iv[0]) {
      if (iv[1] > last[1]) last[1] = iv[1];
    } else out.push([iv[0], iv[1]]);
  }
  return out;
}

function subtract(base, cuts) {
  const u = require(`${__hooks}/lib_util.js`);
  let result = base.map((x) => [x[0], x[1]]);
  for (const c of cuts) {
    const next = [];
    for (const iv of result) {
      if (c[1] < iv[0] || c[0] > iv[1]) {
        next.push(iv);
        continue;
      }
      if (c[0] > iv[0]) next.push([iv[0], u.addDays(c[0], -1)]);
      if (c[1] < iv[1]) next.push([u.addDays(c[1], 1), iv[1]]);
    }
    result = next;
  }
  return result;
}

function totalDays(list) {
  const u = require(`${__hooks}/lib_util.js`);
  let n = 0;
  for (const iv of list) n += u.diffDays(iv[0], iv[1]) + 1;
  return n;
}

/* ------------------------------------------------------------------ */
/* Availability                                                        */
/* ------------------------------------------------------------------ */

function roots(tree) {
  const out = [];
  for (const code of Object.keys(tree || {})) {
    const parent = tree[code].parent;
    if (!parent || !tree[parent]) out.push(code);
  }
  return out;
}

function narrows(spec) {
  return !!spec && ((Array.isArray(spec.include) && spec.include.length > 0) || (Array.isArray(spec.exclude) && spec.exclude.length > 0));
}

function dimMatch(trees, grant, cell) {
  // cell: { [dim]: [codes] } ; every requested value must be touched.
  let full = true;
  for (const dim of Object.keys(cell)) {
    const values = cell[dim] || [];
    if (!values.length) continue;
    for (const v of values) {
      const cov = coverage(trees[dim] || {}, grant.dims[dim], v);
      if (cov === 'none') return 'none';
      if (cov === 'partial') full = false;
    }
  }
  // A dimension the question leaves open means "all of it": a grant that is
  // narrower there (toys only, SVOD only) covers only part of the question.
  for (const dim of Object.keys(grant.dims || {})) {
    const asked = cell[dim];
    if (asked && asked.length) continue;
    if (!narrows(grant.dims[dim])) continue;
    const tops = roots(trees[dim]);
    if (!tops.length) {
      full = false;
      continue;
    }
    let touched = false;
    for (const r of tops) {
      const cov = coverage(trees[dim] || {}, grant.dims[dim], r);
      if (cov !== 'none') touched = true;
      if (cov !== 'full') full = false;
    }
    if (!touched) return 'none';
  }
  return full ? 'full' : 'partial';
}

function reasonText(g, trees, code) {
  const u = require(`${__hooks}/lib_util.js`);
  const who = g.counterparty ? ' to ' + g.counterparty : '';
  const ref = g.agreement_ref || g.agreement_title;
  const until = g.end === FAR_FUTURE ? 'with no end date' : 'until ' + u.human(g.end);
  const from = g.start === FAR_PAST ? '' : ' from ' + u.human(g.start);
  if (code === 'RIGHTS_OUT') {
    return (g.exclusive ? 'Licensed exclusively' : 'Licensed') + who + ' under ' + ref + from + ' ' + until + '.';
  }
  if (code === 'HOLDBACK') return 'Holdback under ' + ref + from + ' ' + until + '.';
  if (code === 'RESTRICTION') return 'Restricted under ' + ref + from + ' ' + until + '.';
  if (code === 'RESERVED') return 'Reserved by the licensor under ' + ref + '.';
  return ref;
}

/**
 * query: {
 *   assets: [{type:'work'|'property'|'matter', id}],
 *   column: 'territory',            // dimension shown as columns
 *   columns: [codes],               // values of that dimension
 *   filters: { media: [codes], ... }, // other dimensions (all values must be available)
 *   start: 'YYYY-MM-DD', end: 'YYYY-MM-DD',
 *   exclusive: bool,                // considering an exclusive deal?
 *   exclude_agreement: id           // ignore this agreement (when checking itself)
 * }
 */
function availability(app, q) {
  const u = require(`${__hooks}/lib_util.js`);
  const trees = dimTree(app);
  const start = u.d10(q.start) || u.today();
  const end = u.d10(q.end) || u.addYMD(start, 1, 0, -1);
  const colDim = q.column || 'territory';
  const columns = Array.isArray(q.columns) && q.columns.length ? q.columns : ['WORLD'];
  const filters = q.filters || {};
  const grants = Array.isArray(q.grants) ? q.grants : loadGrants(app, q.exclude_agreement || '');
  const windowDays = u.diffDays(start, end) + 1;
  const rows = [];
  for (const asset of q.assets || []) {
    const lin = lineage(app, asset.type, asset.id);
    const keySet = {};
    for (const k of lin.keys) keySet[k] = true;
    const relevant = grants.filter((g) => g.assets.some((k) => keySet[k]));
    const cells = [];
    for (const code of columns) {
      const cell = {};
      cell[colDim] = [code];
      for (const k of Object.keys(filters)) if (k !== colDim && Array.isArray(filters[k]) && filters[k].length) cell[k] = filters[k];
      const reasons = [];
      // Rights in.
      let inIntervals = [];
      let partialDim = false;
      if (lin.owned) inIntervals = [[start, end]];
      else {
        for (const g of relevant) {
          if (g.direction !== 'in' || g.kind !== 'grant') continue;
          const m = dimMatch(trees, g, cell);
          if (m === 'none') continue;
          if (m === 'partial') partialDim = true;
          const iv = clip([g.start, g.end], start, end);
          if (iv) inIntervals.push(iv);
        }
        inIntervals = union(inIntervals);
      }
      // Reservations carve rights the licensor kept.
      const cuts = [];
      for (const g of relevant) {
        if (g.kind === 'reservation' && g.direction === 'in') {
          if (dimMatch(trees, g, cell) === 'none') continue;
          const iv = clip([g.start, g.end], start, end);
          if (iv) {
            cuts.push(iv);
            reasons.push({ code: 'RESERVED', agreement_id: g.agreement_id, ref: g.agreement_ref, from: iv[0], to: iv[1], text: reasonText(g, trees, 'RESERVED') });
          }
        }
      }
      // Blocking grants. One that covers only part of the asked scope (toys
      // only, while the question is every category) leaves the rest free.
      let partialBlock = false;
      for (const g of relevant) {
        let code2 = '';
        if (g.kind === 'holdback') code2 = 'HOLDBACK';
        else if (g.kind === 'restriction') code2 = 'RESTRICTION';
        else if (g.direction === 'out' && g.kind === 'grant' && (g.exclusive || q.exclusive)) code2 = 'RIGHTS_OUT';
        if (code2 === '') continue;
        const match = dimMatch(trees, g, cell);
        if (match === 'none') continue;
        const iv = clip([g.start, g.end], start, end);
        if (!iv) continue;
        if (match === 'full') cuts.push(iv);
        else partialBlock = true;
        reasons.push({
          scope: match === 'full' ? 'all' : 'part',
          code: code2,
          agreement_id: g.agreement_id,
          ref: g.agreement_ref,
          counterparty: g.counterparty,
          from: iv[0],
          to: iv[1],
          exclusive: g.exclusive,
          text: reasonText(g, trees, code2),
        });
      }
      const free = subtract(inIntervals, union(cuts));
      const freeDays = totalDays(free);
      let status = 'available';
      if (inIntervals.length === 0) {
        status = 'no_rights';
        reasons.unshift({ code: 'NO_RIGHTS_IN', text: 'No rights acquired for ' + labelOf(trees, colDim, code) + ' in this window.' });
      } else if (freeDays === 0) status = 'unavailable';
      else if (freeDays < windowDays || partialDim || partialBlock) {
        status = 'partial';
        const inDays = totalDays(inIntervals);
        if (inDays < windowDays) {
          reasons.push({ code: 'RIGHTS_IN_ENDS', text: 'Acquired rights cover only part of the window.' });
        }
        if (partialDim) reasons.push({ code: 'PARTIAL_SCOPE', text: 'Acquired rights cover only part of the requested scope.' });
        if (partialBlock) reasons.push({ code: 'PARTIAL_SCOPE', text: 'Part of the requested scope is taken; narrow the question to see what is free.' });
      }
      if (lin.owned && status === 'available') {
        // nothing to explain
      }
      cells.push({
        code: code,
        label: labelOf(trees, colDim, code),
        status: status,
        free: free,
        available_from: free.length ? free[0][0] : '',
        available_until: free.length ? free[free.length - 1][1] : '',
        reasons: reasons,
      });
    }
    rows.push({ type: asset.type, id: asset.id, label: assetLabel(app, asset.type, asset.id), owned: lin.owned, owned_by: lin.ownedBy, cells: cells });
  }
  return {
    column: colDim,
    columns: columns.map((c) => ({ code: c, label: labelOf(trees, colDim, c) })),
    start: start,
    end: end,
    rows: rows,
  };
}

/**
 * Conflicts for an agreement's out-grants (saved or draft) against every
 * other active agreement. Returns [{grant_index, asset, value, reasons, status}].
 */
function conflicts(app, agreementId, draftGrants) {
  const u = require(`${__hooks}/lib_util.js`);
  const trees = dimTree(app);
  const agr = agreementId ? u.byId(app, 'agreements', agreementId) : null;
  let mine = [];
  if (Array.isArray(draftGrants)) {
    mine = draftGrants.map(function (d, i) {
      return {
        index: i,
        direction: d.direction,
        kind: d.kind || 'grant',
        exclusive: d.exclusive === true,
        assets: [].concat(
          (d.properties || []).map((x) => 'property:' + x),
          (d.works || []).map((x) => 'work:' + x),
          (d.matters || []).map((x) => 'matter:' + x),
        ),
        dims: d.dims || {},
        start: u.d10(d.term_start) || (agr ? u.d10(agr.getString('term_start')) : '') || u.today(),
        end: u.d10(d.term_end) || (agr && !agr.getBool('perpetual') ? u.d10(agr.getString('term_end')) : '') || u.addYMD(u.today(), 10, 0, 0),
      };
    });
  } else if (agr !== null) {
    const rows = u.findMany(app, 'grants', 'agreement = {:a}', 'created', 0, { a: agr.id });
    mine = rows.map(function (g, i) {
      const o = grantObj(app, g, agr);
      o.index = i;
      if (o.end === FAR_FUTURE) o.end = u.addYMD(u.today(), 10, 0, 0);
      if (o.start === FAR_PAST) o.start = u.today();
      return o;
    });
  }
  const others = loadGrants(app, agreementId || '');
  const found = [];
  for (const g of mine) {
    if (g.direction !== 'out' || g.kind !== 'grant') continue;
    const colDim = 'territory';
    const spec = g.dims[colDim];
    const values = spec && Array.isArray(spec.include) && spec.include.length ? spec.include : ['WORLD'];
    const filters = {};
    for (const dim of Object.keys(g.dims || {})) {
      if (dim === colDim) continue;
      const s = g.dims[dim];
      if (s && Array.isArray(s.include) && s.include.length) filters[dim] = s.include;
    }
    const assets = g.assets.map(function (k) {
      const p = k.split(':');
      return { type: p[0], id: p[1] };
    });
    if (!assets.length) continue;
    const res = availability(app, {
      assets: assets,
      column: colDim,
      columns: values,
      filters: filters,
      start: g.start,
      end: g.end,
      exclusive: g.exclusive,
      grants: others,
    });
    for (const row of res.rows) {
      for (const cell of row.cells) {
        if (cell.status === 'available') continue;
        found.push({
          grant_index: g.index,
          asset: row.label,
          asset_type: row.type,
          asset_id: row.id,
          value: cell.label,
          status: cell.status,
          reasons: cell.reasons,
        });
      }
    }
  }
  return { conflicts: found, checked: mine.length };
}

module.exports = {
  dimTree: dimTree,
  coverage: coverage,
  specLabel: specLabel,
  lineage: lineage,
  availability: availability,
  conflicts: conflicts,
  loadGrants: loadGrants,
};
