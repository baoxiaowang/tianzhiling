import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HOST = process.env.TZL_DEPLOY_HOST || "tzl_deploy@1.13.18.200";
const HEALTH = {
  public: process.env.TZL_PUBLIC_HEALTH || "https://tianzhiling.chat/api/system/health",
  admin: process.env.TZL_ADMIN_HEALTH || "https://admin.tianzhiling.chat/admin_api/system/health",
};
const SERVICES = ["tzl_node", "tzl_admin_node", "tzl_admin_web", "tzl_nginx"];

function fail(message) {
  throw new Error(message);
}

function lines(value) {
  return String(value || "").split(/\r?\n/u).map((line) => line.trim()).filter(Boolean);
}

function cleanGatewayOutput(value) {
  return lines(value).filter((line) => !/^(bash|\/bin\/sh): warning: setlocale:/u.test(line)).join("\n");
}

function sshArgs(command) {
  const args = ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15"];
  const hostDefault = path.join(os.homedir(), ".ssh", "id_ed25519_tianzhiling_deploy_20260802");
  const identity = process.env.TZL_DEPLOY_IDENTITY || (fs.existsSync(hostDefault) ? hostDefault : null);
  if (identity) args.push("-i", identity.replace(/^~(?=\/)/u, os.homedir()));
  return [...args, HOST, ...command];
}

function ssh(context, command, options = {}) {
  return context.run("ssh", sshArgs(command), options);
}

function fullCommit(value, label) {
  if (!/^[0-9a-f]{40}$/u.test(String(value || ""))) fail(`${label} must be a full commit`);
  return value;
}

function parseStatus(output) {
  const main = output.match(/branch=([^ ]+) commit=([0-9a-f]{40}) dirty_count=(\d+)/u);
  const runtime = output.match(/container=([^ ]+) restarts=(\d+) oom=([^ ]+) pm2_online=(\d+)/u);
  const image = output.match(/^image=(sha256:[0-9a-f]+)$/mu);
  if (!main || !runtime || !image) fail("Cannot parse production status");
  return {
    healthy: true,
    branch: main[1],
    commit: main[2],
    dirtyCount: Number(main[3]),
    container: runtime[1],
    restarts: Number(runtime[2]),
    oom: runtime[3] === "true",
    pm2Online: Number(runtime[4]),
    image: image[1],
  };
}

function inspectProduction(context) {
  const result = ssh(context, ["status"], { allowFailure: true });
  const raw = cleanGatewayOutput(`${result.stdout}${result.stderr}`);
  if (result.code !== 0) {
    if (raw.includes("[STATUS_FAIL]")) return { healthy: false, reason: raw };
    fail(`Production status transport failed (${result.code}): ${raw}`);
  }
  return parseStatus(result.stdout);
}

function parseLogScan(output) {
  const match = output.match(/\[ERROR_SCAN_OK\]\s+window_minutes=(\d+)\s+matched_lines=(\d+)/u);
  if (!match) fail("Cannot parse production log scan");
  return { windowMinutes: Number(match[1]), matchedLines: Number(match[2]) };
}

function classify(files) {
  const suggested = new Set();
  const unknown = [];
  for (const file of files) {
    if (/\.md$/u.test(file) || /(^|\/)(test|tests|docs?|reports?)(\/|$)/u.test(file) || file === "AGENTS.md" || file.startsWith("apps/weapp/")) continue;
    if (file.startsWith("apps/node/")) suggested.add("tzl_node");
    else if (file.startsWith("apps/admin-node/")) suggested.add("tzl_admin_node");
    else if (file.startsWith("apps/admin/")) suggested.add("tzl_admin_web");
    else if (file.startsWith("apps/gateway/")) suggested.add("tzl_nginx");
    else if (file.startsWith("packages/entities/")) {
      suggested.add("tzl_node");
      suggested.add("tzl_admin_node");
    } else if (file.startsWith("packages/shared/")) {
      suggested.add("tzl_node");
      suggested.add("tzl_admin_node");
      suggested.add("tzl_admin_web");
    } else unknown.push(file);
  }
  return { files, suggestedTargets: SERVICES.filter((item) => suggested.has(item)), unknown };
}

const BUILD_TARGETS = {
  entities: ["pnpm", ["--filter", "./packages/entities", "build"]],
  shared: ["pnpm", ["--filter", "./packages/shared", "build"]],
  node: ["pnpm", ["--filter", "./apps/node", "build"]],
  "admin-node": ["pnpm", ["--filter", "./apps/admin-node", "build"]],
  "admin-web": ["pnpm", ["--filter", "./apps/admin", "build"]],
};

