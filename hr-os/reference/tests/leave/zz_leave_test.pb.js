/// <reference path="../pb_data/types.d.ts" />
// SCRATCH ONLY (leave builder's test copy, never shipped): call leave contract
// functions from tests. Needs the agent token.
routerAdd('POST', '/api/leave-test/{fn}', (e) => {
  const tok = String(e.request.header.get('X-A2App-Token') || '');
  const want = toString($os.readFile($filepath.join(__hooks, '..', '..', '.agent-token'))).trim();
  if (tok === '' || tok !== want) return e.json(403, { message: 'agent token' });
  const fn = e.request.pathValue('fn');
  const b = e.requestInfo().body || {};
  const lv = require(`${__hooks}/lib_leave.js`);
  try {
    let out = null;
    if (fn === 'payInputs') out = lv.payInputs(e.app, b.employment, b.from, b.to);
    else if (fn === 'balance') out = lv.balance(e.app, b.employment, b.type, b.day);
    else if (fn === 'cron') out = lv.cronDaily(e.app);
    else if (fn === 'runEntity') out = lv.runEntity(e.app, b.entity, b.force === true);
    else if (fn === 'markEncashPaid') out = lv.markEncashPaid(e.app, b.ids, b.payrun);
    else if (fn === 'ledgerSum') out = require(`${__hooks}/lib_util.js`).rows(e.app, 'SELECT COALESCE(SUM(amount), 0) AS n FROM leave_ledger WHERE employment = {:e} AND type = {:t} AND day <= {:d}', { n: -0 }, { e: b.employment, t: b.type, d: b.day })[0];
    else if (fn === 'profile') {
      const S = lv.session(e.app);
      const ids = require(`${__hooks}/lib_util.js`).rows(e.app, "SELECT id FROM employments", { id: '' }).map((r) => r.id);
      const t0 = Date.now();
      lv.preload(S, ids);
      const t1 = Date.now();
      let n = 0;
      const parts = { plan: 0, walk: 0 };
      for (const id of ids) {
        const emp = lv.employmentOf(S, id);
        for (const t of lv.typesFor(S, emp.getString('entity'), false)) {
          const a = Date.now();
          for (let rep = 0; rep < 5; rep++) lv.plan(S, emp, t, '2026-11-04');
          parts.plan += Date.now() - a;
          const r0 = lv.ruleFor(S, emp, t.getString('code'), '2026-11-04');
          const mk = (r0 ? r0.method : 'null') + ':' + emp.getString('entity').slice(0, 4);
          parts[mk] = (parts[mk] || 0) + (Date.now() - a);
          const b = Date.now();
          lv.simulate(S, emp, t, '2026-11-04', {});
          parts.walk += Date.now() - b;
          n++;
        }
      }
      const t2 = Date.now();
      const views = require(`${__hooks}/lib_leave_views.js`);
      const ctx = require(`${__hooks}/lib_auth.js`).systemCtx(e.app);
      ctx.isAgent = true;
      const t3 = Date.now();
      views.overview(ctx, {});
      const t4 = Date.now();
      out = { preload: t1 - t0, sims: n, loop: t2 - t1, parts: parts, overview: t4 - t3 };
    }
    else if (fn === 'facts') out = lv.profileFacts(require(`${__hooks}/lib_auth.js`).systemCtx(e.app), b.employment);
    else return e.json(404, { message: 'unknown fn' });
    return e.json(200, { out: out });
  } catch (err) {
    return e.json(500, { message: String(err && err.message ? err.message : err) });
  }
});
