/// <reference path="../pb_data/types.d.ts" />
/**
 * Deleting records safely, for people (the delete buttons) and agents (the
 * records.delete op) alike.
 *
 * A delete in PocketBase follows the schema: relations marked cascade take
 * their records with them (an agreement takes its grants, deadlines, events
 * and statements; a statement takes its lines); other relations simply lose
 * the reference (a product keeps existing without its agreement). impact()
 * walks both so a person or agent sees exactly what a delete does before it
 * happens. Nothing here bypasses the role a collection's delete needs.
 */

/** What may be deleted through records.delete, and the role level each needs. */
const DELETABLE = {
  franchises: 'manage',
  titles: 'manage',
  characters: 'manage',
  character_assets: 'manage',
  castings: 'manage',
  talents: 'manage',
  talent_identity: 'admin',
  committees: 'manage',
  committee_members: 'manage',
  consent_requests: 'manage',
  distributions: 'manage',
  agreements: 'manage',
  grants: 'manage',
  songs: 'manage',
  recordings: 'manage',
  releases: 'manage',
  society_contracts: 'manage',
  society_registrations: 'manage',
  content_id_assets: 'manage',
  content_id_claims: 'manage',
  cid_allowlist: 'manage',
  permissions: 'manage',
  guidelines: 'manage',
  fan_registrations: 'manage',
  products: 'manage',
  approvals: 'manage',
  approval_rounds: 'manage',
  seal_orders: 'manage',
  royalty_reports: 'manage',
  royalty_lines: 'manage',
  families: 'manage',
  matters: 'manage',
  goods_services: 'manage',
  renewals: 'manage',
  enforcement_cases: 'manage',
  evidence: 'admin',
  platform_enrollments: 'manage',
  customs_recordations: 'manage',
  watch_hits: 'manage',
  parties: 'manage',
  involvements: 'manage',
  documents: 'manage',
  clearances: 'manage',
  events: 'manage',
  deadlines: 'admin',
  inbox_items: 'admin',
  rules: 'admin',
  fee_schedule: 'manage',
  fx_rates: 'manage',
  office_calendars: 'manage',
  dimension_values: 'manage',
  users: 'admin',
};

/** Friendly names an agent may use for a collection. */
const ALIASES = {
  franchise: 'franchises',
  title: 'titles',
  work: 'titles',
  character: 'characters',
  character_asset: 'character_assets',
  layer: 'character_assets',
  casting: 'castings',
  talent: 'talents',
  committee: 'committees',
  committee_member: 'committee_members',
  member: 'committee_members',
  consent_request: 'consent_requests',
  distribution: 'distributions',
  agreement: 'agreements',
  grant: 'grants',
  window: 'grants',
  song: 'songs',
  recording: 'recordings',
  release: 'releases',
  society_contract: 'society_contracts',
  society_registration: 'society_registrations',
  registration: 'society_registrations',
  content_id_asset: 'content_id_assets',
  content_id_claim: 'content_id_claims',
  claim: 'content_id_claims',
  permission: 'permissions',
  guideline: 'guidelines',
  fan_registration: 'fan_registrations',
  fan_permit: 'fan_registrations',
  product: 'products',
  approval: 'approvals',
  approval_round: 'approval_rounds',
  seal_order: 'seal_orders',
  royalty_report: 'royalty_reports',
  statement: 'royalty_reports',
  royalty_line: 'royalty_lines',
  family: 'families',
  matter: 'matters',
  trademark: 'matters',
  design: 'matters',
  goods_service: 'goods_services',
  class: 'goods_services',
  renewal: 'renewals',
  case: 'enforcement_cases',
  enforcement_case: 'enforcement_cases',
  platform_enrollment: 'platform_enrollments',
  enrollment: 'platform_enrollments',
  customs_recordation: 'customs_recordations',
  recordation: 'customs_recordations',
  watch_hit: 'watch_hits',
  party: 'parties',
  person: 'parties',
  company: 'parties',
  involvement: 'involvements',
  document: 'documents',
  clearance: 'clearances',
  event: 'events',
  deadline: 'deadlines',
  inbox_item: 'inbox_items',
  rule: 'rules',
  fee: 'fee_schedule',
  fx_rate: 'fx_rates',
  calendar_day: 'office_calendars',
  dimension_value: 'dimension_values',
  user: 'users',
};

