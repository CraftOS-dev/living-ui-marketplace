/// <reference path="../pb_data/types.d.ts" />
/**
 * Life OS seed: the one settings row, the ten areas of life (all on; the
 * first run lets a person switch off what is not theirs) and the three
 * routines that ask your AI agent, switched off until the person turns
 * them on. No goals, habits, people or tasks: nothing to clear away.
 */
migrate(
  (app) => {
    const settings = new Record(app.findCollectionByNameOrId('settings'));
    settings.set('owner_name', '');
    settings.set('onboarded', false);
    settings.set('day_starts_hour', 4);
    settings.set('week_starts_on', 'monday');
    settings.set('units', 'metric');
    settings.set('currency', 'USD');
    settings.set('month_budget', 0);
    settings.set('news_topics', ['top', 'world', 'business', 'technology', 'health', 'science']);
    settings.set('water_goal', 8);
    settings.set('sleep_goal', 8);
    settings.set('steps_goal', 8000);
    settings.set('reflections_to_agent', 'when_shared');
    settings.set('agent_autonomy', 'as_designed');
    settings.set('quiet_start', '22:00');
    settings.set('quiet_end', '07:00');
    settings.set('calendar_enabled', false);
    settings.set('calendar_id', 'primary');
    settings.set('calendar_state', 'off');
    app.save(settings);

    const areas = app.findCollectionByNameOrId('areas');
    ['health', 'money', 'relationships', 'work', 'home', 'growth', 'fun', 'mind'].forEach((kind, i) => {
      const r = new Record(areas);
      r.set('kind', kind);
      r.set('enabled', true);
      r.set('rank', i + 1);
      app.save(r);
    });

    const routines = app.findCollectionByNameOrId('routines');
    const R = [
      { kind: 'morning_note', time: '07:30', days: [0, 1, 2, 3, 4, 5, 6] },
      { kind: 'evening_checkin', time: '21:00', days: [0, 1, 2, 3, 4, 5, 6] },
      { kind: 'weekly_recap', time: '18:00', days: [0] },
    ];
    for (const x of R) {
      const r = new Record(routines);
      r.set('kind', x.kind);
      r.set('enabled', false);
      r.set('time', x.time);
      r.set('days', x.days);
      app.save(r);
    }
  },
  (app) => {
    for (const name of ['routines', 'areas', 'settings']) {
      app.findRecordsByFilter(name, '', '', 0, 0).forEach((r) => app.delete(r));
    }
  },
);
