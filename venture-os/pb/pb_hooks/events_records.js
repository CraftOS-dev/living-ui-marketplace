/**
 * kernel-records registrations (SPEC 4.2): the Ctrl-K search provider for
 * people, companies, deals and files, and this module's part of every
 * record's timeline. The CSV import mappers for people and companies belong
 * to network.
 *
 * Events kernel-records emits (payloads are ids):
 *   person.created  { person }
 *   company.created { company }
 *   record.merged   { kind: 'people' | 'companies', keep, drop }   (inside the merge: re-point your rows to keep)
 *   deal.created    { deal, company, pipeline, stage }
 *   deal.moved      { deal, from, to, pipeline }
 *   deal.closed     { deal, status, reason }   (every status but open: invested, passed, lost, hold)
 *   file.added      { file, owner_collection, owner_id, deal, version }
 *   file.text_ready { file, text_state, ocr_pages, owner_collection, owner_id, deal }   (once per version when its text step ends)
 */
module.exports = {
  on: {},
  search: 'lib_records.search',
  timeline: 'lib_records.timelineFor',
};
