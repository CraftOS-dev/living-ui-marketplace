/**
 * Catalog: people (directory, profile, hire, personal details, employments,
 * job and tax records, documents, skills, identity documents, bank
 * accounts, sealed values, import and export).
 */
const S = (desc, extra) => Object.assign({ type: 'string', desc: desc }, extra || {});
const N = (desc, extra) => Object.assign({ type: 'number', desc: desc }, extra || {});
const B = (desc, extra) => Object.assign({ type: 'boolean', desc: desc }, extra || {});
const EMPLOYEE = S('Employee number (E0001), id or work email', { required: true });
const EMPLOYMENT = S('Employment number or id (an employee number means their primary employment)', { required: true });
const AS_OF = S('Day to look at (YYYY-MM-DD, default today): past, today or future');

const PERSON = {
  legal_name: S('Full legal name'),
  preferred_name: S('Name to use day to day'),
  family_name: S('Family name'),
  given_name: S('Given name(s)'),
  name_order: S('family_first | given_first', { enum: ['family_first', 'given_first'] }),
  kana: S('JSON {family, given} reading (Japan)'),
  birth_date: S('Birth date'),
  gender: S('Gender (optional, as the person describes it)'),
  nationality: S('Nationality, two-letter code'),
  personal_email: S('Personal email'),
  work_email: S('Work email'),
  phone: S('Phone'),
  address: S('JSON {line1, line2, city, region, postcode, country}'),
  emergency: S('JSON list of emergency contacts [{name, relation, phone, email, address, primary}]'),
  dependants: S('JSON list of dependants [{name, relation, birth_date, tax_dependant, disabled, note}]'),
};

const JOB = {
  title: S('Job title as shown'),
  job_title: S('Job title from the list (name or id)'),
  department: S('Department (name or id)'),
  location: S('Location (name or id)'),
  manager: S('Manager (employee number or id; empty for none)'),
  grade: S('Grade (code or id)'),
  employment_type: S('Employment type (code or id)'),
  fte: N('Full-time equivalent, e.g. 1 or 0.6'),
  schedule: S('Work schedule (name or id; empty = the entity default)'),
  calendar: S('Holiday calendar (code or id; empty = location, then entity)'),
  cost_center: S('Cost centre (code or id)'),
};

