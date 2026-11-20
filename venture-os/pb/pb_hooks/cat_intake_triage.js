/**
 * Catalog: triage and pass emails (intake). Your AI agent reads decks and
 * saves facts (allow) and drafts pass emails (allow); confirming facts and
 * writing a pass email from the template are people only.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

const ITEM = S('Intake item id or display id', { required: true, example: 'IN-0007' });
const PASS_PARAMS = {
  deal: S('Deal id, D-0007 or its company name', { required: true }),
  reason: S('Reason chip: team, market, product, traction, valuation, thesis_fit, timing or other (labels work too)', { required: true }),
  criterion: S('The specific criterion, in a few words (e.g. "valuation too high for current traction")'),
  revisit_milestone: S('What would make us look again, e.g. USD 1M ARR'),
  revisit_day: S('A day to look again (YYYY-MM-DD, after today)'),
  note: S('An internal note (never in the email)'),
  to: S('JSON list of pass email recipients (default: the founders on file)'),
  email: { type: 'boolean', desc: 'false: no pass email' },
};

module.exports = [
  {
    name: 'triage.start',
    method: 'POST',
    fn: 'lib_intake_triage.opStart',
    perm: 'intake:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Start reading an item (its step becomes Reading). Answers the work: the item and its email text, files with text state and image pages, the fact keys with types and allowed values, grades, the standard slides, facts so far, prior history and the active theses.',
    params: { item: ITEM },
  },
  {
    name: 'triage.facts-save',
    method: 'POST',
    fn: 'lib_intake_triage.opFactsSave',
    perm: 'intake:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Save what the deck says. --facts \'[{"key":"raise_minor","value":"3000000","currency":"USD","grade":"founder_reported","file":"<id>","page":7,"quote":"<exact words>"}]\' (percents as 15 for 15%; unknown: value null). Also --company, --one_liner, --founders, --missing (slide keys), --questions.',
    params: {
      item: ITEM,
      facts: S('JSON list of {key, value, currency (money), grade, file, page, quote, url (public), num_kind, note}'),
      company: S('Company: JSON {"name","domain","website"} or a name or domain'),
      one_liner: S('What the company does, in one line'),
      founders: S('JSON list of {"name","email","title","linkedin"}'),
      missing: S('JSON list of standard slides the deck lacks: problem, solution, product, market, business_model, traction, competition, team, financials, ask'),
      questions: S('JSON list of open questions for the founders (at most 12)'),
    },
  },
  {
    name: 'triage.fit',
    method: 'GET',
    fn: 'lib_intake_triage.opFit',
    perm: 'intake:view',
    effect: 'read',
    desc: 'An item against every active thesis: each criterion met, unmet or unknown from the facts (unknown is never unmet; no score).',
    params: { item: ITEM },
  },
  {
    name: 'triage.confirm',
    method: 'POST',
    fn: 'lib_intake_triage.opConfirm',
    perm: 'intake:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Confirm facts your AI agent read (--keys JSON list; all when empty). A confirmed value is never overwritten by your AI agent.',
    params: { item: ITEM, keys: S('JSON list of fact keys') },
  },
  {
    name: 'passes.draft',
    method: 'POST',
    fn: 'lib_intake_pass.opDraft',
    perm: 'intake:edit',
    agent: 'allow',
    effect: 'write',
    desc: 'Draft the pass email of a passed item as a message the person who passed approves and sends (never sent by you). --subject, --body; --to defaults to the founders. Your own untouched draft is replaced; one a person edited is refused.',
    params: { pass: S('Pass id'), item: S('Intake item id or display id (its current pass)'), deal: S('A passed deal (D-0007 or its company name): its pass'), subject: S('Subject', { required: true }), body: S('The email', { required: true }), to: S('JSON list of recipients') },
  },
  {
    name: 'passes.create',
    method: 'POST',
    fn: 'lib_intake_pass.opCreate',
    perm: 'pipeline:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Pass on a deal (any stage, any pipeline): one reason chip, an optional criterion and revisit. The deal is passed, the pass is kept (anti-portfolio, revisit) and your AI agent is asked to draft the pass email to the founders (trigger pass_draft) unless --email false.',
    params: PASS_PARAMS,
  },
  {
    name: 'passes.request',
    method: 'POST',
    fn: 'lib_intake_pass.opCreate',
    perm: 'pipeline:edit',
    agent: 'propose',
    kind: 'passes',
    preview: 'lib_intake_pass.previewCreate',
    effect: 'write',
    desc: 'Your AI agent: propose passing a deal a person asked you to pass (reason chip, criterion, revisit). The person who accepts passes it; the app then asks you for the email (trigger pass_draft): passes.draft.',
    params: PASS_PARAMS,
  },
  {
    name: 'passes.write',
    method: 'POST',
    fn: 'lib_intake_pass.opWrite',
    perm: 'intake:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'Write the pass email yourself now: an editable draft from the firm\'s template. Answers the draft.',
    params: { pass: S('Pass id'), item: S('Intake item id or display id'), to: S('JSON list of recipients') },
  },
  {
    name: 'passes.list',
    method: 'GET',
    fn: 'lib_intake_pass.opList',
    perm: 'intake:view',
    effect: 'read',
    desc: 'Passes, newest first, with reason, criterion, revisit, the email state and a snapshot of the facts and fit at the time; counts by reason. --pass gives one pass (the one a pass_draft trigger names).',
    params: { pass: S('One pass by id'), reason: S('Only this reason', { enum: ['team', 'market', 'product', 'traction', 'valuation', 'thesis_fit', 'timing', 'other'] }), company: S('Company id, domain or name'), from_day: S('From day (YYYY-MM-DD)'), to_day: S('To day (YYYY-MM-DD)'), limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
];
