/** SCRATCH ONLY (expenses tests). Never copied to APP. */
function E() { return require(`${__hooks}/lib_expenses.js`); }
function U() { return require(`${__hooks}/lib_util.js`); }
function emp(app, ref) { return require(`${__hooks}/lib_people.js`).employmentRef(app, ref).id; }
module.exports = {
  payrun: (ctx, p) => {
    const r = new Record(ctx.app.findCollectionByNameOrId('payruns'));
    r.set('entity', require(`${__hooks}/lib_org.js`).entityRef(ctx.app, p.entity).id); r.set('kind', 'regular'); r.set('number', p.number);
    r.set('period_start', p.pay_date.slice(0, 8) + '01'); r.set('period_end', p.pay_date); r.set('pay_date', p.pay_date); r.set('status', 'locked'); ctx.app.save(r);
    return { payrun: r.id };
  },
  payInputs: (ctx, p) => ({ items: E().payInputs(ctx.app, emp(ctx.app, p.employment), p.up_to, p.currency || '', p.via ? { via: p.via } : undefined) }),
  markPaid: (ctx, p) => {
    let out = null;
    ctx.app.runInTransaction((tx) => { out = E().markPaid(tx, JSON.parse(p.ids), p.payrun); });
    return { result: out };
  },
  unmarkPaid: (ctx, p) => ({ result: E().unmarkPaid(ctx.app, p.payrun) }),
  recovery: (ctx, p) => ({ items: E().advanceRecovery(ctx.app, emp(ctx.app, p.employment), p.up_to) }),
  outstanding: (ctx, p) => ({ result: E().outstanding(ctx.app, emp(ctx.app, p.employment)) }),
  cron: (ctx, p) => ({ result: E().cronReminders(ctx.app) }),
  facts: (ctx, p) => ({ facts: require(`${__hooks}/lib_events.js`).profileFacts(ctx, emp(ctx.app, p.employment)) }),
};
