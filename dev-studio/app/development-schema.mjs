import { fileURLToPath } from "node:url";
import { relative, isAbsolute } from "node:path";
import {
  workspaceOperations,
  workspaceRunners,
} from "./workspace-operations.mjs";
import { workOperations, workRunners } from "./work-operations.mjs";
import { authority, trusted, safePath } from "./filesystem.mjs";
import { runtimeCall } from "./runtime.mjs";
import { requireHuman } from "./config.mjs";
const f = (name, type = "string", extra = {}) => ({
  name,
  type,
  readOnly: true,
  ...extra,
});
const entity = (module, summary, fields = []) => ({ module, summary, fields });
export const developmentEntities = {
  projects: entity(
    "workspace",
    "Real project folders and explicit execution trust.",
    [
      f("name"),
      f("root"),
      f("profile"),
      f("trusted", "boolean"),
      f("opened", "datetime"),
    ],
  ),
  files: entity(
    "workbench",
    "Pointers to actual files; contents stay on disk.",
    [
      f("project", "ref", { entity: "projects" }),
      f("path"),
      f("digest"),
      f("size", "number"),
    ],
  ),
  searches: entity("workbench", "Literal search and reviewed replacement."),
  repositories: entity(
    "changes",
    "Git inspection and explicit delivery actions.",
    [f("project", "ref", { entity: "projects" }), f("root")],
  ),
  checkpoints: entity("changes", "Recoverable previous file versions.", [
    f("project", "ref", { entity: "projects" }),
    f("path"),
    f("created", "datetime"),
  ]),
  reviews: entity("changes", "Isolated changes awaiting a human decision.", [
    f("work", "ref", { entity: "work" }),
    f("project", "ref", { entity: "projects" }),
    f("status"),
    f("files", "number"),
  ]),
  configs: entity(
    "execution",
    "Human-defined commands protected by private execution authority.",
    [
      f("project", "ref", { entity: "projects" }),
      f("name"),
      f("kind"),
      f("command"),
      f("cwd"),
    ],
  ),
  runs: entity(
    "execution",
    "Actual commands, logs, exit codes and source fingerprints.",
    [
      f("project", "ref", { entity: "projects" }),
      f("work", "ref", { entity: "work" }),
      f("name"),
      f("status"),
      f("started", "datetime"),
      f("exitCode", "number"),
      f("stale", "boolean"),
      f("output"),f("artifacts","json"),
    ],
  ),
  languages: entity("execution", "JS/TS and Python language-server queries."),
  debuggers: entity(
    "execution",
    "Owned Node inspector and Python debugpy sessions.",
    [f("project", "ref", { entity: "projects" }), f("path"), f("status")],
  ),
  work: entity("agents", "Goals, criteria and isolated agent attempts.", [
    f("project", "ref", { entity: "projects" }),
    f("title"),
    f("goal"),
    f("criteria"),
    f("mode"),
    f("delivery"),
    f("effort"),
    f("status"),
    f("task"),
    f("summary"),
    f("question"),f("revisions","json"),
  ]),
  attempts: entity(
    "agents",
    "Progress, questions, answers and execution outcomes.",
    [
      f("work", "ref", { entity: "work" }),
      f("status"),
      f("task"),
      f("summary"),
    ],
  ),
  connections: entity("agents", "Installed-agent and CraftBot connections."),
};
export const developmentOperations = [
  ...workspaceOperations,
  ...workOperations,
  {
    name: "language-query",
    module: "execution",
    entity: "languages",
    description:
      "Query real language diagnostics, completion, hover or definition.",
    params: {
      project: { type: "ref", entity: "projects", required: true },
      path: { type: "string", required: true, max: 1000 },
      text: { type: "string", required: false, max: 2097152 },
      action: {
        type: "enum",
        values: ["diagnostics", "completion", "hover", "definition"],
        required: true,
      },
      line: { type: "number" },
      character: { type: "number" },
    },
    readOnly: true,
    idempotent: true,
    destructive: false,
  },
  {
    name: "debug-start",
    module: "execution",
    entity: "debuggers",
    description: "Start a file with real breakpoints.",
    params: {
      project: { type: "ref", entity: "projects", required: true },
      path: { type: "string", required: true, max: 1000 },
      kind: { type: "enum", values: ["javascript", "python"], required: true },
      breakpoints: { type: "json" },
    },
    destructive: false,
  },
  {
    name: "debug-inspect",
    module: "execution",
    entity: "debuggers",
    description: "Read the current stack, locals and output.",
    params: {
      id: { type: "string", required: true, max: 100 },
      frame: { type: "number" },
    },
    readOnly: true,
    idempotent: true,
    destructive: false,
  },
  {
    name: "debug-control",
    module: "execution",
    entity: "debuggers",
    description: "Continue, step, pause or stop this debugger.",
    params: {
      id: { type: "string", required: true, max: 100 },
      action: {
        type: "enum",
        values: ["continue", "next", "stepIn", "stepOut", "pause", "stop"],
        required: true,
      },
    },
    destructive: false,
  },
];
export const developmentRunners = {
  ...workspaceRunners,
  ...workRunners,
  "language-query": async (args, ctx) => {
    requireHuman(ctx);
    const p = trusted(args.project);
    await safePath(p.root, args.path);
    const response = await runtimeCall("language-query", {
      ...args,
      text: args.text || "",
      root: p.root,
    });
    if (args.action === "definition") {
      const items = Array.isArray(response.result)
        ? response.result
        : [response.result];
      response.result = items.filter(Boolean).flatMap((i) => {
        try {
          const path = relative(p.root, fileURLToPath(i.uri || i.targetUri));
          if (isAbsolute(path) || path.startsWith("..")) return [];
          return [{ ...i, relativePath: path.replaceAll("\\", "/") }];
        } catch {
          return [];
        }
      });
    }
    return response;
  },
  "debug-start": async (args, ctx, { store }) => {
    requireHuman(ctx);
    const p = trusted(args.project);
    await safePath(p.root, args.path);
    if (args.breakpoints && !Array.isArray(args.breakpoints))
      throw new Error("Breakpoints must be line numbers.");
    const result = await runtimeCall("debug-start", {
      ...args,
      root: p.root,
      python: authority().preferences.python || "python",
    });
    store.put("debuggers", {
      id: result.id,
      project: p.id,
      path: args.path,
      status: result.status,
    });
    return result;
  },
  "debug-inspect": async (args, ctx) => {
    requireHuman(ctx);
    return runtimeCall("debug-state", args);
  },
  "debug-control": async (args, ctx) => {
    requireHuman(ctx);
    return runtimeCall("debug-control", args);
  },
};
