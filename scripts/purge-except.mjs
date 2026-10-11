#!/usr/bin/env node
/**
 * ⛔ 危险：清空数据库，只保留指定项目及其成员用户。
 *
 * 测试会不断造项目，跑完用这个收干净。注意 labels 表里 scope="system"
 * 的那批是全局配置，不能按 projectId 过滤掉。
 *
 *   node scripts/purge-except.mjs [项目名]
 */
// ⛔ 这个脚本会整表覆盖（convex import --replace），等同于删除线上数据。
// 2026-10-10 起禁止对生产库使用。只有在一次性的临时预览部署上才允许。
if (process.env.ALLOW_PURGE !== "1") {
  console.error(
    "\n⛔ 拒绝执行：purge-except.mjs 会删除生产数据。\n" +
      "   线上数据不可删除（见 AGENTS.md）。\n" +
      "   确实需要清空时，请显式设置 ALLOW_PURGE=1，并且只在临时预览部署上运行。\n",
  );
  process.exit(1);
}
import { execSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const KEEP_NAME = process.argv[2] ?? "复刻雷电游戏";

const PROJECT_SCOPED = [
  "projects",
  "projectMembers",
  "joinRequests",
  "boards",
  "columns",
  "goals",
  "tasks",
  "goalTasks",
  "checklistItems",
  "attachments",
  "labels",
  "activityLog",
  "burndown",
];

function readTable(table) {
  const raw = execSync(`npx convex data ${table} --format jsonArray`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = raw.trim().split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("["));
  return start < 0 ? [] : JSON.parse(lines.slice(start).join("\n"));
}

function writeTable(table, rows) {
  const tmp = join(ROOT, ".import-tmp.json");
  writeFileSync(tmp, JSON.stringify(rows));
  execSync(`npx convex import --table ${table} --format jsonArray --replace --yes ${tmp}`, {
    cwd: ROOT,
    stdio: "ignore",
  });
}

const all = {};
for (const t of [...PROJECT_SCOPED, "users", "sessions", "labels"]) {
  all[t] = readTable(t);
}

const keep = all.projects.find((p) => p.name === KEEP_NAME);
if (!keep) {
  console.log(`没有「${KEEP_NAME}」，全部项目如下：`);
  for (const p of all.projects) console.log(`  ${p.name}`);
  process.exit(1);
}

const memberIds = new Set(
  all.projectMembers.filter((m) => m.projectId === keep._id).map((m) => m.userId),
);

// `labels` holds both levels, so it cannot go through the blanket per-project
// filter: the scope="system" rows carry no projectId and would be dropped.
const systemLabels = all.labels.filter((l) => l.scope === "system");

for (const t of PROJECT_SCOPED) {
  // projects is keyed by _id; filtering it by projectId would empty the table.
  const rows =
    t === "projects"
      ? [keep]
      : t === "labels"
        ? all[t].filter(
            (r) => r.scope === "system" || r.projectId === keep._id,
          )
        : all[t].filter((r) => r.projectId === keep._id);
  writeTable(t, rows);
  console.log(`${t.padEnd(16)} ${String(all[t].length).padStart(4)} → ${String(rows.length).padStart(3)}`);
}

// Hard guard: the system presets carry no projectId, so any filtering mistake
// silently deletes organisation-wide configuration. The check is unconditional —
// an empty vocabulary is a bug whether or not the table started out populated.
const finalLabels = readTable("labels");
const keptSystem = finalLabels.filter((l) => l.scope === "system").length;
if (keptSystem !== systemLabels.length) {
  console.error(
    `\n✗ 系统预设数量不符：期望 ${systemLabels.length}，实际 ${keptSystem}。` +
      `请从 snapshots/ 恢复 labels 表。`,
  );
  process.exit(1);
}

writeTable("users", all.users.filter((u) => memberIds.has(u._id)));
writeTable("sessions", all.sessions.filter((s) => memberIds.has(s.userId)));
console.log(`其中系统预设      ${keptSystem} 条 (scope="system"，全局配置，已保留)`);
console.log(`users            ${all.users.length} → ${memberIds.size}`);
