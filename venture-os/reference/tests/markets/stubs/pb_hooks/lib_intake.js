/// <reference path="../pb_data/types.d.ts" />
/**
 * SCRATCH STUB (markets builder only, never shipped): lib_intake.add as SPEC
 * 4.6 names it. It records each call in the app store so tests can read
 * what markets passed, links the company when one is given, and answers an
 * intake-item-like object.
 */
function add(ctx, o) {
  const u = require(`${__hooks}/lib_util.js`);
  if (!o || o.channel !== 'sourced') throw u.fail(400, 'stub: channel must be sourced', 'invalid_param');
  const calls = JSON.parse(ctx.app.store().get('vo_stub_intake_calls') || '[]');
  const n = calls.length + 1;
  const item = { id: 'stubintake' + String(n).padStart(5, '0'), number: 'IN-' + String(n).padStart(4, '0'), channel: o.channel, company: o.company || '', url: o.url || '', text: o.text || '', thesis: o.thesis || '', status: 'reading' };
  calls.push(item);
  ctx.app.store().set('vo_stub_intake_calls', JSON.stringify(calls));
  return item;
}

function calls(ctx) {
  return { calls: JSON.parse(ctx.app.store().get('vo_stub_intake_calls') || '[]') };
}

module.exports = { add: add, calls: calls };
