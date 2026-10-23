/// <reference path="../pb_data/types.d.ts" />
/**
 * Reviewer responses: the reviews a manuscript received, split into
 * comments, each with a type, a strategy, the response, and the change that
 * addresses it. A comment is "addressed" only when it is linked to a block
 * of the manuscript that changed for it. Your AI agent may propose the split
 * and draft responses; a person confirms.
 */

function u() {
  return require(`${__hooks}/lib_util.js`);
}
function core() {
  return require(`${__hooks}/lib_core.js`);
}

function msOf(ctx, id) {
  const m = core().need(ctx.app, 'manuscripts', id, 'manuscript');
  core().guardProjectId(ctx, m.getString('project'));
  return m;
}

function reviewOut(r) {
  return { id: r.id, manuscript: r.getString('manuscript'), label: r.getString('label'), body: r.getString('body'), received_on: r.getString('received_on'), created: r.getString('created') };
}

function itemOut(app, it) {
  const b = it.getString('change_block') !== '' ? u().byId(app, 'ms_blocks', it.getString('change_block')) : null;
  return {
    id: it.id,
    review: it.getString('review'),
    sort: it.getInt('sort'),
    comment: it.getString('comment'),
    kind: it.getString('kind'),
    strategy: it.getString('strategy'),
    status: it.getString('status'),
    response: it.getString('response'),
    change_block: it.getString('change_block'),
    change_text: b !== null ? b.getString('text').slice(0, 300) : '',
    change_note: it.getString('change_note'),
    actor: it.getString('actor'),
    confirmed: it.getBool('confirmed'),
  };
}

function list(ctx, p) {
  const util = u();
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const reviews = ctx.app.findRecordsByFilter('reviews_received', 'manuscript = {:m}', 'created', 0, 0, { m: m.id });
  return {
    reviews: reviews.map((r) => Object.assign(reviewOut(r), { items: ctx.app.findRecordsByFilter('response_items', 'review = {:r}', 'sort,created', 0, 0, { r: r.id }).map((it) => itemOut(ctx.app, it)) })),
  };
}

function addReview(ctx, p) {
  const util = u();
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const r = util.newRecord(ctx.app, 'reviews_received');
  r.set('manuscript', m.id);
  r.set('label', util.squash(util.text(p, 'label', 200, '')) || 'Reviewer ' + (util.count(ctx.app, 'SELECT COUNT(*) AS n FROM reviews_received WHERE manuscript = {:m}', { m: m.id }) + 1));
  r.set('body', util.text(p, 'body', 200000, ''));
  r.set('received_on', util.day(p, 'received_on', util.today()));
  ctx.app.save(r);
  return { review: reviewOut(r) };
}

function updateReview(ctx, p) {
  const util = u();
  const r = core().need(ctx.app, 'reviews_received', util.req(p, 'review'), 'review');
  msOf(ctx, r.getString('manuscript'));
  if (util.has(p, 'label')) r.set('label', util.squash(util.text(p, 'label', 200, '')) || r.getString('label'));
  if (util.has(p, 'body')) r.set('body', util.text(p, 'body', 200000, ''));
  ctx.app.save(r);
  return { review: reviewOut(r) };
}

function removeReview(ctx, p) {
  const r = core().need(ctx.app, 'reviews_received', u().req(p, 'review'), 'review');
  msOf(ctx, r.getString('manuscript'));
  ctx.app.delete(r);
  return { deleted: true };
}

const KINDS = ['major', 'minor', 'typo', 'misunderstanding', 'praise'];
const STRATEGIES = ['accept', 'defend', 'clarify', 'experiment'];

/** responses.add-items: comments from a review (a person selects them; your AI agent proposes a split). */
function addItems(ctx, p) {
  const util = u();
  const app = ctx.app;
  const r = core().need(app, 'reviews_received', util.req(p, 'review'), 'review');
  const m = msOf(ctx, r.getString('manuscript'));
  const items = util.list(p, 'items') || [];
  if (items.length === 0) throw util.fail(400, 'items is a JSON list of {comment, kind, strategy, response}.', 'missing_param');
  let sort = util.count(app, 'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM response_items WHERE review = {:r}', { r: r.id });
  const made = [];
  app.runInTransaction((tx) => {
    items.slice(0, 200).forEach((it, i) => {
      util.keysOnly(it, ['comment', 'kind', 'strategy', 'response'], 'Item ' + (i + 1));
      const comment = String(it.comment || '').trim();
      if (comment === '') throw util.fail(400, 'Item ' + (i + 1) + ' needs the comment.', 'invalid_param');
      const x = util.newRecord(tx, 'response_items');
      x.set('manuscript', m.id);
      x.set('review', r.id);
      x.set('sort', sort++);
      x.set('comment', comment.slice(0, 20000));
      x.set('kind', util.choice(it.kind, KINDS, 'major', 'Item ' + (i + 1) + ' kind', 'items'));
      x.set('strategy', util.choice(it.strategy, STRATEGIES, '', 'Item ' + (i + 1) + ' strategy', 'items'));
      x.set('status', 'open');
      x.set('response', String(it.response || '').slice(0, 20000));
      x.set('actor', ctx.actor);
      x.set('confirmed', !ctx.isAgent);
      tx.save(x);
      made.push(x.id);
    });
  });
  return { added: made.length, items: made };
}

