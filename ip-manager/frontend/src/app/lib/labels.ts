/**
 * Every enum the UI shows, in plain words, plus the one status-color
 * language (tones). Structural label tables only: no string matching.
 */
import type {
  AgreementType,
  ApprovalStage,
  ApprovalStatus,
  Category,
  DeadlineKind,
  DeadlineStatus,
  DisclosureStage,
  DocType,
  IpType,
  MatterStatus,
  Role,
  StatusGroup,
  VocabPack,
  WorkType,
} from './types.ts';

export type Tone = 'good' | 'warn' | 'bad' | 'info' | 'accent' | 'neutral';

export const IP_TYPE_LABEL: Record<IpType, string> = {
  patent: 'Patent',
  utility_model: 'Utility model',
  design: 'Design',
  trademark: 'Trademark',
  copyright: 'Copyright',
  domain: 'Domain name',
};

export const IP_TYPE_PLURAL: Record<IpType, string> = {
  patent: 'Patents',
  utility_model: 'Utility models',
  design: 'Designs',
  trademark: 'Trademarks',
  copyright: 'Copyrights',
  domain: 'Domain names',
};

export const STATUS_LABEL: Record<MatterStatus, string> = {
  to_file: 'To file',
  filed: 'Filed',
  published: 'Published',
  examination: 'In examination',
  office_action: 'Office action',
  allowed: 'Allowed',
  opposed: 'Opposed',
  granted: 'Granted',
  registered: 'Registered',
  in_grace: 'In grace period',
  lapsed: 'Lapsed',
  abandoned: 'Abandoned',
  withdrawn: 'Withdrawn',
  refused: 'Refused',
  expired: 'Expired',
  revoked: 'Revoked',
  transferred_out: 'Transferred out',
};

export const STATUS_ORDER: MatterStatus[] = [
  'to_file',
  'filed',
  'published',
  'examination',
  'office_action',
  'allowed',
  'opposed',
  'granted',
  'registered',
  'in_grace',
  'lapsed',
  'abandoned',
  'withdrawn',
  'refused',
  'expired',
  'revoked',
  'transferred_out',
];

export const GROUP_LABEL: Record<StatusGroup, string> = {
  pre_filing: 'Not filed',
  pending: 'Pending',
  live: 'In force',
  dead: 'Dead',
};

export const GROUP_TONE: Record<StatusGroup, Tone> = {
  pre_filing: 'neutral',
  pending: 'info',
  live: 'good',
  dead: 'neutral',
};

export function statusTone(status: MatterStatus | '', group: StatusGroup | ''): Tone {
  if (status === 'office_action' || status === 'opposed' || status === 'in_grace') return 'warn';
  if (group === '') return 'neutral';
  return GROUP_TONE[group];
}

export const KIND_LABEL: Record<DeadlineKind, string> = {
  hard: 'Statutory',
  extendable: 'Extendable',
  designated: 'Set by office',
  internal: 'Internal',
  reminder: 'Reminder',
};

export const KIND_HELP: Record<DeadlineKind, string> = {
  hard: 'Set by law. Missing it can lose the right.',
  extendable: 'Set by law, can be extended for a fee up to the final date.',
  designated: 'The office set this period in its communication.',
  internal: 'Our own target, not a legal deadline.',
  reminder: 'For information, such as a third-party opposition period.',
};

export const DEADLINE_STATUS_LABEL: Record<DeadlineStatus, string> = {
  open: 'Open',
  done: 'Done',
  not_needed: 'Not needed',
  extended: 'Extended',
  missed: 'Missed',
  transferred: 'Transferred',
  cancelled: 'Cancelled',
};

export const CATEGORY_LABEL: Record<Category, string> = {
  prosecution: 'Prosecution',
  filing: 'Filing',
  maintenance: 'Maintenance',
  renewal: 'Renewal',
  opposition: 'Opposition',
  use: 'Use',
  term: 'Term',
  agreement: 'Agreement',
  copyright: 'Copyright',
  clearance: 'Clearance',
  dispute: 'Dispute',
  invention: 'Invention',
  other: 'Other',
};

export const SOURCE_LABEL: Record<string, string> = {
  rule: 'Rule',
  office: 'Office',
  inbox: 'Reviewed',
  manual: 'Manual',
  agreement: 'Agreement',
  system: 'System',
};

