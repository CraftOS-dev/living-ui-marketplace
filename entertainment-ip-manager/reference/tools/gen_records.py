"""Generate frontend/src/app/lib/records.ts and enums.ts from the live schema.

Usage:
  1. Apply the migrations to a scratch database (pocketbase migrate up --dir <scratch>
     --migrationsDir pb/pb_migrations) and dump `_collections` to JSON with
     {collection: {field: {type, values?, to?, maxSelect?}}} (see dump_schema.py next to this file).
  2. python reference/tools/gen_records.py <schema.json> <app dir>

Edit this generator, never the generated files.
"""
import json, os, re, sys

schema = json.load(open(sys.argv[1], encoding='utf-8'))
app = sys.argv[2]
out_dir = os.path.join(app, 'frontend', 'src', 'app', 'lib')

SKIP = {'_superusers', '_authOrigins', '_externalAuths', '_mfas', '_otps', 'agent_requests', '_a2app_settings'}
NAMES = {
    'franchises': 'FranchiseRec', 'titles': 'TitleRec', 'characters': 'CharacterRec', 'character_assets': 'CharacterAssetRec',
    'talents': 'TalentRec', 'talent_identity': 'TalentIdentityRec', 'castings': 'CastingRec', 'committees': 'CommitteeRec',
    'committee_members': 'CommitteeMemberRec', 'agreements': 'AgreementRec', 'grants': 'GrantRec', 'songs': 'SongRec',
    'recordings': 'RecordingRec', 'releases': 'ReleaseRec', 'society_contracts': 'SocietyContractRec',
    'society_registrations': 'SocietyRegistrationRec', 'content_id_assets': 'ContentIdAssetRec',
    'content_id_claims': 'ContentIdClaimRec', 'cid_allowlist': 'CidAllowRec', 'families': 'FamilyRec', 'matters': 'MatterRec',
    'goods_services': 'GoodsServiceRec', 'dimensions': 'DimensionRec', 'dimension_values': 'DimensionValueRec',
    'permissions': 'PermissionRec', 'guidelines': 'GuidelineRec', 'fan_registrations': 'FanRegistrationRec',
    'products': 'ProductRec', 'approvals': 'ApprovalRec', 'approval_rounds': 'ApprovalRoundRec', 'seal_orders': 'SealOrderRec',
    'enforcement_cases': 'CaseRec', 'evidence': 'EvidenceRec', 'platform_enrollments': 'PlatformEnrollmentRec',
    'customs_recordations': 'CustomsRecordationRec', 'watch_hits': 'WatchHitRec', 'consent_requests': 'ConsentRequestRec',
    'distributions': 'DistributionRec', 'documents': 'DocumentRec', 'royalty_reports': 'RoyaltyReportRec',
    'royalty_lines': 'RoyaltyLineRec', 'clearances': 'ClearanceRec', 'events': 'EventRec', 'deadlines': 'DeadlineRec',
    'rules': 'RuleRec', 'office_calendars': 'OfficeCalendarRec', 'calendar_years': 'CalendarYearRec', 'renewals': 'RenewalRec',
    'fee_schedule': 'FeeRec', 'fx_rates': 'FxRateRec', 'inbox_items': 'InboxItemRec', 'involvements': 'InvolvementRec',
    'saved_views': 'SavedViewRec', 'audit_log': 'AuditRec', 'notifications': 'NotificationRec', 'sync_runs': 'SyncRunRec',
    'ics_tokens': 'IcsTokenRec', 'office_connections': 'OfficeConnectionRec', 'parties': 'PartyRec', 'settings': 'SettingsRec',
    'users': 'UserRec', 'items': None,
}

