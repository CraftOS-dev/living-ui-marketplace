/// <reference path="../pb_data/types.d.ts" />
/**
 * Agent operations for the Newsletter Tool (routes: agent_ops.pb.js).
 *
 * The app's screens keep their logic in the browser:
 * frontend/src/app/services/apiAdapter.ts maps every screen action onto plain
 * PocketBase record writes plus the /api/ops routes in ops.pb.js. Each write
 * below is a line-for-line port of one adapter handler, so an agent's write
 * stores exactly what the same action in the UI stores:
 *   - the JSON "sidecar" in the `body` text column ({"__meta":true,...}),
 *     built key for key in the adapter's order;
 *   - `blocks`, the `subject` column, `status`, `scheduled_at`, the counters.
 * The "ported from" comment on each function names its source. Keep them in
 * step with apiAdapter.ts.
 *
 * PocketBase notes: JSON fields are read with getString() + JSON.parse (get()
 * returns raw bytes); query results are Go slices, so they are copied with
 * Array.from() before any sort.
 */

/* ============================================================== basics */

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

/**
 * Run fn(params, app) for a route and answer JSON in this app's shape:
 * 200 with the result, or {error} with the failure's status.
 */
function run(e, fn) {
  try {
    const info = e.requestInfo();
    const params = {};
    const query = info.query || {};
    for (const k of Object.keys(query)) params[k] = query[k];
    const body = info.body || {};
    for (const k of Object.keys(body)) params[k] = body[k];
    return e.json(200, fn(params, e.app));
  } catch (err) {
    const status = err && typeof err.status === 'number' ? err.status : 500;
    if (status >= 500) console.log('[newsletter agent op] failed:', String(err));
    return e.json(status, { error: String((err && err.message) || err) });
  }
}

// ---- ported from apiAdapter.ts: str, num, coerceBool, toIso, esc ----

function str(v) {
  return v == null ? '' : String(v);
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback === undefined ? 0 : fallback;
}

function coerceBool(v, fallback) {
  if (typeof v === 'boolean') return v;
  if (v == null) return fallback;
  const s = String(v).toLowerCase();
  return s === 'true' || s === '1';
}