export const ROLE_LABEL: Record<Role, string> = {
  admin: 'Admin',
  manager: 'IP manager',
  counsel: 'Counsel',
  contributor: 'Contributor',
  inventor: 'Inventor',
  viewer: 'Viewer',
};

export const ROLE_HELP: Record<Role, string> = {
  admin: 'Everything, including rules, office connections and people.',
  manager: 'Create and edit everything, decide renewals, accept Inbox items.',
  counsel: 'Edit records and deadlines, give second approvals.',
  contributor: 'Read the portfolio, upload documents, propose changes.',
  inventor: 'Submit inventions and follow their own.',
  viewer: 'Read only.',
};

export const ROUTE_LABEL: Record<string, string> = {
  national: 'National',
  regional: 'Regional',
  provisional: 'Provisional',
  pct: 'PCT',
  ep: 'European patent',
  unitary: 'Unitary patent',
  madrid: 'Madrid (international)',
  hague: 'Hague (international)',
  designation: 'Designation',
  validation: 'Validation',
  other: 'Other',
};

export const RELATION_LABEL: Record<string, string> = {
  none: 'First filing',
  priority: 'Claims priority',
  continuation: 'Continuation',
  continuation_in_part: 'Continuation in part',
  divisional: 'Divisional',
  national_phase: 'National phase',
  validation: 'Validation',
  designation: 'Designation',
  conversion: 'Conversion',
  reissue: 'Reissue',
  related: 'Related',
};

export const MARK_TYPE_LABEL: Record<string, string> = {
  word: 'Word',
  figurative: 'Figurative (logo)',
  combined: 'Word and logo',
  three_d: 'Three-dimensional',
  colour: 'Colour',
  sound: 'Sound',
  motion: 'Motion',
  position: 'Position',
  pattern: 'Pattern',
  hologram: 'Hologram',
  multimedia: 'Multimedia',
  other: 'Other',
};

export const WORK_TYPE_LABEL: Record<WorkType, string> = {
  feature_film: 'Feature film',
  series: 'Series',
  season: 'Season',
  episode: 'Episode',
  short: 'Short',
  game: 'Game',
  book: 'Book',
  comic: 'Comic',
  music_composition: 'Musical composition',
  sound_recording: 'Sound recording',
  album: 'Album',
  character: 'Character',
  logo: 'Logo',
  artwork: 'Artwork',
  photograph: 'Photograph',
  software: 'Software',
  website: 'Website',
  format: 'Format',
  script: 'Script',
  documentation: 'Documentation',
  marketing_asset: 'Marketing asset',
  other: 'Other',
};

export const AGREEMENT_TYPE_LABEL: Record<AgreementType, string> = {
  option: 'Option',
  acquisition: 'Acquisition',
  assignment: 'Assignment',
  license_in: 'Licence in',
  license_out: 'Licence out',
  talent: 'Talent',
  services: 'Services',
  distribution: 'Distribution',
  merchandise: 'Merchandise licence',
  sync: 'Sync licence',
  master_use: 'Master use licence',
  co_production: 'Co-production',
  coexistence: 'Coexistence or consent',
  settlement: 'Settlement',
  nda: 'NDA',
  rnd: 'R&D or collaboration',
  employment_ip: 'Employee IP assignment',
  other: 'Other',
};

export const DIRECTION_LABEL: Record<string, string> = {
  in: 'Rights in',
  out: 'Rights out',
  mutual: 'Mutual',
  none: 'No rights',
};

export const AGREEMENT_STATUS_TONE: Record<string, Tone> = {
  draft: 'neutral',
  negotiating: 'info',
  active: 'good',
  expired: 'neutral',
  terminated: 'bad',
  renewed: 'good',
  superseded: 'neutral',
};

export const DISCLOSURE_STAGE_LABEL: Record<DisclosureStage, string> = {
  draft: 'Draft',
  submitted: 'Submitted',
  search: 'Patentability search',
  review: 'Committee review',
  approved: 'Approved',
  drafting: 'Drafting',
  filed: 'Filed',
  rejected: 'Not pursued',
  on_hold: 'On hold',
  merged: 'Merged',
  archived: 'Archived',
};

export const DISCLOSURE_STAGE_TONE: Record<DisclosureStage, Tone> = {
  draft: 'neutral',
  submitted: 'info',
  search: 'info',
  review: 'accent',
  approved: 'good',
  drafting: 'good',
  filed: 'good',
  rejected: 'bad',
  on_hold: 'warn',
  merged: 'neutral',
  archived: 'neutral',
};

