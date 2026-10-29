import { operations, runners } from "./app/operations.mjs";
import {developmentEntities,developmentOperations,developmentRunners} from "./app/development-schema.mjs";
const ro = (name, type, extra = {}) => ({ name, type, readOnly: true, ...extra });
export const schema = {
  entities: {
    ...developmentEntities,
    proofs: { module: "workspace", summary: "Observed integration evidence; not simulated status.", fields: [
      ro("kind", "string"), ro("status", "enum", { values: ["passed", "failed", "blocked"] }), ro("details", "json"), ro("created", "datetime"),
    ] },
    requests: { module: "agents", summary: "One-use evidence reviews handed to a real harness.", fields: [
      { name: "title", type: "string", required: true, max: 160 }, ro("mode", "enum", { values: ["standalone", "craftbot"] }),
      ro("status", "enum", { values: ["queued", "passed", "blocked", "failed", "canceled"] }), ro("left", "number"), ro("right", "number"),
      ro("evidence", "ref", { entity: "proofs" }), ro("agentTask", "string"), ro("agent", "string"),
      ro("summary", "string", { max: 2000 }), ro("created", "datetime"), ro("finished", "datetime"),
    ] },
  },
  events: [{ type: "studio.review-requested" },{type:"studio.development-requested"}], operations:[...operations,...developmentOperations], operationRunners:{...runners,...developmentRunners},
};
