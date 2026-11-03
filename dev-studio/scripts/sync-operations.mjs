import { writeFile } from "node:fs/promises";
import {schema} from "../a2app.schema.mjs";
const operations=schema.operations;
await writeFile(new URL("../operations.json", import.meta.url), JSON.stringify({ operations }, null, 2) + "\n");
