import assert from "node:assert/strict";
import { describeAdapter, executePlan, parseArgs } from "./core.mjs";

const calls = [];
const adapter = {
  schemaVersion: 1,
  id: "fixture",
  title: "Fixture",
  capabilities: {
    inspect: { effect: "read", description: "read", execute: async () => ({ ok: true }) },
    change: { effect: "workspace_write", description: "write", execute: async () => calls.push("change") },
  },
  acceptance: {
    done: { description: "done", verify: async () => ({ ok: true }) },
  },
};

assert.deepEqual(parseArgs(["run", "--dry-run", "--plan", "a.json"]), {
  command: "run",
  dryRun: true,
  plan: "a.json",
});
assert.equal(describeAdapter(adapter).capabilities[1].effect, "workspace_write");

const plan = {
  schemaVersion: 1,
  adapter: "fixture",
  intent: "test",
  actions: [{ capability: "change", params: {} }],
  acceptance: [{ check: "done", params: {} }],
};
const dry = await executePlan(adapter, plan, { dryRun: true });
assert.equal(dry.status, "planned");
assert.equal(calls.length, 0);

let denied = false;
try {
  await executePlan(adapter, plan, {});
} catch {
  denied = true;
}
assert.equal(denied, true);
process.stdout.write("[TASK_PROTOCOL_SELF_TEST_OK]\n");
