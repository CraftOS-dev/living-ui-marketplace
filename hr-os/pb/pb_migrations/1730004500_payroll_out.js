/// <reference path="../pb_data/types.d.ts" />
/**
 * HR OS payroll-out schema: how pay leaves the company and what is owed to
 * the authorities afterwards.
 *
 *   payout_settings  one row per entity: bank file format, the employer's
 *                    bank details per format, GL accounts for the journal,
 *                    filing preferences (deposit frequency, Japan's 納期の特例)
 *   bank_files       a bank payment file written for a locked pay run, kept
 *                    with its SHA-256; status exported, uploaded (a person
 *                    confirmed the upload with the bank's reference),
 *                    superseded or void. `items` holds masked accounts only.
 *   payout_lists     cash and cheque lists of a run (cheque numbers, handed over)
 *   journal_exports  a GL journal written for a run (balanced lines, file)
 *   filings          the statutory filings ledger: one row per entity, filing
 *                    code and period, with the due day, the amount from locked
 *                    runs, a worksheet, a data file and the submission reference
 *   yearend_docs     year-end documents issued to employees (a snapshot of the
 *                    figures from locked runs, hashed)
 *
 * Every collection is closed to the raw API. Money: integer minor units.
 * Days: 'YYYY-MM-DD' text.
 */
