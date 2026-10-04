/**
 * The one status-colour language (tones) and the label tables that are not
 * select fields. Select-field labels live in enums.ts (generated) and render
 * through enumLabel(); status tones through toneOf(). Structural tables
 * only: no string matching.
 */
import { t } from './i18n.ts';
import { isJa } from './i18n.ts';
import type { ModuleKey, Role } from './shapes.ts';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';

/** Tone of a select value, by "collection.field". Unlisted values are neutral. */
const TONES: Record<string, Record<string, Tone>> = {
  'matters.status_group': { live: 'good', pending: 'info', pre_filing: 'neutral', dead: 'neutral' },
  'matters.status': {
    to_file: 'neutral', filed: 'info', published: 'info', examination: 'info', office_action: 'warn', allowed: 'info', opposed: 'warn',
    registered: 'good', in_grace: 'warn', cancelled: 'neutral', lapsed: 'neutral', abandoned: 'neutral', withdrawn: 'neutral',
    refused: 'bad', expired: 'neutral', revoked: 'bad', transferred_out: 'neutral',
  },
  'agreements.status': { draft: 'neutral', negotiating: 'info', active: 'good', renewed: 'good', expired: 'neutral', terminated: 'bad', superseded: 'neutral' },
  'approvals.status': { submitted: 'info', in_review: 'info', changes_requested: 'warn', approved: 'good', rejected: 'bad', withdrawn: 'neutral' },
  'approval_rounds.status': { submitted: 'info', in_review: 'info', changes_requested: 'warn', approved: 'good', rejected: 'bad', withdrawn: 'neutral' },
  'products.stage': {
    proposal: 'info', contract: 'info', concept: 'info', design: 'info', prototype: 'info', final_sample: 'info', packaging: 'info',
    mass_production: 'accent', on_sale: 'good', sell_off: 'warn', ended: 'neutral', cancelled: 'neutral',
  },
  'talents.lifecycle': {
    audition: 'neutral', pre_debut: 'info', active: 'good', hiatus: 'warn', suspended: 'bad', graduation_announced: 'warn',
    graduated: 'neutral', terminated: 'bad', alumni: 'neutral',
  },
  'characters.status': { development: 'info', active: 'good', hiatus: 'warn', retired: 'neutral', archived: 'neutral' },
  'franchises.status': { development: 'info', active: 'good', dormant: 'warn', retired: 'neutral' },
  'titles.status': { development: 'info', production: 'info', announced: 'accent', released: 'good', archived: 'neutral' },
  'committees.status': { forming: 'info', formed: 'info', production: 'info', exploiting: 'good', term_review: 'warn', dissolved: 'neutral', consolidated: 'neutral' },
  'committee_members.status': { active: 'good', transferred: 'neutral', insolvent: 'bad', exited: 'neutral' },
  'royalty_reports.status': { expected: 'info', received: 'accent', paid: 'good', disputed: 'bad', waived: 'neutral' },
  'seal_orders.status': { requested: 'info', issued: 'accent', reconciled: 'good', cancelled: 'neutral' },
  'consent_requests.status': { open: 'info', approved: 'good', refused: 'bad', withdrawn: 'neutral', expired: 'neutral' },
  'distributions.status': { draft: 'neutral', issued: 'info', paid: 'good' },
  'enforcement_cases.status': {
    new: 'info', investigating: 'info', notice_sent: 'warn', takedown_requested: 'warn', removed: 'good', counter_noticed: 'bad',
    disclosure_requested: 'warn', complaint_filed: 'warn', litigation: 'bad', settled: 'good', won: 'good', lost: 'bad', closed: 'neutral', monitoring: 'info',
  },
  'permissions.status': { active: 'good', pending_application: 'warn', expired: 'neutral', revoked: 'bad', suspended: 'bad' },
  'fan_registrations.status': { applied: 'info', approved: 'good', active: 'good', rejected: 'neutral', suspended: 'warn', expired: 'neutral', revoked: 'bad' },
  'guidelines.status': { draft: 'neutral', published: 'good', superseded: 'neutral' },
  'inbox_items.status': { new: 'info', accepted: 'good', partially_accepted: 'good', rejected: 'neutral', awaiting_second: 'warn' },
  'renewals.decision': { pending: 'warn', renew: 'good', renew_partial: 'good', lapse: 'neutral', defer: 'info' },
  'renewals.instruction_status': { not_instructed: 'neutral', instructed: 'info', confirmed: 'good', paid: 'good', lapsed: 'neutral' },
  'watch_hits.status': { new: 'info', reviewing: 'info', dismissed: 'neutral', monitor: 'warn', escalated: 'bad', actioned: 'good' },
  'songs.status': { draft: 'neutral', splits_pending: 'warn', registered: 'good', released: 'good', archived: 'neutral' },
  'recordings.status': { draft: 'neutral', mixing: 'info', mastered: 'info', released: 'good', archived: 'neutral' },
  'releases.status': { planned: 'neutral', scheduled: 'info', released: 'good', withdrawn: 'neutral' },
  'society_registrations.status': { draft: 'neutral', submitted: 'info', code_issued: 'info', registered: 'good', disputed: 'bad', withheld: 'warn' },
  'content_id_claims.status': { open: 'info', disputed: 'warn', appealed: 'warn', released: 'good', upheld: 'bad', expired: 'neutral', resolved: 'good' },
  'content_id_assets.status': { active: 'good', inactive: 'neutral', conflict: 'bad' },
  'platform_enrollments.status': { not_enrolled: 'neutral', applying: 'info', active: 'good', suspended: 'bad', expired: 'warn' },
  'customs_recordations.status': { preparing: 'neutral', filed: 'info', accepted: 'good', expired: 'warn', withdrawn: 'neutral' },
  'clearances.status': {
    not_started: 'neutral', requested: 'info', in_progress: 'info', cleared: 'good', cleared_with_risk: 'warn', not_cleared: 'bad', not_applicable: 'neutral',
  },
  'character_assets.status': { planned: 'neutral', commissioned: 'info', delivered: 'info', cleared: 'good', needs_attention: 'warn' },
  'deadlines.status': { open: 'info', done: 'good', not_needed: 'neutral', extended: 'info', missed: 'bad', transferred: 'neutral', cancelled: 'neutral' },
  'office_connections.status': { connected: 'good', not_configured: 'neutral', paused: 'neutral', error: 'bad' },
};

