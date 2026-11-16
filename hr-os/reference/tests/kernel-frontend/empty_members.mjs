// Empty database: invite a manager and an employee (no people, no data) so every role can be swept.
import { pathToFileURL } from 'node:url';
// HR_APP: the scratch app copy (default ../app next to this folder).
const app = process.env.HR_APP ?? new URL('../app', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const { client } = await import(pathToFileURL(app + '/tools/dev/api.mjs').href);
const api = client({ port: Number(process.env.PORT ?? 3182), app });
const OWNER = { as: { email: 'owner@northwind.test', password: 'owner-pass-1' } };
for (const [email, name, role] of [['lead@northwind.test', 'Lee Manager', 'manager'], ['staff@northwind.test', 'Sam Staff', 'employee']]) {
  const r = await api.call('members.invite', { email, name, role, pin: '246810' }, OWNER);
  if (r.status !== 200) { console.log('invite', email, r.status, JSON.stringify(r.body)); continue; }
  const a = await api.call('auth.accept-invite', { email, code: r.body.code, password: 'staff-pass-1' }, { as: 'anon' });
  console.log(email, a.status);
}
