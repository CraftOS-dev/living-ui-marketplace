// Seeded: pack profile fields on entities and employments, photos (multipart
// upload and protected serving), app.home questions_asked, and file documents.
import { eq, fresh, newApi, ok, refuses, section, summary, PORT } from './lib.mjs';

fresh({ seed: true });
const api = newApi();
const O = { as: 'owner' };
const all = (await api.op('people.directory', { status: 'all', limit: 100 }, O)).people;
const by = {};
for (const p of all) by[p.work_email] = p;
const sam = by['sam@northwind.test'];
const emily = by['emily@northwind.test'];

section('profile fields');
const us = (await api.op('entities.get', { entity: 'Northwind Inc' }, O)).entity;
ok(us.packs.indexOf('us-federal') >= 0 && us.packs.indexOf('us-ca') >= 0, 'the US-CA entity enables us-federal and us-ca', us.packs);
ok(us.profile_fields.length > 0 && us.profile_fields.every((f) => f.pack && f.key && f.label && f.type && (f.scope === 'employee' || f.scope === 'entity')), 'entities.get lists the packs profile fields (' + us.profile_fields.length + ')', us.profile_fields[0]);
ok(us.profile_fields.some((f) => f.pack === 'us-federal') && us.profile_fields.some((f) => f.pack === 'us-ca'), 'from both packs');
const ep = await api.op('people.get', { employee: emily.number }, O);
ok(ep.employments[0].profile_fields.length === us.profile_fields.length, 'people.get employments carry the same profile fields');
const jp = (await api.op('entities.get', { entity: 'Northwind KK' }, O)).entity;
ok(jp.profile_fields.every((f) => f.pack === 'jp' || jp.packs.indexOf(f.pack) >= 0), 'Japan entity fields come from its packs (' + jp.profile_fields.length + ')');

section('photos');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
await api.op('auth.me', {}, { as: 'sam@northwind.test' });
const samToken = api.tokens.get('sam@northwind.test');
const fd = new FormData();
fd.set('employee', sam.number);
fd.set('photo', new Blob([png], { type: 'image/png' }), 'me.png');
const up = await fetch(`http://127.0.0.1:${PORT}/api/ops/people/photo-set`, { method: 'POST', headers: { authorization: samToken }, body: fd });
const upBody = await up.json();
ok(up.status === 200 && upBody.employee.photo === true, 'a person uploads their own photo', upBody);
await api.op('auth.me', {}, { as: 'eng.lead@northwind.test' });
const mgrToken = api.tokens.get('eng.lead@northwind.test');
const got = await fetch(`http://127.0.0.1:${PORT}/api/ops/people/photo?employee=${sam.number}`, { headers: { authorization: mgrToken } });
const bytes = Buffer.from(await got.arrayBuffer());
ok(got.status === 200 && got.headers.get('content-type') === 'image/png' && bytes.equals(png), 'the manager sees it (streamed with its type)', { status: got.status, type: got.headers.get('content-type'), len: bytes.length });
await api.op('auth.me', {}, { as: 'sales.lead@northwind.test' });
const other = await fetch(`http://127.0.0.1:${PORT}/api/ops/people/photo?employee=${sam.number}`, { headers: { authorization: api.tokens.get('sales.lead@northwind.test') } });
eq(other.status, 403, 'someone outside the team cannot');
const anon = await fetch(`http://127.0.0.1:${PORT}/api/ops/people/photo?employee=${sam.number}`);
eq(anon.status, 401, 'nobody signed in cannot');
const agentPhoto = await api.op('people.photo', { employee: sam.number }, { as: 'agent' });
ok(typeof agentPhoto.path === 'string' && agentPhoto.mime === 'image/png' && agentPhoto.size === png.length, 'your AI agent gets the file path', agentPhoto);
await refuses(api, 'people.photo-set', { employee: emily.number, clear: true }, { as: 'sam@northwind.test' }, 403, 'not_permitted', 'a person cannot change someone else\'s photo');
eq((await api.op('people.photo-set', { employee: sam.number, clear: true }, { as: 'hr@northwind.test' })).employee.photo, false, 'HR removes it');
await refuses(api, 'people.photo', { employee: sam.number }, O, 404, 'not_found', 'no photo answers 404');

section('documents with a file');
const dfd = new FormData();
dfd.set('employee', sam.number);
dfd.set('title', 'Employment contract');
dfd.set('category', 'contract');
dfd.set('needs_ack', 'true');
dfd.set('file', new Blob([Buffer.from('%PDF-1.4\n%test\n')], { type: 'application/pdf' }), 'contract.pdf');
await api.op('auth.me', {}, { as: 'hr@northwind.test' });
const dres = await fetch(`http://127.0.0.1:${PORT}/api/ops/documents/add`, { method: 'POST', headers: { authorization: api.tokens.get('hr@northwind.test') }, body: dfd });
const doc = (await dres.json()).document;
ok(dres.status === 200 && doc.has_file && doc.needs_ack, 'HR adds a contract that needs acknowledgement', doc);
const home = await api.op('app.home', {}, { as: 'sam@northwind.test' });
ok(home.documents_to_ack.some((d) => d.id === doc.id) && home.questions_asked !== undefined, 'Sam\'s home lists it to acknowledge (and questions_asked is there)', home);
const fileRes = await fetch(`http://127.0.0.1:${PORT}/api/ops/documents/file?document=${doc.id}`, { headers: { authorization: samToken } });
ok(fileRes.status === 200 && fileRes.headers.get('content-type') === 'application/pdf', 'Sam opens the file');
eq((await api.op('documents.ack', { document: doc.id }, { as: 'sam@northwind.test' })).document.acked_at !== '', true, 'and acknowledges it');
await refuses(api, 'documents.ack', { document: doc.id }, { as: 'hr@northwind.test' }, 403, 'not_permitted', 'only the person acknowledges');

const s = summary('t06_profile_photo');
process.exitCode = s.failed > 0 ? 1 : 0;
