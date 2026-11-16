import { newApi } from './lib.mjs';
const api = newApi();
for (let i = 0; i < 4; i++) console.log(JSON.stringify(await api.op('zstub.board-profile', {}, { as: 'hr@scale.test' })));
