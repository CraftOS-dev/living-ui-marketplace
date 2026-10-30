/// <reference path="../pb_data/types.d.ts" />
/**
 * Operations: cards, links and tags.
 *
 * Every route here is declared in operations.json. Routes run in isolated
 * VMs: each handler requires its modules inside itself, and inside
 * runInTransaction only the transaction handle (tx) is used.
 */

/* ------------------------------------------------------------------ cards */

routerAdd('GET', '/api/ops/cards/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const filters = [lib.LIVE, "kind != 'section'"];
    const params = {};
    const board = u.str(p, 'board', '');
    if (board !== '') {
      filters.push('board = {:board}');
      params.board = board;
    }
    const kind = u.oneOf(p, 'kind', lib.KINDS, '');
    if (kind !== '') {
      filters.push('kind = {:kind}');
      params.kind = kind;
    }
    if (u.bool(p, 'starred', false)) filters.push('starred = true');
    const digest = u.oneOf(p, 'digest', ['any', 'none', 'waiting', 'reading', 'done', 'failed'], 'any');
    if (digest === 'none') filters.push("digest = ''");
    else if (digest !== 'any') {
      filters.push('digest_state = {:ds}');
      params.ds = digest;
    }
    const added = u.oneOf(p, 'added_by', ['app', 'agent'], '');
    if (added !== '') {
      filters.push('added_by = {:by}');
      params.by = added;
    }
    const q = u.squash(u.str(p, 'q', ''));
    if (q !== '') {
      filters.push('(title ~ {:q} || body ~ {:q} || url ~ {:q} || source ~ {:q} || digest ~ {:q} || tags ~ {:q} || meta ~ {:q})');
      params.q = q;
    }
    const tag = u.squash(u.str(p, 'tag', '')).replace(/^#+/, '');
    const sort = { newest: '-created', oldest: 'created', title: 'title', updated: '-updated' }[u.oneOf(p, 'sort', ['newest', 'oldest', 'title', 'updated'], 'newest')];
    const limit = u.int(p, 'limit', 100, 1, 500);
    const offset = u.int(p, 'offset', 0, 0, 1000000);
    let rows = app.findRecordsByFilter('cards', filters.join(' && '), sort, 0, 0, params);
    // Tags are matched whole (a json field cannot be matched exactly in a filter).
    if (tag !== '') {
      const t = tag.toLowerCase();
      rows = rows.filter((r) => lib.jsonField(r, 'tags', []).some((x) => String(x).toLowerCase() === t));
    }
    const boardRows = app.findRecordsByFilter('boards', '', '', 0, 0);
    const names = {};
    for (const b of boardRows) names[b.id] = b.getString('name');
    const paths = u.bool(p, 'paths', false);
    return {
      count: rows.length,
      cards: rows.slice(offset, offset + limit).map((r) => {
        const c = lib.serialize(app, r, { paths: paths });
        c.board_name = names[c.board] || '';
        return c;
      }),
    };
  }),
);

routerAdd('GET', '/api/ops/cards/get', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const links = require(`${__hooks}/lib_links.js`);
    const rec = lib.mustGet(app, u.req(p, 'card'));
    const out = lib.serialize(app, rec, { paths: true });
    const board = app.findRecordById('boards', rec.getString('board'));
    out.board_name = board.getString('name');
    const rows = app.findRecordsByFilter('links', 'source = {:id} || target = {:id}', 'created', 0, 0, { id: rec.id });
    out.links = [];
    for (const l of rows) {
      const otherId = l.getString('source') === rec.id ? l.getString('target') : l.getString('source');
      const other = u.byId(app, 'cards', otherId);
      if (other === null || other.getString('trashed') !== '') continue;
      const s = links.serialize(l);
      s.direction = l.getString('source') === rec.id ? 'out' : 'in';
      s.other = { id: other.id, title: other.getString('title'), kind: other.getString('kind') };
      out.links.push(s);
    }
    return out;
  }),
);

