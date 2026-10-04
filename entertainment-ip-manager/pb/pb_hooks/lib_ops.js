/// <reference path="../pb_data/types.d.ts" />
/**
 * Shared plumbing for the /api/ops/* routes: one guard, one error shape.
 *
 *   routerAdd('POST', '/api/ops/x', (e) =>
 *     require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => { ... return result; }));
 *
 * The handler gets the parsed body and { u, actor, auth, role, lang }.
 * Throwing u.err(en, ja) returns 400 { error, error_ja }.
 * Every param may arrive as a string (the agent-app CLI sends strings), so
 * handlers coerce with num(), bool(), list() and obj().
 */

function handle(e, level, fn, status) {
  const u = require(`${__hooks}/lib_util.js`);
  if (u.deny(e, level)) return;
  const ctx = {
    u: u,
    actor: u.actorId(e),
    auth: e.auth,
    role: u.roleOf(e.auth),
    lang: u.langOfAuth(e.app, e.auth),
    superuser: u.isSuperuser(e.auth),
  };
  try {
    // Names and references are for staff and agents; portal accounts pass ids (no probing by name).
    const res = fn(u.isExternal(e.auth) ? u.body(e) : resolveParams(e.app, u.body(e)), ctx);
    return e.json(status || 200, res === undefined ? { ok: true } : res);
  } catch (err) {
    return u.fail(e, err);
  }
}

/** Body params that name a record, and the collection each points at. */
const ID_PARAMS = {
  franchise_id: 'franchises',
  character_id: 'characters',
  talent_id: 'talents',
  work_id: 'titles',
  title_id: 'titles',
  song_id: 'songs',
  recording_id: 'recordings',
  agreement_id: 'agreements',
  exclude_agreement: 'agreements',
  committee_id: 'committees',
  member_id: 'committee_members',
  product_id: 'products',
  approval_id: 'approvals',
  matter_id: 'matters',
  family_id: 'families',
  case_id: 'enforcement_cases',
  permission_id: 'permissions',
  guideline_id: 'guidelines',
  template_id: 'guidelines',
  registration_id: 'fan_registrations',
  report_id: 'royalty_reports',
  order_id: 'seal_orders',
  distribution_id: 'distributions',
  request_id: 'consent_requests',
  claim_id: 'content_id_claims',
  document_id: 'documents',
  rule_id: 'rules',
};

/**
 * Turn every record-naming param (character_id: "Hikari", agreement_id:
 * "AG-0002") into the record id before the op runs, so all ops accept ids,
 * references and exact names alike. A name that matches nothing is an error
 * here rather than an empty result later.
 */
function resolveParams(app, body) {
  const u = require(`${__hooks}/lib_util.js`);
  const b = body || {};
  for (const key of Object.keys(ID_PARAMS)) {
    const v = b[key];
    if (typeof v !== 'string' || v.trim() === '') continue;
    const rec = resolve(app, ID_PARAMS[key], v);
    if (rec === null) {
      throw u.err(
        key + ': nothing matches "' + v + '". Give the id, reference or exact name.',
        key + '：「' + v + '」に該当する記録がありません。ID、整理番号、または正確な名称で指定してください。',
      );
    }
    b[key] = rec.id;
  }
  return b;
}

function num(v, fallback) {
  if (v === undefined || v === null || v === '') return fallback === undefined ? 0 : fallback;
  const n = Number(v);
  return isNaN(n) ? (fallback === undefined ? 0 : fallback) : n;
}

function bool(v) {
  return v === true || v === 'true' || v === 1 || v === '1' || v === 'yes';
}

function list(v) {
  return require(`${__hooks}/lib_util.js`).asArray(v);
}

function obj(v) {
  return require(`${__hooks}/lib_util.js`).asObject(v);
}

function str(v) {
  return v === undefined || v === null ? '' : String(v).trim();
}

/**
 * Fields a record can be named by, per collection, tried in order after the
 * id. Lets every op take "AG-0002", "Hikari" or "2024-012345" where it asks
 * for an id (agents know names, not ids). Exact match, case-insensitive;
 * number-like fields also match ignoring spaces and punctuation.
 */
const NAME_FIELDS = {
  franchises: ['name'],
  titles: ['title'],
  characters: ['name', '@names'],
  talents: ['stage_name', '@names'],
  songs: ['title', '#iswc'],
  recordings: ['title', '#isrc'],
  releases: ['title', '#upc', '#catalogue_no'],
  agreements: ['ref', 'title'],
  committees: ['name'],
  committee_members: ['name'],
  products: ['ref', 'name', '#sku', '#jan'],
  matters: ['ref', '#application_no', '#registration_no', 'title'],
  families: ['title'],
  enforcement_cases: ['ref', 'title'],
  parties: ['name', 'name_kana'],
  permissions: ['title'],
  guidelines: ['title'],
  fan_registrations: ['permission_no', 'applicant_name'],
  society_contracts: ['member_no'],
  society_registrations: ['#work_code'],
  content_id_assets: ['asset_id'],
  content_id_claims: ['video_url'],
  cid_allowlist: ['channel_id', 'name'],
  platform_enrollments: ['account_id'],
  customs_recordations: ['#application_no'],
  watch_hits: ['their_mark'],
  character_assets: ['label'],
  clearances: ['title'],
  documents: ['title'],
  consent_requests: ['subject'],
  rules: ['code'],
  users: ['email', 'name'],
  dimension_values: ['code'],
};

