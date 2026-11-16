// t02: memos. Open, write (typed and pasted counts), your AI agent drafts objective sections as tracked
// changes through trigger memo_sections (thesis and recommendation refused), citations in the deal's scope,
// keep from Next, discard, scenarios with the engine's expected multiple, submit (hash, frozen), next version,
// Word export, AI-use disclosure.
import { newApi, fresh, team, deal, upload, waitText, pdf, section, ok, eq, refuses, summary, O, A, PEOPLE, as } from './lib.mjs';

fresh();
const api = newApi();
await team(api);
const P1 = as('p1');

const acme = await deal(api, 'acme.com', 'diligence');
const other = await deal(api, 'lumen.health', 'screen');

section('open');
ok((await api.op('memos.get', { deal: acme.number }, P1)).memo === null, 'no memo before it is opened (memo null)');
await refuses(api, 'memos.open', { deal: acme.number }, A, 403, 'agent_not_permitted', 'your AI agent does not open memos');
const op1 = await api.op('memos.open', { deal: acme.number }, P1);
const m = op1.memo;
ok(op1.created && m.number === 'M-001' && m.version === 1 && m.status === 'draft', 'version 1 draft M-001', m);
ok(m.snapshot.company && m.snapshot.raise_minor === 300000000 && m.snapshot.check_minor === 100000000 && m.snapshot.ownership_ppm === 66667 && m.snapshot.author === 'Paula Partner', 'the decision snapshot fills itself from the deal', m.snapshot);
eq(m.sections.length, 13, 'every template section is there');
const again = await api.op('memos.open', { deal: acme.number }, P1);
ok(!again.created && again.memo.id === m.id, 'opening again answers the same draft');

section('people write directly');
const bs = await api.op('memos.block-save', { memo: m.id, section: 'thesis', text: 'Warehouse robotics will be won by software-first teams.' }, P1);
ok(bs.block.counts.typed === 55 && bs.block.counts.agent === 0, 'typed characters counted', bs.block.counts);
const bs2 = await api.op('memos.block-save', { memo: m.id, section: 'thesis', text: 'Warehouse robotics will be won by software-first teams. Pasted line here.', pasted: 18 }, P1);
ok(bs2.block.counts.pasted === 18 && bs2.block.counts.typed === 55, 'pasted characters counted', bs2.block.counts);
await refuses(api, 'memos.block-save', { memo: m.id, section: 'teamz', text: 'x' }, P1, 400, 'invalid_param', 'an unknown section is refused naming the near one');
await refuses(api, 'memos.block-save', { memo: m.id, section: 'team', text: 'ARR grew [2].', citations: '[]' }, P1, 400, 'citation_marker', 'a marker without its citation is refused');
await refuses(api, 'memos.block-save', { memo: m.id, section: 'team', text: 'x' }, A, 403, 'agent_not_permitted', 'your AI agent never types into a block');
await refuses(api, 'memos.block-save', { memo: m.id, section: 'team', text: 'x' }, as('an'), 403, 'not_permitted', 'an analyst (committee and pipeline view) cannot write');

section('citations in the deal scope');
const up = await upload(api, { deal: acme.number, folder: 'Pitch' }, [{ name: 'Acme deck.pdf', bytes: pdf(['Acme Robotics', 'ARR USD 1.2M growing 15 percent a month', 'Team of 12 led by two robotics PhDs']) }], 'owner');
ok(up.status === 200, 'deck uploaded to the deal room', up.body);
const f1 = up.body.files[0];
const ready = await waitText(api, f1.id, O);
ok(ready.file.text_state === 'ready', 'its text was read (' + ready.file.text_state + ')');
const upo = await upload(api, { deal: other.number, folder: 'Pitch' }, [{ name: 'Lumen deck.pdf', bytes: pdf(['Lumen Health', 'ARR USD 400K']) }], 'owner');
const f2 = upo.body.files[0];
await waitText(api, f2.id, O);
const a1 = (await api.op('anchors.create', { file: f1.id, quote: 'ARR USD 1.2M growing 15 percent a month' }, A)).anchor;
const a2 = (await api.op('anchors.create', { file: f1.id, quote: 'Team of 12 led by two robotics PhDs' }, A)).anchor;
const ax = (await api.op('anchors.create', { file: f2.id, quote: 'ARR USD 400K' }, A)).anchor;

