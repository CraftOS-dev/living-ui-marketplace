// Seeded: kiosk codes (they open the office time clock) show only to time
// editors, administrators and your AI agent, and never in the audit trail.
import { eq, fresh, newApi, ok, section, summary } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };

section('kiosk codes');
const loc = (await api.op('locations.list', { entity: 'Northwind Pte Ltd' }, O)).locations[0];
const made = await api.op('locations.kiosk-code', { location: loc.id }, { as: 'hr@northwind.test' });
const code = made.location.kiosk_code;
ok(/^[A-Z0-9]{8}$/.test(code) && made.location.has_kiosk_code === true, 'HR (time full) makes a kiosk code and sees it', made.location);
for (const [who, sees] of [
  ['owner', true],
  ['hr@northwind.test', true],
  ['agent', true],
  ['payroll@northwind.test', false],
  ['eng.lead@northwind.test', false],
  ['sam@northwind.test', false],
]) {
  const list = (await api.op('locations.list', {}, { as: who })).locations.find((l) => l.id === loc.id);
  const ent = (await api.op('entities.get', { entity: 'Northwind Pte Ltd' }, { as: who })).entity.locations.find((l) => l.id === loc.id);
  const shown = list.kiosk_code === code && ent.kiosk_code === code;
  const hidden = list.kiosk_code === undefined && ent.kiosk_code === undefined && list.has_kiosk_code === true;
  ok(sees ? shown : hidden, who + (sees ? ' sees' : ' does not see') + ' the kiosk code (locations.list, entities.get)', { list, ent });
}
const upd = await api.op('locations.update', { location: loc.id, radius_m: 200 }, { as: 'hr@northwind.test' });
eq(upd.location.kiosk_code, code, 'an update answers the code to a time editor');
const audit = JSON.stringify(await api.op('audit.list', { collection: 'locations', limit: 200 }, O));
ok(audit.indexOf(code) < 0, 'the kiosk code is not in the audit trail');
const status = await api.call('app.status', {}, { as: 'payroll@northwind.test' });
ok(JSON.stringify(status.body).indexOf(code) < 0, 'nor in app.status');

const s = summary('t07_kiosk');
process.exitCode = s.failed > 0 ? 1 : 0;
