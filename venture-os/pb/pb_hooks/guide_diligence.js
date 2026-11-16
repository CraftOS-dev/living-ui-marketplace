/**
 * app.guide section and the full recipes of its triggers: diligence
 * (checklists, cited answers, references, comparison grids, OCR). Plain
 * data.
 */
module.exports = {
  title: 'Diligence: checklists, cited answers, references, grids',
  section: [
    'A deal in diligence has a checklist (dd.get --deal): questions by area (team, market, product, traction, financials, legal, technology, customers), each typed text, number (with a unit: a currency, %, or a word), yes_no or date. dd.template-apply adds a checklist; dd.questions-save adds questions (a proposal for you).',
    'You answer; people confirm. dd.answer saves your answers as proposed: a person confirms or rejects each with one click while reading the quote. You never confirm or reject, and you never re-propose a value a person rejected (rejected_before in the answer).',
    'Every answer you give cites: anchors (anchors.create on the deal\'s room files, or files of its company) or public source links. Your numbers carry num_kind quoted (on the page) or external (a public source); you never compute one (a derived figure such as runway: answer not_found with the inputs and their pages in the note). Grade each: artifact (a document proves it), founder_reported (the founders say it), public, unverifiable, unknown.',
    'Citation scope: an answer cites only its own deal\'s room, its company\'s files and named public sources; never another deal\'s files. NDA files open only while a person asked you about that deal (diligence_answers or page_ocr, for 24 hours).',
    'References: refs.list, refs.candidates (people in the firm\'s records who worked at a founder\'s past company), refs.suggest (names for people to call), refs.log (a call a person described in a note). You never contact a reference.',
    'Comparison grids: compare.get --grid (companies by questions, each cell an answer). A company with a room is answered through its deal\'s questions; a company without one through dd.answer with grid, company and column, from public sources.',
  ],
  events: [],
  diligence_answers: [
    'Answer a deal\'s open diligence questions (trigger diligence_answers { deal_id }).',
    '1) dd.get --deal <deal_id> --state open. files.list --deal <deal_id> shows the room; read each file with files.text --file <id>. Pages needing OCR: read the page picture from files.download with your vision tools and save it with pages.set-ocr first.',
    '2) For each open question find the answer in the room, or in a named public source (the company\'s site, a filing, a reputable article). Cite every passage you use inline in the answer: anchors [{"file":"<id>","page":<n>,"lines":"3-4"}] (or "quote":"<exact words>"); the app anchors it in the same call (anchors.create --passages makes several ahead when you need their ids). Never answer from memory or guesswork.',
    '3) dd.answer --answers \'[{"question":"<id>","value":"1200000","unit":"USD","num_kind":"quoted","grade":"founder_reported","anchors":[{"file":"<id>","page":4,"lines":"7"}]}]\'. Amounts are plain numbers in the currency you name (no k or M); percents as 12.5 with unit "%"; yes_no as yes or no; dates as YYYY-MM-DD. num_kind is quoted (with anchors) or external (with its source link), never computed: a figure the sources do not state (runway, growth) is not_found with its inputs in the note. A question the room and public sources do not answer: {"question":"<id>","not_found":true,"note":"<where you looked>"}, or add --rest_not_found "<where you looked>" --deal <deal_id> to check every other open question at once. Send up to 100 at a time; a refusal names each bad item: fix those and send again.',
    '4) Your first answers mark the ask done. Grade by what the source proves: a deck claim is founder_reported, a signed document or statement is artifact. Never confirm an answer and never judge the founders\' personal traits. When the room cannot be read at all: agent.cannot --trigger diligence_answers --record <deal_id> --reason "<why>".',
  ],
  grid_answers: [
    'Answer the empty cells of a comparison grid for the companies without a data room, from public sources (trigger grid_answers { grid_id }).',
    '1) compare.get --grid <grid_id>: empty_cells lists company, company_name, domain, column, text, type and unit.',
    '2) Research each company from public sources and answer with dd.answer --answers \'[{"grid":"<grid_id>","company":"<id>","column":"<key>","value","unit","num_kind":"external","sources":["<link>"],"grade":"public"}]\'; a cell no source answers: {"grid","company","column","not_found":true,"note":"<where you looked>"}.',
    '3) Your first answers mark the ask done. Never invent or compute a figure.',
  ],
  refs_suggest: [
    'Suggest back-channel references for a deal (trigger refs_suggest { deal_id }).',
    '1) refs.candidates --deal <deal_id>: people in the firm\'s own records who worked at a founder\'s past company, with the overlap in days (null when dates are missing). refs.list --deal <deal_id> shows who is already listed.',
    '2) Pick up to 10 who most likely worked with a founder (overlapping years, same team or a close title). Use only the firm\'s records; never look people up elsewhere and never contact anyone.',
    '3) refs.suggest --deal <deal_id> --suggestions \'[{"person":"<id>","founder":"<founder id>","company":"<company id>","why":"<shared company and years, one line>"}]\' (marks the ask done).',
    '4) With no candidates (no founders on record, or no shared companies): agent.cannot --trigger refs_suggest --record <deal_id> --reason "<which>".',
  ],
  page_ocr: [
    'Read the scanned pages of a file into its text layer (trigger page_ocr { file_id }).',
    '1) files.get --file <file_id> and files.download --file <file_id> (the local path); files.text --file <file_id> names the pages that need OCR. Read each of those pages with your OCR or vision tools.',
    '2) pages.set-ocr --file <file_id> --page <n> --words \'[{"text","x0","top","x1","bottom"}]\' in points from the page\'s top left, or --text with the page\'s lines when you have no word boxes. Transcribe what is on the page; never summarise or add. The first page you save marks the ask done.',
    '3) A page you cannot read: leave it. When no page can be read: agent.cannot --trigger page_ocr --record <file_id> --reason "<why>".',
  ],
};
