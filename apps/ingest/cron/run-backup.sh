#!/bin/sh
set -eu

/app/apps/ingest/.venv/bin/idx-ingest db backup --output /backups