/** Collection names in both languages (singular, plural) for previews and messages. */
const LABEL = {
  franchises: ['franchise', 'franchises', 'フランチャイズ'],
  titles: ['title', 'titles', '作品'],
  characters: ['character', 'characters', 'キャラクター'],
  character_assets: ['rights layer', 'rights layers', '権利構成の要素'],
  castings: ['casting', 'castings', 'キャスティング'],
  talents: ['talent', 'talents', 'タレント'],
  talent_identity: ['identity record', 'identity records', '本人情報'],
  committees: ['committee', 'committees', '製作委員会'],
  committee_members: ['committee member', 'committee members', '委員会構成員'],
  consent_requests: ['consent request', 'consent requests', '同意依頼'],
  distributions: ['distribution statement', 'distribution statements', '分配明細'],
  agreements: ['agreement', 'agreements', '契約'],
  grants: ['grant', 'grants', '許諾範囲'],
  songs: ['song', 'songs', '楽曲'],
  recordings: ['recording', 'recordings', '原盤'],
  releases: ['release', 'releases', 'リリース'],
  society_contracts: ['society contract', 'society contracts', '管理団体との契約'],
  society_registrations: ['society registration', 'society registrations', '作品届'],
  content_id_assets: ['Content ID asset', 'Content ID assets', 'Content IDアセット'],
  content_id_claims: ['Content ID claim', 'Content ID claims', 'Content IDの申し立て'],
  cid_allowlist: ['allowlisted channel', 'allowlisted channels', '許可リストのチャンネル'],
  permissions: ['permission', 'permissions', '利用許諾'],
  guidelines: ['guideline', 'guidelines', 'ガイドライン'],
  fan_registrations: ['fan permit', 'fan permits', 'ファン許諾'],
  products: ['product', 'products', '商品'],
  approvals: ['approval', 'approvals', '監修'],
  approval_rounds: ['approval round', 'approval rounds', '監修の履歴'],
  seal_orders: ['seal order', 'seal orders', '証紙申請'],
  royalty_reports: ['royalty statement', 'royalty statements', 'ロイヤリティ報告'],
  royalty_lines: ['statement line', 'statement lines', '報告明細'],
  families: ['mark family', 'mark families', '商標ファミリー'],
  matters: ['trademark or design', 'trademarks and designs', '商標・意匠'],
  goods_services: ['class', 'classes', '区分'],
  renewals: ['renewal', 'renewals', '更新'],
  enforcement_cases: ['case', 'cases', '案件'],
  evidence: ['evidence item', 'evidence items', '証拠'],
  platform_enrollments: ['platform programme', 'platform programmes', 'プラットフォームの登録'],
  customs_recordations: ['customs recordation', 'customs recordations', '税関登録'],
  watch_hits: ['watch hit', 'watch hits', 'ウォッチの検出'],
  parties: ['person or company', 'people and companies', '取引先・関係者'],
  involvements: ['credit or role', 'credits and roles', '関与'],
  documents: ['document', 'documents', '書類'],
  clearances: ['clearance item', 'clearance items', '権利処理項目'],
  events: ['event', 'events', 'イベント'],
  deadlines: ['deadline', 'deadlines', '期限'],
  inbox_items: ['Inbox item', 'Inbox items', '受信トレイの項目'],
  rules: ['rule', 'rules', 'ルール'],
  fee_schedule: ['fee', 'fees', '料金'],
  fx_rates: ['exchange rate', 'exchange rates', '為替レート'],
  office_calendars: ['calendar day', 'calendar days', '休日カレンダーの日'],
  dimension_values: ['dimension value', 'dimension values', '権利範囲の値'],
  users: ['user', 'users', 'ユーザー'],
  notifications: ['notification', 'notifications', '通知'],
  ics_tokens: ['calendar feed', 'calendar feeds', 'カレンダー連携'],
  saved_views: ['saved view', 'saved views', '保存した表示'],
};

