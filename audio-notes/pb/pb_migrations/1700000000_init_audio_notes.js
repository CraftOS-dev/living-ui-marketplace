/// <reference path="../pb_data/types.d.ts" />
/**
 * Audio Notes schema: sessions collection holding recording metadata, audio file,
 * and structured sections (overview, summary, key_highlights, action_items, transcript).
 * Auth mode "none": open rules are acceptable because the app binds loopback.
 */
migrate(
  (app) => {
    const sessions = new Collection({
      type: 'base',
      name: 'sessions',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'title', type: 'text', required: true, max: 255 },
        { name: 'category', type: 'text', max: 100 },
        { name: 'date', type: 'text', max: 50 },
        { name: 'duration', type: 'number' },
        { name: 'attendees', type: 'text', max: 500 },
        { name: 'is_starred', type: 'bool' },
        { name: 'audio', type: 'file', maxSelect: 1, maxSize: 104857600 },
        { name: 'audio_format', type: 'text', max: 50 },
        { name: 'audio_url', type: 'text', max: 10000 },
        { name: 'overview', type: 'text', max: 50000 },
        { name: 'summary', type: 'text', max: 50000 },
        { name: 'meeting_notes', type: 'text', max: 50000 },
        { name: 'key_highlights', type: 'text', max: 50000 },
        { name: 'transcript', type: 'text', max: 100000 },
        { name: 'action_items', type: 'json' },
        { name: 'share_token', type: 'text', max: 100 },
        { name: 'is_shared', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(sessions);
  },
  (app) => {
    const sessions = app.findCollectionByNameOrId('sessions');
    if (sessions) {
      app.delete(sessions);
    }
  },
);
