/**
 * Catalog: companies, the firm's global company records (kernel-records).
 * Identity by root domain; a free-mail domain never makes a company. Your
 * AI agent creates companies and fills empty fields directly; changing a
 * value a person entered is a proposal (companies.update); merges are
 * proposals; deletes are people only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const ORIGINS = ['manual', 'capture', 'intake', 'import', 'agent', 'markets', 'portfolio', 'other'];
const KINDS = ['startup', 'investor', 'corporate', 'service', 'other'];
const MODELS = ['saas', 'marketplace', 'transactional', 'consumer_subscription', 'advertising', 'hardware', 'licensing', 'services', 'other'];
const STAGES = ['idea', 'pre_seed', 'seed', 'series_a', 'series_b', 'series_c', 'growth'];
const COMPANY = S('Company id, domain or exact name', { required: true, example: 'acme.com' });
const FIELDS = {
  name: S('Name'),
  domain: S('Website or domain (kept as the root domain, e.g. acme.com)'),
  domains: S('JSON list of every domain of the company'),
  website: S('Website link'),
  description: S('What the company does (4000 characters at most)'),
  kind: S('What kind of company', { enum: KINDS }),
  sector: S('Sector, e.g. fintech'),
  subsector: S('Subsector, e.g. payments'),
  stage: S('Stage of the company (empty clears it)', { enum: STAGES }),
  hq_country: S('Headquarters country, two letters (US, GB, SG)'),
  hq_city: S('Headquarters city'),
  founded_year: S('Year founded, e.g. 2021 (empty clears it)'),
  team_size: S('People on the team, a whole number (empty clears it)'),
  business_model: S('Business model', { enum: MODELS }),
  linkedin: S('LinkedIn link'),
  tags: S('JSON list of tags'),
};
const SOURCE = { source_ref: S('Where the values came from: a link, a file and page, an email (kept in provenance)') };

module.exports = [
  {
    name: 'companies.list',
    method: 'GET',
    fn: 'lib_records.opListCompanies',
    perm: 'network:view',
    effect: 'read',
    desc: 'Companies of the firm, by name, with their open deals (the ones you may see) and people: --q searches name and domains; --kind, --sector, --hq_country, --tag narrow; --deleted true lists the trash.',
    params: { q: S('Search text'), kind: S('Kind', { enum: KINDS }), sector: S('Sector'), hq_country: S('Country code'), tag: S('A tag'), deleted: B('true for the trash'), sort: S('name, created or updated', { enum: ['name', 'created', 'updated'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'companies.get',
    method: 'GET',
    fn: 'lib_records.opGetCompany',
    perm: 'network:view',
    effect: 'read',
    desc: 'One company in full: fields with provenance, its people now, and its deals (deals_hidden counts deals you may not see).',
    params: { company: COMPANY },
  },
  {
    name: 'companies.upsert',
    method: 'POST',
    fn: 'lib_records.opUpsertCompany',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Find a company by domain (or exact name, or --company) and update it, or add it. A free-mail domain (gmail.com) never makes a company. For you: new companies and empty fields are written; changing a value a person entered becomes a companies.update proposal. Give --source_ref.',
    params: Object.assign({ company: S('Company id (to update a known company)'), origin: S('How it entered', { enum: ORIGINS }) }, FIELDS, SOURCE),
  },
  {
    name: 'companies.update',
    method: 'POST',
    fn: 'lib_records.opUpdateCompany',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'note_fields',
    preview: 'lib_records.previewCompany',
    effect: 'write',
    desc: 'Change fields of a company, values a person entered included. For you it is a proposal a person accepts (to fill empty fields use companies.upsert or records.enrich instead).',
    params: Object.assign({ company: COMPANY }, FIELDS, SOURCE),
  },
  {
    name: 'companies.merge',
    method: 'POST',
    fn: 'lib_records.opMergeCompanies',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'merges',
    preview: 'lib_records.previewMergeCompanies',
    effect: 'write',
    desc: 'Merge two records of the same company: --keep survives with its values, its empty fields are filled from --drop, domains and tags are combined, people, deals and files move; --drop keeps resolving to --keep. One undo restores both.',
    params: { keep: S('Company id to keep', { required: true }), drop: S('Company id to merge into it', { required: true }) },
  },
  {
    name: 'companies.delete',
    method: 'POST',
    fn: 'lib_records.opDeleteCompany',
    perm: 'network:full',
    agent: 'deny',
    destructive: true,
    effect: 'write',
    desc: 'Move a company to the trash (its history stays; companies.list --deleted true lists it).',
    params: { company: COMPANY },
  },
  {
    name: 'companies.logo-set',
    method: 'POST',
    fn: 'lib_logos.opCompanySet',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'logos',
    preview: 'lib_logos.previewCompanySet',
    effect: 'write',
    files: ['file'],
    bodyLimit: 8388608,
    desc: "Set a company's own logo: one PNG, JPG, WebP or SVG image, 2 MB at most (people upload it as the multipart field file). You give --paths with the absolute path of the image file; for you it is a proposal a person accepts (the image is kept with the proposal). Every screen then shows it in place of the website icon.",
    params: { company: COMPANY, paths: S('Your AI agent: JSON list with the absolute path of one image, e.g. ["C:/logos/acme.png"]'), source_ref: S('Where the image came from (the company website, a deck page)') },
  },
  {
    name: 'companies.logo-remove',
    method: 'POST',
    fn: 'lib_logos.opCompanyRemove',
    perm: 'network:edit',
    agent: 'deny',
    effect: 'write',
    desc: "Remove a company's own logo (people only): screens show its website icon, else its first letter.",
    params: { company: COMPANY },
  },
  {
    name: 'companies.logo',
    method: 'GET',
    fn: 'lib_logos.opCompanyGet',
    perm: 'signed',
    effect: 'read',
    desc: "A company's own logo image (the logo_url company reads carry). You get its local path. 404 when the company has none.",
    params: { company: COMPANY, v: S('Version (changes with the image; any value)') },
  },
  {
    name: 'companies.timeline',
    method: 'GET',
    fn: 'lib_records.opTimelineCompany',
    perm: 'network:view',
    effect: 'read',
    desc: 'Everything dated about a company from every module, newest first: added, people joining, its deals and their stages, files, and what other modules add. hidden counts items of deals you may not see.',
    params: { company: COMPANY, limit: N('Items (default 50)'), before: S('Only items before this time (next_before of the last page)') },
  },
];
