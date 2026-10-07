/// <reference path="../pb_data/types.d.ts" />
/**
 * Audio Notes operations. Every route is declared in operations.json
 * (GET /api/_ops); the UI calls the same routes for everything that is more
 * than a plain field edit, so the app and the agent share one implementation.
 *
 * note_id everywhere accepts a record id or a note's exact title.
 * GOJA RULE: callbacks run in isolated VMs; require() libraries inside them.
 */

// ---------------------------------------------------------------- notes

routerAdd('GET', '/api/ops/notes/list', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const where = [];
    const args = {};
    const q = o.str(p, 'q', '');
    if (q !== '') {
      where.push('(title ~ {:q} || overview ~ {:q} || summary ~ {:q} || transcript ~ {:q} || my_notes ~ {:q} || attendees ~ {:q})');
      args.q = q;
    }
    const category = o.str(p, 'category', '');
    if (category !== '') {
      where.push('category = {:c}');
      args.c = category;
    }
    if (o.bool(p, 'starred', false)) where.push('starred = true');
    const from = o.day(p, 'from', '');
    if (from !== '') {
      where.push('date >= {:from}');
      args.from = from;
    }
    const to = o.day(p, 'to', '');
    if (to !== '') {
      where.push('date <= {:to}');
      args.to = to;
    }
    const limit = o.int(p, 'limit', 50, 1, 500);
    const recs = app.findRecordsByFilter('notes', where.join(' && '), '-date,-created', limit, 0, args);
    return {
      count: recs.length,
      notes: recs.map((r) => {
        const n = lib.toApi(r, false);
        return {
          id: n.id,
          title: n.title,
          date: n.date,
          category: n.category,
          starred: n.starred,
          duration_seconds: n.duration_seconds,
          transcript_status: n.transcript_status,
          notes_status: n.notes_status,
          attendees: n.attendees,
          open_actions: n.action_items.filter((a) => !a.done).length,
          summary: n.summary,
        };
      }),
    };
  }),
);

routerAdd('GET', '/api/ops/notes/get', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const rec = lib.resolve(app, o.req(p, 'note_id'));
    return lib.toApi(rec, o.bool(p, 'include_transcript', true));
  }),
);

routerAdd('POST', '/api/ops/notes/create', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const rec = new Record(app.findCollectionByNameOrId('notes'));
    const date = o.day(p, 'date', o.today());
    const title = o.str(p, 'title', '');
    const transcript = o.str(p, 'transcript', '');
    rec.set('title', title !== '' ? title : 'Note, ' + date);
    rec.set('title_auto', title === '');
    rec.set('date', date);
    rec.set('category', o.str(p, 'category', 'General'));
    rec.set('source', 'text');
    rec.set('transcript', transcript);
    rec.set('my_notes', o.str(p, 'my_notes', ''));
    const attendees = o.strings(p, 'attendees');
    if (attendees !== undefined) rec.set('attendees', attendees);
    if (transcript !== '' && o.bool(p, 'generate', true)) rec.set('notes_status', 'queued');
    app.save(rec);
    return lib.toApi(rec, false);
  }),
);

routerAdd('POST', '/api/ops/notes/import-audio', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const path = o.req(p, 'path');
    // Media files only: this reads a local path into the app's storage.
    const MEDIA = ['mp3', 'wav', 'm4a', 'aac', 'ogg', 'oga', 'opus', 'webm', 'flac', 'wma', 'aiff', 'aif', 'amr', 'mp4', 'm4v', 'mov', 'mkv', 'avi', '3gp'];
    const base = $filepath.base(path);
    const dot = base.lastIndexOf('.');
    const ext = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
    if (MEDIA.indexOf(ext) === -1) throw o.fail(400, 'Not an audio or video file (' + MEDIA.join(', ') + '): ' + base);
    try {
      $os.stat(path);
    } catch {
      throw o.fail(404, 'File not found: ' + path);
    }
    const rec = new Record(app.findCollectionByNameOrId('notes'));
    const title = o.str(p, 'title', '');
    rec.set('title', title !== '' ? title : base.slice(0, dot));
    rec.set('title_auto', title === '');
    rec.set('date', o.day(p, 'date', o.today()));
    rec.set('category', o.str(p, 'category', 'General'));
    rec.set('source', 'import');
    rec.set('language', o.language(p, 'language', 'auto'));
    rec.set('audio', $filesystem.fileFromPath(path));
    rec.set('transcript_status', 'queued');
    app.save(rec);
    return lib.toApi(rec, false);
  }),
);

