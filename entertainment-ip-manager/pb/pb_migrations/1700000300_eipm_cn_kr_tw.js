/// <reference path="../pb_data/types.d.ts" />
/**
 * China, Korea and Taiwan: deadline rules, official fees and the official
 * holiday lists their working-day periods need. Researched 4 October 2026
 * from CNIPA, KIPO (now the Ministry of Intellectual Property), TIPO, the
 * State Council General Office, KASA and the DGPA.
 *
 * China's amended Trademark Law (adopted 26 June 2026) takes effect on
 * 1 January 2027 and renumbers the articles; renewal timing is unchanged
 * (Art. 44 new, Art. 40 old). The rules come in two versions split on that
 * date. China's 2027 holiday notice is not published yet (expected around
 * November 2026); add it in Settings, Office closure days.
 */
migrate(
  (app) => {
    function put(collection, data) {
      const rec = new Record(app.findCollectionByNameOrId(collection));
      for (const k of Object.keys(data)) rec.set(k, data[k]);
      app.save(rec);
      return rec;
    }

    // --- official fees -------------------------------------------------------------
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
        class_tiers: [],
        currency: cur,
        grace_surcharge: e.g || 0,
        surcharge_percent: e.gp === true,
        effective_from: from + ' 00:00:00.000Z',
        source: src,
        notes: e.notes || '',
      });
    }
    fee('CN', 'trademark', 'renewal', 0, 0, 450, 'CNY', '2019-07-01',
      'CNIPA Trademark Office fee list (sbj.cnipa.gov.cn/sbj/sbsq/sfbz): renewal CNY 450 per class online (500 on paper); late renewal in the 6-month grace period CNY 225 per class online (250 on paper).', {
        pc: true,
        g: 225,
        notes: 'Agent filings must be electronic from 1 July 2026 (CNIPA notice of 9 May 2026), so the online amount applies.',
      });
    const CN_DES = 'CNIPA fee guide (专利和集成电路布图设计缴费服务指南), design annual fees per year. Late payment within 6 months: surcharge of 5% of the year\'s fee for each month after the first (up to 25%), Implementing Regulations Art. 115 (2023).';
    [[1, 3, 600], [4, 5, 900], [6, 8, 1200], [9, 10, 2000], [11, 15, 3000]].forEach(function (r) {
      fee('CN', 'design', 'annuity', r[0], r[1], r[2], 'CNY', r[0] === 11 ? '2022-05-05' : '2018-08-01', CN_DES, {
        g: 25,
        gp: true,
        notes: 'The surcharge grows by month (5% in month 2 up to 25% in month 6); the estimate shows the maximum. Eligible owners may get an 85% or 70% reduction for the first 10 years.',
      });
    });
    fee('KR', 'trademark', 'renewal', 0, 0, 300000, 'KRW', '2023-08-01',
      'Korean Intellectual Property Office fee page (patent.go.kr, as of 1 August 2023): renewal KRW 300,000 per class (plus 2,000 for each item beyond 10). In the 6-month additional period: KRW 330,000 per class.', {
        pc: true,
        g: 30000,
        notes: 'Split payment (two 5-year halves) costs KRW 184,000 per class per half (203,000 in the additional period); an unpaid second half ends the mark after year 5.',
      });
    const KR_DES = 'Korean Intellectual Property Office fee page (patent.go.kr), examined designs, per design per year. Late payment within 6 months: 3% surcharge for each month, up to 18%.';
    [[1, 3, 25000], [4, 6, 35000], [7, 9, 70000], [10, 12, 140000], [13, 20, 210000]].forEach(function (r) {
      fee('KR', 'design', 'annuity', r[0], r[1], r[2], 'KRW', '2023-08-01', KR_DES, {
        g: 18,
        gp: true,
        notes: 'Partial-examination designs pay KRW 34,000 a year from year 4. Paying 3 or more years at once takes 10% off. The estimate shows the maximum surcharge.',
      });
    });
    fee('TW', 'trademark', 'renewal', 0, 0, 4000, 'TWD', '2024-05-01',
      'TIPO trademark fee list (effective 1 May 2024): renewal TWD 4,000 per class. Renewal within 6 months after expiry costs double (Trademark Act Art. 34).', {
        pc: true,
        g: 100,
        gp: true,
      });
    const TW_DES = 'TIPO patent fee rules (專利規費收費辦法), design annual fees per year. Late payment within 6 months: 20% for each month or part of a month, at most double (Patent Act Art. 94, applied by Art. 142).';
    [[1, 3, 800], [4, 6, 2000], [7, 15, 3000]].forEach(function (r) {
      fee('TW', 'design', 'annuity', r[0], r[1], r[2], 'TWD', '2019-09-27', TW_DES, { g: 100, gp: true, notes: 'The estimate shows the maximum (double) surcharge.' });
    });

    // --- deadline rules ----------------------------------------------------------------
    function rule(code, name, nameJa, subject, jur, trigger, base, ymd, kind, category, title, titleJa, x) {
      const e = x || {};
      put('rules', {
        code: code,
        name: name,
        name_ja: nameJa,
        subject_type: subject,
        jurisdiction: jur,
        routes: e.routes || [],
        trigger_event: trigger,
        conditions: e.conditions || {},
        base: base,
        offset_years: ymd[0],
        offset_months: ymd[1],
        offset_days: ymd[2],
        offset_unit: 'calendar',
        due_end_of_month: false,
        kind: kind,
        category: category,
        title: title,
        title_ja: titleJa,
        extensions: e.extensions || [],
        final_offset_months: 0,
        final_offset_days: 0,
        window_months: e.window || 0,
        grace_months: e.grace || 0,
        grace_note: e.graceNote || '',
        recurring_years: e.every || 0,
        recurring_until_years: e.until || 0,
        recurring_first_cycle: e.first || 0,
        cycle_label: e.cycleLabel || '',
        roll_office: '',
        citation: e.cite || '',
        summary: '',
        summary_ja: '',
        notes: e.notes || '',
        effective_from: (e.from || '1900-01-01') + ' 00:00:00.000Z',
        effective_to: e.to ? e.to + ' 00:00:00.000Z' : '',
        version: e.version || 1,
        enabled: true,
        system: true,
        creates_renewal: e.renewal === true,
        fee_kind: e.feeKind || '',
      });
    }
    const CN_OLD = { to: '2026-12-31' };
    const CN_NEW = { from: '2027-01-01', version: 2 };
    function both(code, name, nameJa, subject, trigger, base, ymd, kind, category, title, titleJa, oldX, newX) {
      rule(code, name, nameJa, subject, 'CN', trigger, base, ymd, kind, category, title, titleJa, Object.assign({}, oldX, CN_OLD));
      rule(code, name, nameJa, subject, 'CN', trigger, base, ymd, kind, category, title, titleJa, Object.assign({}, newX, CN_NEW));
    }
    // China trademarks.
    both('CN-TM-REFUSAL-REVIEW', 'China trademark refusal review', '中国商標 拒絶査定不服審判', 'trademark', 'REFUSED', 'event_date', [0, 0, 15], 'hard', 'prosecution',
      'Request review of the refusal (15 days from receipt)', '拒絶に対する不服審判の請求（受領から15日）',
      { cite: 'PRC Trademark Law (2019) Art. 34', notes: 'Count from receipt of the notice; enter the receipt date as the event date.' },
      { cite: 'PRC Trademark Law (amended 2026, in force 1 January 2027); verify the renumbered article', notes: 'Count from receipt of the notice.' });
    both('CN-TM-OPPOSITION', 'China trademark opposition period', '中国商標 異議申立期間', 'trademark', 'PUBLISHED', 'event_date', [0, 3, 0], 'reminder', 'opposition',
      'Opposition period ends (3 months from preliminary approval publication)', '異議申立期間の満了（初歩審定公告から3か月）',
      { cite: 'PRC Trademark Law (2019) Art. 33' },
      { cite: 'PRC Trademark Law (amended 2026, in force 1 January 2027); verify the renumbered article' });
    both('CN-TM-RENEWAL', 'China trademark renewal', '中国商標の更新', 'trademark', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew China trademark registration', '中国商標登録の更新',
      { window: 12, grace: 6, graceNote: '6-month grace period with a late fee.', every: 10, first: 1, cycleLabel: '{n0}-year renewal', cite: 'PRC Trademark Law (2019) Art. 39, 40', renewal: true, feeKind: 'renewal' },
      { window: 12, grace: 6, graceNote: '6-month grace period with a late fee.', every: 10, first: 1, cycleLabel: '{n0}-year renewal', cite: 'PRC Trademark Law (amended 2026) Art. 43, 44', renewal: true, feeKind: 'renewal' });
    both('CN-TM-NONUSE', 'China trademark non-use exposure', '中国商標 不使用取消リスク', 'trademark', 'REGISTERED', 'registration_date', [3, 0, 0], 'reminder', 'use',
      'Non-use cancellation exposure begins (3 consecutive years without use)', '不使用取消の対象となり得る時期（3年連続不使用）',
      { cite: 'PRC Trademark Law (2019) Art. 49(2)', notes: 'Squatters often attack unused anime and character marks. Keep use evidence per class.' },
      { cite: 'PRC Trademark Law (amended 2026); the 3-year rule stays, verify the renumbered article', notes: 'The amended law also rejects applications without intent to use and fines malicious filers.' });
    rule('CN-DES-ANNUITY', 'China design annual fees', '中国意匠 年金', 'design', 'CN', 'REGISTERED', 'filing_date', [1, 0, 0], 'hard', 'renewal',
      'Pay China design annual fee, year {n}', '中国意匠の年金納付（第{n}年分）', {
        grace: 6,
        graceNote: 'Pay within 6 months after the due date with a monthly surcharge.',
        every: 1,
        first: 2,
        until: 15,
        cycleLabel: 'Year {n}',
        conditions: { stop_at_expiry: true },
        cite: 'PRC Patent Law Art. 42, 43; Implementing Regulations Art. 115 (2023)',
        notes: 'Designs filed from 1 June 2021 last 15 years from filing; earlier ones 10 years. Each year is due before the previous patent year ends.',
        renewal: true,
        feeKind: 'annuity',
      });

    // Korea.
    rule('KR-TM-OA', 'Korea trademark preliminary rejection', '韓国商標 意見提出通知', 'trademark', 'KR', 'OA_ISSUED', 'event_date', [0, 2, 0], 'designated', 'prosecution',
      'Respond to the preliminary rejection', '意見提出通知への応答', {
        extensions: [{ months: 1, label: 'One-month extension on request (repeatable)', label_ja: '請求による1か月延長（複数回可）' }],
        cite: 'KR Trademark Act Art. 55',
        notes: 'The examiner sets the period, usually 2 months. Enter the period from the notice.',
      });
    rule('KR-TM-OPPOSITION', 'Korea trademark opposition period', '韓国商標 異議申立期間', 'trademark', 'KR', 'PUBLISHED', 'event_date', [0, 2, 0], 'reminder', 'opposition',
      'Opposition period ends (2 months from publication)', '異議申立期間の満了（出願公告から2か月）', { cite: 'KR Trademark Act Art. 60' });
    rule('KR-TM-RENEWAL', 'Korea trademark renewal', '韓国商標の更新', 'trademark', 'KR', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew Korea trademark registration', '韓国商標登録の更新', {
        window: 12,
        grace: 6,
        graceNote: '6-month additional period with a higher fee.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'KR Trademark Act Art. 83, 84',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('KR-TM-NONUSE', 'Korea trademark non-use exposure', '韓国商標 不使用取消リスク', 'trademark', 'KR', 'REGISTERED', 'registration_date', [3, 0, 0], 'reminder', 'use',
      'Non-use cancellation exposure begins (3 years without use)', '不使用取消の対象となり得る時期（3年間不使用）', { cite: 'KR Trademark Act Art. 119(1)(iii)' });
    rule('KR-DES-ANNUITY', 'Korea design annual fees', '韓国意匠 年金', 'design', 'KR', 'REGISTERED', 'registration_date', [3, 0, 0], 'hard', 'renewal',
      'Pay Korea design annual fee, year {n}', '韓国意匠の年金納付（第{n}年分）', {
        grace: 6,
        graceNote: '6-month additional period with a monthly surcharge.',
        every: 1,
        first: 4,
        until: 20,
        cycleLabel: 'Year {n}',
        conditions: { stop_at_expiry: true },
        cite: 'KR Design Protection Act Art. 79, 82, 91',
        notes: 'Years 1 to 3 are paid at registration. The term ends 20 years from the filing date.',
        renewal: true,
        feeKind: 'annuity',
      });

    // Taiwan.
    rule('TW-TM-OA', 'Taiwan trademark office action', '台湾商標 意見書提出通知', 'trademark', 'TW', 'OA_ISSUED', 'event_date', [0, 1, 0], 'designated', 'prosecution',
      'Respond to the office action', '意見書提出通知への応答', {
        extensions: [{ months: 1, label: 'Extension on request', label_ja: '請求による延長' }],
        cite: 'TW Trademark Act Art. 31(2)',
        notes: 'TIPO sets the period (usually 1 month for residents, 2 months for applicants abroad). Enter the period from the notice.',
      });
    rule('TW-TM-OPPOSITION', 'Taiwan trademark opposition period', '台湾商標 異議申立期間', 'trademark', 'TW', 'REGISTERED', 'event_date', [0, 3, 0], 'reminder', 'opposition',
      'Opposition period ends (3 months from registration publication)', '異議申立期間の満了（登録公告から3か月）', { cite: 'TW Trademark Act Art. 48(1)' });
    rule('TW-TM-RENEWAL', 'Taiwan trademark renewal', '台湾商標の更新', 'trademark', 'TW', 'REGISTERED', 'registration_date', [10, 0, 0], 'hard', 'renewal',
      'Renew Taiwan trademark registration', '台湾商標登録の更新', {
        window: 6,
        grace: 6,
        graceNote: 'Within 6 months after expiry at double the fee.',
        every: 10,
        first: 1,
        cycleLabel: '{n0}-year renewal',
        cite: 'TW Trademark Act Art. 33, 34',
        renewal: true,
        feeKind: 'renewal',
      });
    rule('TW-TM-NONUSE', 'Taiwan trademark non-use exposure', '台湾商標 不使用取消リスク', 'trademark', 'TW', 'REGISTERED', 'registration_date', [3, 0, 0], 'reminder', 'use',
      'Non-use revocation exposure begins (3 years without use)', '不使用取消の対象となり得る時期（3年間不使用）', { cite: 'TW Trademark Act Art. 63(1)(ii)' });
    rule('TW-DES-ANNUITY', 'Taiwan design annual fees', '台湾意匠 年金', 'design', 'TW', 'REGISTERED', 'registration_date', [1, 0, 0], 'hard', 'renewal',
      'Pay Taiwan design annual fee, year {n}', '台湾意匠の年金納付（第{n}年分）', {
        grace: 6,
        graceNote: 'Within 6 months after the due date with a surcharge of 20% a month, at most double.',
        every: 1,
        first: 2,
        until: 15,
        cycleLabel: 'Year {n}',
        conditions: { stop_at_expiry: true },
        cite: 'TW Patent Act Art. 93, 94, 135, 142',
        notes: 'The first year is paid at grant. The term ends 15 years from the filing date.',
        renewal: true,
        feeKind: 'annuity',
      });

    // --- official holiday lists ----------------------------------------------------------
    function day(office, d, name, working) {
      put('office_calendars', { office: office, date: d + ' 00:00:00.000Z', name: name, source: 'official', working_day: working === true });
    }
    function range(office, from, to, name) {
      let t = Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, Number(from.slice(8, 10)));
      const end = Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, Number(to.slice(8, 10)));
      while (t <= end) {
        const x = new Date(t);
        const mm = x.getUTCMonth() + 1;
        const dd = x.getUTCDate();
        const ds = x.getUTCFullYear() + '-' + (mm < 10 ? '0' : '') + mm + '-' + (dd < 10 ? '0' : '') + dd;
        day(office, ds, name, false);
        t += 86400000;
      }
    }
    // Mainland China 2026 (State Council General Office notice 国办发明电〔2025〕7号, 4 November 2025).
    range('CN', '2026-01-01', '2026-01-03', "New Year's Day");
    range('CN', '2026-02-15', '2026-02-23', 'Spring Festival');
    range('CN', '2026-04-04', '2026-04-06', 'Qingming Festival');
    range('CN', '2026-05-01', '2026-05-05', 'Labour Day');
    range('CN', '2026-06-19', '2026-06-21', 'Dragon Boat Festival');
    range('CN', '2026-09-25', '2026-09-27', 'Mid-Autumn Festival');
    range('CN', '2026-10-01', '2026-10-07', 'National Day');
    for (const w of ['2026-01-04', '2026-02-14', '2026-02-28', '2026-05-09', '2026-09-20', '2026-10-10']) day('CN', w, 'Make-up working day', true);

    // South Korea 2026 and 2027 (KASA calendar notices; Labor Day and Constitution Day added in 2026).
    const KR = [
      ['2026-01-01', "New Year's Day"],
      ['2026-02-16', 'Seollal'], ['2026-02-17', 'Seollal'], ['2026-02-18', 'Seollal'],
      ['2026-03-01', 'Independence Movement Day'], ['2026-03-02', 'Substitute holiday'],
      ['2026-05-01', 'Labor Day'], ['2026-05-05', "Children's Day"],
      ['2026-05-24', "Buddha's Birthday"], ['2026-05-25', 'Substitute holiday'],
      ['2026-06-03', 'Local election day'], ['2026-06-06', 'Memorial Day'],
      ['2026-07-17', 'Constitution Day'], ['2026-08-15', 'Liberation Day'], ['2026-08-17', 'Substitute holiday'],
      ['2026-09-24', 'Chuseok'], ['2026-09-25', 'Chuseok'], ['2026-09-26', 'Chuseok'],
      ['2026-10-03', 'National Foundation Day'], ['2026-10-05', 'Substitute holiday'],
      ['2026-10-09', 'Hangeul Day'], ['2026-12-25', 'Christmas Day'],
      ['2027-01-01', "New Year's Day"],
      ['2027-02-06', 'Seollal'], ['2027-02-07', 'Seollal'], ['2027-02-08', 'Seollal'], ['2027-02-09', 'Substitute holiday'],
      ['2027-03-01', 'Independence Movement Day'], ['2027-05-01', 'Labor Day'], ['2027-05-03', 'Substitute holiday'],
      ['2027-05-05', "Children's Day"], ['2027-05-13', "Buddha's Birthday"], ['2027-06-06', 'Memorial Day'],
      ['2027-07-17', 'Constitution Day'], ['2027-07-19', 'Substitute holiday'],
      ['2027-08-15', 'Liberation Day'], ['2027-08-16', 'Substitute holiday'],
      ['2027-09-14', 'Chuseok'], ['2027-09-15', 'Chuseok'], ['2027-09-16', 'Chuseok'],
      ['2027-10-03', 'National Foundation Day'], ['2027-10-04', 'Substitute holiday'],
      ['2027-10-09', 'Hangeul Day'], ['2027-10-11', 'Substitute holiday'],
      ['2027-12-25', 'Christmas Day'], ['2027-12-27', 'Substitute holiday'],
    ];
    for (const h of KR) day('KR', h[0], h[1], false);

    // Taiwan 2026 and 2027 (DGPA government office calendars; weekday days off only, no make-up working days).
    const TW = [
      ['2026-01-01', 'Founding Day'],
      ['2026-02-16', "Lunar New Year's Eve"], ['2026-02-17', 'Spring Festival'], ['2026-02-18', 'Spring Festival'],
      ['2026-02-19', 'Spring Festival'], ['2026-02-20', 'Substitute holiday'],
      ['2026-02-27', 'Substitute holiday (Peace Memorial Day)'], ['2026-04-03', "Substitute holiday (Children's Day)"],
      ['2026-04-06', 'Substitute holiday (Tomb Sweeping Day)'], ['2026-05-01', 'Labor Day'],
      ['2026-06-19', 'Dragon Boat Festival'], ['2026-09-25', 'Mid-Autumn Festival'], ['2026-09-28', "Teachers' Day"],
      ['2026-10-09', 'Substitute holiday (National Day)'], ['2026-10-26', 'Substitute holiday (Restoration Day)'],
      ['2026-12-25', 'Constitution Day'],
      ['2027-01-01', 'Founding Day'],
      ['2027-02-04', "Day before Lunar New Year's Eve"], ['2027-02-05', "Lunar New Year's Eve"],
      ['2027-02-08', 'Spring Festival'], ['2027-02-09', 'Substitute holiday'], ['2027-02-10', 'Substitute holiday'],
      ['2027-03-01', 'Substitute holiday (Peace Memorial Day)'], ['2027-04-05', 'Tomb Sweeping Day'],
      ['2027-04-06', "Substitute holiday (Children's Day)"], ['2027-04-30', 'Substitute holiday (Labor Day)'],
      ['2027-06-09', 'Dragon Boat Festival'], ['2027-09-15', 'Mid-Autumn Festival'], ['2027-09-28', "Teachers' Day"],
      ['2027-10-11', 'Substitute holiday (National Day)'], ['2027-10-25', 'Restoration Day'],
      ['2027-12-24', 'Substitute holiday (Constitution Day)'], ['2027-12-31', 'Day off (DGPA calendar)'],
    ];
    for (const h of TW) day('TW', h[0], h[1], false);
  },
  (app) => {
    for (const o of ['CN', 'KR', 'TW']) {
      for (const r of app.findRecordsByFilter('office_calendars', 'office = {:o}', '', 0, 0, { o: o })) app.delete(r);
      for (const r of app.findRecordsByFilter('fee_schedule', 'office = {:o}', '', 0, 0, { o: o })) app.delete(r);
      for (const r of app.findRecordsByFilter('rules', 'jurisdiction = {:o}', '', 0, 0, { o: o })) app.delete(r);
    }
  },
);
