/// <reference path="../pb_data/types.d.ts" />
/**
 * Music and talent verbs: song completeness, the singing-stream setlist
 * check, songs used before registration, neighbouring-right terms, new
 * recording versions, Content ID conflicts, the pre-stream check, talent
 * exposure and graduation, third-party permission re-checks, guidelines
 * and fan permits.
 */

/* ------------------------------------------------------------------ */
/* Music                                                               */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/music/completeness', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const s = require(`${__hooks}/lib_ops.js`).need(e.app, 'songs', b.song_id, 'Song', '楽曲');
    return require(`${__hooks}/lib_music.js`).completeness(e.app, s);
  }),
);

routerAdd('POST', '/api/ops/music/setlist-check', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const items = o.list(b.items).map((x) => o.obj(x));
    if (!items.length) throw ctx.u.err('Add at least one song to the setlist.', 'セットリストに1曲以上追加してください。');
    if (items.length > 200) throw ctx.u.err('Check at most 200 songs at a time.', '一度に確認できるのは200曲までです。');
    return { items: require(`${__hooks}/lib_music.js`).setlistCheck(e.app, items), blanket_platforms: require(`${__hooks}/lib_music.js`).BLANKET_PLATFORMS };
  }),
);

routerAdd('POST', '/api/ops/music/unregistered', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', () => ({ songs: require(`${__hooks}/lib_music.js`).usedButUnregistered(e.app) })),
);

routerAdd('POST', '/api/ops/music/neighbouring-terms', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const r = require(`${__hooks}/lib_ops.js`).need(e.app, 'recordings', b.recording_id, 'Recording', '原盤');
    return require(`${__hooks}/lib_music.js`).neighbouringTerms(e.app, r);
  }),
);

// A new version of a recording (TV size, instrumental, live, remix): every version needs its own ISRC.
routerAdd('POST', '/api/ops/music/new-version', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const music = require(`${__hooks}/lib_music.js`);
    const src = o.need(e.app, 'recordings', b.recording_id, 'Recording', '原盤');
    const vt = o.str(b.version_type);
    const types = ['studio', 'tv_size', 'instrumental', 'a_cappella', 'live', 'remix', 'cover', 'music_video', 'other'];
    if (types.indexOf(vt) < 0) throw u.err('Choose the version type.', 'バージョンの種類を選んでください。');
    const isrc = o.str(b.isrc);
    if (isrc && !music.validIsrc(isrc)) throw u.err('That ISRC is not valid (CC-XXX-YY-NNNNN).', 'ISRCの形式が正しくありません（CC-XXX-YY-NNNNN）。');
    if (isrc && music.normIsrc(isrc) === music.normIsrc(src.getString('isrc'))) throw u.err('A new version needs its own ISRC.', '新しいバージョンには別のISRCが必要です。');
    const label = { tv_size: 'TV size', instrumental: 'Instrumental', a_cappella: 'A cappella', live: 'Live', remix: 'Remix', cover: 'Cover', music_video: 'Music video', studio: 'Studio', other: 'Version' }[vt];
    const rec = u.newRecord(e.app, 'recordings', {
      title: o.str(b.title) || src.getString('title') + ' (' + label + ')',
      song: src.getString('song'),
      songs: u.ids(src, 'songs'),
      song_shares: u.j(src, 'song_shares', []),
      isrc: isrc ? music.formatIsrc(isrc) : '',
      version_type: vt,
      recording_date: u.toPb(o.str(b.recording_date)),
      p_line: src.getString('p_line'),
      master_owners: u.j(src, 'master_owners', []),
      virtual_singer: src.getBool('virtual_singer'),
      virtual_singer_note: src.getString('virtual_singer_note'),
      captured_in_av: vt === 'music_video' || vt === 'live' ? src.getBool('captured_in_av') : false,
      talents: u.ids(src, 'talents'),
      characters: u.ids(src, 'characters'),
      status: 'draft',
      parent: src.id,
    });
    e.app.save(rec);
    let copied = 0;
    for (const inv of u.findMany(e.app, 'involvements', 'recording = {:r}', '', 0, { r: src.id })) {
      if (vt === 'instrumental' && ['singer', 'performer', 'voice_actor'].indexOf(inv.getString('role')) >= 0 && inv.getBool('featured')) continue;
      e.app.save(
        u.newRecord(e.app, 'involvements', {
          party: inv.getString('party'),
          role: inv.getString('role'),
          recording: rec.id,
          share: inv.getFloat('share'),
          shares: u.j(inv, 'shares', {}),
          credit_name: inv.getString('credit_name'),
          featured: inv.getBool('featured'),
        }),
      );
      copied += 1;
    }
    u.audit(e.app, ctx.actor, 'create', 'recordings', rec.id, rec.getString('title'), { parent: src.id, version_type: vt }, '');
    return {
      id: rec.id,
      title: rec.getString('title'),
      credits_copied: copied,
      warnings: isrc ? [] : [u.bi('Assign an ISRC before release. Every version needs its own.', 'リリース前にISRCを付与してください。バージョンごとに別のコードが必要です。')],
    };
  }),
);