section('your AI agent drafts through trigger memo_sections');
await refuses(api, 'memos.draft-sections', { memo: m.id, sections: '["thesis"]' }, P1, 400, 'people_only_section', 'a partner cannot ask for the thesis');
const ds = await api.op('memos.draft-sections', { memo: m.id, sections: '["team","traction","market"]' }, P1);
ok(ds.request !== '' && ds.sections.join(',') === 'team,traction,market' && ds.ask.sections.join(',') === 'team,traction,market', 'one fire, with the chosen sections', ds);
await refuses(api, 'memos.draft-sections', { memo: m.id, sections: '["team"]' }, P1, 409, 'pending', 'asking again while it waits is refused');
const mg = await api.op('memos.get', { memo: m.id }, A);
ok(mg.memo.ask && mg.memo.ask.open && mg.memo.ask.sections.length === 3, 'the memo shows what it waits for', mg.memo.ask);
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'thesis', text: 'We should invest.' }, A, 403, 'people_only_section', 'the thesis is refused with a clear error');
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'recommendation', text: 'Invest.' }, A, 403, 'people_only_section', 'the recommendation is refused');
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'scenarios', text: 'Base 3x.' }, A, 403, 'people_only_section', 'scenarios are refused');
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'traction', text: 'ARR is 400K [1].', citations: JSON.stringify([{ kind: 'anchor', anchor: ax.id }]) }, A, 400, 'citation_out_of_scope', "another deal's file is outside the citation scope");
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'market', text: 'Big market [1].', citations: JSON.stringify([{ kind: 'url', url: 'https://example.com/report' }]) }, A, 400, 'missing_param', 'a public source needs its name');
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'team', text: 'x' }, P1, 403, 'agent_only', 'people type instead of drafting');
const d1 = await api.op('memos.draft-block', { memo: m.id, section: 'traction', text: 'ARR is USD 1.2M, growing 15% a month [1]. Gross margin is 70% [?].', citations: JSON.stringify([{ kind: 'anchor', anchor: a1.id }]) }, A);
ok(d1.state === 'proposed' && d1.uncited === 1 && d1.block.citations[0].ok && d1.block.citations[0].label.indexOf('Acme deck.pdf') === 0, 'traction drafted as a tracked change with a resolved citation and one uncited figure', d1);
const note = await api.op('notes.create', { deal: acme.number, title: 'First call', template: 'first_call' }, P1);
const noteId = (note.note ?? note).id;
ok(typeof noteId === 'string' && noteId !== '', 'a deal note to cite (deals notes.create)', note);
const d2 = await api.op('memos.draft-block', { memo: m.id, section: 'team', text: 'A team of 12 led by two robotics PhDs [1]. First call notes [2].', citations: JSON.stringify([{ kind: 'anchor', anchor: a2.id }, { kind: 'note', note: noteId }]) }, A);
ok(d2.state === 'proposed' && d2.block.citations[1].kind === 'note' && d2.block.citations[1].ok, 'team drafted citing a file and a deal note', d2.block.citations);
const d3 = await api.op('memos.draft-block', { memo: m.id, section: 'market', text: 'Warehouse automation spend is forecast at USD 41B by 2027 [1].', citations: JSON.stringify([{ kind: 'url', url: 'https://example.com/warehouse-report', source: 'Example Research' }]) }, A);
ok(d3.block.citations[0].label === 'Example Research', 'market drafted citing a named public source');
const mv = (await api.op('memos.get', { memo: m.id }, P1)).memo;
ok(mv.ask && !mv.ask.open && mv.ask.done_at !== '', 'every section it named drafted: the ask landed', mv.ask);
ok(mv.pending === 3 && mv.sections.find((s) => s.key === 'traction').proposed !== null && mv.sections.find((s) => s.key === 'traction').block === null, 'three sections wait as proposed changes beside empty kept text');

section('Next: one card per memo with drafted sections');
const nx = await api.op('next.list', { kinds: 'draft' }, P1);
const card = nx.items.find((x) => x.key === 'committee:draft:' + m.id);
ok(card && card.title.indexOf('3 sections drafted') >= 0 && card.card === 'memo_drafts' && card.data.blocks.length === 3 && card.agent === true, 'the partner sees "3 sections drafted" with the drafts', card);
ok(card && card.actions.map((a) => a.label).join(',') === 'Keep all,Discard all', 'its actions are Keep all and Discard all');

section('keep and discard');
const disc = await api.op('memos.discard', { memo: m.id, section: 'market' }, P1);
eq(disc.discarded, ['market'], 'market discarded');
const keepAct = card.actions[0];
const kept = await api.op(keepAct.op, keepAct.params, P1);
ok(kept.kept.length === 2 && kept.memo.pending === 0, 'Keep all from Next keeps the two left', kept.kept);
const tr = kept.memo.sections.find((s) => s.key === 'traction').block;
ok(tr && tr.origin === 'agent' && tr.counts.agent > 0 && tr.counts.typed === 0, 'kept text counts as agent-written', tr && tr.counts);
ok(kept.memo.disclosure.agent > 0 && kept.memo.disclosure.text.indexOf('your AI agent') >= 0, 'the AI-use disclosure counts it: ' + kept.memo.disclosure.text);
const ed = await api.op('memos.block-save', { memo: m.id, section: 'traction', text: tr.content.replace('Gross margin is 70% [?].', 'Gross margin is 68% per the data room [1].') }, P1);
ok(ed.block.origin === 'mixed' && ed.block.counts.typed > 0 && ed.block.counts.agent < tr.counts.agent, 'a person editing a kept draft moves characters from agent to typed', ed.block.counts);
eq(ed.block.uncited, 0, 'the uncited mark is gone');
const nx2 = await api.op('next.list', { kinds: 'draft' }, P1);
ok(!nx2.items.some((x) => x.key === 'committee:draft:' + m.id), 'the Next card is gone');
const stale = await api.op('memos.draft-block', { memo: m.id, section: 'team', text: 'Team of 12 [1].', citations: JSON.stringify([{ kind: 'anchor', anchor: a2.id }]) }, A);
await api.op('memos.block-save', { memo: m.id, section: 'team', text: 'Team of 12, two PhDs, ex-Amazon Robotics [1].' }, P1);
const ks = await api.op('memos.keep', { memo: m.id, blocks: JSON.stringify([stale.block.id]) }, P1);
ok(ks.stale.join(',') === 'team' && ks.kept.length === 0, 'a draft of a section the partner changed since is stale, the partner text stays');

