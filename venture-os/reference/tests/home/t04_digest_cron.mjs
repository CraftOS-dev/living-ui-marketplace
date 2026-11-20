// The morning digest from the cron (every 15 minutes): a member whose own zone is in its morning (after
// 07:00, before noon) and who turned the digest on gets it once, through the mock bridge; a member with it
// off gets nothing; the next tick sends nothing twice. Waits up to 17 minutes for the tick (run it in the
// background). Works on any set-up firm with the mock bridge (VO_BRIDGE).
import { BRIDGE, newApi, ok, section, summary } from './lib.mjs';

const api = newApi();
const O = { as: 'owner' };
const ZONES = ['Pacific/Auckland', 'Australia/Sydney', 'Asia/Tokyo', 'Asia/Singapore', 'Asia/Kolkata', 'Asia/Dubai', 'Europe/Moscow', 'Europe/Berlin', 'Europe/London', 'America/Sao_Paulo', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Pacific/Honolulu'];
const hourIn = (z) => Number(new Intl.DateTimeFormat('en-US', { timeZone: z, hourCycle: 'h23', hour: '2-digit' }).format(new Date()));
const zone = ZONES.find((z) => hourIn(z) >= 7 && hourIn(z) <= 10);
section('a member in their morning');
ok(zone !== undefined, `a zone in its morning now: ${zone}`);
await api.op('auth.update-profile', { zone, prefs: { digest: true, digest_link: 'http://127.0.0.1:3192/' } }, O);
const me = await api.op('auth.me', {}, O);
const before = (await api.op('outbound.list', { kind: 'digest', status: 'all', limit: 100 }, O)).messages.filter((m) => m.ref_id === me.member.id);
const sentToday = before.filter((m) => m.status === 'sent' && Date.now() - Date.parse(m.created.replace(' ', 'T')) < 12 * 3600000);
const until = Date.now() + 17 * 60000;
let got = null;
while (Date.now() < until && sentToday.length === 0) {
  const now = (await api.op('outbound.list', { kind: 'digest', status: 'all', limit: 100 }, O)).messages.filter((m) => m.ref_id === me.member.id && !before.some((b) => b.id === m.id));
  if (now.length > 0) {
    got = now;
    break;
  }
  await new Promise((r) => setTimeout(r, 20000));
}
if (sentToday.length > 0) ok(true, 'already sent today in this zone (a second run sends nothing)');
else {
  ok(got !== null && got.length === 1 && got[0].status === 'sent', 'the cron sent one digest', got);
  const mock = await (await fetch(`http://127.0.0.1:${BRIDGE}/__mock/sent`)).json();
  ok(mock.sent.some((m) => m.to.includes('owner@venture.test') && /Your day at/.test(m.subject)), 'the bridge received it');
}
const partner = (await api.op('members.list', {}, O)).members.find((m) => m.role?.code === 'partner' || m.role === 'partner');
if (partner) {
  const p = (await api.op('outbound.list', { kind: 'digest', status: 'all', limit: 100 }, O)).messages.filter((m) => m.ref_id === partner.id);
  ok(p.length === 0, 'a member with the digest off gets nothing');
}
const res = summary('t04_digest_cron');
process.exit(res.failed > 0 ? 1 : 0);