export const DOC_TYPE_LABEL: Record<DocType, string> = {
  office_action: 'Office action',
  filing: 'Filing',
  receipt: 'Filing receipt',
  certificate: 'Certificate',
  correspondence: 'Correspondence',
  agreement: 'Agreement',
  evidence: 'Evidence',
  specimen: 'Specimen',
  chain_of_title: 'Chain of title',
  clearance: 'Clearance',
  report: 'Report',
  invoice: 'Invoice',
  drawing: 'Drawing',
  disclosure: 'Invention disclosure',
  other: 'Other',
};

export const CLEARANCE_TYPE_LABEL: Record<string, string> = {
  title_report: 'Title report',
  copyright_report: 'Copyright report',
  script_clearance: 'Script clearance',
  music_sync: 'Music sync licence',
  music_master: 'Music master licence',
  talent_release: 'Talent release',
  location_release: 'Location release',
  footage_license: 'Footage licence',
  artwork_clearance: 'Artwork clearance',
  trademark_search: 'Trademark search',
  eo_insurance: 'E&O insurance',
  chain_of_title: 'Chain-of-title documents',
  fto_opinion: 'Freedom-to-operate opinion',
  open_source_review: 'Open-source review',
  other: 'Other',
};

export const CLEARANCE_STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  requested: 'Requested',
  in_progress: 'In progress',
  cleared: 'Cleared',
  cleared_with_risk: 'Cleared with risk',
  not_cleared: 'Not cleared',
  not_applicable: 'Not applicable',
};

export const CLEARANCE_STATUS_TONE: Record<string, Tone> = {
  not_started: 'neutral',
  requested: 'info',
  in_progress: 'info',
  cleared: 'good',
  cleared_with_risk: 'warn',
  not_cleared: 'bad',
  not_applicable: 'neutral',
};

export const APPROVAL_STAGE_LABEL: Record<ApprovalStage, string> = {
  concept: 'Concept',
  pre_production: 'Pre-production',
  production_sample: 'Production sample',
  packaging: 'Packaging',
  final: 'Final product',
};

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  submitted: 'Submitted',
  in_review: 'In review',
  approved: 'Approved',
  approved_with_changes: 'Approved with changes',
  resubmit: 'Resubmit',
  rejected: 'Rejected',
};

export const APPROVAL_STATUS_TONE: Record<ApprovalStatus, Tone> = {
  submitted: 'info',
  in_review: 'accent',
  approved: 'good',
  approved_with_changes: 'good',
  resubmit: 'warn',
  rejected: 'bad',
};

export const RENEWAL_DECISION_LABEL: Record<string, string> = {
  pending: 'Decide',
  renew: 'Renew',
  renew_partial: 'Renew, drop classes',
  lapse: 'Let lapse',
  defer: 'Decide later',
};

export const INSTRUCTION_LABEL: Record<string, string> = {
  not_instructed: 'Not instructed',
  instructed: 'Instructed',
  paid: 'Paid',
  confirmed: 'Confirmed',
  lapsed: 'Lapsed',
  '': 'Not instructed',
};

export const DISPUTE_TYPE_LABEL: Record<string, string> = {
  opposition: 'Opposition',
  cancellation: 'Cancellation',
  invalidation: 'Invalidation',
  non_use: 'Non-use revocation',
  appeal: 'Appeal',
  litigation: 'Litigation',
  udrp: 'Domain dispute (UDRP)',
  cease_and_desist: 'Cease and desist',
  takedown: 'Marketplace takedown',
  ttab: 'TTAB proceeding',
  other: 'Other',
};

export const WATCH_STATUS_LABEL: Record<string, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  dismissed: 'Dismissed',
  monitor: 'Monitor',
  escalated: 'Escalated',
  actioned: 'Actioned',
};

export const WATCH_STATUS_TONE: Record<string, Tone> = {
  new: 'info',
  reviewing: 'accent',
  dismissed: 'neutral',
  monitor: 'warn',
  escalated: 'bad',
  actioned: 'good',
};

