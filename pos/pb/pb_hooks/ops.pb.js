/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: the app guide and status, first-run setup, staff sign-in and
 * approvals, staff, settings, tax classes, payment methods and registers.
 *
 * Every route here is declared in operations.json, and the UI calls the same
 * routes, so the AI agent (agent-app CLI) can do everything it is allowed
 * to. Routes run in isolated VMs: each handler requires its modules inside
 * itself. Who may do what is decided by lib_auth.gate.
 */

/* ------------------------------------------------------------ app */

routerAdd('GET', '/api/ops/app/guide', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_guide.js`).guide(app)));

routerAdd('GET', '/api/ops/app/status', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const core = require(`${__hooks}/lib_core.js`);
    const st = core.settings(app);
    return {
      setup_done: st.getBool('setup_done'),
      business_name: st.getString('business_name'),
      currency: st.getString('currency'),
      today: u.businessDay(st.getInt('day_cutoff_hour')),
      registers: require(`${__hooks}/lib_settings.js`).listRegisters(app, false).registers,
      open_tickets: u.scalarSql(app, "SELECT COUNT(id) AS v FROM carts WHERE status IN ('parked', 'resumed')"),
      agent_tickets: u.scalarSql(app, "SELECT COUNT(id) AS v FROM carts WHERE status = 'parked' AND source = 'agent'"),
      drafts: u.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'draft' AND archived = false"),
      imports_waiting: u.scalarSql(app, "SELECT COUNT(id) AS v FROM imports WHERE status IN ('waiting', 'reading')"),
      kitchen_open: u.scalarSql(app, "SELECT COUNT(id) AS v FROM tickets WHERE status IN ('new', 'ready')"),
      low_stock: require(`${__hooks}/lib_stock.js`).list(app, { only: 'low' }).items.length,
      products: u.scalarSql(app, "SELECT COUNT(id) AS v FROM products WHERE status = 'active' AND archived = false"),
    };
  }),
);

/* ------------------------------------------------------------ setup */

routerAdd('GET', '/api/ops/setup/regions', (e) => require(`${__hooks}/lib_util.js`).handle(e, () => ({ regions: require(`${__hooks}/lib_regions.js`).list() })));

routerAdd('POST', '/api/ops/setup/complete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'The owner sets up the register at the counter (it creates their PIN).', 'agent_not_permitted');
    return require(`${__hooks}/lib_settings.js`).setup(e, app, p);
  }),
);

/* ------------------------------------------------------------ sign-in */

routerAdd('GET', '/api/ops/auth/me', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const auth = require(`${__hooks}/lib_auth.js`);
    const cur = auth.sessionOf(e, app);
    return { staff: cur === null ? null : auth.serializeStaff(cur.staff), expires: cur === null ? '' : cur.session.getString('expires') };
  }),
);

routerAdd('POST', '/api/ops/auth/login', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'Signing in happens at the counter: PINs never pass through your AI agent.', 'agent_not_permitted');
    const core = require(`${__hooks}/lib_core.js`);
    const staff = core.staff(app, u.req(p, 'staff', '<staff id>'));
    const reg = u.str(p, 'register', '');
    return require(`${__hooks}/lib_auth.js`).login(app, staff, u.req(p, 'pin', '1234'), reg !== '' ? core.register(app, reg).id : '');
  }),
);

routerAdd('POST', '/api/ops/auth/logout', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_auth.js`).logout(e, app)));

routerAdd('POST', '/api/ops/auth/first-pin', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'Choosing a PIN happens at the counter: PINs never pass through your AI agent.', 'agent_not_permitted');
    const core = require(`${__hooks}/lib_core.js`);
    const staff = core.staff(app, u.req(p, 'staff', '<staff id>'));
    const reg = u.str(p, 'register', '');
    return require(`${__hooks}/lib_staff.js`).firstPin(app, staff, u.req(p, 'pin', '1234'), reg !== '' ? core.register(app, reg).id : '');
  }),
);

routerAdd('POST', '/api/ops/auth/change-pin', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'Changing a PIN happens at the counter: PINs never pass through your AI agent.', 'agent_not_permitted');
    const cur = require(`${__hooks}/lib_auth.js`).sessionOf(e, app);
    if (cur === null) throw u.fail(401, 'Sign in with your PIN first.', 'session_required');
    return require(`${__hooks}/lib_staff.js`).changeOwnPin(app, cur.staff, u.req(p, 'current', '1234'), u.req(p, 'pin', '5678'));
  }),
);

