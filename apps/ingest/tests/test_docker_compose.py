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


def test_compose_exposes_web_api_and_ingest_with_shared_data_volume():
    config = _compose_config("tools")

    services = config["services"]
    assert set(services) >= {"web", "api", "ingest"}

    data_volume = "vibe-idx-data"
    assert data_volume in config["volumes"]

    web = services["web"]
    api = services["api"]
    ingest = services["ingest"]

    assert web["environment"]["VIBE_IDX_API_PROXY_TARGET"] == "http://api:20240"
    assert api["environment"]["VIBE_IDX_API_HOST"] == "0.0.0.0"
    assert api["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert ingest["build"]["target"] == "ingest"
    assert ingest["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert ingest["environment"]["VIBE_IDX_RAW_DIR"] == "/data/raw"

    assert any(volume["source"] == data_volume and volume["target"] == "/data" for volume in api["volumes"])
    assert any(
        volume["source"] == data_volume and volume["target"] == "/data" for volume in ingest["volumes"]
    )


def test_compose_exposes_compiled_app_for_production():
    config = _compose_config("prod")

    services = config["services"]
    assert set(services) >= {"app"}

    app = services["app"]
    assert app["build"]["target"] == "app"
    assert app["environment"]["VIBE_IDX_API_HOST"] == "0.0.0.0"
    assert app["environment"]["VIBE_IDX_API_PORT"] == "8080"
    assert app["environment"]["VIBE_IDX_DATABASE_URL"] == "sqlite:////data/vibe_idx.sqlite"
    assert any(volume["source"] == "vibe-idx-data" and volume["target"] == "/data" for volume in app["volumes"])


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
    assert scheduler["command"] == ["/etc/vibe-idx/ingest.cron"]
    assert scheduler["entrypoint"] == ["supercronic"]
    assert any(
        volume["source"] == "vibe-idx-data" and volume["target"] == "/data"
        for volume in scheduler["volumes"]
    )


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
