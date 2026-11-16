/**
 * Catalog: tax profiles and tax declarations (payroll-core).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const EMPLOYMENT = S('Employment number or id (an employee number means their primary employment)', { required: true });
const DECL = S('Declaration id', { required: true });

module.exports = [
  { name: 'taxprofile.get', method: 'GET', fn: 'lib_payroll_tax.profileGet', perm: 'signed', effect: 'read', desc: 'The tax profile form of an employment: the pack field definitions (W-4, 扶養控除等申告書, CPF residency, Indian regime, TP1, UK tax code, TFN), the values in effect, what is missing, history and requests.', params: { employment: EMPLOYMENT, as_of: S('Day') } },
  { name: 'taxprofile.submit', method: 'POST', fn: 'lib_payroll_tax.profileSubmit', perm: 'signed', agent: 'propose', kind: 'payroll', effect: 'write', desc: 'Change tax profile fields from a day (fields merge). Payroll changes apply at once; a person\'s own change goes to payroll for approval when the entity says those fields need it.', params: { employment: EMPLOYMENT, fields: S('JSON of pack profile fields, e.g. {"us_filing_status":"mfj"}'), effective_from: S('From day (default today)'), packs: S('JSON list of pack codes (payroll only)'), note: S('Note') } },

  { name: 'payroll.person-set', method: 'POST', fn: 'lib_payroll_tax.personSet', perm: 'payroll:edit', agent: 'propose', kind: 'payroll', effect: 'write', diff: { collection: 'employees', id: 'employee', fields: { birth_date: 'birth_date', nationality: 'nationality', gender: 'gender' } }, desc: 'Set only the personal fields rule packs need (birth date, nationality, gender) for a person you run payroll for. Other details go to HR.', params: { employee: S('Employee number, email or name', { required: true }), birth_date: S('Birth date YYYY-MM-DD'), nationality: S('Two-letter country code'), gender: S('Gender') } },

  { name: 'declarations.types', method: 'GET', fn: 'lib_payroll_tax.types', perm: 'signed', effect: 'read', desc: 'What a country\'s tax declaration covers (India: 80C, 80CCD(1B), 80D, HRA, LTA, 24(b), 80E, 80G, 80TTA, previous employer) and its regimes.', params: { country: S('Country code'), employment: S('Employment') } },
  { name: 'declarations.list', method: 'GET', fn: 'lib_payroll_tax.declarationsList', perm: 'signed', effect: 'read', desc: 'Tax declarations (payroll sees every one in scope; a person their own).', params: { employment: S('Employment'), status: S('draft | submitted | approved | rejected'), kind: S('investment | profile | all', { enum: ['investment', 'profile', 'all'] }) } },
  { name: 'declarations.get', method: 'GET', fn: 'lib_payroll_tax.declarationsGet', perm: 'signed', effect: 'read', desc: 'One declaration with its items, proofs and status.', params: { declaration: DECL } },
  { name: 'declarations.save', method: 'POST', fn: 'lib_payroll_tax.declarationsSave', perm: 'signed', effect: 'write', desc: 'Start or change a draft declaration: the regime and items [{"section":"80C","amount":"150000","description":"PPF"}].', params: { declaration: S('Declaration id (empty to start one)'), employment: S('Employment (to start one)'), fiscal_year: S('Fiscal year, e.g. 2026-27'), regime: S('new | old (India)'), items: S('JSON list of items'), note: S('Note') } },
  { name: 'declarations.proof', method: 'POST', fn: 'lib_payroll_tax.proofAdd', perm: 'signed', effect: 'write', files: ['file'], desc: 'Attach a proof (receipt, certificate, rent receipt) to a declaration section.', params: { declaration: DECL, section: S('Section, e.g. 80C'), name: S('Name of the proof'), path: S('Your AI agent: a file on this machine') } },
  { name: 'declarations.file', method: 'GET', fn: 'lib_payroll_tax.proofFile', perm: 'signed', effect: 'read', desc: 'Open a proof file of a declaration.', params: { declaration: DECL, file: S('File name', { required: true }), download: B('Download') } },
  { name: 'declarations.submit', method: 'POST', fn: 'lib_payroll_tax.declarationsSubmit', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Send a declaration to payroll for approval; on approval its amounts become tax profile fields from that day.', params: { declaration: DECL } },
];
