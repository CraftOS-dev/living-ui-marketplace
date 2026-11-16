/**
 * Diligence registrations (SPEC 4.2). Plain data.
 *
 *   deal.moved       a deal entering Diligence gets the checklist for its
 *                    round when it never had one (settings diligence.auto_apply);
 *                    your AI agent answers only when a person asks (dd.ask:
 *                    trigger diligence_answers, one for the deal; it reads
 *                    the room's scanned pages in the same run)
 *   record.merged    references and grid rows follow the record kept
 *   Next             one verify card per deal (and per grid) with the
 *                    proposed answers waiting
 *   search           grids by name (Ctrl K)
 */
module.exports = {
  on: {
    'deal.moved': 'lib_diligence.onDealMoved',
    'record.merged': 'lib_diligence.onMerged',
  },
  needsYou: 'lib_diligence.needsYou',
  triggers: {
    diligence_answers: {
      record: 'deals',
      param: 'deal_id',
      perm: 'diligence:edit',
      label: 'Answer diligence questions',
      description: "Your AI agent answers a deal's open diligence questions from its data room and public sources, every answer cited, for a person to confirm",
      fires: 'Ask your AI agent on a checklist, or saving or filling a comparison grid',
      cooldown: 10,
      deal: 'lib_diligence.dealSelf',
      nda: true,
      check: 'lib_diligence.askCheck',
      instruction:
        "Answer the open diligence questions of deal deal_id from its room, every answer cited. 1) dd.get --deal <deal_id> --state open; files.list --deal <deal_id>; read each file with files.text (scanned pages: read the picture from files.download and save it with pages.set-ocr first). 2) For each question find the answer in the room or a named public source; never from memory. 3) dd.answer --answers '[{\"question\",\"value\",\"unit\",\"num_kind\":\"quoted\",\"grade\",\"anchors\":[{\"file\",\"page\",\"lines\"}]}]' (up to 100 a call; never compute a figure: not_found with the inputs in the note). End with --rest_not_found \"<where you looked>\" --deal <deal_id>. Your answers wait for a person to confirm.",
    },
    refs_suggest: {
      record: 'deals',
      param: 'deal_id',
      perm: 'diligence:edit',
      label: 'Suggest reference names',
      description: "Your AI agent suggests back-channel references from the firm's own records: people who worked with a founder before",
      fires: 'Ask your AI agent on a deal\'s references',
      cooldown: 10,
      deal: 'lib_diligence.dealSelf',
      check: 'lib_diligence_refs.askCheck',
      instruction:
        "Suggest back-channel references for deal deal_id from the firm's own records only. 1) refs.candidates --deal <deal_id>: people in the records who worked at a founder's past company, with the overlap in days; refs.list --deal <deal_id> shows who is listed already. 2) Pick up to 10 who most likely worked with a founder (overlapping years, same team or a close title). 3) refs.suggest --deal <deal_id> --suggestions '[{\"person\",\"founder\",\"company\",\"why\":\"<shared company and years>\"}]' (marks it done). Never look people up elsewhere and never contact anyone.",
    },
    page_ocr: {
      record: 'files',
      param: 'file_id',
      perm: 'diligence:edit|pipeline:edit',
      label: 'Read scanned pages',
      description: 'Your AI agent reads the scanned pages of a file into its text layer, so they can be searched and cited',
      fires: 'Ask your AI agent on a file with scanned pages',
      cooldown: 10,
      deal: 'lib_diligence.fileDeal',
      nda: true,
      check: 'lib_diligence.ocrCheck',
      instruction:
        "Read the scanned pages of file file_id into its text layer. 1) files.get --file <file_id> (the pages that need OCR) and files.download --file <file_id> (the local path). Read each of those pages with your OCR or vision tools. 2) For each page: pages.set-ocr --file <file_id> --page <n> --words '[{\"text\",\"x0\",\"top\",\"x1\",\"bottom\"}]' in points from the page's top left, or --text with the page's lines when you have no word boxes (the first save marks it done). Transcribe what is on the page; never summarise or add. Leave a page you cannot read.",
    },
    grid_answers: {
      record: 'compare_grids',
      param: 'grid_id',
      perm: 'diligence:edit',
      label: 'Fill a comparison grid',
      description: 'Your AI agent answers the empty cells of a comparison grid for the companies without a data room, from public sources with links',
      fires: 'Saving or filling a comparison grid, or Ask your AI agent on a grid',
      cooldown: 10,
      check: 'lib_diligence_grid.askCheck',
      instruction:
        "Answer the empty cells of comparison grid grid_id for the companies without a data room, from public sources. 1) compare.get --grid <grid_id>: empty_cells lists company, column, question, type and unit. 2) Research each company from public sources (its site, filings, reputable press). 3) dd.answer --answers '[{\"grid\":\"<grid_id>\",\"company\",\"column\",\"value\",\"unit\",\"num_kind\":\"external\",\"grade\":\"public\",\"sources\":[\"<link>\"]}]' (marks it done); a cell no source answers: {\"grid\",\"company\",\"column\",\"not_found\":true,\"note\":\"<where you looked>\"}. Never invent or compute a figure.",
    },
  },
  timeline: 'lib_diligence.timelineFor',
  search: 'lib_diligence_grid.search',
  settingsKeys: { diligence: { auto_apply: true } },
};
