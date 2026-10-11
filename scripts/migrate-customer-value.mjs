#!/usr/bin/env node
/**
 * 一次性迁移：goals.storyPoints → goals.value（客户价值估计，1~10）
 *
 * 严格非破坏性：逐行调用 updateGoal 就地改字段，
 * 不使用 convex import --replace（那会整表覆盖，等同删除）。
 *
 *   node scripts/migrate-customer-value.mjs
 */
import { execSync } from "node:child_process";

const CONVEX_URL = process.env.CONVEX_URL;
if (!CONVEX_URL) {
  console.error("需要 CONVEX_URL 环境变量");
  process.exit(1);
}

/**
 * Read the raw table, not getBoard(): the board projection already exposes
 * `value`, so the legacy `storyPoints` field would be invisible through the API
 * even though it is still on every document.
 */
function readRawGoals() {
  const raw = execSync("npx convex data goals --format jsonArray", {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    stdio: ["ignore", "pipe", "ignore"],
  });
  const lines = raw.trim().split("\n");
  const start = lines.findIndex((l) => l.trim().startsWith("["));
  return start < 0 ? [] : JSON.parse(lines.slice(start).join("\n"));
}

const { ConvexHttpClient } = await import("convex/browser");
const { api } = await import("../convex/_generated/api.js");
const c = new ConvexHttpClient(CONVEX_URL);
const q = (m, n, a = {}) => c.query(api[m][n], a);
const mut = (m, n, a) => c.mutation(api[m][n], a);

/** 故事点无上限；客户价值估计是 1~10，超出的夹紧。 */
function toValue(points) {
  if (!Number.isFinite(points) || points <= 0) return undefined;
  return Math.min(10, Math.max(1, Math.round(points)));
}

const token = process.argv[2];
if (!token) {
  console.error("用法: node scripts/migrate-customer-value.mjs <token>");
  process.exit(1);
}

const goals = readRawGoals();
const withPoints = goals.filter((g) => g.storyPoints !== undefined);
console.log(`goals: ${goals.length} 行，其中带旧 storyPoints 的 ${withPoints.length} 行`);

let moved = 0;
let clamped = 0;
let cleared = 0;

for (const g of withPoints) {
  const v = toValue(g.storyPoints);
  if (v === undefined) {
    await mut("goals", "updateGoal", { token, goalId: g._id, value: null });
    cleared += 1;
    continue;
  }
  if (v !== g.storyPoints) clamped += 1;
  await mut("goals", "updateGoal", { token, goalId: g._id, value: v });
  moved += 1;
  console.log(`  ${g.title}: ${g.storyPoints} → ${v}`);
}

console.log(
  `\n迁移 ${moved} 行` +
    `${clamped ? `（${clamped} 行夹紧到 1~10）` : ""}` +
    `${cleared ? `，${cleared} 行无效值已清除` : ""}` +
    `${moved === 0 && cleared === 0 ? "（无待迁移数据）" : ""}`,
);

const check = readRawGoals();
console.log(`校验: goals ${check.length} 行（迁移前 ${goals.length}）`);
if (check.length !== goals.length) {
  console.error("✗ 行数发生变化，迁移不安全！");
  process.exit(1);
}