routerAdd('GET', '/api/ops/cards/preview', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const url = u.req(p, 'url');
    if (!lib.isWebUrl(url)) throw u.fail(400, 'url must start with http:// or https://');
    const kind = lib.kindForUrl(url);
    const allowed = require(`${__hooks}/lib_settings.js`).row(app).getBool('link_previews');
    if (kind !== 'link' && kind !== 'youtube') return { kind: kind, title: '', description: '', site: lib.hostOf(url), image: kind === 'image' ? url : '', author: '' };
    if (!allowed) {
      const id = lib.youtubeId(url);
      return { kind: kind, title: '', description: '', site: lib.hostOf(url), image: id !== '' ? require(`${__hooks}/lib_unfurl.js`).youtubeStill(id) : '', author: '', previews_off: true };
    }
    return require(`${__hooks}/lib_unfurl.js`).preview(url);
  }),
);

routerAdd('POST', '/api/ops/cards/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    let uploads = [];
    try {
      uploads = ev.findUploadedFiles('file') || [];
    } catch {
      uploads = [];
    }
    const rec = require(`${__hooks}/lib_add.js`).addCard(app, p, u.fromAgent(ev) ? 'agent' : 'app', uploads);
    return { card: lib.serialize(app, rec, { paths: true }) };
  }),
);

routerAdd('POST', '/api/ops/cards/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const rec = lib.mustGet(app, u.req(p, 'card'));
    const oldUrl = rec.getString('url');
    lib.applyFields(rec, p, false);
    const kind = rec.getString('kind');
    if (kind === 'section' && rec.getString('title') === '') rec.set('title', 'Section');
    // A new url for a link or video brings a fresh preview (or on request).
    const url = rec.getString('url');
    if ((kind === 'link' || kind === 'youtube') && url !== '' && (url !== oldUrl || u.bool(p, 'refresh_preview', false))) {
      const meta = lib.jsonField(rec, 'meta', {});
      meta.site = lib.hostOf(url);
      const id = lib.youtubeId(url);
      if (kind === 'youtube' && id !== '') {
        meta.video_id = id;
        rec.set('thumb', require(`${__hooks}/lib_unfurl.js`).youtubeStill(id));
      } else if (kind === 'link') rec.set('thumb', '');
      if (require(`${__hooks}/lib_settings.js`).row(app).getBool('link_previews')) {
        const pv = require(`${__hooks}/lib_unfurl.js`).preview(url);
        if (pv.site !== '') meta.site = pv.site;
        meta.description = pv.description;
        if (pv.author !== '') meta.author = pv.author;
        if (pv.image !== '' && kind === 'link') rec.set('thumb', pv.image);
        if (!u.has(p, 'title') && pv.title !== '') rec.set('title', pv.title);
      }
      rec.set('meta', meta);
    }
    lib.checkComplete(rec);
    app.save(rec);
    return { card: lib.serialize(app, rec, { paths: true }) };
  }),
);

