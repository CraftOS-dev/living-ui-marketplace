/**
 * Catalog: customers across every shop.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});

module.exports = [
  { name: 'customers.list', method: 'GET', fn: 'lib_customers.list', effect: 'read', desc: 'Buyers across shops with their order count, total spent (base currency) and last order; repeat buyers with filter=repeat.', params: { q: S('Name, email or phone'), filter: S('all (default) | repeat', { enum: ['all', 'repeat'] }), limit: N('Rows (default 100)'), offset: N('Skip this many') } },
  { name: 'customers.get', method: 'GET', fn: 'lib_customers.get', effect: 'read', desc: "One buyer: details, every order on every shop, and conversations.", params: { customer: S('Customer id, email or phone', { required: true }) } },
  { name: 'customers.update', method: 'POST', fn: 'lib_customers.update', effect: 'write', desc: "Change a buyer's name, email, phone, private note or tags.", params: { customer: S('Customer id, email or phone', { required: true }), name: S('Name'), email: S('Email'), phone: S('Phone'), note: S('Private note'), tags: S('JSON list of tags, e.g. ["wholesale"]') } },
];
