/// <reference path="../pb_data/types.d.ts" />
/**
 * Reports over trading days (business days: local dates with the shop's
 * cutoff hour). Training sales never count.
 *
 * Net sales are before tax and after discounts and returns (with
 * tax-inclusive prices the tax inside each price is taken out). Collected is
 * what changed hands: totals plus cash rounding. Gross profit counts only
 * lines whose product has a cost.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}

function core() {
  return require(`${__hooks}/lib_core.js`);
}

const NET_EX = "CASE WHEN s.price_mode = 'inclusive' THEN l.net - l.tax ELSE l.net END";

function kpis(app, from, to, regId) {
  const util = u();
  const bind = { from: from, to: to, reg: regId };
  const regSql = regId !== '' ? ' AND s.register = {:reg}' : '';
  const sale = util.rows(
    app,
    "SELECT COUNT(CASE WHEN s.kind != 'refund' THEN 1 END) AS orders, COUNT(CASE WHEN s.kind = 'refund' THEN 1 END) AS refunds, IFNULL(SUM(s.total + s.rounding), 0) AS collected, IFNULL(SUM(s.tax_total), 0) AS tax, IFNULL(SUM(s.service_charge), 0) AS service FROM sales s WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}" + regSql,
    { orders: 0, refunds: 0, collected: 0, tax: 0, service: 0 },
    bind,
  )[0];
  const line = util.rows(
    app,
    'SELECT IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.qty END), 0) AS items, IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.gross END), 0) AS gross, IFNULL(SUM(CASE WHEN l.qty > 0 THEN l.line_discount + l.order_discount END), 0) AS discounts, IFNULL(SUM(CASE WHEN l.qty < 0 THEN -l.net END), 0) AS returns, IFNULL(SUM(' +
      NET_EX +
      '), 0) AS net, IFNULL(SUM(CASE WHEN l.cost > 0 THEN ' +
      NET_EX +
      ' - l.cost * l.qty END), 0) AS profit, IFNULL(SUM(CASE WHEN l.cost > 0 THEN ' +
      NET_EX +
      ' END), 0) AS costed FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' +
      regSql,
    { items: 0, gross: 0, discounts: 0, returns: 0, net: 0, profit: 0, costed: 0 },
    bind,
  )[0];
  const service = sale.service;
  return {
    net_sales: line.net + service,
    gross: line.gross,
    discounts: line.discounts,
    returns: line.returns,
    tax: sale.tax,
    service_charge: service,
    collected: sale.collected,
    orders: sale.orders,
    refunds: sale.refunds,
    average: sale.orders > 0 ? Math.round(sale.collected / sale.orders) : 0,
    items: line.items,
    gross_profit: line.profit,
    costed_sales: line.costed,
  };
}

function summary(app, p) {
  const util = u();
  const s = core().shop(app);
  const today = util.businessDay(s.day_cutoff_hour);
  const from = util.day(p, 'from', today);
  const to = util.day(p, 'to', from > today ? from : today);
  if (to < from) throw util.fail(400, 'to must be on or after from');
  const span = util.daysBetween(from, to) + 1;
  if (span > 3660) throw util.fail(400, 'A report covers at most 10 years');
  const regRef = util.str(p, 'register', '');
  const regId = regRef !== '' ? core().register(app, regRef).id : '';
  const regSql = regId !== '' ? ' AND s.register = {:reg}' : '';
  const bind = { from: from, to: to, reg: regId };
  const prevTo = util.addDays(from, -1);
  const prevFrom = util.addDays(from, -span);

  const byDay = {};
  for (const r of util.rows(
    app,
    "SELECT s.business_day AS day, COUNT(CASE WHEN s.kind != 'refund' THEN 1 END) AS orders, IFNULL(SUM(s.total + s.rounding), 0) AS collected FROM sales s WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}" + regSql + ' GROUP BY s.business_day',
    { day: '', orders: 0, collected: 0 },
    bind,
  )) {
    byDay[r.day] = { orders: r.orders, collected: r.collected, net: 0 };
  }
  for (const r of util.rows(
    app,
    'SELECT s.business_day AS day, IFNULL(SUM(' + NET_EX + '), 0) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' + regSql + ' GROUP BY s.business_day',
    { day: '', net: 0 },
    bind,
  )) {
    if (byDay[r.day] === undefined) byDay[r.day] = { orders: 0, collected: 0, net: 0 };
    byDay[r.day].net = r.net;
  }
  const days = [];
  if (span <= 400) {
    for (let d = from; d <= to; d = util.addDays(d, 1)) {
      const x = byDay[d] || { orders: 0, collected: 0, net: 0 };
      days.push({ day: d, orders: x.orders, collected: x.collected, net: x.net });
    }
  } else {
    // Long ranges by month.
    const months = {};
    for (const d of Object.keys(byDay)) {
      const m = d.slice(0, 7);
      if (months[m] === undefined) months[m] = { orders: 0, collected: 0, net: 0 };
      months[m].orders += byDay[d].orders;
      months[m].collected += byDay[d].collected;
      months[m].net += byDay[d].net;
    }
    for (const m of Object.keys(months).sort()) days.push({ day: m, orders: months[m].orders, collected: months[m].collected, net: months[m].net });
  }

  // Hours of the day, in the shop's local time.
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({ hour: h, orders: 0, collected: 0 });
  for (const r of util.rows(
    app,
    'SELECT s.created AS created, s.kind AS kind, s.total + s.rounding AS collected FROM sales s WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' + regSql,
    { created: '', kind: '', collected: 0 },
    bind,
  )) {
    const h = util.localHour(r.created);
    if (r.kind !== 'refund') hours[h].orders += 1;
    hours[h].collected += r.collected;
  }

  const products = util.rows(
    app,
    "SELECT l.name || CASE WHEN l.variant_name != '' THEN ' ' || l.variant_name ELSE '' END AS name, IFNULL(SUM(l.qty), 0) AS qty, IFNULL(SUM(" +
      NET_EX +
      '), 0) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' +
      regSql +
      ' GROUP BY 1 ORDER BY net DESC LIMIT 25',
    { name: '', qty: 0, net: 0 },
    bind,
  );
  const categories = util.rows(
    app,
    "SELECT CASE WHEN l.category = '' THEN 'No category' ELSE l.category END AS name, IFNULL(SUM(l.qty), 0) AS qty, IFNULL(SUM(" +
      NET_EX +
      '), 0) AS net FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' +
      regSql +
      ' GROUP BY 1 ORDER BY net DESC',
    { name: '', qty: 0, net: 0 },
    bind,
  );
  const tenders = util.rows(
    app,
    'SELECT py.name AS name, py.kind AS kind, COUNT(py.id) AS count, IFNULL(SUM(py.amount), 0) AS amount FROM payments py JOIN sales s ON s.id = py.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}' +
      regSql +
      ' GROUP BY py.name, py.kind ORDER BY amount DESC',
    { name: '', kind: '', count: 0, amount: 0 },
    bind,
  );
  const staffNames = {};
  for (const st of app.findRecordsByFilter('staff', '', '', 0, 0)) staffNames[st.id] = st.getString('name');
  const staff = util
    .rows(
      app,
      "SELECT s.staff AS staff, COUNT(CASE WHEN s.kind != 'refund' THEN 1 END) AS orders, IFNULL(SUM(s.total + s.rounding), 0) AS collected FROM sales s WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}" + regSql + ' GROUP BY s.staff ORDER BY collected DESC',
      { staff: '', orders: 0, collected: 0 },
      bind,
    )
    .map((r) => ({ name: staffNames[r.staff] || 'Unknown', orders: r.orders, collected: r.collected }));
  const types = util.rows(
    app,
    "SELECT s.order_type AS type, COUNT(CASE WHEN s.kind != 'refund' THEN 1 END) AS orders, IFNULL(SUM(s.total + s.rounding), 0) AS collected FROM sales s WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to}" + regSql + ' GROUP BY s.order_type ORDER BY collected DESC',
    { type: '', orders: 0, collected: 0 },
    bind,
  );
  const discounts = util.rows(
    app,
    "SELECT CASE WHEN l.discount_name = '' THEN 'Other discounts' ELSE l.discount_name END AS name, COUNT(DISTINCT l.sale) AS sales, IFNULL(SUM(l.line_discount + l.order_discount), 0) AS amount FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND l.qty > 0 AND (l.line_discount + l.order_discount) > 0 AND s.business_day >= {:from} AND s.business_day <= {:to}" +
      regSql +
      ' GROUP BY 1 ORDER BY amount DESC',
    { name: '', sales: 0, amount: 0 },
    bind,
  );
  const taxes = {};
  for (const sale of app.findRecordsByFilter('sales', 'training = false && business_day >= {:from} && business_day <= {:to}' + (regId !== '' ? ' && register = {:reg}' : ''), '', 0, 0, bind)) {
    for (const t of util.jsonOf(sale, 'taxes', [])) {
      const key = String(t.rate_bp);
      if (taxes[key] === undefined) taxes[key] = { name: t.name, rate_bp: t.rate_bp, base: 0, tax: 0, gross: 0 };
      else if (t.name && taxes[key].name.split(' + ').indexOf(t.name) < 0) taxes[key].name += ' + ' + t.name;
      taxes[key].base += t.base;
      taxes[key].tax += t.tax;
      taxes[key].gross += t.gross;
    }
  }
  return {
    from: from,
    to: to,
    days: span,
    register: regId,
    currency: s.currency,
    currency_decimals: s.exp,
    price_mode: s.price_mode,
    kpis: kpis(app, from, to, regId),
    previous: Object.assign({ from: prevFrom, to: prevTo }, kpis(app, prevFrom, prevTo, regId)),
    by_day: days,
    by_hour: hours,
    products: products,
    categories: categories,
    tenders: tenders,
    staff: staff,
    order_types: types,
    discounts: discounts,
    taxes: Object.keys(taxes)
      .map((k) => taxes[k])
      .sort((a, b) => b.rate_bp - a.rate_bp),
  };
}

/** CSV text (one row per sale, or per line) for accounting or a spreadsheet. */
function exportCsv(app, p) {
  const util = u();
  const s = core().shop(app);
  const today = util.businessDay(s.day_cutoff_hour);
  const from = util.day(p, 'from', today);
  const to = util.day(p, 'to', today);
  const what = util.oneOf(p, 'what', ['sales', 'lines', 'payments'], 'sales');
  const m = (n, cur) => util.minorText(n, core().exponent(cur));
  const cell = (v) => {
    const t = String(v === null || v === undefined ? '' : v);
    return /[",\n\r]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t;
  };
  const rowsOut = [];
  const bind = { from: from, to: to };
  if (what === 'sales') {
    rowsOut.push(['Receipt', 'Kind', 'Business day', 'Time (UTC)', 'Register', 'Staff', 'Customer', 'Order type', 'Order number', 'Items', 'Subtotal', 'Discounts', 'Service charge', 'Tax', 'Rounding', 'Total', 'Currency', 'Payments']);
    for (const r of util.rows(
      app,
      "SELECT s.number AS number, s.kind AS kind, s.business_day AS day, s.created AS created, IFNULL(rg.code, '') AS reg, IFNULL(st.name, '') AS staff, IFNULL(c.name, '') AS customer, s.order_type AS type, s.order_no AS order_no, s.item_count AS items, s.subtotal AS subtotal, s.discount_total AS discount, s.service_charge AS service, s.tax_total AS tax, s.rounding AS rounding, s.total AS total, s.currency AS currency, IFNULL((SELECT GROUP_CONCAT(py.name || ' ' || py.amount, '; ') FROM payments py WHERE py.sale = s.id), '') AS pays FROM sales s LEFT JOIN registers rg ON rg.id = s.register LEFT JOIN staff st ON st.id = s.staff LEFT JOIN customers c ON c.id = s.customer WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to} ORDER BY s.created",
      { number: '', kind: '', day: '', created: '', reg: '', staff: '', customer: '', type: '', order_no: 0, items: 0, subtotal: 0, discount: 0, service: 0, tax: 0, rounding: 0, total: 0, currency: '', pays: '' },
      bind,
    )) {
      const pays = r.pays === '' ? '' : r.pays.split('; ').map((x) => {
        const i = x.lastIndexOf(' ');
        return x.slice(0, i) + ' ' + m(Number(x.slice(i + 1)), r.currency);
      }).join('; ');
      rowsOut.push([r.number, r.kind, r.day, r.created, r.reg, r.staff, r.customer, r.type, r.order_no || '', r.items, m(r.subtotal, r.currency), m(r.discount, r.currency), m(r.service, r.currency), m(r.tax, r.currency), m(r.rounding, r.currency), m(r.total, r.currency), r.currency, pays]);
    }
  } else if (what === 'lines') {
    rowsOut.push(['Receipt', 'Business day', 'Line', 'Product', 'Variant', 'SKU', 'Category', 'Qty', 'Unit price', 'Options', 'Gross', 'Discount', 'Net', 'Tax class', 'Tax rate %', 'Tax', 'Cost', 'Currency']);
    for (const r of util.rows(
      app,
      'SELECT s.number AS number, s.business_day AS day, l.line_no AS line_no, l.name AS name, l.variant_name AS variant, l.sku AS sku, l.category AS category, l.qty AS qty, l.unit AS unit, l.modifiers AS mods, l.gross AS gross, l.line_discount + l.order_discount AS discount, l.net AS net, l.tax_name AS tax_name, l.rate_bp AS rate, l.tax AS tax, l.cost AS cost, s.currency AS currency FROM sale_lines l JOIN sales s ON s.id = l.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to} ORDER BY s.created, l.line_no',
      { number: '', day: '', line_no: 0, name: '', variant: '', sku: '', category: '', qty: 0, unit: 0, mods: '', gross: 0, discount: 0, net: 0, tax_name: '', rate: 0, tax: 0, cost: 0, currency: '' },
      bind,
    )) {
      let mods = '';
      try {
        mods = (JSON.parse(r.mods || '[]') || []).map((x) => x.name).join(', ');
      } catch {
        mods = '';
      }
      rowsOut.push([r.number, r.day, r.line_no, r.name, r.variant, r.sku, r.category, r.qty, m(r.unit, r.currency), mods, m(r.gross, r.currency), m(r.discount, r.currency), m(r.net, r.currency), r.tax_name, util.bpText(r.rate), m(r.tax, r.currency), r.cost > 0 ? m(r.cost, r.currency) : '', r.currency]);
    }
  } else {
    rowsOut.push(['Receipt', 'Business day', 'Method', 'Kind', 'Amount', 'Cash given', 'Change', 'Reference', 'Currency']);
    for (const r of util.rows(
      app,
      'SELECT s.number AS number, s.business_day AS day, py.name AS name, py.kind AS kind, py.amount AS amount, py.tendered AS tendered, py.change AS change, py.reference AS reference, s.currency AS currency FROM payments py JOIN sales s ON s.id = py.sale WHERE s.training = false AND s.business_day >= {:from} AND s.business_day <= {:to} ORDER BY s.created',
      { number: '', day: '', name: '', kind: '', amount: 0, tendered: 0, change: 0, reference: '', currency: '' },
      bind,
    )) {
      rowsOut.push([r.number, r.day, r.name, r.kind, m(r.amount, r.currency), r.kind === 'cash' ? m(r.tendered, r.currency) : '', r.change > 0 ? m(r.change, r.currency) : '', r.reference, r.currency]);
    }
  }
  const csv = rowsOut.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
  return { filename: what + '_' + from + (to !== from ? '_to_' + to : '') + '.csv', rows: rowsOut.length - 1, csv: csv };
}

module.exports = { summary: summary, exportCsv: exportCsv };