export const OFFICE_LABEL: Record<string, string> = {
  uspto_odp: 'USPTO Open Data Portal',
  uspto_tsdr: 'USPTO TSDR',
  epo_ops: 'EPO Open Patent Services',
  euipo: 'EUIPO',
  jpo: 'JPO',
};

/** Office and country codes (WIPO ST.3) to names. */
export const JURISDICTIONS: Record<string, string> = {
  US: 'United States',
  EP: 'European Patent Office',
  EM: 'European Union (EUIPO)',
  JP: 'Japan',
  WO: 'WIPO (PCT, Madrid, Hague)',
  GB: 'United Kingdom',
  CN: 'China',
  KR: 'South Korea',
  TW: 'Taiwan',
  HK: 'Hong Kong',
  SG: 'Singapore',
  IN: 'India',
  AU: 'Australia',
  NZ: 'New Zealand',
  CA: 'Canada',
  MX: 'Mexico',
  BR: 'Brazil',
  AR: 'Argentina',
  CL: 'Chile',
  CO: 'Colombia',
  DE: 'Germany',
  FR: 'France',
  IT: 'Italy',
  ES: 'Spain',
  NL: 'Netherlands',
  BE: 'Belgium',
  CH: 'Switzerland',
  AT: 'Austria',
  SE: 'Sweden',
  DK: 'Denmark',
  FI: 'Finland',
  NO: 'Norway',
  IE: 'Ireland',
  PL: 'Poland',
  PT: 'Portugal',
  TR: 'Türkiye',
  RU: 'Russia',
  IL: 'Israel',
  AE: 'United Arab Emirates',
  SA: 'Saudi Arabia',
  ZA: 'South Africa',
  ID: 'Indonesia',
  TH: 'Thailand',
  MY: 'Malaysia',
  PH: 'Philippines',
  VN: 'Vietnam',
  UA: 'Ukraine',
  BX: 'Benelux (BOIP)',
  OA: 'OAPI',
  AP: 'ARIPO',
  EA: 'Eurasian Patent Office',
  GC: 'Gulf Cooperation Council',
};

export function jurisdictionName(code: string): string {
  return JURISDICTIONS[code.toUpperCase()] ?? code.toUpperCase();
}

export const JURISDICTION_OPTIONS = Object.entries(JURISDICTIONS).map(([value, label]) => ({
  value,
  label: `${value} · ${label}`,
}));

export const CURRENCIES = [
  'USD', 'EUR', 'JPY', 'GBP', 'CHF', 'CNY', 'KRW', 'CAD', 'AUD', 'SGD', 'HKD', 'INR', 'BRL', 'MXN',
  'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'ILS', 'NZD', 'ZAR', 'TRY', 'THB', 'IDR', 'MYR', 'PHP', 'TWD',
];

/* ------------------------------------------------------------------ */
/* Vocabulary packs: labels only, the schema never changes.            */
/* ------------------------------------------------------------------ */

export interface Vocab {
  property: string;
  properties: string;
  work: string;
  works: string;
  propertyHint: string;
  workHint: string;
}

export const VOCAB: Record<VocabPack, Vocab> = {
  general: {
    property: 'Property',
    properties: 'Properties',
    work: 'Work',
    works: 'Works',
    propertyHint: 'A brand, product line, franchise or technology that groups your IP.',
    workHint: 'A creative work or asset protected by copyright.',
  },
  entertainment: {
    property: 'Franchise',
    properties: 'Franchises',
    work: 'Title',
    works: 'Titles',
    propertyHint: 'A franchise or property: the world, characters and brand that titles, trademarks and deals belong to.',
    workHint: 'A film, series, season, episode, game, book, track, character or logo.',
  },
  technology: {
    property: 'Product line',
    properties: 'Product lines',
    work: 'Asset',
    works: 'Assets',
    propertyHint: 'A product line or platform that patents, trademarks and licences belong to.',
    workHint: 'Software, documentation, designs and other copyright assets.',
  },
  consumer: {
    property: 'Brand',
    properties: 'Brands',
    work: 'Creative asset',
    works: 'Creative assets',
    propertyHint: 'A brand that trademarks, designs and licences belong to.',
    workHint: 'Packaging, artwork, mascots, jingles and other creative assets.',
  },
};

export const VOCAB_PACK_LABEL: Record<VocabPack, string> = {
  general: 'General',
  entertainment: 'Entertainment and media',
  technology: 'Technology',
  consumer: 'Consumer brands',
};
