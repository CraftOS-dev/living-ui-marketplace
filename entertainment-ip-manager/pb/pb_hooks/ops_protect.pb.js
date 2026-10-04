/// <reference path="../pb_data/types.d.ts" />
/**
 * Enforcement verbs: a draft notice for a case (never sent from here) and
 * evidence capture with a hash and a preservation date.
 */

/**
 * Draft the notice a case's forum expects, from the rights linked to the
 * case. The draft lands in enforcement_cases.draft_notice for a person to
 * check and send; this app never sends it.
 *   dmca         DMCA 17 U.S.C. 512(c)(3) elements
 *   jp_platform  送信防止措置依頼 under the Information Distribution Platform Act
 *   marketplace  marketplace IP report (listing, right, reason)
 *   cease_desist 警告書 / cease-and-desist letter
 *   other forums a plain notice with the same facts
 */
routerAdd('POST', '/api/ops/cases/draft-notice', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'rights', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const c = o.need(e.app, 'enforcement_cases', b.case_id, 'Case', '案件');
    const forum = o.str(b.forum) || c.getString('forum') || 'cease_desist';
    const lang = o.str(b.lang) === 'en' || o.str(b.lang) === 'ja' ? o.str(b.lang) : forum === 'dmca' ? 'en' : ctx.lang;
    const ja = lang === 'ja';
    const org = String(u.setting(e.app, 'org_name', '') || (ja ? '（会社名）' : '[Company name]'));
    const signer = u.userLabel(e.app, ctx.actor);
    const today = u.today();
    const urls = u.asArray(u.j(c, 'urls', [])).map(String).filter((x) => x);
    const rights = [];
    for (const mid of u.ids(c, 'matters')) {
      const m = u.byId(e.app, 'matters', mid);
      if (m === null) continue;
      const classes = u.findMany(e.app, 'goods_services', 'matter = {:m}', 'nice_class', 0, { m: m.id }).map((g) => g.getInt('nice_class'));
      const no = m.getString('registration_no') || m.getString('application_no');
      rights.push(
        ja
          ? (m.getString('ip_type') === 'design' ? '意匠' : '商標') + '「' + m.getString('title') + '」（' + m.getString('jurisdiction') + ' ' + (m.getString('registration_no') ? '登録第' : '出願') + no + '号' + (classes.length ? '、第' + classes.join('・') + '類' : '') + '）'
          : (m.getString('ip_type') === 'design' ? 'Design' : 'Trademark') + ' "' + m.getString('title') + '" (' + m.getString('jurisdiction') + ' ' + (m.getString('registration_no') ? 'Reg. No. ' : 'App. No. ') + no + (classes.length ? ', class ' + classes.join(', ') : '') + ')',
      );
    }
    for (const wid of u.ids(c, 'works')) {
      const w = u.byId(e.app, 'titles', wid);
      if (w !== null) rights.push(ja ? '著作物「' + w.getString('title') + '」の著作権' : 'Copyright in "' + w.getString('title') + '"');
    }
    for (const cid of u.ids(c, 'characters')) {
      const ch = u.byId(e.app, 'characters', cid);
      if (ch !== null) rights.push(ja ? 'キャラクター「' + ch.getString('name') + '」のデザイン等に係る著作権' : 'Copyright in the character "' + ch.getString('name') + '" (design and artwork)');
    }
    for (const tid of u.ids(c, 'talents')) {
      const t = u.byId(e.app, 'talents', tid);
      if (t !== null && ['impersonation', 'defamation', 'harassment'].indexOf(c.getString('case_type')) >= 0) {
        rights.push(ja ? 'タレント「' + t.getString('stage_name') + '」の名誉・信用及び当社の業務' : 'The reputation of our talent "' + t.getString('stage_name') + '" and our business');
      }
    }
    const missing = [];
    if (!urls.length) missing.push(u.bi('No URL of the infringing material is recorded on the case.', '侵害情報のURLが案件に登録されていません。'));
    if (!rights.length) missing.push(u.bi('No trademark, title or character is linked to the case.', '商標・作品・キャラクターが案件に紐づいていません。'));
    const why = {
      counterfeit: ['The goods are counterfeit: they use our marks and artwork without a licence and are not genuine products.', '当該商品は、当社の許諾なく当社の商標及び著作物を使用した模倣品であり、正規品ではありません。'],
      piracy: ['The material is an unauthorized copy of our work, made available to the public without permission.', '当該情報は当社著作物の無断複製物であり、許諾なく公衆送信されています。'],
      unauthorized_derivative: ['The material adapts our work without permission and outside our published guidelines.', '当該情報は当社著作物を許諾なく翻案したもので、当社ガイドラインの範囲外です。'],
      clip_violation: ['The material uses our talent\'s streams outside our clip guidelines.', '当該情報は当社タレントの配信を切り抜き動画ガイドラインに反して使用しています。'],
      impersonation: ['The account impersonates our talent or company and misleads the public.', '当該アカウントは当社タレント又は当社になりすまし、閲覧者を誤認させています。'],
      leak: ['The material discloses unreleased content without permission.', '当該情報は未発表の内容を許諾なく公開しています。'],
      ai_misuse: ['The material imitates our talent\'s voice or likeness without permission.', '当該情報は当社タレントの声又は容姿を許諾なく模倣しています。'],
    }[c.getString('case_type')] || ['The material infringes the rights listed above.', '当該情報は上記の権利を侵害しています。'];
    const list = (arr, bullet) => arr.map((x) => bullet + x).join('\n');
    let text;
    if (forum === 'dmca' && !ja) {
      text = [
        'DMCA Notice of Copyright Infringement',
        '',
        'Date: ' + today,
        'To: Designated Copyright Agent, ' + (c.getString('platform') || '[Service provider]'),
        '',
        '1. Copyrighted work(s):',
        list(rights, '   - '),
        '2. Infringing material and its location:',
        list(urls, '   - ') || '   - [URL]',
        '3. Why it infringes: ' + why[0],
        '4. Contact: ' + signer + ', ' + org + ', [address], [email], [phone].',
        '5. I have a good faith belief that use of the material in the manner complained of is not authorized by the copyright owner, its agent, or the law.',
        '6. The information in this notice is accurate, and under penalty of perjury, I am authorized to act on behalf of the owner of an exclusive right that is allegedly infringed.',
        '',
        '/s/ ' + signer,
        org,
      ].join('\n');
    } else if (forum === 'jp_platform' || (forum === 'marketplace' && ja) || (forum === 'dmca' && ja)) {
      text = [
        '侵害情報の通知書 兼 送信防止措置依頼書',
        '',
        today,
        (c.getString('platform') || '（プラットフォーム事業者名）') + ' 御中',
        '',
        '申出者：' + org,
        '担当者：' + signer,
        '連絡先：（住所・電話番号・メールアドレス）',
        '',
        '当社は、貴社が管理する特定電気通信設備に掲載されている下記の情報の流通により、当社の権利が侵害されているため、情報流通プラットフォーム対処法に基づき、当該情報の送信を防止する措置を講じるよう依頼します。',
        '',
        '記',
        '',
        '1. 掲載されている場所',
        list(urls, '　・') || '　・（URL）',
        '2. 侵害されたとする権利',
        list(rights, '　・'),
        '3. 権利が侵害されたとする理由',
        '　' + why[1],
        '4. 申出者が権利者であること',
        '　当社は上記権利の権利者（又はその専用実施権者・独占的利用許諾を受けた者）です。必要に応じて登録証等の写しを提出します。',
        '',
        '以上',
      ].join('\n');
    } else if (forum === 'marketplace') {
      text = [
        'Report of intellectual property infringement',
        '',
        'Date: ' + today,
        'Marketplace: ' + (c.getString('platform') || '[Marketplace]'),
        'Rights owner: ' + org,
        'Contact: ' + signer + ', [email]',
        '',
        'Listings:',
        list(urls, '- ') || '- [Listing URL]',
        '',
        'Rights:',
        list(rights, '- '),
        '',
        'Reason: ' + why[0],
        '',
        'We request removal of these listings. The information in this report is accurate, and we are the owner of the rights listed or authorized to act for the owner.',
      ].join('\n');
    } else if (ja) {
      text = [
        '通知書',
        '',
        today,
        (c.getString('their_party') || '（相手方）') + ' 殿',
        '',
        org,
        signer,
        '',
        '当社は、下記の権利を有しています。',
        list(rights, '　・'),
        '',
        '貴殿（貴社）による下記の行為は、当社の上記権利を侵害するものです。',
        list(urls, '　・') || '　・（対象の商品・URL）',
        '　' + why[1],
        '',
        'つきましては、本書到達後14日以内に、当該行為を直ちに中止し、在庫の数量・販売数量及び仕入先を書面にて回答するよう求めます。誠意ある対応がない場合は、法的措置を検討いたします。',
      ].join('\n');
    } else {
      text = [
        'Notice of infringement',
        '',
        today,
        'To: ' + (c.getString('their_party') || '[Recipient]'),
        'From: ' + org + ' (' + signer + ')',
        '',
        'We own the following rights:',
        list(rights, '- '),
        '',
        'The following conduct infringes them:',
        list(urls, '- ') || '- [Product or URL]',
        why[0],
        '',
        'Please stop this conduct immediately and, within 14 days of receiving this letter, tell us in writing the quantity in stock, the quantity sold and your supplier. If we do not receive a satisfactory reply we will consider legal action.',
      ].join('\n');
    }
    if (forum === 'sender_disclosure') {
      missing.push(u.bi(
        'A disclosure request usually goes through the court procedure (発信者情報開示命令). Use this draft for the provider request only and take it to counsel.',
        '発信者情報の開示は通常、裁判所の手続（発信者情報開示命令）によります。この下書きはプロバイダへの請求用とし、弁護士に確認してください。',
      ));
    }
    if (forum === 'customs') {
      missing.push(u.bi('Customs works through a recordation (輸入差止申立), not a notice. Use the customs recordations list.', '税関は通知ではなく輸入差止申立により対応します。税関登録の一覧を使ってください。'));
    }
    if (!o.bool(b.preview)) {
      c.set('draft_notice', text);
      e.app.save(c);
      u.audit(e.app, ctx.actor, 'draft', 'enforcement_cases', c.id, c.getString('ref'), { forum: forum, lang: lang }, '');
    }
    return { forum: forum, lang: lang, text: text, missing: missing, sent: false };
  }),
);