migrate(
  (app) => {
    const closed = { listRule: null, viewRule: null, createRule: null, updateRule: null, deleteRule: null };
    const DAY = '^(\\d{4}-\\d{2}-\\d{2})?$';
    const CUR = '^([A-Z]{3})?$';
    const CC = '^([A-Z]{2})?$';
    const stamps = [
      { name: 'created', type: 'autodate', onCreate: true },
      { name: 'updated', type: 'autodate', onCreate: true, onUpdate: true },
    ];
    const id = (name) => app.findCollectionByNameOrId(name).id;
    const txt = (name, max, extra) => Object.assign({ name: name, type: 'text', max: max || 200 }, extra || {});
    const req = (name, max) => ({ name: name, type: 'text', required: true, max: max || 200 });
    const int = (name, extra) => Object.assign({ name: name, type: 'number', onlyInt: true }, extra || {});
    const sel = (name, values, required) => ({ name: name, type: 'select', maxSelect: 1, values: values, required: required === true });
    const day = (name, required) => ({ name: name, type: 'text', max: 10, pattern: DAY, required: required === true });
    const cur = (name) => ({ name: name, type: 'text', max: 3, pattern: CUR });
    const cc = (name) => ({ name: name, type: 'text', max: 2, pattern: CC });
    const json = (name, max) => ({ name: name, type: 'json', maxSize: max || 20000 });
    const rel = (name, target, extra) => Object.assign({ name: name, type: 'relation', maxSelect: 1, collectionId: id(target), cascadeDelete: false }, extra || {});
    const file = (name, max, mimes) => ({ name: name, type: 'file', maxSelect: 1, maxSize: max, mimeTypes: mimes, thumbs: [], protected: true });
    const make = (name, fields, indexes) => {
      const c = new Collection(Object.assign({ type: 'base', name: name, fields: fields, indexes: indexes || [] }, closed));
      app.save(c);
      return c;
    };
    const FORMATS = ['generic_csv', 'nacha_ppd', 'aba', 'sepa_pain001', 'bacs_csv', 'zengin', 'sg_giro_csv', 'in_neft_csv', 'my_maybank_csv', 'my_cimb_txt'];
    const TEXT_FILES = ['text/plain', 'text/csv', 'application/xml', 'text/xml', 'application/octet-stream'];

    make(
      'payout_settings',
      [
        rel('entity', 'entities', { required: true, cascadeDelete: true }),
        sel('bank_format', FORMATS),
        json('payer', 20000),
        json('bank_options', 4000),
        json('gl', 50000),
        sel('journal_format', ['generic_csv', 'xero_csv', 'quickbooks_csv']),
        json('filing_prefs', 8000),
        rel('updated_by', 'members'),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_payout_settings_entity ON payout_settings (entity)'],
    );

    make(
      'bank_files',
      [
        rel('payrun', 'payruns', { required: true }),
        rel('entity', 'entities', { required: true }),
        sel('format', FORMATS, true),
        file('file', 20 * 1024 * 1024, TEXT_FILES),
        txt('filename', 120),
        int('total_minor'),
        cur('currency'),
        int('count', { min: 0 }),
        txt('hash', 80),
        sel('status', ['exported', 'uploaded', 'superseded', 'void'], true),
        json('items', 2000000),
        json('warnings', 200000),
        json('control', 4000),
        txt('reference', 120),
        day('paid_on'),
        rel('exported_by', 'members'),
        txt('exported_at', 40),
        rel('uploaded_by', 'members'),
        txt('uploaded_at', 40),
        txt('void_reason', 500),
        int('downloads', { min: 0 }),
      ].concat(stamps),
      ['CREATE INDEX idx_bank_files_run ON bank_files (payrun, status)', 'CREATE INDEX idx_bank_files_entity ON bank_files (entity, exported_at)'],
    );

    make(
      'payout_lists',
      [
        rel('payrun', 'payruns', { required: true }),
        rel('entity', 'entities', { required: true }),
        sel('method', ['cash', 'cheque'], true),
        json('items', 500000),
        int('total_minor'),
        cur('currency'),
        int('count', { min: 0 }),
        sel('status', ['open', 'done'], true),
        rel('updated_by', 'members'),
        txt('done_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_payout_lists_run ON payout_lists (payrun, method)'],
    );

    make(
      'journal_exports',
      [
        rel('payrun', 'payruns', { required: true }),
        rel('entity', 'entities', { required: true }),
        sel('format', ['generic_csv', 'xero_csv', 'quickbooks_csv'], true),
        file('file', 20 * 1024 * 1024, TEXT_FILES),
        txt('filename', 120),
        json('lines', 2000000),
        int('debit_minor'),
        int('credit_minor'),
        cur('currency'),
        txt('hash', 80),
        rel('exported_by', 'members'),
        txt('exported_at', 40),
      ].concat(stamps),
      ['CREATE INDEX idx_journal_exports_run ON journal_exports (payrun, exported_at)'],
    );

    make(
      'filings',
      [
        rel('entity', 'entities', { required: true }),
        cc('country'),
        req('kind', 60),
        txt('name', 200),
        txt('form', 200),
        txt('pack', 40),
        sel('frequency', ['monthly', 'quarterly', 'half_yearly', 'annual', 'per_pay_date', 'per_bonus'], true),
        req('period', 40),
        day('period_start', true),
        day('period_end', true),
        day('due_day'),
        { name: 'due_manual', type: 'bool' },
        txt('due_rule', 300),
        sel('status', ['todo', 'prepared', 'submitted', 'accepted', 'rejected', 'not_needed', 'amend'], true),
        int('amount_minor'),
        cur('currency'),
        txt('payee', 120),
        json('payruns', 20000),
        rel('payrun', 'payruns'),
        json('worksheet', 2000000),
        txt('worksheet_hash', 80),
        file('file', 20 * 1024 * 1024, TEXT_FILES),
        txt('reference', 200),
        txt('note', 2000),
        rel('prepared_by', 'members'),
        txt('prepared_at', 40),
        rel('submitted_by', 'members'),
        txt('submitted_at', 40),
        day('submitted_on'),
        txt('result_at', 40),
        txt('reminded_on', 10),
        sel('source', ['pack', 'country', 'builtin', 'person'], true),
      ].concat(stamps),
      [
        'CREATE UNIQUE INDEX idx_filings_period ON filings (entity, kind, period)',
        'CREATE INDEX idx_filings_due ON filings (status, due_day)',
        'CREATE INDEX idx_filings_entity ON filings (entity, period_start)',
      ],
    );

    make(
      'yearend_docs',
      [
        rel('entity', 'entities', { required: true }),
        rel('employment', 'employments', { required: true }),
        rel('employee', 'employees', { required: true }),
        req('doc', 60),
        req('year', 10),
        day('period_start', true),
        day('period_end', true),
        json('data', 200000),
        cur('currency'),
        txt('hash', 80),
        sel('status', ['issued', 'withdrawn'], true),
        rel('issued_by', 'members'),
        txt('issued_at', 40),
        txt('viewed_at', 40),
      ].concat(stamps),
      ['CREATE UNIQUE INDEX idx_yearend_docs ON yearend_docs (doc, year, employment)', 'CREATE INDEX idx_yearend_docs_employee ON yearend_docs (employee, status)'],
    );
  },
  (app) => {
    for (const n of ['yearend_docs', 'filings', 'journal_exports', 'payout_lists', 'bank_files', 'payout_settings']) {
      try {
        app.delete(app.findCollectionByNameOrId(n));
      } catch {
        /* already gone */
      }
    }
  },
);
