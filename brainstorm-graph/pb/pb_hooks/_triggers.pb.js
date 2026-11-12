/// <reference path="../pb_data/types.d.ts" />
/**
 * COMPATIBILITY HOOKS (SYSTEM-OWNED — hash-locked; blueprint-pocketbase-kit).
 * The app→agent request queue, joined to the A2App task plane.
 *
 *   onBootstrap   ensure the `agent_requests` queue collection exists (the UI
 *                 kit fires into it and follows each row live)
 *   routerUse     the fire guard: declared name, params, cooldown, hourly cap,
 *                 status state machine (`_triggers_lib.js`)
 *   row created   → an A2App task (capability = the trigger's name, payload =
 *                 the row id + its params) that any harness can take with
 *                 `a2app <app> tasks next`, or be woken for by the bridge
 *   task moves    → the row follows: working → claimed, completed → done,
 *                 failed / canceled → rejected
 *
 * Handlers are one-liners: PocketBase runs each in an isolated VM.
 */

onBootstrap((e) => {
  e.next();
  try {
    try {
      $app.findCollectionByNameOrId("agent_requests");
      return;
    } catch (_e) {
      /* missing — create it */
    }
    let authRule = "";
    try {
      const manifest = JSON.parse(toString($os.readFile($filepath.join(__hooks, "..", "..", "manifest.json"))));
      if (String(manifest.authMode || "none") === "multi-user") authRule = '@request.auth.id != ""';
    } catch (_e) {
      authRule = "";
    }
    $app.save(
      new Collection({
        type: "base",
        name: "agent_requests",
        listRule: authRule,
        viewRule: authRule,
        createRule: authRule,
        updateRule: authRule,
        deleteRule: null,
        fields: [
          { name: "trigger", type: "text", required: true, max: 64 },
          { name: "params", type: "json" },
          { name: "status", type: "select", required: true, maxSelect: 1, values: ["pending", "claimed", "done", "rejected"] },
          { name: "fired_by", type: "select", required: true, maxSelect: 1, values: ["ui", "hook", "cli"] },
          { name: "claimed_by", type: "text", max: 120 },
          { name: "result", type: "text", max: 10000 },
          { name: "error", type: "text", max: 2000 },
          { name: "created", type: "autodate", onCreate: true },
          { name: "updated", type: "autodate", onCreate: true, onUpdate: true },
        ],
      }),
    );
    console.log("[triggers] agent_requests collection provisioned");
  } catch (err) {
    console.log("[triggers] could not provision agent_requests: " + err);
  }
});

routerUse((e) => require(`${__hooks}/_triggers_lib.js`).guardTriggerRequest(e));

// A row that LANDED: record the cooldown, then ask for the work as an A2App task.
onRecordAfterCreateSuccess((e) => {
  const trig = require(`${__hooks}/_triggers_lib.js`);
  const name = String(e.record.get("trigger"));
  try {
    trig.recordFire(name);
  } catch (err) {
    console.log("[triggers] cooldown bookkeeping failed: " + err);
  }
  try {
    let params = {};
    try {
      params = JSON.parse(e.record.getString("params") || "{}") || {};
    } catch (_e) {
      params = {};
    }
    const payload = Object.assign({}, params);
    payload[trig.REQUEST_FIELD] = String(e.record.id);
    require(`${__hooks}/_a2app_impl.js`).trigger(e.app, {
      type: name,
      capability: name,
      payload: payload,
      dedupKey: "agent_requests:" + e.record.id,
    });
  } catch (err) {
    // The row stays pending either way; a refused task never breaks the fire.
    console.log("[triggers] could not queue the task for " + name + ": " + err);
  }
  e.next();
}, "agent_requests");

// The row follows its task, so the UI's live request status keeps working.
onRecordAfterUpdateSuccess((e) => {
  try {
    let payload = {};
    try {
      payload = JSON.parse(e.record.getString("payload") || "{}") || {};
    } catch (_e) {
      payload = {};
    }
    const rowId = payload && payload.request ? String(payload.request) : "";
    if (rowId === "") return e.next();
    let row = null;
    try {
      row = e.app.findRecordById("agent_requests", rowId);
    } catch (_e) {
      row = null;
    }
    if (!row) return e.next();
    const status = e.record.getString("status");
    const current = row.getString("status");
    let claim = {};
    try {
      claim = JSON.parse(e.record.getString("claim") || "{}") || {};
    } catch (_e) {
      claim = {};
    }
    const by = String(claim.credentialId || "agent").slice(0, 120);
    if ((status === "working" || status === "input-required") && current === "pending") {
      row.set("status", "claimed");
      row.set("claimed_by", by);
      e.app.save(row);
    } else if (status === "completed" && (current === "pending" || current === "claimed")) {
      let result = {};
      try {
        result = JSON.parse(e.record.getString("result") || "{}") || {};
      } catch (_e) {
        result = {};
      }
      const text = typeof result.summary === "string" ? result.summary : JSON.stringify(result);
      if (current === "pending") row.set("claimed_by", by);
      row.set("status", "done");
      row.set("result", String(text).slice(0, 10000));
      e.app.save(row);
    } else if ((status === "failed" || status === "canceled") && (current === "pending" || current === "claimed")) {
      if (current === "pending") row.set("claimed_by", by);
      row.set("status", "rejected");
      row.set("error", String(e.record.getString("reason") || status).slice(0, 2000));
      e.app.save(row);
    }
  } catch (err) {
    console.log("[triggers] could not mirror the task onto its request: " + err);
  }
  return e.next();
}, "_a2app_tasks");