routerAdd('POST', '/api/ops/cards/move', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const positions = u.list(p, 'positions', false);
    if (positions === undefined || positions.length === 0) throw u.fail(400, 'positions is required, e.g. [{"card":"<id>","x":120,"y":80}]');
    if (positions.length > 500) throw u.fail(400, 'At most 500 cards at once');
    // Checked up front (no require per card): numbers in range, sizes not too small.
    const LIMITS = { x: [-1000000, 1000000], y: [-1000000, 1000000], w: [120, 4000], h: [60, 4000] };
    for (const pos of positions) {
      if (pos === null || typeof pos !== 'object' || typeof pos.card !== 'string') throw u.fail(400, 'Each position is {"card":"<id>","x":0,"y":0} (w and h optional)');
      for (const k of ['x', 'y', 'w', 'h']) {
        if (pos[k] === undefined || pos[k] === null) continue;
        const n = Number(pos[k]);
        if (!isFinite(n) || n < LIMITS[k][0] || n > LIMITS[k][1]) throw u.fail(400, k + ' must be a number from ' + LIMITS[k][0] + ' to ' + LIMITS[k][1]);
      }
    }
    const front = u.bool(p, 'front', false);
    let moved = 0;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_cards.js`);
      let z = null;
      for (const pos of positions) {
        const rec = lib.mustGet(tx, pos.card);
        for (const k of ['x', 'y', 'w', 'h']) if (pos[k] !== undefined && pos[k] !== null) rec.set(k, Math.round(Number(pos[k])));
        if (front && rec.getString('kind') !== 'section') {
          if (z === null) z = lib.topZ(tx, rec.getString('board'));
          z += 1;
          rec.set('z', z);
        }
        tx.save(rec);
        moved++;
      }
    });
    return { moved: moved };
  }),
);

routerAdd('POST', '/api/ops/cards/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'ids', false) || (u.has(p, 'card') ? [u.str(p, 'card', '')] : []);
    if (ids.length === 0) throw u.fail(400, 'ids is required, e.g. ["<card id>"]');
    const when = new Date().toISOString();
    let n = 0;
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_cards.js`);
      for (const id of ids) {
        const rec = lib.mustGet(tx, id);
        rec.set('trashed', when);
        tx.save(rec);
        n++;
      }
    });
    return { trashed: n, ids: ids, message: n + (n === 1 ? ' card' : ' cards') + ' moved to the trash; cards.restore brings them back for a day' };
  }),
);

routerAdd('POST', '/api/ops/cards/restore', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'ids', false) || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required, e.g. ["<card id>"]');
    let n = 0;
    app.runInTransaction((tx) => {
      const util = require(`${__hooks}/lib_util.js`);
      for (const id of ids) {
        const rec = util.byId(tx, 'cards', String(id));
        if (rec === null || rec.getString('trashed') === '') continue;
        rec.set('trashed', '');
        tx.save(rec);
        n++;
      }
    });
    return { restored: n };
  }),
);

