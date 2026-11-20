/**
 * Catalog: investment theses (kernel-records). Criteria use the shared fact
 * keys (theses.keys); fit is tri-state with no score. Your AI agent reads
 * theses; adding or changing one is a proposal.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

const THESIS = S('Thesis id or name', { required: true });

module.exports = [
  {
    name: 'theses.list',
    method: 'GET',
    fn: 'lib_theses.opList',
    perm: 'markets:view|intake:view',
    effect: 'read',
    desc: 'The firm\'s theses (active by default) with their criteria, fund and owner.',
    params: { status: S('active, archived or all', { enum: ['active', 'archived', 'all'] }), fund: S('Only theses of this fund (and firm-wide ones)') },
  },
  {
    name: 'theses.get',
    method: 'GET',
    fn: 'lib_theses.opGet',
    perm: 'markets:view|intake:view',
    effect: 'read',
    desc: 'One thesis: statement, criteria (each with its label), status, fund, owner and provenance.',
    params: { thesis: THESIS },
  },
  {
    name: 'theses.keys',
    method: 'GET',
    fn: 'lib_theses.opKeys',
    perm: 'signed',
    effect: 'read',
    desc: 'The fact keys theses and triage share, each with its type (text, money, int, num, bool), label, operators, and the allowed values of coded keys (stage, round_type, business_model; hq_country and currency are ISO codes).',
  },
  {
    name: 'theses.fit',
    method: 'GET',
    fn: 'lib_theses.opFit',
    perm: 'markets:view|intake:view',
    effect: 'read',
    desc: 'Check facts against a thesis: each criterion met, unmet or unknown (a missing fact is unknown, never unmet; no score). --facts \'{"sector":"fintech","raise_minor":300000000,"currency":"USD"}\' or {"key":{"value","grade"}}.',
    params: { thesis: THESIS, facts: S('JSON object of fact key: value', { required: true }) },
  },
  {
    name: 'theses.save',
    method: 'POST',
    fn: 'lib_theses.opSave',
    perm: 'markets:edit',
    agent: 'propose',
    kind: 'theses',
    preview: 'lib_theses.previewSave',
    effect: 'write',
    desc: 'Add a thesis (no --thesis) or change one: --criteria \'[{"key":"sector","op":"in","values":["fintech"],"required":true},{"key":"raise_minor","op":"between","min":100000000,"max":500000000,"currency":"USD"}]\' (theses.keys lists keys and operators). For you it is a proposal.',
    params: {
      thesis: S('Thesis id or name (to change one)'),
      name: S('Name'),
      statement: S('The thesis in a few sentences'),
      criteria: S('JSON list of criteria'),
      status: S('active or archived', { enum: ['active', 'archived'] }),
      fund: S('Fund id or name (empty: firm-wide)'),
      owner: S('Member id or email, or "me"'),
      sort: N('Order among theses'),
      source_ref: S('Where it came from'),
    },
  },
];
