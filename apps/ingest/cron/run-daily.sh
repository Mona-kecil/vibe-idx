#!/bin/sh
set -eu

/app/apps/ingest/.venv/bin/idx-ingest market-summary
/app/apps/ingest/.venv/bin/idx-ingest ksei-5pct
/app/apps/ingest/.venv/bin/idx-ingest insider
