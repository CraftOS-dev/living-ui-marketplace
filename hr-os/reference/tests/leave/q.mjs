// Ad-hoc: node tests/q.mjs <op> '{"param":"v"}' [as] [jsfilter]
import { api } from './lib.mjs';
const [name, params, as, filter] = process.argv.slice(2);
const r = await api.call(name, params ? JSON.parse(params) : {}, { as: as || 'owner' });
const body = r.body;
if (filter) console.log(eval('(b) => ' + filter)(body));
else console.log(r.status, JSON.stringify(body, null, 1).slice(0, 6000));