// Every write below changes the note inside one transaction
// (lib_notes.mutate): edits from the page, the agent and the workers can
// never save over each other.

routerAdd('POST', '/api/ops/notes/update', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const title = o.str(p, 'title', undefined);
    if (title !== undefined && title === '') throw o.fail(400, 'title cannot be empty');
    const date = o.day(p, 'date', undefined);
    const texts = {};
    for (const name of ['category', 'overview', 'summary', 'my_notes', 'transcript']) {
      const v = o.str(p, name, undefined);
      if (v !== undefined) texts[name] = v;
    }
    const starred = o.bool(p, 'starred', undefined);
    const language = o.language(p, 'language', undefined);
    const lists = {};
    for (const name of ['attendees', 'key_points', 'decisions']) {
      const v = o.strings(p, name);
      if (v !== undefined) lists[name] = v;
    }
    // Structured lists (shapes are checked by the record hook on save).
    const structured = {};
    for (const name of ['action_items', 'segments']) {
      const v = o.jsonList(p, name);
      if (v !== undefined) structured[name] = v;
    }
    const rec = lib.mutate(app, id, (r) => {
      const attendeesBefore = lib.list(r, 'attendees');
      if (title !== undefined) {
        r.set('title', title);
        r.set('title_auto', false);
      }
      if (date !== undefined) r.set('date', date);
      for (const k of Object.keys(texts)) r.set(k, texts[k]);
      if (starred !== undefined) r.set('starred', starred);
      if (language !== undefined) r.set('language', language);
      for (const k of Object.keys(lists)) r.set(k, lists[k]);
      for (const k of Object.keys(structured)) r.set(k, structured[k]);
      if (lists.attendees !== undefined) lib.trackAttendeeEdits(r, attendeesBefore);
    });
    if (rec === null) throw o.fail(404, 'The note was deleted.');
    return lib.toApi(rec, false);
  }),
);

routerAdd('POST', '/api/ops/notes/delete', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const rec = lib.resolve(app, o.req(p, 'note_id'));
    const out = { deleted: rec.id, title: rec.getString('title') };
    app.delete(rec);
    return out;
  }),
);

routerAdd('POST', '/api/ops/notes/duplicate', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const src = lib.resolve(app, o.req(p, 'note_id'));
    const copy = new Record(app.findCollectionByNameOrId('notes'));
    const COPIED = [
      'date', 'category', 'starred', 'source', 'duration', 'language', 'detected_language', 'peak_db',
      'transcript', 'segments', 'overview', 'summary', 'key_points', 'decisions', 'action_items',
      'attendees', 'people_found', 'people_removed', 'my_notes', 'transcript_error', 'notes_error',
    ];
    for (const name of COPIED) copy.set(name, src.get(name));
    copy.set('title', (src.getString('title') + ' (copy)').slice(0, 200));
    copy.set('title_auto', false);
    // A copy never inherits queued/running work: it gets the settled state.
    const segments = lib.list(src, 'segments');
    const t = src.getString('transcript_status');
    copy.set('transcript_status', ['queued', 'processing', 'live', 'finishing'].indexOf(t) !== -1 ? (segments.length > 0 ? 'done' : '') : t);
    const n = src.getString('notes_status');
    copy.set('notes_status', n === 'queued' || n === 'processing' ? (src.getString('summary') !== '' ? 'done' : '') : n);
    const audio = src.getString('audio');
    if (audio !== '') {
      copy.set('audio', $filesystem.fileFromPath($filepath.join(app.dataDir(), 'storage', src.baseFilesPath(), audio)));
    }
    app.save(copy);
    return lib.toApi(copy, false);
  }),
);

routerAdd('POST', '/api/ops/notes/transcribe', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const language = o.language(p, 'language', undefined);
    let problem = null;
    const rec = lib.mutate(app, id, (r) => {
      const status = r.getString('transcript_status');
      if (r.getString('audio') === '') problem = o.fail(409, 'This note has no audio to transcribe.');
      else if (status === 'queued' || status === 'processing' || status === 'finishing') problem = o.fail(409, 'This note is already being transcribed.');
      else if (status === 'live') problem = o.fail(409, 'This note is still being recorded.');
      if (problem !== null) return false;
      if (language !== undefined) r.set('language', language);
      r.set('transcript_status', 'queued');
      r.set('transcript_error', '');
    });
    if (problem !== null) throw problem;
    if (rec === null) throw o.fail(404, 'The note was deleted.');
    return lib.toApi(rec, false);
  }),
);

