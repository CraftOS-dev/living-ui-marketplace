// Seed a realistic deals dataset through ops (for screenshots): node seed_demo.mjs [--empty]
// Fresh database, the demo firm, three partners, 24 deals across stages (some stalled), a reviewed
// First call note with its proposals waiting, a draft note from a meeting, an SPV pipeline.
import { newApi, fresh, setupFirm, member, DEMO } from './lib.mjs';

fresh();
const api = newApi();
await setupFirm(api);
if (process.argv.includes('--empty')) {
  console.log('empty firm ready: ' + DEMO.owner + ' / ' + DEMO.password);
  process.exit(0);
}
const pat = await member(api, 'pat@venture.test', 'partner', 'Pat Lin');
const maya = await member(api, 'maya@venture.test', 'partner', 'Maya Ortiz');
await member(api, 'ana@venture.test', 'analyst', 'Ana Kim');

const deals = [
  ['acme-robotics.com', 'Acme Robotics', 'first_meeting', pat, 'seed', '3000000', 9],
  ['lumen.health', 'Lumen Health', 'screen', maya, 'pre_seed', '1500000', 2],
  ['northwind.ai', 'Northwind AI', 'diligence', 'owner', 'series_a', '12000000', 25],
  ['kite-pay.com', 'Kite Pay', 'sourced', pat, 'seed', '4000000', 1],
  ['orbital-labs.io', 'Orbital Labs', 'partner_meeting', maya, 'series_a', '15000000', 5],
  ['ferro.dev', 'Ferro', 'ic', 'owner', 'seed', '5000000', 3],
  ['harbor-freight.io', 'Harbor Freight Tech', 'term_sheet', pat, 'series_a', '10000000', 6],
  ['quill.so', 'Quill', 'screen', pat, 'pre_seed', '1000000', 11],
  ['tessera.bio', 'Tessera Bio', 'sourced', maya, 'seed', '6000000', 4],
  ['brightline.app', 'Brightline', 'first_meeting', 'owner', 'seed', '2500000', 3],
  ['cobalt-grid.com', 'Cobalt Grid', 'diligence', maya, 'series_a', '20000000', 8],
  ['mosaic-data.io', 'Mosaic Data', 'sourced', pat, 'pre_seed', '800000', 0],
  ['vela.space', 'Vela Space', 'screen', 'owner', 'seed', '3500000', 1],
  ['pinecone-ag.com', 'Pinecone Ag', 'sourced', maya, 'seed', '2000000', 12],
  ['atlas-legal.ai', 'Atlas Legal', 'first_meeting', maya, 'seed', '3000000', 2],
  ['sora-energy.com', 'Sora Energy', 'sourced', 'owner', 'series_a', '18000000', 2],
  ['nimbus-hr.com', 'Nimbus HR', 'screen', pat, 'seed', '2200000', 4],
  ['fathom-sec.io', 'Fathom Security', 'partner_meeting', pat, 'series_a', '14000000', 16],
];
const made = {};
for (const [domain, name, stage, point, round, raise, days] of deals) {
  const d = (await api.op('deals.create', { company: domain, name, round_type: round, raise, point: point === 'owner' ? DEMO.owner : point, source: 'inbound' }, { as: 'owner' })).deal;
  const order = ['sourced', 'screen', 'first_meeting', 'diligence', 'partner_meeting', 'ic', 'term_sheet'];
  for (const s of order.slice(1, order.indexOf(stage) + 1)) await api.op('deals.move', { deal: d.id, stage: s }, { as: 'owner' });
  if (days > 0) await api.op('zz.backdate', { deal: d.id, days: String(days) }, { as: 'owner' });
  made[domain] = d;
}
// Closed ones this quarter.
for (const [domain, name, status, reason] of [
  ['glasshouse.io', 'Glasshouse', 'passed', 'Market'],
  ['tidal.fm', 'Tidal FM', 'passed', 'Traction'],
  ['meridian-bank.com', 'Meridian', 'lost', 'Went with another lead'],
  ['ember.games', 'Ember Games', 'hold', 'Revisit after their seed'],
]) {
  const d = (await api.op('deals.create', { company: domain, name }, { as: 'owner' })).deal;
  await api.op('deals.move', { deal: d.id, stage: 'screen' }, { as: 'owner' });
  await api.op('deals.status', { deal: d.id, status, reason }, { as: 'owner' });
}
// Acme: check, team, founders, a restricted one.
const acme = made['acme-robotics.com'];
await api.op('deals.update', { deal: acme.id, check: '500000', instrument: 'safe_cap', tags: '["demo"]' }, { as: pat });
await api.op('deals.team', { deal: acme.id, add: JSON.stringify([maya]) }, { as: pat });
await api.op('deals.people', { deal: acme.id, add: JSON.stringify([{ person: { name: 'Jane Rivera', email: 'jane@acme-robotics.com' }, role: 'founder' }, { person: { name: 'Omar Haddad', email: 'omar@acme-robotics.com' }, role: 'founder' }]) }, { as: pat });
await api.op('deals.restrict', { deal: made['ferro.dev'].id, restricted: true, agent_allowed: true }, { as: 'owner' });

