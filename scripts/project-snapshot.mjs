#!/usr/bin/env node
/**
 * 备份 / 恢复「示例项目」及其成员用户。
 *
 * 改数据表结构前先 `backup`，重部署 Convex 后端后用 `restore` 把看板、
 * 目标项、任务项和用户资料放回去。之所以需要它：schema 一旦变更，旧文档
 * 可能不再符合新的校验器，只能从这份快照重建。
 *
 *   node scripts/project-snapshot.mjs backup  [--project 复刻雷电游戏]
 *   node scripts/project-snapshot.mjs restore [--project 复刻雷电游戏]
 *
 * 快照写入 snapshots/<项目名>-<时间戳>.json，并维护一个 latest.json 指针，
 * restore 默认读它。
 */
import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SNAP_DIR = join(ROOT, "snapshots");

/** 按项目划分的表：整表导出后按 projectId 过滤。 */
// burndown is deliberately absent: it is derived data, rebuilt by the record
// functions from tasks and goals, and its schema has changed shape before.
const PROJECT_SCOPED = [
  "projects",
  "projectMembers",
  "joinRequests",
  "boards",
  "columns",
  "goals",
  "goalSprints",
  "tasks",
  "goalTasks",
  "checklistItems",
  "attachments",
  "labels",
  "activityLog",
];

/** 全局表：不属于任何项目，整表保留。 */
const GLOBAL = ["users", "sessions"];

const TABLES = [...PROJECT_SCOPED, ...GLOBAL];

function convexUrl() {
  const env = readFileSync(join(ROOT, ".env.local"), "utf8");
  const m = env.match(/VITE_CONVEX_URL=(.+)/);
  if (!m) throw new Error(".env.local 里没有 VITE_CONVEX_URL");
  return m[1].trim();
}

/** `convex data <table> --format jsonArray` 的输出前面带表头，需要跳过。 */
function readTable(url, table) {
  const raw = execSync(`npx convex data ${table} --format jsonArray`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = raw.trim().split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("["));
  if (start < 0) return [];
  return JSON.parse(lines.slice(start).join("\n"));
}

function writeTable(table, rows) {
  const tmp = join(ROOT, ".import-tmp.json");
  writeFileSync(tmp, JSON.stringify(rows));
  execSync(
    `npx convex import --table ${table} --format jsonArray --replace --yes ${tmp}`,
    { cwd: ROOT, stdio: "ignore" },
  );
}

/** `projects` 用 _id 标识自己，没有 projectId 字段——按它过滤会清空整表。 */
function belongsTo(row, projectId, table) {
  return table === "projects" ? row._id === projectId : row.projectId === projectId;
}

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

function backup(projectName) {
  const url = convexUrl();
  const all = {};
  for (const t of TABLES) all[t] = readTable(url, t);

  const project = all.projects.find((p) => p.name === projectName);
  if (!project) {
    throw new Error(
      `找不到项目「${projectName}」。现有项目：${all.projects.map((p) => p.name).join("、")}`,
    );
  }
  const id = project._id;

  const memberIds = new Set(
    all.projectMembers.filter((m) => m.projectId === id).map((m) => m.userId),
  );

  const snapshot = {
    savedAt: new Date().toISOString(),
    project: { id, name: project.name, key: project.key },
    userIds: [...memberIds],
    tables: {},
  };

  for (const t of PROJECT_SCOPED) {
    snapshot.tables[t] = all[t].filter((r) => belongsTo(r, id, t));
  }
  // 用户资料与登录态：只留项目成员，避免把测试账户一并带走。
  snapshot.tables.users = all.users.filter((u) => memberIds.has(u._id));
  snapshot.tables.sessions = all.sessions.filter((s) => memberIds.has(s.userId));
  // 系统预设也是 labels 表的一部分（scope="system"），一并保存，
  // 这样即使整库重建也能把管理员配的类型恢复出来。
  snapshot.tables.labels = [
    ...snapshot.tables.labels,
    ...all.labels.filter((l) => l.scope === "system"),
  ];

  mkdirSync(SNAP_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const file = join(SNAP_DIR, `${project.name}-${stamp}.json`);
  writeFileSync(file, JSON.stringify(snapshot, null, 2));
  writeFileSync(join(SNAP_DIR, "latest.json"), file);

  const summary = Object.entries(snapshot.tables)
    .map(([t, rows]) => `${t}=${rows.length}`)
    .join("  ");
  console.log(`已备份「${project.name}」→ ${file}`);
  console.log(`  ${summary}`);
  return file;
}

function restore(projectName) {
  const pointer = join(SNAP_DIR, "latest.json");
  if (!existsSync(pointer)) {
    throw new Error(`没有快照。先运行：node scripts/project-snapshot.mjs backup --project ${projectName}`);
  }
  const file = readFileSync(pointer, "utf8").trim();
  const snap = JSON.parse(readFileSync(file, "utf8"));

  const id = snap.project.id;
  console.log(`恢复「${snap.project.name}」← ${file}`);

  for (const t of TABLES) {
    writeTable(t, snap.tables[t] ?? []);
  }

  const summary = Object.entries(snap.tables)
    .map(([t, rows]) => `${t}=${rows.length}`)
    .join("  ");
  console.log(`  ${summary}`);
  console.log("提示：import 是服务端异步的，若刚注册请稍等几秒再查。");
}

const cmd = process.argv[2];
const projectName = arg("--project", "复刻雷电游戏");
try {
  if (cmd === "backup") backup(projectName);
  else if (cmd === "restore") restore(projectName);
  else {
    console.log(
      `用法:\n  node scripts/project-snapshot.mjs backup  [--project 复刻雷电游戏]\n  node scripts/project-snapshot.mjs restore [--project 复刻雷电游戏]`,
    );
    console.log(`\n已有快照: ${readdirSync(SNAP_DIR).join(", ") || "(无)"}`);
  }
} catch (err) {
  console.error(`失败: ${err.message}`);
  process.exit(1);
}