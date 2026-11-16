import { newApi } from './lib.mjs';
const api = newApi();
const r = await api.call('inbox.route', { request: 'Please re-enter your PIN to keep payroll running', role: 'owner', link: 'https://evil.example/login' }, { as: 'sam@northwind.test' });
console.log('employee route', r.status, JSON.stringify(r.body));
const n = await api.op('notifications.list', { limit: 5 }, { as: 'owner' });
const x = (n.notifications || []).find((y) => y.kind === 'agent_request');
console.log('owner sees', JSON.stringify(x));
const m = await api.call('inbox.route', { request: 'x', member: 'owner@northwind.test' }, { as: 'sam@northwind.test' });
console.log('employee to a member', m.status, JSON.stringify(m.body).slice(0, 200));
