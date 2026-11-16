import { newApi } from './lib.mjs';
const api = newApi();
const n = await api.op('notifications.list', { limit: 100 }, { as: 'owner' });
const kinds = {};
for (const x of n.notifications || []) kinds[x.kind + ' ' + x.title.slice(0, 50)] = (kinds[x.kind + ' ' + x.title.slice(0, 50)] || 0) + 1;
console.log(JSON.stringify(kinds, null, 1).slice(0, 1500));
const a = await api.op('leave.attention', {}, { as: 'owner' });
console.log('attention keys', Object.keys(a).join(','), JSON.stringify(a).length);
