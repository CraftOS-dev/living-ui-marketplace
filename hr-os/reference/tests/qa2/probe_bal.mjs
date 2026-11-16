import { newApi } from './lib.mjs';
const api = newApi();
for (const [num, type] of [['E0020', 'earned'], ['E0034', 'annual'], ['E0008', 'annual'], ['E0030', 'annual']]) {
  for (const p of [{ project_to: '2026-12-15' }, { day: '2026-12-15' }, {}]) {
    const r = await api.call('leave.balance', Object.assign({ employment: num, type }, p), { as: 'owner' });
    const b = r.body;
    console.log(num, type, JSON.stringify(p), r.status, 'available', b.available, 'balance', b.balance, 'day', b.day, 'projection', JSON.stringify(b.projection), 'encash', JSON.stringify(b.encash || b.reserved || b.cashed || ''));
  }
}
