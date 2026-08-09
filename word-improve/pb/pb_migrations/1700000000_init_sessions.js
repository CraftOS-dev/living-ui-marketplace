/// <reference path="../pb_data/types.d.ts" />
/**
 * Word Improve schema.
 *
 * V1 stored a session plus its LLM whole-text variants (session_variants) and
 * git-style merge rows (merge_segments) across three related SQL tables, and
 * did all the sentence-splitting / alignment / word-diff on the Python backend.
 *
 * V2 keeps ONE `sessions` record per improvement run; the variants and the
 * aligned merge segments ride along as JSON columns (`variants`, `segments`).
 * The fetch adapter (src/app/services/apiAdapter.ts) reproduces every backend
 * computation CLIENT-SIDE (text_utils + _build_segments + word_diff ported to
 * TS). The only server-side piece is the LLM call, which must go through the
 * CraftBot bridge (see pb_hooks/ops.pb.js: ai.generate).
 *
 * Fields mirror Session.to_detail():
 *   title / original_text / mode / tone / custom_instruction / variant_count /
 *   compiled_text / status, plus the `variants` and `segments` JSON blobs.
 * created/updated autodate back to_summary()'s createdAt/updatedAt.
 *
 * Auth mode "none": open rules are acceptable because the app binds loopback
 * and the origin guard (_system.pb.js) refuses foreign-origin writes.
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
        { name: 'title', type: 'text', max: 500 },
        { name: 'original_text', type: 'text', max: 2000000 },
        { name: 'mode', type: 'text', max: 32 },
        { name: 'tone', type: 'text', max: 32 },
        { name: 'custom_instruction', type: 'text', max: 100000 },
        { name: 'variant_count', type: 'number' },
        { name: 'compiled_text', type: 'text', max: 2000000 },
        { name: 'status', type: 'text', max: 32 },
        { name: 'variants', type: 'json', maxSize: 5000000 },
        { name: 'segments', type: 'json', maxSize: 5000000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(sessions);
  },
  (app) => {
    app.delete(app.findCollectionByNameOrId('sessions'));
  },
);
