// Seeds a realistic diligence picture through ops (your AI agent simulated with its token) for the screenshots:
// Acme (seed checklist, a deck, 10 proposed answers, some confirmed, a hand answer, references logged and suggested),
// Lumen (series A checklist, no files), Zeta (no checklist), and a grid with a public cell. Answers { ids }.
import { fresh, newApi, team, seedDeals, upload, waitText, pdf, DECK, sleep, PARTNER } from './lib.mjs';

export async function seedUi() {
  fresh();
  const api = newApi();
  await team(api);
  const S = await seedDeals(api);
  const P = { as: PARTNER };
  const A = { as: 'agent' };
  const acme = S.deals.acme;
  await api.op('dd.template-apply', { deal: acme.number }, P);
  await api.op('dd.template-apply', { deal: S.deals.lumen.number }, { as: 'piers@venture.test' });
  const up = await upload(api, { deal: acme.id, folder: 'Deck' }, [{ name: 'Acme Robotics seed deck.pdf', bytes: pdf(DECK, true) }], PARTNER);
  const deck = up.body.files ? up.body.files[0].id : up.body.file.id;
  await waitText(api, deck, PARTNER);
  await sleep(400);
  await api.op('dd.ask', { deal: acme.number }, P);
  const g = await api.op('dd.get', { deal: acme.number }, P);
  const qk = {};
  g.questions.forEach((q) => (qk[q.key] = q.id));
  const an = async (page, quote) => (await api.op('anchors.create', { file: deck, page, quote }, A)).anchor.id;
  const answers = [
    { question: qk.traction_arr, value: '1200000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [await an(2, 'ARR of 1,200,000 USD as of September 2026.')] },
    { question: qk.traction_customers, value: '42', num_kind: 'quoted', grade: 'artifact', anchors: [await an(2, 'Paying customers: 42')] },
    { question: qk.traction_growth, value: '15', unit: '%', num_kind: 'quoted', grade: 'founder_reported', anchors: [await an(2, 'Monthly growth 15 percent.')] },
    { question: qk.team_size, value: '14', num_kind: 'quoted', grade: 'artifact', anchors: [await an(3, 'Full-time team of 14 people.')] },
    { question: qk.team_technical, value: 'yes', grade: 'artifact', anchors: [await an(3, 'CTO Dan Chen built the robotics stack.')] },
    { question: qk.fin_raise, value: '3000000', unit: 'USD', num_kind: 'quoted', grade: 'artifact', anchors: [await an(4, 'Raising 3,000,000 USD on a SAFE.')] },
    { question: qk.fin_burn, value: '180000', unit: 'USD', num_kind: 'quoted', grade: 'founder_reported', anchors: [await an(4, 'Monthly net burn 180,000 USD.')] },
    { question: qk.market_tam, value: '5000000000', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://www.example.org/warehouse-robotics-market-2026'] },
    { question: qk.fin_runway, value: '16.7', unit: 'months', num_kind: 'computed', formula: '3,000,000 / 180,000', grade: 'founder_reported', anchors: [await an(4, 'Monthly net burn 180,000 USD.')] },
    { question: qk.product_live, value: 'yes', grade: 'founder_reported', anchors: [await an(1, 'Warehouse robots for mid-size retailers.')] },
    { question: qk.legal_incorporated, value: '2023-03-14', grade: 'unverifiable', anchors: [await an(1, 'Founded 2023 in Austin, Texas.')] },
    { question: qk.legal_litigation, not_found: true, note: 'The deck does not mention litigation.' },
  ];
  await api.op('dd.answer', { answers: JSON.stringify(answers) }, A);
  let v = await api.op('dd.get', { deal: acme.number }, P);
  const byKey = {};
  v.questions.forEach((q) => (byKey[q.key] = q));
  await api.op('dd.confirm', { answers: JSON.stringify([byKey.team_size.answer.id, byKey.fin_raise.answer.id, byKey.traction_customers.answer.id]) }, P);
  await api.op('dd.answer', { answers: JSON.stringify([{ question: qk.legal_jurisdiction, value: 'Delaware' }, { question: qk.team_fulltime, value: 'yes' }]) }, P);
  // References: suggested names, two logged calls.
  await api.op('refs.ask', { deal: acme.number }, P);
  await api.op('refs.suggest', { deal: acme.number, suggestions: JSON.stringify([{ person: S.people.bea.id, founder: S.people.ada.id, company: S.companies.kiva.id, why: 'Worked with Ada at Kiva Systems, 2017 to 2020' }, { person: 'dee@example.com', founder: S.people.dan.id, company: 'stripe.com', why: 'Overlapped with Dan at Stripe' }]) }, A);
  await api.op('refs.log', { deal: acme.number, name: 'Grace Kim', kind: 'customer', signal: 'positive', note: 'Pilot at 3 warehouses; renewing for 2027.', day: '2026-11-04' }, P);
  await api.op('refs.log', { deal: acme.number, person: 'cy@example.net', kind: 'provided', signal: 'neutral', note: 'Strong operator; hiring is slow.', day: '2026-11-08' }, P);
  // A grid: Acme and Lumen rooms, Zeta from public sources.
  const grid = (await api.op('compare.save', { deals: JSON.stringify([acme.number, S.deals.lumen.number]), companies: JSON.stringify(['zetafreight.com']), columns: JSON.stringify(['traction_arr', 'traction_customers', 'traction_growth', 'fin_burn', 'fin_raise', 'team_size']) }, P)).grid;
  {
    await api.op('dd.answer', { answers: JSON.stringify([{ grid: grid.id, company: S.companies.zeta.id, column: 'traction_arr', value: '800000', unit: 'USD', num_kind: 'external', grade: 'public', sources: ['https://news.example.com/zeta-freight-series-a'] }, { grid: grid.id, company: S.companies.zeta.id, column: 'team_size', value: '22', num_kind: 'external', grade: 'public', sources: ['https://zetafreight.com/about'] }]) }, A);
  }
  // A file on Lumen for the room strip.
  await upload(api, { deal: S.deals.lumen.id }, [{ name: 'Lumen memo.pdf', bytes: pdf([['Lumen Health', 'ARR of 9,000,000 USD.']]) }], 'piers@venture.test');
  const zeta = (await api.op('deals.create', { company: S.companies.zeta.id, point: PARTNER }, P)).deal;
  return { acme, lumen: S.deals.lumen, zeta, grid };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/ui_seed.mjs')) {
  const r = await seedUi();
  console.log(JSON.stringify({ acme: r.acme.number, acme_id: r.acme.id, lumen: r.lumen.number, zeta: r.zeta.number, grid: r.grid.id }));
}
