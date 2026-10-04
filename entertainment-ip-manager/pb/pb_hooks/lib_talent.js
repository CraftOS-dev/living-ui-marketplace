/// <reference path="../pb_data/types.d.ts" />
/**
 * Talents: the pre-stream check and talent summaries.
 *
 * Agencies stream games under each publisher's terms. Many public
 * guidelines cover individuals only (Nintendo's, for example), so agency
 * talents need a corporate agreement or an application; others limit
 * monetization, platforms, spoilers or game music. A permission record
 * holds those terms; the check answers allowed / needs application /
 * blocked for one talent, title, platform and monetization method, and
 * names the permission that decides it.
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

/**
 * q: { talent, title (free text), permission (id, optional), platform, monetization: [ads, super_chat, membership, sponsored], date }
 */
function preStreamCheck(app, q) {
  const u = u_();
  const talent = q.talent ? u.byId(app, 'talents', q.talent) : null;
  const date = u.d10(q.date) || u.today();
  const platform = String(q.platform || '').toUpperCase();
  const wanted = u.asArray(q.monetization).map(function (m) {
    return String(m);
  });
  const reasons = [];
  let verdict = 'allowed';
  function worsen(v) {
    const rank = { allowed: 0, needs_application: 1, blocked: 2 };
    if (rank[v] > rank[verdict]) verdict = v;
  }
  if (talent !== null) {
    const life = talent.getString('lifecycle');
    if (life === 'suspended' || life === 'graduated' || life === 'terminated' || life === 'alumni') {
      reasons.push({ level: 'block', text: u.bi(talent.getString('stage_name') + ' is not active (' + life + ').', talent.getString('stage_name') + 'は活動中ではありません。') });
      worsen('blocked');
    }
  }
  let candidates = [];
  if (q.permission) {
    const p = u.byId(app, 'permissions', q.permission);
    if (p) candidates = [p];
  } else {
    const title = String(q.title || '').trim().toLowerCase();
    for (const p of u.findMany(app, 'permissions', 'permission_type = "game_title" || permission_type = "platform_blanket"', '', 0)) {
      const subj = String(p.getString('subject_name') || p.getString('title')).toLowerCase();
      if (p.getString('permission_type') === 'game_title' && title && subj.indexOf(title) < 0 && title.indexOf(subj) < 0) continue;
      if (p.getString('permission_type') === 'game_title' && !title) continue;
      if (p.getString('permission_type') === 'game_title') candidates.push(p);
    }
  }
  if (!candidates.length) {
    reasons.push({
      level: 'warn',
      text: u.bi(
        'No permission on file for this title. Check the publisher\'s guideline: many cover individuals only, so agency talents need a licence or an application.',
        'このタイトルの許諾が登録されていません。公開ガイドラインは個人のみ対象のことが多く、事務所所属タレントには契約か申請が必要です。',
      ),
    });
    worsen('needs_application');
    return { verdict: verdict, permission: null, reasons: reasons };
  }
  // Prefer a permission that covers this talent.
  let perm = null;
  for (const p of candidates) {
    if (p.getBool('all_talents') || !talent || u.ids(p, 'talents').indexOf(talent.id) >= 0) {
      perm = p;
      break;
    }
  }
  if (perm === null) {
    perm = candidates[0];
    reasons.push({ level: 'warn', text: u.bi('"' + perm.getString('title') + '" does not list ' + (talent ? talent.getString('stage_name') : 'this talent') + '.', '「' + perm.getString('title') + '」の対象に' + (talent ? talent.getString('stage_name') : 'このタレント') + 'が含まれていません。') });
    worsen('needs_application');
  }
  const name = perm.getString('title');
  const st = perm.getString('status');
  if (st === 'pending_application') {
    reasons.push({ level: 'warn', text: u.bi('The application for "' + name + '" is still pending.', '「' + name + '」の申請は審査中です。') });
    worsen('needs_application');
  } else if (st !== 'active') {
    reasons.push({ level: 'block', text: u.bi('"' + name + '" is ' + st.replace(/_/g, ' ') + '.', '「' + name + '」は有効ではありません（' + st + '）。') });
    worsen('blocked');
  }
  const start = u.d10(perm.getString('start_date'));
  const end = u.d10(perm.getString('end_date'));
  if ((start && date < start) || (end && date > end)) {
    reasons.push({ level: 'block', text: u.bi('"' + name + '" runs ' + (start ? u.human(start) : '') + ' to ' + (end ? u.human(end) : 'open') + '.', '「' + name + '」の期間は' + (start ? u.humanJa(start) : '') + 'から' + (end ? u.humanJa(end) : '期限なし') + 'です。') });
    worsen('blocked');
  }
  const plats = u.j(perm, 'platforms', []);
  if (Array.isArray(plats) && plats.length && platform && plats.map(function (x) { return String(x).toUpperCase(); }).indexOf(platform) < 0) {
    reasons.push({ level: 'block', text: u.bi('"' + name + '" does not cover ' + platform + '.', '「' + name + '」は' + platform + 'を対象としていません。') });
    worsen('blocked');
  }
  const mon = u.j(perm, 'monetization', []);
  if (wanted.length && Array.isArray(mon)) {
    const missing = wanted.filter(function (m) {
      return mon.indexOf(m) < 0;
    });
    if (missing.length) {
      reasons.push({ level: 'block', text: u.bi('Not allowed under "' + name + '": ' + missing.join(', ') + '.', '「' + name + '」で認められていない収益化：' + missing.join('、') + '。') });
      worsen('blocked');
    }
  }
  if (perm.getString('content_limits')) {
    reasons.push({ level: 'info', text: u.bi('Limits: ' + perm.getString('content_limits'), '制限事項：' + perm.getString('content_limits')) });
  }
  if (perm.getString('credit_line')) {
    reasons.push({ level: 'info', text: u.bi('Credit: ' + perm.getString('credit_line'), 'クレジット表記：' + perm.getString('credit_line')) });
  }
  if (perm.getString('archive') === 'live_only') {
    reasons.push({ level: 'warn', text: u.bi('Live only: keep the archive private.', 'ライブのみ：アーカイブは非公開にしてください。') });
  }
  if (verdict === 'allowed') reasons.unshift({ level: 'ok', text: u.bi('Allowed under "' + name + '".', '「' + name + '」により配信できます。') });
  return {
    verdict: verdict,
    permission: { id: perm.id, title: name, guideline_url: perm.getString('guideline_url'), end_date: end },
    reasons: reasons,
  };
}

