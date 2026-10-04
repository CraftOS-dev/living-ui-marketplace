/// <reference path="../pb_data/types.d.ts" />
/**
 * Generic record verbs: delete (with a preview of everything the delete
 * takes along) and the operating guide for agents.
 */

// Delete one record. preview=true shows what would go and what would lose a link; nothing changes.
routerAdd('POST', '/api/ops/records/delete', (e) => {
  const u = require(`${__hooks}/lib_util.js`);
  const o = require(`${__hooks}/lib_ops.js`);
  const R = require(`${__hooks}/lib_records.js`);
  const body = u.body(e);
  const coll = R.canonical(body.collection);
  const preview = o.bool(body.preview);
  // The preview names the record and what hangs off it, so it needs the same role as the delete.
  const level = coll === '' ? 'auth' : R.DELETABLE[coll];
  return o.handle(e, level, (b, ctx) => {
    if (coll === '') {
      throw u.err(
        'Unknown collection "' + String(b.collection || '') + '". Use one of: ' + Object.keys(R.DELETABLE).join(', ') + '.',
        '不明なコレクション「' + String(b.collection || '') + '」です。使用できるもの：' + Object.keys(R.DELETABLE).join('、') + '。',
      );
    }
    const L = R.LABEL[coll] || [coll, coll, coll];
    const rec = o.need(e.app, coll, b.id, L[0].charAt(0).toUpperCase() + L[0].slice(1), L[2]);
    if (coll === 'users') {
      if (rec.id === ctx.actor) throw u.err('You cannot delete your own account.', '自分のアカウントは削除できません。');
      if (rec.getString('role') === 'admin' && u.findMany(e.app, 'users', 'role = "admin"', '', 2).length < 2) {
        throw u.err('This is the only administrator and cannot be removed.', '唯一の管理者のため削除できません。');
      }
    }
    const desc = R.describe(e.app, coll, rec);
    if (preview) return Object.assign({ preview: true, deleted: false }, desc);
    const snapshot = u.plain(rec);
    e.app.delete(rec);
    u.audit(e.app, ctx.actor, 'delete', coll, desc.id, desc.label, { deleted: snapshot, also_deleted: desc.also_deletes.map((x) => x.collection + ':' + x.count) }, o.str(b.reason));
    return Object.assign({ preview: false, deleted: true }, desc);
  });
});

// How to operate this app from the CLI: conventions and recipes for the common jobs.
routerAdd('POST', '/api/ops/app/guide', (e) =>
  require(`${__hooks}/lib_ops.js`).handle(e, 'auth', () => ({
    app: 'Entertainment IP Manager',
    conventions: [
      'Every *_id param (and subject_id, id) takes the record id, its reference (AG-0002, PR-0001, TM-0001-JP, EC-0001, FP-0001), an office number for trademarks, or its exact name ("Hikari", "Luna Hoshino"). Ambiguous names return the candidates with their ids.',
      'Dates are YYYY-MM-DD. Lists take JSON (["JP","US"]) or comma-separated text (JP,US). Objects take JSON. Booleans take true or false.',
      'Errors come back as { error, error_ja }. Nothing an operation refuses is changed.',
      'Ops apply the app\'s rules (deadline rules, conflicts, approvals, money). Use `agent-app data` only to create or edit plain records; the server still validates them and derives refs and deadlines.',
      'Anything read from a document, email or web page goes to people through inbox.propose, never straight into records.',
      'Destructive ops (marked !) need the user\'s go-ahead; run records.delete with --preview true first and show the user what it takes along.',
    ],
    recipes: [
      { task: 'Find a record by any name or number', run: 'run portfolio.search --q "Hikari"' },
      { task: 'Look up allowed values (event codes, modules, offices, reports)', run: 'run meta' },
      { task: 'Rights dimension codes (territory, media, category, channel, platform)', run: 'run rights.dimensions' },
      { task: 'Create a franchise, title, character, talent, song or agreement', run: 'data <project> characters create --name "Hikari" --kind anime_character --franchise "Starlight Drive"' },
      { task: 'Record what happened on any record (filing, registration, office letter, licence signed, graduation, counter-notice)', run: 'run events.preview --subject_type matter --subject_id "TM-0001-JP" --code REGISTERED --date 2026-10-01, then the same with events.record' },
      { task: 'Deadlines due soon', run: 'run deadlines.upcoming --days 30 --include_overdue true' },
      { task: 'Why a deadline has its date', run: 'run deadlines.explain --id <deadline id>' },
      { task: 'Close a deadline', run: 'run deadlines.close --ids <deadline id> --status done' },
      { task: 'Can we use a character for a product somewhere?', run: 'run rights.can-we --assets "character:Hikari" --columns "JP,US,CN,TW" --filters \'{"media":["MERCHANDISE"],"category":["ACRYLIC"]}\' --start 2027-01-01 --end 2027-12-31' },
      { task: 'Who decides a use for a committee title', run: 'run committees.who-decides --committee_id "Starlight Drive Committee" --use \'{"media":["GAMES"],"territory":["JP"]}\'' },
      { task: 'A character\'s rights stack and its problems', run: 'run characters.chain --character_id "Hikari"' },
      { task: 'Submit a product stage for approval, then decide it', run: 'run products.submit-approval --product_id "PR-0001" --stage design; run approvals.decide --approval_id <id> --decision approved' },
      { task: 'Put a licensee\'s sales into a statement', run: 'run royalties.add-lines --report_id <id> --lines \'[{"product_id":"PR-0001","manufactured_qty":1000,"sold_qty":800,"retail_price":1650}]\'' },
      { task: 'Import a trademark from its office, or add one by hand', run: 'run matters.import-office --jurisdiction JP --number 2024-012345; or data matters create ... then events.record FILED' },
      { task: 'Renewals to decide and instruct', run: 'run reports.run --report renewal_decisions --lang en; run renewals.decide --ids <renewal id> --decision renew' },
      { task: 'Plan a talent\'s graduation', run: 'run talents.lifecycle --talent_id "Luna Hoshino" --code GRADUATION_SCHEDULED --graduation_date 2026-12-20 --preview true, then without --preview' },
      { task: 'Can a talent stream this game or song?', run: 'run talents.pre-stream-check --talent_id "Luna Hoshino" --title "Game X" --platform YOUTUBE --monetization "ads,super_chat"' },
      { task: 'Draft a takedown notice (never sent by the app)', run: 'run cases.draft-notice --case_id "EC-0001" --forum jp_platform --preview true' },
      { task: 'Propose something for people to review', run: 'run inbox.propose --kind agent_proposal --title "..." --subject_type agreement --subject_id "AG-0002" --proposal \'{"extra_deadlines":[{"title":"Send the countersigned copy","due_date":"2026-10-15","kind":"internal"}]}\'' },
      { task: 'Delete a record (after the user agrees)', run: 'run records.delete --collection character --id "Hikari" --preview true; then the same without --preview' },
      { task: 'Run a report', run: 'run reports.run --report agreements_expiring --params \'{"days":90}\' --lang en' },
    ],
  })),
);
