/// <reference path="../pb_data/types.d.ts" />
/**
 * Research OS schema.
 *
 * Every collection is closed to the raw API (all rules null: superusers
 * only). People and the AI agent reach the data only through the app's
 * operations (pb_hooks/routes.pb.js -> lib_ops.js), which check the caller,
 * keep derived fields in step and write the activity trail. Screens learn
 * about changes from the custom realtime topic "ro", which carries
 * collection names only (lib_bus.js).
 *
 * The core object is the anchor: a position (page, start, end) in the app's
 * own stored text of a PDF page. Its quote is computed from the offsets.
 * Judged records (nodes, relations, cells, decisions) carry a typed status;
 * only a person sets researcher_confirmed.
 *
 * Full-text search: two FTS5 tables (works_fts, pages_fts) are kept in step
 * by the operations that write works and pages (lib_search.js).
 *
 * The blueprint's starter `items` collection is removed (its migration stays:
 * it is applied history).
 */
migrate(
  (app) => {
    app.delete(app.findCollectionByNameOrId('items'));

    // Nobody signs in to this app (local, one researcher); close PocketBase's users collection.
    const users = app.findCollectionByNameOrId('users');
    users.listRule = null;
    users.viewRule = null;
    users.createRule = null;
    users.updateRule = null;
    users.deleteRule = null;
    users.passwordAuth.enabled = false;
    app.save(users);

    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const ACTORS = ['person', 'agent', 'system'];
    const JUDGED = ['agent_proposed', 'researcher_confirmed', 'researcher_rejected', 'superseded'];
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];

    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const num = (name, extra) => Object.assign({ name: name, type: 'number' }, extra || {});
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const owned = (name, target) => rel(name, target, { cascadeDelete: true });
    const file = (name, max, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const addRelations = (collection, fields, indexes) => {
      const c = app.findCollectionByNameOrId(collection);
      for (const f of fields) {
        c.fields.add(new RelationField(f));
      }
      for (const ix of indexes || []) c.addIndex(ix.name, ix.unique === true, ix.columns, ix.where || '');
      app.save(c);
    };

    /* ------------------------------------------------------------ settings */

    make('settings', [
      json('highlight_slots', 4000),
      sel('citation_style', ['apa', 'chicago', 'harvard', 'ieee', 'vancouver', 'mla', 'nature'], true),
      txt('contact_email', 200, { pattern: '^([^@\\s]+@[^@\\s]+\\.[^@\\s]+)?$' }),
      json('agent_policy', 4000),
      json('jobs', 20000),
      bool('welcome_done'),
    ].concat(stamps));

    /* ------------------------------------------------------------- library */

    make(
      'import_batches',
      [
        sel('kind', ['bibtex', 'ris', 'csljson'], true),
        txt('filename', 300),
        sel('status', ['previewed', 'imported', 'undone'], true),
        sel('actor', ACTORS, true),
        json('counts', 4000),
        json('entries', 20000000),
        json('result', 4000000),
        txt('target_collection', 20),
        txt('target_project', 20),
      ].concat(stamps),
    );

    make(
      'works',
      [
        sel('type', ['article', 'preprint', 'conference', 'book', 'chapter', 'thesis', 'report', 'dataset', 'software', 'webpage', 'other'], true),
        req('title', 2000),
        txt('subtitle', 1000),
        json('authors', 200000),
        json('editors', 40000),
        int('year', { min: 0, max: 3000 }),
        txt('issued', 10, { pattern: '^(\\d{4}(-\\d{2}(-\\d{2})?)?)?$' }),
        txt('container', 1000),
        txt('container_short', 300),
        txt('volume', 60),
        txt('issue', 60),
        txt('pages', 80),
        txt('article_number', 60),
        txt('publisher', 500),
        txt('place', 300),
        txt('edition', 60),
        txt('isbn', 20),
        txt('issn', 60),
        txt('abstract', 40000),
        txt('doi', 300),
        txt('arxiv_id', 60),
        txt('pmid', 20),
        txt('pmcid', 20),
        txt('openalex_id', 30),
        txt('url', 2000),
        txt('language', 30),
        json('keywords', 8000),
        txt('citekey', 120),
        sel('resolution', ['pending', 'resolving', 'resolved', 'not_found', 'unreachable', 'manual'], true),
        sel('resolved_via', ['crossref', 'arxiv', 'openalex', 'pubmed', 'openlibrary', 'manual', 'import']),
        txt('resolve_error', 1000),
        int('resolve_attempts', { min: 0 }),
        txt('retry_at', 40),
        sel('identity', ['agent_proposed', 'researcher_confirmed'], true),
        sel('identify', ['none', 'waiting', 'working', 'failed'], true),
        txt('identify_note', 2000),
        sel('integrity', ['unchecked', 'clear', 'retracted', 'corrected', 'concern'], true),
        json('integrity_detail', 20000),
        txt('integrity_at', 40),
        sel('read_state', ['unread', 'reading', 'read'], true),
        txt('read_at', 40),
        txt('opened_at', 40),
        int('rating', { min: 0, max: 5 }),
        bool('starred'),
        sel('added_by', ACTORS, true),
        sel('source', ['identifier', 'pdf', 'search', 'import', 'feed', 'citation_map', 'references', 'manual'], true),
        rel('import_batch', 'import_batches'),
        int('cited_by', { min: 0 }),
        int('refs_count', { min: 0 }),
        txt('oa_url', 2000),
        txt('oa_pdf_url', 2000),
        txt('oa_status', 30),
        sel('oa_fetch', ['due', 'done', 'failed']),
        json('registry', 200000),
        json('edited', 4000),
        json('extra', 40000),
        bool('trashed'),
        txt('trashed_at', 40),
      ].concat(stamps),
      [
        "CREATE UNIQUE INDEX idx_works_doi ON works (doi) WHERE doi != ''",
        "CREATE UNIQUE INDEX idx_works_arxiv ON works (arxiv_id) WHERE arxiv_id != ''",
        "CREATE UNIQUE INDEX idx_works_pmid ON works (pmid) WHERE pmid != ''",
        "CREATE UNIQUE INDEX idx_works_citekey ON works (citekey COLLATE NOCASE) WHERE citekey != ''",
        'CREATE INDEX idx_works_trashed ON works (trashed, created)',
        'CREATE INDEX idx_works_resolution ON works (resolution)',
        'CREATE INDEX idx_works_read ON works (read_state)',
        'CREATE INDEX idx_works_year ON works (year)',
        'CREATE INDEX idx_works_openalex ON works (openalex_id)',
        'CREATE INDEX idx_works_isbn ON works (isbn)',
        'CREATE INDEX idx_works_opened ON works (opened_at)',
        "CREATE INDEX idx_works_oa_fetch ON works (oa_fetch) WHERE oa_fetch != ''",
      ],
    );

    make('collections', [req('name', 200), int('sort')].concat(stamps));
    addRelations('collections', [rel('parent', 'collections', { cascadeDelete: true })], [{ name: 'idx_collections_parent', columns: 'parent' }]);

    make('collection_items', [owned('collection', 'collections'), owned('work', 'works')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_ci ON collection_items (collection, work)',
      'CREATE INDEX idx_ci_work ON collection_items (work)',
    ]);

    make('tags', [req('name', 80), int('color_slot', { min: 0, max: 8 })].concat(stamps), ['CREATE UNIQUE INDEX idx_tags_name ON tags (name COLLATE NOCASE)']);

    make('work_tags', [owned('work', 'works'), owned('tag', 'tags')].concat(stamps), ['CREATE UNIQUE INDEX idx_wt ON work_tags (work, tag)', 'CREATE INDEX idx_wt_tag ON work_tags (tag)']);

    /* --------------------------------------------------------------- files */

    make(
      'files',
      [
        owned('work', 'works'),
        file('file', 1024 * 1024 * 1024, ['application/pdf']),
        txt('name', 400),
        txt('sha256', 64),
        int('bytes', { min: 0 }),
        int('pages', { min: 0 }),
        int('version', { min: 1 }),
        bool('current'),
        sel('text_state', ['waiting', 'extracting', 'ready', 'needs_ocr', 'failed'], true),
        txt('text_error', 2000),
        txt('engine', 60),
        int('pages_with_text', { min: 0 }),
        int('ocr_pages', { min: 0 }),
        json('outline', 400000),
        json('meta', 20000),
        { name: 'thumb', type: 'file', maxSelect: 1, maxSize: 4000000, mimeTypes: ['image/png', 'image/jpeg', 'image/webp'], thumbs: [], protected: true },
        sel('source', ['upload', 'agent_path', 'oa_download', 'import'], true),
        sel('added_by', ACTORS, true),
        int('pos_page', { min: 0 }),
        num('pos_frac', { min: 0, max: 1 }),
        int('max_page', { min: 0 }),
      ].concat(stamps),
      ['CREATE INDEX idx_files_work ON files (work, current)', 'CREATE INDEX idx_files_sha ON files (sha256)', 'CREATE INDEX idx_files_state ON files (text_state)'],
    );

    make(
      'pages',
      [
        owned('file', 'files'),
        int('page_no', { min: 1 }),
        num('width'),
        num('height'),
        int('rotate'),
        txt('text', 2000000),
        json('items', 8000000),
        json('lines', 400000),
        sel('origin', ['pdf_text', 'agent_ocr', 'none'], true),
        int('chars', { min: 0 }),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_pages_file_no ON pages (file, page_no)'],
    );

    make(
      'anchors',
      [
        owned('file', 'files'),
        owned('work', 'works'),
        int('page_no', { min: 1 }),
        int('start', { min: 0 }),
        int('end', { min: 0 }),
        txt('quote', 40000),
        json('rects', 200000),
        sel('kind', ['text', 'area'], true),
        json('area', 400),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE INDEX idx_anchors_file ON anchors (file, page_no, start)', 'CREATE INDEX idx_anchors_work ON anchors (work)'],
    );

    make(
      'annotations',
      [
        owned('anchor', 'anchors'),
        owned('work', 'works'),
        owned('file', 'files'),
        sel('kind', ['highlight', 'underline', 'note', 'area'], true),
        int('color_slot', { min: 1, max: 8 }),
        txt('meaning', 80),
        txt('comment', 20000),
        sel('actor', ACTORS, true),
        int('page_no', { min: 1 }),
        int('start', { min: 0 }),
      ].concat(stamps),
      ['CREATE INDEX idx_ann_file ON annotations (file, page_no, start)', 'CREATE INDEX idx_ann_work ON annotations (work)', 'CREATE INDEX idx_ann_anchor ON annotations (anchor)'],
    );

    /* ------------------------------------------------------------ projects */

    make(
      'projects',
      [
        req('name', 200),
        txt('question', 4000),
        txt('description', 8000),
        sel('color', ['ink', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'teal'], true),
        sel('confidentiality', ['normal', 'confidential'], true),
        sel('state', ['active', 'archived'], true),
        bool('pinned'),
        int('sort'),
        txt('opened_at', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_projects_state ON projects (state)'],
    );

    make(
      'project_works',
      [
        owned('project', 'projects'),
        owned('work', 'works'),
        sel('role', ['core', 'background'], true),
        sel('status', ['to_read', 'reading', 'read', 'excluded'], true),
        sel('added_by', ACTORS, true),
        txt('note', 4000),
        int('sort'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_pw ON project_works (project, work)', 'CREATE INDEX idx_pw_work ON project_works (work)'],
    );

    make(
      'notes',
      [
        txt('title', 400),
        sel('kind', ['literature', 'project', 'free'], true),
        rel('work', 'works'),
        rel('project', 'projects', { cascadeDelete: true }),
        json('blocks', 4000000),
        txt('text', 400000),
        bool('pinned'),
        sel('actor', ACTORS, true),
        sel('status', ['agent_proposed', 'researcher_confirmed'], true),
      ].concat(stamps),
      ['CREATE INDEX idx_notes_work ON notes (work)', 'CREATE INDEX idx_notes_project ON notes (project)', 'CREATE INDEX idx_notes_updated ON notes (updated)'],
    );

    make(
      'nodes',
      [
        owned('project', 'projects'),
        sel('kind', ['question', 'claim', 'evidence'], true),
        req('title', 2000),
        txt('body', 20000),
        sel('status', JUDGED, true),
        sel('claim_basis', ['data_result', 'literature_finding', 'interpretation', 'hypothesis']),
        sel('confidence', ['low', 'medium', 'high']),
        sel('actor', ACTORS, true),
        txt('why', 4000),
        rel('work', 'works'),
        int('sort'),
        num('x'),
        num('y'),
        bool('placed'),
        txt('decided_at', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_nodes_project ON nodes (project, kind, status)', 'CREATE INDEX idx_nodes_work ON nodes (work)', 'CREATE INDEX idx_nodes_status ON nodes (status, actor)'],
    );

    make('node_anchors', [owned('node', 'nodes'), owned('anchor', 'anchors'), int('sort')].concat(stamps), [
      'CREATE UNIQUE INDEX idx_na ON node_anchors (node, anchor)',
      'CREATE INDEX idx_na_anchor ON node_anchors (anchor)',
    ]);

    make(
      'relations',
      [
        owned('project', 'projects'),
        owned('from_node', 'nodes'),
        owned('to_node', 'nodes'),
        sel('kind', ['supports', 'opposes', 'informs'], true),
        sel('status', JUDGED, true),
        txt('reason', 4000),
        sel('actor', ACTORS, true),
        txt('decided_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_rel ON relations (from_node, to_node, kind)', 'CREATE INDEX idx_rel_to ON relations (to_node)', 'CREATE INDEX idx_rel_project ON relations (project, status)'],
    );

    make('boards', [owned('project', 'projects'), req('name', 200), int('sort'), json('viewport', 400)].concat(stamps), ['CREATE INDEX idx_boards_project ON boards (project)']);

    make(
      'board_items',
      [
        owned('board', 'boards'),
        sel('ref_kind', ['node', 'anchor', 'work', 'note', 'text', 'section'], true),
        owned('node', 'nodes'),
        owned('anchor', 'anchors'),
        owned('work', 'works'),
        owned('note', 'notes'),
        txt('text', 8000),
        sel('color', ['plain', 'accent', 'blue', 'green', 'amber', 'red', 'violet', 'teal']),
        num('x'),
        num('y'),
        num('w'),
        num('h'),
        int('z'),
      ].concat(stamps),
      ['CREATE INDEX idx_bi_board ON board_items (board)'],
    );

    /* ------------------------------------------------- your AI agent, trail */

    make(
      'asks',
      [
        sel('scope', ['work', 'collection', 'project', 'library'], true),
        owned('work', 'works'),
        owned('collection', 'collections'),
        owned('project', 'projects'),
        req('question', 8000),
        sel('status', ['waiting', 'working', 'answered', 'failed'], true),
        json('answer', 400000),
        txt('answer_text', 100000),
        txt('failure', 4000),
        txt('request', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_asks_status ON asks (status)', 'CREATE INDEX idx_asks_work ON asks (work)'],
    );

    make(
      'proposals',
      [
        txt('op', 80),
        json('params', 400000),
        txt('kind', 60),
        txt('title', 400),
        txt('summary', 4000),
        json('preview', 2000000),
        txt('why', 8000),
        txt('target_collection', 60),
        txt('target_id', 40),
        txt('target_updated', 40),
        rel('project', 'projects', { cascadeDelete: true }),
        sel('status', ['waiting', 'approved', 'rejected', 'returned', 'withdrawn', 'stale'], true),
        txt('decision_note', 4000),
        txt('decided_at', 40),
        json('result', 200000),
      ].concat(stamps),
      ['CREATE INDEX idx_prop_status ON proposals (status)', 'CREATE INDEX idx_prop_target ON proposals (target_collection, target_id)'],
    );

    make(
      'field_marks',
      [req('target', 60), req('record', 40), req('field', 60), sel('confidence', ['high', 'check'], true), txt('reason', 2000), sel('actor', ACTORS, true)].concat(stamps),
      ['CREATE UNIQUE INDEX idx_marks ON field_marks (target, record, field)'],
    );

    make(
      'activity',
      [
        sel('actor', ACTORS, true),
        txt('op', 80),
        txt('label', 600),
        txt('target', 60),
        txt('record', 40),
        txt('batch', 40),
        json('data', 2000000),
        bool('undoable'),
        bool('undone'),
        txt('project', 20),
      ].concat(stamps),
      ['CREATE INDEX idx_act_created ON activity (created)', 'CREATE INDEX idx_act_batch ON activity (batch)', 'CREATE INDEX idx_act_target ON activity (target, record)', 'CREATE INDEX idx_act_project ON activity (project, created)'],
    );

    make('saved_views', [req('name', 200), sel('page', ['library'], true), json('filter', 20000), int('sort')].concat(stamps));

    /* ------------------------------------------------------------ discover */

    make(
      'searches',
      [
        txt('name', 300),
        req('query', 2000),
        json('sources', 400),
        json('filters', 4000),
        sel('alert', ['off', 'daily', 'weekly'], true),
        rel('project', 'projects', { cascadeDelete: true }),
        txt('last_run_at', 40),
        int('new_count', { min: 0 }),
        bool('saved'),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE INDEX idx_search_alert ON searches (alert, last_run_at)'],
    );

    make(
      'search_runs',
      [
        owned('search', 'searches'),
        json('queries', 200000),
        int('evaluated', { min: 0 }),
        int('found', { min: 0 }),
        int('new', { min: 0 }),
        sel('stop_reason', ['running', 'complete', 'limit', 'unreachable', 'error', 'agent_finished'], true),
        sel('actor', ACTORS, true),
        txt('finished_at', 40),
        txt('error', 4000),
      ].concat(stamps),
      ['CREATE INDEX idx_runs_search ON search_runs (search, created)'],
    );

    make(
      'candidates',
      [
        owned('search', 'searches'),
        owned('run', 'search_runs'),
        sel('source', ['crossref', 'arxiv', 'openalex', 'pubmed', 'agent'], true),
        req('key', 300),
        txt('doi', 300),
        txt('arxiv_id', 60),
        txt('openalex_id', 30),
        txt('pmid', 20),
        req('title', 2000),
        json('authors', 40000),
        int('year', { min: 0, max: 3000 }),
        txt('venue', 1000),
        txt('abstract', 40000),
        int('cited_by', { min: 0 }),
        txt('oa_url', 2000),
        txt('type', 40),
        sel('relevance', ['high', 'medium', 'low']),
        txt('reason', 4000),
        sel('triage', ['new', 'relevant', 'not_relevant', 'added', 'dismissed'], true),
        rel('work', 'works'),
        int('rank', { min: 0 }),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_cand ON candidates (search, key)', 'CREATE INDEX idx_cand_triage ON candidates (triage, created)'],
    );

    make(
      'oa_cache',
      [
        req('openalex_id', 30),
        txt('doi', 300),
        txt('title', 2000),
        int('year', { min: 0, max: 3000 }),
        txt('authors', 1000),
        txt('venue', 1000),
        int('cited_by', { min: 0 }),
        json('refs', 400000),
        txt('type', 40),
        txt('oa_url', 2000),
        txt('fetched_at', 40),
        bool('refs_known'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_oa ON oa_cache (openalex_id)', "CREATE INDEX idx_oa_doi ON oa_cache (doi) WHERE doi != ''"],
    );

    make(
      'work_refs',
      [
        owned('work', 'works'),
        int('position', { min: 0 }),
        txt('raw', 4000),
        txt('doi', 300),
        txt('title', 2000),
        int('year', { min: 0, max: 3000 }),
        txt('authors', 1000),
        txt('venue', 1000),
        txt('openalex_id', 30),
        rel('resolved_work', 'works'),
        sel('source', ['crossref', 'openalex'], true),
      ].concat(stamps),
      ['CREATE INDEX idx_refs_work ON work_refs (work, position)', "CREATE INDEX idx_refs_doi ON work_refs (doi) WHERE doi != ''"],
    );

    /* -------------------------------------------------------------- tables */

    make('grids', [owned('project', 'projects'), req('name', 200), txt('description', 2000), int('sort')].concat(stamps), ['CREATE INDEX idx_grids_project ON grids (project)']);

    make(
      'grid_columns',
      [
        owned('grid', 'grids'),
        req('name', 200),
        txt('question', 4000),
        sel('value_type', ['text', 'number', 'boolean', 'category'], true),
        json('options', 4000),
        int('sort'),
        sel('fill', ['idle', 'requested'], true),
      ].concat(stamps),
      ['CREATE INDEX idx_gcol_grid ON grid_columns (grid, sort)'],
    );

    make('grid_rows', [owned('grid', 'grids'), owned('work', 'works'), int('sort')].concat(stamps), ['CREATE UNIQUE INDEX idx_grow ON grid_rows (grid, work)']);

    make(
      'grid_cells',
      [
        owned('grid', 'grids'),
        owned('row', 'grid_rows'),
        owned('column', 'grid_columns'),
        txt('value_text', 8000),
        num('value_num'),
        bool('value_bool'),
        txt('value_cat', 200),
        bool('has_value'),
        { name: 'anchors', type: 'relation', maxSelect: 20, collectionId: id('anchors'), cascadeDelete: false },
        sel('status', JUDGED, true),
        txt('note', 4000),
        txt('why', 4000),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_cell ON grid_cells (row, column)', 'CREATE INDEX idx_cell_grid ON grid_cells (grid, status)'],
    );

    /* ------------------------------------------------------------- writing */

    make(
      'manuscripts',
      [
        owned('project', 'projects'),
        req('title', 400),
        sel('style', ['apa', 'chicago', 'harvard', 'ieee', 'vancouver', 'mla', 'nature'], true),
        sel('template', ['generic', 'elsevier', 'nature', 'science', 'acl', 'iclr', 'neurips', 'ieee'], true),
        sel('status', ['draft', 'ready'], true),
        int('sort'),
        int('words', { min: 0 }),
        txt('ready_at', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_ms_project ON manuscripts (project)'],
    );

    make(
      'ms_blocks',
      [
        owned('manuscript', 'manuscripts'),
        num('sort'),
        sel('type', ['h1', 'h2', 'h3', 'paragraph', 'quote', 'bullet', 'numbered', 'equation'], true),
        json('content', 400000),
        txt('text', 200000),
        sel('origin', ['typed', 'pasted', 'agent_generated', 'agent_edited', 'mixed'], true),
        int('typed_chars', { min: 0 }),
        int('pasted_chars', { min: 0 }),
        int('agent_chars', { min: 0 }),
      ].concat(stamps),
      ['CREATE INDEX idx_msb ON ms_blocks (manuscript, sort)'],
    );

    make(
      'ms_changes',
      [
        owned('manuscript', 'manuscripts'),
        owned('block', 'ms_blocks'),
        rel('after_block', 'ms_blocks'),
        sel('kind', ['insert', 'replace', 'delete'], true),
        json('before', 400000),
        json('after', 400000),
        sel('status', ['proposed', 'kept', 'undone', 'stale'], true),
        sel('actor', ACTORS, true),
        txt('why', 4000),
        txt('base_updated', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_msc ON ms_changes (manuscript, status)'],
    );

    make('ms_snapshots', [owned('manuscript', 'manuscripts'), txt('label', 300), json('content', 20000000), sel('actor', ACTORS, true), int('words', { min: 0 })].concat(stamps), [
      'CREATE INDEX idx_mss ON ms_snapshots (manuscript, created)',
    ]);

    make('reviews_received', [owned('manuscript', 'manuscripts'), req('label', 200), txt('body', 200000), txt('received_on', 10)].concat(stamps), ['CREATE INDEX idx_rr ON reviews_received (manuscript)']);

    make(
      'response_items',
      [
        owned('manuscript', 'manuscripts'),
        owned('review', 'reviews_received'),
        int('sort'),
        req('comment', 20000),
        sel('kind', ['major', 'minor', 'typo', 'misunderstanding', 'praise'], true),
        sel('strategy', ['accept', 'defend', 'clarify', 'experiment']),
        sel('status', ['open', 'addressed', 'declined', 'unresolved'], true),
        txt('response', 20000),
        rel('change_block', 'ms_blocks'),
        txt('change_note', 2000),
        sel('actor', ACTORS, true),
        bool('confirmed'),
      ].concat(stamps),
      ['CREATE INDEX idx_ri ON response_items (review, sort)'],
    );

    /* ----------------------------------------------------------- screening */

    make(
      'reviews',
      [
        owned('project', 'projects'),
        req('title', 400),
        txt('question', 4000),
        json('criteria', 40000),
        json('reasons', 8000),
        bool('dual'),
        bool('blind'),
        bool('agent_seat'),
        sel('stage', ['setup', 'title_abstract', 'full_text', 'done'], true),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_reviews_project ON reviews (project)'],
    );

    make(
      'import_logs',
      [owned('review', 'reviews'), req('source_db', 80), txt('query', 8000), txt('searched_on', 10), int('count', { min: 0 }), int('added', { min: 0 }), sel('actor', ACTORS, true)].concat(stamps),
      ['CREATE INDEX idx_il ON import_logs (review)'],
    );

    make(
      'review_records',
      [
        owned('review', 'reviews'),
        rel('work', 'works'),
        rel('import_log', 'import_logs'),
        req('title', 2000),
        json('authors', 40000),
        int('year', { min: 0, max: 3000 }),
        txt('venue', 1000),
        txt('abstract', 40000),
        txt('doi', 300),
        txt('pmid', 20),
        txt('source_db', 80),
        sel('ta', ['pending', 'include', 'exclude', 'maybe', 'conflict'], true),
        sel('ft', ['none', 'pending', 'include', 'exclude', 'conflict'], true),
        txt('ta_reason', 60),
        txt('ft_reason', 60),
        int('sort'),
      ].concat(stamps),
      ['CREATE INDEX idx_rec ON review_records (review, ta, ft)', "CREATE INDEX idx_rec_doi ON review_records (review, doi) WHERE doi != ''"],
    );
    addRelations('review_records', [rel('dup_of', 'review_records')], [{ name: 'idx_rec_dup', columns: 'dup_of' }]);

    make(
      'decisions',
      [
        owned('review', 'reviews'),
        owned('record', 'review_records'),
        sel('stage', ['title_abstract', 'full_text'], true),
        sel('seat', ['person', 'agent', 'final'], true),
        sel('value', ['include', 'exclude', 'maybe'], true),
        txt('reason', 60),
        int('basis_start', { min: 0 }),
        int('basis_end', { min: 0 }),
        txt('basis_quote', 8000),
        txt('rationale', 8000),
        sel('confidence', ['low', 'medium', 'high', 'very_high']),
        sel('actor', ACTORS, true),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_dec ON decisions (record, stage, seat)', 'CREATE INDEX idx_dec_review ON decisions (review, stage)'],
    );

    /* ----------------------------------------------------- full-text search */

    const db = app.db();
    db.newQuery("CREATE VIRTUAL TABLE works_fts USING fts5(work_id UNINDEXED, title, authors, abstract, venue, keywords, tokenize='unicode61 remove_diacritics 2')").execute();
    db.newQuery("CREATE VIRTUAL TABLE pages_fts USING fts5(page_id UNINDEXED, file_id UNINDEXED, work_id UNINDEXED, page_no UNINDEXED, body, tokenize='unicode61 remove_diacritics 2')").execute();
    db.newQuery("CREATE VIRTUAL TABLE notes_fts USING fts5(note_id UNINDEXED, title, body, tokenize='unicode61 remove_diacritics 2')").execute();
  },
  (app) => {
    const db = app.db();
    for (const t of ['works_fts', 'pages_fts', 'notes_fts']) db.newQuery('DROP TABLE IF EXISTS ' + t).execute();
    const names = [
      'decisions', 'review_records', 'import_logs', 'reviews', 'response_items', 'reviews_received', 'ms_snapshots', 'ms_changes', 'ms_blocks', 'manuscripts',
      'grid_cells', 'grid_rows', 'grid_columns', 'grids', 'work_refs', 'oa_cache', 'candidates', 'search_runs', 'searches', 'saved_views', 'activity',
      'field_marks', 'proposals', 'asks', 'board_items', 'boards', 'relations', 'node_anchors', 'nodes', 'notes', 'project_works', 'projects',
      'annotations', 'anchors', 'pages', 'files', 'work_tags', 'tags', 'collection_items', 'collections', 'works', 'import_batches', 'settings',
    ];
    for (const n of names) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
