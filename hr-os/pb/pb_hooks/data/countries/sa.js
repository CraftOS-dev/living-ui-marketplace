// Saudi Arabia country data for HR OS (packs-west).

module.exports = {
  code: 'SA',
  name: 'Saudi Arabia',
  currency: 'SAR',
  timezone: 'Asia/Riyadh',
  date_format: 'DD/MM/YYYY',
  week_start: 0,
  weekend: [5, 6],
  name_order: 'given_first',
  id_types: [
    { code: 'national_id', label: 'National ID', mask: 'last4', pattern: '^1\\d{9}$' },
    { code: 'iqama', label: 'Iqama (resident ID)', mask: 'last4', pattern: '^2\\d{9}$' }
  ],
  packs: ['generic'],
  bank_formats: ['generic_csv'],
  schedule: { days: [0, 1, 2, 3, 4], start: '09:00', end: '17:00', break_min: 60 },
  holidays: [],
  sources: [
    {
      title: 'ISO 4217 currency and IANA time zone database identifiers; national identifier formats',
      url: 'https://www.iso.org/iso-4217-currency-codes.html',
      retrieved: '2026-11-04',
      note: 'Metadata only; no statutory rates, leave minimums or holidays were researched.'
    }
  ],
  notes: 'Metadata only: no built-in payroll pack (the generic pack is enabled, with rates a person sets), no statutory leave minimums and no public holidays (add them as company holidays). Wage Protection System files go through Mudad, which this app does not generate. GOSI contributions are not built in; use the generic pack with your rates.'
};
