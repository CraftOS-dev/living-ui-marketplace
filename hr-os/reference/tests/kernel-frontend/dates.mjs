// The one date style: each order formats days, ranges, months and times as the table in format.ts says. No server.
// Usage: node dates.mjs (HR_APP points at the app copy; Node 24 runs the .ts directly; store.tsx is stubbed by a tiny loader).
import { pathToFileURL } from 'node:url';
import { register } from 'node:module';
const APP = process.env.HR_APP ?? 'C:/Users/zfoong/AppData/Local/Temp/claude/c--Users-zfoong-Desktop-agent-code-git-CraftBot/c0e5901d-2062-4482-8bdc-490138be0b72/scratchpad/hr_os/kernel-frontend/app';
globalThis.window = { localStorage: { getItem: () => null, setItem: () => undefined } };
register('data:text/javascript,' + encodeURIComponent(`
export async function resolve(spec, ctx, next) {
  if (spec.endsWith('/i18n.ts')) return { url: 'data:text/javascript,' + encodeURIComponent("export const t=(k,v={})=>k==='format.range'?v.from+' to '+v.to:k==='format.until'?'until '+v.day:k; export const tn=(k,n)=>k+n; export const has=()=>true;"), shortCircuit: true };
  if (spec.endsWith('/store.tsx')) return { url: 'data:text/javascript,' + encodeURIComponent("export const getUi=()=>({ entity: '' });"), shortCircuit: true };
  return next(spec, ctx);
}`));
const f = await import(pathToFileURL(APP + '/frontend/src/app/lib/format.ts').href);
const fails = [];
const want = (label, got, exp) => { if (got !== exp) fails.push(`${label}: got "${got}", want "${exp}"`); };
const y = new Date().getFullYear();
const C = { SG: 'DD/MM/YYYY', US: 'MM/DD/YYYY', JP: 'YYYY/MM/DD', DE: 'DD.MM.YYYY', CA: 'YYYY-MM-DD' };
const ents = [{ id: 'sg', country: 'SG' }, { id: 'us', country: 'US' }, { id: 'jp', country: 'JP' }, { id: 'de', country: 'DE' }];
f.setDateStyles('entity', ents, C);
const d = `${y}-11-16`, e = `${y}-11-18`, n = `${y + 1}-01-04`;
want('SG day', f.fmtDay(d, { entity: 'sg' }), '16 Nov');
want('SG day year', f.fmtDay(d, { entity: 'sg', year: 'always' }), `16 Nov ${y}`);
want('US day', f.fmtDay(d, { entity: 'us' }), 'Nov 16');
want('JP day', f.fmtDay(d, { entity: 'jp', year: 'always' }), `${y}/11/16`);
want('DE day', f.fmtDay(d, { entity: 'de', year: 'always' }), `16 Nov ${y}`);
want('default entity is the first', f.fmtDay(d), '16 Nov');
want('country', f.fmtDay(d, { country: 'US', year: 'always' }), `Nov 16, ${y}`);
want('SG range', f.fmtRange(d, e, { entity: 'sg' }), '16 to 18 Nov');
want('US range', f.fmtRange(d, e, { entity: 'us' }), 'Nov 16 to 18');
want('JP range', f.fmtRange(d, e, { entity: 'jp' }), '11/16 to 11/18');
want('SG across years', f.fmtRange(d, n, { entity: 'sg' }), `16 Nov ${y} to 4 Jan ${y + 1}`);
want('SG time', f.time('14:05', { entity: 'sg' }), '14:05');
want('US time', f.time('14:05', { entity: 'us' }), '2:05 PM');
want('SG month', f.fmtMonth(`${y}-11`, { entity: 'sg' }), `Nov ${y}`);
want('JP month', f.fmtMonth(`${y}-11`, { entity: 'jp' }), `${y}/11`);
want('weekday SG', f.fmtDay(d, { entity: 'sg', weekday: true, year: 'never' }), `${new Date(d + 'T12:00').toLocaleDateString('en', { weekday: 'short' })} 16 Nov`);
// Time zones: a timestamp is read in its entity's zone; "today" is the office's.
const zents = [{ id: 'sg', country: 'SG', timezone: 'Asia/Singapore' }, { id: 'us', country: 'US', timezone: 'America/New_York' }, { id: 'jp', country: 'JP', timezone: 'Asia/Tokyo' }];
f.setDateStyles('entity', zents, C);
want('UTC evening is the next day in Tokyo', f.dayOf('2026-11-04 20:30:00.000Z', { entity: 'jp' }), '2026-11-05');
want('and in Singapore', f.dayOf('2026-11-04 20:30:00.000Z', { entity: 'sg' }), '2026-11-05');
want('but not in New York', f.dayOf('2026-11-04 20:30:00.000Z', { entity: 'us' }), '2026-11-04');
want('a timestamp formats as its zone day', f.fmtDay('2026-11-04 20:30:00.000Z', { entity: 'jp', year: 'always' }), '2026/11/05');
want('stamp day key', f.stampDayKey('2026-11-04 20:30:00.000Z', { entity: 'jp' }), '2026-11-05');
want('stamp day key keeps a day', f.stampDayKey('2026-11-04', { entity: 'jp' }), '2026-11-04');
want('stamp day', f.fmtStampDay('2026-11-04 20:30:00.000Z', { entity: 'sg', year: 'always' }), '5 Nov 2026');
want('stamp', f.fmtStamp('2026-11-04 20:30:00.000Z', { entity: 'sg' }), `5 Nov${new Date().getFullYear() === 2026 ? '' : ' 2026'}, 04:30`);
want('time in the zone', f.time('2026-11-04 20:30:00.000Z', { entity: 'jp' }), '05:30');
want('time in New York', f.time('2026-11-04 20:30:00.000Z', { entity: 'us' }), '3:30 PM');
// The viewer's own entity decides the style when nothing else does (a Japanese employee sees JP style).
f.setDateStyles('entity', zents, C, 'jp');
want('viewer entity style', f.fmtDay(`${y}-11-16`), '11/16');
want('viewer entity zone today', f.today(), new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()));
f.setDateStyles('iso', ents);
want('company iso wins', f.fmtDay(d, { entity: 'us', year: 'always' }), `${y}-11-16`);
f.setDateStyles('mdy', ents);
want('company mdy wins', f.fmtDay(d, { entity: 'sg', year: 'always' }), `Nov 16, ${y}`);
console.log(fails.length === 0 ? 'ok: one date style (dmy, mdy, ymd, iso) for days, ranges, months and times; timestamps read in the entity zone; the viewer entity decides' : fails.join('\n'));
process.exit(fails.length === 0 ? 0 : 1);
