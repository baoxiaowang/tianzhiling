#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath } from "node:url";
import { runCli } from "../tools/task-protocol/core.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

try {
  await runCli(process.argv.slice(2), {
    adapter: path.join(root, "task-adapters", "production-operations.mjs"),
  });
} catch (error) {
  process.stderr.write(`[TASK_FAILED] ${error.message}\n`);
  if (error.evidence) process.stderr.write(`evidence=${error.evidence}\n`);
  process.exitCode = 1;
}