# JSON field shapes (by field name; collection-qualified wins).
JSON_TYPES = {
    'names': 'NameEntry[]', 'tags': 'string[]', 'copyright_lines': 'CopyrightLine[]', 'profiles': 'Profile[]',
    'modules': 'Partial<Record<ModuleKey, boolean>>', 'reminder_days': 'number[]', 'jurisdictions': 'string[]',
    'approval_stages': 'StageTemplate[]', 'parties.roles': 'string[]', 'aliases': 'string[]', 'external_ids': 'Record<string, string>',
    'ai_policy': 'AiPolicy', 'external_ids': 'ExternalId[]', 'channels': 'TalentChannel[]', 'waterfall': 'WaterfallStep[]',
    'committee_members.roles': 'string[]', 'rate_tiers': 'RateTier[]', 'payment_schedule': 'ScheduledPayment[]',
    'delivery_schedule': 'ScheduledItem[]', 'dims': 'DimSpecMap', 'reviewers': 'ApprovalReviewer[]', 'urls': 'string[]',
    'answers': 'ConsentAnswer[]', 'receipts': 'DistributionReceipt[]', 'distributions.members': 'DistributionMember[]',
    'calculation': 'Calculation', 'proposal': 'Record<string, unknown>', 'diffs': 'Record<string, unknown>[]',
    'citations': 'Citation[]', 'data': 'Record<string, unknown>', 'platforms': 'string[]', 'monetization': 'string[]',
    'languages': 'string[]', 'classes': 'number[]', 'classes_keep': 'number[]', 'territories': 'string[]',
    'priority_claims': 'PriorityClaim[]', 'name_variants': 'string[]', 'work_codes': 'Record<string, string>', 'revenue_share': 'RevenueShare[]',
    'reminders_sent': 'string[]', 'routes': 'string[]', 'conditions': 'Record<string, unknown>', 'extensions': 'RuleExtension[]',
    'changes': 'Record<string, unknown>', 'filters': 'Record<string, unknown>', 'columns': 'string[]',
}

def ts_type(coll, fname, f):
    t = f['type']
    if t in ('text', 'editor', 'email', 'url', 'password', 'date', 'autodate'):
        return 'string'
    if t == 'number':
        return 'number'
    if t == 'bool':
        return 'boolean'
    if t == 'select':
        vals = f.get('values') or []
        u = ' | '.join(json.dumps(v) for v in vals) or 'string'
        return f'({u})[]' if (f.get('maxSelect') or 1) > 1 else f"{u} | ''"
    if t == 'relation':
        return 'string[]' if (f.get('maxSelect') or 1) > 1 else 'string'
    if t == 'file':
        return 'string[]' if (f.get('maxSelect') or 1) > 1 else 'string'
    if t == 'json':
        return (JSON_TYPES.get(f'{coll}.{fname}') or JSON_TYPES.get(fname) or 'unknown') + ' | null'
    return 'unknown'

