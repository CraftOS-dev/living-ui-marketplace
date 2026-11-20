/**
 * Kernel subscriptions (SPEC 3.4). The kernel handles one approval kind:
 * bank_account (a new bank account becomes active when a payroll
 * administrator approves it with their PIN).
 *
 * Kernel events other modules can subscribe to:
 *   entity.created       { entity, country, region }
 *   employment.hired     { employment, employee, entity, start_day, from_application }
 *   employment.changed   { employment, kind: 'job' | 'pay' | 'tax', record, effective_from, edited }
 *   employment.ended     { employment, employee, entity, end_day, reason }
 *   employee.updated     { employee, fields }
 *   bank_account.approved { bank_account, employee }
 *   member.linked        { member, employee }
 *   record.editing       { collection, id, employment, effective_from }  (return { block: '<reason>' } to refuse an Edit)
 */
module.exports = {
  on: {},
  approvals: { bank_account: 'lib_people.onBankDecision' },
};
