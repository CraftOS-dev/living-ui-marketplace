import { api } from './lib.mjs';
for (const [op, p, as] of [['leave.home', {}, 'hr@northwind.test'], ['leave.home', {}, 'eng.lead@northwind.test'], ['leave.mine', {}, 'sam@northwind.test'], ['leave.calendar', {}, 'hr@northwind.test'], ['leave.calendar', {}, 'sam@northwind.test'], ['leave.balances', {}, 'hr@northwind.test'], ['leave.register', {}, 'hr@northwind.test'], ['leave.obligation', {}, 'hr@northwind.test'], ['leave.requests', {}, 'hr@northwind.test'], ['people.get', { employee: 'E0005' }, 'hr@northwind.test']]) {
  await api.call(op, p, { as });
  const t = Date.now();
  const r = await api.call(op, p, { as });
  console.log(op.padEnd(18), as.padEnd(26), r.status, (Date.now() - t) + ' ms', r.headers.get('server-timing'));
}