routerAdd('POST', '/api/ops/content-id/conflicts', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', () => ({ conflicts: require(`${__hooks}/lib_music.js`).ownershipConflicts(e.app) })),
);

// Record a Content ID step on a claim (dispute or appeal received, resolved); the engine dates the reply.
routerAdd('POST', '/api/ops/content-id/claim-event', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const o = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const c = o.need(e.app, 'content_id_claims', b.claim_id, 'Claim', '申し立て');
    const code = o.str(b.code);
    if (['CID_DISPUTE_RECEIVED', 'CID_APPEAL_RECEIVED', 'CID_RESOLVED'].indexOf(code) < 0) throw ctx.u.err('Unknown Content ID step.', '不明なContent IDの手順です。');
    const date = ctx.u.d10(b.date) || ctx.u.today();
    // A preview computes the reply deadline only: no event, no status change.
    if (o.bool(b.preview)) return { preview: true, proposals: engine.proposalsFor(e.app, engine.subjectFromRecord('claim', c), { code: code, date: date, data: {} }) };
    const res = engine.recordEvent(e.app, engine.subjectFromRecord('claim', c), code, date, { source: 'manual', actorId: ctx.actor });
    return { event: res.event.id, created: res.created.length, proposals: res.proposals };
  }),
);

/* ------------------------------------------------------------------ */
/* Talent                                                              */
/* ------------------------------------------------------------------ */

routerAdd('POST', '/api/ops/talents/pre-stream-check', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const o = require(`${__hooks}/lib_ops.js`);
    return require(`${__hooks}/lib_talent.js`).preStreamCheck(e.app, {
      talent: o.str(b.talent_id),
      title: o.str(b.title),
      permission: o.str(b.permission_id),
      platform: o.str(b.platform),
      monetization: o.list(b.monetization).map(String),
      date: o.str(b.date),
    });
  }),
);

routerAdd('POST', '/api/ops/talents/exposure', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'read', (b) => {
    const t = require(`${__hooks}/lib_ops.js`).need(e.app, 'talents', b.talent_id, 'Talent', 'タレント');
    return require(`${__hooks}/lib_talent.js`).exposure(e.app, t);
  }),
);

/**
 * Lifecycle change for a talent (debut, hiatus, suspension, graduation,
 * termination): records the event, which moves the lifecycle and lays out
 * the playbook deadlines. preview=true returns the playbook without saving.
 */
