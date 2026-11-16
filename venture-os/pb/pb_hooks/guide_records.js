/**
 * app.guide section: records, deals, files and theses (kernel-records).
 * Plain data; no triggers of its own.
 */
module.exports = {
  title: 'Records, deals, files and theses',
  section: [
    'People and companies are the firm\'s global records. A person is found by email, a company by root domain (people.upsert, companies.upsert); a work email names the company, a free-mail address (gmail.com) never does. Without an email or a domain a record is matched by its exact name; several matches answer 409 with candidates: pass the id.',
    'Provenance: every field keeps who set it, when and from what (prov). You write new records and empty fields directly; give --source_ref (the link, file and page, or email) every time. A value a person entered is never overwritten by you: your different value becomes a proposal (people.update, companies.update, deals.update) and the answer names it. records.enrich --person|--company|--deal --fields \'{...}\' --source_ref fills only empty fields.',
    'Merges (people.merge, companies.merge) are proposals; records.dupes lists likely pairs; records.ignore-dupe marks a pair as different. A merged id keeps resolving to the record kept.',
    'Logos and team: a company\'s own logo is one PNG, JPG, WebP or SVG image of 2 MB at most; companies.logo-set --company <id> --paths \'["<absolute path of the image>"]\' --why "<where it came from>" is a proposal a person accepts (the image is kept with it), and only people remove a logo. Company reads carry logo_url and logo_domain; companies.logo gives you the image\'s local path. people.link --founder true marks a founder; people.unlink --person --company (a proposal for you) takes someone off a company.',
    'Deals: deals.list, deals.board (stages with stall flags), deals.get. deals.create opens a deal at the first stage (one open deal per company and pipeline). Moves (deals.move), updates (deals.update), the point partner (deals.assign) and the team (deals.team) are proposals for you; deals.people adds founders and contacts directly. You never advance, pass, hold, restrict or close a deal: when a person asks you to pass one, propose it with passes.request --deal --reason (a person accepts; then you draft the email for the pass_draft job).',
    'Restricted deals: you see one only when its team turned on agent_allowed; lists say hidden: n for the ones you may not see. Never read hidden as none.',
    'Files: files.list (a deal\'s room, a company, a person), files.get, files.download (you get the local path), files.upload --paths \'["<absolute path>"]\' (a same-named file becomes its next version), files.version, files.delete (a proposal). Text is read in the background: files.get shows text_state; files.text gives numbered lines; pages with needs_ocr wait for pages.set-ocr with your reading.',
    'NDA files open for you only while a person asked you about their deal (an NDA trigger in the last 24 hours: diligence_answers, page_ocr, memo_sections, bear_case). Each such read is logged. Never copy NDA text into another deal\'s records.',
    'Citations: anchors.create --file --page --lines "3-4" (or --quote "<exact words>") gives an anchor id to store with a fact, an answer or a memo block; anchors.resolve --anchors \'[...]\' --deal <deal> checks each is still valid and in that deal\'s citation scope (its own room or its company\'s files).',
    'Theses: theses.list, theses.keys (the fact vocabulary and operators), theses.fit --thesis --facts (met, unmet or unknown per criterion; unknown is not unmet; no score). Adding or changing a thesis (theses.save) is a proposal.',
  ],
  events: [
    'person.created { person }',
    'company.created { company }',
    'record.merged { kind, keep, drop }',
    'deal.created { deal, company, pipeline, stage }',
    'deal.moved { deal, from, to, pipeline }',
    'deal.closed { deal, status, reason }',
    'deal.reopened { deal, from }',
    'file.added { file, owner_collection, owner_id, deal, version }',
    'file.text_ready { file, text_state, ocr_pages, owner_collection, owner_id, deal }',
  ],
};
