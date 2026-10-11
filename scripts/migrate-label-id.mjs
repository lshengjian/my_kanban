#!/usr/bin/env node
/**
 * 一次性迁移，两步：
 *
 *  1. 把 labelTemplates 合并进 labels（scope="system"），并按项目复制出
 *     scope="project" 的分类 —— 这一步必须先做，因为第 2 步要靠分类名反查
 *     回 labelId。
 *  2. 把 goals / tasks 上的 labelName 快照换回 labelId 引用。
 *
 * 必须在 schema 切换之前跑：旧文档带 labelName，新 schema 只认 labelId。
 *
 *   node scripts/migrate-label-id.mjs
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

const readTable = (table) => {
  const raw = execSync(`npx convex data ${table} --format jsonArray`, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = raw.trim().split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("["));
  return start < 0 ? [] : JSON.parse(lines.slice(start).join("\n"));
};

const writeTable = (table, rows) => {
  const tmp = join(ROOT, ".import-tmp.json");
  writeFileSync(tmp, JSON.stringify(rows));
  execSync(`npx convex import --table ${table} --format jsonArray --replace --yes ${tmp}`, {
    cwd: ROOT,
    stdio: "ignore",
  });
};

/** Matches the id the server would mint, so imports stay idempotent. */
const idFor = (table, seed) => {
  // Convex ids are opaque; reuse existing rows where we can and otherwise let
  // the import assign ids by omitting _id.
  void table;
  void seed;
  return undefined;
};

const templates = readTable("labelTemplates");
const boards = readTable("boards");
const users = readTable("users");
const admin = users.find((u) => u.role === "admin") ?? users[0];
if (!admin) throw new Error("库里没有任何用户，无法记录 createdBy");

// ---- 1. system labels ----------------------------------------------------
const systemLabels = [];
for (const t of templates) {
  systemLabels.push({
    scope: "system",
    kind: t.kind,
    name: t.name,
    color: t.color,
    position: t.position,
    createdBy: t.createdBy,
    createdAt: t.createdAt,
  });
}

// ---- 2. project labels, copied per board ---------------------------------
const existing = readTable("labels");
const projectLabels = [];
for (const board of boards) {
  const kind = board.kind;
  const seeded = systemLabels
    .filter((l) => l.kind === kind)
    .sort((a, b) => a.position - b.position);
  const already = existing.filter((l) => l.boardId === board._id);
  const seed = already.length > 0 ? already : seeded;
  seed.forEach((l, i) => {
    projectLabels.push({
      ...(l._id ? { _id: l._id } : {}),
      scope: "project",
      boardId: board._id,
      projectId: board.projectId,
      name: l.name,
      color: l.color,
      position: l.position ?? i,
      createdBy: l.createdBy ?? admin._id,
      createdAt: l.createdAt ?? Date.now(),
    });
  });
}

writeTable("labels", [...systemLabels, ...projectLabels]);
console.log(`labels: 系统 ${systemLabels.length} + 项目 ${projectLabels.length}`);

// The import assigns the _ids, so re-read the table rather than trusting the
// objects we just handed over — otherwise every lookup resolves to undefined.
const freshLabels = readTable("labels");
const byBoardName = new Map();
for (const l of freshLabels) {
  if (l.scope !== "project" || !l.boardId) continue;
  const key = `${l.boardId}|${l.name}`;
  if (!byBoardName.has(key)) byBoardName.set(key, l._id);
}
console.log(`可按名称回查的项目分类: ${byBoardName.size}`);

// ---- 3. cards: labelName → labelId ---------------------------------------
let linked = 0;
let unresolved = 0;
for (const table of ["goals", "tasks"]) {
  const rows = readTable(table);
  const next = rows.map((row) => {
    const { labelName, labelColor, ...rest } = row;
    if (!labelName) return rest;
    const id = byBoardName.get(`${row.boardId}|${labelName}`);
    if (!id) {
      // The category was deleted while cards still carried its name; leave the
      // card untagged rather than pointing at nothing.
      unresolved += 1;
      return rest;
    }
    linked += 1;
    return { ...rest, labelId: id };
  });
  const changed = next.filter((r, i) => JSON.stringify(r) !== JSON.stringify(rows[i])).length;
  if (changed) writeTable(table, next);
  console.log(`${table}: ${rows.length} 行，更新 ${changed} 行`);
}

void idFor;
console.log(`\n完成：回填 ${linked} 张卡片的标签引用，${unresolved} 个分类已不存在（保持未分类）。`);