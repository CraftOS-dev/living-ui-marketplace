/**
 * Lifecycle defaults (plain data, no PocketBase globals): the onboarding
 * and offboarding tasks every new entity starts with, the country tasks
 * added on top (documents to collect, registrations and their deadlines),
 * the letter templates, the exit interview questions and the grievance
 * types. A person edits all of them in the app; these are the first draft.
 *
 * Task item: { key, title, description, assignee, due_offset_days, kind,
 * document_category }. assignee: hr | manager | it | employee | agent.
 * due_offset_days counts from the first day (onboarding) or the last day
 * (offboarding); negative is before it. kind: task | document (an upload
 * completes it) | signature (the assignee confirms they signed).
 */

const t = (key, title, assignee, due, kind, category, description) => ({
  key: key,
  title: title,
  description: description || '',
  assignee: assignee,
  due_offset_days: due,
  kind: kind || 'task',
  document_category: category || '',
});

const ONBOARDING = [
  t('welcome_message', 'Send the welcome message and first-day details', 'hr', -5, 'task', '', 'Start time, address, who to ask for and what to bring. Fill in the first-day details on this checklist so the new hire sees them on their welcome page.'),
  t('agent_plan', 'Draft the welcome note and a first-week plan for the manager', 'agent', -4, 'task', '', 'Your AI agent reads the role, team and start day and leaves the draft in the task note.'),
  t('contract', 'Sign the employment contract', 'employee', -3, 'signature', 'contract'),
  t('first_week', 'Plan the first week and choose a buddy', 'manager', -3),
  t('laptop', 'Prepare the laptop and accessories', 'it', -3),
  t('accounts', 'Create work accounts (email, chat and HR OS)', 'it', -2),
  t('personal_details', 'Add personal details, an emergency contact and a bank account', 'employee', -1),
  t('identity', 'Upload an identity document', 'employee', 0, 'document', 'identity'),
  t('welcome', 'Welcome and introductions on the first day', 'manager', 0),
  t('equipment', 'Hand over equipment and the access card', 'it', 0, 'task', '', 'Record each item in Assets so it shows on the person and comes back at offboarding.'),
  t('handbook', 'Read the employee handbook', 'employee', 3),
  t('week_one', 'First-week check-in', 'manager', 5),
  t('day_thirty', '30-day check-in', 'manager', 30),
  t('probation', 'Probation review', 'manager', 85),
];

const ONBOARDING_BY_COUNTRY = {
  US: [
    t('us_i9_1', 'Form I-9 Section 1 (by the first day)', 'employee', 0, 'document', 'i9'),
    t('us_i9_2', 'Form I-9 Section 2: examine the identity and work authorisation documents (within 3 business days)', 'hr', 3),
    t('us_w4', 'Form W-4 (federal withholding)', 'employee', 0, 'document', 'w4'),
    t('us_state_w4', 'State withholding certificate, where the state has one', 'employee', 0, 'document', 'state_withholding'),
    t('us_new_hire', 'Report the new hire to the state (within 20 days)', 'hr', 20),
  ],
  JP: [
    t('jp_conditions', '労働条件通知書 (written working conditions) to the new hire', 'hr', -3, 'document', 'working_conditions'),
    t('jp_my_number', 'マイナンバー (My Number): consent to collection and the identity check', 'employee', 0, 'document', 'my_number_consent', 'Record the number itself in Identity documents, where it is sealed.'),
    t('jp_fuyo', '扶養控除等申告書 (dependants declaration for withholding)', 'employee', 0, 'document', 'fuyo_kojo'),
    t('jp_commute', '通勤経路 (commuting route for the allowance)', 'employee', 0),
    t('jp_shakai', '健康保険・厚生年金 enrolment (資格取得届 within 5 days)', 'hr', 5),
    t('jp_koyo', '雇用保険 enrolment (資格取得届 by the 10th of the next month)', 'hr', 10),
  ],
  SG: [
    t('sg_pass', 'Check the work pass is valid from the first day (foreign employees)', 'hr', -7),
    t('sg_cpf', 'CPF: confirm residency status for contributions (citizens and PRs)', 'hr', 0),
    t('sg_kets', 'Key Employment Terms in writing (within 14 days)', 'hr', 14, 'document', 'kets'),
  ],
  IN: [
    t('in_pan', 'PAN (for TDS on salary)', 'employee', 0, 'document', 'pan'),
    t('in_aadhaar', 'Aadhaar, with consent (for UAN and KYC)', 'employee', 0, 'document', 'aadhaar'),
    t('in_form11', 'EPF Form 11 (declaration)', 'employee', 0, 'document', 'epf_form11'),
    t('in_uan', 'UAN: record the existing UAN or generate one (EPF)', 'hr', 7),
    t('in_regime', 'Tax regime choice and investment declaration (Form 12BB for the old regime)', 'employee', 14, 'document', 'form12bb'),
    t('in_nomination', 'Nominations: EPF Form 2 and gratuity Form F', 'employee', 30, 'document', 'nomination'),
  ],
  MY: [
    t('my_tax', 'Income tax number, and Form TP3 when they worked elsewhere this year', 'employee', 0, 'document', 'tp3'),
    t('my_epf', 'EPF (KWSP) registration of the employee (within 7 days)', 'hr', 7),
    t('my_socso', 'SOCSO (PERKESO) and EIS registration (within 30 days)', 'hr', 30),
  ],
  GB: [
    t('gb_rtw', 'Right to work check (before the first day)', 'hr', -1, 'document', 'right_to_work'),
    t('gb_statement', 'Written statement of employment particulars (on or before the first day)', 'hr', 0, 'document', 'written_statement'),
    t('gb_p45', 'P45 from the previous employer, or the starter checklist', 'employee', 0, 'document', 'p45'),
    t('gb_pension', 'Workplace pension: assess for automatic enrolment', 'hr', 0),
  ],
  AU: [
    t('au_tfn', 'TFN declaration', 'employee', 0, 'document', 'tfn_declaration'),
    t('au_super', 'Superannuation standard choice form (offer within 28 days)', 'employee', 0, 'document', 'super_choice'),
    t('au_fwis', 'Fair Work Information Statement', 'hr', 0),
    t('au_tfn_lodge', 'Lodge the TFN declaration with the ATO (within 14 days)', 'hr', 14),
  ],
};

