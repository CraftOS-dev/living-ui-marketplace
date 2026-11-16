import { newApi, OWNER, ENG, SAM, HR } from './lib.mjs';
const api = newApi();
for (const [name, params, as] of [['perf.home', {}, OWNER], ['perf.home', {}, ENG], ['perf.home', {}, SAM], ['goals.list', { status: 'all' }, HR], ['trainings.compliance', {}, HR], ['participants.list', { cycle: process.argv[2] }, HR], ['calibration.view', { cycle: process.argv[2] }, HR], ['skills.matrix', { scope: 'all' }, HR], ['perf.profile', { employee: 'E0005' }, ENG], ['cycles.list', {}, HR], ['training-requirements.list', {}, HR]]) {
  const t0 = Date.now();
  const r = await api.call(name, params, as);
  console.log(name, JSON.stringify(as.as), r.status, (Date.now() - t0) + ' ms', r.headers.get('server-timing'));
}
