#!/usr/bin/env node

import { runCli } from "./core.mjs";

try {
  await runCli(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[TASK_FAILED] ${error.message}\n`);
  if (error.evidence) process.stderr.write(`evidence=${error.evidence}\n`);
  process.exitCode = 1;
}

