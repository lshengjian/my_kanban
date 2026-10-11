#!/usr/bin/env bash
# Wipe every table in a Convex deployment.
#
#   bash scripts/reset-data.sh          # 开发测试环境（.env.local 指定的 deployment）
#   bash scripts/reset-data.sh --prod   # 生产环境
#
# The "first registered user becomes admin" rule only holds on an empty
# `users` table, so run this before handing a fresh app to a user.
#
# ⚠️ DESTRUCTIVE and has no confirmation gate — back up first:
#      bash scripts/backup-deployments.sh
#
# `convex import` runs server-side asynchronously, so this script (a) retries
# each table against transient rate limiting and (b) waits until the wipe is
# actually visible before returning. A single `--replace-all` ZIP does NOT work
# here: an empty `documents.jsonl` is read as "nothing to import" and leaves the
# existing rows in place.
#
# Expect roughly 4 minutes: one sequential `npx convex import` per table.
set -uo pipefail
cd "$(dirname "$0")/.."

PROD_FLAG=()
if [[ "${1:-}" == "--prod" ]]; then
  PROD_FLAG=(--prod)
fi

# Every table in convex/schema.ts. Keep this list in step with the schema: an
# earlier revision listed the legacy tables `items`/`labelTemplates` but omitted
# goals/tasks/goalTasks/attachments, so it silently left the 目标项/任务项 behind.
#
# The legacy tables are deliberately NOT listed — they hold no current data, and
# they do not exist at all on a freshly created deployment, where importing into
# them would fail and make this script report a false error.
TABLES=(
  users sessions projects projectMembers joinRequests
  boards columns labels goals tasks goalTasks
  checklistItems attachments activityLog burndown
)

EMPTY="$(mktemp -t convex-empty-XXXXXX).json"
printf '[]' > "$EMPTY"

clear_table() {
  local table="$1" attempt
  for attempt in 1 2 3 4; do
    if npx convex import --table "$table" "${PROD_FLAG[@]+"${PROD_FLAG[@]}"}" \
        --format jsonArray --replace --yes "$EMPTY" >/dev/null 2>&1; then
      return 0
    fi
    # Transient ServiceUnavailable / rate limiting: back off and retry.
    sleep $((attempt * 3))
  done
  echo "  ! ${table}: import kept failing" >&2
  return 1
}

failed=0
for table in "${TABLES[@]}"; do
  if clear_table "$table"; then
    echo "  cleared ${table}"
  else
    failed=1
  fi
  # Server-side imports are async; a short gap keeps us under the rate limit.
  sleep 1
done

rm -f "$EMPTY"

# Wait until the wipe is actually visible, so the caller can immediately
# register the first (admin) user.
#
# Two traps here, both hit while writing this:
#   1. `convex data` writes the table body to STDERR, so it must be merged
#      (`2>&1`), not discarded.
#   2. `grep -q` exits on the first match and closes the pipe, which under
#      `pipefail` kills `npx` with SIGPIPE and reads as "not found".
# Hence: capture both streams, then match with `case`.
for attempt in $(seq 1 20); do
  snapshot="$(npx convex data users ${PROD_FLAG[@]+"${PROD_FLAG[@]}"} 2>&1 || true)"
  case "$snapshot" in
    *"no documents"*)
      echo "done - users table empty"
      exit $failed
      ;;
  esac
  sleep 3
done

echo "warning: users table still reports rows; check the dashboard" >&2
exit 1
