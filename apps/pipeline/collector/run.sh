#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)
state=${XDG_STATE_HOME:-$HOME/.local/state}/vibe-idx-collector
mkdir -p "$state"
exec 9>"$state/lock"
flock -n 9 || { echo 'Another collector run holds the lock' >&2; exit 1; }
[[ $(node -v) == v24.* ]] || { echo "Node 24 required, found $(node -v)" >&2; exit 1; }
: "${R2_ACCOUNT_ID:?}" "${AWS_ACCESS_KEY_ID:?}" "${AWS_SECRET_ACCESS_KEY:?}"

# Back off after failed runs so a revoked token is not refreshed every minute.
failures=$(cat "$state/failures" 2>/dev/null || echo 0)
if ((failures > 0)); then sleep $((failures >= 5 ? 1800 : 60 << failures)); fi

fail() {
  echo $((failures + 1)) >"$state/failures"
  exit 1
}

data=$(mktemp -d)
trap 'rm -rf "$data"' EXIT
mkdir -p "$data/parquet"
uvx --quiet --from awscli aws s3 sync s3://vibe-idx-private/parquet "$data/parquet" \
  --exclude '*' --include 'prices/*.parquet' --include 'corporate_actions/*.parquet' \
  --include 'broker_activity/*.parquet' --include 'broker-activity-coverage.parquet' \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --only-show-errors || {
  status=$?
  if ((status == 130 || status == 143)); then exit "$status"; fi
  fail
}

status=0
# Run node itself: pnpm exits as soon as it is signalled, and systemd then kills node before it releases the run marker.
(cd "$repo/apps/pipeline" && node --import tsx brokers.ts \
  --data "$data" --token "$state/stockbit.json" --out "$data/private") || status=$?
# 130 and 143 mean systemd stopped the run, not that it failed.
if ((status == 130 || status == 143)); then exit "$status"; fi
echo $((status == 0 ? 0 : failures + 1)) >"$state/failures"
exit "$status"
