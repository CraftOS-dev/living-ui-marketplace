/**
 * Intro paths (REPORT Table 33; design inference from Affinity's ranked paths).
 *
 * A path runs from a member of the firm to a target person:
 *   direct   member -> target
 *   one hop  member -> connector -> target
 * Every direct path ranks before every one-hop path. Inside each group a path
 * is scored by its weakest edge (higher first); ties go to the most recent
 * contact, where a path's contact day is the OLDEST last contact along it (a
 * path is only as fresh as its stalest edge); then ids, so the order is stable.
 * Edges with score 0 are not relationships and never make a path.
 *
 * Pure: no PocketBase globals.
 */

let _c = null;
function C() {
  if (_c === null) _c = require((typeof __hooks === 'string' ? __hooks : __dirname) + '/lib_eng_core.js');
  return _c;
}

function atMs(x) {
  return C().isNil(x) || x === '' ? -Infinity : C().instant(x, 'last_at');
}

function minAt(a, b) {
  return atMs(a) <= atMs(b) ? a : b;
}

function checkEdge(e, where, a, b) {
  const c = C();
  if (c.isNil(e) || c.isNil(e[a]) || c.isNil(e[b]) || String(e[a]) === '' || String(e[b]) === '') throw c.fail(400, where + ' needs ' + a + ' and ' + b, 'invalid_edge', { where: where });
  if (typeof e.score !== 'number' || !isFinite(e.score) || e.score < 0 || e.score > 100) throw c.fail(400, where + '.score must be 0 to 100', 'invalid_edge', { where: where });
}

/**
 * Rank the paths to a target (a person, or a company's people).
 * input: {
 *   targets: [personId],                                   // the person, or the company's people
 *   member_edges: [{ member, person, score, last_at }],    // lib_eng_strength edges
 *   links: [{ a, b, score, last_at }],                     // person-to-person ties (either direction)
 *   limit: 20
 * }
 * -> [{ kind: 'direct'|'one_hop', member, connector|null, target,
 *       path: [{ member }, { person }...], edges: [{ from, to, score, last_at }],
 *       weakest, last_at }]
 */
function rank(input) {
  const c = C();
  const x = input || {};
  const targets = {};
  for (const t of Array.isArray(x.targets) ? x.targets : []) targets[String(t)] = true;
  const memberEdges = Array.isArray(x.member_edges) ? x.member_edges : [];
  const links = Array.isArray(x.links) ? x.links : [];
  const limit = c.isNil(x.limit) ? 20 : x.limit;
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 1 || limit > 500) throw c.fail(400, 'limit must be 1 to 500', 'invalid_param', { field: 'limit' });

  // The strongest tie between two people, either direction.
  const tie = {};
  links.forEach((l, i) => {
    checkEdge(l, 'links[' + i + ']', 'a', 'b');
    const a = String(l.a);
    const b = String(l.b);
    if (a === b || l.score <= 0) return;
    for (const k of [a + '\u0000' + b, b + '\u0000' + a]) {
      const cur = tie[k];
      if (cur === undefined || l.score > cur.score || (l.score === cur.score && atMs(l.last_at) > atMs(cur.last_at))) tie[k] = { score: l.score, last_at: c.isNil(l.last_at) ? null : l.last_at };
    }
  });
  // Ties of each connector to targets.
  const toTargets = {};
  Object.keys(tie).forEach((k) => {
    const parts = k.split('\u0000');
    if (targets[parts[1]] && !targets[parts[0]]) {
      if (toTargets[parts[0]] === undefined) toTargets[parts[0]] = [];
      toTargets[parts[0]].push({ target: parts[1], score: tie[k].score, last_at: tie[k].last_at });
    }
  });

  const seen = {};
  const out = [];
  memberEdges.forEach((e, i) => {
    checkEdge(e, 'member_edges[' + i + ']', 'member', 'person');
    if (e.score <= 0) return;
    const m = String(e.member);
    const p = String(e.person);
    const at = c.isNil(e.last_at) ? null : e.last_at;
    if (targets[p]) {
      const key = 'd\u0000' + m + '\u0000' + p;
      if (seen[key] !== undefined && out[seen[key]].weakest >= e.score) return;
      const row = { kind: 'direct', member: m, connector: null, target: p, path: [{ member: m }, { person: p }], edges: [{ from: m, to: p, score: e.score, last_at: at }], weakest: e.score, last_at: at };
      if (seen[key] !== undefined) out[seen[key]] = row;
      else {
        seen[key] = out.length;
        out.push(row);
      }
      return;
    }
    for (const tt of toTargets[p] || []) {
      const key = 'h\u0000' + m + '\u0000' + p + '\u0000' + tt.target;
      const weakest = Math.min(e.score, tt.score);
      if (seen[key] !== undefined && out[seen[key]].weakest >= weakest) continue;
      const row = {
        kind: 'one_hop',
        member: m,
        connector: p,
        target: tt.target,
        path: [{ member: m }, { person: p }, { person: tt.target }],
        edges: [
          { from: m, to: p, score: e.score, last_at: at },
          { from: p, to: tt.target, score: tt.score, last_at: tt.last_at },
        ],
        weakest: weakest,
        last_at: minAt(at, tt.last_at),
      };
      if (seen[key] !== undefined) out[seen[key]] = row;
      else {
        seen[key] = out.length;
        out.push(row);
      }
    }
  });

  out.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'direct' ? -1 : 1;
    if (a.weakest !== b.weakest) return b.weakest - a.weakest;
    const ta = atMs(a.last_at);
    const tb = atMs(b.last_at);
    if (ta !== tb) return tb > ta ? 1 : -1;
    const ka = a.member + '\u0000' + (a.connector || '') + '\u0000' + a.target;
    const kb = b.member + '\u0000' + (b.connector || '') + '\u0000' + b.target;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
  return out.slice(0, limit);
}

module.exports = { rank: rank };
