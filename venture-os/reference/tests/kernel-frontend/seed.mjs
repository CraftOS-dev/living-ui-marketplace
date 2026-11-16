// Seeds the stand-in with sample data for the shell, Focus mode, the agent panel and Settings
// (after setup.mjs). Idempotent for Next items (keyed); other rows are added again on each run.
import { OWNER, op, ownerToken } from './lib.mjs';

const tok = await ownerToken();
const as = { as: tok };
const now = Date.now();
const ago = (min) => new Date(now - min * 60000).toISOString();

const PASS = ['Team', 'Market', 'Product', 'Traction', 'Valuation', 'Fit with thesis', 'Timing', 'Other'].map((x) => ({ value: x.toLowerCase().replace(/ /g, '_'), label: x }));
const steps = (at) => ({ labels: ['Received', 'Reading', 'Facts', 'Ready'], at });
const act = (label, opName, key, extra = {}) => ({ label, op: opName, params: { key }, ...extra });

const DRAFT = 'Hi Dana,\n\nThank you for walking us through Fleetwise. We liked the depth of your routing engine and how quickly the pilots converted.\n\nWe are not yet convinced the fleet software market will consolidate around a standalone vendor, so we will pass for now.\n\nWhat would change our view: three paying fleets above 500 vehicles. We would love to hear when you get there.\n\nSara';

const next = [
  { key: 'committee:v1', kind: 'vote', title: 'Northwind Health, Series A', rank: 10, at: ago(30), href: '#/committee', figures: [{ label: 'Round', value: 'Series A' }, { label: 'Check', value: 'USD 4M' }, { label: 'Ownership', value: '8.2%' }], chips: [{ label: 'IC Thursday', tone: 'warn' }], actions: [act('Vote', 'committee.vote', 'committee:v1', { primary: true, done: 'Voted', choose: { param: 'vote', options: ['1', '2', '4', '5'].map((v) => ({ value: v, label: v })) } })] },
  { key: 'intake:a1', kind: 'verdict', card: 'triage', title: 'Acme Robotics', rank: 20, at: ago(50), agent: true, href: '#/inbox', steps: steps(4), figures: [{ label: 'Raise', value: 'USD 3M' }, { label: 'Valuation', value: 'USD 15M' }, { label: 'ARR', value: 'USD 410K' }], chips: [{ label: 'Seed' }, { label: 'Robotics' }, { label: 'Fits thesis', tone: 'good' }], actions: [act('Advance', 'intake.advance', 'intake:a1', { primary: true, done: 'Advanced', undo: { op: 'intake.restore', params: { key: 'intake:a1' } } }), act('Hold', 'intake.hold', 'intake:a1', { done: 'Held', undo: { op: 'intake.restore', params: { key: 'intake:a1' } } }), act('Pass', 'intake.pass', 'intake:a1', { done: 'Passed', choose: { param: 'reason', options: PASS }, undo: { op: 'intake.restore', params: { key: 'intake:a1' } } })] },
  { key: 'intake:a2', kind: 'verdict', title: 'Lumen Grid', rank: 21, at: ago(20), agent: true, href: '#/inbox', steps: steps(2), figures: [{ label: 'Raise', value: 'USD 1.5M' }], chips: [{ label: 'Pre-seed' }, { label: 'Energy' }], actions: [act('Hold', 'intake.hold', 'intake:a2', { done: 'Held', undo: { op: 'intake.restore', params: { key: 'intake:a2' } } }), act('Pass', 'intake.pass', 'intake:a2', { primary: true, done: 'Passed', choose: { param: 'reason', options: PASS }, undo: { op: 'intake.restore', params: { key: 'intake:a2' } } })] },
  { key: 'kernel:outbound:ob1fleetwise000', kind: 'draft', card: 'draft', title: 'Fleetwise', rank: 30, at: ago(80), agent: true, href: '#/next/draft/ob1fleetwise000', data: { outbound: 'ob1fleetwise000', kind: 'pass', to: ['dana@fleetwise.io'], subject: 'Fleetwise', error: '' }, figures: [{ label: 'To', value: 'dana@fleetwise.io' }], chips: [{ label: 'Your AI agent', tone: 'agent' }], body: DRAFT, edit: { op: 'outbound.update', params: { outbound: 'ob1fleetwise000' }, field: 'body' }, actions: [{ label: 'Approve and send', op: 'outbound.approve', params: { outbound: 'ob1fleetwise000' }, primary: true, done: 'Sent' }, { label: 'Cancel', op: 'outbound.cancel', params: { outbound: 'ob1fleetwise000' }, done: 'Cancelled' }] },
  { key: 'kernel:proposal:pr1acmeheadct00', kind: 'proposal', card: 'proposal', title: 'Acme Robotics team update', rank: 30, at: ago(95), agent: true, href: '#/next/proposal/pr1acmeheadct00', data: { proposal: 'pr1acmeheadct00', why: 'From the October update.', evidence: { quote: 'We grew the team to 18 people and moved HQ to Denver this quarter.', page: 2 }, items: 1 }, figures: [{ label: 'Headcount', value: '18' }, { label: 'HQ', value: 'Denver' }], chips: [{ label: 'note fields', tone: 'agent' }], actions: [{ label: 'Accept', op: 'proposals.accept', params: { proposal: 'pr1acmeheadct00' }, primary: true, done: 'Accepted' }, { label: 'Dismiss', op: 'proposals.dismiss', params: { proposal: 'pr1acmeheadct00' }, done: 'Dismissed' }] },
  { key: 'funds:m1', kind: 'mark', title: 'Acme Robotics mark, Q3', rank: 32, at: ago(120), agent: true, href: '#/funds', figures: [{ label: 'Value', value: 'USD 6.1M' }, { label: 'Method', value: 'Last round' }, { label: 'Change', value: '+22%' }], actions: [act('Approve', 'funds.approve-mark', 'funds:m1', { primary: true, done: 'Approved' })] },
  { key: 'portfolio:k1', kind: 'verify', title: 'Acme Robotics ARR, October', rank: 40, at: ago(140), agent: true, figures: [{ label: 'ARR', value: 'USD 1.24M' }, { label: 'Growth', value: '+9.7%' }], quote: { text: 'ARR closed October at $1.24M, up from $1.13M.', source: 'p.3' }, actions: [act('Verify', 'portfolio.verify', 'portfolio:k1', { primary: true, done: 'Verified' })] },
  { key: 'portfolio:al1', kind: 'alert', title: 'Northwind Health runway', rank: 50, at: ago(200), href: '#/portfolio', figures: [{ label: 'Runway', value: '5.2 mo' }, { label: 'Net burn', value: 'USD 410K' }], chips: [{ label: 'Under 6 months', tone: 'bad' }], actions: [act('Acknowledge', 'portfolio.acknowledge', 'portfolio:al1', { primary: true, done: 'Acknowledged' })] },
  { key: 'funds:p1', kind: 'payment', title: 'Harbor Endowment, CC-003', rank: 50, at: ago(260), href: '#/funds', figures: [{ label: 'Due', value: 'USD 250,000' }, { label: 'Late', value: '6 days' }], chips: [{ label: 'Overdue', tone: 'bad' }], actions: [act('Mark received', 'funds.mark-received', 'funds:p1', { primary: true, done: 'Received' })] },
  { key: 'network:n1', kind: 'note', title: 'Northwind Health call', rank: 55, at: ago(310), figures: [{ label: 'Ended', value: '16:30' }], actions: [{ label: 'Add note', op: 'portfolio.acknowledge', params: { key: 'network:n1', href: '#/agent' }, primary: true, done: 'Note opened' }] },
  { key: 'markets:c1', kind: 'candidate', title: 'Gearbox Robotics', rank: 60, at: ago(300), agent: true, figures: [{ label: 'Raised', value: 'USD 2.5M' }], chips: [{ label: 'Form D' }, { label: 'Robotics' }], actions: [act('Add to Inbox', 'markets.add', 'markets:c1', { primary: true, done: 'Added' }), act('Dismiss', 'markets.dismiss', 'markets:c1', { done: 'Dismissed' })] },
];

