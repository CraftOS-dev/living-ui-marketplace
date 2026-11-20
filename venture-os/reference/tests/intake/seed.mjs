// A demo Inbox for the screenshots and the UI flows: theses, the Gmail sweep, one deck read in full,
// one read in part, one waiting for your AI agent, one past its reply day, a pass with a drafted email
// (Waiting), a held deal, a scout's deal, and the Acme deck ready to advance.
import { copyFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { newApi, fresh, setupFirm, PEOPLE, APP, bridge, upload, deck, waitText } from './lib.mjs';

export async function seed({ empty = false } = {}) {
  fresh();
  await bridge.reset();
  await bridge.mode('search_gmail', 'offline');
  const api = newApi();
  const firm = await setupFirm(api);
  await api.op('settings.update', { modules: { intake: { sweep: false } } }, { as: 'owner' });
  await bridge.mode('search_gmail', 'ok');
  if (empty) return { api, firm };
  const P = PEOPLE.partner;
  await api.op('theses.save', { name: 'Seed robotics', criteria: [{ key: 'round_type', op: 'in', values: ['seed', 'pre_seed'], required: true }, { key: 'raise_minor', op: 'lte', value: 500000000, currency: 'USD' }, { key: 'technical_founder', op: 'bool', value: true }] }, { as: 'owner' });
  await api.op('theses.save', { name: 'US B2B', criteria: [{ key: 'hq_country', op: 'in', values: ['US'] }, { key: 'business_model', op: 'in', values: ['saas', 'marketplace'] }] }, { as: 'owner' });
  await api.op('intake.sweep', {}, { as: P });
  const all = (await api.op('intake.list', { segment: 'all' }, { as: P })).items;
  const acme = all.find((x) => x.name.includes('Acme'));
  const lumen = all.find((x) => x.name.includes('Lumen'));
  const orbit = all.find((x) => x.name.includes('Orbital'));

  // Fix 8: your AI agent works on the record a fire named (no queue to claim from).

  // Acme: read in full, Ready.
  const wa = await api.op('triage.start', { item: acme.id }, { as: 'agent' });
  const fa = wa.files[0].id;
  await waitText(api, fa, 'agent');
  await api.op('triage.facts-save', {
    item: acme.id,
    company: { name: 'Acme Robotics', domain: 'acmerobotics.ai' },
    one_liner: 'Mobile picking arms that work in existing warehouse aisles',
    founders: [{ name: 'Maya Chen', email: 'maya@acmerobotics.ai', title: 'CEO' }, { name: 'Tomas Varga', title: 'CTO' }],
    missing: ['competition'],
    questions: ['What does one site deployment cost up front?'],
    facts: [
      { key: 'round_type', value: 'seed', grade: 'founder_reported', file: fa, page: 1, quote: 'Seed round, November 2026' },
      { key: 'raise_minor', value: '3000000', currency: 'USD', grade: 'founder_reported', file: fa, page: 7, quote: 'Raising USD 3,000,000 on a post-money SAFE' },
      { key: 'post_money_minor', value: '15000000', currency: 'USD', grade: 'founder_reported', file: fa, page: 7, quote: 'Valuation cap: USD 15,000,000 post-money' },
      { key: 'arr_minor', value: '1200000', currency: 'USD', grade: 'founder_reported', file: fa, page: 4, quote: 'ARR: USD 1.2M (October 2026)' },
      { key: 'growth_mom_ppm', value: '15', grade: 'founder_reported', file: fa, page: 4, quote: 'Revenue growth: 15% month over month' },
      { key: 'gross_margin_ppm', value: '61', grade: 'founder_reported', file: fa, page: 4, quote: 'Gross margin: 61%' },
      { key: 'customers', value: 9, grade: 'founder_reported', file: fa, page: 4, quote: 'Customers: 14 sites, 9 paying logos' },
      { key: 'team_size', value: 23, grade: 'founder_reported', file: fa, page: 5, quote: 'Team size: 23 (16 engineering)' },
      { key: 'technical_founder', value: true, grade: 'artifact', file: fa, page: 5, quote: 'PhD Carnegie Mellon (grasp planning)' },
      { key: 'prior_exit', value: true, grade: 'public', url: 'https://www.zebra.com/' },
      { key: 'currency', value: 'USD', grade: 'founder_reported', file: fa, page: 7 },
      { key: 'hq_country', value: null, grade: 'unknown' },
      { key: 'business_model', value: 'saas', grade: 'founder_reported', file: fa, page: 3, quote: 'priced per pick (USD 0.09)' },
    ],
  }, { as: 'agent' });

  // Lumen: being read.
  const wl = await api.op('triage.start', { item: lumen.id }, { as: 'agent' });
  await waitText(api, wl.files[0].id, 'agent');
  await api.op('triage.facts-save', { item: lumen.id, company: { name: 'Lumen Health', domain: 'lumenhealth.io' }, one_liner: 'Text triage for urgent care clinics', facts: [{ key: 'round_type', value: 'pre_seed', grade: 'founder_reported', file: wl.files[0].id, page: 4 }, { key: 'raise_minor', value: '1500000', currency: 'USD', grade: 'founder_reported', file: wl.files[0].id, page: 4, quote: 'Raising USD 1,500,000 pre-seed' }, { key: 'currency', value: 'USD', grade: 'founder_reported', file: wl.files[0].id, page: 4 }] }, { as: 'agent' });

  // A website, an old email past its reply day, a scout's deck, a held deal.
  await api.op('intake.add', { url: 'https://www.boltlabs.dev/', name: 'Bolt Labs' }, { as: P });
  const late = await api.op('intake.add', { company: 'Harbor AI', text: 'Hello, we build port logistics copilots and would love your feedback on our seed round.', received_at: new Date(Date.now() - 12 * 86400000).toISOString(), source_person: { name: 'Ana Ruiz', email: 'ana@harborai.com' } }, { as: P });
  await api.op('triage.facts-save', { item: late.id, one_liner: 'Copilots for port logistics teams', facts: [{ key: 'round_type', value: 'seed', grade: 'founder_reported', quote: 'feedback on our seed round' }] }, { as: 'agent' });
  await upload(api, 'intake.add', {}, [{ name: 'Tidal Grid seed.pdf', bytes: deck('lumen_health_preseed.pdf') }], PEOPLE.scout);
  const held = await api.op('intake.add', { company: 'Quill Health', text: 'Met at a demo day; raising in Q1.' }, { as: P });
  await api.op('intake.hold', { item: held.id, days: 30 }, { as: P });

  // Waiting: a pass with your AI agent's draft.
  const pas = await api.op('intake.add', { company: 'Nimbus Fleet', source_person: { name: 'Lee Nimbus', email: 'lee@nimbusfleet.com' }, text: 'Fleet telematics for regional trucking, raising USD 2M.' }, { as: P });
  const pp = await api.op('intake.pass', { item: pas.id, reason: 'traction', criterion: 'Revenue under USD 10K', revisit_milestone: 'USD 50K MRR' }, { as: P });
  await api.op('passes.draft', { pass: pp.pass.id, subject: 'Re: Nimbus Fleet', body: 'Hi Lee,\n\nThank you for sending us Nimbus Fleet. We liked how quickly you signed the first regional carriers.\n\nWe are not yet convinced on traction at this stage: revenue is still under USD 10K.\n\nWhat would change our view: USD 50K MRR.\n\nBest,\nPat' }, { as: 'agent' });
  const pas2 = await api.op('intake.add', { company: 'Kite Robotics', source_person: { name: 'Jo Kite', email: 'jo@kiterobotics.com' } }, { as: P });
  await api.op('intake.pass', { item: pas2.id, reason: 'thesis_fit' }, { as: P });

  return { api, firm, acme, lumen, orbit };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/tests/seed.mjs')) {
  const r = await seed({ empty: process.argv.includes('--empty') });
  console.log('seeded', r.acme ? r.acme.number : '(empty)');
}