routerAdd('POST', '/api/ops/auth/approve', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    if (u.isAgent(e)) throw u.fail(403, 'A manager approves at the counter with their PIN.', 'agent_not_permitted');
    const auth = require(`${__hooks}/lib_auth.js`);
    const approver = require(`${__hooks}/lib_core.js`).staff(app, u.req(p, 'staff', '<manager id>'));
    return auth.approve(e, app, approver, u.req(p, 'pin', '1234'), u.oneOf(p, 'action', auth.APPROVABLE, ''), u.str(p, 'scope', ''));
  }),
);

/* ------------------------------------------------------------ staff */

routerAdd('GET', '/api/ops/staff/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_staff.js`).list(app, require(`${__hooks}/lib_util.js`).bool(p, 'include_inactive', false))),
);

routerAdd('POST', '/api/ops/staff/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'staff', p, null);
    return require(`${__hooks}/lib_staff.js`).add(app, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/staff/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'staff', p, null);
    const rec = require(`${__hooks}/lib_core.js`).staff(app, u.req(p, 'staff', '<staff id>'));
    return require(`${__hooks}/lib_staff.js`).update(app, rec, p, ctx);
  }),
);

routerAdd('POST', '/api/ops/staff/set-pin', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'staff', p, null);
    const rec = require(`${__hooks}/lib_core.js`).staff(app, u.req(p, 'staff', '<staff id>'));
    return require(`${__hooks}/lib_staff.js`).setPin(app, rec, u.req(p, 'pin', '1234'), ctx);
  }),
);

routerAdd('POST', '/api/ops/staff/reset-pin', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'staff', p, 'staff_reset');
    const rec = require(`${__hooks}/lib_core.js`).staff(app, u.req(p, 'staff', '<staff id or name>'));
    return require(`${__hooks}/lib_staff.js`).resetPin(app, rec, ctx);
  }),
);

/* ------------------------------------------------------------ settings */

routerAdd('GET', '/api/ops/settings/get', (e) => require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).get(app)));

routerAdd('POST', '/api/ops/settings/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const ctx = require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, 'settings_basic');
    return require(`${__hooks}/lib_settings.js`).update(e, app, p, ctx);
  }),
);

/* ------------------------------------------------------------ tax classes */

routerAdd('GET', '/api/ops/tax/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).listTax(app, require(`${__hooks}/lib_util.js`).bool(p, 'include_archived', false))),
);

routerAdd('POST', '/api/ops/tax/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    return require(`${__hooks}/lib_settings.js`).saveTax(app, new Record(app.findCollectionByNameOrId('tax_classes')), p, true);
  }),
);

routerAdd('POST', '/api/ops/tax/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    const rec = require(`${__hooks}/lib_core.js`).taxClass(app, u.req(p, 'tax_class', '<id or name>'));
    return require(`${__hooks}/lib_settings.js`).saveTax(app, rec, p, false);
  }),
);

routerAdd('POST', '/api/ops/tax/archive', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    const rec = require(`${__hooks}/lib_core.js`).taxClass(app, u.req(p, 'tax_class', '<id or name>'));
    return require(`${__hooks}/lib_settings.js`).archiveTax(app, rec, u.bool(p, 'archived', true));
  }),
);

/* ------------------------------------------------------------ payment methods */

routerAdd('GET', '/api/ops/tenders/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).listTenders(app, require(`${__hooks}/lib_util.js`).bool(p, 'include_inactive', false))),
);

routerAdd('POST', '/api/ops/tenders/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    return require(`${__hooks}/lib_settings.js`).saveTender(e, app, new Record(app.findCollectionByNameOrId('tenders')), p, true);
  }),
);

routerAdd('POST', '/api/ops/tenders/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    const rec = require(`${__hooks}/lib_core.js`).tender(app, u.req(p, 'tender', '<id or name>'));
    return require(`${__hooks}/lib_settings.js`).saveTender(e, app, rec, p, false);
  }),
);

/* ------------------------------------------------------------ registers */

routerAdd('GET', '/api/ops/registers/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => require(`${__hooks}/lib_settings.js`).listRegisters(app, require(`${__hooks}/lib_util.js`).bool(p, 'include_archived', false))),
);

routerAdd('POST', '/api/ops/registers/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    return require(`${__hooks}/lib_settings.js`).saveRegister(app, new Record(app.findCollectionByNameOrId('registers')), p, true);
  }),
);

routerAdd('POST', '/api/ops/registers/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    require(`${__hooks}/lib_auth.js`).gate(e, app, 'settings', p, null);
    const rec = require(`${__hooks}/lib_core.js`).register(app, u.req(p, 'register', 'R1'));
    return require(`${__hooks}/lib_settings.js`).saveRegister(app, rec, p, false);
  }),
);