await op(
  'standin.seed',
  {
    data: {
      next,
      outbound: [{ id: 'ob1fleetwise000', kind: 'pass', to: 'dana@fleetwise.io', subject: 'Fleetwise', body: DRAFT, status: 'draft' }],
      proposals: [{ id: 'pr1acmeheadct00', kind: 'note_fields', label: 'Acme Robotics team update', op: 'companies.update', lines: [{ label: 'headcount', before: '14', after: '18' }, { label: 'hq', before: 'Austin', after: 'Denver' }], evidence: 'We grew the team to 18 people and moved HQ to Denver this quarter.', confidence: 0.86, reason: 'From the October update.' }],
      jobs: [
        { kind: 'brief', summary: 'Brief for the Northwind Health board meeting', status: 'queued' },
        { kind: 'triage', summary: 'Read the Lumen Grid deck', status: 'claimed', claimed_at: ago(2) },
        { kind: 'chat', summary: 'How much is uncalled in Fund I?', status: 'done', done_at: ago(40), result: { answer: 'Fund I has USD 18.4M uncalled of USD 50M committed (63% called). The next call is planned for January.' } },
        { kind: 'chat', summary: 'Which portfolio companies have less than 6 months of runway?', status: 'done', done_at: ago(180), result: { answer: 'One: Northwind Health at 5.2 months, net burn USD 410K a month.' } },
        { kind: 'research', summary: 'Research Gearbox Robotics', status: 'failed', error: 'The company website did not answer.', done_at: ago(300) },
      ],
      notifications: [
        { kind: 'intake', title: 'Acme Robotics deck is read', link: '#/focus' },
        { kind: 'committee', title: 'Vote due Thursday: Northwind Health', link: '#/focus' },
        { kind: 'funds', title: 'CC-003 is 6 days late at Harbor Endowment', link: '#/funds', read: true },
      ],
      funds: [
        { name: 'Fund II', code: 'F2', currency: 'USD', vintage: 2024, size_minor: 12000000000, lpa: { fee_rate_ppm: 20000, fee_basis: 'committed', carry_ppm: 200000, waterfall: 'european', hurdle_ppm: 80000 } },
        { name: 'Robotics SPV', kind: 'spv', code: 'S1', currency: 'USD', vintage: 2025, size_minor: 600000000 },
      ],
      activity: [
        { run: 'r1', summary: 'Filed 3 inbound decks from the Deals label', job: 'triage', writes: 9 },
        { run: 'r2', summary: 'Added 4 people from meeting attendees', job: 'brief', writes: 4 },
      ],
      audit: [
        { actor: 'person', op: 'setup.complete', summary: 'Set up Harbor Ventures' },
        { actor: 'agent', op: 'records.enrich', summary: 'Your AI agent filled the website of Acme Robotics' },
      ],
    },
  },
  as,
);

try {
  await op('members.invite', { email: 'dev@harbor.vc', name: 'Dev Rao', role: 'principal', pin: OWNER.pin }, as);
} catch (e) {
  if (e.status !== 409) throw e;
}
console.log('seeded');
