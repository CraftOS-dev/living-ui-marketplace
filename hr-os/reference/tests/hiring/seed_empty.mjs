// An empty company for the empty-database screenshot pass: setup only, and
// a recruiter, a manager and an employee member (no people, no hiring data).
//   node seed_empty.mjs   (after fresh(); HR_APP, HR_PORT as for the tests)
import { DEMO, fresh, member, newApi } from './lib.mjs';

fresh();
const api = newApi();
await api.op('setup.complete', { company_name: 'Empty Co', country: 'SG', owner_name: 'Owner One', email: DEMO.owner, password: DEMO.password, pin: DEMO.pin });
await member(api, 'rita@northwind.test', 'Rita Recruiter', 'recruiter');
await member(api, 'eng.lead@northwind.test', 'Max Manager', 'manager');
await member(api, 'sam@northwind.test', 'Sam Employee', 'employee');
console.log('empty company ready');
