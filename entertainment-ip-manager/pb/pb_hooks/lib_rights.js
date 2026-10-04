/// <reference path="../pb_data/types.d.ts" />
/**
 * Rights availability, committee windows and the "Can we?" check.
 *
 * A grant is a slice of rights on some assets (franchises, titles,
 * characters, songs, recordings, trademarks), for dimension values
 * (territory, media, language and version, product category, channel,
 * platform), over a term. Direction "in" = rights we acquired, "out" =
 * rights we granted. "holdback" and "restriction" block us; "reservation"
 * on an in-agreement carves rights the licensor kept; "window" on a
 * committee agreement hands one use category to a member (窓口権).
 *
 * Availability for (asset, cell, window):
 *   rights in  = owned (franchise, title or character owned by us or our
 *                committee) or covered by in-grants
 *   blocked    = conflicting out-grants (exclusive, or any out-grant when an
 *                exclusive deal is being considered), holdbacks,
 *                restrictions, reservations
 *   available / partial / unavailable / no_rights, each with reasons.
 * A dimension the question leaves open means all of it: a toys-only licence
 * makes a territory partial, not unavailable.
 *
 * canWe() adds, per cell: who decides (window holder, or every committee
 * member under Copyright Act Art. 65(2)), the original-work licence,
 * chain of title for each character layer, performer consent for
 * sound-only products (Art. 91(2)), trademark cover by Nice class, talent
 * status and the copyright notice to print.
 */

const FAR_PAST = '1900-01-01';
const FAR_FUTURE = '9999-12-31';

const ASSET_COLL = {
  franchise: 'franchises',
  work: 'titles',
  character: 'characters',
  song: 'songs',
  recording: 'recordings',
  matter: 'matters',
};
const GRANT_FIELD = {
  franchise: 'franchises',
  work: 'works',
  character: 'characters',
  song: 'songs',
  recording: 'recordings',
  matter: 'matters',
};

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

