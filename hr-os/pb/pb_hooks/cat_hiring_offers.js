/**
 * Catalog: offers (approval kind offer, letter from a template, sent,
 * accepted or declined, then the kernel hire), and referrals.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const OFFER = S('Offer id or number (OF0001)', { required: true });

const TERMS = {
  title: S('Job title offered'),
  start_day: S('Start day'),
  pay_basis: S('salary | hourly | daily', { enum: ['salary', 'hourly', 'daily'] }),
  amount: S('Pay in the offer currency, major units, e.g. 7800.00'),
  pay_per: S('year | month | week | day | hour', { enum: ['year', 'month', 'week', 'day', 'hour'] }),
  currency: S('Currency (default the entity\'s)'),
  components: S('JSON list [{name, amount, per: once|year|month|week|day|hour, note}] (signing bonus, allowances)'),
  terms: S('JSON list of offer term ids, or [{title, text}]'),
  template: S('Letter template id (default the default template)'),
  department: S('Department'),
  location: S('Location'),
  employment_type: S('Employment type'),
  expires_day: S('Answer by this day'),
  note: S('Note for the team'),
};

module.exports = [
  { name: 'offers.list', method: 'GET', fn: 'lib_hiring_offers.list', perm: 'hiring:view', effect: 'read', desc: 'Offers the caller may see. Status open (default: draft to accepted, not yet hired), all or one status.', params: { status: S('open | all | draft | pending | approved | sent | accepted | declined | withdrawn'), opening: S('Opening'), q: S('Candidate, title or number contains'), limit: N('Rows'), offset: N('Rows to skip') } },
  { name: 'offers.get', method: 'GET', fn: 'lib_hiring_offers.get', perm: 'hiring:view', effect: 'read', desc: 'One offer with its approval, the letter (markdown) and, once accepted, the prefilled hire.', params: { offer: OFFER } },
  { name: 'offers.create', method: 'POST', fn: 'lib_hiring_offers.create', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Draft an offer for an active application (one open offer at a time); the candidate moves to the offer stage. Send it for approval with offers.submit.', params: Object.assign({ application: S('Application id', { required: true }) }, TERMS) },
  { name: 'offers.update', method: 'POST', fn: 'lib_hiring_offers.update', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Change a draft offer.', params: Object.assign({ offer: OFFER }, TERMS) },
  { name: 'offers.submit', method: 'POST', fn: 'lib_hiring_offers.submit', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Send a draft offer for approval (kind offer). A decline sends it back to draft with the note.', params: { offer: OFFER } },
  { name: 'offers.send', method: 'POST', fn: 'lib_hiring_offers.send', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Mark an approved offer as sent: the letter is frozen; with --email true it goes to the candidate from your AI agent\'s Gmail (when candidate email is on).', params: { offer: OFFER, email: B('Email the letter to the candidate') } },
  { name: 'offers.respond', method: 'POST', fn: 'lib_hiring_offers.respond', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Record the candidate\'s answer. Accepted emits offer.accepted and answers the prefilled hire for people.hire; declined keeps the reason.', params: { offer: OFFER, answer: S('accepted | declined', { required: true, enum: ['accepted', 'declined'] }), reason: S('Why they declined') } },
  { name: 'offers.withdraw', method: 'POST', fn: 'lib_hiring_offers.withdraw', perm: 'hiring:edit', agent: 'deny', effect: 'write', desc: 'Withdraw an offer that is not answered yet (a pending approval is cancelled).', params: { offer: OFFER, reason: S('Why') } },
  { name: 'offers.letter', method: 'GET', fn: 'lib_hiring_offers.letter', perm: 'hiring:view', effect: 'read', desc: 'The offer letter as markdown with the entity and candidate names (the print page renders it).', params: { offer: OFFER } },
  { name: 'offers.hire-draft', method: 'GET', fn: 'lib_hiring_offers.hireDraft', perm: 'hiring:view', effect: 'read', desc: 'The people.hire params for an accepted offer (entity, name, email, title, department, location, type, start day, pay, from_application). A person hires; your AI agent may propose it.', params: { offer: S('Offer id or number'), application: S('Application id (its accepted offer)') } },

  { name: 'referrals.add', method: 'POST', fn: 'lib_hiring_offers.refer', perm: 'signed', agent: 'deny', effect: 'write', files: ['resume'], desc: 'Refer someone for an open role (openings.open-roles): name, email, phone, how you know them, a note, a resume. You see if in process, hired or closed.', params: { opening: S('Open role id or number', { required: true }), name: S('Their name', { required: true }), email: S('Their email'), phone: S('Their phone'), relationship: S('How you know them'), note: S('Why they fit'), path: S('Your AI agent: a file on this machine') } },
  { name: 'referrals.mine', method: 'GET', fn: 'lib_hiring_offers.referralsMine', perm: 'signed', effect: 'read', desc: 'The caller\'s referrals with what they may know: submitted, in process, hired or not moving forward.', params: { limit: N('Rows') } },
  { name: 'referrals.list', method: 'GET', fn: 'lib_hiring_offers.referralsList', perm: 'hiring:view', effect: 'read', desc: 'Referrals on the openings the caller may see, with who referred whom.', params: { opening: S('Opening'), limit: N('Rows') } },
];
