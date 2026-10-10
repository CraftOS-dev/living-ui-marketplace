/// <reference path="../pb_data/types.d.ts" />
/**
 * App settings: the currency costs are kept in, whether stock may go below
 * zero, and whether the AI agent drafts reorders on its own.
 *
 * Costs are stored in ten-thousandths of a unit whatever the currency, so
 * switching currency relabels them without converting or rounding anything.
 */

function get(app) {
  const core = require(`${__hooks}/lib_core.js`);
  const s = core.settings(app);
  const cur = s.getString('currency');
  return {
    currency: cur,
    currency_decimals: core.exponent(cur),
    currency_confirmed: s.getBool('currency_confirmed'),
    allow_negative: s.getBool('allow_negative'),
    auto_restock: s.getBool('auto_restock'),
    restock_asked_on: s.getString('restock_asked_on'),
  };
}

function update(app, p) {
  const u = require(`${__hooks}/lib_util.js`);
  const core = require(`${__hooks}/lib_core.js`);
  const s = core.settings(app);
  if (u.has(p, 'currency')) {
    const cur = u.str(p, 'currency', '').toUpperCase();
    if (!core.isCurrency(cur)) throw u.fail(400, 'currency must be a 3-letter ISO code such as USD, EUR, JPY');
    s.set('currency', cur);
    s.set('currency_confirmed', true);
  }
  if (u.has(p, 'currency_confirmed')) s.set('currency_confirmed', u.bool(p, 'currency_confirmed', true));
  if (u.has(p, 'allow_negative')) s.set('allow_negative', u.bool(p, 'allow_negative', false));
  if (u.has(p, 'auto_restock')) {
    const on = u.bool(p, 'auto_restock', false);
    // Turning it on asks about everything low right now (nothing was asked yet).
    if (on && !s.getBool('auto_restock')) s.set('restock_sig', '');
    s.set('auto_restock', on);
  }
  app.save(s);
  return get(app);
}

module.exports = { get: get, update: update };