module.exports = [
  {
    name: 'people.directory',
    method: 'GET',
    fn: 'lib_people.directory',
    perm: 'signed',
    effect: 'read',
    desc: 'People the caller may see, one row per employment, as of a day: number, name, title, department, location, entity, manager, status. HR sees their entities, managers their reports, everyone themself.',
    params: { q: S('Name, number, email or title contains'), entity: S('Entity'), department: S('Department'), location: S('Location'), manager: S('Manager (employee)'), employment_type: S('Employment type'), status: S('current (default) | upcoming | former | all', { enum: ['current', 'upcoming', 'former', 'all'] }), archived: B('Include archived people'), sort: S('name | number | start_day | department', { enum: ['name', 'number', 'start_day', 'department'] }), as_of: AS_OF, limit: N('Rows (default 50)'), offset: N('Rows to skip') },
  },
  { name: 'people.get', method: 'GET', fn: 'lib_people.get', perm: 'signed', effect: 'read', desc: 'One person: details the caller may see, employments with the job, pay and tax records on the day and scheduled changes, manager, documents, skills, masked bank and identity records, module facts.', params: { employee: EMPLOYEE, as_of: AS_OF } },
  { name: 'people.org-chart', method: 'GET', fn: 'lib_people.orgChart', perm: 'signed', effect: 'read', desc: 'The reporting lines as of a day: nodes (employee, name, title, manager, reports count) and roots.', params: { entity: S('Entity'), department: S('Department'), as_of: AS_OF } },
  { name: 'people.timeline', method: 'GET', fn: 'lib_people.timeline', perm: 'signed', effect: 'read', desc: 'History of one employment: every job, pay and tax record (past, current, scheduled) and changes to the employment.', params: { employment: EMPLOYMENT } },
  {
    name: 'people.hire',
    method: 'POST',
    fn: 'lib_people.hire',
    perm: 'people:full',
    agent: 'propose',
    kind: 'people',
    preview: 'lib_people.previewHire',
    effect: 'write',
    desc: 'Hire into an entity from a day: employee (or new employment of --employee), employment, first job record, optional pay record, tax profile. Modules start onboarding, leave, pay.',
    params: Object.assign({}, PERSON, JOB, {
      entity: S('Entity id or name', { required: true }),
      start_day: S('First day', { required: true }),
      employee: S('Existing employee (rehire or a second employment)'),
      probation_end: S('Probation end day'),
      primary: B('Make this the primary employment'),
      pay_basis: S('salary | hourly | daily', { enum: ['salary', 'hourly', 'daily'] }),
      pay_amount: S('Pay in the entity currency, major units, e.g. 6500.00'),
      pay_per: S('year | month | week | day | hour', { enum: ['year', 'month', 'week', 'day', 'hour'] }),
      pay_schedule: S('Pay schedule id (payroll)'),
      tax_fields: S('JSON tax profile fields of the packs (e.g. {"filing_status":"single"})'),
      tax_packs: S('JSON list of pack codes (default: the entity packs)'),
      note: S('Note on the hire'),
      from_application: S('Hiring application id this hire comes from'),
    }),
  },
  { name: 'people.update', method: 'POST', fn: 'lib_people.update', perm: 'signed', agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'employees', id: 'employee', fields: { legal_name: 'legal_name', preferred_name: 'preferred_name', family_name: 'family_name', given_name: 'given_name', birth_date: 'birth_date', gender: 'gender', nationality: 'nationality', personal_email: 'personal_email', work_email: 'work_email', phone: 'phone', address: 'address', emergency: 'emergency', dependants: 'dependants' } }, desc: "Change a person's details. HR changes anything; a person changes their own preferred name, phone, personal email, address, emergency contacts and dependants.", params: Object.assign({ employee: EMPLOYEE, notes: S('HR notes') }, PERSON) },
  { name: 'people.photo', method: 'GET', fn: 'lib_people.photo', perm: 'signed', effect: 'read', desc: "A person's photo (an image; your AI agent gets its path on this machine).", params: { employee: EMPLOYEE } },
  { name: 'people.photo-set', method: 'POST', fn: 'lib_people.photoSet', perm: 'signed', effect: 'write', files: ['photo'], desc: 'Set a photo (upload the photo field: JPEG, PNG or WebP up to 5 MB; your AI agent gives --path), or remove it with --clear true. A person sets their own; HR sets anyone.', params: { employee: EMPLOYEE, clear: B('Remove the photo'), path: S('Your AI agent: an image file on this machine') } },
  { name: 'people.archive', method: 'POST', fn: 'lib_people.archive', perm: 'people:edit', agent: 'deny', effect: 'write', desc: 'Archive (or restore) a person who no longer works here; their history stays.', params: { employee: EMPLOYEE, archived: B('true to archive (default), false to restore') } },
  { name: 'people.delete', method: 'POST', fn: 'lib_people.remove', perm: 'people:full', agent: 'deny', effect: 'confirm', destructive: true, desc: 'Delete a person who was never paid (a wrong hire) with their records. Needs your PIN. Everyone else is archived.', params: { employee: EMPLOYEE } },
  { name: 'people.import-check', method: 'POST', fn: 'lib_people.importCheck', perm: 'people:full', effect: 'write', files: ['file'], desc: 'Check a people CSV row by row, changing nothing: legal_name, entity and start_day are required; the other columns are in app.guide --module kernel. people.import takes the same CSV.', params: { csv: S('CSV text (or upload a file, or --path)'), path: S('Your AI agent: a CSV file on this machine') } },
  { name: 'people.import', method: 'POST', fn: 'lib_people.importCommit', perm: 'people:full', agent: 'propose', kind: 'people', effect: 'write', files: ['file'], desc: 'Import a people CSV (all rows or none; run people.import-check first). Each row becomes a hire.', params: { csv: S('CSV text (or upload a file, or --path)'), path: S('Your AI agent: a CSV file on this machine') } },
  { name: 'people.export', method: 'GET', fn: 'lib_people.exportCsv', perm: 'people:view', agent: 'deny', effect: 'read', desc: 'A CSV of the people the caller sees (pay columns only for those whose pay they may see).', params: { entity: S('Entity'), status: S('current | upcoming | former | all', { enum: ['current', 'upcoming', 'former', 'all'] }), include_pay: B('Add pay columns'), as_of: AS_OF } },

  { name: 'employments.update', method: 'POST', fn: 'lib_people.employmentsUpdate', perm: 'people:edit', agent: 'propose', kind: 'people', effect: 'write', diff: { collection: 'employments', id: 'employment', fields: { probation_end: 'probation_end', notice_day: 'notice_day', start_day: 'start_day' } }, desc: 'Change an employment: probation end, notice day, start day (before later changes), on leave, primary.', params: { employment: EMPLOYMENT, probation_end: S('Probation end day'), notice_day: S('Day notice was given'), start_day: S('First day'), on_leave: B('On a long leave (sabbatical, parental)'), primary: B('Make this the primary employment') } },
  { name: 'employments.end', method: 'POST', fn: 'lib_people.employmentsEnd', perm: 'people:full', agent: 'deny', effect: 'write', desc: 'Set the last day of an employment (a separation does this for you).', params: { employment: EMPLOYMENT, end_day: S('Last day', { required: true }), reason: S('Reason') } },

  { name: 'job.history', method: 'GET', fn: 'lib_people.jobHistory', perm: 'signed', effect: 'read', desc: 'Every job record of an employment (past, current, scheduled).', params: { employment: EMPLOYMENT } },
  { name: 'job.update', method: 'POST', fn: 'lib_people.jobUpdate', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_people.previewJobUpdate', effect: 'write', desc: 'A job change from a day (promotion, transfer, new manager...): a new record, history kept; the fields you leave out carry over.', params: Object.assign({ employment: EMPLOYMENT, effective_from: S('From day (default today; future days schedule it)'), reason: S('promotion | transfer | change | correction', { required: true, enum: ['promotion', 'transfer', 'change', 'correction'] }), note: S('Note') }, JOB) },
  { name: 'job.edit', method: 'POST', fn: 'lib_people.jobEdit', perm: 'people:edit', agent: 'propose', kind: 'people', preview: 'lib_people.previewJobEdit', effect: 'write', desc: 'Correct a job record in place (a typo, a wrong department). Refused once a locked pay run used it.', params: Object.assign({ record: S('Job record id', { required: true }), reason: S('Reason', { enum: ['hire', 'promotion', 'transfer', 'change', 'correction'] }), note: S('Note') }, JOB) },
  { name: 'job.delete', method: 'POST', fn: 'lib_people.jobDelete', perm: 'people:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a scheduled (future) job change.', params: { record: S('Job record id', { required: true }) } },

  { name: 'tax.history', method: 'GET', fn: 'lib_people.taxHistory', perm: 'signed', effect: 'read', desc: 'Every tax profile of an employment (the pack profile fields from each day).', params: { employment: EMPLOYMENT } },
  { name: 'tax.update', method: 'POST', fn: 'lib_people.taxUpdate', perm: 'signed', agent: 'propose', kind: 'payroll', preview: 'lib_people.previewTaxUpdate', effect: 'write', desc: 'New tax profile fields from a day (W-4, dependants, regime...). Payroll changes anyone; a person their own. Fields merge unless --replace_fields true.', params: { employment: EMPLOYMENT, effective_from: S('From day (default today)'), fields: S('JSON of pack profile fields'), packs: S('JSON list of pack codes'), replace_fields: B('Replace all fields instead of merging'), note: S('Note') } },
  { name: 'tax.edit', method: 'POST', fn: 'lib_people.taxEdit', perm: 'signed', agent: 'propose', kind: 'payroll', preview: 'lib_people.previewTaxEdit', effect: 'write', desc: 'Correct a tax profile in place. Refused once a locked pay run used it.', params: { record: S('Tax profile id', { required: true }), fields: S('JSON of pack profile fields'), packs: S('JSON list of pack codes'), replace_fields: B('Replace all fields'), note: S('Note') } },
  { name: 'tax.delete', method: 'POST', fn: 'lib_people.taxDelete', perm: 'payroll:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove a scheduled (future) tax profile.', params: { record: S('Tax profile id', { required: true }) } },

  { name: 'documents.list', method: 'GET', fn: 'lib_people.documentsList', perm: 'signed', effect: 'read', desc: "A person's documents (contracts, policies, letters, certificates); a person sees the ones shared with them.", params: { employee: EMPLOYEE, category: S('Category') } },
  { name: 'documents.add', method: 'POST', fn: 'lib_people.documentsAdd', perm: 'signed', effect: 'write', files: ['file'], desc: 'Add a document to a person (upload the file, or your AI agent gives --path); optionally ask them to acknowledge it.', params: { employee: EMPLOYEE, title: S('Title', { required: true }), category: S('Category, e.g. contract, policy, certificate, insurance'), employment: S('Employment it belongs to'), visible_to_employee: B('The person sees it (default true)'), needs_ack: B('The person must acknowledge it'), expires: S('Expiry day'), note: S('Note'), path: S('Your AI agent: a file on this machine') } },
  { name: 'documents.update', method: 'POST', fn: 'lib_people.documentsUpdate', perm: 'people:edit', effect: 'write', desc: 'Change a document (title, category, sharing, acknowledgement, expiry).', params: { document: S('Document id', { required: true }), title: S('Title'), category: S('Category'), visible_to_employee: B('Shared with the person'), needs_ack: B('Needs acknowledgement'), expires: S('Expiry day'), note: S('Note') } },
  { name: 'documents.delete', method: 'POST', fn: 'lib_people.documentsDelete', perm: 'people:edit', agent: 'deny', effect: 'write', destructive: true, desc: 'Delete a document.', params: { document: S('Document id', { required: true }) } },
  { name: 'documents.file', method: 'GET', fn: 'lib_people.documentsFile', perm: 'signed', effect: 'read', desc: "Open a document's file (your AI agent gets its path on this machine).", params: { document: S('Document id', { required: true }), download: B('Download instead of view') } },
  { name: 'documents.ack', method: 'POST', fn: 'lib_people.documentsAck', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Acknowledge a document you were asked to read.', params: { document: S('Document id', { required: true }) } },

  { name: 'employee-skills.list', method: 'GET', fn: 'lib_people.skillsList', perm: 'signed', effect: 'read', desc: "A person's skills with level (1 to 5) and who verified them.", params: { employee: EMPLOYEE } },
  { name: 'employee-skills.set', method: 'POST', fn: 'lib_people.skillsSet', perm: 'signed', effect: 'write', desc: 'Add or change a skill of a person (people set their own; managers and HR can verify).', params: { employee: EMPLOYEE, skill: S('Skill name', { required: true }), level: N('Level 1 to 5'), verified: B('Verified by you'), note: S('Note') } },
  { name: 'employee-skills.remove', method: 'POST', fn: 'lib_people.skillsRemove', perm: 'signed', effect: 'write', destructive: true, desc: 'Remove a skill entry.', params: { skill: S('Skill entry id', { required: true }) } },

  { name: 'ids.list', method: 'GET', fn: 'lib_people.idsList', perm: 'signed', effect: 'read', desc: "A person's identity documents (numbers masked) and the document types of their countries.", params: { employee: EMPLOYEE } },
  { name: 'ids.add', method: 'POST', fn: 'lib_people.idsAdd', perm: 'signed', agent: 'deny', effect: 'write', files: ['file'], desc: 'Add an identity document (national ID, My Number, passport...); the number is sealed.', params: { employee: EMPLOYEE, type: S('Type code, e.g. passport, nric, my_number, ssn, pan, aadhaar', { required: true }), number: S('Number', { required: true, secret: true }), country: S('Issuing country'), issued: S('Issue day'), expires: S('Expiry day'), note: S('Note') } },
  { name: 'ids.update', method: 'POST', fn: 'lib_people.idsUpdate', perm: 'signed', agent: 'deny', effect: 'write', files: ['file'], desc: 'Change an identity document.', params: { identity_doc: S('Identity document id', { required: true }), number: S('Number', { secret: true }), issued: S('Issue day'), expires: S('Expiry day'), note: S('Note') } },
  { name: 'ids.delete', method: 'POST', fn: 'lib_people.idsDelete', perm: 'signed', agent: 'deny', effect: 'write', destructive: true, desc: 'Remove an identity document.', params: { identity_doc: S('Identity document id', { required: true }) } },
  { name: 'ids.file', method: 'GET', fn: 'lib_people.idsFile', perm: 'signed', agent: 'deny', effect: 'read', desc: "Open an identity document's scan.", params: { identity_doc: S('Identity document id', { required: true }), download: B('Download') } },

  { name: 'bank.list', method: 'GET', fn: 'lib_people.bankList', perm: 'signed', effect: 'read', desc: "A person's bank accounts (numbers masked) with split and status (pending until approved).", params: { employee: EMPLOYEE } },
  { name: 'bank.add', method: 'POST', fn: 'lib_people.bankAdd', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Add a bank account for pay (the person or HR/payroll): it waits until a payroll administrator approves it with their PIN.', params: { employee: EMPLOYEE, number: S('Account number', { required: true, secret: true }), iban: S('IBAN', { secret: true }), label: S('Label, e.g. Salary account'), bank_name: S('Bank name'), bank_code: S('Bank code (routing, IFSC, sort code, BSB, zengin bank code)'), branch_code: S('Branch code'), account_type: S('Account type (checking, savings, futsu...)'), holder: S('Account holder (default: legal name)'), swift: S('SWIFT/BIC'), country: S('Country'), currency: S('Currency'), split: S('JSON {kind: rest|percent|fixed, value} (default rest)') } },
  { name: 'bank.retire', method: 'POST', fn: 'lib_people.bankRetire', perm: 'signed', agent: 'deny', effect: 'write', desc: 'Stop using a bank account (a pending one is withdrawn).', params: { bank_account: S('Bank account id', { required: true }) } },
  { name: 'seal.reveal', method: 'POST', fn: 'lib_seal.reveal', perm: 'signed', agent: 'deny', effect: 'confirm', desc: 'Show a sealed number (bank account, IBAN, identity number) for five minutes. Needs your PIN; audited.', params: { collection: S('bank_accounts | identity_docs', { required: true, enum: ['bank_accounts', 'identity_docs'] }), id: S('Record id', { required: true }), field: S('number | iban', { enum: ['number', 'iban'] }) } },
];
