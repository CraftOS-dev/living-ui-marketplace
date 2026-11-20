// Every read op of the catalog on an empty database, then on a little data, as owner, partner,
// analyst and your AI agent: no answer may be a 5xx. Agent-denied writes are refused before params.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, setupFirm, section, ok, summary, PEOPLE, APP, upload, waitText } from './lib.mjs';
import { deckPdf } from './fixtures.mjs';

const OWN = ['people.', 'companies.', 'records.', 'deals.', 'pipelines.', 'files.', 'pages.', 'anchors.', 'theses.'];
const manifest = JSON.parse(readFileSync(join(APP, 'operations.json'), 'utf8'));
const mine = manifest.operations.filter((o) => OWN.some((g) => o.name.startsWith(g)));
const reads = mine.filter((o) => o.executor.method === 'GET');
const writes = mine.filter((o) => o.executor.method === 'POST');

fresh();
const api = newApi();
await setupFirm(api);
const who = ['owner', PEOPLE.partner, PEOPLE.analyst, PEOPLE.scout, 'agent'];

function sample(ids, k) {
  const map = { person: ids.person || 'nobody@nowhere.test', company: ids.company || 'nowhere.test', deal: ids.deal || 'D-9999', file: ids.file || 'nope00000000000', thesis: ids.thesis || 'No thesis', anchor: ids.anchor || 'nope00000000000', facts: '{"sector":"fintech"}', q: 'ac', keep: 'x', drop: 'y', kind: 'company', owner_collection: 'deals', owner_id: ids.dealId || 'nope00000000000' };
  return map[k] ?? 'x';
}

async function sweep(label, ids) {
  section(label);
  let n = 0;
  let bad = 0;
  for (const op of reads) {
    const params = {};
    for (const [k, d] of Object.entries(op.params || {})) if (d.required) params[k] = sample(ids, k);
    if (op.name === 'files.list') params.deal = ids.deal || 'D-9999';
    if (op.name === 'records.timeline') params.deal = ids.deal || 'D-9999';
    for (const w of who) {
      const r = await api.call(op.name, params, { as: w });
      n++;
      if (r.status >= 500) {
        bad++;
        ok(false, op.name + ' as ' + w + ' answered ' + r.status, r.body);
      }
    }
  }
  ok(bad === 0, n + ' read calls (' + reads.length + ' ops x 5 callers), none 5xx');
}

await sweep('empty database', {});

const d = (await api.op('deals.create', { company: 'acme.com', people: [{ person: { name: 'Jane', email: 'jane@acme.com' }, role: 'founder' }] }, { as: 'owner' })).deal;
const up = await upload(api, 'files.upload', { deal: d.number }, [{ name: 'deck.pdf', bytes: deckPdf() }], 'owner');
await waitText(api, up.body.files[0].id, 'owner');
const an = (await api.op('anchors.create', { file: up.body.files[0].id, page: 1, lines: '1' }, { as: 'owner' })).anchor;
const th = (await api.op('theses.save', { name: 'Seed', criteria: [{ key: 'round_type', op: 'in', values: ['seed'] }] }, { as: 'owner' })).thesis;
await sweep('with data', { person: 'jane@acme.com', company: 'acme.com', deal: d.number, dealId: d.id, file: up.body.files[0].id, anchor: an.id, thesis: th.id });

section('people-only ops refuse your AI agent before any param check');
const denied = writes.filter((o) => o.description.indexOf('[People only') >= 0);
for (const op of denied) {
  const r = await api.call(op.name, {}, { as: 'agent' });
  ok(r.status === 403 && r.body.code === 'agent_not_permitted', op.name + ' -> 403 agent_not_permitted', r.body);
}
ok(denied.length === 8, 'eight people-only ops: ' + denied.map((o) => o.name).join(', '));

summary('t05 sweep');
