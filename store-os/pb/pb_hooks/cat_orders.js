/**
 * Catalog: orders, shipments, returns and refunds.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const ORDER = S('The order (id or order number)', { required: true });
const SHOP = S('The shop, when two shops share an order number');
const TRACK = ['pending', 'info_received', 'in_transit', 'out_for_delivery', 'available_for_pickup', 'delivered', 'failed_attempt', 'exception', 'returned'];

module.exports = [
  {
    name: 'orders.list',
    method: 'GET',
    fn: 'lib_orders.list',
    effect: 'read',
    desc: 'Orders across shops by view: to_ship (default, by ship-by), unpaid, at_risk (late or due within a day), shipped, exceptions (tracking problem or no update for 7 days), delivered, returns, cancelled, unlinked (a line whose SKU is not in the catalog), all. counts gives each view\'s size. Each row has the shop, buyer, items, total, status, ship-by, hours left, health and tracking.',
    params: { view: S('to_ship | unpaid | at_risk | shipped | exceptions | delivered | returns | cancelled | unlinked | all', { enum: ['to_ship', 'unpaid', 'at_risk', 'shipped', 'exceptions', 'delivered', 'returns', 'cancelled', 'unlinked', 'all'] }), shop: S('Only this shop'), q: S('Order number, buyer name, email or phone'), from: S('Placed on or after (date)'), to: S('Placed on or before (date)'), limit: N('Rows (default 100)'), offset: N('Skip this many') },
  },
  { name: 'orders.get', method: 'GET', fn: 'lib_orders.get', effect: 'read', desc: 'One order: lines (with SKU links), buyer and address, money (fees, shipping cost, cost of goods, profit and margin in the base currency), shipments with tracking events, conversations, a timeline and tasks.', params: { order: ORDER, shop: SHOP } },
  {
    name: 'orders.add',
    method: 'POST',
    fn: 'lib_orders.add',
    effect: 'write',
    desc: 'Add an order by hand (the Direct shop by default: chat, social and in-person sales). Lines take a SKU (its price is used when none is given) or a title.',
    params: {
      shop: S('The shop (default Direct)'),
      number: S('Order number (Direct orders are numbered D1001, D1002...)'),
      lines: S('JSON list like [{"sku":"MUG-BLU","qty":2,"price":29}] or [{"title":"Gift wrap","qty":1,"price":5}]', { required: true }),
      buyer_name: S('Buyer name'),
      buyer_email: S('Buyer email'),
      buyer_phone: S('Buyer phone'),
      address: S('Delivery address (text or JSON object)'),
      shipping: N('Shipping charged to the buyer'),
      discount: N('Discount'),
      tax: N('Tax'),
      total: N('Total (default: items - discount + shipping + tax)'),
      fees: N('Platform or payment fees, when known'),
      ship_cost: N('What the shipping costs you'),
      payment: S('paid (default) | pending | cod | refunded | partial_refund', { enum: ['paid', 'pending', 'cod', 'refunded', 'partial_refund'] }),
      status: S('to_ship (default) | unpaid', { enum: ['to_ship', 'unpaid'] }),
      currency: S("Currency (default: the shop's)"),
      placed_at: S('When it was placed (default now)'),
      ship_by: S("Ship by (default: placed + the shop's days to ship)"),
      note: S('Note'),
    },
  },
  { name: 'orders.upsert-many', method: 'POST', fn: 'lib_orders.upsertOp', effect: 'write', desc: "Bring in a shop's orders (your AI agent's sync): created or updated by order number, so repeating is safe. Status only moves forward. Orders that arrive already shipped do not move stock. Row format: app.guide rows.order.", params: { shop: S('The shop (id or name)', { required: true }), items: S('JSON list of order rows (up to 2000)', { required: true }) } },
  { name: 'orders.ship', method: 'POST', fn: 'lib_orders.ship', effect: 'write', desc: 'Mark an order shipped (its items leave the shelf) with the carrier and tracking number.', params: { order: ORDER, shop: SHOP, carrier: S('Carrier, e.g. "J&T Express"'), tracking: S('Tracking number'), url: S('Tracking link'), shipped_at: S('When (default now)') } },
  { name: 'orders.ship-many', method: 'POST', fn: 'lib_orders.shipMany', effect: 'write', desc: 'Mark many orders shipped at once.', params: { items: S('JSON list like [{"order":"1043","carrier":"J&T Express","tracking":"JT123"}]', { required: true }) } },
  { name: 'orders.deliver', method: 'POST', fn: 'lib_orders.deliver', effect: 'write', desc: 'Mark an order delivered.', params: { order: ORDER, shop: SHOP, delivered_at: S('When (default now)') } },
  { name: 'orders.cancel', method: 'POST', fn: 'lib_orders.cancel', effect: 'write', agent: 'propose', kind: 'orders', desc: 'Cancel an order that has not shipped (its reserved items go back to available). Cancel it on the platform too; a paid order needs its refund recorded with orders.refund.', params: { order: ORDER, shop: SHOP, reason: S('The cancel reason stored on the order, e.g. "buyer changed their mind"') } },
  { name: 'orders.refund', method: 'POST', fn: 'lib_orders.refund', effect: 'write', agent: 'propose', kind: 'orders', desc: "Record a refund on an order (in the order's currency); the money itself is returned on the platform.", params: { order: ORDER, shop: SHOP, amount: N('Amount refunded', { required: true }), reason: S('Why') } },
  { name: 'orders.return', method: 'POST', fn: 'lib_orders.returnItems', effect: 'write', agent: 'propose', kind: 'orders', desc: 'Record items coming back (all lines when none are given); restock=true puts them back in stock.', params: { order: ORDER, shop: SHOP, lines: S('JSON list like [{"sku":"MUG-BLU","qty":1}] or [{"line":"<line id>","qty":1}]'), restock: B('Put the items back in stock') } },
  {
    name: 'orders.update',
    method: 'POST',
    fn: 'lib_orders.update',
    effect: 'write',
    desc: "Change an order's buyer details, address, note, ship-by, payment, what the buyer was charged (shipping, discount, tax: the total follows), fees (\"\" goes back to estimated) or your shipping cost; status only between unpaid and to_ship.",
    params: { order: ORDER, shop: SHOP, buyer_name: S('Buyer name'), buyer_email: S('Buyer email'), buyer_phone: S('Buyer phone'), address: S('Address (text or JSON)'), note: S('Note'), ship_by: S('Ship by'), payment: S('paid | pending | cod | refunded | partial_refund', { enum: ['paid', 'pending', 'cod', 'refunded', 'partial_refund'] }), status: S('unpaid | to_ship', { enum: ['unpaid', 'to_ship'] }), shipping: N('Shipping charged to the buyer (order currency)'), discount: N('Discount given to the buyer (order currency)'), tax: N('Tax charged to the buyer (order currency)'), fees: S('Fees the platform charged (major units), or "" to estimate them'), ship_cost: N('What the shipping cost you') },
  },
  { name: 'orders.link-line', method: 'POST', fn: 'lib_orders.linkLine', effect: 'write', desc: 'Link an order line whose SKU is not in the catalog to one of your SKUs (other lines with the same SKU text are linked too).', params: { line: S('Order line id', { required: true }), variant: S('Your SKU (or variant id)', { required: true }), all: B('false: only this line') } },
  { name: 'orders.line-extra', method: 'POST', fn: 'lib_orders.lineExtra', effect: 'write', desc: 'Mark an order line as not a product (a gift card, gift wrap, a service fee): it moves no stock, takes the cost you give (0 when it costs nothing) and stops counting as an unknown SKU. Store OS remembers it by SKU (else title) for later orders.', params: { line: S('Order line id', { required: true }), cost: N('What it costs you per unit, in the base currency (default 0)'), all: B('false: only this line (default: every line with the same SKU or title)') } },
  { name: 'orders.remove', method: 'POST', fn: 'lib_orders.remove', effect: 'write', agent: 'deny', destructive: true, lookup: 'lib_orders.lookupOrder', press: 'Delete order on the order page', desc: 'Delete an order (stock moves already made stay in the ledger).', params: { order: ORDER, shop: SHOP } },
  { name: 'orders.help', method: 'POST', fn: 'lib_orders.requestHelp', effect: 'write', desc: 'Ask your AI agent to check an order\'s tracking (task tracking) or sort out a delivery problem (task exception).', params: { order: ORDER, shop: SHOP, task: S('tracking | exception', { required: true, enum: ['tracking', 'exception'] }), note: S('Anything it should know') } },
  { name: 'orders.track-all', method: 'POST', fn: 'lib_orders.requestTrackAll', effect: 'write', desc: 'Ask your AI agent to check the tracking of every parcel on its way.', params: {} },
  {
    name: 'shipments.update',
    method: 'POST',
    fn: 'lib_orders.shipmentUpdate',
    effect: 'write',
    desc: "Record tracking: status, the latest event and its time, carrier, number, link, estimated delivery. A delivered status marks the order delivered. Name the shipment, or the order (its latest shipment).",
    params: { shipment: S('Shipment id'), order: S('The order (id or number)'), shop: SHOP, status: S(TRACK.join(' | '), { enum: TRACK }), event: S('The latest event as the carrier words it'), event_at: S('When it happened'), carrier: S('Carrier'), tracking: S('Tracking number'), url: S('Tracking link'), eta: S('Estimated delivery date') },
  },
];