routerAdd('POST', '/api/ops/cards/duplicate', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'ids', false) || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required, e.g. ["<card id>"]');
    const made = [];
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_cards.js`);
      const add = require(`${__hooks}/lib_add.js`);
      const util = require(`${__hooks}/lib_util.js`);
      const recs = ids.map((id) => lib.mustGet(tx, id));
      const board = recs[0].getString('board');
      if (recs.some((r) => r.getString('board') !== board)) throw util.fail(400, 'Duplicate cards from one board at a time');
      const map = add.copyCards(tx, recs, board, 32, 32);
      for (const id of ids) made.push(map[id].id);
    });
    return { ids: made };
  }),
);

routerAdd('POST', '/api/ops/cards/transfer', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const ids = u.list(p, 'ids', false) || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required, e.g. ["<card id>"]');
    const target = require(`${__hooks}/lib_boards.js`).mustGet(app, u.req(p, 'board'));
    const mode = u.oneOf(p, 'mode', ['move', 'copy'], 'move');
    let dropped = 0;
    const out = [];
    app.runInTransaction((tx) => {
      const lib = require(`${__hooks}/lib_cards.js`);
      const add = require(`${__hooks}/lib_add.js`);
      const recs = ids.map((id) => lib.mustGet(tx, id)).filter((r) => r.getString('board') !== target.id);
      if (recs.length === 0) return;
      // Land the group to the right of what the target board already holds.
      let x0 = Infinity;
      let y0 = Infinity;
      for (const r of recs) {
        x0 = Math.min(x0, r.getFloat('x'));
        y0 = Math.min(y0, r.getFloat('y'));
      }
      const existing = lib.liveOnBoard(tx, target.id);
      let right = 0;
      let top = 0;
      if (existing.length > 0) {
        right = -Infinity;
        top = Infinity;
        for (const r of existing) {
          right = Math.max(right, r.getFloat('x') + r.getFloat('w'));
          top = Math.min(top, r.getFloat('y'));
        }
        right += 80;
      }
      const dx = Math.round(right - x0);
      const dy = Math.round(top - y0);
      if (mode === 'copy') {
        const map = add.copyCards(tx, recs, target.id, dx, dy);
        for (const r of recs) out.push(map[r.id].id);
        return;
      }
      // Move: the cards change board; links among them follow, links to
      // cards staying behind are removed.
      const moving = {};
      for (const r of recs) moving[r.id] = true;
      const seen = {};
      const follow = [];
      for (const r of recs) {
        for (const l of tx.findRecordsByFilter('links', 'source = {:id} || target = {:id}', '', 0, 0, { id: r.id })) {
          if (seen[l.id]) continue;
          seen[l.id] = true;
          if (moving[l.getString('source')] && moving[l.getString('target')]) follow.push(l);
          else {
            tx.delete(l);
            dropped++;
          }
        }
      }
      let z = lib.topZ(tx, target.id);
      for (const r of recs) {
        z += 1;
        r.set('board', target.id);
        r.set('x', r.getFloat('x') + dx);
        r.set('y', r.getFloat('y') + dy);
        if (r.getString('kind') !== 'section') r.set('z', z);
        tx.save(r);
        out.push(r.id);
      }
      for (const l of follow) {
        l.set('board', target.id);
        tx.save(l);
      }
    });
    return { ids: out, mode: mode, links_left_behind: dropped, board: target.id };
  }),
);

routerAdd('POST', '/api/ops/cards/tag', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const ids = u.list(p, 'ids', false) || [];
    if (ids.length === 0) throw u.fail(400, 'ids is required, e.g. ["<card id>"]');
    const add = lib.cleanTags(u.list(p, 'add', true) || []);
    const remove = (lib.cleanTags(u.list(p, 'remove', true) || [])).map((t) => t.toLowerCase());
    if (add.length === 0 && remove.length === 0) throw u.fail(400, 'Give add and/or remove, e.g. --add "method, climate"');
    let n = 0;
    app.runInTransaction((tx) => {
      const cards = require(`${__hooks}/lib_cards.js`);
      for (const id of ids) {
        const rec = cards.mustGet(tx, id);
        const now = cards.jsonField(rec, 'tags', []).filter((t) => remove.indexOf(String(t).toLowerCase()) < 0);
        const lower = now.map((t) => String(t).toLowerCase());
        for (const t of add) if (lower.indexOf(t.toLowerCase()) < 0) now.push(t);
        rec.set('tags', now.slice(0, 20));
        tx.save(rec);
        n++;
      }
    });
    return { updated: n };
  }),
);

/* ------------------------------------------------------------------- tags */

routerAdd('GET', '/api/ops/tags/list', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const lib = require(`${__hooks}/lib_cards.js`);
    const count = {};
    const label = {};
    for (const r of app.findRecordsByFilter('cards', lib.LIVE, '', 0, 0)) {
      for (const t of lib.jsonField(r, 'tags', [])) {
        const k = String(t).toLowerCase();
        count[k] = (count[k] || 0) + 1;
        if (label[k] === undefined) label[k] = String(t);
      }
    }
    return {
      tags: Object.keys(count)
        .map((k) => ({ tag: label[k], count: count[k] }))
        .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
    };
  }),
);

routerAdd('POST', '/api/ops/tags/rename', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const lib = require(`${__hooks}/lib_cards.js`);
    const from = u.req(p, 'tag').replace(/^#+/, '').toLowerCase();
    const to = lib.cleanTags([u.req(p, 'to')])[0];
    if (to === undefined) throw u.fail(400, 'to must be a tag name');
    let n = 0;
    app.runInTransaction((tx) => {
      const cards = require(`${__hooks}/lib_cards.js`);
      for (const r of tx.findRecordsByFilter('cards', 'tags ~ {:t}', '', 0, 0, { t: from })) {
        const tags = cards.jsonField(r, 'tags', []);
        if (!tags.some((t) => String(t).toLowerCase() === from)) continue;
        const next = [];
        for (const t of tags) {
          const v = String(t).toLowerCase() === from ? to : String(t);
          if (!next.some((x) => x.toLowerCase() === v.toLowerCase())) next.push(v);
        }
        r.set('tags', next);
        tx.save(r);
        n++;
      }
    });
    return { updated: n };
  }),
);

routerAdd('POST', '/api/ops/tags/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const tag = u.req(p, 'tag').replace(/^#+/, '').toLowerCase();
    let n = 0;
    app.runInTransaction((tx) => {
      const cards = require(`${__hooks}/lib_cards.js`);
      for (const r of tx.findRecordsByFilter('cards', 'tags ~ {:t}', '', 0, 0, { t: tag })) {
        const tags = cards.jsonField(r, 'tags', []);
        const next = tags.filter((t) => String(t).toLowerCase() !== tag);
        if (next.length === tags.length) continue;
        r.set('tags', next);
        tx.save(r);
        n++;
      }
    });
    return { updated: n };
  }),
);

/* ------------------------------------------------------------------ links */

routerAdd('POST', '/api/ops/links/add', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app, ev) => {
    const u = require(`${__hooks}/lib_util.js`);
    const links = require(`${__hooks}/lib_links.js`);
    const r = links.create(app, p, u.fromAgent(ev) ? 'agent' : 'app');
    return { link: links.serialize(r.link), existed: r.existed };
  }),
);

routerAdd('POST', '/api/ops/links/update', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const links = require(`${__hooks}/lib_links.js`);
    const rec = links.mustGet(app, u.req(p, 'link'));
    if (u.has(p, 'kind')) rec.set('kind', u.oneOf(p, 'kind', links.KINDS, 'relates'));
    if (u.has(p, 'label')) rec.set('label', u.squash(u.str(p, 'label', '')).slice(0, 200));
    if (u.bool(p, 'flip', false)) {
      const s = rec.getString('source');
      rec.set('source', rec.getString('target'));
      rec.set('target', s);
    }
    app.save(rec);
    return { link: links.serialize(rec) };
  }),
);

routerAdd('POST', '/api/ops/links/delete', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const rec = require(`${__hooks}/lib_links.js`).mustGet(app, u.req(p, 'link'));
    app.delete(rec);
    return { deleted: true };
  }),
);

routerAdd('POST', '/api/ops/links/decide', (e) =>
  require(`${__hooks}/lib_util.js`).handle(e, (p, app) => {
    const u = require(`${__hooks}/lib_util.js`);
    const decision = u.oneOf(p, 'decision', ['confirm', 'reject'], '');
    if (decision === '') throw u.fail(400, 'decision is required: confirm or reject');
    let ids = u.list(p, 'ids', false) || [];
    const board = u.str(p, 'board', '');
    if (ids.length === 0 && board !== '') ids = app.findRecordsByFilter('links', "board = {:b} && status = 'proposed'", '', 0, 0, { b: board }).map((r) => r.id);
    if (ids.length === 0) throw u.fail(400, 'Give ids (proposed link ids) or board (to decide all its proposals)');
    let n = 0;
    app.runInTransaction((tx) => {
      const links = require(`${__hooks}/lib_links.js`);
      for (const id of ids) {
        const rec = links.mustGet(tx, id);
        if (rec.getString('status') !== 'proposed') continue;
        if (decision === 'reject') tx.delete(rec);
        else {
          rec.set('status', 'confirmed');
          tx.save(rec);
        }
        n++;
      }
    });
    return { decided: n, decision: decision };
  }),
);
