from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[3]
CRON_PATH = REPO_ROOT / "apps/ingest/cron/ingest.cron"


def _compose_config(*profiles: str) -> dict:
    if shutil.which("docker") is None:
        pytest.skip("docker is not installed")

    profile_args = [arg for profile in profiles for arg in ("--profile", profile)]
    result = subprocess.run(
        ["docker", "compose", *profile_args, "config", "--format", "json"],
        cwd=REPO_ROOT,
        check=True,
        capture_output=True,
        text=True,
    )
    return json.loads(result.stdout)


def _has_volume(service: dict, source: str, target: str) -> bool:
    return any(
        volume["source"] == source and volume["target"] == target
        for volume in service["volumes"]
    )


def _has_backup_bind(service: dict) -> bool:
    return any(
        volume["type"] == "bind"
        and Path(volume["source"]).name == "backups"
        and volume["target"] == "/backups"
        for volume in service["volumes"]
    )


def test_compose_exposes_production_app_scheduler_and_ingest_only():
    config = _compose_config("prod")

    services = config["services"]
    assert set(services) >= {"app", "scheduler", "ingest"}
    assert "web" not in services
    assert "api" not in services

    data_volume = "vibe-idx-data"
    assert data_volume in config["volumes"]

    ingest = services["ingest"]

    assert ingest["build"]["target"] == "ingest"
    assert ingest["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert ingest["environment"]["VIBE_IDX_RAW_DIR"] == "/data/raw"
    assert ingest["environment"]["VIBE_IDX_BACKUP_DIR"] == "/backups"

    assert _has_volume(ingest, data_volume, "/data")
    assert _has_backup_bind(ingest)


def test_compose_exposes_compiled_app_for_production():
    config = _compose_config("prod")

    services = config["services"]
    assert set(services) >= {"app"}

    app = services["app"]
    assert app["build"]["target"] == "app"
    assert app["environment"]["VIBE_IDX_API_HOST"] == "0.0.0.0"
    assert app["environment"]["VIBE_IDX_API_PORT"] == "8080"
    assert app["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert app["environment"]["VIBE_IDX_BACKUP_DIR"] == "/backups"
    assert _has_volume(app, "vibe-idx-data", "/data")
    assert _has_backup_bind(app)


def test_compose_exposes_scheduler_for_production_ingestion():
    config = _compose_config("prod")

    services = config["services"]
    assert set(services) >= {"scheduler"}

    scheduler = services["scheduler"]
    assert scheduler["build"]["dockerfile"] == "apps/ingest/Dockerfile"
    assert scheduler["build"]["target"] == "scheduler"
    assert scheduler["environment"]["TZ"] == "Asia/Jakarta"
    assert scheduler["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert scheduler["environment"]["VIBE_IDX_RAW_DIR"] == "/data/raw"
    assert scheduler["environment"]["VIBE_IDX_BACKUP_DIR"] == "/backups"
    assert scheduler["command"] is None
    assert scheduler["entrypoint"] is None
    assert _has_volume(scheduler, "vibe-idx-data", "/data")
    assert _has_backup_bind(scheduler)


def test_scheduler_cron_runs_daily_and_monthly_ingestion_commands():
    cron = CRON_PATH.read_text()

    assert "0,30 19-21 * * 1-5 /etc/vibe-idx/run-daily.sh" in cron
    assert "0 22 * * 1-5 /etc/vibe-idx/run-daily.sh" in cron
    assert "0 9 2-10 * * /etc/vibe-idx/run-monthly.sh" in cron

    daily_script = (CRON_PATH.parent / "run-daily.sh").read_text()
    assert "/app/apps/ingest/.venv/bin/idx-ingest market-summary" in daily_script
    assert "/app/apps/ingest/.venv/bin/idx-ingest ksei-5pct" in daily_script
    assert "/app/apps/ingest/.venv/bin/idx-ingest insider" in daily_script

    monthly_script = (CRON_PATH.parent / "run-monthly.sh").read_text()
    assert "/app/apps/ingest/.venv/bin/idx-ingest ksei-1pct" in monthly_script
    assert "/app/apps/ingest/.venv/bin/idx-ingest laporan-efek" in monthly_script


def test_scheduler_cron_runs_daily_sqlite_backup():
    cron = CRON_PATH.read_text()

    assert "15 23 * * * /etc/vibe-idx/run-backup.sh" in cron

    backup_script = (CRON_PATH.parent / "run-backup.sh").read_text()
    assert "/app/apps/ingest/.venv/bin/idx-ingest db backup --output /backups" in backup_script

    dockerfile = (REPO_ROOT / "apps/ingest/Dockerfile").read_text()
    assert (
        "chmod +x /etc/vibe-idx/run-daily.sh "
        "/etc/vibe-idx/run-monthly.sh /etc/vibe-idx/run-backup.sh"
    ) in dockerfile
    assert 'ENTRYPOINT ["/usr/local/bin/supercronic"]' in dockerfile
    assert 'CMD ["/etc/vibe-idx/ingest.cron"]' in dockerfile


def test_web_dockerfile_does_not_define_dev_server_target():
    dockerfile = (REPO_ROOT / "apps/web/Dockerfile").read_text()

    assert " AS dev" not in dockerfile