routerAdd('POST', '/api/ops/talents/lifecycle', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'talent', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const t = o.need(e.app, 'talents', b.talent_id, 'Talent', 'タレント');
    const code = o.str(b.code);
    const codes = ['DEBUT_SCHEDULED', 'DEBUTED', 'HIATUS', 'SUSPENDED', 'RESUMED', 'GRADUATION_SCHEDULED', 'GRADUATED', 'TERMINATED'];
    if (codes.indexOf(code) < 0) throw u.err('Unknown lifecycle step.', '不明なライフサイクルの手順です。');
    const date = u.d10(b.date) || u.today();
    if (code === 'GRADUATION_SCHEDULED' && !u.d10(b.graduation_date) && !u.d10(t.getString('graduation_date'))) {
      throw u.err('Give the last day of activity (graduation_date).', '最終活動日（graduation_date）を入力してください。');
    }
    if (code === 'DEBUT_SCHEDULED' && !u.d10(b.debut_date) && !u.d10(t.getString('debut_date'))) throw u.err('Give the debut date.', 'デビュー日を入力してください。');
    if ((code === 'SUSPENDED' || code === 'TERMINATED') && o.str(b.reason) === '') throw u.err('Give the reason. It stays in the audit log only.', '理由を入力してください（監査ログにのみ記録されます）。');
    const preview = o.bool(b.preview);
    if (preview) {
      const subj = engine.subjectFromRecord('talent', t);
      if (u.d10(b.graduation_date)) t.set('graduation_date', u.toPb(b.graduation_date));
      if (u.d10(b.debut_date)) t.set('debut_date', u.toPb(b.debut_date));
      subj.record = t;
      return { preview: true, proposals: engine.proposalsFor(e.app, subj, { code: code, date: date, data: {} }) };
    }
    // Record the event before the dates are saved: the talents hook records a
    // system GRADUATION_SCHEDULED / DEBUT_SCHEDULED event when it sees a new
    // date and no event, which would double the playbook.
    if (u.d10(b.graduation_date)) t.set('graduation_date', u.toPb(b.graduation_date));
    if (u.d10(b.debut_date)) t.set('debut_date', u.toPb(b.debut_date));
    const res = engine.recordEvent(e.app, engine.subjectFromRecord('talent', t), code, date, {
      source: 'manual',
      actorId: ctx.actor,
      data: { reason_logged: o.str(b.reason) !== '' },
      select: b.select !== undefined ? o.list(b.select).map(String) : undefined,
      skip: o.list(b.skip).map(String),
      assignees: o.list(b.assignees).map((x) => o.obj(x)),
    });
    const saved = u.byId(e.app, 'talents', t.id);
    let dirty = false;
    for (const k of ['graduation_date', 'debut_date']) {
      if (u.d10(b[k]) && u.d10(saved.getString(k)) !== u.d10(b[k])) {
        saved.set(k, u.toPb(b[k]));
        dirty = true;
      }
    }
    if (dirty) e.app.save(saved);
    if (o.str(b.reason)) u.audit(e.app, ctx.actor, 'lifecycle', 'talents', t.id, t.getString('stage_name'), { code: code }, o.str(b.reason));
    const after = u.byId(e.app, 'talents', t.id);
    return { lifecycle: after.getString('lifecycle'), created: res.created.length, exposure: code === 'GRADUATION_SCHEDULED' || code === 'TERMINATED' || code === 'SUSPENDED' ? require(`${__hooks}/lib_talent.js`).exposure(e.app, after) : null };
  }),
);

/* ------------------------------------------------------------------ */
/* Third-party permissions, guidelines, fan permits                    */
/* ------------------------------------------------------------------ */

// "I re-read the publisher's guideline today": closes the open re-check and schedules the next one.
routerAdd('POST', '/api/ops/permissions/recheck', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const engine = require(`${__hooks}/lib_engine.js`);
    const p = o.need(e.app, 'permissions', b.permission_id, 'Permission', '許諾');
    const changed = o.bool(b.changed);
    if (changed && o.str(b.note) === '') throw u.err('Say what changed in the guideline.', 'ガイドラインの変更点を記入してください。');
    const today = u.today();
    let closed = 0;
    for (const d of u.findMany(e.app, 'deadlines', 'permission = {:p} && status = "open" && key ~ {:k}', '', 0, { p: p.id, k: 'obl:permission:' + p.id + ':recheck:%' })) {
      engine.closeDeadline(e.app, d, 'done', changed ? 'Guideline changed: ' + o.str(b.note) : 'Re-checked, no change', ctx.actor, today);
      closed += 1;
    }
    p.set('last_checked', u.toPb(today));
    if (changed) {
      if (u.d10(b.revision)) p.set('guideline_revision', u.toPb(b.revision));
      p.set('notes', (p.getString('notes') ? p.getString('notes') + '\n' : '') + today + ': ' + o.str(b.note));
      const st = o.str(b.status);
      if (['active', 'pending_application', 'expired', 'revoked', 'suspended'].indexOf(st) >= 0) p.set('status', st);
    }
    e.app.save(p);
    u.audit(e.app, ctx.actor, 'recheck', 'permissions', p.id, p.getString('title'), { changed: changed }, o.str(b.note));
    if (changed) {
      const talents = p.getBool('all_talents') ? u.findMany(e.app, 'talents', 'lifecycle = "active"', '', 0) : u.ids(p, 'talents').map((id) => u.byId(e.app, 'talents', id)).filter(Boolean);
      const told = {};
      for (const t of talents) {
        for (const uid of u.ids(t, 'managers')) {
          if (told[uid]) continue;
          told[uid] = true;
          u.notify(e.app, uid, 'info', u.bi('Guideline changed: ' + p.getString('title'), 'ガイドライン変更：' + p.getString('title')), u.bi(o.str(b.note), o.str(b.note)), '#/permissions/' + p.id, { permission: p.id });
        }
      }
    }
    return { id: p.id, last_checked: today, closed: closed, status: u.byId(e.app, 'permissions', p.id).getString('status') };
  }),
);