routerAdd('POST', '/api/ops/notes/generate', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    let problem = null;
    const rec = lib.mutate(app, id, (r) => {
      const status = r.getString('notes_status');
      if (r.getString('transcript').trim() === '') problem = o.fail(409, 'This note has no transcript yet.');
      else if (status === 'queued' || status === 'processing') problem = o.fail(409, 'Notes for this recording are already being written.');
      if (problem !== null) return false;
      r.set('notes_status', 'queued');
      r.set('notes_error', '');
    });
    if (problem !== null) throw problem;
    if (rec === null) throw o.fail(404, 'The note was deleted.');
    return lib.toApi(rec, false);
  }),
);

// Attach an audio file to an existing note and transcribe it (multipart:
// note_id, duration, audio). The file arrives with the request, and the note
// is only read inside the transaction that sets it, so a long upload can
// never write back a stale copy of the note.
routerAdd(
  'POST',
  '/api/ops/notes/attach-audio',
  (e) =>
    require(`${__hooks}/lib_ops.js`).handle(e, (p, app, ev) => {
      const o = require(`${__hooks}/lib_ops.js`);
      const lib = require(`${__hooks}/lib_notes.js`);
      const id = lib.resolve(app, o.req(p, 'note_id')).id;
      const files = ev.findUploadedFiles('audio');
      if (files.length === 0 || files[0] === undefined) throw o.fail(400, 'audio file is required (multipart field "audio")');
      const seconds = o.int(p, 'duration', null, 0, 1000000);
      const rec = lib.mutate(app, id, (r) => {
        r.set('audio', files[0]);
        if (seconds !== null) r.set('duration', seconds);
        r.set('transcript_status', 'queued');
        r.set('transcript_error', '');
      });
      if (rec === null) throw o.fail(404, 'The note was deleted.');
      return lib.toApi(rec, false);
    }),
  $apis.bodyLimit(2147483648),
);

// The recording stopped (multipart from the page: note_id, duration, audio;
// JSON from the agent: note_id only, for a page that died mid-recording).
routerAdd(
  'POST',
  '/api/ops/notes/finish-live',
  (e) =>
    require(`${__hooks}/lib_ops.js`).handle(e, (p, app, ev) => {
      const o = require(`${__hooks}/lib_ops.js`);
      const lib = require(`${__hooks}/lib_notes.js`);
      const id = lib.resolve(app, o.req(p, 'note_id')).id;
      let file = null;
      try {
        const files = ev.findUploadedFiles('audio');
        if (files.length > 0 && files[0] !== undefined) file = files[0];
      } catch {
        file = null; // JSON request: no files
      }
      const rec = require(`${__hooks}/lib_live.js`).finish(app, id, file, o.int(p, 'duration', null, 0, 1000000));
      if (rec === null) throw o.fail(409, 'This note is not being recorded.');
      return lib.toApi(rec, false);
    }),
  $apis.bodyLimit(2147483648),
);

routerAdd('POST', '/api/ops/notes/detect-people', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const speakers = o.int(p, 'speakers', undefined, 0, 20);
    let problem = null;
    const rec = lib.mutate(app, id, (r) => {
      const ts = r.getString('transcript_status');
      const ps = r.getString('people_status');
      if (r.getString('audio') === '') problem = o.fail(409, 'This note has no audio: speakers are told apart by their voices.');
      else if (ts === 'live' || ts === 'finishing') problem = o.fail(409, 'This note is still being recorded.');
      else if (ps === 'queued' || ps === 'processing') problem = o.fail(409, 'The speakers of this note are already being detected.');
      if (problem !== null) return false;
      // An explicit run may add everyone it hears, including people removed before.
      if (speakers !== undefined) r.set('speaker_count', speakers);
      r.set('people_removed', []);
      require(`${__hooks}/lib_people.js`).queue(r);
    });
    if (problem !== null) throw problem;
    if (rec === null) throw o.fail(404, 'The note was deleted.');
    return lib.toApi(rec, false);
  }),
);

routerAdd('POST', '/api/ops/notes/rename-speaker', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const from = o.req(p, 'speaker');
    const to = o.req(p, 'name');
    if (to.length > 80) throw o.fail(400, 'name must be at most 80 characters');
    if (from === to) return lib.toApi(lib.resolve(app, id), false);
    let missing = false;
    const rec = lib.mutate(app, id, (r) => {
      if (!require(`${__hooks}/lib_people.js`).rename(r, from, to)) {
        missing = true;
        return false;
      }
    });
    if (missing) throw o.fail(404, 'Nobody in this note is called "' + from + '".');
    if (rec === null) throw o.fail(404, 'The note was deleted.');
    return lib.toApi(rec, false);
  }),
);

