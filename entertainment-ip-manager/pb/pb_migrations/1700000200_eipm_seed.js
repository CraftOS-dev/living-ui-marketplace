/// <reference path="../pb_data/types.d.ts" />
/**
 * Entertainment IP Manager reference data: organization defaults, rights
 * dimensions (with Japanese labels and the product-category to Nice-class
 * table), office connection slots, official fees confirmed from primary
 * sources, and the deadline rule catalog. Every rule carries its citation
 * and Japanese name and title. Rules are data: admins can disable, edit or
 * add rules in Settings. Shipped rules are marked system=true.
 *
 * China, Korea and Taiwan fees and holiday lists live in 1700000300.
 * Agreement, committee, product, approval, permission, music and talent
 * date obligations are generated from those records' own fields by
 * lib_obligations.js; the rules here are the event-driven ones.
 */
migrate(
  (app) => {
    function put(collection, data) {
      const col = app.findCollectionByNameOrId(collection);
      const rec = new Record(col);
      for (const k of Object.keys(data)) rec.set(k, data[k]);
      app.save(rec);
      return rec;
    }

    // --- settings singleton ---------------------------------------------------
    put('settings', {
      org_name: '',
      profiles: [],
      modules: {},
      default_language: 'ja',
      home_currency: 'JPY',
      work_calendar: 'JP',
      target_buffer_days: 14,
      reminder_days: [90, 60, 30, 14, 7, 1],
      digest_enabled: true,
      digest_hour: 8,
      digest_channel: 'in_app',
      slack_channel: '',
      second_reviewer: false,
      renewal_default: 'decide',
      default_signup_role: 'contributor',
      jurisdictions: ['JP', 'US', 'CN', 'KR', 'TW', 'EM', 'WO'],
      approval_sla_days: 5,
      leak_lag_days: 14,
      // Starter template: edit in Settings > Approvals. Reviewer kinds: internal, committee, original, talent, reviewer.
      approval_stages: [
        { key: 'proposal', label: 'Proposal', label_ja: '企画', sla_days: 5, reviewers: ['internal'] },
        { key: 'concept', label: 'Concept', label_ja: 'コンセプト', sla_days: 5, reviewers: ['internal', 'talent'] },
        { key: 'design', label: 'Design', label_ja: 'デザイン', sla_days: 5, reviewers: ['internal', 'committee', 'original', 'talent'] },
        { key: 'prototype', label: 'Prototype', label_ja: '試作', sla_days: 7, reviewers: ['internal', 'committee', 'original'] },
        { key: 'final_sample', label: 'Final sample', label_ja: '最終サンプル', sla_days: 5, reviewers: ['internal'] },
        { key: 'packaging', label: 'Packaging', label_ja: 'パッケージ', sla_days: 5, reviewers: ['internal'] },
        { key: 'mass_production_check', label: 'Mass production check', label_ja: '量産品確認', sla_days: 5, reviewers: ['internal'] },
      ],
      ref_prefix_trademark: 'TM',
      ref_prefix_design: 'D',
      ref_prefix_agreement: 'AG',
      ref_prefix_product: 'PR',
      ref_prefix_case: 'EC',
      ref_prefix_permit: 'FP',
      onboarding_done: false,
      fx_auto: true,
      sync_enabled: true,
      sync_hour: 2,
    });

    // --- office connection slots (trademark data only) ---------------------------
    for (const office of ['uspto_tsdr', 'euipo', 'jpo']) {
      put('office_connections', { office: office, enabled: false, sandbox: false, status: 'not_configured', has_secret: false });
    }

    // --- FX anchor (ECB rates are fetched daily; EUR is the pivot) -------------
    put('fx_rates', { code: 'EUR', per_eur: 1, source: 'manual', as_of: new Date().toISOString() });

    // --- rights dimensions ---------------------------------------------------------
    const dims = [
      ['territory', 'Territory', '地域', 1, true, 'Where the right may be exercised.'],
      ['media', 'Media', 'メディア', 2, true, 'How the work is exploited: broadcast, streaming, video, games, merchandise, live.'],
      ['language', 'Language and version', '言語・版', 3, true, 'Original, subtitled or dubbed language versions.'],
      ['category', 'Product category', '商品カテゴリ', 4, true, 'Merchandise categories. Each maps to the Nice classes a trademark needs.'],
      ['channel', 'Sales channel', '販売チャネル', 5, true, 'Where goods are sold: stores, online, events, lotteries, prize machines.'],
      ['platform', 'Platform', 'プラットフォーム', 6, true, 'Streaming and social platforms for streams, clips and videos.'],
    ];
    for (const d of dims) {
      put('dimensions', { key: d[0], label: d[1], label_ja: d[2], order: d[3], enabled: d[4], description: d[5] });
    }
    let order = 0;
    function val(dimension, code, label, labelJa, parent, classes) {
      order += 1;
      put('dimension_values', {
        dimension: dimension,
        code: code,
        label: label,
        label_ja: labelJa,
        parent_code: parent || '',
        order: order,
        classes: classes || [],
      });
    }

    // Territory: World > regions > countries (ISO 3166-1 alpha-2).
    val('territory', 'WORLD', 'Worldwide', '全世界', '');
    const regions = [
      ['ASIA', 'Asia', 'アジア', 'WORLD'],
      ['EAST_ASIA', 'East Asia', '東アジア', 'ASIA'],
      ['SEA', 'Southeast Asia', '東南アジア', 'ASIA'],
      ['SOUTH_ASIA', 'South Asia', '南アジア', 'ASIA'],
      ['OCEANIA', 'Oceania', 'オセアニア', 'WORLD'],
      ['NORTH_AMERICA', 'North America', '北米', 'WORLD'],
      ['LATAM', 'Latin America', '中南米', 'WORLD'],
      ['EUROPE', 'Europe', 'ヨーロッパ', 'WORLD'],
      ['EU', 'European Union', '欧州連合', 'EUROPE'],
      ['MENA', 'Middle East and North Africa', '中東・北アフリカ', 'WORLD'],
      ['AFRICA', 'Sub-Saharan Africa', 'サハラ以南アフリカ', 'WORLD'],
    ];
    for (const r of regions) val('territory', r[0], r[1], r[2], r[3]);
    const countries = [
      ['JP', 'Japan', '日本', 'EAST_ASIA'], ['CN', 'China', '中国', 'EAST_ASIA'], ['KR', 'South Korea', '韓国', 'EAST_ASIA'],
      ['TW', 'Taiwan', '台湾', 'EAST_ASIA'], ['HK', 'Hong Kong', '香港', 'EAST_ASIA'], ['MO', 'Macau', 'マカオ', 'EAST_ASIA'],
      ['MN', 'Mongolia', 'モンゴル', 'EAST_ASIA'],
      ['SG', 'Singapore', 'シンガポール', 'SEA'], ['TH', 'Thailand', 'タイ', 'SEA'], ['MY', 'Malaysia', 'マレーシア', 'SEA'],
      ['ID', 'Indonesia', 'インドネシア', 'SEA'], ['PH', 'Philippines', 'フィリピン', 'SEA'], ['VN', 'Vietnam', 'ベトナム', 'SEA'],
      ['KH', 'Cambodia', 'カンボジア', 'SEA'], ['MM', 'Myanmar', 'ミャンマー', 'SEA'], ['LA', 'Laos', 'ラオス', 'SEA'],
      ['BN', 'Brunei', 'ブルネイ', 'SEA'],
      ['IN', 'India', 'インド', 'SOUTH_ASIA'], ['PK', 'Pakistan', 'パキスタン', 'SOUTH_ASIA'], ['BD', 'Bangladesh', 'バングラデシュ', 'SOUTH_ASIA'],
      ['LK', 'Sri Lanka', 'スリランカ', 'SOUTH_ASIA'],
      ['AU', 'Australia', 'オーストラリア', 'OCEANIA'], ['NZ', 'New Zealand', 'ニュージーランド', 'OCEANIA'],
      ['US', 'United States', 'アメリカ', 'NORTH_AMERICA'], ['CA', 'Canada', 'カナダ', 'NORTH_AMERICA'],
      ['MX', 'Mexico', 'メキシコ', 'LATAM'], ['BR', 'Brazil', 'ブラジル', 'LATAM'], ['AR', 'Argentina', 'アルゼンチン', 'LATAM'],
      ['CL', 'Chile', 'チリ', 'LATAM'], ['CO', 'Colombia', 'コロンビア', 'LATAM'], ['PE', 'Peru', 'ペルー', 'LATAM'],
      ['AT', 'Austria', 'オーストリア', 'EU'], ['BE', 'Belgium', 'ベルギー', 'EU'], ['BG', 'Bulgaria', 'ブルガリア', 'EU'],
      ['HR', 'Croatia', 'クロアチア', 'EU'], ['CY', 'Cyprus', 'キプロス', 'EU'], ['CZ', 'Czechia', 'チェコ', 'EU'],
      ['DK', 'Denmark', 'デンマーク', 'EU'], ['EE', 'Estonia', 'エストニア', 'EU'], ['FI', 'Finland', 'フィンランド', 'EU'],
      ['FR', 'France', 'フランス', 'EU'], ['DE', 'Germany', 'ドイツ', 'EU'], ['GR', 'Greece', 'ギリシャ', 'EU'],
      ['HU', 'Hungary', 'ハンガリー', 'EU'], ['IE', 'Ireland', 'アイルランド', 'EU'], ['IT', 'Italy', 'イタリア', 'EU'],
      ['LV', 'Latvia', 'ラトビア', 'EU'], ['LT', 'Lithuania', 'リトアニア', 'EU'], ['LU', 'Luxembourg', 'ルクセンブルク', 'EU'],
      ['MT', 'Malta', 'マルタ', 'EU'], ['NL', 'Netherlands', 'オランダ', 'EU'], ['PL', 'Poland', 'ポーランド', 'EU'],
      ['PT', 'Portugal', 'ポルトガル', 'EU'], ['RO', 'Romania', 'ルーマニア', 'EU'], ['SK', 'Slovakia', 'スロバキア', 'EU'],
      ['SI', 'Slovenia', 'スロベニア', 'EU'], ['ES', 'Spain', 'スペイン', 'EU'], ['SE', 'Sweden', 'スウェーデン', 'EU'],
      ['GB', 'United Kingdom', 'イギリス', 'EUROPE'], ['CH', 'Switzerland', 'スイス', 'EUROPE'], ['NO', 'Norway', 'ノルウェー', 'EUROPE'],
      ['IS', 'Iceland', 'アイスランド', 'EUROPE'], ['TR', 'Türkiye', 'トルコ', 'EUROPE'], ['UA', 'Ukraine', 'ウクライナ', 'EUROPE'],
      ['RU', 'Russia', 'ロシア', 'EUROPE'],
      ['AE', 'United Arab Emirates', 'アラブ首長国連邦', 'MENA'], ['SA', 'Saudi Arabia', 'サウジアラビア', 'MENA'],
      ['IL', 'Israel', 'イスラエル', 'MENA'], ['EG', 'Egypt', 'エジプト', 'MENA'], ['QA', 'Qatar', 'カタール', 'MENA'],
      ['ZA', 'South Africa', '南アフリカ', 'AFRICA'], ['NG', 'Nigeria', 'ナイジェリア', 'AFRICA'], ['KE', 'Kenya', 'ケニア', 'AFRICA'],
    ];
    for (const c of countries) val('territory', c[0], c[1], c[2], c[3]);

    // Media: how anime, VTuber and character IP is exploited.
    val('media', 'ALL_MEDIA', 'All media', '全メディア', '');
    const media = [
      ['BROADCAST', 'Broadcast', '放送', 'ALL_MEDIA'],
      ['TERRESTRIAL', 'Terrestrial TV', '地上波', 'BROADCAST'],
      ['BS', 'BS satellite', 'BS放送', 'BROADCAST'],
      ['CS', 'CS satellite', 'CS放送', 'BROADCAST'],
      ['CATV', 'Cable TV', 'ケーブルテレビ', 'BROADCAST'],
      ['SIMULCAST', 'Simultaneous online streaming of broadcasts', '放送同時配信', 'BROADCAST'],
      ['STREAMING', 'Streaming', '配信', 'ALL_MEDIA'],
      ['SVOD', 'Subscription streaming (SVOD)', '定額制配信（SVOD）', 'STREAMING'],
      ['AVOD', 'Ad-supported streaming (AVOD)', '広告型配信（AVOD）', 'STREAMING'],
      ['FAST', 'Free ad-supported channels (FAST)', 'FASTチャンネル', 'STREAMING'],
      ['TVOD', 'Rental streaming (TVOD)', 'レンタル配信（TVOD）', 'STREAMING'],
      ['EST', 'Digital purchase (EST)', '購入型配信（EST）', 'STREAMING'],
      ['LIVE_STREAM', 'Live streams', 'ライブ配信', 'STREAMING'],
      ['CLIPS', 'Clips and short video', '切り抜き・ショート動画', 'STREAMING'],
      ['THEATRICAL', 'Theatrical', '劇場上映', 'ALL_MEDIA'],
      ['NON_THEATRICAL', 'Non-theatrical screening', '非劇場上映', 'ALL_MEDIA'],
      ['AIRLINE', 'Airline', '機内上映', 'NON_THEATRICAL'],
      ['EVENT_SCREENING', 'Event screenings', 'イベント上映', 'NON_THEATRICAL'],
      ['VIDEO_PACKAGE', 'Video packages (Blu-ray, DVD)', 'ビデオグラム（BD・DVD）', 'ALL_MEDIA'],
      ['MUSIC', 'Music', '音楽', 'ALL_MEDIA'],
      ['AUDIO_STREAMING', 'Music streaming and downloads', '音楽配信', 'MUSIC'],
      ['PHYSICAL_AUDIO', 'CD and vinyl', 'CD・レコード', 'MUSIC'],
      ['KARAOKE', 'Karaoke', 'カラオケ', 'MUSIC'],
      ['SYNC', 'Synchronization', 'シンクロ（映像への使用）', 'MUSIC'],
      ['PUBLISHING', 'Publishing', '出版', 'ALL_MEDIA'],
      ['COMICS', 'Comic adaptations', 'コミカライズ', 'PUBLISHING'],
      ['NOVELS', 'Novelizations', 'ノベライズ', 'PUBLISHING'],
      ['ART_BOOKS', 'Art books and setting books', '画集・設定資料集', 'PUBLISHING'],
      ['EBOOK', 'E-books', '電子書籍', 'PUBLISHING'],
      ['GAMES', 'Games', 'ゲーム', 'ALL_MEDIA'],
      ['CONSOLE_PC', 'Console and PC games', '家庭用・PCゲーム', 'GAMES'],
      ['MOBILE_GAMES', 'Mobile games', 'モバイルゲーム', 'GAMES'],
      ['ARCADE', 'Arcade', 'アーケード', 'GAMES'],
      ['PACHINKO', 'Pachinko and pachislot', '遊技機（パチンコ・パチスロ）', 'GAMES'],
      ['MERCHANDISE', 'Merchandise', '商品化', 'ALL_MEDIA'],
      ['LIVE', 'Live and location-based', 'ライブ・イベント', 'ALL_MEDIA'],
      ['CONCERTS', 'Concerts and live shows', 'ライブ・コンサート', 'LIVE'],
      ['STAGE', 'Stage plays', '舞台（2.5次元）', 'LIVE'],
      ['EVENTS', 'Events and exhibitions', 'イベント・展示', 'LIVE'],
      ['COLLAB_CAFE', 'Collaboration cafes', 'コラボカフェ', 'LIVE'],
      ['THEME_PARKS', 'Theme parks and attractions', 'テーマパーク・アトラクション', 'LIVE'],
      ['ADVERTISING', 'Advertising and tie-ups', '広告・タイアップ', 'ALL_MEDIA'],
      ['BRAND_TIEUP', 'Brand tie-ups', '企業タイアップ', 'ADVERTISING'],
      ['PROMOTION', 'Sales promotion', '販促', 'ADVERTISING'],
      ['VOICE', 'Voice products', 'ボイス', 'ALL_MEDIA'],
      ['VOICE_PRODUCTS', 'Voice packs and drama CDs', 'ボイス商品・ドラマCD', 'VOICE'],
      ['ASMR', 'ASMR', 'ASMR', 'VOICE'],
      ['DIGITAL_GOODS', 'Digital goods (wallpapers, stickers)', 'デジタルグッズ（壁紙・スタンプ）', 'ALL_MEDIA'],
      ['FORMAT', 'Remakes and adaptations', 'リメイク・翻案', 'ALL_MEDIA'],
    ];
    for (const m of media) val('media', m[0], m[1], m[2], m[3]);

    // Language and version: a language covers its subtitled and dubbed versions.
    val('language', 'ALL_LANGUAGES', 'All languages', '全言語', '');
    const langs = [
      ['JA', 'Japanese', '日本語'],
      ['EN', 'English', '英語'],
      ['ZH_HANS', 'Chinese (Simplified)', '中国語（簡体字）'],
      ['ZH_HANT', 'Chinese (Traditional)', '中国語（繁体字）'],
      ['KO', 'Korean', '韓国語'],
      ['FR', 'French', 'フランス語'],
      ['DE', 'German', 'ドイツ語'],
      ['ES', 'Spanish', 'スペイン語'],
      ['PT', 'Portuguese', 'ポルトガル語'],
      ['IT', 'Italian', 'イタリア語'],
      ['TH', 'Thai', 'タイ語'],
      ['ID', 'Indonesian', 'インドネシア語'],
      ['VI', 'Vietnamese', 'ベトナム語'],
      ['AR', 'Arabic', 'アラビア語'],
      ['RU', 'Russian', 'ロシア語'],
    ];
    for (const l of langs) {
      val('language', l[0], l[1], l[2], 'ALL_LANGUAGES');
      if (l[0] !== 'JA') {
        val('language', l[0] + '_SUB', l[1] + ' subtitles', l[2] + '字幕', l[0]);
        val('language', l[0] + '_DUB', l[1] + ' dub', l[2] + '吹替', l[0]);
      }
    }

    // Product category, with the Nice classes a trademark needs to cover it.
    // Starter table: edit in Settings > Rights dimensions.
    val('category', 'ALL_CATEGORIES', 'All categories', '全カテゴリ', '', []);
    const cats = [
      ['FIGURES', 'Figures', 'フィギュア', [28, 20]],
      ['PLUSH', 'Plush toys', 'ぬいぐるみ', [28]],
      ['ACRYLIC', 'Acrylic stands and keychains', 'アクリルスタンド・キーホルダー', [20, 14]],
      ['BADGES', 'Can badges and pins', '缶バッジ・ピンバッジ', [26, 14]],
      ['APPAREL', 'Apparel', 'アパレル', [25]],
      ['COSPLAY', 'Costumes and cosplay', 'コスプレ衣装', [25]],
      ['BAGS', 'Bags and pouches', 'バッグ・ポーチ', [18]],
      ['ACCESSORIES', 'Jewellery and watches', 'アクセサリー・時計', [14]],
      ['STATIONERY', 'Stationery', '文具', [16]],
      ['CARDS', 'Trading cards and card games', 'トレーディングカード・カードゲーム', [28, 16]],
      ['POSTERS', 'Posters and wall scrolls', 'ポスター・タペストリー', [16, 24]],
      ['TEXTILES', 'Towels, bedding and fabric goods', 'タオル・寝具・布製品', [24]],
      ['TABLEWARE', 'Mugs and tableware', 'マグカップ・食器', [21]],
      ['HOME', 'Home and interior goods', 'インテリア・雑貨', [20, 21]],
      ['PHONE_ACC', 'Phone cases and accessories', 'スマホケース・アクセサリー', [9]],
      ['ELECTRONICS', 'Electronics and peripherals', '電子機器・周辺機器', [9]],
      ['DIGITAL', 'Digital content (wallpapers, voices, stickers)', 'デジタルコンテンツ（壁紙・ボイス・スタンプ）', [9]],
      ['MEDIA_SOFT', 'Music and video media', '音楽・映像ソフト', [9]],
      ['GAMES_APPS', 'Games and apps', 'ゲーム・アプリ', [9, 28]],
      ['TOYS', 'Toys and games', '玩具・ゲーム', [28]],
      ['BOOKS', 'Books and art books', '書籍・画集', [16]],
      ['FOOD', 'Food and confectionery', '食品・菓子', [30, 29]],
      ['BEVERAGES', 'Beverages', '飲料', [32]],
      ['COSMETICS', 'Cosmetics and fragrance', '化粧品・香水', [3]],
      ['EVENTS_SERVICES', 'Events, concerts and streaming services', 'イベント・ライブ・配信サービス', [41]],
      ['CAFE', 'Collaboration cafes and food service', 'コラボカフェ・飲食提供', [43]],
      ['RETAIL_SERVICES', 'Retail of character goods', 'キャラクターグッズの小売', [35]],
    ];
    for (const c of cats) val('category', c[0], c[1], c[2], 'ALL_CATEGORIES', c[3]);

    // Sales channel.
    val('channel', 'ALL_CHANNELS', 'All channels', '全チャネル', '');
    for (const ch of [
      ['RETAIL', 'Retail stores', '店舗'],
      ['ANIME_SHOPS', 'Anime and hobby shops', 'アニメ・ホビー専門店'],
      ['CONVENIENCE', 'Convenience stores', 'コンビニ'],
      ['ONLINE', 'Online stores', 'オンラインストア'],
      ['OWN_EC', 'Our own online store', '自社EC'],
      ['OVERSEAS_EC', 'Overseas e-commerce', '海外EC'],
      ['EVENT_ONLY', 'Event venues only', '会場限定'],
      ['MADE_TO_ORDER', 'Made to order', '受注生産'],
      ['LOTTERY', 'Lotteries (kuji)', 'くじ'],
      ['GACHA', 'Capsule toys (gacha)', 'カプセルトイ'],
      ['PRIZE', 'Prize machines', 'プライズ（クレーンゲーム）'],
      ['CAFE', 'Collaboration cafes', 'コラボカフェ'],
      ['WHOLESALE', 'Wholesale', '卸'],
      ['PROMOTIONAL', 'Promotional and premium', '販促・ノベルティ'],
    ]) {
      val('channel', ch[0], ch[1], ch[2], 'ALL_CHANNELS');
    }

    // Platform.
    val('platform', 'ALL_PLATFORMS', 'All platforms', '全プラットフォーム', '');
    for (const p of [
      ['YOUTUBE', 'YouTube', 'YouTube'],
      ['TWITCH', 'Twitch', 'Twitch'],
      ['NICONICO', 'niconico', 'ニコニコ'],
      ['TIKTOK', 'TikTok', 'TikTok'],
      ['X', 'X', 'X'],
      ['INSTAGRAM', 'Instagram', 'Instagram'],
      ['BILIBILI', 'Bilibili', 'bilibili'],
      ['TWITCASTING', 'TwitCasting', 'ツイキャス'],
      ['OWN_SITE', 'Our own site and app', '自社サイト・アプリ'],
      ['OTHER_PLATFORM', 'Other platforms', 'その他のプラットフォーム'],
    ]) {
      val('platform', p[0], p[1], p[2], 'ALL_PLATFORMS');
    }

    // --- official fees confirmed from primary sources ---------------------------------
    function fee(o, t, k, c, ct, a, cur, from, src, x) {
      const e = x || {};
      put('fee_schedule', {
        office: o,
        ip_type: t,
        fee_kind: k,
        cycle: c,
        cycle_to: ct,
        entity: 'any',
        per_class: e.pc === true,
        amount: a,
        per_claim_amount: 0,
        class_tiers: e.tiers || [],
        currency: cur,
        grace_surcharge: e.g || 0,
        surcharge_percent: e.gp === true,
        effective_from: from + ' 00:00:00.000Z',
        source: src,
        notes: e.notes || '',
      });
    }
    // USPTO trademark maintenance (37 CFR 2.6), per class.
    const USPTO_2025 = 'USPTO fee schedule effective 18 January 2025 (37 CFR 2.6). Verify current amounts at uspto.gov before relying on them.';
    fee('US', 'trademark', 'sec8', 0, 0, 325, 'USD', '2025-01-18', USPTO_2025, { pc: true, g: 100 });
    fee('US', 'trademark', 'sec71', 0, 0, 325, 'USD', '2025-01-18', USPTO_2025, { pc: true, g: 100 });
    fee('US', 'trademark', 'renewal', 0, 0, 650, 'USD', '2025-01-18', USPTO_2025, {
      pc: true,
      g: 200,
      notes: 'Combined Section 8 declaration (USD 325) and Section 9 renewal (USD 325) per class.',
    });
    fee('US', 'trademark', 'sec15', 0, 0, 250, 'USD', '2025-01-18', USPTO_2025, { pc: true });
    // EUIPO.
    fee('EM', 'trademark', 'renewal', 0, 0, 850, 'EUR', '2016-03-23', 'EUIPO fees payable direct to the Office: EU trade mark e-renewal 850 (first class), 50 (second class), 150 (each further class). Late renewal: +25%, at most EUR 1,500.', {
      tiers: [{ from: 2, amount: 50 }, { from: 3, amount: 150 }],
      g: 25,
      gp: true,
      notes: 'Paper renewal costs EUR 1,000 basic. Collective and certification marks cost EUR 1,500 basic.',
    });
    [[1, 150], [2, 250], [3, 400], [4, 700]].forEach(function (r) {
      fee('EM', 'design', 'renewal', r[0], 0, r[1], 'EUR', '2025-05-01', 'EUIPO EU design renewal fees from 1 May 2025 (Reg. (EU) 2024/2822, Annex I), per design. Late renewal: +25%.', {
        g: 25,
        gp: true,
      });
    });
    // JPO (schedule on or after 1 April 2022). Late payment in the 6-month grace period doubles the fee.
    const JPO_SRC = 'JPO schedule of fees on or after 1 April 2022. Late payment within the 6-month grace period: surcharge equal to the fee.';
    fee('JP', 'design', 'annuity', 2, 3, 8500, 'JPY', '2022-04-01', JPO_SRC, { g: 100, gp: true });
    fee('JP', 'design', 'annuity', 4, 25, 16900, 'JPY', '2022-04-01', JPO_SRC, { g: 100, gp: true });
    fee('JP', 'trademark', 'second_half', 0, 0, 17200, 'JPY', '2022-04-01', 'JPO schedule of fees on or after 1 April 2022: split registration fee, per class per half.', {
      pc: true,
      notes: 'Second halves whose first half was paid or due by 31 March 2022 keep the old JPY 16,400 per class.',
    });
    fee('JP', 'trademark', 'renewal', 0, 0, 43600, 'JPY', '2022-04-01', JPO_SRC, {
      pc: true,
      g: 100,
      gp: true,
      notes: 'A split renewal (5 years at a time) costs JPY 22,800 per class per half.',
    });
    // WIPO Madrid renewal (Schedule of fees as in force on 1 February 2023, item 6).
    fee('WO', 'trademark', 'renewal', 0, 0, 653, 'CHF', '2023-02-01', 'WIPO Madrid schedule of fees (1 February 2023), item 6: basic fee CHF 653, supplementary fee CHF 100 per class beyond three. Grace period: +50% of the basic fee (CHF 326.50).', {
      tiers: [{ from: 4, amount: 100 }],
      g: 326.5,
      notes: 'Add CHF 100 for each designated country without an individual fee, and each country\'s own individual fee where it charges one.',
    });

    // --- deadline rule catalog ------------------------------------------------------------
    const R = [];
    function rule(code, name, nameJa, subject, jur, trigger, base, ymd, kind, category, title, titleJa, extra) {
      const x = extra || {};
      R.push({
        code: code,
        name: name,
        name_ja: nameJa,
        subject_type: subject,
        jurisdiction: jur,
        routes: x.routes || [],
        trigger_event: trigger,
        conditions: x.conditions || {},
        base: base,
        offset_years: ymd[0],
        offset_months: ymd[1],
        offset_days: ymd[2],
        offset_unit: x.business ? 'business' : 'calendar',
        due_end_of_month: x.eom === true,
        kind: kind,
        category: category,
        title: title,
        title_ja: titleJa,
        extensions: x.extensions || [],
        final_offset_months: x.final || 0,
        final_offset_days: x.finalDays || 0,
        window_months: x.window || 0,
        grace_months: x.grace || 0,
        grace_note: x.graceNote || '',
        recurring_years: x.every || 0,
        recurring_until_years: x.until || 0,
        recurring_first_cycle: x.first || 0,
        cycle_label: x.cycleLabel || '',
        roll_office: x.roll || '',
        citation: x.cite || '',
        summary: x.summary || '',
        summary_ja: x.summaryJa || '',
        notes: x.notes || '',
        effective_from: x.from || '1900-01-01 00:00:00.000Z',
        effective_to: x.to || '',
        version: x.version || 1,
        enabled: true,
        system: true,
        creates_renewal: x.renewal === true,
        fee_kind: x.feeKind || '',
      });
    }
    const PROCEDURE_EXT = [{ months: 2, label: 'Extension requested after expiry (within 2 months)', label_ja: '期間経過後の延長請求（2か月以内）' }];

    // Paris Convention priority.
    rule('PARIS-PRIORITY-TM', 'Paris priority (trademarks)', 'パリ優先権（商標）', 'trademark', '*', 'FILED', 'event_date', [0, 6, 0], 'hard', 'filing',
      'Foreign filing deadline (6-month priority)', '外国出願期限（優先期間6か月）', {
        conditions: { first_filing: true },
        cite: 'Paris Convention Art. 4C(1)',
        notes: 'File abroad within 6 months to claim this filing date. Character names are squatted most often in China, Korea and Taiwan.',
      });
    rule('PARIS-PRIORITY-DESIGN', 'Paris priority (designs)', 'パリ優先権（意匠）', 'design', '*', 'FILED', 'event_date', [0, 6, 0], 'hard', 'filing',
      'Foreign filing deadline (6-month priority)', '外国出願期限（優先期間6か月）', {
        conditions: { first_filing: true },
        cite: 'Paris Convention Art. 4C(1)',
      });

    // Japan (JPO): trademarks.
    rule('JP-TM-OA-REFUSAL', 'JP trademark notice of reasons for refusal', '拒絶理由通知（商標）', 'trademark', 'JP', 'OA_ISSUED', 'event_date', [0, 3, 0], 'designated', 'prosecution',
      'Respond to notice of reasons for refusal', '拒絶理由通知への応答', {
        extensions: PROCEDURE_EXT,
        cite: 'JP Trademark Act Art. 15-2, 77; Patent Act Art. 5 applied mutatis mutandis',
        notes: 'The examiner sets the period (40 days for residents, 3 months for applicants abroad). Enter the period from the notice.',
      });
    rule('JP-APPEAL-TM', 'JP appeal against refusal (trademark)', '拒絶査定不服審判（商標）', 'trademark', 'JP', 'REFUSED', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'File appeal against decision of refusal', '拒絶査定不服審判の請求', { cite: 'JP Trademark Act Art. 44(1)' });
    rule('JP-TM-REG-FEE', 'JP trademark registration fee', '登録料納付（商標）', 'trademark', 'JP', 'NOTICE_ALLOWANCE', 'event_date', [0, 0, 30], 'extendable', 'prosecution',
      'Pay trademark registration fee (10 years, or the first 5-year half)', '登録料の納付（10年分または前期5年分）', {
        extensions: [{ months: 1, label: '30-day extension on request', label_ja: '請求による30日の延長' }],
        cite: 'JP Trademark Act Art. 40, 41, 41-2',
      });
    rule('JP-TM-SECOND-HALF', 'JP trademark second-half fee', '後期分割登録料（商標）', 'trademark', 'JP', 'REGISTERED', 'registration_date', [5, 0, 0], 'hard', 'renewal',
      'Pay second 5-year half of the registration fee', '後期分割登録料の納付', {
        conditions: { option: 'jp_split_fee' },
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the fee.',
        cite: 'JP Trademark Act Art. 41-2(1), (5), 43(3)',
        renewal: true,
        feeKind: 'second_half',
        cycleLabel: 'Second 5-year half',
      });
    rule('JP-TM-RENEWAL', 'JP trademark renewal', '商標権の存続期間更新', 'trademark', 'JP', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew JP trademark registration', '商標権の更新登録申請', {
        window: 6,
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the renewal fee. The JPO sends no reminder.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'JP Trademark Act Art. 19, 20(2)-(4), 21, 43(1)',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('JP-TM-OPPOSITION', 'JP trademark opposition period', '登録異議申立期間（商標）', 'trademark', 'JP', 'GAZETTE_PUBLISHED', 'event_date', [0, 2, 0], 'reminder', 'opposition',
      'Opposition period ends (2 months from the trademark gazette)', '登録異議申立期間の満了（商標公報発行から2か月）', { cite: 'JP Trademark Act Art. 43-2' });
    rule('JP-TM-NONUSE', 'JP trademark non-use exposure', '不使用取消リスク（商標）', 'trademark', 'JP', 'REGISTERED', 'registration_date', [3, 0, 0], 'reminder', 'use',
      'Non-use cancellation exposure begins (3 years without use)', '不使用取消審判の対象となり得る時期（3年間不使用）', {
        cite: 'JP Trademark Act Art. 50',
        notes: 'Use by a licensee counts. Keep evidence from royalty reports and approved samples for each class.',
      });
    // Japan: designs (figures and goods).
    rule('JP-DES-OA-REFUSAL', 'JP design notice of reasons for refusal', '拒絶理由通知（意匠）', 'design', 'JP', 'OA_ISSUED', 'event_date', [0, 3, 0], 'designated', 'prosecution',
      'Respond to notice of reasons for refusal', '拒絶理由通知への応答', {
        extensions: PROCEDURE_EXT,
        cite: 'JP Design Act Art. 19, 68; Patent Act Art. 5, 50 applied mutatis mutandis',
        notes: 'The examiner sets the period. Enter the period from the notice.',
      });
    rule('JP-APPEAL-DESIGN', 'JP appeal against refusal (design)', '拒絶査定不服審判（意匠）', 'design', 'JP', 'REFUSED', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'File appeal against decision of refusal', '拒絶査定不服審判の請求', { cite: 'JP Design Act Art. 46(1)' });
    rule('JP-DES-REG-FEE', 'JP design registration fee (year 1)', '登録料納付（意匠第1年分）', 'design', 'JP', 'NOTICE_ALLOWANCE', 'event_date', [0, 0, 30], 'extendable', 'prosecution',
      'Pay first-year design registration fee (30 days from decision)', '第1年分の登録料納付（査定から30日）', {
        extensions: [{ months: 1, label: '30-day extension on request', label_ja: '請求による30日の延長' }],
        cite: 'JP Design Act Art. 43(1), (3)',
      });
    rule('JP-DES-ANNUITY', 'JP design annual fees', '意匠登録料（年金）', 'design', 'JP', 'REGISTERED', 'registration_date', [1, 0, 0], 'hard', 'renewal',
      'Pay JP design annual fee, year {n}', '意匠登録料の納付（第{n}年分）', {
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the fee.',
        every: 1,
        first: 2,
        until: 25,
        cycleLabel: 'Year {n}',
        conditions: { stop_at_expiry: true },
        cite: 'JP Design Act Art. 21, 43, 44',
        notes: 'Design term is 25 years from filing.',
        renewal: true,
        feeKind: 'annuity',
      });

    // United States.
    rule('US-TM-OA', 'US trademark office action', '米国商標オフィスアクション', 'trademark', 'US', 'OA_ISSUED', 'event_date', [0, 3, 0], 'extendable', 'prosecution',
      'Respond to trademark office action', 'オフィスアクションへの応答', {
        extensions: [{ months: 3, label: 'Three-month extension (request and fee before the deadline)', label_ja: '3か月延長（期限前に請求と手数料）' }],
        final: 6,
        cite: '15 U.S.C. 1062(b); 37 CFR 2.62(a)',
        notes: 'The extension must be requested within the initial 3-month period.',
      });
    rule('US-TM-SOU', 'US statement of use', '米国使用宣誓書', 'trademark', 'US', 'NOTICE_ALLOWANCE', 'event_date', [0, 6, 0], 'extendable', 'use',
      'File statement of use or request an extension', '使用宣誓書の提出または延長請求', {
        extensions: [
          { months: 6, label: 'First extension (6 months)', label_ja: '第1回延長（6か月）' },
          { months: 12, label: 'Second extension', label_ja: '第2回延長' },
          { months: 18, label: 'Third extension', label_ja: '第3回延長' },
          { months: 24, label: 'Fourth extension', label_ja: '第4回延長' },
          { months: 30, label: 'Fifth extension', label_ja: '第5回延長' },
        ],
        final: 36,
        cite: '15 U.S.C. 1051(d); 37 CFR 2.88, 2.89',
      });
    rule('US-TM-OPPOSITION', 'US opposition period (publication)', '米国異議申立期間', 'trademark', 'US', 'PUBLISHED', 'event_date', [0, 0, 30], 'reminder', 'opposition',
      'Opposition period after publication ends', '公告後の異議申立期間の満了', {
        cite: '15 U.S.C. 1063(a); 37 CFR 2.101-2.102',
        notes: 'Third parties may extend the period by request, up to 180 days from publication.',
      });
    rule('US-TM-SEC8', 'US Section 8 declaration of use', '米国第8条使用宣誓', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'hard', 'use',
      'File Section 8 declaration of use (between years 5 and 6)', '第8条使用宣誓書の提出（5年目から6年目）', {
        conditions: { not_routes: ['designation', 'madrid'] },
        window: 12,
        grace: 6,
        graceNote: 'Grace period of 6 months with surcharge.',
        cite: '15 U.S.C. 1058(a)(1); 37 CFR 2.160',
        renewal: true,
        feeKind: 'sec8',
        cycleLabel: 'Section 8 declaration (year 6)',
      });
    rule('US-TM-SEC71', 'US Section 71 declaration (Madrid designation)', '米国第71条使用宣誓（マドリッド）', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'hard', 'use',
      'File Section 71 declaration of use (between years 5 and 6)', '第71条使用宣誓書の提出（5年目から6年目）', {
        routes: ['designation', 'madrid'],
        window: 12,
        grace: 6,
        graceNote: 'Grace period of 6 months with surcharge.',
        cite: '15 U.S.C. 1141k; 37 CFR 7.36',
        renewal: true,
        feeKind: 'sec71',
        cycleLabel: 'Section 71 declaration (year 6)',
      });
    rule('US-TM-RENEWAL', 'US renewal (Sections 8 and 9)', '米国商標更新（第8条・第9条）', 'trademark', 'US', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew registration (combined Sections 8 and 9)', '登録の更新（第8条・第9条の合同申請）', {
        conditions: { not_routes: ['designation', 'madrid'] },
        window: 12,
        grace: 6,
        graceNote: 'Grace period of 6 months with surcharge.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: '15 U.S.C. 1058, 1059; 37 CFR 2.182',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('US-TM-SEC15', 'US Section 15 incontestability', '米国第15条不可争性宣誓', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'reminder', 'use',
      'Consider Section 15 declaration of incontestability (after 5 years of continuous use)', '第15条不可争性宣誓の検討（5年間の継続使用後）', {
        conditions: { tm_register: 'principal' },
        window: 12,
        cite: '15 U.S.C. 1065; 37 CFR 2.167',
        notes: 'Optional. Usually filed together with the Section 8 declaration.',
      });
    rule('US-DES-ISSUE-FEE', 'US design issue fee', '米国意匠登録料', 'design', 'US', 'NOTICE_ALLOWANCE', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'Pay design issue fee (not extendable)', '意匠登録料の納付（延長不可）', {
        cite: '35 U.S.C. 151; 37 CFR 1.311(a)',
        notes: 'US design patents last 15 years from grant and have no maintenance fees.',
      });

    // EUIPO.
    rule('EM-TM-OPPOSITION', 'EU trade mark opposition period', 'EU商標異議申立期間', 'trademark', 'EM', 'PUBLISHED', 'event_date', [0, 3, 0], 'reminder', 'opposition',
      'Opposition period ends (3 months from publication)', '異議申立期間の満了（公告から3か月）', { cite: 'Art. 46(1) Reg. (EU) 2017/1001 (EUTMR)' });
    rule('EM-TM-RENEWAL', 'EU trade mark renewal', 'EU商標の更新', 'trademark', 'EM', 'REGISTERED', 'filing_date', [10, 0, 0], 'hard', 'renewal',
      'Renew EU trade mark', 'EU商標の更新', {
        window: 6,
        grace: 6,
        graceNote: 'Additional 6 months with a surcharge.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'Art. 52, 53 EUTMR',
        notes: 'Registration runs 10 years from the filing date.',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('EM-TM-NONUSE', 'EU trade mark genuine use', 'EU商標の真正な使用', 'trademark', 'EM', 'REGISTERED', 'registration_date', [5, 0, 0], 'reminder', 'use',
      'Non-use vulnerability begins (5 years after registration)', '不使用取消リスクの開始（登録から5年）', {
        cite: 'Art. 18, 58(1)(a) EUTMR',
        notes: 'Keep evidence of genuine use in the EU for each class.',
      });
    rule('EM-DES-RENEWAL', 'Registered EU design renewal', 'EU意匠の更新', 'design', 'EM', 'REGISTERED', 'filing_date', [5, 0, 0], 'hard', 'renewal',
      'Renew registered EU design', 'EU登録意匠の更新', {
        window: 6,
        grace: 6,
        graceNote: 'Additional 6 months with a surcharge.',
        every: 5,
        first: 1,
        until: 25,
        cycleLabel: 'Renewal {n} (5-year term)',
        cite: 'Art. 12, 13 Reg. (EC) 6/2002 as amended by Reg. (EU) 2024/2822',
        notes: 'Protection runs in 5-year periods from the filing date, up to 25 years.',
        renewal: true,
        feeKind: 'renewal',
      });

    // Madrid system.
    rule('WO-MADRID-RENEWAL', 'Madrid international registration renewal', '国際登録の更新（マドリッド）', 'trademark', 'WO', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew international registration', '国際登録の更新', {
        routes: ['madrid'],
        window: 6,
        grace: 6,
        graceNote: '6-month grace with a surcharge.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'Madrid Protocol Art. 7; Common Regulations Rules 29-30',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('WO-MADRID-DEPENDENCY', 'Madrid dependency period', '基礎登録への従属期間', 'trademark', 'WO', 'REGISTERED', 'registration_date', [5, 0, 0], 'reminder', 'term',
      'Dependency on the basic mark ends (central attack no longer possible)', '基礎登録への従属期間の満了（セントラルアタックの終了）', {
        routes: ['madrid'],
        cite: 'Madrid Protocol Art. 6(2), (3)',
      });

    // Copyright (titles) and author grants.
    rule('US-CR-REGISTER-412', 'US copyright registration after publication', '米国著作権登録（発行後3か月）', 'work', 'US', 'WORK_PUBLISHED', 'event_date', [0, 3, 0], 'internal', 'copyright',
      'Register copyright within 3 months of first publication', '最初の発行から3か月以内に著作権登録', {
        conditions: { missing_external_id: 'us_copyright_reg' },
        cite: '17 U.S.C. 412',
        notes: 'Registration within 3 months keeps statutory damages and attorney fees available for US infringement that starts before registration. Applies when the title is first published in the US.',
      });
    rule('US-CR-TERM-NOTICE', 'Section 203 termination notice window', '米国著作権法203条 終了通知の開始', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [25, 0, 0], 'reminder', 'copyright',
      'Author may serve a termination notice from this date (Section 203)', '著作者が終了通知を送付できる時期の開始（203条）', {
        cite: '17 U.S.C. 203(a)(4)(A)',
        notes: 'Notice must be served 2 to 10 years before the termination date and recorded before it. Works made for hire are excluded.',
      });
    rule('US-CR-TERM-OPENS', 'Section 203 termination window opens', '米国著作権法203条 終了可能期間の開始', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [35, 0, 0], 'reminder', 'copyright',
      'Termination window opens (35 years after the grant)', '終了可能期間の開始（許諾から35年）', {
        cite: '17 U.S.C. 203(a)(3)',
        notes: 'If the grant covers publication, the window starts at the earlier of 35 years from publication or 40 years from the grant.',
      });
    rule('US-CR-TERM-CLOSES', 'Section 203 termination window closes', '米国著作権法203条 終了可能期間の終了', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [40, 0, 0], 'reminder', 'copyright',
      'Termination window closes (40 years after the grant)', '終了可能期間の終了（許諾から40年）', { cite: '17 U.S.C. 203(a)(3)' });

    // YouTube Content ID.
    rule('CID-DISPUTE-RESPONSE', 'Content ID dispute response', 'Content ID 異議への対応', 'claim', '*', 'CID_DISPUTE_RECEIVED', 'event_date', [0, 0, 30], 'hard', 'content_id',
      'Respond to the Content ID dispute (claim expires after 30 days)', 'Content IDの異議に対応（30日で申し立てが失効）', {
        cite: 'YouTube Help: Respond to a Content ID dispute',
        notes: 'Release, uphold, or take down. With no response the claim expires and the video is released.',
      });
    rule('CID-APPEAL-RESPONSE', 'Content ID appeal response', 'Content ID 再審査請求への対応', 'claim', '*', 'CID_APPEAL_RECEIVED', 'event_date', [0, 0, 7], 'hard', 'content_id',
      'Respond to the Content ID appeal (7 days)', 'Content IDの再審査請求に対応（7日以内）', {
        cite: 'YouTube Help: Respond to a Content ID appeal',
        notes: 'Release the claim, or submit a copyright removal request.',
      });

    // Enforcement forums.
    rule('JP-PLATFORM-DECISION', 'Japanese designated platform decision', '大規模プラットフォームの判断通知', 'case', 'JP', 'PLATFORM_REQUEST_SENT', 'event_date', [0, 0, 7], 'reminder', 'enforcement',
      'Platform must tell you its decision within 7 days (follow up if it has not)', 'プラットフォームは7日以内に判断を通知（未回答なら確認）', {
        cite: 'Information Distribution Platform Act (情報流通プラットフォーム対処法) Art. 25',
        notes: 'Applies to designated large platforms (YouTube, X, TikTok, Meta services, LINE Yahoo and others). The platform may instead say within 7 days that it is consulting the sender or an expert.',
      });
    rule('US-DMCA-RESTORE', 'DMCA counter-notice restore window', 'DMCA カウンター通知後の復元期間', 'case', 'US', 'COUNTER_NOTICE_RECEIVED', 'event_date', [0, 0, 10], 'hard', 'enforcement',
      'File suit before the platform restores the material (10 to 14 business days)', 'プラットフォームが復元する前に訴訟提起（10から14営業日）', {
        business: true,
        roll: 'US',
        finalDays: 14,
        cite: '17 U.S.C. 512(g)(2)(C)',
        notes: 'The service restores the material not less than 10 and not more than 14 business days after receiving the counter-notice, unless it is told that suit has been filed.',
      });
    rule('JP-CUSTOMS-OPINION', 'JP customs verification procedure', '税関 認定手続（意見・証拠の提出）', 'case', 'JP', 'CUSTOMS_SUSPENSION_NOTICE', 'event_date', [0, 0, 10], 'hard', 'customs',
      'Submit evidence and opinion in the verification procedure (10 working days)', '認定手続で証拠・意見を提出（10執務日）', {
        business: true,
        roll: 'JP',
        cite: 'Customs Act Art. 69-12; Customs Act Enforcement Order Art. 62-16',
        notes: 'The importer has the same 10 working days to contest. Without a contest, customs decides on the application file.',
      });
    rule('CN-CUSTOMS-COURT', 'China customs detention (on application)', '中国税関の差止め（申請による）', 'case', 'CN', 'DETENTION_NOTICE', 'event_date', [0, 0, 20], 'hard', 'customs',
      'Obtain a court order before customs releases the goods (20 working days)', '税関が貨物を解放する前に裁判所の命令を取得（20執務日）', {
        business: true,
        roll: 'CN',
        conditions: { data_not: { mode: 'ex_officio' } },
        cite: 'Regulations of the PRC on Customs Protection of IPR Art. 24',
        notes: 'Goods detained on the right holder\'s application are released if no court order arrives within 20 working days.',
      });
    rule('CN-CUSTOMS-COURT-EXOFFICIO', 'China customs detention (ex officio)', '中国税関の差止め（職権による）', 'case', 'CN', 'DETENTION_NOTICE', 'event_date', [0, 0, 50], 'hard', 'customs',
      'Obtain a court order before customs releases the goods (50 working days)', '税関が貨物を解放する前に裁判所の命令を取得（50執務日）', {
        business: true,
        roll: 'CN',
        conditions: { data_equals: { mode: 'ex_officio' } },
        cite: 'Regulations of the PRC on Customs Protection of IPR Art. 24',
        notes: 'For goods detained by customs on its own initiative the period is 50 working days from detention.',
      });
    rule('EU-CUSTOMS-CONFIRM', 'EU customs detention', 'EU税関の差止め', 'case', 'EU', 'DETENTION_NOTICE', 'event_date', [0, 0, 10], 'extendable', 'customs',
      'Confirm destruction or start proceedings (10 working days)', '廃棄の同意または訴訟提起（10執務日）', {
        business: true,
        roll: 'EM',
        extensions: [{ days: 10, label: 'Extension of 10 working days on request', label_ja: '請求による10執務日の延長' }],
        cite: 'Reg. (EU) 608/2013 Art. 23(1), (4)',
        notes: '3 working days for perishable goods.',
      });
    rule('US-CBP-DETENTION', 'US CBP detention period', '米国CBPの留置期間', 'case', 'US', 'DETENTION_NOTICE', 'event_date', [0, 0, 30], 'reminder', 'customs',
      'Detention period ends (30 days)', '留置期間の終了（30日）', {
        cite: '19 CFR 133.21',
        notes: 'CBP notifies the importer within 5 business days of the decision to detain; the importer has 7 business days to respond.',
      });

    // Customs recordations.
    rule('JP-CUSTOMS-RENEWAL', 'JP customs suspension application renewal', '輸入差止申立の更新', 'recordation', 'JP', 'RECORDATION_ACCEPTED', 'valid_until', [0, -3, 0], 'internal', 'customs',
      'Renew the import suspension application (from 3 months before expiry)', '輸入差止申立の更新申請（満了3か月前から）', {
        cite: 'Customs Act Art. 69-13; Japan Customs import suspension procedures',
        notes: 'Valid up to 4 years, never beyond the paid term of the right.',
      });
    rule('CN-CUSTOMS-RENEWAL', 'China customs recordation renewal', '中国税関知財備案の更新', 'recordation', 'CN', 'RECORDATION_ACCEPTED', 'valid_until', [0, -6, 0], 'internal', 'customs',
      'Renew the customs IP recordation (within 6 months before expiry)', '税関知的財産権備案の更新（満了前6か月以内）', {
        cite: 'Regulations of the PRC on Customs Protection of IPR Art. 10',
        notes: 'Recordation lasts 10 years or until the right expires.',
      });
    rule('EU-AFA-RENEWAL', 'EU application for action extension', 'EU税関措置申請の延長', 'recordation', 'EU', 'RECORDATION_ACCEPTED', 'valid_until', [0, 0, -30], 'hard', 'customs',
      'Request extension of the application for action (30 working days before expiry)', '措置申請の延長請求（満了の30執務日前まで）', {
        business: true,
        roll: 'EM',
        cite: 'Reg. (EU) 608/2013 Art. 12(1)',
        notes: 'The action period is at most 1 year and can be extended by up to 1 year at a time.',
      });

    // Talent playbooks (category playbook). Offsets come from real graduations; all editable.
    rule('TALENT-DEBUT-TM', 'Debut: trademarks before announcement', 'デビュー：発表前の商標出願', 'talent', '*', 'DEBUT_SCHEDULED', 'debut_date', [0, -3, 0], 'internal', 'playbook',
      'File trademarks for the name before the debut is announced', 'デビュー発表前に名称の商標を出願', {
        notes: 'Japanese filings appear on J-PlatPat about 2 to 3 weeks after filing. Use the leak check on the trademark.',
      });
    rule('TALENT-DEBUT-PERMISSIONS', 'Debut: permissions', 'デビュー：許諾の確認', 'talent', '*', 'DEBUT_SCHEDULED', 'debut_date', [0, 0, -14], 'internal', 'playbook',
      'Confirm game, music and platform permissions cover the talent', 'ゲーム・楽曲・プラットフォームの許諾がタレントを含むか確認');
    rule('TALENT-DEBUT-CONTENTID', 'Debut: Content ID allowlist', 'デビュー：Content ID 許可リスト', 'talent', '*', 'DEBUT_SCHEDULED', 'debut_date', [0, 0, -7], 'internal', 'playbook',
      'Add the talent\'s channels to the Content ID allowlist', 'タレントのチャンネルをContent ID許可リストに追加', {
        notes: 'Adding a channel does not release claims already made.',
      });
    rule('TALENT-DEBUT-GUIDELINES', 'Debut: fan and clip guidelines', 'デビュー：二次創作・切り抜きガイドライン', 'talent', '*', 'DEBUT_SCHEDULED', 'debut_date', [0, 0, -7], 'internal', 'playbook',
      'Publish fan-work and clip guidelines that cover the talent', 'タレントを含む二次創作・切り抜きガイドラインを公開');
    rule('TALENT-GRAD-LICENSEES', 'Graduation: notify licensees', '卒業：ライセンシーへの通知', 'talent', '*', 'GRADUATION_SCHEDULED', 'event_date', [0, 0, 3], 'internal', 'playbook',
      'Notify licensees and set each sell-off end date', 'ライセンシーへ通知し、販売終了日を設定');
    rule('TALENT-GRAD-ORDERS', 'Graduation: order cut-off', '卒業：受注締切', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 0, -6], 'internal', 'playbook',
      'Close graduation and made-to-order merch orders', '卒業グッズ・受注生産品の受付終了', {
        notes: 'Tsukumo Sana\'s 2022 graduation merch closed 6 days before her graduation date.',
      });
    rule('TALENT-GRAD-LAST-DAY', 'Graduation: last day', '卒業：最終日', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 0, 0], 'hard', 'playbook',
      'Last stream: no new products, digital voice sales end', '最終配信：新規商品の停止、デジタルボイス販売終了');
    rule('TALENT-GRAD-PERMISSIONS', 'Graduation: third-party permissions', '卒業：第三者の許諾', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 0, 0], 'internal', 'playbook',
      'Review third-party permissions tied to the talent (they may end today)', 'タレントに紐づく第三者の許諾を確認（本日で終了する場合あり）', {
        notes: 'The licensed game あくありうむ。 ended its relaxed streaming rules on Minato Aqua\'s graduation date.',
      });
    rule('TALENT-GRAD-ACCOUNTS', 'Graduation: accounts and archives', '卒業：アカウントとアーカイブ', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 0, 30], 'internal', 'playbook',
      'Decide social accounts and record the archive decision for each video', 'SNSアカウントの扱いと各動画のアーカイブ方針を決定');
    rule('TALENT-GRAD-MEMBERSHIP', 'Graduation: membership and trademarks', '卒業：メンバーシップと商標', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 3, 0], 'internal', 'playbook',
      'Close membership; decide each trademark (keep, abandon or assign); update Content ID and distribution', 'メンバーシップ終了、各商標の方針（維持・放棄・譲渡）、Content IDと配信の更新', {
        notes: 'Kiryu Coco\'s membership stayed open for 3 months after graduation.',
      });
    rule('TALENT-GRAD-SHIPPING', 'Graduation: shipping complete', '卒業：発送完了', 'talent', '*', 'GRADUATION_SCHEDULED', 'graduation_date', [0, 6, 0], 'internal', 'playbook',
      'Made-to-order shipping complete; close refunds and cancellations', '受注生産品の発送完了、返金・キャンセル対応の終了');
    rule('TALENT-TERM-STOP', 'Termination: stop', '契約解除：停止', 'talent', '*', 'TERMINATED', 'event_date', [0, 0, 0], 'hard', 'playbook',
      'Stop sales and activity; notify licensees', '販売と活動を停止し、ライセンシーへ通知');
    rule('TALENT-TERM-REFUNDS', 'Termination: refunds', '契約解除：返金', 'talent', '*', 'TERMINATED', 'event_date', [0, 1, 0], 'internal', 'playbook',
      'Settle refunds for unshipped orders', '未発送注文の返金を完了');
    rule('TALENT-TERM-MARKS', 'Termination: trademarks', '契約解除：商標', 'talent', '*', 'TERMINATED', 'event_date', [0, 3, 0], 'internal', 'playbook',
      'Decide each trademark (keep, abandon or assign)', '各商標の方針を決定（維持・放棄・譲渡）', {
        notes: 'The JFTC performer guideline (2026) cites transferring the stage-name trademark to the departing performer as good practice.',
      });
    rule('TALENT-TERM-FOOTAGE', 'Termination: past footage', '契約解除：過去映像', 'talent', '*', 'TERMINATED', 'event_date', [0, 0, 0], 'reminder', 'playbook',
      'Reuse of past footage needs case-by-case confirmation with the former performer', '過去映像の再利用は元演者と個別に確認', {
        cite: 'JFTC guideline on performers and agencies (revised 1 January 2026)',
      });

    for (const r of R) put('rules', r);
  },
  (app) => {
    for (const n of ['rules', 'fee_schedule', 'dimension_values', 'dimensions', 'fx_rates', 'office_connections', 'settings']) {
      try {
        const recs = app.findAllRecords(n);
        for (const r of recs) app.delete(r);
      } catch {
        /* absent */
      }
    }
  },
);