const OFFBOARDING = [
  t('confirm', 'Confirm the last day and the separation details in writing', 'hr', -10),
  t('handover', 'Plan the handover of work', 'manager', -10),
  t('agent_letter', 'Draft the experience letter for HR to issue', 'agent', -3, 'task', '', 'Your AI agent drafts it from the records; HR checks and issues it in Letters.'),
  t('exit_interview', 'Exit interview', 'hr', -3, 'task', '', 'Open the separation and fill in the exit interview, or ask the person to fill it in.'),
  t('return_property', 'Return company property', 'employee', -1),
  t('collect_assets', 'Collect equipment and the access card', 'it', 0, 'task', '', 'The assets this person holds are listed on the separation.'),
  t('accounts_off', 'Turn off accounts and access', 'it', 0),
  t('reassign', 'Reassign direct reports and open approvals', 'manager', 0),
  t('final_pay', 'Check final pay in the termination pay run', 'hr', 0),
  t('letter', 'Issue the experience or relieving letter', 'hr', 0),
];

const OFFBOARDING_BY_COUNTRY = {
  US: [t('us_final_pay', 'Final paycheck by the state deadline (some states: on the last day)', 'hr', 0), t('us_cobra', 'COBRA continuation notice, when the company has a group health plan', 'hr', 14)],
  JP: [
    t('jp_card', 'Return the health insurance card (健康保険証)', 'employee', 0),
    t('jp_shakai_loss', '健康保険・厚生年金 資格喪失届 (within 5 days)', 'hr', 5),
    t('jp_koyo_loss', '雇用保険 資格喪失届 and 離職証明書 (within 10 days)', 'hr', 10),
    t('jp_resident_tax', '住民税: 給与所得者異動届出書 to the city (by the 10th of the next month)', 'hr', 10),
    t('jp_gensen', '源泉徴収票 for the year (within one month)', 'hr', 30),
  ],
  SG: [
    t('sg_ir21', 'IR21 tax clearance for non-citizen employees (at least one month before the last day)', 'hr', -30),
    t('sg_cpf_final', 'Final CPF contribution', 'hr', 0),
    t('sg_pass_cancel', 'Cancel the work pass (within 7 days of the last day)', 'hr', 7),
  ],
  IN: [
    t('in_fnf', 'Full and final settlement', 'hr', 2),
    t('in_epf_exit', 'EPF: date of exit, and transfer or withdrawal guidance', 'hr', 7),
    t('in_form16', 'Form 16 for the year', 'hr', 30),
    t('in_gratuity', 'Gratuity (5 years of service or more, pay within 30 days)', 'hr', 30),
  ],
  MY: [
    t('my_cp22a', 'Form CP22A to LHDN (at least 30 days before the last day, when required)', 'hr', -30),
    t('my_stop', 'Stop EPF, SOCSO and EIS after the final month', 'hr', 0),
    t('my_ea', 'Form EA for the year (by the end of February)', 'hr', 30),
  ],
  GB: [t('gb_p45', 'Issue the P45 (on or after the last day)', 'hr', 0), t('gb_holiday', 'Pay holiday accrued and not taken', 'hr', 0)],
  AU: [t('au_final', 'Final pay, including unused annual leave', 'hr', 0), t('au_sep_cert', 'Employment separation certificate on request (within 14 days)', 'hr', 14)],
};

