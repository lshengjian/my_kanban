#!/usr/bin/env bash
#
# 【强制】任何数据表结构（convex/schema.ts）或卡片数据结构相关的改动之前，
# 必须先备份 **开发版** 和 **产品版** 两个 deployment 的全部数据。
#
#   bash scripts/backup-deployments.sh            # 只备份数据（快）
#   bash scripts/backup-deployments.sh --files    # 连附件等文件存储一起备份
#
# 产物：backups/<时间戳>/dev.zip 与 prod.zip
#
# ⚠️ backups/ 已在 .gitignore 中。导出包含 sessions 表的**明文 bearer token**
#    以及成员邮箱，本仓库是公开仓库，绝不能提交这些归档。
#
set -euo pipefail

cd "$(dirname "$0")/.."

WITH_FILES=""
if [[ "${1:-}" == "--files" ]]; then
  WITH_FILES="--include-file-storage"
fi

STAMP="$(date +%Y-%m-%dT%H-%M-%S)"
OUT="backups/$STAMP"
mkdir -p "$OUT"

echo "→ 备份【开发版 dev】"
npx convex export $WITH_FILES --path "$OUT/dev.zip"

echo
echo "→ 备份【产品版 prod】"
npx convex export --prod $WITH_FILES --path "$OUT/prod.zip"

echo
echo "✓ 备份完成：$OUT"

# 逐项确认产物非空——空归档（例如误指到未初始化的 deployment）必须立刻发现，
# 否则会误以为"已经备份过了"。
for f in "$OUT/dev.zip" "$OUT/prod.zip"; do
  if [[ ! -s "$f" ]]; then
    echo "  ✗ $f 缺失或为空 —— 备份不可信，请勿继续改 schema" >&2
    exit 1
  fi
  printf "  ✓ %-14s %s bytes\n" "$(basename "$f")" "$(wc -c < "$f" | tr -d ' ')"
done

cat <<EOF

恢复（导入）示例：
  npx convex import --replace $OUT/dev.zip           # 开发版
  npx convex import --prod --replace $OUT/prod.zip   # 产品版
EOF
