/**
 * Catalog: people, the firm's global person records (kernel-records).
 * Your AI agent creates people and fills empty fields directly (tagged in
 * prov); changing a value a person entered is a proposal (people.update);
 * merges are proposals; deletes are people only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});

const ORIGINS = ['manual', 'capture', 'intake', 'import', 'agent', 'markets', 'portfolio', 'other'];
const PERSON = S('Person id or email', { required: true, example: 'jane@acme.com' });
const FIELDS = {
  name: S('Full name'),
  email: S('Email (the identity: lower case; another address of the same person is added to emails)'),
  emails: S('JSON list of every email of the person'),
  phone: S('Phone'),
  title: S('Job title'),
  company: S('Company id, domain or name (found or created; a work email names it when left out)'),
  linkedin: S('LinkedIn link'),
  location: S('City or region'),
  bio: S('Short biography (4000 characters at most)'),
  tags: S('JSON list of tags'),
};
const SOURCE = { source_ref: S('Where the values came from: a link, a file and page, an email (kept in provenance)') };

module.exports = [
  {
    name: 'people.list',
    method: 'GET',
    fn: 'lib_records.opListPeople',
    perm: 'network:view',
    effect: 'read',
    desc: 'People of the firm, by name: --q searches name, emails and title; --company, --tag, --origin narrow; --deleted true lists the trash. Answers people with total.',
    params: { q: S('Search text'), company: S('Company id, domain or name'), tag: S('A tag'), origin: S('How they entered', { enum: ORIGINS }), deleted: B('true for the trash'), sort: S('name, created or updated', { enum: ['name', 'created', 'updated'] }), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  {
    name: 'people.get',
    method: 'GET',
    fn: 'lib_records.opGetPerson',
    perm: 'network:view',
    effect: 'read',
    desc: 'One person in full: fields with provenance (prov: who set each field, when, from which source), work history, and the deals they are on (deals_hidden counts deals you may not see).',
    params: { person: PERSON },
  },
  {
    name: 'people.upsert',
    method: 'POST',
    fn: 'lib_records.opUpsertPerson',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Find a person by email (or --person) and update them, or add them. A work email names their company (free mail never does). For you: new people and empty fields are written; changing a value a person entered becomes a people.update proposal (answer: proposal). Give --source_ref.',
    params: Object.assign({ person: S('Person id (to update a known person)'), origin: S('How they entered', { enum: ORIGINS }) }, FIELDS, SOURCE),
  },
  {
    name: 'people.update',
    method: 'POST',
    fn: 'lib_records.opUpdatePerson',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'note_fields',
    preview: 'lib_records.previewPerson',
    effect: 'write',
    desc: "Change fields of a person, values a person entered included. For you it is a proposal a person accepts (to fill empty fields use people.upsert or records.enrich instead).",
    params: Object.assign({ person: PERSON }, FIELDS, SOURCE),
  },
  {
    name: 'people.link',
    method: 'POST',
    fn: 'lib_records.opLink',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Add a job to a person\'s work history: --company and --title; --current false with --start_day and --end_day for a past job. A current job becomes their company when it is empty (or set by you or the app). --founder true marks the job a founder\'s (the company page lists them as a founder); false takes that off.',
    params: Object.assign({ person: PERSON, company: S('Company id, domain or name', { required: true }), title: S('Job title'), current: B('false for a past job (default true)'), founder: B('A founder of the company'), start_day: S('YYYY-MM-DD'), end_day: S('YYYY-MM-DD') }, SOURCE),
  },
  {
    name: 'people.unlink',
    method: 'POST',
    fn: 'lib_records.opUnlink',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'people_links',
    preview: 'lib_records.previewUnlink',
    effect: 'write',
    desc: 'Take a person off a company: their current job there ends today, the company leaves their record, and their founder or contact seats on its deals go. For you it is a proposal a person accepts.',
    params: { person: PERSON, company: S('Company id, domain or name', { required: true }) },
  },
  {
    name: 'people.merge',
    method: 'POST',
    fn: 'lib_records.opMergePeople',
    perm: 'network:edit',
    agent: 'propose',
    kind: 'merges',
    preview: 'lib_records.previewMergePeople',
    effect: 'write',
    desc: 'Merge two records of the same person: --keep survives with its values, its empty fields are filled from --drop, emails and tags are combined, every link moves; --drop keeps resolving to --keep. One undo restores both.',
    params: { keep: S('Person id to keep', { required: true }), drop: S('Person id to merge into it', { required: true }) },
  },
  {
    name: 'people.delete',
    method: 'POST',
    fn: 'lib_records.opDeletePerson',
    perm: 'network:full',
    agent: 'deny',
    destructive: true,
    effect: 'write',
    desc: 'Move a person to the trash (their history stays; people.list --deleted true lists it).',
    params: { person: PERSON },
  },
  {
    name: 'people.timeline',
    method: 'GET',
    fn: 'lib_records.opTimelinePerson',
    perm: 'network:view',
    effect: 'read',
    desc: 'Everything dated about a person from every module, newest first: added, jobs, deals and their stages, files, and what other modules add (meetings, notes). --before <next_before> pages back.',
    params: { person: PERSON, limit: N('Items (default 50)'), before: S('Only items before this time (next_before of the last page)') },
  },
];