// Copy a starter template into an editable draft.
routerAdd('POST', '/api/ops/guidelines/from-template', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const t = o.need(e.app, 'guidelines', b.template_id, 'Template', 'テンプレート');
    if (!t.getBool('template')) throw u.err('That guideline is not a template.', 'そのガイドラインはテンプレートではありません。');
    const rec = u.newRecord(e.app, 'guidelines', {
      title: o.str(b.title) || t.getString('title'),
      kind: t.getString('kind'),
      franchise: o.str(b.franchise_id),
      talent: o.str(b.talent_id),
      characters: o.list(b.characters).map(String),
      version: '1.0',
      languages: u.j(t, 'languages', ['ja', 'en']),
      body: t.getString('body'),
      body_ja: t.getString('body_ja'),
      status: 'draft',
      template: false,
    });
    e.app.save(rec);
    u.audit(e.app, ctx.actor, 'create', 'guidelines', rec.id, rec.getString('title'), { template: t.id }, '');
    return { id: rec.id, title: rec.getString('title') };
  }),
);

// Publish a draft; the previous published guideline for the same scope becomes superseded.
routerAdd('POST', '/api/ops/guidelines/publish', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'manage', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const g = o.need(e.app, 'guidelines', b.guideline_id, 'Guideline', 'ガイドライン');
    if (g.getBool('template')) throw u.err('Copy the template into a draft before publishing.', '公開する前にテンプレートを下書きにコピーしてください。');
    if (g.getString('status') !== 'draft') throw u.err('Only a draft can be published.', '公開できるのは下書きのみです。');
    if (!o.str(b.version) && !g.getString('version')) throw u.err('Give a version number.', 'バージョン番号を入力してください。');
    const eff = u.d10(b.effective_date) || u.today();
    let superseded = '';
    const prev = u.findMany(e.app, 'guidelines', 'status = "published" && kind = {:k} && franchise = {:f} && talent = {:t} && id != {:id}', '-effective_date', 0, {
      k: g.getString('kind'),
      f: g.getString('franchise'),
      t: g.getString('talent'),
      id: g.id,
    });
    for (const p of prev) {
      p.set('status', 'superseded');
      e.app.save(p);
      if (!superseded) superseded = p.id;
    }
    if (superseded && !g.getString('supersedes')) g.set('supersedes', superseded);
    if (o.str(b.version)) g.set('version', o.str(b.version));
    if (o.str(b.changelog)) g.set('changelog', o.str(b.changelog));
    if (o.str(b.url)) g.set('url', o.str(b.url));
    g.set('effective_date', u.toPb(eff));
    g.set('status', 'published');
    e.app.save(g);
    u.audit(e.app, ctx.actor, 'publish', 'guidelines', g.id, g.getString('title') + ' ' + g.getString('version'), { superseded: prev.length }, o.str(b.changelog));
    return { id: g.id, version: g.getString('version'), effective_date: eff, superseded: prev.map((p) => p.id) };
  }),
);

// Approve, reject, suspend or revoke a fan permit (clip channel, fan permit, one-day event licence).
routerAdd('POST', '/api/ops/fan/decide', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'edit', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const f = o.need(e.app, 'fan_registrations', b.registration_id, 'Fan permit', '個人許諾');
    const decision = o.str(b.decision);
    const map = { approve: 'approved', activate: 'active', reject: 'rejected', suspend: 'suspended', revoke: 'revoked' };
    if (!map[decision]) throw u.err('Decide approve, activate, reject, suspend or revoke.', '承認・有効化・却下・停止・取消のいずれかを選んでください。');
    if (decision !== 'approve' && decision !== 'activate' && o.str(b.reason) === '') throw u.err('Give the reason.', '理由を入力してください。');
    const from = f.getString('status');
    f.set('status', map[decision]);
    if ((decision === 'approve' || decision === 'activate') && !u.d10(f.getString('start_date'))) f.set('start_date', u.toPb(u.today()));
    if (u.d10(b.end_date)) f.set('end_date', u.toPb(b.end_date));
    if (b.royalty_pct !== undefined && b.royalty_pct !== '') f.set('royalty_pct', o.num(b.royalty_pct));
    if (b.seals_issued !== undefined && b.seals_issued !== '') f.set('seals_issued', o.num(b.seals_issued));
    if (o.str(b.guideline_id)) f.set('guideline', o.str(b.guideline_id));
    if (o.str(b.reason)) f.set('notes', (f.getString('notes') ? f.getString('notes') + '\n' : '') + u.today() + ' ' + map[decision] + ': ' + o.str(b.reason));
    e.app.save(f);
    u.audit(e.app, ctx.actor, 'decide', 'fan_registrations', f.id, f.getString('permission_no') + ' ' + f.getString('applicant_name'), { status: [from, map[decision]] }, o.str(b.reason));
    return { id: f.id, permission_no: f.getString('permission_no'), status: map[decision] };
  }),
);
