import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const EFFECTS = new Set(["read", "workspace_write", "external_write"]);

function fail(message) {
  throw new Error(message);
}

export function parseArgs(argv) {
  const values = { command: argv[0] || "help" };
  for (let index = 1; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) fail(`Unknown argument: ${token}`);
    const key = token.slice(2).replace(/-([a-z])/gu, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) values[key] = true;
    else {
      values[key] = next;
      index += 1;
    }
  }
  return values;
}

export function runCommand(command, args = [], options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...(options.env || {}) },
    encoding: "utf8",
    input: options.input,
    stdio: options.stream ? "inherit" : "pipe",
  });
  if (result.error) throw result.error;
  const normalized = {
    command: [command, ...args],
    code: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
  if (normalized.code !== 0 && !options.allowFailure) {
    fail(`${command} exited ${normalized.code}\n${normalized.stderr || normalized.stdout}`);
  }
  return normalized;
}

function atomicJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(temporary, file);
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

export function validateAdapter(adapter) {
  if (adapter?.schemaVersion !== 1 || !adapter.id) fail("Adapter schemaVersion=1 and id are required");
  if (!adapter.capabilities || !adapter.acceptance) fail("Adapter capabilities and acceptance are required");
  for (const [id, capability] of Object.entries(adapter.capabilities)) {
    if (!EFFECTS.has(capability.effect) || typeof capability.execute !== "function") {
      fail(`Invalid capability: ${id}`);
    }
  }
  for (const [id, acceptance] of Object.entries(adapter.acceptance)) {
    if (typeof acceptance.verify !== "function") fail(`Invalid acceptance check: ${id}`);
  }
  return adapter;
}

export function describeAdapter(adapter) {
  validateAdapter(adapter);
  return {
    schemaVersion: 1,
    adapter: adapter.id,
    title: adapter.title,
    capabilities: Object.entries(adapter.capabilities).map(([id, item]) => ({
      id,
      effect: item.effect,
      description: item.description,
      input: item.input || {},
    })),
    acceptance: Object.entries(adapter.acceptance).map(([id, item]) => ({
      id,
      description: item.description,
      input: item.input || {},
    })),
  };
}

function validatePlan(plan, adapter) {
  if (plan?.schemaVersion !== 1) fail("Plan schemaVersion must be 1");
  if (plan.adapter !== adapter.id) fail(`Plan adapter must be ${adapter.id}`);
  if (!plan.intent || !Array.isArray(plan.actions) || !Array.isArray(plan.acceptance)) {
    fail("Plan intent, actions, and acceptance are required");
  }
  plan.actions.forEach((action, index) => {
    if (!adapter.capabilities[action.capability]) fail(`Unknown action ${index}: ${action.capability}`);
    if (action.params !== undefined && (typeof action.params !== "object" || Array.isArray(action.params))) {
      fail(`Action ${index} params must be an object`);
    }
  });
  plan.acceptance.forEach((item, index) => {
    if (!adapter.acceptance[item.check]) fail(`Unknown acceptance ${index}: ${item.check}`);
  });
  return plan;
}

function assertAuthority(effect, options) {
  if (effect === "workspace_write" && !options.allowWorkspaceWrite) {
    fail("Plan requires --allow-workspace-write");
  }
  if (effect === "external_write" && !options.allowExternalWrite) {
    fail("Plan requires --allow-external-write");
  }
}

function evidencePath(adapter, options) {
  const root = path.resolve(options.evidenceDir || adapter.evidenceDirectory || ".task-evidence");
  return path.join(root, `${Date.now()}_${adapter.id.replace(/[^a-z0-9_-]/giu, "-")}.json`);
}

function createContext(adapter, evidence, persist, options) {
  return {
    adapter,
    options,
    run: runCommand,
    emit(type, detail = {}) {
      const event = { time: new Date().toISOString(), type, ...detail };
      evidence.events.push(event);
      persist();
      process.stdout.write(`[TASK_EVENT] ${JSON.stringify(event)}\n`);
      return event;
    },
  };
}

async function verifyItems(adapter, items, context) {
  const results = [];
  for (const item of items) {
    context.emit("acceptance.begin", { check: item.check });
    const result = await adapter.acceptance[item.check].verify(context, item.params || {});
    results.push({ check: item.check, result });
    context.emit("acceptance.complete", { check: item.check });
  }
  return results;
}

