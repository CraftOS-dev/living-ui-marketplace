/**
 * Catalog: approvals.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const PROPOSAL = S('The proposal id', { required: true });

module.exports = [
  { name: 'proposals.list', method: 'GET', fn: 'lib_proposals.list', effect: 'read', desc: 'Proposals waiting for the seller (pending, oldest first) or decided ones: each with its items (what changes, before and after), risk and notes.', params: { status: S('pending (default) | decided | all', { enum: ['pending', 'decided', 'all'] }), limit: N('Rows (default 100)') } },
  { name: 'proposals.get', method: 'GET', fn: 'lib_proposals.get', effect: 'read', desc: 'One proposal with its items and their states (pending, applied, stale, failed, rejected, undone).', params: { proposal: PROPOSAL } },
  {
    name: 'proposals.create',
    method: 'POST',
    fn: 'lib_proposals.create',
    effect: 'write',
    desc: 'Your AI agent: propose several changes as one set for the seller to approve at once. Each item is an operation that needs approval (listings.draft, variants.set-price, stock.adjust, stock.count, orders.cancel, orders.refund, orders.return) with its params.',
    params: { title: S('What the set does, e.g. "Listings for the blue mug on 3 shops"'), why: S('One or two lines on why'), items: S('JSON list like [{"op":"listings.draft","params":{"product":"...","shop":"...","title":"..."}}]', { required: true }) },
  },
  { name: 'proposals.approve', method: 'POST', fn: 'lib_proposals.approve', effect: 'confirm', agent: 'deny', press: 'Approve in Approvals', desc: 'Apply a proposal (all items, or the chosen ones; the rest are rejected). Each item is checked again first and skipped as stale if what it changes moved.', params: { proposal: PROPOSAL, items: S('JSON list of item indexes to apply (default all)') } },
  { name: 'proposals.reject', method: 'POST', fn: 'lib_proposals.reject', effect: 'confirm', agent: 'deny', press: 'Reject in Approvals', desc: 'Reject a proposal, with a note for your AI agent.', params: { proposal: PROPOSAL, note: S('Why, so your AI agent does better next time') } },
  { name: 'proposals.undo', method: 'POST', fn: 'lib_proposals.undo', effect: 'confirm', agent: 'deny', press: 'Undo on an applied proposal', desc: 'Put back what an applied proposal changed (listing text and price, SKU prices, stock). Order actions cannot be undone.', params: { proposal: PROPOSAL } },
  { name: 'proposals.withdraw', method: 'POST', fn: 'lib_proposals.withdraw', effect: 'write', desc: 'Withdraw a pending proposal (it no longer applies).', params: { proposal: PROPOSAL } },
];