export function toneOf(key: string, value: string | null | undefined): Tone {
  if (value === null || value === undefined || value === '') return 'neutral';
  return TONES[key]?.[value] ?? 'neutral';
}

/** "Can we?" verdicts and check levels. */
export const VERDICT_TONE: Record<string, Tone> = { yes: 'good', conditions: 'warn', consent: 'info', no: 'bad' };
export function verdictLabel(v: string): string {
  return { yes: t('Yes'), conditions: t('Yes, with conditions'), consent: t('Needs committee consent'), no: t('No') }[v] ?? v;
}
export const LEVEL_TONE: Record<string, Tone> = { ok: 'good', info: 'info', warn: 'warn', block: 'bad', na: 'neutral' };

/* ------------------------------------------------------------------ */
/* Offices and countries                                               */
/* ------------------------------------------------------------------ */

/** The trademark and design offices this app tracks. */
export const OFFICES = ['JP', 'US', 'CN', 'KR', 'TW', 'EM', 'WO'] as const;

/** Office or country code to [English, Japanese] name. */
const PLACES: Record<string, [string, string]> = {
  JP: ['Japan', '日本'],
  US: ['United States', '米国'],
  CN: ['China', '中国'],
  KR: ['South Korea', '韓国'],
  TW: ['Taiwan', '台湾'],
  EM: ['European Union (EUIPO)', '欧州連合（EUIPO）'],
  EU: ['European Union', '欧州連合'],
  WO: ['WIPO (Madrid, Hague)', 'WIPO（マドリッド・ハーグ）'],
  HK: ['Hong Kong', '香港'],
  MO: ['Macau', 'マカオ'],
  SG: ['Singapore', 'シンガポール'],
  TH: ['Thailand', 'タイ'],
  VN: ['Vietnam', 'ベトナム'],
  ID: ['Indonesia', 'インドネシア'],
  MY: ['Malaysia', 'マレーシア'],
  PH: ['Philippines', 'フィリピン'],
  IN: ['India', 'インド'],
  AU: ['Australia', 'オーストラリア'],
  NZ: ['New Zealand', 'ニュージーランド'],
  CA: ['Canada', 'カナダ'],
  MX: ['Mexico', 'メキシコ'],
  BR: ['Brazil', 'ブラジル'],
  GB: ['United Kingdom', '英国'],
  DE: ['Germany', 'ドイツ'],
  FR: ['France', 'フランス'],
  IT: ['Italy', 'イタリア'],
  ES: ['Spain', 'スペイン'],
  RU: ['Russia', 'ロシア'],
  SA: ['Saudi Arabia', 'サウジアラビア'],
  AE: ['United Arab Emirates', 'アラブ首長国連邦'],
};

export function jurisdictionName(code: string): string {
  const p = PLACES[(code || '').toUpperCase()];
  if (p === undefined) return (code || '').toUpperCase();
  return isJa() ? p[1] : p[0];
}

export const CURRENCIES = ['JPY', 'USD', 'EUR', 'CNY', 'KRW', 'TWD', 'HKD', 'SGD', 'GBP', 'AUD', 'CAD', 'THB', 'IDR', 'PHP', 'MYR', 'VND', 'INR', 'CHF'];

/** Trademark office data connections (credentials optional). */
export const OFFICE_CONNECTION_LABEL: Record<string, string> = { jpo: 'JPO', uspto_tsdr: 'USPTO TSDR', euipo: 'EUIPO' };

/* ------------------------------------------------------------------ */
/* Roles and modules                                                   */
/* ------------------------------------------------------------------ */

export function roleHelp(role: Role): string {
  switch (role) {
    case 'admin':
      return t('Everything, including settings, people, roles, office connections and talent identity.');
    case 'manager':
      return t('Edit everything, decide renewals and approvals, delete records.');
    case 'rights':
      return t('Agreements, committees, trademarks, enforcement and deadlines.');
    case 'licensing':
      return t('Products, approvals, seals, royalties and licensees.');
    case 'talent_manager':
      return t('Talents, permissions and playbooks; the identity of the talents they manage.');
    case 'contributor':
      return t('Read everything, upload documents and propose changes for review.');
    case 'viewer':
      return t('Read only.');
    case 'licensee':
      return t('External: their own agreements, products, approvals, statements and seal orders.');
    case 'committee_member':
      return t('External: their committee\'s windows, statements and consent requests.');
    case 'reviewer':
      return t('External: the approvals assigned to them.');
    default:
      return '';
  }
}

export function moduleLabel(m: ModuleKey): string {
  return {
    titles: t('Titles'),
    committees: t('Committees'),
    franchises: t('Franchises and characters'),
    talents: t('Talents'),
    permissions: t('Third-party permissions'),
    guidelines: t('Guidelines and fan permits'),
    music: t('Music'),
    products: t('Products'),
    royalties: t('Royalties and seals'),
    approvals: t('Approvals'),
  }[m];
}

export function profileLabel(p: string): string {
  return { anime: t('Anime and film'), talent: t('VTubers and virtual talent'), character: t('Characters and virtual idols') }[p] ?? p;
}
