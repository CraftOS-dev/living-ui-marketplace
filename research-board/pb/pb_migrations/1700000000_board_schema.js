/// <reference path="../pb_data/types.d.ts" />
/**
 * Research Board schema (one person, auth mode none: open rules, loopback only).
 *
 *   settings  one row: the workspace name and whether links get a preview.
 *   boards    a canvas: name, description, color, the last view (viewport)
 *             and the state of a review asked of the AI agent.
 *   cards     everything placed on a board: notes, links, images, videos,
 *             YouTube videos, documents, quotes and sections (frames that
 *             group cards). Position and size are world coordinates.
 *             A deleted card is kept `trashed` for a day so it can be
 *             brought back (Undo); an hourly job removes it for good.
 *   links     an arrow between two cards on the same board, with a kind
 *             (relates, supports, contradicts, leads to) and an optional
 *             label. What the AI agent proposes waits as `proposed`.
 *
 * Deleting a board deletes its cards and links; deleting a card deletes its
 * links (cascading relations), so nothing dangles.
 */
migrate(
  (app) => {
    const settings = new Collection({
      type: 'base',
      name: 'settings',
      listRule: '',
      viewRule: '',
      createRule: null,
      updateRule: '',
      deleteRule: null,
      fields: [
        { name: 'title', type: 'text', max: 120 },
        { name: 'link_previews', type: 'bool' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(settings);

    const boards = new Collection({
      type: 'base',
      name: 'boards',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'name', type: 'text', required: true, max: 120 },
        { name: 'description', type: 'text', max: 2000 },
        { name: 'color', type: 'text', max: 20 },
        { name: 'viewport', type: 'json', maxSize: 2000 },
        { name: 'sort', type: 'number' },
        { name: 'review_state', type: 'select', maxSelect: 1, values: ['waiting', 'working', 'done', 'failed'] },
        { name: 'review_request', type: 'text', max: 40 },
        { name: 'review_note', type: 'text', max: 4000 },
        { name: 'review_focus', type: 'text', max: 1000 },
        { name: 'review_at', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
    });
    app.save(boards);

    const cards = new Collection({
      type: 'base',
      name: 'cards',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        {
          name: 'kind',
          type: 'select',
          required: true,
          maxSelect: 1,
          values: ['note', 'link', 'image', 'video', 'youtube', 'doc', 'quote', 'section'],
        },
        { name: 'title', type: 'text', max: 500 },
        { name: 'body', type: 'text', max: 100000 },
        { name: 'url', type: 'text', max: 5000 },
        { name: 'file', type: 'file', maxSelect: 1, maxSize: 200 * 1024 * 1024 },
        { name: 'source', type: 'text', max: 500 },
        { name: 'thumb', type: 'text', max: 5000 },
        { name: 'meta', type: 'json', maxSize: 20000 },
        { name: 'tags', type: 'json', maxSize: 4000 },
        { name: 'color', type: 'text', max: 20 },
        { name: 'x', type: 'number' },
        { name: 'y', type: 'number' },
        { name: 'w', type: 'number' },
        { name: 'h', type: 'number' },
        { name: 'z', type: 'number' },
        { name: 'starred', type: 'bool' },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['app', 'agent'] },
        { name: 'digest', type: 'text', max: 20000 },
        { name: 'digest_state', type: 'select', maxSelect: 1, values: ['waiting', 'reading', 'done', 'failed'] },
        { name: 'digest_error', type: 'text', max: 1000 },
        { name: 'digest_at', type: 'date' },
        { name: 'trashed', type: 'date' },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_cards_board ON cards (board)', 'CREATE INDEX idx_cards_kind ON cards (kind)', 'CREATE INDEX idx_cards_created ON cards (created)'],
    });
    app.save(cards);

    const links = new Collection({
      type: 'base',
      name: 'links',
      listRule: '',
      viewRule: '',
      createRule: '',
      updateRule: '',
      deleteRule: '',
      fields: [
        { name: 'board', type: 'relation', required: true, collectionId: boards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'source', type: 'relation', required: true, collectionId: cards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'target', type: 'relation', required: true, collectionId: cards.id, cascadeDelete: true, maxSelect: 1 },
        { name: 'kind', type: 'select', required: true, maxSelect: 1, values: ['relates', 'supports', 'contradicts', 'leads'] },
        { name: 'label', type: 'text', max: 200 },
        { name: 'status', type: 'select', required: true, maxSelect: 1, values: ['confirmed', 'proposed'] },
        { name: 'added_by', type: 'select', maxSelect: 1, values: ['app', 'agent'] },
        { name: 'reason', type: 'text', max: 1000 },
        { name: 'created', type: 'autodate', onCreate: true },
        { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
      ],
      indexes: ['CREATE INDEX idx_links_board ON links (board)', 'CREATE UNIQUE INDEX idx_links_pair ON links (source, target)'],
    });
    app.save(links);

    // The title stays empty here: lib_settings fills it on first read from
    // pb_hooks/setup.json (the name chosen at install, JSON-escaped there).
    const row = new Record(settings);
    row.set('title', '');
    row.set('link_previews', true);
    app.save(row);
  },
  (app) => {
    for (const name of ['links', 'cards', 'boards', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