export async function executePlan(adapterInput, planInput, options = {}) {
  const adapter = validateAdapter(adapterInput);
  const plan = validatePlan(planInput, adapter);
  if (options.dryRun) {
    const effects = [...new Set(plan.actions.map((action) => adapter.capabilities[action.capability].effect))];
    return {
      schemaVersion: 1,
      status: "planned",
      adapter: adapter.id,
      intent: plan.intent,
      actions: plan.actions.map((action) => ({
        capability: action.capability,
        effect: adapter.capabilities[action.capability].effect,
        params: action.params || {},
      })),
      acceptance: plan.acceptance,
      requiredAuthorities: effects.filter((effect) => effect !== "read"),
    };
  }
  for (const action of plan.actions) assertAuthority(adapter.capabilities[action.capability].effect, options);

  const file = evidencePath(adapter, options);
  const evidence = {
    schemaVersion: 1,
    status: "running",
    adapter: adapter.id,
    intent: plan.intent,
    decisions: plan.decisions || [],
    startedAt: new Date().toISOString(),
    plan,
    actions: [],
    acceptance: [],
    events: [],
  };
  const persist = () => atomicJson(file, evidence);
  const context = createContext(adapter, evidence, persist, options);
  persist();
  try {
    for (const action of plan.actions) {
      const capability = adapter.capabilities[action.capability];
      context.emit("action.begin", { capability: action.capability, effect: capability.effect });
      const result = await capability.execute(context, action.params || {});
      evidence.actions.push({ capability: action.capability, effect: capability.effect, result });
      context.emit("action.complete", { capability: action.capability });
    }
    evidence.acceptance = await verifyItems(adapter, plan.acceptance, context);
    evidence.status = "complete";
    evidence.completedAt = new Date().toISOString();
    persist();
    return { evidence: file, result: evidence };
  } catch (error) {
    evidence.status = "failed";
    evidence.failedAt = new Date().toISOString();
    evidence.error = error.message;
    persist();
    error.evidence = file;
    throw error;
  }
}

export async function verifyOnly(adapterInput, items, options = {}) {
  const adapter = validateAdapter(adapterInput);
  const evidence = { events: [] };
  const context = createContext(adapter, evidence, () => {}, options);
  return await verifyItems(adapter, items, context);
}

async function loadAdapter(file) {
  const module = await import(`${pathToFileURL(path.resolve(file)).href}?v=${Date.now()}`);
  return validateAdapter(module.default);
}

function usage() {
  return `Generic task protocol\n\n` +
    `  taskctl schema\n` +
    `  taskctl capabilities --adapter <file>\n` +
    `  taskctl inspect --adapter <file> [--capability <id>]\n` +
    `  taskctl run --adapter <file> --plan <file> [--dry-run] [--allow-workspace-write] [--allow-external-write]\n` +
    `  taskctl verify --adapter <file> --check <id> [--params <json-file>]\n`;
}

function protocolSchema() {
  return {
    schemaVersion: 1,
    effects: {
      read: "No state change",
      workspace_write: "Changes only the selected local workspace; execution requires --allow-workspace-write",
      external_write: "Changes an external or production system; execution requires --allow-external-write",
    },
    plan: {
      schemaVersion: 1,
      adapter: "adapter id returned by capabilities",
      intent: "desired outcome",
      decisions: ["optional Agent reasoning or method choices"],
      actions: [{ capability: "capability id", params: {} }],
      acceptance: [{ check: "acceptance id", params: {} }],
    },
  };
}

export async function runCli(argv, defaults = {}) {
  const options = { ...defaults, ...parseArgs(argv) };
  if (options.command === "help" || options.help) {
    process.stdout.write(usage());
    return;
  }
  if (options.command === "schema") {
    process.stdout.write(`[TASK_PROTOCOL_SCHEMA]\n${JSON.stringify(protocolSchema(), null, 2)}\n`);
    return;
  }
  if (!options.adapter) fail("--adapter is required");
  const adapter = await loadAdapter(options.adapter);
  if (options.command === "capabilities") {
    process.stdout.write(`[TASK_CAPABILITIES]\n${JSON.stringify(describeAdapter(adapter), null, 2)}\n`);
    return;
  }
  if (options.command === "inspect") {
    const id = options.capability || adapter.defaultInspect;
    const capability = adapter.capabilities[id];
    if (!capability || capability.effect !== "read") fail("inspect requires a read capability");
    const evidence = { events: [] };
    const context = createContext(adapter, evidence, () => {}, options);
    const result = await capability.execute(context, {});
    process.stdout.write(`[TASK_INSPECT_OK]\n${JSON.stringify({ capability: id, result }, null, 2)}\n`);
    return;
  }
  if (options.command === "run") {
    if (!options.plan) fail("run requires --plan");
    const output = await executePlan(adapter, readJson(options.plan), options);
    const marker = options.dryRun ? "TASK_PLAN_OK" : "TASK_COMPLETE";
    process.stdout.write(`[${marker}]\n${JSON.stringify(output, null, 2)}\n`);
    return;
  }
  if (options.command === "verify") {
    const id = options.check || adapter.defaultAcceptance;
    if (!adapter.acceptance[id]) fail(`Unknown acceptance check: ${id}`);
    const params = options.params ? readJson(options.params) : {};
    const result = await verifyOnly(adapter, [{ check: id, params }], options);
    process.stdout.write(`[TASK_VERIFY_OK]\n${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  fail(`Unknown command: ${options.command}\n${usage()}`);
}
