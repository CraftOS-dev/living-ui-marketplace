/**
 * Catalog: references on a deal (diligence module). People hold the calls
 * and log them; your AI agent suggests back-channel names from the firm's
 * own records and may log a reference a person described in a note.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const DEAL = S('Deal id or D-0001', { required: true, example: 'D-0001' });

module.exports = [
  {
    name: 'refs.list',
    method: 'GET',
    fn: 'lib_diligence_refs.opList',
    perm: 'diligence:view',
    effect: 'read',
    desc: "A deal's references: logged calls (kind, signal, note, day) and suggested names, with counts by kind and signal and your AI agent's suggestion ask (its state).",
    params: { deal: DEAL },
  },
  {
    name: 'refs.log',
    method: 'POST',
    fn: 'lib_diligence_refs.opLog',
    perm: 'diligence:edit',
    effect: 'write',
    desc: 'Log a reference call: --deal --person <id or email> or --name, --kind provided|backchannel|customer|expert, --signal positive|neutral|negative, --note (short); --offered true for one named but not called yet. --reference <id> logs a suggested name.',
    params: {
      deal: S('Deal id or D-0001'),
      reference: S('A suggested reference to log'),
      person: S('Person id or email'),
      name: S('Name, when the person is not in the records'),
      kind: S('Kind', { enum: ['provided', 'backchannel', 'customer', 'expert'] }),
      signal: S('Signal', { enum: ['positive', 'neutral', 'negative'] }),
      note: S('A short note'),
      day: S('Day of the call, YYYY-MM-DD (default today)'),
      offered: { type: 'boolean', desc: 'true: offered (named in a meeting) but not called yet; kept as a name to call, no signal' },
    },
  },
  {
    name: 'refs.candidates',
    method: 'GET',
    fn: 'lib_diligence_refs.opCandidates',
    perm: 'diligence:view',
    effect: 'read',
    desc: "People in the firm's records who worked at a founder's past company (employments), with the overlap in days (null when dates are missing). Founders and people already listed are left out.",
    params: { deal: DEAL },
  },
  {
    name: 'refs.suggest',
    method: 'POST',
    fn: 'lib_diligence_refs.opSuggest',
    perm: 'diligence:edit',
    effect: 'write',
    desc: 'Suggest back-channel names: --suggestions \'[{"person":"<id or email>","founder":"<founder id>","company":"<shared company id>","why":"Both at Stripe 2019 to 2021"}]\'. Only people in the records; a name already listed is kept.',
    params: { deal: DEAL, suggestions: S('JSON list of {person, founder, company, kind?, why}', { required: true }) },
  },
  {
    name: 'refs.dismiss',
    method: 'POST',
    fn: 'lib_diligence_refs.opDismiss',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    desc: 'A person drops a suggested name.',
    params: { reference: S('Reference id', { required: true }) },
  },
  {
    name: 'refs.ask',
    method: 'POST',
    fn: 'lib_diligence_refs.opAsk',
    perm: 'diligence:edit',
    agent: 'deny',
    effect: 'write',
    track: false,
    desc: 'Ask your AI agent for back-channel names now (trigger refs_suggest); answers the request and its progress. 409 while it waits for an answer, on a cooldown or in a demo firm.',
    params: { deal: DEAL, again: S('The request id a screen saw done or rejected: ask once more') },
  },
];
