#!/usr/bin/env bash
# Usage: pull-fixtures.sh [session date ...]
# Copies the private site files into $VIBE_FIXTURES: all broker histories, plus every ticker's ticks for each date.
set -euo pipefail
out=${VIBE_FIXTURES:-$HOME/.cache/vibe-idx/fixtures}
: "${R2_ACCOUNT_ID:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
export AWS_ACCESS_KEY_ID=$R2_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY=$R2_SECRET_ACCESS_KEY AWS_DEFAULT_REGION=auto
include=()
for date in "$@"; do include+=(--include "ticks/*/$date.*"); done
uvx --quiet --from awscli aws s3 sync s3://vibe-idx-private/site/ "$out/site/" \
  --endpoint-url "https://$R2_ACCOUNT_ID.r2.cloudflarestorage.com" --only-show-errors \
  --exclude 'ticks/*' "${include[@]}"