/** Everything that depends on a talent: characters, products on sale, permissions, marks. */
function exposure(app, talent) {
  const u = u_();
  const chars = u.findMany(app, 'castings', 'talent = {:t}', '', 0, { t: talent.id }).map(function (c) {
    return c.getString('character');
  });
  const products = [];
  for (const p of u.findMany(app, 'products', '(stage = "on_sale" || stage = "mass_production" || stage = "sell_off") && talents.id ?= {:t}', '', 0, { t: talent.id })) products.push(p);
  for (const cid of chars) {
    for (const p of u.findMany(app, 'products', '(stage = "on_sale" || stage = "mass_production" || stage = "sell_off") && characters.id ?= {:c}', '', 0, { c: cid })) {
      if (products.every(function (x) { return x.id !== p.id; })) products.push(p);
    }
  }
  const marks = u.findMany(app, 'matters', 'talent = {:t} && status_group != "dead"', '', 0, { t: talent.id });
  const perms = u.findMany(app, 'permissions', 'talents.id ?= {:t} && status = "active"', '', 0, { t: talent.id });
  return {
    characters: chars.length,
    products_on_sale: products.map(function (p) {
      return { id: p.id, name: p.getString('name'), stage: p.getString('stage'), licensee: p.getString('licensee') };
    }),
    marks: marks.map(function (m) {
      return { id: m.id, ref: m.getString('ref'), jurisdiction: m.getString('jurisdiction') };
    }),
    permissions: perms.map(function (p) {
      return { id: p.id, title: p.getString('title'), end_date: u.d10(p.getString('end_date')) };
    }),
  };
}

module.exports = {
  preStreamCheck: preStreamCheck,
  exposure: exposure,
};