/** Bookkeeping that links to records but is not shown in a delete preview (the audit log keeps its actor link). */
const QUIET = { audit_log: true };

function canonical(name) {
  const n = String(name || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (DELETABLE[n]) return n;
  if (ALIASES[n]) return ALIASES[n];
  if (n.slice(-1) === 's' && ALIASES[n.slice(0, -1)]) return ALIASES[n.slice(0, -1)];
  return '';
}

function words(coll, n) {
  const l = LABEL[coll] || [coll, coll, coll];
  return { en: n + ' ' + (n === 1 ? l[0] : l[1]), ja: l[2] + n + '件' };
}

function fieldProp(f, prop) {
  const v = f[prop];
  return typeof v === 'function' ? v.call(f) : v;
}

/** Every relation field that points at `collId`: [{ coll, field, multi, cascade }]. */
function referencesTo(app, collId) {
  const out = [];
  const cols = app.findAllCollections();
  for (let i = 0; i < cols.length; i++) {
    const col = cols[i];
    const name = col.name;
    if (!name || name.charAt(0) === '_' || QUIET[name]) continue;
    const fields = col.fields;
    for (let j = 0; j < fields.length; j++) {
      const f = fields[j];
      if (fieldProp(f, 'type') !== 'relation') continue;
      if (fieldProp(f, 'collectionId') !== collId) continue;
      out.push({ coll: name, field: fieldProp(f, 'name'), multi: Number(fieldProp(f, 'maxSelect')) > 1, cascade: !!fieldProp(f, 'cascadeDelete') });
    }
  }
  return out;
}

/**
 * What deleting `rec` does: { deletes: { coll: count }, unlinks: { coll: count } }.
 * Cascades are followed two levels deep (an agreement's deadlines take their renewals).
 */
function impact(app, rec, depth, acc) {
  const u = require(`${__hooks}/lib_util.js`);
  const out = acc || { deletes: {}, unlinks: {} };
  const level = depth || 0;
  const col = rec.collection();
  for (const ref of referencesTo(app, col.id)) {
    const filter = ref.multi ? ref.field + '.id ?= {:id}' : ref.field + ' = {:id}';
    let rows = [];
    try {
      rows = u.findMany(app, ref.coll, filter, '', 0, { id: rec.id });
    } catch {
      rows = [];
    }
    if (!rows.length) continue;
    if (ref.cascade) {
      out.deletes[ref.coll] = (out.deletes[ref.coll] || 0) + rows.length;
      if (level < 2) for (const r of rows.slice(0, 300)) impact(app, r, level + 1, out);
    } else {
      out.unlinks[ref.coll] = (out.unlinks[ref.coll] || 0) + rows.length;
    }
  }
  return out;
}

/** The impact as two bilingual lists for people and agents. */
function describe(app, coll, rec) {
  const ops = require(`${__hooks}/lib_ops.js`);
  const imp = impact(app, rec);
  const del = Object.keys(imp.deletes).map((c) => Object.assign({ collection: c, count: imp.deletes[c] }, { text: words(c, imp.deletes[c]) }));
  const unl = Object.keys(imp.unlinks).map((c) => Object.assign({ collection: c, count: imp.unlinks[c] }, { text: words(c, imp.unlinks[c]) }));
  const l = LABEL[coll] || [coll, coll, coll];
  return {
    collection: coll,
    id: rec.id,
    label: ops.labelOf(rec),
    kind: { en: l[0], ja: l[2] },
    also_deletes: del,
    unlinks: unl,
  };
}

module.exports = {
  DELETABLE: DELETABLE,
  ALIASES: ALIASES,
  LABEL: LABEL,
  canonical: canonical,
  impact: impact,
  describe: describe,
};
