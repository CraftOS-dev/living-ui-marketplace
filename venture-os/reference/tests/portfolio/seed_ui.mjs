// Seeds a realistic portfolio on the scratch app for screenshots (fresh database, through ops only).
// Six portfolio companies with 12 months of verified KPIs, a founder update staged by your AI agent,
// a runway alert, requests on, asks, a board meeting with a brief, a committee decision to invest.
import { newApi, fresh, setupFirm, dealFor, PEOPLE, bridge, stubFile } from './lib.mjs';

export async function seed(opts = {}) {
  await fresh();
  await bridge.mode('search_gmail', 'offline');
  const api = newApi();
  await setupFirm(api);
  if (opts.empty) return api;

  const months = [];
  for (let i = 12; i >= 1; i--) {
    const d = new Date(Date.UTC(2026, 10 - i, 1));
    const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
    months.push(last.toISOString().slice(0, 10));
  }
  const cos = [
    { domain: 'acmerobotics.ai', name: 'Acme Robotics', founder: ['maya@acmerobotics.ai', 'Maya Chen'], check: '500000', cap: '6700000', instr: 'safe_cap', arr: 420000, g: 0.09, burn: 140000, cash: 2600000, hc: 14 },
    { domain: 'northwind-analytics.com', name: 'Northwind Analytics', founder: ['ana@northwind-analytics.com', 'Ana Silva'], check: '1500000', post: '18000000', instr: 'priced', arr: 1400000, g: 0.05, burn: 180000, cash: 4200000, hc: 22, rev: true },
    { domain: 'lumenhealth.io', name: 'Lumen Health', founder: ['raj@lumenhealth.io', 'Raj Patel'], check: '750000', cap: '9000000', instr: 'safe_cap', arr: 260000, g: 0.03, burn: 210000, cash: 1300000, hc: 11 },
    { domain: 'orbitalfreight.com', name: 'Orbital Freight', founder: ['leo@orbitalfreight.com', 'Leo Okafor'], check: '2000000', post: '48000000', instr: 'priced', arr: 3100000, g: 0.04, burn: 320000, cash: 9800000, hc: 41 },
    { domain: 'helixbio.com', name: 'Helix Bio', founder: ['iris@helixbio.com', 'Iris Wong'], check: '600000', cap: '12000000', instr: 'safe_cap', arr: 0, g: 0, burn: 260000, cash: 5200000, hc: 9 },
    { domain: 'kitepay.eu', name: 'KitePay', founder: ['leo@kitepay.eu', 'Leo Brandt'], check: '400000', cap: '8000000', instr: 'safe_cap', arr: 1050000, g: 0.07, burn: 140000, cash: 1100000, hc: 17, eur: true },
  ];
  const rows = ['Company,Period end,Metric,Value,Currency'];
  for (const c of cos) {
    if (c.domain === 'kitepay.eu') {
      // The Gmail sweep files Northwind's emailed update and one from KitePay, not a portfolio company yet.
      await bridge.mode('search_gmail', 'ok');
      await api.op('updates.sweep', {}, { as: 'owner' });
      await bridge.mode('search_gmail', 'offline');
    }
    const terms = { round_type: c.instr === 'priced' ? 'series_a' : 'seed', check: c.check, instrument: c.instr };
    if (c.post) terms.post_money = c.post;
    const d = await dealFor(api, c.domain, c.name, [{ email: c.founder[0], name: c.founder[1] }], terms);
    const p = { deal: d.number, day: '2025-09-15', pro_rata: c.instr === 'priced' };
    if (c.cap) p.cap = c.cap;
    await api.op('holdings.create-from-deal', p, { as: 'owner' });
    if (c.eur) await api.op('holdings.update', { holding: c.domain, report_currency: 'EUR' }, { as: 'owner' });
    const ccy = c.eur ? 'EUR' : 'USD';
    months.forEach((m, i) => {
      if (m === months[months.length - 1] && (c.domain === 'acmerobotics.ai' || c.domain === 'kitepay.eu')) return;
      const growth = Math.pow(1 + c.g, i);
      if (c.arr > 0) rows.push(`${c.domain},${m},${c.rev ? 'revenue' : 'arr'},${Math.round(c.arr * growth / (c.rev ? 12 : 1))},${ccy}`);
      rows.push(`${c.domain},${m},net_burn,${Math.round(c.burn * (1 + 0.02 * i))},${ccy}`);
      rows.push(`${c.domain},${m},cash,${Math.max(100000, Math.round(c.cash + c.burn * (11 - i) * 1.02))},${ccy}`);
      rows.push(`${c.domain},${m},headcount,${c.hc - Math.floor((11 - i) / 3)},`);
    });
  }
  for (let i = 1; i < rows.length; i += 190) {
    const chunk = [rows[0]].concat(rows.slice(i, i + 190)).join('\n');
    await api.op('imports.run', { target: 'kpi_values', csv: chunk }, { as: 'owner' });
  }
  // Requests on for four companies (the mock bridge takes the emails).
  await api.op('requests.schedule', { companies: JSON.stringify(['acmerobotics.ai', 'northwind-analytics.com', 'lumenhealth.io', 'kitepay.eu']), cadence: 'monthly' }, { as: PEOPLE.partner });
  // Acme's October update, read by your AI agent and staged.
  const up = await api.op('updates.add', { company: 'acmerobotics.ai', subject: 'Acme Robotics: October update', text: 'Hi all,\n\nOctober was our best month yet. ARR closed at USD 1.24M, up from USD 1.13M in September. Net burn was USD 165,000 and we ended the month with USD 2.1M in cash. We are 16 people now.\n\nNext quarter we expect ARR of USD 1.5M (plan).\n\nAsks: intros to heads of operations at mid-size 3PLs, and a senior controls engineer.\n\nMaya' }, { as: PEOPLE.partner });
  await api.op('kpis.stage', { update: up.update.id, values: JSON.stringify([
    { key: 'arr', period_end: '2026-10-31', value: '1240000', quote: 'ARR closed at USD 1.24M' },
    { key: 'net_burn', period_end: '2026-10-31', value: '165000', quote: 'Net burn was USD 165,000' },
    { key: 'cash', period_end: '2026-10-31', value: '2100000', quote: 'USD 2.1M in cash' },
    { key: 'headcount', period_end: '2026-10-31', value: 16, quote: 'We are 16 people now' },
    { key: 'arr', period_end: '2027-01-31', value: '1500000', forecast: true, quote: 'expect ARR of USD 1.5M (plan)' },
  ]) }, { as: 'agent' });
  await api.call('asks.save', { company: 'acmerobotics.ai', update: up.update.id, kind: 'intro', title: 'Heads of operations at mid-size 3PLs', quote: 'intros to heads of operations at mid-size 3PLs' }, { as: 'agent' });
  // KitePay's October email with its numbers, staged.
  const kp = await api.op('updates.add', { company: 'kitepay.eu', subject: 'KitePay October 2026 update', text: 'Hi all,\n\nOctober 2026 numbers:\n- MRR: EUR 96,000 (September: EUR 88,500)\n- Net burn: EUR 140,000\n- Cash at 31 October: EUR 1,100,000\n- Customers: 412\n\nLeo' }, { as: PEOPLE.partner });
  await api.op('kpis.stage', { update: kp.update.id, values: JSON.stringify([
    { key: 'mrr', period_end: '2026-10-31', value: '96000', quote: 'MRR: EUR 96,000' },
    { key: 'net_burn', period_end: '2026-10-31', value: '140000', quote: 'Net burn: EUR 140,000' },
    { key: 'cash', period_end: '2026-10-31', value: '1100000', quote: 'Cash at 31 October: EUR 1,100,000' },
    { key: 'customers', period_end: '2026-10-31', value: 412, quote: 'Customers: 412', flags: ['period_unclear'] },
  ]) }, { as: 'agent' });
  // Asks the team works.
  await api.op('asks.save', { company: 'northwind-analytics.com', kind: 'hire', title: 'VP Sales for EMEA', owner: 'me' }, { as: PEOPLE.platform });
  const a2 = await api.op('asks.save', { company: 'northwind-analytics.com', kind: 'customer', title: 'Retail data leaders', owner: 'me' }, { as: PEOPLE.platform });
  await api.op('asks.update', { ask: a2.ask.id, status: 'in_progress' }, { as: PEOPLE.platform });
  const a3 = await api.op('asks.save', { company: 'northwind-analytics.com', kind: 'fundraising', title: 'Series B lead list' }, { as: 'owner' });
  await api.op('asks.update', { ask: a3.ask.id, status: 'done', outcome: 'Six funds introduced' }, { as: 'owner' });
  // A board meeting tomorrow with its brief, and a past one with a note.
  const tomorrow = new Date(Date.now() + 26 * 3600000).toISOString().slice(0, 10);
  const bm = await api.op('board.save', { company: 'northwind-analytics.com', day: tomorrow, time: '15:00', title: 'Q4 board' }, { as: 'owner' });
  await api.op('board.brief-save', { meeting: bm.meeting.id, brief: JSON.stringify({ sections: [
    { title: 'KPIs', points: ['Revenue USD 164K in October, up 5% on September', 'Runway 26 months on verified cash'] },
    { title: 'Since last board', points: ['Two enterprise pilots signed', 'Headcount 22'] },
    { title: 'Open asks', points: ['VP Sales for EMEA', 'Retail data leaders'] },
    { title: 'Questions', points: ['Pricing for the enterprise tier', 'Hiring plan against burn'] },
  ] }) }, { as: 'agent' });
  await api.op('board.save', { company: 'northwind-analytics.com', day: '2026-08-14', time: '15:00', title: 'Q3 board', note: 'Agreed the enterprise pilot plan. Next: pricing review.' }, { as: 'owner' });
  await api.op('alerts.run', {}, { as: 'owner' });
  // A deal the committee decided to invest in (Mark invested waits in Next).
  const d7 = await dealFor(api, 'gammaworks.com', 'Gamma Works', [{ email: 'gia@gammaworks.com', name: 'Gia Gamma' }], { round_type: 'seed', check: '400000', instrument: 'safe_cap', post_money: '8000000' });
  await api.op('deals.move', { deal: d7.number, stage: 'term_sheet' }, { as: 'owner' });
  stubFile('vo_test_decisions.json', { [d7.id]: 'invest' });
  return { api, deal: d7, update: up.update.id, kitepay: kp.update.id };
}

if (process.argv[1] && process.argv[1].replace(/\\/g, '/').endsWith('/seed_ui.mjs')) {
  const r = await seed();
  console.log('seeded', JSON.stringify({ deal: r.deal.number, update: r.update }));
}
