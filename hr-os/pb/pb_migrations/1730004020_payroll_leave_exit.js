/// <reference path="../pb_data/types.d.ts" />
/**
 * payroll-core (QA2 N-1): unused leave paid out on leaving gets its own
 * earning component LEAVE_EXIT (role exit_leave), tagged exit_leave_payout
 * and termination so packs can treat it apart from salary (AU Schedule 7 and
 * not ordinary time earnings, SG additional wages, IN leave encashment
 * exemption). Wage tags come only from a pack's own seed_components entry for
 * LEAVE_EXIT. Every existing entity gets the component (or its tags again);
 * new entities get it from lib_payroll.seedComponents on entity.created, and
 * every calculation re-syncs the tags with the packs then enabled
 * (lib_payroll.syncExitComponent), as packs seed on boot after migrations.
 */
const EXIT_TAGS = ['exit_leave_payout', 'termination'];

migrate(
  (app) => {
    const c = app.findCollectionByNameOrId('pay_components');
    const f = c.fields.getByName('role');
    if (f.values.indexOf('exit_leave') < 0) f.values = f.values.concat(['exit_leave']);
    app.save(c);

    const bodyOf = (code) => {
      const rows = app.findRecordsByFilter('rule_packs', "code = {:c} && status = 'active'", '-effective_from', 1, 0, { c: code });
      const any = rows.length > 0 ? rows : app.findRecordsByFilter('rule_packs', "code = {:c} && status != 'retired'", '-effective_from', 1, 0, { c: code });
      if (any.length === 0) return null;
      try {
        return JSON.parse(any[0].getString('body') || 'null');
      } catch (e) {
        return null;
      }
    };
    for (const ent of app.findRecordsByFilter('entities', '1=1', '', 0, 0)) {
      const have = app.findRecordsByFilter('pay_components', "entity = {:e} && code = 'LEAVE_EXIT'", '', 1, 0, { e: ent.id });
      let packs = [];
      try {
        packs = JSON.parse(ent.getString('packs') || '[]') || [];
      } catch (e) {
        packs = [];
      }
      const tags = EXIT_TAGS.slice();
      let name = 'Unused leave paid on leaving';
      let pack = '';
      for (const code of packs) {
        const b = bodyOf(code);
        for (const sc of (b && b.seed_components) || []) {
          if (!sc || sc.code !== 'LEAVE_EXIT') continue;
          for (const t of sc.tags || []) if (tags.indexOf(t) < 0) tags.push(t);
          if (sc.name) name = sc.name;
          pack = code;
        }
      }
      if (have.length > 0) {
        have[0].set('tags', tags);
        have[0].set('pack', pack);
        have[0].set('source', pack !== '' ? 'pack' : 'builtin');
        app.save(have[0]);
        continue;
      }
      const r = new Record(app.findCollectionByNameOrId('pay_components'));
      r.set('code', 'LEAVE_EXIT');
      r.set('name', name);
      r.set('entity', ent.id);
      r.set('country', ent.getString('country'));
      r.set('kind', 'earning');
      r.set('stage', '');
      r.set('calc', 'days');
      r.set('amount_minor', 0);
      r.set('percent', 0);
      r.set('base', '');
      r.set('formula', '');
      r.set('multiplier', 0);
      r.set('tags', tags);
      r.set('taxable', true);
      r.set('recurring', false);
      r.set('prorate', false);
      r.set('payslip_group', '');
      r.set('sort', 56);
      r.set('role', 'exit_leave');
      r.set('pack', pack);
      r.set('source', pack !== '' ? 'pack' : 'builtin');
      r.set('archived', false);
      app.save(r);
    }
  },
  (app) => {
    for (const r of app.findRecordsByFilter('pay_components', "code = 'LEAVE_EXIT'", '', 0, 0)) app.delete(r);
    const c = app.findCollectionByNameOrId('pay_components');
    const f = c.fields.getByName('role');
    f.values = f.values.filter((v) => v !== 'exit_leave');
    app.save(c);
  },
);