routerAdd('POST', '/api/ops/notes/cancel', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    return require(`${__hooks}/lib_worker.js`).cancel(app, id);
  }),
);

routerAdd('GET', '/api/ops/notes/export', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const rec = lib.resolve(app, o.req(p, 'note_id'));
    return lib.exportNote(rec, o.str(p, 'format', 'md'));
  }),
);

// -------------------------------------------------------------- actions

routerAdd('POST', '/api/ops/actions/add', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const item = {
      id: $security.randomString(10),
      title: o.req(p, 'title'),
      assignee: o.str(p, 'assignee', ''),
      due: o.day(p, 'due', ''),
      done: false,
    };
    if (lib.mutate(app, id, (r) => r.set('action_items', lib.list(r, 'action_items').concat([item]))) === null) {
      throw o.fail(404, 'The note was deleted.');
    }
    return item;
  }),
);

routerAdd('POST', '/api/ops/actions/update', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const actionId = o.req(p, 'action_id');
    const title = o.str(p, 'title', undefined);
    if (title !== undefined && title === '') throw o.fail(400, 'title cannot be empty');
    const assignee = o.str(p, 'assignee', undefined);
    const dueRaw = o.str(p, 'due', undefined);
    const due = dueRaw === undefined ? undefined : dueRaw === '' ? '' : o.day(p, 'due', '');
    const done = o.bool(p, 'done', undefined);
    let item;
    lib.mutate(app, id, (r) => {
      const items = lib.list(r, 'action_items');
      item = items.find((a) => a.id === actionId);
      if (item === undefined) return false;
      if (title !== undefined) item.title = title;
      if (assignee !== undefined) item.assignee = assignee;
      if (due !== undefined) item.due = due;
      if (done !== undefined) item.done = done;
      r.set('action_items', items);
    });
    if (item === undefined) throw o.fail(404, 'No action item ' + actionId + ' in this note');
    return item;
  }),
);

routerAdd('POST', '/api/ops/actions/delete', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    const actionId = o.req(p, 'action_id');
    let remaining = -1;
    lib.mutate(app, id, (r) => {
      const items = lib.list(r, 'action_items');
      const kept = items.filter((a) => a.id !== actionId);
      if (kept.length === items.length) return false;
      remaining = kept.length;
      r.set('action_items', kept);
    });
    if (remaining === -1) throw o.fail(404, 'No action item ' + actionId + ' in this note');
    return { deleted: actionId, remaining: remaining };
  }),
);

routerAdd('POST', '/api/ops/actions/clear-done', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const id = lib.resolve(app, o.req(p, 'note_id')).id;
    let cleared = 0;
    let remaining = 0;
    lib.mutate(app, id, (r) => {
      const items = lib.list(r, 'action_items');
      const kept = items.filter((a) => !a.done);
      cleared = items.length - kept.length;
      remaining = kept.length;
      r.set('action_items', kept);
    });
    return { cleared: cleared, remaining: remaining };
  }),
);

routerAdd('GET', '/api/ops/actions/open', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const lib = require(`${__hooks}/lib_notes.js`);
    const assignee = o.str(p, 'assignee', '').toLowerCase();
    const recs = app.findRecordsByFilter('notes', '', '-date,-created', 0, 0);
    const out = [];
    for (const rec of recs) {
      for (const a of lib.list(rec, 'action_items')) {
        if (a.done) continue;
        if (assignee !== '' && a.assignee.toLowerCase() !== assignee) continue;
        out.push({
          note_id: rec.id,
          note_title: rec.getString('title'),
          note_date: rec.getString('date'),
          action_id: a.id,
          title: a.title,
          assignee: a.assignee,
          due: a.due,
        });
      }
    }
    out.sort((x, y) => (x.due || '9999') < (y.due || '9999') ? -1 : (x.due || '9999') > (y.due || '9999') ? 1 : 0);
    return { count: out.length, actions: out };
  }),
);

// --------------------------------------------------------- digest/engine

routerAdd('GET', '/api/ops/digest/week', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => {
    const o = require(`${__hooks}/lib_ops.js`);
    return require(`${__hooks}/lib_notes.js`).digest(app, o.day(p, 'week', o.today()));
  }),
);

routerAdd('GET', '/api/ops/engine/status', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => require(`${__hooks}/lib_worker.js`).status(app)),
);

routerAdd('POST', '/api/ops/engine/install', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, (p, app) => require(`${__hooks}/lib_setup.js`).request(app)),
);
