#!/bin/sh
set -eu

/app/apps/ingest/.venv/bin/idx-ingest ksei-1pct
/app/apps/ingest/.venv/bin/idx-ingest laporan-efek