ACRONYM = {
    'jp': 'JP', 'us': 'US', 'eu': 'EU', 'cn': 'CN', 'kr': 'KR', 'tw': 'TW', 'em': 'EM', 'wo': 'WO', 'ova': 'OVA', 'mg': 'MG',
    'dmca': 'DMCA', 'spc': 'SPC', 'llp': 'LLP', 'jpo': 'JPO', 'euipo': 'EUIPO', 'jasrac': 'JASRAC', 'nextone': 'NexTone',
    'nda': 'NDA', 'ip': 'IP', 'ipp': 'IPP', 'ai': 'AI', 'nft': 'NFT', 'vtuber': 'VTuber', 'coda': 'CODA', 'ics': 'ICS',
    'ecb': 'ECB', 'av': 'AV', 'cd': 'CD', 'tv': 'TV', 'sku': 'SKU', 'url': 'URL', 'id': 'ID', 'vero': 'VeRO', 'x': 'X',
    'tiktok': 'TikTok', 'youtube': 'YouTube', 'ebay': 'eBay', 'aidc': 'AIDC', 'en': 'English', 'ja': 'Japanese',
}
LABEL_OVERRIDE = {
    'users.role.talent_manager': 'Talent manager', 'users.role.committee_member': 'Committee member',
    'office_connections.office.uspto_tsdr': 'USPTO TSDR', 'committees.form.nin_i_kumiai': 'Partnership (nin-i kumiai)',
    'committees.form.spc': 'Special purpose company', 'committees.form.llp': 'LLP', 'committees.form.sole': 'Single company',
    'committees.consent_default.lead_discretion': 'Lead company decides', 'committees.consent_default.consult': 'Consult members',
    'enforcement_cases.forum.jp_platform': 'Japanese platform request', 'enforcement_cases.forum.sender_disclosure': 'Sender disclosure',
    'enforcement_cases.forum.coda': 'CODA', 'enforcement_cases.forum.cease_desist': 'Warning letter',
    'enforcement_cases.case_type.ai_misuse': 'AI misuse', 'enforcement_cases.case_type.clip_violation': 'Clip guideline violation',
    'agreements.royalty_basis.retail_x_manufactured': 'Retail price x manufactured',
    'agreements.royalty_basis.retail_x_sold': 'Retail price x sold', 'agreements.royalty_basis.wholesale_net': 'Net wholesale',
    'agreements.royalty_basis.net_receipts': 'Net receipts', 'agreements.royalty_basis.per_unit': 'Per unit',
    'agreements.royalty_basis.per_seal': 'Per seal', 'agreements.royalty_basis.flat_fee': 'Flat fee',
    'agreements.royalty_basis.revenue_share': 'Revenue share', 'agreements.royalty_basis.none': 'None',
    'agreements.agreement_type.original_work_license': 'Original work licence', 'agreements.agreement_type.committee': 'Production committee',
    'agreements.agreement_type.creator_commission': 'Creator commission', 'agreements.agreement_type.talent': 'Talent agreement',
    'agreements.agreement_type.voice_actor': 'Voice actor', 'agreements.agreement_type.merchandise': 'Merchandise licence',
    'agreements.agreement_type.overseas': 'Overseas licence', 'agreements.agreement_type.video': 'Video (Blu-ray, DVD)',
    'agreements.agreement_type.game': 'Game licence', 'agreements.agreement_type.pachinko': 'Pachinko and pachislot',
    'agreements.agreement_type.event_collab': 'Event or collaboration', 'agreements.agreement_type.brand_tieup': 'Brand tie-up',
    'agreements.agreement_type.music_publishing': 'Music publishing', 'agreements.agreement_type.master_license': 'Master licence',
    'agreements.agreement_type.master_assignment': 'Master assignment', 'agreements.agreement_type.co_master': 'Co-owned master',
    'agreements.agreement_type.tie_up': 'Music tie-up', 'agreements.agreement_type.sync': 'Sync licence',
    'agreements.agreement_type.fan_permit': 'Fan permit', 'agreements.agreement_type.coexistence': 'Coexistence',
    'agreements.stage_name_clause.agency_owns': 'Agency owns the name', 'agreements.stage_name_clause.talent_owns': 'Talent owns the name',
    'agreements.stage_name_clause.shared': 'Shared', 'agreements.stage_name_clause.not_stated': 'Not stated',
    'agreements.approval_timeout.deemed_refused': 'Deemed refused', 'agreements.approval_timeout.deemed_approved': 'Deemed approved',
    'approvals.timeout_outcome.deemed_refused': 'Deemed refused', 'approvals.timeout_outcome.deemed_approved': 'Deemed approved',
    'approvals.stage.pre_production_sample': 'Pre-production sample', 'approval_rounds.stage.pre_production_sample': 'Pre-production sample',
    'approvals.stage.mass_production_check': 'Mass production check', 'approval_rounds.stage.mass_production_check': 'Mass production check',
    'characters.ownership_model.agency_owned': 'Agency owned', 'characters.ownership_model.talent_owned': 'Talent owned',
    'characters.ownership_model.co_owned': 'Co-owned', 'characters.ownership_model.licensed_in': 'Licensed in',
    'characters.ownership_model.committee_owned': 'Committee owned', 'franchises.ownership_model.sole_owner': 'We own it',
    'franchises.ownership_model.committee': 'Production committee', 'franchises.ownership_model.licensed_in': 'Licensed in',
    'franchises.ownership_model.co_production': 'Co-production', 'franchises.ownership_model.talent_owned': 'Talent owned',
    'character_assets.acquisition.owned_original': 'Created in-house', 'character_assets.acquisition.work_for_hire': 'Work made for hire',
    'character_assets.acquisition.exclusive_license': 'Exclusive licence', 'character_assets.acquisition.nonexclusive_license': 'Non-exclusive licence',
    'character_assets.component.live2d_model': 'Live2D model', 'character_assets.component.model_3d': '3D model',
    'character_assets.component.persona_lore': 'Persona and lore', 'character_assets.component.design_sheet': 'Design sheet',
    'character_assets.component.standing_art': 'Standing art', 'character_assets.portfolio_use.after_announcement': 'After announcement',
    'talents.lifecycle.pre_debut': 'Before debut', 'talents.lifecycle.graduation_announced': 'Graduation announced',
    'talents.talent_type.vtuber': 'VTuber', 'talents.affiliation.ours': 'Our talent', 'talents.affiliation.external': 'External',
    'recordings.version_type.tv_size': 'TV size', 'recordings.version_type.a_cappella': 'A cappella',
    'recordings.version_type.music_video': 'Music video', 'songs.tie_up_use.character_song': 'Character song', 'songs.tie_up_use.bgm': 'Background music',
    'releases.format.bluray_bundle': 'Blu-ray bundle', 'society_registrations.society.self': 'Self-managed',
    'society_registrations.status.code_issued': 'Code issued', 'content_id_assets.asset_type.art_track': 'Art track',
    'platform_enrollments.platform.amazon_brand_registry': 'Amazon Brand Registry', 'platform_enrollments.platform.alibaba_ipp': 'Alibaba IPP',
    'platform_enrollments.platform.aidc_ipp': 'AliExpress (AIDC IPP)', 'platform_enrollments.platform.ebay_vero': 'eBay VeRO',
    'platform_enrollments.platform.yahoo_auctions': 'Yahoo! Auctions', 'platform_enrollments.platform.mercari': 'Mercari',
    'permissions.permission_type.game_title': 'Game title', 'permissions.permission_type.music_work': 'Music (composition)',
    'permissions.permission_type.master': 'Master recording', 'permissions.permission_type.backing_track': 'Backing track',
    'permissions.permission_type.platform_blanket': 'Platform blanket licence', 'permissions.permission_type.cross_agency_collab': 'Cross-agency collaboration',
    'permissions.source.public_guideline': 'Public guideline', 'permissions.status.pending_application': 'Application needed',
    'permissions.archive.live_only': 'Live only', 'fan_registrations.kind.clip_channel': 'Clip channel',
    'fan_registrations.kind.fan_permit': 'Fan permit', 'fan_registrations.kind.event_permit': 'One-day event licence',
    'fan_registrations.kind.fan_game': 'Fan game', 'guidelines.kind.fan_work': 'Fan works', 'guidelines.kind.clip': 'Clips',
    'guidelines.kind.cover_song': 'Cover songs', 'guidelines.kind.ai_use': 'AI use', 'guidelines.kind.doujin_event': 'One-day event licence',
    'products.sales_model.made_to_order': 'Made to order', 'products.stage.final_sample': 'Final sample',
    'products.stage.mass_production': 'Mass production', 'products.stage.on_sale': 'On sale', 'products.stage.sell_off': 'Sell-off',
    'titles.title_type.original_manga': 'Original manga', 'titles.title_type.original_novel': 'Original novel',
    'titles.title_type.stream_archive': 'Stream archive', 'titles.title_type.voice_product': 'Voice product', 'titles.title_type.stage_play': 'Stage play',
    'franchises.kind.anime_title': 'Anime title', 'franchises.kind.original_character': 'Original character',
    'franchises.kind.vtuber_agency': 'VTuber agency', 'franchises.kind.vtuber_group': 'VTuber group',
    'franchises.kind.virtual_singer': 'Virtual singer', 'franchises.kind.music_project': 'Music project', 'franchises.kind.mixed_media': 'Mixed media',
    'characters.kind.anime_character': 'Anime character', 'characters.kind.vtuber_persona': 'VTuber persona',
    'characters.kind.virtual_singer': 'Virtual singer', 'characters.kind.idol_member': 'Idol group member', 'characters.kind.game_character': 'Game character',
    'deadlines.kind.hard': 'Statutory', 'deadlines.kind.extendable': 'Extendable', 'deadlines.kind.designated': 'Office-set',
    'deadlines.kind.internal': 'Internal', 'deadlines.kind.reminder': 'Reminder', 'deadlines.status.not_needed': 'Not needed',
    'deadlines.category.content_id': 'Content ID', 'deadlines.category.playbook': 'Talent playbook',
    'renewals.decision.renew_partial': 'Renew some classes', 'renewals.instruction_status.not_instructed': 'Not instructed',
    'matters.relation.designation': 'Madrid designation', 'matters.route.designation': 'Madrid designation', 'matters.tm_basis.use': 'Use',
    'inbox_items.kind.office_change': 'Office change', 'inbox_items.kind.agreement_draft': 'Contract read',
    'inbox_items.kind.royalty_statement': 'Royalty statement', 'inbox_items.kind.watch_hit': 'Watch hits',
    'inbox_items.kind.agent_proposal': 'Proposal', 'inbox_items.status.partially_accepted': 'Partly accepted',
    'inbox_items.status.awaiting_second': 'Waiting for second review', 'inbox_items.source.office_sync': 'Office sync',
    'documents.doc_type.office_action': 'Office action', 'documents.doc_type.style_guide': 'Style guide',
    'documents.doc_type.model_sheet': 'Model sheet', 'documents.doc_type.chain_of_title': 'Chain of title',
    'documents.doc_type.guideline_snapshot': 'Guideline snapshot', 'documents.doc_type.platform_notice': 'Platform notice',
    'documents.doc_type.sample_photo': 'Sample photo', 'clearances.status.cleared_with_risk': 'Cleared with risk',
    'clearances.status.not_applicable': 'Not applicable', 'clearances.item_type.music_sync': 'Music sync',
    'clearances.item_type.music_master': 'Music master', 'clearances.item_type.performer_consent': 'Performer consent',
    'clearances.item_type.committee_consent': 'Committee consent', 'clearances.item_type.original_work_license': 'Original work licence',
    'involvements.role.original_author': 'Original author', 'involvements.role.voice_actor': 'Voice actor',
    'involvements.role.committee_member': 'Committee member', 'notifications.kind.inbox': 'Inbox',
    'evidence.kind.page_archive': 'Page archive', 'evidence.kind.test_purchase': 'Test purchase',
    'watch_hits.status.actioned': 'Action taken', 'content_id_claims.direction.incoming': 'Claims on our videos',
    'content_id_claims.direction.outgoing': 'Our claims', 'grants.kind.window': 'Window (madoguchi)',
    'society_contracts.model.trust_all': 'All works on trust', 'society_contracts.model.per_work': 'Work by work',
    'society_contracts.society.self': 'Self-managed', 'families.strategy.prune': 'Trim classes or offices',
    # Context-suffixed keys ("English|context"): same English, different Japanese.
    'approvals.stage.design': 'Design|approval stage', 'approval_rounds.stage.design': 'Design|approval stage',
    'products.stage.design': 'Design|approval stage', 'recordings.version_type.live': 'Live|recording',
    'users.role.rights': 'Rights team', 'users.role.licensing': 'Licensing team',
    'settings.default_signup_role.rights': 'Rights team', 'settings.default_signup_role.licensing': 'Licensing team',
    'talents.lifecycle.active': 'Active|talent', 'titles.status.released': 'Released|title',
    'consent_requests.status.refused': 'Refused|consent', 'consent_requests.status.approved': 'Approved|consent',
    'approvals.status.rejected': 'Rejected|approval', 'approval_rounds.status.rejected': 'Rejected|approval',
    'renewals.decision.pending': 'Pending|decision', 'content_id_claims.status.disputed': 'Disputed|content id',
}