async function verifyProduction(context, params) {
  const status = inspectProduction(context);
  if (!status.healthy) fail(status.reason || "Production is unhealthy");
  if (params.expectedCommit && status.commit !== fullCommit(params.expectedCommit, "expectedCommit")) {
    fail(`Production commit ${status.commit} does not match ${params.expectedCommit}`);
  }
  if (status.dirtyCount !== 0 || status.container !== "running" || status.restarts !== 0 || status.oom || status.pm2Online !== 4) {
    fail("Production runtime invariants failed");
  }
  const minutes = Number(params.logMinutes || 10);
  const logResult = ssh(context, ["logs", String(minutes)]);
  const logScan = parseLogScan(logResult.stdout);
  if (logScan.matchedLines !== 0) fail(`Production has ${logScan.matchedLines} fatal log matches`);
  const health = {};
  for (const [name, url] of Object.entries(HEALTH)) {
    const response = context.run("curl", ["-fsS", "--max-time", "20", url]);
    const payload = JSON.parse(response.stdout);
    if ((payload.data || payload).status !== "ok") fail(`${name} health failed`);
    health[name] = "ok";
  }
  return { status, logScan, health };
}

export default {
  schemaVersion: 1,
  id: "tianzhiling.production-operations",
  title: "天之灵生产操作能力",
  evidenceDirectory: path.join(REPO, ".task-evidence"),
  defaultInspect: "production.inspect",
  defaultAcceptance: "production.runtime",
  capabilities: {
    "production.inspect": {
      effect: "read",
      description: "读取当前生产身份与运行健康；不改变生产。",
      execute: async (context) => inspectProduction(context),
    },
    "production.progress": {
      effect: "read",
      description: "读取发布阶段；旧网关自动回退到状态和日志。",
      execute: async (context, params) => {
        const direct = ssh(context, ["progress"], { allowFailure: true });
        if (direct.code === 0 && /^(state|phase)=/mu.test(direct.stdout)) return { protocol: "phase", raw: direct.stdout.trim() };
        const status = inspectProduction(context);
        const logs = ssh(context, ["logs", String(params.minutes || 10)], { allowFailure: true });
        return { protocol: "fallback", status, logs: cleanGatewayOutput(`${logs.stdout}${logs.stderr}`) };
      },
    },
    "changes.inspect": {
      effect: "read",
      description: "返回提交差异和建议服务范围；建议不约束 Agent 的最终策略。",
      input: { base: "40-hex commit", target: "40-hex commit" },
      execute: async (context, params) => {
        const base = fullCommit(params.base, "base");
        const target = fullCommit(params.target, "target");
        const result = context.run("git", ["diff", "--name-only", `${base}..${target}`], { cwd: REPO });
        return { base, target, ...classify(lines(result.stdout)) };
      },
    },
    "workspace.build": {
      effect: "workspace_write",
      description: "运行 Agent 选择的命名构建目标；这是一种可选策略。",
      input: { targets: Object.keys(BUILD_TARGETS) },
      execute: async (context, params) => {
        if (!Array.isArray(params.targets) || !params.targets.length) fail("targets are required");
        for (const target of params.targets) {
          const command = BUILD_TARGETS[target];
          if (!command) fail(`Unknown build target: ${target}`);
          context.run(command[0], command[1], { cwd: REPO, stream: true });
        }
        return { targets: params.targets, status: "passed" };
      },
    },
    "production.deploy": {
      effect: "external_write",
      description: "通过受限网关部署 Agent 已选择并验证的完整提交。",
      input: { branch: "YYYYMMDD", commit: "40-hex commit" },
      execute: async (context, params) => {
        if (!/^\d{8}$/u.test(String(params.branch || ""))) fail("branch must be YYYYMMDD");
        const commit = fullCommit(params.commit, "commit");
        const result = ssh(context, ["release", params.branch, commit], { stream: true });
        return { branch: params.branch, commit, gatewayExit: result.code };
      },
    },
  },
  acceptance: {
    "production.runtime": {
      description: "独立验证提交身份、工作树、容器、PM2、日志和公网健康。",
      input: { expectedCommit: "optional 40-hex commit", logMinutes: "default 10" },
      verify: verifyProduction,
    },
  },
};
