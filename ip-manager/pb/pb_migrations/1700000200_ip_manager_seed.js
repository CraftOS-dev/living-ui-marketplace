/// <reference path="../pb_data/types.d.ts" />
/**
 * IP Manager reference data: organization defaults, the deadline rule
 * catalog (every rule carries its legal citation), rights dimensions,
 * invention scoring criteria, office connection slots, and the official
 * fees we could confirm from primary sources. Office closure calendars are
 * generated lazily per year by lib_calendar.js (see lib_engine.ensureCalendar).
 *
 * Rules are data: admins can disable, edit or add rules in Settings. A seed
 * rule is marked system=true so the UI can show "shipped with IP Manager".
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
      vocab_pack: 'general',
      home_currency: 'USD',
      target_buffer_days: 14,
      reminder_days: [90, 60, 30, 14, 7, 1],
      digest_enabled: true,
      digest_hour: 8,
      digest_channel: 'in_app',
      slack_channel: '',
      second_reviewer: false,
      renewal_default: 'decide',
      default_signup_role: 'contributor',
      jurisdictions: ['US', 'EP', 'EM', 'JP', 'WO'],
      ref_prefix_patent: 'P',
      ref_prefix_trademark: 'TM',
      ref_prefix_design: 'D',
      ref_prefix_copyright: 'CR',
      ref_prefix_agreement: 'AG',
      ref_prefix_invention: 'INV',
      onboarding_done: false,
      fx_auto: true,
      sync_enabled: true,
      sync_hour: 2,
    });

    // --- office connection slots ----------------------------------------------
    for (const office of ['uspto_odp', 'uspto_tsdr', 'epo_ops', 'euipo', 'jpo']) {
      put('office_connections', { office: office, enabled: false, sandbox: false, status: 'not_configured', has_secret: false });
    }

    // --- FX anchor (ECB rates are fetched daily; EUR is the pivot) -------------
    put('fx_rates', { code: 'EUR', per_eur: 1, source: 'manual', as_of: new Date().toISOString() });

    // --- scoring criteria for invention review -----------------------------------
    const criteria = [
      ['market_value', 'Value in market', 'How much revenue or strategic value the invention could protect.', 3],
      ['core_business', 'Core to business', 'How central the invention is to current or planned products.', 3],
      ['commercial_plans', 'Commercialization plans', 'Whether there is a concrete plan to ship or license it.', 2],
      ['detectability', 'Detectability', 'How easily use by others could be seen and proven.', 2],
      ['patentability', 'Patentability likelihood', 'Novelty and inventive step against what is already known.', 3],
      ['enforceability', 'Enforceability', 'How practical it would be to enforce a granted patent.', 2],
    ];
    criteria.forEach(function (c, i) {
      put('scoring_criteria', {
        key: c[0],
        label: c[1],
        description: c[2],
        weight: c[3],
        order: i,
        enabled: true,
        levels: [
          { value: 0, label: 'None' },
          { value: 25, label: 'Low' },
          { value: 50, label: 'Moderate' },
          { value: 75, label: 'High' },
          { value: 100, label: 'Very high' },
        ],
      });
    });

    // --- rights dimensions -----------------------------------------------------------
    const dims = [
      ['territory', 'Territory', 1, true, 'Where the right may be exercised.'],
      ['media', 'Media', 2, true, 'Formats and exploitation media (film, TV, streaming, print, merchandise).'],
      ['language', 'Language', 3, true, 'Dubbed, subtitled or published language versions.'],
      ['channel', 'Channel', 4, false, 'Sales or distribution channel.'],
      ['category', 'Product category', 5, true, 'Licensed product categories for merchandise and brand deals.'],
      ['field_of_use', 'Field of use', 6, true, 'Technical field for patent and technology licences.'],
    ];
    for (const d of dims) {
      put('dimensions', { key: d[0], label: d[1], order: d[2], enabled: d[3], description: d[4] });
    }
    let order = 0;
    function val(dimension, code, label, parent) {
      order += 1;
      put('dimension_values', { dimension: dimension, code: code, label: label, parent_code: parent || '', order: order });
    }
    // Territory: World > regions > countries (ISO 3166-1 alpha-2).
    val('territory', 'WORLD', 'Worldwide', '');
    const regions = [
      ['EUROPE', 'Europe'],
      ['EU', 'European Union'],
      ['NORTH_AMERICA', 'North America'],
      ['LATAM', 'Latin America'],
      ['APAC', 'Asia Pacific'],
      ['MENA', 'Middle East and North Africa'],
      ['AFRICA', 'Sub-Saharan Africa'],
    ];
    for (const r of regions) val('territory', r[0], r[1], r[0] === 'EU' ? 'EUROPE' : 'WORLD');
    const countries = [
      ['AT', 'Austria', 'EU'], ['BE', 'Belgium', 'EU'], ['BG', 'Bulgaria', 'EU'], ['HR', 'Croatia', 'EU'],
      ['CY', 'Cyprus', 'EU'], ['CZ', 'Czechia', 'EU'], ['DK', 'Denmark', 'EU'], ['EE', 'Estonia', 'EU'],
      ['FI', 'Finland', 'EU'], ['FR', 'France', 'EU'], ['DE', 'Germany', 'EU'], ['GR', 'Greece', 'EU'],
      ['HU', 'Hungary', 'EU'], ['IE', 'Ireland', 'EU'], ['IT', 'Italy', 'EU'], ['LV', 'Latvia', 'EU'],
      ['LT', 'Lithuania', 'EU'], ['LU', 'Luxembourg', 'EU'], ['MT', 'Malta', 'EU'], ['NL', 'Netherlands', 'EU'],
      ['PL', 'Poland', 'EU'], ['PT', 'Portugal', 'EU'], ['RO', 'Romania', 'EU'], ['SK', 'Slovakia', 'EU'],
      ['SI', 'Slovenia', 'EU'], ['ES', 'Spain', 'EU'], ['SE', 'Sweden', 'EU'],
      ['GB', 'United Kingdom', 'EUROPE'], ['CH', 'Switzerland', 'EUROPE'], ['NO', 'Norway', 'EUROPE'],
      ['IS', 'Iceland', 'EUROPE'], ['TR', 'Türkiye', 'EUROPE'], ['UA', 'Ukraine', 'EUROPE'], ['RS', 'Serbia', 'EUROPE'],
      ['US', 'United States', 'NORTH_AMERICA'], ['CA', 'Canada', 'NORTH_AMERICA'],
      ['MX', 'Mexico', 'LATAM'], ['BR', 'Brazil', 'LATAM'], ['AR', 'Argentina', 'LATAM'], ['CL', 'Chile', 'LATAM'],
      ['CO', 'Colombia', 'LATAM'], ['PE', 'Peru', 'LATAM'],
      ['JP', 'Japan', 'APAC'], ['CN', 'China', 'APAC'], ['KR', 'South Korea', 'APAC'], ['TW', 'Taiwan', 'APAC'],
      ['HK', 'Hong Kong', 'APAC'], ['SG', 'Singapore', 'APAC'], ['IN', 'India', 'APAC'], ['AU', 'Australia', 'APAC'],
      ['NZ', 'New Zealand', 'APAC'], ['ID', 'Indonesia', 'APAC'], ['TH', 'Thailand', 'APAC'], ['MY', 'Malaysia', 'APAC'],
      ['PH', 'Philippines', 'APAC'], ['VN', 'Vietnam', 'APAC'],
      ['AE', 'United Arab Emirates', 'MENA'], ['SA', 'Saudi Arabia', 'MENA'], ['IL', 'Israel', 'MENA'],
      ['EG', 'Egypt', 'MENA'], ['QA', 'Qatar', 'MENA'], ['MA', 'Morocco', 'MENA'],
      ['ZA', 'South Africa', 'AFRICA'], ['NG', 'Nigeria', 'AFRICA'], ['KE', 'Kenya', 'AFRICA'],
    ];
    for (const c of countries) val('territory', c[0], c[1], c[2]);

    // Media.
    val('media', 'ALL_MEDIA', 'All media', '');
    const media = [
      ['THEATRICAL', 'Theatrical', 'ALL_MEDIA'],
      ['TV', 'Television', 'ALL_MEDIA'],
      ['FREE_TV', 'Free TV', 'TV'],
      ['PAY_TV', 'Pay TV', 'TV'],
      ['BASIC_CABLE', 'Basic cable', 'TV'],
      ['DIGITAL', 'Digital', 'ALL_MEDIA'],
      ['SVOD', 'Subscription streaming (SVOD)', 'DIGITAL'],
      ['AVOD', 'Ad-supported streaming (AVOD)', 'DIGITAL'],
      ['FAST', 'Free ad-supported channels (FAST)', 'DIGITAL'],
      ['TVOD', 'Rental (TVOD)', 'DIGITAL'],
      ['EST', 'Digital purchase (EST)', 'DIGITAL'],
      ['HOME_VIDEO', 'Home video (physical)', 'ALL_MEDIA'],
      ['NON_THEATRICAL', 'Non-theatrical', 'ALL_MEDIA'],
      ['AIRLINE', 'Airline', 'NON_THEATRICAL'],
      ['HOTEL', 'Hotel', 'NON_THEATRICAL'],
      ['EDUCATIONAL', 'Educational', 'NON_THEATRICAL'],
      ['AUDIO', 'Audio', 'ALL_MEDIA'],
      ['AUDIO_STREAMING', 'Audio streaming', 'AUDIO'],
      ['RADIO', 'Radio', 'AUDIO'],
      ['PODCAST', 'Podcast', 'AUDIO'],
      ['PUBLISHING', 'Publishing', 'ALL_MEDIA'],
      ['PRINT', 'Print', 'PUBLISHING'],
      ['EBOOK', 'E-book', 'PUBLISHING'],
      ['AUDIOBOOK', 'Audiobook', 'PUBLISHING'],
      ['GAMES', 'Games', 'ALL_MEDIA'],
      ['CONSOLE_PC', 'Console and PC games', 'GAMES'],
      ['MOBILE_GAMES', 'Mobile games', 'GAMES'],
      ['MERCHANDISE', 'Merchandise', 'ALL_MEDIA'],
      ['LIVE', 'Live and location-based', 'ALL_MEDIA'],
      ['LIVE_EVENTS', 'Live events and stage', 'LIVE'],
      ['THEME_PARKS', 'Theme parks and attractions', 'LIVE'],
      ['ADVERTISING', 'Advertising and promotion', 'ALL_MEDIA'],
      ['FORMAT', 'Format and remake rights', 'ALL_MEDIA'],
    ];
    for (const m of media) val('media', m[0], m[1], m[2]);

    // Language.
    val('language', 'ALL_LANGUAGES', 'All languages', '');
    const langs = [
      ['EN', 'English'], ['JA', 'Japanese'], ['ZH', 'Chinese'], ['KO', 'Korean'], ['FR', 'French'],
      ['DE', 'German'], ['ES', 'Spanish'], ['PT', 'Portuguese'], ['IT', 'Italian'], ['NL', 'Dutch'],
      ['RU', 'Russian'], ['AR', 'Arabic'], ['HI', 'Hindi'], ['TH', 'Thai'], ['ID', 'Indonesian'],
      ['VI', 'Vietnamese'], ['TR', 'Turkish'], ['PL', 'Polish'], ['SV', 'Swedish'], ['HE', 'Hebrew'],
    ];
    for (const l of langs) val('language', l[0], l[1], 'ALL_LANGUAGES');

    // Channel.
    val('channel', 'ALL_CHANNELS', 'All channels', '');
    for (const ch of [
      ['RETAIL', 'Retail stores'],
      ['ONLINE', 'Online and e-commerce'],
      ['WHOLESALE', 'Wholesale'],
      ['DIRECT', 'Direct to consumer'],
      ['MASS', 'Mass market'],
      ['SPECIALTY', 'Specialty and collector'],
      ['DUTY_FREE', 'Travel retail and duty free'],
      ['PROMOTIONAL', 'Promotional and premium'],
    ]) {
      val('channel', ch[0], ch[1], 'ALL_CHANNELS');
    }

    // Product category.
    val('category', 'ALL_CATEGORIES', 'All categories', '');
    for (const pc of [
      ['TOYS', 'Toys'],
      ['APPAREL', 'Apparel'],
      ['ACCESSORIES', 'Accessories and bags'],
      ['HOME', 'Home and decor'],
      ['STATIONERY', 'Stationery and school'],
      ['BOOKS', 'Books and publishing'],
      ['FOOD_BEV', 'Food and beverage'],
      ['HEALTH_BEAUTY', 'Health and beauty'],
      ['ELECTRONICS', 'Electronics'],
      ['GAMES_PUZZLES', 'Games and puzzles'],
      ['COLLECTIBLES', 'Collectibles'],
      ['SPORTS', 'Sports and outdoor'],
    ]) {
      val('category', pc[0], pc[1], 'ALL_CATEGORIES');
    }

    // Field of use.
    val('field_of_use', 'ALL_FIELDS', 'All fields of use', '');
    for (const fu of [
      ['CONSUMER', 'Consumer products'],
      ['INDUSTRIAL', 'Industrial'],
      ['MEDICAL', 'Medical and health'],
      ['AUTOMOTIVE', 'Automotive and mobility'],
      ['TELECOM', 'Telecommunications'],
      ['ENERGY', 'Energy'],
      ['SOFTWARE', 'Software and services'],
      ['MEDIA_TECH', 'Media and entertainment technology'],
      ['RESEARCH', 'Research and non-commercial'],
    ]) {
      val('field_of_use', fu[0], fu[1], 'ALL_FIELDS');
    }

    // --- official fees confirmed from primary sources ---------------------------------
    const USPTO_2025 = 'USPTO fee schedule effective January 2025. Verify current amounts at uspto.gov before relying on them.';
    const fees = [
      // Patent maintenance fees (35 U.S.C. 41(b)); cycle = maintenance point.
      ['US', 'patent', 'maintenance', 1, 'large', false, 2150],
      ['US', 'patent', 'maintenance', 1, 'small', false, 860],
      ['US', 'patent', 'maintenance', 1, 'micro', false, 430],
      ['US', 'patent', 'maintenance', 2, 'large', false, 4040],
      ['US', 'patent', 'maintenance', 2, 'small', false, 1616],
      ['US', 'patent', 'maintenance', 2, 'micro', false, 808],
      ['US', 'patent', 'maintenance', 3, 'large', false, 8280],
      ['US', 'patent', 'maintenance', 3, 'small', false, 3312],
      ['US', 'patent', 'maintenance', 3, 'micro', false, 1656],
      // Trademark maintenance (37 CFR 2.6), per class.
      ['US', 'trademark', 'sec8', 0, 'any', true, 325],
      ['US', 'trademark', 'sec71', 0, 'any', true, 325],
      ['US', 'trademark', 'renewal', 0, 'any', true, 650],
      ['US', 'trademark', 'sec15', 0, 'any', true, 250],
    ];
    for (const f of fees) {
      put('fee_schedule', {
        office: f[0],
        ip_type: f[1],
        fee_kind: f[2],
        cycle: f[3],
        entity: f[4],
        per_class: f[5],
        amount: f[6],
        currency: 'USD',
        grace_surcharge: f[1] === 'trademark' ? (f[2] === 'renewal' ? 200 : 100) : 0,
        surcharge_percent: false,
        effective_from: '2025-01-18 00:00:00.000Z',
        source: USPTO_2025,
      });
    }

    // EPO, EUIPO, JPO and WIPO renewal fees, read on each office's own fee page (checked 29 Sep 2026).
    // o: office, t: ip_type, k: fee_kind, c/ct: cycle range, a: amount, cur, pc: per class,
    // claim: per claim, tiers: class tiers, g: grace surcharge, gp: surcharge is a percent.
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
        per_claim_amount: e.claim || 0,
        class_tiers: e.tiers || [],
        currency: cur,
        grace_surcharge: e.g || 0,
        surcharge_percent: e.gp === true,
        effective_from: from + ' 00:00:00.000Z',
        source: src,
        notes: e.notes || '',
      });
    }
    // EP application renewal fees (Art. 86 EPC). Payments before 1 April 2026 used the 2024 amounts.
    const EPO_2024 = 'EPO renewal fees, OJ EPO 2024 A3 (payments from 1 April 2024). Late payment: +50% (Rule 51(2) EPC).';
    const EPO_2026 = 'EPO renewal fees, OJ EPO 2026 A2 (payments from 1 April 2026). Late payment: +50% (Rule 51(2) EPC).';
    const EP_NOTE = 'Micro-entities, natural persons and non-profits get 30% off (Rule 7a EPC) unless they filed 5 or more applications in the last 5 years.';
    [[3, 690, 725], [4, 845, 885], [5, 1000, 1050], [6, 1155, 1215], [7, 1310, 1375], [8, 1465, 1540], [9, 1620, 1700]].forEach(function (r) {
      fee('EP', 'patent', 'annuity', r[0], 0, r[1], 'EUR', '2024-04-01', EPO_2024, { g: 50, gp: true, notes: EP_NOTE });
      fee('EP', 'patent', 'annuity', r[0], 0, r[2], 'EUR', '2026-04-01', EPO_2026, { g: 50, gp: true, notes: EP_NOTE });
    });
    fee('EP', 'patent', 'annuity', 10, 20, 1775, 'EUR', '2024-04-01', EPO_2024, { g: 50, gp: true, notes: EP_NOTE });
    fee('EP', 'patent', 'annuity', 10, 20, 1865, 'EUR', '2026-04-01', EPO_2026, { g: 50, gp: true, notes: EP_NOTE });
    // Unitary Patent renewal fees (RFeesUPP, OJ EPO 2016 A40), unchanged since the system started.
    const UP_SRC = 'Unitary Patent renewal fees, OJ EPO 2016 A40 (Art. 2(1) RFeesUPP). Late payment: +50% (Rule 13(3) UPR).';
    [35, 105, 145, 315, 475, 630, 815, 990, 1175, 1460, 1775, 2105, 2455, 2830, 3240, 3640, 4055, 4455, 4855].forEach(function (a, i) {
      fee('EP', 'patent', 'unitary_annuity', i + 2, 0, a, 'EUR', '2023-06-01', UP_SRC, {
        g: 50,
        gp: true,
        notes: 'A licence-of-right statement takes 15% off renewal fees falling due after it is filed.',
      });
    });
    // EUIPO: EU trade mark renewal (electronic) and EU design renewals after the 2025 reform.
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
    // JPO fees (schedule on or after 1 April 2022). Late payment in the 6-month grace period doubles the fee.
    const JPO_SRC = 'JPO schedule of fees on or after 1 April 2022. Late payment within the 6-month grace period: surcharge equal to the fee.';
    const JPO_PAT = 'Applies where examination was requested on or after 1 April 2004; earlier requests pay the higher legacy scale.';
    fee('JP', 'patent', 'annuity', 4, 6, 10300, 'JPY', '2022-04-01', JPO_SRC, { claim: 800, g: 100, gp: true, notes: JPO_PAT });
    fee('JP', 'patent', 'annuity', 7, 9, 24800, 'JPY', '2022-04-01', JPO_SRC, { claim: 1900, g: 100, gp: true, notes: JPO_PAT });
    fee('JP', 'patent', 'annuity', 10, 25, 59400, 'JPY', '2022-04-01', JPO_SRC, { claim: 4600, g: 100, gp: true, notes: JPO_PAT });
    fee('JP', 'utility_model', 'annuity', 4, 6, 6100, 'JPY', '2022-04-01', JPO_SRC, { claim: 300, g: 100, gp: true });
    fee('JP', 'utility_model', 'annuity', 7, 10, 18100, 'JPY', '2022-04-01', JPO_SRC, { claim: 900, g: 100, gp: true });
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
    // Field order: code, name, ip_type, jurisdiction, trigger, base, [y,m,d], kind, category, title,
    // extra (routes, conditions, extensions, final_offset_months, window_months, grace_months,
    // grace_note, recurring_years, recurring_until_years, recurring_first_cycle, cycle_label,
    // due_end_of_month, citation, notes, creates_renewal, fee_kind, effective_from).
    const R = [];
    function rule(code, name, ipType, jur, trigger, base, ymd, kind, category, title, extra) {
      const x = extra || {};
      R.push({
        code: code,
        name: name,
        ip_type: ipType,
        jurisdiction: jur,
        routes: x.routes || [],
        trigger_event: trigger,
        conditions: x.conditions || {},
        base: base,
        offset_years: ymd[0],
        offset_months: ymd[1],
        offset_days: ymd[2],
        due_end_of_month: x.eom === true,
        kind: kind,
        category: category,
        title: title,
        extensions: x.extensions || [],
        final_offset_months: x.final || 0,
        window_months: x.window || 0,
        grace_months: x.grace || 0,
        grace_note: x.graceNote || '',
        recurring_years: x.every || 0,
        recurring_until_years: x.until || 0,
        recurring_first_cycle: x.first || 0,
        cycle_label: x.cycleLabel || '',
        roll_office: x.roll || '',
        citation: x.cite || '',
        notes: x.notes || '',
        effective_from: x.from || '1900-01-01 00:00:00.000Z',
        effective_to: x.to || '',
        version: 1,
        enabled: true,
        system: true,
        creates_renewal: x.renewal === true,
        fee_kind: x.feeKind || '',
      });
    }

    // Paris Convention priority (first filings anywhere).
    rule('PARIS-PRIORITY-PATENT', 'Paris priority year (patents and utility models)', 'patent', '*', 'FILED', 'event_date', [0, 12, 0], 'hard', 'filing',
      'Foreign and PCT filing deadline (12-month priority)', {
        conditions: { first_filing: true },
        cite: 'Paris Convention Art. 4C(1); PCT Art. 8',
        notes: 'Later filings claiming priority must be made within 12 months of the first filing. Restoration may be possible in some offices within 2 further months.',
      });
    rule('PARIS-PRIORITY-UM', 'Paris priority year (utility models)', 'utility_model', '*', 'FILED', 'event_date', [0, 12, 0], 'hard', 'filing',
      'Foreign filing deadline (12-month priority)', { conditions: { first_filing: true }, cite: 'Paris Convention Art. 4C(1)' });
    rule('PARIS-PRIORITY-DESIGN', 'Paris priority (designs)', 'design', '*', 'FILED', 'event_date', [0, 6, 0], 'hard', 'filing',
      'Foreign filing deadline (6-month priority)', { conditions: { first_filing: true }, cite: 'Paris Convention Art. 4C(1)' });
    rule('PARIS-PRIORITY-TM', 'Paris priority (trademarks)', 'trademark', '*', 'FILED', 'event_date', [0, 6, 0], 'hard', 'filing',
      'Foreign filing deadline (6-month priority)', { conditions: { first_filing: true }, cite: 'Paris Convention Art. 4C(1)' });

    // PCT.
    rule('PCT-NATIONAL-30', 'PCT national phase (30 months)', 'patent', 'WO', 'FILED', 'priority_date', [0, 30, 0], 'hard', 'filing',
      'Enter national phase (30 months from priority: US, JP and most offices)', {
        routes: ['pct'],
        cite: 'PCT Art. 22(1), 39(1)(a); 35 U.S.C. 371; JP Patent Act Art. 184-4',
        notes: 'Some offices allow 31 months or more. The EPO allows 31 months (separate rule).',
      });
    rule('PCT-EP-31', 'PCT regional phase at the EPO (31 months)', 'patent', 'WO', 'FILED', 'priority_date', [0, 31, 0], 'hard', 'filing',
      'Enter European regional phase (31 months from priority)', { routes: ['pct'], cite: 'Rule 159(1) EPC' });
    rule('PCT-DEMAND-22', 'PCT Chapter II demand', 'patent', 'WO', 'FILED', 'priority_date', [0, 22, 0], 'reminder', 'prosecution',
      'Last day to file a demand for international preliminary examination (optional)', {
        routes: ['pct'],
        cite: 'PCT Rule 54bis.1(a)',
        notes: 'Later of 22 months from priority or 3 months from transmittal of the search report and written opinion.',
      });

    // United States: patents.
    rule('US-PAT-PROV-12', 'US provisional to non-provisional', 'patent', 'US', 'FILED', 'event_date', [0, 12, 0], 'hard', 'filing',
      'File non-provisional or PCT application claiming the provisional', {
        routes: ['provisional'],
        cite: '35 U.S.C. 119(e)(1); 37 CFR 1.78(a)(1)',
        notes: 'Restoration of the benefit claim may be available up to 14 months (37 CFR 1.78(b)).',
      });
    rule('US-PAT-OA-NONFINAL', 'US non-final office action', 'patent', 'US', 'OA_NONFINAL', 'event_date', [0, 3, 0], 'extendable', 'prosecution',
      'Respond to non-final rejection', {
        extensions: [
          { months: 1, label: 'One-month extension (fee)' },
          { months: 2, label: 'Two-month extension (fee)' },
          { months: 3, label: 'Three-month extension (fee)' },
        ],
        final: 6,
        cite: '35 U.S.C. 133; 37 CFR 1.134, 1.136(a)',
      });
    rule('US-PAT-OA-FINAL', 'US final office action', 'patent', 'US', 'OA_FINAL', 'event_date', [0, 3, 0], 'extendable', 'prosecution',
      'Respond to final rejection', {
        extensions: [
          { months: 1, label: 'One-month extension (fee)' },
          { months: 2, label: 'Two-month extension (fee)' },
          { months: 3, label: 'Three-month extension (fee)' },
        ],
        final: 6,
        cite: '35 U.S.C. 133; 37 CFR 1.113, 1.136(a)',
        notes: 'A first reply filed within 2 months of the final action lets the extension period run from the advisory action (MPEP 706.07(f)).',
      });
    rule('US-PAT-RESTRICTION', 'US restriction requirement', 'patent', 'US', 'RESTRICTION', 'event_date', [0, 2, 0], 'extendable', 'prosecution',
      'Respond to restriction or election requirement', {
        extensions: [
          { months: 1, label: 'One-month extension (fee)' },
          { months: 2, label: 'Two-month extension (fee)' },
          { months: 3, label: 'Three-month extension (fee)' },
          { months: 4, label: 'Four-month extension (fee)' },
        ],
        final: 6,
        cite: '37 CFR 1.142, 1.136(a); MPEP 817',
      });
    rule('US-PAT-ISSUE-FEE', 'US issue fee', 'patent', 'US', 'NOTICE_ALLOWANCE', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'Pay issue fee (not extendable)', { cite: '35 U.S.C. 151; 37 CFR 1.311(a)' });
    rule('US-DES-ISSUE-FEE', 'US design issue fee', 'design', 'US', 'NOTICE_ALLOWANCE', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'Pay design issue fee (not extendable)', { cite: '35 U.S.C. 151; 37 CFR 1.311(a)' });
    rule('US-PAT-MAINT-1', 'US maintenance fee, 3.5 years', 'patent', 'US', 'GRANTED', 'registration_date', [3, 6, 0], 'hard', 'maintenance',
      'Pay 3.5-year maintenance fee', {
        window: 6,
        grace: 6,
        graceNote: 'Payable with surcharge in the 6-month grace period.',
        cite: '35 U.S.C. 41(b); 37 CFR 1.362(d), (e)',
        renewal: true,
        feeKind: 'maintenance',
        cycleLabel: '3.5-year maintenance fee',
        conditions: { cycle: 1 },
      });
    rule('US-PAT-MAINT-2', 'US maintenance fee, 7.5 years', 'patent', 'US', 'GRANTED', 'registration_date', [7, 6, 0], 'hard', 'maintenance',
      'Pay 7.5-year maintenance fee', {
        window: 6,
        grace: 6,
        graceNote: 'Payable with surcharge in the 6-month grace period.',
        cite: '35 U.S.C. 41(b); 37 CFR 1.362(d), (e)',
        renewal: true,
        feeKind: 'maintenance',
        cycleLabel: '7.5-year maintenance fee',
        conditions: { cycle: 2 },
      });
    rule('US-PAT-MAINT-3', 'US maintenance fee, 11.5 years', 'patent', 'US', 'GRANTED', 'registration_date', [11, 6, 0], 'hard', 'maintenance',
      'Pay 11.5-year maintenance fee', {
        window: 6,
        grace: 6,
        graceNote: 'Payable with surcharge in the 6-month grace period.',
        cite: '35 U.S.C. 41(b); 37 CFR 1.362(d), (e)',
        renewal: true,
        feeKind: 'maintenance',
        cycleLabel: '11.5-year maintenance fee',
        conditions: { cycle: 3 },
      });

    // United States: trademarks.
    rule('US-TM-OA', 'US trademark office action', 'trademark', 'US', 'OA_ISSUED', 'event_date', [0, 3, 0], 'extendable', 'prosecution',
      'Respond to trademark office action', {
        extensions: [{ months: 3, label: 'Three-month extension (request and fee before the deadline)' }],
        final: 6,
        cite: '15 U.S.C. 1062(b); 37 CFR 2.62(a)',
        notes: 'The extension must be requested within the initial 3-month period.',
      });
    rule('US-TM-SOU', 'US statement of use', 'trademark', 'US', 'NOTICE_ALLOWANCE', 'event_date', [0, 6, 0], 'extendable', 'use',
      'File statement of use or request an extension', {
        extensions: [
          { months: 6, label: 'First extension (6 months)' },
          { months: 12, label: 'Second extension' },
          { months: 18, label: 'Third extension' },
          { months: 24, label: 'Fourth extension' },
          { months: 30, label: 'Fifth extension' },
        ],
        final: 36,
        cite: '15 U.S.C. 1051(d); 37 CFR 2.88, 2.89',
      });
    rule('US-TM-OPPOSITION', 'US opposition period (publication)', 'trademark', 'US', 'PUBLISHED', 'event_date', [0, 0, 30], 'reminder', 'opposition',
      'Opposition period after publication ends', {
        cite: '15 U.S.C. 1063(a); 37 CFR 2.101-2.102',
        notes: 'Third parties may extend the period by request. Watch for extensions before treating the mark as clear.',
      });
    rule('US-TM-SEC8', 'US Section 8 declaration of use', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'hard', 'use',
      'File Section 8 declaration of use (between years 5 and 6)', {
        conditions: { not_routes: ['designation', 'madrid'] },
        window: 12,
        grace: 6,
        graceNote: 'Grace period of 6 months with surcharge.',
        cite: '15 U.S.C. 1058(a)(1); 37 CFR 2.160',
        renewal: true,
        feeKind: 'sec8',
        cycleLabel: 'Section 8 declaration (year 6)',
      });
    rule('US-TM-SEC71', 'US Section 71 declaration (Madrid designation)', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'hard', 'use',
      'File Section 71 declaration of use (between years 5 and 6)', {
        routes: ['designation', 'madrid'],
        window: 12,
        grace: 6,
        graceNote: 'Grace period of 6 months with surcharge.',
        cite: '15 U.S.C. 1141k; 37 CFR 7.36',
        renewal: true,
        feeKind: 'sec71',
        cycleLabel: 'Section 71 declaration (year 6)',
      });
    rule('US-TM-RENEWAL', 'US renewal (Sections 8 and 9)', 'trademark', 'US', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew registration (combined Sections 8 and 9)', {
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
    rule('US-TM-SEC15', 'US Section 15 incontestability', 'trademark', 'US', 'REGISTERED', 'registration_date', [6, 0, 0], 'reminder', 'use',
      'Consider Section 15 declaration of incontestability (after 5 years of continuous use)', {
        conditions: { tm_register: 'principal' },
        window: 12,
        cite: '15 U.S.C. 1065; 37 CFR 2.167',
        notes: 'Optional. Usually filed together with the Section 8 declaration.',
      });

    // European patents (EPO) and the Unitary Patent.
    rule('EP-EXAM-REQUEST', 'EP examination request and search opinion reply', 'patent', 'EP', 'SEARCH_REPORT_PUBLISHED', 'event_date', [0, 6, 0], 'hard', 'prosecution',
      'Request examination and reply to the extended European search opinion', {
        cite: 'Art. 94(1), Rule 70(1), Rule 70a(1) EPC',
        notes: 'Further processing is available within 2 months of the loss-of-rights communication (Art. 121, Rule 135 EPC).',
      });
    rule('EP-OA-94-3', 'EP examination communication', 'patent', 'EP', 'OA_ISSUED', 'event_date', [0, 4, 0], 'designated', 'prosecution',
      'Reply to examination communication', {
        extensions: [{ months: 2, label: 'Extension on reasoned request (Rule 132(2) EPC)' }],
        cite: 'Art. 94(3), Rule 71(1), Rule 132 EPC',
        notes: 'The examiner sets the period (usually 4 months). Enter the period from the communication.',
      });
    rule('EP-R71-3', 'EP intention to grant', 'patent', 'EP', 'R71_3', 'event_date', [0, 4, 0], 'hard', 'prosecution',
      'Approve text, pay grant and publishing fee, file claim translations (Rule 71(3))', {
        cite: 'Rule 71(3), (6), (7) EPC',
        notes: 'Not extendable. Further processing is available.',
      });
    rule('EP-UNITARY-REQUEST', 'Unitary Patent request', 'patent', 'EP', 'EP_GRANT_MENTION', 'event_date', [0, 1, 0], 'hard', 'filing',
      'Request unitary effect (optional)', {
        cite: 'Art. 9(1)(g) Reg. (EU) 1257/2012; Rule 6(1) UPP Rules',
        notes: 'Only if unitary protection is wanted.',
      });
    rule('EP-VALIDATION', 'EP national validation', 'patent', 'EP', 'EP_GRANT_MENTION', 'event_date', [0, 3, 0], 'hard', 'filing',
      'Validate in designated states (translations and fees)', {
        cite: 'Art. 65 EPC; national law',
        notes: 'Most states allow 3 months from the mention of grant; some states differ. Check each state.',
      });
    rule('EP-OPPOSITION', 'EP opposition period', 'patent', 'EP', 'EP_GRANT_MENTION', 'event_date', [0, 9, 0], 'reminder', 'opposition',
      'Opposition period ends (third parties may oppose until this date)', { cite: 'Art. 99(1) EPC' });
    rule('EP-RENEWAL', 'EP renewal fees (pending application)', 'patent', 'EP', 'FILED', 'filing_date', [2, 0, 0], 'hard', 'renewal',
      'Pay EPO renewal fee, year {n}', {
        routes: ['national', 'regional', 'ep', 'other'],
        eom: true,
        window: 3,
        grace: 6,
        graceNote: 'Payable within 6 months with a 50% additional fee (Rule 51(2) EPC).',
        every: 1,
        first: 3,
        until: 20,
        cycleLabel: 'Year {n}',
        conditions: { stop_on_event: 'EP_GRANT_MENTION' },
        cite: 'Art. 86(1) EPC; Rule 51 EPC',
        notes: 'Due on the last day of the month containing the filing anniversary. Payable no earlier than 3 months before the due date. After grant, fees go to national offices or the Unitary Patent.',
        renewal: true,
        feeKind: 'annuity',
      });
    rule('EP-RENEWAL-PCT', 'EP renewal fees (Euro-PCT application)', 'patent', 'EP', 'FILED', 'filing_date', [2, 0, 0], 'hard', 'renewal',
      'Pay EPO renewal fee, year {n}', {
        routes: ['pct'],
        eom: true,
        window: 3,
        grace: 6,
        graceNote: 'Payable within 6 months with a 50% additional fee (Rule 51(2) EPC).',
        every: 1,
        first: 3,
        until: 20,
        cycleLabel: 'Year {n}',
        conditions: { stop_on_event: 'EP_GRANT_MENTION' },
        cite: 'Art. 86(1) EPC; Rule 51, Rule 159(1)(g) EPC',
        notes: 'For Euro-PCT applications the international filing date is the reference date.',
        renewal: true,
        feeKind: 'annuity',
      });
    rule('UP-RENEWAL', 'Unitary Patent renewal fees', 'patent', 'EP', 'UNITARY_REGISTERED', 'filing_date', [2, 0, 0], 'hard', 'renewal',
      'Pay Unitary Patent renewal fee, year {n}', {
        eom: true,
        window: 3,
        grace: 6,
        graceNote: 'Payable within 6 months with a 50% additional fee.',
        every: 1,
        first: 3,
        until: 20,
        cycleLabel: 'Year {n}',
        cite: 'Rule 13 UPP Rules; Art. 11 Reg. (EU) 1257/2012',
        notes: 'Due on the last day of the month containing the filing anniversary, for the years after the mention of grant. Not payable more than 3 months early.',
        renewal: true,
        feeKind: 'unitary_annuity',
      });

    // EUIPO.
    rule('EM-TM-OPPOSITION', 'EU trade mark opposition period', 'trademark', 'EM', 'PUBLISHED', 'event_date', [0, 3, 0], 'reminder', 'opposition',
      'Opposition period ends (3 months from publication)', { cite: 'Art. 46(1) Reg. (EU) 2017/1001 (EUTMR)' });
    rule('EM-TM-RENEWAL', 'EU trade mark renewal', 'trademark', 'EM', 'REGISTERED', 'filing_date', [10, 0, 0], 'hard', 'renewal',
      'Renew EU trade mark', {
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
    rule('EM-TM-NONUSE', 'EU trade mark genuine use', 'trademark', 'EM', 'REGISTERED', 'registration_date', [5, 0, 0], 'reminder', 'use',
      'Non-use vulnerability begins (5 years after registration)', {
        cite: 'Art. 18, 58(1)(a) EUTMR',
        notes: 'Keep evidence of genuine use in the EU for each class.',
      });
    rule('EM-DES-RENEWAL', 'Registered Community design renewal', 'design', 'EM', 'REGISTERED', 'filing_date', [5, 0, 0], 'hard', 'renewal',
      'Renew registered EU design', {
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

    // Japan (JPO).
    rule('JP-EXAM-REQUEST', 'JP request for examination', 'patent', 'JP', 'FILED', 'filing_date', [3, 0, 0], 'hard', 'prosecution',
      'Request examination (3 years from filing)', {
        cite: 'JP Patent Act Art. 48-3(1)',
        notes: 'For PCT national phase the international filing date applies. Missing it means the application is deemed withdrawn.',
      });
    rule('JP-OA-REFUSAL', 'JP notice of reasons for refusal', 'patent', 'JP', 'OA_ISSUED', 'event_date', [0, 3, 0], 'designated', 'prosecution',
      'Respond to notice of reasons for refusal', {
        extensions: [{ months: 2, label: 'Extension requested after expiry (within 2 months)' }],
        cite: 'JP Patent Act Art. 50, 5; Patent Regulations Art. 4-2',
        notes: 'The examiner sets the period, typically 60 days for residents and 3 months for applicants abroad. Enter the period from the notice.',
      });
    rule('JP-DES-OA-REFUSAL', 'JP design notice of reasons for refusal', 'design', 'JP', 'OA_ISSUED', 'event_date', [0, 3, 0], 'designated', 'prosecution',
      'Respond to notice of reasons for refusal', {
        extensions: [{ months: 2, label: 'Extension requested after expiry (within 2 months)' }],
        cite: 'JP Design Act Art. 19, 68; Patent Act Art. 5, 50 applied mutatis mutandis',
        notes: 'The examiner sets the period. Enter the period from the notice.',
      });
    rule('JP-TM-OA-REFUSAL', 'JP trademark notice of reasons for refusal', 'trademark', 'JP', 'OA_ISSUED', 'event_date', [0, 3, 0], 'designated', 'prosecution',
      'Respond to notice of reasons for refusal', {
        extensions: [{ months: 2, label: 'Extension requested after expiry (within 2 months)' }],
        cite: 'JP Trademark Act Art. 15-2, 77; Patent Act Art. 5 applied mutatis mutandis',
        notes: 'The examiner sets the period. Enter the period from the notice.',
      });
    rule('JP-APPEAL-PATENT', 'JP appeal against refusal (patent)', 'patent', 'JP', 'REFUSED', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'File appeal against decision of refusal', { cite: 'JP Patent Act Art. 121(1)', notes: 'Amendments may be filed only together with the appeal request.' });
    rule('JP-APPEAL-DESIGN', 'JP appeal against refusal (design)', 'design', 'JP', 'REFUSED', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'File appeal against decision of refusal', { cite: 'JP Design Act Art. 46(1)' });
    rule('JP-APPEAL-TM', 'JP appeal against refusal (trademark)', 'trademark', 'JP', 'REFUSED', 'event_date', [0, 3, 0], 'hard', 'prosecution',
      'File appeal against decision of refusal', { cite: 'JP Trademark Act Art. 44(1)' });
    rule('JP-PAT-REG-FEE', 'JP patent registration fee (years 1 to 3)', 'patent', 'JP', 'NOTICE_ALLOWANCE', 'event_date', [0, 0, 30], 'extendable', 'prosecution',
      'Pay registration fees for years 1 to 3 (30 days from decision to grant)', {
        extensions: [{ months: 1, label: '30-day extension on request' }],
        cite: 'JP Patent Act Art. 108(1), (3)',
      });
    rule('JP-PAT-ANNUITY', 'JP patent annuities (year 4 on)', 'patent', 'JP', 'GRANTED', 'registration_date', [3, 0, 0], 'hard', 'renewal',
      'Pay JP annuity, year {n}', {
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the annuity.',
        every: 1,
        first: 4,
        until: 20,
        cycleLabel: 'Year {n}',
        conditions: { stop_at_expiry: true },
        cite: 'JP Patent Act Art. 108(2), 112',
        notes: 'Each year is due before the preceding year ends. When the JPO connection is active, the official next due date replaces the computed one.',
        renewal: true,
        feeKind: 'annuity',
      });
    rule('JP-PAT-OPPOSITION', 'JP patent opposition period', 'patent', 'JP', 'GAZETTE_PUBLISHED', 'event_date', [0, 6, 0], 'reminder', 'opposition',
      'Opposition period ends (6 months from the patent gazette)', { cite: 'JP Patent Act Art. 113' });
    rule('JP-DES-REG-FEE', 'JP design registration fee (year 1)', 'design', 'JP', 'NOTICE_ALLOWANCE', 'event_date', [0, 0, 30], 'extendable', 'prosecution',
      'Pay first-year design registration fee (30 days from decision)', {
        extensions: [{ months: 1, label: '30-day extension on request' }],
        cite: 'JP Design Act Art. 43(1), (3)',
      });
    rule('JP-DES-ANNUITY', 'JP design annual fees', 'design', 'JP', 'REGISTERED', 'registration_date', [1, 0, 0], 'hard', 'renewal',
      'Pay JP design annual fee, year {n}', {
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
    rule('JP-TM-REG-FEE', 'JP trademark registration fee', 'trademark', 'JP', 'NOTICE_ALLOWANCE', 'event_date', [0, 0, 30], 'extendable', 'prosecution',
      'Pay trademark registration fee (10 years, or the first 5-year half)', {
        extensions: [{ months: 1, label: '30-day extension on request' }],
        cite: 'JP Trademark Act Art. 40, 41, 41-2',
      });
    rule('JP-TM-SECOND-HALF', 'JP trademark second-half fee', 'trademark', 'JP', 'REGISTERED', 'registration_date', [5, 0, 0], 'hard', 'renewal',
      'Pay second 5-year half of the registration fee', {
        conditions: { option: 'jp_split_fee' },
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the fee.',
        cite: 'JP Trademark Act Art. 41-2(1), (5), 43(3)',
        renewal: true,
        feeKind: 'second_half',
        cycleLabel: 'Second 5-year half',
      });
    rule('JP-TM-RENEWAL', 'JP trademark renewal', 'trademark', 'JP', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew JP trademark registration', {
        window: 6,
        grace: 6,
        graceNote: '6-month grace with a surcharge equal to the renewal fee.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'JP Trademark Act Art. 19, 20(2)-(4), 21, 43(1)',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('JP-TM-OPPOSITION', 'JP trademark opposition period', 'trademark', 'JP', 'GAZETTE_PUBLISHED', 'event_date', [0, 2, 0], 'reminder', 'opposition',
      'Opposition period ends (2 months from the trademark gazette)', { cite: 'JP Trademark Act Art. 43-2' });
    rule('JP-TM-NONUSE', 'JP trademark non-use exposure', 'trademark', 'JP', 'REGISTERED', 'registration_date', [3, 0, 0], 'reminder', 'use',
      'Non-use cancellation exposure begins (3 years without use)', { cite: 'JP Trademark Act Art. 50' });

    // Madrid system (international registrations).
    rule('WO-MADRID-RENEWAL', 'Madrid international registration renewal', 'trademark', 'WO', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew international registration', {
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
    rule('WO-MADRID-DEPENDENCY', 'Madrid dependency period', 'trademark', 'WO', 'REGISTERED', 'registration_date', [5, 0, 0], 'reminder', 'term',
      'Dependency on the basic mark ends (central attack no longer possible)', { routes: ['madrid'], cite: 'Madrid Protocol Art. 6(2), (3)' });

    // Copyright (works) and author grants.
    rule('US-CR-REGISTER-412', 'US copyright registration after publication', 'work', 'US', 'WORK_PUBLISHED', 'event_date', [0, 3, 0], 'internal', 'copyright',
      'Register copyright within 3 months of first publication', {
        conditions: { no_copyright_registration: true },
        cite: '17 U.S.C. 412',
        notes: 'Registration within 3 months keeps statutory damages and attorney fees available for infringement that starts before registration.',
      });
    rule('US-CR-TERM-NOTICE', 'Section 203 termination notice window', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [25, 0, 0], 'reminder', 'copyright',
      'Author may serve a termination notice from this date (Section 203)', {
        cite: '17 U.S.C. 203(a)(4)(A)',
        notes: 'Notice must be served 2 to 10 years before the termination date and recorded before it. Works made for hire are excluded.',
      });
    rule('US-CR-TERM-OPENS', 'Section 203 termination window opens', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [35, 0, 0], 'reminder', 'copyright',
      'Termination window opens (35 years after the grant)', {
        cite: '17 U.S.C. 203(a)(3)',
        notes: 'If the grant covers publication, the window starts at the earlier of 35 years from publication or 40 years from the grant.',
      });
    rule('US-CR-TERM-CLOSES', 'Section 203 termination window closes', 'agreement', 'US', 'AUTHOR_GRANT_EXECUTED', 'event_date', [40, 0, 0], 'reminder', 'copyright',
      'Termination window closes (40 years after the grant)', { cite: '17 U.S.C. 203(a)(3)' });

    for (const r of R) put('rules', r);
  },
  (app) => {
    for (const n of ['rules', 'fee_schedule', 'dimension_values', 'dimensions', 'scoring_criteria', 'fx_rates', 'office_connections', 'settings']) {
      try {
        const recs = app.findAllRecords(n);
        for (const r of recs) app.delete(r);
      } catch {
        /* absent */
      }
    }
  },
);
