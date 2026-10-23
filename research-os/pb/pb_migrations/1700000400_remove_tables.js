/// <reference path="../pb_data/types.d.ts" />
/**
 * The user removed project tables (2026-10-22): the four table collections
 * go, and so does everything that pointed at them: their Activity entries
 * (their undo handlers are gone), proposals and field marks for them, task
 * links to a table, and the daily cap on table cells.
 */
migrate((app) => {
  const run = (sql) => app.db().newQuery(sql).execute();
  run("DELETE FROM activity WHERE target IN ('grids', 'grid_rows', 'grid_columns', 'grid_cells') OR op LIKE 'tables.%' OR (CASE WHEN json_valid(data) THEN json_extract(data, '$.undo.fn') END) LIKE 'lib_grids.%'");
  run("DELETE FROM proposals WHERE op LIKE 'tables.%'");
  run("DELETE FROM field_marks WHERE target = 'grid_cells'");
  run(
    "UPDATE tasks SET links = (SELECT json_group_array(json(value)) FROM json_each(tasks.links) WHERE json_extract(value, '$.kind') != 'table') " +
      "WHERE json_valid(links) AND EXISTS (SELECT 1 FROM json_each(tasks.links) WHERE json_extract(value, '$.kind') = 'table')",
  );
  run("UPDATE settings SET agent_policy = json_remove(agent_policy, '$.cell_cap') WHERE json_valid(agent_policy)");
  for (const name of ['grid_cells', 'grid_rows', 'grid_columns', 'grids']) app.delete(app.findCollectionByNameOrId(name));
});