function dimTree(app) {
  const u = u_();
  const trees = {};
  const rows = u.findMany(app, 'dimension_values', '', 'order', 0);
  for (const r of rows) {
    const d = r.getString('dimension');
    if (!trees[d]) trees[d] = {};
    trees[d][r.getString('code')] = {
      parent: r.getString('parent_code'),
      label: r.getString('label'),
      label_ja: r.getString('label_ja') || r.getString('label'),
      classes: u.j(r, 'classes', []),
    };
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

function depth(tree, code) {
  return ancestors(tree, code).length;
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
function labelJaOf(trees, dim, code) {
  return trees[dim] && trees[dim][code] ? trees[dim][code].label_ja : code;
}

function specLabel(trees, dim, spec) {
  if (!spec || !Array.isArray(spec.include) || spec.include.length === 0) {
    const ex = spec && Array.isArray(spec.exclude) ? spec.exclude : [];
    return ex.length
      ? 'All excl. ' +
          ex
            .map(function (c) {
              return labelOf(trees, dim, c);
            })
            .join(', ')
      : 'All';
  }
  let s = spec.include
    .map(function (c) {
      return labelOf(trees, dim, c);
    })
    .join(', ');
  if (Array.isArray(spec.exclude) && spec.exclude.length) {
    s +=
      ' excl. ' +
      spec.exclude
        .map(function (c) {
          return labelOf(trees, dim, c);
        })
        .join(', ');
  }
  return s;
}

/* ------------------------------------------------------------------ */
/* Assets and lineage                                                  */
/* ------------------------------------------------------------------ */

const OWNED_FRANCHISE = { sole_owner: true, committee: true, co_production: true };
const OWNED_WORK = { owned: true, committee: true, mixed: true };
const OWNED_CHARACTER = { agency_owned: true, committee_owned: true, co_owned: true };

/**
 * Keys for an asset and everything above it, plus ownership, the committee
 * that governs it and the franchise/title it belongs to.
 */
function lineage(app, type, id) {
  const u = u_();
  const keys = [];
  const out = { keys: keys, owned: false, ownedBy: '', committee: '', franchise: '', work: '', characters: [] };
  const seen = {};
  function own(label) {
    if (!out.owned) {
      out.owned = true;
      out.ownedBy = label;
    }
  }
  function addFranchise(fid, inheritOwnership) {
    let cur = fid;
    while (cur && !seen['franchise:' + cur]) {
      seen['franchise:' + cur] = true;
      keys.push('franchise:' + cur);
      const f = u.byId(app, 'franchises', cur);
      if (f === null) break;
      if (!out.franchise) out.franchise = f.id;
      if (!out.committee && f.getString('committee')) out.committee = f.getString('committee');
      if (inheritOwnership && OWNED_FRANCHISE[f.getString('ownership_model')]) own(f.getString('name'));
      cur = f.getString('parent');
    }
  }
  function addWork(wid) {
    let cur = wid;
    let franchise = '';
    let inherit = true;
    while (cur && !seen['work:' + cur]) {
      seen['work:' + cur] = true;
      keys.push('work:' + cur);
      const w = u.byId(app, 'titles', cur);
      if (w === null) break;
      if (!out.work) out.work = w.id;
      if (!out.committee && w.getString('committee')) out.committee = w.getString('committee');
      const basis = w.getString('rights_basis');
      if (OWNED_WORK[basis]) own(w.getString('title'));
      if (basis === 'acquired' || basis === 'licensed_in') inherit = false;
      if (w.getString('franchise')) franchise = w.getString('franchise');
      cur = w.getString('parent');
    }
    if (franchise) addFranchise(franchise, inherit);
  }
  if (type === 'franchise') addFranchise(id, true);
  else if (type === 'work') addWork(id);
  else if (type === 'character') {
    keys.push('character:' + id);
    const c = u.byId(app, 'characters', id);
    if (c !== null) {
      out.characters.push(c.id);
      const model = c.getString('ownership_model');
      if (OWNED_CHARACTER[model]) own(c.getString('name'));
      if (c.getString('franchise')) addFranchise(c.getString('franchise'), model === '' || OWNED_CHARACTER[model] === true);
      for (const w of u.ids(c, 'appears_in')) if (!out.work) out.work = w;
    }
  } else if (type === 'song' || type === 'recording') {
    let songId = id;
    if (type === 'recording') {
      keys.push('recording:' + id);
      const r = u.byId(app, 'recordings', id);
      songId = r ? r.getString('song') : '';
      if (r !== null) for (const c of u.ids(r, 'characters')) out.characters.push(c);
    }
    if (songId) {
      keys.push('song:' + songId);
      const s = u.byId(app, 'songs', songId);
      if (s !== null) {
        for (const c of u.ids(s, 'characters')) if (out.characters.indexOf(c) < 0) out.characters.push(c);
        if (s.getString('work')) addWork(s.getString('work'));
        if (s.getString('franchise')) addFranchise(s.getString('franchise'), true);
      }
    }
  } else if (type === 'matter') {
    keys.push('matter:' + id);
    const m = u.byId(app, 'matters', id);
    if (m !== null) {
      own(m.getString('ref') || m.getString('title'));
      if (m.getString('character')) keys.push('character:' + m.getString('character'));
      if (m.getString('work')) addWork(m.getString('work'));
      if (m.getString('franchise')) addFranchise(m.getString('franchise'), true);
    }
  }
  return out;
}

function assetLabel(app, type, id) {
  const u = u_();
  const r = u.byId(app, ASSET_COLL[type] || '', id);
  if (r === null) return 'Unknown';
  if (type === 'work' || type === 'song' || type === 'recording') return r.getString('title');
  if (type === 'matter') return r.getString('ref') + ' ' + r.getString('title');
  return r.getString('name');
}

function grantAssets(g) {
  const u = u_();
  const keys = [];
  for (const t of Object.keys(GRANT_FIELD)) for (const id of u.ids(g, GRANT_FIELD[t])) keys.push(t + ':' + id);
  return keys;
}

function grantObj(app, g, a) {
  const u = u_();
  const cp = a && a.getString('counterparty') ? u.byId(app, 'parties', a.getString('counterparty')) : null;
  const start = u.d10(g.getString('term_start')) || (a ? u.d10(a.getString('term_start')) || u.d10(a.getString('effective_date')) : '') || FAR_PAST;
  let end = u.d10(g.getString('term_end')) || (a && !a.getBool('perpetual') ? u.d10(a.getString('term_end')) : '') || FAR_FUTURE;
  if (a && a.getString('status') === 'expired' && end === FAR_FUTURE) end = u.d10(a.getString('term_end')) || FAR_PAST;
  const holders = u.ids(g, 'holders');
  return {
    id: g.id || '',
    agreement_id: a ? a.id : '',
    agreement_ref: a ? a.getString('ref') : '',
    agreement_title: a ? a.getString('title') : '',
    agreement_type: a ? a.getString('agreement_type') : '',
    committee: a ? a.getString('committee') : '',
    sublicense: a ? a.getBool('sublicense_allowed') : false,
    counterparty: cp ? cp.getString('name') : '',
    direction: g.getString('direction'),
    kind: g.getString('kind'),
    exclusive: g.getBool('exclusive'),
    holders: holders,
    holder_split: u.j(g, 'holder_split', []),
    fee_pct: g.getFloat('fee_pct'),
    fee_base: g.getString('fee_base'),
    assets: grantAssets(g),
    dims: u.j(g, 'dims', {}),
    start: start,
    end: end,
  };
}

/** All grants with their agreement context, counted agreements only. */
function loadGrants(app, excludeAgreementId) {
  const u = u_();
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

/* ------------------------------------------------------------------ */
/* Intervals                                                           */
/* ------------------------------------------------------------------ */

function clip(iv, a, b) {
  const s = iv[0] > a ? iv[0] : a;
  const e = iv[1] < b ? iv[1] : b;
  return s <= e ? [s, e] : null;
}

function union(list) {
  const u = u_();
  const sorted = list.slice().sort(function (x, y) {
    return x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0;
  });
  const out = [];
  for (const iv of sorted) {
    const last = out[out.length - 1];
    if (last && u.addDays(last[1], 1) >= iv[0]) {
      if (iv[1] > last[1]) last[1] = iv[1];
    } else out.push([iv[0], iv[1]]);
  }
  return out;
}

function subtract(base, cuts) {
  const u = u_();
  let result = base.map(function (x) {
    return [x[0], x[1]];
  });
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
  const u = u_();
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

/** cell: { [dim]: [codes] }; every requested value must be touched. */
function dimMatch(trees, grant, cell) {
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

function reasonText(g, code) {
  const u = u_();
  const ref = g.agreement_ref || g.agreement_title;
  const until = g.end === FAR_FUTURE ? 'with no end date' : 'until ' + u.human(g.end);
  const untilJa = g.end === FAR_FUTURE ? '期限なし' : u.humanJa(g.end) + 'まで';
  const from = g.start === FAR_PAST ? '' : ' from ' + u.human(g.start);
  const fromJa = g.start === FAR_PAST ? '' : u.humanJa(g.start) + 'から';
  if (code === 'RIGHTS_OUT') {
    return u.bi(
      (g.exclusive ? 'Licensed exclusively' : 'Licensed') + (g.counterparty ? ' to ' + g.counterparty : '') + ' under ' + ref + from + ' ' + until + '.',
      ref + 'により' + (g.counterparty ? g.counterparty + 'へ' : '') + (g.exclusive ? '独占的に' : '') + '許諾済み（' + fromJa + untilJa + '）。',
    );
  }
  if (code === 'HOLDBACK') return u.bi('Holdback under ' + ref + from + ' ' + until + '.', ref + 'によるホールドバック（' + fromJa + untilJa + '）。');
  if (code === 'RESTRICTION') return u.bi('Restricted under ' + ref + from + ' ' + until + '.', ref + 'による制限（' + fromJa + untilJa + '）。');
  if (code === 'RESERVED') return u.bi('Reserved by the licensor under ' + ref + '.', ref + 'でライセンサーが留保。');
  return u.bi(ref, ref);
}

/**
 * query: {
 *   assets: [{ type, id }],
 *   column: 'territory', columns: [codes],
 *   filters: { media: [codes], category: [...], ... },
 *   start, end, exclusive, exclude_agreement, grants (optional preloaded)
 * }
 */
function availability(app, q) {
  const u = u_();
  const trees = q.trees || dimTree(app);
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
    const relevant = grants.filter(function (g) {
      return g.kind !== 'window' && g.assets.some(function (k) {
        return keySet[k];
      });
    });
    const cells = [];
    for (const code of columns) {
      const cell = {};
      cell[colDim] = [code];
      for (const k of Object.keys(filters)) if (k !== colDim && Array.isArray(filters[k]) && filters[k].length) cell[k] = filters[k];
      const reasons = [];
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
      const cuts = [];
      for (const g of relevant) {
        if (g.kind === 'reservation' && g.direction === 'in') {
          if (dimMatch(trees, g, cell) === 'none') continue;
          const iv = clip([g.start, g.end], start, end);
          if (iv) {
            cuts.push(iv);
            reasons.push({ code: 'RESERVED', agreement_id: g.agreement_id, ref: g.agreement_ref, from: iv[0], to: iv[1], text: reasonText(g, 'RESERVED') });
          }
        }
      }
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
          text: reasonText(g, code2),
        });
      }
      const free = subtract(inIntervals, union(cuts));
      const freeDays = totalDays(free);
      let status = 'available';
      if (inIntervals.length === 0) {
        status = 'no_rights';
        reasons.unshift({
          code: 'NO_RIGHTS_IN',
          text: u.bi(
            'No rights acquired for ' + labelOf(trees, colDim, code) + ' in this window.',
            'この期間の' + labelJaOf(trees, colDim, code) + 'の権利を取得していません。',
          ),
        });
      } else if (freeDays === 0) status = 'unavailable';
      else if (freeDays < windowDays || partialDim || partialBlock) {
        status = 'partial';
        if (totalDays(inIntervals) < windowDays) reasons.push({ code: 'RIGHTS_IN_ENDS', text: u.bi('Acquired rights cover only part of the window.', '取得した権利は期間の一部のみです。') });
        if (partialDim) reasons.push({ code: 'PARTIAL_SCOPE', text: u.bi('Acquired rights cover only part of the requested scope.', '取得した権利は求める範囲の一部のみです。') });
        if (partialBlock) {
          reasons.push({
            code: 'PARTIAL_SCOPE',
            text: u.bi('Part of the requested scope is taken; narrow the question to see what is free.', '求める範囲の一部は使用済みです。条件を絞ると空きが分かります。'),
          });
        }
      }
      cells.push({
        code: code,
        label: labelOf(trees, colDim, code),
        label_ja: labelJaOf(trees, colDim, code),
        status: status,
        free: free,
        available_from: free.length ? free[0][0] : '',
        available_until: free.length ? free[free.length - 1][1] : '',
        reasons: reasons,
      });
    }
    rows.push({
      type: asset.type,
      id: asset.id,
      label: assetLabel(app, asset.type, asset.id),
      owned: lin.owned,
      owned_by: lin.ownedBy,
      committee: lin.committee,
      franchise: lin.franchise,
      work: lin.work,
      characters: lin.characters,
      cells: cells,
    });
  }
  return {
    column: colDim,
    columns: columns.map(function (c) {
      return { code: c, label: labelOf(trees, colDim, c), label_ja: labelJaOf(trees, colDim, c) };
    }),
    start: start,
    end: end,
    rows: rows,
  };
}

/* ------------------------------------------------------------------ */
/* Committee windows: who can say yes                                  */
/* ------------------------------------------------------------------ */

function committeeWindows(app, committeeId, grants) {
  return (grants || loadGrants(app, '')).filter(function (g) {
    return g.kind === 'window' && g.committee === committeeId;
  });
}

function specificity(trees, g) {
  let s = 0;
  for (const dim of Object.keys(g.dims || {})) {
    const inc = g.dims[dim] && Array.isArray(g.dims[dim].include) ? g.dims[dim].include : [];
    for (const c of inc) s += depth(trees[dim] || {}, c);
    if (g.dims[dim] && Array.isArray(g.dims[dim].exclude) && g.dims[dim].exclude.length) s += 1;
  }
  return s;
}

/**
 * Who decides a use of a committee-owned asset.
 * Returns { mode: 'window' | 'shared_window' | 'consent' | 'partial', windows: [...], members: [...], text: {en, ja} }.
 */
function decider(app, trees, committeeId, cell, start, end, grants) {
  const u = u_();
  const c = u.byId(app, 'committees', committeeId);
  if (c === null) return null;
  const members = u.findMany(app, 'committee_members', 'committee = {:c} && status != "exited"', 'created', 0, { c: committeeId }).map(function (m) {
    const p = m.getString('party') ? u.byId(app, 'parties', m.getString('party')) : null;
    return {
      id: m.id,
      party: m.getString('party'),
      name: m.getString('name') || (p ? p.getString('name') : ''),
      share_pct: m.getFloat('share_pct'),
      status: m.getString('status'),
      roles: u.j(m, 'roles', []),
    };
  });
  const nameOf = function (partyId) {
    for (const m of members) if (m.party === partyId) return m.name;
    const p = u.byId(app, 'parties', partyId);
    return p ? p.getString('name') : '';
  };
  const full = [];
  const part = [];
  for (const w of committeeWindows(app, committeeId, grants)) {
    const iv = clip([w.start, w.end], start, end);
    if (!iv) continue;
    const m = dimMatch(trees, w, cell);
    if (m === 'none') continue;
    const obj = {
      grant_id: w.id,
      agreement_id: w.agreement_id,
      holders: w.holders.map(function (h) {
        return { party: h, name: nameOf(h) };
      }),
      holder_split: w.holder_split,
      fee_pct: w.fee_pct,
      fee_base: w.fee_base,
      start: w.start,
      end: w.end,
      covers_window: iv[0] === start && iv[1] === end,
      scope: m,
      specificity: specificity(trees, w),
      dims: w.dims,
    };
    if (m === 'full' && obj.covers_window) full.push(obj);
    else part.push(obj);
  }
  const consentMode = c.getString('consent_default') || 'unanimous';
  const live = members.filter(function (m) {
    return m.status !== 'exited';
  });
  const risk = members.filter(function (m) {
    return m.status === 'insolvent' || m.status === 'transferred';
  });
  const riskNote = risk.length
    ? u.bi(
        ' Member status needs attention: ' + risk.map(function (m) { return m.name + ' (' + m.status + ')'; }).join(', ') + '.',
        ' 構成員の状況を確認してください：' + risk.map(function (m) { return m.name + '（' + m.status + '）'; }).join('、') + '。',
      )
    : u.bi('', '');
  if (full.length) {
    full.sort(function (a, b) {
      return b.specificity - a.specificity;
    });
    const top = full[0];
    const ties = full.filter(function (w) {
      return w.specificity === top.specificity;
    });
    const holderNames = top.holders.map(function (h) {
      return h.name;
    });
    const fee = top.fee_pct ? ' Window fee ' + top.fee_pct + '% of ' + (top.fee_base || 'net') + '.' : '';
    const feeJa = top.fee_pct ? '窓口手数料は' + (top.fee_base === 'gross' ? '総額' : '純額') + 'の' + top.fee_pct + '%。' : '';
    if (ties.length > 1 && ties.some(function (w) { return w.grant_id !== top.grant_id && w.holders.join() !== top.holders.join(); })) {
      return {
        mode: 'conflict',
        windows: ties,
        members: members,
        committee: { id: c.id, name: c.getString('name') },
        text: u.bi(
          'Two windows claim this use (' + ties.map(function (w) { return w.holders.map(function (h) { return h.name; }).join(' and '); }).join('; ') + '). Settle it in the committee before licensing.',
          'この利用には複数の窓口が該当します（' + ties.map(function (w) { return w.holders.map(function (h) { return h.name; }).join('・'); }).join('、') + '）。許諾前に委員会で調整してください。',
        ),
      };
    }
    return {
      mode: top.holders.length > 1 ? 'shared_window' : 'window',
      windows: [top],
      members: members,
      committee: { id: c.id, name: c.getString('name') },
      text: u.bi(
        'Window held by ' + holderNames.join(' and ') + (top.end === FAR_FUTURE ? '' : ' until ' + u.human(top.end)) + '. The window holder signs; no committee consent needed.' + fee + riskNote.en,
        holderNames.join('・') + 'が窓口' + (top.end === FAR_FUTURE ? '' : '（' + u.humanJa(top.end) + 'まで）') + '。窓口会社が契約し、委員会の同意は不要です。' + feeJa + riskNote.ja,
      ),
    };
  }
  const modeText = {
    unanimous: ['every member must agree (Copyright Act Art. 65(2))', '全構成員の同意が必要です（著作権法65条2項）'],
    majority: ['a majority of members must agree under the committee agreement', '委員会契約により構成員の過半数の同意が必要です'],
    lead_discretion: ['the lead company decides under the committee agreement', '委員会契約により幹事会社が判断します'],
    consult: ['the lead company decides after consulting members', '幹事会社が構成員と協議のうえ判断します'],
  }[consentMode] || ['every member must agree (Copyright Act Art. 65(2))', '全構成員の同意が必要です（著作権法65条2項）'];
  const partText = part.length
    ? u.bi(
        ' A window covers part of it (' + part.map(function (w) { return w.holders.map(function (h) { return h.name; }).join(' and ') + (w.end !== FAR_FUTURE ? ' until ' + u.human(w.end) : ''); }).join('; ') + ').',
        ' 一部は窓口が担当します（' + part.map(function (w) { return w.holders.map(function (h) { return h.name; }).join('・') + (w.end !== FAR_FUTURE ? '、' + u.humanJa(w.end) + 'まで' : ''); }).join('；') + '）。',
      )
    : u.bi('', '');
  return {
    mode: part.length ? 'partial' : 'consent',
    consent_mode: consentMode,
    windows: part,
    members: members,
    committee: { id: c.id, name: c.getString('name') },
    text: u.bi(
      'No window covers this use, so ' + modeText[0] + ': ' + live.length + ' member' + (live.length === 1 ? '' : 's') + '.' + partText.en + riskNote.en,
      'この利用を担当する窓口がないため、' + modeText[1] + '（構成員' + live.length + '社）。' + partText.ja + riskNote.ja,
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Can we?                                                             */
/* ------------------------------------------------------------------ */

const ADAPTATION_MEDIA = ['MERCHANDISE', 'GAMES', 'STAGE', 'FORMAT', 'COMICS', 'NOVELS', 'PACHINKO', 'COLLAB_CAFE', 'THEME_PARKS', 'BRAND_TIEUP'];
const SOUND_ONLY_MEDIA = ['VOICE', 'VOICE_PRODUCTS', 'ASMR', 'MUSIC', 'AUDIO_STREAMING', 'PHYSICAL_AUDIO', 'KARAOKE'];
const VISUAL_COMPONENTS = ['design_sheet', 'standing_art', 'outfit', 'logo', 'live2d_model', 'model_3d', 'emote'];
/** Nice classes implied by media codes (category codes carry their own). */
const MEDIA_CLASSES = {
  CONCERTS: [41],
  EVENTS: [41],
  STAGE: [41],
  EVENT_SCREENING: [41],
  LIVE_STREAM: [41],
  STREAMING: [41],
  COLLAB_CAFE: [43],
  DIGITAL_GOODS: [9],
  VOICE_PRODUCTS: [9],
  ASMR: [9],
  CONSOLE_PC: [9],
  MOBILE_GAMES: [9],
  PHYSICAL_AUDIO: [9],
  AUDIO_STREAMING: [9],
  VIDEO_PACKAGE: [9],
};
const EU_MEMBERS = ['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE'];

function expand(trees, dim, codes) {
  // A code plus all its ancestors (so ACRYLIC also matches MERCHANDISE-level rules).
  const out = [];
  for (const c of codes || []) for (const a of ancestors(trees[dim] || {}, c)) if (out.indexOf(a) < 0) out.push(a);
  return out;
}

function classesFor(trees, filters) {
  const set = {};
  for (const c of filters.category || []) {
    for (const a of ancestors(trees.category || {}, c)) {
      const node = trees.category && trees.category[a];
      if (node && Array.isArray(node.classes)) for (const k of node.classes) set[k] = true;
      if (node && node.classes && node.classes.length) break;
    }
  }
  for (const m of expand(trees, 'media', filters.media || [])) {
    if (MEDIA_CLASSES[m]) for (const k of MEDIA_CLASSES[m]) set[k] = true;
  }
  return Object.keys(set)
    .map(Number)
    .sort(function (a, b) {
      return a - b;
    });
}

function trademarkCover(app, trees, ctx, territory, classes) {
  const u = u_();
  if (!classes.length) return null;
  const filters = [];
  const params = {};
  ctx.characters.forEach(function (cid, i) {
    filters.push('character = {:c' + i + '}');
    params['c' + i] = cid;
  });
  if (ctx.franchise) {
    filters.push('franchise = {:f}');
    params.f = ctx.franchise;
  }
  ctx.talents.forEach(function (tid, i) {
    filters.push('talent = {:t' + i + '}');
    params['t' + i] = tid;
  });
  if (!filters.length) return null;
  const marks = u.findMany(app, 'matters', 'ip_type = "trademark" && (' + filters.join(' || ') + ')', '', 0, params);
  const jurs = [territory];
  if (EU_MEMBERS.indexOf(territory) >= 0) jurs.push('EM');
  const result = {};
  for (const k of classes) result[k] = { state: 'missing', marks: [] };
  for (const m of marks) {
    if (jurs.indexOf(m.getString('jurisdiction').toUpperCase()) < 0) continue;
    const group = m.getString('status_group');
    if (group === 'dead') continue;
    const gs = u.findMany(app, 'goods_services', 'matter = {:m}', '', 0, { m: m.id });
    for (const g of gs) {
      const k = g.getInt('nice_class');
      if (!result[k]) continue;
      const st = g.getString('class_status');
      if (st === 'deleted' || st === 'cancelled' || st === 'refused') continue;
      const state = group === 'live' && (st === 'registered' || st === '') ? 'registered' : 'pending';
      if (result[k].state !== 'registered') result[k].state = state;
      result[k].marks.push({ id: m.id, ref: m.getString('ref'), registration_no: m.getString('registration_no'), application_no: m.getString('application_no') });
    }
  }
  return result;
}

function copyrightLine(app, ctx, territory) {
  const u = u_();
  if (ctx.committee) {
    const c = u.byId(app, 'committees', ctx.committee);
    if (c && c.getString('copyright_line')) return c.getString('copyright_line');
  }
  if (ctx.franchise) {
    const f = u.byId(app, 'franchises', ctx.franchise);
    if (f) {
      const lines = u.j(f, 'copyright_lines', []);
      if (Array.isArray(lines)) {
        let fallback = '';
        for (const l of lines) {
          if (!l) continue;
          if (l.territory === territory) return l.text;
          if (!l.territory || l.territory === 'WORLD' || l.territory === '*') fallback = l.text;
        }
        if (fallback) return fallback;
      }
    }
  }
  for (const cid of ctx.characters) {
    const ch = u.byId(app, 'characters', cid);
    if (ch && ch.getString('copyright_line')) return ch.getString('copyright_line');
  }
  return '';
}

function check(key, level, en, ja, links) {
  return { key: key, level: level, text: { en: en, ja: ja }, links: links || [] };
}

/** Context shared by all cells of one asset row. */
function rowContext(app, row) {
  const u = u_();
  const ctx = {
    committee: row.committee,
    franchise: row.franchise,
    work: row.work,
    characters: row.characters.slice(),
    talents: [],
    castings: [],
    assets: [],
  };
  for (const cid of ctx.characters) {
    for (const cast of u.findMany(app, 'castings', 'character = {:c}', '-start_date', 0, { c: cid })) {
      const end = u.d10(cast.getString('end_date'));
      if (end !== '' && end < u.today()) continue;
      const t = u.byId(app, 'talents', cast.getString('talent'));
      if (t === null) continue;
      ctx.castings.push({ character: cid, talent: t, role: cast.getString('role') });
      if (ctx.talents.indexOf(t.id) < 0) ctx.talents.push(t.id);
    }
    for (const a of u.findMany(app, 'character_assets', 'character = {:c}', '', 0, { c: cid })) ctx.assets.push(a);
  }
  return ctx;
}

function upstreamChecks(app, trees, ctx, cell, start, end) {
  const u = u_();
  const out = [];
  const filters = [];
  const params = {};
  if (ctx.franchise) {
    filters.push('franchise = {:f}');
    params.f = ctx.franchise;
  }
  if (ctx.work) {
    filters.push('work = {:w}');
    params.w = ctx.work;
  }
  if (!filters.length) return out;
  const owl = u.findMany(app, 'agreements', 'agreement_type = "original_work_license" && status != "terminated" && status != "superseded" && (' + filters.join(' || ') + ')', '', 0, params);
  for (const a of owl) {
    const ref = a.getString('ref') || a.getString('title');
    const gs = u.findMany(app, 'grants', 'agreement = {:a} && direction = "in" && kind = "grant"', '', 0, { a: a.id }).map(function (g) {
      return grantObj(app, g, a);
    });
    let best = 'none';
    for (const g of gs) {
      if (!clip([g.start, g.end], start, end)) continue;
      const m = dimMatch(trees, g, cell);
      if (m === 'full') best = 'full';
      else if (m === 'partial' && best === 'none') best = 'partial';
    }
    const link = [{ type: 'agreement', id: a.id, label: ref }];
    if (gs.length === 0) {
      out.push(check('upstream', 'warn', 'Original-work licence ' + ref + ' has no scope recorded. Check that it covers this use.', '原作使用許諾 ' + ref + 'の許諾範囲が未登録です。この利用が含まれるか確認してください。', link));
    } else if (best === 'none') {
      out.push(check('upstream', 'block', 'Original-work licence ' + ref + ' does not cover this use. Negotiate with the publisher first.', '原作使用許諾 ' + ref + 'の範囲外です。先に出版社と交渉が必要です。', link));
    } else if (best === 'partial') {
      out.push(check('upstream', 'warn', 'Original-work licence ' + ref + ' covers only part of this use.', '原作使用許諾 ' + ref + 'はこの利用の一部のみを対象としています。', link));
    } else {
      out.push(check('upstream', 'ok', 'Original-work licence ' + ref + ' covers this use.', '原作使用許諾 ' + ref + 'の範囲内です。', link));
    }
    if (a.getBool('original_approval_required')) {
      out.push(check('upstream', 'warn', 'Publisher approval is required under ' + ref + '.', ref + 'により出版社（原作者側）の監修が必要です。', link));
    }
  }
  return out;
}

function chainChecks(app, trees, ctx, cell, q) {
  const u = u_();
  const out = [];
  const media = expand(trees, 'media', cell.media || []);
  const adaptation = media.some(function (m) {
    return ADAPTATION_MEDIA.indexOf(m) >= 0;
  }) || (cell.category && cell.category.length > 0);
  const soundOnly = media.some(function (m) {
    return SOUND_ONLY_MEDIA.indexOf(m) >= 0;
  });
  let problems = 0;
  for (const a of ctx.assets) {
    const comp = a.getString('component');
    const visual = VISUAL_COMPONENTS.indexOf(comp) >= 0;
    if (soundOnly && comp !== 'voice' && comp !== 'name' && comp !== 'jingle') continue;
    if (!soundOnly && !visual && comp !== 'name') continue;
    const label = a.getString('label');
    const link = [{ type: 'character', id: a.getString('character'), label: label }];
    const acq = a.getString('acquisition');
    if (acq === 'unknown' || acq === '') {
      out.push(check('chain', 'warn', 'How "' + label + '" was acquired is not recorded.', '「' + label + '」の権利取得方法が未登録です。', link));
      problems += 1;
      continue;
    }
    if (acq === 'nonexclusive_license' && q.exclusive) {
      out.push(check('chain', 'block', '"' + label + '" is licensed non-exclusively, so it cannot be in an exclusive deal.', '「' + label + '」は非独占の利用許諾のため、独占契約には使えません。', link));
      problems += 1;
    }
    const lic = u.d10(a.getString('license_end'));
    if ((acq === 'exclusive_license' || acq === 'nonexclusive_license') && lic !== '' && lic < u.d10(q.end)) {
      out.push(check('chain', 'warn', 'The licence for "' + label + '" ends ' + u.human(lic) + ', before this window ends.', '「' + label + '」の利用許諾は' + u.humanJa(lic) + 'に終了し、この期間より前に切れます。', link));
      problems += 1;
    }
    if (acq === 'assignment' && !a.getBool('art27_28') && adaptation && visual) {
      out.push(check('chain', 'block',
        'The assignment of "' + label + '" does not name Articles 27 and 28, so adaptation rights are presumed to stay with the creator (Copyright Act Art. 61(2)).',
        '「' + label + '」の譲渡契約に27条・28条の記載がないため、翻案権等は創作者に留保されたと推定されます（著作権法61条2項）。', link));
      problems += 1;
    }
    if ((acq === 'assignment' || acq === 'exclusive_license' || acq === 'nonexclusive_license') && !a.getBool('moral_rights_waiver') && adaptation && visual) {
      out.push(check('chain', 'warn', 'No non-exercise of moral rights for "' + label + '": changes may need the creator\'s consent (Art. 20).', '「' + label + '」に著作者人格権不行使の定めがなく、改変には創作者の同意が必要な場合があります（20条）。', link));
      problems += 1;
    }
    if (a.getString('territory_limit')) {
      out.push(check('chain', 'info', '"' + label + '" is limited to: ' + a.getString('territory_limit') + '.', '「' + label + '」の利用範囲：' + a.getString('territory_limit') + '。', link));
    }
  }
  if (ctx.characters.length && ctx.assets.length === 0) {
    out.push(check('chain', 'warn', 'No rights stack is recorded for these characters. Add the design, model and voice layers.', 'キャラクターの権利構成が未登録です。デザイン・モデル・声の要素を登録してください。'));
  } else if (ctx.characters.length && problems === 0) {
    out.push(check('chain', 'ok', 'Every recorded character layer allows this use.', '登録済みのキャラクター要素はすべてこの利用を認めています。'));
  }
  return out;
}

function performerChecks(app, trees, ctx, cell, q) {
  const u = u_();
  const out = [];
  const media = expand(trees, 'media', cell.media || []);
  const soundOnly = q.includes_voice === true || media.some(function (m) {
    return SOUND_ONLY_MEDIA.indexOf(m) >= 0;
  });
  if (!soundOnly) {
    out.push(check('performer', 'na', 'Not needed. The use has no voice.', '不要です。音声を使用しません。'));
    return out;
  }
  for (const cast of ctx.castings) {
    const t = cast.talent;
    const link = [{ type: 'talent', id: t.id, label: t.getString('stage_name') }];
    if (t.getString('affiliation') === 'external') {
      const agency = t.getString('agency') ? u.byId(app, 'parties', t.getString('agency')) : null;
      out.push(check('performer', 'warn',
        'Sound-only use of ' + t.getString('stage_name') + '\'s performance needs fresh consent if it was recorded for a film (Copyright Act Art. 91(2)). Ask ' + (agency ? agency.getString('name') : 'the agency') + '.',
        t.getString('stage_name') + 'の実演を映画から音声のみで利用する場合は改めて許諾が必要です（著作権法91条2項）。' + (agency ? agency.getString('name') : '所属事務所') + 'に確認してください。', link));
    } else {
      out.push(check('performer', 'ok', t.getString('stage_name') + ' is our talent; the talent contract covers voice products.', t.getString('stage_name') + 'は所属タレントで、タレント契約がボイス商品をカバーしています。', link));
    }
  }
  if (!ctx.castings.length) out.push(check('performer', 'warn', 'No performer is cast for these characters; confirm who voices them.', 'キャラクターの演者が未登録です。担当声優を確認してください。'));
  return out;
}

function talentChecks(app, ctx, q) {
  const u = u_();
  const out = [];
  for (const cast of ctx.castings) {
    const t = cast.talent;
    const life = t.getString('lifecycle');
    const grad = u.d10(t.getString('graduation_date'));
    const link = [{ type: 'talent', id: t.id, label: t.getString('stage_name') }];
    if (life === 'graduated' || life === 'terminated' || life === 'alumni') {
      out.push(check('talent', 'block', t.getString('stage_name') + ' has ' + (life === 'terminated' ? 'left (contract terminated)' : 'graduated') + '. No new products.', t.getString('stage_name') + 'は' + (life === 'terminated' ? '契約解除' : '卒業') + '済みのため、新規商品は作れません。', link));
    } else if (life === 'graduation_announced' && grad !== '') {
      out.push(check('talent', grad < u.d10(q.end) ? 'block' : 'warn',
        t.getString('stage_name') + ' graduates on ' + u.human(grad) + '. Sales must stop by then.',
        t.getString('stage_name') + 'は' + u.humanJa(grad) + 'に卒業します。それまでに販売を終える必要があります。', link));
    } else if (life === 'suspended' || life === 'hiatus') {
      out.push(check('talent', 'warn', t.getString('stage_name') + ' is on ' + life + '.', t.getString('stage_name') + 'は' + (life === 'hiatus' ? '活動休止中' : '活動停止中') + 'です。', link));
    }
    const tc = u.findOne(app, 'agreements', 'agreement_type = "talent" && talent_approval_required = true && status = "active" && counterparty = {:p}', { p: t.getString('party') || '__none__' });
    if (tc !== null) {
      out.push(check('talent', 'warn', 'The talent contract requires ' + t.getString('stage_name') + '\'s approval.', 'タレント契約により' + t.getString('stage_name') + 'の確認が必要です。', [{ type: 'agreement', id: tc.id, label: tc.getString('ref') }]));
    }
  }
  return out;
}

const RANK = { block: 4, warn: 3, consent: 3, info: 1, ok: 0, na: 0 };

/**
 * The "Can we?" check. Same query as availability(), plus includes_voice.
 * Every cell gets: decider (or null), checks [{ key, level, text, links }],
 * trademark coverage, the copyright line and a verdict: yes | conditions | consent | no.
 */
function canWe(app, q) {
  const u = u_();
  const trees = dimTree(app);
  const grants = loadGrants(app, q.exclude_agreement || '');
  const base = availability(app, Object.assign({}, q, { trees: trees, grants: grants }));
  const filters = q.filters || {};
  const classes = classesFor(trees, filters);
  for (const row of base.rows) {
    const ctx = rowContext(app, row);
    for (const cell of row.cells) {
      const cellQ = {};
      cellQ[base.column] = [cell.code];
      for (const k of Object.keys(filters)) if (k !== base.column && Array.isArray(filters[k]) && filters[k].length) cellQ[k] = filters[k];
      const checks = [];
      // 1. Availability.
      if (cell.status === 'available') {
        checks.push(check('availability', 'ok', row.owned ? 'Free for the whole window. No conflicting grant or holdback.' : 'Covered by rights we acquired, with no conflict.', row.owned ? '期間全体で利用可能です。競合する許諾やホールドバックはありません。' : '取得済みの権利の範囲内で、競合はありません。'));
      } else {
        for (const r of cell.reasons) checks.push({ key: 'availability', level: cell.status === 'partial' ? 'warn' : 'block', text: r.text, links: r.agreement_id ? [{ type: 'agreement', id: r.agreement_id, label: r.ref }] : [] });
      }
      // 2. Who decides.
      let dec = null;
      if (ctx.committee) {
        dec = decider(app, trees, ctx.committee, cellQ, base.start, base.end, grants);
        if (dec) checks.push({ key: 'decider', level: dec.mode === 'window' || dec.mode === 'shared_window' ? 'ok' : dec.mode === 'conflict' ? 'block' : 'consent', text: dec.text, links: [{ type: 'committee', id: dec.committee.id, label: dec.committee.name }] });
      } else if (row.owned) {
        checks.push(check('decider', 'ok', 'We own it outright, so we decide.', '自社単独の権利のため、自社で判断できます。'));
      } else {
        const keySet = {};
        for (const k of lineage(app, row.type, row.id).keys) keySet[k] = true;
        const ins = grants.filter(function (g) {
          return g.direction === 'in' && g.kind === 'grant' && g.assets.some(function (k) { return keySet[k] === true; });
        });
        const noSub = ins.filter(function (g) {
          return !g.sublicense;
        });
        checks.push(check('decider', noSub.length ? 'warn' : 'ok',
          'Licensed in' + (noSub.length ? '; ' + noSub.map(function (g) { return g.agreement_ref; }).join(', ') + ' do not allow sublicensing, so the licensor must agree.' : '. Sublicensing is allowed.'),
          '他社からの許諾' + (noSub.length ? '。' + noSub.map(function (g) { return g.agreement_ref; }).join('、') + 'は再許諾不可のため、ライセンサーの同意が必要です。' : '。再許諾が認められています。')));
      }
      // 3. Upstream (original work), 4. chain of title, 5. performers, 6. talent status.
      for (const c of upstreamChecks(app, trees, ctx, cellQ, base.start, base.end)) checks.push(c);
      for (const c of chainChecks(app, trees, ctx, cellQ, q)) checks.push(c);
      for (const c of performerChecks(app, trees, ctx, cellQ, q)) checks.push(c);
      for (const c of talentChecks(app, ctx, q)) checks.push(c);
      // 7. Trademarks.
      let tm = null;
      if (base.column === 'territory' && classes.length) {
        tm = trademarkCover(app, trees, ctx, cell.code, classes);
        if (tm) {
          const missing = classes.filter(function (k) { return tm[k].state === 'missing'; });
          const pending = classes.filter(function (k) { return tm[k].state === 'pending'; });
          const reg = classes.filter(function (k) { return tm[k].state === 'registered'; });
          if (missing.length) {
            checks.push(check('trademark', 'warn',
              'Class ' + missing.join(', ') + ' not registered in ' + cell.label + '.' + (reg.length ? ' Class ' + reg.join(', ') + ' registered.' : '') + ' Counterfeits mailed from abroad can only be stopped with a registered trademark or design.',
              cell.label_ja + 'で第' + missing.join('・') + '類が未登録です。' + (reg.length ? '第' + reg.join('・') + '類は登録済み。' : '') + '海外からの模倣品は登録商標・意匠がないと差し止められません。'));
          } else if (pending.length) {
            checks.push(check('trademark', 'warn', 'Class ' + pending.join(', ') + ' still pending in ' + cell.label + '.', cell.label_ja + 'で第' + pending.join('・') + '類は審査中です。'));
          } else {
            checks.push(check('trademark', 'ok', 'Class ' + reg.join(', ') + ' registered in ' + cell.label + '.', cell.label_ja + 'で第' + reg.join('・') + '類は登録済みです。'));
          }
        }
      }
      // 8. Copyright line.
      const line = copyrightLine(app, ctx, cell.code);
      if (line) checks.push(check('copyright', 'info', line, line));
      // Verdict.
      let worst = 0;
      for (const c of checks) worst = Math.max(worst, RANK[c.level] || 0);
      const consent = dec && (dec.mode === 'consent' || dec.mode === 'partial');
      let verdict = 'yes';
      if (cell.status === 'unavailable' || cell.status === 'no_rights' || worst >= 4) verdict = 'no';
      else if (consent) verdict = 'consent';
      else if (worst >= 3 || cell.status === 'partial') verdict = 'conditions';
      cell.checks = checks;
      cell.decider = dec;
      cell.trademarks = tm;
      cell.copyright_line = line;
      cell.verdict = verdict;
    }
  }
  base.classes = classes;
  return base;
}

/**
 * Conflicts for an agreement's out-grants (saved or draft) against every
 * other counted agreement.
 */
function conflicts(app, agreementId, draftGrants) {
  const u = u_();
  const agr = agreementId ? u.byId(app, 'agreements', agreementId) : null;
  let mine = [];
  if (Array.isArray(draftGrants)) {
    mine = draftGrants.map(function (d, i) {
      const assets = [];
      for (const t of Object.keys(GRANT_FIELD)) for (const x of d[GRANT_FIELD[t]] || []) assets.push(t + ':' + x);
      return {
        index: i,
        direction: d.direction,
        kind: d.kind || 'grant',
        exclusive: d.exclusive === true,
        assets: assets,
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
          value_ja: cell.label_ja,
          status: cell.status,
          reasons: cell.reasons,
        });
      }
    }
  }
  return { conflicts: found, checked: mine.length };
}

/**
 * Server-side guard for an outbound grant: returns { en, ja } when it
 * conflicts with other agreements and no override reason was given, else null.
 */
function guardGrant(app, g) {
  const u = u_();
  if (g.getString('direction') !== 'out' || g.getString('kind') !== 'grant') return null;
  if (String(g.getString('override_reason')).trim() !== '') return null;
  const draft = {
    direction: 'out',
    kind: 'grant',
    exclusive: g.getBool('exclusive'),
    franchises: u.ids(g, 'franchises'),
    works: u.ids(g, 'works'),
    characters: u.ids(g, 'characters'),
    songs: u.ids(g, 'songs'),
    recordings: u.ids(g, 'recordings'),
    matters: u.ids(g, 'matters'),
    dims: u.j(g, 'dims', {}),
    term_start: g.getString('term_start'),
    term_end: g.getString('term_end'),
  };
  const res = conflicts(app, g.getString('agreement'), [draft]);
  if (!res.conflicts.length) return null;
  const first = res.conflicts[0];
  const why = first.reasons && first.reasons[0] && first.reasons[0].text ? first.reasons[0].text : { en: '', ja: '' };
  const n = res.conflicts.length;
  return {
    en: 'This grant conflicts with other agreements (' + n + ' cell' + (n === 1 ? '' : 's') + ', for example ' + first.asset + ' in ' + first.value + ': ' + (why.en || '') + ') Give an override reason to save it anyway.',
    ja: 'この許諾は他の契約と競合しています（' + n + '件。例：' + first.asset + '、' + first.value + '：' + (why.ja || why.en || '') + '）。保存するには優先する理由を入力してください。',
  };
}

/** Trademark coverage matrix for a character, talent or franchise: classes by jurisdiction. */
function coverageMatrix(app, subject) {
  const u = u_();
  const field = subject.type === 'talent' ? 'talent' : subject.type === 'franchise' ? 'franchise' : 'character';
  const marks = u.findMany(app, 'matters', 'ip_type = "trademark" && ' + field + ' = {:id}', '', 0, { id: subject.id });
  const jurs = {};
  const classes = {};
  const cells = {};
  for (const m of marks) {
    const j = m.getString('jurisdiction').toUpperCase();
    const group = m.getString('status_group');
    jurs[j] = true;
    for (const g of u.findMany(app, 'goods_services', 'matter = {:m}', '', 0, { m: m.id })) {
      const k = g.getInt('nice_class');
      classes[k] = true;
      const key = k + ':' + j;
      const st = g.getString('class_status');
      let state = 'missing';
      if (group !== 'dead' && st !== 'deleted' && st !== 'cancelled' && st !== 'refused') state = group === 'live' ? 'registered' : 'pending';
      const prev = cells[key] ? cells[key].state : 'missing';
      const rank = { registered: 3, pending: 2, missing: 1 };
      if (!cells[key] || rank[state] > rank[prev]) {
        cells[key] = { state: state, matter: m.id, ref: m.getString('ref'), last_use: u.d10(m.getString('last_use_evidence')) };
      }
    }
  }
  // Licensed categories and territories that have no mark behind them.
  const gaps = [];
  const trees = dimTree(app);
  const assetKey = subject.type + ':' + subject.id;
  for (const g of loadGrants(app, '')) {
    if (g.direction !== 'out' || g.kind !== 'grant') continue;
    if (g.assets.indexOf(assetKey) < 0) continue;
    const cats = g.dims.category && Array.isArray(g.dims.category.include) ? g.dims.category.include : [];
    const terrs = g.dims.territory && Array.isArray(g.dims.territory.include) ? g.dims.territory.include : [];
    const ks = classesFor(trees, { category: cats, media: g.dims.media && g.dims.media.include ? g.dims.media.include : [] });
    for (const t of terrs) {
      if (t.length !== 2) continue;
      for (const k of ks) {
        const c = cells[k + ':' + t] || (EU_MEMBERS.indexOf(t) >= 0 ? cells[k + ':EM'] : null);
        if (!c || c.state === 'missing') gaps.push({ class: k, territory: t, agreement_id: g.agreement_id, ref: g.agreement_ref });
      }
    }
  }
  return {
    jurisdictions: Object.keys(jurs).sort(),
    classes: Object.keys(classes)
      .map(Number)
      .sort(function (a, b) {
        return a - b;
      }),
    cells: cells,
    gaps: gaps,
  };
}

module.exports = {
  dimTree: dimTree,
  coverage: coverage,
  specLabel: specLabel,
  lineage: lineage,
  availability: availability,
  canWe: canWe,
  decider: decider,
  conflicts: conflicts,
  guardGrant: guardGrant,
  loadGrants: loadGrants,
  coverageMatrix: coverageMatrix,
  classesFor: classesFor,
};
