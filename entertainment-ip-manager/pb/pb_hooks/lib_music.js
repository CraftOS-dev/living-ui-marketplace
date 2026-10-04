/// <reference path="../pb_data/types.d.ts" />
/**
 * Music: the three rights in a song (composition, master, performance),
 * identifiers, society registrations and the singing-stream check.
 *
 * - ISRC identifies a recording (12 characters: country, registrant, year,
 *   designation). Every TV-size, instrumental, live, remix or cover version
 *   needs its own (IFPI ISRC Handbook).
 * - ISWC identifies a composition (T + 9 digits + check digit).
 * - JASRAC holds all of a writer's works on trust; NexTone takes works one by
 *   one. Shares are filed per right category and must add to 100; a JASRAC
 *   publisher takes at most 6/12 of performance income (distribution rules).
 * - Platform blanket licences (YouTube, TikTok, Twitch, niconico and others)
 *   cover the composition only; a commercial master or licensed backing
 *   track needs its own permission, often for live use only.
 * - A performance recorded for a film needs fresh consent for sound-only
 *   release (Copyright Act Art. 91(2)).
 */

function u_() {
  return require(`${__hooks}/lib_util.js`);
}

function normIsrc(code) {
  return String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function validIsrc(code) {
  return /^[A-Z]{2}[A-Z0-9]{3}\d{2}\d{5}$/.test(normIsrc(code));
}

function formatIsrc(code) {
  const c = normIsrc(code);
  if (!validIsrc(c)) return String(code || '');
  return c.slice(0, 2) + '-' + c.slice(2, 5) + '-' + c.slice(5, 7) + '-' + c.slice(7);
}

function normIswc(code) {
  return String(code || '').toUpperCase().replace(/[^T0-9]/g, '');
}

/** ISWC check digit: 1 + sum(i * d_i) for i = 1..9; check = (10 - sum mod 10) mod 10. */
function validIswc(code) {
  const c = normIswc(code);
  if (!/^T\d{10}$/.test(c)) return false;
  let sum = 1;
  for (let i = 1; i <= 9; i++) sum += i * Number(c.charAt(i));
  return (10 - (sum % 10)) % 10 === Number(c.charAt(10));
}

function formatIswc(code) {
  const c = normIswc(code);
  if (!/^T\d{10}$/.test(c)) return String(code || '');
  return 'T-' + c.slice(1, 4) + '.' + c.slice(4, 7) + '.' + c.slice(7, 10) + '-' + c.slice(10);
}

const CATEGORIES = ['performance', 'mechanical', 'print', 'film', 'video', 'game', 'ad', 'broadcast', 'interactive'];

/** Share problems in a registration: each used category must add to 100; JASRAC publisher performance share at most 50%. */
function shareProblems(reg) {
  const u = u_();
  const shares = u.j(reg, 'shares', []);
  const out = [];
  if (!Array.isArray(shares) || !shares.length) {
    out.push(u.bi('No shares filed.', '取分が未登録です。'));
    return out;
  }
  for (const cat of CATEGORIES) {
    let total = 0;
    let used = false;
    for (const s of shares) {
      if (s && s[cat] !== undefined && s[cat] !== '' && s[cat] !== null) {
        used = true;
        total += Number(s[cat]) || 0;
      }
    }
    if (used && Math.abs(total - 100) > 0.01) out.push(u.bi(cat + ' shares add up to ' + u.round2(total) + '%, not 100%.', cat + 'の取分合計が' + u.round2(total) + '%で、100%ではありません。'));
  }
  if (reg.getString('society') === 'jasrac') {
    let pub = 0;
    for (const s of shares) if (s && s.role === 'publisher') pub += Number(s.performance) || 0;
    if (pub > 50.0001) {
      out.push(u.bi('JASRAC caps the publisher\'s performance share at 6/12 (50%); this registration gives ' + u.round2(pub) + '%.', 'JASRACでは演奏権等の出版者取分は6/12（50%）までです。この届出は' + u.round2(pub) + '%です。'));
    }
  }
  return out;
}

/** Completeness of a song and its recordings: { score, items: [{ key, ok, text }] }. */
function completeness(app, song) {
  const u = u_();
  const items = [];
  function item(key, ok, en, ja) {
    items.push({ key: key, ok: ok, text: u.bi(en, ja) });
  }
  const inv = u.findMany(app, 'involvements', 'song = {:s}', '', 0, { s: song.id });
  const roles = inv.map(function (i) {
    return i.getString('role');
  });
  item('writers', roles.indexOf('composer') >= 0 && roles.indexOf('lyricist') >= 0 || (roles.indexOf('composer') >= 0 && song.getString('lyrics_language') === 'instrumental'),
    'Composer and lyricist recorded.', '作曲者・作詞者が登録されています。');
  item('iswc', song.getString('iswc') === '' ? false : validIswc(song.getString('iswc')),
    song.getString('iswc') === '' ? 'No ISWC yet.' : validIswc(song.getString('iswc')) ? 'ISWC is valid.' : 'ISWC check digit is wrong.',
    song.getString('iswc') === '' ? 'ISWCが未登録です。' : validIswc(song.getString('iswc')) ? 'ISWCは有効です。' : 'ISWCのチェックディジットが不正です。');
  const regs = u.findMany(app, 'society_registrations', 'song = {:s}', '', 0, { s: song.id });
  const registered = regs.filter(function (r) {
    return r.getString('status') === 'registered' || r.getString('status') === 'code_issued';
  });
  const selfManaged = regs.some(function (r) {
    return r.getString('society') === 'self';
  });
  item('registration', registered.length > 0 || selfManaged, registered.length ? 'Registered with ' + registered.map(function (r) { return r.getString('society').toUpperCase(); }).join(', ') + '.' : selfManaged ? 'Self-managed (no society).' : 'Not registered with JASRAC or NexTone yet.',
    registered.length ? registered.map(function (r) { return r.getString('society').toUpperCase(); }).join('・') + 'に登録済みです。' : selfManaged ? '自己管理（団体に委託していません）。' : 'JASRAC・NexToneに未登録です。');
  let shareIssues = [];
  for (const r of regs) shareIssues = shareIssues.concat(shareProblems(r));
  item('shares', regs.length > 0 && shareIssues.length === 0, shareIssues.length ? shareIssues.map(function (x) { return x.en; }).join(' ') : 'Shares add up.', shareIssues.length ? shareIssues.map(function (x) { return x.ja; }).join('') : '取分の合計は正しいです。');
  const recs = u.findMany(app, 'recordings', 'song = {:s}', '', 0, { s: song.id });
  let isrcOk = true;
  let mastersOk = true;
  let consentOk = true;
  for (const r of recs) {
    if (r.getString('status') === 'released' && !validIsrc(r.getString('isrc'))) isrcOk = false;
    const owners = u.j(r, 'master_owners', []);
    const total = (Array.isArray(owners) ? owners : []).reduce(function (s, o) {
      return s + (Number(o && o.pct) || 0);
    }, 0);
    if (Math.abs(total - 100) > 0.01) mastersOk = false;
    if (r.getBool('captured_in_av') && !r.getBool('sound_only_consent')) consentOk = false;
  }
  item('isrc', recs.length > 0 && isrcOk, recs.length === 0 ? 'No recordings yet.' : isrcOk ? 'Released recordings have valid ISRCs.' : 'A released recording has no valid ISRC.',
    recs.length === 0 ? '音源が未登録です。' : isrcOk ? 'リリース済み音源のISRCは有効です。' : 'リリース済み音源に有効なISRCがありません。');
  item('masters', recs.length > 0 && mastersOk, mastersOk ? 'Master ownership adds up to 100%.' : 'Master ownership does not add up to 100% on every recording.', mastersOk ? '原盤の持分合計は100%です。' : '原盤の持分合計が100%でない音源があります。');
  item('consent', consentOk, consentOk ? 'Performer consents are in place.' : 'A recording captured in a film has no sound-only consent (Copyright Act Art. 91(2)).', consentOk ? '実演家の許諾は揃っています。' : '映画で録音された実演について音声のみ利用の許諾がありません（著作権法91条2項）。');
  const done = items.filter(function (i) {
    return i.ok;
  }).length;
  return { score: Math.round((done / items.length) * 100), items: items };
}

/** Neighbouring-rights terms (Copyright Act Art. 101): 70 years after the year of performance / publication. */
function neighbouringTerms(app, recording) {
  const u = u_();
  const perf = u.d10(recording.getString('recording_date'));
  let pub = '';
  for (const rel of u.findMany(app, 'releases', 'recordings.id ?= {:r} && release_date != ""', 'release_date', 1, { r: recording.id })) pub = u.d10(rel.getString('release_date'));
  return {
    performance: perf ? { date: Number(perf.slice(0, 4)) + 70 + '-12-31', text: u.bi('70 years after the year of the performance (Art. 101(2)(i)).', '実演の翌年から70年（101条2項1号）。') } : null,
    recording: pub
      ? { date: Number(pub.slice(0, 4)) + 70 + '-12-31', text: u.bi('70 years after the year of publication (Art. 101(2)(ii)).', '発行の翌年から70年（101条2項2号）。') }
      : perf
        ? { date: Number(perf.slice(0, 4)) + 70 + '-12-31', text: u.bi('Not published yet: 70 years after the year of fixation.', '未発行のため、固定の翌年から70年。') }
        : null,
  };
}

/** Platforms with a JASRAC/NexTone blanket licence for user uploads (checked April 2026; X had none). */
const BLANKET_PLATFORMS = ['YOUTUBE', 'TIKTOK', 'TWITCH', 'NICONICO', 'INSTAGRAM', 'TWITCASTING', 'BILIBILI'];

/**
 * Singing-stream setlist check.
 * items: [{ song, recording?, backing: own | commissioned | licensed_karaoke | commercial_master | a_cappella,
 *           platform, archive: bool, monetized: bool, arranged: bool, foreign: bool, company_channel: bool, talent }]
 * Returns per item: { verdict: ok | live_only | blocked, reasons: [{ level, text }] }.
 */
function setlistCheck(app, items) {
  const u = u_();
  const out = [];
  for (const it of u.asArray(items)) {
    const reasons = [];
    let verdict = 'ok';
    function worsen(v) {
      const rank = { ok: 0, live_only: 1, blocked: 2 };
      if (rank[v] > rank[verdict]) verdict = v;
    }
    const song = it.song ? u.byId(app, 'songs', it.song) : null;
    const platform = String(it.platform || '').toUpperCase();
    const ownSong = song !== null && song.getBool('original');
    // Composition.
    if (!ownSong) {
      if (BLANKET_PLATFORMS.indexOf(platform) >= 0) {
        reasons.push({ level: 'ok', text: u.bi('The platform\'s JASRAC/NexTone licence covers the composition.', 'プラットフォームの包括契約で楽曲（作詞・作曲）は利用できます。') });
      } else {
        reasons.push({ level: 'block', text: u.bi('This platform has no blanket licence for the composition. Get a licence or skip the song.', 'このプラットフォームには楽曲の包括契約がありません。個別に許諾を得るか、曲を外してください。') });
        worsen('blocked');
      }
      if (it.foreign === true && it.company_channel !== false && it.archive === true) {
        reasons.push({ level: 'warn', text: u.bi('A foreign work in a company channel\'s archive needs a videogram licence at the publisher\'s set price. Keep it live only or get that licence.', '法人チャンネルのアーカイブで外国曲を使う場合、出版者指値のビデオグラム録音許諾が必要です。ライブのみにするか許諾を得てください。') });
        worsen('live_only');
      }
      if (it.arranged === true) {
        reasons.push({ level: 'warn', text: u.bi('Arrangements and changed lyrics need the writers\' consent through the publisher.', '編曲や歌詞の変更には出版者を通じた著作者の同意が必要です。') });
        const perm = findPermission(app, 'arrangement', it, song);
        if (perm === null) worsen('blocked');
      }
    } else {
      reasons.push({ level: 'ok', text: u.bi('Our own song.', '自社楽曲です。') });
    }
    // Master or backing track.
    const backing = it.backing || 'own';
    if (backing === 'commercial_master' || backing === 'licensed_karaoke') {
      const perm = findPermission(app, backing === 'commercial_master' ? 'master' : 'backing_track', it, song);
      if (perm === null) {
        reasons.push({ level: 'block', text: u.bi('Using ' + (backing === 'commercial_master' ? 'a commercial recording' : 'a karaoke track') + ' needs the master owner\'s permission, and none is on file.', (backing === 'commercial_master' ? '市販音源' : 'カラオケ音源') + 'の利用には原盤権者の許諾が必要ですが、登録がありません。') });
        worsen('blocked');
      } else {
        const archive = perm.getString('archive');
        const link = perm.getString('title');
        if (it.archive === true && archive !== 'yes') {
          reasons.push({ level: 'warn', text: u.bi('"' + link + '" allows live use only; the archive must be private or cut.', '「' + link + '」はライブのみ許諾のため、アーカイブは非公開または該当部分のカットが必要です。') });
          worsen('live_only');
        } else {
          reasons.push({ level: 'ok', text: u.bi('Backing track cleared by "' + link + '".', '「' + link + '」で音源の許諾があります。') });
        }
        const mon = u.j(perm, 'monetization', []);
        if (it.monetized === true && Array.isArray(mon) && mon.length && mon.indexOf('ads') < 0 && mon.indexOf('super_chat') < 0 && mon.indexOf('membership') < 0) {
          reasons.push({ level: 'warn', text: u.bi('The permission does not allow monetization.', '許諾は収益化を認めていません。') });
          worsen('blocked');
        }
      }
    } else if (backing === 'a_cappella') {
      reasons.push({ level: 'ok', text: u.bi('A cappella: no master involved.', 'アカペラのため原盤は関係しません。') });
    } else {
      reasons.push({ level: 'ok', text: u.bi('Own or commissioned backing track.', '自社制作または委託制作の音源です。') });
    }
    out.push({ song: it.song || '', title: song ? song.getString('title') : it.title || '', verdict: verdict, reasons: reasons });
  }
  return out;
}

function findPermission(app, type, it, song) {
  const u = u_();
  const rows = u.findMany(app, 'permissions', 'permission_type = {:t} && (status = "active")', '', 0, { t: type });
  const platform = String(it.platform || '').toUpperCase();
  for (const p of rows) {
    if (u.d10(p.getString('end_date')) !== '' && u.d10(p.getString('end_date')) < u.today()) continue;
    if (it.talent && !p.getBool('all_talents') && u.ids(p, 'talents').indexOf(it.talent) < 0) continue;
    const plats = u.j(p, 'platforms', []);
    if (Array.isArray(plats) && plats.length && platform && plats.map(function (x) { return String(x).toUpperCase(); }).indexOf(platform) < 0) continue;
    if (song) {
      const subject = String(p.getString('subject_name') || '').toLowerCase();
      if (subject && subject !== '*' && subject.indexOf(song.getString('title').toLowerCase()) < 0 && song.getString('title').toLowerCase().indexOf(subject) < 0) continue;
    }
    return p;
  }
  return null;
}

/** Songs used (released, streamed, first published) but not registered with any society. */
function usedButUnregistered(app) {
  const u = u_();
  const out = [];
  for (const s of u.findMany(app, 'songs', 'status != "archived"', 'title', 0)) {
    const used = u.d10(s.getString('first_publication')) !== '' || u.findOne(app, 'recordings', 'song = {:s} && status = "released"', { s: s.id }) !== null;
    if (!used) continue;
    const regs = u.findMany(app, 'society_registrations', 'song = {:s}', '', 0, { s: s.id });
    const ok = regs.some(function (r) {
      return r.getString('society') === 'self' || r.getString('status') === 'registered' || r.getString('status') === 'code_issued';
    });
    if (!ok) {
      out.push({
        id: s.id,
        title: s.getString('title'),
        first_publication: u.d10(s.getString('first_publication')),
        registrations: regs.map(function (r) {
          return { society: r.getString('society'), status: r.getString('status') };
        }),
      });
    }
  }
  return out;
}

/** Content ID assets whose claimed ownership is over 100% in a territory. */
function ownershipConflicts(app) {
  const u = u_();
  const byTarget = {};
  for (const a of u.findMany(app, 'content_id_assets', 'status != "inactive"', '', 0)) {
    const target = a.getString('recording') || a.getString('song');
    if (!target) continue;
    for (const o of u.asArray(u.j(a, 'ownership', []))) {
      const key = target + ':' + (o.territory || 'WORLD');
      byTarget[key] = (byTarget[key] || 0) + (Number(o.pct) || 0);
    }
  }
  const out = [];
  for (const k of Object.keys(byTarget)) if (byTarget[k] > 100.0001) out.push({ target: k.split(':')[0], territory: k.split(':')[1], total: u.round2(byTarget[k]) });
  return out;
}

module.exports = {
  normIsrc: normIsrc,
  validIsrc: validIsrc,
  formatIsrc: formatIsrc,
  validIswc: validIswc,
  formatIswc: formatIswc,
  shareProblems: shareProblems,
  completeness: completeness,
  neighbouringTerms: neighbouringTerms,
  setlistCheck: setlistCheck,
  usedButUnregistered: usedButUnregistered,
  ownershipConflicts: ownershipConflicts,
  BLANKET_PLATFORMS: BLANKET_PLATFORMS,
};
