/**
 * Catalog: reports.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const RANGE = S('7d | 30d (default) | 90d | 12m | mtd (this month to date)', { enum: ['7d', '30d', '90d', '12m', 'mtd'] });

module.exports = [
  { name: 'reports.overview', method: 'GET', fn: 'lib_reports.overview', effect: 'read', desc: "Sales across shops in the base currency, days counted in the seller's time zone: net sales, profit, orders, average order, margin and refunds, each with delta_pct (change against the previous period); a series by day (by month for 12m) with the previous period alongside; each shop (delta_pct: change in net sales) with its sparkline; best-selling products; quality (orders missing a cost, orders with no shipping cost of yours) and fees_estimated_share.", params: { range: RANGE, shop: S('Only this shop') } },
  { name: 'reports.attention', method: 'GET', fn: 'lib_reports.attention', effect: 'read', desc: 'What needs the seller now, as counts: orders to ship, late (late_orders names the oldest five), due soon, unpaid, delivery exceptions, messages open and overdue, drafts ready, approvals, listing issues, low and out of stock, missing costs, unlinked SKUs, stock to set on shops, open tasks.', params: {} },
  { name: 'reports.profit', method: 'GET', fn: 'lib_reports.profit', effect: 'read', desc: 'Profit and loss for a period (base currency, the seller\'s days): items, discount, shipping_charged, refunds, net_sales (items - discount + shipping charged - refunds), fees, ship_cost (yours), cogs, profit and margin, in total and per shop; estimates says how much is estimated (fees from rates, orders missing a cost, orders with no shipping cost).', params: { range: RANGE, shop: S('Only this shop') } },
];
