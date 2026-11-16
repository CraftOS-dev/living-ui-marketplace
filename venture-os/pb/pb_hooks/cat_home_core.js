/**
 * Catalog: Home (SPEC 3.1, 7.13). One read for the whole Home page, and the
 * member's own morning digest (preview, send now). Turning the digest on or
 * off is the member's screen preference (auth.update-profile --prefs
 * '{"digest":true}'); the day's picture for your AI agent is app.today,
 * whose `home` block lib_home.today answers.
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});

module.exports = [
  {
    name: 'home.summary',
    method: 'GET',
    fn: 'lib_home.summary',
    perm: 'signed',
    agent: 'allow',
    effect: 'read',
    desc: "Home in one read: Next (top 5, total), today's meetings, inbound by week, the quarter's funnel, the fund's TVPI, DPI, net IRR and J-curve, the shortest runways; visual: the key numbers (firm NAV, TVPI, DPI, net IRR, called share, dry powder, portfolio companies, open deals), holdings by fund, deals by stage, the cohort flow, inbound by source, fund performance. hidden, errors: blocks left out.",
    params: { fund: S('Fund for the funds block and the runways (id or name; default: the newest fund with capital called)') },
  },
  {
    name: 'home.digest',
    method: 'GET',
    fn: 'lib_home.opDigest',
    perm: 'signed',
    agent: 'deny',
    effect: 'read',
    desc: "Your morning digest: whether it is on (auth.update-profile --prefs '{\"digest\":true}'), its time and zone, and what today's would say (meetings, items past due, votes and decisions due, alerts), one line per item. Nothing is sent.",
  },
  {
    name: 'home.digest-send',
    method: 'POST',
    fn: 'lib_home.opDigestSend',
    perm: 'signed',
    agent: 'deny',
    effect: 'write',
    track: false,
    desc: 'Send your digest to your own address now (a test). It goes out as a kernel outbound message of kind digest, approved by you.',
  },
];