// Evidence: who captured it, when, its SHA-256 (computed in the browser from the file) and how long to keep it.
routerAdd('POST', '/api/ops/cases/evidence', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'contribute', (b, ctx) => {
    const u = ctx.u;
    const o = require(`${__hooks}/lib_ops.js`);
    const c = o.need(e.app, 'enforcement_cases', b.case_id, 'Case', '案件');
    const kind = o.str(b.kind) || 'screenshot';
    if (['screenshot', 'page_archive', 'test_purchase', 'listing', 'video', 'document', 'other'].indexOf(kind) < 0) throw u.err('Unknown evidence kind.', '不明な証拠の種類です。');
    const sha = o.str(b.sha256).toLowerCase();
    if (sha && !/^[0-9a-f]{64}$/.test(sha)) throw u.err('The SHA-256 must be 64 hex characters.', 'SHA-256は16進数64文字です。');
    let files = [];
    try {
      files = e.findUploadedFiles('file') || [];
    } catch {
      files = [];
    }
    if (!files.length && !o.str(b.url)) throw u.err('Attach a file or give the URL captured.', 'ファイルを添付するか、取得したURLを入力してください。');
    const years = Math.max(1, Math.min(20, o.num(b.preserve_years, 5)));
    const rec = u.newRecord(e.app, 'evidence', {
      case_ref: c.id,
      kind: kind,
      url: o.str(b.url),
      captured_at: o.str(b.captured_at) || new Date().toISOString(),
      sha256: sha,
      captured_by: ctx.actor,
      preserve_until: u.toPb(u.addYMD(u.today(), years, 0, 0)),
      chain_note: o.str(b.chain_note),
      notes: o.str(b.notes),
    });
    if (files.length) rec.set('file', files[0]);
    e.app.save(rec);
    u.audit(e.app, ctx.actor, 'create', 'evidence', rec.id, c.getString('ref') + ' ' + kind, { sha256: sha, url: o.str(b.url) }, '');
    return { id: rec.id, preserve_until: u.d10(rec.getString('preserve_until')), sha256: sha };
  }),
);