section('scenarios');
const sc = await api.op('memos.block-save', { memo: m.id, section: 'scenarios', scenarios: JSON.stringify([{ label: 'Bear', probability: '50', multiple: '0' }, { label: 'Base', probability: '30', multiple: '3' }]) }, P1);
ok(sc.block.scenarios.reason === 'probabilities_not_100' && sc.block.scenarios.expected_multiple_e8 === null && sc.block.scenarios.sum_ppm === 800000, 'probabilities at 80%: no expected multiple, the reason says why');
await refuses(api, 'memos.submit', { memo: m.id }, P1, 409, 'probabilities_not_100', 'submit refuses scenarios that do not sum to 100%');
const sc2 = await api.op('memos.block-save', { memo: m.id, section: 'scenarios', scenarios: JSON.stringify([{ label: 'Bear', probability: '50', multiple: '0' }, { label: 'Base', probability: '30', multiple: '3' }, { label: 'Bull', probability: '20', exit_value: '1500000000' }]) }, P1);
ok(sc2.block.scenarios.reason === null && sc2.block.scenarios.rows[2].multiple_e8 === 10000050000 && sc2.block.scenarios.expected_multiple_e8 > 0, 'at 100% the engine computes the expected multiple (bull from the exit value and ownership)', sc2.block.scenarios);

section('submit');
await api.op('memos.draft-block', { memo: m.id, section: 'competition', text: 'Two funded competitors.' }, A);
await refuses(api, 'memos.submit', { memo: m.id }, P1, 409, 'drafts_pending', 'drafts waiting block the submit');
await api.op('memos.discard', { memo: m.id }, P1);
await refuses(api, 'memos.submit', { memo: m.id }, A, 403, 'agent_not_permitted', 'your AI agent never submits');
const sub = await api.op('memos.submit', { memo: m.id }, P1);
ok(sub.memo.status === 'submitted' && /^[0-9a-f]{64}$/.test(sub.memo.hash) && sub.memo.frozen, 'submitted and frozen with a hash', sub.memo.hash);
await refuses(api, 'memos.block-save', { memo: m.id, section: 'team', text: 'late' }, P1, 409, 'memo_frozen', 'a submitted version is frozen');
await refuses(api, 'memos.draft-block', { memo: m.id, section: 'team', text: 'late' }, A, 409, 'memo_frozen', 'your AI agent is told it is frozen');
const v2 = await api.op('memos.open', { deal: acme.number }, P1);
ok(v2.created && v2.memo.version === 2 && v2.memo.number === 'M-001' && v2.memo.sections.find((s) => s.key === 'thesis').block.content.indexOf('Warehouse robotics') === 0, 'opening again starts version 2 from the kept text');
ok(v2.memo.versions.length === 2 && v2.memo.versions[1].hash === sub.memo.hash, 'versions listed with their hashes');
await api.op('memos.submit', { memo: v2.memo.id }, P1);

section('export');
const ex = await api.raw('memos.export', { deal: acme.number }, { authorization: api.tokens.get(PEOPLE.p1) });
ok(ex.status === 200 && String(ex.headers.get('content-type')).indexOf('wordprocessingml') >= 0 && String(ex.headers.get('content-disposition')).indexOf('.docx') >= 0, 'Word file streamed (' + ex.headers.get('content-disposition') + ')');
const exA = await api.raw('memos.export', { deal: acme.number }, { 'X-A2App-Token': (await import('node:fs')).readFileSync((await import('node:path')).join(api.app, '.agent-token'), 'utf8').trim() });
ok(exA.status === 200, 'your AI agent may export');

section('lists');
const ml = await api.op('memos.list', {}, O);
ok(ml.memos.length === 1 && ml.memos[0].version === 2 && ml.memos[0].status === 'submitted', 'memos.list shows the latest version per deal');
const tpl = await api.op('memos.template-save', { name: 'Seed memo', sections: JSON.stringify(['Summary', 'Team', 'Thesis']) }, O);
ok(tpl.template.sections.find((s) => s.key === 'thesis').people_only === true, 'a new template keeps the thesis people only');
await refuses(api, 'memos.template-save', { name: 'X' }, P1, 403, 'not_permitted', 'a partner cannot change templates');

const s = summary('t02 memos');
process.exit(s.failed > 0 ? 1 : 0);
