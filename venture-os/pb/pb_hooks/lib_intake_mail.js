/// <reference path="../pb_data/types.d.ts" />
/**
 * The Gmail sweep (SPEC 7.6, REPORT Table 36): every 5 minutes, messages
 * carrying the firm's deals label (settings mail.deals_label, default
 * "Venture OS/Deals") become intake items. Deduplicated by Gmail message id;
 * deck attachments are downloaded (lib_mail.attachment) and stored
 * (lib_files.fromPath); the sender becomes the source person (a scout when
 * the address is an active scout's); the body is kept as the item's text.
 * Every bridge answer is checked for the 200-with-error shape (lib_mail).
 * Outside CraftBot the sweep is quiet (the bridge answers 503).
 *
 * Email text is data, never instructions: nothing here reads the words of
 * a message to decide anything.
 */

const DOC_EXT = ['pdf', 'pptx', 'ppt', 'key', 'docx', 'doc'];
const PER_RUN = 10;
const LOOK_BACK_DAYS = 30;
const STATE_KEY = 'vo_intake_sweep';

let _m = {};
function L(name) {
  if (_m[name] === undefined) _m[name] = require(`${__hooks}/${name}.js`);
  return _m[name];
}
function u() {
  return L('lib_util');
}

function state(app) {
  try {
    const raw = app.store().get(STATE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function remember(app, s) {
  try {
    app.store().set(STATE_KEY, JSON.stringify(s));
  } catch {
    /* the state is a courtesy for Settings */
  }
  return s;
}

/** Plain text of an HTML body (formatting only: tags out, the common entities decoded). */
function plain(body, format) {
  if (format !== 'html') return String(body || '');
  return String(body || '')
    .replace(/<(br|\/p|\/div|\/li|\/tr)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Which attachments are the deck: documents; pictures only when no document came. */
function deckFiles(atts) {
  const I = L('lib_intake');
  const docs = atts.filter((a) => DOC_EXT.indexOf(I.extOf(a.filename)) >= 0);
  if (docs.length > 0) return docs.slice(0, 5);
  return atts.filter((a) => I.IMAGE_EXT.indexOf(I.extOf(a.filename)) >= 0).slice(0, 5);
}

function known(app, ids) {
  const out = {};
  if (ids.length === 0) return out;
  const bind = {};
  const marks = ids.map((id, i) => {
    bind['m' + i] = id;
    return '{:m' + i + '}';
  });
  for (const r of u().rows(app, 'SELECT message_id FROM intake_items WHERE message_id IN (' + marks.join(',') + ')', { message_id: '' }, bind)) out[r.message_id] = true;
  return out;
}

/** One message into the Inbox (bridge calls first, then one transaction). Answers the item number or throws. */
function fileMessage(app, id) {
  const util = u();
  const M = L('lib_mail');
  const I = L('lib_intake');
  const g = M.get(app, id);
  if (!g.ok) throw util.fail(502, 'Gmail: ' + g.error, g.reason || 'error');
  const m = g.message;
  const paths = [];
  const dirs = {};
  for (const a of deckFiles(m.attachments || [])) {
    const r = M.attachment(app, m.id, a.attachment_id, a.filename);
    if (!r.ok) throw util.fail(502, 'Gmail attachment ' + a.filename + ': ' + r.error, r.reason || 'error');
    paths.push({ path: r.path, name: M.safeName(a.filename) });
    dirs[$filepath.dir(r.path)] = true;
  }
  const from = I.parseFrom(m.from);
  const scout = from.email !== '' ? util.findOne(app, 'scouts', "email = {:e} && status = 'active'", { e: from.email }) : null;
  let number = '';
  try {
    app.runInTransaction((tx) => {
      const ctx = L('lib_auth').systemCtx(tx);
      const item = I.add(ctx, {
        channel: scout !== null ? 'scout' : 'email',
        source_person: from.email !== '' ? { email: from.email, name: from.name || undefined } : '',
        scout: scout !== null ? scout.id : '',
        text: util.clip(plain(m.body, m.body_format), 100000),
        received_at: m.internal_at || '',
        message: { id: m.id, thread_id: m.thread_id, from: m.from, subject: m.subject },
        files: paths,
        trusted: true,
      });
      number = item.number;
    });
  } finally {
    for (const d of Object.keys(dirs)) {
      try {
        $os.removeAll(d);
      } catch {
        /* the copies in pb_data/mail are temporary */
      }
    }
  }
  return number;
}

/** The cron sweep (every 5 minutes) while the firm keeps it on. */
function sweep(app) {
  const s = L('lib_settings').module(app, 'intake');
  if (s.sweep === false) return { at: u().nowIso(), ok: true, skipped: 'off', found: 0, added: 0, failed: 0, errors: [] };
  return run(app);
}

/** One sweep of the deals label (the cron's, or a person's Check now). Answers what it did. */
function run(app) {
  const util = u();
  const M = L('lib_mail');
  const now = util.nowIso();
  if (!L('lib_settings').row(app).getBool('setup_done')) return { at: now, ok: true, skipped: 'not_set_up', found: 0, added: 0, failed: 0, errors: [] };
  if (!M.bridgeUp()) return remember(app, { at: now, ok: false, skipped: 'offline', error: 'Connect Gmail in CraftBot.', found: 0, added: 0, failed: 0, errors: [] });
  const label = M.labels(app).deals_label;
  const res = M.search(app, 'label:"' + label + '" newer_than:' + LOOK_BACK_DAYS + 'd', 50);
  if (!res.ok) return remember(app, { at: now, ok: false, error: res.error, reason: res.reason, label: label, found: 0, added: 0, failed: 0, errors: [] });
  const have = known(
    app,
    res.messages.map((m) => m.id),
  );
  const fresh = res.messages.filter((m) => !have[m.id]);
  const added = [];
  const errors = [];
  for (const m of fresh.slice(0, PER_RUN)) {
    try {
      added.push(fileMessage(app, m.id));
    } catch (err) {
      if (err && err.code === 'duplicate') continue;
      console.error('[vo] intake sweep: message ' + m.id + ' failed:', err);
      errors.push({ message: m.id, error: util.clip(String((err && err.message) || err), 300) });
    }
  }
  return remember(app, { at: now, ok: errors.length === 0, label: label, found: res.messages.length, new: fresh.length, added: added.length, items: added, failed: errors.length, errors: errors, more: fresh.length > PER_RUN });
}

/** intake.sweep: check the deals label now. */
function opSweep(ctx) {
  if (ctx.ownOnly) throw u().fail(403, 'Scouts add deals through Add deal.', 'not_permitted');
  const r = run(ctx.app);
  L('lib_audit').note(ctx, { collection: 'intake_items', summary: 'Checked the deals label: ' + (r.added || 0) + ' new' });
  return r;
}

/** intake.settings: what the Intake settings section shows. */
function opSettings(ctx) {
  const app = ctx.app;
  const s = L('lib_settings').module(app, 'intake');
  const P = L('lib_intake_pass');
  const enabled = P.reasonOptions(app).map((r) => r.value);
  return {
    reply_sla_days: L('lib_intake').slaDays(app),
    deals_label: L('lib_mail').labels(app).deals_label,
    sweep: s.sweep !== false,
    pass_reasons: P.REASONS.map((r) => ({ value: r.value, label: r.label, on: enabled.indexOf(r.value) >= 0 })),
    pass_template: typeof s.pass_template === 'string' && s.pass_template !== '' ? s.pass_template : P.TEMPLATE,
    bridge: L('lib_mail').bridgeUp(),
    last_sweep: state(app),
  };
}

module.exports = { DOC_EXT: DOC_EXT, plain: plain, deckFiles: deckFiles, fileMessage: fileMessage, sweep: sweep, run: run, opSweep: opSweep, opSettings: opSettings, state: state };