function toIso(v) {
  if (v == null || v === '') return null;
  try {
    const d = new Date(String(v).replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  } catch (_e) {
    return null;
  }
}

/* ============================================================ params */

function has(p, key) {
  return p[key] !== undefined && p[key] !== null && p[key] !== '';
}

function requireId(p, key) {
  const v = str(p[key]).trim();
  if (v === '') throw fail(400, key + ' is required');
  return v;
}

function intParam(p, key, dflt, min, max) {
  if (p[key] === undefined || p[key] === null || p[key] === '') return dflt;
  const n = Number(p[key]);
  if (!Number.isInteger(n) || n < min || n > max) throw fail(400, `${key} must be a whole number from ${min} to ${max}`);
  return n;
}

function boolParam(p, key) {
  return coerceBool(p[key], false);
}

function jsonParam(p, key) {
  const v = p[key];
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch (_e) {
    throw fail(400, key + ' must be JSON');
  }
}

function enumParam(p, key, values, dflt) {
  if (p[key] === undefined || p[key] === null || p[key] === '') return dflt;
  const v = String(p[key]);
  if (values.indexOf(v) < 0) throw fail(400, `${key} must be one of: ${values.join(', ')}`);
  return v;
}

/* ===================================================== record access */

function jsonField(rec, field) {
  let s = '';
  try {
    s = rec.getString(field) || '';
  } catch (_e) {
    s = '';
  }
  if (!s) return null;
  try {
    return JSON.parse(s);
  } catch (_e) {
    return null;
  }
}

/** The record as the PocketBase REST API shows it to the adapter. */
function plain(name, rec) {
  if (name === 'subscribers') {
    return {
      id: rec.id,
      email: rec.getString('email'),
      name: rec.getString('name'),
      status: rec.getString('status'),
      tags: rec.getString('tags'),
      created: rec.getString('created'),
      updated: rec.getString('updated'),
    };
  }
  if (name === 'templates') {
    return {
      id: rec.id,
      name: rec.getString('name'),
      subject: rec.getString('subject'),
      body: rec.getString('body'),
      blocks: jsonField(rec, 'blocks'),
      created: rec.getString('created'),
      updated: rec.getString('updated'),
    };
  }
  if (name === 'campaigns') {
    return {
      id: rec.id,
      subject: rec.getString('subject'),
      body: rec.getString('body'),
      blocks: jsonField(rec, 'blocks'),
      status: rec.getString('status'),
      scheduled_at: rec.getString('scheduled_at'),
      sent_at: rec.getString('sent_at'),
      recipients_count: rec.getFloat('recipients_count'),
      deliver: rec.getBool('deliver'),
      delivered_count: rec.getFloat('delivered_count'),
      created: rec.getString('created'),
      updated: rec.getString('updated'),
    };
  }
  if (name === 'settings') {
    return {
      id: rec.id,
      sender_name: rec.getString('sender_name'),
      sender_email: rec.getString('sender_email'),
      reply_to: rec.getString('reply_to'),
      organization_name: rec.getString('organization_name'),
      organization_address: rec.getString('organization_address'),
      updated: rec.getString('updated'),
    };
  }
  throw fail(500, 'unknown collection ' + name);
}

function all(app, name, sort) {
  return Array.from(app.findRecordsByFilter(name, "id != ''", sort || '', 0, 0));
}

const NOT_FOUND = { campaigns: 'Campaign not found', templates: 'Template not found', subscribers: 'Subscriber not found' };

function byId(app, name, id) {
  try {
    return app.findRecordById(name, id);
  } catch (_e) {
    throw fail(404, NOT_FOUND[name] || 'Not found');
  }
}

/** Write fields onto a record and save it (the adapter's pbCreate / pbPatch). */
function write(app, rec, data) {
  for (const k of Object.keys(data)) rec.set(k, data[k]);
  try {
    app.save(rec);
  } catch (err) {
    throw fail(400, String((err && err.message) || err));
  }
  return rec;
}

function create(app, name, data) {
  return write(app, new Record(app.findCollectionByNameOrId(name)), data);
}

/* ======================================== ported adapter helpers & mappers */

// ported from apiAdapter.ts parseSidecar()
function parseSidecar(body) {
  const s = str(body).trim();
  if (!s.startsWith('{')) return null;
  try {
    const obj = JSON.parse(s);
    return obj && obj.__meta === true ? obj : null;
  } catch (_e) {
    return null;
  }
}

// ported from apiAdapter.ts blocksOf()
function blocksOf(rec) {
  const raw = rec.blocks;
  if (Array.isArray(raw)) return raw.filter((b) => !!b && typeof b === 'object');
  return [];
}

// ported from apiAdapter.ts effectiveBlocks()
function effectiveBlocks(rec, sidecar) {
  const blocks = blocksOf(rec);
  if (blocks.length > 0) return blocks;
  if (!sidecar) {
    const body = str(rec.body).trim();
    if (body) return [{ type: 'text', text: body }];
  }
  return [];
}

// ported from apiAdapter.ts splitName()
function splitName(full) {
  const s = full.trim();
  if (!s) return { firstName: null, lastName: null };
  const i = s.indexOf(' ');
  if (i < 0) return { firstName: s, lastName: null };
  return { firstName: s.slice(0, i), lastName: s.slice(i + 1).trim() || null };
}

// ported from apiAdapter.ts joinName()
function joinName(first, last) {
  return [str(first).trim(), str(last).trim()].filter(Boolean).join(' ');
}

// ported from apiAdapter.ts tagsToArray()
function tagsToArray(v) {
  return str(v)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
}

// ported from apiAdapter.ts tagsToCsv()
function tagsToCsv(v) {
  if (Array.isArray(v)) return v.map((t) => str(t).trim()).filter(Boolean).join(', ');
  return str(v);
}

// ported from apiAdapter.ts toSubscriber()
function toSubscriber(rec) {
  const n = splitName(str(rec.name));
  const status = str(rec.status) || 'subscribed';
  const created = toIso(rec.created);
  return {
    id: str(rec.id),
    email: str(rec.email),
    firstName: n.firstName,
    lastName: n.lastName,
    status: status,
    tags: tagsToArray(rec.tags),
    bounceReason: null,
    unsubscribeToken: 'unsub_' + str(rec.id),
    source: 'manual',
    createdAt: created,
    updatedAt: toIso(rec.updated) || created,
  };
}

// ported from apiAdapter.ts toTemplate()
function toTemplate(rec) {
  const sidecar = parseSidecar(rec.body);
  const created = toIso(rec.created);
  return {
    id: str(rec.id),
    name: str(rec.name),
    subject: str(rec.subject),
    preheader: sidecar ? str(sidecar.preheader) : '',
    blocks: effectiveBlocks(rec, sidecar),
    design: sidecar && typeof sidecar.design === 'object' && sidecar.design ? sidecar.design : {},
    category: sidecar ? str(sidecar.category) || 'custom' : 'custom',
    isBuiltin: false,
    icon: sidecar ? str(sidecar.icon) || 'FiMail' : 'FiMail',
    usageCount: sidecar ? num(sidecar.usageCount) : 0,
    createdAt: created,
    updatedAt: toIso(rec.updated) || created,
  };
}

// ported from apiAdapter.ts campaignStatus()
function campaignStatus(rec, sidecar) {
  if (str(rec.status) === 'sent') return 'sent';
  const s = sidecar ? str(sidecar.status) : '';
  return s || 'draft';
}

// ported from apiAdapter.ts toCampaignSummary()
function toCampaignSummary(rec) {
  const sidecar = parseSidecar(rec.body);
  const created = toIso(rec.created);
  const recipients = num(rec.recipients_count);
  const status = campaignStatus(rec, sidecar);
  const sentCount = status === 'sent' ? recipients : 0;
  return {
    id: str(rec.id),
    name: sidecar ? str(sidecar.name) || str(rec.subject) || 'Untitled campaign' : str(rec.subject) || 'Untitled campaign',
    subject: sidecar && sidecar.subject !== undefined ? str(sidecar.subject) : str(rec.subject),
    preheader: sidecar ? str(sidecar.preheader) : '',
    fromName: sidecar && str(sidecar.fromName) ? str(sidecar.fromName) : null,
    fromEmail: sidecar && str(sidecar.fromEmail) ? str(sidecar.fromEmail) : null,
    replyTo: sidecar && str(sidecar.replyTo) ? str(sidecar.replyTo) : null,
    status: status,
    targetTags: sidecar && Array.isArray(sidecar.targetTags) ? sidecar.targetTags : [],
    targetAll: sidecar ? coerceBool(sidecar.targetAll, true) : true,
    scheduledAt: toIso(rec.scheduled_at),
    sentAt: toIso(rec.sent_at),
    totalRecipients: recipients,
    sentCount: sentCount,
    failedCount: 0,
    opensUnique: 0,
    clicksUnique: 0,
    unsubscribes: 0,
    errorMessage: sidecar && str(sidecar.errorMessage) ? str(sidecar.errorMessage) : null,
    createdAt: created,
    updatedAt: toIso(rec.updated) || created,
  };
}

// ported from apiAdapter.ts toCampaignDetail()
function toCampaignDetail(rec) {
  const sidecar = parseSidecar(rec.body);
  const summary = toCampaignSummary(rec);
  summary.blocks = effectiveBlocks(rec, sidecar);
  summary.design = sidecar && typeof sidecar.design === 'object' && sidecar.design ? sidecar.design : {};
  return summary;
}

// ported from frontend/src/app/audience.ts campaignAudience(): who a campaign
// goes to (the Audience tab, the Send confirm, the Dashboard's scheduled rows).
function campaignAudience(campaign, subscribers) {
  const active = subscribers.filter((s) => s.status === 'subscribed');
  if (campaign.targetAll) return active;
  if (campaign.targetTags.length === 0) return [];
  return active.filter((s) => (s.tags || []).some((t) => campaign.targetTags.indexOf(t) >= 0));
}

// ported from apiAdapter.ts buildCampaignSidecar()
function buildCampaignSidecar(prev, incoming) {
  const s = Object.assign({ __meta: true }, prev || {});
  const apply = (key, val) => {
    if (val !== undefined) s[key] = val;
  };
  if ('name' in incoming) apply('name', str(incoming.name));
  if ('subject' in incoming) apply('subject', str(incoming.subject));
  if ('preheader' in incoming) apply('preheader', str(incoming.preheader));
  if ('from_name' in incoming) apply('fromName', str(incoming.from_name));
  if ('from_email' in incoming) apply('fromEmail', str(incoming.from_email));
  if ('reply_to' in incoming) apply('replyTo', str(incoming.reply_to));
  if ('design' in incoming) apply('design', incoming.design == null ? {} : incoming.design);
  if ('target_tags' in incoming) {
    apply(
      'targetTags',
      Array.isArray(incoming.target_tags) ? incoming.target_tags.map((t) => str(t).trim()).filter(Boolean) : [],
    );
  }
  if ('target_all' in incoming) apply('targetAll', coerceBool(incoming.target_all, true));
  if ('status' in incoming) apply('status', str(incoming.status));
  if ('errorMessage' in incoming) apply('errorMessage', incoming.errorMessage);
  const subjectField = str(s.subject) || str(s.name) || '(no subject)';
  return { sidecar: s, subjectField: subjectField };
}

// ported from apiAdapter.ts buildTemplateSidecar()
function buildTemplateSidecar(prev, incoming) {
  const s = Object.assign({ __meta: true }, prev || {});
  const apply = (key, val) => {
    if (val !== undefined) s[key] = val;
  };
  if ('preheader' in incoming) apply('preheader', str(incoming.preheader));
  if ('design' in incoming) apply('design', incoming.design == null ? {} : incoming.design);
  if ('category' in incoming) apply('category', str(incoming.category) || 'custom');
  if ('icon' in incoming) apply('icon', str(incoming.icon) || 'FiMail');
  if ('usageCount' in incoming) apply('usageCount', num(incoming.usageCount));
  return s;
}

/** A JSON round trip: what the browser's request body looks like after JSON.stringify. */
function asSent(obj) {
  return JSON.parse(JSON.stringify(obj));
}

/* ============================================ block and design validation */

const BLOCK_TYPES = ['heading', 'text', 'button', 'image', 'divider', 'spacer'];

// Field kinds per block type: exactly the fields the editor's controls write
// (types.ts EmailBlock; CampaignCanvas.tsx block controls).
const BLOCK_FIELDS = {
  heading: { text: 'html', level: 'level', align: 'align', color: 'color' },
  text: { text: 'html', size: 'size', align: 'align', color: 'color' },
  button: { label: 'string', url: 'string', align: 'align', backgroundColor: 'color', textColor: 'color' },
  image: { url: 'string', alt: 'string', width: 'width', align: 'align' },
  divider: { color: 'color' },
  spacer: { height: 'height' },
};
const BLOCK_REQUIRED = { heading: ['text'], text: ['text'], button: ['label', 'url'], image: ['url'], divider: [], spacer: ['height'] };

// The palette's new blocks (EditorSidebar.tsx PALETTE make()).
const BLOCK_DEFAULTS = {
  heading: { type: 'heading', text: 'Your headline here', level: 2 },
  text: { type: 'text', text: 'Write your paragraph here.' },
  button: { type: 'button', label: 'Click here', url: 'https://example.com' },
  image: { type: 'image', url: '', alt: '' },
  divider: { type: 'divider' },
  spacer: { type: 'spacer', height: 24 },
};

const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const ELIDED_RE = /^data:[^,]*,…\(\d+ chars elided/;

// Inline markup the rich-text editor (RichTextEditor.tsx) can produce:
// execCommand bold/italic/underline -> b/i/u (styleWithCSS off), foreColor ->
// font color, createLink -> a href (http(s): or mailto: only, applyLink),
// Enter in a paragraph -> div/br, and span style from the browser's own
// merging. Nothing in the app sanitizes stored text, so this accepts exactly
// that set and rejects anything the editor cannot write.
const INLINE_TAGS = { b: [], i: [], u: [], font: ['color', 'style'], a: ['href'], div: ['style'], br: [], span: ['style'] };
const INLINE_TAG_NAMES = 'b, i, u, font color, a href (http/https/mailto), div, br, span style';

function checkInlineHtml(text) {
  if (/<!--|<!|<\?/.test(text)) return 'comments and declarations are not allowed';
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g;
  let m;
  while ((m = tagRe.exec(text)) !== null) {
    const name = m[2].toLowerCase();
    if (!(name in INLINE_TAGS)) {
      return `tag "${name}" is not one the editor writes (allowed: ${INLINE_TAG_NAMES}; write a literal less-than sign as an HTML entity)`;
    }
    if (m[1] === '/') continue;
    const attrs = m[3].replace(/\/\s*$/, '');
    const attrRe = /([^\s=/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
    let a;
    while ((a = attrRe.exec(attrs)) !== null) {
      const attr = a[1].toLowerCase();
      const val = a[2] !== undefined ? a[2] : a[3] !== undefined ? a[3] : a[4] !== undefined ? a[4] : '';
      if (INLINE_TAGS[name].indexOf(attr) < 0) return `attribute "${attr}" on tag "${name}" is not one the editor writes`;
      if (attr === 'href' && !/^(https?:|mailto:)/i.test(val.trim())) return 'links must start with http:, https: or mailto:';
      if (attr === 'color' && !/^(#[0-9a-fA-F]{3,8}|rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\))$/.test(val.trim())) {
        return 'font color must be a hex or rgb() color';
      }
      if (attr === 'style' && /url\s*\(|expression|javascript:|[<>]/i.test(val)) return 'style may only hold plain CSS values';
    }
  }
  return null;
}

/** Problems with one block, or null. `where` prefixes the message. */
function blockProblem(b, where) {
  if (!b || typeof b !== 'object' || Array.isArray(b)) return where + ' must be an object';
  const type = b.type;
  if (BLOCK_TYPES.indexOf(type) < 0) return `${where}.type must be one of: ${BLOCK_TYPES.join(', ')}`;
  const fields = BLOCK_FIELDS[type];
  for (const k of Object.keys(b)) {
    if (k === 'type') continue;
    if (!(k in fields)) return `${where}: a ${type} block has no field "${k}" (fields: ${Object.keys(fields).join(', ') || 'none'})`;
    const v = b[k];
    const kind = fields[k];
    if (kind === 'html' || kind === 'string') {
      if (typeof v !== 'string') return `${where}.${k} must be a string`;
      if (kind === 'string' && ELIDED_RE.test(v)) {
        return `${where}.${k} is a shortened preview of an image; leave that block unchanged (use blocks.edit) or read it with include_data_urls=true`;
      }
      if (kind === 'html') {
        const bad = checkInlineHtml(v);
        if (bad) return `${where}.${k}: ${bad}`;
      }
    } else if (kind === 'level') {
      if (v !== 1 && v !== 2 && v !== 3) return `${where}.level must be 1, 2 or 3`;
    } else if (kind === 'align') {
      if (['left', 'center', 'right'].indexOf(v) < 0) return `${where}.align must be left, center or right`;
    } else if (kind === 'size') {
      if (['small', 'normal', 'large'].indexOf(v) < 0) return `${where}.size must be small, normal or large`;
    } else if (kind === 'width') {
      if (['small', 'medium', 'full'].indexOf(v) < 0) return `${where}.width must be small, medium or full`;
    } else if (kind === 'color') {
      if (typeof v !== 'string' || !COLOR_RE.test(v)) return `${where}.${k} must be a #RRGGBB color`;
    } else if (kind === 'height') {
      if (!Number.isInteger(v) || v < 4 || v > 96 || v % 4 !== 0) return `${where}.height must be 4 to 96 in steps of 4`;
    }
  }
  for (const k of BLOCK_REQUIRED[type]) {
    if (b[k] === undefined) return `${where}: a ${type} block needs "${k}"`;
  }
  return null;
}

function checkBlocks(blocks) {
  if (!Array.isArray(blocks)) throw fail(400, 'blocks must be a JSON array');
  for (let i = 0; i < blocks.length; i++) {
    const bad = blockProblem(blocks[i], `blocks[${i}]`);
    if (bad) throw fail(400, bad);
  }
  return blocks;
}

const DESIGN_KEYS = ['emailBg', 'cardBg', 'textColor', 'headingColor', 'buttonBg', 'buttonTextColor', 'fontFamily'];

function checkDesign(design) {
  if (!design || typeof design !== 'object' || Array.isArray(design)) throw fail(400, 'design must be a JSON object');
  for (const k of Object.keys(design)) {
    if (DESIGN_KEYS.indexOf(k) < 0) throw fail(400, `design has no key "${k}" (keys: ${DESIGN_KEYS.join(', ')})`);
    if (k === 'fontFamily') {
      if (['system', 'serif', 'mono'].indexOf(design[k]) < 0) throw fail(400, 'design.fontFamily must be system, serif or mono');
    } else if (typeof design[k] !== 'string' || !COLOR_RE.test(design[k])) {
      throw fail(400, `design.${k} must be a #RRGGBB color`);
    }
  }
  return design;
}

/* ============================================== agent-facing presentation */

/** Shorten long data: URLs in a blocks array (unless asked for in full). */
function elideBlocks(blocks, full) {
  if (full) return blocks;
  return blocks.map((b) => {
    if (!b || typeof b.url !== 'string' || !b.url.startsWith('data:') || b.url.length <= 200) return b;
    const comma = b.url.indexOf(',');
    const head = comma > 0 ? b.url.slice(0, comma + 1) : 'data:';
    return Object.assign({}, b, { url: `${head}…(${b.url.length} chars elided; include_data_urls=true shows it)` });
  });
}

function withElided(obj, full) {
  if (!obj || !Array.isArray(obj.blocks)) return obj;
  return Object.assign({}, obj, { blocks: elideBlocks(obj.blocks, full) });
}

function summaryOfBlock(b, i) {
  let summary = '';
  if (b.type === 'heading' || b.type === 'text') summary = str(b.text).replace(/<[^>]+>/g, '');
  else if (b.type === 'button') summary = str(b.label) + ' → ' + str(b.url);
  else if (b.type === 'image') summary = str(b.url).startsWith('data:') ? `uploaded image (${str(b.url).length} chars)` : str(b.url);
  else if (b.type === 'spacer') summary = num(b.height, 16) + 'px';
  return { index: i, type: b.type, summary: summary.length > 60 ? summary.slice(0, 59) + '…' : summary };
}

/* ================================================================ guide */

function guide() {
  return {
    app: 'Newsletter Tool: a subscriber list, reusable email templates, and campaigns (emails built from blocks) that are sent now or on a schedule.',
    sending: [
      'campaigns.send-now records the audience snapshot exactly as the app\'s Send button does: each subscriber in the campaign\'s audience becomes a recipient row, and the campaign is marked sent with that count. It cannot be undone.',
      'The audience is every subscriber with status "subscribed" when target_all is true (the default); otherwise only the subscribed contacts with any of target_tags (nobody when no tag is chosen). campaigns.get shows the count.',
      'No email leaves the app: Send and scheduled sends record the campaign and its audience only. To email it, the person uses their own email service, or asks you to send it with your own tools (campaigns.preview gives the HTML, subscribers.export the list).',
      'A scheduled campaign is recorded the same way by the app\'s scheduler (checks every minute) once scheduled_at passes. campaigns.schedule only accepts future times.',
      'Per-campaign from_name, from_email and reply_to are stored and shown, but the send does not use them.',
    ],
    statuses: {
      draft: 'editable',
      scheduled: 'editable; recorded as sent when scheduled_at passes; campaigns.cancel stops it',
      cancelled: 'editable; can be scheduled again',
      sent: 'read-only; can be duplicated or deleted',
      'sending, failed': 'filter values in the app; this version never produces them',
    },
    blocks: {
      format: 'A campaign or template body is a JSON array of blocks rendered top to bottom. Fields not listed are rejected.',
      heading: 'text (inline markup), level 1|2|3, align left|center|right, color #RRGGBB. New: {"type":"heading","text":"Your headline here","level":2}',
      text: 'text (inline markup; a newline becomes a line break), size small|normal|large, align, color. New: {"type":"text","text":"Write your paragraph here."}',
      button: 'label (plain text), url (http(s)://, mailto: or a {placeholder}; anything else links to #), align (default center), backgroundColor, textColor. New: {"type":"button","label":"Click here","url":"https://example.com"}',
      image: 'url (https:// address or a data:image/...;base64 upload), alt, width small|medium|full, align (default center). Nothing shows until url is set. New: {"type":"image","url":"","alt":""}',
      divider: 'color (default #EAEAEA). New: {"type":"divider"}',
      spacer: 'height 4 to 96 in steps of 4. New: {"type":"spacer","height":24}',
      inlineMarkup: `heading and text may hold the editor's inline tags only: ${INLINE_TAG_NAMES}.`,
      placeholders: '{firstName}, {lastName}, {email}, {unsubscribeUrl} are filled per recipient in the preview.',
      editing: 'blocks.edit adds (appends, like the palette), updates (merges fields), moves or removes one block by index; campaigns.update and templates.update replace the whole array.',
      images: 'Long data: image URLs are shortened in get results; pass include_data_urls=true to see them.',
    },
    design: {
      keys: 'emailBg #F5F5F5, cardBg #FFFFFF, textColor #262626, headingColor #171717, buttonBg #FF4F18, buttonTextColor #FFFFFF (defaults), fontFamily system|serif|mono (default system). A design param is merged into the current design.',
    },
    templates: 'Starting a campaign from a template (campaigns.create template_id) copies its subject, preheader, blocks and design and counts one use; the campaign name defaults to "{template name} — campaign". A template that was never edited (the seeded "Monthly update") keeps its text in a plain body and shows it as one text block; the first campaign started from it stores that block on the template, so the template keeps its content.',
    subscribers: 'subscribers.add and subscribers.import update an existing email instead of duplicating it. Editing or deleting one subscriber can also be done with data CRUD on subscribers: email in lower case, name "First Last", tags as "a, b", status subscribed|unsubscribed.',
    settings: 'The sender name and email, the reply-to address, and the organization name and mailing address are stored (settings.get, settings.update). The organization name and address appear in the footer of the rendered email (campaigns.preview).',
    stats: 'Open, click, unsubscribe and bounce tracking are not implemented in this version; those numbers are always 0.',
  };
}

/* =========================================================== dashboard */

const DAY = 86400000;

// ported from apiAdapter.ts computeOverview()
function computeOverview(campaigns, subs) {
  const total = subs.length;
  const active = subs.filter((s) => str(s.status) === 'subscribed').length;
  const unsub = subs.filter((s) => str(s.status) === 'unsubscribed').length;
  const bounced = 0;
  const now = Date.now();
  const cutoff = now - 30 * 24 * 3600000;
  const newLast30 = subs.filter((s) => {
    const c = toIso(s.created);
    return c ? Date.parse(c) >= cutoff : false;
  }).length;
  const sent = campaigns.filter((c) => c.status === 'sent');
  const emailsDelivered = sent.reduce((acc, c) => acc + num(c.sentCount), 0);
  const scheduled = campaigns.filter((c) => c.status === 'scheduled').length;
  const drafts = campaigns.filter((c) => c.status === 'draft').length;
  const last7 = now - 6 * 24 * 3600000;
  const byDay = {};
  for (const c of sent) {
    const sentAt = str(c.sentAt);
    if (!sentAt) continue;
    const ms = Date.parse(sentAt);
    if (Number.isNaN(ms) || ms < last7) continue;
    const key = new Date(ms).toISOString().slice(0, 10);
    byDay[key] = (byDay[key] || 0) + num(c.sentCount);
  }
  return {
    subscribers: { total: total, active: active, unsubscribed: unsub, bounced: bounced, newLast30Days: newLast30 },
    campaigns: {
      totalSent: sent.length,
      scheduled: scheduled,
      drafts: drafts,
      emailsDelivered: emailsDelivered,
      uniqueOpens: 0,
      uniqueClicks: 0,
      openRate: 0,
      clickRate: 0,
      sendsByDay: byDay,
    },
  };
}

function ms(iso) {
  return iso ? new Date(iso).getTime() : 0;
}

/** dashboard.get: Dashboard.tsx panels over handleDashboard's data. */
function dashboard(app) {
  const campaigns = all(app, 'campaigns', '-updated').map((r) => toCampaignSummary(plain('campaigns', r)));
  const subsRaw = all(app, 'subscribers', '-created').map((r) => plain('subscribers', r));
  const templates = all(app, 'templates', '-updated').map((r) => toTemplate(plain('templates', r)));
  // Dashboard.tsx drafts / scheduled / recentSends
  const drafts = campaigns.filter((c) => c.status === 'draft').sort((a, b) => ms(b.updatedAt) - ms(a.updatedAt));
  const scheduled = campaigns
    .filter((c) => c.status === 'scheduled' && c.scheduledAt)
    .sort((a, b) => ms(a.scheduledAt) - ms(b.scheduledAt));
  const recentSends = campaigns
    .filter((c) => c.status === 'sent' && c.sentAt && c.sentCount > 0)
    .sort((a, b) => ms(b.sentAt) - ms(a.sentAt));
  // Dashboard.tsx pickQuickStart: used templates first (no template is built-in in this version)
  const quickStart = templates
    .filter((t) => (t.usageCount || 0) > 0)
    .sort((a, b) => (b.usageCount || 0) - (a.usageCount || 0))
    .slice(0, 4)
    .map((t) => ({ id: t.id, name: t.name, subject: t.subject, usageCount: t.usageCount }));
  // Dashboard.tsx GrowthChartPanel: cumulative subscribers at the end of each of the last 31 days (UTC)
  const subs = subsRaw.map(toSubscriber);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const start = today.getTime() - 30 * DAY;
  const growth = [];
  for (let i = 0; i <= 30; i++) {
    const dayEnd = start + i * DAY + DAY - 1;
    growth.push({
      date: new Date(start + i * DAY).toISOString().slice(0, 10),
      total: subs.filter((s) => s.createdAt && new Date(s.createdAt).getTime() <= dayEnd).length,
    });
  }
  // A scheduled row shows how many contacts its send will record.
  const rows = scheduled
    .map((c) => ({ kind: 'scheduled', campaign: c, contacts: campaignAudience(c, subs).length }))
    .concat(drafts.map((c) => ({ kind: 'draft', campaign: c })))
    .slice(0, 6);
  return {
    overview: computeOverview(campaigns, subsRaw),
    campaignsPanel: { scheduled: scheduled.length, drafts: drafts.length, shown: rows },
    recentSends: recentSends.slice(0, 4),
    quickStart: quickStart,
    growth: growth,
  };
}

/* ========================================================= subscribers */

function tagCounts(subsRaw) {
  // ported from apiAdapter.ts handleTags()
  const counts = {};
  const order = [];
  for (const r of subsRaw) {
    for (const t of tagsToArray(r.tags)) {
      if (!(t in counts)) {
        counts[t] = 0;
        order.push(t);
      }
      counts[t] += 1;
    }
  }
  return order
    .map((name) => ({ name: name, count: counts[name] }))
    .sort((a, b) => b.count - a.count || a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
}

/** subscribers.list: the Subscribers screen (Subscribers.tsx filtered list, header, tag dropdown). */
function subscribersList(app, p) {
  const status = enumParam(p, 'status', ['subscribed', 'unsubscribed', 'bounced'], '');
  const tag = str(p.tag);
  const search = str(p.search).trim().toLowerCase();
  const limit = intParam(p, 'limit', 500, 1, 5000);
  const offset = intParam(p, 'offset', 0, 0, 10000000);
  const raw = all(app, 'subscribers', '-created').map((r) => plain('subscribers', r));
  const subs = raw.map(toSubscriber);
  // Subscribers.tsx `filtered`
  const matched = subs.filter((s) => {
    if (status && s.status !== status) return false;
    if (tag && s.tags.indexOf(tag) < 0) return false;
    if (search) {
      const name = `${s.firstName || ''} ${s.lastName || ''}`.toLowerCase();
      if (s.email.toLowerCase().indexOf(search) < 0 && name.indexOf(search) < 0) return false;
    }
    return true;
  });
  return {
    subscribers: matched.slice(offset, offset + limit),
    total: matched.length,
    limit: limit,
    offset: offset,
    header: { total: subs.length, active: subs.filter((s) => s.status === 'subscribed').length },
    tags: tagCounts(raw),
  };
}

function findByEmail(app, email) {
  const rows = Array.from(app.findRecordsByFilter('subscribers', 'email = {:email}', '', 1, 0, { email: email }));
  return rows[0] || null;
}

// ported from apiAdapter.ts handleSubscriberCreate() (the Add form)
function subscribersAdd(app, p) {
  const tagsGiven = tagsToArray(p.tags);
  // AppController.addSubscriber -> ApiService.createSubscriber body
  const body = asSent({ email: str(p.email), first_name: p.first_name, last_name: p.last_name, tags: tagsGiven });
  const email = str(body.email).trim().toLowerCase();
  if (!email || email.indexOf('@') < 0) throw fail(422, 'A valid email is required');
  const found = findByEmail(app, email);
  if (found) {
    const patch = {};
    const name = joinName(body.first_name, body.last_name);
    if (name) patch.name = name;
    if (body.tags !== undefined) {
      const merged = [];
      for (const t of tagsToArray(found.getString('tags')).concat(tagsToArray(tagsToCsv(body.tags)))) {
        if (merged.indexOf(t) < 0) merged.push(t);
      }
      patch.tags = merged.join(', ');
    }
    if (Object.keys(patch).length > 0) write(app, found, patch);
    return { subscriber: toSubscriber(plain('subscribers', found)), created: false };
  }
  const rec = create(app, 'subscribers', {
    email: email,
    name: joinName(body.first_name, body.last_name),
    status: 'subscribed',
    tags: tagsToCsv(body.tags),
  });
  return { subscriber: toSubscriber(plain('subscribers', rec)), created: true };
}

// ported from apiAdapter.ts handleSubscribersImport() (Import CSV)
function subscribersImport(app, p) {
  const content = str(p.csv).trim();
  const applyTags = tagsToArray(tagsToCsv(tagsToArray(p.tags)));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  const errors = [];
  if (!content) return { inserted: 0, updated: 0, skipped: 0, errors: ['empty input'] };
  const seen = {};
  const rows = content.split(/\r?\n/);
  // Snapshot existing subscribers once to detect insert-vs-update, keyed by
  // lower-case email (the adapter's snapshot holds only its first 500 rows).
  const byEmail = {};
  for (const r of all(app, 'subscribers', '')) byEmail[r.getString('email').toLowerCase()] = r;
  for (const line of rows) {
    const cells = line.split(',');
    const firstCell = str(cells[0]).trim();
    if (!firstCell || firstCell.startsWith('#')) continue;
    if (firstCell.indexOf('@') < 0) {
      skipped += 1;
      continue;
    }
    const email = firstCell.toLowerCase();
    if (seen[email]) continue;
    seen[email] = true;
    const firstName = cells.length > 1 ? str(cells[1]).trim() : '';
    const lastName = cells.length > 2 ? str(cells[2]).trim() : '';
    const existing = byEmail[email];
    try {
      if (existing) {
        const patch = {};
        const name = joinName(firstName, lastName);
        if (name) patch.name = name;
        if (applyTags.length > 0) {
          const merged = [];
          for (const t of tagsToArray(existing.getString('tags')).concat(applyTags)) if (merged.indexOf(t) < 0) merged.push(t);
          patch.tags = merged.join(', ');
        }
        if (Object.keys(patch).length > 0) write(app, existing, patch);
        updated += 1;
      } else {
        byEmail[email] = create(app, 'subscribers', {
          email: email,
          name: joinName(firstName, lastName),
          status: 'subscribed',
          tags: applyTags.join(', '),
        });
        inserted += 1;
      }
    } catch (err) {
      errors.push(`${email}: ${String((err && err.message) || err)}`);
    }
  }
  return { inserted: inserted, updated: updated, skipped: skipped, errors: errors };
}

/* =========================================================== templates */

function templatesList(app, p) {
  const limit = intParam(p, 'limit', 200, 1, 5000);
  const offset = intParam(p, 'offset', 0, 0, 10000000);
  // handleTemplatesList (-updated), then Templates.tsx `sorted`
  const list = all(app, 'templates', '-updated')
    .map((r) => toTemplate(plain('templates', r)))
    .sort((a, b) => {
      const use = (b.usageCount || 0) - (a.usageCount || 0);
      if (use !== 0) return use;
      return ms(b.updatedAt) - ms(a.updatedAt);
    });
  return {
    templates: list.slice(offset, offset + limit).map((t) => {
      const out = Object.assign({}, t, { blockCount: t.blocks.length });
      delete out.blocks;
      return out;
    }),
    total: list.length,
    limit: limit,
    offset: offset,
  };
}

function templatesGet(app, p) {
  const rec = byId(app, 'templates', requireId(p, 'template_id'));
  return { template: withElided(toTemplate(plain('templates', rec)), boolParam(p, 'include_data_urls')) };
}

// ported from apiAdapter.ts handleTemplateCreate()
function templateCreateCore(app, body) {
  const sidecar = buildTemplateSidecar(null, {
    preheader: body.preheader,
    design: body.design,
    category: body.category,
    icon: body.icon,
    usageCount: 0,
  });
  const rec = create(app, 'templates', {
    name: str(body.name).trim() || 'Untitled template',
    subject: str(body.subject),
    blocks: Array.isArray(body.blocks) ? body.blocks : [],
    body: JSON.stringify(sidecar),
  });
  return toTemplate(plain('templates', rec));
}

// ported from apiAdapter.ts handleTemplateUpdate()
function templateUpdateCore(app, rec, body) {
  const cur = plain('templates', rec);
  const sidecar = buildTemplateSidecar(parseSidecar(cur.body), {
    preheader: body.preheader,
    design: body.design,
    category: body.category,
    icon: body.icon,
  });
  const patch = { body: JSON.stringify(sidecar) };
  if (body.name !== undefined) patch.name = str(body.name).trim() || str(cur.name);
  if (body.subject !== undefined) patch.subject = str(body.subject);
  if (body.blocks !== undefined) patch.blocks = Array.isArray(body.blocks) ? body.blocks : [];
  write(app, rec, patch);
  return toTemplate(plain('templates', rec));
}

/** The template editor's autosave payload (TemplateEditor.tsx -> saveTemplate -> updateTemplate). */
function saveTemplateLikeEditor(app, rec, working) {
  return templateUpdateCore(
    app,
    rec,
    asSent({
      name: working.name || 'Untitled template',
      subject: working.subject || '',
      preheader: working.preheader || '',
      blocks: working.blocks || [],
      design: working.design || {},
      category: undefined,
      icon: undefined,
    }),
  );
}

/** templates.create: the "New blank template" modal (Templates.tsx), optionally with content. */
function templatesCreate(app, p) {
  const name = str(p.name).trim();
  if (!name) throw fail(400, 'name is required');
  const blocks = has(p, 'blocks')
    ? checkBlocks(jsonParam(p, 'blocks'))
    : [
        { type: 'heading', text: 'Hello!', level: 1 },
        { type: 'text', text: 'Write your message here.' },
      ];
  const design = has(p, 'design') ? checkDesign(jsonParam(p, 'design')) : undefined;
  // AppController.saveTemplate -> ApiService.createTemplate body
  const body = asSent({
    name: name,
    subject: str(p.subject),
    preheader: str(p.preheader),
    blocks: blocks,
    design: design,
    category: undefined,
    icon: undefined,
  });
  return { template: withElided(templateCreateCore(app, body), false) };
}

/** templates.update: the template editor's autosave with the given fields changed. */
function templatesUpdate(app, p) {
  const rec = byId(app, 'templates', requireId(p, 'template_id'));
  const working = toTemplate(plain('templates', rec));
  let changed = false;
  for (const k of ['name', 'subject', 'preheader']) {
    if (p[k] !== undefined && p[k] !== null) {
      working[k] = str(p[k]);
      changed = true;
    }
  }
  if (has(p, 'blocks')) {
    working.blocks = checkBlocks(jsonParam(p, 'blocks'));
    changed = true;
  }
  if (has(p, 'design')) {
    working.design = Object.assign({}, working.design || {}, checkDesign(jsonParam(p, 'design')));
    changed = true;
  }
  if (!changed) throw fail(400, 'Give at least one of: name, subject, preheader, blocks, design');
  return { template: withElided(saveTemplateLikeEditor(app, rec, working), false) };
}

/** templates.duplicate: TemplateEditor.tsx handleDuplicate. */
function templatesDuplicate(app, p) {
  const rec = byId(app, 'templates', requireId(p, 'template_id'));
  const working = toTemplate(plain('templates', rec));
  const body = asSent({
    name: `${working.name} (copy)`,
    subject: working.subject || '',
    preheader: working.preheader || '',
    blocks: working.blocks || [],
    design: working.design || {},
    category: undefined,
    icon: undefined,
  });
  return { template: withElided(templateCreateCore(app, body), false) };
}

// ported from apiAdapter.ts handleTemplateDelete()
function templatesDelete(app, p) {
  const rec = byId(app, 'templates', requireId(p, 'template_id'));
  const name = rec.getString('name');
  app.delete(rec);
  return { deleted: rec.id, name: name };
}

/* =========================================================== campaigns */

const CAMPAIGN_STATUSES = ['draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled'];

function campaignsList(app, p) {
  const status = enumParam(p, 'status', CAMPAIGN_STATUSES, '');
  const limit = intParam(p, 'limit', 200, 1, 5000);
  const offset = intParam(p, 'offset', 0, 0, 10000000);
  // handleCampaignsList (-updated, logical status filter)
  let list = all(app, 'campaigns', '-updated').map((r) => toCampaignSummary(plain('campaigns', r)));
  if (status) list = list.filter((c) => c.status === status);
  // Schedule.tsx / Dashboard order scheduled sends by their time.
  if (status === 'scheduled') list = list.filter((c) => c.scheduledAt).sort((a, b) => ms(a.scheduledAt) - ms(b.scheduledAt));
  return { campaigns: list.slice(offset, offset + limit), total: list.length, limit: limit, offset: offset };
}

function isReadonly(detail) {
  return detail.status === 'sent' || detail.status === 'sending';
}

function editable(rec) {
  const detail = toCampaignDetail(plain('campaigns', rec));
  if (isReadonly(detail)) throw fail(409, `Campaign is ${detail.status} and can no longer be edited (duplicate it to reuse the content)`);
  return detail;
}

/** CampaignEditor.tsx AudienceTab numbers, plus what the send really records. */
function audienceOf(app, campaign) {
  const raw = all(app, 'subscribers', '-created').map((r) => plain('subscribers', r));
  const stored = {};
  for (const r of raw) stored[r.id] = r.status;
  const subs = raw.map(toSubscriber);
  const active = subs.filter((s) => s.status === 'subscribed');
  const recipients = campaignAudience(campaign, subs);
  return {
    matching: recipients.length,
    active: active.length,
    unsubscribed: subs.filter((s) => s.status === 'unsubscribed').length,
    bounced: subs.filter((s) => s.status === 'bounced').length,
    sample: recipients.slice(0, 6).map((s) => ({
      email: s.email,
      name: `${s.firstName || ''} ${s.lastName || ''}`.trim() || null,
      tags: s.tags,
    })),
    // send.js audienceOf: the same targeting over rows whose stored status is "subscribed"
    // (a row with no status shows as subscribed but is left out of sends).
    sendRecords: recipients.filter((s) => stored[s.id] === 'subscribed').length,
    note: 'A send records the matching subscribers (sendRecords): everyone subscribed, or by tag when target_all is false.',
  };
}

function campaignsGet(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  const detail = toCampaignDetail(plain('campaigns', rec));
  return {
    campaign: withElided(detail, boolParam(p, 'include_data_urls')),
    readonly: isReadonly(detail),
    audience: audienceOf(app, detail),
  };
}

// ported from apiAdapter.ts handleCampaignPreview()
function campaignsPreview(app, p) {
  const render = require(`${__hooks}/lib_agent_render.js`);
  const format = enumParam(p, 'format', ['text', 'html', 'both'], 'text');
  const rec = plain('campaigns', byId(app, 'campaigns', requireId(p, 'campaign_id')));
  const sidecar = parseSidecar(rec.body);
  const subject = sidecar && sidecar.subject !== undefined ? str(sidecar.subject) : str(rec.subject);
  const name = sidecar ? str(sidecar.name) : '';
  const preheader = sidecar ? str(sidecar.preheader) : '';
  const design = sidecar && typeof sidecar.design === 'object' && sidecar.design ? sidecar.design : {};
  const blocks = effectiveBlocks(rec, sidecar);
  const sampleRec = Array.from(app.findRecordsByFilter('subscribers', "status = 'subscribed'", 'created', 1, 0))[0];
  const sample = sampleRec ? plain('subscribers', sampleRec) : null;
  const sampleName = sample ? splitName(str(sample.name)) : { firstName: 'Friend', lastName: '' };
  const context = {
    firstName: render.esc(sampleName.firstName || 'there'),
    lastName: render.esc(sampleName.lastName || ''),
    email: render.esc(sample ? str(sample.email) : 'preview@example.com'),
    unsubscribeUrl: '#preview-unsubscribe',
  };
  // The Settings footer (organization name and mailing address).
  const identity = settingsRecord(app);
  const rendered = render.renderEmail({
    subject: subject || name,
    preheader: preheader,
    blocks: blocks,
    context: context,
    design: design,
    organizationName: identity ? identity.getString('organization_name') : '',
    organizationAddress: identity ? identity.getString('organization_address') : '',
  });
  const out = { subject: subject || name, preheader: preheader, sampleRecipient: sample ? sample.email : null };
  if (format === 'text' || format === 'both') out.text = rendered.text;
  if (format === 'html' || format === 'both') out.html = rendered.html;
  return out;
}

// ported from apiAdapter.ts handleCampaignCreate()
function campaignCreateCore(app, body) {
  let blocks = Array.isArray(body.blocks) ? body.blocks : [];
  let subject = str(body.subject);
  let preheader = str(body.preheader);
  let design = body.design && typeof body.design === 'object' ? body.design : {};
  const templateId = body.template_id != null && str(body.template_id) !== '' ? str(body.template_id) : '';
  if (templateId) {
    const tplRec = byId(app, 'templates', templateId);
    const tpl = plain('templates', tplRec);
    const tplSidecar = parseSidecar(tpl.body);
    if (blocks.length === 0) blocks = effectiveBlocks(tpl, tplSidecar);
    if (!subject) subject = str(tpl.subject);
    if (!preheader && tplSidecar) preheader = str(tplSidecar.preheader);
    if (Object.keys(design).length === 0 && tplSidecar && typeof tplSidecar.design === 'object' && tplSidecar.design) {
      design = tplSidecar.design;
    }
    // bump usageCount
    const bumped = buildTemplateSidecar(tplSidecar, { usageCount: (tplSidecar ? num(tplSidecar.usageCount) : 0) + 1 });
    const tplPatch = { body: JSON.stringify(bumped) };
    // A template still in its plain-text form (the seeded one) has its text in
    // `body`; the sidecar replaces that, so keep the text as its block.
    if (!tplSidecar && blocksOf(tpl).length === 0) tplPatch.blocks = effectiveBlocks(tpl, tplSidecar);
    write(app, tplRec, tplPatch);
  }
  const built = buildCampaignSidecar(null, {
    name: str(body.name).trim() || 'Untitled campaign',
    subject: subject,
    preheader: preheader,
    from_name: body.from_name,
    from_email: body.from_email,
    reply_to: body.reply_to,
    design: design,
    target_tags: body.target_tags,
    target_all: body.target_all === undefined ? true : body.target_all,
    status: 'draft',
  });
  const rec = create(app, 'campaigns', {
    subject: built.subjectField,
    body: JSON.stringify(built.sidecar),
    blocks: blocks,
    status: 'draft',
    recipients_count: 0,
    delivered_count: 0,
    deliver: false,
  });
  return rec;
}

/** campaigns.create: AppController.createCampaign (Campaigns modal, dashboard New, Start campaign). */
function campaignsCreate(app, p) {
  const templateId = has(p, 'template_id') ? str(p.template_id).trim() : '';
  let name = str(p.name).trim();
  if (!name) {
    // The UI's own names: MainView startCampaignFromTemplate / dashboard "New".
    name = templateId ? `${byId(app, 'templates', templateId).getString('name')} — campaign` : 'New campaign';
  }
  const body = asSent({ name: name, template_id: templateId || undefined, target_all: true });
  const rec = campaignCreateCore(app, body);
  return { campaign: withElided(toCampaignDetail(plain('campaigns', rec)), false) };
}

// ported from apiAdapter.ts handleCampaignUpdate()
function campaignUpdateCore(app, rec, body) {
  const cur = plain('campaigns', rec);
  const built = buildCampaignSidecar(parseSidecar(cur.body), body);
  const patch = { body: JSON.stringify(built.sidecar), subject: built.subjectField };
  if (body.blocks !== undefined) patch.blocks = Array.isArray(body.blocks) ? body.blocks : [];
  if (body.status !== undefined) {
    const s = str(body.status);
    if (s === 'sent' || s === 'draft') patch.status = s;
  }
  write(app, rec, patch);
  return toCampaignDetail(plain('campaigns', rec));
}

/** The campaign editor's autosave payload (AppController.saveCampaign). */
function saveCampaignLikeEditor(app, rec, campaign) {
  return campaignUpdateCore(
    app,
    rec,
    asSent({
      name: campaign.name,
      subject: campaign.subject,
      preheader: campaign.preheader,
      from_name: campaign.fromName || '',
      from_email: campaign.fromEmail || '',
      reply_to: campaign.replyTo || '',
      blocks: campaign.blocks || [],
      target_tags: campaign.targetTags,
      target_all: campaign.targetAll,
      design: campaign.design || {},
    }),
  );
}

function tagList(v) {
  let list = v;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s.startsWith('[')) {
      try {
        list = JSON.parse(s);
      } catch (_e) {
        throw fail(400, 'target_tags must be a comma-separated list or a JSON array');
      }
    } else list = s.split(',');
  }
  if (!Array.isArray(list)) throw fail(400, 'target_tags must be a comma-separated list or a JSON array');
  const out = [];
  for (const t of list) {
    const s = str(t).trim();
    if (s && out.indexOf(s) < 0) out.push(s);
  }
  return out;
}

/** campaigns.update: the editor's fields, then its autosave. */
function campaignsUpdate(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  const campaign = editable(rec);
  const fields = { name: 'name', subject: 'subject', preheader: 'preheader', from_name: 'fromName', from_email: 'fromEmail', reply_to: 'replyTo' };
  let changed = false;
  for (const k of Object.keys(fields)) {
    if (p[k] !== undefined && p[k] !== null) {
      campaign[fields[k]] = str(p[k]);
      changed = true;
    }
  }
  if (p.target_all !== undefined && p.target_all !== null && p.target_all !== '') {
    campaign.targetAll = coerceBool(p.target_all, true);
    changed = true;
  }
  const warnings = [];
  if (p.target_tags !== undefined && p.target_tags !== null) {
    campaign.targetTags = tagList(p.target_tags);
    changed = true;
    const known = tagCounts(all(app, 'subscribers', '').map((r) => plain('subscribers', r))).map((t) => t.name);
    for (const t of campaign.targetTags) if (known.indexOf(t) < 0) warnings.push(`tag "${t}" matches no subscriber`);
  }
  if (has(p, 'blocks')) {
    campaign.blocks = checkBlocks(jsonParam(p, 'blocks'));
    changed = true;
  }
  if (has(p, 'design')) {
    campaign.design = Object.assign({}, campaign.design || {}, checkDesign(jsonParam(p, 'design')));
    changed = true;
  }
  if (!changed) {
    throw fail(400, 'Give at least one of: name, subject, preheader, from_name, from_email, reply_to, target_all, target_tags, blocks, design');
  }
  const out = { campaign: withElided(saveCampaignLikeEditor(app, rec, campaign), false) };
  if (warnings.length) out.warnings = warnings;
  return out;
}

/** campaigns.ai-write: AIPanel -> generateCopy -> handleGenerate, then applyAI + autosave. */
function campaignsAiWrite(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  const campaign = editable(rec);
  const prompt = str(p.prompt).trim();
  if (!prompt) throw fail(400, 'prompt is required');
  const tone = enumParam(p, 'tone', ['friendly', 'professional', 'playful', 'concise', 'warm', 'persuasive'], 'friendly');
  const audience = str(p.audience).trim();
  const result = generate(prompt, tone, audience, true);
  // CampaignEditor.tsx applyAI
  campaign.subject = result.subject || campaign.subject || '';
  campaign.preheader = result.preheader || campaign.preheader || '';
  campaign.blocks = result.blocks;
  const saved = saveCampaignLikeEditor(app, rec, campaign);
  return { status: result.status, llmAvailable: result.llmAvailable, campaign: withElided(saved, false) };
}

// ported from apiAdapter.ts stubEmail()
function stubEmail(prompt, tone) {
  const base = (prompt || 'your latest update').trim().replace(/\.+$/, '');
  const short = (base || 'your latest update').slice(0, 60);
  return {
    subject: `${short.slice(0, 60)} — a quick note`,
    preheader: 'Connect an AI agent to this app to get AI-written copy.',
    blocks: [
      { type: 'heading', text: short.slice(0, 80), level: 1 },
      { type: 'text', text: `Hi {firstName}, here's a draft about ${short.slice(0, 120)}.` },
      {
        type: 'text',
        text: `This is a starter draft. Connect an AI agent to this app (CraftBot, or any agent harness running the app's bridge) to get real AI drafts in a ${tone.toLowerCase()} tone.`,
      },
      { type: 'button', label: 'Read more', url: 'https://example.com' },
      { type: 'text', text: 'Thanks for reading.\n— The team' },
    ],
  };
}

// ported from apiAdapter.ts bodyToBlocks()
function bodyToBlocks(subject, bodyText, includeCta) {
  const blocks = [];
  if (subject.trim()) blocks.push({ type: 'heading', text: subject.trim(), level: 1 });
  const paras = bodyText
    .split(/\n{2,}/)
    .map((x) => x.trim())
    .filter(Boolean);
  const list = paras.length > 0 ? paras : bodyText.trim() ? [bodyText.trim()] : [];
  for (const x of list) blocks.push({ type: 'text', text: x });
  if (includeCta) blocks.push({ type: 'button', label: 'Learn more', url: 'https://example.com' });
  return blocks;
}

/**
 * ported from apiAdapter.ts handleGenerate(); the LLM call and its parsing are
 * the ai.draft route's (ops.pb.js), copied because that route keeps them inline.
 */
function generate(promptIn, toneIn, audienceIn, includeCta) {
  const prompt = str(promptIn).trim() || 'Send a short update to our subscribers.';
  const tone = str(toneIn) || 'friendly';
  const audience = str(audienceIn).trim();
  const topic = audience ? `${prompt}\nAudience: ${audience}` : prompt;
  // --- ops.pb.js ai.draft ---
  const bridge = require(`${__hooks}/_craftbot_bridge.js`);
  const draftTone = String(tone || 'friendly and concise');
  const raw = bridge.callLLM(
    'Draft a short email newsletter about: ' +
      topic +
      '\nTone: ' +
      draftTone +
      '\n\nOutput format EXACTLY:\nSUBJECT: <one line>\n\n<newsletter body, 3-6 short paragraphs, plain text>',
    'You write crisp, engaging email newsletters.',
  );
  if (raw) {
    let draftSubject = topic;
    let draft = raw.trim();
    const match = draft.match(/^SUBJECT:\s*(.+)\n+([\s\S]*)$/);
    if (match) {
      draftSubject = match[1].trim();
      draft = match[2].trim();
    }
    // --- handleGenerate success branch ---
    const subject = str(draftSubject) || prompt.slice(0, 70);
    const blocks = bodyToBlocks(subject, str(draft), includeCta);
    return { status: 'ok', llmAvailable: true, subject: subject.slice(0, 255), preheader: '', blocks: blocks };
  }
  const stub = stubEmail(prompt, tone);
  return { status: 'stub', llmAvailable: false, subject: stub.subject, preheader: stub.preheader, blocks: stub.blocks };
}

// ported from apiAdapter.ts handleCampaignDuplicate()
function campaignsDuplicate(app, p) {
  const rec = plain('campaigns', byId(app, 'campaigns', requireId(p, 'campaign_id')));
  const prev = parseSidecar(rec.body);
  const built = buildCampaignSidecar(null, {
    name: `${prev ? str(prev.name) : str(rec.subject)} (copy)`,
    subject: prev && prev.subject !== undefined ? str(prev.subject) : str(rec.subject),
    preheader: prev ? str(prev.preheader) : '',
    from_name: prev ? prev.fromName : '',
    from_email: prev ? prev.fromEmail : '',
    reply_to: prev ? prev.replyTo : '',
    design: prev ? prev.design : {},
    target_tags: prev && Array.isArray(prev.targetTags) ? prev.targetTags : [],
    target_all: prev ? coerceBool(prev.targetAll, true) : true,
    status: 'draft',
  });
  const copy = create(app, 'campaigns', {
    subject: built.subjectField,
    body: JSON.stringify(built.sidecar),
    blocks: blocksOf(rec),
    status: 'draft',
    recipients_count: 0,
    delivered_count: 0,
    deliver: false,
  });
  return { campaign: withElided(toCampaignDetail(plain('campaigns', copy)), false) };
}

// ported from apiAdapter.ts handleCampaignDelete()
function campaignsDelete(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  const detail = toCampaignSummary(plain('campaigns', rec));
  let removed = 0;
  try {
    removed = Array.from(app.findRecordsByFilter('campaign_recipients', 'campaign = {:id}', '', 0, 0, { id: rec.id })).length;
  } catch (_e) {
    removed = 0;
  }
  app.delete(rec);
  return { deleted: rec.id, name: detail.name, status: detail.status, recipientsRemoved: removed };
}

function parseWhen(raw) {
  const s = str(raw).trim();
  if (!s) throw fail(400, 'scheduled_at is required');
  const iso = s.replace(' ', 'T');
  if (!/([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)) {
    throw fail(400, 'scheduled_at needs a time zone: end it with Z (UTC) or an offset such as +02:00');
  }
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw fail(400, 'scheduled_at is not a valid date and time');
  return d;
}

// ported from apiAdapter.ts handleCampaignSchedule()
function campaignsSchedule(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  editable(rec);
  const d = parseWhen(p.scheduled_at);
  if (d.getTime() <= Date.now()) {
    throw fail(
      400,
      'scheduled_at must be in the future. To send now, use campaigns.send-now (it asks the person for approval).',
    );
  }
  const cur = plain('campaigns', rec);
  const sc = buildCampaignSidecar(parseSidecar(cur.body), { status: 'scheduled', errorMessage: null }).sidecar;
  // Keep the column status "draft" so the minute scheduler records it on time.
  write(app, rec, { scheduled_at: d.toISOString(), status: 'draft', body: JSON.stringify(sc) });
  return { campaign: withElided(toCampaignDetail(plain('campaigns', rec)), false) };
}

// ported from apiAdapter.ts handleCampaignCancel()
function campaignsCancel(app, p) {
  const rec = byId(app, 'campaigns', requireId(p, 'campaign_id'));
  const cur = plain('campaigns', rec);
  const status = campaignStatus(cur, parseSidecar(cur.body));
  // The app offers Cancel only on scheduled campaigns (Campaigns.tsx, Schedule.tsx).
  if (status !== 'scheduled') throw fail(409, `Only a scheduled campaign can be cancelled (this one is ${status})`);
  const sc = buildCampaignSidecar(parseSidecar(cur.body), { status: 'cancelled' }).sidecar;
  write(app, rec, { scheduled_at: '', status: 'draft', body: JSON.stringify(sc) });
  return { campaign: withElided(toCampaignDetail(plain('campaigns', rec)), false) };
}

// ported from apiAdapter.ts handleCampaignSend() (the editor's Send now)
function campaignsSendNow(app, p) {
  const id = requireId(p, 'campaign_id');
  const rec = plain('campaigns', byId(app, 'campaigns', id));
  const status = campaignStatus(rec, parseSidecar(rec.body));
  if (status === 'sending') throw fail(409, 'already_sending');
  if (status === 'sent') throw fail(409, 'campaign already sent');
  const lock = 'newsletter_agent_send_' + id;
  const store = app.store();
  if (store.has(lock)) throw fail(409, 'already_sending');
  store.set(lock, true);
  let result;
  try {
    // Exactly the app's path: POST /api/ops/campaigns/send {deliver:false}
    // runs sendCampaign(app, id, false) (ops.pb.js, send.js).
    const send = require(`${__hooks}/send.js`);
    let r;
    try {
      r = send.sendCampaign(app, id, false);
    } catch (err) {
      throw fail(400, String((err && err.message) || err));
    }
    result = { sent: true, recipients: r.recipients, delivered: r.delivered, failed: r.failed, mode: r.mode };
  } finally {
    store.remove(lock);
  }
  // Ensure the logical sidecar status reflects "sent" too.
  const freshRec = byId(app, 'campaigns', id);
  const fresh = plain('campaigns', freshRec);
  if (str(fresh.status) === 'sent') {
    const sc = buildCampaignSidecar(parseSidecar(fresh.body), { status: 'sent', errorMessage: null }).sidecar;
    write(app, freshRec, { body: JSON.stringify(sc) });
  }
  return { campaign: withElided(toCampaignDetail(plain('campaigns', freshRec)), false), result: result };
}

/* ============================================================== blocks */

// @dnd-kit/sortable arrayMove (CampaignCanvas.tsx handleMove)
function arrayMove(array, from, to) {
  const next = array.slice();
  next.splice(to < 0 ? next.length + to : to, 0, next.splice(from, 1)[0]);
  return next;
}

/** blocks.edit: CampaignCanvas.tsx handleUpdate / handleMove / handleRemove and the palette's append. */
function blocksEdit(app, p) {
  const cid = has(p, 'campaign_id') ? str(p.campaign_id).trim() : '';
  const tid = has(p, 'template_id') ? str(p.template_id).trim() : '';
  if ((cid === '') === (tid === '')) throw fail(400, 'Give exactly one of campaign_id or template_id');
  const action = enumParam(p, 'action', ['add', 'update', 'move', 'remove'], '');
  if (!action) throw fail(400, 'action is required (add, update, move or remove)');
  let rec;
  let target;
  if (cid) {
    rec = byId(app, 'campaigns', cid);
    target = editable(rec);
  } else {
    rec = byId(app, 'templates', tid);
    target = toTemplate(plain('templates', rec));
  }
  const blocks = (target.blocks || []).slice();
  const indexOf = (key) => {
    const v = Number(p[key]);
    if (p[key] === undefined || p[key] === null || p[key] === '' || !Number.isInteger(v)) throw fail(400, `${key} is required (a block index)`);
    if (v < 0 || v >= blocks.length) {
      throw fail(400, `${key} ${v} is out of range (${blocks.length ? '0 to ' + (blocks.length - 1) : 'there are no blocks'})`);
    }
    return v;
  };
  let next = blocks;
  if (action === 'add') {
    const block = jsonParam(p, 'block');
    if (!block || typeof block !== 'object' || Array.isArray(block)) throw fail(400, 'block is required: a JSON object with a type');
    if (BLOCK_TYPES.indexOf(block.type) < 0) throw fail(400, `block.type must be one of: ${BLOCK_TYPES.join(', ')}`);
    const made = Object.assign({}, BLOCK_DEFAULTS[block.type], block);
    const bad = blockProblem(made, 'block');
    if (bad) throw fail(400, bad);
    next = blocks.concat([made]);
  } else if (action === 'update') {
    const i = indexOf('index');
    const patch = jsonParam(p, 'block');
    if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw fail(400, 'block is required: a JSON object of the fields to change');
    if (patch.type !== undefined && patch.type !== blocks[i].type) throw fail(400, 'a block keeps its type; remove it and add a new one instead');
    const merged = Object.assign({}, blocks[i], patch);
    const bad = blockProblem(merged, `blocks[${i}]`);
    if (bad) throw fail(400, bad);
    next = blocks.slice();
    next[i] = merged;
  } else if (action === 'move') {
    const from = indexOf('index');
    const to = indexOf('to');
    if (from === to) next = blocks;
    else next = arrayMove(blocks, from, to);
  } else {
    const i = indexOf('index');
    next = blocks.slice();
    next.splice(i, 1);
  }
  target.blocks = next;
  const saved = cid ? saveCampaignLikeEditor(app, rec, target) : saveTemplateLikeEditor(app, rec, target);
  return {
    count: saved.blocks.length,
    blocks: saved.blocks.map(summaryOfBlock),
    updatedAt: saved.updatedAt,
  };
}

/* ============================================================ settings */

function settingsRecord(app) {
  // apiAdapter.ts getSettingsRecord(): the first row by `updated`.
  return Array.from(app.findRecordsByFilter('settings', "id != ''", 'updated', 1, 0))[0] || null;
}

function settingsView(rec) {
  // Any host's model: CraftBot's bridge or a running framework bridge (_craftbot_bridge.llmAvailable).
  const configured = require(`${__hooks}/_craftbot_bridge.js`).llmAvailable();
  const s = rec ? plain('settings', rec) : null;
  return {
    fromName: s ? str(s.sender_name) : '',
    fromEmail: s ? str(s.sender_email) : '',
    replyTo: s ? str(s.reply_to) : '',
    organizationName: s ? str(s.organization_name) : '',
    organizationAddress: s ? str(s.organization_address) : '',
    updatedAt: s ? toIso(s.updated) : null,
    // The Settings screen's Integrations card: email delivery is never connected (sends are recorded only).
    integrations: { llm: { connected: configured }, emailDelivery: { connected: false } },
  };
}

function settingsGet(app) {
  return settingsView(settingsRecord(app));
}

// Settings form field (agent param) -> settings column, as handleSenderIdentityUpdate maps them.
const SETTINGS_FIELDS = {
  from_name: 'sender_name',
  from_email: 'sender_email',
  reply_to: 'reply_to',
  organization_name: 'organization_name',
  organization_address: 'organization_address',
};

// ported from apiAdapter.ts handleSenderIdentityUpdate()
function settingsUpdate(app, p) {
  const patch = {};
  for (const k of Object.keys(SETTINGS_FIELDS)) {
    if (p[k] !== undefined && p[k] !== null) patch[SETTINGS_FIELDS[k]] = str(p[k]).trim();
  }
  if (Object.keys(patch).length === 0) throw fail(400, `Give at least one of: ${Object.keys(SETTINGS_FIELDS).join(', ')}`);
  let rec = settingsRecord(app);
  if (!rec) rec = create(app, 'settings', { sender_name: '', sender_email: '' });
  write(app, rec, patch);
  return settingsView(rec);
}

module.exports = {
  run: run,
  guide: guide,
  dashboard: dashboard,
  subscribersList: subscribersList,
  subscribersAdd: subscribersAdd,
  subscribersImport: subscribersImport,
  templatesList: templatesList,
  templatesGet: templatesGet,
  templatesCreate: templatesCreate,
  templatesUpdate: templatesUpdate,
  templatesDuplicate: templatesDuplicate,
  templatesDelete: templatesDelete,
  campaignsList: campaignsList,
  campaignsGet: campaignsGet,
  campaignsPreview: campaignsPreview,
  campaignsCreate: campaignsCreate,
  campaignsUpdate: campaignsUpdate,
  campaignsDuplicate: campaignsDuplicate,
  campaignsDelete: campaignsDelete,
  campaignsSchedule: campaignsSchedule,
  campaignsCancel: campaignsCancel,
  campaignsSendNow: campaignsSendNow,
  campaignsAiWrite: campaignsAiWrite,
  blocksEdit: blocksEdit,
  settingsGet: settingsGet,
  settingsUpdate: settingsUpdate,
};