VALUE_OVERRIDE = {
    'uspto_tsdr': 'USPTO TSDR', 'three_d': '3D', 'na': 'Not applicable', 'brand_tieup': 'Brand tie-up',
    'co_production': 'Co-production', 'non_exclusive': 'Non-exclusive', 'pre_filing': 'Before filing', 'ok': 'OK',
    'in_app': 'In the app',
}

def humanize(coll, field, v):
    k = f'{coll}.{field}.{v}'
    if k in LABEL_OVERRIDE:
        return LABEL_OVERRIDE[k]
    if v in VALUE_OVERRIDE:
        return VALUE_OVERRIDE[v]
    if v.isupper():
        return v
    words = v.split('_')
    out = []
    for i, w in enumerate(words):
        if w in ACRONYM:
            out.append(ACRONYM[w])
        else:
            out.append(w.capitalize() if i == 0 else w)
    return ' '.join(out)

lines = [
    '/**',
    ' * Record shapes for every collection, GENERATED from the schema by',
    ' * reference/tools/gen_records.py. Edit the generator, not this file.',
    ' * Dates arrive as PocketBase strings ("YYYY-MM-DD 00:00:00.000Z" or "").',
    ' */',
    "import type { RecordModel } from 'pocketbase';",
    "import type {",
    "  AiPolicy, ApprovalReviewer, Calculation, Citation, ConsentAnswer, CopyrightLine, DimSpecMap, DistributionMember, DistributionReceipt,",
    "  ModuleKey, NameEntry, PriorityClaim, Profile, RateTier, RuleExtension, ScheduledItem, ScheduledPayment, StageTemplate,",
    "  ExternalId, RevenueShare, TalentChannel, WaterfallStep,",
    "} from './shapes.ts';",
    '',
]
enum_lines = [
    '/**',
    ' * Every select field\'s values and English labels, GENERATED from the schema by',
    ' * reference/tools/gen_records.py. Render labels through enumLabel() so they are translated.',
    ' */',
    '',
    'export const ENUM_LABEL: Record<string, Record<string, string>> = {',
]
labels_seen = set()
for coll in sorted(schema):
    if coll in SKIP or coll.startswith('_') or NAMES.get(coll, 'X') is None:
        continue
    name = NAMES.get(coll)
    if name is None:
        print('no name for', coll)
        continue
    lines.append(f'export interface {name} extends RecordModel {{')
    for fname, f in schema[coll].items():
        if fname in ('id', 'password', 'tokenKey', 'collectionId', 'collectionName'):
            continue
        if f['type'] == 'password':
            continue
        lines.append(f'  {fname}: {ts_type(coll, fname, f)};')
        if f['type'] == 'select':
            vals = f.get('values') or []
            enum_lines.append(f"  '{coll}.{fname}': {{")
            for v in vals:
                lab = humanize(coll, fname, v)
                labels_seen.add(lab)
                enum_lines.append(f"    {json.dumps(v)}: {json.dumps(lab)},")
            enum_lines.append('  },')
    lines.append('}')
    lines.append('')
enum_lines.append('};')
enum_lines.append('')

open(os.path.join(out_dir, 'records.ts'), 'w', encoding='utf-8', newline='\n').write('\n'.join(lines))
open(os.path.join(out_dir, 'enums.ts'), 'w', encoding='utf-8', newline='\n').write('\n'.join(enum_lines))
json.dump(sorted(labels_seen), open(os.path.join(os.path.dirname(__file__), 'enum_labels.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=0)
print('collections', sum(1 for l in lines if l.startswith('export interface')), 'unique labels', len(labels_seen))