// A reviewed First call note on Acme with its proposals waiting.
const note = (
  await api.op(
    'notes.create',
    {
      deal: acme.id,
      template: 'first_call',
      meeting_day: '2026-11-10',
      consent: 'informed',
      sections: {
        team: 'Jane (CEO, ex Boston Dynamics, 8 years on legged robots) and Omar (CTO, built the perception stack at Kiva). 14 people, 9 engineers.',
        product: 'Autonomous picking arm for mid-size warehouses; retrofits existing shelving. Live at 6 sites.',
        market: 'Mid-size 3PLs in the US, about 11,000 sites. Labour shortage is the pull.',
        traction: 'USD 1.2M ARR, 18% month on month for the last 6 months, 42 customers, net retention 135%.',
        round: 'Raising USD 3M seed on a post-money SAFE at a USD 15M cap. Lead not set yet. We would put in USD 500k.',
        next_steps: 'Pat sends the data room request by 2026-11-14. Maya to call two customers. Catch up with the founders soon.',
      },
      save: true,
    },
    { as: pat },
  )
).note;
await api.op('notes.review', { note: note.id }, { as: pat });
const quote = 'USD 1.2M ARR, 18% month on month for the last 6 months, 42 customers, net retention 135%.';
const p1 = await api.op('deals.update', { deal: acme.id, pre_money: '12000000', evidence: 'Raising USD 3M seed on a post-money SAFE at a USD 15M cap.', confidence: 0.95, why: 'Stated in the note' }, { as: 'agent' });
const p2 = await api.op('deals.update', { deal: acme.id, post_money: '15000000', evidence: 'Raising USD 3M seed on a post-money SAFE at a USD 15M cap.', confidence: 0.9 }, { as: 'agent' });
const p3 = await api.op('deals.update', { deal: acme.id, source: 'referral', evidence: 'Intro from Kiva alumni group.', confidence: 0.6 }, { as: 'agent' });
const t1 = (await api.op('tasks.save', { title: 'Send the data room request', ref_collection: 'deals', ref_id: acme.id, assignee: pat, due_day: '2026-11-14' }, { as: 'agent' })).task;
const t2 = (await api.op('tasks.save', { title: 'Call two Acme customers', ref_collection: 'deals', ref_id: acme.id, assignee: maya }, { as: 'agent' })).task;
await api.op(
  'notes.summary-save',
  {
    note: note.id,
    headline: 'Robotics picking for mid-size 3PLs; USD 1.2M ARR growing 18% a month; USD 3M seed.',
    sections: {
      team: 'Two technical founders from Boston Dynamics and Kiva; 14 people.',
      product: 'Retrofit picking arm, live at 6 sites.',
      market: 'About 11,000 mid-size 3PL sites in the US.',
      traction: quote,
      round: 'USD 3M seed, post-money SAFE, USD 15M cap; USD 500k discussed.',
      next_steps: 'Data room request by 14 Nov; two customer calls.',
    },
    proposals: JSON.stringify([p1.proposal, p2.proposal, p3.proposal]),
    tasks: JSON.stringify([t1.id, t2.id]),
  },
  { as: 'agent' },
);
// A draft note waiting from a meeting that ended; a free note.
await api.op('zz.emit', { event: 'meeting.ended', payload: JSON.stringify({ cal_event: 'calevdemo000001', deal: made['northwind.ai'].id }) }, { as: 'owner' });
await api.op('notes.create', { deal: acme.id, template: 'reference', meeting_day: '2026-11-11', sections: { who: 'Former manager of Jane at Boston Dynamics.', strengths: 'Ships hardware on time.' }, save: true }, { as: maya });
// An SPV pipeline with two deals.
await api.op('deals.create', { company: 'harbor-freight.io', pipeline: 'spv', name: 'Harbor SPV' }, { as: 'owner' });
await api.op('deals.create', { company: 'orbital-labs.io', pipeline: 'spv', name: 'Orbital co-invest' }, { as: 'owner' });
console.log('seeded: ' + Object.keys(made).length + ' open deals, note ' + note.id + ', acme ' + acme.number);
