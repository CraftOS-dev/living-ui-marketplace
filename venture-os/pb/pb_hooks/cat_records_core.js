/**
 * Catalog: work across records (kernel-records): filling empty fields from
 * a named source, one timeline for any record, likely duplicates.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  {
    name: 'records.enrich',
    method: 'POST',
    fn: 'lib_records.opEnrich',
    perm: 'network:edit|pipeline:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Fill empty fields of one --person, --company or --deal from a named source: --fields \'{"sector":"fintech","founded_year":2021}\' --source_ref "<link>". Empty fields are written; a different value a person entered is kept, and from you becomes a proposal (answer: proposal). Deal money is in major units.',
    params: { person: S('Person id or email'), company: S('Company id, domain or name'), deal: S('Deal id or D-0001'), fields: S('JSON object of field: value', { required: true }), source_ref: S('Where the values came from (required for your AI agent): a link, a file and page') },
  },
  {
    name: 'records.timeline',
    method: 'GET',
    fn: 'lib_records.opTimeline',
    perm: 'signed',
    effect: 'read',
    desc: 'One record\'s dated history from every module, newest first: give --deal, --company or --person. hidden counts items you may not see; --before <next_before> pages back.',
    params: { deal: S('Deal id or D-0001'), company: S('Company id, domain or name'), person: S('Person id or email'), limit: N('Items (default 50)'), before: S('Only items before this time') },
  },
  {
    name: 'records.dupes',
    method: 'GET',
    fn: 'lib_records.opDupes',
    perm: 'network:view',
    effect: 'read',
    desc: 'Likely duplicates: people (or companies, --kind company) with the same normalized name, minus pairs a person marked as different. Merge with people.merge or companies.merge (proposals for you).',
    params: { kind: S('person or company (default company)', { enum: ['person', 'company'] }), limit: N('Groups (default 50)') },
  },
  {
    name: 'records.ignore-dupe',
    method: 'POST',
    fn: 'lib_records.opIgnoreDupe',
    perm: 'network:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Mark two records as different people or companies, so records.dupes stops showing the pair.',
    params: { kind: S('person or company', { required: true, enum: ['person', 'company'] }), a: S('First record id', { required: true }), b: S('Second record id', { required: true }) },
  },
];
