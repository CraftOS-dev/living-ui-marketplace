// South Africa country data for HR OS (packs-west).

module.exports = {
  code: 'ZA',
  name: 'South Africa',
  currency: 'ZAR',
  timezone: 'Africa/Johannesburg',
  date_format: 'YYYY/MM/DD',
  week_start: 1,
  weekend: [0, 6],
  name_order: 'given_first',
  id_types: [
    { code: 'sa_id', label: 'South African ID number', mask: 'last3', pattern: '^\\d{13}$' },
    { code: 'tax_ref', label: 'SARS income tax reference', mask: 'last3', pattern: '^\\d{10}$' }
  ],
  packs: ['generic'],
  bank_formats: ['generic_csv'],
  schedule: { days: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', break_min: 60 },
  holidays: [],
  sources: [
    {
      title: 'ISO 4217 currency and IANA time zone database identifiers; national identifier formats',
      url: 'https://www.iso.org/iso-4217-currency-codes.html',
      retrieved: '2026-11-04',
      note: 'Metadata only; no statutory rates, leave minimums or holidays were researched.'
    }
  ],
  notes: 'Metadata only: no built-in payroll pack (the generic pack is enabled, with rates a person sets), no statutory leave minimums and no public holidays (add them as company holidays). PAYE, UIF and SDL are not built in.'
};