const DISPLAY_FIELDS = ['ref', 'name', 'title', 'stage_name', 'label', 'subject', 'applicant_name', 'their_mark', 'email', 'code'];

/** A short label for a record (for messages and previews). */
function labelOf(rec) {
  for (const f of DISPLAY_FIELDS) {
    let v = '';
    try {
      v = rec.getString(f);
    } catch {
      v = '';
    }
    if (v) return v;
  }
  return rec.id;
}

function normKey(v) {
  return String(v || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
}

/**
 * Find one record of `coll` by id, reference or exact name. Returns null
 * when nothing matches; throws a bilingual error listing the candidates when
 * the name is ambiguous.
 */
function resolve(app, coll, value) {
  const u = require(`${__hooks}/lib_util.js`);
  const raw = String(value === undefined || value === null ? '' : value).trim();
  if (raw === '') return null;
  const byId = u.byId(app, coll, raw);
  if (byId !== null) return byId;
  const fields = NAME_FIELDS[coll] || [];
  const lower = raw.toLowerCase();
  const key = normKey(raw);
  for (const spec of fields) {
    const json = spec.charAt(0) === '@';
    const numeric = spec.charAt(0) === '#';
    const field = json || numeric ? spec.slice(1) : spec;
    let candidates = [];
    try {
      // Text: `~` narrows on the server (contains, case-insensitive). Numbers are
      // stored in any format (2024-012345, 2024012345), so compare them all here.
      candidates = numeric ? u.findMany(app, coll, field + ' != ""', '', 0) : u.findMany(app, coll, field + ' ~ {:v}', '', 50, { v: raw });
    } catch {
      candidates = [];
    }
    const hits = candidates.filter((r) => {
      if (json) {
        const list = u.j(r, field, []);
        return Array.isArray(list) && list.some((x) => x && String(x.value || x.name || x).toLowerCase() === lower);
      }
      const v = r.getString(field);
      return numeric ? key !== '' && normKey(v) === key : v.toLowerCase() === lower;
    });
    if (hits.length === 1) return hits[0];
    if (hits.length > 1) {
      const list = hits.slice(0, 8).map((r) => labelOf(r) + ' (' + r.id + ')').join(', ');
      throw u.err(
        '"' + raw + '" matches ' + hits.length + ' ' + coll + ': ' + list + '. Use the id.',
        '「' + raw + '」に該当する記録が' + hits.length + '件あります：' + list + '。IDで指定してください。',
      );
    }
  }
  return null;
}

/**
 * Load a record by id, reference or exact name, or throw a bilingual "not found".
 * idOnly (portal accounts): ids only, so nobody can probe other companies' records by name.
 */
function need(app, coll, id, en, ja, idOnly) {
  const u = require(`${__hooks}/lib_util.js`);
  const rec = idOnly ? (id ? u.byId(app, coll, String(id)) : null) : resolve(app, coll, id);
  if (rec === null) {
    const what = String(id === undefined || id === null ? '' : id).trim();
    throw u.err(
      (en || 'Record') + (what ? ' "' + what + '"' : '') + ' not found. Give its id, reference or exact name.',
      (ja || '記録') + (what ? '「' + what + '」' : '') + 'が見つかりません。ID、整理番号、または正確な名称で指定してください。',
    );
  }
  return rec;
}

/** The subject of an event or manual deadline: { type, id } from the body. */
function subjectFrom(app, b) {
  const u = require(`${__hooks}/lib_util.js`);
  const engine = require(`${__hooks}/lib_engine.js`);
  let type = str(b.subject_type);
  let id = str(b.subject_id);
  if (!type) {
    for (const t of Object.keys(engine.SUBJECTS)) {
      const key = t === 'case' ? 'case_id' : t + '_id';
      if (b[key]) {
        type = t;
        id = str(b[key]);
        break;
      }
    }
  }
  if (type === 'trademark' || type === 'design') type = 'matter';
  if (!engine.SUBJECTS[type]) throw u.err('Say which record this is about (subject_type and subject_id).', '対象の記録を指定してください（subject_type と subject_id）。');
  const rec = resolve(app, engine.SUBJECTS[type].coll, id);
  if (rec === null) throw u.err('No ' + type + ' "' + id + '" was found. Give its id, reference or exact name.', '対象の記録「' + id + '」が見つかりません。ID、整理番号、または正確な名称で指定してください。');
  return engine.subjectFromRecord(type, rec);
}

/** Records an external account acts for: parties whose portal_users include it. */
function partiesOf(app, auth) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!auth || u.isSuperuser(auth)) return [];
  return u.findMany(app, 'parties', 'portal_users.id ?= {:u}', '', 0, { u: auth.id });
}

module.exports = {
  NAME_FIELDS: NAME_FIELDS,
  resolve: resolve,
  labelOf: labelOf,
  handle: handle,
  num: num,
  bool: bool,
  list: list,
  obj: obj,
  str: str,
  need: need,
  subjectFrom: subjectFrom,
  partiesOf: partiesOf,
};
