/// <reference path="../pb_data/types.d.ts" />
/**
 * Audio Notes operations (spec B3/D4).
 * Declared in operations.json and discoverable at GET /api/_ops.
 */

// sessions.duplicate — duplicates a saved audio note session
routerAdd('POST', '/api/ops/sessions/duplicate', (e) => {
  const data = e.requestInfo().body;
  const sessionId = data?.session_id;
  if (!sessionId) {
    return e.json(400, { error: 'session_id is required' });
  }

  try {
    const original = e.app.findRecordById('sessions', sessionId);
    const sessionsCol = e.app.findCollectionByNameOrId('sessions');
    const copy = new Record(sessionsCol);

    copy.set('title', `${original.getString('title')} (Copy)`);
    copy.set('category', original.getString('category'));
    copy.set('date', original.getString('date'));
    copy.set('duration', original.getInt('duration'));
    copy.set('attendees', original.getString('attendees'));
    copy.set('is_starred', original.getBool('is_starred'));
    copy.set('overview', original.getString('overview'));
    copy.set('summary', original.getString('summary'));
    copy.set('key_highlights', original.getString('key_highlights'));
    copy.set('action_items', original.get('action_items'));
    copy.set('transcript', original.getString('transcript'));
    copy.set('audio_format', original.getString('audio_format'));
    copy.set('audio_url', original.getString('audio_url'));

    e.app.save(copy);
    return e.json(200, {
      id: copy.id,
      title: copy.getString('title'),
      created: copy.getString('created'),
    });
  } catch (err) {
    return e.json(404, { error: `Failed to duplicate session: ${err}` });
  }
});

// sessions.clear-completed-actions — clears completed action items for a session
routerAdd('POST', '/api/ops/sessions/clear-completed-actions', (e) => {
  const data = e.requestInfo().body;
  const sessionId = data?.session_id;
  if (!sessionId) {
    return e.json(400, { error: 'session_id is required' });
  }

  try {
    const session = e.app.findRecordById('sessions', sessionId);
    const items = session.get('action_items') || [];
    const list = Array.isArray(items) ? items : [];
    const active = list.filter((item) => !item.completed);
    const clearedCount = list.length - active.length;

    session.set('action_items', active);
    e.app.save(session);

    return e.json(200, {
      session_id: sessionId,
      cleared: clearedCount,
      remaining: active.length,
    });
  } catch (err) {
    return e.json(404, { error: `Failed to clear completed actions: ${err}` });
  }
});