/** responses.update: type, strategy, response, linked change and status (addressed needs a linked change). */
function updateItem(ctx, p) {
  const util = u();
  const app = ctx.app;
  const it = core().need(app, 'response_items', util.req(p, 'item'), 'comment');
  msOf(ctx, it.getString('manuscript'));
  if (ctx.isAgent && it.getBool('confirmed') && (util.has(p, 'status') || util.has(p, 'comment'))) throw util.fail(403, 'Your AI agent drafts responses; a person sets the status of a confirmed comment.', 'agent_not_permitted');
  if (util.has(p, 'comment')) it.set('comment', util.text(p, 'comment', 20000, it.getString('comment')));
  if (util.has(p, 'kind')) it.set('kind', util.oneOf(p, 'kind', KINDS, 'major'));
  if (util.has(p, 'strategy')) it.set('strategy', util.oneOf(p, 'strategy', STRATEGIES, ''));
  if (util.has(p, 'response')) it.set('response', util.text(p, 'response', 20000, ''));
  if (util.has(p, 'change_note')) it.set('change_note', util.text(p, 'change_note', 2000, ''));
  if (util.has(p, 'change_block')) {
    const id = util.str(p, 'change_block', '');
    if (id !== '') {
      const b = core().need(app, 'ms_blocks', id, 'block');
      if (b.getString('manuscript') !== it.getString('manuscript')) throw util.fail(400, 'The change must be in the same manuscript.', 'invalid_param');
    }
    it.set('change_block', id);
  }
  if (util.has(p, 'status')) {
    const st = util.oneOf(p, 'status', ['open', 'addressed', 'declined', 'unresolved'], 'open');
    if (st === 'addressed' && it.getString('change_block') === '') throw util.fail(409, 'A comment is addressed only when it is linked to the change that addresses it (choose the paragraph).', 'needs_linked_change');
    it.set('status', st);
  }
  if (!ctx.isAgent) it.set('confirmed', true);
  app.save(it);
  return { item: itemOut(app, it) };
}

function removeItem(ctx, p) {
  const it = core().need(ctx.app, 'response_items', u().req(p, 'item'), 'comment');
  msOf(ctx, it.getString('manuscript'));
  if (ctx.isAgent && it.getBool('confirmed')) throw u().fail(403, 'Your AI agent removes only its own unconfirmed comments.', 'agent_not_permitted');
  ctx.app.delete(it);
  return { deleted: true };
}

/** responses.letter: the response letter as Markdown (each comment, its response, where it changed). */
function letter(ctx, p) {
  const util = u();
  const app = ctx.app;
  const m = msOf(ctx, util.req(p, 'manuscript'));
  const L = ['# Response to the reviewers', '', 'Manuscript: ' + m.getString('title'), ''];
  for (const r of app.findRecordsByFilter('reviews_received', 'manuscript = {:m}', 'created', 0, 0, { m: m.id })) {
    L.push('## ' + r.getString('label'), '');
    let n = 0;
    for (const it of app.findRecordsByFilter('response_items', 'review = {:r}', 'sort,created', 0, 0, { r: r.id })) {
      n++;
      L.push('**Comment ' + n + '.** ' + it.getString('comment'), '');
      L.push('**Response.** ' + (it.getString('response') || '[response to write]'), '');
      if (it.getString('change_block') !== '') {
        const b = util.byId(app, 'ms_blocks', it.getString('change_block'));
        if (b !== null) L.push('**Change.** "' + b.getString('text').replace(/\[cite\]/g, '').slice(0, 400) + '"' + (it.getString('change_note') ? ' (' + it.getString('change_note') + ')' : ''), '');
      } else if (it.getString('change_note') !== '') L.push('**Change.** ' + it.getString('change_note'), '');
    }
  }
  const open = util.count(app, "SELECT COUNT(*) AS n FROM response_items WHERE manuscript = {:m} AND status = 'open'", { m: m.id });
  return { filename: 'response-to-reviewers.md', content: L.join('\n'), open: open };
}

module.exports = { list: list, addReview: addReview, updateReview: updateReview, removeReview: removeReview, addItems: addItems, updateItem: updateItem, removeItem: removeItem, letter: letter };