const COUNTRY_NAMES = { US: 'United States', JP: 'Japan', SG: 'Singapore', IN: 'India', MY: 'Malaysia', GB: 'United Kingdom', AU: 'Australia' };

const LETTERS = [
  {
    kind: 'offer',
    name: 'Offer of employment',
    country: '',
    language: 'en',
    needs_ack: true,
    body: [
      '# Offer of employment',
      '',
      '{{letter.date}}',
      '',
      'Dear {{employee.name}},',
      '',
      'We are pleased to offer you the position of **{{job.title}}** with {{entity.legal_name}}, starting on {{employment.start_day}}.',
      '',
      'You will report to {{job.manager}} and work at {{job.location}}. Your pay will be {{pay.amount}} per {{pay.per}}.',
      '',
      'This offer depends on the checks and documents in your onboarding checklist. Please acknowledge this letter to accept the offer.',
      '',
      'We look forward to welcoming you.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}  ',
      '{{entity.legal_name}}',
    ].join('\n'),
  },
  {
    kind: 'appointment',
    name: 'Letter of appointment',
    country: '',
    language: 'en',
    needs_ack: true,
    body: [
      '# Letter of appointment',
      '',
      '{{letter.date}}',
      '',
      'Dear {{employee.name}},',
      '',
      '{{entity.legal_name}} appoints you as **{{job.title}}** in {{job.department}} from {{employment.start_day}}. Your employee number is {{employee.number}}.',
      '',
      'Your probation period ends on {{employment.probation_end}}. Your pay is {{pay.amount}} per {{pay.per}}, paid as your contract sets out. Your working hours, leave and other terms follow your contract and the employee handbook.',
      '',
      'Please acknowledge this letter to confirm you have received it.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'confirmation',
    name: 'Confirmation after probation',
    country: '',
    language: 'en',
    needs_ack: false,
    body: [
      '# Confirmation of employment',
      '',
      '{{letter.date}}',
      '',
      'Dear {{employee.name}},',
      '',
      'We are pleased to confirm that you have completed your probation. Your employment as {{job.title}} with {{entity.legal_name}} is confirmed from {{letter.date}}.',
      '',
      'Thank you for your work so far.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'experience',
    name: 'Experience letter',
    country: '',
    language: 'en',
    needs_ack: false,
    body: [
      '# Experience letter',
      '',
      '{{letter.date}}',
      '',
      'To whom it may concern,',
      '',
      'This is to certify that {{employee.legal_name}} (employee number {{employee.number}}) worked for {{entity.legal_name}} from {{employment.start_day}} to {{employment.end_day}}. Their last position was {{job.title}} in {{job.department}}.',
      '',
      'We thank them for their contributions and wish them well.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}  ',
      '{{entity.legal_name}}',
    ].join('\n'),
  },
  {
    kind: 'custom',
    name: 'Certificate of employment',
    country: '',
    language: 'en',
    needs_ack: false,
    body: [
      '# Certificate of employment',
      '',
      '{{letter.date}}',
      '',
      'To whom it may concern,',
      '',
      'This is to certify that {{employee.legal_name}} (employee number {{employee.number}}) has been employed by {{entity.legal_name}} since {{employment.start_day}} and holds the position of {{job.title}} in {{job.department}}.',
      '',
      'This certificate is issued at the employee\'s request.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'salary_certificate',
    name: 'Salary certificate',
    country: '',
    language: 'en',
    needs_ack: false,
    body: [
      '# Salary certificate',
      '',
      '{{letter.date}}',
      '',
      'To whom it may concern,',
      '',
      'This is to certify that {{employee.legal_name}} (employee number {{employee.number}}) has been employed by {{entity.legal_name}} as {{job.title}} since {{employment.start_day}}, with pay of {{pay.amount}} per {{pay.per}}.',
      '',
      'This certificate is issued at the employee\'s request for {{letter.purpose}}.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'warning',
    name: 'Written warning',
    country: '',
    language: 'en',
    needs_ack: true,
    body: [
      '# Written warning',
      '',
      '{{letter.date}}',
      '',
      'Dear {{employee.name}},',
      '',
      'This letter is a formal written warning about {{letter.subject}}.',
      '',
      '{{letter.details}}',
      '',
      'We expect {{letter.expectation}}. If this does not improve, further action may follow under the disciplinary policy. You may respond in writing within {{letter.response_days}} days.',
      '',
      'Please acknowledge this letter to confirm you have received it.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'relieving',
    name: 'Relieving letter',
    country: '',
    language: 'en',
    needs_ack: false,
    body: [
      '# Relieving letter',
      '',
      '{{letter.date}}',
      '',
      'Dear {{employee.name}},',
      '',
      'This confirms that you are relieved from your duties as {{job.title}} with {{entity.legal_name}} at the close of business on {{separation.last_day}}.',
      '',
      'Your full and final settlement follows your settlement statement. We thank you for your contributions and wish you well.',
      '',
      '{{signer.name}}  ',
      '{{signer.title}}',
    ].join('\n'),
  },
  {
    kind: 'custom',
    name: '在職証明書',
    country: 'JP',
    language: 'ja',
    needs_ack: false,
    body: [
      '# 在職証明書',
      '',
      '{{letter.date}}',
      '',
      '{{employee.legal_name}} 殿',
      '',
      '{{entity.legal_name}}',
      '',
      '下記の者が当社に在職していることを証明します。',
      '',
      '- 氏名: {{employee.legal_name}}',
      '- 入社日: {{employment.start_day}}',
      '- 所属: {{job.department}}',
      '- 役職: {{job.title}}',
      '',
      '以上',
    ].join('\n'),
  },
  {
    kind: 'relieving',
    name: '退職証明書',
    country: 'JP',
    language: 'ja',
    needs_ack: false,
    body: [
      '# 退職証明書',
      '',
      '{{letter.date}}',
      '',
      '{{employee.legal_name}} 殿',
      '',
      '{{entity.legal_name}}',
      '',
      '以下の事実を証明します。',
      '',
      '- 使用期間: {{employment.start_day}} から {{employment.end_day}} まで',
      '- 業務の種類: {{job.title}}',
      '- 退職の事由: {{separation.reason_label}}',
      '',
      '以上',
    ].join('\n'),
  },
];

const EXIT_QUESTIONS = [
  { key: 'reason', label: 'What made you decide to leave?', type: 'choice', options: ['A better opportunity', 'Pay and benefits', 'Career growth', 'My manager', 'Work and life balance', 'Moving away', 'Personal reasons', 'Something else'] },
  { key: 'overall', label: 'How would you rate your time here overall?', type: 'rating' },
  { key: 'manager', label: 'How well did your manager support you?', type: 'rating' },
  { key: 'tools', label: 'Did you have the tools and training you needed?', type: 'yes_no' },
  { key: 'keep', label: 'What should we keep doing?', type: 'text' },
  { key: 'change', label: 'What should we change?', type: 'text' },
  { key: 'recommend', label: 'Would you recommend working here to a friend?', type: 'yes_no' },
  { key: 'return', label: 'Would you consider coming back one day?', type: 'yes_no' },
];

const GRIEVANCE_TYPES = [
  { code: 'harassment', name: 'Harassment', description: 'Unwanted conduct, including sexual harassment.', confidential: true },
  { code: 'discrimination', name: 'Discrimination', description: 'Unfair treatment because of who someone is.', confidential: true },
  { code: 'bullying', name: 'Bullying', description: 'Repeated behaviour meant to intimidate or belittle.', confidential: true },
  { code: 'retaliation', name: 'Retaliation', description: 'Being treated worse after raising a concern.', confidential: true },
  { code: 'safety', name: 'Health and safety', description: 'Unsafe work, conditions or equipment.', confidential: false },
  { code: 'pay', name: 'Pay and benefits', description: 'Pay, overtime, allowances or benefits.', confidential: false },
  { code: 'conditions', name: 'Working conditions', description: 'Hours, workload, schedules or the workplace.', confidential: false },
  { code: 'policy', name: 'Policy breach', description: 'A company policy or the law is not followed.', confidential: true },
  { code: 'other', name: 'Something else', description: '', confidential: true },
];

/** The tasks of a default template: the common list, then the country tasks, ordered by due offset. */
function templateTasks(kind, country) {
  const base = kind === 'onboarding' ? ONBOARDING : OFFBOARDING;
  const extra = (kind === 'onboarding' ? ONBOARDING_BY_COUNTRY : OFFBOARDING_BY_COUNTRY)[String(country || '').toUpperCase()] || [];
  const all = base.concat(extra).map((x, i) => Object.assign({ i: i }, x));
  all.sort((a, b) => a.due_offset_days - b.due_offset_days || a.i - b.i);
  return all.map((x) => {
    const o = Object.assign({}, x);
    delete o.i;
    return o;
  });
}

module.exports = {
  ONBOARDING: ONBOARDING,
  OFFBOARDING: OFFBOARDING,
  ONBOARDING_BY_COUNTRY: ONBOARDING_BY_COUNTRY,
  OFFBOARDING_BY_COUNTRY: OFFBOARDING_BY_COUNTRY,
  COUNTRY_NAMES: COUNTRY_NAMES,
  LETTERS: LETTERS,
  EXIT_QUESTIONS: EXIT_QUESTIONS,
  GRIEVANCE_TYPES: GRIEVANCE_TYPES,
  templateTasks: templateTasks,
};
