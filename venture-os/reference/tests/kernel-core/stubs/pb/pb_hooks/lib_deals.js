/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH ONLY stand-in for kernel-records' lib_deals.js: just ref (a deal
 * by id or display number), the one function the kernel calls. Never shipped.
 */
function ref(app, r0) {
  const u = require(`${__hooks}/lib_util.js`);
  const r = String(r0 || '').trim();
  if (r === '') throw u.fail(400, 'deal is required.', 'missing_param', { param: 'deal' });
  let d = u.byId(app, 'deals', r);
  if (d === null) d = u.findOne(app, 'deals', 'number = {:n}', { n: r.toUpperCase() });
  if (d === null || d.getString('deleted_at') !== '') throw u.fail(404, 'No deal ' + r + '. Run deals.list.', 'not_found', { ref: r });
  return d;
}

module.exports = { ref: ref };
