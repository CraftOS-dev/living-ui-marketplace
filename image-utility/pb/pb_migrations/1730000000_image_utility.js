/// <reference path="../pb_data/types.d.ts" />
/**
 * Image Utility schema (one person and their AI agent, auth mode none,
 * loopback only).
 *
 * An image's original is never changed. What you see and export is the
 * original run through its edit stack (`edits`, in `seq` order) by the
 * image engine. Every change to a stack is journaled (`changes`) so it can
 * be undone, redone or reverted; the AI agent's edits can wait as
 * `proposals` for the person to accept.
 *
 *   settings   one row: export defaults, the AI agent's policy
 *   images     originals and what the engine knows about them
 *   edits      the edit stack of each image (kind + params)
 *   changes    the journal of stack changes
 *   proposals  edits or batches the AI agent proposed
 *   exports    files written from images or batches
 *   presets    export settings, output sizes and edit recipes (built-in and yours)
 *   batches    a recipe and outputs run over many images
 *   assets     logos for logo layers
 *   requests   what the person asked the AI agent to do
 *
 * Every collection can be read by the UI (live updates) and is written only
 * through the operations (hooks.pb.js refuses direct writes).
 */
migrate(
  (app) => {
    const read = { listRule: '', viewRule: '', createRule: null, updateRule: null, deleteRule: null };
    const stamp = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const save = (def) => {
      const c = new Collection(Object.assign({ type: 'base' }, read, def, { fields: def.fields.concat(stamp) }));
      app.save(c);
      return c;
    };
    const text = (name, max) => ({ name: name, type: 'text', max: max || 500 });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 200000 });
    const num = (name) => ({ name: name, type: 'number' });
    const bool = (name) => ({ name: name, type: 'bool' });
    const sel = (name, values) => ({ name: name, type: 'select', maxSelect: 1, values: values });
    const file = (name, maxMb) => ({ name: name, type: 'file', maxSelect: 1, maxSize: (maxMb || 300) * 1024 * 1024 });
    const rel = (name, coll, cascade) => ({ name: name, type: 'relation', collectionId: coll.id, maxSelect: 1, cascadeDelete: !!cascade });

    save({
      name: 'settings',
      fields: [json('defaults', 20000), json('policy', 20000), text('export_folder', 1000), text('last_prune_at', 40)],
    });

    const images = save({
      name: 'images',
      fields: [
        { name: 'name', type: 'text', required: true, max: 300 },
        file('original', 500),
        text('format', 20),
        num('width'),
        num('height'),
        num('bytes'),
        num('frames'),
        num('duration_ms'),
        bool('alpha'),
        text('mode', 20),
        text('icc', 200),
        bool('wide_gamut'),
        json('exif', 20000),
        json('gps', 2000),
        json('transform', 1000),
        json('dpi', 200),
        text('hash', 64),
        num('out_width'),
        num('out_height'),
        num('edits_count'),
        text('stack_hash', 64),
        text('preview', 120),
        file('thumb', 5),
        sel('status', ['ready', 'failed', 'pending']),
        text('error', 2000),
        sel('origin', ['you', 'agent']),
        text('source_path', 1000),
        bool('pinned'),
        text('title', 300),
        text('alt_text', 2000),
        text('caption', 4000),
        json('keywords', 20000),
        text('notes', 4000),
        text('last_exported', 40),
        num('exports_count'),
      ],
      indexes: ['CREATE INDEX idx_images_hash ON images (hash)'],
    });

    const proposals = save({
      name: 'proposals',
      fields: [
        rel('image', images, true),
        sel('kind', ['edits', 'batch']),
        text('title', 300),
        text('reason', 4000),
        sel('status', ['pending', 'accepted', 'rejected', 'superseded']),
        file('preview', 20),
        json('summary', 50000),
        text('batch', 20),
        text('decided_at', 40),
        text('response', 2000),
        sel('author', ['agent', 'you']),
      ],
    });

    save({
      name: 'edits',
      fields: [
        rel('image', images, true),
        num('seq'),
        sel('kind', ['crop', 'resize', 'canvas', 'adjust', 'filter', 'remove_bg', 'layer']),
        json('params', 2000000),
        bool('enabled'),
        sel('author', ['you', 'agent']),
        sel('state', ['active', 'proposed']),
        rel('proposal', proposals, true),
        text('note', 2000),
        file('mask', 50),
        text('mask_key', 64),
        json('mask_info', 2000),
      ],
      indexes: ['CREATE INDEX idx_edits_image ON edits (image, seq)'],
    });

    save({
      name: 'changes',
      fields: [
        rel('image', images, true),
        text('batch', 20),
        sel('actor', ['you', 'agent', 'system']),
        sel('action', ['add', 'update', 'move', 'remove', 'toggle', 'accept', 'reject']),
        text('edit', 20),
        json('before', 2000000),
        json('after', 2000000),
        num('ord'),
        text('note', 2000),
        text('reverted_by', 20),
        text('reverts', 20),
      ],
      indexes: ['CREATE INDEX idx_changes_image ON changes (image, batch, ord)'],
    });

    const batches = save({
      name: 'batches',
      fields: [
        text('name', 200),
        json('images', 200000),
        json('recipe', 2000000),
        json('outputs', 200000),
        text('rename', 300),
        sel('collision', ['rename', 'skip', 'overwrite']),
        text('folder', 1000),
        sel('status', ['draft', 'proposed', 'queued', 'running', 'done', 'failed', 'cancelled']),
        num('total'),
        num('done_count'),
        num('failed_count'),
        num('bytes_in'),
        num('bytes_out'),
        json('results', 2000000),
        file('zip', 2000),
        text('started', 40),
        text('finished', 40),
        sel('requested_by', ['you', 'agent']),
        text('error', 2000),
        bool('cancel'),
      ],
    });

    save({
      name: 'exports',
      fields: [
        rel('image', images, false),
        rel('batch', batches, true),
        file('file', 1000),
        text('name', 300),
        text('format', 20),
        num('width'),
        num('height'),
        num('bytes'),
        num('source_bytes'),
        json('settings', 20000),
        text('folder_path', 1000),
        sel('requested_by', ['you', 'agent']),
      ],
    });

    save({
      name: 'presets',
      fields: [{ name: 'name', type: 'text', required: true, max: 120 }, sel('kind', ['export', 'size', 'recipe']), text('description', 500), json('data', 2000000), bool('builtin'), num('sort')],
    });

    save({
      name: 'assets',
      fields: [{ name: 'name', type: 'text', required: true, max: 200 }, file('file', 20), sel('kind', ['logo']), num('width'), num('height'), num('bytes')],
    });

    save({
      name: 'requests',
      fields: [
        rel('image', images, true),
        json('images', 200000),
        sel('kind', ['edit', 'describe']),
        text('title', 300),
        text('body', 8000),
        json('region', 2000),
        sel('status', ['sent', 'working', 'done', 'failed']),
        text('result', 8000),
        text('request_id', 40),
      ],
    });

    /* -------------------------------------------------------- default rows */
    const s = new Record(app.findCollectionByNameOrId('settings'));
    s.set('defaults', { format: 'webp', quality: 'balanced', metadata: 'basic', strip_gps: true, matte: '#ffffff', effort: 'normal', resample: 'lanczos' });
    s.set('policy', { agent_edits: 'propose', agent_batches: 'propose', house_rules: '' });
    s.set('export_folder', '');
    app.save(s);

    const P = app.findCollectionByNameOrId('presets');
    let sort = 0;
    const preset = (name, kind, description, data) => {
      const r = new Record(P);
      r.set('name', name);
      r.set('kind', kind);
      r.set('description', description);
      r.set('data', data);
      r.set('builtin', true);
      r.set('sort', sort++);
      app.save(r);
    };
    // Output sizes (Buffer, May 2026): the resize covers the size, keeping the most interesting part.
    const SIZES = [
      ['Instagram square', 1080, 1080],
      ['Instagram portrait', 1080, 1350],
      ['Instagram grid 3:4', 1080, 1440],
      ['Story, Reel, TikTok', 1080, 1920],
      ['X post', 1600, 900],
      ['X header', 1500, 500],
      ['Open Graph link', 1200, 630],
      ['LinkedIn link', 1200, 627],
      ['LinkedIn banner', 1584, 396],
      ['YouTube thumbnail', 1280, 720],
      ['YouTube banner', 2560, 1440],
      ['Pinterest pin', 1000, 1500],
      ['Facebook cover', 851, 315],
    ];
    for (const z of SIZES) preset(z[0], 'size', z[1] + ' x ' + z[2], { width: z[1], height: z[2] });
    // Export settings.
    preset('Web: WebP', 'export', 'Small and sharp; every current browser', { outputs: [{ format: 'webp', quality: 'balanced' }], metadata: 'basic', strip_gps: true });
    preset('Web: AVIF + JPEG', 'export', 'The smallest file and a fallback', { outputs: [{ format: 'avif', quality: 'balanced' }, { format: 'jpeg', quality: 'balanced' }], metadata: 'basic', strip_gps: true });
    preset('Email: JPEG under 500 KB', 'export', 'Longest edge 2048, fits a mail limit', { outputs: [{ format: 'jpeg', mode: 'size', target_kb: 500, longest: 2048 }], metadata: 'basic', strip_gps: true });
    preset('Print: high-quality JPEG', 'export', 'Quality 92, all metadata', { outputs: [{ format: 'jpeg', quality: 92 }], metadata: 'keep', strip_gps: true });
    preset('Lossless PNG', 'export', 'Exact pixels, optimized', { outputs: [{ format: 'png' }], metadata: 'basic', strip_gps: true });
    preset('Retina 1x and 2x', 'export', 'Full size as @2x, half size as @1x (WebP)', { outputs: [{ format: 'webp', quality: 'balanced', suffix: '@2x' }, { format: 'webp', quality: 'balanced', scale: 0.5, suffix: '@1x' }], metadata: 'basic', strip_gps: true });
    preset('Favicon set', 'export', 'favicon.ico, apple-touch-icon 180, icons 192 and 512', {
      outputs: [
        { format: 'ico', name: 'favicon', ico_sizes: [16, 32, 48] },
        { format: 'png', name: 'apple-touch-icon', square: 180 },
        { format: 'png', name: 'icon-192', square: 192 },
        { format: 'png', name: 'icon-512', square: 512 },
      ],
      metadata: 'none',
    });
    // Edit recipes (apply to one image or a batch).
    preset('Screenshot polish', 'recipe', 'Padding, a gradient, rounded corners and a soft shadow', { edits: [{ kind: 'canvas', params: { padding: 72, fill: { from: '#ff4f18', to: '#7b2ff7', angle: 135 }, radius: 14, shadow: true } }] });
    preset('Web-ready photo', 'recipe', 'Auto light and colour, longest edge 2048', { edits: [{ kind: 'adjust', params: { auto: true } }, { kind: 'resize', params: { mode: 'longest', longest: 2048 } }] });
    preset('Square for social', 'recipe', 'Smart 1:1 crop at 1080 x 1080', { edits: [{ kind: 'resize', params: { mode: 'cover', width: 1080, height: 1080, smart: true } }] });
    preset('Proof watermark', 'recipe', 'A faint tiled "PROOF" across the image', {
      edits: [{ kind: 'layer', params: { type: 'text', anchor: 'frame', cx: 0.5, cy: 0.5, size: 0.07, rotation: -30, text: 'PROOF', font: 'sans-bold', color: '#ffffff', opacity: 0.2, tile: true, gap: 80 } }],
    });
  },
  (app) => {
    for (const name of ['requests', 'assets', 'presets', 'exports', 'batches', 'changes', 'edits', 'proposals', 'images', 'settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch {
        /* already gone */
      }
    }
  },
);
