/// <reference path="../pb_data/types.d.ts" />
/**
 * Venture OS fix 7: specific triggers that wake your AI agent only when it
 * is worth it (pb_hooks/lib_wake.js).
 *
 * - `agent_jobs.trigger`: the trigger of the job's kind; your AI agent
 *   claims by it (jobs.next --trigger) and the app fires per trigger.
 * - `agent_jobs.source`: person (someone asked) or the Automatic work switch
 *   that started the job.
 * - `agent_jobs.status` gains `unanswered`: asked 24 hours ago and never
 *   claimed (Retry asks once more; nothing is asked again on its own).
 * - `settings.automatic`: the firm's Automatic work switches (all off).
 *
 * Existing jobs get their trigger; jobs still waiting were asked under the
 * old catch-all trigger and never picked up, so they become unanswered
 * (their people see Retry) and nothing fires when the app starts.
 */
migrate(
  (app) => {
    const TRIGGER_OF = {
      triage: 'deck_review',
      fetch_link: 'deck_review',
      brief: 'brief_requested',
      board_brief: 'brief_requested',
      dd_answers: 'diligence_requested',
      refs_suggest: 'diligence_requested',
      ocr: 'diligence_requested',
      pass_draft: 'draft_requested',
      intro_draft: 'draft_requested',
      memo_sections: 'draft_requested',
      bear_case: 'draft_requested',
      lp_letter: 'draft_requested',
      lp_questions: 'draft_requested',
      notice_review: 'draft_requested',
      note_review: 'notes_review',
      update_extract: 'portfolio_update',
      closing_extract: 'portfolio_update',
      mark_note: 'fund_review',
      reconcile: 'fund_review',
      research: 'research_requested',
      market_brief: 'research_requested',
      anti_portfolio: 'research_requested',
      radar_sweep: 'research_requested',
      map_refresh: 'research_requested',
      news_digest: 'news_review',
      news_insights: 'news_review',
      chat: 'question_asked',
      import_help: 'question_asked',
    };
    const jobs = app.findCollectionByNameOrId('agent_jobs');
    if (!jobs.fields.getByName('trigger')) jobs.fields.add(new TextField({ name: 'trigger', max: 40 }));
    if (!jobs.fields.getByName('source')) jobs.fields.add(new TextField({ name: 'source', max: 40 }));
    const status = jobs.fields.getByName('status');
    if (status.values.indexOf('unanswered') < 0) status.values = status.values.concat(['unanswered']);
    jobs.addIndex('idx_jobs_trigger', false, 'trigger, status', '');
    app.save(jobs);

    const settings = app.findCollectionByNameOrId('settings');
    if (!settings.fields.getByName('automatic')) settings.fields.add(new JSONField({ name: 'automatic', maxSize: 4000 }));
    app.save(settings);

    for (const kind of Object.keys(TRIGGER_OF)) app.db().newQuery('UPDATE agent_jobs SET trigger = {:t} WHERE kind = {:k}').bind({ t: TRIGGER_OF[kind], k: kind }).execute();
    app.db().newQuery("UPDATE agent_jobs SET source = 'person' WHERE requested_by != ''").execute();
    const now = new Date().toISOString();
    app
      .db()
      .newQuery("UPDATE agent_jobs SET status = 'unanswered', error = {:e}, done_at = {:n} WHERE status = 'queued' OR status = 'asked'")
      .bind({ e: "Your AI agent hasn't picked this up.", n: now })
      .execute();
  },
  (app) => {
    app.db().newQuery("UPDATE agent_jobs SET status = 'cancelled' WHERE status = 'unanswered'").execute();
    const jobs = app.findCollectionByNameOrId('agent_jobs');
    jobs.removeIndex('idx_jobs_trigger');
    if (jobs.fields.getByName('trigger')) jobs.fields.removeByName('trigger');
    if (jobs.fields.getByName('source')) jobs.fields.removeByName('source');
    const status = jobs.fields.getByName('status');
    status.values = status.values.filter((v) => v !== 'unanswered');
    app.save(jobs);
    const settings = app.findCollectionByNameOrId('settings');
    if (settings.fields.getByName('automatic')) settings.fields.removeByName('automatic');
    app.save(settings);
  },
);
