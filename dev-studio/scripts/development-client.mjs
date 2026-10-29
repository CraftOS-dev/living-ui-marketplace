// A small task-scoped A2App client. Server-side leases, CAS, trust and review
// authorization are unchanged; no direct project filesystem writes occur here.
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { operation, request } from "./client.mjs";

const allowed = new Set([
  "work-context",
  "project-tree",
  "file-read",
  "file-write",
  "run-start",
  "run-inspect",
  "run-stop",
  "work-progress",
  "work-question",
  "work-finish",
]);
export async function callDevelopment(work, name, args = {}) {
  if (!work || !allowed.has(name))
    throw Error("Choose a supported development operation and work id.");
  if (args.work && args.work !== work)
    throw Error("Request belongs to a different work item.");
  const scoped = ["run-inspect", "run-stop"].includes(name)
    ? args
    : { ...args, work };
  return operation(name, scoped);
}
export async function developmentContext(taskId) {
  const task = await request("/api/_a2app/tasks/" + taskId);
  const work = task.request?.payload?.work;
  if (!work || task.status !== "working") return null;
  const context = await callDevelopment(work, "work-context");
  const tree = await callDevelopment(work, "project-tree", { path: "" });
  const candidates = (tree.entries || [])
    .filter(
      (entry) =>
        entry.kind === "file" &&
        /^(?:package\.json|(?:main|index|app)(?:\.test|_test)?\.(?:[cm]?jsx?|tsx?|py)|test_main\.py)$/i.test(
          entry.name,
        ),
    )
    .slice(0, 4);
  const files = await Promise.all(
    candidates.map(async (entry) => {
      const doc = await callDevelopment(work, "file-read", {
        path: entry.path,
      });
      return { ...doc, text: doc.text?.slice(0, 12000) ?? null };
    }),
  );
  return { context, tree, files };
}
export async function runSavedCheck(work, config) {
  let run = await callDevelopment(work, "run-start", { config });
  const deadline = Date.now() + 610000;
  while (["running", "stopping"].includes(run.status)) {
    if (Date.now() > deadline)
      throw Error(
        "The saved check is still active; inspect or stop it before submitting.",
      );
    await new Promise((resolve) => setTimeout(resolve, 300));
    run = await callDevelopment(work, "run-inspect", { run: run.id });
  }
  return run;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const [work, command, input] = process.argv.slice(2);
  try {
    const raw = input?.startsWith("@")
      ? await readFile(input.slice(1), "utf8")
      : input;
    const args = raw ? JSON.parse(raw) : {};
    let result;
    if (command === "batch") {
      if (!Array.isArray(args) || args.length > 20)
        throw Error("A batch contains at most20 operations.");
      // Finish and question are separate user handoffs, never hidden in a batch.
      if (
        args.some((item) =>
          ["work-finish", "work-question"].includes(item.name),
        )
      )
        throw Error("Submit or ask a question separately after the batch.");
      result = [];
      for (const item of args)
        result.push(await callDevelopment(work, item.name, item.args));
    } else if (command === "test")
      result = await runSavedCheck(work, args.config);
    else result = await callDevelopment(work, command, args);
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(
      String(error.message).replace(/^Operation "[^"]+" threw:\s*/, ""),
    );
    process.exitCode = 1;
  }
}
